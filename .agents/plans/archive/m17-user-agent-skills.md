# M17：Workspace Skill 框架

**前置条件**：无强依赖（文件存储独立，Workflow 注入是加法；可与 M16 并行）。

**状态：✅ 已完成（commit f92ba24）**

**目标**：建立 workspace 级别的 skill 发现与加载框架，允许用户在工作区中添加 skill 文件，Agent 在 Workflow 执行时自动发现并加载匹配的 skill，从而让 workbench 具备面向未来的可扩展能力。

---

## 背景与动机

当前用户只能通过 PromptProfile 在 RuleSet 级别注入全局风格指令，无法对单个 Agent 类型设定持久化的创作框架要求。每次 Workflow 执行时，用户只能在对话中临时说明（如"NPC 必须包含神话接触程度"），无法积累。

更根本的问题是：trpg-workbench 当前没有可扩展的 Agent 能力机制。未来有人写了一个"怪物描述→风格化配图"的 skill，我们没有框架来发现和加载它。

来源：`docs/benchmark-reviews/accepted/2026-04-24_user-defined-agent-skills.md`

### 关键设计决策：文件而非数据库

Skill 存储在 workspace 数据目录下的 `skills/` 子目录中，每个 skill 是一个 Markdown 文件，
不是数据库行。原因：

- 文件可以被复制、分享、版本化，DB 行不能
- 文件格式可以随时在 frontmatter 中增加新字段（未来的 `tools:`、`hooks:` 等），不需要迁移 schema
- 与已有的 `.agents/skills/` 机制完全一致，用户和开发者共享同一套心智模型

---

## Skill 文件格式规范

```markdown
---
name: coc-npc-framework
description: CoC 7e NPC 创作框架。当创作任何 NPC 时自动应用，确保包含神话接触程度、
             职业背景、心理稳定性等关键维度。
agent_types: [npc]    # 适用的 agent 类型列表；留空或省略表示所有创作型 Agent
enabled: true
---

在创作 NPC 时，必须包含以下维度：
- 职业：NPC 在 1920s 社会中的角色
- 神话接触程度：无 / 轻微 / 深度
- 心理稳定性：正常 / 不稳定 / 已崩溃
- 线索载体：此 NPC 能揭示哪条调查线索（可为空）
```

**合法的 `agent_types` 值：** `npc`, `monster`, `plot`, `lore`, `rules`  
**留空或省略**：对所有创作型 Agent 生效（通配）

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A6：Chat 对话创建 Skill（AI 辅助生成）**

用户可以在 Chat 中用自然语言请求「帮我根据知识库内容创建一个 Skill」。Director 识别
`create_skill` 意图后，`chat.py` 在同一请求中：
1. 使用 `_build_knowledge_retriever` 检索相关知识库内容
2. 调用 `run_skill_agent(user_intent, knowledge_context, workspace_context, model)` 生成 Skill 内容
3. 调用 `workspace_skills.py` 的内部写入逻辑将 skill 落盘
4. 返回创建的 skill slug + name，并附在 assistant 消息中

新增文件：
- `apps/backend/app/prompts/skill/system.txt` — Skill Agent system prompt
- `apps/backend/app/agents/skill_agent.py` — 调用 LLM 生成 skill JSON

修改文件：
- `apps/backend/app/api/chat.py` — 处理 `create_skill` workflow，调用 skill_agent + 写文件
- `apps/backend/app/prompts/director/clarification.txt` — 加入 `create_skill` 不触发澄清规则
- `apps/backend/app/prompts/director/planning.txt` — 加入 `create_skill` intent/workflow 枚举

**A1：后端 — Skill 文件存储与 CRUD API**

Skill 文件保存在：
```
{WORKSPACE_DATA_ROOT}/{workspace_id}/skills/{skill_slug}.md
```

