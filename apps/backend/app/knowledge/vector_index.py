"""Vector index management using lancedb."""
from __future__ import annotations
import json
from pathlib import Path
import lancedb
import pyarrow as pa


SCHEMA = pa.schema([
    pa.field("chunk_id", pa.string()),
    pa.field("document_id", pa.string()),
    pa.field("library_id", pa.string()),
    pa.field("content", pa.string()),
    pa.field("page_from", pa.int32()),
    pa.field("page_to", pa.int32()),
    pa.field("section_title", pa.string()),
    pa.field("vector", pa.list_(pa.float32())),  # dimension determined at index creation time
])


def get_table(index_dir: Path, dimensions: int = 1536) -> lancedb.table.Table:
    """Open or create a lancedb table for a library."""
    db = lancedb.connect(str(index_dir))
    schema = pa.schema([
        pa.field("chunk_id", pa.string()),
        pa.field("document_id", pa.string()),
        pa.field("library_id", pa.string()),
        pa.field("content", pa.string()),
        pa.field("page_from", pa.int32()),
        pa.field("page_to", pa.int32()),
        pa.field("section_title", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), dimensions)),
    ])
    if "chunks" not in db.table_names():
        return db.create_table("chunks", schema=schema)
    return db.open_table("chunks")


def upsert_chunks(
    index_dir: Path,
    records: list[dict],
    dimensions: int = 1536,
) -> None:
    """Insert chunk vectors into the index."""
    table = get_table(index_dir, dimensions)
    rows = []
    for r in records:
        vector = r["vector"]
        # Pad or truncate to match declared dimensions
        if len(vector) < dimensions:
            vector = vector + [0.0] * (dimensions - len(vector))
        elif len(vector) > dimensions:
            vector = vector[:dimensions]
        rows.append({
            "chunk_id": r["chunk_id"],
            "document_id": r["document_id"],
            "library_id": r["library_id"],
            "content": r["content"],
            "page_from": int(r["page_from"]),
            "page_to": int(r["page_to"]),
            "section_title": r.get("section_title") or "",
            "vector": vector,
        })
    if rows:
        table.add(rows)


def search_library(
    index_dir: Path,
    query_vector: list[float],
    top_k: int = 5,
    dimensions: int = 1536,
) -> list[dict]:
    """Search a single library index, return top-k results."""
    if not index_dir.exists() or not (index_dir / "chunks.lance").exists():
        return []
    try:
        db = lancedb.connect(str(index_dir))
        if "chunks" not in db.table_names():
            return []
        table = db.open_table("chunks")
        # Pad/truncate query vector
        if len(query_vector) < dimensions:
            query_vector = query_vector + [0.0] * (dimensions - len(query_vector))
        elif len(query_vector) > dimensions:
            query_vector = query_vector[:dimensions]
        results = table.search(query_vector).limit(top_k).to_list()
        return results
    except Exception:
        return []


def delete_document_chunks(index_dir: Path, document_id: str) -> None:
    """Remove all chunks for a document from the index."""
    try:
        db = lancedb.connect(str(index_dir))
        if "chunks" in db.table_names():
            table = db.open_table("chunks")
            table.delete(f"document_id = '{document_id}'")
    except Exception:
        pass
