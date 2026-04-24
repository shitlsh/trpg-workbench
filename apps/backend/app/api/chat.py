"""Chat session + message API."""
import json
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
async def send_message(session_id: str, body: SendMessageRequest, db: Session = Depends(get_db)):
    """
    Send a user message and get Director response.
    Returns: {user_message, assistant_message, change_plan, workflow_id, skill_created}
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

    skill_created = None

    # Handle create_skill workflow inline (no background task needed)
    if change_plan.get("workflow") == "create_skill":
        try:
            skill_created = await _execute_create_skill(
                user_intent=body.content,
                workspace_id=body.workspace_id,
                ws_ctx=ws_ctx,
                db=db,
            )
            if skill_created:
                change_plan = {
                    **change_plan,
                    "change_plan": (
                        f"已为您创建 Skill「{skill_created['name']}」（slug: `{skill_created['slug']}`）。"
                        f"您可以在工作区设置 → Skill 中查看和编辑。"
                    ),
                }
        except Exception as e:
            change_plan = {
                **change_plan,
                "change_plan": f"Skill 创建失败：{str(e)}",
            }

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
        "skill_created": skill_created,
    }


async def _execute_create_skill(
    user_intent: str,
    workspace_id: str,
    ws_ctx: dict,
    db: Session,
) -> dict | None:
    """Run Skill Agent with RAG context and persist the result to disk."""
    from app.api.workflows import _build_knowledge_retriever, _resolve_model
    from app.agents.skill_agent import run_skill_agent
    from app.api.workspace_skills import (
        _skills_dir, _name_to_slug, _unique_slug, _write_skill, WorkspaceSkill,
    )
    from app.models.orm import WorkspaceORM

    ws = db.get(WorkspaceORM, workspace_id)
    if not ws:
        raise ValueError("Workspace not found")

    # Resolve LLM model
    model = _resolve_model(workspace_id, "create_module", db)

    # RAG retrieval (optional — may return None if no libraries bound)
    knowledge_context: list[dict] = []
    try:
        retriever = await _build_knowledge_retriever(workspace_id, "create_module", db)
        if retriever:
            citations = await retriever(user_intent, workspace_id)
            knowledge_context = [
                {"content": c.content, "source": getattr(c, "source", "")}
                for c in citations
                if hasattr(c, "content")
            ]
    except Exception:
        pass  # Proceed without knowledge context if retrieval fails

    # Run Skill Agent
    result = run_skill_agent(user_intent, knowledge_context, ws_ctx, model=model)

    # Write skill file
    skills_dir = _skills_dir(ws.workspace_path)
    base_slug = _name_to_slug(result["name"])
    slug = _unique_slug(skills_dir, base_slug)
    skill = WorkspaceSkill(
        slug=slug,
        name=result["name"],
        description=result["description"],
        agent_types=result["agent_types"],
        enabled=True,
        body=result["body"],
    )
    _write_skill(skills_dir / f"{slug}.md", skill)

    return {"slug": slug, "name": result["name"]}
