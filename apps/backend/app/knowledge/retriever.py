"""Retrieval logic: search across libraries by priority, return Citations."""
from __future__ import annotations
import logging
from pathlib import Path
from typing import Any
from app.knowledge.citations import Citation
from app.knowledge.vector_index import search_library
from app.utils.paths import get_data_dir

logger = logging.getLogger(__name__)


def retrieve_knowledge(
    query: str,
    library_ids: list[str],
    db,
    top_k: int = 5,
    type_filter: list[str] | None = None,
    workspace_path: str | None = None,
) -> list[dict]:
    """Synchronous convenience wrapper used by tool functions.

    Resolves the embedder from the first library's snapshot profile, embeds the
    query, and returns results as plain dicts (not Citation objects) so that
    caller code doesn't need to import Citation.

    Args:
        type_filter: Optional list of ChunkType values to restrict results.
            Chunks with unknown/empty chunk_type are conservatively included.
        workspace_path: If provided, will attempt to load rerank config from
            .trpg/config.yaml to apply rerank after vector retrieval.

    Returns [] silently if no library is indexed or embedding profile is missing.
    """
    if not library_ids or db is None:
        return []

    try:
        from app.services.model_routing import get_embedding_for_query, LibraryNotIndexedError, ModelNotConfiguredError
        from app.agents.model_adapter import embedding_from_profile
    except ImportError:
        return []

    try:
        embedding_profile = get_embedding_for_query(library_ids[0], db)
        embedder = embedding_from_profile(embedding_profile)
    except Exception as e:
        logger.warning("retrieve_knowledge: failed to get embedder: %s", e)
        return []

    try:
        query_vector = embedder.embed_one(query)
    except Exception as e:
        logger.warning("retrieve_knowledge: failed to embed query %r: %s", query, e)
        return []

    doc_map: dict[str, dict] = {}
    try:
        from app.models.orm import KnowledgeDocumentORM
        docs = db.query(KnowledgeDocumentORM).filter(
            KnowledgeDocumentORM.library_id.in_(library_ids)
        ).all()
        doc_map = {d.id: {"filename": d.filename} for d in docs}
    except Exception:
        pass

    # Determine effective top_k — if rerank is enabled we over-fetch
    rerank_cfg = _load_rerank_cfg(workspace_path)
    rerank_enabled = rerank_cfg.get("enabled", False)
    effective_fetch_k = rerank_cfg.get("top_k", 20) if rerank_enabled else top_k

    seen_chunk_ids: set[str] = set()
    all_results: list[dict] = []
    for lib_id in library_ids:
        idx_dir = _index_dir(lib_id)
        hits = search_library(idx_dir, query_vector, top_k=effective_fetch_k)
        for hit in hits:
            cid = hit.get("chunk_id", "")
            if cid not in seen_chunk_ids:
                seen_chunk_ids.add(cid)
                doc_info = doc_map.get(hit.get("document_id", ""), {})
                chunk_type = hit.get("chunk_type") or None
                # Apply type filter: chunks with no type are conservatively included
                if type_filter and chunk_type and chunk_type not in type_filter:
                    continue
                all_results.append({
                    "chunk_id": cid,
                    "document_id": hit.get("document_id", ""),
                    "document_name": doc_info.get("filename", hit.get("document_id", "")),
                    "page_from": hit.get("page_from"),
                    "page_to": hit.get("page_to"),
                    "section_title": hit.get("section_title") or "",
                    "content": hit.get("content", ""),
                    "chunk_type": chunk_type,
                    "_distance": hit.get("_distance", 999),
                })

    all_results.sort(key=lambda x: x.get("_distance", 999))

    # If type_filter was applied and nothing came through, fall back to unfiltered results
    if type_filter and not all_results:
        return retrieve_knowledge(
            query=query,
            library_ids=library_ids,
            db=db,
            top_k=top_k,
            type_filter=None,
            workspace_path=workspace_path,
        )

    # Optional rerank
    if rerank_enabled and all_results:
        reranked = _apply_rerank(
            query=query,
            results=all_results,
            workspace_path=workspace_path,
            rerank_cfg=rerank_cfg,
            db=db,
        )
        if reranked is not None:
            all_results = reranked

    return all_results[:top_k]


