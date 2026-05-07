"""TOC extraction utilities for PDF and CHM files.

PDF:  auto-scan first N pages to detect the table of contents, or extract
      a caller-specified page range.  Returns raw text for LLM analysis.

CHM:  read the .hhc (HTML Help Contents) file that is embedded in every
      compliant CHM archive and return a structured section list directly
      (no LLM needed).
"""
from __future__ import annotations

import html
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


# ─── PDF ──────────────────────────────────────────────────────────────────────

_TOC_KEYWORDS = re.compile(
    r"目\s*录|contents?|table\s+of\s+contents|inhaltsverzeichnis|sommaire",
    re.IGNORECASE,
)
# 西式目录：行末为引导点/空白后接页码。
_TOC_LINE_DOTTED = re.compile(r"[\.\s·…]{3,}\d{1,4}\s*$")
# 扫描前若干页、单段目录取多页，与 ``fetch_pdf_toc`` 入模上限一起考虑。
TOC_DETECT_DEFAULT_SCAN_FIRST_N: int = 20
TOC_DETECT_MAX_SPAN_EXTRA_PAGES: int = 9  # 与起始页连续时最多再含 9 页（共 10 页）


def _loose_toc_line_ends_with_page(s: str) -> bool:
    """无点线时，行末为「任意正文 + 空白 + 1～4 位页码」（含以「1. 章名」起头的行）。"""
    s = s.strip()
    m = re.match(r"^(.+)\s+(\d{1,4})\s*$", s)
    if not m or len(s) < 4:
        return False
    body, num_s = m.group(1), m.group(2)
    if re.fullmatch(r"\d{1,4}", body.strip()):
        return False
    if len(num_s) == 4 and 1800 <= int(num_s) < 3000:
        return False
    if len(body.strip()) < 2:
        return False
    return True


def _is_toc_like_line(line: str) -> bool:
    s = line.strip()
    if len(s) < 4:
        return False
    if _TOC_LINE_DOTTED.search(s):
        return True
    return _loose_toc_line_ends_with_page(s)


def _score_toc_page(text: str) -> float:
    """Heuristic score: how likely is this page to be a TOC page (0–1)."""
    if not text.strip():
        return 0.0
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return 0.0

    n = max(len(lines), 1)
    score = 0.0
    if _TOC_KEYWORDS.search(text):
        score += 0.3

    toc_rows = sum(1 for l in lines if _is_toc_like_line(l))
    score += min(0.7, toc_rows / n * 1.35)

    return min(1.0, score)


def _bridge_toc_page_scores(
    raw_scores: list[float],
    *,
    th: float = 0.3,
    max_pass: int = 2,
) -> list[float]:
    """若某页分略低于 th，但前后两页都 ≥ th，则视为同一跨页目录的「薄弱页」并抬到 th，避免 2-2 / 2 与 3-4-5 断开。

    两栏 PDF 在某一页上可能整页少匹配点线/行形，用夹心补齐一段连续区间。
    """
    if len(raw_scores) < 3:
        return list(raw_scores)
    s = list(raw_scores)
    for _ in range(max_pass):
        prev = s[:]
        for i in range(1, len(s) - 1):
            if s[i] < th and s[i - 1] >= th and s[i + 1] >= th:
                s[i] = th
        if s == prev:
            break
    return s


def _extract_page_toc_text_adaptive(page) -> str:
    """Heuristic two-up: if both half-pages have enough text, concatenate left then right; else full-page ``extract_text``."""
    try:
        full = (page.extract_text() or "").strip()
    except Exception:
        return ""
    try:
        x0, _y0, x1, y1 = page.bbox
        w = (x1 - x0) or 1.0
        if w < 2:
            return full
        mid = (x0 + x1) * 0.5
        left = page.crop((x0, _y0, mid, y1))
        right = page.crop((mid, _y0, x1, y1))
        lt = (left.extract_text() or "").strip()
        rt = (right.extract_text() or "").strip()
    except Exception:
        return full
    a, b = len(lt), len(rt)
    if a < 4 and b < 4:
        return full
    if a == 0 or b == 0:
        return full
    ratio = min(a, b) / max(a, b, 1)
    if ratio >= 0.08 and a >= 12 and b >= 12:
        return f"{lt}\n{rt}"
    return full


# ─── Text cleanup before LLM (noise from OCR, watermarks, vertical type) ─────


