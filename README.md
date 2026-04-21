# TRPG Workbench

本地优先的 TRPG 主持人创作工作台。类 IDE 桌面应用，辅助 KP/GM 完成剧本撰写、NPC/怪物设计、线索编排、知识库检索等工作。

> **当前状态：M1 基础骨架（开发中）**

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面壳 | [Tauri 2](https://tauri.app) |
| 前端 | React 18 + Vite + TypeScript |
| AI 编排 | Python + [Agno](https://github.com/agno-agi/agno)（M4 起） |
| 数据库 | SQLite（via SQLAlchemy） |
| 向量索引 | lancedb（M2 起） |

---

## 仓库结构

```
trpg-workbench/
  apps/
    desktop/          # React + Tauri 前端
      src/            # React 源码
      src-tauri/      # Tauri / Rust 壳
    backend/          # Python FastAPI 后端
      app/
        api/          # HTTP 路由
        models/       # ORM + Pydantic Schema
        services/     # 业务逻辑（M2+）
        storage/      # SQLite 操作、种子数据
        utils/        # 路径、加密工具
      server.py       # 启动入口
  packages/
    shared-schema/    # 前后端共用 TypeScript 类型（API contract）
  docs/
  .agents/
    skills/           # AI Agent skill 定义
    plans/            # 开发计划（gitignore，本地）
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
# 后端监听 http://127.0.0.1:7821
```

**方式二：完整桌面应用（Tauri + React + Python）**

```bash
# 先确保 Rust 工具链已 source
source "$HOME/.cargo/env"

cd apps/desktop
cargo tauri dev
# Tauri 会自动拉起前端 Vite dev server 和 Python 后端
```

### 验证

1. 应用窗口打开，显示"正在启动服务..."
2. 几秒后进入主界面，显示工作空间列表
3. 点击「新建工作空间」，填写名称，选择规则体系（空白 / COC7）
4. 重启应用，确认数据持久化
5. 进入「模型配置」，新增 OpenAI profile（api_key 加密存储，不明文落盘）

---

## 数据目录

运行时数据默认存储在 `~/trpg-workbench-data/`，可通过环境变量 `TRPG_DATA_DIR` 覆盖。

```
~/trpg-workbench-data/
  app.db               # SQLite 主数据库
  .secret_key          # 本地加密密钥（chmod 600，勿提交）
  workspaces/
    <workspace-id>/    # 每个工作空间的文件目录（M3 起使用）
```

---

## 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1 基础骨架 | monorepo、后端骨架、Workspace CRUD、模型配置 | **进行中** |
| M2 知识库 | PDF 导入、切块、向量检索 | 待启动 |
| M3 资产系统 | NPC/怪物/场景等资产 CRUD、三栏编辑器 | 待启动 |
| M4 Agent 创作 | Director + 6 个子 Agent、Patch 确认流程 | 待启动 |
| M5 产品打磨 | 图像生成、导出、Prompt 配置 | 待启动 |

---

## 贡献

本项目处于早期开发阶段。如有意参与，请先阅读 `PLAN.md` 了解完整产品设计，以及 `.agents/skills/` 下的架构约束文档。
