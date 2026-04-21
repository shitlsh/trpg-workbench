"""rules_review Workflow – retrieve rules context and generate advisory suggestions."""
import json
import asyncio
from sqlalchemy.orm import Session

from app.workflows.utils import (
    create_workflow, update_step, complete_workflow,
    fail_workflow, get_workspace_context,
)
from app.agents.rules import run_rules_agent
from app.models.orm import WorkflowStateORM, AssetORM, AssetRevisionORM


STEP_NAMES = [
    "",                        # 0 (unused)
    "读取资产内容",             # 1
    "检索规则知识库",            # 2
    "生成规则建议列表",          # 3
    "等待用户操作",             # 4
    "完成",                    # 5
]
TOTAL_STEPS = 5


async def run_rules_review(
    db: Session,
    workspace_id: str,
    user_question: str,
    asset_ids: list[str],
    model=None,
    knowledge_retriever=None,
) -> WorkflowStateORM:
    """
    Run rules_review workflow.
    asset_ids: optional list of asset IDs whose content provides context for the review.
    knowledge_retriever: optional callable(query, workspace_id) -> list[Citation]
    Does NOT auto-persist. User must click "Apply suggestion" to trigger modify_asset.
    """
    wf = create_workflow(
        db=db,
        workspace_id=workspace_id,
        wf_type="rules_review",
        total_steps=TOTAL_STEPS,
        input_snapshot={
            "user_question": user_question,
            "asset_ids": asset_ids,
        },
    )

    try:
        # ── Step 1: Load asset content ──────────────────────────────────────
        update_step(db, wf, 1, STEP_NAMES[1], "running")
        asset_context_parts = []
        for aid in asset_ids:
            asset = db.get(AssetORM, aid)
            if asset and asset.latest_revision_id:
                rev = db.get(AssetRevisionORM, asset.latest_revision_id)
                if rev:
                    asset_context_parts.append(
                        f"Asset [{asset.type}] {asset.name}:\n{rev.content_md[:800]}"
                    )
        asset_context_str = "\n\n".join(asset_context_parts)
        update_step(db, wf, 1, STEP_NAMES[1], "completed",
                    summary=f"加载 {len(asset_context_parts)} 个资产内容")

        # ── Step 2: Knowledge retrieval ─────────────────────────────────────
        update_step(db, wf, 2, STEP_NAMES[2], "running")
        knowledge_context = []
        if knowledge_retriever:
            try:
                knowledge_context = await asyncio.to_thread(
                    knowledge_retriever, user_question, workspace_id
                )
            except Exception:
                knowledge_context = []
        update_step(db, wf, 2, STEP_NAMES[2], "completed",
                    summary=f"检索到 {len(knowledge_context)} 条规则参考")

        # ── Step 3: Rules Agent ─────────────────────────────────────────────
        update_step(db, wf, 3, STEP_NAMES[3], "running")
        # Include asset content in the question for context
        full_question = user_question
        if asset_context_str:
            full_question = f"{user_question}\n\n参考资产内容：\n{asset_context_str}"

        result = run_rules_agent(full_question, knowledge_context, model=model)
        suggestions = result.get("suggestions", [])
        update_step(db, wf, 3, STEP_NAMES[3], "completed",
                    summary=json.dumps(result, ensure_ascii=False))

        # ── Step 4: Waiting for user action (no auto-persist) ──────────────
        update_step(db, wf, 4, STEP_NAMES[4], "completed",
                    summary="建议已生成，等待用户选择是否应用")

        # ── Step 5: Done ────────────────────────────────────────────────────
        update_step(db, wf, 5, STEP_NAMES[5], "completed")
        complete_workflow(db, wf, result.get("summary", f"生成 {len(suggestions)} 条规则建议"))

    except Exception as e:
        fail_workflow(db, wf, str(e))

    return wf
