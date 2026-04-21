from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import (
    KnowledgeLibraryORM, KnowledgeDocumentORM, WorkspaceLibraryBindingORM, WorkspaceORM
)
from app.models.schemas import (
    WorkspaceLibraryBindingSchema, WorkspaceLibraryBindingCreate,
    SearchRequest, CitationSchema,
)
from app.services.model_routing import LibraryNotIndexedError, get_embedding_for_query, ModelNotConfiguredError

router = APIRouter(tags=["knowledge"])


class SearchResponse(BaseModel):
    results: list[CitationSchema]
    warnings: list[str] = []
    error: str | None = None


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

@router.post("/knowledge/search", response_model=SearchResponse)
async def search_knowledge(body: SearchRequest, db: Session = Depends(get_db)):
    if not body.library_ids:
        raise HTTPException(status_code=400, detail="library_ids is required")
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    # Check that all libraries have been indexed
    for lib_id in body.library_ids:
        lib = db.get(KnowledgeLibraryORM, lib_id)
        if not lib or not lib.embedding_model_snapshot:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": f"Library {lib_id} has not been indexed yet. Please ingest documents first.",
                    "library_id": lib_id,
                }
            )

    # Build document map for citation enrichment
    docs = (
        db.query(KnowledgeDocumentORM)
        .filter(KnowledgeDocumentORM.library_id.in_(body.library_ids))
        .all()
    )
    doc_map = {d.id: {"filename": d.filename} for d in docs}

    # Resolve embedder from the first library's snapshot profile
    try:
        embedding_profile = get_embedding_for_query(body.library_ids[0], db)
    except (LibraryNotIndexedError, ModelNotConfiguredError) as exc:
        raise HTTPException(status_code=422, detail={"error": exc.message})

    from app.agents.model_adapter import embedding_from_profile
    embedder = embedding_from_profile(embedding_profile)

    from app.knowledge.retriever import retrieve
    try:
        citations = await retrieve(
            query=body.query,
            library_ids=body.library_ids,
            top_k=body.top_k,
            embedder=embedder,
            document_map=doc_map,
        )
        return SearchResponse(results=[c.to_dict() for c in citations])
    except LibraryNotIndexedError as exc:
        raise HTTPException(status_code=422, detail={"error": exc.message, "library_id": exc.library_id})
    except Exception as exc:
        return SearchResponse(results=[], warnings=[], error=str(exc))


# ── Reindex ───────────────────────────────────────────────────────────────────

@router.post("/knowledge/libraries/{library_id}/reindex", status_code=202)
async def reindex_library(library_id: str, db: Session = Depends(get_db)):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    # Placeholder: full reindex would re-embed from chunks.jsonl
    return {"message": "Reindex scheduled (not yet implemented)"}
