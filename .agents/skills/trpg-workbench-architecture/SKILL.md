---
name: trpg-workbench-architecture
description: 约束 trpg-workbench 项目的整体架构决策、技术选型和仓库结构规范。当讨论或实现任何涉及技术选型、架构分层、数据模型、目录结构、通信方式、数据库方案、前后端划分的问题时，必须加载本 skill。包括但不限于：新建模块、引入新依赖、设计服务间通信、讨论存储方案、规划仓库结构，或任何"用什么技术"的决策。
---

# Skill: trpg-workbench-architecture

## 用途

本 skill 约束 `trpg-workbench` 项目的整体架构决策，防止引入与产品定位不符的技术选型或架构模式。**所有代码实现、技术方案、新功能设计都必须先对照本 skill 检查是否符合约束。**

---

## 技术栈（锁死，不可更换）

| 层次 | 技术 | 禁止替换为 |
|------|------|-----------|
| 桌面壳 | Tauri | Electron、NW.js |
| 前端框架 | React + Vite + TypeScript | Next.js、Nuxt、SvelteKit |
| AI 编排 | Python + Agno | LangChain、LlamaIndex、纯 OpenAI SDK |
| 数据库 | SQLite（第一版）| MySQL、MongoDB（第一版禁用） |
| 向量索引 | 本地轻量方案（如 lancedb、hnswlib）| 第一版禁止依赖外部向量服务 |
| 资产格式 | JSON + Markdown 双轨 | 纯富文本、纯 HTML |

> **关于 PostgreSQL**：本地桌面端不引入 PostgreSQL，原因是需要独立安装数据库服务，严重损害"开箱即用"体验。SQLite 对本项目的写入并发需求完全足够（单用户桌面工具）。未来云同步阶段可引入 PostgreSQL + pgvector。

> **SQLite 的向量能力**：第一版向量索引不依赖 SQLite，单独用本地文件型向量库（如 lancedb）管理，SQLite 只存业务数据。

---

## 架构分层（必须遵守）

```
A. 桌面应用层   Tauri
   - 应用窗口、本地菜单、系统文件对话框、打包、桌面生命周期
   - 不写业务逻辑

B. 前端 UI 层   React + Vite + TypeScript
   - 项目树、编辑区、Agent 面板、资产详情、知识库管理、模型配置
   - 不直接操作文件系统，通过后端 API 完成

C. 应用服务层   Python 本地 HTTP 服务
   - 工作空间管理、文件导入、PDF 解析、资产读写
   - patch 应用、任务调度、图像生成调用、配置与日志

D. AI 编排层    Python + Agno
   - Director / Rules / Plot / NPC / Monster / Lore / Consistency / Document Agent
   - Workflow 编排、Knowledge 检索、会话与记忆

E. 数据层       SQLite + 本地文件系统 + 本地向量索引
   - SQLite: 主业务数据（workspace、asset、chat、model profile 等）
   - 文件系统: 资产 MD/JSON 文件、PDF 原始文件、图像资源
   - 向量索引目录: 独立管理，不混入 SQLite
```

**前后端通信**：第一版使用本地 HTTP API（`http://127.0.0.1:<port>`），Python 后端在 Tauri 启动时作为子进程拉起。后续可升级为 Tauri sidecar 模式。

---

## 核心业务模型层次关系

```
RuleSet（规则集，用户可创建和管理）
  ├── PromptProfile（创作风格提示词，通过 rule_set_id 关联，1 个规则集最多 1 个活跃提示词）
  └── KnowledgeLibrary[]（归属该规则集，一对多，通过 KnowledgeLibrary.rule_set_id 外键）
        └── KnowledgeDocument（具体 PDF 文件）
              └── KnowledgeChunk（切块 + 向量引用）

Workspace（工作空间）── 归属一个 RuleSet
  ├── WorkspaceLibraryBinding（工作空间级额外知识库绑定，补充规则集之外的知识库）
  ├── Asset（结构化资产）
  │     └── AssetRevision（每次落盘生成一条，不可删除）
  └── ChatSession（对话历史）
        └── ChatMessage（含引用和 tool_calls）

LLMProfile（LLM 供应商配置，全局可复用）
EmbeddingProfile（Embedding 供应商配置，全局可复用）
ModelCatalogEntry（LLM 模型目录，含 pricing/context_window 元数据）
EmbeddingCatalogEntry（Embedding 模型目录）
LLMUsageRecord（每次 LLM 调用的 token 用量记录，绑定 workspace）
ImageGenerationJob（图像生成任务，绑定 Asset）
```

### 关键约束

- **Workspace 只能归属一个 RuleSet**，不可跨规则体系混用
- **每次 Asset 落盘都必须写 AssetRevision**，不允许直接覆盖
- **KnowledgeChunk 必须保留 page_from / page_to**，引用必须追溯到页码
- **Asset 必须同时维护 content_json 和 content_md**，缺一不可
- **KnowledgeLibrary 归属某个 RuleSet**（一对多，通过 `KnowledgeLibrary.rule_set_id` 外键）；在规则集管理页内创建和管理，不是全局独立资产
- **WorkspaceLibraryBinding 是工作空间级扩充**，用于为单个工作空间追加规则集之外的知识库；工作空间实际可用的知识库 = 规则集归属的库 + 工作空间额外绑定的库

