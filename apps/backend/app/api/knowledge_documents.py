import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import KnowledgeDocumentORM, KnowledgeLibraryORM, IngestTaskORM
from app.models.schemas import KnowledgeDocumentSchema, IngestTaskSchema

router = APIRouter(prefix="/knowledge/libraries", tags=["knowledge-documents"])


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
    db: Session = Depends(get_db),
):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Create document record
    doc = KnowledgeDocumentORM(
        library_id=library_id,
        filename=file.filename,
        original_path="",  # will be set after save
        mime_type="application/pdf",
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
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    tmp.write(content)
    tmp.close()
    tmp_path = Path(tmp.name)

    # Launch ingest in background (fire-and-forget)
    asyncio.create_task(
        _run_ingest_background(
            document_id=doc.id,
            library_id=library_id,
            task_id=task.id,
            tmp_path=tmp_path,
            filename=file.filename,
        )
    )

    return {"document_id": doc.id, "task_id": task.id}


async def _run_ingest_background(
    document_id: str,
    library_id: str,
    task_id: str,
    tmp_path: Path,
    filename: str,
):
    from app.knowledge.pdf_ingest import run_ingest
    from app.storage.database import get_session_factory

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
    finally:
        db.close()

    try:
        result = await run_ingest(
            document_id=document_id,
            library_id=library_id,
            tmp_file_path=tmp_path,
            original_filename=filename,
            progress_callback=progress_callback,
        )
        db = SessionLocal()
        try:
            doc = db.get(KnowledgeDocumentORM, document_id)
            if doc:
                doc.parse_status = result["parse_status"]
                doc.page_count = result.get("page_count")
                doc.chunk_count = result.get("chunk_count")
                doc.original_path = result.get("manifest_path", "")
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
