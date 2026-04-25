---
status: completed
completion_commit: 2b595b6
date: 2026-04-26
source: 用户反馈
theme: Agent 批量写入能力
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# 批量资产写入：移除 per-file 用户确认，改为直接落盘

## 来源与借鉴理由

用户反馈：当前 `asset_write` 工具一旦被调用就抛出 `PatchProposalInterrupt`，整个 agent stream 立即终止。
这意味着：
- 用户说"帮我创建三个 NPC"，Agent 只会写第一个，然后停下来等确认
- 用户 confirm 之后流程结束，第二三个 NPC 根本不会被写
- 批量创作体验完全破碎

## 当前差距

当前架构：
```
asset_write 调用
  → PatchProposalInterrupt 抛出
  → SSE stream 终止
  → 前端显示确认弹窗
  → 用户点击"应用变更"
  → POST /confirm → 单文件落盘
  → 流程结束（不继续）
```

期望架构（方案 B）：
```
asset_write 调用
  → 直接落盘（create/update）
  → 返回 {auto_applied: true, slug, action} 给 Agent
  → SSE 发出 auto_applied 事件（执行日志可见）
  → Agent 继续下一个工具调用
  → 可连续写 N 个文件
```

## 适合性判断

**适合**：trpg-workbench 的创作场景中，批量生成 NPC/场景/线索是核心用例。
当前的 per-file 确认流程是出于"防误操作"的安全设计，但实际上：
1. Agent 生成的内容不会直接覆盖无法恢复的数据（资产文件有 revision 历史）
2. 执行日志 + 文件版本已足够提供"事后审查"能力，无需 per-file 阻断
3. 用户如不满意可直接在编辑器中修改，代价可接受

**不适合 per-file confirm 的理由**：
- 创作流程被强制打断，认知负担极高
- 批量任务退化为单步执行，LLM 多次调用成本累积
- 与"AI workbench 协同"的理念背道而驰

## 对创作控制感的影响

**改善**：用户告诉 Agent 做什么，Agent 一次执行完，用户事后在编辑器中审查。
这是更自然的"委托→审查"模式，而不是"委托→每步确认"。

## 对 workbench 协同的影响

**改善右栏 Agent 面板与中栏编辑器的协同**：
- Agent 完成批量写入后，用户可在左栏资产树看到所有新资产
- 用户直接点击进编辑器审查/修改，不需要逐个在弹窗里确认

## 对 1.0 用户价值的影响

**高**：批量创作是 TRPG 创作工具的核心场景。这是 1.0 前必须解决的体验阻断。

## 建议落地方式

- [x] 直接改代码：见下方实现方案

### 实现范围

**`apps/backend/app/agents/tools.py`**：

1. `create_asset`：移除 `trust_mode` 条件分支，始终调用 `execute_patch_proposal()` 落盘，返回 `{"auto_applied": True, ...}`
2. `update_asset`：同上
3. `create_skill`：暂时保留 `PatchProposalInterrupt`（skill 模板是更高风险的写入，可分开讨论）
4. `PatchProposalInterrupt` 类保留（create_skill 仍在使用）
5. 更新 `create_asset` / `update_asset` 的 docstring，移除"此操作需要用户确认后才会实际写入磁盘"

**`apps/backend/app/agents/director.py`**：
- 无需改动（`auto_applied` SSE 事件已有处理逻辑）

**`apps/desktop/src/components/agent/AgentPanel.tsx`**：
- `auto_applied` 事件的执行日志展示已有基础实现，确认日志显示正确（action create/update + asset_name）
- `PatchConfirmDialog` 不会再被 asset_write 触发，但组件保留（create_skill 仍可能触发）

### 不需要改的部分

- `/chat/sessions/{id}/confirm/{proposal_id}` 端点保留（create_skill 仍使用）
- `PatchConfirmDialog` 前端组件保留
- `execute_patch_proposal()` 函数保留（现在直接被工具函数调用）

## 不做的理由（如适用）

当前决策：**做**，优先级高。

若未来需要重新引入确认机制（例如：用户操作了大量资产，想在批量写入前预览）：
- 可在 Agent 面板增加"批量写入前显示计划"的 plan-then-execute 模式
- 该模式属于另一个独立 proposal，不影响当前改动
