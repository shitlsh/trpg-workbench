"""Apply patch to an asset + consistency check endpoints.

Export removed in M18 — workspace directory IS the deliverable.
"""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import AssetORM, WorkspaceORM
from app.models.schemas import ApplyPatchRequest, AssetWithContentSchema
from app.services import asset_service
from app.agents.consistency import run_consistency_agent

router = APIRouter(tags=["agent-tools"])


@router.post("/assets/{asset_id}/apply-patch", response_model=AssetWithContentSchema)
def apply_patch(asset_id: str, body: ApplyPatchRequest, db: Session = Depends(get_db)):
    asset = db.get(AssetORM, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    ws = db.get(WorkspaceORM, asset.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    file_path = Path(ws.workspace_path) / asset.file_path

    result = asset_service.update_asset(
        workspace_path=ws.workspace_path,
        file_path=file_path,
        body=body.content_md,
        change_summary=body.change_summary,
        source_type=body.source_type,
    )

    # Update DB index
    asset.file_hash = result["file_hash"]
    asset.version = result["metadata"].get("version", asset.version)
    db.commit()
    db.refresh(asset)

    # Return with content
    content = asset_service.get_asset_with_content(ws.workspace_path, file_path)
    return {
        "id": asset.id,
        "workspace_id": asset.workspace_id,
        "type": asset.type,
        "name": content.get("name", asset.name) if content else asset.name,
        "slug": asset.slug,
        "status": content.get("status", asset.status) if content else asset.status,
        "summary": asset.summary,
        "file_path": asset.file_path,
        "file_hash": asset.file_hash,
        "version": asset.version,
        "metadata_json": asset.metadata_json,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
        "content_md": content.get("content_md", "") if content else "",
    }


@router.get("/workspaces/{workspace_id}/consistency-check", response_model=dict)
def consistency_check(workspace_id: str, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    assets = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.status != "deleted",
    ).all()

    summaries = []
    for asset in assets:
        file_path = Path(ws.workspace_path) / asset.file_path
        content = asset_service.get_asset_with_content(ws.workspace_path, file_path)
        summaries.append({
            "type": asset.type,
            "name": asset.name,
            "slug": asset.slug,
            "content_md": content.get("content_md", "") if content else "",
        })

    if not summaries:
        return {"issues": [], "overall_status": "clean"}

    return run_consistency_agent(summaries)
