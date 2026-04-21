"""Adapts a ModelProfile ORM record to an Agno model provider."""
import re
from typing import Any
from agno.models.openai import OpenAIChat


def strip_code_fence(text: str) -> str:
    """Remove markdown code fences (``` or ```json etc.) from LLM responses."""
    return re.sub(r"^```[a-zA-Z]*\n?|```\s*$", "", text.strip(), flags=re.MULTILINE).strip()


def model_from_profile(profile) -> Any:
    """
    Given a ModelProfileORM instance (or dict with same fields),
    return the appropriate Agno model object.

    Supported provider_type values:
      openai, anthropic, google, openrouter, custom
    """
    provider = profile.provider_type if hasattr(profile, "provider_type") else profile["provider_type"]
    model_name = profile.model_name if hasattr(profile, "model_name") else profile["model_name"]
    base_url = (profile.base_url if hasattr(profile, "base_url") else profile.get("base_url")) or None

    # Decrypt API key
    api_key: str | None = None
    try:
        from app.utils.secrets import decrypt
        raw = profile.api_key_encrypted if hasattr(profile, "api_key_encrypted") else None
        if raw:
            api_key = decrypt(raw)
    except Exception:
        pass

    if provider == "openai":
        kwargs: dict = {"id": model_name}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAIChat(**kwargs)

    elif provider == "anthropic":
        from agno.models.anthropic import Claude
        kwargs = {"id": model_name}
        if api_key:
            kwargs["api_key"] = api_key
        return Claude(**kwargs)

    elif provider == "google":
        from agno.models.google import Gemini
        kwargs = {"id": model_name}
        if api_key:
            kwargs["api_key"] = api_key
        return Gemini(**kwargs)

    elif provider in ("openrouter", "custom"):
        # OpenRouter and custom endpoints use OpenAI-compatible API
        kwargs = {"id": model_name}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        else:
            kwargs["base_url"] = "https://openrouter.ai/api/v1"
        return OpenAIChat(**kwargs)

    else:
        raise ValueError(f"Unsupported provider_type: {provider}")


def get_default_model(db=None) -> Any:
    """Return a default model for use when no profile is specified.
    Falls back to gpt-4o-mini via environment OPENAI_API_KEY."""
    return OpenAIChat(id="gpt-4o-mini")
