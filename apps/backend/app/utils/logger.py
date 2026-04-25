"""Execution logger – records model calls, RAG retrievals, and asset writes to workspace log files."""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal


LogEntryType = Literal["model_call", "retrieval", "asset_write"]


def _log_file(workspace_path: str) -> Path:
    """Returns today's log file path inside the workspace logs/ directory."""
    logs_dir = Path(workspace_path) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return logs_dir / f"{date_str}.jsonl"


def _append(workspace_path: str, entry: dict) -> None:
    """Append a JSON log entry to today's log file."""
    try:
        log_file = _log_file(workspace_path)
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        # Logging must never crash the main flow
        logging.getLogger(__name__).warning("Failed to write log entry", exc_info=True)


def log_model_call(
    workspace_path: str,
    provider: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    duration_ms: int = 0,
    agent: str = "",
    summary: str = "",
) -> None:
    """Log a model API call."""
    _append(workspace_path, {
        "type": "model_call",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "model": model,
        "agent": agent,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "duration_ms": duration_ms,
        "summary": summary,
    })


def log_retrieval(
    workspace_path: str,
    query: str,
    library_id: str,
    library_name: str = "",
    result_count: int = 0,
    top_result_summary: str = "",
) -> None:
    """Log a knowledge retrieval event."""
    _append(workspace_path, {
        "type": "retrieval",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "query": query[:200],
        "library_id": library_id,
        "library_name": library_name,
        "result_count": result_count,
        "top_result_summary": top_result_summary[:200],
    })


def log_asset_write(
    workspace_path: str,
    asset_id: str,
    asset_name: str,
    asset_type: str,
    revision_version: int,
    source_type: str,
    action: str = "create",
    change_summary: str = "",
) -> None:
    """Log an asset write. action is one of: create, update, delete."""
    _append(workspace_path, {
        "type": "asset_write",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "asset_id": asset_id,
        "asset_name": asset_name,
        "asset_type": asset_type,
        "revision_version": revision_version,
        "source_type": source_type,
        "change_summary": change_summary[:300],
    })


def read_log_entries(workspace_path: str, date_str: str | None = None, entry_type: str | None = None) -> list[dict]:
    """Read log entries for a given date (defaults to today). Optionally filter by type."""
    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    log_file = Path(workspace_path) / "logs" / f"{date_str}.jsonl"
    if not log_file.exists():
        return []

    entries = []
    try:
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry_type is None or entry.get("type") == entry_type:
                        entries.append(entry)
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    return entries
