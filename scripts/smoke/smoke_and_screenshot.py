#!/usr/bin/env python3
"""
smoke_and_screenshot.py — M9 A1 smoke test & screenshot script for trpg-workbench.

Usage (servers already running):
    apps/backend/.venv/bin/python scripts/smoke/smoke_and_screenshot.py

Usage (start servers via webapp-testing skill's with_server.py):
    python <webapp-testing-skill-path>/scripts/with_server.py \
      --server "cd apps/backend && .venv/bin/python server.py" --port 7821 \
      --server "cd apps/desktop && pnpm dev" --port 5173 \
      -- apps/backend/.venv/bin/python scripts/smoke/smoke_and_screenshot.py

Options:
    --frontend  Frontend base URL  (default: http://localhost:5173)
    --backend   Backend base URL   (default: http://localhost:7821)
    --out       Output base dir    (default: docs/ui-snapshots)
    --date      Override date slug (default: today in Asia/Shanghai, YYYY-MM-DD)

Outputs (all relative to --out/<date>/):
    screenshots/<slug>.png
    smoke-report.md
And updates:
    docs/ui-snapshots/latest-manifest.json
"""

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--frontend", default="http://localhost:5173")
    p.add_argument("--backend",  default="http://localhost:7821")
    p.add_argument("--out",      default="docs/ui-snapshots")
    p.add_argument("--date",     default=None,
                   help="Date slug YYYY-MM-DD (default: today UTC+8)")
    return p.parse_args()


# ── Page definitions ──────────────────────────────────────────────────────────
# Each entry: (slug, path, priority, assertions)
# assertions: list of (locator_text, description) — checked with page.locator()
# priority P0 = always run; P1 = skip if no workspace found

P0_PAGES = [
    (
        "home",
        "/",
        [
            ("新建工作空间", "new-workspace button or heading"),
        ],
    ),
    (
        "settings-models",
        "/settings/models",
        [
            ("LLM", "LLM tab present"),
            ("Embedding", "Embedding tab present"),
        ],
    ),
    (
        "knowledge",
        "/knowledge",
        [
            ("知识库", "knowledge page heading"),
            ("新建知识库", "new-library button"),
        ],
    ),
]

# P1 pages: require workspace_id at runtime; filled in by discover_workspace()
P1_PAGE_TEMPLATES = [
    (
        "workspace",
        "/workspace/{workspace_id}",
        [
            ("Agent", "agent panel present"),
        ],
    ),
    (
        "workspace-settings",
        "/workspace/{workspace_id}/settings",
        [
            ("模型路由", "model routing section"),
        ],
    ),
]

VIEWPORT = {"width": 1280, "height": 800}
NETWORK_IDLE_TIMEOUT = 15_000   # ms
NAV_TIMEOUT = 20_000            # ms

# ── Helpers ───────────────────────────────────────────────────────────────────

def today_cst() -> str:
    cst = timezone(timedelta(hours=8))
    return datetime.now(cst).strftime("%Y-%m-%d")


def run_at_iso() -> str:
    cst = timezone(timedelta(hours=8))
    return datetime.now(cst).isoformat(timespec="seconds")


