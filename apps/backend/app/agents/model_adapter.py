"""Adapter utilities for profile auth/config + native SDK invocations."""
import inspect
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from openai import AsyncOpenAI

from app.core.settings import LLM_REQUEST_TIMEOUT_SECONDS

# Anthropic Messages API *requires* ``max_tokens``; the SDK will not let you omit it. This is
# only a default when the caller does not pass ``max_tokens=``; the model may still cap lower.
# (Current project default 32768 — align with your deployment’s Claude max output when you add
# per-model profile config.)
# OpenAI / OpenRouter / ``openai_compatible`` / **Google Gemini** do *not* set a default here:
# the request omits max output and uses each provider’s own defaults.
DEFAULT_MAX_TOKENS_ANTHROPIC: int = 32768


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
    max_tokens: int | None = None,
) -> str:
    """Simple single-turn completion for utility endpoints (non tool-calling).

    **max_tokens** (optional):
    - If **omitted** for OpenAI-compatible providers: **we do not send** ``max_tokens`` so the
      **server / model** chooses (Gemini: same—see Google branch, no max output set).
    - **Anthropic**: the API **requires** a value; if you omit the argument, we use
      :data:`DEFAULT_MAX_TOKENS_ANTHROPIC`. Pass ``max_tokens`` explicitly to raise the ceiling
      (subject to the model’s hard cap).
    """
    provider = (profile.provider_type or "").strip().lower()
    if provider in {"openai", "openrouter", "openai_compatible"}:
        client = AsyncOpenAI(**_openai_client_kwargs(profile))
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.append({"role": "user", "content": user_prompt})
        create_kwargs: dict[str, Any] = {
            "model": model_name,
            "messages": msgs,
            "temperature": temperature,
        }
        if max_tokens is not None:
            create_kwargs["max_tokens"] = max_tokens
        resp = await client.chat.completions.create(**create_kwargs)
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
        anthropic_max = max_tokens if max_tokens is not None else DEFAULT_MAX_TOKENS_ANTHROPIC
        resp = await client.messages.create(
            model=model_name,
            system=system_prompt or "",
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=anthropic_max,
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
        # Intentionally omit max_output_tokens so Gemini / GenAI use provider defaults per model.
        resp = await asyncio.to_thread(client.models.generate_content, model=model_name, contents=prompt)
        return getattr(resp, "text", "") or ""

    raise ValueError(f"Unsupported provider_type: {provider}")


StreamDeltaCallback = Callable[[str], Awaitable[None] | None]


async def _maybe_await(cb: StreamDeltaCallback | None, fragment: str) -> None:
    if not cb or not fragment:
        return
    out = cb(fragment)
    if inspect.isawaitable(out):
        await out


async def iter_complete_text_deltas(
    *,
    profile,
    model_name: str,
    system_prompt: str | None,
    user_prompt: str,
    temperature: float = 0.2,
) -> AsyncIterator[str]:
    """Async iterator of assistant text fragments (single-turn chat completion)."""
    provider = (profile.provider_type or "").strip().lower()

    if provider in {"openai", "openrouter", "openai_compatible"}:
        client = AsyncOpenAI(**_openai_client_kwargs(profile))
        msgs: list[dict[str, Any]] = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.append({"role": "user", "content": user_prompt})
        stream = await client.chat.completions.create(
            model=model_name,
            messages=msgs,
            temperature=temperature,
            stream=True,
        )
        async for chunk in stream:
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            if delta is None:
                continue
            content = getattr(delta, "content", None)
            if isinstance(content, str) and content:
                yield content
        return

    if provider == "anthropic":
        from anthropic import AsyncAnthropic

        key = _decrypt_key(profile)
        if not key:
            raise RuntimeError("Anthropic API key is required")
        client_kw: dict[str, Any] = {"api_key": key}
        if LLM_REQUEST_TIMEOUT_SECONDS is not None:
            client_kw["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
        client = AsyncAnthropic(**client_kw)
        async with client.messages.stream(
            model=model_name,
            system=system_prompt or "",
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=DEFAULT_MAX_TOKENS_ANTHROPIC,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                if text:
                    yield text
        return

    if provider == "google":
        from google import genai
        from google.genai import types

        key = _decrypt_key(profile)
        if not key:
            raise RuntimeError("Google API key is required")
        client = genai.Client(api_key=key)
        merged = ((system_prompt or "").strip() + "\n\n" if (system_prompt or "").strip() else "") + user_prompt
        # No max_output_tokens — model / API defaults apply.
        config = types.GenerateContentConfig(temperature=temperature)
        async for chunk in await client.aio.models.generate_content_stream(
            model=model_name,
            contents=merged,
            config=config,
        ):
            chunk_text = getattr(chunk, "text", None)
            if isinstance(chunk_text, str) and chunk_text:
                yield chunk_text
        return

    raise ValueError(f"Unsupported provider_type for iter_complete_text_deltas: {provider}")


async def stream_complete_text(
    *,
    profile,
    model_name: str,
    system_prompt: str | None,
    user_prompt: str,
    temperature: float = 0.2,
    on_delta: StreamDeltaCallback | None = None,
) -> tuple[str, dict[str, Any]]:
    """Stream a single-turn completion; accumulate full text. Returns (full_text, meta).

    meta includes: provider, first_chunk_ms (float | None), used_stream (bool).
    """
    provider = (profile.provider_type or "").strip().lower()
    meta: dict[str, Any] = {"provider": provider, "first_chunk_ms": None, "used_stream": True}
    t0 = time.perf_counter()
    first = True
    parts: list[str] = []

    async for fragment in iter_complete_text_deltas(
        profile=profile,
        model_name=model_name,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
    ):
        if first:
            meta["first_chunk_ms"] = round((time.perf_counter() - t0) * 1000.0, 2)
            first = False
        parts.append(fragment)
        await _maybe_await(on_delta, fragment)

    return "".join(parts), meta


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
