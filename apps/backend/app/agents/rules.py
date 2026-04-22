"""Rules Agent – knowledge retrieval + rule advisory with citations."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_rules_agent(
    question: str,
    knowledge_context: list[dict],
    model=None,
) -> dict:
    """
    knowledge_context: list of Citation dicts from retriever
    Returns: {"suggestions": [...], "summary": str}
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    mdl = model
    agent = Agent(model=mdl, system_prompt=load_prompt("rules", "system"), markdown=False)

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
