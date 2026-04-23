"""Asset CRUD + file system management + revision creation."""
import json
import re
from pathlib import Path
from sqlalchemy.orm import Session

from app.models.orm import AssetORM, AssetRevisionORM
from app.utils.paths import get_data_dir

# ─── Asset type → directory mapping ──────────────────────────────────────────

ASSET_TYPE_DIRS = {
    "outline": "outline",
    "stage": "stages",
    "npc": "npcs",
    "monster": "monsters",
    "location": "locations",
    "clue": "clues",
    "branch": "branches",
    "timeline": "timelines",
    "map_brief": "map_briefs",
    "lore_note": "lore_notes",
}

# ─── NPC template (Markdown with standard headings) ───────────────────────────

NPC_MD_TEMPLATE = """# {name}

## 外貌描述


## 背景故事


## 动机


## 与玩家的关系


## 备注

"""

GENERIC_MD_TEMPLATE = """# {name}

## 描述


## 备注

"""

NPC_JSON_TEMPLATE = {
    "name": "",
    "appearance": "",
    "background": "",
    "motivation": "",
    "relationship_to_players": "",
    "notes": "",
}

GENERIC_JSON_TEMPLATE = {
    "name": "",
    "description": "",
    "notes": "",
}


def _workspace_assets_dir(workspace_path: str) -> Path:
    return Path(workspace_path) / "assets"


def ensure_workspace_dirs(workspace_path: str) -> None:
    """Create all asset subdirectories for a workspace."""
    base = _workspace_assets_dir(workspace_path)
    for subdir in ASSET_TYPE_DIRS.values():
        (base / subdir).mkdir(parents=True, exist_ok=True)
    (Path(workspace_path) / "revisions").mkdir(parents=True, exist_ok=True)
    (Path(workspace_path) / "images").mkdir(parents=True, exist_ok=True)
    (Path(workspace_path) / "logs").mkdir(parents=True, exist_ok=True)


def _asset_file_prefix(asset_type: str, slug: str) -> str:
    return f"{asset_type}-{slug}"


def _get_template_md(asset_type: str, name: str) -> str:
    if asset_type == "npc":
        return NPC_MD_TEMPLATE.format(name=name)
    return GENERIC_MD_TEMPLATE.format(name=name)


def _get_template_json(asset_type: str, name: str) -> str:
    if asset_type == "npc":
        data = {**NPC_JSON_TEMPLATE, "name": name}
    else:
        data = {**GENERIC_JSON_TEMPLATE, "name": name}
    return json.dumps(data, ensure_ascii=False, indent=2)


def _write_asset_files(asset_dir: Path, prefix: str, content_md: str, content_json: str) -> None:
    (asset_dir / f"{prefix}.md").write_text(content_md, encoding="utf-8")
    (asset_dir / f"{prefix}.json").write_text(content_json, encoding="utf-8")


def create_asset(db: Session, workspace_id: str, workspace_path: str,
                 asset_type: str, name: str, slug: str, summary: str | None = None) -> AssetORM:
    """Create an asset, write initial files, and create revision 1."""
    subdir = ASSET_TYPE_DIRS.get(asset_type, asset_type + "s")
    asset_dir = _workspace_assets_dir(workspace_path) / subdir
    asset_dir.mkdir(parents=True, exist_ok=True)

    prefix = _asset_file_prefix(asset_type, slug)
    rel_path = f"assets/{subdir}/{prefix}"

    content_md = _get_template_md(asset_type, name)
    content_json = _get_template_json(asset_type, name)

    _write_asset_files(asset_dir, prefix, content_md, content_json)

    asset = AssetORM(
        workspace_id=workspace_id,
        type=asset_type,
        name=name,
        slug=slug,
        path=rel_path,
        status="draft",
        summary=summary,
    )
    db.add(asset)
    db.flush()  # get id before creating revision

    revision = AssetRevisionORM(
        asset_id=asset.id,
        version=1,
        content_md=content_md,
        content_json=content_json,
        change_summary="初始创建",
        source_type="user",
    )
    db.add(revision)
    db.flush()

    asset.latest_revision_id = revision.id
    db.commit()
    db.refresh(asset)
    return asset


