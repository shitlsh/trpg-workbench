"""Adapts LLMProfileORM / EmbeddingProfileORM records to Agno model/embedder objects."""
import re
from typing import Any
from agno.models.openai import OpenAIChat


def strip_code_fence(text: str) -> str:
    """Remove markdown code fences (``` or ```json etc.) from LLM responses."""
    return re.sub(r"^```[a-zA-Z]*\n?|```\s*$", "", text.strip(), flags=re.MULTILINE).strip()


def _decrypt_key(profile) -> str | None:
    try:
        from app.utils.secrets import decrypt_secret
        raw = profile.api_key_encrypted if hasattr(profile, "api_key_encrypted") else None
        if raw:
            return decrypt_secret(raw)
    except Exception:
        pass
    return None


def model_from_profile(profile, model_name: str) -> Any:
    """
    Given a LLMProfileORM instance and an explicit model_name, return the Agno model object.

    model_name must be provided explicitly — it is no longer stored on the profile.
    Resolve order: SendMessageRequest.model → workspace.default_llm_model_name.

    Supported provider_type values:
      openai, anthropic, google, openrouter, openai_compatible
    """
    provider = profile.provider_type
    base_url = profile.base_url or None
    api_key = _decrypt_key(profile)

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

    elif provider == "openrouter":
        kwargs = {"id": model_name}
        if api_key:
            kwargs["api_key"] = api_key
        kwargs["base_url"] = base_url or "https://openrouter.ai/api/v1"
        return OpenAIChat(**kwargs)

    elif provider == "openai_compatible":
        kwargs = {"id": model_name}
        # Local/compatible endpoints don't require a real key, but the OpenAI client
        # will raise if neither api_key kwarg nor OPENAI_API_KEY env var is present.
        kwargs["api_key"] = api_key or "local"
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAIChat(**kwargs)

    else:
        raise ValueError(f"Unsupported provider_type: {provider}")


def embedding_from_profile(profile) -> Any:
    """
    Given an EmbeddingProfileORM instance, return the appropriate embedder object.

    Supported provider_type values:
      openai, openai_compatible
    """
    provider = profile.provider_type
    model_name = profile.model_name
    base_url = profile.base_url or None
    api_key = _decrypt_key(profile)

    from openai import OpenAI

    kwargs: dict = {}
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["base_url"] = base_url

    client = OpenAI(**kwargs)

    class _Embedder:
        def __init__(self, client, model_name):
            self._client = client
            self._model = model_name

        def embed(self, texts: list[str]) -> list[list[float]]:
            response = self._client.embeddings.create(input=texts, model=self._model)
            return [item.embedding for item in response.data]

        def embed_one(self, text: str) -> list[float]:
            return self.embed([text])[0]

    return _Embedder(client, model_name)
