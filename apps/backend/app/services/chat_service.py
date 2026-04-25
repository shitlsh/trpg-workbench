"""File-first chat service — JSONL files are source of truth.

Each chat session is stored as .trpg/chat/{session-id}.jsonl
with one JSON object per line (one message per line).
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.utils.paths import chat_dir, chat_session_path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_id() -> str:
    return str(uuid.uuid4())


# ─── Message I/O ─────────────────────────────────────────────────────────────


def append_message(
    workspace_path: str | Path,
    session_id: str,
    role: str,
    content: str,
    references_json: str | None = None,
    tool_calls_json: str | None = None,
    message_id: str | None = None,
) -> dict:
    """Append a message to a session's JSONL file. Returns the message dict."""
    msg = {
        "id": message_id or _make_id(),
        "session_id": session_id,
        "role": role,
        "content": content,
        "references_json": references_json,
        "tool_calls_json": tool_calls_json,
        "created_at": _now_iso(),
    }
    filepath = chat_session_path(workspace_path, session_id)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")
    return msg


def read_messages(workspace_path: str | Path, session_id: str) -> list[dict]:
    """Read all messages from a session's JSONL file."""
    filepath = chat_session_path(workspace_path, session_id)
    if not filepath.exists():
        return []
    messages = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    messages.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return messages


# ─── Session metadata ────────────────────────────────────────────────────────

# Session metadata is derived from the JSONL file:
# - id: from filename
# - title: first user message content (truncated)
# - message_count: number of lines
# - created_at: first message timestamp
# - updated_at: last message timestamp


def get_session_metadata(workspace_path: str | Path, session_id: str) -> dict | None:
    """Derive session metadata from JSONL file content."""
    messages = read_messages(workspace_path, session_id)
    if not messages:
        return None

    first_user_msg = next((m for m in messages if m["role"] == "user"), None)
    title = None
    if first_user_msg:
        title = first_user_msg["content"][:100]

    return {
        "id": session_id,
        "workspace_id": "",  # filled by caller
        "title": title,
        "message_count": len(messages),
        "created_at": messages[0].get("created_at", ""),
        "updated_at": messages[-1].get("created_at", ""),
    }


def list_sessions(workspace_path: str | Path) -> list[dict]:
    """List all chat sessions by scanning .trpg/chat/ directory."""
    cdir = chat_dir(workspace_path)
    if not cdir.exists():
        return []

    sessions = []
    for jsonl_file in sorted(cdir.glob("*.jsonl"), key=lambda f: f.stat().st_mtime, reverse=True):
        session_id = jsonl_file.stem
        meta = get_session_metadata(workspace_path, session_id)
        if meta:
            sessions.append(meta)
    return sessions


def read_recent_messages(workspace_path: str | Path, session_id: str, limit: int = 20) -> list[dict]:
    """Read the most recent messages for multi-turn context.

    Tool call results are replaced with brief summaries to conserve token budget.
    """
    all_msgs = read_messages(workspace_path, session_id)
    # Take last `limit` messages
    recent = all_msgs[-limit:] if len(all_msgs) > limit else all_msgs
    result = []
    for msg in recent:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role not in ("user", "assistant"):
            continue
        # Summarize tool_calls_json to reduce token usage
        tool_calls_raw = msg.get("tool_calls_json")
        if tool_calls_raw and role == "assistant":
            try:
                tc_list = json.loads(tool_calls_raw)
                if isinstance(tc_list, list) and tc_list:
                    summary_parts = [f"[调用工具: {tc.get('name', '?')}]" for tc in tc_list if isinstance(tc, dict)]
                    if summary_parts and not content.strip():
                        content = " ".join(summary_parts)
            except (json.JSONDecodeError, TypeError):
                pass
        result.append({"role": role, "content": content})
    return result


def trim_to_budget(messages: list[dict], max_rounds: int = 10, max_chars: int = 8000) -> list[dict]:
    """Trim message history to fit token budget.

    Keeps the most recent messages, always preserving the last user message.
    """
    if not messages:
        return []

    # Take at most max_rounds * 2 messages (each round = user + assistant)
    trimmed = messages[-(max_rounds * 2):]

    # Check char budget
    total = sum(len(m.get("content", "")) for m in trimmed)
    while total > max_chars and len(trimmed) > 1:
        trimmed = trimmed[1:]
        total = sum(len(m.get("content", "")) for m in trimmed)

    return trimmed


def create_session(
    workspace_path: str | Path,
    session_id: str | None = None,
    workspace_id: str = "",
    agent_scope: str | None = None,
    title: str | None = None,
) -> dict:
    """Create a new empty chat session (just the metadata structure).

    The JSONL file is created on first message append.
    """
    sid = session_id or _make_id()
    now = _now_iso()
    return {
        "id": sid,
        "workspace_id": workspace_id,
        "agent_scope": agent_scope,
        "title": title,
        "message_count": 0,
        "created_at": now,
        "updated_at": now,
    }
