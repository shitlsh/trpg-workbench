"""Prompt Profile CRUD API."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import PromptProfileORM, RuleSetORM, LLMProfileORM
from app.models.schemas import (
    PromptProfileSchema, PromptProfileCreate, PromptProfileUpdate,
    GeneratePromptRequest, GeneratePromptResponse,
)

router = APIRouter(prefix="/prompt-profiles", tags=["prompt-profiles"])


@router.get("", response_model=list[PromptProfileSchema])
def list_profiles(
    rule_set_id: str | None = Query(None, description="Filter by rule set ID"),
    db: Session = Depends(get_db),
):
    q = db.query(PromptProfileORM).order_by(PromptProfileORM.created_at)
    if rule_set_id:
        q = q.filter(PromptProfileORM.rule_set_id == rule_set_id)
    return q.all()


@router.post("/generate", response_model=GeneratePromptResponse)
def generate_prompt(body: GeneratePromptRequest, db: Session = Depends(get_db)):
    """Generate a prompt profile using an LLM based on the rule set's info."""
    rule_set = db.get(RuleSetORM, body.rule_set_id)
    if not rule_set:
        raise HTTPException(status_code=404, detail="Rule set not found")

    llm_profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not llm_profile:
        raise HTTPException(status_code=404, detail="LLM profile not found")

    try:
        from app.agents.model_adapter import model_from_profile
        from agno.agent import Agent

        model = model_from_profile(llm_profile, body.model_name)

        rs_desc = rule_set.description or "无"
        style_hint = f"\n用户风格偏好：{body.style_description}" if body.style_description else ""

        prompt = f"""你是一位专业的 TRPG 模组创作顾问。请为以下规则集生成一份创作风格提示词（PromptProfile），指导 AI 助手进行创作。

规则集名称：{rule_set.name}
描述：{rs_desc}{style_hint}

请以 JSON 格式返回，包含以下字段：
- name: 提示词名称（简短，如"恐怖调查标准风格"）
- system_prompt: 完整的系统提示词（200-500字，涵盖创作风格、NPC设计原则、场景描述要点、输出格式约束等）
- style_notes: 简短的风格摘要（30-60字，供界面展示）

只返回 JSON，不要其他内容。"""

        agent = Agent(model=model, markdown=False)
        result = agent.run(prompt)
        raw = result.content if hasattr(result, "content") else str(result)

        import json, re
        # Strip thinking tags (e.g., Qwen3 reasoning tokens)
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
        # Strip markdown code fences
        raw = re.sub(r"^```[a-zA-Z]*\n?|```\s*$", "", raw.strip(), flags=re.MULTILINE).strip()
        data = json.loads(raw)

        return GeneratePromptResponse(
            name=data.get("name", f"{rule_set.name}创作风格"),
            system_prompt=data.get("system_prompt", ""),
            style_notes=data.get("style_notes", ""),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败：{str(e)}")


@router.post("", response_model=PromptProfileSchema, status_code=201)
def create_profile(body: PromptProfileCreate, db: Session = Depends(get_db)):
    profile = PromptProfileORM(
        name=body.name,
        system_prompt=body.system_prompt,
        style_notes=body.style_notes,
        rule_set_id=body.rule_set_id,
        output_schema_hint=body.output_schema_hint,
        is_builtin=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/{profile_id}", response_model=PromptProfileSchema)
def get_profile(profile_id: str, db: Session = Depends(get_db)):
    p = db.get(PromptProfileORM, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Prompt profile not found")
    return p


@router.patch("/{profile_id}", response_model=PromptProfileSchema)
def update_profile(profile_id: str, body: PromptProfileUpdate, db: Session = Depends(get_db)):
    p = db.get(PromptProfileORM, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Prompt profile not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{profile_id}", status_code=204)
def delete_profile(profile_id: str, db: Session = Depends(get_db)):
    p = db.get(PromptProfileORM, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Prompt profile not found")
    db.delete(p)
    db.commit()
