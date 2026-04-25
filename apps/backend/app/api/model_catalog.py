"""Model catalog API: CRUD + refresh endpoint."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.storage.database import get_db
from app.models.orm import ModelCatalogEntryORM, EmbeddingCatalogEntryORM
from app.models.schemas import (
    ModelCatalogEntrySchema,
    EmbeddingCatalogEntrySchema,
    UpdateModelCatalogEntryRequest,
    CatalogRefreshRequest,
    CatalogRefreshResult,
)
from app.services.catalog_service import refresh_catalog_from_provider

router = APIRouter(prefix="/settings/model-catalog", tags=["model-catalog"])


@router.get("", response_model=list[ModelCatalogEntrySchema])
def list_catalog(
    provider_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(ModelCatalogEntryORM).order_by(
        ModelCatalogEntryORM.provider_type,
        ModelCatalogEntryORM.model_name,
    )
    if provider_type:
        stmt = stmt.where(ModelCatalogEntryORM.provider_type == provider_type)
    return db.execute(stmt).scalars().all()


@router.get("/embedding", response_model=list[EmbeddingCatalogEntrySchema])
def list_embedding_catalog(
    provider_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(EmbeddingCatalogEntryORM).order_by(
        EmbeddingCatalogEntryORM.provider_type,
        EmbeddingCatalogEntryORM.model_name,
    )
    if provider_type:
        stmt = stmt.where(EmbeddingCatalogEntryORM.provider_type == provider_type)
    return db.execute(stmt).scalars().all()


@router.get("/{entry_id:path}", response_model=ModelCatalogEntrySchema)
def get_catalog_entry(entry_id: str, db: Session = Depends(get_db)):
    entry = db.get(ModelCatalogEntryORM, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Catalog entry not found")
    return entry


@router.patch("/{entry_id:path}", response_model=ModelCatalogEntrySchema)
def update_catalog_entry(
    entry_id: str,
    body: UpdateModelCatalogEntryRequest,
    db: Session = Depends(get_db),
):
    entry = db.get(ModelCatalogEntryORM, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Catalog entry not found")

    update_data = body.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(entry, k, v)
    # Mark as user-customized so dynamic refresh won't overwrite pricing
    if any(k in update_data for k in ("input_price_per_1m", "output_price_per_1m")):
        entry.source = "user"
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/refresh", response_model=CatalogRefreshResult)
def refresh_catalog(body: CatalogRefreshRequest, db: Session = Depends(get_db)):
    added, updated, error = refresh_catalog_from_provider(
        db=db,
        provider_type=body.provider_type,
        llm_profile_id=body.llm_profile_id,
        base_url=body.base_url,
        api_key=body.api_key,
    )
    return CatalogRefreshResult(
        provider_type=body.provider_type,
        models_added=added,
        models_updated=updated,
        error=error,
    )
