---
description: Run UI smoke test with DOM assertions and screenshots (dom_plus_screenshot mode)
---

Load the `tauri-ui-smoke-and-docs` skill, then run a smoke test in **dom_plus_screenshot** mode.

## Mode

Fixed: `dom_plus_screenshot`

- Run DOM assertions and page-text extraction for all key pages
- Take full-page screenshots for human review
- Do NOT interpret screenshot pixels; all assertions are DOM-based
- Screenshots are saved to `docs/ui-snapshots/<today>/screenshots/`

## Steps to follow

1. Verify the frontend dev server is running and which port it is on.
   Check `apps/desktop/package.json` or probe common ports (5173, 1420).
   If the server is not running, note it and stop — do not auto-start.

2. Run the smoke script:
   ```
   apps/backend/.venv/bin/python scripts/smoke/smoke_and_screenshot.py \
     --frontend <frontend-url>
   ```
   Pass `--frontend` with the actual port discovered in step 1.

3. Read and present the generated `docs/ui-snapshots/<date>/smoke-report.md`.

4. If any page is `❌ fail` due to a build/compile error, diagnose the
   error from the DOM-extracted message and propose a fix. Do not proceed
   to help-doc generation until all P0 pages pass.

5. Do NOT generate help doc drafts unless the user explicitly asks for them
   after reviewing the smoke report.

6. Do NOT sync any files to `apps/desktop/src/help/` automatically.

## Arguments

Optional: pass a page slug to limit the run to a single page.
Example: `/ui-smoke knowledge`
If $ARGUMENTS is provided, note it as a filter in your output, but the
current script may not support single-page filtering — run full suite and
highlight the requested page in your summary.
