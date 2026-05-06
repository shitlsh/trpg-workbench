"""LLM-based TOC analyzer.

Two-phase design:

Phase 1 (fast, ``fetch_pdf_toc_llm_raw`` / ``parse_pdf_toc_response``):
  LLM only outputs ``sections`` (chapter-skeleton with ``suggested_chunk_type``).
  Prompt is small → response is small → fast.

Phase 2 (optional, ``build_full_toc_from_toc_text`` + ``fetch_full_toc_llm``):
  Build ``full_toc`` using rule-based numbering heuristics first.
  If rule-based result is sparse (< sections*2 rows), fall back to a second
  focused LLM call that only outputs ``{ "full_toc": { "nodes": [...] } }``.
  Triggered asynchronously from the frontend after Phase 1 completes.

Result types:
- ``sections`` — chapter-skeleton list (coarse, for ingest) with
  ``suggested_chunk_type`` on each major row.
- ``full_toc`` — tree ``{ "nodes": [ ... ] }``; flattened to rows for UI.
  Child rows inherit ``suggested_chunk_type`` from their parent chapter.
"""
from __future__ import annotations

import json
import re
import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from app.agents.model_adapter import (
    DEFAULT_MAX_TOKENS_ANTHROPIC,
    strip_code_fence,
    complete_text_once,
)

_log = logging.getLogger(__name__)
from app.prompts import load_prompt
from app.knowledge.toc_extractor import preprocess_toc_text_for_llm
from app.knowledge.types import ChunkType
from app.services.llm_defaults import task_temperature

# Wall-clock cap for one `complete_text_once` in TOC flows (PDF analyze-toc, each CHM batch).
TOC_LLM_MAX_WAIT_SECONDS: float = 900.0
# PDF: raw TOC text sent to the model (output is already chapter-skeleton; allow longer multi-page TOCs).
PDF_TOC_LLM_MAX_INPUT_CHARS: int = 12000
# Anthropic TOC/CHM: use ``DEFAULT_MAX_TOKENS_ANTHROPIC`` until catalog-driven limits exist;
# OpenAI / OpenRouter / ``openai_compatible`` / **Google** do not pass max output — provider defaults.
# CHM: only ask the LLM for rows with depth <= this; deeper rows inherit (default 1 = top-level part/book, like PDF big chapters).
CHM_CLASSIFY_MAX_DEPTH: int = 1
# CHM batch line: index + depth + tab + title; long HHC titles are truncated for prompt size.
CHM_CLASSIFY_LINE_TITLE_MAX_CHARS: int = 500


def _chm_title_for_classify_prompt(title: str) -> str:
    t = (title or "").replace("\n", " ").replace("\t", " ").strip()
    if len(t) <= CHM_CLASSIFY_LINE_TITLE_MAX_CHARS:
        return t
    return t[: CHM_CLASSIFY_LINE_TITLE_MAX_CHARS - 1] + "…"


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class TocSection:
    title: str
    page_from: int
    page_to: int | None
    depth: int
    suggested_chunk_type: str | None


@dataclass
class TocAnalysisResult:
    sections: list[TocSection]
    # Raw `full_toc` from the LLM: ``{ "nodes": [...] }`` (preferred) or ``{ "rows": [...] }``.
    full_toc: dict[str, Any] | None = None


