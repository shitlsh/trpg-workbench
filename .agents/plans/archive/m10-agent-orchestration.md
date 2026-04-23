# M10：Agent 编排升级、澄清式交互与 Prompt 体系化

**前置条件**：M9a 完成（规则集统一管理、知识库↔规则集绑定链路、PromptProfile 接入 Agent 运行时）

**状态：✅ 已完成（commit 2a970cb）**

**目标**：将现有的"闷头生成"模式升级为"先澄清、再执行"的协作式创作体验；将零散分布的 prompt 字符串整理为可维护的 Prompt Registry；让整个「规则集 → 提示词 → Agent → 创作物」数据流在运行时真正体现 vibe coding 感。

---

## 背景与动机

### 当前问题

M4–M9a 完成了功能链路的打通，但创作体验存在三个根本性缺陷：

**缺陷 1：Director 只会"执行"，不会"澄清"**

现有 Director 接收用户输入后直接输出 `change_plan` 进入执行流程。当用户的需求模糊（如"帮我做个调查模组"）时，Director 无法发现缺失信息，只会按最可能的解释闷头执行。这导致用户需要多轮"生成—不对—重来"才能接近目标，浪费大量 token 和时间。

**缺陷 2：Workflow 只有两个等待点（确认变更计划 + 确认 patch）**

当前 Workflow 在步骤 2（Director plan）和步骤 6（patch confirm）各有一次暂停。但在这两个点之间，所有步骤（Rules/Plot/NPC/Monster/Lore/Consistency/Document）全部自动连续执行，用户没有机会在中途补充信息、调整方向或选择选项。这与"vibe coding / AI IDE"的协作感相差甚远。

**缺陷 3：Prompt 散落在各 Agent 文件内，无法统一维护**

`DIRECTOR_SYSTEM`、`PLOT_SYSTEM`、`NPC_SYSTEM` 等字符串常量各自散落在 `director.py`、`plot.py`、`npc.py` 等文件中。同一个 prompt 涉及修改时，需要翻遍多个文件；无法对 prompt 做版本管理；无法对 clarification/planning/generation/review 等 prompt 阶段做统一编排。

### 目标体验（create_module 示例）

```
用户：帮我做一个调查模组

Director（澄清阶段）：
  我需要了解几个关键信息：
  1. 背景设定偏向哪种风格？
     A. 1920s 乡村（孤立农场、邪教、古老传说）
     B. 现代都市（失踪人口、机构秘密、网络线索）
     C. 工业废墟（超自然异变、隔离区、幸存者）
  2. 玩家人数预期？（2–3 人 / 4–5 人）
  3. 这是独立模组还是接续已有世界观？
  [ 或者，直接告诉我更多你的想法 ]

用户：选 A，4 人团，独立模组

Director（执行计划确认）：
  好的，我将创建：
  · 1920s 乡村调查模组，4 人，独立
  · 预计生成：大纲 + 3 幕 + 2 NPC + 1 怪物 + 3 地点 + 线索链
  [ 确认执行 ] [ 调整方向 ]

…执行中（流式展示步骤进度）…

Document Agent（待确认阶段）：
  已生成 12 个资产，发现 1 处一致性警告：
  · NPC "Arthur Hale" 在 act2 和 act3 名称不一致
  建议：统一使用 "Arthur Hale 镇长"
  [ 确认并保存 ] [ 手动编辑后保存 ]
```

---

## 范围

### M10 当前实现（A 类，第一优先级）

**A1：Director Clarification 机制**
- Director schema 扩展，支持 `needs_clarification` 模式
- Director 输出澄清问题（最多 3 个）和候选方向（2–3 个选项 + 推荐默认）
- 前端 AgentPanel 新增 ClarificationCard 组件
- 用户回答/选择后，answers 写入 workflow state，触发 resume

**A2：Workflow State 升级**
- `WorkflowStateORM` 补全缺失字段（`current_step`, `total_steps`, `input_snapshot`, `step_results`, `result_summary`, `error_message`）——现有 `utils.py` 已引用这些字段但 ORM 未定义，是已有 bug
- 新增 `clarification_answers` JSON 字段
- 新增 `planning_phase` 状态值 `waiting_for_clarification`
- resume 接口支持传入 `clarification_answers`

