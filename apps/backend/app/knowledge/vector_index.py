"""Vector index management using lancedb."""
from __future__ import annotations
import json
import shutil
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
    pa.field("chunk_type", pa.string()),  # ChunkType value, empty string = unknown
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
        pa.field("chunk_type", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), dimensions)),
    ])
    if "chunks" not in db.table_names():
        return db.create_table("chunks", schema=schema)
    return db.open_table("chunks")


def _ensure_chunk_type_column(table) -> None:
    """Best-effort: add chunk_type column to tables created before M24."""
    try:
        field_names = [f.name for f in table.schema]
        if "chunk_type" not in field_names:
            import pyarrow as _pa
            table.add_columns([_pa.field("chunk_type", _pa.string())])
    except Exception:
        pass  # schema evolution not supported by this lancedb version — degrade gracefully


def upsert_chunks(
    index_dir: Path,
    records: list[dict],
    dimensions: int = 1536,
) -> None:
    """Insert chunk vectors into the index."""
    if not records:
        return
    incoming_dim = len(records[0].get("vector") or [])
    if incoming_dim <= 0:
        raise ValueError("Empty embedding vector is not allowed")

    # If an existing table uses a different vector dimension, rebuild the index.
    # A library's index must be homogeneous; mixed dimensions are not searchable.
    if index_dir.exists() and (index_dir / "chunks.lance").exists():
        try:
            db = lancedb.connect(str(index_dir))
            if "chunks" in db.table_names():
                table = db.open_table("chunks")
                existing_dim: int | None = None
                for field in table.schema:
                    if field.name == "vector":
                        existing_dim = field.type.list_size
                        break
                if existing_dim and existing_dim != incoming_dim:
                    shutil.rmtree(index_dir / "chunks.lance", ignore_errors=True)
        except Exception:
            # If we cannot inspect old index metadata, continue with normal path.
            pass

    dimensions = incoming_dim
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
            "chunk_type": r.get("chunk_type") or "",
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
        _ensure_chunk_type_column(table)
        actual_dim = dimensions
        try:
            for field in table.schema:
                if field.name == "vector":
                    # pa.list_<float>(N) has list_size attribute
                    actual_dim = field.type.list_size
                    break
        except Exception:
            actual_dim = len(query_vector)
        # Pad or truncate query vector to match stored dimension
        if len(query_vector) < actual_dim:
            query_vector = query_vector + [0.0] * (actual_dim - len(query_vector))
        elif len(query_vector) > actual_dim:
            query_vector = query_vector[:actual_dim]
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
            _ensure_chunk_type_column(table)
            table.delete(f"document_id = '{document_id}'")
    except Exception:
        pass
