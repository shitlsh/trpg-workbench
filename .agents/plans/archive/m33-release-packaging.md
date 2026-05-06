# M33：0.1.0 打包与发布

**前置条件**：M32 完成（核心创作链路已全部实现，具备打包交付条件）。

**状态：✅ 已完成（commit 8a263de）**

**目标**：将 trpg-workbench 打包为可独立运行的桌面应用，交付 Mac（Apple Silicon + Intel）和 Windows 平台的 v0.1.0 测试版安装包。

---

## 背景与动机

M1–M32 核心功能链路已闭环，具备发布测试版的条件。当前 Tauri 生产构建**完全无法启动后端**：

- `lib.rs` 只有 `#[cfg(debug_assertions)]` dev 路径，release 模式下后端进程根本不会被拉起
- 端口 `7821` 在 `server.py`、`api.ts` 中硬编码，存在用户环境端口冲突风险
- 无 PyInstaller sidecar 配置，无 CI/CD 流水线

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：server.py 支持 --port 参数**

方案：用 `argparse` 解析 `--port`，默认 `7821` 作 fallback，传给 `uvicorn.run()`。

**A2：lib.rs 随机端口分配 + dev/release 双路径**

方案：
- Rust 绑定 `127.0.0.1:0` 获取随机可用端口，存入 `app.manage(BackendPort(port))`
- 新增 Tauri command `get_backend_port`
- `#[cfg(debug_assertions)]`：dev 模式传随机端口给 venv python（macOS `bin/python3` / Windows `Scripts\python.exe`）
- `#[cfg(not(debug_assertions))]`：release 模式通过 `tauri_plugin_shell` sidecar 启动 `trpg-backend`，传入 `--port`

**A3：前端动态端口**

方案：`api.ts` 启动时调用 `invoke("get_backend_port")` 获取端口，`BASE_URL` 由硬编码改为动态构造。

**A4：前端后端等待 + Loading 状态**

方案：`App.tsx` 全局初始化时轮询 `/health`（每 500ms，最多 30 秒），等待期间展示 loading 界面，避免空白/报错。

**A5：PyInstaller spec**

方案：新建 `apps/backend/trpg-backend.spec`，`--onefile` 模式，包含所有 hidden imports（lancedb、pyarrow、tiktoken、pdfplumber、anthropic、openai、google.genai、ddgs、frontmatter、chm/pychm、uvicorn 相关、sqlalchemy.dialects.sqlite），打包 `app/prompts/` 数据文件。
本地验证：`pyinstaller trpg-backend.spec` 构建成功，`./dist/trpg-backend --port 17821` 可启动。

> ⚠️ macOS 构建前须：`brew install chmlib`（pychm 编译依赖）

**A6：Tauri sidecar 配置**

方案：`tauri.conf.json` 添加 `bundle.externalBin: ["binaries/trpg-backend"]`；创建 `apps/desktop/src-tauri/binaries/` 目录（含 `.gitkeep`）。

**A7：端到端本地 macOS 验证**

方案：`pnpm tauri build` 生成 `.dmg`，安装后后端自动拉起，页面正常加载。

**A8：GitHub Actions CI/CD（Mac + Windows）**

方案：新建 `.github/workflows/release.yml`，触发条件 `push tags: v*`，matrix：

| Runner | Target Triple | 产物 |
|--------|--------------|------|
| `macos-latest` | `aarch64-apple-darwin` | `.dmg` |
| `macos-13` | `x86_64-apple-darwin` | `.dmg` |
| `windows-latest` | `x86_64-pc-windows-msvc` | NSIS `.exe` |

每平台 steps：Checkout → Node 20 + pnpm → Python 3.11 → pip install（含 pyinstaller） → macOS 额外 `brew install chmlib` → Rust stable → `pnpm install` → PyInstaller → rename sidecar → `pnpm tauri build` → upload artifacts。

Release job（depends on all builds）：`gh release create $TAG --draft --generate-notes` + 上传安装包。

**A9：版本号验证 + Release Notes 补充**

方案：确认四处版本号一致（`apps/desktop/package.json`、`tauri.conf.json`、`Cargo.toml`、`app/main.py`）；Release Notes 补充未签名绕过说明、数据目录说明。