**A3：Prompt Registry**
- 建立 `apps/backend/app/prompts/` 目录结构
- 将所有 Agent 的 system prompt 从各 `.py` 文件迁移到 registry
- 区分 system / clarification / planning / generation / review 五类 prompt
- 提供统一的 `load_prompt(agent, phase, **vars)` 接口

**A4：create_module 澄清式改造**
- create_module Workflow 前置一个 clarification 阶段（step 0）
- Director 判断是否需要澄清，如需要则暂停并输出问题/选项
- 用户回答后 resume，clarification answers 注入后续所有 Agent 的 prompt

### M10 第二优先级（B 类）

**B1：modify_asset 澄清式支持**
- modify_asset 同样在 step 1（Director 识别意图）前检查是否需要澄清
- 澄清对象：目标资产模糊时（多个候选）/ 改动幅度不明时

**B2：rules_review 结构化输出升级**
- rules_review 输出从当前的纯文本建议升级为 structured JSON
- 每条建议包含：severity / type / citation / affected_field / suggestion_patch
- 前端 RulesReviewView 按 severity 分组展示，支持"一键应用"单条建议

**B3：Consistency Agent 引入 Reviewer 模式**
- 在 Consistency Agent 内引入 Agno structured outputs
- 返回更精确的 issue schema（type/severity/affected_assets/auto_fixable）
- 对 auto_fixable=true 的 issue 提供一键修复选项

### M10 后续扩展（C 类，不在本次范围内）

- 多 Agent team debate（Planner + Critic 角色分离）
- 更复杂的长链规划（多模组世界观自动构建）
- Agent 之间的异步消息总线
- Prompt A/B 测试与效果记录

---

## 非目标

- 不更换 Agno 框架，不引入 LangChain / LangGraph / CrewAI
- 不引入流式输出（SSE / WebSocket streaming），保持现有轮询模式
- 不重构前端 AgentPanel 的整体布局，只新增 ClarificationCard 组件
- 不实现 Prompt 版本管理 UI（Registry 以文件为单位版本化，不做数据库存储）
- 不实现 Prompt 在线编辑（在 M10a 或后续里程碑处理）

---

## 数据结构建议

### Director 输出 Schema 升级（A1）

**新增模式**：Director 现在可以输出两种顶层 schema，由 `mode` 字段区分：

```json
// 模式 A：需要澄清（needs_clarification = true）
{
  "mode": "clarification",
  "needs_clarification": true,
  "clarification_questions": [
    {
      "id": "q1",
      "question": "背景设定偏向哪种风格？",
      "type": "single_choice | multi_choice | free_text",
      "options": [
        { "id": "a", "label": "1920s 乡村", "description": "孤立农场、邪教、古老传说" },
        { "id": "b", "label": "现代都市", "description": "失踪人口、机构秘密、网络线索" },
        { "id": "c", "label": "工业废墟", "description": "超自然异变、隔离区、幸存者" }
      ],
      "recommended_default": "a"
    },
    {
      "id": "q2",
      "question": "玩家人数预期？",
      "type": "single_choice",
      "options": [
        { "id": "small", "label": "2–3 人", "description": null },
        { "id": "medium", "label": "4–5 人", "description": null }
      ],
      "recommended_default": "medium"
    }
  ],
  "missing_information": ["setting_style", "player_count"],
  "preliminary_plan": "基于现有信息，初步判断为一个调查型模组，待确认背景后生成详细计划"
}

// 模式 B：信息充分，直接输出执行计划（现有行为，保持兼容）
{
  "mode": "execution",
  "needs_clarification": false,
  "intent": "create_asset | modify_asset | rules_review | image_gen | query",
  "affected_asset_types": ["npc", "stage"],
  "workflow": "create_module | modify_asset | rules_review | generate_image | null",
  "agents_to_call": ["plot", "npc"],
  "change_plan": "将新增一个 NPC 并更新第一幕的线索列表",
  "requires_user_confirm": true
}
```

**判断规则**：
- 用户请求字数 < 30 字且缺少风格/规模/焦点任一信息 → 倾向 clarification
- 用户请求已明确说明风格和主要目标 → 倾向 execution
- clarification questions 最多 3 个，以最高价值优先
- 若 workspace 的 rule_set 有关联 PromptProfile，Director 可用 style_prompt 推断部分偏好，减少问题数量

