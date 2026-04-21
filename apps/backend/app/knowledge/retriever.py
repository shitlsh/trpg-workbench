"""Retrieval logic: search across libraries by priority, return Citations."""
from __future__ import annotations
from pathlib import Path
from typing import Any
from app.knowledge.citations import Citation
from app.knowledge.vector_index import search_library
from app.utils.paths import get_data_dir


def _index_dir(library_id: str) -> Path:
    return get_data_dir() / "knowledge" / "libraries" / library_id / "index"


async def retrieve(
    query: str,
    library_ids: list[str],
    top_k: int = 5,
    embedder: Any = None,  # object with .embed_one(text) -> list[float]
    document_map: dict[str, dict] | None = None,  # document_id -> {filename, ...}
) -> list[Citation]:
    """
    Embed the query and search across the given libraries in order.
    Returns up to top_k deduplicated Citations, sorted by relevance.

    embedder must be provided; raises ValueError if None.
    """
    if not library_ids:
        return []

    if embedder is None:
        raise ValueError("embedder must be provided for retrieval")

    import asyncio
    query_vector = await asyncio.to_thread(embedder.embed_one, query)

    seen_chunk_ids: set[str] = set()
    all_results: list[dict] = []

    for lib_id in library_ids:
        idx_dir = _index_dir(lib_id)
        hits = search_library(idx_dir, query_vector, top_k=top_k)
        for hit in hits:
            cid = hit.get("chunk_id", "")
            if cid not in seen_chunk_ids:
                seen_chunk_ids.add(cid)
                hit["_library_id"] = lib_id
                all_results.append(hit)

    # Sort by distance (lower = more relevant); lancedb returns "_distance"
    all_results.sort(key=lambda x: x.get("_distance", 999))
    all_results = all_results[:top_k]

    citations: list[Citation] = []
    for hit in all_results:
        doc_id = hit.get("document_id", "")
        doc_info = (document_map or {}).get(doc_id, {})
        distance = hit.get("_distance", 1.0)
        # Convert distance to a [0,1] relevance score (cosine: score = 1 - distance/2)
        relevance = max(0.0, min(1.0, 1.0 - distance / 2.0))
        citations.append(Citation(
            chunk_id=hit.get("chunk_id", ""),
            content=hit.get("content", ""),
            document_id=doc_id,
            document_filename=doc_info.get("filename", ""),
            page_from=int(hit.get("page_from", -1)),
            page_to=int(hit.get("page_to", -1)),
            section_title=hit.get("section_title") or None,
            relevance_score=relevance,
        ))
    return citations
