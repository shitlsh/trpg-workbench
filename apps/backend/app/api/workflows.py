"""Workflow CRUD + control API."""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import WorkflowStateORM, WorkspaceLibraryBindingORM, KnowledgeDocumentORM
from app.models.schemas import WorkflowStateSchema, StartWorkflowRequest, ClarifyRequest
from app.workflows.create_module import run_create_module, resume_create_module
from app.workflows.modify_asset import run_modify_asset, apply_modify_asset_patches, resume_modify_asset
from app.workflows.rules_review import run_rules_review
from app.workflows.utils import get_workspace_context
from app.services.model_routing import get_llm_for_task, get_reranker_for_workspace, ModelNotConfiguredError
from app.agents.model_adapter import model_from_profile

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _get_wf(wf_id: str, db: Session) -> WorkflowStateORM:
    wf = db.get(WorkflowStateORM, wf_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


def _resolve_model(workspace_id: str, task_type: str, db: Session):
    """Resolve LLM model for the given task, raising 422 if not configured."""
    try:
        profile = get_llm_for_task(workspace_id, task_type, db)
        return model_from_profile(profile)
    except ModelNotConfiguredError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": exc.message, "error_type": "ModelNotConfiguredError"},
        )


async def _build_knowledge_retriever(workspace_id: str, task_type: str, db: Session):
    """
    Build a knowledge retriever function for the given workspace + task_type.
    Integrates optional rerank if workspace has rerank enabled for this task_type.
    Returns None if no libraries are bound to the workspace.
    """
    from app.models.orm import WorkspaceORM
    from app.services.model_routing import get_embedding_for_query, LibraryNotIndexedError

    bindings = (
        db.query(WorkspaceLibraryBindingORM)
        .filter(
            WorkspaceLibraryBindingORM.workspace_id == workspace_id,
            WorkspaceLibraryBindingORM.enabled == True,
        )
        .order_by(WorkspaceLibraryBindingORM.priority.desc())
        .all()
    )
    if not bindings:
        return None

    library_ids = [b.library_id for b in bindings]

    # Resolve rerank profile (may be None — rerank is optional)
    workspace = db.get(WorkspaceORM, workspace_id)
    rerank_profile = get_reranker_for_workspace(workspace_id, task_type, db)
    rerank_top_n = workspace.rerank_top_n if workspace else 20
    rerank_top_k = workspace.rerank_top_k if workspace else 5

    # Build document map
    docs = db.query(KnowledgeDocumentORM).filter(
        KnowledgeDocumentORM.library_id.in_(library_ids)
    ).all()
    doc_map = {d.id: {"filename": d.filename} for d in docs}

    # Resolve embedder from the first indexed library
    try:
        embedding_profile = get_embedding_for_query(library_ids[0], db)
    except (LibraryNotIndexedError, ModelNotConfiguredError):
        return None  # No indexed library — retrieval will be skipped silently

    from app.agents.model_adapter import embedding_from_profile
    embedder = embedding_from_profile(embedding_profile)

    # Capture rerank state for closure
    rp = rerank_profile
    rp_top_n = rerank_top_n
    rp_top_k = rerank_top_k

    async def retriever(query: str, _workspace_id: str):
        from app.knowledge.retriever import retrieve
        retrieve_k = rp_top_n if rp else rp_top_k

        citations = await retrieve(
            query=query,
            library_ids=library_ids,
            top_k=retrieve_k,
            embedder=embedder,
            document_map=doc_map,
        )

        if rp and citations:
            from app.utils.secrets import decrypt_secret as decrypt
            from app.services.rerank_adapter import rerank as do_rerank
            api_key = decrypt(rp.api_key_encrypted) if rp.api_key_encrypted else None
            texts = [c.content for c in citations]
            try:
                reranked = do_rerank(
                    query, texts,
                    provider_type=rp.provider_type,
                    model_name=rp.model_name,
                    api_key=api_key,
                    base_url=rp.base_url,
                    top_n=rp_top_k,
                )
                # Rebuild citations in reranked order
                return [citations[r.index] for r in reranked]
            except Exception:
                # Rerank failed — silently fall back to vector results
                return citations[:rp_top_k]

        return citations[:rp_top_k]

    return retriever


