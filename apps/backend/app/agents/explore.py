"""Explore Agent – read-only tool-calling agent for workspace navigation."""
from __future__ import annotations

from app.agents.chat_input_messages import build_chat_input_messages
from app.agents.director import _build_workspace_snapshot
from app.agents.runtime import RuntimeRequest, run_provider_runtime
from app.agents.tools import (
    EXPLORE_TOOLS,
    configure as configure_tools,
)
from app.prompts import load_prompt


def build_explore_prompt(workspace_context: dict) -> str:
    system_prompt = load_prompt("explore", "system")
    style = workspace_context.get("style_prompt")
    if style:
        prefix = load_prompt("_shared", "style_prefix", style_prompt=style)
        system_prompt = f"{prefix}\n\n{system_prompt}"
    return f"{system_prompt}\n\n{_build_workspace_snapshot(workspace_context)}"


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

    if not isinstance(model, dict):
        yield {"event": "error", "data": {"message": "LLM runtime config 无效"}}
        return
    configure_tools(workspace_context, db, model=model)

    prompt = user_message
    if referenced_assets:
        refs_block = "\n\n".join(
            f"[引用资产: {a['name']}]\n{a['content']}" for a in referenced_assets
        )
        prompt = f"{refs_block}\n\n---\n\n{user_message}"

    input_messages = build_chat_input_messages(history, prompt)

    try:
        req = RuntimeRequest(
            profile=model["profile"],
            model_name=model["model_name"],
            system_prompt=build_explore_prompt(workspace_context),
            messages=input_messages,
            tools=EXPLORE_TOOLS,
            temperature=temperature,
        )
        async for evt in run_provider_runtime(req):
            yield evt
        yield {"event": "done", "data": {}}

    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}
        yield {"event": "done", "data": {}}
