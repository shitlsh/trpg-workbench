"""Adapter utilities for profile auth/config + native SDK invocations."""
import re
from typing import Any
from openai import AsyncOpenAI

from app.core.settings import LLM_REQUEST_TIMEOUT_SECONDS


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
    """Return a plain runtime config object for provider runtimes."""
    return {"profile": profile, "model_name": model_name}


def _openai_client_kwargs(profile) -> dict[str, Any]:
    provider = (profile.provider_type or "").strip().lower()
    base_url = profile.base_url or None
    api_key = _decrypt_key(profile)
    kwargs: dict[str, Any] = {"api_key": api_key or "local"}
    if provider == "openrouter" and not base_url:
        base_url = "https://openrouter.ai/api/v1"
    if base_url:
        kwargs["base_url"] = base_url
    if LLM_REQUEST_TIMEOUT_SECONDS is not None:
        kwargs["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
    return kwargs


async def complete_text_once(
    *,
    profile,
    model_name: str,
    system_prompt: str | None,
    user_prompt: str,
    temperature: float = 0.2,
) -> str:
    """Simple single-turn completion for utility endpoints (non tool-calling)."""
    provider = (profile.provider_type or "").strip().lower()
    if provider in {"openai", "openrouter", "openai_compatible"}:
        client = AsyncOpenAI(**_openai_client_kwargs(profile))
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.append({"role": "user", "content": user_prompt})
        resp = await client.chat.completions.create(
            model=model_name,
            messages=msgs,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""

    if provider == "anthropic":
        from anthropic import AsyncAnthropic

        key = _decrypt_key(profile)
        if not key:
            raise RuntimeError("Anthropic API key is required")
        client_kw: dict[str, Any] = {"api_key": key}
        if LLM_REQUEST_TIMEOUT_SECONDS is not None:
            client_kw["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
        client = AsyncAnthropic(**client_kw)
        resp = await client.messages.create(
            model=model_name,
            system=system_prompt or "",
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=2048,
            temperature=temperature,
        )
        parts = [getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text"]
        return "".join(parts)

    if provider == "google":
        from google import genai
        import asyncio

        key = _decrypt_key(profile)
        if not key:
            raise RuntimeError("Google API key is required")
        client = genai.Client(api_key=key)
        prompt = (system_prompt or "") + "\n\n" + user_prompt
        resp = await asyncio.to_thread(client.models.generate_content, model=model_name, contents=prompt)
        return getattr(resp, "text", "") or ""

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
