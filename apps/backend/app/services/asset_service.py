"""File-first asset CRUD — frontmatter Markdown is source of truth.

Write path:  Agent/user edit → write .md file → update cache.db index
Read path:   read .md file from disk → parse frontmatter
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import frontmatter

from app.utils.paths import (
    asset_type_dir, asset_file_path, asset_revision_dir,
)


# ─── Frontmatter helpers ────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file_hash(path: Path) -> str:
    """SHA-256 hex digest of a file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_frontmatter(
    asset_type: str,
    name: str,
    slug: str,
    status: str = "draft",
    version: int = 1,
    created_at: str | None = None,
    updated_at: str | None = None,
    extra: dict | None = None,
) -> dict:
    """Build the YAML frontmatter dict for an asset file."""
    meta: dict[str, Any] = {
        "type": asset_type,
        "name": name,
        "slug": slug,
        "status": status,
        "version": version,
        "created_at": created_at or _now_iso(),
        "updated_at": updated_at or _now_iso(),
    }
    if extra:
        meta.update(extra)
    return meta


# ─── Templates ───────────────────────────────────────────────────────────────


NPC_MD_TEMPLATE = """# {name}

## 外貌描述


## 背景故事


## 动机


## 与玩家的关系


## 备注

"""

GENERIC_MD_TEMPLATE = """# {name}

## 描述


## 备注

"""


def _get_template_body(asset_type: str, name: str) -> str:
    """Return the Markdown body (below frontmatter) for a new asset."""
    if asset_type == "npc":
        return NPC_MD_TEMPLATE.format(name=name)
    return GENERIC_MD_TEMPLATE.format(name=name)


# ─── File I/O ────────────────────────────────────────────────────────────────


def write_asset_file(
    workspace_path: str | Path,
    asset_type: str,
    slug: str,
    metadata: dict,
    body: str,
    target_path: Path | None = None,
) -> Path:
    """Write a frontmatter Markdown asset file.

    If target_path is given, write there; otherwise use the convention path.
    Returns the absolute path of the written file.
    """
    if target_path is None:
        target_path = asset_file_path(workspace_path, asset_type, slug)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    post = frontmatter.Post(body, **metadata)
    target_path.write_text(frontmatter.dumps(post), encoding="utf-8")
    return target_path


def read_asset_file(filepath: Path) -> dict | None:
    """Read and parse a frontmatter Markdown file.

    Returns dict with keys: metadata (dict), body (str), file_path (Path), file_hash (str).
    Returns None if the file cannot be parsed.
    """
    if not filepath.exists():
        return None
    try:
        post = frontmatter.load(str(filepath))
        meta = dict(post.metadata)
        if "type" not in meta:
            return None
        return {
            "metadata": meta,
            "body": post.content,
            "file_path": filepath,
            "file_hash": _file_hash(filepath),
        }
    except Exception:
        return None


def scan_asset_files(workspace_path: str | Path) -> tuple[list[dict], list[dict]]:
    """Recursively scan workspace for .md files with frontmatter.

    Returns (valid_assets, diagnostics).
    - valid_assets: list of parsed asset dicts
    - diagnostics: list of {file_path, error} for files with broken frontmatter
    """
    from app.utils.paths import is_reserved_dir

    root = Path(workspace_path)
    valid: list[dict] = []
    diagnostics: list[dict] = []

    for md_file in root.rglob("*.md"):
        # Skip reserved directories
        rel_parts = md_file.relative_to(root).parts
        if any(is_reserved_dir(p) for p in rel_parts):
            continue

        try:
            post = frontmatter.load(str(md_file))
            meta = dict(post.metadata)
        except Exception as e:
            # Has frontmatter-like content but failed to parse
            diagnostics.append({
                "file_path": str(md_file.relative_to(root)),
                "error": f"Frontmatter 解析失败: {e}",
            })
            continue

        # No frontmatter at all → silent skip (user notes)
        if not meta:
            continue

        # Has frontmatter but missing required fields
        if "type" not in meta:
            diagnostics.append({
                "file_path": str(md_file.relative_to(root)),
                "error": "缺少必填字段 'type'",
            })
            continue

        if "name" not in meta:
            diagnostics.append({
                "file_path": str(md_file.relative_to(root)),
                "error": "缺少必填字段 'name'",
            })
            continue

        valid.append({
            "metadata": meta,
            "body": post.content,
            "file_path": md_file,
            "rel_path": str(md_file.relative_to(root)),
            "file_hash": _file_hash(md_file),
        })

    return valid, diagnostics


# ─── Create / Update / Read (high-level) ─────────────────────────────────────


def create_asset(
    workspace_path: str | Path,
    asset_type: str,
    name: str,
    slug: str,
    summary: str | None = None,
    body: str | None = None,
    extra_meta: dict | None = None,
) -> dict:
    """Create a new asset file and return parsed asset dict.

    Returns: {metadata, body, file_path, rel_path, file_hash}
    """
    ws = Path(workspace_path)
    meta = build_frontmatter(asset_type, name, slug, extra=extra_meta)
    if summary:
        meta["summary"] = summary

    content = body if body is not None else _get_template_body(asset_type, name)
    filepath = write_asset_file(ws, asset_type, slug, meta, content)

    # Create initial revision snapshot
    _save_revision_snapshot(ws, slug, 1, meta, content)

    return {
        "metadata": meta,
        "body": content,
        "file_path": filepath,
        "rel_path": str(filepath.relative_to(ws)),
        "file_hash": _file_hash(filepath),
    }