### B 类：后续扩展（不强制当前实现）

- **B1：Linux 平台打包**：AppImage + deb，加入 CI matrix，需处理系统 GTK/WebKit 依赖
- **B2：代码签名**：macOS notarization + Windows EV 签名，需购买证书，推迟到 0.2.0
- **B3：应用内自动更新**：Tauri updater 需代码签名，依赖 B2，推迟到 0.2.0

### C 类：明确不做

- 应用内 Patch Notes 页面（GitHub Release Notes 已足够）
- 数据路径迁移到平台规范目录（`~/Library/...` 等），维持 `~/trpg-workbench-data`

---

## 文件结构

### 新增文件

```
apps/backend/trpg-backend.spec                         ← PyInstaller spec
apps/desktop/src-tauri/binaries/.gitkeep               ← sidecar 放置目录
.github/workflows/release.yml                          ← CI/CD 流水线
```

### 修改文件

```
apps/backend/server.py                  ← 添加 --port argparse 参数
apps/desktop/src-tauri/src/lib.rs       ← 随机端口 + sidecar 启动 + get_backend_port command
apps/desktop/src/lib/api.ts             ← BASE_URL 改为动态（invoke get_backend_port）
apps/desktop/src/App.tsx                ← 后端等待 + loading 状态
apps/desktop/src-tauri/tauri.conf.json  ← 添加 externalBin
```

---

## 关键设计约束

**端口传递链路：**

```
Rust lib.rs
  ├─ 绑定 127.0.0.1:0 → 获取可用端口 N
  ├─ app.manage(BackendPort(N))
  ├─ [dev] venv python server.py --port N
  └─ [release] sidecar trpg-backend --port N

Python server.py
  └─ argparse --port N (default 7821) → uvicorn.run(port=N)

Frontend api.ts
  └─ invoke("get_backend_port") → N → BASE_URL = "http://127.0.0.1:N"
```

**Sidecar 命名规则（Tauri 要求）：**

```
trpg-backend-aarch64-apple-darwin       (macOS Apple Silicon)
trpg-backend-x86_64-apple-darwin        (macOS Intel)
trpg-backend-x86_64-pc-windows-msvc.exe (Windows)
```

**PyInstaller 非交叉编译原则：** 每平台的 sidecar 必须在对应平台的 runner 上构建，不能跨平台编译（原生扩展 lancedb/pyarrow/pychm 不支持交叉编译）。

---

## Todo

### A1：server.py --port 参数

- [x] **A1.1**：`apps/backend/server.py` — 用 `argparse` 解析 `--port`，默认 `7821`，传给 `uvicorn.run()`

### A2：lib.rs 随机端口 + sidecar

- [x] **A2.1**：`lib.rs` — 绑定 `127.0.0.1:0` 获取可用端口，存入 `app.manage(BackendPort(port))`
- [x] **A2.2**：`lib.rs` — 新增 `#[tauri::command] fn get_backend_port(state: State<BackendPort>) -> u16`
- [x] **A2.3**：`lib.rs` — `#[cfg(debug_assertions)]` dev 路径：macOS `bin/python3` / Windows `Scripts\python.exe`，传入 `--port`
- [x] **A2.4**：`lib.rs` — `#[cfg(not(debug_assertions))]` release 路径：`shell.sidecar("trpg-backend").args(["--port", &port.to_string()]).spawn()`

### A3：前端动态端口

- [x] **A3.1**：`apps/desktop/src/lib/api.ts` — `BASE_URL` 改为 `let`，新增 `initBackendUrl()` 通过 `invoke("get_backend_port")` 初始化
- [x] **A3.2**：`api.ts` — 所有 fetch 入口确保在 `initBackendUrl()` 之后执行

### A4：前端 Loading 等待

- [x] **A4.1**：`apps/desktop/src/App.tsx` — 组件挂载时调用 `initBackendUrl()`，再轮询 `/health`（每 500ms，最多 30s），期间渲染 loading 界面

### A5：PyInstaller spec

- [x] **A5.1**：新建 `apps/backend/trpg-backend.spec`，配置 hidden imports 和数据文件
- [ ] **A5.2**：本地运行 `pyinstaller trpg-backend.spec` 验证构建成功（需本地手工执行）
- [ ] **A5.3**：运行 `./dist/trpg-backend --port 17821`，确认后端可正常启动（需本地手工执行）