API 挂载在 `/workspaces/{workspace_id}/skills`：
- `GET /workspaces/{id}/skills` — 列出所有 skill（读目录，解析 frontmatter，返回元数据列表）
- `POST /workspaces/{id}/skills` — 创建 skill（写文件，slug 由 name 生成，冲突时加后缀）
- `GET /workspaces/{id}/skills/{slug}` — 读取单个 skill（返回 frontmatter + 正文）
- `PUT /workspaces/{id}/skills/{slug}` — 覆盖更新（全量替换文件内容）
- `PATCH /workspaces/{id}/skills/{slug}` — 部分更新（只改 frontmatter 字段，如 enabled）
- `DELETE /workspaces/{id}/skills/{slug}` — 删除文件

**返回格式（GET list）：**
```python
[
    {
        "slug": "coc-npc-framework",
        "name": "coc-npc-framework",
        "description": "CoC 7e NPC 创作框架...",
        "agent_types": ["npc"],
        "enabled": True,
    },
    ...
]
```

**A2：后端 — Workflow 发现与注入逻辑**

在 `workflows/utils.py` 中实现 skill 加载工具函数：

```python
def load_workspace_skills(workspace_id: str) -> list[dict]:
    """扫描 skills/ 目录，返回所有 enabled skill 的元数据（frontmatter）列表。"""

def get_skills_for_agent(workspace_id: str, agent_type: str) -> list[dict]:
    """返回适用于指定 agent_type 的 enabled skill（agent_types 匹配或为空）。"""

def inject_skills(skills: list[dict], task_prompt: str) -> str:
    """将 skill 正文内容注入 task_prompt 前面。"""
```

**workspace_context 中追加 skill 摘要：**
```python
"skills": [
    {"name": s["name"], "description": s["description"], "agent_types": s["agent_types"]}
    for s in load_workspace_skills(workspace_id)
    if s["enabled"]
]
```
Director 可据此感知当前工作区激活了哪些 skill。

**Workflow 注入点（`create_module.py` 和 `modify_asset.py`）：**
```python
# 在每个专项 Agent 调用前
skills = get_skills_for_agent(workspace_id, "npc")
task_prompt = inject_skills(skills, task_prompt)
```

注入层次顺序（不可打乱）：
```
Agent System Prompt  （全局，开发者维护）
  + style_prompt      （PromptProfile，RuleSet 级）
  + skill content     （Workspace Skill，本 milestone）  ← 新增
  + task_prompt       （运行时任务）
  + knowledge_context （RAG）
```

**A3：前端 — Workspace 设置页 Skill 管理 UI**

在 WorkspaceSettingsPage（或同等入口）新增"Skill"标签页：

- 列表展示当前工作区的所有 skill（slug + name + description 摘要 + agent_types + enabled 开关）
- 点击某条 skill 展开完整编辑（name、description、agent_types 多选、正文 textarea、enabled）
- "添加 Skill"按钮打开新建表单
- 删除带确认
- 对外文字统一用"Skill"（不翻译），避免自创中文词造成歧义

**A4：前端 — shared-schema 类型定义**

```typescript
export interface WorkspaceSkillMeta {
  slug: string;
  name: string;
  description: string;
  agent_types: string[];   // 空数组表示通配
  enabled: boolean;
}

export interface WorkspaceSkill extends WorkspaceSkillMeta {
  body: string;   // Markdown 正文（frontmatter 之后的内容）
}

export interface CreateWorkspaceSkillRequest {
  name: string;
  description: string;
  agent_types?: string[];
  body: string;
  enabled?: boolean;
}

export interface UpdateWorkspaceSkillRequest {
  name?: string;
  description?: string;
  agent_types?: string[];
  body?: string;
  enabled?: boolean;
}
```

**A5：帮助文档**

在 `apps/desktop/src/help/` 新增"Skill"帮助文章：
- 是什么 / 能做什么
- Skill 文件格式说明（frontmatter 字段解释）
- CoC NPC 框架 skill 完整示例
- 与"创作风格"（PromptProfile）的区别

### B 类：后续扩展

