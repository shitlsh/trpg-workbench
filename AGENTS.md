# AGENTS.md — trpg-workbench

## Repo structure

| Path | What it is |
|------|-----------|
| `apps/desktop/` | React 18 + Vite + TypeScript frontend, wrapped by Tauri 2 |
| `apps/backend/` | Python FastAPI backend, runs as a sidecar managed by Tauri at a dynamic port |
| `packages/shared-schema/` | Shared TypeScript types consumed by the frontend — must be built before frontend |
| `.agents/skills/` | OpenCode skill files; load with the `skill` tool before working on matching topics |
| `.agents/plans/` | Milestone plan files; see `roadmap.md` for current state |

## Dev commands

```bash
# Full dev (backend + Tauri desktop window) — preferred
bash scripts/dev.sh

# Web-only (backend + Vite at localhost:1420, no Rust build wait)
bash scripts/dev.sh --web

# Backend only (port 7821)
bash scripts/dev.sh --backend

# Reset setup wizard on next launch
bash scripts/dev.sh --reset-wizard
```

- `scripts/dev.sh` handles process lifecycle and port cleanup; prefer it over running services manually.
- Backend Python must use the venv: `apps/backend/.venv/bin/python3`. Never `pip install` globally; use `PIP_USER=false .venv/bin/pip install`.
- `pnpm install` at repo root installs all workspaces. Run this before any frontend work.
- `shared-schema` must be built (`pnpm --filter shared-schema build`) before the frontend if types changed.

## Backend quirks

- Backend port is **dynamic** in Tauri mode (injected via env at startup); only fixed at `7821` when run standalone.
- `agent_question` SSE event does **not** emit a preceding `tool_call_start` for `ask_user` — the frontend synthesizes one. Keep this asymmetry in mind when touching SSE event handling.
- Chat messages are stored as JSONL at `~/trpg-workbench-data/workspaces/<id>/.trpg/chat/<session_id>.jsonl`. Backend is the source of truth; frontend messages with `id: local_*` are optimistic and get replaced on reload.
- `metadata_json` on `ChatMessage` is opaque UI metadata (e.g. `question_answer` answers). Backend stores it verbatim; only the frontend interprets it.

## Frontend quirks

- `AgentPanel.tsx` is large (~1500 lines) and owns SSE streaming, message rendering, QuestionCard pairing logic, and the `handleSend` flow. Changes here have wide blast radius.
- Question-answer pairing is positional: the first `question_answer` user message after an `ask_user` assistant message (by index in the messages array) is the pair. No ID matching.
- Optimistic user messages (including `question_answer` replies) are added to the Zustand store immediately on `handleSend` — not on SSE `done`. This is intentional so the QuestionCard "submitted" state renders during the next streaming turn.
- `ask_user` tool calls are suppressed from `ToolCallCard` rendering in both streaming and history views — rendered as `QuestionCard` instead.

## Release flow

Releases are fully automated via CI. Never manually edit version numbers in `tauri.conf.json` or `package.json`.

```bash
# 1. Write changelog entry under <!-- next-release --> in CHANGELOG.md
# 2. Commit and push
git add CHANGELOG.md && git commit -m "chore(release): prepare vX.Y.Z" && git push

# 3. Trigger CI (CI updates versions, tags, builds, creates draft release)
gh workflow run release.yml -f version=X.Y.Z
```

CHANGELOG format is parsed by `awk` in CI — the header **must** be exactly:
```
## vX.Y.Z — YYYY-MM-DD
```
(em dash `—`, not hyphen).

See `.agents/skills/release-manager/SKILL.md` for the full release workflow including rollback steps.

## Skills to load

Load these skills before working on matching areas — they contain binding constraints:

| Topic | Skill |
|-------|-------|
| Any Agent / Workflow design | `agent-workflow-patterns` |
| Asset schema / frontmatter | `asset-schema-authoring` |
| Frontend layout / components / state | `frontend-ui-patterns` |
| Architecture decisions / new modules | `trpg-workbench-architecture` |
| Milestone create / archive / roadmap | `milestone-management` |
| Release / changelog / CI | `release-manager` |
| Knowledge library ingest / TOC | `knowledge-library-ingest` |
