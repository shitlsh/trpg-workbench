"""Document Agent – formats raw agent output into structured asset JSON + MD patch proposals.
This agent NEVER writes files or database rows. It only returns patch data."""
import json
from agno.agent import Agent
from app.agents.model_adapter import get_default_model, strip_code_fence

DOCUMENT_SYSTEM = """You are the Document Agent for a TRPG workbench.
Your ONLY job is to format raw content into structured asset data.
You do NOT create new content, do NOT write files, do NOT make creative judgments.

For each asset you receive, output a patch proposal:
{
  "asset_id": "...",
  "asset_name": "...",
  "asset_type": "...",
  "asset_slug": "...",
  "content_json": "{valid json string}",
  "content_md": "# Title\\n\\n## Section\\ncontent...",
  "change_summary": "brief description of what changed"
}

Output a JSON array of patch proposals.
Use proper Markdown headings matching the asset type conventions:
- NPC: ## 外貌描述, ## 背景故事, ## 动机, ## 与玩家的关系, ## 备注
- Stage: ## 场景描述, ## 目标, ## 关键NPC, ## 关键地点, ## 备注
- Outline: ## 故事前提, ## 主题, ## 基调, ## 幕次结构, ## 备注
- Clue: ## 线索描述, ## 发现条件, ## 指向何处, ## 备注
- Location: ## 外观描述, ## 历史背景, ## 当前状态, ## 备注
For other types use: ## 描述, ## 备注
"""


def run_document_agent(
    raw_assets: list[dict],
    model=None,
) -> list[dict]:
    """
    raw_assets: list of {"asset_id": str | None, "asset_name": str, "asset_type": str,
                          "asset_slug": str, "raw_content": dict | str}
    Returns: list of PatchProposal dicts
    """
    mdl = model or get_default_model()
    agent = Agent(model=mdl, system_prompt=DOCUMENT_SYSTEM, markdown=False)

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
