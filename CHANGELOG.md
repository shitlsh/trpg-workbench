# Changelog

All notable changes to TRPG Workbench will be documented in this file.

<!-- next-release -->

## v0.1.8 — 2026-05-08

### Bug Fixes

- **删除确认弹窗**：修复 Tauri WebView 中原生 `confirm()` 导致网络请求中断的问题，所有删除/回滚确认改为 inline 弹窗实现。
- **知识库导入**：修复点击「开始导入」时因向量维度字段缺失导致的 500 错误。
- **删除规则集**：修复因过时的工作空间关联检查导致的 500 错误。
- **进行中弹窗保护**：TOC 分析、AI 生成提示词/资产类型进行中时，点击弹窗外部不再意外关闭。
- **等待中文档**：知识文档卡在「等待中」时现在会显示提示，引导用户删除后重新上传。

## v0.1.7 — 2026-05-08

### Features

- **网页抓取工具**：Director Agent 新增 `web_fetch` 工具，当用户在对话中提供 URL 时可直接抓取页面内容作为创作参考，工具调用卡片同步支持展示抓取结果。

- **创作风格提示词生成优化**：PromptProfile 生成逻辑全面改写，明确聚焦叙事风格、场景氛围、NPC 塑造和题材气质，避免凭空捏造规则数值；style_prefix 注入边界同步加固，防止用户编辑的风格内容意外覆盖 Agent 工作流规则。

### Bug Fixes

- **澄清问题触发率修复**：修复 Director 在信息不足时倾向于跳过 `ask_user` 直接创作的问题。新增「开始执行前的澄清判断」章节，修正与 ask_user 规则冲突的示例，将工具描述改为决策性语言并扩展进入 tool schema，同时调整工具列表排位使模型更易选中。

- **一致性检查调用范围修正**：`patch_asset` 局部修改场景不再强制要求先调用 `check_consistency`，减少不必要的延迟和 token 消耗。

## v0.1.6 — 2026-05-08

### Features

- **模型配置向导全面升级**：新增供应商推荐卡片（Google Gemini / LM Studio 一键填入）、API Key 在线验证、模型列表自动拉取、配置名称智能建议，向导完成后自动预填工作空间模型路由
- **Embedding 配置简化**：移除无实际作用的「向量维度」字段，降低配置心智负担

### Bug Fixes

- **向导流程修复**：工作空间步骤不再强制要求规则集，LLM 配置保存后立即验证连通性
- **Windows CHM 支持增强**：hh.exe 查找路径增加 `C:\Windows` 直接路径，提升 CHM 导入在 Windows 上的成功率

## v0.1.5 — 2026-05-07

### Bug Fixes

- **Windows taskkill 不再闪烁控制台窗口**：`taskkill` 调用加 `CREATE_NO_WINDOW` flag，启动和关闭时不再出现一闪而过的黑色终端窗口。
- **CHM 目录提取增强（Windows）**：新增 `hh.exe` 的 `Sysnative` 路径 fallback（32-bit Python on 64-bit Windows）、`.hhk` 文件 fallback、decompile 产出文件诊断日志，以及 `<param>` 单引号 value 支持。
- **CHM 目录解析失败时给出明确错误提示**：原来 TOC 返回空列表时前端会静默跳过目录直接进入 embedding；现在检测到空结果时会显示错误信息并提示查看 `backend.log`，不再静默失败。

## v0.1.4 — 2026-05-07

### Bug Fixes

- **动态端口未覆盖全部调用点**：`AgentPanel` 聊天发送、`ExportDialog` 导出、`RuleSetPage` 文件上传均使用硬编码的 7821 端口，绕过了动态端口机制。新增 `resolveBackendUrl()` 并替换所有 raw `fetch()` 调用点。
- **启动时清理残留后端进程**：上次会话的 `trpg-backend.exe` 残留会导致新实例端口冲突。现在在 spawn sidecar 前先执行 `taskkill /F /IM /T` 清理旧进程。
- **退出时进程 kill 改为阻塞 + 进程树**：`taskkill` 加 `/T` 确保子进程一并清理，改为 `.status()` 等待完成，避免 app 退出后进程仍残留。

## v0.1.3 — 2026-05-07

### Bug Fixes

- **Windows 无法启动根因修复（CORS）**：Windows 上 Tauri WebView2 使用 `https://tauri.localhost` 作为请求 origin，而后端 CORS 只允许 `tauri://localhost`（macOS），导致所有跨域请求被拒绝，前端健康检查始终失败。新增 `https://tauri.localhost` 和 `http://tauri.localhost` 到允许列表。
- **Windows 后台进程残留强化**：`child.kill()` 在 Windows 上对 PyInstaller 进程不可靠，新增 `taskkill /F /IM trpg-backend.exe` 作为兜底，在独立线程中执行避免阻塞主线程。
- **app.log 日志去重**：后端 stdout/stderr 已由 Python 侧 `backend.log` 完整记录，`app.log` 不再重复收录，只保留 Error 和 Terminated 事件。
- **`attachConsole()` 改为 await**：React mount 前等待 console→app.log 桥接就绪，确保前端日志完整捕获。

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
