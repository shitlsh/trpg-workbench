"""Map chat history dicts to native runtime message list.

Leading ``role: "system"`` messages (e.g. compaction summary from chat.py) are
merged into the first user turn so the model actually sees them — Agno Agent
already uses ``instructions=`` for the system prompt, so we fold runtime system
lines into the first *user* message, or insert a *user* line before a leading
*assistant* turn.
"""
from __future__ import annotations

def build_chat_input_messages(
    history: list[dict] | None,
    final_user_content: str,
) -> list[dict]:
    """Build messages for provider runtimes: history + current user turn.

    * Only **leading** ``role == "system"`` entries (after optional leading empty
      rows) are treated as merged prefix text, matching
      :func:`append_message` + truncation flow in ``chat.py``.
    * The current turn is always ``final_user_content`` (already includes @refs).
    """
    h = history or []
    # Leading system messages (compact summary) — only contiguous from start
    i = 0
    system_parts: list[str] = []
    while i < len(h) and h[i].get("role") == "system":
        c = h[i].get("content")
        if isinstance(c, str) and c.strip():
            system_parts.append(c)
        i += 1
    prefix = "\n\n".join(system_parts) if system_parts else ""

    rest: list[dict] = []
    for msg in h[i:]:
        role = msg.get("role", "user")
        content = msg.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if role in ("user", "assistant"):
            item: dict = {"role": role, "content": content}
            rc = msg.get("reasoning_content")
            if role == "assistant" and isinstance(rc, str) and rc.strip():
                item["reasoning_content"] = rc
            rest.append(item)

    if not rest:
        if prefix:
            return [{"role": "user", "content": f"{prefix}\n\n{final_user_content}"}]
        return [{"role": "user", "content": final_user_content}]

    out: list[dict] = []
    for idx, item in enumerate(rest):
        role = item["role"]
        content = item["content"]
        reasoning_content = item.get("reasoning_content")
        if idx == 0 and prefix:
            if role == "user":
                content = f"{prefix}\n\n{content}"
            else:
                out.append({"role": "user", "content": prefix})
        if role == "assistant" and isinstance(reasoning_content, str) and reasoning_content.strip():
            out.append({"role": role, "content": content, "reasoning_content": reasoning_content})
        else:
            out.append({"role": role, "content": content})

    out.append({"role": "user", "content": final_user_content})
    return out
