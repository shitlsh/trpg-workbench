import asyncio
import json
import logging
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from app.knowledge.toc_analyzer import (
    TocSection,
    TOC_LLM_MAX_WAIT_SECONDS,
    CHM_CLASSIFY_BATCH,
)

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import KnowledgeDocumentORM, KnowledgeLibraryORM, IngestTaskORM
from app.models.schemas import KnowledgeDocumentSchema, IngestTaskSchema
from app.models.orm import EmbeddingProfileORM as _EmbeddingProfileORM

router = APIRouter(prefix="/knowledge/libraries", tags=["knowledge-documents"])
_log = logging.getLogger(__name__)


def _doc_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _toc_sections_payload(sections: list[TocSection]) -> list[dict[str, Any]]:
    return [
        {
            "title": s.title,
            "page_from": s.page_from,
            "page_to": s.page_to,
            "depth": s.depth,
            "suggested_chunk_type": s.suggested_chunk_type,
        }
        for s in sections
    ]


@router.get("/{library_id}/documents", response_model=list[KnowledgeDocumentSchema])
def list_documents(library_id: str, db: Session = Depends(get_db)):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    return (
        db.query(KnowledgeDocumentORM)
        .filter(KnowledgeDocumentORM.library_id == library_id)
        .order_by(KnowledgeDocumentORM.created_at.desc())
        .all()
    )


@router.post("/{library_id}/documents", status_code=202)
async def upload_document(
    library_id: str,
    file: UploadFile = File(...),
    embedding_profile_id: str = Query(..., description="Embedding profile ID to use for indexing"),
    default_chunk_type: str = Query("", description="ChunkType tag for all chunks in this document"),
    page_offset: int = Query(0, description="Subtract this from PDF page numbers to get logical page numbers matching the book's TOC. E.g. if PDF page 13 = book page 1, set page_offset=12."),
    db: Session = Depends(get_db),
):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    SUPPORTED_EXTS = {".pdf", ".chm"}
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{file_ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTS))}")

    # Resolve embedding profile directly by ID
    embedding_profile = db.get(_EmbeddingProfileORM, embedding_profile_id)
    if not embedding_profile:
        raise HTTPException(
            status_code=422,
            detail={"error": f"Embedding profile '{embedding_profile_id}' not found", "error_type": "ModelNotConfiguredError"},
        )

    # Sanitize filename to prevent path traversal
    safe_filename = Path(file.filename).name

    # Create document record
    mime_map = {".pdf": "application/pdf", ".chm": "application/vnd.ms-htmlhelp"}
    doc = KnowledgeDocumentORM(
        library_id=library_id,
        filename=safe_filename,
        original_path="",  # will be set after save
        mime_type=mime_map.get(file_ext, "application/octet-stream"),
        parse_status="pending",
    )
    db.add(doc)
    db.flush()

    # Create ingest task record
    task = IngestTaskORM(document_id=doc.id, status="pending", current_step=0, total_steps=8)
    db.add(task)
    db.commit()
    db.refresh(doc)
    db.refresh(task)

    # Save uploaded file to temp location
    content = await file.read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=file_ext)
    tmp.write(content)
    tmp.close()
    tmp_path = Path(tmp.name)

    # Snapshot embedding profile info (id + model details) to persist on library after ingest
    embedding_snapshot = {
        "profile_id": embedding_profile.id,
        "provider_type": embedding_profile.provider_type,
        "model_name": embedding_profile.model_name,
        "dimensions": embedding_profile.dimensions,
    }

    # Launch ingest in background (fire-and-forget)
    asyncio.create_task(
        _run_ingest_background(
            document_id=doc.id,
            library_id=library_id,
            task_id=task.id,
            tmp_path=tmp_path,
            filename=file.filename,
            file_ext=file_ext,
            embedding_profile_id=embedding_profile.id,
            embedding_snapshot=embedding_snapshot,
            default_chunk_type=default_chunk_type,
            page_offset=page_offset,
        )
    )

    return {"document_id": doc.id, "task_id": task.id}


