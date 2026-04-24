"""Workspace configuration service — .trpg/config.yaml is source of truth.

The config.yaml stores workspace metadata (name, description, rule_set,
model bindings, rerank settings, knowledge library references) using
human-readable names instead of UUIDs for portability.
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from app.utils.paths import config_yaml_path, init_workspace_dirs


# ─── Default config ──────────────────────────────────────────────────────────

DEFAULT_CONFIG: dict[str, Any] = {
    "name": "",
    "description": "",
    "created_at": "",
    "rule_set": "",
    "models": {
        "default_llm": "",
        "rules_llm": "",
        "embedding": "",
        "rerank": "",
    },
    "rerank": {
        "enabled": False,
        "top_n": 5,
        "top_k": 20,
    },
    "knowledge_libraries": [],
}


# ─── Read / Write ────────────────────────────────────────────────────────────


def read_config(workspace_path: str | Path) -> dict:
    """Read .trpg/config.yaml. Returns default config if file missing."""
    cfg_path = config_yaml_path(workspace_path)
    if not cfg_path.exists():
        return {**DEFAULT_CONFIG, "name": Path(workspace_path).name}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        # Merge with defaults to ensure all keys exist
        merged = {**DEFAULT_CONFIG, **data}
        merged["models"] = {**DEFAULT_CONFIG["models"], **(data.get("models") or {})}
        merged["rerank"] = {**DEFAULT_CONFIG["rerank"], **(data.get("rerank") or {})}
        return merged
    except Exception:
        return {**DEFAULT_CONFIG, "name": Path(workspace_path).name}


def write_config(workspace_path: str | Path, config: dict) -> None:
    """Write config dict to .trpg/config.yaml."""
    cfg_path = config_yaml_path(workspace_path)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cfg_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def update_config(workspace_path: str | Path, updates: dict) -> dict:
    """Read, merge updates, write back. Returns the merged config."""
    config = read_config(workspace_path)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(config.get(key), dict):
            config[key].update(value)
        else:
            config[key] = value
    write_config(workspace_path, config)
    return config


# ─── Init ────────────────────────────────────────────────────────────────────


def init_workspace(
    workspace_path: str | Path,
    name: str,
    description: str = "",
    rule_set: str = "",
) -> dict:
    """Initialize a new workspace directory with .trpg/ structure and config.yaml.

    Returns the initial config dict.
    """
    init_workspace_dirs(workspace_path)

    now = datetime.now(timezone.utc).isoformat()
    config = {
        **DEFAULT_CONFIG,
        "name": name,
        "description": description,
        "created_at": now,
        "rule_set": rule_set,
    }
    write_config(workspace_path, config)
    return config


def is_valid_workspace(workspace_path: str | Path) -> bool:
    """Check if a directory is a valid workspace (has .trpg/config.yaml)."""
    return config_yaml_path(workspace_path).exists()
