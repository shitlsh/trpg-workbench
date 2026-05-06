# Changelog

All notable changes to TRPG Workbench will be documented in this file.

<!-- next-release -->

## v0.1.2 — 2026-05-07

### Bug Fixes

- **退出后后台进程残留修复**：关闭应用后 `trpg-backend` 进程仍在后台运行。将 `CommandChild` 存入 Tauri managed state，在主窗口 `Destroyed` 事件时显式 kill，确保进程随应用退出。同时加 `window.label() == "main"` guard 防止未来多窗口场景提前误杀后端。
- **端口占用竞态修复（TOCTOU）**：`get_free_port()` 拿到端口后立刻释放 listener，Windows Defender 等进程可能在 sidecar bind 前抢占该端口。改为持有 `TcpListener` 直到 sidecar spawn 完成再 drop。
- **sidecar 启动失败从 panic 改为 dialog**：bundle 损坏或 sidecar 二进制缺失时 app 会无声崩溃黑屏。现在改为弹出错误对话框并 graceful exit。
- **dev 路径从 `current_dir()` 改为 `env!("CARGO_MANIFEST_DIR")`**：从 IDE 或 monorepo 根目录启动 dev 时 `current_dir()` 链式 `parent()` 可能 panic，改用编译时常量确保路径稳定。
- **`BackendChild` cfg guard 移除**：debug build 也 manage `BackendChild(None)`，使 `on_window_event` 的 kill 逻辑在 debug 下也能编译和运行，避免仅 release 可测的盲区。
- **`BASE_URL` 改为 Promise-based**：原 module-level `let BASE_URL` 在 `initBackendUrl` 完成前调用任意 fetch 函数均会使用 stale 的 7821 端口。改为 `BASE_URL_PROMISE`（模块加载时立即开始解析，所有 fetch 函数内部 `await`），彻底消除调用时序依赖。

## v0.1.1 — 2026-05-06

### Bug Fixes

- **Windows 无法启动修复**：后端 sidecar 进程在 spawn 后被立即杀死，导致 UI 始终显示"服务启动失败"。根本原因是 Rust 侧进程 handle 在 setup block 结束时立即 drop，已修复为在 async task 中持续持有 handle。
- **重试无效修复**：Tauri webview 初始化完成前调用 invoke 会静默失败并 fallback 到硬编码端口，导致点重试后仍然无法连接后端。现改为自动重试直到拿到正确端口。
- **Python 模块打包缺失**：PyInstaller 打包时 `uvicorn.run("app.main:app")` 字符串形式无法被静态分析，导致 `app.main` 等模块未被打入 bundle。改为直接传入 import 对象，并将模块收集方式改为文件系统扫描，确保所有模块都被包含。
- **Windows CHM 支持**：放弃在 MSVC 上编译 pychm（chmlib 依赖 POSIX 头文件），改用 Windows 内置的 `hh.exe -decompile` 解包 CHM，零依赖，功能对等。

### Features

- **完整日志体系**：所有层的日志统一输出到 `~/trpg-workbench-data/logs/`
  - `backend.log`：Python 后端 uvicorn 请求日志、业务异常、启动错误（RotatingFileHandler，5 MB × 3 份轮转）
  - `app.log`：Rust 层、前端 JS 错误、未捕获异常、sidecar stdout/stderr
  - 排查问题时提供此目录下两个文件即可

## v0.1.0 — 2026-05-06

Initial release.

### Features

- AI Agent 对话面板，支持多轮工具调用、思考链（DeepSeek / Qwen3）流式输出
- 资产系统：NPC、场景、地点、线索等结构化资产的创建、编辑、版本历史
- 知识库：PDF / CHM 文档导入、向量检索（`search_knowledge`）
- 多 LLM 供应商支持：OpenAI、Google Gemini、OpenRouter、本地 OpenAI 兼容（LM Studio 等）
- 工作空间管理：多项目隔离，本地文件系统存储
- Director Agent 调度框架：Consistency / Rules / Skill Agent 工具化委托
- 一致性检查（`check_consistency`）：跨资产矛盾检测
- 规则咨询（`consult_rules`）、世界观检索（`consult_lore`）
- 流式打字机效果、工具调用卡片、思考块折叠展示
- 停止生成后自动保存已输出内容
- 同名工具调用批量折叠摘要卡片
