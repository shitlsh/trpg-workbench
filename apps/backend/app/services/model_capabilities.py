"""Resolve model-level capabilities from the local model catalog (not LLM profile)."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.orm import ModelCatalogEntryORM


@dataclass(frozen=True)
class ModelCapabilities:
    supports_json_mode: bool
    supports_tools: bool
    context_window: int | None
    max_output_tokens: int | None


def _entry_id(provider_type: str, model_name: str) -> str:
    return f"{provider_type}:{model_name}"


def get_model_capabilities(
    provider_type: str, model_name: str, db: Session,
) -> ModelCapabilities:
    """Load capabilities for ``{provider_type}:{model_name}`` from ``model_catalog_entries``.

    If the row is missing or boolean fields are NULL, treat booleans as False (conservative).
    """
    if not model_name or not provider_type:
        return ModelCapabilities(False, False, None, None)
    entry = db.get(ModelCatalogEntryORM, _entry_id(provider_type, model_name))
    if not entry:
        return ModelCapabilities(False, False, None, None)
    j = bool(entry.supports_json_mode) if entry.supports_json_mode is not None else False
    t = bool(entry.supports_tools) if entry.supports_tools is not None else False
    return ModelCapabilities(
        supports_json_mode=j,
        supports_tools=t,
        context_window=entry.context_window,
        max_output_tokens=entry.max_output_tokens,
    )
