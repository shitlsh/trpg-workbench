"""Model probe API — dynamically query available models from a provider.

This is a lightweight replacement that keeps only the probe-models endpoint
from the retired model_catalog.py (M7). No local catalog DB is involved.
"""
import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.storage.database import get_db

router = APIRouter(prefix="/settings/model-catalog", tags=["model-probe"])


class ProbeModelsResponse(BaseModel):
    models: list[str]
    error: str | None = None


@router.get("/probe-models", response_model=ProbeModelsResponse)
def probe_models(
    base_url: str = Query(None, description="Base URL of the OpenAI-compatible endpoint"),
    api_key: str = Query("", description="API key (optional, for direct key pass-through)"),
    llm_profile_id: str = Query(None, description="LLM profile ID; credentials resolved from profile"),
    embedding_profile_id: str = Query(None, description="Embedding profile ID; credentials resolved from profile"),
    rerank_profile_id: str = Query(None, description="Rerank profile ID; credentials resolved from profile"),
    db: Session = Depends(get_db),
) -> ProbeModelsResponse:
    """Return the list of models available for a given profile or endpoint.

    Modes (checked in order):
    - llm_profile_id: resolves provider_type + api_key from the LLM profile.
    - embedding_profile_id: resolves provider_type + api_key from the Embedding profile.
    - rerank_profile_id: resolves provider_type + api_key from the Rerank profile.
    - base_url: probes an OpenAI-compatible endpoint directly (legacy / new profile).
    """
    from app.utils.secrets import decrypt_secret

    def _resolve_key(encrypted: str | None) -> str | None:
        if not encrypted:
            return None
        try:
            return decrypt_secret(encrypted)
        except Exception:
            return encrypted

    # ── Mode 1: LLM profile ──────────────────────────────────────────────────
    if llm_profile_id:
        from app.models.orm import LLMProfileORM
        profile = db.get(LLMProfileORM, llm_profile_id)
        if not profile:
            return ProbeModelsResponse(models=[], error="LLM profile not found")

        resolved_key = _resolve_key(profile.api_key_encrypted)
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
                return ProbeModelsResponse(
                    models=[],
                    error=f"Dynamic model listing not supported for provider '{provider_type}'",
                )
        except Exception as exc:
            return ProbeModelsResponse(models=[], error=str(exc))

    # ── Mode 2: Embedding profile ────────────────────────────────────────────
    if embedding_profile_id:
        from app.models.orm import EmbeddingProfileORM
        profile = db.get(EmbeddingProfileORM, embedding_profile_id)
        if not profile:
            return ProbeModelsResponse(models=[], error="Embedding profile not found")

        resolved_key = _resolve_key(profile.api_key_encrypted)
        resolved_base_url = getattr(profile, "base_url", None)
        provider_type = getattr(profile, "provider_type", "") or ""

        try:
            if provider_type == "openai":
                return _probe_openai_compatible("https://api.openai.com/v1", resolved_key)
            elif provider_type == "openai_compatible":
                if not resolved_base_url:
                    return ProbeModelsResponse(models=[], error="openai_compatible profile is missing base_url")
                return _probe_openai_compatible(resolved_base_url, resolved_key)
            else:
                return ProbeModelsResponse(models=[], error=f"No probe support for embedding provider '{provider_type}'")
        except Exception as exc:
            return ProbeModelsResponse(models=[], error=str(exc))

    # ── Mode 3: Rerank profile ───────────────────────────────────────────────
    if rerank_profile_id:
        from app.models.orm import RerankProfileORM
        profile = db.get(RerankProfileORM, rerank_profile_id)
        if not profile:
            return ProbeModelsResponse(models=[], error="Rerank profile not found")

        resolved_key = _resolve_key(profile.api_key_encrypted)
        resolved_base_url = getattr(profile, "base_url", None)
        provider_type = getattr(profile, "provider_type", "") or ""

        try:
            if provider_type == "jina":
                # Jina exposes an OpenAI-compatible /v1/models endpoint
                return _probe_jina_rerank(resolved_key)
            elif provider_type == "cohere":
                return _probe_cohere_rerank(resolved_key)
            elif provider_type == "openai_compatible":
                if not resolved_base_url:
                    return ProbeModelsResponse(models=[], error="openai_compatible rerank profile is missing base_url")
                return _probe_openai_compatible(resolved_base_url, resolved_key)
            else:
                return ProbeModelsResponse(models=[], error=f"No probe support for rerank provider '{provider_type}'")
        except Exception as exc:
            return ProbeModelsResponse(models=[], error=str(exc))

    # ── Mode 4: legacy direct base_url probe ─────────────────────────────────
    if not base_url:
        return ProbeModelsResponse(models=[], error="Provide a profile ID or base_url")

    return _probe_openai_compatible(base_url, api_key or None)