### `WorkflowState` 关键字段（M12 新增，shared-schema 定义）

```typescript
interface WorkflowStepResult {
  step_id: string
  label: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  detail?: string | null   // M12：citations JSON 字符串或自由文本，供前端展示 CitationsPanel
  error?: string | null
}

interface WorkflowState {
  workflow_id: string
  status: "idle" | "running" | "completed" | "failed"
  steps: WorkflowStepResult[]
  director_intent?: string | null  // M12：Director 的规划意图，供前端展示"AI 正在做什么"
}
```

**约束**：
- `detail` 写入时机：知识库检索步骤完成后，由 Workflow 的 `update_step(detail=...)` 写入，空检索时写 `None`，不写 `"[]"`
- `director_intent` 写入时机：Director 规划完成后，在 Workflow 启动阶段写入，不在每步更新
- 前后端通过 `packages/shared-schema/` 共享此类型定义，不允许前后端各自单独定义

---

### `workspace_context` 结构（Agent 运行时传入）

```python
{
    "workspace_name": str,
    "rule_set": str,           # rule_set_id
    "style_prompt": str | None, # 规则集 PromptProfile 的 system_prompt，供 Agent 注入风格约束
    "library_ids": list[str],  # 合并后的知识库 ID 列表（规则集绑定 + 工作空间额外绑定，已去重）
    "existing_assets": [{"type": str, "name": str, "slug": str}],
}
```

Agent 使用 `style_prompt` 时，应将其作为 prompt prefix 注入，**不得替换 Agent 自身的硬编码 system_prompt 常量（M10 后：通过 `load_prompt()` 加载的 prompt）**。

M10 prompt prefix 注入顺序：
```
[创作风格约束]             ← style_prompt
{style_prompt}

[用户创作偏好]             ← clarification_answers（仅 create_module resume 时有值）
{answers_summary}

{task_prompt}              ← 实际任务描述
```

---

## 本地文件目录结构

### 不可改变的核心边界

以下一级目录划分是架构边界，不可更改：

- `workspaces/<workspace-id>/assets/` 下必须按资产类型分子目录
- `knowledge/libraries/<library-id>/` 下必须有 `source/`、`parsed/`、`index/` 三级
- `settings/` 存放全局配置文件

### 参考结构（内部子目录可在不破坏边界前提下演进）

```
trpg-workbench-data/
  app.db                         # SQLite 主数据库
  workspaces/
    <workspace-id>/
      assets/
        outline/
        stages/
        npcs/
        monsters/
        locations/
        clues/
        branches/
        timelines/
        map_briefs/
        lore_notes/
      revisions/                 # revision 文件备份
      exports/
      images/
      logs/
  knowledge/
    libraries/
      <library-id>/
        source/                  # 原始 PDF（不可修改原始文件）
        parsed/
          manifest.json
          chunks.jsonl
        index/                   # 向量索引文件
  settings/
    # 全局配置由 SQLite 管理，无独立配置文件
```

> 若需调整内部子目录结构（如将 `storage/` 拆分为 `db/` + `fs/`），可在不破坏上方核心边界的前提下调整，但必须同步更新本 skill 中的参考结构。

---

## 仓库结构

### 不可改变的核心边界

- `apps/desktop/` 和 `apps/backend/` 的一级划分固定，前端后端不可合并
- `packages/shared-schema/` 是前后端 API contract 的唯一来源，**前后端接口数据结构必须在此定义和维护**，不允许前端或后端单独定义接口类型后各自使用

### 参考结构（内部模块可在不破坏边界前提下演进）

```
trpg-workbench/
  apps/
    desktop/                     # React + Tauri 前端
      src/
      src-tauri/
    backend/                     # Python 后端
      app/
        api/                     # HTTP 路由层
        services/                # 业务服务层
        agents/                  # Agno Agent 定义
        workflows/               # Agno Workflow 定义
        knowledge/               # PDF 处理与检索
        storage/                 # SQLite + 文件操作
        models/                  # 数据模型定义（Pydantic）
        prompts/                 # Prompt Registry（M10）：load_prompt() + 各 Agent prompt 文件
        utils/
      tests/
  packages/
    shared-schema/               # 前后端共用 JSON Schema / TypeScript 类型（API contract）
    prompt-templates/
    asset-templates/
  docs/
  scripts/
```

> 若需调整 `backend/app/` 内部模块拆分（如将 `storage/` 拆为 `db/` + `fs/`），可在不破坏一级边界的前提下调整，但必须同步更新本 skill。

---

## 产品原则（禁止违背）

1. **Local-first**：第一版所有功能必须在本地可运行，不依赖云服务（调用用户配置的云模型 API 除外）
2. **结构化优先**：AI 生成结果必须是 JSON + Markdown，不接受纯长文本成品
3. **AI 是共创编辑器**：AI 输出必须可追踪、可局部修改、可查看引用与变更摘要
4. **不承诺严格规则引擎**：Rules Agent 只做建议性校验，不承诺数值绝对正确

## 第一版明确不做（遇到需求要拒绝）

- 多人协作 / 云同步
- 复杂地图编辑器
- 严格数值战斗模拟 / 规则引擎
- 插件市场 / 模板市场
- 重型富文本编辑器（Notion / Quill 风格）
- 在线 SaaS / Web 版本
- 完整玩家端 / 主持人端双端系统
