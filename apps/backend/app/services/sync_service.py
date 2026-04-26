"""File → DB index synchronisation service.

The filesystem is the source of truth.  This module scans workspace files
and upserts/deletes rows in the DB so the index stays consistent.

Two modes:
  - incremental_sync:  compare file_hash, only touch changed rows
  - rebuild_cache:     delete all index rows for the workspace, rescan everything
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.orm import AssetORM, AssetRevisionORM, ChatSessionORM, _uuid
from app.services.asset_service import scan_asset_files, list_revision_snapshots
from app.services.chat_service import list_sessions as list_chat_sessions

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


# ─── Asset sync ──────────────────────────────────────────────────────────────


def _sync_assets(
    workspace_path: str | Path,
    workspace_id: str,
    db: Session,
) -> tuple[int, int, int]:
    """Scan .md files and sync AssetORM index.

    Returns (created, updated, deleted) counts.
    """
    ws = Path(workspace_path)
    valid_assets, _diagnostics = scan_asset_files(ws)

    # Build a map of rel_path → scanned asset
    scanned_map: dict[str, dict] = {}
    for asset in valid_assets:
        rel = asset["rel_path"]
        scanned_map[rel] = asset

    # Existing DB rows for this workspace
    existing_rows = db.query(AssetORM).filter(AssetORM.workspace_id == workspace_id).all()
    existing_map: dict[str, AssetORM] = {row.file_path: row for row in existing_rows}

    created = 0
    updated = 0
    deleted = 0

    # Upsert: files on disk
    for rel_path, asset in scanned_map.items():
        meta = asset["metadata"]
        if rel_path in existing_map:
            row = existing_map[rel_path]
            # Only update if content changed
            if row.file_hash != asset["file_hash"]:
                row.type = meta.get("type", row.type)
                row.name = meta.get("name", row.name)
                row.slug = meta.get("slug", row.slug)
                row.status = meta.get("status", "draft")
                row.summary = meta.get("summary")
                row.file_hash = asset["file_hash"]
                row.version = meta.get("version", 1)
                row.updated_at = _now()
                updated += 1
        else:
            row = AssetORM(
                id=_uuid(),
                workspace_id=workspace_id,
                type=meta.get("type", ""),
                name=meta.get("name", ""),
                slug=meta.get("slug", ""),
                status=meta.get("status", "draft"),
                summary=meta.get("summary"),
                file_path=rel_path,
                file_hash=asset["file_hash"],
                version=meta.get("version", 1),
            )
            db.add(row)
            created += 1

    # Delete: rows whose files no longer exist on disk
    for rel_path, row in existing_map.items():
        if rel_path not in scanned_map:
            db.delete(row)
            deleted += 1

    return created, updated, deleted


# ─── Revision sync ───────────────────────────────────────────────────────────


def _sync_revisions(
    workspace_path: str | Path,
    workspace_id: str,
    db: Session,
) -> int:
    """Scan .trpg/revisions/ and sync AssetRevisionORM index.

    Returns count of new revision rows created.
    """
    # Get all assets for this workspace to map slug → asset_id
    assets = db.query(AssetORM).filter(AssetORM.workspace_id == workspace_id).all()
    slug_to_id: dict[str, str] = {a.slug: a.id for a in assets}

    created = 0
    for slug, asset_id in slug_to_id.items():
        snapshots = list_revision_snapshots(workspace_path, slug)
        # Existing revisions in DB
        existing_versions = {
            r.version
            for r in db.query(AssetRevisionORM)
            .filter(AssetRevisionORM.asset_id == asset_id)
            .all()
        }

        for snap in snapshots:
            if snap["version"] not in existing_versions:
                rev = AssetRevisionORM(
                    id=_uuid(),
                    asset_id=asset_id,
                    version=snap["version"],
                    snapshot_path=snap["snapshot_path"],
                    change_summary=snap.get("change_summary", ""),
                    source_type=snap.get("source_type", "user"),
                )
                db.add(rev)
                created += 1

    return created


# ─── Chat session sync ───────────────────────────────────────────────────────


def _sync_chat_sessions(
    workspace_path: str | Path,
    workspace_id: str,
    db: Session,
) -> int:
    """Scan .trpg/chat/*.jsonl and sync ChatSessionORM index.

    Returns count of new/updated session rows.
    """
    sessions = list_chat_sessions(workspace_path)

    existing = {
        row.id: row
        for row in db.query(ChatSessionORM)
        .filter(ChatSessionORM.workspace_id == workspace_id)
        .all()
    }

    changed = 0
    seen_ids: set[str] = set()

    for meta in sessions:
        sid = meta["id"]
        seen_ids.add(sid)

        if sid in existing:
            row = existing[sid]
            if row.message_count != meta["message_count"]:
                row.title = meta.get("title")
                row.message_count = meta["message_count"]
                row.updated_at = _now()
                changed += 1
        else:
            # Check if session exists under a different workspace_id (e.g. after
            # workspace re-registration) and reuse the row rather than inserting a
            # duplicate PK.
            stale = db.query(ChatSessionORM).filter(ChatSessionORM.id == sid).first()
            if stale:
                stale.workspace_id = workspace_id
                stale.title = meta.get("title")
                stale.message_count = meta["message_count"]
                stale.updated_at = _now()
            else:
                row = ChatSessionORM(
                    id=sid,
                    workspace_id=workspace_id,
                    title=meta.get("title"),
                    message_count=meta["message_count"],
                )
                db.add(row)
            changed += 1

    # Delete sessions whose JSONL files no longer exist
    for sid, row in existing.items():
        if sid not in seen_ids:
            db.delete(row)
            changed += 1

    return changed


# ─── Public API ──────────────────────────────────────────────────────────────


def incremental_sync(
    workspace_path: str | Path,
    workspace_id: str,
    db: Session,
) -> dict:
    """Incremental sync: compare hashes, only touch changed rows.

    Returns a summary dict with counts.
    """
    a_created, a_updated, a_deleted = _sync_assets(workspace_path, workspace_id, db)
    r_created = _sync_revisions(workspace_path, workspace_id, db)
    c_changed = _sync_chat_sessions(workspace_path, workspace_id, db)

    db.commit()

    summary = {
        "assets_created": a_created,
        "assets_updated": a_updated,
        "assets_deleted": a_deleted,
        "revisions_synced": r_created,
        "chat_sessions_synced": c_changed,
    }
    logger.info("Incremental sync complete: %s", summary)
    return summary


def rebuild_cache(
    workspace_path: str | Path,
    workspace_id: str,
    db: Session,
) -> dict:
    """Full rebuild: delete all index rows for this workspace, then rescan.

    Use when cache.db is missing/corrupted or user requests a full rescan.
    """
    # Delete all existing rows
    db.query(AssetRevisionORM).filter(
        AssetRevisionORM.asset_id.in_(
            db.query(AssetORM.id).filter(AssetORM.workspace_id == workspace_id)
        )
    ).delete(synchronize_session="fetch")
    db.query(AssetORM).filter(AssetORM.workspace_id == workspace_id).delete()
    db.query(ChatSessionORM).filter(ChatSessionORM.workspace_id == workspace_id).delete()
    db.flush()

    # Rescan
    a_created, _, _ = _sync_assets(workspace_path, workspace_id, db)
    r_created = _sync_revisions(workspace_path, workspace_id, db)
    c_changed = _sync_chat_sessions(workspace_path, workspace_id, db)

    db.commit()

    summary = {
        "assets_indexed": a_created,
        "revisions_indexed": r_created,
        "chat_sessions_indexed": c_changed,
    }
    logger.info("Full cache rebuild complete: %s", summary)
    return summary
