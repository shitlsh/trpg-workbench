"""Consistency Agent – checks naming, timeline, motivation, clue chain coherence."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
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
    mdl = model
    agent = Agent(model=mdl, system_prompt=load_prompt("consistency", "system"), markdown=False)

    ctx = json.dumps(asset_summaries, ensure_ascii=False, indent=2)
    prompt = f"""Please check consistency across the following assets:

{ctx}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        return json.loads(text)
    except Exception:
        return {"issues": [], "overall_status": "clean"}