def update_asset(db: Session, asset: AssetORM, workspace_path: str,
                 content_md: str | None = None, content_json: str | None = None,
                 change_summary: str | None = None,
                 name: str | None = None, status: str | None = None,
                 summary: str | None = None,
                 source_type: str = "user") -> AssetORM:
    """Update asset content + write files + append revision."""
    # Get current content from latest revision
    latest = None
    if asset.latest_revision_id:
        latest = db.get(AssetRevisionORM, asset.latest_revision_id)

    current_md = latest.content_md if latest else ""
    current_json = latest.content_json if latest else "{}"

    new_md = content_md if content_md is not None else current_md
    new_json = content_json if content_json is not None else current_json

    if name:
        asset.name = name
    if status:
        asset.status = status
    if summary is not None:
        asset.summary = summary

    # Write files
    subdir = ASSET_TYPE_DIRS.get(asset.type, asset.type + "s")
    asset_dir = _workspace_assets_dir(workspace_path) / subdir
    prefix = _asset_file_prefix(asset.type, asset.slug)
    _write_asset_files(asset_dir, prefix, new_md, new_json)

    # Count revisions for next version number
    last_version = latest.version if latest else 0

    revision = AssetRevisionORM(
        asset_id=asset.id,
        version=last_version + 1,
        content_md=new_md,
        content_json=new_json,
        change_summary=change_summary or "用户手动编辑",
        source_type=source_type,
    )
    db.add(revision)
    db.flush()

    asset.latest_revision_id = revision.id
    db.commit()
    db.refresh(asset)
    return asset


def get_asset_with_content(db: Session, asset: AssetORM) -> dict:
    """Return asset dict merged with latest revision content."""
    latest = None
    if asset.latest_revision_id:
        latest = db.get(AssetRevisionORM, asset.latest_revision_id)

    result = {
        "id": asset.id,
        "workspace_id": asset.workspace_id,
        "type": asset.type,
        "name": asset.name,
        "slug": asset.slug,
        "path": asset.path,
        "status": asset.status,
        "summary": asset.summary,
        "metadata_json": asset.metadata_json,
        "latest_revision_id": asset.latest_revision_id,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
        "content_md": latest.content_md if latest else "",
        "content_json": latest.content_json if latest else "{}",
        "version": latest.version if latest else 0,
    }
    return result


def md_to_json_sync(content_md: str, asset_type: str, existing_json: str) -> tuple[str, list[str]]:
    """
    Parse MD headings into JSON fields. Returns (new_json, warnings).
    Unrecognised sections are collected into `notes`.
    """
    try:
        data = json.loads(existing_json)
    except Exception:
        data = {}

    HEADING_MAP = {
        "外貌描述": "appearance",
        "背景故事": "background",
        "动机": "motivation",
        "与玩家的关系": "relationship_to_players",
        "描述": "description",
        "备注": "notes",
    }

    sections: dict[str, str] = {}
    current_heading = None
    lines = content_md.splitlines()
    buf = []

    for line in lines:
        m = re.match(r"^##\s+(.+)", line)
        if m:
            if current_heading is not None:
                sections[current_heading] = "\n".join(buf).strip()
            current_heading = m.group(1).strip()
            buf = []
        else:
            buf.append(line)
    if current_heading is not None:
        sections[current_heading] = "\n".join(buf).strip()

    warnings = []
    unmapped = []
    for heading, text in sections.items():
        field = HEADING_MAP.get(heading)
        if field:
            data[field] = text
        else:
            unmapped.append(f"## {heading}\n{text}")

    if unmapped:
        data["notes"] = (data.get("notes") or "") + "\n\n" + "\n\n".join(unmapped)
        warnings.append("部分内容无法同步到 JSON，建议在 JSON 视图补充：" + ", ".join(
            [h for h in sections if h not in HEADING_MAP]
        ))

    return json.dumps(data, ensure_ascii=False, indent=2), warnings
