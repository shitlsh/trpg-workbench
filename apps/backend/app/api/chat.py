"""Chat session + message API."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.storage.database import get_db
from app.models.orm import ChatSessionORM, ChatMessageORM, WorkspaceORM, AssetORM
from app.models.schemas import (
    ChatSessionSchema, ChatMessageSchema,
    ChatSessionCreate, SendMessageRequest,
)
from app.agents.director import run_director
from app.workflows.utils import get_workspace_context

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/sessions", response_model=ChatSessionSchema, status_code=201)
def create_session(body: ChatSessionCreate, db: Session = Depends(get_db)):
    ws = db.get(WorkspaceORM, body.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    session = ChatSessionORM(**body.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=ChatSessionSchema)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageSchema])
def get_messages(session_id: str, db: Session = Depends(get_db)):
    return (
        db.query(ChatMessageORM)
        .filter(ChatMessageORM.session_id == session_id)
        .order_by(ChatMessageORM.created_at)
        .all()
    )


@router.post("/sessions/{session_id}/messages", response_model=dict, status_code=201)
def send_message(session_id: str, body: SendMessageRequest, db: Session = Depends(get_db)):
    """
    Send a user message and get Director response.
    Returns: {user_message, assistant_message, change_plan, workflow_id}
    """
    session = db.get(ChatSessionORM, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Save user message
    user_msg = ChatMessageORM(
        session_id=session_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    db.commit()

    # Run Director Agent
    try:
        ws_ctx = get_workspace_context(db, body.workspace_id)
        change_plan = run_director(body.content, ws_ctx)
    except Exception as e:
        change_plan = {
            "intent": "query",
            "affected_asset_types": [],
            "workflow": None,
            "agents_to_call": [],
            "change_plan": f"处理请求时出错：{str(e)}",
            "requires_user_confirm": False,
        }

    import json
    assistant_content = change_plan.get("change_plan", "")
    assistant_msg = ChatMessageORM(
        session_id=session_id,
        role="assistant",
        content=assistant_content,
        tool_calls_json=json.dumps(change_plan, ensure_ascii=False),
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)

    return {
        "user_message": ChatMessageSchema.model_validate(user_msg),
        "assistant_message": ChatMessageSchema.model_validate(assistant_msg),
        "change_plan": change_plan,
        "workflow_id": None,
    }
