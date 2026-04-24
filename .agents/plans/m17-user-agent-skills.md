# M17：用户自定义 Agent Skill

**前置条件**：无强依赖（后端新表独立，Workflow 注入是加法，不改现有逻辑；可与 M16 并行）。

**目标**：允许用户为每个 Agent 类型编写独立的创作框架指令（Skill），注入到 Workflow 执行中，让用户从"被动接受 AI 生成结果"变为"主动塑造 AI 创作框架"。

---

## 背景与动机

当前 `PromptProfile` 允许用户编写全局风格提示词，注入所有创作型 Agent。但用户无法对单个 Agent 类型（如 NPC Agent、Monster Agent）设定独立的创作维度要求。每次开始创作时，用户只能在对话中重复说明框架要求（如"NPC 必须包含神话接触程度字段"），无法持久化。

AgentSkill 是 PromptProfile 的精细化版本：粒度从 RuleSet 级全局风格，变为 Workspace × Agent 类型级创作框架指令。

来源：`docs/benchmark-reviews/accepted/2026-04-24_user-defined-agent-skills.md`

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：后端 — agent_skills 表与 CRUD API**

数据库：
```sql
CREATE TABLE agent_skills (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,   -- "npc" | "monster" | "plot" | "lore" | "rules" | "consistency"
  name TEXT NOT NULL,
  prompt_patch TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
```

API（挂载在 `/workspaces/{workspace_id}/agent-skills`）：
- `GET /workspaces/{id}/agent-skills` — 列出当前工作区所有 skill（可按 agent_type 筛选）
- `POST /workspaces/{id}/agent-skills` — 创建 skill
- `PATCH /workspaces/{id}/agent-skills/{skill_id}` — 更新（name / prompt_patch / enabled / sort_order）
- `DELETE /workspaces/{id}/agent-skills/{skill_id}` — 删除

**A2：后端 — Workflow 注入逻辑**

在 `create_module` 和 `modify_asset` Workflow 中，调用每个专项 Agent 前，查询该 Agent 类型对应的 skill 并注入 user prompt：

```python
# apps/backend/app/workflows/utils.py 或各 workflow 文件
def inject_agent_skills(db, workspace_id: str, agent_type: str, task_prompt: str) -> str:
    skills = get_enabled_skills(db, workspace_id, agent_type)
    if not skills:
        return task_prompt
    skill_block = "\n\n".join(
        f"[用户创作框架指令 - {s.name}]\n{s.prompt_patch}"
        for s in skills
    )
    return f"{skill_block}\n\n{task_prompt}"
```

注入点（每个专项 Agent 调用前）：
- NPC Agent → `agent_type = "npc"`
- Monster Agent → `agent_type = "monster"`
- Plot Agent → `agent_type = "plot"`
- Lore Agent → `agent_type = "lore"`
- Rules Agent → `agent_type = "rules"`

**A3：前端 — 工作区设置页新增 Agent Skills 标签页**

位置：WorkspaceSettingsPage（或现有工作区设置的标签页系统）

UI 结构：
- 按 agent_type 分组展示（NPC / Monster / Plot / Lore / Rules）
- 每条 skill 卡片：名称 + prompt_patch 文本域 + enabled 开关 + 删除按钮
- 每个 agent_type 分组右上角有"添加指令"按钮
- 文字标签使用"创作指令"，不出现"prompt"或"skill"技术词
- 不需要复杂编辑器，纯 `<textarea>` 足够

**A4：前端 — shared-schema 类型定义**

```typescript
export interface AgentSkill {
  id: string;
  workspace_id: string;
  agent_type: string;
  name: string;
  prompt_patch: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentSkillRequest {
  agent_type: string;
  name: string;
  prompt_patch: string;
  enabled?: boolean;
}

export interface UpdateAgentSkillRequest {
  name?: string;
  prompt_patch?: string;
  enabled?: boolean;
  sort_order?: number;
}
```

**A5：帮助文档**

在 `apps/desktop/src/help/` 补充"Agent 创作指令"使用说明：
- 是什么 / 能做什么 / 不能做什么
- CoC NPC Agent 示例（包含神话接触程度、心理稳定性等维度）
- 与"创作风格"（PromptProfile）的区别

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：RuleSet 级内置 Skill 预设**：开发者为 CoC/D&D 等系统预置内置 skill 包，创建工作区时自动激活。详见 `docs/benchmark-reviews/proposed/2026-04-24_builtin-agent-skill-presets.md`，计划进入 M18+
- **B2：Skill 排序拖拽**：当前 `sort_order` 字段已预留，UI 拖拽排序推迟实现
- **B3：跨工作区 Skill 复制**：将某工作区的 skill 导出/导入到其他工作区

### C 类：明确不承诺

- 不引入 Skill 版本管理（无 revision 历史）
- 不对 prompt_patch 内容做格式验证或质量检测
- 不为 Document Agent 和 Consistency Agent 提供 skill 注入（这两个是格式化/检查角色，注入框架指令语义不清晰）
- 不提供"skill 市场"或社区共享功能

---

## 文件结构

### 新增文件

```
apps/backend/app/api/agent_skills.py          ← CRUD API
apps/backend/app/models/agent_skill_orm.py    ← ORM 模型（或追加到 orm.py）
apps/desktop/src/help/agent-skills.md         ← 帮助文档
```

### 修改文件

