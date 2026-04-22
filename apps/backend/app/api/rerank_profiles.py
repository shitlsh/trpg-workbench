import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import RerankProfileORM, WorkspaceORM
from app.models.schemas import (
    RerankProfileSchema, RerankProfileCreate, RerankProfileUpdate, RerankTestResult
)
from app.utils.secrets import encrypt_secret, decrypt_secret as decrypt

router = APIRouter(prefix="/settings/rerank-profiles", tags=["rerank-profiles"])


def _to_schema(profile: RerankProfileORM) -> RerankProfileSchema:
    schema = RerankProfileSchema.model_validate(profile)
    schema.has_api_key = bool(profile.api_key_encrypted)
    return schema


@router.get("", response_model=list[RerankProfileSchema])
def list_rerank_profiles(db: Session = Depends(get_db)):
    profiles = db.query(RerankProfileORM).order_by(RerankProfileORM.name).all()
    return [_to_schema(p) for p in profiles]


@router.post("", response_model=RerankProfileSchema, status_code=201)
def create_rerank_profile(body: RerankProfileCreate, db: Session = Depends(get_db)):
    data = body.model_dump()
    api_key = data.pop("api_key", None)
    if api_key is not None and api_key == "":
        raise HTTPException(status_code=400, detail="api_key cannot be empty string; omit the field to leave unset")
    profile = RerankProfileORM(
        **data,
        api_key_encrypted=encrypt_secret(api_key) if api_key else None,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _to_schema(profile)


@router.get("/{profile_id}", response_model=RerankProfileSchema)
def get_rerank_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(RerankProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="RerankProfile not found")
    return _to_schema(profile)


@router.patch("/{profile_id}", response_model=RerankProfileSchema)
def update_rerank_profile(profile_id: str, body: RerankProfileUpdate, db: Session = Depends(get_db)):
    profile = db.get(RerankProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="RerankProfile not found")

    data = body.model_dump(exclude_unset=True)
    api_key = data.pop("api_key", None)
    clear_api_key = data.pop("clear_api_key", False)

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
def delete_rerank_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(RerankProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="RerankProfile not found")

    refs = db.query(WorkspaceORM).filter(
        WorkspaceORM.rerank_profile_id == profile_id
    ).all()
    if refs:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Rerank profile is referenced by workspaces",
                "referenced_by": [w.name for w in refs],
            },
        )

    db.delete(profile)
    db.commit()


@router.post("/{profile_id}/test", response_model=RerankTestResult)
def test_rerank_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(RerankProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="RerankProfile not found")

    api_key = decrypt(profile.api_key_encrypted) if profile.api_key_encrypted else None

    from app.services.rerank_adapter import test_connection
    success, latency_ms, error = test_connection(
        provider_type=profile.provider_type,
        model_name=profile.model_name,
        api_key=api_key,
        base_url=profile.base_url,
    )
    return RerankTestResult(success=success, latency_ms=latency_ms, error=error)
