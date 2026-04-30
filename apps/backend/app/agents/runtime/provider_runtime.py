from __future__ import annotations

import asyncio
import inspect
import json
from dataclasses import dataclass
from typing import Any

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from app.agents.model_adapter import DEFAULT_MAX_TOKENS_ANTHROPIC
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
    force_disable_thinking: bool = False


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


def _start_tool_call(
    fn: Any,
    args: dict[str, Any],
    tool_call_id: str,
    loop: asyncio.AbstractEventLoop,
) -> tuple[asyncio.Task, asyncio.Queue]:
    sig = inspect.signature(fn)
    accepted = {k: v for k, v in args.items() if k in sig.parameters}

    trace_q: asyncio.Queue = asyncio.Queue()

    def _trace_emitter(_call_id: str, line: str) -> None:
        loop.call_soon_threadsafe(trace_q.put_nowait, line)

    def _run():
        from app.agents.tools import set_tool_trace_context, reset_tool_trace_context

        tokens = set_tool_trace_context(tool_call_id, _trace_emitter)
        try:
            return fn(**accepted)
        finally:
            reset_tool_trace_context(tokens)

    task = asyncio.create_task(asyncio.to_thread(_run))
    return task, trace_q


def _best_effort_json_args(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _extract_trace_lines(raw: str) -> list[str]:
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, dict):
        return []
    trace = data.get("_trace")
    if not isinstance(trace, list):
        return []
    out: list[str] = []
    for t in trace:
        if isinstance(t, str):
            out.append(t)
    return out


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
        reasoning_parts: list[str] = []
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
                reasoning_parts.append(reasoning)
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
        reasoning_content = "".join(reasoning_parts)
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
        if reasoning_content:
            assistant_msg["reasoning_content"] = reasoning_content
        messages.append(assistant_msg)

        for tc in tool_calls:
            name = tc["function"]["name"] or ""
            raw_args = tc["function"]["arguments"] or "{}"
            args = _best_effort_json_args(raw_args)
            tc_id = tc["id"] or ""
            emitted_trace_lines: list[str] = []
            fn = tool_map.get(name)
            if fn is None:
                result = json.dumps({"success": False, "error": f"Unknown tool: {name}"}, ensure_ascii=False)
                success = False
            else:
                loop = asyncio.get_running_loop()
                tool_task, trace_q = _start_tool_call(fn, args, tc_id, loop)
                while True:
                    if tool_task.done():
                        break
                    try:
                        line = await asyncio.wait_for(trace_q.get(), timeout=0.12)
                    except asyncio.TimeoutError:
                        continue
                    emitted_trace_lines.append(str(line))
                    yield {
                        "event": "tool_trace",
                        "data": {"id": tc_id, "delta": str(line)},
                    }
                while True:
                    try:
                        line = trace_q.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    emitted_trace_lines.append(str(line))
                    yield {
                        "event": "tool_trace",
                        "data": {"id": tc_id, "delta": str(line)},
                    }
                try:
                    raw = await tool_task
                    result = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
                    success = True
                except Exception as exc:
                    if exc.__class__.__name__ == "AgentQuestionInterrupt":
                        raise
                    result = f"Tool execution failed: {exc}"
                    success = False
            messages.append({"role": "tool", "tool_call_id": tc_id, "name": name, "content": result})
            trace_lines = _extract_trace_lines(result)
            if trace_lines and len(trace_lines) > len(emitted_trace_lines):
                # Backward-compatible fallback for tools that only return final _trace.
                # Emit missing tail as delta lines (incremental UI updates).
                for line in trace_lines[len(emitted_trace_lines) :]:
                    yield {"event": "tool_trace", "data": {"id": tc_id, "delta": line}}
            yield {
                "event": "tool_call_result",
                "data": {"id": tc_id, "success": success, "summary": result},
            }