### Workflow State 字段补全（A2）

**现状问题**：当前 `WorkflowStateORM` 只有 `id / workspace_id / type / status / updated_at` 五个字段，而 `utils.py` 中已经引用了 `current_step / total_steps / input_snapshot / step_results / result_summary / error_message`——这些字段在 ORM 上不存在，是 M4 遗留的已知 bug。

**M10 补全字段**（同时修复遗留 bug）：

```python
class WorkflowStateORM(Base):
    __tablename__ = "workflow_states"

    id: str                          # PK
    workspace_id: str                # FK → workspaces.id
    type: str                        # create_module | modify_asset | rules_review | generate_image
    status: str                      # planning | waiting_for_clarification | executing
                                     # | awaiting_confirmation | completed | failed
    current_step: int                # 当前步骤编号（0 = clarification 阶段）
    total_steps: int                 # 总步骤数
    input_snapshot: str              # JSON，初始用户 intent 快照（只写一次）
    clarification_questions: str     # JSON，Director 输出的澄清问题（nullable）
    clarification_answers: str       # JSON，用户回答（nullable，resume 时写入）
    step_results: str                # JSON array，各步骤结果追加
    result_summary: str              # nullable，完成后填写
    error_message: str               # nullable，失败时填写
    created_at: datetime
    updated_at: datetime
```

**Status 状态机**：

```
pending
  └─► planning                  （Director 开始分析）
        ├─► waiting_for_clarification  （Director 需要澄清，暂停等待用户）
        │     └─► executing     （用户回答后 resume）
        └─► executing           （信息充分，直接执行）
              └─► awaiting_confirmation  （所有 Agent 完成，等待用户确认 patch）
                    ├─► completed
                    └─► failed
```

### API 变更

**新增端点**：

```
POST /workflows/{id}/clarify
  body: { answers: Record<string, string | string[]> }
  作用：将用户的澄清回答写入 workflow state，更新 status → executing，触发异步 resume

GET /workflows/{id}
  （已有，补充返回 clarification_questions / clarification_answers 字段）
```

**已有端点调整**：

```
POST /workflows/{id}/confirm   （已有，语义不变，但触发时机从 step2 变为 awaiting_confirmation）
```

---

## Director Schema 升级建议（A1 详细）

### 新增 Clarification Prompt

Director 需要两个 prompt 阶段，对应 Prompt Registry 中两个文件：

1. `prompts/director/system.txt` — 原有 DIRECTOR_SYSTEM，补充澄清判断规则
2. `prompts/director/clarification.txt` — 专用于生成澄清问题的 prompt

**Clarification Prompt 核心逻辑**：
- 输入：用户原始意图 + workspace_context（含 rule_set / library_ids / style_prompt）
- 判断条件（满足任一 → 触发澄清）：
  - 用户未指明风格 / 主题 / 氛围
  - 用户未指明规模（场景数量 / NPC 数量）
  - 用户意图涉及多个资产但未明确优先级
  - 用户意图与 workspace 的 rule_set 风格明显不匹配
- 输出约束：
  - 最多 3 个问题，优先高价值（style > scale > focus）
  - 每个问题最多 3 个选项，每个选项带 1 行描述
  - 必须包含 `recommended_default`（引导用户快速决策）
  - 若 style_prompt 已暗示风格，相关问题可跳过

### Director 模式切换逻辑

```python
# director.py 新增逻辑草稿
def run_director(user_message, workspace_context, model, allow_clarification=True):
    # 第一次调用：判断是否需要澄清
    if allow_clarification:
        clarification_result = _check_needs_clarification(user_message, workspace_context, model)
        if clarification_result.get("needs_clarification"):
            return {**clarification_result, "mode": "clarification"}
    
    # 有澄清答案时，将 answers 注入 context 再走执行路径
    return _run_execution_plan(user_message, workspace_context, model)
```

---

## Workflow State 升级建议（A2 详细）

### create_module 步骤重组

**M10 后的 create_module 步骤（共 14 步）**：

