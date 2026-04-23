---
name: tauri-ui-smoke-and-docs
description: 对 trpg-workbench 桌面应用进行 UI smoke test、截图记录和帮助文档草稿生成。当需要验证前端页面关键元素是否正常渲染、生成应用截图、或基于 DOM 状态生成 Help 文档时必须加载本 skill。包括：运行 /ui-smoke 命令、执行构建验证、核查关键页面 DOM 状态、为新功能补充帮助文档内容。注意：本 skill 针对 trpg-workbench 项目特定页面结构，通用 Playwright 测试请使用 webapp-testing skill。
---

# Skill: tauri-ui-smoke-and-docs

## Purpose

This skill chains three tasks that belong together:

1. **Smoke test** — navigate to each key page, assert that critical elements
   are present based on DOM state, page text, and console logs; record
   pass/fail per page.
2. **Screenshot capture** — save raw full-page PNGs as a visual record for
   human review (and optionally for visual analysis if vision is available).
3. **Help doc draft generation** — produce Markdown documents grounded in
   the actual DOM state and page text extracted during the smoke run.

### Scope and boundaries

- Covers the key user-facing pages and the critical paths through them.
- Does **not** attempt complete E2E regression or interaction testing.
- Does **not** replace unit tests or backend API tests.
- Is intended for build verification and help-doc generation, not as a gate
  that blocks feature development.

---

## Running Modes

This skill operates in one of three modes. The mode is selected by the
invoking command (see `/ui-smoke` and `/ui-review`) or by explicit
instruction from the user.

### `dom_only`

- Run DOM assertions and page-text extraction only.
- No screenshots taken.
- Use when screenshots are not needed (e.g., quick CI check).

### `dom_plus_screenshot` *(default)*

- Run DOM assertions + extract page text.
- Take full-page screenshots for each page.
- Screenshots are **for human review only** — the agent does NOT interpret
  screenshot pixels in this mode.
- All assertions and doc generation are based on DOM data only.

### `vision_review`

- Run DOM assertions + extract page text + take screenshots.
- Additionally, pass screenshots to a vision-capable model to produce a
  richer qualitative UI review and more detailed help-doc content.
- **Only use this mode when:**
  1. The user explicitly requests it (e.g., via `/ui-review`), AND
  2. The execution environment supports vision (multimodal model is active).
- **Degradation rule:** If `vision_review` is requested but the environment
  does not support vision, automatically fall back to `dom_plus_screenshot`.
  Record a `⚠ warning` in the smoke report:
  ```
  Warning: vision_review requested but vision is not available in this
  environment. Falling back to dom_plus_screenshot. Screenshots are saved
  for manual inspection.
  ```

### Mode selection summary

| Invocation | Mode used |
|---|---|
| `/ui-smoke` command | `dom_plus_screenshot` (fixed) |
| `/ui-review` command | `vision_review` → degrades to `dom_plus_screenshot` if no vision |
| User says "run smoke test" | `dom_plus_screenshot` (default) |
| User says "review screenshots" or "analyze UI visually" | `vision_review` |
| User says "just check DOM, no screenshots" | `dom_only` |

### DOM data is always the primary source

Regardless of mode, DOM-extracted content is always the authoritative basis
for assertions and help-doc generation. Vision output (when available) is
an **enhancement** on top of DOM data, not a replacement.

---

## Smoke Fail Conditions

A page MUST be recorded as `❌ fail` if any of the following are true:

- Navigation times out or returns a non-2xx status
- `wait_for_load_state("networkidle")` times out
- A Vite error overlay is detected (selector `vite-error-overlay` or
  `[data-vite-dev-server-error]` is present in DOM)
- A compiler error page is detected (page title contains "Error" and the
  body contains stack trace text)
- The page is blank: `document.body.innerText.trim()` is empty after load
- A required DOM assertion fails

A Vite overlay or blank page is **not** the same as a skipped page.
Record it as `fail` and note the error message extracted from the DOM.

Assertion failures are otherwise **non-fatal**: record the failure with its
error message, take the screenshot anyway, and continue to the next page.

---

## Prerequisites

**First priority: verify the frontend dev server compiles and loads.**

Before running any smoke assertions, confirm:

1. The frontend dev server starts without compilation errors. If it fails to
   start, record ALL pages as `❌ fail (build error)` and stop.
2. The home page loads without a Vite overlay. If an overlay is present,
   extract its error message, record as fail, and stop.
3. Only proceed with per-page assertions once the base page is clean.

Other prerequisites:

