"""create_module Workflow – orchestrates full module creation (9+ steps)."""
import json
import asyncio
from sqlalchemy.orm import Session

from app.workflows.utils import (
    create_workflow, update_step, complete_workflow,
    fail_workflow, pause_workflow, pause_for_clarification, get_workspace_context,
)
from app.agents.director import run_director
from app.agents.rules import run_rules_agent
from app.agents.plot import run_plot_agent
from app.agents.npc import run_npc_agent
from app.agents.monster import run_monster_agent
from app.agents.lore import run_lore_agent
from app.agents.consistency import run_consistency_agent
from app.agents.document import run_document_agent
from app.services.asset_service import create_asset, update_asset, get_asset_with_content
from app.models.orm import WorkflowStateORM, WorkspaceORM, AssetORM


STEP_NAMES = [
    "",                              # 0 (unused)
    "读取 Workspace 配置",            # 1
    "生成变更计划（等待用户确认）",     # 2
    "检索规则知识库",                  # 3
    "生成故事大纲",                    # 4
    "生成场景列表",                    # 5
    "生成关键 NPC",                    # 6
    "生成怪物/实体",                   # 7
    "生成地点与世界观",                # 8
    "生成线索链",                      # 9
    "一致性检查",                      # 10
    "格式化资产",                      # 11
    "落盘保存",                        # 12
    "完成",                            # 13
]
TOTAL_STEPS = 13


async def run_create_module(
    db: Session,
    workspace_id: str,
    user_intent: str,
    model=None,
    knowledge_retriever=None,
) -> WorkflowStateORM:
    """
    Runs the full create_module workflow.
    knowledge_retriever: optional callable(query, workspace_id) -> list[Citation]
    Returns the WorkflowStateORM after completion or failure.
    """
    wf = create_workflow(
        db=db,
        workspace_id=workspace_id,
        wf_type="create_module",
        total_steps=TOTAL_STEPS,
        input_snapshot={"user_intent": user_intent},
    )

    try:
        # ── Step 1: Load workspace config ──────────────────────────────────
        update_step(db, wf, 1, STEP_NAMES[1], "running")
        ws_ctx = get_workspace_context(db, workspace_id)
        update_step(db, wf, 1, STEP_NAMES[1], "completed",
                    summary=f"工作空间：{ws_ctx.get('workspace_name')}")

        # ── Step 0: Director – clarification check ─────────────────────────
        # (Step 0 is optional, only triggered if Director needs clarification)
        update_step(db, wf, 2, STEP_NAMES[2], "running")
        director_result = run_director(user_intent, ws_ctx, model=model, allow_clarification=True)

        if director_result.get("needs_clarification"):
            # Director wants clarification – pause and wait for user answers
            questions = director_result.get("clarification_questions", [])
            pause_for_clarification(db, wf, questions)
            return wf  # Frontend will show ClarificationCard

        # No clarification needed – store change plan and wait for user confirm
        update_step(db, wf, 2, STEP_NAMES[2], "waiting_confirm",
                    summary=json.dumps(director_result, ensure_ascii=False))
        pause_workflow(db, wf)
        return wf  # Caller must resume after user confirms

    except Exception as e:
        fail_workflow(db, wf, str(e))
        return wf


