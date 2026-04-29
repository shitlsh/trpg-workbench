"""LLM-based TOC analyzer.

Takes raw text extracted from PDF TOC pages and asks an LLM to return JSON with:

- ``full_toc`` — **full** directory hierarchy (``rows`` or tree ``nodes``) for
  UI preview; sub-rows do not carry ``suggested_chunk_type`` (program assigns
  by inheriting from chapter-level ``sections``).
- ``sections`` — **chapter-skeleton** list (coarse, for ingest) with
  ``suggested_chunk_type`` on each major row — see ``prompts/toc_analyzer/system.txt``.

The LLM is expected to output JSON only; if the input is not a valid TOC the
response must include ``"is_toc": false`` and a ``"reason"`` field — we then
raise TocNotRecognizedError so the caller can surface this to the user.
If ``is_toc`` is true but ``full_toc`` is missing or empty, the API still
succeeds for `sections`; line-level ``preview_expanded`` is only filled when
``full_toc`` yields rows.
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
from app.services.llm_defaults import task_temperature

# Wall-clock cap for one `complete_text_once` in TOC flows (PDF analyze-toc, each CHM batch).
TOC_LLM_MAX_WAIT_SECONDS: float = 900.0
# PDF: raw TOC text sent to the model (output is already chapter-skeleton; allow longer multi-page TOCs).
PDF_TOC_LLM_MAX_INPUT_CHARS: int = 12000
# Anthropic TOC/CHM: use ``DEFAULT_MAX_TOKENS_ANTHROPIC`` (see ``model_adapter``). OpenAI /
# OpenRouter / ``openai_compatible`` / **Google** do not pass max output — provider defaults.
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
    # Raw `full_toc` from the LLM: ``{ "rows": [...] }`` or ``{ "nodes": [...] }``.
    full_toc: dict[str, Any] | None = None


class TocNotRecognizedError(ValueError):
    """Raised when the LLM determines the input is not a recognizable TOC."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(f"Input not recognized as a TOC: {reason}")


def _norm_title_str(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip()).lower()


def _flatten_toc_node(node: Any) -> list[dict[str, Any]]:
    if not isinstance(node, dict) or not str(node.get("title", "")).strip():
        return []
    row = {k: v for k, v in node.items() if k != "children"}
    out: list[dict[str, Any]] = [row]
    for c in node.get("children") or []:
        out.extend(_flatten_toc_node(c))
    return out


def _extract_full_toc_rows(full_toc: Any) -> list[dict[str, Any]]:
    if full_toc is None:
        return []
    if isinstance(full_toc, list):
        return [x for x in full_toc if isinstance(x, dict) and str(x.get("title", "")).strip()]
    if not isinstance(full_toc, dict):
        return []
    r = full_toc.get("rows")
    if isinstance(r, list) and r:
        return [x for x in r if isinstance(x, dict) and str(x.get("title", "")).strip()]
    n = full_toc.get("nodes")
    if isinstance(n, list) and n:
        out: list[dict[str, Any]] = []
        for node in n:
            out.extend(_flatten_toc_node(node))
        return out
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
    return out


# ─── Main function ────────────────────────────────────────────────────────────

async def fetch_pdf_toc_llm_raw(toc_text: str, llm_profile, model_name: str) -> str:
    """Call LLM only; return raw assistant text (may include fences). Raises RuntimeError on failure.

    Use ``await`` from async routes. For sync call sites, use :func:`analyze_toc` or
    ``asyncio.run(fetch_pdf_toc_llm_raw(...))`` at a true sync boundary.
    """
    effective_model_name = model_name or ""
    system_prompt = load_prompt("toc_analyzer", "system")
    user_message = load_prompt(
        "toc_analyzer",
        "user_pdf",
        toc_text=(toc_text or "")[:PDF_TOC_LLM_MAX_INPUT_CHARS],
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
            "toc_analyzer operation=fetch_pdf_toc_llm_raw toc_chars=%s response_chars=%s",
            len(toc_text or ""),
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

    valid_chunk_types = {"rule", "example", "lore", "table", "procedure", "flavor"}
    sections: list[TocSection] = []

    for i, s in enumerate(raw_sections):
        if not isinstance(s, dict) or not s.get("title"):
            continue
        page_to: int | None = None
        if i + 1 < len(raw_sections):
            next_pf = raw_sections[i + 1].get("page_from")
            if isinstance(next_pf, int):
                page_to = max(next_pf - 1, s.get("page_from", 1))

        ctype = s.get("suggested_chunk_type")
        if ctype not in valid_chunk_types:
            ctype = None

        sections.append(TocSection(
            title=str(s.get("title", "")),
            page_from=int(s.get("page_from", 1)),
            page_to=page_to,
            depth=int(s.get("depth", 1)),
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

    ftraw = data.get("full_toc")
    if isinstance(ftraw, list):
        full_toc = {"rows": ftraw}
    elif isinstance(ftraw, dict) and ftraw:
        full_toc = ftraw
    else:
        full_toc = None
    if full_toc is not None and not _extract_full_toc_rows(full_toc):
        _log.info(
            "toc_analyzer operation=parse_pdf_toc_response full_toc_present_but_no_rows response_chars=%s",
            len(raw or ""),
        )
    elif not full_toc and data.get("is_toc", True):
        _log.info(
            "toc_analyzer operation=parse_pdf_toc_response full_toc_missing (no line-level preview) response_chars=%s",
            len(raw or ""),
        )

    return TocAnalysisResult(sections=sections, full_toc=full_toc)


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
    valid = {"rule", "example", "lore", "table", "procedure", "flavor"}
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
