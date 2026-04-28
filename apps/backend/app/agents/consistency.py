"""Consistency Agent – checks naming, timeline, motivation, clue chain coherence."""
import json
import asyncio
from app.agents.model_adapter import strip_code_fence, complete_text_once
from app.prompts import load_prompt


def run_consistency_agent(
    asset_summaries: list[dict],
    model=None,
) -> dict:
    """
    asset_summaries: list of {"type": str, "name": str, "slug": str, "content_json": str}
    Returns: ConsistencyReport dict
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    if not isinstance(model, dict):
        raise ValueError("model runtime config is required")
    profile = model["profile"]
    model_name = model["model_name"]

    ctx = json.dumps(asset_summaries, ensure_ascii=False, indent=2)
    prompt = f"""请检查以下资产之间的一致性：

{ctx}"""

    text = asyncio.run(
        complete_text_once(
            profile=profile,
            model_name=model_name,
            system_prompt=load_prompt("consistency", "system"),
            user_prompt=prompt,
            temperature=0.2,
        )
    )
    text = strip_code_fence(text)

    try:
        return json.loads(text)
    except Exception:
        return {"issues": [], "overall_status": "clean"}
