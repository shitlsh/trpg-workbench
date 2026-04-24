---
status: proposed
date: 2026-04-24
source: Internal (release readiness review)
theme: 0.1.0 多平台打包与发布
priority: high
affects_creative_control: no
affects_workbench_collab: no
recommended_action: plan
---

# 0.1.0 多平台打包与 GitHub Release 发布

## 背景

trpg-workbench 的 17 个 milestone 已全部完成，核心创作链路闭环，具备发布 0.1.0 测试版的条件。当前缺少生产构建和发布基础设施——Python 后端无打包方案、无 CI/CD、端口硬编码。

## 当前状态

| 维度 | 现状 | 问题 |
|------|------|------|
| Python 后端 | 开发模式下通过 `#[cfg(debug_assertions)]` 从 `.venv/` 启动 | **生产构建完全无法启动后端** |
| 端口 | 硬编码 `127.0.0.1:7821`（后端 `server.py` + 前端 `api.ts`） | 端口冲突时无法启动 |
| 前端构建 | Vite + Tauri bundle targets `"all"` | 可用 |
| 版本号 | 所有位置统一 `0.1.0` | 可用 |
| 数据路径 | `~/trpg-workbench-data`（`TRPG_DATA_DIR` 可覆盖） | **维持现状**，跨平台一致、用户易找 |
| CI/CD | 无 | 无自动构建和发布 |
| 代码签名 | 无 | 0.1.0 暂缓，README 说明绕过方法 |
| 版本更新 | 无 | 0.1.0 手动下载覆盖安装，暂不做应用内自动更新 |
| 应用内 Patch Notes | 无 | 不需要，GitHub Release Notes 足够 |

## 决策记录

- **数据路径**：维持 `~/trpg-workbench-data`，不迁移到平台规范目录
- **版本更新方式**：手动下载覆盖安装（Tauri updater 需要代码签名，暂不具备条件）
- **应用内 Patch Notes**：不做，测试版用户直接看 GitHub Release Notes
- **代码签名**：0.1.0 暂缓，Release Notes 和 README 中说明 macOS 右键→打开、Windows 忽略 SmartScreen

---

## 方案设计

### A1. Python 后端打包——PyInstaller Sidecar

**策略**：PyInstaller 将后端打包为单个可执行文件，作为 Tauri sidecar 随应用分发。

**为什么选 PyInstaller**：
- 成熟稳定，Tauri + Python sidecar 社区实践多
- 打包为单个二进制，用户无需安装 Python
- Tauri 原生 sidecar 管理：生命周期绑定、自动查找

**实现步骤**：

1. **PyInstaller spec 文件** `apps/backend/trpg-backend.spec`：
   - 入口：`server.py`
   - 模式：`--onefile`
   - Hidden imports：`agno`、`lancedb`、`pdfplumber`、`tiktoken` 等
   - 数据文件：`app/prompts/` 等运行时资源

2. **Tauri sidecar 配置**（`tauri.conf.json`）：
   ```json
   { "bundle": { "externalBin": ["binaries/trpg-backend"] } }
   ```
   命名规则（Tauri 要求 `<name>-<target-triple>`）：
   - `trpg-backend-aarch64-apple-darwin`
   - `trpg-backend-x86_64-apple-darwin`
   - `trpg-backend-x86_64-pc-windows-msvc.exe`
   - `trpg-backend-x86_64-unknown-linux-gnu`

3. **修改 `lib.rs`**——release 模式使用 sidecar，dev 模式保持现有逻辑（增加 Windows 兼容）

4. **前端健康检查等待**：后端启动需要数秒，前端应轮询 `/health` 直到就绪，期间展示 loading 状态

### A2. 随机端口

当前前后端端口均硬编码为 `7821`，需改为动态分配。

**实现路径**：

```
Rust (lib.rs)
  ├─ 绑定 127.0.0.1:0 获取可用端口
  ├─ 将端口作为 --port 参数传给 sidecar / dev python
  └─ 通过 Tauri app.manage(PortState(port)) 存入全局状态

Python (server.py)
  └─ 读取 --port 参数（argparse），默认 7821 作 fallback

Frontend (api.ts)
  ├─ 启动时通过 Tauri invoke("get_backend_port") 获取端口
  └─ 用该端口构造 BASE_URL
```

