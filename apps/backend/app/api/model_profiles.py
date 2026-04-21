from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import ModelProfileORM
from app.models.schemas import ModelProfileSchema, ModelProfileCreate, ModelProfileUpdate
from app.utils.secrets import encrypt_secret

router = APIRouter(prefix="/settings/model-profiles", tags=["model-profiles"])


@router.get("", response_model=list[ModelProfileSchema])
def list_model_profiles(db: Session = Depends(get_db)):
    return db.query(ModelProfileORM).order_by(ModelProfileORM.name).all()


@router.post("", response_model=ModelProfileSchema, status_code=201)
def create_model_profile(body: ModelProfileCreate, db: Session = Depends(get_db)):
    data = body.model_dump()
    api_key = data.pop("api_key")
    profile = ModelProfileORM(**data, api_key_encrypted=encrypt_secret(api_key) if api_key else None)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/{profile_id}", response_model=ModelProfileSchema)
def update_model_profile(profile_id: str, body: ModelProfileUpdate, db: Session = Depends(get_db)):
    profile = db.get(ModelProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="ModelProfile not found")
    data = body.model_dump(exclude_unset=True)
    api_key = data.pop("api_key", None)
    for field, value in data.items():
        setattr(profile, field, value)
    if api_key:
        profile.api_key_encrypted = encrypt_secret(api_key)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=204)
def delete_model_profile(profile_id: str, db: Session = Depends(get_db)):
    profile = db.get(ModelProfileORM, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="ModelProfile not found")
    db.delete(profile)
    db.commit()
