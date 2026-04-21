"""Usage aggregator: query and aggregate LLM usage records with cost estimation."""
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func, select
from app.models.orm import LLMUsageRecordORM, LLMProfileORM, ModelCatalogEntryORM


def _get_pricing(db: Session, provider_type: str, model_name: str) -> tuple[float | None, float | None]:
    """Look up input/output pricing from model catalog."""
    entry_id = f"{provider_type}:{model_name}"
    entry = db.get(ModelCatalogEntryORM, entry_id)
    if entry:
        return entry.input_price_per_1m, entry.output_price_per_1m
    return None, None


def _estimate_cost(
    input_tokens: int | None,
    output_tokens: int | None,
    input_price: float | None,
    output_price: float | None,
) -> float | None:
    if input_tokens is None and output_tokens is None:
        return None
    if input_price is None and output_price is None:
        return None
    cost = 0.0
    if input_tokens and input_price:
        cost += (input_tokens / 1_000_000) * input_price
    if output_tokens and output_price:
        cost += (output_tokens / 1_000_000) * output_price
    return round(cost, 6)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def get_usage_summary(
    db: Session,
    workspace_id: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    task_type: str | None = None,
    provider_type: str | None = None,
) -> dict:
    """Return aggregated usage summary with optional filters."""
    stmt = select(LLMUsageRecordORM)
    if workspace_id:
        stmt = stmt.where(LLMUsageRecordORM.workspace_id == workspace_id)
    if from_dt:
        stmt = stmt.where(LLMUsageRecordORM.created_at >= from_dt)
    if to_dt:
        stmt = stmt.where(LLMUsageRecordORM.created_at <= to_dt)
    if task_type:
        stmt = stmt.where(LLMUsageRecordORM.task_type == task_type)

    records = db.execute(stmt).scalars().all()

    # Join with profiles for provider_type / model_name
    profile_cache: dict[str, LLMProfileORM] = {}

    def get_profile(pid: str) -> LLMProfileORM | None:
        if pid not in profile_cache:
            profile_cache[pid] = db.get(LLMProfileORM, pid)
        return profile_cache[pid]

    # Filter by provider_type if requested
    enriched = []
    for r in records:
        profile = get_profile(r.llm_profile_id)
        pt = profile.provider_type if profile else "unknown"
        mn = profile.model_name if profile else "unknown"
        if provider_type and pt != provider_type:
            continue
        enriched.append((r, pt, mn))

    total_input = sum(r.prompt_tokens or 0 for r, _, _ in enriched)
    total_output = sum(r.completion_tokens or 0 for r, _, _ in enriched)
    call_count = len(enriched)

    # Aggregate by model
    model_groups: dict[str, dict] = {}
    for r, pt, mn in enriched:
        key = f"{pt}:{mn}"
        if key not in model_groups:
            model_groups[key] = {"provider_type": pt, "model_name": mn, "input_tokens": 0, "output_tokens": 0, "call_count": 0}
        model_groups[key]["input_tokens"] += r.prompt_tokens or 0
        model_groups[key]["output_tokens"] += r.completion_tokens or 0
        model_groups[key]["call_count"] += 1

    by_model = []
    total_cost: float | None = None
    for key, g in model_groups.items():
        inp_price, out_price = _get_pricing(db, g["provider_type"], g["model_name"])
        cost = _estimate_cost(g["input_tokens"], g["output_tokens"], inp_price, out_price)
        if cost is not None:
            total_cost = (total_cost or 0.0) + cost
        by_model.append({
            "provider_type": g["provider_type"],
            "model_name": g["model_name"],
            "input_tokens": g["input_tokens"],
            "output_tokens": g["output_tokens"],
            "estimated_cost_usd": cost,
            "call_count": g["call_count"],
        })

    now = datetime.now(timezone.utc)
    return {
        "period": {
            "from": from_dt.isoformat() if from_dt else None,
            "to": to_dt.isoformat() if to_dt else now.isoformat(),
        },
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "estimated_cost_usd": round(total_cost, 6) if total_cost is not None else None,
        "call_count": call_count,
        "by_model": by_model,
    }


def get_recent_records(
    db: Session,
    limit: int = 50,
    workspace_id: str | None = None,
    task_type: str | None = None,
) -> list[dict]:
    """Return recent usage records enriched with provider_type, model_name, estimated_cost."""
    stmt = select(LLMUsageRecordORM).order_by(LLMUsageRecordORM.created_at.desc()).limit(limit)
    if workspace_id:
        stmt = stmt.where(LLMUsageRecordORM.workspace_id == workspace_id)
    if task_type:
        stmt = stmt.where(LLMUsageRecordORM.task_type == task_type)

    records = db.execute(stmt).scalars().all()
    result = []
    for r in records:
        profile = db.get(LLMProfileORM, r.llm_profile_id)
        pt = profile.provider_type if profile else "unknown"
        mn = profile.model_name if profile else "unknown"
        inp_price, out_price = _get_pricing(db, pt, mn)
        cost = _estimate_cost(r.prompt_tokens, r.completion_tokens, inp_price, out_price)
        # task_type field in ORM is used as workflow_source too; split if needed
        result.append({
            "id": r.id,
            "workspace_id": r.workspace_id,
            "provider_type": pt,
            "model_name": mn,
            "task_type": r.task_type,
            "workflow_source": None,
            "input_tokens": r.prompt_tokens,
            "output_tokens": r.completion_tokens,
            "total_tokens": r.total_tokens,
            "estimated_cost_usd": cost,
            "created_at": r.created_at.isoformat(),
        })
    return result
