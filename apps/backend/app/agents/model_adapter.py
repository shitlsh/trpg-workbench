"""Adapts LLMProfileORM / EmbeddingProfileORM records to Agno model/embedder objects."""
import re
from typing import Any
from agno.models.openai import OpenAIChat

from app.core.settings import LLM_REQUEST_TIMEOUT_SECONDS


def _llm_timeout_kwargs() -> dict:
    """Extra kwargs for Agno chat models (best-effort; ignored if unsupported)."""
    t = LLM_REQUEST_TIMEOUT_SECONDS
    if t is None:
        return {}
    return {"timeout": float(t)}


def _instantiate_chat_model(factory, **kwargs):
    """Construct an Agno model, dropping ``timeout`` if the class rejects it."""
    try:
        return factory(**kwargs)
    except TypeError:
        kwargs.pop("timeout", None)
        return factory(**kwargs)


def strip_code_fence(text: str) -> str:
    """Remove markdown code fences (``` or ```json etc.) from LLM responses."""
    return re.sub(r"^```[a-zA-Z]*\n?|```\s*$", "", text.strip(), flags=re.MULTILINE).strip()


def parse_json_object_from_llm(text: str) -> dict:
    """Parse a single JSON object from model output; tolerates leading/trailing prose and fences.

    Many models still emit a short preamble or put JSON after ``strip_code_fence``; some
    also break JSON by using raw newlines or unescaped ``"`` inside string values — that
    cannot be fixed here and will still raise with a clear error.
    """
    import json

    s = text.strip()
    for candidate in (s, _first_brace_to_last_brace(s)):
        if not candidate:
            continue
        try:
            out = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(out, dict):
            return out
        raise ValueError("模型返回的 JSON 根类型必须是对象 {}，不能是数组或标量")
    raise ValueError(
        "无法解析为 JSON 对象。常见原因：1) 输出中混有说明文字；2) 字符串里含未转义的双引号；"
        "3) 在 JSON 字符串内写了未转义的换行。请重试，或换用温度更低的模型。"
    )


def _first_brace_to_last_brace(text: str) -> str:
    a = text.find("{")
    b = text.rfind("}")
    if a < 0 or b <= a:
        return ""
    return text[a : b + 1]


def _decrypt_key(profile) -> str | None:
    try:
        from app.utils.secrets import decrypt_secret
        raw = profile.api_key_encrypted if hasattr(profile, "api_key_encrypted") else None
        if raw:
            return decrypt_secret(raw)
    except Exception:
        pass
    return None


def _normalize_openai_compatible_embedding_model(model_name: str) -> str:
    """Normalize common provider-prefixed names for OpenAI-compatible embedding APIs."""
    if not model_name:
        return model_name
    # Jina OpenAI-compatible endpoint expects "jina-embeddings-..." without "jina-ai/".
    if model_name.startswith("jina-ai/"):
        return model_name.split("/", 1)[1]
    return model_name


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

    to = _llm_timeout_kwargs()

    if provider == "openai":
        kwargs: dict = {"id": model_name, **to}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        return _instantiate_chat_model(OpenAIChat, **kwargs)

    elif provider == "anthropic":
        from agno.models.anthropic import Claude
        kwargs = {"id": model_name, **to}
        if api_key:
            kwargs["api_key"] = api_key
        return _instantiate_chat_model(Claude, **kwargs)

    elif provider == "google":
        from agno.models.google import Gemini
        kwargs = {"id": model_name, **to}
        if api_key:
            kwargs["api_key"] = api_key
        return _instantiate_chat_model(Gemini, **kwargs)

    elif provider == "openrouter":
        kwargs = {"id": model_name, **to}
        if api_key:
            kwargs["api_key"] = api_key
        kwargs["base_url"] = base_url or "https://openrouter.ai/api/v1"
        return _instantiate_chat_model(OpenAIChat, **kwargs)

    elif provider == "openai_compatible":
        kwargs = {"id": model_name, **to}
        # Local/compatible endpoints don't require a real key, but the OpenAI client
        # will raise if neither api_key kwarg nor OPENAI_API_KEY env var is present.
        kwargs["api_key"] = api_key or "local"
        if base_url:
            kwargs["base_url"] = base_url
        return _instantiate_chat_model(OpenAIChat, **kwargs)

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
    if provider == "openai_compatible":
        model_name = _normalize_openai_compatible_embedding_model(model_name)
    base_url = profile.base_url or None
    api_key = _decrypt_key(profile)

    from openai import OpenAI

    kwargs: dict = {}
    if LLM_REQUEST_TIMEOUT_SECONDS is not None:
        kwargs["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
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
            try:
                response = self._client.embeddings.create(input=texts, model=self._model)
            except Exception as exc:
                msg = str(exc)
                if "union_tag_invalid" in msg and "expected tags" in msg:
                    raise ValueError(
                        "Embedding 模型名无效。若使用 Jina 的 OpenAI 兼容端点，"
                        "请使用例如 `jina-embeddings-v5-text-small`，不要使用 `jina-ai/...` 前缀。"
                    ) from exc
                raise
            return [item.embedding for item in response.data]

        def embed_one(self, text: str) -> list[float]:
            return self.embed([text])[0]

    return _Embedder(client, model_name)
