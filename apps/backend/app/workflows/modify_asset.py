"""modify_asset Workflow – targeted modification of one or more existing assets."""
import json
import asyncio
from sqlalchemy.orm import Session

from app.workflows.utils import (
    create_workflow, update_step, complete_workflow,
    fail_workflow, pause_workflow, get_workspace_context,
)
from app.agents.director import run_director
from app.agents.consistency import run_consistency_agent
from app.agents.document import run_document_agent
from app.agents.plot import run_plot_agent
from app.agents.npc import run_npc_agent
from app.agents.monster import run_monster_agent
from app.agents.lore import run_lore_agent
from app.models.orm import WorkflowStateORM, WorkspaceORM, AssetORM, AssetRevisionORM


STEP_NAMES = [
    "",                              # 0 (unused)
    "识别改动意图",                   # 1
    "检索相关知识库",                  # 2
    "生成修改内容",                    # 3
    "一致性检查",                      # 4
    "生成 Patch 方案",                # 5
    "等待用户确认",                    # 6
    "落盘保存",                        # 7
    "完成",                            # 8
]
TOTAL_STEPS = 8


async def run_modify_asset(
    db: Session,
    workspace_id: str,
    user_intent: str,
    affected_asset_ids: list[str],
    model=None,
    knowledge_retriever=None,
) -> WorkflowStateORM:
    wf = create_workflow(
        db=db,
        workspace_id=workspace_id,
        wf_type="modify_asset",
        total_steps=TOTAL_STEPS,
        input_snapshot={
            "user_intent": user_intent,
            "affected_asset_ids": affected_asset_ids,
        },
    )

    try:
        ws_ctx = get_workspace_context(db, workspace_id)

        # Build style prefix from workspace's rule set PromptProfile
        style_prefix = ""
        if ws_ctx.get("style_prompt"):
            style_prefix = f"[创作风格约束]\n{ws_ctx['style_prompt']}\n\n"

        # ── Step 1: Director intent analysis ───────────────────────────────
        update_step(db, wf, 1, STEP_NAMES[1], "running")
        change_plan = run_director(style_prefix + user_intent, ws_ctx, model=model)
        update_step(db, wf, 1, STEP_NAMES[1], "completed",
                    summary=change_plan.get("change_plan", ""))

        # ── Step 2: Knowledge retrieval ────────────────────────────────────
        update_step(db, wf, 2, STEP_NAMES[2], "running")
        knowledge_context = []
        if knowledge_retriever:
            try:
                knowledge_context = await asyncio.to_thread(
                    knowledge_retriever, user_intent, workspace_id
                )
            except Exception:
                knowledge_context = []
        update_step(db, wf, 2, STEP_NAMES[2], "completed",
                    summary=f"检索到 {len(knowledge_context)} 条相关内容")

        # ── Step 3: Generate modifications ────────────────────────────────
        update_step(db, wf, 3, STEP_NAMES[3], "running")
        assets = []
        for aid in affected_asset_ids:
            asset = db.get(AssetORM, aid)
            if asset and asset.latest_revision_id:
                rev = db.get(AssetRevisionORM, asset.latest_revision_id)
                assets.append({
                    "asset_id": asset.id,
                    "asset_name": asset.name,
                    "asset_type": asset.type,
                    "asset_slug": asset.slug,
                    "current_content_md": rev.content_md if rev else "",
                    "current_content_json": rev.content_json if rev else "{}",
                })

        # Call appropriate agent based on asset type
        raw_assets_for_doc = []
        for asset_ctx in assets:
            asset_type = asset_ctx["asset_type"]
            if asset_type == "npc":
                raw = run_npc_agent(style_prefix + user_intent, [], 1, knowledge_context, ws_ctx, model=model)
                raw_content = raw[0] if raw else {}
            elif asset_type == "monster":
                raw = run_monster_agent(style_prefix + user_intent, [asset_ctx["asset_name"]], knowledge_context, ws_ctx, model=model)
                raw_content = raw[0] if raw else {}
            elif asset_type in ("location", "lore_note"):
                raw = run_lore_agent(style_prefix + user_intent, [asset_ctx["asset_name"]], knowledge_context, ws_ctx,
                                     location_count=1, lore_note_count=1, model=model)
                locs = raw.get("locations", [])
                lnotes = raw.get("lore_notes", [])
                raw_content = locs[0] if locs and asset_type == "location" else (lnotes[0] if lnotes else {})
            else:
                raw = run_plot_agent(style_prefix + user_intent, "outline", knowledge_context, ws_ctx, model=model)
                raw_content = raw
            raw_assets_for_doc.append({
                "asset_id": asset_ctx["asset_id"],
                "asset_name": asset_ctx["asset_name"],
                "asset_type": asset_type,
                "asset_slug": asset_ctx["asset_slug"],
                "raw_content": raw_content,
                "existing_md": asset_ctx["current_content_md"],
            })

        update_step(db, wf, 3, STEP_NAMES[3], "completed",
                    summary=f"修改内容已生成，涉及 {len(raw_assets_for_doc)} 个资产")

        # ── Step 4: Consistency check ──────────────────────────────────────
        update_step(db, wf, 4, STEP_NAMES[4], "running")
        consistency = run_consistency_agent(
            [{"type": a["asset_type"], "name": a["asset_name"], "slug": a["asset_slug"],
              "content_json": json.dumps(a.get("raw_content", {}), ensure_ascii=False)}
             for a in raw_assets_for_doc],
            model=model,
        )
        update_step(db, wf, 4, STEP_NAMES[4], "completed",
                    summary=f"一致性状态：{consistency.get('overall_status', 'clean')}")

        # ── Step 5: Document Agent – patch proposals ───────────────────────
        update_step(db, wf, 5, STEP_NAMES[5], "running")
        patches = run_document_agent(raw_assets_for_doc, model=model)
        update_step(db, wf, 5, STEP_NAMES[5], "completed",
                    summary=json.dumps(patches, ensure_ascii=False))

        # ── Step 6: Pause for user confirmation ───────────────────────────
        update_step(db, wf, 6, STEP_NAMES[6], "waiting_confirm",
                    summary=json.dumps(patches, ensure_ascii=False))
        pause_workflow(db, wf)

    except Exception as e:
        fail_workflow(db, wf, str(e))

    return wf


