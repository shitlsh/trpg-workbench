"""File-first revision history — snapshots stored in .trpg/revisions/{slug}/v{N}.md"""
from pathlib import Path

from app.services.asset_service import (
    read_asset_file,
    read_revision_snapshot,
    list_revision_snapshots,
    update_asset,
)


def list_revisions(workspace_path: str | Path, slug: str) -> list[dict]:
    """List all revisions for an asset (from snapshot files)."""
    return list_revision_snapshots(workspace_path, slug)


def rollback_to_revision(
    workspace_path: str | Path,
    file_path: Path,
    slug: str,
    target_version: int,
) -> dict:
    """Rollback = create a new revision with the content of target_version.

    History is never deleted.
    """
    snapshot = read_revision_snapshot(workspace_path, slug, target_version)
    if not snapshot:
        raise ValueError(f"Revision v{target_version} not found for asset '{slug}'")

    return update_asset(
        workspace_path=workspace_path,
        file_path=file_path,
        body=snapshot["body"],
        meta_updates={k: v for k, v in snapshot["metadata"].items()
                      if k not in ("version", "updated_at", "created_at")},
        change_summary=f"回滚到版本 {target_version}",
    )