@router.post("", response_model=WorkflowStateSchema, status_code=201)
async def start_workflow(body: StartWorkflowRequest, background_tasks: BackgroundTasks,
                         db: Session = Depends(get_db)):
    user_intent = body.input.get("user_intent", "")
    affected_ids = body.input.get("affected_asset_ids", [])

    if body.type == "create_module":
        model = _resolve_model(body.workspace_id, "create_module", db)
        wf = await run_create_module(db, body.workspace_id, user_intent, model=model)
    elif body.type == "modify_asset":
        model = _resolve_model(body.workspace_id, "modify_asset", db)
        wf = await run_modify_asset(db, body.workspace_id, user_intent, affected_ids, model=model)
    elif body.type == "rules_review":
        asset_ids = body.input.get("asset_ids", [])
        model = _resolve_model(body.workspace_id, "rules_review", db)
        knowledge_retriever = await _build_knowledge_retriever(body.workspace_id, "rules_review", db)
        wf = await run_rules_review(db, body.workspace_id, user_intent, asset_ids, model=model,
                                     knowledge_retriever=knowledge_retriever)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown workflow type: {body.type}")

    db.refresh(wf)
    return wf


@router.get("", response_model=list[WorkflowStateSchema])
def list_workflows(workspace_id: str, db: Session = Depends(get_db)):
    return (
        db.query(WorkflowStateORM)
        .filter(WorkflowStateORM.workspace_id == workspace_id)
        .order_by(WorkflowStateORM.created_at.desc())
        .limit(50)
        .all()
    )


@router.get("/{wf_id}", response_model=WorkflowStateSchema)
def get_workflow(wf_id: str, db: Session = Depends(get_db)):
    return _get_wf(wf_id, db)


@router.post("/{wf_id}/confirm", response_model=WorkflowStateSchema)
async def confirm_workflow(wf_id: str, db: Session = Depends(get_db)):
    wf = _get_wf(wf_id, db)
    if wf.status != "paused":
        raise HTTPException(status_code=400, detail="Workflow is not paused")

    if wf.type == "create_module":
        model = _resolve_model(wf.workspace_id, "create_module", db)
        wf = await resume_create_module(db, wf, model=model)
    elif wf.type == "modify_asset":
        wf = await apply_modify_asset_patches(db, wf)
    else:
        raise HTTPException(status_code=400, detail=f"Cannot confirm workflow type: {wf.type}")

    db.refresh(wf)
    return wf


@router.post("/{wf_id}/clarify", response_model=WorkflowStateSchema)
async def clarify_workflow(wf_id: str, body: ClarifyRequest, db: Session = Depends(get_db)):
    """Accept clarification answers and resume the workflow."""
    wf = _get_wf(wf_id, db)
    if wf.status != "waiting_for_clarification":
        raise HTTPException(status_code=400, detail="Workflow is not waiting for clarification")

    import json
    wf.clarification_answers = json.dumps(body.answers, ensure_ascii=False)
    wf.status = "executing"
    wf.updated_at = __import__('datetime').datetime.now(__import__('datetime').timezone.utc)
    db.commit()

    if wf.type == "create_module":
        model = _resolve_model(wf.workspace_id, "create_module", db)
        wf = await resume_create_module(db, wf, model=model)
    elif wf.type == "modify_asset":
        model = _resolve_model(wf.workspace_id, "modify_asset", db)
        wf = await resume_modify_asset(db, wf, model=model)
    else:
        raise HTTPException(status_code=400, detail=f"Cannot clarify workflow type: {wf.type}")

    db.refresh(wf)
    return wf


@router.post("/{wf_id}/cancel", response_model=WorkflowStateSchema)
def cancel_workflow(wf_id: str, db: Session = Depends(get_db)):
    wf = _get_wf(wf_id, db)
    wf.status = "failed"
    wf.error_message = "用户取消"
    db.commit()
    db.refresh(wf)
    return wf


@router.get("/{wf_id}/rules-suggestions", response_model=dict)
def get_rules_suggestions(wf_id: str, db: Session = Depends(get_db)):
    """Return the rules suggestions from a completed rules_review workflow."""
    wf = _get_wf(wf_id, db)
    step_results = json.loads(wf.step_results)
    step3 = next((s for s in step_results if s["step"] == 3 and s.get("summary")), None)
    if step3:
        try:
            return json.loads(step3["summary"])
        except Exception:
            pass
    return {"suggestions": [], "summary": wf.result_summary or ""}


@router.get("/{wf_id}/patches")
def get_workflow_patches(wf_id: str, db: Session = Depends(get_db)):
    """Return the patch proposals stored in step 5 or 6 of a modify_asset workflow."""
    wf = _get_wf(wf_id, db)
    step_results = json.loads(wf.step_results)
    # Find the step with patches (step 5 or 6 for modify_asset, step 11 for create_module)
    for step_num in [6, 5, 11, 10]:
        step = next((s for s in step_results if s["step"] == step_num and s.get("summary")), None)
        if step:
            try:
                return json.loads(step["summary"])
            except Exception:
                pass
    return []
