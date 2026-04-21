"""generate_image Workflow – generate images for assets with image_brief."""
import json
import os
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy.orm import Session

from app.workflows.utils import create_workflow, update_step, complete_workflow, fail_workflow
from app.agents.document import run_document_agent
from app.models.orm import WorkflowStateORM, AssetORM, AssetRevisionORM, ImageGenerationJobORM, WorkspaceORM
from app.services.asset_service import update_asset


STEP_NAMES = [
    "",                            # 0 (unused)
    "读取资产内容",                  # 1
    "生成图像 Prompt",              # 2
    "等待用户确认 Prompt",          # 3
    "调用图像 API",                 # 4
    "保存图像并写 Revision",        # 5
    "完成",                         # 6
]
TOTAL_STEPS = 6


async def run_generate_image(
    db: Session,
    workspace_id: str,
    asset_id: str,
    user_prompt_override: str | None = None,
    provider: str = "dalle3",
    model=None,
) -> WorkflowStateORM:
    """
    Run image generation workflow for a given asset.
    user_prompt_override: if provided, skip Document Agent prompt generation and use this prompt directly.
    """
    wf = create_workflow(
        db=db,
        workspace_id=workspace_id,
        wf_type="generate_image",
        total_steps=TOTAL_STEPS,
        input_snapshot={
            "asset_id": asset_id,
            "provider": provider,
            "user_prompt_override": user_prompt_override,
        },
    )

    try:
        # ── Step 1: Load asset content ──────────────────────────────────────
        update_step(db, wf, 1, STEP_NAMES[1], "running")
        asset = db.get(AssetORM, asset_id)
        if not asset:
            fail_workflow(db, wf, f"Asset {asset_id} not found")
            return wf

        content_json = "{}"
        if asset.latest_revision_id:
            rev = db.get(AssetRevisionORM, asset.latest_revision_id)
            if rev:
                content_json = rev.content_json

        update_step(db, wf, 1, STEP_NAMES[1], "completed",
                    summary=f"资产：{asset.name}（{asset.type}）")

        # ── Step 2: Generate prompt via Document Agent ──────────────────────
        update_step(db, wf, 2, STEP_NAMES[2], "running")
        if user_prompt_override:
            generated_prompt = user_prompt_override
        else:
            # Extract image_brief from asset JSON and use Document Agent to refine
            try:
                asset_data = json.loads(content_json)
                image_brief = asset_data.get("image_brief", {})
                subject = image_brief.get("subject", asset.name)
                mood = image_brief.get("mood", "mysterious")
                key_elements = ", ".join(image_brief.get("key_elements", []))
                style = image_brief.get("style", "realistic illustration")
                generated_prompt = (
                    f"{subject}. {mood} atmosphere. Key elements: {key_elements}. "
                    f"Art style: {style}. High detail, dramatic lighting."
                )
            except Exception:
                generated_prompt = f"A dramatic illustration of {asset.name}, high detail, atmospheric"

        update_step(db, wf, 2, STEP_NAMES[2], "completed",
                    summary=generated_prompt)

        # ── Step 3: Pause for user to confirm/edit prompt ───────────────────
        update_step(db, wf, 3, STEP_NAMES[3], "waiting_confirm",
                    summary=json.dumps({"prompt": generated_prompt, "provider": provider}, ensure_ascii=False))
        wf.status = "paused"
        db.commit()

    except Exception as e:
        fail_workflow(db, wf, str(e))

    return wf


async def resume_generate_image(
    db: Session,
    wf: WorkflowStateORM,
    confirmed_prompt: str,
    api_key: str | None = None,
) -> WorkflowStateORM:
    """Continue after user confirms or edits the prompt."""
    step_results = json.loads(wf.step_results)
    input_snapshot = json.loads(wf.input_snapshot)
    asset_id = input_snapshot.get("asset_id")
    provider = input_snapshot.get("provider", "dalle3")

    wf.status = "running"
    db.commit()

    try:
        asset = db.get(AssetORM, asset_id)
        ws = db.get(WorkspaceORM, wf.workspace_id)

        # ── Step 4: Call image API ──────────────────────────────────────────
        update_step(db, wf, 4, STEP_NAMES[4], "running")

        # Create job record
        job = ImageGenerationJobORM(
            workspace_id=wf.workspace_id,
            asset_id=asset_id,
            prompt=confirmed_prompt,
            provider=provider,
            status="running",
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        result_path: str | None = None
        try:
            result_path = await _call_image_api(
                prompt=confirmed_prompt,
                provider=provider,
                workspace_path=ws.workspace_path,
                asset_id=asset_id,
                api_key=api_key,
            )
            job.status = "completed"
            job.result_path = result_path
        except Exception as e:
            job.status = "failed"
            job.error_message = str(e)
            db.commit()
            fail_workflow(db, wf, f"图像生成失败：{e}")
            return wf

        db.commit()
        update_step(db, wf, 4, STEP_NAMES[4], "completed",
                    summary=f"图像已生成：{result_path}")

        # ── Step 5: Save path to asset JSON and write revision ──────────────
        update_step(db, wf, 5, STEP_NAMES[5], "running")
        if asset and asset.latest_revision_id:
            rev = db.get(AssetRevisionORM, asset.latest_revision_id)
            if rev:
                try:
                    content = json.loads(rev.content_json)
                    if "image_brief" not in content:
                        content["image_brief"] = {}
                    content["image_brief"]["generated_image_path"] = result_path
                    update_asset(
                        db, asset, ws.workspace_path,
                        content_json=json.dumps(content, ensure_ascii=False),
                        change_summary="生成图像",
                        source_type="agent",
                    )
                except Exception:
                    pass

        update_step(db, wf, 5, STEP_NAMES[5], "completed")

        # ── Step 6: Done ────────────────────────────────────────────────────
        update_step(db, wf, 6, STEP_NAMES[6], "completed")
        complete_workflow(db, wf, f"图像已保存：{result_path}")

    except Exception as e:
        fail_workflow(db, wf, str(e))

    return wf


async def _call_image_api(
    prompt: str,
    provider: str,
    workspace_path: str,
    asset_id: str,
    api_key: str | None,
) -> str:
    """
    Call the image generation API and save the result.
    Returns the saved file path.
    Supports: dalle3 (OpenAI), sd_api (Stable Diffusion), custom.
    """
    images_dir = Path(workspace_path) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{asset_id[:8]}_{timestamp}.png"
    save_path = str(images_dir / filename)

    if provider == "dalle3":
        import httpx
        if not api_key:
            raise ValueError("DALL-E 3 requires an API key")
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": "dall-e-3", "prompt": prompt, "n": 1, "size": "1024x1024"},
            )
            resp.raise_for_status()
            data = resp.json()
            image_url = data["data"][0]["url"]

            # Download image
            img_resp = await client.get(image_url)
            img_resp.raise_for_status()
            with open(save_path, "wb") as f:
                f.write(img_resp.content)

    elif provider == "sd_api":
        # Stable Diffusion API (e.g., stability.ai or local)
        import httpx
        base_url = os.environ.get("SD_API_BASE_URL", "http://127.0.0.1:7860")
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{base_url}/sdapi/v1/txt2img",
                json={"prompt": prompt, "steps": 30, "width": 768, "height": 768},
            )
            resp.raise_for_status()
            import base64
            img_data = resp.json()["images"][0]
            with open(save_path, "wb") as f:
                f.write(base64.b64decode(img_data))

    else:
        raise ValueError(f"Unsupported image provider: {provider}")

    return save_path
