"""Execution log API – read workspace log entries."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.storage.database import get_db
from app.models.orm import WorkspaceORM
from app.utils.logger import read_log_entries

router = APIRouter(prefix="/workspaces/{workspace_id}/logs", tags=["logs"])


@router.get("")
def get_logs(
    workspace_id: str,
    date: Optional[str] = None,
    entry_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return log entries for the workspace. date format: YYYY-MM-DD."""
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    entries = read_log_entries(ws.workspace_path, date_str=date, entry_type=entry_type)
    return {"entries": entries, "count": len(entries)}
