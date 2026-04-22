"""Director Agent – intent parsing and routing only. No content generation."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_director(
    user_message: str,
    workspace_context: dict,
    model=None,
    allow_clarification: bool = False,
    clarification_answers: dict | None = None,
) -> dict:
    """
    Run Director Agent.
    workspace_context: {
      "workspace_name": str,
      "rule_set": str,
      "existing_assets": [{"type": str, "name": str, "slug": str}]
    }
    allow_clarification: if True, Director may return a clarification result instead of execution plan
    clarification_answers: if provided, inject answers into context and run in planning mode
    Returns: ChangePlan dict (execution mode) or ClarificationResult dict (clarification mode)
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    
    # Determine which phase to use
    if clarification_answers:
        # User answered clarification questions – run planning mode
        system_prompt = load_prompt("director", "planning")
        context_with_answers = {**workspace_context, "clarification_answers": clarification_answers}
        context_str = json.dumps(context_with_answers, ensure_ascii=False, indent=2)
    elif allow_clarification:
        # First call – check if we need clarification
        system_prompt = load_prompt("director", "clarification")
        context_str = json.dumps(workspace_context, ensure_ascii=False, indent=2)
    else:
        # Direct execution (legacy behavior)
        system_prompt = load_prompt("director", "system")
        context_str = json.dumps(workspace_context, ensure_ascii=False, indent=2)
    
    agent = Agent(
        model=model,
        system_prompt=system_prompt,
        markdown=False,
    )

    prompt = f"""Workspace context:
{context_str}

User request: {user_message}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        result = json.loads(text)
        # If clarification mode but LLM decided no clarification needed, ensure mode is set
        if allow_clarification and not clarification_answers:
            if not result.get("needs_clarification"):
                result["mode"] = result.get("mode", "execution")
        return result
    except json.JSONDecodeError:
        # Fallback: return a safe default execution plan
        return {
            "mode": "execution",
            "needs_clarification": False,
            "intent": "query",
            "affected_asset_types": [],
            "workflow": None,
            "agents_to_call": [],
            "change_plan": text,
            "requires_user_confirm": False,
        }
