"""Shared workflow utilities – step persistence and workspace context loading."""
import json
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy.orm import Session

try:
    import frontmatter as _frontmatter
    _HAS_FRONTMATTER = True
except ImportError:
    _HAS_FRONTMATTER = False

from app.models.orm import (
    WorkflowStateORM, WorkspaceORM, AssetORM,
    KnowledgeLibraryORM, WorkspaceLibraryBindingORM,
    PromptProfileORM, CustomAssetTypeConfigORM,
)


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
                step_status: str, summary: str | None = None, error: str | None = None,
                detail: str | None = None):
    try:
        results = json.loads(wf.step_results or "[]")
    except (json.JSONDecodeError, TypeError):
        results = []
    # Update or append; never regress a completed step back to a non-terminal status
    existing = next((r for r in results if r["step"] == step), None)
    entry = {"step": step, "name": step_name, "status": step_status,
             "summary": summary, "error": error, "detail": detail}
    if existing:
        # Protect completed steps: only allow overwriting with another terminal status
        if existing.get("status") == "completed" and step_status not in ("completed", "failed"):
            pass  # Skip regression
        else:
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


def pause_for_clarification(db: Session, wf: WorkflowStateORM, clarification_questions: list):
    wf.status = "waiting_for_clarification"
    wf.clarification_questions = json.dumps(clarification_questions, ensure_ascii=False)
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

    # style_prompt: from the PromptProfile bound to the workspace's rule set
    style_prompt = None
    if ws.rule_set_id:
        pp = db.query(PromptProfileORM).filter_by(rule_set_id=ws.rule_set_id).first()
        if pp:
            style_prompt = pp.system_prompt

    # library_ids: rule set libraries (via FK) + workspace extra bindings
    rs_libs = [
        lib.id
        for lib in db.query(KnowledgeLibraryORM).filter_by(rule_set_id=ws.rule_set_id).all()
    ] if ws.rule_set_id else []
    ws_libs = [
        b.library_id
        for b in db.query(WorkspaceLibraryBindingORM).filter_by(
            workspace_id=workspace_id, enabled=True
        ).all()
    ]
    library_ids = list(dict.fromkeys(rs_libs + ws_libs))  # deduplicate, preserve order

    # M16: custom asset types registered for this rule set
    custom_asset_types = []
    if ws.rule_set_id:
        custom_asset_types = [
            {"type_key": c.type_key, "label": c.label, "icon": c.icon}
            for c in (
                db.query(CustomAssetTypeConfigORM)
                .filter_by(rule_set_id=ws.rule_set_id)
                .order_by(CustomAssetTypeConfigORM.sort_order, CustomAssetTypeConfigORM.created_at)
                .all()
            )
        ]

    return {
        "workspace_name": ws.name,
        "workspace_path": ws.workspace_path,
        "rule_set": ws.rule_set_id,
        "style_prompt": style_prompt,
        "library_ids": library_ids,
        "existing_assets": [
            {"type": a.type, "name": a.name, "slug": a.slug}
            for a in assets
        ],
        "custom_asset_types": custom_asset_types,
        "skills": [
            {"name": s["name"], "description": s["description"], "agent_types": s["agent_types"]}
            for s in load_workspace_skills(ws.workspace_path)
            if s.get("enabled", True)
        ],
    }
# ─── Skill discovery & injection ─────────────────────────────────────────────

def load_workspace_skills(workspace_path: str) -> list[dict]:
    """Scan skills/ directory, return all skill metadata (frontmatter) as dicts."""
    skills_dir = Path(workspace_path) / "skills"
    if not skills_dir.exists():
        return []
    result = []
    for md_file in sorted(skills_dir.glob("*.md")):
        try:
            if _HAS_FRONTMATTER:
                post = _frontmatter.load(str(md_file))
                slug = md_file.stem
                result.append({
                    "slug": slug,
                    "name": post.get("name", slug),
                    "description": post.get("description", ""),
                    "agent_types": post.get("agent_types", []),
                    "enabled": post.get("enabled", True),
                    "body": post.content,
                })
            else:
                # Fallback: plain text (no frontmatter library)
                text = md_file.read_text(encoding="utf-8")
                slug = md_file.stem
                result.append({
                    "slug": slug,
                    "name": slug,
                    "description": "",
                    "agent_types": [],
                    "enabled": True,
                    "body": text,
                })
        except Exception:
            pass
    return result


def get_skills_for_agent(workspace_path: str, agent_type: str) -> list[dict]:
    """Return enabled skills applicable to the given agent_type."""
    all_skills = load_workspace_skills(workspace_path)
    result = []
    for s in all_skills:
        if not s.get("enabled", True):
            continue
        types = s.get("agent_types", [])
        if not types or agent_type in types:
            result.append(s)
    return result


def inject_skills(skills: list[dict], task_prompt: str) -> str:
    """Prepend skill body content to task_prompt."""
    if not skills:
        return task_prompt
    blocks = [f"[Skill: {s['name']}]\n{s['body']}" for s in skills]
    return "\n\n".join(blocks) + "\n\n" + task_prompt
