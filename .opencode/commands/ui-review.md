---
description: Run UI review with vision analysis if available, otherwise falls back to dom_plus_screenshot
---

Load the `tauri-ui-smoke-and-docs` skill, then attempt a **vision_review** mode run.

## Mode

Requested: `vision_review`
Fallback: `dom_plus_screenshot` (automatic, if vision is not available)

## Vision availability check

Before running, determine whether vision is available in the current session:

- If you can accept and interpret image file content (multimodal capability
  is active), proceed in `vision_review` mode.
- If vision is NOT available (e.g., org policy disables it, or the active
  model is text-only), automatically fall back to `dom_plus_screenshot` and
  add this warning to the smoke report:

  > ⚠ Warning: vision_review requested but vision is not available in this
  > environment. Falling back to dom_plus_screenshot. Screenshots are saved
  > to `docs/ui-snapshots/<date>/screenshots/` for manual inspection.

## Steps to follow

1. Check vision availability as described above. Note the mode in use at
   the start of your response.

2. Verify the frontend dev server is running and which port it is on.

3. Run the smoke script:
   ```
   apps/backend/.venv/bin/python scripts/smoke/smoke_and_screenshot.py \
     --frontend <frontend-url>
   ```

4. Read `docs/ui-snapshots/<date>/smoke-report.md` and present results.

5. **If running in `vision_review` mode (vision available):**
   - Read each screenshot from `docs/ui-snapshots/<date>/screenshots/`
   - For each page, provide a qualitative review:
     - Layout correctness (does it match expected three-panel / settings structure?)
     - Visual regressions or anomalies (broken layout, missing elements, overflow)
     - Contrast, spacing, and typography concerns
   - Summarize findings in a `vision-review.md` in the same date directory

6. **If running in `dom_plus_screenshot` mode (fallback):**
   - Present DOM-based smoke results only
   - Note that screenshots are available at the path above for human review
   - Do not fabricate visual analysis

7. If the user asks for help-doc generation after reviewing results, proceed
   with `tauri-ui-smoke-and-docs` skill's Help Doc Generation section.

8. Do NOT sync any files to `apps/desktop/src/help/` automatically.

## Arguments

Optional: $ARGUMENTS can be a page slug to focus the review on.
