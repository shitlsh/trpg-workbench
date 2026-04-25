---
status: proposed
date: 2026-04-26
source: Inscriptor, OpenPawz
theme: 三栏 UI 拖拽与聊天展示
priority: medium
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: code
---

# 三栏布局持久化 + 聊天气泡 tool call 折叠

## 来源与借鉴理由

- Inscriptor 的三栏布局支持宽度持久化、语义化的最小/最大宽度约束
- OpenPawz 的 AI 对话气泡有明确的消息类型区分、tool call 展开/收起、代码块高亮

## 当前差距

**拖拽：**
- 手写 ResizablePanel 没有 localStorage 持久化（刷新后宽度重置）
- 拖拽区域过窄（4px 碰撞区），触发不稳定
- 无键盘支持

**聊天展示：**
- tool call 参数直接裸展示（长 JSON 无折叠）
- thinking_delta 尚未实现（见 thinking-display proposal）
- system 角色消息（截断提示等）无专门样式
- 长对话无日期分隔线

## 适合性判断

适合，拖拽持久化和 tool call 折叠改动都很小但体验提升明显。替换 react-resizable-panels 是较大改动，可作为独立 UI polish 任务。

## 对创作控制感的影响

间接改善——用户能更自由地调整工作区布局以适应不同创作阶段

## 对 workbench 协同的影响

改善三栏协作体验，减少"拖拽卡顿/重置"的干扰

## 对 1.0 用户价值的影响

中，日常使用痛点，体验差但不影响核心功能。

## 建议落地方式

**Phase 1 — 直接小改（高价值，低成本）：**
- [ ] `apps/desktop/src/components/editor/ThreePanelLayout.tsx`：ResizablePanel 加 localStorage 持久化，key 格式 `panel_width_${side}_${workspaceId}`
- [ ] 将 4px 拖拽 handle 的 hover 区扩大至 8px（仍保持视觉 4px）
- [ ] `apps/desktop/src/components/agent/AgentPanel.tsx` 或 ToolCallCard：tool call 参数超 80 字符时折叠，点击展开

**Phase 2 — 中改（独立 UI polish 任务）：**
- [ ] 引入 `react-resizable-panels` 替换手写实现
- [ ] 聊天区加日期分隔线（连续对话超过 1 小时时显示时间戳分割线）
- [ ] system 角色消息用浅色分割线样式展示（用于上下文截断提示等）

## 不做的理由

Phase 1 无理由不做。Phase 2 作为 UI polish milestone 单独规划，不与功能 milestone 混合。
