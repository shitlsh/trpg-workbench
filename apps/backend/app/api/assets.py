"""Asset CRUD + Revision API — file-first.

Asset content lives in frontmatter Markdown files on disk.
AssetORM in cache.db is a search/filter index only.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import AssetORM, WorkspaceORM, _uuid
from app.models.schemas import (
    AssetSchema, AssetWithContentSchema, AssetRevisionSchema,
    AssetCreate, AssetUpdate,
)
from app.services import asset_service
from app.services.revision_service import list_revisions, rollback_to_revision
from app.services.sync_service import incremental_sync

router = APIRouter(prefix="/workspaces/{workspace_id}/assets", tags=["assets"])
asset_router = APIRouter(prefix="/assets", tags=["assets"])


def _get_workspace(workspace_id: str, db: Session) -> WorkspaceORM:
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


def _get_asset(asset_id: str, db: Session) -> AssetORM:
    asset = db.get(AssetORM, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _resolve_file_path(ws: WorkspaceORM, asset: AssetORM) -> Path:
    """Resolve absolute file path from workspace root + relative file_path."""
    return Path(ws.workspace_path) / asset.file_path


# ─── List assets ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[AssetSchema])
def list_assets(workspace_id: str, asset_type: str | None = None, db: Session = Depends(get_db)):
    _get_workspace(workspace_id, db)
    q = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.status != "deleted",
    )
    if asset_type:
        q = q.filter(AssetORM.type == asset_type)
    return q.order_by(AssetORM.type, AssetORM.name).all()


# ─── Create asset ────────────────────────────────────────────────────────────

@router.post("", response_model=AssetWithContentSchema)
def create_asset_endpoint(workspace_id: str, body: AssetCreate, db: Session = Depends(get_db)):
    ws = _get_workspace(workspace_id, db)

    # Check slug uniqueness via DB index
    existing = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.type == body.type,
        AssetORM.slug == body.slug,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' already exists for type '{body.type}'")

    # Write file to disk
    result = asset_service.create_asset(
        workspace_path=ws.workspace_path,
        asset_type=body.type,
        name=body.name,
        slug=body.slug,
        summary=body.summary,
    )

    # Create DB index row
    asset_row = AssetORM(
        id=_uuid(),
        workspace_id=workspace_id,
        type=body.type,
        name=body.name,
        slug=body.slug,
        status="draft",
        summary=body.summary,
        file_path=result["rel_path"],
        file_hash=result["file_hash"],
        version=1,
    )
    db.add(asset_row)
    db.commit()
    db.refresh(asset_row)

    # Return with content
    return _build_asset_with_content(ws, asset_row)


# ─── Get single asset (with content from disk) ───────────────────────────────

@asset_router.get("/{asset_id}", response_model=AssetWithContentSchema)
def get_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return _build_asset_with_content(ws, asset)


def _build_asset_with_content(ws: WorkspaceORM, asset: AssetORM) -> dict:
    """Read content from disk and merge with DB index data."""
    file_path = _resolve_file_path(ws, asset)
    content = asset_service.get_asset_with_content(ws.workspace_path, file_path)
    if not content:
        # File missing on disk — return index data with empty content
        return {
            "id": asset.id,
            "workspace_id": asset.workspace_id,
            "type": asset.type,
            "name": asset.name,
            "slug": asset.slug,
            "status": asset.status,
            "summary": asset.summary,
            "file_path": asset.file_path,
            "file_hash": asset.file_hash,
            "version": asset.version,
            "metadata_json": asset.metadata_json,
            "created_at": asset.created_at,
            "updated_at": asset.updated_at,
            "content_md": "",
            "content_json": "{}",
        }

    return {
        "id": asset.id,
        "workspace_id": asset.workspace_id,
        "type": asset.type,
        "name": content.get("name", asset.name),
        "slug": content.get("slug", asset.slug),
        "status": content.get("status", asset.status),
        "summary": content.get("summary", asset.summary),
        "file_path": asset.file_path,
        "file_hash": content.get("file_hash", asset.file_hash),
        "version": content.get("version", asset.version),
        "metadata_json": asset.metadata_json,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
        "content_md": content.get("content_md", ""),
        "content_json": content.get("content_json", "{}"),
    }


# ─── Update asset ────────────────────────────────────────────────────────────

@asset_router.patch("/{asset_id}", response_model=AssetWithContentSchema)
def patch_asset(asset_id: str, body: AssetUpdate, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_path = _resolve_file_path(ws, asset)

    # Build meta updates from request
    meta_updates: dict = {}
    if body.name is not None:
        meta_updates["name"] = body.name
    if body.status is not None:
        meta_updates["status"] = body.status
    if body.summary is not None:
        meta_updates["summary"] = body.summary

    # Write to disk (file-first)
    result = asset_service.update_asset(
        workspace_path=ws.workspace_path,
        file_path=file_path,
        body=body.content_md,
        meta_updates=meta_updates if meta_updates else None,
        change_summary=body.change_summary,
    )

    # Update DB index
    asset.name = result["metadata"].get("name", asset.name)
    asset.status = result["metadata"].get("status", asset.status)
    asset.summary = result["metadata"].get("summary", asset.summary)
    asset.file_hash = result["file_hash"]
    asset.version = result["metadata"].get("version", asset.version)
    db.commit()
    db.refresh(asset)

    return _build_asset_with_content(ws, asset)


# ─── Delete asset (hard delete — remove file + mark status) ──────────────────

@asset_router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)
    if ws and asset.file_path:
        file_path = Path(ws.workspace_path) / asset.file_path
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass  # best-effort — don't block deletion if file is already gone
    asset.status = "deleted"
    db.commit()


# ─── List revisions ─────────────────────────────────────────────────────────

@asset_router.get("/{asset_id}/revisions")
def get_revisions(asset_id: str, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return list_revisions(ws.workspace_path, asset.slug)


# ─── Rollback ────────────────────────────────────────────────────────────────

@asset_router.post("/{asset_id}/revisions/{version}/rollback", response_model=AssetWithContentSchema)
def rollback(asset_id: str, version: int, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_path = _resolve_file_path(ws, asset)
    try:
        result = rollback_to_revision(ws.workspace_path, file_path, asset.slug, version)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Update DB index
    asset.file_hash = result["file_hash"]
    asset.version = result["metadata"].get("version", asset.version)
    db.commit()
    db.refresh(asset)

    return _build_asset_with_content(ws, asset)


# ─── Diagnostics (file scanning issues) ─────────────────────────────────────

@router.get("/diagnostics")
def get_diagnostics(workspace_id: str, db: Session = Depends(get_db)):
    """Return files with broken frontmatter or missing required fields."""
    ws = _get_workspace(workspace_id, db)
    _, diagnostics = asset_service.scan_asset_files(ws.workspace_path)
    return {"diagnostics": diagnostics}



