"""Model catalog API: CRUD + refresh + probe endpoint."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.storage.database import get_db
from app.models.orm import ModelCatalogEntryORM, EmbeddingCatalogEntryORM
from app.models.schemas import (
    ModelCatalogEntrySchema,
    EmbeddingCatalogEntrySchema,
    UpdateModelCatalogEntryRequest,
    CatalogRefreshRequest,
    CatalogRefreshResult,
)
from app.services.catalog_service import refresh_catalog_from_provider

router = APIRouter(prefix="/settings/model-catalog", tags=["model-catalog"])


class ProbeModelsResponse(BaseModel):
    models: list[str]
    error: str | None = None


@router.get("/probe-models", response_model=ProbeModelsResponse)
def probe_models(
    base_url: str = Query(None, description="Base URL of the OpenAI-compatible endpoint"),
    api_key: str = Query("", description="API key (optional, for direct key pass-through)"),
    llm_profile_id: str = Query(None, description="LLM profile ID; if provided, credentials are resolved from the profile"),
    db: Session = Depends(get_db),
):
    """
    Return the list of models available for a given LLM profile or OpenAI-compatible endpoint.

    Two modes:
    - llm_profile_id: resolves provider_type + api_key from the stored profile; supports
      anthropic, openai, google, openrouter, openai_compatible.
    - base_url (legacy): probes an OpenAI-compatible endpoint directly (no profile needed).
    """
    import httpx

    # ── Mode 1: resolve from stored profile ──────────────────────────────────
    if llm_profile_id:
        from app.models.orm import LLMProfileORM
        profile = db.get(LLMProfileORM, llm_profile_id)
        if not profile:
            return ProbeModelsResponse(models=[], error="LLM profile not found")

        resolved_key: str | None = None
        if profile.api_key_encrypted:
            try:
                from app.utils.secrets import decrypt_secret
                resolved_key = decrypt_secret(profile.api_key_encrypted)
            except Exception:
                resolved_key = profile.api_key_encrypted

        provider_type: str = profile.provider_type or ""
        resolved_base_url: str | None = getattr(profile, "base_url", None)

        try:
            if provider_type == "anthropic":
                return _probe_anthropic(resolved_key)
            elif provider_type == "openai":
                return _probe_openai(resolved_key)
            elif provider_type == "google":
                return _probe_google(resolved_key)
            elif provider_type == "openrouter":
                return _probe_openrouter(resolved_key)
            elif provider_type == "openai_compatible":
                if not resolved_base_url:
                    return ProbeModelsResponse(models=[], error="openai_compatible profile is missing base_url")
                return _probe_openai_compatible(resolved_base_url, resolved_key)
            else:
                return ProbeModelsResponse(models=[], error=f"Dynamic model listing not supported for provider '{provider_type}'")
        except Exception as exc:
            return ProbeModelsResponse(models=[], error=str(exc))

    # ── Mode 2: legacy direct base_url probe ─────────────────────────────────
    if not base_url:
        return ProbeModelsResponse(models=[], error="Provide either llm_profile_id or base_url")

    return _probe_openai_compatible(base_url, api_key or None)


def _probe_anthropic(api_key: str | None) -> "ProbeModelsResponse":
    import httpx
    headers = {"anthropic-version": "2023-06-01"}
    if api_key:
        headers["x-api-key"] = api_key
    resp = httpx.get("https://api.anthropic.com/v1/models", headers=headers, timeout=10.0)
    resp.raise_for_status()
    models = [m["id"] for m in resp.json().get("data", []) if m.get("id")]
    return ProbeModelsResponse(models=models)


def _probe_openai(api_key: str | None) -> "ProbeModelsResponse":
    import httpx
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.get("https://api.openai.com/v1/models", headers=headers, timeout=10.0)
    resp.raise_for_status()
    models = sorted([m["id"] for m in resp.json().get("data", []) if m.get("id")])
    return ProbeModelsResponse(models=models)


def _probe_google(api_key: str | None) -> "ProbeModelsResponse":
    import httpx
    params = {}
    if api_key:
        params["key"] = api_key
    resp = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", params=params, timeout=10.0)
    resp.raise_for_status()
    models = []
    for m in resp.json().get("models", []):
        name = m.get("name", "")
        model_id = name.replace("models/", "") if name.startswith("models/") else name
        if model_id:
            models.append(model_id)
    return ProbeModelsResponse(models=models)


def _probe_openrouter(api_key: str | None) -> "ProbeModelsResponse":
    import httpx
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=15.0)
    resp.raise_for_status()
    models = [m["id"] for m in resp.json().get("data", []) if m.get("id")]
    return ProbeModelsResponse(models=models)


def _probe_openai_compatible(base_url: str, api_key: str | None) -> "ProbeModelsResponse":
    import httpx
    base = base_url.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
    headers = {}
    if api_key and api_key not in ("local", "ollama", "lm-studio", ""):
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        resp = httpx.get(url, headers=headers, timeout=5.0)
        resp.raise_for_status()
        models = [m["id"] for m in resp.json().get("data", []) if m.get("id")]
        return ProbeModelsResponse(models=models)
    except httpx.HTTPStatusError as e:
        return ProbeModelsResponse(models=[], error=f"HTTP {e.response.status_code}")
    except Exception as e:
        return ProbeModelsResponse(models=[], error=str(e))


@router.get("", response_model=list[ModelCatalogEntrySchema])
def list_catalog(
    provider_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(ModelCatalogEntryORM).order_by(
        ModelCatalogEntryORM.provider_type,
        ModelCatalogEntryORM.model_name,
    )
    if provider_type:
        stmt = stmt.where(ModelCatalogEntryORM.provider_type == provider_type)
    return db.execute(stmt).scalars().all()


@router.get("/embedding", response_model=list[EmbeddingCatalogEntrySchema])
def list_embedding_catalog(
    provider_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(EmbeddingCatalogEntryORM).order_by(
        EmbeddingCatalogEntryORM.provider_type,
        EmbeddingCatalogEntryORM.model_name,
    )
    if provider_type:
        stmt = stmt.where(EmbeddingCatalogEntryORM.provider_type == provider_type)
    return db.execute(stmt).scalars().all()


@router.get("/{entry_id:path}", response_model=ModelCatalogEntrySchema)
def get_catalog_entry(entry_id: str, db: Session = Depends(get_db)):
    entry = db.get(ModelCatalogEntryORM, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Catalog entry not found")
    return entry


@router.patch("/{entry_id:path}", response_model=ModelCatalogEntrySchema)
def update_catalog_entry(
    entry_id: str,
    body: UpdateModelCatalogEntryRequest,
    db: Session = Depends(get_db),
):
    entry = db.get(ModelCatalogEntryORM, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Catalog entry not found")

    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(entry, k, v)
    # Mark as user-customized so dynamic refresh won't overwrite pricing
    if any(k in update_data for k in ("input_price_per_1m", "output_price_per_1m")):
        entry.source = "user"
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/refresh", response_model=CatalogRefreshResult)
def refresh_catalog(body: CatalogRefreshRequest, db: Session = Depends(get_db)):
    added, updated, error = refresh_catalog_from_provider(
        db=db,
        provider_type=body.provider_type,
        llm_profile_id=body.llm_profile_id,
        base_url=body.base_url,
        api_key=body.api_key,
    )
    return CatalogRefreshResult(
        provider_type=body.provider_type,
        models_added=added,
        models_updated=updated,
        error=error,
    )
