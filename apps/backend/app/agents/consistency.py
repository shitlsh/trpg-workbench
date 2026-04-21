"""Consistency Agent – checks naming, timeline, motivation, clue chain coherence."""
import json
from agno.agent import Agent
from app.agents.model_adapter import get_default_model, strip_code_fence

CONSISTENCY_SYSTEM = """You are the Consistency Agent for a TRPG workbench.
Your ONLY job is to check consistency across assets and report issues.
You MUST NOT modify any assets.

Check for:
1. Naming conflicts (same entity called different names across assets)
2. Timeline conflicts (events in impossible order)
3. Motivation gaps (NPC behavior contradicts stated motivation)
4. Clue breaks (clue chain has gaps – clues can't be found or don't connect)
5. Branch conflicts (contradictory outcomes across branches)

Respond ONLY with a JSON object:
{
  "issues": [
    {
      "type": "naming_conflict | timeline_conflict | motivation_gap | clue_break | branch_conflict",
      "severity": "warning | error",
      "description": "...",
      "affected_assets": ["asset_slug_1", "asset_slug_2"],
      "suggestion": "..."
    }
  ],
  "overall_status": "clean | has_warnings | has_errors"
}

If no issues found, return {"issues": [], "overall_status": "clean"}.
"""


def run_consistency_agent(
    asset_summaries: list[dict],
    model=None,
) -> dict:
    """
    asset_summaries: list of {"type": str, "name": str, "slug": str, "content_json": str}
    Returns: ConsistencyReport dict
    """
    mdl = model or get_default_model()
    agent = Agent(model=mdl, system_prompt=CONSISTENCY_SYSTEM, markdown=False)

    ctx = json.dumps(asset_summaries, ensure_ascii=False, indent=2)
    prompt = f"""Please check consistency across the following assets:

{ctx}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        return json.loads(text)
    except Exception:
        return {"issues": [], "overall_status": "clean"}
