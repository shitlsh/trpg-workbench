# trpg-workbench 开发路线图

## 总览

核心功能链路已通过 M1–M12 全部完成。

```
✅ M1 基础骨架
  ├── ✅ M2 知识库 MVP ──┐
  └── ✅ M3 资产系统 ────┤
                        ├── ✅ M4 Agent 创作
                        └────────────────── ✅ M5 产品打磨
                                                 └── ✅ M6 模型配置管理
                                                       └── ✅ M7 模型发现
                                                             └── ✅ M8 知识库预览
                                                                   └── ✅ M9 Smoke/Help
                                                                         └── ✅ M9a 规则集统一
                                                                               └── ✅ M10 Agent 编排
                                                                                      └── ✅ M11 Onboarding
                                                                                                      └── ✅ M12 Agent 透明度
                                                                                                            └── M13 UI 视觉语言升级
```

> 已完成里程碑的计划文件已归档至 `.agents/plans/archive/`。

---

## 里程碑概览

### 已完成（归档）

| # | 名称 | 目标 | 计划文件 |
|---|------|------|---------|
| M1 ✅ | 基础骨架 | 前后端互通，Workspace CRUD，模型配置可保存 | [archive/m1-foundation.md](archive/m1-foundation.md) |
| M2 ✅ | 知识库 MVP | PDF 导入→解析→向量化→检索→引用显示 全链路 | [archive/m2-knowledge.md](archive/m2-knowledge.md) |
| M3 ✅ | 资产系统 | 三栏编辑器，资产 CRUD，双视图，Revision 回溯 | [archive/m3-asset-system.md](archive/m3-asset-system.md) |
| M4 ✅ | Agent 创作 | 对话驱动生成/修改资产，Workflow 持久化 | [archive/m4-agent-creation.md](archive/m4-agent-creation.md) |
| M5 ✅ | 产品打磨 | 补全 Agent，图像生成，导出，体验完整 | [archive/m5-polish.md](archive/m5-polish.md) |
| M6 ✅ | 模型配置管理 | LLM/Embedding 双 Profile，Workspace 路由绑定，模型决策层，usage 埋点 | [archive/m6-model-management.md](archive/m6-model-management.md) |
| M7 ✅ | 模型发现与用量观测 | Provider catalog，动态模型发现，usage 统计，成本估算，context window 展示 | [archive/m7-model-discovery.md](archive/m7-model-discovery.md) |
| M8 ✅ | 知识库预览、质量检查与增强解析扩展 | ingest 结果可视化，chunk/页级预览，检索测试，质量告警 | [archive/m8-knowledge-preview.md](archive/m8-knowledge-preview.md) |
| M9 ✅ | 前端 Smoke Test、截图与帮助文档系统 | 关键页面 smoke test，截图产物，Help 文档，Tauri Help 菜单接入 | [archive/m9-smoke-and-help.md](archive/m9-smoke-and-help.md) |
| M9a ✅ | 规则集统一管理 | 规则集 CRUD UI，知识库↔规则集绑定，PromptProfile 接入 Agent 运行时，工作空间知识库继承链路打通 | [archive/m9a-ruleset-unification.md](archive/m9a-ruleset-unification.md) |
| M10 ✅ | Agent 编排升级、澄清式交互与 Prompt 体系化 | 澄清式对话，Workflow 持久化修复，Prompt 模板体系，Director/Plot/NPC Agent 升级 | [archive/m10-agent-orchestration.md](archive/m10-agent-orchestration.md) |
| M11 ✅ | 首次配置引导与 Onboarding 体验 | Setup Wizard（分步配置，LLM/Embedding/Rerank/工作空间），Inline Hint + Gemini/Jina 推荐默认值，冷启动引导链路打通 | [archive/m11-onboarding.md](archive/m11-onboarding.md) |
| M12 ✅ | Agent 透明度 | RAG 引用在 WorkflowProgress 中可展开查看，Director 意图摘要在确认卡展示 | [archive/m12-agent-transparency.md](archive/m12-agent-transparency.md) |

### 进行中 / 待启动

| # | 名称 | 目标 | 计划文件 |
|---|------|------|---------|
| M13 | UI 视觉语言升级 | 彩色 per-type 资产图标、三档文字颜色梯度、Active 状态焦点指示 | [m13-visual-language.md](m13-visual-language.md) |

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

- 后端默认端口：`7821`
- 前端通过 `VITE_BACKEND_URL`（默认 `http://127.0.0.1:7821`）访问
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
