"""Export service — generate HTML for module handbook PDF export.

Flow:
  1. validate_export() — scan all assets, return draft list + broken slug refs
  2. build_export_html() — render full HTML with print CSS

The backend generates a self-contained HTML string only; no Chromium or
WeasyPrint dependency.  The frontend loads it in a hidden <iframe> and calls
iframe.contentWindow.print() so the user can save to PDF via the system dialog.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

import frontmatter  # python-frontmatter

from app.services.workspace_service import read_config


# ─── Types ───────────────────────────────────────────────────────────────────

class ExportValidateResult:
    def __init__(
        self,
        draft_assets: list[dict],
        broken_refs: list[dict],
    ) -> None:
        self.draft_assets = draft_assets   # [{slug, name, type}]
        self.broken_refs = broken_refs     # [{source_slug, ref_slug}]

    def to_dict(self) -> dict:
        return {
            "draft_assets": self.draft_assets,
            "broken_refs": self.broken_refs,
        }


# ─── Chapter order ────────────────────────────────────────────────────────────

CHAPTER_TYPES: list[tuple[str, str]] = [
    ("outline", "大纲"),
    ("stage",   "场景"),
    ("npc",     "NPC"),
    ("monster", "怪物"),
    ("map",     "地图"),
    ("clue",    "线索"),
]

KNOWN_TYPES = {t for t, _ in CHAPTER_TYPES}

# Regex for act-number extraction (mirrors frontend extractActNumber)
_ACT_RE = re.compile(r"第\s*([一二三四五六七八九十百\d]+)\s*幕")
_CN_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
           "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _act_number(name: str) -> int:
    m = _ACT_RE.search(name)
    if not m:
        return 9999
    raw = m.group(1)
    if raw.isdigit():
        return int(raw)
    val = 0
    for ch in raw:
        val = val * 10 + _CN_MAP.get(ch, 0)
    return val or 9999


# ─── Asset loading ────────────────────────────────────────────────────────────

def _load_assets(workspace_path: str | Path) -> list[dict]:
    """Walk workspace assets/ dir, parse frontmatter + body for each .md file."""
    root = Path(workspace_path)
    assets_dir = root / "assets"
    if not assets_dir.exists():
        return []
    results: list[dict] = []
    for md_file in sorted(assets_dir.rglob("*.md")):
        try:
            post = frontmatter.load(str(md_file))
        except Exception:
            continue
        meta: dict[str, Any] = dict(post.metadata)
        meta["_body"] = post.content
        meta["_file"] = str(md_file.relative_to(root))
        results.append(meta)
    return results


def _collect_slug_refs(meta: dict) -> list[str]:
    """Extract slug references from known frontmatter list fields."""
    refs: list[str] = []
    for field in ("key_npcs", "key_locations", "clues_available", "accessible_in_stages"):
        val = meta.get(field)
        if isinstance(val, list):
            refs.extend(str(v) for v in val if v)
    for rel in (meta.get("relationships") or []):
        if isinstance(rel, dict) and rel.get("target"):
            refs.append(str(rel["target"]))
    # Also scan [[wikilinks]] in body
    body = meta.get("_body", "") or ""
    for m in re.finditer(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", body):
        refs.append(m.group(1).strip())
    return refs


# ─── Validate ─────────────────────────────────────────────────────────────────

def validate_export(workspace_path: str | Path) -> ExportValidateResult:
    assets = _load_assets(workspace_path)
    all_slugs = {a.get("slug") for a in assets if a.get("slug")}

    draft_assets: list[dict] = []
    broken_refs: list[dict] = []

    for asset in assets:
        slug = asset.get("slug", "")
        name = asset.get("name", slug)
        atype = asset.get("type", "")
        if asset.get("status") == "draft":
            draft_assets.append({"slug": slug, "name": name, "type": atype})
        for ref in _collect_slug_refs(asset):
            if ref and ref not in all_slugs:
                broken_refs.append({"source_slug": slug, "ref_slug": ref})

    return ExportValidateResult(draft_assets=draft_assets, broken_refs=broken_refs)


# ─── HTML builder ─────────────────────────────────────────────────────────────

_PRINT_CSS = """
* { box-sizing: border-box; }
body {
  font-family: "Noto Serif SC", "Source Han Serif SC", "STSong", serif;
  font-size: 11pt;
  color: #1a1a1a;
  line-height: 1.7;
  margin: 0;
}
@page { size: A4; margin: 2cm; }
.page-break { page-break-before: always; }
h1 { font-size: 22pt; margin-bottom: 0.3em; }
h2 { font-size: 16pt; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 1.5em; }
h3 { font-size: 13pt; margin-top: 1.2em; margin-bottom: 0.3em; }
p { margin: 0.4em 0; }
.cover { text-align: center; padding-top: 30%; }
.cover h1 { font-size: 28pt; }
.cover .meta { color: #555; margin-top: 1em; font-size: 12pt; }
.toc ol { line-height: 2; padding-left: 1.5em; }
.asset-block { margin-bottom: 1.8em; }
.asset-block .label { font-size: 9pt; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
.asset-block h3 { margin-top: 0.2em; }
.meta-table { border-collapse: collapse; width: 100%; margin-bottom: 0.8em; font-size: 10pt; }
.meta-table td { padding: 2px 8px 2px 0; vertical-align: top; }
.meta-table td:first-child { color: #666; width: 8em; }
.draft-badge { display: inline-block; font-size: 8pt; background: #ffd; border: 1px solid #bb0; padding: 1px 5px; border-radius: 3px; margin-left: 6px; vertical-align: middle; }
"""

def _e(s: Any) -> str:
    return html.escape(str(s)) if s else ""


def _render_body(md_body: str) -> str:
    """Very lightweight Markdown → HTML: headings, bold, italic, lists, paragraphs."""
    lines = (md_body or "").splitlines()
    out: list[str] = []
    in_ul = False
    in_ol = False

    def close_lists():
        nonlocal in_ul, in_ol
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_ol:
            out.append("</ol>")
            in_ol = False

    def inline(text: str) -> str:
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        text = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]",
                      lambda m: f"<em>{_e(m.group(2) or m.group(1))}</em>", text)
        return text

    for line in lines:
        if line.startswith("### "):
            close_lists(); out.append(f"<h4>{inline(_e(line[4:]))}</h4>")
        elif line.startswith("## "):
            close_lists(); out.append(f"<h5>{inline(_e(line[3:]))}</h5>")
        elif line.startswith("# "):
            close_lists(); out.append(f"<h6>{inline(_e(line[2:]))}</h6>")
        elif re.match(r"^[-*] ", line):
            if not in_ul:
                close_lists(); out.append("<ul>"); in_ul = True
            out.append(f"<li>{inline(_e(line[2:]))}</li>")
        elif re.match(r"^\d+\. ", line):
            if not in_ol:
                close_lists(); out.append("<ol>"); in_ol = True
            out.append(f"<li>{inline(_e(re.sub(r'^\d+\.\s*', '', line)))}</li>")
        elif line.strip() == "":
            close_lists()
        else:
            close_lists(); out.append(f"<p>{inline(_e(line))}</p>")
    close_lists()
    return "\n".join(out)


def _asset_html(asset: dict) -> str:
    slug = asset.get("slug", "")
    name = asset.get("name", slug)
    status = asset.get("status", "")
    body = asset.get("_body", "")
    atype = asset.get("type", "")

    badge = '<span class="draft-badge">草稿</span>' if status == "draft" else ""
    rows: list[str] = []

    # Type-specific metadata rows
    if atype == "npc":
        for label, key in [("身份", "identity"), ("阵营", "faction"), ("动机", "motivation")]:
            val = asset.get(key)
            if val:
                rows.append(f"<tr><td>{_e(label)}</td><td>{_e(val)}</td></tr>")
    elif atype == "monster":
        for label, key in [("威胁等级", "threat_level"), ("栖息地", "habitat")]:
            val = asset.get(key)
            if val:
                rows.append(f"<tr><td>{_e(label)}</td><td>{_e(val)}</td></tr>")
    elif atype == "stage":
        for label, key in [("摘要", "summary")]:
            val = asset.get(key)
            if val:
                rows.append(f"<tr><td>{_e(label)}</td><td>{_e(val)}</td></tr>")
    elif atype == "clue":
        for label, key in [("线索类型", "clue_type"), ("发现条件", "discovery_condition")]:
            val = asset.get(key)
            if val:
                rows.append(f"<tr><td>{_e(label)}</td><td>{_e(val)}</td></tr>")

    meta_html = (
        f'<table class="meta-table"><tbody>{"".join(rows)}</tbody></table>'
        if rows else ""
    )

    return (
        f'<div class="asset-block" id="asset-{_e(slug)}">'
        f'<div class="label">{_e(atype)}</div>'
        f'<h3>{_e(name)}{badge}</h3>'
        f'{meta_html}'
        f'{_render_body(body)}'
        f'</div>'
    )


def build_export_html(workspace_path: str | Path) -> str:
    workspace_path = Path(workspace_path)
    config = read_config(workspace_path)
    title = _e(config.get("name", "模组手册"))
    author = _e(config.get("author", ""))
    rule_set = _e(config.get("rule_set", ""))
    from datetime import date
    today = date.today().strftime("%Y-%m-%d")

    assets = _load_assets(workspace_path)
    by_type: dict[str, list[dict]] = {}
    for a in assets:
        t = a.get("type", "other")
        by_type.setdefault(t, []).append(a)

    # Sort stages by act number
    if "stage" in by_type:
        by_type["stage"].sort(key=lambda a: _act_number(a.get("name", "")))

    # Build TOC entries
    toc_items: list[str] = []
    chapter_sections: list[str] = []
    chapter_idx = 1

    for atype, ch_title in CHAPTER_TYPES:
        group = by_type.get(atype, [])
        if not group:
            continue
        toc_items.append(f'<li>第{chapter_idx}章 {_e(ch_title)}</li>')
        items_html = "".join(_asset_html(a) for a in group)
        chapter_sections.append(
            f'<div class="page-break"></div>'
            f'<h2>第{chapter_idx}章 {_e(ch_title)}</h2>'
            f'{items_html}'
        )
        chapter_idx += 1

    # Appendix: custom types
    appendix_items: list[str] = []
    for atype, group in by_type.items():
        if atype not in KNOWN_TYPES:
            appendix_items.append(
                f'<h3>{_e(atype)}</h3>'
                + "".join(_asset_html(a) for a in group)
            )
    if appendix_items:
        toc_items.append(f'<li>附录 自定义资产</li>')
        chapter_sections.append(
            f'<div class="page-break"></div>'
            f'<h2>附录 自定义资产</h2>'
            + "".join(appendix_items)
        )

    toc_html = f'<div class="toc page-break"><h2>目录</h2><ol>{"".join(toc_items)}</ol></div>'
    body_html = "".join(chapter_sections)

    cover = (
        f'<div class="cover">'
        f'<h1>{title}</h1>'
        f'<div class="meta">'
        f'{"作者：" + author + "<br>" if author else ""}'
        f'{"规则体系：" + rule_set + "<br>" if rule_set else ""}'
        f'{today}'
        f'</div>'
        f'</div>'
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>{_PRINT_CSS}</style>
</head>
<body>
{cover}
{toc_html}
{body_html}
</body>
</html>"""