```
Step 0：Clarification（可选，若 Director 判断需要则暂停）
Step 1：读取 Workspace 配置（原 Step 1）
Step 2：Director 生成执行计划，用户确认（原 Step 2，现在基于 clarification answers）
Step 3：Rules Agent 检索知识库（原 Step 3）
Step 4：Plot Agent 生成大纲（原 Step 4）
Step 5：Plot Agent 生成场景列表（原 Step 5）
Step 6：NPC Agent 生成 NPC（原 Step 6）
Step 7：Monster Agent 生成怪物（原 Step 7）
Step 8：Lore Agent 生成地点与世界观（原 Step 8）
Step 9：Plot Agent 生成线索链（原 Step 9）
Step 10：Consistency Agent 一致性检查（原 Step 10）
Step 11：Document Agent 格式化（原 Step 11）
Step 12：落盘保存（原 Step 12）
Step 13：完成（原 Step 13）
```

Step 0 只在需要澄清时启用，不影响后续步骤编号（总步骤数在 Workflow 启动时动态设置）。

### clarification_answers 注入规则

澄清答案在 resume 时被合并进 `workspace_context`，并在两个层面生效：

1. **Director 执行计划生成**（Step 2）：answers 作为附加上下文传入 Director，使 change_plan 更精准
2. **专项 Agent 调用**（Step 3–9）：answers 中与风格/主题相关的内容，作为 `[用户创作偏好]\n{answers_summary}\n\n` prefix，叠加在 style_prompt 之后、task prompt 之前注入

---

## Prompt Registry 目录结构建议（A3）

### 目录结构

```
apps/backend/app/prompts/
  __init__.py               # load_prompt() 统一入口
  _shared/
    citation_rules.txt      # 引用格式规范（所有 Agent 可引用）
    rag_injection.txt       # RAG 上下文注入格式规范
    style_prefix.txt        # style_prompt 注入的 wrapper 模板
    output_json_rules.txt   # JSON 输出约束（no markdown fence 等）
  director/
    system.txt              # Director 主 system prompt
    clarification.txt       # 生成澄清问题的 prompt
    planning.txt            # 生成执行计划的 prompt（从 clarification 结果出发）
  plot/
    system.txt              # Plot Agent system prompt
    outline.txt             # 生成大纲的 task prompt 模板
    stages.txt              # 生成场景列表的 task prompt 模板
    clues.txt               # 生成线索链的 task prompt 模板
  npc/
    system.txt
    generate.txt            # 生成 NPC 的 task prompt 模板
  monster/
    system.txt
    generate.txt
  lore/
    system.txt
    locations.txt
    lore_notes.txt
  rules/
    system.txt
    review.txt              # 规则审查的 task prompt 模板
  consistency/
    system.txt
    check.txt
  document/
    system.txt
    format_asset.txt        # 格式化资产的 task prompt 模板
```

### 统一接口

```python
# apps/backend/app/prompts/__init__.py

def load_prompt(agent: str, phase: str, **vars) -> str:
    """
    加载并渲染 prompt 模板。
    agent: "director" | "plot" | "npc" | "monster" | "lore" | "rules" | "consistency" | "document"
    phase: "system" | "clarification" | "planning" | "generate" | "review" | "check" 等
    vars: 模板变量（{style_prompt}、{premise}、{knowledge_context} 等）
    """
```

**模板格式**：使用 Python `str.format_map()` 风格的 `{variable_name}` 占位符。共享片段通过 `{{include:_shared/citation_rules.txt}}` 语法引入（在 `load_prompt` 内展开）。

### 迁移策略

**逐文件迁移，不一次性重构**：
1. 先建立目录结构和 `load_prompt()` 接口
2. 从 `director.py` 开始，将 `DIRECTOR_SYSTEM` 迁移到 `prompts/director/system.txt`，验证行为不变
3. 依次迁移 `plot.py`, `npc.py`, `monster.py`, `lore.py`, `rules.py`, `consistency.py`, `document.py`
4. 新增 `prompts/director/clarification.txt`（新 prompt，无历史包袱）

---

## 前端交互建议（A1 详细）

### 新增组件：ClarificationCard

