---
name: tauri-ui-smoke-and-docs
description: >
  Smoke-tests the trpg-workbench frontend against a local dev server, captures
  annotated screenshots of every key page, and generates or updates the
  in-app Help / Getting Started documentation from real UI state.
  Use this skill whenever the user asks to: run a UI smoke test, take page
  screenshots, verify that key pages render correctly, generate or refresh
  help docs, update Getting Started content, prepare Tauri Help-menu content,
  or "document the current UI". Also use it proactively after large UI changes
  to a milestone to verify nothing is visually broken.
---

# Skill: tauri-ui-smoke-and-docs

## Purpose

This skill automates three tightly coupled tasks:

1. **Smoke test** — visit every key page, assert that critical elements are
   present, record pass/fail per page.
2. **Screenshot capture** — save full-page PNG screenshots with timestamped
   filenames for visual reference and future diffing.
3. **Help doc generation** — produce Markdown help documents grounded in the
   actual screenshots rather than guessed copy.

Running all three together keeps the docs honest: they describe what users
actually see, not what the code is supposed to show.

---

## Prerequisites

- Frontend dev server must be reachable (default `http://localhost:5173`).
- Backend must be running (default `http://localhost:7821`), because many
  pages make live API calls on mount.
- Playwright Python must be installed in the project venv or globally.
- Use the `webapp-testing` skill's `scripts/with_server.py` to orchestrate
  server startup if either server is not already up.

### Quick start (servers not running)

```bash
python .agents/skills/webapp-testing/scripts/with_server.py \
  --server "cd apps/backend && .venv/bin/python server.py" --port 7821 \
  --server "cd apps/desktop && pnpm dev" --port 5173 \
  -- python .agents/skills/tauri-ui-smoke-and-docs/scripts/smoke_and_screenshot.py
```

### Quick start (servers already running)

```bash
python .agents/skills/tauri-ui-smoke-and-docs/scripts/smoke_and_screenshot.py
```

---

## Key Pages

Test and screenshot these routes **in order**. Each entry lists:
- the URL path
- a canonical slug used for filenames
- the minimum DOM assertions that must pass for the page to be considered
  "smoke-green"

| Page | Route | Slug | Required elements |
|------|-------|------|-------------------|
| Home | `/` | `home` | workspace list or "新建工作空间" button |
| Settings — Models | `/settings/models` | `settings-models` | "LLM 语言模型" tab, "Embedding 向量模型" tab |
| Settings — Rerank | `/settings/models` → Rerank tab | `settings-rerank` | "Rerank 重排序" tab heading |
| Knowledge | `/knowledge` | `knowledge` | "知识库管理" heading, "新建知识库" button |
| Workspace (if one exists) | `/workspace/:id` | `workspace` | three-column layout, Agent panel |
| Workspace Settings | `/workspace/:id/settings` | `workspace-settings` | "模型路由" section, "Rerank 重排序" section |

The Workspace and Workspace Settings pages require at least one workspace to
exist. If none exists, mark those pages as "skipped" (not failed) in the
summary and note this in the generated docs.

---

## Output Layout

All outputs go into `docs/ui-snapshots/<YYYY-MM-DD>/`.

```
docs/ui-snapshots/2026-04-22/
├── screenshots/
│   ├── home.png
│   ├── settings-models.png
│   ├── settings-rerank.png
│   ├── knowledge.png
│   ├── workspace.png            # only if workspace exists
│   └── workspace-settings.png  # only if workspace exists
├── smoke-report.md              # pass/fail table + error details
└── help/
    ├── getting-started.md
    ├── model-setup.md
    ├── knowledge-import.md
    └── start-creating.md
```

The `docs/ui-snapshots/latest/` symlink (or copy on Windows) always points
to the most recent run.

---

## Smoke Test Assertions

For each page, navigate → wait for `networkidle` → assert.

**Assert pattern (Python Playwright):**
```python
page.goto("http://localhost:5173/knowledge")
page.wait_for_load_state("networkidle")
assert page.locator("text=知识库管理").count() > 0, "knowledge heading missing"
assert page.locator("text=新建知识库").count() > 0, "new library button missing"
```

Assertion failures are **non-fatal**: record the failure with the error
message, take a screenshot anyway, and continue to the next page. A page is
"red" only if navigation or networkidle times out entirely.

---

## Screenshot Conventions

- Full-page capture: `page.screenshot(path=..., full_page=True)`
- Resolution: use the default viewport (1280 × 800 to match Tauri's window
  config in `tauri.conf.json`)
- Do **not** crop or annotate programmatically — the raw full-page PNG is the
  source of truth
- After capture, embed the screenshot path in the smoke report for traceability

---

## Smoke Report Format

`smoke-report.md` must use this exact structure so future runs can be
machine-compared:

