"""Workspace management API — file-first.

WorkspaceORM in global app.db is just a registry pointer (id, name, path).
Actual config lives in .trpg/config.yaml per workspace.
"""
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import WorkspaceORM, _uuid
from app.models.schemas import WorkspaceSchema, WorkspaceCreate, WorkspaceOpen, WorkspaceUpdate
from app.utils.paths import get_workspaces_root, slugify
from app.services.workspace_service import (
    init_workspace, read_config, update_config, is_valid_workspace,
)
from app.services.sync_service import incremental_sync, rebuild_cache

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _get_ws(workspace_id: str, db: Session) -> WorkspaceORM:
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


# ─── List / Get ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkspaceSchema])
def list_workspaces(db: Session = Depends(get_db)):
    rows = db.query(WorkspaceORM).order_by(WorkspaceORM.last_opened_at.desc()).all()
    # Mark missing workspaces
    for row in rows:
        if not Path(row.workspace_path).exists():
            row.status = "missing"
    return rows


@router.get("/{workspace_id}", response_model=WorkspaceSchema)
def get_workspace(workspace_id: str, db: Session = Depends(get_db)):
    ws = _get_ws(workspace_id, db)
    if not Path(ws.workspace_path).exists():
        ws.status = "missing"
    return ws


# ─── Create workspace ────────────────────────────────────────────────────────

@router.post("", response_model=WorkspaceSchema, status_code=201)
def create_workspace(body: WorkspaceCreate, db: Session = Depends(get_db)):
    """Create a new workspace.

    If workspace_path is provided, use it; otherwise auto-create under workspaces root.
    """
    if body.workspace_path:
        ws_path = Path(body.workspace_path)
    else:
        slug = slugify(body.name)
        ws_path = get_workspaces_root() / slug
        # Avoid collisions
        if ws_path.exists():
            counter = 2
            while (get_workspaces_root() / f"{slug}-{counter}").exists():
                counter += 1
            ws_path = get_workspaces_root() / f"{slug}-{counter}"

    # Initialize filesystem structure + config.yaml
    init_workspace(
        workspace_path=str(ws_path),
        name=body.name,
        description=body.description or "",
        rule_set=body.rule_set or "",
    )

    # Register in global app.db
    ws = WorkspaceORM(
        id=_uuid(),
        name=body.name,
        workspace_path=str(ws_path),
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


# ─── Open existing workspace ─────────────────────────────────────────────────

@router.post("/open", response_model=WorkspaceSchema)
def open_workspace(body: WorkspaceOpen, db: Session = Depends(get_db)):
    """Open an existing workspace directory (register or re-register in app.db)."""
    ws_path = Path(body.workspace_path)
    if not ws_path.exists():
        raise HTTPException(status_code=404, detail="Directory does not exist")
    if not is_valid_workspace(ws_path):
        raise HTTPException(status_code=400, detail="Not a valid workspace (missing .trpg/config.yaml)")

    # Check if already registered
    existing = db.query(WorkspaceORM).filter(
        WorkspaceORM.workspace_path == str(ws_path)
    ).first()
    if existing:
        existing.last_opened_at = datetime.now(timezone.utc)
        existing.status = "ok"
        db.commit()
        db.refresh(existing)
        return existing

    # Read name from config.yaml
    config = read_config(ws_path)
    ws = WorkspaceORM(
        id=_uuid(),
        name=config.get("name", ws_path.name),
        workspace_path=str(ws_path),
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


# ─── Update workspace ────────────────────────────────────────────────────────

@router.patch("/{workspace_id}", response_model=WorkspaceSchema)
def update_workspace(workspace_id: str, body: WorkspaceUpdate, db: Session = Depends(get_db)):
    ws = _get_ws(workspace_id, db)
    if body.name is not None:
        ws.name = body.name
        # Also update config.yaml
        update_config(ws.workspace_path, {"name": body.name})
    db.commit()
    db.refresh(ws)
    return ws


# ─── Delete workspace (unregister) ──────────────────────────────────────────

@router.delete("/{workspace_id}", status_code=204)
def delete_workspace(workspace_id: str, db: Session = Depends(get_db)):
    """Unregister workspace from app.db. Does NOT delete files on disk."""
    ws = _get_ws(workspace_id, db)
    db.delete(ws)
    db.commit()


# ─── Config ──────────────────────────────────────────────────────────────────

class WorkspaceConfigResponse(BaseModel):
    config: dict


@router.get("/{workspace_id}/config", response_model=WorkspaceConfigResponse)
def get_config(workspace_id: str, db: Session = Depends(get_db)):
    ws = _get_ws(workspace_id, db)
    return {"config": read_config(ws.workspace_path)}


class ConfigUpdateRequest(BaseModel):
    updates: dict


@router.patch("/{workspace_id}/config", response_model=WorkspaceConfigResponse)
def patch_config(workspace_id: str, body: ConfigUpdateRequest, db: Session = Depends(get_db)):
    ws = _get_ws(workspace_id, db)
    merged = update_config(ws.workspace_path, body.updates)

    # Sync model routing fields to WorkspaceORM so model_routing.py can read them fast.
    models_update = body.updates.get("models", {})
    if models_update:
        from app.models.orm import LLMProfileORM, RerankProfileORM

        # LLM profile: resolve by name → ID
        if "default_llm" in models_update:
            profile_name = models_update["default_llm"]
            if profile_name:
                profile = db.query(LLMProfileORM).filter(LLMProfileORM.name == profile_name).first()
                ws.default_llm_profile_id = profile.id if profile else None
            else:
                ws.default_llm_profile_id = None

        # LLM model name (stored separately from the profile)
        if "default_llm_model" in models_update:
            ws.default_llm_model_name = models_update["default_llm_model"] or None

        # Rerank profile: resolve by name → ID
        if "rerank" in models_update:
            rerank_name = models_update["rerank"]
            if rerank_name:
                rp = db.query(RerankProfileORM).filter(RerankProfileORM.name == rerank_name).first()
                ws.rerank_profile_id = rp.id if rp else None
            else:
                ws.rerank_profile_id = None

    rerank_update = body.updates.get("rerank", {})
    if rerank_update:
        if "enabled" in rerank_update:
            ws.rerank_enabled = bool(rerank_update["enabled"])

    db.commit()
    return {"config": merged}


# ─── Sync ────────────────────────────────────────────────────────────────────

@router.post("/{workspace_id}/sync")
def sync_workspace(workspace_id: str, db: Session = Depends(get_db)):
    """Incremental file→DB sync."""
    ws = _get_ws(workspace_id, db)
    ws.last_opened_at = datetime.now(timezone.utc)
    summary = incremental_sync(ws.workspace_path, workspace_id, db)
    return summary


@router.post("/{workspace_id}/rebuild")
def rebuild_workspace_cache(workspace_id: str, db: Session = Depends(get_db)):
    """Full cache rebuild from filesystem."""
    ws = _get_ws(workspace_id, db)
    ws.last_opened_at = datetime.now(timezone.utc)
    summary = rebuild_cache(ws.workspace_path, workspace_id, db)
    return summary
