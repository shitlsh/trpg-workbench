"""Workspace Skill CRUD API — file-based skill management.

Skills are stored as Markdown files with YAML frontmatter in:
  {workspace_path}/skills/{slug}.md
"""
import re
from pathlib import Path

import frontmatter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.orm import WorkspaceORM
from app.storage.database import get_db

router = APIRouter(prefix="/workspaces/{workspace_id}/skills", tags=["workspace-skills"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class WorkspaceSkillMeta(BaseModel):
    slug: str
    name: str
    description: str
    agent_types: list[str]
    enabled: bool


class WorkspaceSkill(WorkspaceSkillMeta):
    body: str


class CreateWorkspaceSkillRequest(BaseModel):
    name: str
    description: str = ""
    agent_types: list[str] = []
    body: str = ""
    enabled: bool = True


class UpdateWorkspaceSkillRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    agent_types: list[str] | None = None
    body: str | None = None
    enabled: bool | None = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _skills_dir(workspace_path: str) -> Path:
    d = Path(workspace_path) / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _name_to_slug(name: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", name.lower())
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug.strip("-") or "skill"


def _unique_slug(skills_dir: Path, base: str) -> str:
    if not (skills_dir / f"{base}.md").exists():
        return base
    i = 2
    while (skills_dir / f"{base}-{i}.md").exists():
        i += 1
    return f"{base}-{i}"


def _read_skill(path: Path) -> WorkspaceSkill:
    post = frontmatter.load(str(path))
    slug = path.stem
    return WorkspaceSkill(
        slug=slug,
        name=post.get("name", slug),
        description=post.get("description", ""),
        agent_types=post.get("agent_types", []),
        enabled=post.get("enabled", True),
        body=post.content,
    )


def _write_skill(path: Path, skill: WorkspaceSkill) -> None:
    post = frontmatter.Post(
        skill.body,
        name=skill.name,
        description=skill.description,
        agent_types=skill.agent_types,
        enabled=skill.enabled,
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(post))


def _get_workspace_path(workspace_id: str, db: Session) -> str:
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws.workspace_path


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkspaceSkillMeta])
def list_skills(workspace_id: str, db: Session = Depends(get_db)):
    ws_path = _get_workspace_path(workspace_id, db)
    skills_dir = _skills_dir(ws_path)
    result = []
    for md_file in sorted(skills_dir.glob("*.md")):
        try:
            skill = _read_skill(md_file)
            result.append(WorkspaceSkillMeta(**skill.model_dump()))
        except Exception:
            pass  # Skip malformed skill files
    return result


@router.post("", response_model=WorkspaceSkill, status_code=201)
def create_skill(
    workspace_id: str,
    body: CreateWorkspaceSkillRequest,
    db: Session = Depends(get_db),
):
    ws_path = _get_workspace_path(workspace_id, db)
    skills_dir = _skills_dir(ws_path)
    base_slug = _name_to_slug(body.name)
    slug = _unique_slug(skills_dir, base_slug)
    skill = WorkspaceSkill(
        slug=slug,
        name=body.name,
        description=body.description,
        agent_types=body.agent_types,
        enabled=body.enabled,
        body=body.body,
    )
    _write_skill(skills_dir / f"{slug}.md", skill)
    return skill


@router.get("/{slug}", response_model=WorkspaceSkill)
def get_skill(workspace_id: str, slug: str, db: Session = Depends(get_db)):
    ws_path = _get_workspace_path(workspace_id, db)
    path = _skills_dir(ws_path) / f"{slug}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Skill not found")
    return _read_skill(path)


@router.put("/{slug}", response_model=WorkspaceSkill)
def replace_skill(
    workspace_id: str,
    slug: str,
    body: CreateWorkspaceSkillRequest,
    db: Session = Depends(get_db),
):
    ws_path = _get_workspace_path(workspace_id, db)
    skills_dir = _skills_dir(ws_path)
    path = skills_dir / f"{slug}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Skill not found")
    skill = WorkspaceSkill(
        slug=slug,
        name=body.name,
        description=body.description,
        agent_types=body.agent_types,
        enabled=body.enabled,
        body=body.body,
    )
    _write_skill(path, skill)
    return skill


@router.patch("/{slug}", response_model=WorkspaceSkill)
def update_skill(
    workspace_id: str,
    slug: str,
    body: UpdateWorkspaceSkillRequest,
    db: Session = Depends(get_db),
):
    ws_path = _get_workspace_path(workspace_id, db)
    path = _skills_dir(ws_path) / f"{slug}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Skill not found")
    current = _read_skill(path)
    updated = current.model_copy(update={
        k: v for k, v in body.model_dump(exclude_unset=True).items()
        if v is not None
    })
    _write_skill(path, updated)
    return updated


@router.delete("/{slug}", status_code=204)
def delete_skill(workspace_id: str, slug: str, db: Session = Depends(get_db)):
    ws_path = _get_workspace_path(workspace_id, db)
    path = _skills_dir(ws_path) / f"{slug}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Skill not found")
    path.unlink()
