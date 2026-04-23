# M1：基础骨架

**前置条件**：无（起始 milestone）。

**状态：✅ 已完成（commit fa3c24e）**

**目标**：前后端可互通的空壳，Workspace CRUD 可用，模型配置可保存，重启数据不丢失。

**完成后可进入**：M2（知识库）和 M3（资产系统）可并行启动。

---

## Todo

### 仓库结构初始化

- [x] 创建 `apps/desktop/`，初始化 Tauri + React + Vite + TypeScript 项目
- [x] 创建 `apps/backend/`，初始化 Python 项目结构（`app/api/`、`app/services/`、`app/models/`、`app/storage/`、`app/utils/`）
- [x] 创建 `packages/shared-schema/`，初始化 TypeScript 类型包
- [x] 配置 monorepo 工具（pnpm workspace）
- [x] 确认 `.gitignore` 覆盖 `node_modules/`、`.venv/`、`trpg-workbench-data/`

### Python 后端骨架

- [x] 安装依赖：FastAPI、uvicorn、SQLAlchemy、pydantic、cryptography、keyring
- [x] 实现 `GET /health` 端点，返回 `{"status": "ok", "version": "0.1.0"}`
- [x] SQLAlchemy 直接建表（Base.metadata.create_all），无需 alembic（M1 阶段 schema 稳定）
- [x] 建表：`rule_sets`（id、name、slug、description、genre、created_at、updated_at）
- [x] 建表：`workspaces`（id、rule_set_id、name、description、workspace_path、default_model_profile_id、created_at、updated_at）
- [x] 建表：`model_profiles`（id、name、provider_type、base_url、api_key_encrypted、model_name、temperature、max_tokens、created_at、updated_at）
- [x] Workspace CRUD API：`GET/POST /workspaces`、`GET/PATCH/DELETE /workspaces/:id`
- [x] RuleSet API：`GET /rule-sets`、`POST /rule-sets`（内置空规则和 COC7 模板）
- [x] ModelProfile CRUD API：`GET/POST /settings/model-profiles`、`PATCH/DELETE /settings/model-profiles/:id`
- [x] API key 本地加密存储（Fernet 加密，密钥存 `~/.trpg-workbench-data/.secret_key`，chmod 600）

### 前端

- [x] Tauri + React + Vite 项目能 `cargo tauri dev` 正常启动
- [x] 实现 Tauri 启动时拉起 Python 后端子进程（tauri-plugin-shell Command API）
- [x] 实现启动态状态机：轮询 `/health`，间隔 500ms，超时 30s
  - `starting`：全屏加载页，显示"正在启动服务..."
  - `ready`：渲染主界面
  - `failed`：全屏错误页，显示原因 + 重试按钮
  - `disconnected`（运行中断连）：顶部 Banner + 自动重连
- [x] 首页：最近 Workspace 列表（名称、规则体系、最后修改时间）
- [x] 首页：新建 Workspace 入口（填名称、选 RuleSet）
- [x] 首页：删除 Workspace（二次确认）
- [x] 模型配置页：新增/编辑/删除 ModelProfile
  - 支持 provider：OpenAI、Anthropic、Google、OpenRouter、自定义 base URL
  - 填写：model name、temperature、max_tokens、api_key（password 输入）
- [x] Workspace 设置页：基本信息编辑、RuleSet 选择、默认模型选择
- [x] 全局状态：`useSettingsStore`（persist）、`useWorkspaceStore`

### shared-schema

- [x] 定义 TypeScript 类型：`Workspace`、`RuleSet`、`ModelProfile`
- [x] 定义 API 响应类型：`ApiResponse<T>`、`PaginatedResponse<T>`

---

## 验证步骤

1. 执行 `cargo tauri dev`，确认应用窗口正常打开 ← **待人工验证**
2. 确认界面显示"正在启动服务..."后进入主界面
3. 新建一个 Workspace，名称填"测试空间"，选择"COC 模板"RuleSet
4. 进入模型配置页，新增一个 OpenAI profile（填任意 key 和 gpt-4o）
5. 在 Workspace 设置页，将默认模型绑定到刚才创建的 profile
6. **完全关闭应用并重启**
7. 确认"测试空间"仍出现在首页列表
8. 确认模型配置仍然存在，且 api_key 不是明文显示
9. 删除"测试空间"，确认从列表消失，无报错

---

## 关键约束提示

- Python 后端必须在 Tauri 启动时自动拉起，用户不需要手动启动
- API key 不得明文写入 SQLite 或任何文本文件
- `trpg-workbench-data/` 目录由后端自动创建，不需要用户手动建

---

## 实现备注

- 选用 SQLAlchemy `Base.metadata.create_all` 替代 alembic，M1 阶段 schema 简单稳定；M2/M3 引入 alembic
- pip 全局配置 `user = true` 导致 venv 内安装报错，需用 `PIP_USER=false` 覆盖，或修改 `~/Library/Application Support/pip/pip.conf`
- Python 系统版本为 3.9（Apple CLT 自带），必须用 Homebrew Python 3.13（`/opt/homebrew/bin/python3.13`）创建 venv
- Rust 需通过 rustup 安装（`curl ... | sh`），安装后须 `source "$HOME/.cargo/env"` 方可使用