```
┌─────────────────────────────────────────────────────┐
│ AI 需要了解几个关键信息：                              │
│                                                     │
│ 1. 背景设定偏向哪种风格？                              │
│    ○ 1920s 乡村（孤立农场、邪教、古老传说）  ← 推荐    │
│    ○ 现代都市（失踪人口、机构秘密、网络线索）           │
│    ○ 工业废墟（超自然异变、隔离区、幸存者）             │
│                                                     │
│ 2. 玩家人数预期？                                     │
│    ○ 2–3 人  ○ 4–5 人 ← 推荐                        │
│                                                     │
│ 或直接补充描述：[___________________________]         │
│                                                     │
│         [ 使用推荐默认值，直接开始 ]  [ 提交回答 ]      │
└─────────────────────────────────────────────────────┘
```

**交互细节**：
- 单选题渲染为 radio group，多选题渲染为 checkbox group，自由文本渲染为 textarea
- 每个选项的 `recommended_default` 以颜色或 "← 推荐" 标注
- "使用推荐默认值" 按钮：一键选中所有问题的 `recommended_default`，立即提交
- 提交后：ClarificationCard 折叠为只读摘要，AgentPanel 继续显示 WorkflowProgress

### AgentPanel 状态机变化

现有 AgentPanel 处理 Workflow 状态时新增一个分支：

```
workflow.status === "waiting_for_clarification"
  → 渲染 ClarificationCard（传入 clarification_questions）
  → 用户提交后调用 POST /workflows/{id}/clarify
  → 轮询 workflow 状态恢复为 "executing"

workflow.status === "planning" | "executing"
  → 渲染 WorkflowProgress（现有行为不变）

workflow.status === "awaiting_confirmation"
  → 渲染 PatchConfirmDialog（现有行为不变）
```

### shared-schema 新增类型

```typescript
// clarification
export interface ClarificationQuestion {
  id: string;
  question: string;
  type: "single_choice" | "multi_choice" | "free_text";
  options: Array<{ id: string; label: string; description: string | null }>;
  recommended_default: string | null;
}

export interface ClarificationResult {
  mode: "clarification";
  needs_clarification: true;
  clarification_questions: ClarificationQuestion[];
  missing_information: string[];
  preliminary_plan: string | null;
}

export interface ClarifyRequest {
  answers: Record<string, string | string[]>;
}

// workflow state 补全
export interface WorkflowState {
  // 现有字段
  id: string;
  workspace_id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  current_step: number;
  total_steps: number;
  // 新增字段
  clarification_questions: ClarificationQuestion[] | null;
  clarification_answers: Record<string, string | string[]> | null;
  input_snapshot: WorkflowInputSnapshot | null;
  step_results: WorkflowStepResult[];
  result_summary: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowStatus =
  | "pending"
  | "planning"
  | "waiting_for_clarification"
  | "executing"
  | "awaiting_confirmation"
  | "completed"
  | "failed";
```

---

## Todo

### P1：第一优先级（M10 核心，必须完成）

#### P1-A1：Director Clarification 机制（后端）✅ 完成

- [x] 升级 `Director` output schema，支持 `mode: "clarification" | "execution"`
- [x] 新增 `prompts/director/clarification.txt`：澄清问题生成 prompt
- [x] 新增 `prompts/director/planning.txt`：基于 clarification answers 的执行计划 prompt
- [x] `run_director()` 新增 `allow_clarification` 参数，第一次调用时判断是否需要澄清
- [x] `run_director()` 新增 `clarification_answers` 参数，resume 时将 answers 注入 context
- [x] Director fallback 处理：JSON 解析失败时保持现有 execution 模式降级逻辑

#### P1-A2：WorkflowStateORM 字段补全（后端，同时修复遗留 bug）✅ 完成

- [x] 补全 `WorkflowStateORM` 缺失字段：`current_step`, `total_steps`, `input_snapshot`, `step_results`, `result_summary`, `error_message`（`create_all` 自动建表）
- [x] 新增字段：`clarification_questions` (Text JSON)、`clarification_answers` (Text JSON)
- [x] 新增 status 值 `planning` 和 `waiting_for_clarification`
- [x] 新增 API `POST /workflows/{id}/clarify`：写入 answers，更新 status，触发异步 resume
- [x] `WorkflowSchema` 补全新字段，同步更新 `shared-schema/index.ts`
- [x] `utils.py` 的 `create_workflow` / `update_step` / `complete_workflow` / `fail_workflow` 函数签名与 ORM 对齐（现有调用已使用这些字段，补全 ORM 后需确认无错误）

