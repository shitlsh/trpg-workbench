"""Agent tool functions for the Director Agent.

Read-only tools execute silently and return data.
Write tools (create_asset, update_asset) do NOT write directly — they raise
PatchProposalInterrupt which is caught by the SSE layer, which then pauses the
stream and waits for user confirmation before writing.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from agno.tools import tool
from agno.exceptions import AgentRunException


# ─── Context injection ────────────────────────────────────────────────────────
# The SSE layer injects these before registering tools with the Agent.

_workspace_context: dict = {}
_db = None  # SQLAlchemy Session


def configure(workspace_context: dict, db) -> None:
    """Inject runtime dependencies into tool closures."""
    global _workspace_context, _db
    _workspace_context = workspace_context
    _db = db


# ─── PatchProposal interrupt ──────────────────────────────────────────────────

class PatchProposalInterrupt(AgentRunException):
    """Raised by write tools to signal a patch proposal needs user confirmation.
    
    Inherits AgentRunException so Agno re-raises it instead of swallowing it
    as a generic tool error. stop_execution=True halts the agent run.
    """

    def __init__(self, proposal: dict):
        self.proposal = proposal
        super().__init__("patch_proposal", stop_execution=True)


# ─── Read-only tools ──────────────────────────────────────────────────────────

@tool
def list_assets(asset_type: str = "") -> str:
    """列出工作空间中的资产。可选 asset_type 过滤（如 "npc", "stage", "location"）。
    返回 JSON 数组，每项含 type/name/slug/summary 字段。"""
    assets = _workspace_context.get("existing_assets", [])
    if asset_type:
        assets = [a for a in assets if a.get("type") == asset_type]
    return json.dumps(assets, ensure_ascii=False)


@tool
def read_asset(asset_slug: str) -> str:
    """读取指定资产的完整 Markdown 内容。asset_slug 是资产的 slug 标识符。
    返回 Markdown 文本，如果未找到则返回错误信息。"""
    ws_path = _workspace_context.get("workspace_path", "")
    if not ws_path:
        return "错误：未找到工作空间路径"

    # Search asset files across all subdirectories
    assets_root = Path(ws_path) / "assets"
    if not assets_root.exists():
        assets_root = Path(ws_path)

    # Try to find by slug
    for md_file in assets_root.rglob("*.md"):
        if md_file.stem == asset_slug or md_file.stem.replace("-", "_") == asset_slug:
            try:
                return md_file.read_text(encoding="utf-8")
            except Exception as e:
                return f"错误：读取文件失败 — {e}"

    # Also try DB lookup if available
    if _db is not None:
        from app.models.orm import AssetORM
        assets_list = _workspace_context.get("existing_assets", [])
        # match by slug
        matched = next((a for a in assets_list if a.get("slug") == asset_slug), None)
        if matched is None:
            return f"错误：未找到 slug 为 '{asset_slug}' 的资产"

    return f"错误：未找到 slug 为 '{asset_slug}' 的资产"


@tool
def search_assets(query: str) -> str:
    """按关键词搜索资产名称和 summary。返回匹配资产的 JSON 数组。"""
    assets = _workspace_context.get("existing_assets", [])
    query_lower = query.lower()
    results = [
        a for a in assets
        if query_lower in (a.get("name") or "").lower()
        or query_lower in (a.get("summary") or "").lower()
        or query_lower in (a.get("slug") or "").lower()
    ]
    return json.dumps(results, ensure_ascii=False)


@tool
def read_config() -> str:
    """读取工作空间配置信息，包含规则集名称、模型配置等。返回 JSON。"""
    ctx = {
        "workspace_name": _workspace_context.get("workspace_name"),
        "rule_set": _workspace_context.get("rule_set"),
        "custom_asset_types": _workspace_context.get("custom_asset_types", []),
        "skills": _workspace_context.get("skills", []),
    }
    return json.dumps(ctx, ensure_ascii=False)


@tool
def search_knowledge(query: str) -> str:
    """检索工作空间关联的知识库（RAG）。返回相关段落列表（JSON），含文档名和页码。"""
    library_ids = _workspace_context.get("library_ids", [])
    if not library_ids or _db is None:
        return json.dumps({"results": [], "message": "没有可用的知识库"}, ensure_ascii=False)

    try:
        from app.knowledge.retriever import retrieve_knowledge
        results = retrieve_knowledge(
            query=query,
            library_ids=library_ids,
            db=_db,
            top_k=5,
        )
        formatted = [
            {
                "document_name": r.get("document_name", r.get("document_filename", "")),
                "page_from": r.get("page_from"),
                "page_to": r.get("page_to"),
                "content": r.get("content", "")[:500],  # truncate for context budget
            }
            for r in results
        ]
        return json.dumps({"results": formatted}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"results": [], "error": str(e)}, ensure_ascii=False)


# ─── Write tools (generate PatchProposal, do NOT write directly) ──────────────

@tool
def create_asset(asset_type: str, name: str, content_md: str, change_summary: str = "") -> str:
    """创建新资产。asset_type 如 "npc"/"stage"/"location" 等，name 为资产名称，
    content_md 为完整的 Markdown 内容（含 frontmatter）。
    此操作需要用户确认后才会实际写入磁盘。"""
    proposal = {
        "id": f"pp_{uuid.uuid4().hex[:12]}",
        "tool_call_id": "",  # filled by SSE layer
        "action": "create",
        "asset_type": asset_type,
        "asset_name": name,
        "content_md": content_md,
        "original_content": "",
        "change_summary": change_summary or f"新建 {asset_type}：{name}",
    }
    raise PatchProposalInterrupt(proposal)


@tool
def update_asset(asset_slug: str, content_md: str, change_summary: str = "") -> str:
    """修改已有资产的内容。asset_slug 是资产标识符，content_md 为新的完整 Markdown 内容。
    此操作需要用户确认后才会实际写入磁盘。"""
    # Try to read original content for diff
    original = ""
    ws_path = _workspace_context.get("workspace_path", "")
    if ws_path:
        assets_root = Path(ws_path) / "assets"
        if not assets_root.exists():
            assets_root = Path(ws_path)
        for md_file in assets_root.rglob("*.md"):
            if md_file.stem == asset_slug or md_file.stem.replace("-", "_") == asset_slug:
                try:
                    original = md_file.read_text(encoding="utf-8")
                except Exception:
                    pass
                break

    # Get asset name from context
    assets = _workspace_context.get("existing_assets", [])
    matched = next((a for a in assets if a.get("slug") == asset_slug), None)
    asset_name = matched.get("name", asset_slug) if matched else asset_slug

    proposal = {
        "id": f"pp_{uuid.uuid4().hex[:12]}",
        "tool_call_id": "",  # filled by SSE layer
        "action": "update",
        "asset_type": matched.get("type", "") if matched else "",
        "asset_name": asset_name,
        "asset_slug": asset_slug,
        "content_md": content_md,
        "original_content": original,
        "change_summary": change_summary or f"修改资产：{asset_name}",
    }
    raise PatchProposalInterrupt(proposal)


# ─── Proposal execution (called after user confirms) ─────────────────────────

def execute_patch_proposal(proposal: dict, workspace_path: str, db) -> dict:
    """Actually write the patch to disk and update DB index. Returns result summary."""
    from app.services import asset_service

    action = proposal.get("action", "create")
    asset_type = proposal.get("asset_type", "")
    asset_name = proposal.get("asset_name", "")
    content_md = proposal.get("content_md", "")

    if action == "create":
        # Use asset_service to create the asset
        workspace_id = _get_workspace_id_from_path(workspace_path, db)
        if not workspace_id:
            return {"success": False, "error": "Workspace not found"}

        import re
        slug_base = re.sub(r"[^\w\u4e00-\u9fff]+", "-", asset_name.lower()).strip("-") or "asset"
        # Ensure unique slug
        from app.models.orm import AssetORM
        existing_slugs = {a.slug for a in db.query(AssetORM).filter_by(workspace_id=workspace_id).all()}
        slug = slug_base
        counter = 1
        while slug in existing_slugs:
            slug = f"{slug_base}-{counter}"
            counter += 1

        result = asset_service.create_asset_file(
            workspace_path=workspace_path,
            workspace_id=workspace_id,
            asset_type=asset_type,
            name=asset_name,
            slug=slug,
            content_md=content_md,
            change_summary=proposal.get("change_summary", "Agent 创建"),
            db=db,
        )
        return {"success": True, "asset_id": result.get("id"), "slug": slug, "action": "created"}

    elif action == "update":
        asset_slug = proposal.get("asset_slug", "")
        workspace_id = _get_workspace_id_from_path(workspace_path, db)
        if not workspace_id:
            return {"success": False, "error": "Workspace not found"}

        from app.models.orm import AssetORM
        asset = db.query(AssetORM).filter_by(workspace_id=workspace_id, slug=asset_slug).first()
        if not asset:
            return {"success": False, "error": f"Asset '{asset_slug}' not found"}

        result = asset_service.update_asset_content(
            workspace_path=workspace_path,
            asset=asset,
            content_md=content_md,
            change_summary=proposal.get("change_summary", "Agent 修改"),
            source_type="agent",
            db=db,
        )
        return {"success": True, "asset_id": asset.id, "slug": asset_slug, "action": "updated"}

    return {"success": False, "error": f"Unknown action: {action}"}


def _get_workspace_id_from_path(workspace_path: str, db) -> str | None:
    from app.models.orm import WorkspaceORM
    ws = db.query(WorkspaceORM).filter_by(workspace_path=workspace_path).first()
    return ws.id if ws else None


# ─── Tool list for Director ────────────────────────────────────────────────────

ALL_TOOLS = [list_assets, read_asset, search_assets, read_config, search_knowledge,
             create_asset, update_asset]
