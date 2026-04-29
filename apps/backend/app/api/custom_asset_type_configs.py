"""Custom Asset Type Config CRUD API (M16)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.storage.database import get_db
from app.models.orm import CustomAssetTypeConfigORM, RuleSetORM
from app.models.schemas import (
    CustomAssetTypeConfigSchema,
    CustomAssetTypeConfigCreate,
    CustomAssetTypeConfigUpdate,
)

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
