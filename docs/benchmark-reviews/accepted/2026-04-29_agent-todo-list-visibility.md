---
status: proposed
date: 2026-04-29
source: Manus (leaked-system-prompts), OpenPawz, Inscriptor
theme: Agent 编排与人机协作体验
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# Agent 执行 TODO List 的生成与 UI 显示

## 来源与借鉴理由

**Manus system prompt**（leaked-system-prompts）有一个明确的「plan before execute」机制：
Agent 在开始执行复杂任务前会先生成一个步骤列表（以 `<plan>` XML 标签包裹），
用户可以看到「Agent 准备做哪些步骤」，并且每个步骤完成后有状态更新（✓ / 进行中 / 待处理）。

这个设计解决了一个核心感知问题：**用户不知道 AI 打算做多少工作、当前进行到哪一步。**

**Inscriptor** 在「长内容生成」流程中展示了类似的「生成大纲 → 逐步填充 → 完成标记」模式，
用户在任何时刻都能感知进度，而不是盯着光标闪烁等待。

## 当前差距

### 当前 Agent 面板的进度感知

用户目前能看到的「进度」：
- 工具调用卡（ToolCallCard）的 `running` 状态图标（转圈）→ `done`（勾）
- 每个工具调用是独立的，相互没有层级关系
- 用户无法提前知道「还有几步」

### 缺失的信息层

对于复杂请求（如「帮我为这次会话创建 3 个 NPC、2 个场景和一套线索链」），
当前体验是：工具调用卡一个个弹出，用户不知道 AI 有没有完整理解请求，
也不知道「3 个 NPC」这个数字 AI 是否记住了。

### TODO list 功能现状

整个系统中 TODO list 功能**完全不存在**：
- 后端 prompt 没有「生成计划列表」的指令
- 前端没有 TodoList 或 StepList 组件
- Director 没有「先列出步骤再执行」的工作模式

## 适合性判断

**适合，但需要区分场景**。TODO list 对以下场景有明确价值：
- 「批量创建多个资产」的请求（用户需要知道 AI 打算创建几个、创建哪些）
- 「有依赖关系的多步骤任务」（如：先创建地点，再创建在这个地点的 NPC）

对以下场景没有价值或有副作用：
- 简单的单步骤请求（显示一个只有一条的 TODO list 反而让界面更嘈杂）
- 问答型交互（不需要 TODO list）

## 对创作控制感的影响

**改善**。用户在 AI 开始执行前看到「任务列表」，相当于在执行前得到了一次
「这是我的计划，你确认吗」的机会（即使不强制确认，视觉上也给了用户参与感）。

## 对 workbench 协同的影响

改善「右栏 Agent 面板」的内部信息结构。
当前 Agent 面板的信息层次是：消息流 → 工具卡（平铺）。
引入 TODO list 后：消息流 → 任务计划（有层级）→ 工具卡（归属到具体步骤下）。

这让用户更容易理解「这个工具调用是为了完成哪个步骤」。

## 对 1.0 用户价值的影响

**中等**。1.0 前不阻塞，但对于「批量创建类」任务（这在 TRPG 工作台中非常常见）
体验差距很明显。建议在 1.1 或单独的「Agent 体验提升」milestone 中实现。

## 设计方案

### 方案 A：Prompt 层声明性计划（轻量）

在 system.txt 中增加规则：当请求涉及 3 个以上独立操作时，
在回复开头输出一个 Markdown 格式的任务计划，然后开始执行。

```markdown
**本轮计划：**
- [ ] 创建 NPC「白狐」
- [ ] 创建 NPC「铁面人」
- [ ] 创建场景「幽暗森林」
```

执行完后再在回复末尾输出完成状态（前述「完成总结」方案 A 的延伸）。

优点：实现成本极低，前端无需改动。
缺点：这只是 AI 写的 Markdown 文字，没有实时更新（任务完成时不会自动打勾）。

### 方案 B：结构化 TODO SSE 事件（中等成本）

设计新的 SSE 事件 `agent_plan`，在 Director 开始执行前 yield 一个步骤列表，
每个步骤有 `id`、`description`、`status`（pending/running/done/skipped）。
后续每个工具调用完成时发送 `agent_plan_update` 事件更新对应步骤的状态。

前端在 Agent 面板的流式气泡中渲染一个 `PlanCard` 组件，实时更新每个步骤的状态。

优点：实时更新、视觉效果好、用户体验最佳。
缺点：实现成本较高，需要：
  - Director 的 plan 生成逻辑（或 LLM 工具调用）
  - 新的 SSE 事件类型
  - 前端 PlanCard 组件
  - 步骤 ID 与工具调用的映射关系（技术难点）

### 方案 C：基于现有工具调用卡的分组

不新增 TODO list，而是让工具调用卡支持「分组」——当 Director 在执行批量任务时，
用一个折叠的「任务组」卡片包裹相关的工具调用（如「创建 NPC 白狐」下面包含
`check_consistency`、`create_asset` 两个工具卡）。

优点：复用现有组件（ToolCallCard），改动范围较小。
缺点：需要 Director 在执行前声明任务组结构（prompt 改动），
      前端需要支持嵌套工具卡渲染（组件改动）。

**建议路径**：先实现方案 A（验证 LLM 是否稳定生成计划格式），
再根据效果评估是否值得投入方案 B 或 C。

## 建议落地方式

- [ ] **直接改代码（方案 A 验证）**：在 `apps/backend/app/prompts/director/system.txt`
  增加「批量任务计划输出」规则（约 8 行），测试 LLM 输出稳定性
- [ ] **plan（方案 B 完整实现）**：如果方案 A 验证有效，在下一个 milestone 中
  设计 `agent_plan` SSE 事件 + 前端 `PlanCard` 组件的完整实现
  - 后端：`apps/backend/app/agents/director.py`（新增 plan yield）
  - 前端：新建 `apps/desktop/src/components/agent/PlanCard.tsx`
  - 类型：`packages/shared-schema/src/index.ts`（新增 AgentPlan 相关类型）

## 不做的理由（方案 B 暂缓）

方案 B 要求 Director 在执行前「知道自己要执行哪些步骤」，
但当前 Director 是 reactive tool-calling 模式——它不预先规划，而是边推断边执行。
要让它在执行前输出完整的步骤列表，需要先引入一个「planning pass」，
这会显著增加 token 开销和延迟。1.0 前不引入，先用轻量方案验证价值。