### A6：Tauri sidecar 配置

- [x] **A6.1**：`tauri.conf.json` — `bundle.externalBin` 添加 `"binaries/trpg-backend"`
- [x] **A6.2**：创建 `apps/desktop/src-tauri/binaries/.gitkeep`
- [ ] **A6.3**：将本地构建产物重命名为 `trpg-backend-<target-triple>` 放入 `binaries/`（CI 构建时自动处理）

### A7：端到端本地验证

- [ ] **A7.1**：`pnpm tauri build` 成功，生成 `.dmg`（需本地手工执行）
- [ ] **A7.2**：安装并启动应用，后端自动拉起，loading 消失，页面正常加载（需本地手工执行）

### A8：GitHub Actions

- [x] **A8.1**：新建 `.github/workflows/release.yml`，配置 trigger + matrix（macOS ARM、macOS Intel、Windows）
- [x] **A8.2**：每平台 steps 完整：Node/pnpm/Python/Rust setup → pip install → brew chmlib（macOS）→ PyInstaller → rename sidecar → tauri build → upload
- [x] **A8.3**：Release job：`gh release create --draft` + 上传所有安装包
- [ ] **A8.4**：用 `v0.1.0-rc.1` tag 触发验证，修复各平台构建问题（需 tag 推送后验证）

### A9：版本号与发布

- [x] **A9.1**：确认 `apps/desktop/package.json`、`tauri.conf.json`、`Cargo.toml` 版本号均为 `0.1.0`（`app/main.py` 无版本变量）
- [x] **A9.2**：README.md 补充 macOS Gatekeeper / Windows SmartScreen 绕过说明
- [ ] **A9.3**：`git tag v0.1.0 && git push origin v0.1.0`，审查 Draft Release 后发布（需手工执行）

---

## 验收标准

1. 在 macOS（Apple Silicon）上，从 `.dmg` 安装启动后，应用自动拉起后端，loading 界面消失，主界面正常加载，无需用户手动启动任何进程
2. 在 Windows 上，从 NSIS `.exe` 安装启动后，同上，后端自动运行
3. 同时启动两个实例时，两者各自使用不同随机端口，互不冲突
4. 后端启动失败时（超过 30s 未响应 `/health`），前端显示明确的错误提示，而非空白页
5. `v0.1.0` tag 推送后，GitHub Actions 自动构建并生成 Draft Release，包含 macOS ARM `.dmg`、macOS Intel `.dmg`、Windows NSIS `.exe`

---

## 与其他里程碑的关系

```
✅ M32（资产体验增强，功能链路闭环）
  └── 🚧 M33（0.1.0 打包与发布）
        ├── B1：Linux 平台打包（后续 milestone）
        └── B2/B3：代码签名 + 自动更新（0.2.0）
```

---

## 非目标

- **Linux 平台**：AppImage/deb 推迟到后续 milestone（本次只做 Mac + Windows）
- **代码签名**：macOS notarization 和 Windows EV 签名需购买证书，0.1.0 测试版不做，README 说明绕过方法
- **应用内自动更新**：Tauri updater 依赖代码签名，0.1.0 手动下载覆盖安装
- **数据路径迁移**：维持 `~/trpg-workbench-data`，不迁移到 `~/Library/Application Support/` 等平台目录
- **应用内 Patch Notes 页面**：GitHub Release Notes 已足够，不在应用内展示版本日志

---

## 风险点

| 风险 | 缓解 |
|------|------|
| PyInstaller + lancedb/pyarrow 原生扩展 | 在各平台 runner 上原生构建，不跨平台编译 |
| pychm 需要系统 chmlib | macOS CI 用 `brew install chmlib`，Windows 直接 pip wheel |
| 产物体积 200-500MB | `--onefile` 可接受，测试版用户可接受较大安装包 |
| CI 构建时间 15-30 分钟/平台 | 接受；使用 pip cache + Rust cache 优化后续 |
| GitHub `macos-13`（Intel runner）未来被淘汰 | 持续关注，必要时切换到 `macos-14` with Rosetta |

