from __future__ import annotations

import asyncio
import inspect
import json
from dataclasses import dataclass
from typing import Any

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from app.agents.runtime.policy import resolve_policy
from app.agents.tooling import build_openai_tool_specs
from app.core.settings import LLM_REQUEST_TIMEOUT_SECONDS


@dataclass
class RuntimeRequest:
    profile: Any
    model_name: str
    system_prompt: str
    messages: list[dict]
    tools: list[Any]
    temperature: float
    max_tool_rounds: int = 12


def _decrypt_key(profile) -> str | None:
    try:
        from app.utils.secrets import decrypt_secret

        raw = profile.api_key_encrypted if hasattr(profile, "api_key_encrypted") else None
        if raw:
            return decrypt_secret(raw)
    except Exception:
        pass
    return None


def _normalize_messages(messages: list[dict], role_map: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        role = role_map.get(m.get("role", "user"), m.get("role", "user"))
        content = m.get("content", "")
        item: dict[str, Any] = {"role": role, "content": content}
        if role == "assistant":
            rc = m.get("reasoning_content")
            if isinstance(rc, str) and rc.strip():
                item["reasoning_content"] = rc
        if role == "tool":
            item["tool_call_id"] = m.get("tool_call_id", "")
            item["name"] = m.get("name") or ""
        out.append(item)
    return out


async def _call_tool(fn: Any, args: dict[str, Any]) -> str:
    sig = inspect.signature(fn)
    accepted = {k: v for k, v in args.items() if k in sig.parameters}
    res = await asyncio.to_thread(fn, **accepted)
    if isinstance(res, str):
        return res
    return json.dumps(res, ensure_ascii=False)


def _best_effort_json_args(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _iter_text_chunks(text: str, size: int = 48):
    if not text:
        return
    for i in range(0, len(text), size):
        yield text[i : i + size]


def _delta_text_content(delta: Any) -> str:
    content = getattr(delta, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
            else:
                t = getattr(item, "text", None)
                if isinstance(t, str):
                    parts.append(t)
        return "".join(parts)
    return ""


async def _chat_openai_like(
    req: RuntimeRequest,
    *,
    role_map: dict[str, str],
    disable_thinking: bool,
):
    profile = req.profile
    api_key = _decrypt_key(profile) or "local"
    base_url = getattr(profile, "base_url", None) or None
    provider = (getattr(profile, "provider_type", "") or "").strip().lower()
    if provider == "openrouter" and not base_url:
        base_url = "https://openrouter.ai/api/v1"

    client_kw: dict[str, Any] = {"api_key": api_key}
    if base_url:
        client_kw["base_url"] = base_url
    if LLM_REQUEST_TIMEOUT_SECONDS is not None:
        client_kw["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
    client = AsyncOpenAI(**client_kw)

    tool_map = {t.__name__: t for t in req.tools}
    tool_specs = build_openai_tool_specs(req.tools) if req.tools else []

    messages = [{"role": "system", "content": req.system_prompt}] + _normalize_messages(req.messages, role_map)
    extra_body = {"thinking": {"type": "disabled"}} if disable_thinking else None

    for _ in range(req.max_tool_rounds):
        payload: dict[str, Any] = {
            "model": req.model_name,
            "messages": messages,
            "temperature": req.temperature,
        }
        if tool_specs:
            payload["tools"] = tool_specs
            payload["tool_choice"] = "auto"
        if extra_body:
            payload["extra_body"] = extra_body

        stream = await client.chat.completions.create(**payload, stream=True)
        text_parts: list[str] = []
        tool_acc: dict[int, dict[str, Any]] = {}
        finish_reason: str | None = None

        async for chunk in stream:
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            ch = choices[0]
            delta = getattr(ch, "delta", None)
            if delta is None:
                continue

            content = _delta_text_content(delta)
            if content:
                text_parts.append(content)
                yield {"event": "text_delta", "data": {"content": content}}

            reasoning = getattr(delta, "reasoning_content", None)
            if isinstance(reasoning, str) and reasoning:
                yield {"event": "thinking_delta", "data": {"content": reasoning}}

            d_tool_calls = getattr(delta, "tool_calls", None) or []
            for tc in d_tool_calls:
                idx = int(getattr(tc, "index", 0) or 0)
                item = tool_acc.setdefault(
                    idx,
                    {
                        "id": "",
                        "name": "",
                        "arguments": "",
                        "started": False,
                    },
                )
                tc_id = getattr(tc, "id", None)
                if isinstance(tc_id, str) and tc_id:
                    item["id"] = tc_id
                fn = getattr(tc, "function", None)
                if fn is not None:
                    fn_name = getattr(fn, "name", None)
                    fn_args = getattr(fn, "arguments", None)
                    if isinstance(fn_name, str) and fn_name:
                        item["name"] = fn_name
                    if isinstance(fn_args, str) and fn_args:
                        item["arguments"] += fn_args
                if not item["started"] and (item["id"] or item["name"]):
                    yield {
                        "event": "tool_call_start",
                        "data": {
                            "id": item["id"] or f"call_{idx}",
                            "name": item["name"] or "",
                            "arguments": json.dumps(
                                _best_effort_json_args(item["arguments"]), ensure_ascii=False
                            ),
                        },
                    }
                    item["started"] = True

            fr = getattr(ch, "finish_reason", None)
            if isinstance(fr, str) and fr:
                finish_reason = fr

        text = "".join(text_parts)
        tool_calls: list[dict[str, Any]] = []
        for idx in sorted(tool_acc.keys()):
            item = tool_acc[idx]
            call_id = item["id"] or f"call_{idx}"
            name = item["name"] or ""
            raw_args = item["arguments"] or "{}"
            if not item["started"]:
                yield {
                    "event": "tool_call_start",
                    "data": {
                        "id": call_id,
                        "name": name,
                        "arguments": json.dumps(_best_effort_json_args(raw_args), ensure_ascii=False),
                    },
                }
            tool_calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": raw_args},
                }
            )

        if not tool_calls and finish_reason != "tool_calls":
            break

        if not tool_calls:
            break

        assistant_msg: dict[str, Any] = {
            "role": "assistant",
            "content": text,
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"] or "{}",
                    },
                }
                for tc in tool_calls
            ],
        }
        messages.append(assistant_msg)

        for tc in tool_calls:
            name = tc["function"]["name"] or ""
            raw_args = tc["function"]["arguments"] or "{}"
            args = _best_effort_json_args(raw_args)
            tc_id = tc["id"] or ""
            fn = tool_map.get(name)
            if fn is None:
                result = json.dumps({"success": False, "error": f"Unknown tool: {name}"}, ensure_ascii=False)
                success = False
            else:
                try:
                    result = await _call_tool(fn, args)
                    success = True
                except Exception as exc:
                    if exc.__class__.__name__ == "AgentQuestionInterrupt":
                        raise
                    result = f"Tool execution failed: {exc}"
                    success = False
            messages.append({"role": "tool", "tool_call_id": tc_id, "name": name, "content": result})
            yield {
                "event": "tool_call_result",
                "data": {"id": tc_id, "success": success, "summary": result[:500]},
            }


