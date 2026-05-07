"""CHM ingest pipeline — adapted from pdf_ingest.py.

CHM parsing strategy (platform-dependent):
  macOS/Linux: pychm (Python bindings to chmlib).
               macOS: brew install chmlib; pip install pychm
               Linux: apt-get install libchm-dev && pip install pychm
  Windows:     hh.exe -decompile (built into every Windows install since XP).
               No external dependencies required.

Steps (same 8-step structure as pdf_ingest):
1. Save original file to source/
2. Extract text from CHM (pychm → iterate topics → strip HTML tags)
3. Clean text
4. Chunk text
5. Page mapping (CHM topics use sequential index as "page" numbers)
6. Generate embeddings
7. Build lancedb vector index
8. Write manifest.json and chunks.jsonl
"""
from __future__ import annotations
import asyncio
import html
import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.knowledge.chunker import chunk_pages, RawChunk
from app.knowledge.vector_index import upsert_chunks
from app.utils.paths import get_data_dir

STEP_LABELS = [
    "正在保存原始文件...",
    "正在提取 CHM 内容...",
    "正在清洗文本...",
    "正在切块...",
    "正在记录页面映射...",
    "正在生成向量...",
    "正在建立向量索引...",
    "正在写入 manifest...",
]

CHM_OVERLAP_CHARS = 80


def _lib_dir(library_id: str) -> Path:
    d = get_data_dir() / "knowledge" / "libraries" / library_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _append_parse_note(existing: str, note: str) -> str:
    note = (note or "").strip()
    if not note:
        return existing
    existing = (existing or "").strip()
    return f"{existing} | {note}" if existing else note


def _strip_html(raw: str) -> str:
    """Strip HTML/XML tags and unescape entities."""
    # Preserve structural breaks before stripping tags; otherwise many CHM pages
    # collapse into one giant paragraph and produce highly-overlapped chunks.
    raw = re.sub(r"(?is)<br\s*/?>", "\n", raw)
    raw = re.sub(
        r"(?is)</(p|div|li|tr|table|section|article|h[1-6]|ul|ol|dl|dt|dd|blockquote)>",
        "\n\n",
        raw,
    )
    raw = re.sub(r"(?is)<li[^>]*>", "\n- ", raw)
    # Remove script/style blocks first
    raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    raw = re.sub(r"<[^>]+>", " ", raw)
    # Unescape HTML entities
    raw = html.unescape(raw)
    # Normalize and collapse whitespace while keeping paragraph boundaries.
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"[ \t\f\v]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def _chm_text_encoding(chm_file: Any) -> str:
    enc = chm_file.GetEncoding()
    if not enc:
        return "utf-8"
    if isinstance(enc, bytes):
        return enc.decode("ascii", errors="replace")
    return str(enc)


def _decode_chm_html(raw: bytes, chm_suggested_codec: str) -> str:
    """Best-effort decode for CHM HTML bytes.

    Some Chinese CHM files report an encoding that does not match body pages.
    Prefer decodes with fewer replacement chars and more readable CJK text.
    """
    candidates: list[str] = []
    for c in (chm_suggested_codec, "gb18030", "gbk", "utf-8", "cp936", "big5", "latin-1"):
        if c and c not in candidates:
            candidates.append(c)

    best_text: str | None = None
    best_score: tuple[int, int, int] | None = None
    for enc in candidates:
        try:
            s = raw.decode(enc, errors="replace")
        except LookupError:
            continue
        bad = s.count("\ufffd")
        cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
        controls = sum(1 for ch in s if ord(ch) < 32 and ch not in "\r\n\t")
        score = (bad, controls, -cjk)
        if best_score is None or score < best_score:
            best_score = score
            best_text = s
        # For Chinese CHM, this is usually the desired decode.
        if bad == 0 and cjk > 24 and enc in ("gb18030", "gbk", "cp936", "utf-8"):
            return s

    if best_text is not None:
        return best_text
    return raw.decode("utf-8", errors="replace")


