# trpg-workbench 开发路线图

## 总览

核心功能链路 **M1–M27 已完成**（见下表）。

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
                                                                                                             └── ✅ M13 UI 视觉语言升级
                                                                                                                    └── ✅ M14 Help 文档重建
                                                                                                                          └── ✅ M15 知识库归属规则集
                                                                                                                                  ├── ✅ M16 AssetType 开放化
                                                                                                                                  └── ✅ M17 用户自定义 Agent Skill
                                                                                                                                        └── ✅ M18 File-first 自包含 Workspace
                                                                                                                                               ├── ✅ M19 Agent 上下文控制
                                                                                                                                                       └── ✅ M20 Agent 创作质量增强
                                                                                                                                                              └── ✅ M21 聊天会话管理
                                                                                                                                                                    └── ✅ M22 规则集 UX 打磨
                                                                                                                                                                           └── ✅ M23 Agent 澄清问题机制
                                                                                                                                                                                   ├── ✅ M24 知识库检索质量提升
                                                                                                                                                                                   ├── ✅ M25 LLM Profile 字段瘦身
                                                                                                                                                                                   ├── ✅ M26 探索子 Agent 与 Prompt 体系统一
                                                                                                                                                                                   └── ✅ M27 资产单步操作与批处理
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

| M13 ✅ | UI 视觉语言升级 | 彩色 per-type 资产图标、三档文字颜色梯度、Active 状态焦点指示 | [archive/m13-visual-language.md](archive/m13-visual-language.md) |
| M14 ✅ | Help 文档重建与维护机制 | 重写 Help 文档（人工编写、任务导向、嵌入截图），调整维护机制，增强 HelpPage 交互 | [archive/m14-help-rebuild.md](archive/m14-help-rebuild.md) |
| M15 ✅ | 知识库归属规则集 | 知识库作为规则集下级管理（合并进 RuleSetPage），消除独立 /knowledge 路由，统一 1:N 数据模型 | [archive/m15-knowledge-under-ruleset.md](archive/m15-knowledge-under-ruleset.md) |
| M16 ✅ | AssetType 开放化与自定义类型注册 | `AssetType` 改为开放字符串，用户可在 RuleSet 中注册自定义资产类型（名称、标签、图标） | [archive/m16-asset-type-openness.md](archive/m16-asset-type-openness.md) |
| M17 ✅ | 用户自定义 Agent Skill | 用户为每个 Agent 类型编写持久化创作框架指令，注入 Workflow 执行；Chat 可对话创建 Skill | [archive/m17-user-agent-skills.md](archive/m17-user-agent-skills.md) |
| M18 ✅ | File-first 自包含 Workspace | 资产/配置/聊天全部以文件为真相源，DB 降级为可重建缓存索引，工作空间目录可拷贝即迁移 | [archive/m18-file-first-workspace.md](archive/m18-file-first-workspace.md) |
| M19 ✅ | Agent 上下文控制与工具能力 | Agent 从固定流水线升级为拥有工具的自主协作者（tool-calling + SSE streaming + 多轮记忆 + @引用） | [archive/m19-agent-context-control.md](archive/m19-agent-context-control.md) |
| M20 ✅ | Agent 创作质量与上下文感知增强 | 子 Agent 工具化（Consistency/Rules/Skill）、资产语义搜索、信任模式、Director prompt 质量提升 | [archive/m20-agent-quality.md](archive/m20-agent-quality.md) |
| M21 ✅ | 聊天会话管理 | 多会话列表、切换、历史浏览、重命名删除；SessionDrawer + 刷新自动恢复上次会话 | [archive/m21-chat-sessions.md](archive/m21-chat-sessions.md) |

| M22 ✅ | 规则集 UX 打磨 | 移除内置规则集限制、Setup Wizard 补充规则集步骤、展示内置 AssetType、三标签提示词弹窗 | [archive/m22-ruleset-ux-polish.md](archive/m22-ruleset-ux-polish.md) |
| M23 ✅ | Agent 澄清问题机制 | Director 在推理中途向用户提出结构化选项问题，减少猜错方向的来回成本 | [archive/m23-agent-question-interrupt.md](archive/m23-agent-question-interrupt.md) |
| M24 ✅ | 知识库检索质量提升 | chunk 级类型标签、chunker 修复、top_k 配置化、rerank 接入 | [archive/m24-knowledge-retrieval-quality.md](archive/m24-knowledge-retrieval-quality.md) |
| M25 ✅ | LLM Profile 字段瘦身与模型选择体验 | 去掉 Profile 死字段、能力归目录、模型下拉可搜可筛可展示 | [archive/m25-llm-profile-fields-cleanup.md](archive/m25-llm-profile-fields-cleanup.md) |
| M26 ✅ | 探索子 Agent 与 Prompt 体系统一 | 落地只读 Explore + 会话分流；**统一中文化**（含 **PDF/CHM 两套 TOC prompt**）；P0、死 prompt、`prompts` 规范；聊天摘要等；`knowledge-library-ingest` skill；不恢复旧顺序主链；用量见 plan B1 | [archive/m26-explore-prompt-integrity.md](archive/m26-explore-prompt-integrity.md) |
| M27 ✅ | 资产单步操作与批处理 | Director 工具补足 **删除/移动**；**批量** create/patch/delete/move；**跨资产** `preview`→`apply` 文本替换；不引入通用 shell；见 [benchmark accepted](../../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md) | [archive/m27-asset-ops-and-batch.md](archive/m27-asset-ops-and-batch.md) |

### 进行中 / 待启动

| # | 名称 | 目标 | 计划文件 |
|---|------|------|---------|
| — | — | — | *（无）* |

---

## 技术约束速查

> 详细约束见各 skill 文件，此处只列最关键的不可越界点。

- **桌面壳**：Tauri，禁止 Electron
- **前端**：React + Vite + TypeScript，禁止 Next.js
- **后端**：Python + FastAPI + Agno，禁止 LangChain
- **数据库**：SQLite（本地），禁止 PostgreSQL（第一版）
- **向量库**：lancedb 或 hnswlib（本地文件型），禁止外部向量服务
- **资产格式**：Frontmatter Markdown 为真相源（M18 起），`.trpg/cache.db` 为可重建索引
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