def discover_workspace(backend_url: str) -> str | None:
    """Return the first workspace id found, or None."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"{backend_url}/workspaces", timeout=5) as r:
            data = json.loads(r.read())
            if isinstance(data, list) and data:
                return data[0].get("id")
    except Exception:
        pass
    return None


# ── Core runner ───────────────────────────────────────────────────────────────

def smoke_and_screenshot(
    frontend_url: str,
    backend_url: str,
    out_dir: Path,
    run_at: str,
) -> list[dict]:
    """Run smoke test and take screenshots. Returns list of result dicts."""
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    screenshots_dir = out_dir / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    workspace_id = discover_workspace(backend_url)

    # Build full page list
    pages: list[tuple[str, str, list, str]] = []  # slug, url, assertions, priority
    for slug, path, assertions in P0_PAGES:
        pages.append((slug, frontend_url + path, assertions, "P0"))

    for slug, path_tmpl, assertions in P1_PAGE_TEMPLATES:
        if workspace_id:
            url = frontend_url + path_tmpl.format(workspace_id=workspace_id)
            pages.append((slug, url, assertions, "P1"))
        else:
            results.append({
                "slug": slug,
                "status": "skipped",
                "screenshot": None,
                "notes": "No workspace found",
                "errors": [],
            })

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport=VIEWPORT)
            page = context.new_page()

            for slug, url, assertions, priority in pages:
                result = {"slug": slug, "status": "pass", "screenshot": None, "notes": "", "errors": []}
                screenshot_rel = f"screenshots/{slug}.png"
                screenshot_abs = out_dir / screenshot_rel

                try:
                    page.goto(url, timeout=NAV_TIMEOUT)
                    page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_TIMEOUT)
                except PWTimeout:
                    result["status"] = "fail"
                    result["errors"].append("Navigation or networkidle timed out")
                    results.append(result)
                    continue
                except Exception as exc:
                    result["status"] = "fail"
                    result["errors"].append(f"Navigation error: {exc}")
                    results.append(result)
                    continue

                # Screenshot (always, even if assertions fail)
                try:
                    page.screenshot(path=str(screenshot_abs), full_page=True)
                    result["screenshot"] = screenshot_rel
                except Exception as exc:
                    result["errors"].append(f"Screenshot failed: {exc}")

                # Assertions (non-fatal)
                for locator_text, description in assertions:
                    try:
                        count = page.locator(f"text={locator_text}").count()
                        if count == 0:
                            result["status"] = "fail"
                            result["errors"].append(f"Assertion failed: '{locator_text}' ({description}) not found")
                    except Exception as exc:
                        result["status"] = "fail"
                        result["errors"].append(f"Assertion error for '{locator_text}': {exc}")

                results.append(result)

            # settings-models: also verify tab switching renders content
            settings_result = next((r for r in results if r["slug"] == "settings-models"), None)
            if settings_result and settings_result["status"] != "fail":
                try:
                    page.goto(frontend_url + "/settings/models", timeout=NAV_TIMEOUT)
                    page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_TIMEOUT)
                    # Click through available model tabs and confirm no crash
                    for tab_text in ["Embedding", "Rerank", "LLM"]:
                        tabs = page.locator(f"text={tab_text}").all()
                        if tabs:
                            try:
                                tabs[0].click()
                                page.wait_for_timeout(600)
                                tab_slug = f"settings-{tab_text.lower()}"
                                page.screenshot(
                                    path=str(out_dir / "screenshots" / f"{tab_slug}.png"),
                                    full_page=True,
                                )
                            except Exception as exc:
                                settings_result["errors"].append(f"Tab '{tab_text}' click/render error: {exc}")
                                settings_result["status"] = "fail"
                except Exception as exc:
                    settings_result["errors"].append(f"Tab-switching check error: {exc}")

        finally:
            browser.close()

    return results


# ── Report writers ────────────────────────────────────────────────────────────

STATUS_ICON = {"pass": "✅ pass", "fail": "❌ fail", "skipped": "⏭ skipped"}


def write_smoke_report(results: list[dict], out_dir: Path, frontend_url: str,
                       backend_url: str, run_at: str):
    lines = [
        f"# Smoke Test Report — {run_at[:10]}",
        "",
        f"**Frontend:** {frontend_url}",
        f"**Backend:** {backend_url}",
        f"**Run at:** {run_at}",
        "",
        "## Results",
        "",
        "| Page | Status | Screenshot | Notes |",
        "|------|--------|------------|-------|",
    ]
    failures = []
    for r in results:
        icon = STATUS_ICON.get(r["status"], r["status"])
        shot = r["screenshot"] or "—"
        notes = r["notes"] or ""
        if r["errors"]:
            notes = (notes + " " + "; ".join(r["errors"])).strip()
        lines.append(f"| {r['slug']} | {icon} | {shot} | {notes} |")
        if r["status"] == "fail":
            failures.append(r)

    lines += ["", "## Failures", ""]
    if failures:
        for r in failures:
            lines.append(f"### {r['slug']}")
            for e in r["errors"]:
                lines.append(f"- {e}")
    else:
        lines.append("_None_")

    (out_dir / "smoke-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_latest_manifest(snapshots_root: Path, date_slug: str, run_at: str):
    manifest = {
        "date": date_slug,
        "dir": str(snapshots_root / date_slug),
        "run_at": run_at,
    }
    (snapshots_root / "latest-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    date_slug = args.date or today_cst()
    run_at = run_at_iso()

    snapshots_root = Path(args.out)
    out_dir = snapshots_root / date_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "help").mkdir(exist_ok=True)

    print(f"[smoke] date={date_slug}  frontend={args.frontend}  backend={args.backend}")
    print(f"[smoke] output → {out_dir}")

    try:
        results = smoke_and_screenshot(args.frontend, args.backend, out_dir, run_at)
    except Exception:
        print("[smoke] FATAL: smoke runner crashed", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    write_smoke_report(results, out_dir, args.frontend, args.backend, run_at)
    write_latest_manifest(snapshots_root, date_slug, run_at)

    # Summary
    counts = {"pass": 0, "fail": 0, "skipped": 0}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"[smoke] done — pass={counts['pass']}  fail={counts['fail']}  skipped={counts['skipped']}")
    print(f"[smoke] report → {out_dir / 'smoke-report.md'}")

    if counts["fail"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
