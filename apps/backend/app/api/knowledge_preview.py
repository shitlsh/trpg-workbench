"""M8 A1: Knowledge preview, chunk browsing, page text, search/test with optional rerank."""
from __future__ import annotations
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import KnowledgeDocumentORM, KnowledgeLibraryORM, WorkspaceORM, RerankProfileORM
from app.models.schemas import (
    KnowledgeDocumentSummarySchema,
    PageTextPreviewSchema,
    ChunkListItemSchema,
    SearchTestRequest,
    SearchTestResponse,
    SearchTestResultSchema,
    QualityWarningSchema,
)
from app.utils.paths import get_data_dir

router = APIRouter(tags=["knowledge-preview"])


def _parsed_dir(library_id: str) -> Path:
    return get_data_dir() / "knowledge" / "libraries" / library_id / "parsed"


def _load_chunks_jsonl(library_id: str) -> list[dict]:
    """Load all chunks from chunks.jsonl for a library."""
    path = _parsed_dir(library_id) / "chunks.jsonl"
    if not path.exists():
        return []
    chunks = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    chunks.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return chunks


def _load_manifest(library_id: str) -> dict | None:
    path = _parsed_dir(library_id) / "manifest.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _build_quality_warnings(doc: KnowledgeDocumentORM, manifest: dict | None) -> list[QualityWarningSchema]:
    warnings: list[QualityWarningSchema] = []

    # Parse status warnings
    if doc.parse_status == "scanned_fallback":
        warnings.append(QualityWarningSchema(
            type="scanned_fallback",
            detail="疑似扫描版 PDF，文本提取质量较低，引用精度不保证"
        ))
    elif doc.parse_status == "partial":
        warnings.append(QualityWarningSchema(
            type="partial",
            detail="部分页面提取失败",
        ))

    # Manifest-based warnings
    if manifest:
        quality_notes = manifest.get("parse_quality_notes", "") or ""
        if "双栏" in quality_notes or "multi_column" in quality_notes:
            warnings.append(QualityWarningSchema(
                type="has_multi_column",
                detail=quality_notes,
            ))
        if "表格" in quality_notes or "table" in quality_notes:
            warnings.append(QualityWarningSchema(
                type="has_table",
                detail=quality_notes,
            ))

    return warnings