async def _run_ingest_background(
    document_id: str,
    library_id: str,
    task_id: str,
    tmp_path: Path,
    filename: str,
    file_ext: str = ".pdf",
    embedding_profile_id: str = "",
    embedding_snapshot: dict | None = None,
    default_chunk_type: str = "",
    page_offset: int = 0,
    toc_mapping: list[dict] | None = None,
):
    if file_ext == ".chm":
        from app.knowledge.chm_ingest import run_ingest
    else:
        from app.knowledge.pdf_ingest import run_ingest
    from app.storage.database import get_session_factory
    from app.agents.model_adapter import embedding_from_profile
    from app.models.orm import EmbeddingProfileORM

    SessionLocal = get_session_factory()

    async def progress_callback(step: int, label: str, status: str = "running"):
        db = SessionLocal()
        try:
            task = db.get(IngestTaskORM, task_id)
            if task:
                task.current_step = step
                task.step_label = label
                task.status = "running" if status == "running" else status
                db.commit()
        finally:
            db.close()

    db = SessionLocal()
    try:
        task = db.get(IngestTaskORM, task_id)
        if task:
            task.status = "running"
            db.commit()
        doc = db.get(KnowledgeDocumentORM, document_id)
        if doc:
            doc.parse_status = "running"
            db.commit()

        # Reload embedding profile for use in background task
        profile = db.get(EmbeddingProfileORM, embedding_profile_id)
        if not profile:
            raise RuntimeError(f"Embedding profile {embedding_profile_id} not found")
        embedder = embedding_from_profile(profile)
    finally:
        db.close()

    try:
        result = await run_ingest(
            document_id=document_id,
            library_id=library_id,
            tmp_file_path=tmp_path,
            original_filename=filename,
            progress_callback=progress_callback,
            embedder=embedder,
            embedding_snapshot=embedding_snapshot or {},
            default_chunk_type=default_chunk_type,
            page_offset=page_offset,
            toc_mapping=toc_mapping,
        )
        _log.info(
            "ingest finished document_id=%s library_id=%s parse_status=%s page_count=%s chunk_count=%s parse_notes=%s",
            document_id,
            library_id,
            result.get("parse_status"),
            result.get("page_count"),
            result.get("chunk_count"),
            result.get("parse_notes"),
        )
        db = SessionLocal()
        try:
            doc = db.get(KnowledgeDocumentORM, document_id)
            if doc:
                doc.parse_status = result["parse_status"]
                doc.page_count = result.get("page_count")
                doc.chunk_count = result.get("chunk_count")
                doc.original_path = result.get("manifest_path", "")
                notes = result.get("parse_notes")
                if notes:
                    try:
                        meta: dict
                        if doc.metadata_json:
                            meta = json.loads(doc.metadata_json)
                        else:
                            meta = {}
                        meta["ingest_parse_notes"] = notes
                        doc.metadata_json = json.dumps(meta, ensure_ascii=False)
                    except Exception:
                        pass
                db.commit()
            # Update library embedding snapshot on successful ingest
            lib = db.get(KnowledgeLibraryORM, library_id)
            if lib:
                lib.embedding_profile_id = embedding_profile_id
                lib.embedding_model_snapshot = json.dumps(embedding_snapshot)
                db.commit()
            task = db.get(IngestTaskORM, task_id)
            if task:
                task.status = "completed"
                task.current_step = 8
                task.step_label = "处理完成"
                db.commit()
        finally:
            db.close()
    except Exception as e:
        _log.exception(
            "ingest failed document_id=%s library_id=%s task_id=%s: %s",
            document_id,
            library_id,
            task_id,
            e,
        )
        db = SessionLocal()
        try:
            task = db.get(IngestTaskORM, task_id)
            if task:
                task.status = "failed"
                task.error_message = str(e)
                db.commit()
            doc = db.get(KnowledgeDocumentORM, document_id)
            if doc:
                doc.parse_status = "failed"
                db.commit()
        finally:
            db.close()
    finally:
        tmp_path.unlink(missing_ok=True)


router2 = APIRouter(prefix="/knowledge/documents", tags=["knowledge-documents"])


