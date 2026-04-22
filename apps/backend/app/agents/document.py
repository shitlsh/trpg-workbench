"""Document Agent – formats raw agent output into structured asset JSON + MD patch proposals.
This agent NEVER writes files or database rows. It only returns patch data."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_document_agent(
    raw_assets: list[dict],
    model=None,
) -> list[dict]:
    """
    raw_assets: list of {"asset_id": str | None, "asset_name": str, "asset_type": str,
                          "asset_slug": str, "raw_content": dict | str}
    Returns: list of PatchProposal dicts
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(model=mdl, system_prompt=load_prompt("document", "system"), markdown=False)

    ctx = json.dumps(raw_assets, ensure_ascii=False, indent=2)
    prompt = f"""Format the following raw assets into structured patch proposals:

{ctx}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "patches" in result:
            return result["patches"]
        return [result]
    except Exception:
        return []