- **B1：开发者内置 Skill 预设**：随应用分发的内置 skill 文件（CoC/D&D 等系统），创建工作区时复制到 skills 目录。详见 `docs/benchmark-reviews/proposed/2026-04-24_builtin-agent-skill-presets.md`
- **B2：能力型 Skill（工具调用）**：frontmatter 中加 `tools:` 字段，声明 skill 可调用的工具（如图像生成 API）。Workflow 加载时执行工具调用而不只是注入文字。这是 M17 框架的自然延伸，不需要重新设计，只需扩展 frontmatter schema 和执行器
- **B3：Skill 排序与分组**：frontmatter 加 `sort_order`，UI 支持拖拽排序
- **B4：跨工作区 Skill 复制**：导出 skill 文件供其他工作区导入（本质是文件复制，UI 问题）

### C 类：明确不承诺

- 不做 skill 市场或远程分发（B4 只是本地文件操作）
- 不做 skill 版本历史（Git 跟踪 skill 文件是用户自己的事）
- 不对 skill 正文做语义验证
- Document Agent 和 Consistency Agent 不在 A 类注入范围（功能定位不符合框架指令语义）

---

## 文件结构

### 新增文件

```
apps/backend/app/api/workspace_skills.py      ← CRUD API（文件操作）
apps/desktop/src/help/skills.md               ← 帮助文档
```

### 修改文件

```
apps/backend/app/main.py                      ← 注册新 router
apps/backend/app/workflows/utils.py           ← load_workspace_skills / get_skills_for_agent / inject_skills
apps/backend/app/workflows/create_module.py   ← 各专项 Agent 调用前注入 skill
apps/backend/app/workflows/modify_asset.py    ← 同上
packages/shared-schema/src/index.ts           ← 追加 WorkspaceSkill 相关类型
apps/desktop/src/pages/WorkspaceSettingsPage.tsx (或同等入口)  ← 新增 Skill 标签页
apps/desktop/src/help/index.ts (或同等索引)   ← 注册新帮助文章
```

**无需修改：**
- `orm.py` / `schemas.py` / `database.py` — Skill 用文件存储，不需要新 DB 表

---

## 关键设计约束

### Skill 文件路径约定

```python
SKILLS_DIR = Path(WORKSPACE_DATA_ROOT) / workspace_id / "skills"
```

`WORKSPACE_DATA_ROOT` 从环境变量或应用配置读取，与现有 workspace 数据目录保持一致。
`SKILLS_DIR` 在第一次写入时自动创建（`mkdir -p`）。

### Slug 生成规则

```python
import re
def name_to_slug(name: str) -> str:
    slug = re.sub(r'[^\w\s-]', '', name.lower())
    slug = re.sub(r'[\s_]+', '-', slug)
    return slug.strip('-')
```

重复 slug 自动加数字后缀：`coc-npc-framework`, `coc-npc-framework-2`, ...

### Frontmatter 解析

使用 `python-frontmatter` 库（已在 Python 生态成熟）：
```python
import frontmatter

post = frontmatter.load(skill_path)
meta = {
    "name": post.get("name", slug),
    "description": post.get("description", ""),
    "agent_types": post.get("agent_types", []),
    "enabled": post.get("enabled", True),
}
body = post.content
```

### 注入格式

```python
def inject_skills(skills: list[dict], task_prompt: str) -> str:
    if not skills:
        return task_prompt
    blocks = [
        f"[Skill: {s['name']}]\n{s['body']}"
        for s in skills
    ]
    return "\n\n".join(blocks) + "\n\n" + task_prompt
```

---

## Todo

### A1：后端 — Skill 文件 API

- [x] **A1.1**：`apps/backend/app/api/workspace_skills.py` — 实现 GET list / POST / GET single / PUT / PATCH / DELETE，内部用 `python-frontmatter` 读写文件
- [x] **A1.2**：`apps/backend/app/main.py` — 注册 router，路径前缀 `/workspaces/{workspace_id}/skills`
- [x] **A1.3**：确认 `python-frontmatter` 已在 `requirements.txt` 中（或改用纯正则解析，视依赖策略决定）

