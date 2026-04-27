"""Prompt Profile CRUD API."""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import PromptProfileORM, RuleSetORM, LLMProfileORM
from app.models.schemas import (
    PromptProfileSchema, PromptProfileCreate, PromptProfileUpdate,
    GeneratePromptRequest,
)
from app.prompts import load_prompt

router = APIRouter(prefix="/prompt-profiles", tags=["prompt-profiles"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("", response_model=list[PromptProfileSchema])
def list_profiles(
    rule_set_id: str | None = Query(None, description="Filter by rule set ID"),
    db: Session = Depends(get_db),
):
    q = db.query(PromptProfileORM).order_by(PromptProfileORM.created_at)
    if rule_set_id:
        q = q.filter(PromptProfileORM.rule_set_id == rule_set_id)
    return q.all()


@router.post("/generate")
async def generate_prompt(body: GeneratePromptRequest, db: Session = Depends(get_db)):
    """Generate a prompt profile via SSE stream with keepalive comments.

    Yields:
      `: keepalive`          — every 10s while waiting
      `event: result`        — on success, data = {name, system_prompt, style_notes}
      `event: error`         — on failure, data = {message}
    """
    rule_set = db.get(RuleSetORM, body.rule_set_id)
    if not rule_set:
        raise HTTPException(status_code=404, detail="Rule set not found")

    llm_profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not llm_profile:
        raise HTTPException(status_code=404, detail="LLM profile not found")

    rule_set_name = rule_set.name
    rule_set_desc = rule_set.description or "无"

    def _run_llm() -> dict:
        import re
        from app.agents.model_adapter import model_from_profile, strip_code_fence
        from agno.agent import Agent

        style_hint = f"\n用户风格偏好：{body.style_description}" if body.style_description else ""
        prompt = load_prompt(
            "prompt_profiles", "generate",
            rule_set_name=rule_set_name,
            rule_set_desc=rule_set_desc,
            style_hint=style_hint,
        )

        model = model_from_profile(llm_profile, body.model_name)
        agent = Agent(model=model, markdown=False)
        result = agent.run(prompt)
        raw = result.content if hasattr(result, "content") else str(result)
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
        raw = strip_code_fence(raw)
        data = json.loads(raw)
        return {
            "name": data.get("name") or f"{rule_set_name}创作风格",
            "system_prompt": data.get("system_prompt", ""),
            "style_notes": data.get("style_notes", ""),
        }

    async def _stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce():
            try:
                result = await asyncio.to_thread(_run_llm)
                await queue.put(("result", result))
            except Exception as exc:
                await queue.put(("error", str(exc)))

        asyncio.create_task(_produce())

        deadline = 300  # seconds
        elapsed = 0
        while elapsed < deadline:
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=10.0)
                if kind == "result":
                    yield _sse("result", payload)
                else:
                    yield _sse("error", {"message": payload})
                return
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                elapsed += 10

        yield _sse("error", {"message": "生成超时（300秒），请尝试更快的模型"})

    return StreamingResponse(_stream(), media_type="text/event-stream")


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
