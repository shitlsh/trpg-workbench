"""Prompt Profile CRUD API."""
import asyncio
import json
import logging
import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import PromptProfileORM, RuleSetORM, LLMProfileORM
from app.models.schemas import (
    PromptProfileSchema,
    PromptProfileCreate,
    PromptProfileUpdate,
    GeneratePromptRequest,
)
from app.agents.model_adapter import parse_json_object_from_llm, strip_code_fence, iter_complete_text_deltas
from app.prompts import load_prompt
from app.services.llm_defaults import task_temperature

router = APIRouter(prefix="/prompt-profiles", tags=["prompt-profiles"])
_log = logging.getLogger(__name__)


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
    """Generate a prompt profile via SSE: progress, partial (streaming text), result, error.

    Yields:
      ``: keepalive`` — while waiting (long gaps)
      ``event: progress`` — phases: queued, llm_request, llm_stream, json_parse, complete / json_parse_error
      ``event: partial`` — ``{ "text": "<accumulated assistant text tail>" }``
      ``event: result`` — ``{ name, system_prompt, style_notes }``
      ``event: error``
    """
    rule_set = db.get(RuleSetORM, body.rule_set_id)
    if not rule_set:
        raise HTTPException(status_code=404, detail="Rule set not found")

    llm_profile = db.get(LLMProfileORM, body.llm_profile_id)
    if not llm_profile:
        raise HTTPException(status_code=404, detail="LLM profile not found")

    rule_set_name = rule_set.name
    rule_set_desc = rule_set.description or "无"
    model_label = (body.model_name or "").strip() or (getattr(llm_profile, "model_name", None) or "")

    async def _stream():
        correlation_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        detail_base = {
            "correlation_id": correlation_id,
            "operation": "prompt_profile_generate",
            "rule_set_id": body.rule_set_id,
            "model": model_label,
            "provider_kind": (llm_profile.provider_type or "").strip().lower(),
        }
        yield _sse("progress", {"phase": "queued", "message": "已排队", "detail": detail_base})

        style_hint = f"\n用户风格偏好：{body.style_description}" if body.style_description else ""
        prompt = load_prompt(
            "prompt_profiles",
            "generate",
            rule_set_name=rule_set_name,
            rule_set_desc=rule_set_desc,
            style_hint=style_hint,
        )
        prompt_chars = len(prompt or "")

        yield _sse(
            "progress",
            {
                "phase": "llm_request",
                "message": "正在请求模型生成提示词…",
                "detail": {**detail_base, "prompt_chars": prompt_chars},
            },
        )

        try:
            t_llm = time.perf_counter()
            first_chunk_ms: float | None = None
            parts: list[str] = []
            yield _sse(
                "progress",
                {"phase": "llm_stream", "message": "正在接收模型输出…", "detail": {**detail_base}},
            )

            async for fragment in iter_complete_text_deltas(
                profile=llm_profile,
                model_name=body.model_name,
                system_prompt=None,
                user_prompt=prompt,
                temperature=task_temperature("prompt_generation"),
            ):
                if first_chunk_ms is None:
                    first_chunk_ms = round((time.perf_counter() - t_llm) * 1000.0, 2)
                parts.append(fragment)
                acc = "".join(parts)
                tail = acc[-12000:] if len(acc) > 12000 else acc
                yield _sse("partial", {"text": tail})

            llm_total_ms = round((time.perf_counter() - t_llm) * 1000.0, 2)
            raw = "".join(parts)
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            raw = strip_code_fence(raw)
            response_chars = len(raw or "")
            _log.info(
                "prompt_profile_generate phase=llm_done correlation_id=%s rule_set_id=%s first_chunk_ms=%s "
                "llm_total_ms=%s prompt_chars=%s response_chars=%s",
                correlation_id,
                body.rule_set_id,
                first_chunk_ms,
                llm_total_ms,
                prompt_chars,
                response_chars,
            )

            yield _sse(
                "progress",
                {
                    "phase": "json_parse",
                    "message": "正在解析 JSON…",
                    "detail": {**detail_base, "response_chars": response_chars},
                },
            )
            t_parse = time.perf_counter()
            try:
                data = parse_json_object_from_llm(raw)
            except Exception as exc:
                parse_ms = round((time.perf_counter() - t_parse) * 1000.0, 2)
                total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                _log.info(
                    "prompt_profile_generate phase=json_parse_error correlation_id=%s total_ms=%s parse_ms=%s "
                    "parse_ok=false snippet=%s",
                    correlation_id,
                    total_ms,
                    parse_ms,
                    str(exc)[:240],
                )
                yield _sse(
                    "progress",
                    {
                        "phase": "json_parse_error",
                        "message": "无法解析模型返回的 JSON",
                        "detail": {**detail_base, "elapsed_ms": parse_ms, "parse_ok": False},
                    },
                )
                yield _sse("error", {"message": str(exc)})
                return

            parse_ms = round((time.perf_counter() - t_parse) * 1000.0, 2)
            result = {
                "name": data.get("name") or f"{rule_set_name}创作风格",
                "system_prompt": data.get("system_prompt", ""),
                "style_notes": data.get("style_notes", ""),
            }
            total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            _log.info(
                "prompt_profile_generate phase=complete correlation_id=%s total_ms=%s llm_ms=%s parse_ms=%s "
                "parse_ok=true name_len=%s system_prompt_len=%s",
                correlation_id,
                total_ms,
                llm_total_ms,
                parse_ms,
                len(result["name"] or ""),
                len(result["system_prompt"] or ""),
            )
            yield _sse(
                "progress",
                {
                    "phase": "complete",
                    "message": "生成完成",
                    "detail": {**detail_base, "total_ms": total_ms, "parse_ok": True},
                },
            )
            yield _sse("result", result)
        except Exception as exc:
            total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            _log.exception(
                "prompt_profile_generate phase=error correlation_id=%s total_ms=%s",
                correlation_id,
                total_ms,
            )
            yield _sse("error", {"message": str(exc)})

    async def _stream_with_keepalive():
        q: asyncio.Queue = asyncio.Queue()

        async def _pump():
            try:
                async for line in _stream():
                    await q.put(("line", line))
            except Exception as exc:
                await q.put(("err", str(exc)))
            await q.put(("done", None))

        asyncio.create_task(_pump())
        deadline = 300
        elapsed = 0
        while elapsed < deadline:
            try:
                kind, payload = await asyncio.wait_for(q.get(), timeout=10.0)
                if kind == "line":
                    yield payload
                elif kind == "err":
                    yield _sse("error", {"message": payload})
                    return
                else:
                    return
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                elapsed += 10
        yield _sse("error", {"message": "生成超时（300秒），请尝试更快的模型"})

    return StreamingResponse(_stream_with_keepalive(), media_type="text/event-stream")


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
