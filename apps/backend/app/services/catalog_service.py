"""Catalog service: load static catalog on startup, support dynamic fetch for OpenRouter/Google."""
import json
import logging
import httpx
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy.orm import Session
from app.models.orm import ModelCatalogEntryORM, EmbeddingCatalogEntryORM, LLMProfileORM

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).parent.parent / "data"


def _now():
    return datetime.now(timezone.utc)


def load_static_catalog(db: Session) -> None:
    """Load static LLM and Embedding catalog entries into DB on startup.
    Only inserts entries that don't already exist (static seeding, no overwrite).
    """
    # LLM catalog
    llm_path = _DATA_DIR / "static_llm_catalog.json"
    if llm_path.exists():
        entries = json.loads(llm_path.read_text())
        for e in entries:
            entry_id = f"{e['provider_type']}:{e['model_name']}"
            existing = db.get(ModelCatalogEntryORM, entry_id)
            if existing is None:
                db.add(ModelCatalogEntryORM(
                    id=entry_id,
                    provider_type=e["provider_type"],
                    model_name=e["model_name"],
                    display_name=e.get("display_name"),
                    context_window=e.get("context_window"),
                    max_output_tokens=e.get("max_output_tokens"),
                    supports_json_mode=e.get("supports_json_mode"),
                    supports_tools=e.get("supports_tools"),
                    input_price_per_1m=e.get("input_price_per_1m"),
                    output_price_per_1m=e.get("output_price_per_1m"),
                    source="static",
                ))
        db.commit()
        logger.info("Static LLM catalog loaded: %d entries", len(entries))

    # Embedding catalog
    emb_path = _DATA_DIR / "static_embedding_catalog.json"
    if emb_path.exists():
        entries = json.loads(emb_path.read_text())
        for e in entries:
            entry_id = f"{e['provider_type']}:{e['model_name']}"
            existing = db.get(EmbeddingCatalogEntryORM, entry_id)
            if existing is None:
                db.add(EmbeddingCatalogEntryORM(
                    id=entry_id,
                    provider_type=e["provider_type"],
                    model_name=e["model_name"],
                    display_name=e.get("display_name"),
                    dimensions=e.get("dimensions"),
                    max_input_tokens=e.get("max_input_tokens"),
                    input_price_per_1m=e.get("input_price_per_1m"),
                    source="static",
                ))
        db.commit()
        logger.info("Static Embedding catalog loaded: %d entries", len(entries))


def refresh_catalog_from_provider(
    db: Session,
    provider_type: str,
    llm_profile_id: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
) -> tuple[int, int, str | None]:
    """Dynamically fetch model list from a provider using the given profile's credentials.
    Returns (models_added, models_updated, error).
    Only modifies model_catalog_entries; never touches the profile itself.
    For openai_compatible, base_url and api_key can be passed directly (no profile needed).
    """
    resolved_api_key = api_key
    resolved_base_url = base_url

    if llm_profile_id:
        profile = db.get(LLMProfileORM, llm_profile_id)
        if not profile:
            return 0, 0, "LLM profile not found"
        # Decrypt api_key from profile
        if profile.api_key_encrypted:
            try:
                from app.utils.secrets import decrypt_secret
                resolved_api_key = resolved_api_key or decrypt_secret(profile.api_key_encrypted)
            except Exception:
                resolved_api_key = resolved_api_key or profile.api_key_encrypted
        if not resolved_base_url and hasattr(profile, "base_url"):
            resolved_base_url = profile.base_url

    try:
        if provider_type == "openrouter":
            return _refresh_openrouter(db, resolved_api_key)
        elif provider_type == "google":
            return _refresh_google(db, resolved_api_key)
        elif provider_type == "openai":
            return _refresh_openai(db, resolved_api_key)
        elif provider_type == "openai_compatible":
            if not resolved_base_url:
                return 0, 0, "openai_compatible requires a base_url"
            return _refresh_openai_compatible(db, resolved_base_url, resolved_api_key)
        else:
            return 0, 0, f"Dynamic fetch not supported for provider '{provider_type}'"
    except Exception as exc:
        logger.warning("Catalog refresh failed for %s: %s", provider_type, exc)
        return 0, 0, str(exc)


def _upsert_llm_catalog(db: Session, entry_id: str, data: dict) -> bool:
    """Insert or update a catalog entry. Returns True if new, False if updated.
    Preserves user-customized pricing (source == 'user') and static entries' pricing."""
    existing = db.get(ModelCatalogEntryORM, entry_id)
    if existing is None:
        db.add(ModelCatalogEntryORM(
            id=entry_id,
            source="api_fetched",
            fetched_at=_now(),
            **data,
        ))
        return True
    else:
        # Always update non-pricing metadata from dynamic fetch
        existing.display_name = data.get("display_name", existing.display_name)
        existing.context_window = data.get("context_window", existing.context_window)
        existing.max_output_tokens = data.get("max_output_tokens", existing.max_output_tokens)
        # Only overwrite pricing if user has NOT manually customized it
        if existing.source != "user":
            existing.input_price_per_1m = data.get("input_price_per_1m", existing.input_price_per_1m)
            existing.output_price_per_1m = data.get("output_price_per_1m", existing.output_price_per_1m)
            existing.source = "api_fetched"
        existing.fetched_at = _now()
        return False


