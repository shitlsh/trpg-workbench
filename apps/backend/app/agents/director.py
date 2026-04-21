"""Director Agent – intent parsing and routing only. No content generation."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence

DIRECTOR_SYSTEM = """You are the Director Agent for a TRPG workbench application.
Your ONLY job is to:
1. Parse the user's intent
2. Decide which assets are affected
3. Choose the appropriate workflow or sub-agents
4. Generate a concise change plan for user confirmation

You MUST NOT generate any asset content yourself.
You MUST respond ONLY with a valid JSON object matching this exact schema:
{
  "intent": "create_asset | modify_asset | rules_review | image_gen | query",
  "affected_asset_types": ["npc", "stage", ...],
  "workflow": "create_module | modify_asset | rules_review | generate_image | null",
  "agents_to_call": ["plot", "npc", ...],
  "change_plan": "human-readable description of what will be created/changed",
  "requires_user_confirm": true
}

Rules:
- If the user wants to create a full module (多个资产), workflow = "create_module"
- If modifying a single asset field, workflow = "modify_asset"
- If asking a rules question, workflow = "rules_review", agents_to_call = ["rules"]
- For simple queries with no file changes, workflow = null, intent = "query"
- For image generation requests, workflow = "generate_image", intent = "image_gen"
- Always set requires_user_confirm = true for create/modify operations
- agents_to_call can include: "plot", "npc", "monster", "lore", "rules", "consistency", "document"
- Respond ONLY with JSON, no extra text
"""


def run_director(
    user_message: str,
    workspace_context: dict,
    model=None,
) -> dict:
    """
    Run Director Agent.
    workspace_context: {
      "workspace_name": str,
      "rule_set": str,
      "existing_assets": [{"type": str, "name": str, "slug": str}]
    }
    Returns: ChangePlan dict
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(
        model=mdl,
        system_prompt=DIRECTOR_SYSTEM,
        markdown=False,
    )

    context_str = json.dumps(workspace_context, ensure_ascii=False, indent=2)
    prompt = f"""Workspace context:
{context_str}

User request: {user_message}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fallback: return a safe default
        return {
            "intent": "query",
            "affected_asset_types": [],
            "workflow": None,
            "agents_to_call": [],
            "change_plan": text,
            "requires_user_confirm": False,
        }