def _to_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts: list[str] = []
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            if isinstance(content, str) and content.strip():
                system_parts.append(content)
            continue
        if role in ("user", "assistant"):
            out.append({"role": role, "content": content})
        elif role == "tool":
            out.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": m.get("tool_call_id") or "",
                            "content": content,
                        }
                    ],
                }
            )
    return ("\n\n".join(system_parts), out)


async def _chat_anthropic(req: RuntimeRequest):
    profile = req.profile
    api_key = _decrypt_key(profile)
    if not api_key:
        raise RuntimeError("Anthropic API key is required")

    client_kw: dict[str, Any] = {"api_key": api_key}
    if LLM_REQUEST_TIMEOUT_SECONDS is not None:
        client_kw["timeout"] = float(LLM_REQUEST_TIMEOUT_SECONDS)
    client = AsyncAnthropic(**client_kw)

    tool_map = {t.__name__: t for t in req.tools}
    tool_specs = []
    if req.tools:
        for spec in build_openai_tool_specs(req.tools):
            fn = spec["function"]
            tool_specs.append(
                {
                    "name": fn["name"],
                    "description": fn["description"],
                    "input_schema": fn["parameters"],
                }
            )

    messages = [{"role": "system", "content": req.system_prompt}] + req.messages

    for _ in range(req.max_tool_rounds):
        system_prompt, payload_messages = _to_anthropic_messages(messages)
        req_kw: dict[str, Any] = {
            "model": req.model_name,
            "system": system_prompt,
            "messages": payload_messages,
            "max_tokens": 2048,
            "temperature": req.temperature,
        }
        if tool_specs:
            req_kw["tools"] = tool_specs
        resp = await client.messages.create(**req_kw)

        text_parts: list[str] = []
        tool_uses: list[Any] = []
        for block in resp.content:
            if getattr(block, "type", "") == "text":
                text_parts.append(getattr(block, "text", "") or "")
            elif getattr(block, "type", "") == "tool_use":
                tool_uses.append(block)

        text = "".join(text_parts)
        if text:
            for part in _iter_text_chunks(text):
                yield {"event": "text_delta", "data": {"content": part}}

        if not tool_uses:
            break

        assistant_content: list[dict] = []
        if text:
            assistant_content.append({"type": "text", "text": text})
        for tu in tool_uses:
            assistant_content.append(
                {"type": "tool_use", "id": tu.id, "name": tu.name, "input": tu.input or {}}
            )
        messages.append({"role": "assistant", "content": assistant_content})

        for tu in tool_uses:
            args = tu.input or {}
            yield {
                "event": "tool_call_start",
                "data": {
                    "id": tu.id or "",
                    "name": tu.name or "",
                    "arguments": json.dumps(args, ensure_ascii=False),
                },
            }
            fn = tool_map.get(tu.name or "")
            if fn is None:
                result = json.dumps({"success": False, "error": f"Unknown tool: {tu.name}"}, ensure_ascii=False)
                success = False
            else:
                try:
                    result = await _call_tool(fn, args)
                    success = True
                except Exception as exc:
                    if exc.__class__.__name__ == "AgentQuestionInterrupt":
                        raise
                    result = f"Tool execution failed: {exc}"
                    success = False
            messages.append({"role": "tool", "tool_call_id": tu.id, "name": tu.name, "content": result})
            yield {
                "event": "tool_call_result",
                "data": {"id": tu.id or "", "success": success, "summary": result[:500]},
            }


