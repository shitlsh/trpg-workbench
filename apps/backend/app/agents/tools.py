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
_model = None  # LLM model instance (for sub-agent delegation)
_embedder = None  # Embedding model instance (for semantic search)


def configure(workspace_context: dict, db, model=None) -> None:
    """Inject runtime dependencies into tool closures.
    
    Also resolves an embedder from the first bound knowledge library so that
    search_assets can use semantic similarity when available.
    """
    global _workspace_context, _db, _model, _embedder
    _workspace_context = workspace_context
    _db = db
    _model = model

    # Attempt to resolve embedder for semantic asset search
    _embedder = None
    library_ids = workspace_context.get("library_ids", [])
    if library_ids and db is not None:
        try:
            from app.services.model_routing import get_embedding_for_query
            from app.agents.model_adapter import embedding_from_profile
            profile = get_embedding_for_query(library_ids[0], db)
            _embedder = embedding_from_profile(profile)
        except Exception:
            pass  # no embedding profile available — semantic search degrades to keyword


def _get_model():
    """Return the injected model, raising if not set."""
    if _model is None:
        raise ValueError("model not configured; call configure() with a model instance first")
    return _model


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
    """刷新工作空间资产列表（当前快照已注入 system prompt，无需在对话开始时调用此工具）。
    仅在需要获取最新状态时调用，例如刚刚创建/修改了资产后。
    可选 asset_type 过滤（如 "npc", "stage", "location"）。
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
def search_assets(query: str = "") -> str:
    """按关键词或语义搜索资产名称和内容。返回匹配资产的 JSON 数组。
    有 embedding profile 时走语义路径，否则 fallback 到关键词匹配。"""
    if not query or not query.strip():
        return json.dumps({"error": "query 参数不能为空。"}, ensure_ascii=False)
    ws_path = _workspace_context.get("workspace_path", "")
    # Semantic path (preferred when embedder is available)
    if _embedder is not None and ws_path:
        try:
            from app.knowledge.asset_indexer import search_assets_semantic
            results = search_assets_semantic(ws_path, query, _embedder, top_k=8)
            if results:
                return json.dumps(results, ensure_ascii=False)
        except Exception:
            pass  # fall through to keyword

    # Keyword fallback
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
def search_knowledge(query: str = "") -> str:
    """检索工作空间关联的知识库（RAG）。返回相关段落列表（JSON），含文档名和页码。"""
    if not query or not query.strip():
        return json.dumps({"error": "query 参数不能为空，请提供具体的搜索关键词。"}, ensure_ascii=False)
    library_ids = _workspace_context.get("library_ids", [])
    if not library_ids or _db is None:
        return json.dumps({
            "results": [],
            "message": "当前工作空间未绑定任何知识库。若需要规则参考，请先在「知识库」页面导入规则书并绑定到此工作空间。",
        }, ensure_ascii=False)

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
    if _workspace_context.get("trust_mode") and _db is not None:
        ws_path = _workspace_context.get("workspace_path", "")
        result = execute_patch_proposal(proposal, ws_path, _db)
        return json.dumps({"auto_applied": True, **result}, ensure_ascii=False)
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
    if _workspace_context.get("trust_mode") and _db is not None:
        result = execute_patch_proposal(proposal, ws_path, _db)
        return json.dumps({"auto_applied": True, **result}, ensure_ascii=False)
    raise PatchProposalInterrupt(proposal)


# ─── Proposal execution (called after user confirms) ─────────────────────────

def execute_patch_proposal(proposal: dict, workspace_path: str, db) -> dict:
    """Actually write the patch to disk and update DB index. Returns result summary."""
    import re
    import threading
    from app.services import asset_service
    from app.models.orm import AssetORM, _uuid

    action = proposal.get("action", "create")
    asset_type = proposal.get("asset_type", "")
    asset_name = proposal.get("asset_name", "")
    content_md = proposal.get("content_md", "")

    workspace_id = _get_workspace_id_from_path(workspace_path, db)
    if not workspace_id:
        return {"success": False, "error": "Workspace not found"}

    # Parse summary from frontmatter (if present) to store in DB index
    summary = _extract_frontmatter_field(content_md, "summary")
    # Strip frontmatter to get body for service call
    body = _strip_frontmatter_block(content_md)

    def _trigger_index(asset_id: str, slug: str, name: str, atype: str, cmd: str) -> None:
        """Background thread: embed and index the asset."""
        if _embedder is None:
            return
        try:
            from app.knowledge.asset_indexer import index_asset
            index_asset(
                workspace_path=workspace_path,
                asset_id=asset_id,
                slug=slug,
                name=name,
                asset_type=atype,
                content_md=cmd,
                embedder=_embedder,
            )
        except Exception:
            pass

    if action == "create":
        slug_base = re.sub(r"[^\w\u4e00-\u9fff]+", "-", asset_name.lower()).strip("-") or "asset"
        existing_slugs = {a.slug for a in db.query(AssetORM).filter_by(workspace_id=workspace_id).all()}
        slug = slug_base
        counter = 1
        while slug in existing_slugs:
            slug = f"{slug_base}-{counter}"
            counter += 1

        # Write file to disk
        result = asset_service.create_asset(
            workspace_path=workspace_path,
            asset_type=asset_type,
            name=asset_name,
            slug=slug,
            summary=summary,
            body=content_md,  # write full content_md as body (includes frontmatter if any)
        )

        # Create DB index row
        asset_id = _uuid()
        asset_row = AssetORM(
            id=asset_id,
            workspace_id=workspace_id,
            type=asset_type,
            name=asset_name,
            slug=slug,
            status="draft",
            summary=summary,
            file_path=result["rel_path"],
            file_hash=result["file_hash"],
            version=1,
        )
        db.add(asset_row)
        db.commit()

        # Async embed
        threading.Thread(
            target=_trigger_index,
            args=(asset_id, slug, asset_name, asset_type, content_md),
            daemon=True,
        ).start()

        return {"success": True, "asset_id": asset_id, "slug": slug, "action": "created"}

    elif action == "update":
        asset_slug = proposal.get("asset_slug", "")
        asset = db.query(AssetORM).filter_by(workspace_id=workspace_id, slug=asset_slug).first()
        if not asset:
            return {"success": False, "error": f"Asset '{asset_slug}' not found"}

        from app.utils.paths import asset_type_dir
        file_path = asset_type_dir(workspace_path, asset.type) / f"{asset_slug}.md"
        if not file_path.exists():
            # Fallback: scan
            for md_file in Path(workspace_path).rglob("*.md"):
                if md_file.stem == asset_slug:
                    file_path = md_file
                    break

        result = asset_service.update_asset(
            workspace_path=workspace_path,
            file_path=file_path,
            body=content_md,
            meta_updates={"summary": summary} if summary else None,
            change_summary=proposal.get("change_summary", "Agent 修改"),
            source_type="agent",
        )

        # Update DB index
        asset.file_hash = result["file_hash"]
        asset.version = result["revision_version"]
        if summary:
            asset.summary = summary
        db.commit()

        # Async embed
        threading.Thread(
            target=_trigger_index,
            args=(asset.id, asset_slug, asset.name, asset.type, content_md),
            daemon=True,
        ).start()

        return {"success": True, "asset_id": asset.id, "slug": asset_slug, "action": "updated"}

    return {"success": False, "error": f"Unknown action: {action}"}


def _get_workspace_id_from_path(workspace_path: str, db) -> str | None:
    from app.models.orm import WorkspaceORM
    ws = db.query(WorkspaceORM).filter_by(workspace_path=workspace_path).first()
    return ws.id if ws else None


def _extract_frontmatter_field(md: str, field: str) -> str | None:
    """Extract a single scalar field from YAML frontmatter."""
    import re
    m = re.search(rf"^{field}:\s*(.+)$", md, re.MULTILINE)
    return m.group(1).strip().strip('"\'') if m else None


def _strip_frontmatter_block(md: str) -> str:
    """Remove YAML frontmatter (---...---) and return the body."""
    if md.startswith("---"):
        end = md.find("\n---", 3)
        if end != -1:
            return md[end + 4:].lstrip()
    return md


# ─── Sub-agent delegation tools ──────────────────────────────────────────────

@tool
def check_consistency(draft_content_md: str = "", focus: str = "") -> str:
    """对工作空间中现有资产运行一致性检查。
    draft_content_md：可选，待写入的草稿 Markdown（用于提前检查草稿与现有资产的冲突）。
    focus：可选，检查重点描述（如 "NPC 命名" / "时间线"）。
    返回 ConsistencyReport JSON，包含 issues 列表和 overall_status。"""
    from app.agents.consistency import run_consistency_agent

    model = _get_model()
    assets = _workspace_context.get("existing_assets", [])

    # Build summaries: type/name/slug + content (truncated)
    asset_summaries = []
    for a in assets:
        entry = {
            "type": a.get("type", ""),
            "name": a.get("name", ""),
            "slug": a.get("slug", ""),
            "summary": a.get("summary", ""),
        }
        asset_summaries.append(entry)

    if draft_content_md:
        asset_summaries.append({
            "type": "draft",
            "name": "[待写入草稿]",
            "slug": "__draft__",
            "summary": draft_content_md[:800],
        })

    if focus:
        asset_summaries.append({"_focus_hint": focus})

    report = run_consistency_agent(asset_summaries=asset_summaries, model=model)
    return json.dumps(report, ensure_ascii=False)


@tool
def consult_rules(question: str, review_mode: bool = False) -> str:
    """向规则顾问 Agent 提问，检索知识库并返回带引用来源的建议。
    question：规则问题或待审查内容描述。
    review_mode：True 时以结构化审查模式运行（含 severity/suggestion_patch 字段）。
    返回 {"suggestions": [...], "summary": str} JSON。"""
    from app.agents.rules import run_rules_agent

    model = _get_model()
    library_ids = _workspace_context.get("library_ids", [])

    knowledge_context: list[dict] = []
    if library_ids and _db is not None:
        try:
            from app.knowledge.retriever import retrieve_knowledge
            knowledge_context = retrieve_knowledge(
                query=question,
                library_ids=library_ids,
                db=_db,
                top_k=6,
            )
        except Exception:
            pass

    result = run_rules_agent(
        question=question,
        knowledge_context=knowledge_context,
        model=model,
        review_mode=review_mode,
    )
    return json.dumps(result, ensure_ascii=False)


@tool
def create_skill(user_intent: str) -> str:
    """根据用户意图创建一个可复用的 Agent Skill（技能模板）。
    user_intent：描述想要的技能功能，如"COC 探索者人格创建框架"。
    此操作需要用户确认后才会实际写入磁盘。"""
    from app.agents.skill_agent import run_skill_agent

    model = _get_model()
    library_ids = _workspace_context.get("library_ids", [])

    knowledge_context: list[dict] = []
    if library_ids and _db is not None:
        try:
            from app.knowledge.retriever import retrieve_knowledge
            knowledge_context = retrieve_knowledge(
                query=user_intent,
                library_ids=library_ids,
                db=_db,
                top_k=4,
            )
        except Exception:
            pass

    content_md = run_skill_agent(
        user_intent=user_intent,
        knowledge_context=knowledge_context,
        workspace_context=_workspace_context,
        model=model,
    )

    # Extract skill name from frontmatter for the proposal
    skill_name = user_intent[:60]
    try:
        import re
        m = re.search(r"^name:\s*(.+)$", content_md, re.MULTILINE)
        if m:
            skill_name = m.group(1).strip()
    except Exception:
        pass

    proposal = {
        "id": f"pp_{uuid.uuid4().hex[:12]}",
        "tool_call_id": "",
        "action": "create",
        "asset_type": "skill",
        "asset_name": skill_name,
        "content_md": content_md,
        "original_content": "",
        "change_summary": f"新建 Skill：{skill_name}",
    }
    raise PatchProposalInterrupt(proposal)


@tool
def web_search(query: str = "", max_results: int = 5) -> str:
    """Search the internet for real-world reference information using DuckDuckGo.

    Use this tool when you need factual background that is NOT in the rulebook:
    - Real-world locations, landmarks, geography (e.g. "1920s Shanghai architecture")
    - Historical events, figures, time periods
    - Cultural details, customs, folklore
    - Scientific or medical facts relevant to the story

    Do NOT use for game rule queries — use search_knowledge or consult_rules instead.

    Args:
        query: Search query in the most specific language (English or Chinese).
        max_results: Number of results to return (1-10, default 5).

    Returns:
        JSON array of {title, url, snippet} objects, or an error message.
    """
    import logging
    logger = logging.getLogger(__name__)
    if not query or not query.strip():
        return json.dumps({"error": "query 参数不能为空。"}, ensure_ascii=False)
    try:
        from ddgs import DDGS
        max_results = max(1, min(10, max_results))
        # timeout=20s; region="cn-zh" for Chinese queries for better results
        with DDGS(timeout=20) as ddgs:
            results = list(ddgs.text(query, max_results=max_results, region="cn-zh"))
        # Fallback: retry without region if empty
        if not results:
            with DDGS(timeout=20) as ddgs:
                results = list(ddgs.text(query, max_results=max_results))
        formatted = [
            {
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            }
            for r in results
        ]
        if not formatted:
            return json.dumps({"results": [], "note": "No results found. Try rephrasing the query or use English keywords."}, ensure_ascii=False)
        return json.dumps({"results": formatted}, ensure_ascii=False)
    except Exception as e:
        logger.warning("web_search failed for query %r: %s", query, e)
        return json.dumps({"error": str(e), "results": []}, ensure_ascii=False)


# ─── Tool list for Director ────────────────────────────────────────────────────

ALL_TOOLS = [list_assets, read_asset, search_assets, search_knowledge,
             create_asset, update_asset, check_consistency, consult_rules, create_skill,
             web_search]
