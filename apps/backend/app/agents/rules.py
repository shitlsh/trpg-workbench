"""Rules Agent – knowledge retrieval + rule advisory with citations."""
import json
import asyncio
from app.agents.model_adapter import strip_code_fence, complete_text_once
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
    if not isinstance(model, dict):
        raise ValueError("model runtime config is required")
    profile = model["profile"]
    model_name = model["model_name"]

    ctx = json.dumps(knowledge_context, ensure_ascii=False, indent=2)
    prompt = f"""Knowledge context from rule books:
{ctx}

Question: {question}"""

    text = asyncio.run(
        complete_text_once(
            profile=profile,
            model_name=model_name,
            system_prompt=load_prompt("rules", phase),
            user_prompt=prompt,
            temperature=0.2,
        )
    )
    text = strip_code_fence(text)

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
