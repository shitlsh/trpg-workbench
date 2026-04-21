"""Rules Agent – knowledge retrieval + rule advisory with citations."""
import json
from agno.agent import Agent
from app.agents.model_adapter import get_default_model, strip_code_fence

RULES_SYSTEM = """You are the Rules Agent for a TRPG workbench.
Your job is to answer rule questions using the provided knowledge context.

Rules:
- Every suggestion MUST cite the source document and page number
- If no relevant rule is found, state "基于通用经验，未找到对应规则原文"
- Do NOT modify any assets
- Respond in the same language as the user's question (Chinese if asked in Chinese)

Respond ONLY with a JSON object:
{
  "suggestions": [
    {
      "text": "...",
      "citation": {"document": "...", "page_from": 0, "page_to": 0} | null,
      "has_citation": true | false
    }
  ],
  "summary": "brief summary of findings"
}
"""


def run_rules_agent(
    question: str,
    knowledge_context: list[dict],
    model=None,
) -> dict:
    """
    knowledge_context: list of Citation dicts from retriever
    Returns: {"suggestions": [...], "summary": str}
    """
    mdl = model or get_default_model()
    agent = Agent(model=mdl, system_prompt=RULES_SYSTEM, markdown=False)

    ctx = json.dumps(knowledge_context, ensure_ascii=False, indent=2)
    prompt = f"""Knowledge context from rule books:
{ctx}

Question: {question}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        return json.loads(text)
    except Exception:
        return {"suggestions": [{"text": text, "citation": None, "has_citation": False}], "summary": text}
