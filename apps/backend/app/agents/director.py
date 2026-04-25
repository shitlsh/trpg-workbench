"""Director Agent – tool-calling autonomous agent.

The Director is the single entry point for all user requests. It has access to
a set of tools to read and write the workspace. Write tools generate PatchProposals
that require user confirmation before being applied.
"""
from __future__ import annotations
import json
from agno.agent import Agent
from agno.models.message import Message
from app.agents.model_adapter import strip_code_fence
from app.agents.tools import (
    ALL_TOOLS, PatchProposalInterrupt, configure as configure_tools,
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

    return Agent(
        model=model,
        tools=ALL_TOOLS,
        instructions=[system_prompt],
        markdown=False,
    )


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
    Events: text_delta, tool_call_start, tool_call_result, patch_proposal, done, error
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

    # Build messages list: history + current prompt (handled below)

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
        async for chunk in await agent.arun(
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
                            "arguments": "",
                        },
                    }

            # Tool call completed (result)
            elif event_type == "ToolCallCompleted":
                tool = getattr(chunk, "tool", None)
                raw_content = str(getattr(chunk, "content", "") or "")
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
                            "success": True,
                            "summary": raw_content[:200],
                        },
                    }

        yield {"event": "done", "data": {}}

    except PatchProposalInterrupt as pp:
        yield {"event": "patch_proposal", "data": pp.proposal}
        # Confirm/reject happen via separate HTTP endpoints, not this stream.
        yield {"event": "done", "data": {}}

    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}
        yield {"event": "done", "data": {}}
