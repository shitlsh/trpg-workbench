"""Lore Agent – locations, world-building entries, map briefs, faction lore."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence

LORE_SYSTEM = """You are the Lore Agent for a TRPG workbench.
Your job is to create world-building content: locations, lore notes (world-building entries),
map briefs, historical background, and faction relationships.

You do NOT:
- Design specific NPC characters (that belongs to NPC Agent)
- Design scene flow or plot structure (that belongs to Plot Agent)
- Design monsters (that belongs to Monster Agent)

For each location, always include an image_brief with subject, mood, key_elements, and style.
This will be used for optional image generation later.

Respond in Chinese unless specified otherwise.
Respond ONLY with a JSON object:
{
  "locations": [
    {
      "name": "...",
      "slug": "...",
      "type": "building | district | wilderness | ruin | interior | other",
      "era": "...",
      "description": "...",
      "atmosphere": "...",
      "history": "...",
      "notable_features": ["...", "..."],
      "faction_presence": "...",
      "secrets": "...",
      "image_brief": {
        "subject": "...",
        "mood": "...",
        "key_elements": ["...", "..."],
        "style": "..."
      },
      "notes": ""
    }
  ],
  "lore_notes": [
    {
      "name": "...",
      "slug": "...",
      "category": "faction | history | item | concept | geography | other",
      "content": "...",
      "related_locations": ["..."],
      "notes": ""
    }
  ]
}
"""


def run_lore_agent(
    premise: str,
    location_hints: list[str],
    knowledge_context: list[dict],
    workspace_context: dict,
    location_count: int = 3,
    lore_note_count: int = 2,
    model=None,
) -> dict:
    """
    Generate location and lore note content.
    location_hints: high-level descriptions of locations to create
    Returns: {"locations": [...], "lore_notes": [...]}
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(model=mdl, system_prompt=LORE_SYSTEM, markdown=False)

    ctx = json.dumps(knowledge_context[:5], ensure_ascii=False) if knowledge_context else "None"
    hints_str = "\n".join(f"- {h}" for h in location_hints) if location_hints else "Infer appropriate locations from the premise"

    prompt = f"""Module premise: {premise}
Rule set: {workspace_context.get('rule_set', 'unknown')}
Location hints:
{hints_str}
Requested: {location_count} locations and {lore_note_count} lore notes.
Knowledge context (lore books, module references):
{ctx}

Create the requested locations and lore notes. Each location must include an image_brief."""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return {
                "locations": result.get("locations", []),
                "lore_notes": result.get("lore_notes", []),
            }
        return {"locations": [], "lore_notes": []}
    except Exception:
        return {"locations": [], "lore_notes": []}
