#!/usr/bin/env bash
# Refresh help-images screenshots for in-app Help docs.
#
# Prerequisites: backend and frontend dev servers must be running.
#   - Backend:  cd apps/backend && .venv/bin/python server.py
#   - Frontend: cd apps/desktop && pnpm dev    (serves on port 1420)
#
# Usage:
#   ./scripts/smoke/refresh-help-images.sh
#   ./scripts/smoke/refresh-help-images.sh --frontend http://localhost:5173
#
# The script uses a fresh browser context (no localStorage),
# so it will always encounter and click through the Setup Wizard.
# Screenshots are saved to apps/desktop/public/help-images/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"
exec apps/backend/.venv/bin/python scripts/smoke/smoke_and_screenshot.py --help-images "$@"
