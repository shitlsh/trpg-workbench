"""Rules Agent – knowledge retrieval + rule advisory with citations."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
from app.prompts import load_prompt


def run_rules_agent(
    question: str,
    knowledge_context: list[dict],
    model=None,
    review_mode: bool = False,
) -> dict:
    """
    knowledge_context: list of Citation dicts from retriever
    review_mode: if True, uses structured review prompt (adds severity/type/affected_field/suggestion_patch)
    Returns: {"suggestions": [...], "summary": str}
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")
    phase = "review" if review_mode else "system"
    agent = Agent(model=model, system_prompt=load_prompt("rules", phase), markdown=False)

    ctx = json.dumps(knowledge_context, ensure_ascii=False, indent=2)
    prompt = f"""Knowledge context from rule books:
{ctx}

Question: {question}"""

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))

    try:
        return json.loads(text)
    except Exception:
        fallback_suggestion = {
            "severity": "info",
            "type": "general_advice",
            "text": text,
            "citation": None,
            "has_citation": False,
            "affected_field": None,
            "suggestion_patch": None,
        }
        return {"suggestions": [fallback_suggestion], "summary": text}