def _to_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    """Convert internal message list to Anthropic API format.

    Anthropic requires strictly alternating user/assistant turns.  When a
    single assistant turn emits multiple tool_use blocks, all their results
    must be packed into **one** ``role: "user"`` message as a list of
    ``tool_result`` blocks — consecutive separate user messages are rejected.
    """
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
            tool_block: dict[str, Any] = {
                "type": "tool_result",
                "tool_use_id": m.get("tool_call_id") or "",
                "content": content,
            }
            # Merge into the preceding user message when it already holds
            # tool_result blocks (parallel tools from the same assistant turn).
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                out[-1]["content"].append(tool_block)
            else:
                out.append({"role": "user", "content": [tool_block]})
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
            "max_tokens": DEFAULT_MAX_TOKENS_ANTHROPIC,
            "temperature": req.temperature,
        }
        if tool_specs:
            req_kw["tools"] = tool_specs
        async with client.messages.stream(**req_kw) as stream:
            async for text in stream.text_stream:
                if text:
                    yield {"event": "text_delta", "data": {"content": text}}
            resp = await stream.get_final_message()

        text_parts: list[str] = []
        tool_uses: list[Any] = []
        for block in resp.content:
            if getattr(block, "type", "") == "text":
                text_parts.append(getattr(block, "text", "") or "")
            elif getattr(block, "type", "") == "tool_use":
                tool_uses.append(block)

        text = "".join(text_parts)

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
            emitted_trace_lines: list[str] = []
            fn = tool_map.get(tu.name or "")
            if fn is None:
                result = json.dumps({"success": False, "error": f"Unknown tool: {tu.name}"}, ensure_ascii=False)
                success = False
            else:
                loop = asyncio.get_running_loop()
                tool_task, trace_q = _start_tool_call(fn, args, tu.id or "", loop)
                while True:
                    if tool_task.done():
                        break
                    try:
                        line = await asyncio.wait_for(trace_q.get(), timeout=0.12)
                    except asyncio.TimeoutError:
                        continue
                    emitted_trace_lines.append(str(line))
                    yield {
                        "event": "tool_trace",
                        "data": {"id": tu.id or "", "delta": str(line)},
                    }
                while True:
                    try:
                        line = trace_q.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    emitted_trace_lines.append(str(line))
                    yield {
                        "event": "tool_trace",
                        "data": {"id": tu.id or "", "delta": str(line)},
                    }
                try:
                    raw = await tool_task
                    result = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
                    success = True
                except Exception as exc:
                    if exc.__class__.__name__ == "AgentQuestionInterrupt":
                        raise
                    result = f"Tool execution failed: {exc}"
                    success = False
            messages.append({"role": "tool", "tool_call_id": tu.id, "name": tu.name, "content": result})
            trace_lines = _extract_trace_lines(result)
            if trace_lines and len(trace_lines) > len(emitted_trace_lines):
                for line in trace_lines[len(emitted_trace_lines) :]:
                    yield {"event": "tool_trace", "data": {"id": tu.id or "", "delta": line}}
            yield {
                "event": "tool_call_result",
                "data": {"id": tu.id or "", "success": success, "summary": result},
            }


def _to_gemini_contents(messages: list[dict]) -> list[Any]:
    """Convert internal messages to google-genai ``Content`` objects.

    Roles: ``user`` → ``"user"``, ``assistant`` / ``model`` → ``"model"``.
    ``tool`` results are packed as ``FunctionResponse`` parts inside a user turn;
    consecutive tool results for the same assistant turn are merged into one
    Content so the history stays alternating.
    """
    from google.genai import types  # local import to keep the module optional

    out: list[Any] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            continue  # passed via GenerateContentConfig.system_instruction
        if role in ("user",):
            out.append(types.Content(role="user", parts=[types.Part(text=content or "")]))
        elif role in ("assistant", "model"):
            # assistant messages may carry tool_call blocks in list form (Anthropic
            # style); for Gemini history we only need the text.
            if isinstance(content, list):
                text = " ".join(
                    b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
                )
            else:
                text = content or ""
            out.append(types.Content(role="model", parts=[types.Part(text=text)]))
        elif role == "tool":
            # Gemini expects function responses in a user Content.
            # Merge consecutive tool results (parallel calls) into one Content.
            name = m.get("name") or ""
            raw = content
            try:
                resp_val: Any = json.loads(raw)
            except Exception:
                resp_val = {"result": raw}
            fr_part = types.Part(
                function_response=types.FunctionResponse(name=name, response=resp_val)
            )
            if out and getattr(out[-1], "role", None) == "user":
                # Peek: if last Content is already a function-response user turn,
                # append the part to it instead of creating a new Content.
                last_parts = list(out[-1].parts or [])
                if last_parts and getattr(last_parts[0], "function_response", None) is not None:
                    out[-1] = types.Content(role="user", parts=last_parts + [fr_part])
                    continue
            out.append(types.Content(role="user", parts=[fr_part]))
    return out