- Frontend dev server is reachable — default `http://localhost:5173`, but
  verify the actual port from `apps/desktop/package.json` or the running
  process. The Tauri dev server may use a different port (e.g., `1420`).
- Backend is running — default `http://localhost:7821`. Many pages make live
  API calls on mount; missing backend = blank/error state. Note in report
  whether backend was available.
- A Playwright runtime is available. This project uses the `webapp-testing`
  skill as the underlying testing toolkit. Check which runtime (`playwright`
  Python package or `@playwright/test` Node package) is actually installed
  before writing any script. Prefer whichever is already present.

### Starting servers if they are not already running

Use the `webapp-testing` skill's `with_server.py` helper:

```bash
python <path-to-webapp-testing-skill>/scripts/with_server.py \
  --server "cd apps/backend && .venv/bin/python server.py" --port 7821 \
  --server "cd apps/desktop && pnpm dev" --port 5173 \
  -- python <your-smoke-script.py>
```

If servers are already running, run the smoke script directly.

---

## Key Pages

Confirm routes against `apps/desktop/src/App.tsx` before running.

| Slug | Recommended route | Minimum DOM assertions |
|------|------------------|------------------------|
| `home` | `/` | Body is not blank; no Vite overlay |
| `settings-models` | `/settings/models` | Tab bar element present in DOM |
| `knowledge` | `/knowledge` | Page body is not blank; no Vite overlay |
| `workspace` | `/workspace/:id` | Requires existing workspace; skip if none |
| `workspace-settings` | `/workspace/:id/settings` | Requires existing workspace; skip if none |

Workspace pages require an existing workspace. If none exists, mark them
as `skipped` (not `fail`).

---

## Output Layout

All outputs go into `docs/ui-snapshots/<YYYY-MM-DD>/`. Use UTC+8 date.

```
docs/ui-snapshots/
├── latest-manifest.json
└── 2026-04-22/
    ├── screenshots/          # present in dom_plus_screenshot and vision_review
    │   ├── home.png
    │   ├── settings-models.png
    │   ├── knowledge.png
    │   ├── workspace.png           # only if workspace exists
    │   └── workspace-settings.png # only if workspace exists
    ├── smoke-report.md
    └── help/
        ├── getting-started.md
        ├── model-setup.md
        ├── knowledge-import.md
        └── start-creating.md
```

`latest-manifest.json` format:

```json
{
  "date": "2026-04-22",
  "dir": "docs/ui-snapshots/2026-04-22",
  "run_at": "2026-04-22T10:39:00+08:00"
}
```

---

## Smoke Test Implementation

For each page: navigate → `wait_for_load_state("networkidle")` → check for
Vite overlay → check for blank page → assert DOM elements → screenshot
(if mode ≠ `dom_only`).

```python
# Check for Vite compilation error overlay
vite_error = page.locator("vite-error-overlay")
if vite_error.count() > 0:
    error_text = vite_error.inner_text()
    record_fail(slug, f"Vite error overlay: {error_text[:200]}")
    if mode != "dom_only":
        page.screenshot(path=..., full_page=True)
    continue

# Check for blank page
body_text = page.locator("body").inner_text().strip()
if not body_text:
    record_fail(slug, "Page body is blank after networkidle")
    if mode != "dom_only":
        page.screenshot(path=..., full_page=True)
    continue

# DOM assertions (non-fatal)
try:
    assert page.locator("[data-tab-bar]").count() > 0
except AssertionError as e:
    record_warning(slug, str(e))

# Screenshot (dom_plus_screenshot and vision_review)
if mode != "dom_only":
    page.screenshot(path=..., full_page=True)
```

The existing project script `scripts/smoke/smoke_and_screenshot.py` accepts
a `--mode` parameter for this purpose. See script `--help` for usage.

---

## Screenshot Conventions

- Capture: `page.screenshot(path=..., full_page=True)`
- Viewport: 1280 × 800 (confirm against `apps/desktop/src-tauri/tauri.conf.json`)
- Raw output only — do not crop, annotate, or draw overlays programmatically
- One PNG per page slug; overwrite if re-running on the same date
- Take screenshots even for failed pages — they help human reviewers diagnose
- In `dom_plus_screenshot` mode: screenshots are for human review only
- In `vision_review` mode: screenshots may additionally be passed to vision model

---

## Smoke Report Format

