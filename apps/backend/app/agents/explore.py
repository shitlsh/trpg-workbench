"""Explore Agent – read-only tool-calling agent for workspace navigation."""
from __future__ import annotations

import json

from agno.agent import Agent
from app.agents.chat_input_messages import build_chat_input_messages
from app.agents.director import _build_workspace_snapshot
from app.agents.tools import (
    EXPLORE_TOOLS,
    configure as configure_tools,
)
from app.prompts import load_prompt


def build_explore(model, workspace_context: dict, db, temperature: float = 0.7) -> Agent:
    """Explore: list/read/search only; no writes."""
    configure_tools(workspace_context, db, model=model)

    system_prompt = load_prompt("explore", "system")
    style = workspace_context.get("style_prompt")
    if style:
        prefix = load_prompt("_shared", "style_prefix", style_prompt=style)
        system_prompt = f"{prefix}\n\n{system_prompt}"

    system_prompt = f"{system_prompt}\n\n{_build_workspace_snapshot(workspace_context)}"

    agent_kw = dict(
        model=model,
        tools=EXPLORE_TOOLS,
        instructions=[system_prompt],
        markdown=False,
    )
    try:
        return Agent(**agent_kw, temperature=temperature)
    except TypeError:
        return Agent(**agent_kw)


async def run_explore_stream(
    user_message: str,
    workspace_context: dict,
    model,
    history: list[dict] | None = None,
    referenced_assets: list[dict] | None = None,
    db=None,
    temperature: float = 0.7,
):
    """Same SSE event shape as run_director_stream; Explore has no ask_user (no AgentQuestionInterrupt)."""
    if model is None:
        yield {"event": "error", "data": {"message": "未配置 LLM，请在工作区设置中配置 LLM Profile"}}
        return

    agent = build_explore(model, workspace_context, db, temperature=temperature)

    prompt = user_message
    if referenced_assets:
        refs_block = "\n\n".join(
            f"[引用资产: {a['name']}]\n{a['content']}" for a in referenced_assets
        )
        prompt = f"{refs_block}\n\n---\n\n{user_message}"

    input_messages = build_chat_input_messages(history, prompt)

    _in_think = False
    _think_buf = ""

    try:
        async for chunk in agent.arun(
            input_messages,
            stream=True,
            stream_events=True,
        ):
            event_type = getattr(chunk, "event", None)

            if event_type == "RunContent":
                gemini_thinking = getattr(chunk, "reasoning_content", None)
                if gemini_thinking:
                    yield {"event": "thinking_delta", "data": {"content": gemini_thinking}}

                raw = _think_buf + (getattr(chunk, "content", None) or "")
                _think_buf = ""

                while raw:
                    if _in_think:
                        end = raw.find("</think>")
                        if end == -1:
                            safe = max(0, len(raw) - 8)
                            if safe > 0:
                                yield {"event": "thinking_delta", "data": {"content": raw[:safe]}}
                            _think_buf = raw[safe:]
                            raw = ""
                        else:
                            if end > 0:
                                yield {"event": "thinking_delta", "data": {"content": raw[:end]}}
                            _in_think = False
                            raw = raw[end + len("</think>"):]
                    else:
                        start = raw.find("<think>")
                        if start == -1:
                            safe = max(0, len(raw) - 7)
                            if safe > 0:
                                yield {"event": "text_delta", "data": {"content": raw[:safe]}}
                            _think_buf = raw[safe:]
                            raw = ""
                        else:
                            if start > 0:
                                yield {"event": "text_delta", "data": {"content": raw[:start]}}
                            _in_think = True
                            raw = raw[start + len("<think>"):]

            elif event_type == "ReasoningContentDelta" and getattr(chunk, "reasoning_content", None):
                yield {"event": "thinking_delta", "data": {"content": chunk.reasoning_content}}

            elif event_type == "ToolCallStarted":
                tool = getattr(chunk, "tool", None)
                if tool:
                    yield {
                        "event": "tool_call_start",
                        "data": {
                            "id": tool.tool_call_id or "",
                            "name": tool.tool_name or "",
                            "arguments": json.dumps(tool.tool_args or {}, ensure_ascii=False),
                        },
                    }

            elif event_type == "ToolCallCompleted":
                tool = getattr(chunk, "tool", None)
                raw_content = str(
                    (getattr(tool, "result", None) if tool is not None else None)
                    or getattr(chunk, "content", None)
                    or ""
                )
                if tool is not None:
                    yield {
                        "event": "tool_call_result",
                        "data": {
                            "id": tool.tool_call_id or "",
                            "success": not tool.tool_call_error,
                            "summary": raw_content[:500],
                        },
                    }
                elif raw_content:
                    yield {
                        "event": "tool_call_result",
                        "data": {
                            "id": getattr(chunk, "tool_call_id", None) or "",
                            "success": True,
                            "summary": raw_content[:500],
                        },
                    }

        yield {"event": "done", "data": {}}

    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}
        yield {"event": "done", "data": {}}
