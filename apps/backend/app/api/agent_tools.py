"""Apply patch to an asset + consistency check endpoint."""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import AssetORM, WorkspaceORM
from app.models.schemas import ApplyPatchRequest, AssetWithContentSchema
from app.services.asset_service import update_asset, get_asset_with_content
from app.agents.consistency import run_consistency_agent

router = APIRouter(tags=["agent-tools"])


@router.post("/assets/{asset_id}/apply-patch", response_model=AssetWithContentSchema)
def apply_patch(asset_id: str, body: ApplyPatchRequest, db: Session = Depends(get_db)):
    asset = db.get(AssetORM, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    ws = db.get(WorkspaceORM, asset.workspace_id)
    updated = update_asset(
        db=db,
        asset=asset,
        workspace_path=ws.workspace_path,
        content_md=body.content_md,
        content_json=body.content_json,
        change_summary=body.change_summary,
    )
    # Override source_type on the latest revision
    from app.models.orm import AssetRevisionORM
    rev = db.get(AssetRevisionORM, updated.latest_revision_id)
    if rev:
        rev.source_type = body.source_type
        db.commit()

    return get_asset_with_content(db, updated)


@router.get("/workspaces/{workspace_id}/consistency-check", response_model=dict)
def consistency_check(workspace_id: str, db: Session = Depends(get_db)):
    assets = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.status != "deleted",
    ).all()

    from app.models.orm import AssetRevisionORM
    summaries = []
    for asset in assets:
        rev = db.get(AssetRevisionORM, asset.latest_revision_id) if asset.latest_revision_id else None
        summaries.append({
            "type": asset.type,
            "name": asset.name,
            "slug": asset.slug,
            "content_json": rev.content_json if rev else "{}",
        })

    if not summaries:
        return {"issues": [], "overall_status": "clean"}

    return run_consistency_agent(summaries)
