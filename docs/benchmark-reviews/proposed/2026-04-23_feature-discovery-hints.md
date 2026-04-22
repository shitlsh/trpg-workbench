---
status: proposed
date: 2026-04-23
source: OpenPawz / Inscriptor
theme: 首次使用功能发现提示（Feature Discovery Hints）
priority: low
affects_creative_control: indirect
affects_workbench_collab: indirect
recommended_action: defer
---

# Feature Discovery Hints：首次使用功能提示

## 来源与借鉴理由

OpenPawz 和 Inscriptor 在用户首次进入某个功能区域时显示一次性 tooltip 或 callout，
帮助用户发现非显见功能（如拖拽、右键菜单、快捷键）。显示一次后永久消失（存于 store）。

## 当前差距

trpg-workbench 完全没有 feature discovery hint 机制。以下区域的非显见操作对新用户不透明：
- 资产树：右键菜单（新增 NPC/场景/怪物）
- Agent 面板：如何触发 Director Agent、如何确认 patch
- 知识库：RAG 何时自动介入、如何手动触发检索
- 编辑器：如何将资产拖入编辑器

## 适合性判断

适合作为 1.0 之后的迭代方向。当前阶段 wizard + inline hint 已能解决最核心的配置引导问题。
Feature hint 属于"功能发现"层，优先级低于"配置前置"层。

## 对创作控制感的影响

间接改善。用户发现更多功能后，创作控制感提升，但不是 1.0 前的核心瓶颈。

## 对 workbench 协同的影响

间接。减少用户在不同区域摸索的时间。

## 对 1.0 用户价值的影响

低优先级。1.0 前应优先保证配置不出错、AI 能跑通，而不是引导用户发现所有功能。

## 建议落地方式

- [ ] 暂缓：触发重新评估的条件
  - 用户反馈某个功能"完全不知道怎么用"（超过 2-3 次）
  - 1.0 发布后根据实际用户行为数据决定哪些区域需要 hint

## 不做的理由

当前阶段实现 feature hint 系统（需要 hint 注册机制 + store 持久化 + UI 组件）
相对于其收益不值得。配置引导（wizard + inline hint）解决的是"用不起来"的问题，
feature hint 解决的是"用不好"的问题，后者优先级更低。
