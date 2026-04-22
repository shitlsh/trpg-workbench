"""Plot Agent – story structure, stages, clue chains."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_plot_agent(
    premise: str,
    output_type: str,
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> dict:
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(model=mdl, system_prompt=load_prompt("plot", "system"), markdown=False)

    ctx = json.dumps(knowledge_context[:3], ensure_ascii=False) if knowledge_context else "None"
    prompt = f"""Module premise: {premise}
Output type requested: {output_type}
Workspace rule set: {workspace_context.get('rule_set', 'unknown')}
Knowledge context (top references): {ctx}

Generate the {output_type} for this TRPG module."""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        return json.loads(text)
    except Exception:
        return {"raw": text}
