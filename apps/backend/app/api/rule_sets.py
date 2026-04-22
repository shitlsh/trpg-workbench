from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import RuleSetORM, WorkspaceORM, RuleSetLibraryBindingORM, KnowledgeLibraryORM
from app.models.schemas import (
    RuleSetSchema, RuleSetCreate, RuleSetUpdate,
    RuleSetLibraryBindingSchema, RuleSetLibraryBindingCreate,
    KnowledgeLibrarySchema,
)

router = APIRouter(prefix="/rule-sets", tags=["rule-sets"])


def _is_builtin(rule_set_id: str) -> bool:
    return rule_set_id.startswith("builtin-")


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
    if _is_builtin(rule_set_id):
        raise HTTPException(status_code=403, detail="Built-in rule sets cannot be modified")
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
    if _is_builtin(rule_set_id):
        raise HTTPException(status_code=403, detail="Built-in rule sets cannot be deleted")
    dependent = db.query(WorkspaceORM).filter(WorkspaceORM.rule_set_id == rule_set_id).all()
    if dependent:
        names = [w.name for w in dependent]
        raise HTTPException(
            status_code=409,
            detail={"message": "Rule set is in use by workspaces", "workspaces": names}
        )
    db.delete(rs)
    db.commit()


# ─── Library bindings ──────────────────────────────────────────────────────────

@router.get("/{rule_set_id}/library-bindings", response_model=list[RuleSetLibraryBindingSchema])
def list_library_bindings(rule_set_id: str, db: Session = Depends(get_db)):
    rs = db.get(RuleSetORM, rule_set_id)
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    return db.query(RuleSetLibraryBindingORM).filter(
        RuleSetLibraryBindingORM.rule_set_id == rule_set_id
    ).all()


@router.post("/{rule_set_id}/library-bindings", response_model=RuleSetLibraryBindingSchema, status_code=201)
def add_library_binding(rule_set_id: str, body: RuleSetLibraryBindingCreate, db: Session = Depends(get_db)):
    rs = db.get(RuleSetORM, rule_set_id)
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    lib = db.get(KnowledgeLibraryORM, body.library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Knowledge library not found")
    existing = db.query(RuleSetLibraryBindingORM).filter_by(
        rule_set_id=rule_set_id, library_id=body.library_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Library already bound to this rule set")
    binding = RuleSetLibraryBindingORM(rule_set_id=rule_set_id, **body.model_dump())
    db.add(binding)
    db.commit()
    db.refresh(binding)
    return binding


@router.delete("/{rule_set_id}/library-bindings/{binding_id}", status_code=204)
def remove_library_binding(rule_set_id: str, binding_id: str, db: Session = Depends(get_db)):
    binding = db.query(RuleSetLibraryBindingORM).filter_by(
        id=binding_id, rule_set_id=rule_set_id
    ).first()
    if not binding:
        raise HTTPException(status_code=404, detail="Binding not found")
    db.delete(binding)
    db.commit()

