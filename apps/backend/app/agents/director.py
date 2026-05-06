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
from app.knowledge.types import build_chunk_types_section

# M30: canonical 6 built-in types — order determines injection order in prompt
_BUILTIN_TYPE_KEYS = ["outline", "stage", "npc", "monster", "map", "clue"]


def _extract_section(text: str, heading: str) -> str:
    """Extract the body of a Markdown section (from ## heading to the next ## heading)."""
    lines = text.splitlines()
    in_section = False
    result = []
    for line in lines:
        if line.strip() == f"## {heading}":
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section:
            result.append(line)
    return "\n".join(result).strip()


def _build_asset_types_section(workspace_context: dict) -> str:
    """Build a compact asset type index injected into every Director prompt turn.

    Only injects: type name + one-line scope summary + required fields before creation.
    Full Markdown chapter templates are NOT included here — they are available on demand
    via the `get_asset_type_spec(type_key)` tool, called when Director is about to write
    content_md for a new asset of that type.

    This keeps per-turn overhead to ~400 tokens instead of ~5,500 tokens.
    """
    lines = [
        "## 可用资产类型",
        "创建资产时必须从以下列表选择 `asset_type`。",
        "**在开始编写 `content_md` 之前，调用 `get_asset_type_spec(type_key)` 获取完整章节模板。**",
        "",
    ]

    # Built-in types — scope summary extracted from first paragraph of 「范围与用途」
    _BUILTIN_SUMMARIES = {
        "outline": "整体故事框架，含世界背景设定和主要分支结局。必须提供：故事主题 + 主要矛盾。",
        "stage":   "故事单元（幕），含事件序列和 NPC 出场安排。必须提供：场景名称 + 核心事件。",
        "npc":     "玩家会直接交互的角色，以动机/关系为核心。必须提供：名字 + 阵营/关系定位 + 至少一个背景元素。",
        "monster": "玩家的威胁来源，以战斗/恐惧功能为核心。必须提供：战斗角色定位 + 外形风格。",
        "map":     "地点网络，含各地点感官描述和移动路径。必须提供：地点名称 + 时代/风格背景。",
        "clue":    "可被玩家发现的关键信息载体，连接场景推动调查。必须提供：关联事件/角色 + 揭示内容方向。",
    }

    lines.append("### 内置类型")
    lines.append("")
    for type_key in _BUILTIN_TYPE_KEYS:
        summary = _BUILTIN_SUMMARIES.get(type_key, "")
        lines.append(f"- **{type_key}**：{summary}")
    lines.append("")

    # Custom types — inject name + first meaningful line of description (if any)
    custom_types = workspace_context.get("custom_asset_types", [])
    if custom_types:
        lines.append("### 自定义类型（当前规则集注册）")
        lines.append("")
        for t in custom_types:
            type_key = t.get("type_key", "")
            label = t.get("label", type_key)
            icon = t.get("icon", "")
            description = t.get("description", "").strip()
            # Extract first non-heading, non-empty line from description as one-liner
            oneliner = ""
            if description:
                for ln in description.splitlines():
                    stripped = ln.strip()
                    if stripped and not stripped.startswith("#"):
                        oneliner = stripped[:120]
                        break
            required = ""
            if description:
                req_body = _extract_section(description, "创建前必须提供")
                if req_body:
                    req_lines = [l.strip() for l in req_body.splitlines() if l.strip()]
                    required = " | ".join(req_lines[:3])
            entry = f"- **{type_key}**（{icon}{label}）：{oneliner}"
            if required:
                entry += f"  必须提供：{required}"
            lines.append(entry)
        lines.append("")

    return "\n".join(lines)


