from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import IngestTaskORM
from app.models.schemas import IngestTaskSchema

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/{task_id}/status", response_model=IngestTaskSchema)
def get_task_status(task_id: str, db: Session = Depends(get_db)):
    task = db.get(IngestTaskORM, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