async def resume_create_module(
    db: Session,
    wf: WorkflowStateORM,
    model=None,
    knowledge_retriever=None,
) -> WorkflowStateORM:
    """Continue a paused/clarification create_module workflow."""
    step_results = json.loads(wf.step_results or "[]")
    input_snapshot = json.loads(wf.input_snapshot or "{}")
    user_intent = input_snapshot.get("user_intent", "")
    workspace_id = wf.workspace_id

    ws_ctx = get_workspace_context(db, workspace_id)

    # Build style prefix from workspace's rule set PromptProfile
    style_prefix = ""
    if ws_ctx.get("style_prompt"):
        style_prefix = f"[创作风格约束]\n{ws_ctx['style_prompt']}\n\n"

    # Check if clarification answers are present (user just answered clarification questions)
    clarification_answers = None
    if wf.clarification_answers:
        try:
            clarification_answers = json.loads(wf.clarification_answers)
        except Exception:
            clarification_answers = None

    # If we have clarification answers but step 2 doesn't yet have an execution plan,
    # run Director in planning mode to get the plan
    step2 = next((s for s in step_results if s["step"] == 2), None)
    change_plan: dict = {}

    if clarification_answers and (not step2 or step2.get("status") != "waiting_confirm"):
        # Re-run Director with answers to get execution plan
        wf.status = "planning"
        db.commit()

        # Build answers summary for style prefix injection
        answers_summary = "\n".join(
            f"- {k}: {v if isinstance(v, str) else ', '.join(v)}"
            for k, v in clarification_answers.items()
        )
        answers_prefix = f"[用户创作偏好]\n{answers_summary}\n\n"

        director_result = run_director(
            user_intent, ws_ctx, model=model,
            allow_clarification=False,
            clarification_answers=clarification_answers,
        )
        change_plan = director_result
        update_step(db, wf, 2, STEP_NAMES[2], "waiting_confirm",
                    summary=json.dumps(change_plan, ensure_ascii=False))
        pause_workflow(db, wf)
        return wf  # Wait for user to confirm the execution plan

    elif step2 and step2.get("summary"):
        try:
            change_plan = json.loads(step2["summary"])
        except Exception:
            change_plan = {}

    # Build answers prefix if available
    answers_prefix = ""
    if clarification_answers:
        answers_summary = "\n".join(
            f"- {k}: {v if isinstance(v, str) else ', '.join(v)}"
            for k, v in clarification_answers.items()
        )
        answers_prefix = f"[用户创作偏好]\n{answers_summary}\n\n"

    premise = change_plan.get("change_plan", user_intent)
    full_prefix = style_prefix + answers_prefix
    wf.status = "running"
    db.commit()

    try:
        # ── Step 3: Rules Agent retrieval ───────────────────────────────────
        update_step(db, wf, 3, STEP_NAMES[3], "running")
        knowledge_context = []
        if knowledge_retriever:
            try:
                knowledge_context = await asyncio.to_thread(
                    knowledge_retriever, premise, workspace_id
                )
            except Exception:
                knowledge_context = []
        rules_result = run_rules_agent(full_prefix + premise, knowledge_context, model=model)
        update_step(db, wf, 3, STEP_NAMES[3], "completed",
                    summary=rules_result.get("summary", "规则检索完成"))

        # ── Step 4: Plot Agent – outline ────────────────────────────────────
        update_step(db, wf, 4, STEP_NAMES[4], "running")
        outline = run_plot_agent(full_prefix + premise, "outline", knowledge_context, ws_ctx, model=model)
        update_step(db, wf, 4, STEP_NAMES[4], "completed",
                    summary=outline.get("title", "大纲生成完成"))

        # ── Step 5: Plot Agent – stages ─────────────────────────────────────
        update_step(db, wf, 5, STEP_NAMES[5], "running")
        stages_result = run_plot_agent(full_prefix + premise, "stages", knowledge_context, ws_ctx, model=model)
        stages = stages_result.get("stages", [])
        update_step(db, wf, 5, STEP_NAMES[5], "completed",
                    summary=f"生成 {len(stages)} 个场景")

        # ── Step 6: NPC Agent ───────────────────────────────────────────────
        update_step(db, wf, 6, STEP_NAMES[6], "running")
        stage_summaries = [s.get("description", s.get("name", "")) for s in stages]
        npcs = run_npc_agent(full_prefix + premise, stage_summaries, 3, knowledge_context, ws_ctx, model=model)
        update_step(db, wf, 6, STEP_NAMES[6], "completed",
                    summary=f"生成 {len(npcs)} 个 NPC")

        # ── Step 7: Monster Agent ───────────────────────────────────────────
        update_step(db, wf, 7, STEP_NAMES[7], "running")
        monster_hints = change_plan.get("monster_hints", [])
        monsters = run_monster_agent(full_prefix + premise, monster_hints, knowledge_context, ws_ctx, model=model)
        update_step(db, wf, 7, STEP_NAMES[7], "completed",
                    summary=f"生成 {len(monsters)} 个怪物/实体")

        # ── Step 8: Lore Agent – locations & lore notes ────────────────────
        update_step(db, wf, 8, STEP_NAMES[8], "running")
        location_hints = [s.get("name", "") for s in stages[:3]]
        lore_result = run_lore_agent(
            full_prefix + premise, location_hints, knowledge_context, ws_ctx,
            location_count=max(2, len(stages[:3])),
            lore_note_count=2,
            model=model,
        )
        locations = lore_result.get("locations", [])
        lore_notes = lore_result.get("lore_notes", [])
        update_step(db, wf, 8, STEP_NAMES[8], "completed",
                    summary=f"生成 {len(locations)} 个地点，{len(lore_notes)} 个世界观词条")

        # ── Step 9: Clue chain ──────────────────────────────────────────────
        update_step(db, wf, 9, STEP_NAMES[9], "running")
        clues_result = run_plot_agent(full_prefix + premise, "clues", knowledge_context, ws_ctx, model=model)
        clues = clues_result.get("clues", [])
        update_step(db, wf, 9, STEP_NAMES[9], "completed",
                    summary=f"生成 {len(clues)} 条线索")

        # ── Step 10: Consistency check ──────────────────────────────────────
        update_step(db, wf, 10, STEP_NAMES[10], "running")
        all_summaries = (
            [{"type": "outline", "name": outline.get("title", "大纲"), "slug": "outline",
              "content_json": json.dumps(outline, ensure_ascii=False)}]
            + [{"type": "npc", "name": n.get("name", "NPC"), "slug": n.get("slug", "npc"),
                "content_json": json.dumps(n, ensure_ascii=False)} for n in npcs]
            + [{"type": "monster", "name": m.get("name", "怪物"), "slug": m.get("slug", "monster"),
                "content_json": json.dumps(m, ensure_ascii=False)} for m in monsters]
            + [{"type": "location", "name": loc.get("name", "地点"), "slug": loc.get("slug", "location"),
                "content_json": json.dumps(loc, ensure_ascii=False)} for loc in locations]
        )
        consistency = run_consistency_agent(all_summaries, model=model)
        update_step(db, wf, 10, STEP_NAMES[10], "completed",
                    summary=f"一致性状态：{consistency.get('overall_status', 'clean')}")

        # ── Step 11: Document Agent formatting ─────────────────────────────
        update_step(db, wf, 11, STEP_NAMES[11], "running")
        raw_assets = (
            [{"asset_id": None, "asset_name": outline.get("title", "大纲"),
              "asset_type": "outline", "asset_slug": "outline-main",
              "raw_content": outline}]
            + [{"asset_id": None, "asset_name": s.get("name"), "asset_type": "stage",
                "asset_slug": s.get("slug", f"stage-{i+1}"), "raw_content": s}
               for i, s in enumerate(stages)]
            + [{"asset_id": None, "asset_name": n.get("name"), "asset_type": "npc",
                "asset_slug": n.get("slug", f"npc-{i+1}"), "raw_content": n}
               for i, n in enumerate(npcs)]
            + [{"asset_id": None, "asset_name": m.get("name"), "asset_type": "monster",
                "asset_slug": m.get("slug", f"monster-{i+1}"), "raw_content": m}
               for i, m in enumerate(monsters)]
            + [{"asset_id": None, "asset_name": loc.get("name"), "asset_type": "location",
                "asset_slug": loc.get("slug", f"location-{i+1}"), "raw_content": loc}
               for i, loc in enumerate(locations)]
            + [{"asset_id": None, "asset_name": ln.get("name"), "asset_type": "lore_note",
                "asset_slug": ln.get("slug", f"lore-{i+1}"), "raw_content": ln}
               for i, ln in enumerate(lore_notes)]
            + [{"asset_id": None, "asset_name": c.get("name"), "asset_type": "clue",
                "asset_slug": c.get("slug", f"clue-{i+1}"), "raw_content": c}
               for i, c in enumerate(clues)]
        )
        patches = run_document_agent(raw_assets, model=model)
        update_step(db, wf, 11, STEP_NAMES[11], "completed",
                    summary=f"格式化 {len(patches)} 个资产")

        # ── Step 12: Persist assets ─────────────────────────────────────────
        update_step(db, wf, 12, STEP_NAMES[12], "running")
        ws = db.get(WorkspaceORM, workspace_id)
        created_count = 0
        for patch in patches:
            try:
                asset_type = patch.get("asset_type", "npc")
                slug = patch.get("asset_slug", "unknown")
                name = patch.get("asset_name", slug)
                content_md = patch.get("content_md", "")
                content_json = patch.get("content_json", "{}")
                summary_text = patch.get("change_summary", "由 AI 创建")

                existing = db.query(AssetORM).filter(
                    AssetORM.workspace_id == workspace_id,
                    AssetORM.type == asset_type,
                    AssetORM.slug == slug,
                ).first()

                if existing:
                    update_asset(db, existing, ws.workspace_path,
                                 content_md=content_md, content_json=content_json,
                                 change_summary=summary_text)
                else:
                    new_asset = create_asset(db, workspace_id, ws.workspace_path,
                                             asset_type, name, slug)
                    update_asset(db, new_asset, ws.workspace_path,
                                 content_md=content_md, content_json=content_json,
                                 change_summary=summary_text)
                created_count += 1
            except Exception:
                continue

        update_step(db, wf, 12, STEP_NAMES[12], "completed",
                    summary=f"保存 {created_count} 个资产")

        # ── Step 13: Done ────────────────────────────────────────────────────
        update_step(db, wf, 13, STEP_NAMES[13], "completed")
        complete_workflow(db, wf, f"模组创建完成，共生成 {created_count} 个资产")

    except Exception as e:
        fail_workflow(db, wf, str(e))

    return wf
