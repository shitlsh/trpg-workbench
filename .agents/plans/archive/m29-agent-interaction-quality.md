# M29：Agent 交互质量提升

**前置条件**：无强依赖（prompt 层改动 + 轻量前端组件，不依赖 M28 的特定产出，可独立启动）。

**状态：✅ 已完成（2026-04-29）**

**目标**：修复 `ask_user` 触发率过低的问题，建立单轮对话的完成感知机制，并通过结构化 PlanCard 为批量任务提供执行前的进度预知能力。

---

## 背景与动机

本 milestone 来源于以下三个已接受的 benchmark review proposal：

- `docs/benchmark-reviews/accepted/2026-04-29_clarification-trigger-redesign.md`
- `docs/benchmark-reviews/accepted/2026-04-29_turn-completion-visibility.md`
- `docs/benchmark-reviews/accepted/2026-04-29_agent-todo-list-visibility.md`

**核心问题**：

1. **ask_user 触发率接近零**：system.txt 中「可以通过合理假设后在回复中说明」的兜底禁止规则，导致 Director 几乎永远走「自行假设 + 文字说明」路径，`QuestionCard` 组件有但无效。

2. **单轮完成感知缺失**：用户无法清晰感知「Director 这一轮做了什么、做完了吗」——完成状态只能从文字流中猜测。

3. **批量任务缺乏进度感知**：对于「创建 3 个 NPC + 2 个场景」类请求，用户不知道 Director 是否完整理解了任务，且没有任何任务计划展示。成熟产品（Manus、OpenPawz）均已有类似机制。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：重写 ask_user 触发规则**

修改 `apps/backend/app/prompts/director/system.txt` 的 ask_user 调用规范段落，将触发逻辑扩展为两类：

**A1.1 信息量不足型（新增）**：当用户请求的信息量低于创作最低门槛时必须调用 ask_user：
- 只提供资产类型，没有任何内容方向（如「帮我创建一个 NPC」）
- 只提供动作，没有提供对象（如「帮我扩展一下」而未指定资产）
- 描述模糊到任何合理假设都会导致结果方向完全不同

**A1.2 关键分叉型（原有，修订兜底条款）**：删除「问题可以通过合理假设后在回复中说明」的兜底禁止规则，改为：假设错误的修改成本较低（短文本措辞调整）可假设后说明；假设错误会导致整体方向偏差（资产类型、核心背景、阵营）时，应先问。

**A1.3 常见资产类型最低信息量清单**：在 system.txt 中为常见资产类型定义创作最低必要信息字段，供「信息量不足型」触发判断使用：
- NPC：名字 + 阵营/关系定位 + 至少一个背景元素
- 场景：地点名称 + 时代/风格背景
- 线索：关联事件/角色 + 揭示内容方向
- 怪物：战斗角色定位 + 外形风格

---

**A2：单轮完成回复规范**

修改 `apps/backend/app/prompts/director/system.txt`，增加「完成回复规范」约束段落：

每轮对话结束时，在文字回复中包含结构化的「已完成操作」列表：

```
**已完成：**
- [动作] [资产名]（如：创建了 NPC「白狐」）
- [动作] [资产名]（如：修改了场景「幽暗森林」的背景描述）
```

若发现一致性问题需提示用户，追加「注意事项」段落。若本轮无写入操作，不输出「已完成」段落。

---

**A3：结构化 PlanCard（`<plan>` 标签解析 + 实时步骤状态）**

采用「路径 B：Prompt 内联输出」方案，无额外 LLM 调用，无额外延迟。

**A3.1 Prompt 层**：修改 `apps/backend/app/prompts/director/system.txt`，要求 Director 在执行批量任务（≥3 个独立写入操作）前，在第一段文字输出中先输出 `<plan>` 标签包裹的 JSON 步骤列表：

```
<plan>
[
  {"id": "s1", "label": "创建 NPC「白狐」"},
  {"id": "s2", "label": "创建 NPC「铁面人」"},
  {"id": "s3", "label": "创建场景「幽暗森林」"}
]
</plan>
```

`<plan>` 标签内容不渲染为普通文字，由后端解析后作为 `agent_plan` SSE 事件推送。

若模型未输出 `<plan>` 标签（弱模型降级），前端静默退化，不渲染 PlanCard，不影响正常使用。

**A3.2 后端解析**：在 `apps/backend/app/agents/director.py` 的 `text_delta` 处理块中新增 `<plan>` 标签状态机（类似现有 `<think>` 标签解析）：
- 检测到 `<plan>` 开始：进入 plan 缓冲模式，text_delta 不向前端转发
- 检测到 `</plan>` 结束：解析 JSON，yield `agent_plan` SSE 事件，记录 `_plan_steps` 和 `_plan_step_cursor`
- 每个 `tool_call_start` 到达：按顺序映射更新对应步骤状态为 `running`，yield `agent_plan_update`
- 每个 `tool_call_result` 到达：更新对应步骤状态为 `done`（或 `error`），游标前移

**A3.3 SSE 事件透传**：在 `apps/backend/app/api/chat.py` 的 `_event_generator` 中透传 `agent_plan` 和 `agent_plan_update` 两类事件（不持久化）。

