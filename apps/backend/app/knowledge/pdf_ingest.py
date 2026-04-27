"""PDF ingest pipeline — 8-step sequential processing.

Steps:
1. Save original file to source/
2. Extract text with pdfplumber (page-by-page)
3. Clean text (remove repeated headers/footers, merge broken lines)
4. Chunk text (heading-aware sliding window)
5. Record page_from / page_to / section_title per chunk
6. Generate embeddings
7. Build lancedb vector index
8. Write manifest.json and chunks.jsonl
"""
from __future__ import annotations
import asyncio
import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber

from app.knowledge.chunker import chunk_pages, RawChunk
from app.knowledge.vector_index import upsert_chunks
from app.utils.paths import get_data_dir

STEP_LABELS = [
    "正在保存原始文件...",       # 1
    "正在提取文本...",           # 2
    "正在清洗文本...",           # 3
    "正在切块...",               # 4
    "正在记录页码映射...",        # 5
    "正在生成向量...",            # 6
    "正在建立向量索引...",        # 7
    "正在写入 manifest...",      # 8
]


def _lib_dir(library_id: str) -> Path:
    d = get_data_dir() / "knowledge" / "libraries" / library_id
    d.mkdir(parents=True, exist_ok=True)
    return d


async def run_ingest(
    *,
    document_id: str,
    library_id: str,
    tmp_file_path: Path,
    original_filename: str,
    embedder: Any,  # object with .embed(texts: list[str]) -> list[list[float]]
    embedding_snapshot: dict,  # {profile_id, provider_type, model_name, dimensions}
    progress_callback=None,  # async callable(step: int, label: str, status: str)
    default_chunk_type: str = "",  # ChunkType value to tag all chunks in this document
) -> dict:
    """
    Run the full 8-step ingest pipeline.
    Returns a result dict with parse_status, page_count, chunk_count, manifest_path.
    Raises on unrecoverable errors.
    """
    lib_dir = _lib_dir(library_id)
    source_dir = lib_dir / "source"
    parsed_dir = lib_dir / "parsed"
    index_dir = lib_dir / "index"
    source_dir.mkdir(exist_ok=True)
    parsed_dir.mkdir(exist_ok=True)
    index_dir.mkdir(exist_ok=True)

    async def report(step: int, label: str, status: str = "running"):
        if progress_callback:
            await progress_callback(step, label, status)

    parse_quality = "good"
    parse_notes = ""

    # ── Step 1: Save original file ───────────────────────────────────────────
    await report(1, STEP_LABELS[0])
    dest_path = source_dir / original_filename
    # Avoid collision
    if dest_path.exists():
        stem = dest_path.stem
        suffix = dest_path.suffix
        dest_path = source_dir / f"{stem}_{document_id[:8]}{suffix}"
    shutil.copy2(str(tmp_file_path), str(dest_path))

    # ── Step 2: Extract text ─────────────────────────────────────────────────
    await report(2, STEP_LABELS[1])
    pages: list[dict] = []
    page_count = 0
    try:
        with pdfplumber.open(str(dest_path)) as pdf:
            page_count = len(pdf.pages)
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                pages.append({"page": i + 1, "text": text})
    except Exception as e:
        raise RuntimeError(f"PDF text extraction failed: {e}") from e

    # Detect scanned PDF: if >80% of pages have no text
    empty_pages = sum(1 for p in pages if not p["text"].strip())
    if page_count > 0 and empty_pages / page_count > 0.8:
        parse_quality = "scanned_fallback"
        parse_notes = f"疑似扫描版 PDF，{empty_pages}/{page_count} 页无可提取文本"

    # ── Step 3: Clean text ───────────────────────────────────────────────────
    await report(3, STEP_LABELS[2])
    pages = _clean_pages(pages)

    # ── Step 4: Chunk ────────────────────────────────────────────────────────
    await report(4, STEP_LABELS[3])
    raw_chunks: list[RawChunk] = chunk_pages(pages)

    if not raw_chunks:
        # Nothing to embed — record partial status
        return {
            "parse_status": "partial" if parse_quality != "scanned_fallback" else "scanned_fallback",
            "page_count": page_count,
            "chunk_count": 0,
            "manifest_path": str(parsed_dir / "manifest.json"),
            "parse_notes": "No text chunks extracted",
        }

    # ── Step 5: Page mapping already done in chunker ─────────────────────────
    await report(5, STEP_LABELS[4])
    # (page_from / page_to / section_title are set by chunk_pages)

    # ── Step 6: Generate embeddings ──────────────────────────────────────────
    await report(6, STEP_LABELS[5])
    texts = [c.content for c in raw_chunks]
    try:
        vectors = await asyncio.to_thread(embedder.embed, texts)
    except Exception as e:
        # Embedding failure: save chunks without vectors
        parse_quality = "partial" if parse_quality == "good" else parse_quality
        parse_notes += f" | Embedding failed: {e}"
        dimensions = embedding_snapshot.get("dimensions") or 1536
        vectors = [[0.0] * dimensions for _ in raw_chunks]

    # ── Step 7: Build vector index ───────────────────────────────────────────
    await report(7, STEP_LABELS[6])
    chunk_records = []
    chunk_dicts = []
    for i, (rc, vec) in enumerate(zip(raw_chunks, vectors)):
        cid = f"chunk_{uuid.uuid4().hex[:16]}"
        chunk_records.append({
            "chunk_id": cid,
            "document_id": document_id,
            "library_id": library_id,
            "content": rc.content,
            "page_from": rc.page_from if parse_quality != "scanned_fallback" else -1,
            "page_to": rc.page_to if parse_quality != "scanned_fallback" else -1,
            "section_title": rc.section_title or "",
            "chunk_type": default_chunk_type,
            "vector": vec,
        })
        chunk_dicts.append({
            "id": cid,
            "document_id": document_id,
            "chunk_index": rc.chunk_index,
            "content": rc.content,
            "embedding_ref": cid,
            "page_from": rc.page_from if parse_quality != "scanned_fallback" else -1,
            "page_to": rc.page_to if parse_quality != "scanned_fallback" else -1,
            "section_title": rc.section_title,
            "char_count": rc.char_count,
            "metadata": {
                "chunk_type": default_chunk_type or None,
                "parse_quality": parse_quality,
                "has_table": False,
                "has_multi_column": False,
            },
        })

    try:
        upsert_chunks(index_dir, chunk_records, dimensions=len(vectors[0]) if vectors else 1536)
    except Exception as e:
        parse_notes += f" | Vector index write failed: {e}"

    # ── Step 8: Write manifest & chunks.jsonl ────────────────────────────────
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
    # Append (multiple documents can share one library)
    manifests = []
    if manifest_path.exists():
        try:
            manifests = json.loads(manifest_path.read_text())
            if not isinstance(manifests, list):
                manifests = [manifests]
        except Exception:
            manifests = []
    manifests.append(manifest)
    manifest_path.write_text(json.dumps(manifests, ensure_ascii=False, indent=2))

    chunks_path = parsed_dir / "chunks.jsonl"
    with chunks_path.open("a", encoding="utf-8") as f:
        for cd in chunk_dicts:
            f.write(json.dumps(cd, ensure_ascii=False) + "\n")

    await report(8, "处理完成", "completed")

    return {
        "parse_status": "success" if parse_quality == "good" else parse_quality,
        "page_count": page_count,
        "chunk_count": len(raw_chunks),
        "manifest_path": str(manifest_path),
        "parse_notes": parse_notes or None,
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _clean_pages(pages: list[dict]) -> list[dict]:
    """Remove repeated header/footer lines and merge broken paragraphs."""
    if not pages:
        return pages

    # Detect repeated lines across pages (likely headers/footers)
    from collections import Counter
    line_counts: Counter = Counter()
    for p in pages:
        lines = p["text"].splitlines()
        for line in lines:
            line = line.strip()
            if line and len(line) < 80:
                line_counts[line] += 1

    threshold = max(2, len(pages) * 0.3)
    noise_lines = {line for line, cnt in line_counts.items() if cnt >= threshold}

    cleaned = []
    for p in pages:
        lines = p["text"].splitlines()
        filtered = [l for l in lines if l.strip() not in noise_lines]
        # Merge broken lines: a line ending mid-sentence + next line starts lowercase
        merged: list[str] = []
        for line in filtered:
            if (
                merged
                and merged[-1]
                and not merged[-1].endswith(("。", ".", "！", "？", "!", "?", "：", ":"))
                and line
                and (line[0].islower() or "\u4e00" <= line[0] <= "\u9fff")
            ):
                merged[-1] = merged[-1].rstrip() + " " + line.strip()
            else:
                merged.append(line)
        cleaned.append({"page": p["page"], "text": "\n".join(merged)})
    return cleaned
