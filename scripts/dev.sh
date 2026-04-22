#!/usr/bin/env bash
# scripts/dev.sh — 本地开发启动脚本
#
# 用途：
#   启动后端 Python 服务 + pnpm tauri dev（完整 Tauri 桌面应用）
#   退出时（Ctrl+C）自动清理所有子进程和占用的端口
#
# 使用：
#   bash scripts/dev.sh           # 完整启动（后端 + Tauri 桌面应用）
#   bash scripts/dev.sh --web     # 仅启动后端 + Vite web dev server（浏览器访问）
#   bash scripts/dev.sh --backend # 仅启动后端
#
# 前置条件：
#   - apps/backend/.venv 已存在（参考 .agents/skills/dev-env-setup/SKILL.md）
#   - apps/desktop/node_modules 已安装（pnpm install）
#   - Rust / Tauri CLI 已安装（tauri 模式需要）

set -euo pipefail

# ── 路径解析 ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/apps/backend"
DESKTOP_DIR="${PROJECT_ROOT}/apps/desktop"
VENV_PYTHON="${BACKEND_DIR}/.venv/bin/python3"

# ── 参数解析 ────────────────────────────────────────────────────────────────────
MODE="tauri"   # default: full Tauri desktop app
while [[ $# -gt 0 ]]; do
  case "$1" in
    --web)     MODE="web";     shift ;;
    --backend) MODE="backend"; shift ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── 端口清理函数 ──────────────────────────────────────────────────────────────
free_port() {
  local port="$1"
  local pid
  pid=$(lsof -ti :"${port}" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    echo "  [dev] Freeing port ${port} (pid ${pid})"
    kill -9 "${pid}" 2>/dev/null || true
    sleep 0.3
  fi
}

# ── 子进程跟踪与清理 ───────────────────────────────────────────────────────────
PIDS=()

cleanup() {
  echo ""
  echo "[dev] Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
  # Give processes a moment to exit gracefully
  sleep 1
  # Force kill any remaining
  for pid in "${PIDS[@]}"; do
    kill -9 "${pid}" 2>/dev/null || true
  done
  # Free ports explicitly in case child spawned grandchildren
  free_port 7821
  free_port 1420
  echo "[dev] Done."
}

trap cleanup EXIT INT TERM

# ── 前置检查 ───────────────────────────────────────────────────────────────────
echo "[dev] Mode: ${MODE}"
echo "[dev] Project root: ${PROJECT_ROOT}"

if [[ ! -f "${VENV_PYTHON}" ]]; then
  echo "[dev] ERROR: Python venv not found at ${VENV_PYTHON}"
  echo "       Run: cd apps/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

if [[ "${MODE}" != "backend" ]] && [[ ! -d "${DESKTOP_DIR}/node_modules" ]]; then
  echo "[dev] ERROR: node_modules not found. Run: pnpm install"
  exit 1
fi

# ── 端口预清理 ─────────────────────────────────────────────────────────────────
free_port 7821
[[ "${MODE}" != "backend" ]] && free_port 1420

# ── 启动后端 ───────────────────────────────────────────────────────────────────
echo "[dev] Starting backend on :7821 ..."
cd "${BACKEND_DIR}"
"${VENV_PYTHON}" server.py &
BACKEND_PID=$!
PIDS+=("${BACKEND_PID}")

# 等后端健康检查通过（最多 20s）
echo "[dev] Waiting for backend to be ready..."
WAITED=0
until curl -sf http://localhost:7821/health > /dev/null 2>&1; do
  sleep 0.5
  WAITED=$((WAITED + 1))
  if [[ $WAITED -ge 40 ]]; then
    echo "[dev] ERROR: Backend did not start within 20s"
    exit 1
  fi
done
echo "[dev] Backend ready ✓"

# ── 仅后端模式 ─────────────────────────────────────────────────────────────────
if [[ "${MODE}" == "backend" ]]; then
  echo "[dev] Backend-only mode. Press Ctrl+C to stop."
  wait "${BACKEND_PID}"
  exit 0
fi

# ── 启动前端 ───────────────────────────────────────────────────────────────────
cd "${DESKTOP_DIR}"

if [[ "${MODE}" == "web" ]]; then
  echo "[dev] Starting Vite web dev server on :1420 ..."
  echo "[dev] Open http://localhost:1420 in your browser"
  pnpm dev &
  FRONTEND_PID=$!
  PIDS+=("${FRONTEND_PID}")
  echo "[dev] Press Ctrl+C to stop all services."
  wait "${FRONTEND_PID}"
else
  # Full Tauri mode
  echo "[dev] Starting Tauri desktop app (this may take a while on first run)..."
  echo "[dev] The desktop window will open automatically."
  pnpm tauri dev &
  TAURI_PID=$!
  PIDS+=("${TAURI_PID}")
  echo "[dev] Press Ctrl+C to stop all services."
  wait "${TAURI_PID}"
fi
