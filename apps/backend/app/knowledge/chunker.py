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


# Patterns that look like headings (Markdown-style or ALL CAPS short lines)
_HEADING_RE = re.compile(r"^(#{1,3}\s+.+|[A-Z\u4e00-\u9fff][^\n]{0,60})$", re.MULTILINE)

TARGET_MIN_CHARS = 600
TARGET_MAX_CHARS = 1600
OVERLAP_CHARS = 200


def chunk_pages(
    pages: list[dict],  # [{"page": int, "text": str}]
    target_min: int = TARGET_MIN_CHARS,
    target_max: int = TARGET_MAX_CHARS,
    overlap: int = OVERLAP_CHARS,
) -> list[RawChunk]:
    """Split extracted page texts into overlapping chunks with page tracking."""
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
        is_heading = bool(_HEADING_RE.match(para)) and len(para) < 120

        if is_heading:
            current_section = para.lstrip("# ").strip()

        # If adding this paragraph exceeds target_max, flush first
        if current_chars + len(para) > target_max and current_chars >= target_min:
            rc = flush(current_parts)
            if rc:
                chunks.append(rc)
            # Keep overlap: last few parts
            overlap_parts: list[tuple[str, int]] = []
            overlap_count = 0
            for p, pg in reversed(current_parts):
                overlap_count += len(p)
                overlap_parts.insert(0, (p, pg))
                if overlap_count >= overlap:
                    break
            current_parts = overlap_parts
            current_chars = sum(len(p) for p, _ in current_parts)

        current_parts.append((para, page_num))
        current_chars += len(para)

    # Flush remaining
    if current_parts:
        rc = flush(current_parts)
        if rc:
            chunks.append(rc)

    return chunks
