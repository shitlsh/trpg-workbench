"""NPC Agent – character design, motivations, relationships."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_npc_agent(
    premise: str,
    stage_summaries: list[str],
    npc_count: int,
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> list[dict]:
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(model=mdl, system_prompt=load_prompt("npc", "system"), markdown=False)

    ctx = json.dumps(knowledge_context[:3], ensure_ascii=False) if knowledge_context else "None"
    stages_str = "\n".join(f"- {s}" for s in stage_summaries) if stage_summaries else "Not yet defined"

    prompt = f"""Module premise: {premise}
Scene summaries: {stages_str}
Number of key NPCs to create: {npc_count}
Rule set: {workspace_context.get('rule_set', 'unknown')}
Knowledge context: {ctx}

Create {npc_count} key NPCs for this module."""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "npcs" in result:
            return result["npcs"]
        return [result]
    except Exception:
        return [{"name": "Unknown NPC", "slug": "unknown-npc", "notes": text}]
