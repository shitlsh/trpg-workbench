"""Revision history query and rollback."""
from sqlalchemy.orm import Session
from app.models.orm import AssetORM, AssetRevisionORM
from app.services.asset_service import update_asset


def list_revisions(db: Session, asset_id: str) -> list[AssetRevisionORM]:
    return (
        db.query(AssetRevisionORM)
        .filter(AssetRevisionORM.asset_id == asset_id)
        .order_by(AssetRevisionORM.version.desc())
        .all()
    )


def rollback_to_revision(db: Session, asset: AssetORM, revision_id: str, workspace_path: str) -> AssetORM:
    """
    Rollback = create a new revision with the content of `revision_id`.
    History is never deleted.
    """
    target = db.get(AssetRevisionORM, revision_id)
    if not target or target.asset_id != asset.id:
        raise ValueError(f"Revision {revision_id} not found for asset {asset.id}")

    return update_asset(
        db=db,
        asset=asset,
        workspace_path=workspace_path,
        content_md=target.content_md,
        content_json=target.content_json,
        change_summary=f"回滚到版本 {target.version}",
    )