async def apply_modify_asset_patches(
    db: Session,
    wf: WorkflowStateORM,
) -> WorkflowStateORM:
    """Apply the patches stored in step 6 (called after user confirmation)."""
    step_results = json.loads(wf.step_results)
    step6 = next((s for s in step_results if s["step"] == 6), None)
    patches = []
    if step6 and step6.get("summary"):
        try:
            patches = json.loads(step6["summary"])
        except Exception:
            patches = []

    wf.status = "running"
    db.commit()

    try:
        from app.services.asset_service import update_asset
        ws = db.get(WorkspaceORM, wf.workspace_id)
        if not ws:
            fail_workflow(db, wf, f"Workspace {wf.workspace_id} not found")
            return wf

        update_step(db, wf, 7, STEP_NAMES[7], "running")
        saved = 0
        for patch in patches:
            asset_id = patch.get("asset_id")
            if not asset_id:
                continue
            asset = db.get(AssetORM, asset_id)
            if not asset:
                continue
            update_asset(
                db, asset, ws.workspace_path,
                content_md=patch.get("content_md"),
                content_json=patch.get("content_json"),
                change_summary=patch.get("change_summary", "AI 修改"),
            )
            saved += 1

        update_step(db, wf, 7, STEP_NAMES[7], "completed", summary=f"保存 {saved} 个资产")
        update_step(db, wf, 8, STEP_NAMES[8], "completed")
        complete_workflow(db, wf, f"修改完成，共更新 {saved} 个资产")

    except Exception as e:
        fail_workflow(db, wf, str(e))

    return wf
