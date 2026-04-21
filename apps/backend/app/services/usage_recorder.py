"""Usage recorder: async fire-and-forget writes for LLM usage records."""
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.orm import LLMUsageRecordORM

logger = logging.getLogger(__name__)


def record_llm_usage(
    db: Session,
    llm_profile_id: str,
    task_type: str,
    workspace_id: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
) -> None:
    """
    Write an LLM usage record to the database.
    Failures are logged and silently swallowed — never propagate to callers.
    """
    try:
        record = LLMUsageRecordORM(
            llm_profile_id=llm_profile_id,
            workspace_id=workspace_id,
            task_type=task_type,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )
        db.add(record)
        db.commit()
    except Exception as exc:
        logger.warning("Failed to write LLM usage record: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
