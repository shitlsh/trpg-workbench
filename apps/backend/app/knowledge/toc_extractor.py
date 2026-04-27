"""TOC extraction utilities for PDF and CHM files.

PDF:  auto-scan first N pages to detect the table of contents, or extract
      a caller-specified page range.  Returns raw text for LLM analysis.

CHM:  read the .hhc (HTML Help Contents) file that is embedded in every
      compliant CHM archive and return a structured section list directly
      (no LLM needed).
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


# ─── PDF ──────────────────────────────────────────────────────────────────────

_TOC_KEYWORDS = re.compile(
    r"目\s*录|contents?|table\s+of\s+contents|inhaltsverzeichnis|sommaire",
    re.IGNORECASE,
)
# A TOC line typically ends with a run of dots/spaces and then page digits.
_TOC_LINE_RE = re.compile(r"[\.\s]{3,}\d{1,4}\s*$")


def _score_toc_page(text: str) -> float:
    """Heuristic score: how likely is this page to be a TOC page (0–1)."""
    if not text.strip():
        return 0.0
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return 0.0

    score = 0.0
    # Keyword bonus
    if _TOC_KEYWORDS.search(text):
        score += 0.3

    # Fraction of lines that end with a page number pattern
    dotted = sum(1 for l in lines if _TOC_LINE_RE.search(l))
    score += min(0.7, dotted / max(len(lines), 1) * 1.4)

    return min(1.0, score)


def detect_toc_pages_sync(
    pdf_path: Path,
    scan_first_n: int = 12,
) -> tuple[str, int, int]:
    """Scan the first *scan_first_n* pages of a PDF and find the TOC range.

    Returns (toc_text, page_start, page_end) — page numbers are 1-indexed.
    Raises RuntimeError if pdfplumber is unavailable or the file cannot be read.
    """
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber is required for PDF TOC extraction")

    with pdfplumber.open(str(pdf_path)) as pdf:
        total = len(pdf.pages)
        pages_to_scan = min(scan_first_n, total)

        page_texts: list[tuple[int, str]] = []  # (1-indexed page, text)
        for i in range(pages_to_scan):
            text = pdf.pages[i].extract_text() or ""
            page_texts.append((i + 1, text))

    # Score each page
    scores = [(pn, txt, _score_toc_page(txt)) for pn, txt in page_texts]

    # Find the best contiguous run of high-scoring pages
    THRESHOLD = 0.3
    best_start = best_end = -1
    best_sum = 0.0

    run_start = -1
    run_sum = 0.0
    for pn, _, sc in scores:
        if sc >= THRESHOLD:
            if run_start == -1:
                run_start = pn
                run_sum = sc
            else:
                run_sum += sc
        else:
            if run_start != -1:
                if run_sum > best_sum:
                    best_sum = run_sum
                    best_start = run_start
                    best_end = pn - 1
                run_start = -1
                run_sum = 0.0
    if run_start != -1 and run_sum > best_sum:
        best_start = run_start
        best_end = scores[-1][0]

    if best_start == -1:
        # No clear TOC found — return first 3 pages as fallback
        best_start = 1
        best_end = min(3, total)

    # Clamp to at most 6 pages to keep LLM input manageable
    best_end = min(best_end, best_start + 5)

    toc_text = "\n\n--- Page {} ---\n".format(best_start)
    toc_text += "\n\n--- Page {} ---\n".join(
        str(pn) for pn, _ in page_texts if best_start <= pn <= best_end
    )
    # Rebuild properly
    toc_parts = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for pn in range(best_start, best_end + 1):
            txt = pdf.pages[pn - 1].extract_text() or ""
            toc_parts.append(f"--- Page {pn} ---\n{txt}")
    toc_text = "\n\n".join(toc_parts)

    return toc_text, best_start, best_end


def extract_pages_text_sync(pdf_path: Path, page_start: int, page_end: int) -> str:
    """Extract raw text from *page_start*–*page_end* (1-indexed, inclusive)."""
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber is required for PDF text extraction")

    parts = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        total = len(pdf.pages)
        for pn in range(page_start, min(page_end, total) + 1):
            txt = pdf.pages[pn - 1].extract_text() or ""
            parts.append(f"--- Page {pn} ---\n{txt}")
    return "\n\n".join(parts)


# ─── CHM ──────────────────────────────────────────────────────────────────────

def _parse_hhc_xml(hhc_text: str) -> list[dict]:
    """Parse a CHM .hhc file (HTML-like XML) into a flat section list.

    Returns list of {title: str, depth: int}.
    """
    # .hhc is HTML-style so we use regex rather than a full XML parser
    # (it often has loose/invalid XML).
    sections: list[dict] = []
    depth = 0

    # Track nesting by <ul>/<li>
    tokens = re.split(r"(<[^>]+>)", hhc_text, flags=re.DOTALL)
    current_title: str | None = None

    for tok in tokens:
        tok_stripped = tok.strip()
        lower = tok_stripped.lower()
        if lower.startswith("<ul"):
            depth += 1
        elif lower.startswith("</ul"):
            depth = max(0, depth - 1)
        elif lower.startswith("<param") and 'name="name"' in lower:
            m = re.search(r'value="([^"]*)"', tok_stripped, re.IGNORECASE)
            if m:
                current_title = html.unescape(m.group(1)).strip()
        elif lower.startswith("</object") and current_title:
            sections.append({"title": current_title, "depth": max(1, depth)})
            current_title = None

    return sections


def _chm_codec_name(chm_file) -> str:
    """pychm GetEncoding() may return bytes (e.g. b'cp936') suitable for str.decode/encode."""
    enc = chm_file.GetEncoding()
    if not enc:
        return "utf-8"
    if isinstance(enc, bytes):
        return enc.decode("ascii", errors="replace")
    return str(enc)


def _chm_topics_path_variants(topics: bytes | None) -> list[bytes]:
    """#SYSTEM stores topics path in local encoding; resolve may need UTF-8 re-encoded form."""
    if not topics:
        return []
    out: list[bytes] = [topics]
    for dec in ("gbk", "gb18030", "cp936"):
        try:
            s = topics.decode(dec)
            u8 = s.encode("utf-8")
            if u8 not in out:
                out.append(u8)
        except UnicodeDecodeError:
            continue
    return out