#### P1-A3：Prompt Registry 建立（后端）✅ 完成

- [x] 创建 `apps/backend/app/prompts/` 目录结构（见上方目录结构）
- [x] 实现 `prompts/__init__.py` 中的 `load_prompt(agent, phase, **vars)` 接口（支持 `{{include:}}` 共享片段引入）
- [x] 迁移 `director.py`：`DIRECTOR_SYSTEM` → `prompts/director/system.txt`，验证行为不变
- [x] 迁移 `plot.py`：`PLOT_SYSTEM` → `prompts/plot/system.txt`
- [x] 迁移 `npc.py`：`NPC_SYSTEM` → `prompts/npc/system.txt`
- [x] 迁移 `monster.py`：`MONSTER_SYSTEM` → `prompts/monster/system.txt`
- [x] 迁移 `lore.py`：`LORE_SYSTEM` → `prompts/lore/system.txt`
- [x] 迁移 `rules.py`：`RULES_SYSTEM` → `prompts/rules/system.txt`
- [x] 迁移 `consistency.py`：`CONSISTENCY_SYSTEM` → `prompts/consistency/system.txt`
- [x] 迁移 `document.py`：`DOCUMENT_SYSTEM` → `prompts/document/system.txt`
- [x] 建立 `_shared/` 共享片段：`citation_rules.txt`、`rag_injection.txt`、`style_prefix.txt`、`output_json_rules.txt`
- [x] 各 Agent 调用改为通过 `load_prompt()` 获取 system prompt，确认所有现有测试（如有）通过

#### P1-A4：create_module 澄清式改造（后端 + 前端）✅ 完成

- [x] `create_module.py` 在 step 0 调用 `run_director(allow_clarification=True)`，若返回 `mode=clarification` 则：写入 `clarification_questions`，设 status=`waiting_for_clarification`，paused return
- [x] `resume_create_module()` 接收 `clarification_answers` 参数，将 answers 写入 workflow state，再调用 `run_director(allow_clarification=False, clarification_answers=answers)` 生成执行计划
- [x] clarification answers 注入专项 Agent 调用（作为 prompt prefix，格式：`[用户创作偏好]\n{answers_summary}\n\n`）
- [x] 前端 `AgentPanel.tsx`：新增 `ClarificationCard` 组件（questions + options + free_text + 推荐默认值按钮）
- [x] `AgentPanel.tsx` 新增 `waiting_for_clarification` 状态分支，渲染 `ClarificationCard`
- [x] `AgentPanel.tsx` 提交澄清回答后调用 `POST /workflows/{id}/clarify`，轮询恢复 WorkflowProgress
- [x] `shared-schema/index.ts` 新增 `ClarificationQuestion`、`ClarifyRequest`、`WorkflowStatus` 升级

### P2：第二优先级

#### P2-B1：modify_asset 澄清式支持

- [x] `modify_asset.py` 在 step 1 前加 clarification 检查（目标资产模糊 / 改动幅度不明时）
- [x] Director clarification prompt 增加 modify 场景的判断规则

#### P2-B2：rules_review structured output 升级

- [x] `rules_review.py` 输出改为结构化 JSON（每条建议含 severity / type / citation / affected_field / suggestion_patch）
- [x] `prompts/rules/review.txt` 明确输出 schema
- [x] 前端 `RulesReviewView` 按 severity 分组，每条建议可"一键应用"

#### P2-B3：Consistency Agent Structured Outputs

- [x] `consistency.py` 利用 Agno structured outputs（`response_model=`）约束输出 schema
- [x] 返回 `auto_fixable: bool` 字段，标记可自动修复的 issue
- [x] 前端对 `auto_fixable=true` 的 issue 显示"一键修复"按钮

---

## 验证步骤

### P1 验证