```
apps/backend/app/models/orm.py                ← 追加 AgentSkillORM
apps/backend/app/models/schemas.py            ← 追加 AgentSkillSchema / Create / Update
apps/backend/app/storage/database.py          ← 追加建表语句
apps/backend/app/main.py                      ← 注册新 router
apps/backend/app/workflows/create_module.py   ← 各专项 Agent 调用前注入 skill
apps/backend/app/workflows/modify_asset.py    ← 同上
apps/backend/app/workflows/utils.py           ← 新增 inject_agent_skills() / get_enabled_skills()
packages/shared-schema/src/index.ts           ← 追加 AgentSkill 相关类型
apps/desktop/src/pages/WorkspaceSettingsPage.tsx (或同等入口)  ← 新增标签页
apps/desktop/src/help/index.ts (或同等索引)   ← 注册新帮助文章
```

---

## 关键设计约束

### 注入层次顺序（不可打乱）

```
Agent System Prompt（全局，开发者维护，prompts/*.txt）
  + style_prompt（PromptProfile，RuleSet 级，风格）
  + skill patches（AgentSkill，Workspace × Agent 级，框架）  ← 本 milestone 新增
  + task_prompt（运行时任务描述）
  + knowledge_context（RAG，运行时动态）
```

skill patches 在 task_prompt 之前注入，让框架指令比任务描述更靠近 system context。

### Workflow 注入点

- `create_module`：在 Step 6（NPC Agent）、Step 7（Monster Agent）、Step 8（Lore Agent）、Step 4/5（Plot Agent）各自调用前注入
- `modify_asset`：在 Step 3（专项 Agent 调用）前注入
- `rules_review`：在 Rules Agent 调用前注入（可选，Rules Agent 注入后注意不改变其"仅建议"性质）

### 数据库迁移

`agent_skills` 表在 `database.py` 的 `init_db()` 中用 `CREATE TABLE IF NOT EXISTS` 创建，无需单独迁移文件。

---

## Todo

### A1：后端 — 数据库与 ORM

- [ ] **A1.1**：`apps/backend/app/storage/database.py` — 追加 `agent_skills` 建表语句（`CREATE TABLE IF NOT EXISTS`）
- [ ] **A1.2**：`apps/backend/app/models/orm.py` — 追加 `AgentSkillORM` SQLAlchemy 模型
- [ ] **A1.3**：`apps/backend/app/models/schemas.py` — 追加 `AgentSkillSchema`, `AgentSkillCreate`, `AgentSkillUpdate`

### A2：后端 — API

- [ ] **A2.1**：`apps/backend/app/api/agent_skills.py` — 实现 GET / POST / PATCH / DELETE 四个端点
- [ ] **A2.2**：`apps/backend/app/main.py` — 注册 router，路径前缀 `/workspaces/{workspace_id}/agent-skills`

### A3：后端 — Workflow 注入

- [ ] **A3.1**：`apps/backend/app/workflows/utils.py` — 实现 `get_enabled_skills(db, workspace_id, agent_type)` 和 `inject_agent_skills(db, workspace_id, agent_type, task_prompt) -> str`
- [ ] **A3.2**：`apps/backend/app/workflows/create_module.py` — 在 Plot/NPC/Monster/Lore Agent 调用前注入 skill
- [ ] **A3.3**：`apps/backend/app/workflows/modify_asset.py` — 在专项 Agent 调用前注入 skill

### A4：前端 — 类型与 API

- [ ] **A4.1**：`packages/shared-schema/src/index.ts` — 追加 `AgentSkill`, `CreateAgentSkillRequest`, `UpdateAgentSkillRequest`
- [ ] **A4.2**：前端 API client — 追加 agent skills 的 CRUD 调用函数（或 TanStack Query hooks）

### A5：前端 — UI

- [ ] **A5.1**：工作区设置页 — 新增"Agent 创作指令"标签页，按 agent_type 分组展示 skill 列表
- [ ] **A5.2**：每条 skill 的展示组件：名称 + 文本域 + enabled 开关 + 删除按钮
- [ ] **A5.3**：每个 agent_type 分组的"添加指令"按钮与新建表单

### A6：帮助文档

- [ ] **A6.1**：`apps/desktop/src/help/agent-skills.md` — 编写"Agent 创作指令"帮助文章（含 CoC 示例）
- [ ] **A6.2**：注册到 HelpPage 文章索引

---

## 验收标准

1. 用户在工作区设置中为 NPC Agent 添加一条 skill（含"神话接触程度"维度要求），执行 create_module Workflow 后，NPC Agent 生成的结果包含该维度
2. 禁用（enabled=false）某条 skill 后，下次 Workflow 执行不再注入该 skill 的内容
3. 删除 skill 后，该 skill 不再出现在设置页，后续 Workflow 不注入
4. 不存在 skill 的工作区，Workflow 行为与修改前完全一致（注入函数返回原始 task_prompt）
5. 工作区设置页"Agent 创作指令"标签页正确加载、创建、编辑、删除 skill
6. `packages/shared-schema` 中 `AgentSkill` 类型导出正常，前端无 TypeScript 编译错误

---

## 与其他里程碑的关系

```
M15（知识库归属规则集）
  ├── M16（AssetType 开放化）← 无依赖关系，可并行
  └── M17（用户自定义 Agent Skill）← 本 milestone
        └── M18+（B1：开发者预置 Skill 包，待规划）
```

---

## 非目标

- 不为 Document Agent 和 Consistency Agent 提供 skill 注入
- 不引入 skill 版本历史（无 revision）
- 不做 skill 内容格式验证
- 不做跨工作区 skill 共享或导出
- 不做 RuleSet 级内置 skill 预设（B1，留给 M18+）