### A2：后端 — Workflow 发现与注入

- [x] **A2.1**：`workflows/utils.py` — 实现 `load_workspace_skills()`、`get_skills_for_agent()`、`inject_skills()`
- [x] **A2.2**：`workflows/utils.py` `get_workspace_context()` — 追加 `skills` 摘要字段
- [x] **A2.3**：`workflows/create_module.py` — 在 NPC / Monster / Plot / Lore Agent 调用前注入 skill
- [x] **A2.4**：`workflows/modify_asset.py` — 在专项 Agent 调用前注入 skill

### A3：前端 — 类型定义

- [x] **A3.1**：`packages/shared-schema/src/index.ts` — 追加 `WorkspaceSkillMeta`、`WorkspaceSkill`、`CreateWorkspaceSkillRequest`、`UpdateWorkspaceSkillRequest`

### A4：前端 — UI

- [x] **A4.1**：WorkspaceSettingsPage — 新增"Skill"区块，列出当前工作区 skill，含 enabled 开关
- [x] **A4.2**：Skill 编辑表单：name + description + agent_types 多选 + body textarea + enabled
- [x] **A4.3**："添加 Skill"按钮与新建流程，删除带确认

### A5：帮助文档

- [x] **A5.1**：`apps/desktop/src/help/skills.md` — 编写 Skill 帮助文章，含 frontmatter 格式说明和 CoC NPC 示例
- [x] **A5.2**：注册到 HelpPage 文章索引

### A6：Chat 对话创建 Skill

- [x] **A6.1**：`apps/backend/app/prompts/director/clarification.txt` — 加入 `create_skill` intent/workflow 定义和不触发澄清规则
- [x] **A6.2**：`apps/backend/app/prompts/director/planning.txt` — 加入 `create_skill` intent/workflow 枚举
- [x] **A6.3**：`apps/backend/app/prompts/skill/system.txt` — Skill Agent system prompt
- [x] **A6.4**：`apps/backend/app/agents/skill_agent.py` — 实现 `run_skill_agent()`
- [x] **A6.5**：`apps/backend/app/api/chat.py` — 处理 `create_skill` workflow，调用 skill_agent + 写文件，返回 slug + name
- [x] **A6.6**：`apps/desktop/src/help/skills.md` — 新增「通过对话创建 Skill」章节

## 验收标准

1. 用户在工作区设置 Skill 标签页中创建一个 `agent_types: [npc]` 的 skill，执行 create_module Workflow 后，NPC Agent 生成结果符合 skill 中的框架约束
2. 将 skill 的 `enabled` 改为 false 后，下次 Workflow 执行不注入该 skill
3. 删除 skill 文件后，Workflow 不再注入，API 列表不再返回该 skill
4. 不存在任何 skill 的工作区，Workflow 行为与修改前完全一致（inject_skills 返回原始 task_prompt）
5. `agent_types` 为空的 skill 对所有创作型 Agent 生效
6. skill 文件在 `workspace-data/{workspace_id}/skills/` 目录中以 `.md` 文件形式存在，可手动打开查看内容
7. TypeScript 编译无错误，`WorkspaceSkill` 类型正确导出
8. **A6**：用户在 Chat 中说「帮我创建一个 CoC NPC 创作框架的 Skill」，系统自动生成并写入 skills 目录，返回的 assistant 消息包含 skill slug 和名称

---

## 与其他里程碑的关系

```
M16（AssetType 开放化）← 无依赖，已完成
M17（Workspace Skill 框架）← 本 milestone
  └── M18+（B1：内置 Skill 预设包，B2：能力型 Skill / 工具调用）
```

---

## 非目标

- 不做 skill 版本历史（无 revision 机制）
- 不做 skill 内容语义验证或质量检测
- 不为 Document Agent 和 Consistency Agent 提供 skill 注入
- 不做 skill 市场或远程安装
- B2（工具调用型 skill）的执行器留给 M18+，M17 只建立文件框架和加载路径