```markdown
# Smoke Test Report — 2026-04-22

**Frontend:** http://localhost:1420
**Backend:** http://localhost:7821
**Mode:** dom_plus_screenshot
**Run at:** 2026-04-22T10:39:00+08:00

## Results

| Page | Status | Screenshot | Notes |
|------|--------|------------|-------|
| home | ✅ pass | screenshots/home.png | |
| settings-models | ✅ pass | screenshots/settings-models.png | |
| knowledge | ✅ pass | screenshots/knowledge.png | |
| workspace | ⏭ skipped | — | No workspace found |
| workspace-settings | ⏭ skipped | — | No workspace found |

## Failures

_None_

## Warnings

_None_
```

Status values: `✅ pass`, `❌ fail`, `⏭ skipped`.

For fail entries, always include the extracted error message or DOM text.
For mode-degradation, include a `## Warnings` section with the downgrade note.

---

## Help Doc Generation (Optional Reference Only)

> **Important:** The source of truth for Help documentation is
> `apps/desktop/src/help/`. These files are **human-authored and
> human-maintained**. The DOM-extracted drafts below are **optional
> reference material only** — they can help identify UI element names
> and page structure, but should never be copied directly into
> `apps/desktop/src/help/` without significant human editing.
>
> See M14 (Help 文档重建) for the rationale behind this policy.

After the smoke run, you **may optionally** write help doc drafts into
`docs/ui-snapshots/<date>/help/`. Base the content on:

- Page titles and headings extracted from the DOM
- Button labels and tab names via `page.inner_text()` or
  `page.locator(...).all_inner_texts()`
- Navigation structure observed from DOM
- Any text content captured during assertions
- In `vision_review` mode: additionally incorporate qualitative notes from
  visual model output, but always reconcile against DOM-extracted text

**These drafts are NOT synced to `apps/desktop/src/help/`.**
The previous two-stage sync rule is retired. If a smoke run reveals
that `apps/desktop/src/help/` content is outdated (e.g., new buttons
or pages not mentioned in the docs), flag this in the smoke report
rather than auto-generating replacement docs.

Write in plain Chinese (中文). Under 600 words per document.

If a page was `skipped` or `fail`, the corresponding doc section must note
this explicitly rather than fabricating content.

### Four documents (optional drafts)

- **`getting-started.md`** — first-launch experience, create workspace, navigate to settings
- **`model-setup.md`** — settings page, tabs (enumerated from DOM), profile types
- **`knowledge-import.md`** — create library, upload PDF, ingest, chunks, search
- **`start-creating.md`** — three-panel layout, Agent panel, submit prompt, review result

---

## Script Parameters (for `scripts/smoke/smoke_and_screenshot.py`)

The project smoke script supports these parameters at the script layer.
They are not native skill config — they control script behavior when invoked:

| Parameter | Default | Description |
|---|---|---|
| `--frontend` | `http://localhost:5173` | Frontend base URL |
| `--backend` | `http://localhost:7821` | Backend base URL |
| `--out` | `docs/ui-snapshots` | Output base directory |
| `--date` | today (UTC+8) | Override date slug |
| `--mode` | `dom_plus_screenshot` | `dom_only` / `dom_plus_screenshot` / `vision_review` |
| `--generate-help-drafts` | off | Generate help doc drafts after smoke |
| `--sync-help` | off | Copy drafts to `apps/desktop/src/help/` (requires explicit flag) |

Run `apps/backend/.venv/bin/python scripts/smoke/smoke_and_screenshot.py --help`
to see the current parameter list; the table above reflects intended design,
not guaranteed implementation state.

---

## In-App Help Page

The in-app help page (`/help/:doc`) is already implemented and
human-maintained at `apps/desktop/src/help/`. This skill does NOT
manage help page content — it only produces optional reference drafts
in `docs/ui-snapshots/<date>/help/`.

**Tauri native Help menu is intentionally not implemented** — it was
found to be unhelpful and would not be portable to a future web version.
Help is accessed via the in-app HelpButton on each page header.

---

## When to Run This Skill

- After any milestone that changes key UI pages
- When preparing onboarding material or a demo
- When the user asks to verify current UI state
- When updating in-app help content after UI changes

**Standard run order:**
1. Verify frontend compiles and loads (fix build errors first)
2. Determine mode (default: `dom_plus_screenshot`)
3. Run smoke test; extract DOM text; generate screenshots if mode requires
4. Generate help doc drafts from DOM-observed content
5. Present smoke report; await explicit approval before syncing docs

Base directory for this skill: file:///Users/tshi/Sandbox/trpg-workbench/.agents/skills/tauri-ui-smoke-and-docs