async def _chat_google(req: RuntimeRequest):
    """Gemini native SDK: streaming text + full tool-calling loop."""
    from google import genai
    from google.genai import types

    profile = req.profile
    api_key = _decrypt_key(profile)
    if not api_key:
        raise RuntimeError("Google API key is required")

    client = genai.Client(api_key=api_key)
    tool_map = {t.__name__: t for t in req.tools}

    # Build Gemini FunctionDeclaration tool specs
    gemini_tools: list[Any] = []
    if req.tools:
        decls = []
        for spec in build_openai_tool_specs(req.tools):
            fn = spec["function"]
            decls.append(
                types.FunctionDeclaration(
                    name=fn["name"],
                    description=fn["description"],
                    parameters=fn["parameters"],
                )
            )
        gemini_tools = [types.Tool(function_declarations=decls)]

    all_messages = [{"role": "system", "content": req.system_prompt}] + req.messages
    contents = _to_gemini_contents(all_messages)

    for _ in range(req.max_tool_rounds):
        config = types.GenerateContentConfig(
            system_instruction=req.system_prompt,
            temperature=req.temperature,
            tools=gemini_tools if gemini_tools else None,
        )

        text_parts: list[str] = []
        function_calls: list[Any] = []
        last_response: Any = None

        async for chunk in await client.aio.models.generate_content_stream(
            model=req.model_name,
            contents=contents,
            config=config,
        ):
            last_response = chunk
            # Stream text deltas
            chunk_text = getattr(chunk, "text", None)
            if chunk_text:
                text_parts.append(chunk_text)
                yield {"event": "text_delta", "data": {"content": chunk_text}}

        # Extract function_call parts from the final response candidates
        if last_response is not None:
            candidates = getattr(last_response, "candidates", None) or []
            for cand in candidates:
                cand_content = getattr(cand, "content", None)
                if cand_content is None:
                    continue
                for part in getattr(cand_content, "parts", None) or []:
                    fc = getattr(part, "function_call", None)
                    if fc is not None:
                        function_calls.append(fc)

        if not function_calls:
            break

        # Append model turn (text + function_calls) to contents
        model_parts: list[Any] = []
        joined_text = "".join(text_parts)
        if joined_text:
            model_parts.append(types.Part(text=joined_text))
        for fc in function_calls:
            model_parts.append(
                types.Part(
                    function_call=types.FunctionCall(
                        name=getattr(fc, "name", "") or "",
                        args=dict(getattr(fc, "args", {}) or {}),
                    )
                )
            )
        contents.append(types.Content(role="model", parts=model_parts))

        # Execute tools and collect results into a single user Content
        result_parts: list[Any] = []
        for fc in function_calls:
            name = getattr(fc, "name", "") or ""
            args = dict(getattr(fc, "args", {}) or {})
            yield {
                "event": "tool_call_start",
                "data": {
                    "id": name,
                    "name": name,
                    "arguments": json.dumps(args, ensure_ascii=False),
                },
            }
            fn = tool_map.get(name)
            if fn is None:
                resp_val: Any = {"success": False, "error": f"Unknown tool: {name}"}
                success = False
                result = json.dumps(resp_val, ensure_ascii=False)
            else:
                try:
                    loop = asyncio.get_running_loop()
                    tool_task, trace_q = _start_tool_call(fn, args, name, loop)
                    while True:
                        if tool_task.done():
                            break
                        try:
                            line = await asyncio.wait_for(trace_q.get(), timeout=0.12)
                        except asyncio.TimeoutError:
                            continue
                        yield {"event": "tool_trace", "data": {"id": name, "delta": str(line)}}
                    while True:
                        try:
                            line = trace_q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        yield {"event": "tool_trace", "data": {"id": name, "delta": str(line)}}
                    raw = await tool_task
                    result = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
                    success = True
                    try:
                        resp_val = json.loads(result)
                    except Exception:
                        resp_val = {"result": result}
                except Exception as exc:
                    if exc.__class__.__name__ == "AgentQuestionInterrupt":
                        raise
                    result = f"Tool execution failed: {exc}"
                    resp_val = {"error": result}
                    success = False

            result_parts.append(
                types.Part(
                    function_response=types.FunctionResponse(name=name, response=resp_val)
                )
            )
            yield {
                "event": "tool_call_result",
                "data": {"id": name, "success": success, "summary": result},
            }

        # All tool results go into a single user Content (Gemini requirement)
        contents.append(types.Content(role="user", parts=result_parts))


async def run_provider_runtime(req: RuntimeRequest):
    policy = resolve_policy(req.profile, req.model_name)
    provider = policy.provider
    if provider in {"openai", "openrouter", "openai_compatible"}:
        disable_thinking = bool(policy.disable_thinking or req.force_disable_thinking)
        async for evt in _chat_openai_like(
            req,
            role_map=policy.role_map,
            disable_thinking=disable_thinking,
        ):
            yield evt
        return

    if provider == "anthropic":
        async for evt in _chat_anthropic(req):
            yield evt
        return

    if provider == "google":
        async for evt in _chat_google(req):
            yield evt
        return

    raise RuntimeError(f"Unsupported provider_type: {provider}")