1. 发送模糊请求（如"帮我做个模组"）→ Workflow 进入 `waiting_for_clarification` 状态，AgentPanel 渲染 ClarificationCard，显示 2–3 个问题和选项
2. 点击"使用推荐默认值" → Workflow 自动 resume，WorkflowProgress 继续展示步骤
3. 手动选择选项后提交 → Workflow resume，后续 Agent 生成的内容风格符合所选方向（可用对比验证）
4. 发送明确请求（如"做一个 1920s 乡村调查模组，4 人团"）→ Director 判断无需澄清，直接进入 planning → executing，行为与 M9a 前相同
5. `WorkflowStateORM` 字段全部正确写入 SQLite，`utils.py` 调用无字段缺失报错
6. Prompt Registry 迁移后，每个 Agent 的输出质量与迁移前无明显差异（可对比 prompt 内容验证等价性）
7. `load_prompt()` 对所有 agent/phase 组合能正确加载并渲染模板变量
8. `clarification_answers` 在 resume 后被正确写入 workflow state，可在 GET /workflows/{id} 中查看

### P2 验证

9. modify_asset 场景：请求修改"NPC"（不指定哪个）→ 触发澄清，列出候选 NPC 列表
10. rules_review 输出为结构化 JSON，RulesReviewView 按 severity 分组渲染，单条建议可应用
11. Consistency Agent 对明确可自动修复的问题（如名称不一致）标注 `auto_fixable=true`，前端显示修复按钮

---

## 与现有架构的关键衔接点

### RAG 与 Clarification 的关系

**Clarification 阶段不触发 RAG 检索**：澄清问题仅基于 workspace_context（rule_set / existing_assets / style_prompt）生成，不需要知识库支持。这避免了在用户还未确认方向前消耗 embedding 资源。

RAG 检索从 Step 3（Rules Agent）开始，此时 clarification_answers 已就位，可以用于精化检索 query（例如：answers 包含"1920s 乡村"时，Rules Agent 的检索 query 可附加 "1920s investigation rural"）。

### Rerank 与 Clarification 的关系

不变。Rerank 仍在 Rules Agent 检索阶段按 workspace 配置决定是否启用。

### style_prompt 注入顺序（M10 后）

各专项 Agent 调用时，prompt prefix 按以下顺序叠加：

```
[创作风格约束]            ← style_prompt（来自 RuleSet PromptProfile，M9a 引入）
{style_prompt}

[用户创作偏好]            ← clarification_answers 摘要（M10 新增，仅 resume 后有值）
{answers_summary}

{task_prompt}             ← 实际任务描述
```

若 `style_prompt` 为空，跳过第一段；若无 clarification_answers（需求一开始就明确），跳过第二段。

### 与 Agno 的关系

**不更换框架，充分利用现有能力**：

- `Agent` + `system_prompt` + `agent.run(prompt)` 模式保持不变
- M10 A3（Prompt Registry）只是将 prompt 字符串从 Python 常量迁移到文件，`Agent` 的调用方式不变
- M10 P2-B3（Structured Outputs）可利用 Agno 的 `response_model=` 参数（如果 Agno 版本支持），替代手动 JSON 解析
- 不引入 Agno Team / Multi-Agent 模式（C 类，后续扩展）

---

## 与现有 Skill 的同步更新（实施前需确认）

实施完成后，以下 skill 需同步更新：

- **`agent-workflow-patterns/SKILL.md`**：
  - Director 输出 schema 新增 clarification 模式
  - Workflow status 状态机补全 `planning` / `waiting_for_clarification`
  - Prompt 引用规则改为"通过 `load_prompt()` 加载，禁止在 Agent 文件内定义 prompt 字符串常量"
  - RAG 章节补充：clarification 阶段不触发检索；clarification answers 可作为检索 query 增强
- **`trpg-workbench-architecture/SKILL.md`**：
  - 补充 `apps/backend/app/prompts/` 目录说明
  - `WorkflowStateORM` 字段列表更新

---

## 与其他里程碑的关系

```
M9a（规则集统一管理）
  └── M10（Agent 编排升级、澄清式交互与 Prompt 体系化）
        └── M11（规划中：多工作空间协作 / 模组发布包 / ...）
```

M10 完成后，整个创作流程将具备：
- "先问再做"的澄清式入口（解决 M4 的闷头生成问题）
- 所有 prompt 集中可维护（解决 M4–M5 的 prompt 散落问题）
- Workflow State 字段完整，支持中断恢复（修复 M4 遗留 bug）
- 结构化 Agent 输出，为后续自动化与质量评估打基础