def _line_looks_like_toc_entry(line: str) -> bool:
    s = line.strip()
    if _is_toc_like_line(s):
        return True
    if _loose_toc_line_ends_with_page(s):
        return True
    # 常见章/幕/节标题
    if re.search(r"第[一二三四五六七八九十百千万0-9]+[章节部幕]|\A附录|^[0-9]{1,2}\s*\.\s*[\S\u4e00-\u9fff]", s):
        if len(s) >= 3:
            return True
    return False


def _line_looks_like_noise_only(line: str) -> bool:
    """OCR/水印：竖条字、单字母碎片、纯数字/符号行等。保守：有 TOC 像则保留，由前一条规则先过。"""
    t = line.strip()
    if not t:
        return True
    if re.match(r"^---\s*Page\s+\d+\s*---\s*$", t, re.I):
        return False
    # 极短、几乎无字母/汉字
    if len(t) <= 2 and not re.search(r"[\u4e00-\u9fff]", t):
        return re.fullmatch(r"[\W\dA-Za-z]{1,2}", t) is not None
    # 碎片：R P T 馆 这种单字空格串（≥4 个 token 且多数字符为单格）
    parts = t.split()
    if len(parts) >= 4:
        if sum(1 for p in parts if len(p) == 1) >= max(3, len(parts) * 0.5):
            if not re.search(r"[\u4e00-\u9fff]{2,}", t):
                return len(t) < 100
    # 大量孤立拉丁字母 + 少量 CJK
    cjk = sum(1 for c in t if "\u4e00" <= c <= "\u9fff")
    if cjk < 2 and len(t) < 80:
        alnum_blocks = re.findall(r"[A-Za-z]", t)
        if len(set(alnum_blocks)) >= 6 and len(t.split()) >= 4:
            return True
    # 版权/ URL 整行
    if "http" in t.lower() or "www." in t.lower() or t.startswith("©"):
        if len(t) < 200:
            return not _line_looks_like_toc_entry(t)
    return False


def preprocess_toc_text_for_llm(text: str) -> str:
    """Normalize and drop obvious noise before sending raw TOC to the LLM. Idempotent on Page markers.

    - Unicode NFKC (full/half width)
    - Strip ZW / BOM / soft-hyphen that often break line boundaries in OCR
    - Drop lines that look like vertical-OCR or watermark fragments (layout: :func:`_extract_page_toc_text_adaptive`)
    - Collapse long runs of blank lines
    """
    if not (text and text.strip()):
        return (text or "").strip()
    try:
        import unicodedata

        t = unicodedata.normalize("NFKC", text)
    except Exception:
        t = text
    t = re.sub(r"[\u200b\ufeff\u00ad\u2060]+", "", t)
    t = re.sub(r"[\t\f\v]+", " ", t)
    out: list[str] = []
    for line in t.splitlines():
        s = line.strip()
        if re.match(r"^---\s*Page\s+\d+\s*---\s*$", s, re.I):
            out.append(s)
            continue
        if not s:
            continue
        if _line_looks_like_toc_entry(s) or not _line_looks_like_noise_only(s):
            out.append(s)
    # Adjacent exact duplicates (OCR/双栏重抽) — 保留 Page 分隔行
    dedup: list[str] = []
    for s in out:
        if (
            dedup
            and dedup[-1] == s
            and not re.match(r"^---\s*Page\s+\d+\s*---\s*$", s, re.I)
        ):
            continue
        dedup.append(s)
    t2 = "\n".join(dedup)
    t2 = re.sub(r"\n{4,}", "\n\n\n", t2)
    return t2.strip()


