from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import RuleSetORM, WorkspaceORM
from app.models.schemas import (
    RuleSetSchema, RuleSetCreate, RuleSetUpdate,
)

router = APIRouter(prefix="/rule-sets", tags=["rule-sets"])


@router.get("", response_model=list[RuleSetSchema])
def list_rule_sets(db: Session = Depends(get_db)):
    return db.query(RuleSetORM).order_by(RuleSetORM.name).all()


@router.post("", response_model=RuleSetSchema, status_code=201)
def create_rule_set(body: RuleSetCreate, db: Session = Depends(get_db)):
    existing = db.query(RuleSetORM).filter(RuleSetORM.slug == body.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Slug '{body.slug}' already exists")
    rs = RuleSetORM(**body.model_dump())
    db.add(rs)
    db.commit()
    db.refresh(rs)
    return rs


@router.patch("/{rule_set_id}", response_model=RuleSetSchema)
def update_rule_set(rule_set_id: str, body: RuleSetUpdate, db: Session = Depends(get_db)):
    rs = db.get(RuleSetORM, rule_set_id)
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rs, field, value)
    db.commit()
    db.refresh(rs)
    return rs


@router.delete("/{rule_set_id}", status_code=204)
def delete_rule_set(rule_set_id: str, db: Session = Depends(get_db)):
    rs = db.get(RuleSetORM, rule_set_id)
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    dependent = db.query(WorkspaceORM).filter(WorkspaceORM.rule_set_id == rule_set_id).all()
    if dependent:
        names = [w.name for w in dependent]
        raise HTTPException(
            status_code=409,
            detail={"message": "Rule set is in use by workspaces", "workspaces": names}
        )
    db.delete(rs)
    db.commit()
