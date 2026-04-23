---
status: completed
date: 2026-04-23
completed_date: 2026-04-23
source: OpenCode Desktop / OpenPawz
theme: 首次配置引导 — Setup Wizard（分步配置向导）
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# Setup Wizard：首次启动分步配置向导

## 来源与借鉴理由

OpenCode Desktop 和 OpenPawz 均在首次启动时主动引导用户完成 provider / model 配置，
且允许跳过非必填步骤，完成后展示状态确认 summary。

trpg-workbench 的配置比单一 coding agent 更复杂（LLM + Embedding + Rerank + 工作空间模型路由），
新用户不可能自行摸索出正确的配置顺序。当前冷启动 → 空首页 → 进工作空间 → AI 调用报错
是必然出现的路径，是 1.0 前必须解决的核心体验问题。

## 当前差距

- `settingsStore` 中无 `hasCompletedSetup` 状态字段
- `App.tsx` 路由无首次启动重定向逻辑
- 无任何 wizard / stepper 组件
- 用户可以不配置 LLM 就进入工作空间并触发 AI 任务，必然报错

## 适合性判断

非常适合。分步向导是解决"配置前置复杂度"的成熟机制，且 trpg-workbench 的配置顺序
有明确的依赖关系（LLM > Embedding > Rerank），天然适合 step-by-step 呈现。

## 推荐设计方案

步骤设计（含可跳过逻辑）：

| 步骤 | 内容 | 可跳过 | 说明 |
|------|------|--------|------|
| Step 1 | 配置 LLM Profile | 是 | 推荐 Gemini，提供 placeholder 示例 |
| Step 2 | 配置 Embedding Profile | 是 | 推荐 Jina Embeddings，提供 placeholder 示例 |
| Step 3 | 配置 Rerank Profile | **默认跳过** | 标注"可选，默认不启用，仅需精准检索时开启" |
| Step 4 | 创建第一个工作空间 | 否 | 工作台核心，不可跳过 |

完成后展示 checklist summary，跳过的步骤显示"未配置，可稍后在设置页完成"。

## 对创作控制感的影响

改善。用户在开始创作前已确认 AI 配置状态，而不是在 Agent 面板调用时才发现配置缺失。

## 对 workbench 协同的影响

有。右栏 Agent 面板（依赖 LLM）和知识库 RAG（依赖 Embedding）均需正确配置才能工作。
Wizard 确保用户在进入工作空间前已完成最低配置。

## 对 1.0 用户价值的影响

高优先级，1.0 前必须解决。当前无引导 = 新用户首次运行 AI 必然失败。

## 建议落地方式

- [ ] plan：新建 milestone 或追加到当前最近的前端体验 milestone
  - 新增 `SetupWizard` 组件（stepper + skip + summary）
  - `settingsStore` 加 `hasCompletedSetup: boolean` 字段
  - `App.tsx` 加首次启动检测：若 `!hasCompletedSetup` 则重定向到 wizard 路由
  - wizard 完成后跳转首页，并展示 onboarding checklist

## 不做的理由（如适用）

无。此项对 1.0 用户价值影响高，实现复杂度中等，无理由推迟。
