"""Director runtime (native SDK based)."""
from __future__ import annotations
import json
import uuid
from app.agents.chat_input_messages import build_chat_input_messages
from app.agents.runtime import RuntimeRequest, run_provider_runtime
from app.agents.tools import (
    ALL_TOOLS,
    configure as configure_tools,
    AgentQuestionInterrupt,
)
from app.prompts import load_prompt


def build_director_prompt(workspace_context: dict) -> str:
    system_prompt = load_prompt("director", "system")
    style = workspace_context.get("style_prompt")
    if style:
        prefix = load_prompt("_shared", "style_prefix", style_prompt=style)
        system_prompt = f"{prefix}\n\n{system_prompt}"
    snapshot = _build_workspace_snapshot(workspace_context)
    return f"{system_prompt}\n\n{snapshot}"


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


# create/patch/update asset + create_skill: successful JSON → `tool_call_result` with `workspace_mutating: true`
# (UI green “已应用” + mid-stream asset tree refresh). Not related to removed “trust mode”.
_WORKSPACE_MUTATING_TOOL_NAMES = frozenset({
    "create_asset",
    "patch_asset",
    "update_asset",
    "create_skill",
})


def _workspace_mutating_result(tool, raw_content: str) -> bool:
    """True if this tool result should refresh workspace assets in the client (streaming)."""
    if tool is None or getattr(tool, "tool_call_error", False):
        return False
    name = (getattr(tool, "tool_name", None) or "").strip()
    if name not in _WORKSPACE_MUTATING_TOOL_NAMES:
        return False
    try:
        payload = json.loads(raw_content)
    except Exception:
        return False
    return isinstance(payload, dict) and bool(payload.get("success"))


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
    Events: text_delta, tool_call_start, tool_call_result, done, error
    (`tool_call_result` may include `workspace_mutating: true` for successful asset/skill writes — see `_WORKSPACE_MUTATING_TOOL_NAMES`.)
    """
    if model is None:
        yield {"event": "error", "data": {"message": "未配置 LLM，请在工作区设置中配置 LLM Profile"}}
        return
    if not isinstance(model, dict):
        yield {"event": "error", "data": {"message": "LLM runtime config 无效"}}
        return
    configure_tools(workspace_context, db, model=model)

    # Build full prompt (inject referenced assets if any)
    prompt = user_message
    if referenced_assets:
        refs_block = "\n\n".join(
            f"[引用资产: {a['name']}]\n{a['content']}" for a in referenced_assets
        )
        prompt = f"{refs_block}\n\n---\n\n{user_message}"

    input_messages = build_chat_input_messages(history, prompt)

    try:
        call_name_by_id: dict[str, str] = {}
        _in_think = False
        _think_buf = ""
        req = RuntimeRequest(
            profile=model["profile"],
            model_name=model["model_name"],
            system_prompt=build_director_prompt(workspace_context),
            messages=input_messages,
            tools=ALL_TOOLS,
            temperature=temperature,
            force_disable_thinking=bool(model.get("force_disable_thinking")),
        )
        async for evt in run_provider_runtime(req):
            if evt.get("event") == "text_delta":
                raw = _think_buf + str((evt.get("data") or {}).get("content", ""))
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
                            raw = raw[end + len("</think>") :]
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
                            raw = raw[start + len("<think>") :]
                continue
            if evt.get("event") == "tool_call_start":
                data = evt.get("data", {})
                call_name_by_id[data.get("id", "")] = data.get("name", "")
            if evt.get("event") == "tool_call_result":
                data = evt.get("data", {})
                raw_content = str(data.get("summary", ""))
                call_id = data.get("id", "")
                name = call_name_by_id.get(call_id, "")
                # Only trigger workspace refresh when the tool explicitly reports success.
                ws_mut = False
                if name in _WORKSPACE_MUTATING_TOOL_NAMES and bool(data.get("success")):
                    try:
                        payload = json.loads(raw_content)
                        ws_mut = isinstance(payload, dict) and bool(payload.get("success"))
                    except Exception:
                        pass
                evt["data"]["workspace_mutating"] = ws_mut
            yield evt
        if _think_buf:
            evt_name = "thinking_delta" if _in_think else "text_delta"
            yield {"event": evt_name, "data": {"content": _think_buf}}
        yield {"event": "done", "data": {}}

    except AgentQuestionInterrupt as e:
        q_id = f"q_{uuid.uuid4().hex[:12]}"
        yield {"event": "agent_question", "data": {"id": q_id, "questions": e.questions}}
        yield {"event": "done", "data": {}}

    except Exception as e:
        yield {"event": "error", "data": {"message": str(e)}}
        yield {"event": "done", "data": {}}