def update_asset(
    workspace_path: str | Path,
    file_path: Path,
    body: str | None = None,
    meta_updates: dict | None = None,
    change_summary: str | None = None,
    source_type: str = "user",
) -> dict:
    """Update an existing asset file (re-write with updated frontmatter/body).

    Returns: {metadata, body, file_path, rel_path, file_hash, revision_version}
    """
    ws = Path(workspace_path)
    parsed = read_asset_file(file_path)
    if not parsed:
        raise FileNotFoundError(f"Asset file not found: {file_path}")

    meta = parsed["metadata"]
    new_body = body if body is not None else parsed["body"]

    if meta_updates:
        meta.update(meta_updates)

    # Bump version
    old_version = meta.get("version", 1)
    new_version = old_version + 1
    meta["version"] = new_version
    meta["updated_at"] = _now_iso()

    write_asset_file(ws, meta["type"], meta["slug"], meta, new_body, target_path=file_path)

    # Save revision snapshot
    _save_revision_snapshot(
        ws, meta["slug"], new_version, meta, new_body,
        change_summary=change_summary, source_type=source_type,
    )

    return {
        "metadata": meta,
        "body": new_body,
        "file_path": file_path,
        "rel_path": str(file_path.relative_to(ws)),
        "file_hash": _file_hash(file_path),
        "revision_version": new_version,
    }


def get_asset_with_content(workspace_path: str | Path, file_path: Path) -> dict | None:
    """Read asset from disk and return API-friendly dict."""
    ws = Path(workspace_path)
    parsed = read_asset_file(file_path)
    if not parsed:
        return None
    meta = parsed["metadata"]

    # Build a JSON representation from frontmatter for backward compat
    json_data = {k: v for k, v in meta.items()
                 if k not in ("type", "slug", "version", "created_at", "updated_at", "status")}

    return {
        "type": meta.get("type", ""),
        "name": meta.get("name", ""),
        "slug": meta.get("slug", ""),
        "status": meta.get("status", "draft"),
        "summary": meta.get("summary"),
        "version": meta.get("version", 1),
        "file_path": str(parsed["file_path"].relative_to(ws)),
        "file_hash": parsed["file_hash"],
        "content_md": parsed["body"],
        "content_json": json.dumps(json_data, ensure_ascii=False, indent=2),
        "metadata_json": meta.get("metadata_json"),
        "created_at": meta.get("created_at", ""),
        "updated_at": meta.get("updated_at", ""),
    }


# ─── Revision snapshots ─────────────────────────────────────────────────────


def _save_revision_snapshot(
    workspace_path: Path,
    slug: str,
    version: int,
    metadata: dict,
    body: str,
    change_summary: str | None = None,
    source_type: str = "user",
) -> Path:
    """Copy current asset content to .trpg/revisions/{slug}/v{N}.md"""
    rev_dir = asset_revision_dir(workspace_path, slug)
    rev_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = rev_dir / f"v{version}.md"

    # Add revision metadata to the snapshot
    rev_meta = {**metadata, "_change_summary": change_summary or "用户手动编辑", "_source_type": source_type}
    post = frontmatter.Post(body, **rev_meta)
    snapshot_path.write_text(frontmatter.dumps(post), encoding="utf-8")
    return snapshot_path


def list_revision_snapshots(workspace_path: str | Path, slug: str) -> list[dict]:
    """List all revision snapshots for an asset, newest first."""
    rev_dir = asset_revision_dir(workspace_path, slug)
    if not rev_dir.exists():
        return []
    snapshots = []
    for f in sorted(rev_dir.glob("v*.md"), reverse=True):
        try:
            version = int(f.stem[1:])  # "v3" → 3
            post = frontmatter.load(str(f))
            meta = dict(post.metadata)
            snapshots.append({
                "version": version,
                "snapshot_path": str(f.relative_to(Path(workspace_path) / ".trpg")),
                "change_summary": meta.pop("_change_summary", ""),
                "source_type": meta.pop("_source_type", "user"),
                "created_at": meta.get("updated_at", ""),
            })
        except Exception:
            continue
    return snapshots


def read_revision_snapshot(workspace_path: str | Path, slug: str, version: int) -> dict | None:
    """Read a specific revision snapshot."""
    snapshot_path = asset_revision_dir(workspace_path, slug) / f"v{version}.md"
    if not snapshot_path.exists():
        return None
    try:
        post = frontmatter.load(str(snapshot_path))
        meta = dict(post.metadata)
        meta.pop("_change_summary", None)
        meta.pop("_source_type", None)
        return {"metadata": meta, "body": post.content}
    except Exception:
        return None
