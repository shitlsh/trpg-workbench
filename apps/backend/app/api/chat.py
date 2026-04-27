"""Chat session + message API — file-first, SSE streaming.

Messages stored in .trpg/chat/{session-id}.jsonl.
ChatSessionORM in cache.db is an index only.

POST /chat/sessions/{id}/messages  → SSE stream
"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import ChatSessionORM, WorkspaceORM
from app.models.schemas import (
    ChatSessionSchema, ChatMessageSchema,
    ChatSessionCreate, SendMessageRequest,
    UpdateChatSessionRequest,
)
from app.services import chat_service
from app.agents.director import run_director_stream
from app.agents.explore import run_explore_stream
from app.workflows.utils import get_workspace_context
from app.services.model_routing import get_llm_for_task, ModelNotConfiguredError
from app.services.llm_defaults import task_temperature
from app.agents.model_adapter import model_from_profile
from app.core.settings import LLM_REQUEST_TIMEOUT_SECONDS
from app.prompts import load_prompt

router = APIRouter(prefix="/chat", tags=["chat"])


# ─── History compaction helper ────────────────────────────────────────────────

async def _summarize_dropped_messages(
    dropped: list[dict],
    profile,
    model_name: str,
) -> str | None:
    """Generate a ≤200-char summary of dropped messages via a one-shot LLM call.

    Returns None on any failure so callers fall back to the generic Phase-1 notice.
    """
    if not dropped:
        return None
    try:
        from openai import AsyncOpenAI
        from app.agents.model_adapter import _decrypt_key

        api_key = _decrypt_key(profile) or "dummy"
        base_url = profile.base_url or None
        client_kw: dict = {"api_key": api_key, "base_url": base_url}
        if LLM_REQUEST_TIMEOUT_SECONDS is not None:
            client_kw["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
        client = AsyncOpenAI(**client_kw)

        lines = []
        for m in dropped:
            role = m.get("role", "user")
            content = (m.get("content", "") or "")[:300]
            lines.append(f"{role}: {content}")
        transcript = "\n".join(lines)

        summary_system = load_prompt("chat", "summary_system")
        resp = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": summary_system},
                {"role": "user", "content": transcript},
            ],
            max_tokens=150,
            temperature=task_temperature("summary"),
        )
        summary = (resp.choices[0].message.content or "").strip()
        return summary[:300] if summary else None
    except Exception:
        return None

# ─── Session management ───────────────────────────────────────────────────────

@router.post("/sessions", response_model=ChatSessionSchema, status_code=201)
def create_session(body: ChatSessionCreate, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, body.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    meta = chat_service.create_session(
        workspace_path=ws.workspace_path,
        workspace_id=body.workspace_id,
        agent_scope=body.agent_scope,
        title=body.title,
    )

    session = ChatSessionORM(
        id=meta["id"],
        workspace_id=body.workspace_id,
        agent_scope=body.agent_scope,
        title=body.title,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions", response_model=list[ChatSessionSchema])
def list_sessions(workspace_id: str = Query(...), db: Session = Depends(get_db)):
    """List all sessions for a workspace, newest first."""
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    sessions = chat_service.list_sessions(ws.workspace_path)
    # Inject workspace_id and ensure message_count is present
    result = []
    for s in sessions:
        s = dict(s)
        s["workspace_id"] = workspace_id  # get_session_metadata always sets "" so we must override
        s.setdefault("agent_scope", None)
        s.setdefault("message_count", 0)
        result.append(s)
    return result


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, workspace_id: str = Query(...), db: Session = Depends(get_db)):
    """Delete a chat session (JSONL file + DB record)."""
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    from pathlib import Path
    jsonl_path = Path(ws.workspace_path) / ".trpg" / "chat" / f"{session_id}.jsonl"
    if jsonl_path.exists():
        jsonl_path.unlink()
    db.query(ChatSessionORM).filter(ChatSessionORM.id == session_id).delete()
    db.commit()


@router.patch("/sessions/{session_id}", response_model=ChatSessionSchema)
def update_session(session_id: str, body: UpdateChatSessionRequest, db: Session = Depends(get_db)):
    """Rename a chat session."""
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.title = body.title
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=ChatSessionSchema)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageSchema])
def get_messages(
    session_id: str,
    workspace_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """Read messages from JSONL file on disk.

    workspace_id query param is preferred over session.workspace_id so that
    sessions created under an old workspace record (removed + re-added) can
    still be loaded via the current workspace.
    """
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Prefer the caller-supplied workspace_id (current, valid) over the one
    # stored on the session (may point to a deleted workspace record).
    effective_workspace_id = workspace_id or session.workspace_id
    ws = db.get(WorkspaceORM, effective_workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Heal the session record so future lookups work without the query param.
    if workspace_id and session.workspace_id != workspace_id:
        session.workspace_id = workspace_id
        db.commit()

    return chat_service.read_messages(ws.workspace_path, session_id)


# ─── SSE streaming send message ──────────────────────────────────────────────

@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    body: SendMessageRequest,
    db: Session = Depends(get_db),
):
    """Send a user message and stream agent response via SSE (Director 或 Explore).

    `agent_scope` 在创建会话时设置；`explore` 为只读探索，其余为创作向 Director。

    Returns: text/event-stream
    Events: text_delta, tool_call_start, tool_call_result, auto_applied, done, error
    """
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ws = db.get(WorkspaceORM, body.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Save user message
    chat_service.append_message(
        workspace_path=ws.workspace_path,
        session_id=session_id,
        role="user",
        content=body.content,
    )

    # Resolve model
    try:
        profile, model_name, temperature = get_llm_for_task(body.workspace_id, "chat", db)
        # Allow per-message model override (e.g. from AgentPanel model switcher)
        if body.model:
            model_name = body.model
        model = model_from_profile(profile, model_name)
    except ModelNotConfiguredError as e:
        async def _err_stream():
            yield _sse("error", {"message": str(e)})
            yield _sse("done", {})
        return StreamingResponse(_err_stream(), media_type="text/event-stream")

    # Get workspace context
    ws_ctx = get_workspace_context(db, body.workspace_id)

    scope = (session.agent_scope or "").strip().lower()
    run_stream = run_explore_stream if scope == "explore" else run_director_stream

    # Multi-turn history
    history = chat_service.read_recent_messages(ws.workspace_path, session_id, limit=20)
    trimmed, truncated = chat_service.trim_to_budget(history)
    # Remove the just-appended user message (it's already the `body.content` we pass)
    if trimmed and trimmed[-1]["role"] == "user":
        trimmed = trimmed[:-1]

    # If history was truncated, try to generate a summary of dropped messages (Phase 2).
    # Fall back to a generic notice if the LLM call fails (Phase 1 behaviour).
    if truncated:
        dropped = history[: len(history) - len(trimmed)]
        summary = await _summarize_dropped_messages(dropped, profile, model_name)
        if summary:
            truncation_notice = f"[上下文摘要：{summary}]"
        else:
            truncation_notice = "[系统提示：对话历史较长，部分早期内容已移出上下文窗口]"
        chat_service.append_message(
            workspace_path=ws.workspace_path,
            session_id=session_id,
            role="system",
            content=truncation_notice,
        )
        history = [{"role": "system", "content": truncation_notice}] + trimmed
    else:
        history = trimmed

    # Handle @mention referenced assets
    referenced_assets: list[dict] = []
    if body.referenced_asset_ids:
        from app.services import asset_service
        for aid in body.referenced_asset_ids:
            from app.models.orm import AssetORM
            asset = db.get(AssetORM, aid)
            if asset:
                try:
                    content = asset_service.read_asset_content(ws.workspace_path, asset)
                    referenced_assets.append({"name": asset.name, "content": content})
                except Exception:
                    pass

    async def _event_generator():
        text_buffer = []
        tool_calls_emitted: list[dict] = []
        thinking_buffer: list[str] = []

        # ── Keepalive via asyncio queue ───────────────────────────────────────
        # The director may go silent for 30-60s while LM Studio processes a
        # large prompt.  We run the director in a background task and yield
        # SSE comment keepalives every 15s so Tauri / proxies don't drop the
        # connection.
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce():
            try:
                async for evt in run_stream(
                    user_message=body.content,
                    workspace_context=ws_ctx,
                    model=model,
                    history=history,
                    referenced_assets=referenced_assets or None,
                    db=db,
                    temperature=temperature,
                ):
                    await queue.put(("evt", evt))
            except Exception as exc:
                await queue.put(("exc", exc))
            finally:
                await queue.put(("done", None))

        producer = asyncio.create_task(_produce())

        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # No event in 15s — send SSE comment to keep connection alive
                    yield ": keepalive\n\n"
                    continue

                if kind == "done":
                    break

                if kind == "exc":
                    yield _sse("error", {"message": str(payload)})
                    yield _sse("done", {})
                    break

                evt = payload
                event_type = evt.get("event")
                data = evt.get("data", {})

                if event_type == "text_delta":
                    text_buffer.append(data.get("content", ""))
                    yield _sse("text_delta", data)

                elif event_type == "thinking_delta":
                    thinking_buffer.append(data.get("content", ""))
                    yield _sse("thinking_delta", data)

                elif event_type == "tool_call_start":
                    tool_calls_emitted.append({
                        "id": data.get("id", ""),
                        "name": data.get("name", ""),
                        "arguments": data.get("arguments", "{}"),
                        "status": "running",
                        "result_summary": None,
                    })
                    yield _sse("tool_call_start", data)

                elif event_type == "tool_call_result":
                    tc_id = data.get("id", "")
                    for tc in tool_calls_emitted:
                        if tc["id"] == tc_id:
                            tc["status"] = "done"
                            tc["result_summary"] = data.get("summary", "")
                    yield _sse("tool_call_result", data)

                elif event_type == "auto_applied":
                    # Asset written directly — update last tool call status
                    if tool_calls_emitted:
                        tool_calls_emitted[-1]["status"] = "auto_applied"
                        tool_calls_emitted[-1]["result_summary"] = (
                            f"{data.get('action', 'written')}: {data.get('slug', '')}"
                        )
                    yield _sse("auto_applied", data)

                elif event_type == "done":
                    # Save assistant message
                    final_text = "".join(text_buffer)
                    tc_json = json.dumps(tool_calls_emitted, ensure_ascii=False) if tool_calls_emitted else None
                    final_thinking = "".join(thinking_buffer) if thinking_buffer else None
                    chat_service.append_message(
                        workspace_path=ws.workspace_path,
                        session_id=session_id,
                        role="assistant",
                        content=final_text,
                        tool_calls_json=tc_json,
                        thinking_json=final_thinking,
                    )
                    # Update session
                    session.message_count = (session.message_count or 0) + 2
                    if not session.title and body.content:
                        session.title = body.content[:100]
                    db.commit()
                    yield _sse("done", {})

                elif event_type == "error":
                    yield _sse("error", data)
                    yield _sse("done", {})

        except asyncio.CancelledError:
            producer.cancel()
            raise
        except Exception as e:
            yield _sse("error", {"message": str(e)})
            yield _sse("done", {})
        finally:
            if not producer.done():
                producer.cancel()

    return StreamingResponse(_event_generator(), media_type="text/event-stream")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    """Format an SSE event string."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
