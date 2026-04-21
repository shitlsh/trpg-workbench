"""Usage API: aggregated statistics for LLM usage records."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime
from app.storage.database import get_db
from app.services.usage_aggregator import get_usage_summary, get_recent_records

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/summary")
def usage_summary(
    from_dt: str | None = Query(None, alias="from"),
    to_dt: str | None = Query(None, alias="to"),
    task_type: str | None = Query(None),
    provider_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return get_usage_summary(
        db=db,
        from_dt=_parse_dt(from_dt),
        to_dt=_parse_dt(to_dt),
        task_type=task_type,
        provider_type=provider_type,
    )


@router.get("/by-workspace/{workspace_id}")
def usage_by_workspace(
    workspace_id: str,
    from_dt: str | None = Query(None, alias="from"),
    to_dt: str | None = Query(None, alias="to"),
    task_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return get_usage_summary(
        db=db,
        workspace_id=workspace_id,
        from_dt=_parse_dt(from_dt),
        to_dt=_parse_dt(to_dt),
        task_type=task_type,
    )


@router.get("/by-model")
def usage_by_model(
    from_dt: str | None = Query(None, alias="from"),
    to_dt: str | None = Query(None, alias="to"),
    provider_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    summary = get_usage_summary(
        db=db,
        from_dt=_parse_dt(from_dt),
        to_dt=_parse_dt(to_dt),
        provider_type=provider_type,
    )
    return summary["by_model"]


@router.get("/recent")
def usage_recent(
    limit: int = Query(50, ge=1, le=200),
    workspace_id: str | None = Query(None),
    task_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return get_recent_records(db=db, limit=limit, workspace_id=workspace_id, task_type=task_type)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
