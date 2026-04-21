"""Prompt Profile CRUD API."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import PromptProfileORM
from app.models.schemas import PromptProfileSchema, PromptProfileCreate, PromptProfileUpdate

router = APIRouter(prefix="/prompt-profiles", tags=["prompt-profiles"])


@router.get("", response_model=list[PromptProfileSchema])
def list_profiles(db: Session = Depends(get_db)):
    return db.query(PromptProfileORM).order_by(PromptProfileORM.created_at).all()


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
    if p.is_builtin:
        raise HTTPException(status_code=400, detail="Cannot modify builtin profiles")
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
    if p.is_builtin:
        raise HTTPException(status_code=400, detail="Cannot delete builtin profiles")
    db.delete(p)
    db.commit()