class TocNotRecognizedError(ValueError):
    """Raised when the LLM determines the input is not a recognizable TOC."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(f"Input not recognized as a TOC: {reason}")


def _norm_title_str(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip()).lower()


def _flatten_toc_node(node: Any, level: int = 1) -> list[dict[str, Any]]:
    """前序展平；每行上的嵌套层级由树形深度决定，与节点自填字段无关。"""
    if not isinstance(node, dict) or not str(node.get("title", "")).strip():
        return []
    row = {k: v for k, v in node.items() if k != "children"}
    row["depth"] = int(level)
    out: list[dict[str, Any]] = [row]
    for c in node.get("children") or []:
        out.extend(_flatten_toc_node(c, level + 1))
    return out


def _extract_full_toc_rows(full_toc: Any) -> list[dict[str, Any]]:
    if full_toc is None:
        return []
    if isinstance(full_toc, list):
        return [x for x in full_toc if isinstance(x, dict) and str(x.get("title", "")).strip()]
    if not isinstance(full_toc, dict):
        return []
    n = full_toc.get("nodes")
    if isinstance(n, list) and n:
        from_nodes: list[dict[str, Any]] = []
        for node in n:
            from_nodes.extend(_flatten_toc_node(node))
        if from_nodes:
            return from_nodes
    r = full_toc.get("rows")
    if isinstance(r, list) and r:
        from_rows = [x for x in r if isinstance(x, dict) and str(x.get("title", "")).strip()]
        if from_rows:
            return from_rows
    return []


def full_toc_rows_to_preview(
    sections: list[TocSection],
    full_toc: Any,
    *,
    max_rows: int = 5000,
) -> list[dict[str, Any]]:
    """将模型输出的 ``full_toc`` 行表展平为行级预览；子行 ``suggested_chunk_type`` 由章级 ``sections`` 按页码归属。"""
    rows_in = _extract_full_toc_rows(full_toc)
    if not rows_in or not sections:
        return []
    cap = max_rows if max_rows and max_rows > 0 else 0
    if cap == 0:
        return []
    sk = sorted(sections, key=lambda x: (x.page_from, _norm_title_str(x.title)))
    n = len(sk)

    def owner_idx(p: int) -> int:
        best = 0
        for i in range(n):
            if sk[i].page_from <= p:
                best = i
        return best

    out: list[dict[str, Any]] = []
    for r in rows_in[:cap]:
        if not isinstance(r, dict):
            continue
        title = str(r.get("title", "")).strip()
        if not title:
            continue
        try:
            page_from = int(r.get("page_from", 1))
        except (TypeError, ValueError):
            page_from = 1
        raw_d = r.get("depth", 1)
        try:
            depth = int(raw_d) if isinstance(raw_d, (int, float, str)) else 1
        except (TypeError, ValueError):
            depth = 1
        oi = owner_idx(page_from)
        sec = sk[oi]
        ct = sec.suggested_chunk_type
        pt = r.get("page_to", page_from)
        try:
            page_to = int(pt) if pt is not None and str(pt).strip() != "" else page_from
        except (TypeError, ValueError):
            page_to = page_from
        inherited = _norm_title_str(title) != _norm_title_str(sec.title)
        out.append(
            {
                "title": title,
                "page_from": page_from,
                "page_to": page_to,
                "depth": depth,
                "suggested_chunk_type": ct,
                "inherited": inherited,
            }
        )
    # Back-fill page_to: rows where page_to == page_from (no explicit end) get
    # inferred as next_row.page_from - 1.  Last row gets 99999 sentinel.
    for i, row in enumerate(out):
        if row["page_to"] <= row["page_from"]:
            if i + 1 < len(out):
                row["page_to"] = max(out[i + 1]["page_from"] - 1, row["page_from"])
            else:
                row["page_to"] = 99999
    return out


# ─── Main function ────────────────────────────────────────────────────────────

async def fetch_pdf_toc_llm_raw(toc_text: str, llm_profile, model_name: str) -> str:
    """Call LLM only; return raw assistant text (may include fences). Raises RuntimeError on failure.

    Use ``await`` from async routes. For sync call sites, use :func:`analyze_toc` or
    ``asyncio.run(fetch_pdf_toc_llm_raw(...))`` at a true sync boundary.
    """
    effective_model_name = model_name or ""
    system_prompt = load_prompt("toc_analyzer", "system")
    prepped = preprocess_toc_text_for_llm(toc_text or "")
    user_message = load_prompt(
        "toc_analyzer",
        "user_pdf",
        toc_text=prepped[:PDF_TOC_LLM_MAX_INPUT_CHARS],
    )
    try:
        t = task_temperature("toc_analysis")
        prov = (getattr(llm_profile, "provider_type", None) or "").strip().lower()
        call_kw: dict[str, Any] = {
            "profile": llm_profile,
            "model_name": effective_model_name,
            "system_prompt": system_prompt,
            "user_prompt": user_message,
            "temperature": t,
        }
        if prov == "anthropic":
            call_kw["max_tokens"] = DEFAULT_MAX_TOKENS_ANTHROPIC
        raw = await complete_text_once(**call_kw)
        out = strip_code_fence(raw)
        _log.debug(
            "toc_analyzer operation=fetch_pdf_toc_llm_raw toc_chars=%s prepped_chars=%s response_chars=%s",
            len(toc_text or ""),
            len(prepped or ""),
            len(out or ""),
        )
        return out
    except Exception as e:
        raise RuntimeError(f"LLM call for TOC analysis failed: {e}") from e


def _log_toc_json_parse_failure(raw: str, err: json.JSONDecodeError | None) -> None:
    msg = err.msg if err else ""
    pos = err.pos if err else -1
    n = len(raw)
    head = (raw[:500] if n > 500 else raw).replace("\n", " ")
    tail = (raw[-500:] if n > 500 else "").replace("\n", " ")
    _log.warning(
        "toc_analyzer operation=parse_pdf_toc_response parse_ok=false json_error=%s json_pos=%s response_chars=%s head_500=%s tail_500=%s",
        msg,
        pos,
        n,
        head,
        tail,
    )


def _toc_json_user_message(raw: str, err: json.JSONDecodeError | None) -> str:
    n = len(raw)
    t = raw.rstrip()
    truncated_hint = bool(n > 200 and not t.endswith("}"))
    if err and err.msg:
        if "Unterminated" in err.msg or (err.pos is not None and n > 100 and err.pos >= n - 80):
            truncated_hint = True
    core = f"无法解析模型返回的 JSON（约 {n} 个字符）"
    if err is not None:
        core += f"。JSON: {err.msg}，位置: {err.pos}"
    if truncated_hint:
        core += "。常见原因：整段在末尾被截断（`full_toc` 行数多时会很长）。可缩短抽到的目录页后重试；若仍失败请查服务端日志中的 `tail_500`。"
    else:
        core += "。请检查是否混有说明文字、或未转义引号/换行。"
    return core


def parse_pdf_toc_response(raw: str) -> TocAnalysisResult:
    """Parse LLM JSON into sections. Raises TocNotRecognizedError or RuntimeError."""
    raw = strip_code_fence(raw).strip()
    data: dict[str, Any] | None = None
    last_err: json.JSONDecodeError | None = None
    try:
        first = json.loads(raw)
        if isinstance(first, dict):
            data = first
    except json.JSONDecodeError as e:
        last_err = e
    if data is None and raw:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            try:
                sub = json.loads(m.group(0))
                if isinstance(sub, dict):
                    data = sub
            except json.JSONDecodeError as e:
                last_err = e
    if data is None:
        _log_toc_json_parse_failure(raw, last_err)
        raise RuntimeError(_toc_json_user_message(raw, last_err))

    if not data.get("is_toc", True):
        raise TocNotRecognizedError(data.get("reason", "LLM could not identify a table of contents"))

    raw_sections = data.get("sections", [])
    if not isinstance(raw_sections, list):
        raise RuntimeError(f"Unexpected LLM response structure: {raw[:300]}")

    valid_chunk_types = {t.value for t in ChunkType} - {ChunkType.NONE.value}
    sections: list[TocSection] = []

    for i, s in enumerate(raw_sections):
        if not isinstance(s, dict) or not s.get("title"):
            continue
        page_to: int | None = None
        if i + 1 < len(raw_sections):
            next_pf = raw_sections[i + 1].get("page_from")
            try:
                next_pf_int = int(next_pf) if next_pf is not None else None
            except (TypeError, ValueError):
                next_pf_int = None
            if next_pf_int is not None:
                page_to = max(next_pf_int - 1, s.get("page_from", 1))

        ctype = s.get("suggested_chunk_type")
        if ctype not in valid_chunk_types:
            ctype = None

        sections.append(TocSection(
            title=str(s.get("title", "")),
            page_from=int(s.get("page_from", 1)),
            page_to=page_to,
            depth=1,
            suggested_chunk_type=ctype,
        ))

    if sections and sections[-1].page_to is None:
        sections[-1] = TocSection(
            title=sections[-1].title,
            page_from=sections[-1].page_from,
            page_to=99999,
            depth=sections[-1].depth,
            suggested_chunk_type=sections[-1].suggested_chunk_type,
        )

    return TocAnalysisResult(sections=sections, full_toc=None)


def analyze_toc(
    toc_text: str,
    llm_profile,       # LLMProfileORM instance
    model_name: str,   # e.g. "gpt-4o", "claude-3-5-sonnet-20241022"
) -> TocAnalysisResult:
    """Parse TOC text using an LLM and return structured sections.

    Sync API for non-async contexts: runs a single event loop via :func:`asyncio.run`
    around :func:`fetch_pdf_toc_llm_raw`.

    Raises TocNotRecognizedError if the LLM says the input is not a TOC.
    Raises RuntimeError on LLM/parse failures.
    """
    raw = asyncio.run(fetch_pdf_toc_llm_raw(toc_text, llm_profile, model_name))
    return parse_pdf_toc_response(raw)


# ─── Phase-2: rule-based full_toc builder ────────────────────────────────────

# Patterns for numbered headings, ordered from most-specific to least.
# Each (pattern, depth) pair; first match wins.
_NUMBERED_HEADING_PATTERNS: list[tuple[re.Pattern, int]] = [
    # Arabic multi-level: 1.1.1 / 1.1.1.1
    (re.compile(r"^(\d+\.\d+\.\d+\.?\d*)\s+\S"), 3),
    # Arabic two-level: 1.1 / 1.2
    (re.compile(r"^(\d+\.\d+)\s+\S"), 2),
    # Arabic chapter: 1. / 2.  (single digit/two-digit, must be followed by space+non-digit to avoid page numbers)
    (re.compile(r"^\d{1,2}\.\s+[^\d]"), 1),
    # Chinese sub-section: 第X节 / X、  (appears under 第X章)
    (re.compile(r"^第[一二三四五六七八九十百千0-9]+[节篇幕]\s*\S"), 2),
    # Chinese chapter / part / appendix (root level)
    (re.compile(r"^(第[一二三四五六七八九十百千0-9]+[章部卷]|附录\s*[A-Za-z0-9一二三四五六七八九十]+)\s*\S", re.UNICODE), 1),
    # Western chapter / appendix root
    (re.compile(r"^(Chapter|Part|Appendix|Section)\s+\S", re.IGNORECASE), 1),
]

# Matches trailing page number in a TOC line.
# Priority (tried in order by _extract_page_from_toc_line):
#   1. Leader dots/spaces + digits  e.g. "Title ……… 42" or "Title ..... 42"
#   2. Two-or-more spaces + digits  e.g. "Title   42"
#   3. Single space + digits at end, BUT only when the digits are clearly a page
#      (i.e. the part before the space contains a non-digit character right before)
#      e.g. "第一章 揭开面纱 19"  →  page=19, title="第一章 揭开面纱"
_RE_PAGE_LEADER = re.compile(r"^(.+?)\s*[·.…]{2,}\s*(\d{1,5})\s*$")
_RE_PAGE_MULTI_SPACE = re.compile(r"^(.+?)\s{2,}(\d{1,5})\s*$")
_RE_PAGE_SINGLE_SPACE = re.compile(r"^(.+\D)\s(\d{1,5})\s*$")


def _extract_page_from_toc_line(line: str) -> int | None:
    """Extract trailing page number from a TOC line, or None."""
    for pat in (_RE_PAGE_LEADER, _RE_PAGE_MULTI_SPACE, _RE_PAGE_SINGLE_SPACE):
        m = pat.match(line)
        if m:
            return int(m.group(2))
    return None


def _strip_page_from_title(line: str) -> str:
    """Remove the trailing page number and leader dots from a title."""
    for pat in (_RE_PAGE_LEADER, _RE_PAGE_MULTI_SPACE, _RE_PAGE_SINGLE_SPACE):
        m = pat.match(line)
        if m:
            return m.group(1).strip()
    return line.strip()


def _depth_from_line(line: str) -> int | None:
    """Return the structural depth (1=chapter, 2=section, 3=sub-section) from heading patterns, or None."""
    for pattern, depth in _NUMBERED_HEADING_PATTERNS:
        if pattern.match(line):
            return depth
    return None


def build_full_toc_from_toc_text(
    toc_text: str,
    sections: list[TocSection],
) -> dict[str, Any] | None:
    """Build ``full_toc`` from raw toc_text using numbering heuristics.

    Strategy:
    - Parse each line; determine depth from heading number patterns.
    - Lines with no recognisable depth pattern are skipped (or treated as
      depth-1 leaves when they look like TOC entries but have no sub-structure).
    - Assemble a tree using a depth-stack.
    - Returns ``{ "nodes": [...] }`` or ``None`` if fewer than
      ``max(len(sections), 2)`` rows were parsed (sparse → caller falls back
      to LLM).

    NOTE: x-axis indentation is NOT available (stripped by pdfplumber + preprocess).
    Depth is determined purely by heading number patterns.
    """
    from app.knowledge.toc_extractor import preprocess_toc_text_for_llm

    prepped = preprocess_toc_text_for_llm(toc_text or "")
    lines = [l.strip() for l in prepped.splitlines()]

    _log.info(
        "toc_analyzer build_full_toc_from_toc_text START raw_chars=%s prepped_lines=%s sections=%s",
        len(toc_text or ""), len(lines), len(sections) if sections else 0,
    )

    parsed: list[tuple[int, str, int]] = []  # (depth, title, page_from)

    # We need at least section page-ranges to give depth-1 fallback lines a page
    sec_pages = sorted({s.page_from for s in sections} if sections else set())

    for raw_line in lines:
        line = raw_line.strip()
        if not line or re.match(r"^---\s*Page\s+\d+", line):
            continue
        page = _extract_page_from_toc_line(line)
        title = _strip_page_from_title(line)
        if not title or len(title) < 2:
            continue
        depth = _depth_from_line(line)
        if depth is None:
            # Only include depth-1 fallback when the line has a recognisable page number
            # and matches a section title exactly (to avoid garbage lines)
            if page is not None and sections:
                norm = _norm_title_str(title)
                if any(_norm_title_str(s.title) == norm for s in sections):
                    depth = 1
                else:
                    continue
            else:
                continue
        if page is None:
            # Try to infer from neighbouring section
            if sec_pages:
                page = sec_pages[0]
            else:
                page = 1
        parsed.append((depth, title, page))

    _log.info(
        "toc_analyzer build_full_toc_from_toc_text parsed=%s lines (from %s input lines)",
        len(parsed), len(lines),
    )
    if parsed:
        # Log first few parsed entries for diagnosis
        sample = [(d, t, p) for d, t, p in parsed[:5]]
        _log.info("toc_analyzer build_full_toc_from_toc_text sample_entries=%s", sample)

    if not parsed:
        _log.info(
            "toc_analyzer build_full_toc_from_toc_text parsed=0 → no numbered headings found, returning None"
        )
        return None

    # Threshold: if we found fewer lines than sections, rule-based is too sparse
    min_rows = max(len(sections) if sections else 2, 2)
    if len(parsed) < min_rows:
        _log.info(
            "toc_analyzer build_full_toc_from_toc_text sparse parsed=%s min_rows=%s sections=%s → returning None",
            len(parsed), min_rows, len(sections) if sections else 0,
        )
        return None

    # Build tree using a stack: stack contains (depth, node_dict)
    root_nodes: list[dict[str, Any]] = []
    stack: list[tuple[int, dict[str, Any]]] = []  # (depth, node)

    for depth, title, page_from in parsed:
        node: dict[str, Any] = {"title": title, "page_from": page_from}
        # Pop stack until top is at shallower depth
        while stack and stack[-1][0] >= depth:
            stack.pop()
        if stack:
            parent = stack[-1][1]
            parent.setdefault("children", []).append(node)
        else:
            root_nodes.append(node)
        stack.append((depth, node))

    if not root_nodes:
        return None

    _log.info(
        "toc_analyzer build_full_toc_from_toc_text parsed=%s root_nodes=%s",
        len(parsed),
        len(root_nodes),
    )
    return {"nodes": root_nodes}


# ─── Phase-2: LLM full_toc fallback ──────────────────────────────────────────

# Max input chars for the full_toc-only LLM call (can be larger since output is also smaller without sections)
PDF_FULL_TOC_LLM_MAX_INPUT_CHARS: int = 16000


async def fetch_full_toc_llm(
    toc_text: str,
    sections: list[TocSection],
    llm_profile,
    model_name: str,
) -> dict[str, Any] | None:
    """Second-phase LLM call: only asks for full_toc tree (no sections, no chunk_type).

    Returns parsed ``{ "nodes": [...] }`` dict or None on failure.
    """
    effective_model_name = model_name or ""
    _log.info(
        "toc_analyzer fetch_full_toc_llm START model=%s sections=%s toc_chars=%s",
        effective_model_name, len(sections), len(toc_text or ""),
    )
    system_prompt = load_prompt("toc_analyzer", "system_full_toc")
    prepped = preprocess_toc_text_for_llm(toc_text or "")

    sections_summary = json.dumps(
        [{"title": s.title, "page_from": s.page_from} for s in sections],
        ensure_ascii=False,
    )
    user_message = load_prompt(
        "toc_analyzer",
        "user_full_toc",
        sections_json=sections_summary,
        toc_text=prepped[:PDF_FULL_TOC_LLM_MAX_INPUT_CHARS],
    )
    try:
        t = task_temperature("toc_analysis")
        prov = (getattr(llm_profile, "provider_type", None) or "").strip().lower()
        call_kw: dict[str, Any] = {
            "profile": llm_profile,
            "model_name": effective_model_name,
            "system_prompt": system_prompt,
            "user_prompt": user_message,
            "temperature": t,
        }
        if prov == "anthropic":
            call_kw["max_tokens"] = DEFAULT_MAX_TOKENS_ANTHROPIC
        raw = await complete_text_once(**call_kw)
        raw = strip_code_fence(raw).strip()
    except Exception as e:
        _log.warning("toc_analyzer fetch_full_toc_llm failed: %s", e)
        return None

    # Parse the result
    data: dict[str, Any] | None = None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            data = parsed
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            try:
                sub = json.loads(m.group(0))
                if isinstance(sub, dict):
                    data = sub
            except json.JSONDecodeError:
                pass

    if data is None:
        _log.warning("toc_analyzer fetch_full_toc_llm could not parse JSON response (chars=%s)", len(raw))
        return None

    ftraw = data.get("full_toc")
    if isinstance(ftraw, dict) and ftraw:
        result = ftraw
    elif isinstance(ftraw, list):
        result = {"rows": ftraw}
    else:
        _log.info("toc_analyzer fetch_full_toc_llm: no full_toc key in response")
        return None

    if not _extract_full_toc_rows(result):
        _log.info("toc_analyzer fetch_full_toc_llm: full_toc present but no rows extracted")
        return None

    rows_count = len(_extract_full_toc_rows(result))
    _log.info("toc_analyzer fetch_full_toc_llm success rows=%s", rows_count)
    return result


# ─── CHM structural TOC → TocSection list ────────────────────────────────────

def chm_structure_to_sections(raw_items: list[dict]) -> list[TocSection]:
    """Convert CHM directory items (from toc_extractor) to TocSection list.

    CHM doesn't have page numbers; we assign sequential indices as page_from.
    """
    sections: list[TocSection] = []
    for i, item in enumerate(raw_items):
        sections.append(TocSection(
            title=item.get("title", f"Section {i + 1}"),
            page_from=i + 1,
            page_to=i + 1,  # each CHM topic = 1 "page"
            depth=item.get("depth", 1),
            suggested_chunk_type=None,  # user must classify
        ))
    return sections


# ─── CHM: LLM chunk_type for shallow rows + tree inherit for deep rows ───────

# Larger batch reduces round-trips; with default depth=1, batches are usually small.
CHM_CLASSIFY_BATCH = 120


def _inherit_chm_chunk_types(
    sections: list[TocSection],
    anchor_types: dict[int, str | None],
) -> list[TocSection]:
    """Pre-order walk: unindexed rows inherit `suggested_chunk_type` from the nearest open parent."""
    stack: list[tuple[int, str | None]] = []
    filled: list[str | None] = []
    for i, s in enumerate(sections):
        d = s.depth
        while stack and stack[-1][0] >= d:
            stack.pop()
        if i in anchor_types:
            t = anchor_types[i]
        else:
            t = stack[-1][1] if stack else None
        filled.append(t)
        stack.append((d, t))
    return [
        TocSection(
            s.title,
            s.page_from,
            s.page_to,
            s.depth,
            (filled[i] if filled[i] is not None else s.suggested_chunk_type),
        )
        for i, s in enumerate(sections)
    ]


async def iter_assign_chm_section_chunk_types(
    sections: list[TocSection],
    llm_profile,
    model_name: str,
    *,
    max_classify_depth: int = CHM_CLASSIFY_MAX_DEPTH,
) -> AsyncIterator[tuple[int, int, int, list[TocSection]]]:
    """Yield after each LLM batch: (batch_index_0based, batch_total, batch_row_count, merged_sections).

    When there is nothing to label, yields a single (0, 1, 0, sections) with types unchanged.
    Uses ``await complete_text_once`` (no :func:`asyncio.run` per batch).
    """
    if not sections:
        return
    to_label_idx = [i for i, s in enumerate(sections) if s.depth <= max_classify_depth]
    if not to_label_idx:
        yield (0, 1, 0, list(sections))
        return

    effective_model_name = model_name or ""
    system_prompt = load_prompt("toc_analyzer", "chm_classify_system")
    valid = {t.value for t in ChunkType} - {ChunkType.NONE.value}
    n = len(sections)
    anchor: dict[int, str | None] = {}
    num_batches = (len(to_label_idx) + CHM_CLASSIFY_BATCH - 1) // CHM_CLASSIFY_BATCH
    batch_num = 0

    for batch_start in range(0, len(to_label_idx), CHM_CLASSIFY_BATCH):
        batch_rows = to_label_idx[batch_start : batch_start + CHM_CLASSIFY_BATCH]
        lines = "\n".join(
            f"{i + 1}.\tdepth={sections[i].depth}\t{_chm_title_for_classify_prompt(sections[i].title)}"
            for i in batch_rows
        )
        user_message = load_prompt(
            "toc_analyzer",
            "user_chm_batch",
            total=n,
            batch_size=len(batch_rows),
            lines=lines,
        )
        _log.debug(
            "toc_analyzer operation=chm_classify_batch batch_index=%s batch_rows=%s user_chars=%s",
            batch_num,
            len(batch_rows),
            len(user_message),
        )
        try:
            chm_kw: dict[str, Any] = {
                "profile": llm_profile,
                "model_name": effective_model_name,
                "system_prompt": system_prompt,
                "user_prompt": user_message,
                "temperature": task_temperature("toc_analysis"),
            }
            if (getattr(llm_profile, "provider_type", None) or "").strip().lower() == "anthropic":
                chm_kw["max_tokens"] = DEFAULT_MAX_TOKENS_ANTHROPIC
            raw = await asyncio.wait_for(
                complete_text_once(**chm_kw),
                timeout=TOC_LLM_MAX_WAIT_SECONDS,
            )
            raw = strip_code_fence(raw)
        except asyncio.TimeoutError as e:
            raise RuntimeError(
                f"CHM 目录分类单批等待模型超过 {int(TOC_LLM_MAX_WAIT_SECONDS)} 秒"
            ) from e
        except Exception as e:
            raise RuntimeError(f"LLM call for CHM chunk classification failed: {e}") from e
        raw = raw.strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if m:
                data = json.loads(m.group())
            else:
                raise RuntimeError(f"CHM classifier returned non-JSON: {raw[:400]}")

        classifs = data.get("classifications", [])
        if not isinstance(classifs, list):
            raise RuntimeError("CHM classifier: missing 'classifications' array")

        for j, bi in enumerate(batch_rows):
            item = classifs[j] if j < len(classifs) and isinstance(classifs[j], dict) else {}
            if isinstance(item, dict) and item.get("i") is not None:
                idx = int(item["i"]) - 1
            else:
                idx = bi
            if idx < 0 or idx >= n:
                idx = bi
            ct = item.get("suggested_chunk_type") if isinstance(item, dict) else None
            if ct in (None, "null", ""):
                anchor[idx] = None
            elif isinstance(ct, str) and ct in valid:
                anchor[idx] = ct
            else:
                anchor[idx] = None

        merged = _inherit_chm_chunk_types(sections, anchor)
        yield (batch_num, num_batches, len(batch_rows), merged)
        batch_num += 1


def assign_chm_section_chunk_types(
    sections: list[TocSection],
    llm_profile,
    model_name: str,
    *,
    max_classify_depth: int = CHM_CLASSIFY_MAX_DEPTH,
) -> list[TocSection]:
    """Label CHM sections with `suggested_chunk_type` using LLM on shallow nodes (depth ≤ max);
    deeper nodes inherit from parent chain in the flat HHC order.

    Only rows with ``depth <= max_classify_depth`` are sent to the LLM; the rest
    inherit along the flat tree (default depth 1 aligns with PDF-style big parts).
    """
    async def _run() -> list[TocSection]:
        last = list(sections)
        async for *_, merged in iter_assign_chm_section_chunk_types(
            sections, llm_profile, model_name, max_classify_depth=max_classify_depth
        ):
            last = merged
        return last

    return asyncio.run(_run())