def _refresh_openrouter(db: Session, api_key: str | None) -> tuple[int, int, str | None]:
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=15)
    resp.raise_for_status()
    models = resp.json().get("data", [])
    added = updated = 0
    for m in models:
        model_id = m.get("id", "")
        if not model_id:
            continue
        entry_id = f"openrouter:{model_id}"
        pricing = m.get("pricing", {})
        data = {
            "provider_type": "openrouter",
            "model_name": model_id,
            "display_name": m.get("name"),
            "context_window": m.get("context_length"),
            "max_output_tokens": None,
            "supports_json_mode": None,
            "supports_tools": None,
            "input_price_per_1m": float(pricing["prompt"]) * 1_000_000 if pricing.get("prompt") and float(pricing["prompt"]) > 0 else None,
            "output_price_per_1m": float(pricing["completion"]) * 1_000_000 if pricing.get("completion") and float(pricing["completion"]) > 0 else None,
        }
        is_new = _upsert_llm_catalog(db, entry_id, data)
        if is_new:
            added += 1
        else:
            updated += 1
    db.commit()
    return added, updated, None


def _refresh_google(db: Session, api_key: str | None) -> tuple[int, int, str | None]:
    url = "https://generativelanguage.googleapis.com/v1beta/models"
    params = {}
    if api_key:
        params["key"] = api_key
    resp = httpx.get(url, params=params, timeout=15)
    resp.raise_for_status()
    models = resp.json().get("models", [])
    added = updated = 0
    for m in models:
        name = m.get("name", "")  # e.g. "models/gemini-1.5-pro"
        model_name = name.replace("models/", "") if name.startswith("models/") else name
        if not model_name:
            continue
        entry_id = f"google:{model_name}"
        data = {
            "provider_type": "google",
            "model_name": model_name,
            "display_name": m.get("displayName"),
            "context_window": m.get("inputTokenLimit"),
            "max_output_tokens": m.get("outputTokenLimit"),
            "supports_json_mode": None,
            "supports_tools": None,
            "input_price_per_1m": None,
            "output_price_per_1m": None,
        }
        is_new = _upsert_llm_catalog(db, entry_id, data)
        if is_new:
            added += 1
        else:
            updated += 1
    db.commit()
    return added, updated, None


def _refresh_openai(db: Session, api_key: str | None) -> tuple[int, int, str | None]:
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.get("https://api.openai.com/v1/models", headers=headers, timeout=15)
    resp.raise_for_status()
    models = resp.json().get("data", [])
    added = updated = 0
    for m in models:
        model_id = m.get("id", "")
        if not model_id:
            continue
        entry_id = f"openai:{model_id}"
        data = {
            "provider_type": "openai",
            "model_name": model_id,
            "display_name": None,
            "context_window": None,
            "max_output_tokens": None,
            "supports_json_mode": None,
            "supports_tools": None,
            "input_price_per_1m": None,  # OpenAI list API has no pricing
            "output_price_per_1m": None,
        }
        is_new = _upsert_llm_catalog(db, entry_id, data)
        if is_new:
            added += 1
        else:
            updated += 1
    db.commit()
    return added, updated, None


def _refresh_openai_compatible(
    db: Session, base_url: str, api_key: str | None
) -> tuple[int, int, str | None]:
    """Fetch model list from an OpenAI-compatible endpoint (e.g. LM Studio, Ollama)."""
    # Normalize base_url: strip trailing slash, ensure /v1/models
    base = base_url.rstrip("/")
    # Support both http://localhost:1234 and http://localhost:1234/v1
    if base.endswith("/v1"):
        url = f"{base}/models"
    else:
        url = f"{base}/v1/models"

    headers = {}
    if api_key and api_key not in ("local", "ollama", "lm-studio", ""):
        headers["Authorization"] = f"Bearer {api_key}"

    resp = httpx.get(url, headers=headers, timeout=5)
    resp.raise_for_status()
    models = resp.json().get("data", [])
    added = updated = 0
    for m in models:
        model_id = m.get("id", "")
        if not model_id:
            continue
        entry_id = f"openai_compatible:{model_id}"
        data = {
            "provider_type": "openai_compatible",
            "model_name": model_id,
            "display_name": m.get("name") or model_id.split("/")[-1],
            "context_window": m.get("context_length") or m.get("context_window"),
            "max_output_tokens": None,
            "supports_json_mode": None,
            "supports_tools": None,
            "input_price_per_1m": None,
            "output_price_per_1m": None,
        }
        is_new = _upsert_llm_catalog(db, entry_id, data)
        if is_new:
            added += 1
        else:
            updated += 1
    db.commit()
    return added, updated, None