def build_director_prompt(workspace_context: dict) -> str:
    system_prompt = load_prompt("director", "system")
    style = workspace_context.get("style_prompt")
    if style:
        prefix = load_prompt("_shared", "style_prefix", style_prompt=style)
        system_prompt = f"{prefix}\n\n{system_prompt}"
    asset_types_section = _build_asset_types_section(workspace_context)
    chunk_types_section = build_chunk_types_section()
    snapshot = _build_workspace_snapshot(workspace_context)
    parts = [system_prompt]
    if asset_types_section:
        parts.append(asset_types_section)
    parts.append(chunk_types_section)
    parts.append(snapshot)
    return "\n\n".join(parts)


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
        # M30 bugfix: was t.get("name") which always returned "" — should be "label"
        type_names = "、".join(t.get("label", t.get("type_key", "")) for t in custom_types[:10])
        lines.append(f"- 自定义资产类型：{type_names}（详见上方「可用资产类型」）")

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
        _think_buf_safe = False  # True once </think> has been seen; flush text immediately after

        # <plan> tag parsing state
        _in_plan = False
        _plan_buf = ""
        _plan_emitted = False
        _plan_id: str = ""
        _plan_steps: list[dict] = []
        _plan_step_cursor = 0

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
                            _think_buf_safe = True
                            raw = raw[end + len("</think>"):]
                    elif _in_plan:
                        end = raw.find("</plan>")
                        if end == -1:
                            _plan_buf += raw
                            raw = ""
                        else:
                            _plan_buf += raw[:end]
                            _in_plan = False
                            raw = raw[end + len("</plan>"):]
                            # Parse and emit agent_plan
                            try:
                                steps_raw = json.loads(_plan_buf.strip())
                                if isinstance(steps_raw, list) and steps_raw:
                                    _plan_id = f"plan_{uuid.uuid4().hex[:12]}"
                                    _plan_steps = [
                                        {
                                            "id": s.get("id", f"s{i+1}"),
                                            "index": i,
                                            "label": s.get("label", ""),
                                            "status": "pending",
                                        }
                                        for i, s in enumerate(steps_raw)
                                        if isinstance(s, dict)
                                    ]
                                    if _plan_steps:
                                        _plan_emitted = True
                                        yield {
                                            "event": "agent_plan",
                                            "data": {
                                                "plan_id": _plan_id,
                                                "steps": _plan_steps,
                                            },
                                        }
                            except Exception:
                                # Malformed JSON — silently ignore, degrade gracefully
                                pass
                    else:
                        # Check for <think> first, then <plan>
                        think_start = raw.find("<think>")
                        plan_start = raw.find("<plan>")

                        next_tag_start = -1
                        next_tag = None
                        if think_start != -1 and (plan_start == -1 or think_start <= plan_start):
                            next_tag_start = think_start
                            next_tag = "think"
                        elif plan_start != -1:
                            next_tag_start = plan_start
                            next_tag = "plan"

                        if next_tag_start == -1:
                            # No special tags found.
                            # Only guard against partial tag at end if we haven't
                            # finished thinking yet — once thinking is done, no
                            # more <think>/<plan> tags are expected and we can
                            # flush the entire buffer immediately.
                            if _in_think or not _think_buf_safe:
                                safe = max(0, len(raw) - 7)
                                if safe > 0:
                                    yield {"event": "text_delta", "data": {"content": raw[:safe]}}
                                _think_buf = raw[safe:]
                            else:
                                yield {"event": "text_delta", "data": {"content": raw}}
                                _think_buf = ""
                            raw = ""
                        else:
                            if next_tag_start > 0:
                                yield {"event": "text_delta", "data": {"content": raw[:next_tag_start]}}
                            if next_tag == "think":
                                _in_think = True
                                raw = raw[next_tag_start + len("<think>"):]
                            else:
                                _in_plan = True
                                _plan_buf = ""
                                raw = raw[next_tag_start + len("<plan>"):]
                continue
            if evt.get("event") == "tool_call_start":
                data = evt.get("data", {})
                call_name_by_id[data.get("id", "")] = data.get("name", "")
                # Advance plan step to "running" (sequential mapping)
                if _plan_emitted and _plan_step_cursor < len(_plan_steps):
                    step = _plan_steps[_plan_step_cursor]
                    yield {
                        "event": "agent_plan_update",
                        "data": {
                            "plan_id": _plan_id,
                            "step_id": step["id"],
                            "status": "running",
                            "tool_call_id": data.get("id", ""),
                        },
                    }
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
                # Advance plan step to "done" or "error" (sequential mapping)
                if _plan_emitted and _plan_step_cursor < len(_plan_steps):
                    step = _plan_steps[_plan_step_cursor]
                    step_status = "done" if bool(data.get("success")) else "error"
                    yield {
                        "event": "agent_plan_update",
                        "data": {
                            "plan_id": _plan_id,
                            "step_id": step["id"],
                            "status": step_status,
                        },
                    }
                    _plan_step_cursor += 1
            # Native reasoning_content thinking_delta: once we see any thinking,
            # it's safe to flush text immediately when thinking ends.
            if evt.get("event") == "thinking_delta":
                _think_buf_safe = True
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
