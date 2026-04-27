"""Director Agent – tool-calling autonomous agent.

The Director is the single entry point for all user requests. It has access to
a set of tools to read and write the workspace. Write tools write directly to
disk and return results immediately — no user confirmation step.
"""
from __future__ import annotations
import json
import uuid
from agno.agent import Agent
from agno.models.message import Message
from app.agents.chat_input_messages import build_chat_input_messages
from app.agents.model_adapter import strip_code_fence
from app.agents.tools import (
    ALL_TOOLS, configure as configure_tools, AgentQuestionInterrupt,
)
from app.prompts import load_prompt


def build_director(model, workspace_context: dict, db, temperature: float = 0.7) -> Agent:
    """Build a Director Agent instance with tools configured for the given workspace."""
    configure_tools(workspace_context, db, model=model)

    system_prompt = load_prompt("director", "system")

    # Inject style_prompt if present (template in prompts/_shared/style_prefix.txt)
    style = workspace_context.get("style_prompt")
    if style:
        prefix = load_prompt("_shared", "style_prefix", style_prompt=style)
        system_prompt = f"{prefix}\n\n{system_prompt}"

    # Inject workspace snapshot so model doesn't need to call read_config/list_assets
    snapshot = _build_workspace_snapshot(workspace_context)
    system_prompt = f"{system_prompt}\n\n{snapshot}"

    agent_kw = dict(
        model=model,
        tools=ALL_TOOLS,
        instructions=[system_prompt],
        markdown=False,
    )
    try:
        return Agent(**agent_kw, temperature=temperature)
    except TypeError:
        return Agent(**agent_kw)


def _build_workspace_snapshot(workspace_context: dict) -> str:
    """Build a concise workspace snapshot string to inject into the system prompt.
    
    This avoids the model needing to call read_config/list_assets at the start
    of every request, saving 1-2 tool-call rounds.
    """
    name = workspace_context.get("workspace_name", "未命名")
    rule_set = workspace_context.get("rule_set", "未设置")
    style = workspace_context.get("style_prompt")
    custom_types = workspace_context.get("custom_asset_types", [])
    assets = workspace_context.get("existing_assets", [])

    lines = [
        "## 当前工作空间快照（请勿重复调用 read_config / list_assets 获取此信息）",
        f"- 工作空间：{name}",
        f"- 规则集：{rule_set}",
    ]
    if style:
        lines.append(f"- 创作风格：{style[:80]}{'…' if len(style) > 80 else ''}")
    if custom_types:
        type_names = "、".join(t.get("name", "") for t in custom_types[:10])
        lines.append(f"- 自定义资产类型：{type_names}")

    if not assets:
        lines.append("- 现有资产：（空，尚无资产）")
    else:
        lines.append(f"- 现有资产（共 {len(assets)} 个）：")
        for a in assets[:30]:  # cap at 30 to avoid token bloat
            summary = a.get("summary") or ""
            summary_part = f" — {summary[:60]}" if summary else ""
            lines.append(f"  - [{a.get('type','')}] {a.get('name','')} (slug: {a.get('slug','')}){summary_part}")
        if len(assets) > 30:
            lines.append(f"  - … 还有 {len(assets) - 30} 个资产，可用 list_assets 刷新")

    lines.append("（如需获取最新资产列表，可调用 list_assets 刷新；否则以上快照即为当前状态）")
    return "\n".join(lines)


async def run_director_stream(
    user_message: str,
    workspace_context: dict,
    model,
    history: list[dict] | None = None,
    referenced_assets: list[dict] | None = None,
    db=None,
    temperature: float = 0.7,
):
    """Async generator yielding SSE event dicts.

    Yields dicts with keys: event, data
    Events: text_delta, tool_call_start, tool_call_result, auto_applied, done, error
    """
    if model is None:
        yield {"event": "error", "data": {"message": "未配置 LLM，请在工作区设置中配置 LLM Profile"}}
        return

    agent = build_director(model, workspace_context, db, temperature=temperature)

    # Build full prompt (inject referenced assets if any)
    prompt = user_message
    if referenced_assets:
        refs_block = "\n\n".join(
            f"[引用资产: {a['name']}]\n{a['content']}" for a in referenced_assets
        )
        prompt = f"{refs_block}\n\n---\n\n{user_message}"

    # History may include leading role=system (compact summary); fold into first user turn
    input_messages: list[Message] = build_chat_input_messages(history, prompt)

    try:
        # State machine for parsing inline <think>...</think> blocks from models
        # like Qwen3 that embed reasoning in the main content stream rather than
        # emitting a dedicated ReasoningContentDelta event.
        _in_think = False   # True while inside a <think> block
        _think_buf = ""     # Accumulates partial tag chars across chunk boundaries

        async for chunk in agent.arun(
            input_messages,
            stream=True,
            stream_events=True,
        ):
            event_type = getattr(chunk, "event", None)

            # Text delta — may contain inline <think>...</think> from Qwen3
            if event_type == "RunContent":
                # Gemini separates thinking into reasoning_content on the same RunContent event
                gemini_thinking = getattr(chunk, "reasoning_content", None)
                if gemini_thinking:
                    yield {"event": "thinking_delta", "data": {"content": gemini_thinking}}

                raw = _think_buf + (getattr(chunk, "content", None) or "")
                _think_buf = ""

                while raw:
                    if _in_think:
                        end = raw.find("</think>")
                        if end == -1:
                            # Check if a partial </think> tag is split at the boundary
                            # Keep up to 8 chars at the end as a potential partial tag
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
                            # Check for a partial <think> tag at the end
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

            # Reasoning/thinking delta (Claude extended thinking, etc.)
            elif event_type == "ReasoningContentDelta" and getattr(chunk, "reasoning_content", None):
                yield {"event": "thinking_delta", "data": {"content": chunk.reasoning_content}}

            # Tool call started
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

            # Tool call completed (result)
            elif event_type == "ToolCallCompleted":
                tool = getattr(chunk, "tool", None)
                raw_content = str(
                    (getattr(tool, "result", None) if tool is not None else None)
                    or getattr(chunk, "content", None)
                    or ""
                )
                if tool is not None:
                    try:
                        payload = json.loads(raw_content)
                        if isinstance(payload, dict) and payload.get("auto_applied"):
                            yield {"event": "auto_applied", "data": payload}
                            continue
                    except Exception:
                        pass
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

    except AgentQuestionInterrupt as e:
        q_id = f"q_{uuid.uuid4().hex[:12]}"
        yield {"event": "agent_question", "data": {"id": q_id, "questions": e.questions}}
        yield {"event": "done", "data": {}}

    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}
        yield {"event": "done", "data": {}}
