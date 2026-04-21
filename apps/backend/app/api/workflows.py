"""Workflow CRUD + control API."""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import WorkflowStateORM
from app.models.schemas import WorkflowStateSchema, StartWorkflowRequest
from app.workflows.create_module import run_create_module, resume_create_module
from app.workflows.modify_asset import run_modify_asset, apply_modify_asset_patches
from app.workflows.utils import get_workspace_context

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _get_wf(wf_id: str, db: Session) -> WorkflowStateORM:
    wf = db.get(WorkflowStateORM, wf_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


@router.post("", response_model=WorkflowStateSchema, status_code=201)
async def start_workflow(body: StartWorkflowRequest, background_tasks: BackgroundTasks,
                         db: Session = Depends(get_db)):
    user_intent = body.input.get("user_intent", "")
    affected_ids = body.input.get("affected_asset_ids", [])

    if body.type == "create_module":
        wf = await run_create_module(db, body.workspace_id, user_intent)
    elif body.type == "modify_asset":
        wf = await run_modify_asset(db, body.workspace_id, user_intent, affected_ids)
    elif body.type == "rules_review":
        # Lightweight: Director routes directly, no long workflow
        from app.workflows.utils import create_workflow, update_step, complete_workflow
        from app.agents.rules import run_rules_agent
        wf = create_workflow(db, body.workspace_id, "rules_review", 3,
                             {"user_intent": user_intent})
        update_step(db, wf, 1, "检索规则知识库", "completed", summary="规则检索完成")
        result = run_rules_agent(user_intent, [])
        update_step(db, wf, 2, "整理建议", "completed",
                    summary=json.dumps(result, ensure_ascii=False))
        update_step(db, wf, 3, "完成", "completed")
        complete_workflow(db, wf, result.get("summary", "规则审查完成"))
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
        wf = await resume_create_module(db, wf)
    elif wf.type == "modify_asset":
        wf = await apply_modify_asset_patches(db, wf)
    else:
        raise HTTPException(status_code=400, detail=f"Cannot confirm workflow type: {wf.type}")

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


@router.get("/{wf_id}/patches", response_model=list[dict])
def get_workflow_patches(wf_id: str, db: Session = Depends(get_db)):
    """Return the patch proposals stored in step 5 or 6 of a modify_asset workflow."""
    wf = _get_wf(wf_id, db)
    step_results = json.loads(wf.step_results)
    # Find the step with patches (step 5 or 6 for modify_asset, step 10 for create_module)
    for step_num in [6, 5, 10]:
        step = next((s for s in step_results if s["step"] == step_num and s.get("summary")), None)
        if step:
            try:
                return json.loads(step["summary"])
            except Exception:
                pass
    return []
