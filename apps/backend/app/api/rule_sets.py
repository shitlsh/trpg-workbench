from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import RuleSetORM
from app.models.schemas import RuleSetSchema, RuleSetCreate

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
