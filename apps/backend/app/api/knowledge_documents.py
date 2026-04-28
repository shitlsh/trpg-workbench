import asyncio
import json
import logging
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

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

    embedding_snapshot = {
        "profile_id": profile.id,
        "provider_type": profile.provider_type,
        "model_name": profile.model_name,
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
    doc.parse_status = "running"
    db.commit()
    db.refresh(task)

    asyncio.create_task(
        _run_reindex_background(
            document_id=document_id,
            library_id=doc.library_id,
            task_id=task.id,
            embedding_profile_id=profile.id,
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
    embedding_snapshot: dict,
):
    from app.storage.database import get_session_factory
    from app.agents.model_adapter import embedding_from_profile
    from app.knowledge.vector_index import upsert_chunks
    from app.utils.paths import get_data_dir

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
        embedder = embedding_from_profile(profile)
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
            doc = db.get(KnowledgeDocumentORM, document_id)
            if doc:
                doc.parse_status = "failed"
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


# ── 3. Analyze TOC with LLM ───────────────────────────────────────────────────

class AnalyzeTocRequest(BaseModel):
    toc_text: str
    llm_profile_id: str
    llm_model_name: str = ""


@router3.post("/preview/{file_id}/analyze-toc")
async def analyze_toc(file_id: str, body: AnalyzeTocRequest, db: Session = Depends(get_db)):
    """Parse TOC text via SSE stream with keepalive comments.

    Yields:
      `: keepalive`       — every 10s while the LLM is running
      `event: result`     — on success, data = {sections: [...]}
      `event: error`      — on failure, data = {message, error_type?}
    """
    _get_temp(file_id)  # validate file still exists

    from app.models.orm import LLMProfileORM
    from app.knowledge.toc_analyzer import analyze_toc as _analyze, TocNotRecognizedError

    profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not profile:
        profile = db.query(LLMProfileORM).first()
    if not profile:
        async def _no_profile():
            yield _doc_sse("error", {"message": "No LLM profile configured.", "error_type": "ModelNotConfiguredError"})
        return StreamingResponse(_no_profile(), media_type="text/event-stream")

    toc_text = body.toc_text
    model_name = body.llm_model_name

    def _run() -> list[dict]:
        result = _analyze(toc_text, profile, model_name)
        return [
            {"title": s.title, "page_from": s.page_from, "page_to": s.page_to,
             "depth": s.depth, "suggested_chunk_type": s.suggested_chunk_type}
            for s in result.sections
        ]

    async def _stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce():
            try:
                sections = await asyncio.to_thread(_run)
                await queue.put(("result", sections))
            except TocNotRecognizedError as exc:
                await queue.put(("toc_error", exc.reason))
            except Exception as exc:
                await queue.put(("error", str(exc)))

        asyncio.create_task(_produce())

        deadline = 300
        elapsed = 0
        while elapsed < deadline:
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=10.0)
                if kind == "result":
                    yield _doc_sse("result", {"sections": payload})
                elif kind == "toc_error":
                    yield _doc_sse("error", {"message": payload, "error_type": "toc_not_recognized"})
                else:
                    yield _doc_sse("error", {"message": payload})
                return
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                elapsed += 10

        yield _doc_sse("error", {"message": "TOC analysis timed out (300s). Try a faster model."})

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── 3b. CHM: LLM suggest chunk_type (shallow rows + depth inherit) ───────────

class ClassifyChmRequest(BaseModel):
    llm_profile_id: str
    llm_model_name: str = ""
    max_classify_depth: int = 2  # only LLM-label depth ≤ this; deeper rows inherit in tree order


@router3.post("/preview/{file_id}/classify-chm-sections")
async def classify_chm_sections(file_id: str, body: ClassifyChmRequest, db: Session = Depends(get_db)):
    """Re-read CHM from temp storage, run batched LLM on shallow TOC rows, return sections with types.

    SSE: `event: result` with `{sections: [...]}` (same shape as detect-toc for CHM).
    """
    entry = _get_temp(file_id)
    if entry["ext"] != ".chm":
        raise HTTPException(status_code=400, detail="Only .chm preview uploads can use this endpoint")
    file_path = Path(entry["path"])

    from app.knowledge.toc_extractor import extract_chm_toc_sync
    from app.knowledge.toc_analyzer import chm_structure_to_sections, assign_chm_section_chunk_types
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

    def _run():
        return assign_chm_section_chunk_types(
            sections_orm,
            profile,
            body.llm_model_name,
            max_classify_depth=body.max_classify_depth,
        )

    async def _stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce():
            try:
                done = await asyncio.to_thread(_run)
                rows = [
                    {
                        "title": s.title,
                        "page_from": s.page_from,
                        "page_to": s.page_to,
                        "depth": s.depth,
                        "suggested_chunk_type": s.suggested_chunk_type,
                    }
                    for s in done
                ]
                await queue.put(("result", rows))
            except Exception as exc:
                await queue.put(("error", str(exc)))

        asyncio.create_task(_produce())

        deadline = 600
        elapsed = 0
        while elapsed < deadline:
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=10.0)
                if kind == "result":
                    yield _doc_sse("result", {"sections": payload})
                else:
                    yield _doc_sse("error", {"message": payload})
                return
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                elapsed += 10

        yield _doc_sse("error", {"message": "CHM classification timed out (600s). Try a faster model or lower max_classify_depth."})

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

