"""Chunking logic for PDF text extraction.

Supports two modes:
- Heading-based: split on detected H1/H2/H3 boundaries
- Sliding window: paragraph-based with overlap when no headings found
"""
import re
from dataclasses import dataclass


@dataclass
class RawChunk:
    chunk_index: int
    content: str
    page_from: int
    page_to: int
    section_title: str | None
    char_count: int


# Patterns that look like headings.
# Requires Markdown-style (#) or ALL-CAPS short line (≤ 60 chars, no lowercase letters after the first).
# Deliberately tighter than before to avoid false positives on regular sentences.
_HEADING_RE = re.compile(
    r"^(?:#{1,3}\s+.{1,80}|[A-Z\u4e00-\u9fff][^\n]{0,59})$",
    re.MULTILINE,
)
# A more permissive pre-filter: only treat a paragraph as a heading candidate
# if it is a single line (no embedded newlines).
_IS_SINGLE_LINE = re.compile(r"^[^\n]+$")

TARGET_MIN_CHARS = 600
TARGET_MAX_CHARS = 1600
# CJK languages are denser: a Chinese sentence of 300 chars carries more
# semantic content than 600 English characters.  Use tighter bounds so
# chunks stay well within LLM context windows and retrieval stays precise.
CJK_TARGET_MIN_CHARS = 300
CJK_TARGET_MAX_CHARS = 800
OVERLAP_CHARS = 200


def _is_cjk_dominant(text: str, threshold: float = 0.4) -> bool:
    """Return True if CJK characters make up >= threshold of all letters/words."""
    if not text:
        return False
    cjk_count = sum(
        1 for ch in text
        if "\u4e00" <= ch <= "\u9fff"  # CJK Unified Ideographs
        or "\u3400" <= ch <= "\u4dbf"  # Extension A
        or "\uac00" <= ch <= "\ud7a3"  # Hangul syllables
        or "\u3040" <= ch <= "\u30ff"  # Hiragana / Katakana
    )
    # Compare against total non-whitespace characters
    total = sum(1 for ch in text if not ch.isspace())
    return total > 0 and (cjk_count / total) >= threshold


def chunk_pages(
    pages: list[dict],  # [{"page": int, "text": str}]
    target_min: int | None = None,
    target_max: int | None = None,
    overlap: int = OVERLAP_CHARS,
) -> list[RawChunk]:
    """Split extracted page texts into overlapping chunks with page tracking."""
    # Detect CJK dominance from full document text and pick appropriate bounds
    full_text = " ".join(p.get("text", "") for p in pages)
    if target_min is None:
        target_min = CJK_TARGET_MIN_CHARS if _is_cjk_dominant(full_text) else TARGET_MIN_CHARS
    if target_max is None:
        target_max = CJK_TARGET_MAX_CHARS if _is_cjk_dominant(full_text) else TARGET_MAX_CHARS

    # Build a flat list of (text, page_num) segments by paragraph
    segments: list[tuple[str, int]] = []
    for page_info in pages:
        page_num = page_info["page"]
        text = page_info["text"] or ""
        # Split into paragraphs on blank lines or heading boundaries
        paras = re.split(r"\n{2,}", text.strip())
        for para in paras:
            para = para.strip()
            if para:
                segments.append((para, page_num))

    if not segments:
        return []

    chunks: list[RawChunk] = []
    current_parts: list[tuple[str, int]] = []
    current_chars = 0
    current_section: str | None = None
    chunk_index = 0

    def flush(parts: list[tuple[str, int]]) -> RawChunk | None:
        nonlocal chunk_index
        if not parts:
            return None
        content = "\n\n".join(p for p, _ in parts)
        pages_seen = [pg for _, pg in parts]
        rc = RawChunk(
            chunk_index=chunk_index,
            content=content,
            page_from=min(pages_seen),
            page_to=max(pages_seen),
            section_title=current_section,
            char_count=len(content),
        )
        chunk_index += 1
        return rc

    for para, page_num in segments:
        is_heading = (
            bool(_IS_SINGLE_LINE.match(para))
            and bool(_HEADING_RE.match(para))
            and len(para) < 120
        )

        if is_heading:
            # Force flush current buffer at a heading boundary so each section
            # starts its own chunk (semantic boundary).
            if current_chars >= target_min and current_parts:
                rc = flush(current_parts)
                if rc:
                    chunks.append(rc)
                # Keep overlap from end of previous section
                overlap_parts: list[tuple[str, int]] = []
                overlap_count = 0
                for p, pg in reversed(current_parts):
                    overlap_count += len(p)
                    overlap_parts.insert(0, (p, pg))
                    if overlap_count >= overlap:
                        break
                current_parts = overlap_parts
                current_chars = sum(len(p) for p, _ in current_parts)
            current_section = para.lstrip("# ").strip()

        # If adding this paragraph exceeds target_max, flush first
        if current_chars + len(para) > target_max and current_chars >= target_min:
            rc = flush(current_parts)
            if rc:
                chunks.append(rc)
            # Keep overlap: last few parts
            size_overlap_parts: list[tuple[str, int]] = []
            overlap_count = 0
            for p, pg in reversed(current_parts):
                overlap_count += len(p)
                size_overlap_parts.insert(0, (p, pg))
                if overlap_count >= overlap:
                    break
            current_parts = size_overlap_parts
            current_chars = sum(len(p) for p, _ in current_parts)

        current_parts.append((para, page_num))
        current_chars += len(para)

    # Flush remaining
    if current_parts:
        rc = flush(current_parts)
        if rc:
            chunks.append(rc)

    return chunks