def detect_toc_pages_sync(
    pdf_path: Path,
    scan_first_n: int = TOC_DETECT_DEFAULT_SCAN_FIRST_N,
) -> tuple[str, int, int]:
    """Scan the first *scan_first_n* pages of a PDF and find the TOC range.

    启发式：「目录/contents」关键词 + 行是否像「点线+页码」或「词+空格+页码」；两栏/中文无点线靠后者与夹心补页。

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
            text = _extract_page_toc_text_adaptive(pdf.pages[i])
            page_texts.append((i + 1, text))

    raw_sc = [_score_toc_page(txt) for _, txt in page_texts]
    br = _bridge_toc_page_scores(raw_sc)
    scores: list[tuple[int, str, float]] = [
        (page_texts[i][0], page_texts[i][1], br[i]) for i in range(len(page_texts))
    ]

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

    # 单段目录页数上限（多页长目录）
    best_end = min(best_end, best_start + TOC_DETECT_MAX_SPAN_EXTRA_PAGES)

    toc_parts = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for pn in range(best_start, best_end + 1):
            txt = _extract_page_toc_text_adaptive(pdf.pages[pn - 1])
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
            txt = _extract_page_toc_text_adaptive(pdf.pages[pn - 1])
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
        if not tok_stripped:
            continue
        lower = tok_stripped.lower()
        if lower.startswith("<ul"):
            depth += 1
        elif lower.startswith("</ul"):
            depth = max(0, depth - 1)
        elif lower.startswith("<param") and 'name="name"' in lower:
            # Standard: value="..."
            m = re.search(r'value="([^"]*)"', tok_stripped, re.IGNORECASE)
            if not m:
                # Also accept single-quoted values
                m = re.search(r"value='([^']*)'", tok_stripped, re.IGNORECASE)
            if m:
                current_title = html.unescape(m.group(1)).strip()
        elif lower.startswith("</object") and current_title:
            sections.append({"title": current_title, "depth": max(1, depth)})
            current_title = None

    if not sections:
        logger.warning("[CHM] _parse_hhc_xml produced 0 sections from %d chars", len(hhc_text))

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


def _extract_hhc_windows(chm_path: Path) -> bytes | None:
    """Windows-native: decompile CHM with hh.exe and find the .hhc file."""
    import subprocess
    import tempfile
    from app.knowledge.chm_ingest import _find_hh_exe

    if not chm_path.is_file():
        logger.warning("[CHM] File not found: %s", chm_path)
        return None

    hh_exe = _find_hh_exe()
    if not hh_exe:
        logger.warning("[CHM] hh.exe not found at C:\\Windows\\System32, C:\\Windows, or Sysnative")
        return None

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_dir = Path(tmp_dir) / "chm_toc"
        out_dir.mkdir()
        result = subprocess.run(
            [str(hh_exe), "-decompile", str(out_dir), str(chm_path)],
            capture_output=True,
            timeout=60,
        )
        # hh.exe often returns non-zero even on success; check output instead.
        if result.stderr:
            stderr_text = result.stderr.decode("utf-8", errors="replace").strip()
            if stderr_text:
                logger.warning("[CHM] hh.exe stderr: %s", stderr_text[:500])

        # Find .hhc (table of contents) — the primary TOC source.
        hhc_files = list(out_dir.rglob("*.hhc"))
        if hhc_files:
            logger.info("[CHM] found .hhc file: %s", hhc_files[0].name)
            return hhc_files[0].read_bytes()

        # Fallback: some CHMs use .hhk (index) with a similar structure.
        hhk_files = list(out_dir.rglob("*.hhk"))
        if hhk_files:
            logger.info("[CHM] no .hhc found, trying .hhk: %s", hhk_files[0].name)
            return hhk_files[0].read_bytes()

        # Diagnostic: list what files were produced
        all_files = list(out_dir.rglob("*"))
        file_names = [f.name for f in all_files if f.is_file()]
        logger.warning(
            "[CHM] no .hhc or .hhk found; decompile produced %d files: %s",
            len(file_names),
            ", ".join(file_names[:30]),
        )
        return None


def extract_chm_toc_sync(chm_path: Path) -> list[dict]:
    """Extract the CHM directory structure from the embedded .hhc file.

    Returns list of {title: str, depth: int} — no page numbers (CHM uses
    sequential topic index as page numbers).

    On Windows: uses hh.exe -decompile (built-in, no dependencies).
    On macOS/Linux: uses pychm (requires chmlib + pip install pychm).
    """
    from app.knowledge.pychm_loader import is_windows_platform

    if is_windows_platform():
        hhc_raw = _extract_hhc_windows(chm_path)
        if not hhc_raw:
            logger.warning("[CHM] TOC extraction failed for %s", chm_path.name)
            return []
        hhc_text = _decode_hhc_file(hhc_raw, "utf-8")
        sections = _parse_hhc_xml(hhc_text)
        logger.info("[CHM] extracted %d TOC entries from %s", len(sections), chm_path.name)
        return sections

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
