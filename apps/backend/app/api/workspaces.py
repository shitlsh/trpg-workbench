import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import WorkspaceORM
from app.models.schemas import WorkspaceSchema, WorkspaceCreate, WorkspaceUpdate
from app.utils.paths import get_data_dir
from app.services.asset_service import ensure_workspace_dirs

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _workspace_path(workspace_id: str) -> str:
    path = get_data_dir() / "workspaces" / workspace_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


@router.get("", response_model=list[WorkspaceSchema])
def list_workspaces(db: Session = Depends(get_db)):
    return db.query(WorkspaceORM).order_by(WorkspaceORM.updated_at.desc()).all()


@router.post("", response_model=WorkspaceSchema, status_code=201)
def create_workspace(body: WorkspaceCreate, db: Session = Depends(get_db)):
    ws_id = str(uuid.uuid4())
    ws = WorkspaceORM(
        id=ws_id,
        workspace_path=_workspace_path(ws_id),
        **body.model_dump(),
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    ensure_workspace_dirs(ws.workspace_path)
    return ws


@router.get("/{workspace_id}", response_model=WorkspaceSchema)
def get_workspace(workspace_id: str, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


@router.patch("/{workspace_id}", response_model=WorkspaceSchema)
def update_workspace(workspace_id: str, body: WorkspaceUpdate, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(ws, field, value)
    db.commit()
    db.refresh(ws)
    return ws


@router.delete("/{workspace_id}", status_code=204)
def delete_workspace(workspace_id: str, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    workspace_path = ws.workspace_path
    db.delete(ws)
    db.commit()
    # Clean up filesystem directory after successful DB delete
    shutil.rmtree(workspace_path, ignore_errors=True)