async def _chat_google_fallback(req: RuntimeRequest):
    # Minimal compatibility path: no native function-calling loop yet.
    # Keeps provider usable for plain chat while avoiding framework dependency.
    from google import genai

    profile = req.profile
    api_key = _decrypt_key(profile)
    if not api_key:
        raise RuntimeError("Google API key is required")
    client = genai.Client(api_key=api_key)
    prompt_parts = [req.system_prompt]
    for m in req.messages:
        role = m.get("role")
        if role in ("user", "assistant"):
            prompt_parts.append(f"{role}: {m.get('content', '')}")
    prompt = "\n\n".join(prompt_parts)
    resp = await asyncio.to_thread(client.models.generate_content, model=req.model_name, contents=prompt)
    text = getattr(resp, "text", "") or ""
    if text:
        for part in _iter_text_chunks(text):
            yield {"event": "text_delta", "data": {"content": part}}


async def run_provider_runtime(req: RuntimeRequest):
    policy = resolve_policy(req.profile, req.model_name)
    provider = policy.provider
    if provider in {"openai", "openrouter", "openai_compatible"}:
        async for evt in _chat_openai_like(
            req,
            role_map=policy.role_map,
            disable_thinking=policy.disable_thinking,
        ):
            yield evt
        return

    if provider == "anthropic":
        async for evt in _chat_anthropic(req):
            yield evt
        return

    if provider == "google":
        async for evt in _chat_google_fallback(req):
            yield evt
        return

    raise RuntimeError(f"Unsupported provider_type: {provider}")

