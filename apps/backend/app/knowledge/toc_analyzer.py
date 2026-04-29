"""LLM-based TOC analyzer.

Takes raw text extracted from PDF TOC pages and asks an LLM to return a
structured section list with suggested chunk_type tags.

The LLM is expected to output JSON only; if the input is not a valid TOC the
response must include ``"is_toc": false`` and a ``"reason"`` field — we then
raise TocNotRecognizedError so the caller can surface this to the user.
"""
from __future__ import annotations

import json
import re
import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.agents.model_adapter import strip_code_fence, complete_text_once

_log = logging.getLogger(__name__)
from app.prompts import load_prompt
from app.services.llm_defaults import task_temperature


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


class TocNotRecognizedError(ValueError):
    """Raised when the LLM determines the input is not a recognizable TOC."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(f"Input not recognized as a TOC: {reason}")


# ─── Main function ────────────────────────────────────────────────────────────

async def fetch_pdf_toc_llm_raw(toc_text: str, llm_profile, model_name: str) -> str:
    """Call LLM only; return raw assistant text (may include fences). Raises RuntimeError on failure.

    Use ``await`` from async routes. For sync call sites, use :func:`analyze_toc` or
    ``asyncio.run(fetch_pdf_toc_llm_raw(...))`` at a true sync boundary.
    """
    effective_model_name = model_name or ""
    system_prompt = load_prompt("toc_analyzer", "system")
    user_message = load_prompt("toc_analyzer", "user_pdf", toc_text=toc_text[:6000])
    try:
        t = task_temperature("toc_analysis")
        raw = await complete_text_once(
            profile=llm_profile,
            model_name=effective_model_name,
            system_prompt=system_prompt,
            user_prompt=user_message,
            temperature=t,
        )
        out = strip_code_fence(raw)
        _log.debug(
            "toc_analyzer operation=fetch_pdf_toc_llm_raw toc_chars=%s response_chars=%s",
            len(toc_text or ""),
            len(out or ""),
        )
        return out
    except Exception as e:
        raise RuntimeError(f"LLM call for TOC analysis failed: {e}") from e


def parse_pdf_toc_response(raw: str) -> TocAnalysisResult:
    """Parse LLM JSON into sections. Raises TocNotRecognizedError or RuntimeError."""
    raw = strip_code_fence(raw).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group())
            except json.JSONDecodeError:
                _log.info(
                    "toc_analyzer operation=parse_pdf_toc_response parse_ok=false response_chars=%s snippet=%s",
                    len(raw),
                    raw[:300],
                )
                raise RuntimeError(f"LLM returned non-JSON output: {raw[:300]}")
        else:
            _log.info(
                "toc_analyzer operation=parse_pdf_toc_response parse_ok=false response_chars=%s snippet=%s",
                len(raw),
                raw[:300],
            )
            raise RuntimeError(f"LLM returned non-JSON output: {raw[:300]}")

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

    return TocAnalysisResult(sections=sections)


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

CHM_CLASSIFY_MAX_DEPTH = 2
# Larger batch significantly reduces request round-trips for CHM catalogs.
# For common depth<=2 catalogs, 120 usually fits in one or two calls.
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
            f"{i + 1}.\tdepth={sections[i].depth}\t{sections[i].title}"
            for i in batch_rows
        )
        user_message = load_prompt(
            "toc_analyzer",
            "user_chm_batch",
            total=n,
            batch_size=len(batch_rows),
            lines=lines,
        )
        try:
            raw = await complete_text_once(
                profile=llm_profile,
                model_name=effective_model_name,
                system_prompt=system_prompt,
                user_prompt=user_message,
                temperature=task_temperature("toc_analysis"),
            )
            raw = strip_code_fence(raw)
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

    Large CHMs (thousands of leaves) are handled by classifying only the top
    `max_classify_depth` levels — typically a few hundred calls at most.
    """
    async def _run() -> list[TocSection]:
        last = list(sections)
        async for *_, merged in iter_assign_chm_section_chunk_types(
            sections, llm_profile, model_name, max_classify_depth=max_classify_depth
        ):
            last = merged
        return last

    return asyncio.run(_run())
