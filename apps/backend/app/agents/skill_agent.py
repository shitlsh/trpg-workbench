"""Skill Agent – generates a reusable Agent Skill from user intent + knowledge context."""
import json
from agno.agent import Agent
from app.agents.model_adapter import strip_code_fence
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

    agent = Agent(model=model, instructions=[load_prompt("skill", "system")], markdown=False)

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

    response = agent.run(prompt)
    text = strip_code_fence(response.content if hasattr(response, "content") else str(response))
    return text
