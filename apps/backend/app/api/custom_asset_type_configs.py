"""Custom Asset Type Config CRUD API (M16 + M30)."""
import re
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.storage.database import get_db
from app.models.orm import CustomAssetTypeConfigORM, RuleSetORM, LLMProfileORM
from app.models.schemas import (
    CustomAssetTypeConfigSchema,
    CustomAssetTypeConfigCreate,
    CustomAssetTypeConfigUpdate,
)
from app.prompts import load_prompt
from app.agents.model_adapter import iter_complete_text_deltas, parse_json_object_from_llm, strip_code_fence
from app.services.llm_defaults import task_temperature

_log = logging.getLogger(__name__)


def _sse(event: str, data: dict) -> str:
    import json
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class GenerateAssetTypeRequest(BaseModel):
    rule_set_id: str
    llm_profile_id: str
    model_name: str
    type_intent: str  # user's free-form description of the desired type

router = APIRouter(
    prefix="/rule-sets/{rule_set_id}/asset-type-configs",
    tags=["custom-asset-type-configs"],
)

# M30: Reduced to 6 canonical built-in types.
# Deprecated: location, branch, timeline, map_brief, lore_note
_BUILTIN_TYPES = {
    "outline", "stage", "npc", "monster", "map", "clue",
}


def _get_rule_set_or_404(rule_set_id: str, db: Session):
    rs = db.get(RuleSetORM, rule_set_id)
    if not rs:
        raise HTTPException(status_code=404, detail="RuleSet not found")
    return rs


@router.get("", response_model=list[CustomAssetTypeConfigSchema])
def list_configs(rule_set_id: str, db: Session = Depends(get_db)):
    _get_rule_set_or_404(rule_set_id, db)
    return (
        db.query(CustomAssetTypeConfigORM)
        .filter_by(rule_set_id=rule_set_id)
        .order_by(CustomAssetTypeConfigORM.sort_order, CustomAssetTypeConfigORM.created_at)
        .all()
    )


@router.post("", response_model=CustomAssetTypeConfigSchema, status_code=201)
def create_config(rule_set_id: str, body: CustomAssetTypeConfigCreate, db: Session = Depends(get_db)):
    _get_rule_set_or_404(rule_set_id, db)

    if body.type_key in _BUILTIN_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"'{body.type_key}' 是内置类型，不可注册为自定义类型",
        )

    config = CustomAssetTypeConfigORM(
        rule_set_id=rule_set_id,
        type_key=body.type_key,
        label=body.label,
        icon=body.icon,
        sort_order=body.sort_order,
        description=body.description,
        template_md=body.template_md,
    )
    db.add(config)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"类型 '{body.type_key}' 在该规则集中已存在",
        )
    db.refresh(config)
    return config


@router.patch("/{config_id}", response_model=CustomAssetTypeConfigSchema)
def update_config(
    rule_set_id: str,
    config_id: str,
    body: CustomAssetTypeConfigUpdate,
    db: Session = Depends(get_db),
):
    _get_rule_set_or_404(rule_set_id, db)
    config = db.get(CustomAssetTypeConfigORM, config_id)
    if not config or config.rule_set_id != rule_set_id:
        raise HTTPException(status_code=404, detail="Custom asset type config not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(config, field, value)
    db.commit()
    db.refresh(config)
    return config


@router.delete("/{config_id}", status_code=204)
def delete_config(rule_set_id: str, config_id: str, db: Session = Depends(get_db)):
    _get_rule_set_or_404(rule_set_id, db)
    config = db.get(CustomAssetTypeConfigORM, config_id)
    if not config or config.rule_set_id != rule_set_id:
        raise HTTPException(status_code=404, detail="Custom asset type config not found")
    db.delete(config)
    db.commit()


@router.post("/generate")
async def generate_asset_type(body: GenerateAssetTypeRequest, db: Session = Depends(get_db)):
    """AI-assisted generation of a custom asset type definition via SSE.

    Yields:
      ``: keepalive``    — keep-alive comment
      ``event: progress`` — phases: queued, llm_request, llm_stream, json_parse, complete / error
      ``event: partial``  — { "text": "<accumulated text>" }
      ``event: result``   — { type_key, label, icon, description, template_md }
      ``event: error``    — { message }
    """
    rule_set = db.get(RuleSetORM, body.rule_set_id)
    if not rule_set:
        raise HTTPException(status_code=404, detail="Rule set not found")
    llm_profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not llm_profile:
        raise HTTPException(status_code=404, detail="LLM profile not found")

    rule_set_name = rule_set.name

    async def _stream():
        correlation_id = uuid.uuid4().hex[:16]

        yield _sse("progress", {"phase": "queued", "message": "已排队"})

        try:
            prompt = load_prompt(
                "asset_types",
                "generate",
                rule_set_name=rule_set_name,
                type_intent=body.type_intent.strip(),
            )
        except Exception as exc:
            yield _sse("error", {"message": f"加载 prompt 失败：{exc}"})
            return

        yield _sse("progress", {"phase": "llm_request", "message": "正在请求模型生成类型定义…"})

        try:
            parts: list[str] = []
            yield _sse("progress", {"phase": "llm_stream", "message": "正在接收模型输出…"})
            async for fragment in iter_complete_text_deltas(
                profile=llm_profile,
                model_name=body.model_name,
                system_prompt=None,
                user_prompt=prompt,
                temperature=task_temperature("prompt_generation"),
            ):
                parts.append(fragment)
                acc = "".join(parts)
                tail = acc[-8000:] if len(acc) > 8000 else acc
                yield _sse("partial", {"text": tail})

            raw = "".join(parts)
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = strip_code_fence(raw)

        except Exception as exc:
            _log.error("asset_type_generate llm error correlation_id=%s error=%s", correlation_id, exc)
            yield _sse("error", {"message": f"模型请求失败：{exc}"})
            return

        yield _sse("progress", {"phase": "json_parse", "message": "正在解析 JSON…"})
        try:
            data = parse_json_object_from_llm(raw)
        except Exception as exc:
            yield _sse("error", {"message": f"无法解析模型返回的 JSON：{exc}"})
            return

        result = {
            "type_key": (data.get("type_key") or "custom").strip().lower(),
            "label": data.get("label") or "自定义类型",
            "icon": data.get("icon") or "📦",
            "description": data.get("description") or "",
            "template_md": data.get("template_md") or "",
        }
        yield _sse("progress", {"phase": "complete", "message": "生成完成"})
        yield _sse("result", result)

    return StreamingResponse(_stream(), media_type="text/event-stream")
