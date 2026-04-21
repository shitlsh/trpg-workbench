from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import (
    KnowledgeLibraryORM, KnowledgeDocumentORM, WorkspaceLibraryBindingORM, WorkspaceORM
)
from app.models.schemas import (
    WorkspaceLibraryBindingSchema, WorkspaceLibraryBindingCreate,
    SearchRequest, CitationSchema,
)

router = APIRouter(tags=["knowledge"])


# ── Library bindings ──────────────────────────────────────────────────────────

@router.post("/workspaces/{workspace_id}/library-bindings", response_model=WorkspaceLibraryBindingSchema, status_code=201)
def bind_library(workspace_id: str, body: WorkspaceLibraryBindingCreate, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    lib = db.get(KnowledgeLibraryORM, body.library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    # Check duplicate
    existing = db.query(WorkspaceLibraryBindingORM).filter(
        WorkspaceLibraryBindingORM.workspace_id == workspace_id,
        WorkspaceLibraryBindingORM.library_id == body.library_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Library already bound to this workspace")
    binding = WorkspaceLibraryBindingORM(workspace_id=workspace_id, **body.model_dump())
    db.add(binding)
    db.commit()
    db.refresh(binding)
    return binding


@router.get("/workspaces/{workspace_id}/library-bindings", response_model=list[WorkspaceLibraryBindingSchema])
def list_bindings(workspace_id: str, db: Session = Depends(get_db)):
    return (
        db.query(WorkspaceLibraryBindingORM)
        .filter(WorkspaceLibraryBindingORM.workspace_id == workspace_id)
        .order_by(WorkspaceLibraryBindingORM.priority.desc())
        .all()
    )


@router.delete("/workspaces/{workspace_id}/library-bindings/{binding_id}", status_code=204)
def unbind_library(workspace_id: str, binding_id: str, db: Session = Depends(get_db)):
    binding = db.query(WorkspaceLibraryBindingORM).filter(
        WorkspaceLibraryBindingORM.id == binding_id,
        WorkspaceLibraryBindingORM.workspace_id == workspace_id,
    ).first()
    if not binding:
        raise HTTPException(status_code=404, detail="Binding not found")
    db.delete(binding)
    db.commit()


# ── Search ────────────────────────────────────────────────────────────────────

@router.post("/knowledge/search", response_model=list[CitationSchema])
async def search_knowledge(body: SearchRequest, db: Session = Depends(get_db)):
    if not body.library_ids:
        raise HTTPException(status_code=400, detail="library_ids is required")
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    # Build document map for citation enrichment
    docs = (
        db.query(KnowledgeDocumentORM)
        .filter(KnowledgeDocumentORM.library_id.in_(body.library_ids))
        .all()
    )
    doc_map = {d.id: {"filename": d.filename} for d in docs}

    from app.knowledge.retriever import retrieve
    citations = await retrieve(
        query=body.query,
        library_ids=body.library_ids,
        top_k=body.top_k,
        document_map=doc_map,
    )
    return [c.to_dict() for c in citations]


# ── Reindex ───────────────────────────────────────────────────────────────────

@router.post("/knowledge/libraries/{library_id}/reindex", status_code=202)
async def reindex_library(library_id: str, db: Session = Depends(get_db)):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    # Placeholder: full reindex would re-embed from chunks.jsonl
    return {"message": "Reindex scheduled (not yet implemented)"}
