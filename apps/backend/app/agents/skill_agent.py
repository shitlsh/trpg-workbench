"""Skill Agent – generates a reusable Agent Skill from user intent + knowledge context."""
import json
import asyncio
from app.agents.model_adapter import strip_code_fence, complete_text_once
from app.prompts import load_prompt


def run_skill_agent(
    user_intent: str,
    knowledge_context: list[dict],
    workspace_context: dict,
    model=None,
) -> str:
    """Generate a Skill definition from user intent and optional RAG knowledge context.

    Returns a Frontmatter Markdown string:
        ---
        name: coc-npc-framework
        description: One sentence.
        agent_types:
          - npc
        ---
        ...body...
    """
    if model is None:
        raise ValueError("model must be provided; configure an LLM profile in workspace settings")

    if not isinstance(model, dict):
        raise ValueError("model runtime config is required")
    profile = model["profile"]
    model_name = model["model_name"]

    if knowledge_context:
        ctx_json = json.dumps(knowledge_context[:5], ensure_ascii=False, indent=2)
        knowledge_block = load_prompt("_shared", "rag_injection", knowledge_context=ctx_json)
    else:
        knowledge_block = "（当前无知识库参考片段。）"

    prompt = load_prompt(
        "skill",
        "user_request",
        user_intent=user_intent,
        rule_set=workspace_context.get("rule_set", "unknown"),
        knowledge_block=knowledge_block,
    )

    text = asyncio.run(
        complete_text_once(
            profile=profile,
            model_name=model_name,
            system_prompt=load_prompt("skill", "system"),
            user_prompt=prompt,
            temperature=0.2,
        )
    )
    text = strip_code_fence(text)
    return text
