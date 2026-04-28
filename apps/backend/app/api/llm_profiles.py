import time
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import LLMProfileORM, WorkspaceORM
from app.models.schemas import (
    LLMProfileSchema, LLMProfileCreate, LLMProfileUpdate, LLMTestResult
)
from app.utils.secrets import encrypt_secret, decrypt_secret as decrypt

router = APIRouter(prefix="/settings/llm-profiles", tags=["llm-profiles"])


def _normalize_strict_compatible(provider_type: str, strict_compatible: bool | None) -> bool:
    if provider_type != "openai_compatible":
        return False
    return bool(strict_compatible)


def _to_schema(profile: LLMProfileORM) -> LLMProfileSchema:
    schema = LLMProfileSchema.model_validate(profile)
    schema.has_api_key = bool(profile.api_key_encrypted)
    return schema


@router.get("", response_model=list[LLMProfileSchema])
def list_llm_profiles(db: Session = Depends(get_db)):
    profiles = db.query(LLMProfileORM).order_by(LLMProfileORM.name).all()
    return [_to_schema(p) for p in profiles]


@router.post("", response_model=LLMProfileSchema, status_code=201)
def create_llm_profile(body: LLMProfileCreate, db: Session = Depends(get_db)):
    data = body.model_dump()
    data["strict_compatible"] = _normalize_strict_compatible(
        data.get("provider_type", ""),
        data.get("strict_compatible"),
    )
    api_key = data.pop("api_key", None)
    if api_key is not None and api_key == "":
        raise HTTPException(status_code=400, detail="api_key cannot be empty string; omit the field to leave unset")
    profile = LLMProfileORM(
        **data,
        api_key_encrypted=encrypt_secret(api_key) if api_key else None,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _to_schema(profile)


@router.get("/{profile_id}", response_model=LLMProfileSchema)
def get_llm_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(LLMProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLMProfile not found")
    return _to_schema(profile)


@router.patch("/{profile_id}", response_model=LLMProfileSchema)
def update_llm_profile(profile_id: str, body: LLMProfileUpdate, db: Session = Depends(get_db)):
    profile = db.get(LLMProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLMProfile not found")

    data = body.model_dump(exclude_unset=True)
    if "provider_type" in data or "strict_compatible" in data:
        provider_type = data.get("provider_type", profile.provider_type)
        strict_compatible = data.get("strict_compatible", profile.strict_compatible)
        data["strict_compatible"] = _normalize_strict_compatible(provider_type, strict_compatible)
    api_key = data.pop("api_key", None)
    clear_api_key = data.pop("clear_api_key", False)

    # Validate: cannot pass both api_key and clear_api_key=true
    if api_key is not None and clear_api_key:
        raise HTTPException(status_code=400, detail="Cannot set api_key and clear_api_key=true simultaneously")
    if api_key is not None and api_key == "":
        raise HTTPException(status_code=400, detail="api_key cannot be empty string; use clear_api_key=true to clear")

    for field, value in data.items():
        setattr(profile, field, value)

    if clear_api_key:
        profile.api_key_encrypted = None
    elif api_key is not None:
        profile.api_key_encrypted = encrypt_secret(api_key)

    db.commit()
    db.refresh(profile)
    return _to_schema(profile)


@router.delete("/{profile_id}", status_code=204)
def delete_llm_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(LLMProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLMProfile not found")

    # Check workspace references
    refs = db.query(WorkspaceORM).filter(
        WorkspaceORM.default_llm_profile_id == profile_id
    ).all()
    if refs:
        workspace_names = [w.name for w in refs]
        raise HTTPException(
            status_code=409,
            detail={
                "message": "LLM profile is referenced by workspaces",
                "referenced_by": workspace_names,
            },
        )

    db.delete(profile)
    db.commit()


@router.post("/{profile_id}/test", response_model=LLMTestResult)
def test_llm_profile(profile_id: str, model_name: str = Query(..., description="Model name to test"), db: Session = Depends(get_db)):
    profile = db.get(LLMProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="LLMProfile not found")

    try:
        from app.agents.model_adapter import model_from_profile
        model = model_from_profile(profile, model_name)
        start = time.monotonic()
        # Use agno model to do a simple completion
        from agno.agent import Agent
        agent = Agent(model=model)
        resp = agent.run("Say 'ok'", stream=False)
        latency_ms = int((time.monotonic() - start) * 1000)
        return LLMTestResult(success=True, latency_ms=latency_ms)
    except Exception as exc:
        return LLMTestResult(success=False, error=str(exc))
