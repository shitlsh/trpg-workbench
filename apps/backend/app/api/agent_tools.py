"""Apply patch to an asset + consistency check + workspace export endpoints."""
import io
import json
import zipfile
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.storage.database import get_db
from app.models.orm import AssetORM, WorkspaceORM, AssetRevisionORM
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


@router.get("/workspaces/{workspace_id}/export")
def export_workspace(
    workspace_id: str,
    include_review: bool = False,
    db: Session = Depends(get_db),
):
    """
    Export all 'final' (optionally 'review') status assets as Markdown files in a zip archive.
    Returns: application/zip stream
    """
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    statuses = ["final"]
    if include_review:
        statuses.append("review")

    assets = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.status.in_(statuses),
    ).all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for asset in assets:
            rev = db.get(AssetRevisionORM, asset.latest_revision_id) if asset.latest_revision_id else None
            content_md = rev.content_md if rev else ""
            dir_name = asset.type + "s"  # e.g. npcs, stages
            filename = f"{dir_name}/{asset.type}-{asset.slug}.md"
            zf.writestr(filename, content_md or f"# {asset.name}\n\n（内容为空）\n")

        # Add a simple index
        index_lines = [f"# {ws.name} 导出文档\n\n"]
        by_type: dict[str, list[AssetORM]] = {}
        for a in assets:
            by_type.setdefault(a.type, []).append(a)
        for atype, items in sorted(by_type.items()):
            index_lines.append(f"## {atype}\n")
            for a in items:
                index_lines.append(f"- [{a.name}]({atype}s/{atype}-{a.slug}.md)\n")
            index_lines.append("\n")
        zf.writestr("index.md", "".join(index_lines))

    buf.seek(0)
    safe_name = ws.name.replace(" ", "_").replace("/", "_")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_export.zip"'},
    )
