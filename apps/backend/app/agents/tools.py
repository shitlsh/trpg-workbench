"""Agent tool functions for the Director Agent.

All tools execute and return results directly — read tools return data,
write tools (create_asset, update_asset, create_skill) write to disk immediately
and return a result summary. No user confirmation step.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from agno.tools import tool


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


def _get_knowledge_top_k(default: int = 5) -> int:
    """Read retrieval.knowledge_top_k from workspace config; fall back to default."""
    ws_path = _workspace_context.get("workspace_path")
    if not ws_path:
        return default
    try:
        from app.services.workspace_service import read_config
        cfg = read_config(ws_path)
        retrieval = cfg.get("retrieval") or {}
        val = retrieval.get("knowledge_top_k")
        if isinstance(val, int) and val > 0:
            return val
    except Exception:
        pass
    return default


# ─── Read-only tools ──────────────────────────────────────────────────────────

@tool
def list_assets(asset_type: str = "", name_contains: str = "", status: str = "", limit: int = 0) -> str:
    """刷新工作空间资产列表（当前快照已注入 system prompt，无需在对话开始时调用此工具）。
    仅在需要获取最新状态时调用，例如刚刚创建/修改了资产后。
    可选过滤参数：
    - asset_type: 精确类型匹配（如 "npc", "stage", "location"）
    - name_contains: 名称模糊匹配（不区分大小写）
    - status: 精确状态匹配（"draft" / "published" / "archived"）
    - limit: 返回数量上限（0 表示不限制，默认不限制）
    返回 JSON 数组，每项含 type/name/slug/summary 字段。"""
    assets = _workspace_context.get("existing_assets", [])
    if asset_type:
        assets = [a for a in assets if a.get("type") == asset_type]
    if name_contains:
        q = name_contains.lower()
        assets = [a for a in assets if q in (a.get("name") or "").lower()]
    if status:
        assets = [a for a in assets if a.get("status") == status]
    if limit and limit > 0:
        assets = assets[:limit]
    return json.dumps(assets, ensure_ascii=False)


@tool
def read_asset(asset_slug: str) -> str:
    """读取指定资产的完整 Markdown 内容。asset_slug 是资产的 slug 标识符。
    返回 Markdown 文本，如果未找到则返回错误信息。
    注意：仅在需要理解资产完整结构时使用；若只需查找特定文本请用 grep_asset，
    若只需读取某个章节请用 read_asset_section。"""
    file_path = _resolve_asset_file(asset_slug)
    if file_path is None:
        return f"错误：未找到 slug 为 '{asset_slug}' 的资产"
    try:
        return file_path.read_text(encoding="utf-8")
    except Exception as e:
        return f"错误：读取文件失败 — {e}"


def _resolve_asset_file(asset_slug: str) -> "Path | None":
    """Shared helper: resolve an asset slug to its file path.

    Searches the workspace assets directory recursively. Handles both
    hyphen-slug and underscore-slug variants (e.g. "wang-wu" matches
    file "wang_wu.md"). Returns None if not found.
    """
    ws_path = _workspace_context.get("workspace_path", "")
    if not ws_path:
        return None
    assets_root = Path(ws_path) / "assets"
    if not assets_root.exists():
        assets_root = Path(ws_path)
    for md_file in assets_root.rglob("*.md"):
        stem = md_file.stem
        if stem == asset_slug or stem.replace("-", "_") == asset_slug or stem.replace("_", "-") == asset_slug:
            return md_file
    # DB fallback
    if _db is not None:
        from app.models.orm import AssetORM
        workspace_id = _get_workspace_id_from_path(ws_path, _db)
        if workspace_id:
            asset = _db.query(AssetORM).filter_by(workspace_id=workspace_id, slug=asset_slug).first()
            if asset:
                from app.utils.paths import asset_type_dir
                candidate = asset_type_dir(ws_path, asset.type) / f"{asset_slug}.md"
                if candidate.exists():
                    return candidate
    return None


@tool
def grep_asset(asset_slug: str, pattern: str, context_lines: int = 2) -> str:
    """在单个资产文件内搜索文本，返回匹配行及上下文，不加载全文。
    这是局部修改前定位精确 old_str 的首选工具（token 消耗极低）。
    asset_slug：资产标识符。
    pattern：要搜索的字面量字符串（大小写敏感）。
    context_lines：匹配行上下各保留几行上下文（默认 2）。
    返回 JSON，含 matches 列表，每项有 line（行号）和 context（上下文文本）。
    若无匹配则 matches 为空列表并附带提示信息。"""
    if not pattern:
        return json.dumps({"error": "pattern 不能为空"}, ensure_ascii=False)

    file_path = _resolve_asset_file(asset_slug)
    if file_path is None:
        return json.dumps({"error": f"未找到 slug 为 '{asset_slug}' 的资产文件"}, ensure_ascii=False)

    try:
        text = file_path.read_text(encoding="utf-8")
    except Exception as e:
        return json.dumps({"error": f"读取文件失败：{e}"}, ensure_ascii=False)

    lines = text.splitlines()
    matching_line_indices = [i for i, ln in enumerate(lines) if pattern in ln]

    if not matching_line_indices:
        return json.dumps({
            "asset_slug": asset_slug,
            "pattern": pattern,
            "matches": [],
            "message": "未找到匹配内容，请检查 pattern 是否精确（大小写敏感）",
        }, ensure_ascii=False)

    MAX_MATCHES = 10
    truncated = len(matching_line_indices) > MAX_MATCHES
    matching_line_indices = matching_line_indices[:MAX_MATCHES]

    matches = []
    for idx in matching_line_indices:
        start = max(0, idx - context_lines)
        end = min(len(lines), idx + context_lines + 1)
        context_text = "\n".join(lines[start:end])
        matches.append({"line": idx + 1, "context": context_text})

    result: dict = {"asset_slug": asset_slug, "pattern": pattern, "matches": matches}
    if truncated:
        result["message"] = f"匹配结果超过 {MAX_MATCHES} 条，已截断，请使用更精确的 pattern"
    return json.dumps(result, ensure_ascii=False)


@tool
def read_asset_section(asset_slug: str, heading: str) -> str:
    """按 Markdown 标题名加载资产的单个章节内容，避免大型资产全文加载。
    适合大型资产（Stage/Location/Lore）的章节级读取，比 read_asset 节省 60%~80% token。
    asset_slug：资产标识符。
    heading：章节标题文本（模糊匹配，不区分大小写；不需要带 # 号）。
    返回从匹配标题到下一个同级或更高级标题之间的全部文本。
    找不到标题时返回错误，不回退到全文加载。"""
    if not heading:
        return json.dumps({"error": "heading 不能为空"}, ensure_ascii=False)

    file_path = _resolve_asset_file(asset_slug)
    if file_path is None:
        return json.dumps({"error": f"未找到 slug 为 '{asset_slug}' 的资产文件"}, ensure_ascii=False)

    try:
        text = file_path.read_text(encoding="utf-8")
    except Exception as e:
        return json.dumps({"error": f"读取文件失败：{e}"}, ensure_ascii=False)

    import re
    lines = text.splitlines(keepends=True)
    heading_lower = heading.strip().lower()

    # Find the matching heading line
    heading_pattern = re.compile(r"^(#{1,6})\s+(.+)$")
    match_idx = None
    match_level = None
    for i, line in enumerate(lines):
        m = heading_pattern.match(line.rstrip())
        if m and heading_lower in m.group(2).lower():
            match_idx = i
            match_level = len(m.group(1))
            break

    if match_idx is None:
        return json.dumps({
            "asset_slug": asset_slug,
            "heading": heading,
            "error": f"未找到标题 '{heading}'，请检查标题文本是否正确",
        }, ensure_ascii=False)

    # Collect lines from match_idx to the next heading of same or higher level
    section_lines = [lines[match_idx]]
    for line in lines[match_idx + 1:]:
        m = heading_pattern.match(line.rstrip())
        if m and len(m.group(1)) <= match_level:
            break
        section_lines.append(line)

    section_text = "".join(section_lines).rstrip()
    return json.dumps({
        "asset_slug": asset_slug,
        "heading": heading,
        "content": section_text,
    }, ensure_ascii=False)


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
def search_knowledge(query: str = "", chunk_types: str = "") -> str:
    """检索工作空间关联的知识库（RAG）。返回相关段落列表（JSON），含文档名和页码。
    chunk_types：可选，逗号分隔的类型过滤（rule/example/lore/table/procedure/flavor）。
    例如："rule,table" 只检索规则说明和数值表格；留空则不过滤。"""
    if not query or not query.strip():
        return json.dumps({"error": "query 参数不能为空，请提供具体的搜索关键词。"}, ensure_ascii=False)
    library_ids = _workspace_context.get("library_ids", [])
    if not library_ids or _db is None:
        return json.dumps({
            "results": [],
            "message": "当前工作空间未绑定任何知识库。若需要规则参考，请先在「知识库」页面导入规则书并绑定到此工作空间。",
        }, ensure_ascii=False)

    # Parse type filter
    type_filter: list[str] | None = None
    if chunk_types and chunk_types.strip():
        type_filter = [t.strip() for t in chunk_types.split(",") if t.strip()]

    # Resolve top_k from workspace config
    top_k = _get_knowledge_top_k()

    try:
        from app.knowledge.retriever import retrieve_knowledge
        ws_path = _workspace_context.get("workspace_path")
        results = retrieve_knowledge(
            query=query,
            library_ids=library_ids,
            db=_db,
            top_k=top_k,
            type_filter=type_filter,
            workspace_path=ws_path,
        )
        formatted = [
            {
                "document_name": r.get("document_name", r.get("document_filename", "")),
                "page_from": r.get("page_from"),
                "page_to": r.get("page_to"),
                "chunk_type": r.get("chunk_type"),
                "content": r.get("content", "")[:500],  # truncate for context budget
            }
            for r in results
        ]
        warning = None
        if not formatted:
            warning = "知识库检索结果为空，建议尝试不同关键词或清空 chunk_types 过滤。"
        resp = {"results": formatted}
        if warning:
            resp["warning"] = warning
        return json.dumps(resp, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"results": [], "error": str(e)}, ensure_ascii=False)


# ─── Write tools (write directly to disk, no confirmation required) ───────────

@tool
def create_asset(
    asset_type: str,
    name: str | None = None,
    content_md: str | None = None,
    change_summary: str = "",
) -> str:
    """创建新资产，立即写入磁盘。
    必填：asset_type（如 "npc"/"stage"/"location"/"lore_note"/"monster"）、
    name（资产名称）、content_md（完整 Markdown 内容，含 frontmatter）。
    缺少任意必填参数时返回错误，请补充后重试。
    返回 JSON，含 success/slug/asset_id 字段。"""
    if not name or not content_md:
        missing = [f for f, v in [("name", name), ("content_md", content_md)] if not v]
        return json.dumps(
            {"success": False, "error": f"create_asset 缺少必填参数：{', '.join(missing)}。请补充后重新调用。"},
            ensure_ascii=False,
        )
    if _db is None:
        return json.dumps({"success": False, "error": "数据库未配置"}, ensure_ascii=False)
    ws_path = _workspace_context.get("workspace_path", "")
    proposal = {
        "action": "create",
        "asset_type": asset_type,
        "asset_name": name,
        "content_md": content_md,
        "change_summary": change_summary or f"新建 {asset_type}：{name}",
    }
    result = execute_patch_proposal(proposal, ws_path, _db)
    return json.dumps({"auto_applied": True, **result}, ensure_ascii=False)


@tool
def patch_asset(asset_slug: str, old_str: str, new_str: str, change_summary: str = "") -> str:
    """对已有资产做局部字符串替换，立即写入磁盘。
    优先使用此工具进行局部修改（比 update_asset 节省大量 token）。
    asset_slug：资产标识符。
    old_str：要被替换的原始文本片段（必须在文件中唯一存在，精确匹配包括空白符）。
    new_str：替换后的新文本。
    返回 JSON，含 success/slug/asset_id 字段；若 old_str 未找到或有多处匹配则返回错误。"""
    if _db is None:
        return json.dumps({"success": False, "error": "数据库未配置"}, ensure_ascii=False)
    if not old_str:
        return json.dumps({"success": False, "error": "old_str 不能为空"}, ensure_ascii=False)

    ws_path = _workspace_context.get("workspace_path", "")
    file_path = _resolve_asset_file(asset_slug)
    if file_path is None:
        return json.dumps({"success": False, "error": f"未找到 slug 为 '{asset_slug}' 的资产文件"}, ensure_ascii=False)

    try:
        original = file_path.read_text(encoding="utf-8")
    except Exception as e:
        return json.dumps({"success": False, "error": f"读取文件失败：{e}"}, ensure_ascii=False)

    count = original.count(old_str)
    if count == 0:
        return json.dumps({"success": False, "error": "old_str 在文件中未找到，请检查文本是否精确匹配（包括空白符和换行符）"}, ensure_ascii=False)
    if count > 1:
        return json.dumps({"success": False, "error": f"old_str 在文件中出现了 {count} 次，请提供更多上下文使其唯一"}, ensure_ascii=False)

    new_content = original.replace(old_str, new_str, 1)

    # Get asset info from context
    assets = _workspace_context.get("existing_assets", [])
    matched = next((a for a in assets if a.get("slug") == asset_slug), None)
    asset_name = matched.get("name", asset_slug) if matched else asset_slug

    proposal = {
        "action": "update",
        "asset_type": matched.get("type", "") if matched else "",
        "asset_name": asset_name,
        "asset_slug": asset_slug,
        "content_md": new_content,
        "change_summary": change_summary or f"局部修改资产：{asset_name}",
    }
    result = execute_patch_proposal(proposal, ws_path, _db)
    return json.dumps({"auto_applied": True, **result}, ensure_ascii=False)


@tool
def update_asset(asset_slug: str, content_md: str, change_summary: str = "") -> str:
    """全文替换已有资产内容，立即写入磁盘。
    仅在需要大幅重写时使用；局部修改请优先使用 patch_asset（节省 token）。
    asset_slug 是资产标识符，content_md 为新的完整 Markdown 内容。
    返回 JSON，含 success/slug/asset_id 字段。"""
    if _db is None:
        return json.dumps({"success": False, "error": "数据库未配置"}, ensure_ascii=False)
    ws_path = _workspace_context.get("workspace_path", "")

    # Get asset name from context
    assets = _workspace_context.get("existing_assets", [])
    matched = next((a for a in assets if a.get("slug") == asset_slug), None)
    asset_name = matched.get("name", asset_slug) if matched else asset_slug

    proposal = {
        "action": "update",
        "asset_type": matched.get("type", "") if matched else "",
        "asset_name": asset_name,
        "asset_slug": asset_slug,
        "content_md": content_md,
        "change_summary": change_summary or f"修改资产：{asset_name}",
    }
    result = execute_patch_proposal(proposal, ws_path, _db)
    return json.dumps({"auto_applied": True, **result}, ensure_ascii=False)


# ─── Proposal execution ───────────────────────────────────────────────────────

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

    # Parse content_md using python-frontmatter so body is properly separated
    # from the YAML front matter the Agent generated.
    try:
        import frontmatter as _fm
        _parsed_post = _fm.loads(content_md)
        body = _parsed_post.content  # text body without frontmatter block
        _fm_meta: dict = dict(_parsed_post.metadata)
    except Exception:
        _fm_meta = {}
        body = _strip_frontmatter_block(content_md)  # regex fallback

    summary: str | None = _fm_meta.get("summary") or _extract_frontmatter_field(content_md, "summary")

    # Fields safe to carry over from Agent-generated frontmatter into meta_updates.
    # We never override version/updated_at (managed by asset_service) or
    # slug/type (structural fields that should not change via content rewrite).
    _PROTECTED_FIELDS = {"version", "updated_at", "slug", "type", "id"}
    fm_meta_updates: dict = {k: v for k, v in _fm_meta.items() if k not in _PROTECTED_FIELDS}

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
            body=body,  # stripped body; frontmatter is rebuilt by asset_service
            extra_meta=fm_meta_updates if fm_meta_updates else None,
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

        # Log the write
        from app.utils.logger import log_asset_write
        log_asset_write(
            workspace_path=workspace_path,
            asset_id=asset_id,
            asset_name=asset_name,
            asset_type=asset_type,
            revision_version=1,
            source_type="agent",
            action="create",
            change_summary=proposal.get("change_summary", ""),
        )

        return {"success": True, "asset_id": asset_id, "slug": slug, "action": "created"}

    elif action == "update":
        asset_slug = proposal.get("asset_slug", "")
        asset = db.query(AssetORM).filter_by(workspace_id=workspace_id, slug=asset_slug).first()
        if not asset:
            return {"success": False, "error": f"Asset '{asset_slug}' not found"}

        from app.utils.paths import asset_type_dir
        file_path = asset_type_dir(workspace_path, asset.type) / f"{asset_slug}.md"
        if not file_path.exists():
            # Fallback: scan (same matching logic as patch_asset)
            for md_file in Path(workspace_path).rglob("*.md"):
                if md_file.stem == asset_slug or md_file.stem.replace("-", "_") == asset_slug:
                    file_path = md_file
                    break

        result = asset_service.update_asset(
            workspace_path=workspace_path,
            file_path=file_path,
            body=body,  # stripped body; frontmatter merged via meta_updates
            meta_updates=fm_meta_updates if fm_meta_updates else None,
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

        # Log the write
        from app.utils.logger import log_asset_write
        log_asset_write(
            workspace_path=workspace_path,
            asset_id=asset.id,
            asset_name=asset.name,
            asset_type=asset.type,
            revision_version=result["revision_version"],
            source_type="agent",
            action="update",
            change_summary=proposal.get("change_summary", "Agent 修改"),
        )

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
            from app.knowledge.types import RULE_CHUNK_TYPES
            knowledge_context = retrieve_knowledge(
                query=question,
                library_ids=library_ids,
                db=_db,
                top_k=_get_knowledge_top_k(default=6),
                type_filter=RULE_CHUNK_TYPES,
                workspace_path=_workspace_context.get("workspace_path"),
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
    """根据用户意图创建一个可复用的 Agent Skill（技能模板），立即写入磁盘。
    user_intent：描述想要的技能功能，如"COC 探索者人格创建框架"。
    返回 JSON，含 success/slug/asset_id 字段。"""
    from app.agents.skill_agent import run_skill_agent

    if _db is None:
        return json.dumps({"success": False, "error": "数据库未配置"}, ensure_ascii=False)

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
                top_k=_get_knowledge_top_k(default=4),
                workspace_path=_workspace_context.get("workspace_path"),
            )
        except Exception:
            pass

    content_md = run_skill_agent(
        user_intent=user_intent,
        knowledge_context=knowledge_context,
        workspace_context=_workspace_context,
        model=model,
    )

    # Extract skill name from frontmatter
    skill_name = user_intent[:60]
    try:
        import re
        m = re.search(r"^name:\s*(.+)$", content_md, re.MULTILINE)
        if m:
            skill_name = m.group(1).strip()
    except Exception:
        pass

    ws_path = _workspace_context.get("workspace_path", "")
    proposal = {
        "action": "create",
        "asset_type": "skill",
        "asset_name": skill_name,
        "content_md": content_md,
        "change_summary": f"新建 Skill：{skill_name}",
    }
    result = execute_patch_proposal(proposal, ws_path, _db)
    return json.dumps({"auto_applied": True, **result}, ensure_ascii=False)


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

# ─── Question Interrupt ───────────────────────────────────────────────────────

class AgentQuestionInterrupt(Exception):
    """Raised by ask_user to interrupt the Director stream and surface a structured
    question card to the user.  The SSE layer catches this and emits an
    ``agent_question`` event, then terminates the current stream.  The user's
    answer arrives as the next chat message, giving the Director full context to
    continue in the following arun() call.
    """

    def __init__(self, questions: list[dict]) -> None:
        self.questions = questions
        super().__init__("agent_question")


@tool
def ask_user(questions: list[dict]) -> str:
    """向用户提出结构化选择问题，在收到答复后继续当前任务。

    当任务方向存在**关键分叉**且无法从现有上下文或对话历史推断时调用。
    每次调用最多提 2 个问题，每个问题 2-4 个选项。
    调用后当前推理流程将暂停，等待用户点选答复后在下一轮继续。

    questions 格式（list，每项为一个问题）：
    [
        {
            "header": "简短标题（10 字以内）",
            "question": "完整问题描述",
            "options": [
                {"label": "选项标签（2-5 字）", "description": "一句话解释这个选项的含义"}
            ],
            "multiple": false   // true 时允许多选，默认 false
        }
    ]

    禁止调用场景：
    - 仅为"礼貌确认"（"我准备创建 NPC，你确认吗？"）
    - 对话历史中已有足够信息可推断答案
    - 规则集/工作空间配置已能决定方向
    - 每次超过 2 个问题
    """
    if not questions or not isinstance(questions, list):
        return json.dumps({"error": "questions 必须是非空列表"}, ensure_ascii=False)
    if len(questions) > 2:
        questions = questions[:2]  # 强制限制，不报错
    raise AgentQuestionInterrupt(questions)


ALL_TOOLS = [list_assets, read_asset, grep_asset, read_asset_section, search_assets, search_knowledge,
             create_asset, patch_asset, update_asset, check_consistency, consult_rules, create_skill,
             web_search, ask_user]

# Explore 会话：只读 + 规则咨询，无写入、无一致性委托、无 Skill、无向用户中断提问
EXPLORE_TOOLS = [
    list_assets,
    read_asset,
    grep_asset,
    read_asset_section,
    search_assets,
    search_knowledge,
    web_search,
    consult_rules,
]
