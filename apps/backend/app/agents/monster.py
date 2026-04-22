"""Monster / Entity Agent – creature design, threat forms, rule adaptation."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


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
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(model=mdl, system_prompt=load_prompt("monster", "system"), markdown=False)

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
