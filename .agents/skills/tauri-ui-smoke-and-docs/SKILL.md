---
name: tauri-ui-smoke-and-docs
description: >
  Smoke-tests the trpg-workbench frontend against a local dev server, captures
  raw full-page screenshots of key pages, and generates Help / Getting Started
  documentation drafts grounded in the real UI state.
  Use this skill whenever the user asks to: run a UI smoke test, take page
  screenshots, verify that key pages render correctly, generate or refresh
  help docs, update Getting Started content, prepare Tauri Help-menu content,
  or "document the current UI". Also use it proactively after large UI changes
  (e.g., after a milestone lands) to verify nothing is visually broken and to
  keep the help documentation current.
---

# Skill: tauri-ui-smoke-and-docs

## Purpose

This skill chains three tasks that belong together:

1. **Smoke test** — navigate to each key page, assert that critical elements
   are present, record pass/fail per page.
2. **Screenshot capture** — save raw full-page PNGs as a visual record.
3. **Help doc draft generation** — produce Markdown documents grounded in
   what the screenshots and DOM actually show, not what the code is supposed
   to render.

Running the three together keeps the docs honest. Screenshots become
the evidence base for writing step-by-step onboarding text.

### Scope and boundaries

- Covers the key user-facing pages and the critical paths through them.
- Does **not** attempt complete E2E regression or interaction testing.
- Does **not** replace unit tests or backend API tests.
- Is intended for onboarding verification and help-doc generation, not as a
  gate that blocks feature development.

---

## Prerequisites

Before running, confirm:

- Frontend dev server is reachable — default `http://localhost:5173`, but
  verify the actual port from `apps/desktop/package.json` or the running
  process.
- Backend is running — default `http://localhost:7821`. Many pages make live
  API calls on mount; missing backend = blank/error state in screenshots.
- A Playwright runtime is available. This project uses the `webapp-testing`
  skill as the underlying testing toolkit. Check which runtime (`playwright`
  Python package or `@playwright/test` Node package) is actually installed in
  the project before writing any script. Prefer whichever is already present.

### Starting servers if they are not already running

Use the `webapp-testing` skill's `with_server.py` helper. Locate the script
via the skill's installed path (ask the skill system or run
`find .agents -name with_server.py` from the project root). Invoke with
`--help` first to confirm usage, then start both servers before running the
smoke script:

```bash
python <path-to-webapp-testing-skill>/scripts/with_server.py \
  --server "cd apps/backend && .venv/bin/python server.py" --port 7821 \
  --server "cd apps/desktop && pnpm dev" --port 5173 \
  -- python <your-smoke-script.py>
```

If servers are already running, run the smoke script directly.

---

## Key Pages

The table below lists the **recommended** target pages. Before running,
confirm that these routes exist in the current frontend by checking
`apps/desktop/src/App.tsx` (or equivalent router config). If any route
differs from what is listed, use the actual current route.

| Slug | Recommended route | Minimum elements to assert |
|------|------------------|---------------------------|
| `home` | `/` | A "新建工作空间" button or a workspace list entry |
| `settings-models` | `/settings/models` | Tab bar with at least one model-related tab |
| `knowledge` | `/knowledge` | Page heading, upload or "新建知识库" button |
| `workspace` | `/workspace/:id` | Three-column layout visible, Agent panel present |
| `workspace-settings` | `/workspace/:id/settings` | A "模型路由" or equivalent model section |

**Workspace pages require an existing workspace.** If none exists, mark them
as `skipped` (not `fail`) in the smoke report and note this in the help docs.

Feel free to add pages that are part of the current milestone but not yet
listed above. The list is a starting point, not a contract.

---

## Output Layout

All outputs go into `docs/ui-snapshots/<YYYY-MM-DD>/`. Use the UTC+8 date of
the run. Do **not** create a `latest/` symlink. Instead, write a
`docs/ui-snapshots/latest-manifest.json` that records which dated directory
is the most recent:

```json
{
  "date": "2026-04-22",
  "dir": "docs/ui-snapshots/2026-04-22",
  "run_at": "2026-04-22T10:39:00+08:00"
}
```

Directory structure:

