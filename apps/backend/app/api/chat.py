"""Chat session + message API — file-first, SSE streaming.

Messages stored in .trpg/chat/{session-id}.jsonl.
ChatSessionORM in cache.db is an index only.

POST /chat/sessions/{id}/messages  → SSE stream
POST /chat/sessions/{id}/confirm/{proposal_id}  → apply PatchProposal
POST /chat/sessions/{id}/reject/{proposal_id}   → reject PatchProposal
"""
import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
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
from app.workflows.utils import get_workspace_context
from app.services.model_routing import get_llm_for_task, ModelNotConfiguredError
from app.agents.model_adapter import model_from_profile

router = APIRouter(prefix="/chat", tags=["chat"])

# In-memory proposal store: {session_id: {proposal_id: proposal_dict}}
# In production this would be in Redis/DB but for local single-user app this is fine.
_pending_proposals: dict[str, dict[str, dict]] = {}


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
def get_messages(session_id: str, db: Session = Depends(get_db)):
    """Read messages from JSONL file on disk."""
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ws = db.get(WorkspaceORM, session.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return chat_service.read_messages(ws.workspace_path, session_id)


# ─── SSE streaming send message ──────────────────────────────────────────────

@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    body: SendMessageRequest,
    db: Session = Depends(get_db),
):
    """Send a user message and stream Director response via SSE.

    Returns: text/event-stream
    Events: text_delta, tool_call_start, tool_call_result, patch_proposal, done, error
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
        profile, model_name = get_llm_for_task(body.workspace_id, "chat", db)
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

    # Multi-turn history
    history = chat_service.read_recent_messages(ws.workspace_path, session_id, limit=20)
    history = chat_service.trim_to_budget(history)
    # Remove the just-appended user message (it's already the `body.content` we pass)
    if history and history[-1]["role"] == "user":
        history = history[:-1]

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

    # Also handle create_skill inline (legacy, keep for now)
    async def _event_generator():
        text_buffer = []
        tool_calls_emitted: list[dict] = []
        patch_proposals: list[dict] = []

        try:
            async for evt in run_director_stream(
                user_message=body.content,
                workspace_context=ws_ctx,
                model=model,
                history=history,
                referenced_assets=referenced_assets or None,
                db=db,
            ):
                event_type = evt.get("event")
                data = evt.get("data", {})

                if event_type == "text_delta":
                    text_buffer.append(data.get("content", ""))
                    yield _sse("text_delta", data)

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

                elif event_type == "patch_proposal":
                    proposal = dict(data)
                    if not proposal.get("id"):
                        proposal["id"] = f"pp_{uuid.uuid4().hex[:12]}"
                    # Link to last tool_call_start
                    if tool_calls_emitted:
                        last_tc = tool_calls_emitted[-1]
                        proposal["tool_call_id"] = last_tc["id"]
                        last_tc["status"] = "pending_confirm"
                    patch_proposals.append(proposal)
                    # Store for confirm/reject
                    if session_id not in _pending_proposals:
                        _pending_proposals[session_id] = {}
                    _pending_proposals[session_id][proposal["id"]] = {
                        **proposal,
                        "workspace_path": ws.workspace_path,
                        "workspace_id": body.workspace_id,
                    }
                    yield _sse("patch_proposal", proposal)

                elif event_type == "done":
                    # Save assistant message
                    final_text = "".join(text_buffer)
                    tc_json = json.dumps(tool_calls_emitted, ensure_ascii=False) if tool_calls_emitted else None
                    chat_service.append_message(
                        workspace_path=ws.workspace_path,
                        session_id=session_id,
                        role="assistant",
                        content=final_text,
                        tool_calls_json=tc_json,
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

        except Exception as e:
            yield _sse("error", {"message": str(e)})
            yield _sse("done", {})

    return StreamingResponse(_event_generator(), media_type="text/event-stream")


# ─── Confirm / Reject PatchProposal ──────────────────────────────────────────

@router.post("/sessions/{session_id}/confirm/{proposal_id}", response_model=dict)
def confirm_proposal(session_id: str, proposal_id: str, db: Session = Depends(get_db)):
    """Apply a PatchProposal after user confirmation."""
    proposal = _pending_proposals.get(session_id, {}).get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found or already processed")

    workspace_path = proposal.get("workspace_path", "")
    workspace_id = proposal.get("workspace_id", "")

    from app.agents.tools import execute_patch_proposal, configure as configure_tools
    ws_ctx = get_workspace_context(db, workspace_id)
    configure_tools(ws_ctx, db)

    result = execute_patch_proposal(proposal, workspace_path, db)

    # Clean up
    _pending_proposals.get(session_id, {}).pop(proposal_id, None)

    if result.get("success"):
        # Save confirmation as system message
        ws = db.get(WorkspaceORM, workspace_id)
        if ws:
            chat_service.append_message(
                workspace_path=ws.workspace_path,
                session_id=session_id,
                role="system",
                content=f"✓ 已应用变更：{proposal.get('change_summary', '')}",
            )

    return result


@router.post("/sessions/{session_id}/reject/{proposal_id}", response_model=dict)
def reject_proposal(session_id: str, proposal_id: str, db: Session = Depends(get_db)):
    """Reject a PatchProposal."""
    proposal = _pending_proposals.get(session_id, {}).get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found or already processed")

    # Clean up
    workspace_path = proposal.get("workspace_path", "")
    workspace_id = proposal.get("workspace_id", "")
    _pending_proposals.get(session_id, {}).pop(proposal_id, None)

    ws = db.get(WorkspaceORM, workspace_id)
    if ws:
        chat_service.append_message(
            workspace_path=ws.workspace_path,
            session_id=session_id,
            role="system",
            content=f"✗ 用户拒绝了变更：{proposal.get('change_summary', '')}",
        )

    return {"success": True, "message": "Proposal rejected"}


# ─── Legacy: create_skill inline (keep for backward compat) ──────────────────

class _CreateSkillBody(BaseModel):
    workspace_id: str
    user_intent: str


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    """Format an SSE event string."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
