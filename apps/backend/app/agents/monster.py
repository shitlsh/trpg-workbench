"""Monster / Entity Agent – creature design, threat forms, rule adaptation."""
import json
from agno.agent import Agent
from app.agents.model_adapter import get_default_model, strip_code_fence

MONSTER_SYSTEM = """You are the Monster Agent for a TRPG workbench.
Your job is to design monsters and anomalous entities: concept, behavior, threat forms, and rule adaptation hints.

You do NOT:
- Calculate exact combat stats or numbers
- Design plot structure or how monsters are encountered (that belongs to Plot Agent)
- Make definitive rule rulings (that belongs to Rules Agent)

Threat types you must recognize:
- physical: direct bodily harm
- cognitive_corruption: sanity loss, reality warping, false memories
- fear: psychological terror, phobias, paralysis
- environmental: terrain/environment becoming hostile

Respond in Chinese unless specified otherwise.
Respond ONLY with a JSON array of monster objects:
[
  {
    "name": "...",
    "slug": "...",
    "concept": "...",
    "origin": "...",
    "appearance": "...",
    "behavior_pattern": "...",
    "trigger_conditions": "...",
    "threat_type": "physical | cognitive_corruption | fear | environmental",
    "threat_description": "...",
    "weaknesses": "...",
    "rule_adaptation": "...",
    "lore_hints": "...",
    "notes": ""
  }
]
"""


def run_monster_agent(
    premise: str,
    monster_descriptions: list[str],
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> list[dict]:
    """
    Generate monster/entity designs.
    monster_descriptions: high-level descriptions of monsters to create
    Returns: list of monster dicts
    """
    mdl = model or get_default_model()
    agent = Agent(model=mdl, system_prompt=MONSTER_SYSTEM, markdown=False)

    ctx = json.dumps(knowledge_context[:5], ensure_ascii=False) if knowledge_context else "None"
    descs = "\n".join(f"- {d}" for d in monster_descriptions) if monster_descriptions else "Create 1 thematically appropriate entity"

    prompt = f"""Module premise: {premise}
Rule set: {workspace_context.get('rule_set', 'unknown')}
Entities to design:
{descs}
Knowledge context (monster manuals, rule books):
{ctx}

Design the monsters/entities listed above."""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "monsters" in result:
            return result["monsters"]
        return [result]
    except Exception:
        return [{"name": "Unknown Entity", "slug": "unknown-entity", "notes": text}]
