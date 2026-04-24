"""Skill Agent – generates a reusable Agent Skill from user intent + knowledge context."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_skill_agent(
    user_intent: str,
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> dict:
    """Generate a Skill definition from user intent and optional RAG knowledge context.

    Returns a dict with keys: name, description, agent_types, body.
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")

    agent = Agent(model=model, system_prompt=load_prompt("skill", "system"), markdown=False)

    ctx = json.dumps(knowledge_context[:5], ensure_ascii=False) if knowledge_context else "None"

    prompt = f"""User request: {user_intent}
Rule set: {workspace_context.get('rule_set', 'unknown')}
Knowledge context: {ctx}

Generate a Skill based on the user's request."""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        result = json.loads(text)
        # Normalise: ensure required fields exist
        return {
            "name": result.get("name", "custom-skill"),
            "description": result.get("description", ""),
            "agent_types": result.get("agent_types", []),
            "body": result.get("body", ""),
        }
    except Exception:
        # Fallback: treat raw text as body
        return {
            "name": "custom-skill",
            "description": user_intent[:120],
            "agent_types": [],
            "body": text,
        }