def _load_rerank_cfg(workspace_path: str | None) -> dict:
    """Load rerank config from workspace config.yaml. Returns empty dict if unavailable."""
    if not workspace_path:
        return {}
    try:
        from app.services.workspace_service import read_config
        cfg = read_config(workspace_path)
        return cfg.get("rerank") or {}
    except Exception:
        return {}


def _apply_rerank(
    query: str,
    results: list[dict],
    workspace_path: str | None,
    rerank_cfg: dict,
    db,
) -> list[dict] | None:
    """Apply rerank if workspace has a rerank profile configured. Returns None on failure."""
    try:
        from app.services.workspace_service import read_config
        from app.models.orm import WorkspaceORM, RerankProfileORM
        from app.services.rerank_adapter import rerank as do_rerank
        from app.utils.secrets import decrypt_secret as decrypt

        if not workspace_path or db is None:
            return None

        cfg = read_config(workspace_path)
        rerank_model_name = (cfg.get("models") or {}).get("rerank", "")
        if not rerank_model_name:
            return None

        # Resolve rerank profile by name
        try:
            from app.models.orm import RerankProfileORM as _RerankORM
            profile = db.query(_RerankORM).filter_by(name=rerank_model_name).first()
        except Exception:
            return None

        if not profile:
            return None

        api_key = decrypt(profile.api_key_encrypted) if profile.api_key_encrypted else None
        top_n = rerank_cfg.get("top_n", 5)
        texts = [r["content"] for r in results]
        reranked_items = do_rerank(
            query,
            texts,
            provider_type=profile.provider_type,
            model_name=profile.model,
            api_key=api_key,
            base_url=profile.base_url,
            top_n=top_n,
        )
        reranked_results = []
        for item in reranked_items:
            orig = results[item.index]
            reranked_results.append({**orig, "_rerank_score": item.score})
        return reranked_results
    except Exception as e:
        logger.warning("retrieve_knowledge: rerank failed, falling back to vector results: %s", e)
        return None


def _index_dir(library_id: str) -> Path:
    return get_data_dir() / "knowledge" / "libraries" / library_id / "index"


async def retrieve(
    query: str,
    library_ids: list[str],
    top_k: int = 5,
    embedder: Any = None,  # object with .embed_one(text) -> list[float]
    document_map: dict[str, dict] | None = None,  # document_id -> {filename, ...}
    chunk_type_filter: list[str] | None = None,
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
    # 按类型筛选时需多取候选，避免过滤后条数不足（空类型仍保留，与 retrieve_knowledge 一致）
    fetch_k = min(200, top_k * 30) if chunk_type_filter else top_k

    for lib_id in library_ids:
        idx_dir = _index_dir(lib_id)
        hits = search_library(idx_dir, query_vector, top_k=fetch_k)
        for hit in hits:
            cid = hit.get("chunk_id", "")
            if cid not in seen_chunk_ids:
                seen_chunk_ids.add(cid)
                hit["_library_id"] = lib_id
                all_results.append(hit)

    # Sort by distance (lower = more relevant); lancedb returns "_distance"
    all_results.sort(key=lambda x: x.get("_distance", 999))

    if chunk_type_filter:
        filtered: list[dict] = []
        for hit in all_results:
            ct = (hit.get("chunk_type") or "").strip()
            if ct and ct not in chunk_type_filter:
                continue
            filtered.append(hit)
            if len(filtered) >= top_k:
                break
        all_results = filtered[:top_k]
    else:
        all_results = all_results[:top_k]

    citations: list[Citation] = []
    for hit in all_results:
        doc_id = hit.get("document_id", "")
        doc_info = (document_map or {}).get(doc_id, {})
        distance = hit.get("_distance", 1.0)
        # Convert distance to a [0,1] relevance score (cosine: score = 1 - distance/2)
        relevance = max(0.0, min(1.0, 1.0 - distance / 2.0))
        ct_raw = (hit.get("chunk_type") or "").strip()
        citations.append(Citation(
            chunk_id=hit.get("chunk_id", ""),
            content=hit.get("content", ""),
            document_id=doc_id,
            document_filename=doc_info.get("filename", ""),
            page_from=int(hit.get("page_from", -1)),
            page_to=int(hit.get("page_to", -1)),
            section_title=hit.get("section_title") or None,
            relevance_score=relevance,
            chunk_type=ct_raw or None,
        ))
    return citations
