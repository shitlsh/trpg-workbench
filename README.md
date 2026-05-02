# TRPG Workbench

本地优先的 TRPG 主持人创作工作台。类 IDE 桌面应用，辅助 KP/GM 完成剧本撰写、NPC/怪物设计、线索编排、知识库检索等工作。

> **当前状态：M31 已完成，M32（资产体验增强）进行中**（Stage 排序修复、content_json 清除、关系可视化、[[双链]]语法、author 字段、模组手册 PDF 导出）

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面壳 | [Tauri 2](https://tauri.app) |
| 前端 | React 18 + Vite + TypeScript |
| AI 编排 | Python + Provider 原生 SDK（OpenAI / Anthropic / Google / OpenAI-compatible），可选适配框架 |
| 数据库 | SQLite（via SQLAlchemy） |
| 向量索引 | lancedb |

---

## 仓库结构

```
trpg-workbench/
  apps/
    desktop/                # React + Tauri 前端
      src/
        pages/              # 页面组件
        components/         # 通用组件（editor、agent、layout）
        stores/             # Zustand 状态
        lib/                # API 客户端工具
      src-tauri/            # Tauri / Rust 壳
    backend/                # Python FastAPI 后端
      app/
        api/                # HTTP 路由（workspaces、assets、chat、llm_profiles 等）
        agents/             # Agent 运行时（director/explore、tools、provider adapter）
        data/               # 静态数据（model catalog JSON）
        models/             # ORM（SQLAlchemy）+ Pydantic Schema
        services/           # 业务逻辑（model_routing、catalog_service 等）
        storage/            # SQLite 初始化、种子数据
        utils/              # 路径、加密工具
        workflows/          # 多步 Workflow（create_module、rules_review 等）
        knowledge/          # PDF 解析、向量检索
      server.py             # 启动入口
  packages/
    shared-schema/          # 前后端共用 TypeScript 类型（API contract 唯一来源）
  .agents/
    skills/                 # AI Agent skill 约束文档
    plans/                  # 各里程碑开发计划
```

---

## 本地开发

### 环境要求

- Node.js >= 20
- pnpm >= 9（`npm install -g pnpm`）
- Python 3.11+（推荐 3.13）
- Rust（`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`）
- Tauri CLI（`cargo install tauri-cli`）
- macOS：需安装 Xcode Command Line Tools

### 安装依赖

```bash
# 前端依赖
pnpm install

# Python 后端依赖
cd apps/backend
python3 -m venv .venv
PIP_USER=false .venv/bin/pip install -r requirements.txt
```

### 启动开发服务器

**方式一：仅调试后端**

```bash
cd apps/backend
PIP_USER=false TRPG_DATA_DIR=~/trpg-workbench-data .venv/bin/python3 server.py
# 后端监听 http://127.0.0.1:8765
```

**方式二：完整桌面应用（Tauri + React + Python）**

```bash
# 推荐方式：使用项目内置启动脚本（自动管理后端 + 前端 + 退出清理）
bash scripts/dev.sh

# 或手动启动（先确保 Rust 工具链已 source）
source "$HOME/.cargo/env"
cd apps/desktop
cargo tauri dev
# Tauri 会自动拉起前端 Vite dev server 和 Python 后端
```

### 首次配置

1. 应用首次启动会进入**配置向导**（4 步）：LLM 模型 → Embedding 模型 → 规则集 → 工作空间；各步均可跳过后补
2. 如需手动配置，进入「模型配置」分别添加 LLM Profile 和 Embedding Profile
3. 进入工作空间设置，在「模型路由」区域绑定默认 LLM 和 Embedding 模型

---

## 数据目录

运行时数据默认存储在 `~/trpg-workbench-data/`，可通过环境变量 `TRPG_DATA_DIR` 覆盖。

后端（FastAPI）可选环境变量 `LLM_REQUEST_TIMEOUT_SECONDS`：设为正整数秒时，会对 Provider SDK 的 LLM 与 Embedding 请求注入对应 HTTP 超时；**不设置**则不传 `timeout`，由 SDK 默认行为决定（与未接入该参数前一致）。**无应用内 UI**，需在启动进程前设置环境变量。

```
~/trpg-workbench-data/
  app.db               # SQLite 主数据库
  .secret_key          # 本地加密密钥（chmod 600，勿提交）
  workspaces/
    <workspace-id>/    # 每个工作空间的资产文件目录
      assets/          # 结构化资产（JSON + Markdown 双文件）
  knowledge/
    libraries/
      <library-id>/    # 知识库索引和解析结果
```

---

## 贡献

本项目处于积极开发阶段。参与前请先阅读：
- `.agents/skills/trpg-workbench-architecture/SKILL.md`：整体架构约束
- `.agents/plans/roadmap.md`：里程碑路线图