def _find_hh_exe() -> Path | None:
    """Locate hh.exe on Windows. Tries several known locations.

    On 32-bit Python on 64-bit Windows, System32 may be redirected to
    SysWOW64 (which lacks hh.exe); Sysnative bypasses the redirect.
    Some Windows installations place hh.exe directly in C:\\Windows.
    """
    candidates = [
        Path(r"C:\Windows\System32\hh.exe"),
        Path(r"C:\Windows\Sysnative\hh.exe"),
        Path(r"C:\Windows\hh.exe"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def _extract_chm_pages_windows(chm_path: Path) -> list[dict]:
    """Windows-native CHM extraction using hh.exe -decompile.

    hh.exe is built into every Windows install since XP, but its location
    varies: typically C:\\Windows\\System32 or C:\\Windows.
    It decompiles the CHM into a folder of HTML files which we then parse.
    """
    import subprocess
    import tempfile

    hh_exe = _find_hh_exe()
    if hh_exe is None:
        raise RuntimeError(
            "hh.exe not found. It should be in C:\\Windows\\System32 or C:\\Windows. "
            "This is a built-in Windows tool."
        )

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_dir = Path(tmp_dir) / "chm_out"
        out_dir.mkdir()

        result = subprocess.run(
            [str(hh_exe), "-decompile", str(out_dir), str(chm_path)],
            capture_output=True,
            timeout=60,
        )
        # hh.exe returns non-zero even on success in many cases; check output instead
        html_files = sorted(out_dir.rglob("*.htm")) + sorted(out_dir.rglob("*.html"))
        if not html_files and result.returncode != 0:
            raise RuntimeError(
                f"hh.exe -decompile failed (exit {result.returncode}): "
                f"{result.stderr.decode('utf-8', errors='replace')}"
            )

        pages: list[dict] = []
        page_index = 0
        for html_file in html_files:
            path_str = str(html_file.relative_to(out_dir))
            # Skip navigation/TOC frames
            if html_file.name.lower() in ("toc.htm", "toc.html", "index.htm", "index.html"):
                # Only skip if they look like nav frames (very short)
                pass
            try:
                raw_bytes = html_file.read_bytes()
            except OSError:
                continue

            raw_html = _decode_chm_html(raw_bytes, "utf-8")
            text = _strip_html(raw_html)
            if text and len(text) > 20:
                page_index += 1
                pages.append({"page": page_index, "text": text, "_path": path_str})

        return pages


def _extract_chm_pages_sync(chm_path: Path) -> list[dict]:
    """Extract [{page: int, text: str}] from a CHM file.

    On Windows: uses hh.exe -decompile (built-in, no dependencies).
    On macOS/Linux: uses pychm (requires chmlib + pip install pychm).
    """
    from app.knowledge.pychm_loader import is_windows_platform

    if is_windows_platform():
        return _extract_chm_pages_windows(chm_path)

    from app.knowledge.pychm_loader import import_pychm

    chm_hl, chm_c = import_pychm()

    chm_file = chm_hl.CHMFile()
    if not chm_file.LoadCHM(str(chm_path)):
        raise RuntimeError(f"pychm could not open CHM file: {chm_path}")

    encoding = _chm_text_encoding(chm_file)

    pages: list[dict] = []
    page_index = 0

    def _visitor(_chm_handle: Any, ui: Any, _ctx: Any) -> int:
        """chm_enumerate_dir callback: (context, chmUnitInfo, user)."""
        nonlocal page_index
        path_b = ui.path
        if isinstance(path_b, memoryview):
            path_b = path_b.tobytes()
        path: str = path_b.decode("utf-8", errors="replace") if isinstance(path_b, bytes) else str(path_b)
        if not path.lower().endswith((".htm", ".html")):
            return chm_c.CHM_ENUMERATOR_CONTINUE
        if path.startswith("/#") or path.startswith("/$"):
            return chm_c.CHM_ENUMERATOR_CONTINUE

        size, raw_bytes = chm_file.RetrieveObject(ui)
        if not size or not raw_bytes:
            return chm_c.CHM_ENUMERATOR_CONTINUE

        raw_html = _decode_chm_html(raw_bytes, encoding)

        text = _strip_html(raw_html)
        if text and len(text) > 20:  # skip near-empty pages (nav frames, etc.)
            page_index += 1
            pages.append({"page": page_index, "text": text, "_path": path})

        return chm_c.CHM_ENUMERATOR_CONTINUE

    if chm_file.file:
        chm_c.chm_enumerate_dir(
            chm_file.file, b"/", chm_c.CHM_ENUMERATE_ALL, _visitor, None
        )
    chm_file.CloseCHM()

    return pages


async def _extract_chm_pages(chm_path: Path) -> list[dict]:
    return await asyncio.to_thread(_extract_chm_pages_sync, chm_path)



async def run_ingest(
    *,
    document_id: str,
    library_id: str,
    tmp_file_path: Path,
    original_filename: str,
    embedder: Any,
    embedding_snapshot: dict,
    progress_callback=None,
    default_chunk_type: str = "",
    page_offset: int = 0,  # not commonly used for CHM but kept for API parity
    toc_mapping: list[dict] | None = None,  # [{title, page_from, page_to, chunk_type}]
) -> dict:
    """Run the full 8-step CHM ingest pipeline."""

    async def report(step: int, label: str, status: str = "running"):
        if progress_callback:
            await progress_callback(step, label, status)

    lib_dir = _lib_dir(library_id)
    source_dir = lib_dir / "source"
    parsed_dir = lib_dir / "parsed"
    source_dir.mkdir(parents=True, exist_ok=True)
    parsed_dir.mkdir(parents=True, exist_ok=True)
    index_dir = lib_dir / "index"

    parse_notes = ""

    # ── Step 1: Save file ────────────────────────────────────────────────────
    await report(1, STEP_LABELS[0])
    dest_path = source_dir / f"{Path(original_filename).stem}_{document_id[:8]}.chm"
    if dest_path.exists():
        stem = dest_path.stem
        dest_path = source_dir / f"{stem}_{document_id[:8]}.chm"
    await asyncio.to_thread(shutil.copy2, str(tmp_file_path), str(dest_path))

    # ── Step 2: Extract text ─────────────────────────────────────────────────
    await report(2, STEP_LABELS[1])
    try:
        pages = await _extract_chm_pages(dest_path)
    except Exception as e:
        raise RuntimeError(f"CHM text extraction failed: {e}") from e

    page_count = len(pages)
    if page_count == 0:
        return {
            "parse_status": "failed",
            "parse_notes": "No text content found in CHM file",
            "page_count": 0,
            "chunk_count": 0,
            "manifest_path": "",
        }

    parse_quality = "good"

    # ── Step 3: Clean text ───────────────────────────────────────────────────
    await report(3, STEP_LABELS[2])
    # Minimal cleaning for CHM (HTML stripping already done in extraction)
    from app.knowledge.pdf_ingest import _clean_pages
    pages = await asyncio.to_thread(_clean_pages, pages)

    # ── Step 4: Chunk ────────────────────────────────────────────────────────
    await report(4, STEP_LABELS[3])
    raw_chunks: list[RawChunk] = await asyncio.to_thread(
        chunk_pages,
        pages,
        overlap=CHM_OVERLAP_CHARS,
    )

    if not raw_chunks:
        return {
            "parse_status": "partial",
            "parse_notes": "Text extracted but no chunks produced",
            "page_count": page_count,
            "chunk_count": 0,
            "manifest_path": "",
        }

    # ── Step 5: Page mapping ─────────────────────────────────────────────────
    await report(5, STEP_LABELS[4])

    # ── Step 6: Embed ────────────────────────────────────────────────────────
    await report(6, STEP_LABELS[5])
    texts = [rc.content for rc in raw_chunks]
    try:
        vectors = await asyncio.to_thread(embedder.embed, texts)
    except Exception as e:
        parse_notes = _append_parse_note(parse_notes, f"Embedding failed: {e}")
        # Strict mode: embedding failure means ingest failure.
        raise RuntimeError(parse_notes) from e

    # ── Step 7: Upsert vector index ──────────────────────────────────────────
    await report(7, STEP_LABELS[6])
    chunk_records = []
    chunk_dicts = []

    def _logical(file_page: int) -> int:
        if file_page < 0:
            return -1
        lp = file_page - page_offset
        return lp if lp > 0 else file_page

    # Build sorted TOC mapping for chunk_type lookup
    _sorted_toc: list[tuple[int, int, str]] = []
    if toc_mapping:
        for m in toc_mapping:
            # Use `or 99999` so that explicit 0 / None falls back to sentinel,
            # consistent with pdf_ingest behaviour.
            _sorted_toc.append((m.get("page_from", 0), m.get("page_to") or 99999, m.get("chunk_type", "") or ""))
        _sorted_toc.sort(key=lambda x: x[0])

    def _chunk_type_for(page: int) -> str:
        if not _sorted_toc or page <= 0:
            return default_chunk_type
        result = default_chunk_type
        for pf, pt, ct in _sorted_toc:
            if pf <= page <= pt:
                result = ct
            elif pf > page:
                break
        return result

    for i, (rc, vec) in enumerate(zip(raw_chunks, vectors)):
        cid = f"chunk_{uuid.uuid4().hex[:16]}"
        lp = _logical(rc.page_from)
        chunk_type = _chunk_type_for(lp)
        chunk_records.append({
            "chunk_id": cid,
            "document_id": document_id,
            "library_id": library_id,
            "content": rc.content,
            "page_from": lp,
            "page_to": _logical(rc.page_to),
            "section_title": rc.section_title or "",
            "chunk_type": chunk_type,
            "vector": vec,
        })
        chunk_dicts.append({
            "id": cid,
            "document_id": document_id,
            "chunk_id": cid,
            "chunk_index": rc.chunk_index,
            "content": rc.content,
            "embedding_ref": cid,
            "page_from": lp,
            "page_to": _logical(rc.page_to),
            "section_title": rc.section_title,
            "char_count": rc.char_count,
            "metadata": {
                "chunk_type": chunk_type or None,
                "has_table": False,
                "has_multi_column": False,
                "parse_quality": parse_quality,
            },
        })

    try:
        await asyncio.to_thread(upsert_chunks, index_dir, chunk_records, len(vectors[0]) if vectors else 1536)
    except Exception as e:
        parse_notes = _append_parse_note(parse_notes, f"Vector index write failed: {e}")
        raise RuntimeError(parse_notes) from e

    # ── Step 8: Write manifest & chunks.jsonl (same layout as PDF) ──────────
    await report(8, STEP_LABELS[7])
    manifest = {
        "document_id": document_id,
        "library_id": library_id,
        "filename": original_filename,
        "page_count": page_count,
        "chunk_count": len(raw_chunks),
        "parse_status": "success" if parse_quality == "good" else parse_quality,
        "parse_quality_notes": parse_notes or None,
        "embedding_profile_id": embedding_snapshot["profile_id"],
        "embedding_provider": embedding_snapshot["provider_type"],
        "embedding_model": embedding_snapshot["model_name"],
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = parsed_dir / "manifest.json"
    manifests = []
    if manifest_path.exists():
        try:
            manifests = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifests, list):
                manifests = [manifests]
        except Exception:
            manifests = []
    manifests.append(manifest)
    manifest_path.write_text(json.dumps(manifests, ensure_ascii=False, indent=2))

    chunks_path = parsed_dir / "chunks.jsonl"
    with chunks_path.open("a", encoding="utf-8") as f:
        for c in chunk_dicts:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    await report(8, "处理完成", "completed")

    return {
        "parse_status": "success" if parse_quality == "good" else parse_quality,
        "parse_notes": parse_notes.strip(" |"),
        "page_count": page_count,
        "chunk_count": len(raw_chunks),
        "manifest_path": str(manifest_path),
    }