**A3.4 前端渲染**：
- `packages/shared-schema/src/index.ts`：新增 `AgentPlan`、`AgentPlanStep`、`AgentPlanUpdate`、`SSEAgentPlan`、`SSEAgentPlanUpdate` 类型
- `apps/desktop/src/components/agent/AgentPanel.tsx`：`StreamEvent` union 新增 `plan` 和 `plan_step_update` 两种事件类型；SSE 解析新增 `agent_plan` 和 `agent_plan_update` 分支；`StreamingBubble` 渲染新增 `PlanCard`
- 新建 `apps/desktop/src/components/agent/PlanCard.tsx`：展示步骤列表，每步显示序号 + 描述 + 状态图标（○ pending / ⟳ running / ✓ done / ✗ error）；`done` 事件后组件变为只读最终态

**步骤状态映射策略**：采用顺序映射（第 N 个 `tool_call_start` → 更新第 N 个步骤），不依赖 LLM 在参数中注入 step_id，接受步骤数量偶尔不匹配的边界情况（多余步骤保持 pending，多余工具调用不更新 plan）。

> **A3 fallback**：若 `<plan>` 标签解析失败或模型未输出，A2 的「已完成：」文字列表作为兜底，保证用户始终有完成感知。A3 是 A2 的增强，不是替代。

---

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：前端结构化「本轮操作摘要」组件**：在 `done` 事件处理后，从本轮 `tool_call_result` 事件提取所有 `workspace_mutating: true` 的操作，在 AssistantMessage 底部渲染可点击的摘要徽章（资产名 + 操作类型，点击跳转到资产）。比 A2 的文字方案更精准，但需要持久化额外元数据。
- **B2：PlanCard 步骤精确 ID 映射**：要求 Director 在工具调用参数中携带 `step_id`，实现精确的步骤 ↔ 工具调用映射，替代当前的顺序映射方案。需要修改 system prompt + LLM 遵循率保证。

### C 类：明确不承诺

- 不引入独立的预规划 LLM 调用（路径 A），避免额外延迟和 token 消耗
- 不引入 `report_completion` 工具（会增加 LLM token 开销，且容易被错误调用）
- 不引入「执行前强制用户确认计划」机制（会显著降低流畅度）
- 不修改 `AgentQuestionInterrupt` 后端逻辑和 `QuestionCard` 前端组件（这两个已正确实现）
- PlanCard 不持久化（`done` 后清空，页面刷新后不重建，仅作流式 UI 元数据）

---

## 文件结构

### 修改文件

```
apps/backend/app/prompts/director/system.txt
  — A1：重写 ask_user 触发规则段（约 20 行替换）
  — A2：新增「完成回复规范」段落（约 12 行）
  — A3.1：新增 <plan> 标签输出规范（约 15 行）

apps/backend/app/agents/director.py
  — A3.2：新增 <plan> 标签状态机 + agent_plan/agent_plan_update yield（约 +50 行）

apps/backend/app/api/chat.py
  — A3.3：透传 agent_plan / agent_plan_update 事件（约 +8 行）

packages/shared-schema/src/index.ts
  — A3.4：新增 AgentPlan 相关类型定义（约 +30 行）

apps/desktop/src/components/agent/AgentPanel.tsx
  — A3.4：StreamEvent union 扩展 + SSE 分支 + StreamingBubble 渲染（约 +70 行）
```

### 新建文件

```
apps/desktop/src/components/agent/PlanCard.tsx
  — A3.4：步骤列表组件，约 120 行
```

---

## 关键设计约束

### A1 触发规则设计

`ask_user` 的触发规则区分两类场景，均满足才可触发：

```
触发类型 A（信息量不足）：
  条件：用户请求 + 工作空间上下文 → 缺少最低必要信息，无法开始创作
  动作：ask_user（收集最少必要信息，问题聚焦于"缺什么"而非"选哪个"）

触发类型 B（关键分叉）：
  条件：方向明确，但存在影响整体结果的关键分歧，且假设错误修改成本高
  动作：ask_user（最多 2 个问题，聚焦分歧点）

禁止触发（修订版）：
  - 仅为礼貌确认
  - 对话历史中已有足够信息可推断
  - 规则集/工作空间配置已能决定方向
  - 假设错误的修改成本较低（短文本措辞、格式调整、描述措辞等）
```

### A3 `<plan>` 标签解析约束

- `<plan>` 标签只出现在回复文字的**最开始**，不出现在工具调用之后
- 标签内容必须是合法 JSON 数组，解析失败时静默忽略（不 raise，不中断流）
- `<plan>` 内容不转发为 `text_delta`（用户不应看到原始 XML）
- `agent_plan` 事件不写入 `chat_messages` 持久化表
- `agent_plan_update` 是增量事件，前端按 `plan_id + step_id` 匹配更新

### A3 顺序映射边界情况

```
步骤数 > 工具调用数：多余步骤保持 pending 状态（计划未完全执行）
步骤数 < 工具调用数：多余工具调用不更新 plan（游标越界后停止）
工具调用失败（error）：对应步骤标为 error，游标仍前移
```