@router2.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.get(KnowledgeDocumentORM, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    library_id = doc.library_id
    # Remove from vector index
    from app.knowledge.vector_index import delete_document_chunks
    from app.utils.paths import get_data_dir
    idx_dir = get_data_dir() / "knowledge" / "libraries" / library_id / "index"
    delete_document_chunks(idx_dir, document_id)
    # Remove from DB
    db.delete(doc)
    db.commit()


class ReindexDocumentRequest(BaseModel):
    embedding_profile_id: str | None = None
    embedding_model_name: str | None = None


@router2.post("/{document_id}/reindex", status_code=202)
async def reindex_document(
    document_id: str,
    body: ReindexDocumentRequest = Body(default=ReindexDocumentRequest()),
    db: Session = Depends(get_db),
):
    """Rebuild vector index from existing chunks without re-upload/TOC analysis."""
    doc = db.get(KnowledgeDocumentORM, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    lib = db.get(KnowledgeLibraryORM, doc.library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    profile_id = body.embedding_profile_id
    if not profile_id:
        if lib.embedding_model_snapshot:
            try:
                profile_id = (json.loads(lib.embedding_model_snapshot) or {}).get("profile_id")
            except Exception:
                profile_id = None
    if not profile_id:
        profile_id = lib.embedding_profile_id
    if not profile_id:
        raise HTTPException(status_code=422, detail="No embedding profile configured for this library")

    profile = db.get(_EmbeddingProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=422, detail=f"Embedding profile {profile_id} not found")
    model_name = (body.embedding_model_name or "").strip() or profile.model_name

    embedding_snapshot = {
        "profile_id": profile.id,
        "provider_type": profile.provider_type,
        "model_name": model_name,
        "dimensions": profile.dimensions,
    }

    task = IngestTaskORM(
        document_id=document_id,
        status="pending",
        current_step=0,
        total_steps=4,
        step_label="准备重建索引",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    asyncio.create_task(
        _run_reindex_background(
            document_id=document_id,
            library_id=doc.library_id,
            task_id=task.id,
            embedding_profile_id=profile.id,
            embedding_model_name=model_name,
            embedding_snapshot=embedding_snapshot,
        )
    )
    return {"document_id": document_id, "task_id": task.id}


def _strip_embedding_fail_notes(notes: str | None) -> str | None:
    text = (notes or "").strip()
    if not text:
        return None
    kept = []
    for part in [p.strip() for p in text.split(" | ")]:
        if not part:
            continue
        low = part.lower()
        if "embedding failed" in low or "vector index write failed" in low:
            continue
        kept.append(part)
    return " | ".join(kept) if kept else None


async def _run_reindex_background(
    *,
    document_id: str,
    library_id: str,
    task_id: str,
    embedding_profile_id: str,
    embedding_model_name: str,
    embedding_snapshot: dict,
):
    from app.storage.database import get_session_factory
    from app.agents.model_adapter import embedding_from_profile
    from app.knowledge.vector_index import upsert_chunks
    from app.utils.paths import get_data_dir
    from types import SimpleNamespace

    SessionLocal = get_session_factory()

    async def report(step: int, label: str, status: str = "running"):
        db = SessionLocal()
        try:
            task = db.get(IngestTaskORM, task_id)
            if task:
                task.current_step = step
                task.step_label = label
                task.status = "running" if status == "running" else status
                db.commit()
        finally:
            db.close()

    db = SessionLocal()
    try:
        task = db.get(IngestTaskORM, task_id)
        if task:
            task.status = "running"
            db.commit()
        profile = db.get(_EmbeddingProfileORM, embedding_profile_id)
        if not profile:
            raise RuntimeError(f"Embedding profile {embedding_profile_id} not found")
        profile_for_reindex = SimpleNamespace(
            provider_type=profile.provider_type,
            model_name=embedding_model_name or profile.model_name,
            base_url=profile.base_url,
            api_key_encrypted=profile.api_key_encrypted,
        )
        embedder = embedding_from_profile(profile_for_reindex)
    finally:
        db.close()

    try:
        await report(1, "正在读取已解析分块...")
        parsed_dir = get_data_dir() / "knowledge" / "libraries" / library_id / "parsed"
        chunks_path = parsed_dir / "chunks.jsonl"
        if not chunks_path.exists():
            raise RuntimeError("chunks.jsonl not found; cannot rebuild index")

        all_chunks: list[dict] = []
        target_count = 0
        with chunks_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    c = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not c.get("document_id"):
                    continue
                if not (c.get("content") or "").strip():
                    continue
                all_chunks.append(c)
                if c.get("document_id") == document_id:
                    target_count += 1
        if target_count == 0:
            raise RuntimeError("No chunks found for this document")
        if not all_chunks:
            raise RuntimeError("No chunks found in library parsed data")

        await report(2, "正在生成向量...")
        batch_size = 32
        vectors_by_id: dict[str, list[float]] = {}
        for i in range(0, len(all_chunks), batch_size):
            batch = all_chunks[i : i + batch_size]
            texts = [(c.get("content") or "") for c in batch]
            vectors = await asyncio.to_thread(embedder.embed, texts)
            if len(vectors) != len(batch):
                raise RuntimeError("Embedding provider returned unexpected vector count")
            for c, vec in zip(batch, vectors):
                cid = c.get("id") or c.get("chunk_id")
                if cid:
                    vectors_by_id[cid] = vec

        await report(3, "正在重建向量索引...")
        idx_dir = get_data_dir() / "knowledge" / "libraries" / library_id / "index"
        idx_dir.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(idx_dir / "chunks.lance", ignore_errors=True)
        records: list[dict] = []
        for c in all_chunks:
            cid = c.get("id") or c.get("chunk_id")
            if not cid or cid not in vectors_by_id:
                continue
            meta = c.get("metadata", {}) or {}
            records.append({
                "chunk_id": cid,
                "document_id": c.get("document_id", ""),
                "library_id": library_id,
                "content": c.get("content", ""),
                "page_from": c.get("page_from", -1),
                "page_to": c.get("page_to", -1),
                "section_title": c.get("section_title") or "",
                "chunk_type": meta.get("chunk_type") or c.get("chunk_type") or "",
                "vector": vectors_by_id[cid],
            })
        await asyncio.to_thread(upsert_chunks, idx_dir, records, len(records[0]["vector"]) if records else 1536)

        await report(4, "正在更新索引元数据...")
        manifest_path = parsed_dir / "manifest.json"
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if manifest_path.exists():
            try:
                m = json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(m, dict):
                    m["embedding_profile_id"] = embedding_snapshot["profile_id"]
                    m["embedding_provider"] = embedding_snapshot["provider_type"]
                    m["embedding_model"] = embedding_snapshot["model_name"]
                    m["indexed_at"] = now_iso
                    m["parse_quality_notes"] = _strip_embedding_fail_notes(m.get("parse_quality_notes"))
                elif isinstance(m, list):
                    for item in m:
                        if not isinstance(item, dict):
                            continue
                        item["embedding_profile_id"] = embedding_snapshot["profile_id"]
                        item["embedding_provider"] = embedding_snapshot["provider_type"]
                        item["embedding_model"] = embedding_snapshot["model_name"]
                        item["indexed_at"] = now_iso
                        item["parse_quality_notes"] = _strip_embedding_fail_notes(item.get("parse_quality_notes"))
                manifest_path.write_text(json.dumps(m, ensure_ascii=False, indent=2))
            except Exception:
                pass

        db = SessionLocal()
        try:
            lib = db.get(KnowledgeLibraryORM, library_id)
            if lib:
                lib.embedding_profile_id = embedding_profile_id
                lib.embedding_model_snapshot = json.dumps(embedding_snapshot, ensure_ascii=False)
            doc = db.get(KnowledgeDocumentORM, document_id)
            if doc and doc.metadata_json:
                try:
                    meta = json.loads(doc.metadata_json)
                    if isinstance(meta, dict):
                        meta["ingest_parse_notes"] = _strip_embedding_fail_notes(meta.get("ingest_parse_notes"))
                        doc.metadata_json = json.dumps(meta, ensure_ascii=False)
                except Exception:
                    pass
            task = db.get(IngestTaskORM, task_id)
            if task:
                task.status = "completed"
                task.current_step = 4
                task.step_label = "重建完成"
            db.commit()
        finally:
            db.close()
    except Exception as e:
        _log.exception("reindex failed document_id=%s library_id=%s task_id=%s: %s", document_id, library_id, task_id, e)
        db = SessionLocal()
        try:
            task = db.get(IngestTaskORM, task_id)
            if task:
                task.status = "failed"
                task.error_message = str(e)
            db.commit()
        finally:
            db.close()


# ─── TOC-driven ingest preview flow ──────────────────────────────────────────
#
# Flow:
#   1. POST /knowledge/documents/upload-preview            → upload file, get file_id
#   2. POST /knowledge/documents/preview/{id}/detect-toc  → auto-detect or re-scan TOC
#   3. POST /knowledge/documents/preview/{id}/analyze-toc → LLM parse TOC text → sections
#   4. POST /knowledge/libraries/{lid}/documents/ingest-confirmed → real ingest
#
# Temp files are held in memory (path dict) with a 1-hour TTL and cleaned on use.

_TEMP_FILES: dict[str, dict[str, Any]] = {}  # file_id → {path, ext, filename, created_at}
_TEMP_TTL_SECONDS = 3600


def _purge_expired_temps() -> None:
    now = time.time()
    expired = [k for k, v in _TEMP_FILES.items() if now - v["created_at"] > _TEMP_TTL_SECONDS]
    for k in expired:
        try:
            Path(_TEMP_FILES[k]["path"]).unlink(missing_ok=True)
        except Exception:
            pass
        del _TEMP_FILES[k]


def _get_temp(file_id: str) -> dict[str, Any]:
    _purge_expired_temps()
    entry = _TEMP_FILES.get(file_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Temporary upload not found or expired. Please re-upload the file.")
    return entry


router3 = APIRouter(prefix="/knowledge/documents", tags=["knowledge-toc-preview"])


# ── 1. Upload for preview ─────────────────────────────────────────────────────

@router3.post("/upload-preview")
async def upload_for_preview(file: UploadFile = File(...)):
    """Upload a PDF or CHM file for TOC preview without starting ingest."""
    _purge_expired_temps()

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in {".pdf", ".chm"}:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{file_ext}'. Supported: .pdf, .chm")

    content = await file.read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=file_ext)
    tmp.write(content)
    tmp.close()

    file_id = uuid.uuid4().hex
    _TEMP_FILES[file_id] = {
        "path": tmp.name,
        "ext": file_ext,
        "filename": Path(file.filename).name,
        "created_at": time.time(),
        "size_bytes": len(content),
    }

    return {
        "file_id": file_id,
        "filename": Path(file.filename).name,
        "file_ext": file_ext,
        "size_bytes": len(content),
    }


# ── 2. Detect TOC ─────────────────────────────────────────────────────────────

class DetectTocRequest(BaseModel):
    toc_page_start: int | None = None  # if provided, override auto-detection
    toc_page_end: int | None = None


@router3.post("/preview/{file_id}/detect-toc")
async def detect_toc(file_id: str, body: DetectTocRequest = Body(default=DetectTocRequest())):
    """Auto-detect TOC pages in a PDF, or extract the specified page range.

    For CHM files, returns the embedded HHC structure (is_structural=true) and
    skips the PDF "TOC text → LLM" flow. Use POST .../classify-chm-sections
    to let the LLM fill chunk_type (shallow rows + inherit for deep entries).
    """
    entry = _get_temp(file_id)
    file_path = Path(entry["path"])
    file_ext = entry["ext"]

    if file_ext == ".chm":
        from app.knowledge.toc_extractor import extract_chm_toc_sync
        from app.knowledge.toc_analyzer import chm_structure_to_sections
        try:
            raw_items = await asyncio.to_thread(extract_chm_toc_sync, file_path)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"CHM TOC extraction failed: {e}")
        sections = chm_structure_to_sections(raw_items)
        return {
            "toc_text": "",
            "page_start": 1,
            "page_end": len(raw_items),
            "is_structural": True,
            "sections": [
                {
                    "title": s.title,
                    "page_from": s.page_from,
                    "page_to": s.page_to,
                    "depth": s.depth,
                    "suggested_chunk_type": s.suggested_chunk_type,
                }
                for s in sections
            ],
        }

    # PDF
    from app.knowledge.toc_extractor import detect_toc_pages_sync, extract_pages_text_sync

    try:
        if body.toc_page_start is not None and body.toc_page_end is not None:
            toc_text = await asyncio.to_thread(
                extract_pages_text_sync, file_path,
                body.toc_page_start, body.toc_page_end,
            )
            page_start = body.toc_page_start
            page_end = body.toc_page_end
        else:
            toc_text, page_start, page_end = await asyncio.to_thread(
                detect_toc_pages_sync, file_path,
            )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"TOC page extraction failed: {e}")

    return {
        "toc_text": toc_text,
        "page_start": page_start,
        "page_end": page_end,
        "is_structural": False,
        "sections": None,
    }


# PDF `analyze-toc` 与 CHM 每批 `complete_text_once` 的单次墙钟上限见 `toc_analyzer.TOC_LLM_MAX_WAIT_SECONDS`。

# ── 3. Analyze TOC with LLM ───────────────────────────────────────────────────

class AnalyzeTocRequest(BaseModel):
    toc_text: str
    llm_profile_id: str
    llm_model_name: str = ""


@router3.post("/preview/{file_id}/analyze-toc")
async def analyze_toc(file_id: str, body: AnalyzeTocRequest, db: Session = Depends(get_db)):
    """Parse TOC text via SSE: progress phases, keepalive, then result or error.

    Events: ``progress`` (phase, message, detail), ``result``, ``error``.
    """
    _get_temp(file_id)  # validate file still exists

    from app.models.orm import LLMProfileORM
    from app.knowledge.toc_analyzer import (
        fetch_pdf_toc_llm_raw,
        parse_pdf_toc_response,
        full_toc_rows_to_preview,
        build_full_toc_from_toc_text,
        TocNotRecognizedError,
    )

    profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not profile:
        profile = db.query(LLMProfileORM).first()
    if not profile:
        async def _no_profile():
            yield _doc_sse("error", {"message": "No LLM profile configured.", "error_type": "ModelNotConfiguredError"})
        return StreamingResponse(_no_profile(), media_type="text/event-stream")

    toc_text = body.toc_text
    model_name = body.llm_model_name
    model_label = (model_name or "").strip() or (getattr(profile, "model_name", None) or "")
    toc_chars = len(toc_text or "")

    async def _stream():
        correlation_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        detail_base = {
            "correlation_id": correlation_id,
            "operation": "analyze_toc",
            "file_id": file_id,
            "model": model_label,
            "provider_kind": (profile.provider_type or "").strip().lower(),
        }
        yield _doc_sse(
            "progress",
            {"phase": "queued", "message": "已加入分析队列", "detail": {**detail_base, "toc_chars": toc_chars}},
        )
        yield _doc_sse(
            "progress",
            {"phase": "llm_request", "message": "正在请求模型解析目录…", "detail": detail_base},
        )
        yield _doc_sse(
            "progress",
            {
                "phase": "llm_wait",
                "message": "已发送请求，等待模型首次响应…",
                "detail": {**detail_base, "wait_seconds": 0},
            },
        )
        try:
            q: asyncio.Queue = asyncio.Queue()

            async def _fetch_raw():
                try:
                    t_llm = time.perf_counter()
                    raw_local = await fetch_pdf_toc_llm_raw(toc_text, profile, model_name)
                    llm_ms_local = round((time.perf_counter() - t_llm) * 1000.0, 2)
                    await q.put(("raw", raw_local, llm_ms_local))
                except Exception as exc:
                    await q.put(("fetch_err", str(exc)))

            asyncio.create_task(_fetch_raw())
            t_llm_start = time.perf_counter()
            raw = ""
            llm_ms = 0.0
            while True:
                if (time.perf_counter() - t_llm_start) >= TOC_LLM_MAX_WAIT_SECONDS:
                    w = int(time.perf_counter() - t_llm_start)
                    _log.warning(
                        "knowledge_sse operation=analyze_toc phase=llm_wait_exceeded file_id=%s correlation_id=%s "
                        "wall_wait_s=%s toc_chars=%s model=%s (LLM 未在时限内返回完整响应)",
                        file_id,
                        correlation_id,
                        w,
                        toc_chars,
                        model_label,
                    )
                    yield _doc_sse(
                        "error",
                        {
                            "message": (
                                f"目录分析超时：等待模型返回已超过 {int(TOC_LLM_MAX_WAIT_SECONDS)} 秒。"
                                " 整本目录的 JSON 输出可能较慢，请稍后重试、换更快模型，或只选取较短目录页范围。"
                            ),
                        },
                    )
                    return
                remaining = TOC_LLM_MAX_WAIT_SECONDS - (time.perf_counter() - t_llm_start)
                try:
                    item = await asyncio.wait_for(q.get(), timeout=min(10.0, max(0.1, remaining)))
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    wait_sec = int(time.perf_counter() - t_llm_start)
                    yield _doc_sse(
                        "progress",
                        {
                            "phase": "llm_wait",
                            "message": f"等待模型响应当中（已约 {wait_sec} 秒）",
                            "detail": {**detail_base, "wait_seconds": wait_sec},
                        },
                    )
                    continue
                if item[0] == "fetch_err":
                    raise RuntimeError(item[1])
                _, raw, llm_ms = item
                break

            response_chars = len(raw or "")
            yield _doc_sse(
                "progress",
                {
                    "phase": "llm_response_received",
                    "message": "已收到模型响应，正在解析 JSON…",
                    "detail": {**detail_base, "elapsed_ms": llm_ms, "response_chars": response_chars},
                },
            )
            t_parse = time.perf_counter()
            try:
                result = await asyncio.to_thread(parse_pdf_toc_response, raw)
            except TocNotRecognizedError as exc:
                parse_ms = round((time.perf_counter() - t_parse) * 1000.0, 2)
                total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                _log.info(
                    "knowledge_sse operation=analyze_toc phase=json_parse_error file_id=%s correlation_id=%s "
                    "total_ms=%s parse_ms=%s toc_chars=%s response_chars=%s error_type=toc_not_recognized",
                    file_id,
                    correlation_id,
                    total_ms,
                    parse_ms,
                    toc_chars,
                    response_chars,
                )
                yield _doc_sse(
                    "progress",
                    {
                        "phase": "json_parse_error",
                        "message": "模型判定输入不是有效目录",
                        "detail": {**detail_base, "elapsed_ms": parse_ms, "parse_ok": False},
                    },
                )
                yield _doc_sse("error", {"message": exc.reason, "error_type": "toc_not_recognized"})
                return
            except Exception as exc:
                parse_ms = round((time.perf_counter() - t_parse) * 1000.0, 2)
                total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                snippet = str(exc)[:240]
                _log.info(
                    "knowledge_sse operation=analyze_toc phase=json_parse_error file_id=%s correlation_id=%s "
                    "total_ms=%s parse_ms=%s parse_ok=false parse_error_snippet=%s",
                    file_id,
                    correlation_id,
                    total_ms,
                    parse_ms,
                    snippet,
                )
                yield _doc_sse(
                    "progress",
                    {
                        "phase": "json_parse_error",
                        "message": "解析模型输出失败",
                        "detail": {**detail_base, "elapsed_ms": parse_ms, "parse_ok": False},
                    },
                )
                yield _doc_sse("error", {"message": str(exc)})
                return

            parse_ms = round((time.perf_counter() - t_parse) * 1000.0, 2)
            total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            rows = _toc_sections_payload(result.sections)
            result_body: dict[str, Any] = {"sections": rows}

            # Phase-2a: attempt rule-based full_toc from toc_text + heading numbering
            rule_full_toc: dict[str, Any] | None = None
            try:
                rule_full_toc = build_full_toc_from_toc_text(toc_text, result.sections)
            except Exception as e:
                _log.warning(
                    "knowledge_sse operation=analyze_toc build_full_toc_from_toc_text error file_id=%s: %s",
                    file_id, e, exc_info=True,
                )

            if rule_full_toc is not None:
                from app.knowledge.toc_analyzer import _extract_full_toc_rows
                rule_rows = len(_extract_full_toc_rows(rule_full_toc))
                _log.info(
                    "knowledge_sse operation=analyze_toc full_toc_source=rule file_id=%s "
                    "rule_rows=%s sections=%s → sending rule full_toc to frontend",
                    file_id, rule_rows, len(result.sections),
                )
                result_body["full_toc"] = rule_full_toc
                result_body["full_toc_source"] = "rule"
            else:
                _log.info(
                    "knowledge_sse operation=analyze_toc full_toc_source=pending_llm file_id=%s "
                    "sections=%s → rule-based sparse, signalling frontend to call analyze-full-toc",
                    file_id, len(result.sections),
                )
                # Signal to the frontend that it should request a full_toc via analyze-full-toc
                result_body["full_toc_source"] = "pending_llm"

            try:
                active_full_toc = rule_full_toc  # may be None → preview_expanded skipped
                pe = full_toc_rows_to_preview(result.sections, active_full_toc)
                if pe:
                    result_body["preview_expanded"] = pe
            except Exception as e:
                _log.debug("analyze_toc preview_expanded skipped: %s", e, exc_info=True)

            _log.info(
                "knowledge_sse operation=analyze_toc phase=complete file_id=%s correlation_id=%s total_ms=%s "
                "llm_ms=%s parse_ms=%s toc_chars=%s response_chars=%s sections_out=%s "
                "full_toc_source=%s parse_ok=true",
                file_id,
                correlation_id,
                total_ms,
                llm_ms,
                parse_ms,
                toc_chars,
                response_chars,
                len(rows),
                result_body.get("full_toc_source", "none"),
            )
            yield _doc_sse(
                "progress",
                {
                    "phase": "json_parse",
                    "message": "目录结构解析完成",
                    "detail": {
                        **detail_base,
                        "elapsed_ms": parse_ms,
                        "parse_ok": True,
                        "sections_out": len(rows),
                        "full_toc_source": result_body.get("full_toc_source"),
                    },
                },
            )
            yield _doc_sse("result", result_body)
        except Exception as exc:
            total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            _log.exception(
                "knowledge_sse operation=analyze_toc phase=error file_id=%s correlation_id=%s total_ms=%s",
                file_id,
                correlation_id,
                total_ms,
            )
            yield _doc_sse("error", {"message": str(exc)})

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── 3b. Async full_toc via LLM (Phase-2 fallback when rule-based is sparse) ───

class AnalyzeFullTocRequest(BaseModel):
    toc_text: str
    sections: list[dict[str, Any]]
    llm_profile_id: str
    llm_model_name: str = ""


@router3.post("/preview/{file_id}/analyze-full-toc")
async def analyze_full_toc(file_id: str, body: AnalyzeFullTocRequest, db: Session = Depends(get_db)):
    """Phase-2 SSE endpoint: request full_toc tree from LLM (sections-only output).

    Called by frontend when Phase-1 ``analyze-toc`` returned ``full_toc_source: 'pending_llm'``.

    Events: ``progress`` (phase, message), ``result`` ({full_toc, preview_expanded}), ``error``.
    """
    _get_temp(file_id)  # validate file still exists

    from app.models.orm import LLMProfileORM
    from app.knowledge.toc_analyzer import (
        TocSection,
        fetch_full_toc_llm,
        full_toc_rows_to_preview,
    )

    profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not profile:
        profile = db.query(LLMProfileORM).first()
    if not profile:
        async def _no_profile():
            yield _doc_sse("error", {"message": "No LLM profile configured.", "error_type": "ModelNotConfiguredError"})
        return StreamingResponse(_no_profile(), media_type="text/event-stream")

    # Reconstruct TocSection list from request body
    sections: list[TocSection] = []
    for s in body.sections:
        if not isinstance(s, dict) or not s.get("title"):
            continue
        sections.append(TocSection(
            title=str(s.get("title", "")),
            page_from=int(s.get("page_from", 1)),
            page_to=s.get("page_to"),
            depth=int(s.get("depth", 1)),
            suggested_chunk_type=s.get("suggested_chunk_type"),
        ))

    toc_text = body.toc_text
    model_name = body.llm_model_name
    model_label = (model_name or "").strip() or (getattr(profile, "model_name", None) or "")

    _log.info(
        "knowledge_sse operation=analyze_full_toc ENTER file_id=%s sections=%s toc_chars=%s model=%s",
        file_id, len(sections), len(toc_text or ""), model_label,
    )

    async def _stream():
        correlation_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        detail_base = {
            "correlation_id": correlation_id,
            "operation": "analyze_full_toc",
            "file_id": file_id,
            "model": model_label,
        }
        yield _doc_sse("progress", {"phase": "queued", "message": "已加入完整目录分析队列", "detail": detail_base})
        yield _doc_sse("progress", {"phase": "llm_request", "message": "正在请求模型生成完整目录树…", "detail": detail_base})
        yield _doc_sse(
            "progress",
            {"phase": "llm_wait", "message": "已发送请求，等待模型响应…", "detail": {**detail_base, "wait_seconds": 0}},
        )
        try:
            q: asyncio.Queue = asyncio.Queue()

            async def _fetch():
                try:
                    t_llm = time.perf_counter()
                    full_toc_local = await fetch_full_toc_llm(toc_text, sections, profile, model_name)
                    llm_ms_local = round((time.perf_counter() - t_llm) * 1000.0, 2)
                    await q.put(("ok", full_toc_local, llm_ms_local))
                except Exception as exc:
                    await q.put(("err", str(exc)))

            asyncio.create_task(_fetch())
            t_llm_start = time.perf_counter()
            full_toc: dict[str, Any] | None = None
            llm_ms = 0.0

            while True:
                if (time.perf_counter() - t_llm_start) >= TOC_LLM_MAX_WAIT_SECONDS:
                    yield _doc_sse(
                        "error",
                        {"message": f"完整目录分析超时（>{int(TOC_LLM_MAX_WAIT_SECONDS)}秒），请重试或换更快模型。"},
                    )
                    return
                remaining = TOC_LLM_MAX_WAIT_SECONDS - (time.perf_counter() - t_llm_start)
                try:
                    item = await asyncio.wait_for(q.get(), timeout=min(10.0, max(0.1, remaining)))
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    wait_sec = int(time.perf_counter() - t_llm_start)
                    yield _doc_sse(
                        "progress",
                        {"phase": "llm_wait", "message": f"等待模型响应中（已约 {wait_sec} 秒）",
                         "detail": {**detail_base, "wait_seconds": wait_sec}},
                    )
                    continue
                if item[0] == "err":
                    yield _doc_sse("error", {"message": item[1]})
                    return
                _, full_toc, llm_ms = item
                break

            total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            if full_toc is None:
                _log.info(
                    "knowledge_sse operation=analyze_full_toc phase=no_result file_id=%s total_ms=%s",
                    file_id, total_ms,
                )
                yield _doc_sse("error", {"message": "模型未能生成有效的完整目录树，请重试。", "error_type": "full_toc_empty"})
                return

            result_body: dict[str, Any] = {"full_toc": full_toc, "full_toc_source": "llm"}
            try:
                pe = full_toc_rows_to_preview(sections, full_toc)
                if pe:
                    result_body["preview_expanded"] = pe
            except Exception as e:
                _log.debug("analyze_full_toc preview_expanded skipped: %s", e, exc_info=True)

            _log.info(
                "knowledge_sse operation=analyze_full_toc phase=complete file_id=%s correlation_id=%s "
                "total_ms=%s llm_ms=%s",
                file_id, correlation_id, total_ms, llm_ms,
            )
            yield _doc_sse("progress", {
                "phase": "complete",
                "message": "完整目录树生成完成",
                "detail": {**detail_base, "elapsed_ms": total_ms},
            })
            yield _doc_sse("result", result_body)

        except Exception as exc:
            total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            _log.exception(
                "knowledge_sse operation=analyze_full_toc phase=error file_id=%s total_ms=%s",
                file_id, total_ms,
            )
            yield _doc_sse("error", {"message": str(exc)})

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── 3c. CHM: LLM suggest chunk_type (shallow rows + depth inherit) ───────────

class ClassifyChmRequest(BaseModel):
    llm_profile_id: str
    llm_model_name: str = ""
    max_classify_depth: int = 1  # LLM 只标 depth ≤ 此值（默认 1=最外大节，子树继承；要标到第 2 层可传 2）


@router3.post("/preview/{file_id}/classify-chm-sections")
async def classify_chm_sections(file_id: str, body: ClassifyChmRequest, db: Session = Depends(get_db)):
    """Re-read CHM from temp storage, run batched LLM on shallow TOC rows, return sections with types.

    SSE: ``progress``, ``partial`` (sections snapshot per batch), ``result``, ``error``.
    """
    entry = _get_temp(file_id)
    if entry["ext"] != ".chm":
        raise HTTPException(status_code=400, detail="Only .chm preview uploads can use this endpoint")
    if not body.llm_model_name.strip():
        raise HTTPException(status_code=422, detail="llm_model_name is required for CHM section classification")
    file_path = Path(entry["path"])

    from app.knowledge.toc_extractor import extract_chm_toc_sync
    from app.knowledge.toc_analyzer import chm_structure_to_sections, iter_assign_chm_section_chunk_types
    from app.models.orm import LLMProfileORM

    try:
        raw_items = await asyncio.to_thread(extract_chm_toc_sync, file_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"CHM TOC extraction failed: {e}")

    sections_orm = chm_structure_to_sections(raw_items)
    profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not profile:
        profile = db.query(LLMProfileORM).first()
    if not profile:
        async def _no_profile():
            yield _doc_sse("error", {"message": "No LLM profile configured.", "error_type": "ModelNotConfiguredError"})

        return StreamingResponse(_no_profile(), media_type="text/event-stream")

    model_label = body.llm_model_name.strip()
    sections_in = len(sections_orm)
    _mcd = body.max_classify_depth
    _n_label = sum(1 for s in sections_orm if s.depth <= _mcd)
    _n_b = (_n_label + CHM_CLASSIFY_BATCH - 1) // CHM_CLASSIFY_BATCH if _n_label else 0
    chm_classify_stream_max_s = min(
        8 * 3600.0,
        float(max(1, _n_b)) * TOC_LLM_MAX_WAIT_SECONDS + 120.0,
    )

    async def _stream():
        correlation_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        tq: asyncio.Queue = asyncio.Queue()

        async def _pump_chm() -> None:
            try:
                if not sections_orm:
                    await tq.put(("done", []))
                    return
                last_rows: list[dict[str, Any]] = []
                async for bi, bt, br, merged in iter_assign_chm_section_chunk_types(
                    sections_orm,
                    profile,
                    body.llm_model_name,
                    max_classify_depth=body.max_classify_depth,
                ):
                    last_rows = _toc_sections_payload(merged)
                    prog: dict[str, Any] = {
                        "phase": "chm_batch",
                        "message": f"目录类型标注：第 {bi + 1}/{bt} 批",
                        "detail": {
                            "correlation_id": correlation_id,
                            "batch_index": bi,
                            "batch_total": bt,
                            "batch_row_count": br,
                            "sections_in": sections_in,
                            "sections_out": len(last_rows),
                            "model": model_label,
                            "operation": "classify_chm",
                            "file_id": file_id,
                        },
                    }
                    await tq.put(("batch", prog, {"sections": last_rows}))
                await tq.put(("done", last_rows))
            except Exception as exc:
                await tq.put(("error", str(exc)))

        asyncio.create_task(_pump_chm())
        detail_base = {
            "correlation_id": correlation_id,
            "operation": "classify_chm",
            "file_id": file_id,
            "model": model_label,
            "provider_kind": (profile.provider_type or "").strip().lower(),
            "sections_in": sections_in,
        }
        yield _doc_sse(
            "progress",
            {"phase": "queued", "message": "已开始 CHM 目录类型分析", "detail": detail_base},
        )
        yield _doc_sse(
            "progress",
            {
                "phase": "llm_wait",
                "message": "已排队，准备调用模型…",
                "detail": {**detail_base, "wait_seconds": 0},
            },
        )
        t_stream_start = time.perf_counter()
        while (time.perf_counter() - t_stream_start) < chm_classify_stream_max_s:
            try:
                _rem = chm_classify_stream_max_s - (time.perf_counter() - t_stream_start)
                item = await asyncio.wait_for(tq.get(), timeout=min(10.0, max(0.1, _rem)))
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                wall = int(time.perf_counter() - t_stream_start)
                yield _doc_sse(
                    "progress",
                    {
                        "phase": "llm_wait",
                        "message": f"等待模型响应当中（已约 {wall} 秒）",
                        "detail": {**detail_base, "wait_seconds": wall},
                    },
                )
                continue
            if item[0] == "batch":
                _, prog, partial_body = item
                _log.info(
                    "knowledge_sse operation=classify_chm phase=chm_batch file_id=%s correlation_id=%s detail=%s",
                    file_id,
                    correlation_id,
                    json.dumps(prog.get("detail", {}), ensure_ascii=False) if isinstance(prog, dict) else "",
                )
                yield _doc_sse("progress", prog)
                yield _doc_sse("partial", partial_body)
                continue
            if item[0] == "done":
                rows = item[1]
                total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                _log.info(
                    "knowledge_sse operation=classify_chm phase=complete file_id=%s correlation_id=%s total_ms=%s "
                    "sections_out=%s",
                    file_id,
                    correlation_id,
                    total_ms,
                    len(rows),
                )
                yield _doc_sse(
                    "progress",
                    {
                        "phase": "complete",
                        "message": "CHM 目录类型标注完成",
                        "detail": {**detail_base, "total_ms": total_ms, "sections_out": len(rows)},
                    },
                )
                yield _doc_sse("result", {"sections": rows})
                return
            if item[0] == "error":
                total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                _log.info(
                    "knowledge_sse operation=classify_chm phase=error file_id=%s correlation_id=%s total_ms=%s message=%s",
                    file_id,
                    correlation_id,
                    total_ms,
                    str(item[1])[:300],
                )
                yield _doc_sse("error", {"message": item[1]})
                return

        _log.warning(
            "knowledge_sse operation=classify_chm phase=stream_exceeded file_id=%s max_wall_s=%s n_batches=%s",
            file_id,
            int(chm_classify_stream_max_s),
            _n_b,
        )
        yield _doc_sse(
            "error",
            {
                "message": (
                    f"CHM 分类等待超时：本次连接墙钟上限约 {int(chm_classify_stream_max_s)} 秒（与批次数相关）。"
                    " 可换更快模型、减小目录或调低 max_classify_depth。"
                ),
            },
        )

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── 4. Ingest with confirmed TOC mapping ─────────────────────────────────────

class TocMappingItem(BaseModel):
    title: str
    page_from: int
    page_to: int
    chunk_type: str | None = None  # 前端可能传 null；下游统一为字符串

    @field_validator("chunk_type", mode="before")
    @classmethod
    def _chunk_type_to_str(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v)


class IngestConfirmedRequest(BaseModel):
    file_id: str
    embedding_profile_id: str
    page_offset: int = 0
    toc_mapping: list[TocMappingItem] = []


router4 = APIRouter(prefix="/knowledge/libraries", tags=["knowledge-toc-preview"])


@router4.post("/{library_id}/documents/ingest-confirmed", status_code=202)
async def ingest_confirmed(
    library_id: str,
    body: IngestConfirmedRequest,
    db: Session = Depends(get_db),
):
    """Start the real ingest with a user-confirmed TOC section→chunk_type mapping."""
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    entry = _get_temp(body.file_id)
    file_path = Path(entry["path"])
    file_ext = entry["ext"]
    filename = entry["filename"]

    embedding_profile = db.get(_EmbeddingProfileORM, body.embedding_profile_id)
    if not embedding_profile:
        raise HTTPException(
            status_code=422,
            detail={"error": f"Embedding profile '{body.embedding_profile_id}' not found", "error_type": "ModelNotConfiguredError"},
        )

    doc = KnowledgeDocumentORM(
        library_id=library_id,
        filename=filename,
        original_path="",
        mime_type={"pdf": "application/pdf", "chm": "application/vnd.ms-htmlhelp"}.get(file_ext.lstrip("."), "application/octet-stream"),
        parse_status="pending",
    )
    db.add(doc)
    db.flush()
    task = IngestTaskORM(document_id=doc.id, status="pending", current_step=0, total_steps=8)
    db.add(task)
    db.commit()
    db.refresh(doc)
    db.refresh(task)

    embedding_snapshot = {
        "profile_id": embedding_profile.id,
        "provider_type": embedding_profile.provider_type,
        "model_name": embedding_profile.model_name,
        "dimensions": embedding_profile.dimensions,
    }

    toc_mapping = [
        {"title": m.title, "page_from": m.page_from, "page_to": m.page_to, "chunk_type": m.chunk_type or ""}
        for m in body.toc_mapping
    ]

    # Remove file from temp store before background task takes ownership
    _TEMP_FILES.pop(body.file_id, None)

    asyncio.create_task(
        _run_ingest_background(
            document_id=doc.id,
            library_id=library_id,
            task_id=task.id,
            tmp_path=file_path,
            filename=filename,
            file_ext=file_ext,
            embedding_profile_id=embedding_profile.id,
            embedding_snapshot=embedding_snapshot,
            default_chunk_type="",
            page_offset=body.page_offset,
            toc_mapping=toc_mapping,
        )
    )

    return {"document_id": doc.id, "task_id": task.id}