```markdown
# Smoke Test Report — 2026-04-22

**Frontend:** http://localhost:5173
**Backend:** http://localhost:7821
**Run at:** 2026-04-22T10:39:00+08:00

## Results

| Page | Status | Screenshot | Notes |
|------|--------|------------|-------|
| home | ✅ pass | screenshots/home.png | |
| settings-models | ✅ pass | screenshots/settings-models.png | |
| settings-rerank | ✅ pass | screenshots/settings-rerank.png | |
| knowledge | ✅ pass | screenshots/knowledge.png | |
| workspace | ⏭ skipped | — | No workspace found |
| workspace-settings | ⏭ skipped | — | No workspace found |

## Failures

_None_
```

---

## Help Doc Generation

After all screenshots are taken, generate the four Markdown help documents
**by examining the screenshots and the real DOM state** — not by reciting
what the code is supposed to do.

The goal is documentation a non-technical user can follow on first launch.
Write in plain Chinese (中文), matching the UI language. Keep each doc under
600 words.

### `getting-started.md`

Cover the first-launch flow end to end:
1. App starts, backend initialises
2. User lands on Home — what they see
3. Create first workspace — where the button is
4. Where to go next (link to model-setup)

### `model-setup.md`

Cover `/settings/models`:
1. The three (now four) tabs: LLM / Embedding / 模型发现 / Rerank
2. How to add an LLM profile (step by step from the screenshot)
3. How to add an Embedding profile
4. Optional: how to add a Rerank profile and why you'd want one

### `knowledge-import.md`

Cover `/knowledge`:
1. Create a library (type choices and when to use each)
2. Upload a PDF (drag-drop or click)
3. Wait for ingest — progress bar
4. Expand a document row to see manifest summary and quality warnings
5. Preview chunks / page text
6. Run a search test

### `start-creating.md`

Cover `/workspace/:id` (the main workbench):
1. Three-panel layout overview
2. The Agent panel: how to type a prompt
3. What "规则审查 / rules_review" does
4. How to open an asset in the middle editor
5. Where results go / how to approve patches

---

## Tauri Help Menu — Minimal Implementation Plan

This section documents the **recommended approach** for wiring the generated
docs into the Tauri application. Implement only when the user explicitly asks.

### A. Where to store source documents

```
apps/desktop/src/help/
├── getting-started.md
├── model-setup.md
├── knowledge-import.md
└── start-creating.md
```

These files are the canonical source. The smoke-and-docs skill writes its
output here (overwriting the previous draft) so the docs always reflect the
latest real UI. They are bundled into the Tauri binary via the `bundle.resources`
field in `tauri.conf.json`:

```json
"bundle": {
  "resources": ["src/help/**/*"]
}
```

At runtime the frontend reads them from `convertFileSrc(await
resolveResource("help/getting-started.md"))`.

### B. Tauri menu integration

Add a native "Help" menu item in `tauri.conf.json` → `app.windows[0].menu`
(or via Rust in `lib.rs` using `tauri::menu::MenuBuilder`). Two approaches:

**Option 1 — simple: emit a Tauri event**

In `lib.rs`:
```rust
.menu(tauri::menu::MenuBuilder::new(app)
    .item(&MenuItem::with_id(app, "help_getting_started",
          "Getting Started", true, None::<&str>)?)
    .build()?)
.on_menu_event(|app, event| {
    if event.id() == "help_getting_started" {
        app.emit("open_help", "getting-started").unwrap();
    }
})
```

In the frontend (`App.tsx`), listen:
```typescript
import { listen } from "@tauri-apps/api/event";
listen("open_help", (e) => navigateToHelp(e.payload as string));
```

**Option 2 — open a second webview window**

Simpler for a read-only help viewer; avoids polluting main app state.
Register a second window in `tauri.conf.json` with `url: "help.html"` and
create `help.html` as a standalone Markdown renderer using
[marked](https://github.com/markedjs/marked).

Recommendation: **Option 1** (emit event) is the better fit because:
- The app is already a SPA with React Router — adding a route is trivial
- A second window has a separate loading cycle and doesn't share styles
- The help content can use the same dark theme and CSS variables

### C. In-app help page

Add a route `/help/:doc` in `App.tsx`. The page component:
- Receives `:doc` (e.g., `getting-started`) as a param
- Loads `src/help/<doc>.md` via Vite's `?raw` import or `fetch`
- Renders with a lightweight Markdown renderer (e.g., `react-markdown`)
- Includes a sidebar TOC linking to each of the four docs

This keeps the implementation to ≈ 80 lines of React. No new dependencies
are required if `react-markdown` is already installed; otherwise it is the
only addition needed.

---

## Iteration Notes

- Run this skill whenever a UI milestone lands (e.g., after M7, M8 frontend work).
- If the smoke report shows a red page, fix the UI bug first, then re-run the
  skill before committing docs.
- The `docs/ui-snapshots/` directory should be committed to the repo so the
  team has a visual history of the UI over time.
- Screenshots from this skill can also be used in PR descriptions.