```
docs/ui-snapshots/
├── latest-manifest.json
└── 2026-04-22/
    ├── screenshots/
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

---

## Smoke Test Assertions

For each page: navigate → `wait_for_load_state("networkidle")` → assert.

Assertion failures are **non-fatal**: record the failure with its error
message, take the screenshot anyway, and continue to the next page. Only
treat a page as `fail` if navigation or `networkidle` times out entirely.

Example pattern (Python Playwright — use the appropriate runtime if Node is
preferred):

```python
page.goto("http://localhost:5173/knowledge")
page.wait_for_load_state("networkidle")
assert page.locator("text=知识库管理").count() > 0, "knowledge heading missing"
```

Check the `webapp-testing` skill's examples directory for additional
patterns before writing new boilerplate.

---

## Screenshot Conventions

- Capture: `page.screenshot(path=..., full_page=True)`
- Viewport: 1280 × 800 (matches the Tauri window config in
  `apps/desktop/src-tauri/tauri.conf.json`; confirm before running)
- Raw output only — do **not** crop, annotate, or draw overlays
  programmatically; any notes belong in `smoke-report.md`
- One PNG per page slug; overwrite if re-running on the same date

---

## Smoke Report Format

Use this structure so reports from different runs can be compared:

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
| knowledge | ✅ pass | screenshots/knowledge.png | |
| workspace | ⏭ skipped | — | No workspace found |
| workspace-settings | ⏭ skipped | — | No workspace found |

## Failures

_None_
```

Status values: `✅ pass`, `❌ fail`, `⏭ skipped`.

---

## Help Doc Generation

After screenshots are taken, write the four help documents below into
`docs/ui-snapshots/<date>/help/`. Base the content on what the screenshots
and DOM inspection actually show — tab names, button labels, and section
headings must match the real UI, not guesses or prior assumptions.

**Two-stage sync rule:**
- Stage 1 (always): generate docs into `docs/ui-snapshots/<date>/help/`.
- Stage 2 (only on explicit request): copy the files into
  `apps/desktop/src/help/` to update the in-app help source. Never update
  the application source automatically.

Write in plain Chinese (中文). Each doc should be readable by a first-time
user. Aim for under 600 words per document.

### `getting-started.md`

Walk through the first-launch experience:
- What the user sees when the app opens
- How to create the first workspace
- Where to configure models next

### `model-setup.md`

Walk through the settings page for model configuration:
- What tabs exist (enumerate from the actual screenshot, not from memory)
- How to add each type of profile
- What each profile type is used for in the app

### `knowledge-import.md`

Walk through importing a PDF and verifying the result:
- Creating a library
- Uploading a PDF
- Watching the ingest progress
- Reviewing the document summary and any quality warnings
- Previewing chunks and running a search test

### `start-creating.md`

Walk through the main workbench:
- The three-panel layout
- How to write a prompt in the Agent panel
- What happens after submitting a prompt
- How to review and save the result

---

## Tauri Help Menu and In-App Help Page

This section describes the recommended approach for wiring the generated
docs into the Tauri application. **Do not implement this during a smoke run;
implement only when the user explicitly asks for M9 Tauri integration work.**

### Document source location

```
apps/desktop/src/help/
├── getting-started.md
├── model-setup.md
├── knowledge-import.md
└── start-creating.md
```

These files are the in-app canonical source. They are populated from
`docs/ui-snapshots/<date>/help/` only when the user approves the sync.
Tauri bundles them as resources:

```json
// tauri.conf.json — bundle section
"resources": ["src/help/**/*"]
```

At runtime the frontend reads them via `@tauri-apps/api/path`
`resolveResource()`.

### Tauri menu integration (Option 1 — recommended)

Register a Help menu item in `lib.rs` using `tauri::menu::MenuBuilder`.
On click, emit a Tauri event to the frontend. The frontend listens and
navigates to `/help/getting-started` via React Router. This keeps the SPA
intact and reuses the existing theme and CSS variables.

An alternative (Option 2) is to open a second `WebviewWindow` pointing at a
standalone `help.html`. This is simpler to isolate but adds a separate
loading cycle and does not share the app's design system.

### In-app help page

Add a `/help/:doc` route to `App.tsx`. The page component loads the
corresponding Markdown file, renders it (e.g., using `react-markdown`), and
provides a sidebar linking to all four docs. The implementation is small
(~80 lines of React) and requires no new dependencies if `react-markdown` is
already installed.

---

## When to Run This Skill

- After any milestone that changes key UI pages.
- When preparing onboarding material or a demo.
- When the user asks to verify the current UI state visually.
- When updating in-app help content after a round of UI changes.

If the smoke report shows a failed page, fix the UI issue first, then re-run
before committing any docs or screenshots.
