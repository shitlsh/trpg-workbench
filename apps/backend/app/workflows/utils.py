"""Workspace context loading and skill utilities."""
from pathlib import Path
from sqlalchemy.orm import Session

try:
    import frontmatter as _frontmatter
    _HAS_FRONTMATTER = True
except ImportError:
    _HAS_FRONTMATTER = False

from app.models.orm import (
    WorkspaceORM, AssetORM, RuleSetORM,
    KnowledgeLibraryORM, WorkspaceLibraryBindingORM,
    PromptProfileORM, CustomAssetTypeConfigORM,
)


def get_workspace_context(db: Session, workspace_id: str) -> dict:
    from app.services.workspace_service import read_config

    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        return {}

    # Read config.yaml for rule_set name, model bindings, etc.
    config = read_config(ws.workspace_path)

    # Resolve rule_set name → id
    rule_set_name = config.get("rule_set", "")
    rule_set_id = None
    if rule_set_name:
        rs = db.query(RuleSetORM).filter(RuleSetORM.slug == rule_set_name).first()
        if not rs:
            rs = db.query(RuleSetORM).filter(RuleSetORM.name == rule_set_name).first()
        if rs:
            rule_set_id = rs.id

    # Assets from DB index
    assets = db.query(AssetORM).filter(
        AssetORM.workspace_id == workspace_id,
        AssetORM.status != "deleted",
    ).all()

    # style_prompt: from the PromptProfile bound to the workspace's rule set
    style_prompt = None
    if rule_set_id:
        pp = db.query(PromptProfileORM).filter_by(rule_set_id=rule_set_id).first()
        if pp:
            style_prompt = pp.system_prompt

    # library_ids: rule set libraries (via FK) + workspace extra bindings
    rs_libs = [
        lib.id
        for lib in db.query(KnowledgeLibraryORM).filter_by(rule_set_id=rule_set_id).all()
    ] if rule_set_id else []
    ws_libs = [
        b.library_id
        for b in db.query(WorkspaceLibraryBindingORM).filter_by(
            workspace_id=workspace_id, enabled=True
        ).all()
    ]
    library_ids = list(dict.fromkeys(rs_libs + ws_libs))  # deduplicate, preserve order

    # M16: custom asset types registered for this rule set
    custom_asset_types = []
    if rule_set_id:
        custom_asset_types = [
            {"type_key": c.type_key, "label": c.label, "icon": c.icon}
            for c in (
                db.query(CustomAssetTypeConfigORM)
                .filter_by(rule_set_id=rule_set_id)
                .order_by(CustomAssetTypeConfigORM.sort_order, CustomAssetTypeConfigORM.created_at)
                .all()
            )
        ]

    return {
        "workspace_name": ws.name,
        "workspace_path": ws.workspace_path,
        "rule_set": rule_set_name,
        "rule_set_id": rule_set_id,
        "style_prompt": style_prompt,
        "library_ids": library_ids,
        "existing_assets": [
            {"type": a.type, "name": a.name, "slug": a.slug, "summary": a.summary}
            for a in assets
        ],
        "custom_asset_types": custom_asset_types,
        "config": config,
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
