"""CHM ingest pipeline — adapted from pdf_ingest.py.

Uses `pychm` (Python bindings to chmlib) to read CHM files cross-platform.

Requirements:
  macOS:   brew install chmlib && pip install pychm
  Linux:   apt-get install libchm-dev && pip install pychm
  Windows: pip install pychm   (pre-built wheels available on PyPI)

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


def _lib_dir(library_id: str) -> Path:
    d = get_data_dir() / "knowledge" / "libraries" / library_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _strip_html(raw: str) -> str:
    """Strip HTML/XML tags and unescape entities."""
    # Remove script/style blocks first
    raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    raw = re.sub(r"<[^>]+>", " ", raw)
    # Unescape HTML entities
    raw = html.unescape(raw)
    # Collapse whitespace
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def _extract_chm_pages_sync(chm_path: Path) -> list[dict]:
    """Extract [{page: int, text: str}] from a CHM file using pychm.

    Raises RuntimeError if pychm is not installed or the file cannot be opened.
    """
    try:
        from chm import chm as chmlib
    except ImportError:
        raise RuntimeError(
            "pychm is not installed. "
            "macOS: brew install chmlib && pip install pychm  |  "
            "Linux: apt-get install libchm-dev && pip install pychm  |  "
            "Windows: pip install pychm"
        )

    chm_file = chmlib.CHMFile()
    if not chm_file.LoadCHM(str(chm_path)):
        raise RuntimeError(f"pychm could not open CHM file: {chm_path}")

    encoding = chm_file.GetEncoding() or "utf-8"

    pages: list[dict] = []
    page_index = 0

    def _visitor(chm_obj: Any, ui: Any, ctx: Any) -> int:
        """Called by pychm for each object in the CHM archive."""
        nonlocal page_index
        # Only process HTML topic files (not images, scripts, etc.)
        path: str = ui.path.decode("utf-8", errors="replace") if isinstance(ui.path, bytes) else ui.path
        if not path.lower().endswith((".htm", ".html")):
            return chmlib.CHM_ENUMERATOR_CONTINUE
        # Skip internal CHM metadata files
        if path.startswith("/#") or path.startswith("/$"):
            return chmlib.CHM_ENUMERATOR_CONTINUE

        success, raw_bytes = chm_file.RetrieveObject(ui)
        if not success or not raw_bytes:
            return chmlib.CHM_ENUMERATOR_CONTINUE

        try:
            raw_html = raw_bytes.decode(encoding, errors="replace")
        except Exception:
            raw_html = raw_bytes.decode("utf-8", errors="replace")

        text = _strip_html(raw_html)
        if text and len(text) > 20:  # skip near-empty pages (nav frames, etc.)
            page_index += 1
            pages.append({"page": page_index, "text": text, "_path": path})

        return chmlib.CHM_ENUMERATOR_CONTINUE

    chm_file.EnumerateDir("/", chmlib.CHM_ENUMERATE_NORMAL, _visitor, None)
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
) -> dict:
    """Run the full 8-step CHM ingest pipeline."""

    async def report(step: int, label: str, status: str = "running"):
        if progress_callback:
            await progress_callback(step, label, status)

    lib_dir = _lib_dir(library_id)
    source_dir = lib_dir / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
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

    parse_quality = "ok"

    # ── Step 3: Clean text ───────────────────────────────────────────────────
    await report(3, STEP_LABELS[2])
    # Minimal cleaning for CHM (HTML stripping already done in extraction)
    from app.knowledge.pdf_ingest import _clean_pages
    pages = await asyncio.to_thread(_clean_pages, pages)

    # ── Step 4: Chunk ────────────────────────────────────────────────────────
    await report(4, STEP_LABELS[3])
    raw_chunks: list[RawChunk] = await asyncio.to_thread(chunk_pages, pages)

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
        vectors = await embedder.embed(texts)
    except Exception as e:
        raise RuntimeError(f"Embedding failed: {e}") from e

    # ── Step 7: Upsert vector index ──────────────────────────────────────────
    await report(7, STEP_LABELS[6])
    chunk_records = []
    chunk_dicts = []

    def _logical(file_page: int) -> int:
        if file_page < 0:
            return -1
        lp = file_page - page_offset
        return lp if lp > 0 else file_page

    for i, (rc, vec) in enumerate(zip(raw_chunks, vectors)):
        cid = f"chunk_{uuid.uuid4().hex[:16]}"
        chunk_records.append({
            "chunk_id": cid,
            "document_id": document_id,
            "library_id": library_id,
            "content": rc.content,
            "page_from": _logical(rc.page_from),
            "page_to": _logical(rc.page_to),
            "section_title": rc.section_title or "",
            "chunk_type": default_chunk_type,
            "vector": vec,
        })
        chunk_dicts.append({
            "chunk_id": cid,
            "chunk_index": rc.chunk_index,
            "content": rc.content,
            "embedding_ref": cid,
            "page_from": _logical(rc.page_from),
            "page_to": _logical(rc.page_to),
            "section_title": rc.section_title,
            "char_count": rc.char_count,
            "metadata": {
                "has_table": False,
                "has_multi_column": False,
                "parse_quality": parse_quality,
            },
        })

    try:
        await asyncio.to_thread(upsert_chunks, index_dir, chunk_records, len(vectors[0]) if vectors else 1536)
    except Exception as e:
        parse_notes += f" | Vector index write failed: {e}"

    # ── Step 8: Write manifest ───────────────────────────────────────────────
    await report(8, STEP_LABELS[7])
    manifest = {
        "document_id": document_id,
        "library_id": library_id,
        "original_filename": original_filename,
        "source_path": str(dest_path),
        "page_count": page_count,
        "chunk_count": len(raw_chunks),
        "parse_quality": parse_quality,
        "parse_notes": parse_notes.strip(" |"),
        "embedding_snapshot": embedding_snapshot,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = lib_dir / f"manifest_{document_id[:8]}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

    chunks_path = lib_dir / f"chunks_{document_id[:8]}.jsonl"
    chunks_path.write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in chunk_dicts)
    )

    await report(8, "处理完成", "completed")

    return {
        "parse_status": "ok" if not parse_notes else "partial",
        "parse_notes": parse_notes.strip(" |"),
        "page_count": page_count,
        "chunk_count": len(raw_chunks),
        "manifest_path": str(manifest_path),
    }
