"""Asset CRUD + Revision API."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import AssetORM, WorkspaceORM
from app.models.schemas import (
    AssetSchema, AssetWithContentSchema, AssetRevisionSchema,
    AssetCreate, AssetUpdate,
)
from app.services.asset_service import (
    create_asset, update_asset, get_asset_with_content, md_to_json_sync,
)
from app.services.revision_service import list_revisions, rollback_to_revision

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


# ─── Create asset ─────────────────────────────────────────────────────────────

@router.post("", response_model=AssetWithContentSchema)
def create_asset_endpoint(workspace_id: str, body: AssetCreate, db: Session = Depends(get_db)):
    ws = _get_workspace(workspace_id, db)
    # Check slug uniqueness within workspace
    existing = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.type == body.type,
        AssetORM.slug == body.slug,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' already exists for type '{body.type}'")

    asset = create_asset(
        db=db,
        workspace_id=workspace_id,
        workspace_path=ws.workspace_path,
        asset_type=body.type,
        name=body.name,
        slug=body.slug,
        summary=body.summary,
    )
    return get_asset_with_content(db, asset)


# ─── Get single asset ─────────────────────────────────────────────────────────

@asset_router.get("/{asset_id}", response_model=AssetWithContentSchema)
def get_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    return get_asset_with_content(db, asset)


# ─── Update asset ─────────────────────────────────────────────────────────────

@asset_router.patch("/{asset_id}", response_model=AssetWithContentSchema)
def patch_asset(asset_id: str, body: AssetUpdate, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)

    # If MD was updated and JSON was not provided, attempt MD→JSON sync
    sync_warnings = []
    effective_json = body.content_json
    if body.content_md is not None and body.content_json is None:
        from app.models.orm import AssetRevisionORM
        latest = db.get(AssetRevisionORM, asset.latest_revision_id) if asset.latest_revision_id else None
        existing_json = latest.content_json if latest else "{}"
        effective_json, sync_warnings = md_to_json_sync(body.content_md, asset.type, existing_json)

    updated = update_asset(
        db=db,
        asset=asset,
        workspace_path=ws.workspace_path,
        content_md=body.content_md,
        content_json=effective_json,
        change_summary=body.change_summary,
        name=body.name,
        status=body.status,
        summary=body.summary,
    )
    result = get_asset_with_content(db, updated)
    if sync_warnings:
        result["sync_warnings"] = sync_warnings
    return result


# ─── Delete asset (soft) ─────────────────────────────────────────────────────

@asset_router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    asset.status = "deleted"
    db.commit()


# ─── List revisions ──────────────────────────────────────────────────────────

@asset_router.get("/{asset_id}/revisions", response_model=list[AssetRevisionSchema])
def get_revisions(asset_id: str, db: Session = Depends(get_db)):
    _get_asset(asset_id, db)
    return list_revisions(db, asset_id)


# ─── Rollback ────────────────────────────────────────────────────────────────

@asset_router.post("/{asset_id}/revisions/{revision_id}/rollback", response_model=AssetWithContentSchema)
def rollback(asset_id: str, revision_id: str, db: Session = Depends(get_db)):
    asset = _get_asset(asset_id, db)
    ws = db.get(WorkspaceORM, asset.workspace_id)
    try:
        updated = rollback_to_revision(db, asset, revision_id, ws.workspace_path)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return get_asset_with_content(db, updated)
