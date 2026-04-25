"""Director Agent – tool-calling autonomous agent.

The Director is the single entry point for all user requests. It has access to
a set of tools to read and write the workspace. Write tools generate PatchProposals
that require user confirmation before being applied.
"""
from __future__ import annotations
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.agents.tools import (
    ALL_TOOLS, PatchProposalInterrupt, configure as configure_tools,
)
from app.prompts import load_prompt


def build_director(model, workspace_context: dict, db) -> Agent:
    """Build a Director Agent instance with tools configured for the given workspace."""
    configure_tools(workspace_context, db)

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
        show_tool_calls=False,
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

    # Build messages list for multi-turn history
    messages: list = []
    if history:
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    try:
        async for chunk in await agent.arun(
            message=prompt,
            messages=messages if messages else None,
            stream=True,
        ):
            # Agno streaming chunks
            if hasattr(chunk, "content") and chunk.content:
                yield {"event": "text_delta", "data": {"content": chunk.content}}
            if hasattr(chunk, "tool_calls") and chunk.tool_calls:
                for tc in chunk.tool_calls:
                    yield {
                        "event": "tool_call_start",
                        "data": {
                            "id": tc.tool_call_id or "",
                            "name": tc.tool_name or "",
                            "arguments": json.dumps(tc.tool_input or {}, ensure_ascii=False),
                        },
                    }
            if hasattr(chunk, "tool_results") and chunk.tool_results:
                for tr in chunk.tool_results:
                    yield {
                        "event": "tool_call_result",
                        "data": {
                            "id": tr.tool_call_id or "",
                            "success": True,
                            "summary": str(tr.content or "")[:200],
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
