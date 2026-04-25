"""Director Agent – tool-calling autonomous agent.

The Director is the single entry point for all user requests. It has access to
a set of tools to read and write the workspace. Write tools write directly to
disk and return results immediately — no user confirmation step.
"""
from __future__ import annotations
import json
from agno.agent import Agent
from agno.models.message import Message
from app.agents.model_adapter import strip_code_fence
from app.agents.tools import (
    ALL_TOOLS, configure as configure_tools,
)
from app.prompts import load_prompt


def build_director(model, workspace_context: dict, db) -> Agent:
    """Build a Director Agent instance with tools configured for the given workspace."""
    configure_tools(workspace_context, db, model=model)

    system_prompt = load_prompt("director", "system")

    # Inject style_prompt if present
    style = workspace_context.get("style_prompt")
    if style:
        system_prompt = f"[创作风格约束]\n{style}\n\n{system_prompt}"

    # Inject workspace snapshot so model doesn't need to call read_config/list_assets
    snapshot = _build_workspace_snapshot(workspace_context)
    system_prompt = f"{system_prompt}\n\n{snapshot}"

    return Agent(
        model=model,
        tools=ALL_TOOLS,
        instructions=[system_prompt],
        markdown=False,
    )


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
):
    """Async generator yielding SSE event dicts.

    Yields dicts with keys: event, data
    Events: text_delta, tool_call_start, tool_call_result, auto_applied, done, error
    """
    if model is None:
        yield {"event": "error", "data": {"message": "未配置 LLM，请在工作区设置中配置 LLM Profile"}}
        return

    agent = build_director(model, workspace_context, db)

    # Build full prompt (inject referenced assets if any)
    prompt = user_message
    if referenced_assets:
        refs_block = "\n\n".join(
            f"[引用资产: {a['name']}]\n{a['content']}" for a in referenced_assets
        )
        prompt = f"{refs_block}\n\n---\n\n{user_message}"

    # Build messages list: history + current prompt
    input_messages: list[Message] = []
    if history:
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                input_messages.append(Message(role=role, content=content))
    input_messages.append(Message(role="user", content=prompt))

    try:
        async for chunk in agent.arun(
            input_messages,
            stream=True,
            stream_events=True,
        ):
            event_type = getattr(chunk, "event", None)

            # Text delta
            if event_type == "RunContent" and getattr(chunk, "content", None):
                yield {"event": "text_delta", "data": {"content": chunk.content}}

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
                # tool.result holds the actual return value of the tool function
                raw_content = str(getattr(tool, "result", None) or getattr(chunk, "content", "") or "")
                if tool:
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

        yield {"event": "done", "data": {}}

    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}
        yield {"event": "done", "data": {}}
