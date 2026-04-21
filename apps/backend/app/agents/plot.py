"""Plot Agent – story structure, stages, clue chains."""
import json
from agno.agent import Agent
from app.agents.model_adapter import get_default_model

PLOT_SYSTEM = """You are the Plot Agent for a TRPG workbench.
Your job is to create story structure, scene (stage) lists, and clue chains.
You do NOT create NPC details, monster stats, or rule judgments.

Respond in Chinese unless specified otherwise.
Respond ONLY with a JSON object matching the requested output_type.

For output_type "outline":
{
  "title": "...",
  "premise": "...",
  "theme": "...",
  "tone": "...",
  "summary": "...",
  "act_count": 3
}

For output_type "stages":
{
  "stages": [
    {"name": "...", "slug": "...", "description": "...", "objectives": ["..."], "key_npcs": [], "key_locations": []}
  ]
}

For output_type "clues":
{
  "clues": [
    {"name": "...", "slug": "...", "description": "...", "leads_to": "...", "found_at": "..."}
  ]
}
"""


def run_plot_agent(
    premise: str,
    output_type: str,
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> dict:
    mdl = model or get_default_model()
    agent = Agent(model=mdl, system_prompt=PLOT_SYSTEM, markdown=False)

    ctx = json.dumps(knowledge_context[:3], ensure_ascii=False) if knowledge_context else "None"
    prompt = f"""Module premise: {premise}
Output type requested: {output_type}
Workspace rule set: {workspace_context.get('rule_set', 'unknown')}
Knowledge context (top references): {ctx}

Generate the {output_type} for this TRPG module."""

    response = agent.run(prompt)
    text = (response.content if hasattr(response, "content") else str(response)).strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        return json.loads(text)
    except Exception:
        return {"raw": text}
