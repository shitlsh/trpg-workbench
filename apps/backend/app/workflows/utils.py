"""Shared workflow utilities – step persistence and workspace context loading."""
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.orm import WorkflowStateORM, WorkspaceORM, AssetORM


def _now():
    return datetime.now(timezone.utc)


def create_workflow(db: Session, workspace_id: str, wf_type: str,
                    total_steps: int, input_snapshot: dict) -> WorkflowStateORM:
    wf = WorkflowStateORM(
        workspace_id=workspace_id,
        type=wf_type,
        status="running",
        current_step=0,
        total_steps=total_steps,
        input_snapshot=json.dumps(input_snapshot, ensure_ascii=False),
        step_results="[]",
    )
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return wf


def update_step(db: Session, wf: WorkflowStateORM, step: int, step_name: str,
                step_status: str, summary: str | None = None, error: str | None = None):
    try:
        results = json.loads(wf.step_results or "[]")
    except (json.JSONDecodeError, TypeError):
        results = []
    # Update or append
    existing = next((r for r in results if r["step"] == step), None)
    entry = {"step": step, "name": step_name, "status": step_status,
             "summary": summary, "error": error}
    if existing:
        results[results.index(existing)] = entry
    else:
        results.append(entry)

    wf.step_results = json.dumps(results, ensure_ascii=False)
    wf.current_step = step
    wf.updated_at = _now()
    db.commit()


def complete_workflow(db: Session, wf: WorkflowStateORM, summary: str):
    wf.status = "completed"
    wf.result_summary = summary
    wf.updated_at = _now()
    db.commit()


def fail_workflow(db: Session, wf: WorkflowStateORM, error: str):
    wf.status = "failed"
    wf.error_message = error
    wf.updated_at = _now()
    db.commit()


def pause_workflow(db: Session, wf: WorkflowStateORM):
    wf.status = "paused"
    wf.updated_at = _now()
    db.commit()


def get_workspace_context(db: Session, workspace_id: str) -> dict:
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        return {}
    assets = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.status != "deleted",
    ).all()
    return {
        "workspace_name": ws.name,
        "rule_set": ws.rule_set_id,
        "existing_assets": [
            {"type": a.type, "name": a.name, "slug": a.slug}
            for a in assets
        ],
    }