# ── Provider-specific probe helpers ──────────────────────────────────────────

def _probe_anthropic(api_key: str | None) -> ProbeModelsResponse:
    headers = {"anthropic-version": "2023-06-01"}
    if api_key:
        headers["x-api-key"] = api_key
    resp = httpx.get("https://api.anthropic.com/v1/models", headers=headers, timeout=10.0)
    resp.raise_for_status()
    models = [m["id"] for m in resp.json().get("data", []) if m.get("id")]
    return ProbeModelsResponse(models=models)


def _probe_openai(api_key: str | None) -> ProbeModelsResponse:
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.get("https://api.openai.com/v1/models", headers=headers, timeout=10.0)
    resp.raise_for_status()
    models = sorted([m["id"] for m in resp.json().get("data", []) if m.get("id")])
    return ProbeModelsResponse(models=models)


def _probe_google(api_key: str | None) -> ProbeModelsResponse:
    params = {}
    if api_key:
        params["key"] = api_key
    resp = httpx.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        params=params,
        timeout=10.0,
    )
    resp.raise_for_status()
    models = []
    for m in resp.json().get("models", []):
        name = m.get("name", "")
        model_id = name.replace("models/", "") if name.startswith("models/") else name
        if model_id:
            models.append(model_id)
    return ProbeModelsResponse(models=models)


def _probe_openrouter(api_key: str | None) -> ProbeModelsResponse:
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=15.0)
    resp.raise_for_status()
    models = [m["id"] for m in resp.json().get("data", []) if m.get("id")]
    return ProbeModelsResponse(models=models)


def _probe_jina_rerank(api_key: str | None) -> ProbeModelsResponse:
    """Probe Jina AI /v1/models and return only reranker model IDs."""
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        resp = httpx.get("https://api.jina.ai/v1/models", headers=headers, timeout=10.0)
        resp.raise_for_status()
        # Jina returns all models; filter to those that are rerankers
        # Jina model IDs come as "jina-ai/jina-reranker-v3" — strip the "jina-ai/" prefix
        # so they match what Jina's actual rerank API expects as the model name.
        raw = [
            m["id"] for m in resp.json().get("data", [])
            if m.get("id") and "reranker" in m.get("id", "").lower()
        ]
        models = [mid.split("/")[-1] if "/" in mid else mid for mid in raw]
        # Sort: newest first (reranker-v3 before v2, etc.)
        models.sort(reverse=True)
        return ProbeModelsResponse(models=models)
    except httpx.HTTPStatusError as e:
        return ProbeModelsResponse(models=[], error=f"HTTP {e.response.status_code}")
    except Exception as e:
        return ProbeModelsResponse(models=[], error=str(e))


# Current Cohere rerank models (as of 2026-05).
# Cohere's /v2/models endpoint exists but requires auth and returns a non-OpenAI
# format, so we use an accurate static list instead of probing.
_COHERE_RERANK_MODELS = [
    "rerank-v4.0-pro",
    "rerank-v4.0-fast",
    "rerank-v3.5",
    "rerank-multilingual-v3.0",
    "rerank-english-v3.0",
]


def _probe_cohere_rerank(api_key: str | None) -> ProbeModelsResponse:
    """Return Cohere rerank model list.

    We verify the key is valid by hitting the lightweight /v2/tokenize endpoint,
    then return the known static model list (the /v2/models endpoint returns all
    Cohere models in a non-OpenAI format, which adds unnecessary complexity).
    """
    if api_key:
        # Quick auth check — tokenize is the cheapest Cohere endpoint
        try:
            resp = httpx.post(
                "https://api.cohere.com/v2/tokenize",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"text": "ping", "model": "command-r"},
                timeout=8.0,
            )
            if resp.status_code == 401:
                return ProbeModelsResponse(models=[], error="API Key 无效（401 Unauthorized）")
        except Exception:
            pass  # Network error: still return the list so user can type manually

    return ProbeModelsResponse(models=_COHERE_RERANK_MODELS)


def _probe_openai_compatible(base_url: str, api_key: str | None) -> ProbeModelsResponse:
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