**涉及文件**：
- `apps/desktop/src-tauri/src/lib.rs` — 端口分配 + Tauri command `get_backend_port`
- `apps/backend/server.py` — 接受 `--port` 参数
- `apps/desktop/src/lib/api.ts` — `BASE_URL` 从硬编码改为动态获取
- `scripts/dev.sh` — dev 模式也改为动态端口（或保留 7821 fallback）

### A3. GitHub Actions CI/CD

**文件**：`.github/workflows/release.yml`

**触发**：`push tags: v*`

**Matrix**：

| Runner | Target Triple | 产物 |
|--------|--------------|------|
| `macos-latest` | `aarch64-apple-darwin` | `.dmg` |
| `macos-13` | `x86_64-apple-darwin` | `.dmg` |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.AppImage`, `.deb` |
| `windows-latest` | `x86_64-pc-windows-msvc` | NSIS `.exe` |

**Steps per platform**：
1. Checkout
2. Setup Node 20 + pnpm
3. Setup Python 3.11 + pip install requirements
4. Setup Rust stable
5. Install system deps（Linux: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev` 等）
6. `pnpm install`
7. PyInstaller 构建 sidecar
8. 重命名 sidecar 为 `trpg-backend-<target-triple>`，放入 `apps/desktop/src-tauri/binaries/`
9. `pnpm tauri build`
10. Upload artifacts

**Release job**（depends on build）：
1. Download all artifacts
2. `gh release create $TAG --draft --generate-notes`
3. Upload 所有安装包到 Release

### A4. 发布流程

```
1. 确认版本号一致（package.json ×2, tauri.conf.json, Cargo.toml）
2. git tag v0.1.0 && git push origin v0.1.0
3. GitHub Actions 自动构建四平台安装包 → Draft Release
4. 审查 Draft Release，补充 Release Notes（测试版声明、已知限制、安装说明、反馈渠道）
5. 发布
```

### A5. 跨平台注意事项

| 事项 | 处理方式 |
|------|---------|
| Dev 模式 venv 路径 | `lib.rs` 中 `#[cfg(target_os = "windows")]` 用 `Scripts/python.exe`，其他用 `bin/python3` |
| 数据目录 | `~/trpg-workbench-data`，Python `pathlib` 已跨平台处理，无需改动 |
| lancedb 原生扩展 | PyInstaller 在各 runner 上构建时自动包含对应平台的 Arrow 二进制 |
| SQLite WAL | 跨平台兼容，无需改动 |
| Linux 系统依赖 | CI 中 `apt-get install` 安装，用户侧 AppImage 自包含 |

---

## 实施计划

### Phase 1：后端 sidecar + 随机端口（核心阻塞项）

1. `server.py` 添加 `--port` argparse 参数
2. `lib.rs` 实现端口分配、sidecar 启动（release）、dev 启动（跨平台 venv 路径）
3. `api.ts` 改为通过 Tauri invoke 动态获取端口
4. 前端添加后端启动等待 + loading 状态
5. 编写 PyInstaller spec，本地验证打包
6. 本地 `pnpm tauri build` 验证产物可运行

### Phase 2：GitHub Actions

7. 编写 `.github/workflows/release.yml`
8. 用 `v0.1.0-rc.1` tag 触发验证
9. 修复各平台构建问题

### Phase 3：发布

10. 创建 `v0.1.0` tag，审查 Draft Release，发布

## 风险点

1. **PyInstaller + lancedb/Arrow**：原生扩展打包可能需要大量 hidden imports 调试
2. **产物体积**：PyInstaller 单文件可能 200-500MB（含 Python 运行时 + 所有依赖）
3. **GitHub Actions 构建时间**：Rust 编译 + PyInstaller，每平台预计 15-30 分钟
4. **macOS Intel runner**：GitHub 的 `macos-13`（Intel）可能在未来被淘汰，需关注
