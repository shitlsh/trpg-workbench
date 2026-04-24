"""Path utilities for global data dir and workspace-internal paths.

Directory layout:
  ~/trpg-workbench-data/
  ├── app.db                         ← global DB (profiles, rule sets, workspace registry)
  └── workspaces/
      └── {workspace-slug}/          ← one per workspace
          ├── .trpg/
          │   ├── config.yaml
          │   ├── cache.db
          │   ├── revisions/{slug}/v{N}.md
          │   └── chat/{session-id}.jsonl
          ├── skills/                ← M17 user skills
          ├── {type}/               ← asset dirs created on demand
          │   └── {slug}.md
          └── ...
"""
import os
import re
import unicodedata
from pathlib import Path


# ─── Global paths ────────────────────────────────────────────────────────────


def get_data_dir() -> Path:
    """Return the data directory, creating it if needed."""
    data_dir = Path(os.environ.get("TRPG_DATA_DIR", Path.home() / "trpg-workbench-data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_db_path() -> Path:
    """Global app.db path."""
    return get_data_dir() / "app.db"


def get_workspaces_root() -> Path:
    """Root directory for all workspaces."""
    root = get_data_dir() / "workspaces"
    root.mkdir(parents=True, exist_ok=True)
    return root


# ─── Workspace-internal paths ────────────────────────────────────────────────


def trpg_dir(workspace_path: str | Path) -> Path:
    """.trpg/ metadata directory inside a workspace."""
    return Path(workspace_path) / ".trpg"


def cache_db_path(workspace_path: str | Path) -> Path:
    """.trpg/cache.db — rebuildable index cache."""
    return trpg_dir(workspace_path) / "cache.db"


def config_yaml_path(workspace_path: str | Path) -> Path:
    """.trpg/config.yaml — workspace configuration."""
    return trpg_dir(workspace_path) / "config.yaml"


def revisions_dir(workspace_path: str | Path) -> Path:
    """.trpg/revisions/ — asset version snapshots."""
    return trpg_dir(workspace_path) / "revisions"


def asset_revision_dir(workspace_path: str | Path, slug: str) -> Path:
    """.trpg/revisions/{slug}/ — revision snapshots for a single asset."""
    return revisions_dir(workspace_path) / slug


def chat_dir(workspace_path: str | Path) -> Path:
    """.trpg/chat/ — JSONL chat session files."""
    return trpg_dir(workspace_path) / "chat"


def chat_session_path(workspace_path: str | Path, session_id: str) -> Path:
    """.trpg/chat/{session-id}.jsonl"""
    return chat_dir(workspace_path) / f"{session_id}.jsonl"


def skills_dir(workspace_path: str | Path) -> Path:
    """skills/ — M17 user-defined agent skills."""
    return Path(workspace_path) / "skills"


def asset_type_dir(workspace_path: str | Path, asset_type: str) -> Path:
    """{type}/ — asset directory for a given type (created on demand)."""
    # Pluralise: npc → npcs, scene → scenes, etc.
    dirname = asset_type + "s" if not asset_type.endswith("s") else asset_type
    return Path(workspace_path) / dirname


def asset_file_path(workspace_path: str | Path, asset_type: str, slug: str) -> Path:
    """{type}s/{slug}.md — the canonical path for a new asset file."""
    return asset_type_dir(workspace_path, asset_type) / f"{slug}.md"


# ─── Reserved directories (skipped during asset scanning) ────────────────────

RESERVED_DIRS = {".trpg", "skills"}


def is_reserved_dir(dirname: str) -> bool:
    """Check if a directory name should be skipped during recursive asset scanning."""
    return dirname in RESERVED_DIRS


# ─── Workspace init ──────────────────────────────────────────────────────────


def init_workspace_dirs(workspace_path: str | Path) -> None:
    """Create the .trpg/ internal structure for a new workspace."""
    p = Path(workspace_path)
    p.mkdir(parents=True, exist_ok=True)
    trpg_dir(p).mkdir(exist_ok=True)
    revisions_dir(p).mkdir(parents=True, exist_ok=True)
    chat_dir(p).mkdir(parents=True, exist_ok=True)
    skills_dir(p).mkdir(exist_ok=True)


# ─── Slug helpers ─────────────────────────────────────────────────────────────


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug.

    - Chinese / non-ASCII kept as-is (pinyin conversion is out of scope)
    - Whitespace and special chars replaced with hyphens
    - Consecutive hyphens collapsed
    - Lowercased
    """
    text = unicodedata.normalize("NFKC", text).strip().lower()
    # Replace whitespace and common separators with hyphens
    text = re.sub(r"[\s_/\\]+", "-", text)
    # Remove characters that are not alphanumeric, CJK, or hyphens
    text = re.sub(r"[^\w\u4e00-\u9fff\u3400-\u4dbf\-]", "", text)
    # Collapse consecutive hyphens
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-") or "untitled"