def _chm_read_object_bytes(chm_file: object, chm_c: object, path: bytes) -> bytes | None:
    """Read one object by path bytes; pychm CHMFile.ResolveObject(str) is wrong for non-ASCII on py3."""
    if not chm_file.file:
        return None
    res, ui = chm_c.chm_resolve_object(chm_file.file, path)
    if res != chm_c.CHM_RESOLVE_SUCCESS or ui is None:
        return None
    size, raw = chm_file.RetrieveObject(ui)
    if not size or not raw:
        return None
    return raw


def _decode_hhc_file(raw: bytes, chm_suggested_codec: str) -> str:
    """HHC is often GBK/GB18030 while #SYSTEM / GetEncoding() may report utf-8; pick best fit."""
    candidates: list[str] = []
    for c in (chm_suggested_codec, "gbk", "gb18030", "utf-8", "cp936", "big5", "latin-1"):
        if c and c not in candidates:
            candidates.append(c)
    best: tuple[int, str] | None = None
    for enc in candidates:
        try:
            s = raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        bad = s.count("\ufffd")
        if best is None or bad < best[0]:
            best = (bad, s)
        if bad == 0 and enc in ("gbk", "gb18030", "utf-8") and any("\u4e00" <= ch <= "\u9fff" for ch in s[:2000]):
            return s
    return best[1] if best else raw.decode("utf-8", errors="replace")


def extract_chm_toc_sync(chm_path: Path) -> list[dict]:
    """Extract the CHM directory structure from the embedded .hhc file.

    Returns list of {title: str, depth: int} — no page numbers (CHM uses
    sequential topic index as page numbers).

    Raises RuntimeError if pychm is not available or .hhc cannot be found.
    """
    from app.knowledge.pychm_loader import import_pychm

    chm_hl, chm_c = import_pychm()

    chm_file = chm_hl.CHMFile()
    if not chm_file.LoadCHM(str(chm_path)):
        raise RuntimeError(f"pychm could not open CHM file: {chm_path}")

    encoding = _chm_codec_name(chm_file)
    hhc_text: str | None = None
    hhc_raw: bytes | None = None

    # 1) GetTopicsTree() when #SYSTEM path resolves
    try:
        raw = chm_file.GetTopicsTree()
        if raw and len(raw) > 8:
            hhc_raw = raw
    except Exception:
        hhc_raw = None

    # 2) Same file as chm_file.topics but with path encoding variants (Chinese CHMs)
    if hhc_raw is None and chm_file.topics:
        topics_b = chm_file.topics if isinstance(chm_file.topics, bytes) else str(chm_file.topics).encode("utf-8")
        for pth in _chm_topics_path_variants(topics_b):
            hhc_raw = _chm_read_object_bytes(chm_file, chm_c, pth)
            if hhc_raw:
                break

    # 3) Common English paths
    hhc_candidates = ("/#TOCIDX", "/toc.hhc", "/Table of Contents.hhc")
    if hhc_raw is None:
        for candidate in hhc_candidates:
            hhc_raw = _chm_read_object_bytes(chm_file, chm_c, candidate.encode("utf-8"))
            if hhc_raw:
                break

    # 4) Enumerate — keep path as bytes (matches archive; str/UTF-8 alone can fail)
    if hhc_raw is None and chm_file.file:
        found: list[bytes] = []

        def _find_hhc(_ctx: object, ui: object, _user: object) -> int:
            path = getattr(ui, "path", b"")
            if isinstance(path, memoryview):
                path = path.tobytes()
            if isinstance(path, bytes) and path.lower().endswith(b".hhc"):
                found.append(path)
            return chm_c.CHM_ENUMERATOR_CONTINUE

        chm_c.chm_enumerate_dir(
            chm_file.file, b"/", chm_c.CHM_ENUMERATE_ALL, _find_hhc, None
        )
        for fp in found:
            hhc_raw = _chm_read_object_bytes(chm_file, chm_c, fp)
            if hhc_raw:
                break

    if hhc_raw:
        hhc_text = _decode_hhc_file(hhc_raw, encoding)

    chm_file.CloseCHM()

    if not hhc_text:
        return []

    return _parse_hhc_xml(hhc_text)
