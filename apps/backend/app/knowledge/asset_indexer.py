"""Asset vector index for semantic search.

Stores asset embeddings in a per-workspace LanceDB table so that
search_assets can find semantically similar assets even when exact
keywords don't match.

Index location: .trpg/asset_index/ inside each workspace.
Table name: "assets"
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any


# ── Schema helpers ────────────────────────────────────────────────────────────

def _asset_index_dir(workspace_path: str | Path) -> Path:
    return Path(workspace_path) / ".trpg" / "asset_index"


def _get_or_create_table(index_dir: Path, dimensions: int = 1536):
    """Open or create the assets table in lancedb."""
    import lancedb
    import pyarrow as pa

    index_dir.mkdir(parents=True, exist_ok=True)
    db = lancedb.connect(str(index_dir))
    schema = pa.schema([
        pa.field("asset_id", pa.string()),
        pa.field("slug", pa.string()),
        pa.field("name", pa.string()),
        pa.field("asset_type", pa.string()),
        pa.field("content", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), dimensions)),
    ])
    if "assets" not in db.table_names():
        return db.create_table("assets", schema=schema)
    return db.open_table("assets")


# ── Indexing ──────────────────────────────────────────────────────────────────

def index_asset(
    workspace_path: str | Path,
    asset_id: str,
    slug: str,
    name: str,
    asset_type: str,
    content_md: str,
    embedder: Any,  # object with .embed_one(text: str) -> list[float]
) -> None:
    """Embed the asset content and upsert into the workspace asset index.

    Truncates content to ~2000 chars for embedding budget.
    Silently skips if embedder or lancedb is unavailable.
    """
    if embedder is None:
        return
    try:
        import lancedb
        import pyarrow as pa
    except ImportError:
        return

    try:
        # Build text to embed: name + truncated body
        body = _strip_frontmatter(content_md)
        text = f"{name}\n{asset_type}\n{body}"[:2000]
        vector = embedder.embed_one(text)
        dimensions = len(vector)

        index_dir = _asset_index_dir(workspace_path)
        table = _get_or_create_table(index_dir, dimensions)

        # Delete existing entry for this asset (upsert pattern)
        try:
            table.delete(f"asset_id = '{asset_id}'")
        except Exception:
            pass

        # Pad/truncate to declared dimensions
        declared = table.schema.field("vector").type.list_size
        if declared and len(vector) < declared:
            vector = vector + [0.0] * (declared - len(vector))
        elif declared and len(vector) > declared:
            vector = vector[:declared]

        table.add([{
            "asset_id": asset_id,
            "slug": slug,
            "name": name,
            "asset_type": asset_type,
            "content": body[:500],
            "vector": vector,
        }])
    except Exception:
        pass  # indexing failures must never break asset writes


def delete_asset_from_index(workspace_path: str | Path, asset_id: str) -> None:
    """Remove an asset from the vector index."""
    try:
        import lancedb
        index_dir = _asset_index_dir(workspace_path)
        if not index_dir.exists():
            return
        db = lancedb.connect(str(index_dir))
        if "assets" not in db.table_names():
            return
        table = db.open_table("assets")
        table.delete(f"asset_id = '{asset_id}'")
    except Exception:
        pass


# ── Search ────────────────────────────────────────────────────────────────────

def search_assets_semantic(
    workspace_path: str | Path,
    query: str,
    embedder: Any,
    top_k: int = 8,
) -> list[dict]:
    """Return top-k semantically similar assets as dicts with type/name/slug/summary.

    Returns [] if no index exists or embedder is None (caller falls back to keyword).
    """
    if embedder is None:
        return []
    try:
        import lancedb
    except ImportError:
        return []

    index_dir = _asset_index_dir(workspace_path)
    if not index_dir.exists() or not (index_dir / "assets.lance").exists():
        return []

    try:
        db = lancedb.connect(str(index_dir))
        if "assets" not in db.table_names():
            return []
        table = db.open_table("assets")
        query_vector = embedder.embed_one(query)

        declared = table.schema.field("vector").type.list_size
        if declared:
            if len(query_vector) < declared:
                query_vector = query_vector + [0.0] * (declared - len(query_vector))
            elif len(query_vector) > declared:
                query_vector = query_vector[:declared]

        hits = table.search(query_vector).limit(top_k).to_list()
        return [
            {
                "type": h.get("asset_type", ""),
                "name": h.get("name", ""),
                "slug": h.get("slug", ""),
                "summary": h.get("content", ""),
            }
            for h in hits
        ]
    except Exception:
        return []


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_frontmatter(md: str) -> str:
    """Remove YAML frontmatter from markdown text."""
    if md.startswith("---"):
        end = md.find("\n---", 3)
        if end != -1:
            return md[end + 4:].lstrip()
    return md
