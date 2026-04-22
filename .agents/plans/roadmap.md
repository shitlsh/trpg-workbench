# trpg-workbench 开发路线图

## 总览

5 个里程碑，顺序推进。M2 和 M3 在 M1 完成后可并行启动，但 M4 必须等 M2 和 M3 都完成。

```
M1 基础骨架
  ├── M2 知识库 MVP ──┐
  └── M3 资产系统 ────┤
                     ├── M4 Agent 创作
                     └──────────────── M5 产品打磨
```

---

## 里程碑概览

| # | 名称 | 目标 | 计划文件 |
|---|------|------|---------|
| M1 | 基础骨架 | 前后端互通，Workspace CRUD，模型配置可保存 | [m1-foundation.md](m1-foundation.md) |
| M2 | 知识库 MVP | PDF 导入→解析→向量化→检索→引用显示 全链路 | [m2-knowledge.md](m2-knowledge.md) |
| M3 | 资产系统 | 三栏编辑器，资产 CRUD，双视图，Revision 回溯 | [m3-asset-system.md](m3-asset-system.md) |
| M4 | Agent 创作 | 对话驱动生成/修改资产，Workflow 持久化 | [m4-agent-creation.md](m4-agent-creation.md) |
| M5 | 产品打磨 | 补全 Agent，图像生成，导出，体验完整 | [m5-polish.md](m5-polish.md) |
| M6 | 模型配置管理 | LLM/Embedding 双 Profile，Workspace 路由绑定，模型决策层，usage 埋点 | [m6-model-management.md](m6-model-management.md) |
| M7 | 模型发现与用量观测 | Provider catalog，动态模型发现，usage 统计，成本估算，context window 展示 | [m7-model-discovery.md](m7-model-discovery.md) |
| M8 | 知识库预览、质量检查与增强解析扩展 | ingest 结果可视化，chunk/页级预览，检索测试，质量告警；图片/AI增强/rerank 作为后续扩展 | [m8-knowledge-preview.md](m8-knowledge-preview.md) |

---

## 技术约束速查

> 详细约束见各 skill 文件，此处只列最关键的不可越界点。

- **桌面壳**：Tauri，禁止 Electron
- **前端**：React + Vite + TypeScript，禁止 Next.js
- **后端**：Python + FastAPI + Agno，禁止 LangChain
- **数据库**：SQLite（本地），禁止 PostgreSQL（第一版）
- **向量库**：lancedb 或 hnswlib（本地文件型），禁止外部向量服务
- **资产格式**：JSON + Markdown 双文件，JSON 是真相源
- **前端通信**：查询型用 TanStack Query，禁止组件内裸 fetch
- **状态管理**：Zustand，禁止 Redux

---

## 跨里程碑关键约定

### 目录约定

```
apps/desktop/          前端（React + Tauri）
apps/backend/          后端（Python）
packages/shared-schema/ 前后端共用类型（API contract 唯一来源）
trpg-workbench-data/   运行时数据（不提交 git）
```

### API 约定

- 后端默认端口：`8765`
- 前端通过 `VITE_BACKEND_URL`（默认 `http://127.0.0.1:8765`）访问
- 所有接口数据类型在 `packages/shared-schema/` 中定义，前后端不得各自单独定义

### 资产文件命名约定

```
{type}-{slug}.json    例：npc-mayor-arthur.json
{type}-{slug}.md      例：npc-mayor-arthur.md
```

### Asset ID 约定

```
{type}_{slug_underscored}    例：npc_mayor_arthur
```

跨资产引用统一使用 asset_id，禁止用自然语言名称或文件名。
