---
status: completed
date: 2026-04-23
accepted_date: 2026-04-23
milestone: M12
source: OpenPawz
theme: agent 编排与人机协作体验
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: plan
---

# Director 规划结果应对用户可见，执行前展示意图摘要

## 来源与借鉴理由

OpenPawz 在执行复杂 Agent 任务前，会先展示"任务分解计划"让用户确认——"我打算调用哪些
能力、做哪些步骤、涉及哪些资产"。用户可以在这一步决定是否继续、是否调整范围。

对于 trpg-workbench，这个机制在 `create_module` 场景下尤为必要：一次创建模组涉及
8+ Agent、13+ 步骤，用户在启动后实际上不清楚 AI 打算动哪些东西、会创建哪些资产类型、
修改哪些已有内容。

## 当前差距

Director Agent 生成了完整的 `ChangePlan`：

```python
{
  "intent": "创建一个以 Arkham 为背景的克苏鲁模组，主线...",
  "affected_asset_types": ["plot", "npc", "location", "lore_note"],
  "agents_to_call": ["plot_agent", "npc_agent", "lore_agent"],
  "change_plan": { ... }
}
```

但这些信息**没有在前端任何地方展示**。

`create_module` 步骤 2 有一个"确认执行 / 取消"的暂停节点，但只显示"将创建以下内容"的
资产类型列表（从 Workflow state 读取），没有 Director 的 `intent`（用自然语言描述的意图）
和 `change_plan` 摘要。

更深层的问题：Director 返回的 `agents_to_call` 字段目前**未被 Workflow 代码读取**，
Agent 调用顺序是硬编码的。这意味着 Director 的规划能力被部分浪费——它规划了什么不影响
实际执行。

## 适合性判断

适合，但要控制范围：

**Phase 1（适合立即做）：** 在 `create_module` / `modify_asset` 的"确认执行"卡片中，
增加 Director 规划摘要展示：
- `intent`：一句话说明 AI 理解了什么任务
- `affected_asset_types`：预计会影响哪些资产类型
- 不要让用户修改 Agent 调用顺序（太复杂，超出范围）

**Phase 2（可推迟）：** 修复 `agents_to_call` 未被实际读取的问题，让 Director 的规划
真正影响 Workflow 执行顺序（这是 Agent 编排的架构问题，需要 `agent-workflow-patterns`
skill 参与设计）。

## 对创作控制感的影响

显著改善（Phase 1）。"AI 透明度"的核心不是让用户控制每一步，而是让用户在执行前理解整体
意图——用户确认的是"AI 理解正确了吗"，而不是盲目点击"继续"。

## 对 workbench 协同的影响

间接改善。用户在确认计划时的信心更高，后续 patch 确认的审查负担也更低——因为用户已经
预先了解了 AI 的总体意图，不需要在每个 patch 时从零猜测 AI 在做什么。

## 对 1.0 用户价值的影响

中高。`create_module` 是 trpg-workbench 最重的操作，往往需要 2-3 分钟执行。用户在
启动这个操作时应该知道自己在做什么决定，而不是点击后只能等待、无法判断是否偏离预期。

## 建议落地方式

- [ ] plan：追加到 M12 或新建 milestone
  - 后端：确保 Director 的 `intent` 和 `affected_asset_types` 写入 Workflow state（`extra_data` 字段）
  - 前端：`WorkflowProgress.tsx` 步骤 2 确认卡中，增加 Director intent 展示区域
  - `agent-workflow-patterns` skill：补充 Director 规划结果可见性规范

- [ ] 暂缓：`agents_to_call` 动态调度（Phase 2），触发条件：Director 规划逻辑稳定后，
  单独设计 Workflow 动态路由机制

## 不做的理由（如适用）

Phase 2（动态 Agent 调度）当前不应做：硬编码顺序有其稳定性价值，贸然改为动态路由会引入
大量边缘情况。应先稳定 Phase 1 的可见性改进，再讨论执行层的动态化。