---

## Todo

### A1：重写 ask_user 触发规则

- [x] **A1.1**：`apps/backend/app/prompts/director/system.txt` — 将「ask_user 调用规范」段落重写为包含「信息量不足型」和「关键分叉型」两类触发规则的新版本
- [x] **A1.2**：`apps/backend/app/prompts/director/system.txt` — 删除「问题可以通过合理假设后在回复中说明」兜底禁止条款，替换为「按修改成本高低判断」的精确规则
- [x] **A1.3**：`apps/backend/app/prompts/director/system.txt` — 新增常见资产类型最低信息量清单（NPC/场景/线索/怪物四类）

### A2：单轮完成回复规范

- [x] **A2.1**：`apps/backend/app/prompts/director/system.txt` — 新增「完成回复规范」段落，约束每轮对话结束时的「已完成」列表输出格式

### A3：结构化 PlanCard

- [x] **A3.1**：`apps/backend/app/prompts/director/system.txt` — 新增 `<plan>` 标签输出规范，约束 Director 在批量任务前输出 JSON 步骤列表的格式和触发条件
- [x] **A3.2**：`apps/backend/app/agents/director.py` — 新增 `<plan>` 标签解析状态机（`_in_plan`、`_plan_buf`、`_plan_steps`、`_plan_step_cursor` 等变量），在 `text_delta` 处理块中解析，在 `tool_call_start` 和 `tool_call_result` 分支中 yield `agent_plan_update`
- [x] **A3.3**：`apps/backend/app/api/chat.py` — 在 `_event_generator` 中透传 `agent_question`（原先缺失）、`agent_plan` 和 `agent_plan_update` 事件（不持久化）
- [x] **A3.4**：`packages/shared-schema/src/index.ts` — 新增 `PlanStepStatus`、`AgentPlanStep`、`AgentPlan`、`AgentPlanUpdate`、`SSEAgentPlan`、`SSEAgentPlanUpdate` 类型；更新 `SSEEventType` union 和 `SSEEvent` union
- [x] **A3.5**：`apps/desktop/src/components/agent/AgentPanel.tsx` — `StreamEvent` union 新增 `plan` 种类；SSE 解析新增 `agent_plan` / `agent_plan_update` 分支（含步骤状态 immutable 更新逻辑）；`StreamingBubble` 新增 `PlanCard` 渲染分支；`done` 事件处理时 plan 事件不计入正文 content
- [x] **A3.6**：新建 `apps/desktop/src/components/agent/PlanCard.tsx` — 步骤列表组件，支持 pending/running/done/error 四种状态图标，`done` 后变为只读最终态（顺带发现并修复了 `agent_question` 在 chat.py 中缺少透传分支的 bug）

---

## 验收标准

1. **ask_user 触发测试（信息量不足型）**：发送「帮我创建一个 NPC」（无任何额外信息），Director 应触发 `ask_user`，前端渲染 `QuestionCard`，而不是直接生成内容。
2. **ask_user 不过度触发测试**：发送「帮我给白狐加一段关于背叛的经历」（有具体资产名和方向），Director 不应触发 `ask_user`，直接执行。
3. **完成回复测试**：执行任何写入操作后，Director 的文字回复中应包含「已完成：- [动作] [资产名]」格式的列表。
4. **PlanCard 触发测试**：发送「帮我创建 3 个风格各异的 NPC」（使用支持 `<plan>` 格式的强模型），Agent 面板应在工具调用开始前渲染 PlanCard，每个步骤随工具调用推进实时更新状态。
5. **PlanCard 降级测试**：使用不遵循 `<plan>` 格式的弱模型时，前端不渲染 PlanCard，但 A2 的「已完成：」文字列表正常出现。
6. **无写入操作测试**：发送问答型消息（如「白狐是什么阵营？」），Director 回复中不应出现「已完成：」段落，也不应出现 PlanCard。

---

## 与其他里程碑的关系

```
M23（Agent 澄清问题机制，已完成）
  — 建立了 ask_user 工具 + QuestionCard 完整基础设施
  └── M29（Agent 交互质量提升，本 milestone）
        — 修复 ask_user 触发率，新增 PlanCard 机制
        ├── B1：前端结构化操作摘要组件（后续）
        └── B2：PlanCard 步骤精确 ID 映射（后续）
```

---

## 非目标

- 不修改 `ask_user` 工具的后端实现（`tools.py` 中的 `AgentQuestionInterrupt` 逻辑已正确）
- 不修改 `QuestionCard.tsx` 前端组件（UI 实现已正确，问题在 prompt 层）
- 不修改 `max_tool_rounds = 12` 的上限（这是合理的兜底机制）
- 不持久化 PlanCard 内容（仅作流式 UI 元数据，刷新后不重建）
- 不引入独立预规划 LLM 调用（避免额外延迟和 token 消耗）
- 不为「输出验收」引入自动化测试（LLM 输出的 acceptance testing 超出当前范围）
- 不引入「强制用户确认计划后再执行」的 UX 模式
