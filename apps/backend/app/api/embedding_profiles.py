import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import EmbeddingProfileORM, KnowledgeLibraryORM
from app.models.schemas import (
    EmbeddingProfileSchema, EmbeddingProfileCreate, EmbeddingProfileUpdate, EmbeddingTestResult
)
from app.utils.secrets import encrypt_secret

router = APIRouter(prefix="/settings/embedding-profiles", tags=["embedding-profiles"])


def _normalize_embedding_model_name(provider_type: str, model_name: str) -> str:
    if provider_type == "openai_compatible" and model_name.startswith("jina-ai/"):
        return model_name.split("/", 1)[1]
    return model_name


def _to_schema(profile: EmbeddingProfileORM) -> EmbeddingProfileSchema:
    schema = EmbeddingProfileSchema.model_validate(profile)
    schema.has_api_key = bool(profile.api_key_encrypted)
    return schema


@router.get("", response_model=list[EmbeddingProfileSchema])
def list_embedding_profiles(db: Session = Depends(get_db)):
    profiles = db.query(EmbeddingProfileORM).order_by(EmbeddingProfileORM.name).all()
    return [_to_schema(p) for p in profiles]


@router.post("", response_model=EmbeddingProfileSchema, status_code=201)
def create_embedding_profile(body: EmbeddingProfileCreate, db: Session = Depends(get_db)):
    data = body.model_dump()
    data["model_name"] = _normalize_embedding_model_name(data["provider_type"], data["model_name"])
    api_key = data.pop("api_key", None)
    if api_key is not None and api_key == "":
        raise HTTPException(status_code=400, detail="api_key cannot be empty string; omit the field to leave unset")
    profile = EmbeddingProfileORM(
        **data,
        api_key_encrypted=encrypt_secret(api_key) if api_key else None,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _to_schema(profile)


@router.get("/{profile_id}", response_model=EmbeddingProfileSchema)
def get_embedding_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(EmbeddingProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="EmbeddingProfile not found")
    return _to_schema(profile)


@router.patch("/{profile_id}", response_model=EmbeddingProfileSchema)
def update_embedding_profile(profile_id: str, body: EmbeddingProfileUpdate, db: Session = Depends(get_db)):
    profile = db.get(EmbeddingProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="EmbeddingProfile not found")

    data = body.model_dump(exclude_unset=True)
    if "model_name" in data:
        provider_type = data.get("provider_type", profile.provider_type)
        data["model_name"] = _normalize_embedding_model_name(provider_type, data["model_name"])
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
def delete_embedding_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(EmbeddingProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="EmbeddingProfile not found")

    # Check library snapshot references
    lib_refs = db.query(KnowledgeLibraryORM).filter(
        KnowledgeLibraryORM.embedding_profile_id == profile_id
    ).all()

    if lib_refs:
        referenced_by = [{"type": "knowledge_library", "id": l.id, "name": l.name} for l in lib_refs]
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Embedding profile is still referenced",
                "referenced_by": referenced_by,
            },
        )

    db.delete(profile)
    db.commit()


@router.post("/{profile_id}/test", response_model=EmbeddingTestResult)
def test_embedding_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(EmbeddingProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="EmbeddingProfile not found")

    try:
        from app.agents.model_adapter import embedding_from_profile
        embedder = embedding_from_profile(profile)
        start = time.monotonic()
        vec = embedder.embed_one("test")
        latency_ms = int((time.monotonic() - start) * 1000)
        return EmbeddingTestResult(success=True, dimensions=len(vec), latency_ms=latency_ms)
    except Exception as exc:
        return EmbeddingTestResult(success=False, error=str(exc))
