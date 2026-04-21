"""NPC Agent – character design, motivations, relationships."""
import json
from agno.agent import Agent
from app.agents.model_adapter import get_default_model

NPC_SYSTEM = """You are the NPC Agent for a TRPG workbench.
Your job is to create detailed NPC characters: identity, appearance, personality, motivation, secrets, relationships.
You do NOT design plot structure, monster stats, or rule judgments.

Respond in Chinese unless specified otherwise.
Respond ONLY with a JSON array of NPC objects:
[
  {
    "name": "...",
    "slug": "...",
    "role": "...",
    "appearance": "...",
    "personality": "...",
    "background": "...",
    "motivation": "...",
    "secret": "...",
    "relationship_to_players": "...",
    "speech_style": "...",
    "notes": ""
  }
]
"""


def run_npc_agent(
    premise: str,
    stage_summaries: list[str],
    npc_count: int,
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> list[dict]:
    mdl = model or get_default_model()
    agent = Agent(model=mdl, system_prompt=NPC_SYSTEM, markdown=False)

    ctx = json.dumps(knowledge_context[:3], ensure_ascii=False) if knowledge_context else "None"
    stages_str = "\n".join(f"- {s}" for s in stage_summaries) if stage_summaries else "Not yet defined"

    prompt = f"""Module premise: {premise}
Scene summaries: {stages_str}
Number of key NPCs to create: {npc_count}
Rule set: {workspace_context.get('rule_set', 'unknown')}
Knowledge context: {ctx}

Create {npc_count} key NPCs for this module."""

    response = agent.run(prompt)
    text = (response.content if hasattr(response, "content") else str(response)).strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "npcs" in result:
            return result["npcs"]
        return [result]
    except Exception:
        return [{"name": "Unknown NPC", "slug": "unknown-npc", "notes": text}]