def _doc_to_summary(doc: KnowledgeDocumentORM, manifest: dict | None) -> KnowledgeDocumentSummarySchema:
    embedding_provider: str | None = None
    embedding_model: str | None = None
    indexed_at: str | None = None

    if manifest:
        embedding_provider = manifest.get("embedding_provider")
        embedding_model = manifest.get("embedding_model")
        indexed_at = manifest.get("indexed_at")
    elif doc.library and doc.library.embedding_model_snapshot:
        try:
            snap = json.loads(doc.library.embedding_model_snapshot)
            embedding_provider = snap.get("provider_type")
            embedding_model = snap.get("model_name")
        except Exception:
            pass

    quality_warnings = _build_quality_warnings(doc, manifest)

    return KnowledgeDocumentSummarySchema(
        id=doc.id,
        library_id=doc.library_id,
        filename=doc.filename,
        page_count=doc.page_count,
        chunk_count=doc.chunk_count,
        parse_status=doc.parse_status,
        parse_quality_notes=manifest.get("parse_quality_notes") if manifest else None,
        embedding_provider=embedding_provider,
        embedding_model=embedding_model,
        indexed_at=indexed_at,
        quality_warnings=quality_warnings,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


# ─── Document list with summaries ─────────────────────────────────────────────

@router.get(
    "/knowledge/libraries/{library_id}/documents/summary",
    response_model=list[KnowledgeDocumentSummarySchema],
)
def list_document_summaries(library_id: str, db: Session = Depends(get_db)):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    docs = (
        db.query(KnowledgeDocumentORM)
        .filter(KnowledgeDocumentORM.library_id == library_id)
        .order_by(KnowledgeDocumentORM.created_at.desc())
        .all()
    )

    summaries = []
    for doc in docs:
        manifest = _load_manifest(library_id)
        # Try per-doc manifest (keyed by doc filename or use library manifest)
        summaries.append(_doc_to_summary(doc, manifest))
    return summaries


@router.get(
    "/knowledge/documents/{document_id}/summary",
    response_model=KnowledgeDocumentSummarySchema,
)
def get_document_summary(document_id: str, db: Session = Depends(get_db)):
    doc = db.get(KnowledgeDocumentORM, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    manifest = _load_manifest(doc.library_id)
    return _doc_to_summary(doc, manifest)


# ─── Chunk list ───────────────────────────────────────────────────────────────

@router.get(
    "/knowledge/documents/{document_id}/chunks",
    response_model=list[ChunkListItemSchema],
)
def list_chunks(
    document_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    doc = db.get(KnowledgeDocumentORM, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    all_chunks = _load_chunks_jsonl(doc.library_id)
    doc_chunks = [c for c in all_chunks if c.get("document_id") == document_id]
    doc_chunks.sort(key=lambda c: c.get("chunk_index", 0))
    page = doc_chunks[offset: offset + limit]

    result = []
    for c in page:
        meta = c.get("metadata", {})
        result.append(ChunkListItemSchema(
            chunk_id=c.get("id", ""),
            chunk_index=c.get("chunk_index", 0),
            page_from=c.get("page_from", -1),
            page_to=c.get("page_to", -1),
            section_title=c.get("section_title") or None,
            char_count=c.get("char_count", len(c.get("content", ""))),
            parse_quality=meta.get("parse_quality", "good"),
            has_table=bool(meta.get("has_table", False)),
            has_multi_column=bool(meta.get("has_multi_column", False)),
        ))
    return result


@router.get(
    "/knowledge/documents/{document_id}/chunks/{chunk_id}",
    response_model=ChunkListItemSchema,
)
def get_chunk(document_id: str, chunk_id: str, db: Session = Depends(get_db)):
    doc = db.get(KnowledgeDocumentORM, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    all_chunks = _load_chunks_jsonl(doc.library_id)
    chunk = next((c for c in all_chunks if c.get("id") == chunk_id), None)
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk not found")

    meta = chunk.get("metadata", {})
    return ChunkListItemSchema(
        chunk_id=chunk.get("id", ""),
        chunk_index=chunk.get("chunk_index", 0),
        page_from=chunk.get("page_from", -1),
        page_to=chunk.get("page_to", -1),
        section_title=chunk.get("section_title") or None,
        char_count=chunk.get("char_count", len(chunk.get("content", ""))),
        content=chunk.get("content"),
        parse_quality=meta.get("parse_quality", "good"),
        has_table=bool(meta.get("has_table", False)),
        has_multi_column=bool(meta.get("has_multi_column", False)),
    )


# ─── Page text preview ────────────────────────────────────────────────────────

@router.get(
    "/knowledge/documents/{document_id}/pages/{page_number}",
    response_model=PageTextPreviewSchema,
)
def get_page_text(document_id: str, page_number: int, db: Session = Depends(get_db)):
    doc = db.get(KnowledgeDocumentORM, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Load per-page text from parsed/pages/<page>.json if available
    pages_dir = _parsed_dir(doc.library_id) / "pages"
    page_file = pages_dir / f"{page_number}.json"

    raw_text = ""
    cleaned_text = None
    if page_file.exists():
        try:
            page_data = json.loads(page_file.read_text(encoding="utf-8"))
            raw_text = page_data.get("raw_text", "")
            cleaned_text = page_data.get("cleaned_text")
        except Exception:
            raw_text = ""

    # Find chunk_ids for this page
    all_chunks = _load_chunks_jsonl(doc.library_id)
    chunk_ids = [
        c.get("id", "")
        for c in all_chunks
        if c.get("document_id") == document_id
        and c.get("page_from", -1) <= page_number <= c.get("page_to", -1)
    ]

    return PageTextPreviewSchema(
        page_number=page_number,
        raw_text=raw_text,
        cleaned_text=cleaned_text,
        chunk_ids=chunk_ids,
    )


# ─── Search test ──────────────────────────────────────────────────────────────

@router.post(
    "/knowledge/libraries/{library_id}/search/test",
    response_model=SearchTestResponse,
)
async def search_test(
    library_id: str,
    body: SearchTestRequest,
    db: Session = Depends(get_db),
):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    # Use the specified library_ids or fall back to just this library
    library_ids = body.library_ids if body.library_ids else [library_id]

    # Validate all libraries are indexed
    warnings: list[str] = []
    valid_library_ids: list[str] = []
    for lid in library_ids:
        l = db.get(KnowledgeLibraryORM, lid)
        if not l or not l.embedding_model_snapshot:
            warnings.append(f"Library {lid} has not been indexed yet, skipping")
        else:
            valid_library_ids.append(lid)

    if not valid_library_ids:
        return SearchTestResponse(results=[], reranked=False, warnings=warnings, error="No indexed libraries found")

    # Build document map
    from app.models.orm import KnowledgeDocumentORM as DocORM
    docs = db.query(DocORM).filter(DocORM.library_id.in_(valid_library_ids)).all()
    doc_map = {d.id: {"filename": d.filename} for d in docs}

    # Resolve embedder from first library snapshot
    from app.services.model_routing import get_embedding_for_query, LibraryNotIndexedError, ModelNotConfiguredError
    try:
        embedding_profile = get_embedding_for_query(valid_library_ids[0], db)
    except (LibraryNotIndexedError, ModelNotConfiguredError) as exc:
        raise HTTPException(status_code=422, detail={"error": exc.message})

    from app.agents.model_adapter import embedding_from_profile
    embedder = embedding_from_profile(embedding_profile)

    # Determine effective top_n (for rerank) and top_k
    effective_top_k = body.top_k
    effective_top_n = body.top_n if body.use_rerank else body.top_k

    # Vector search
    from app.knowledge.retriever import retrieve
    try:
        citations = await retrieve(
            query=body.query,
            library_ids=valid_library_ids,
            top_k=effective_top_n,
            embedder=embedder,
            document_map=doc_map,
        )
    except Exception as exc:
        return SearchTestResponse(results=[], reranked=False, warnings=warnings, error=str(exc))

    # Build base results with vector_score
    results: list[SearchTestResultSchema] = [
        SearchTestResultSchema(
            chunk_id=c.chunk_id,
            content=c.content,
            document_filename=c.document_filename,
            page_from=c.page_from,
            page_to=c.page_to,
            section_title=c.section_title,
            vector_score=c.relevance_score,
            rerank_score=None,
            reranked=False,
        )
        for c in citations
    ]

    # Optional rerank — only if explicitly requested and workspace has a rerank profile
    did_rerank = False
    if body.use_rerank and results:
        rerank_profile: RerankProfileORM | None = None

        if body.workspace_id:
            ws = db.get(WorkspaceORM, body.workspace_id)
            if ws and ws.rerank_profile_id:
                rerank_profile = db.get(RerankProfileORM, ws.rerank_profile_id)

        if rerank_profile:
            from app.utils.secrets import decrypt_secret as decrypt
            from app.services.rerank_adapter import rerank as do_rerank
            api_key = decrypt(rerank_profile.api_key_encrypted) if rerank_profile.api_key_encrypted else None
            texts = [r.content for r in results]
            try:
                reranked = do_rerank(
                    body.query,
                    texts,
                    provider_type=rerank_profile.provider_type,
                    model_name=rerank_profile.model_name,
                    api_key=api_key,
                    base_url=rerank_profile.base_url,
                    top_n=effective_top_k,
                )
                reranked_results: list[SearchTestResultSchema] = []
                for rr in reranked:
                    orig = results[rr.index]
                    reranked_results.append(SearchTestResultSchema(
                        chunk_id=orig.chunk_id,
                        content=orig.content,
                        document_filename=orig.document_filename,
                        page_from=orig.page_from,
                        page_to=orig.page_to,
                        section_title=orig.section_title,
                        vector_score=orig.vector_score,
                        rerank_score=rr.score,
                        reranked=True,
                    ))
                results = reranked_results
                did_rerank = True
            except Exception as exc:
                warnings.append(f"Rerank failed, falling back to vector results: {exc}")
                results = results[:effective_top_k]
        else:
            warnings.append("use_rerank=true but no rerank profile configured for workspace; using vector results")
            results = results[:effective_top_k]
    else:
        results = results[:effective_top_k]

    return SearchTestResponse(results=results, reranked=did_rerank, warnings=warnings)
