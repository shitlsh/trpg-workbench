---
status: accepted
date: 2026-04-23
source: OpenCode Desktop
theme: 首次配置引导 — 推荐默认值与 Inline Hint
priority: high
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# Inline Hint + 推荐默认值：Gemini / Jina 专属配置示例

## 来源与借鉴理由

OpenCode Desktop 在 provider 配置表单中对每个字段给出推荐值、optional/required 标注和
简短的 inline description。对复杂字段（如 model ID 格式、base_url）有 placeholder 示例。

trpg-workbench 推荐的通用模型是 Gemini，Embedding 是 Jina，但 SettingsPage 表单字段
完全没有任何说明，用户不知道填什么格式。

## 当前差距

- LLM Section：无 Gemini model_name 格式示例（`gemini-2.0-flash` vs `google/gemini-2.0-flash`）
- Embedding Section：无 Jina base_url 示例，无推荐 model 名称
- Rerank Section：无"默认不启用"说明，用户不知道这个 section 是否必填
- WorkspaceSettingsPage：模型路由选"不指定"时无任何 warning 提醒

## 适合性判断

非常适合，且实现成本极低（只需在表单字段加 placeholder、description 文字，
以及可选的"一键填入推荐值"按钮，无需新组件）。

## 推荐具体内容

**LLM Section（Gemini 推荐配置）：**
- Provider：Google
- Model Name placeholder：`gemini-2.0-flash`
- Base URL：留空（使用 Google 官方默认端点）
- "一键填入 Gemini 推荐值"按钮（预填 model_name 和 provider）
- Description：推荐用于日常创作，支持长上下文，适合 TRPG 场景

**Embedding Section（Jina 推荐配置）：**
- Model Name placeholder：`jina-embeddings-v3`
- Base URL：`https://api.jina.ai/v1`
- "一键填入 Jina 推荐值"按钮
- Description：推荐用于规则书和资产的语义检索

**Rerank Section：**
- Section 顶部加说明：`Rerank 为可选功能，默认不启用。仅在需要更精准的知识库检索时配置。`
- Empty state 修改为：`未配置 Rerank（默认跳过，不影响基础 AI 功能）`

**WorkspaceSettingsPage 模型路由：**
- 默认 LLM 选"不指定"时，旁边加 ⚠️ badge + tooltip："未指定 LLM 时，AI 功能将无法运行"

## 对创作控制感的影响

改善。用户清楚每个配置项的含义和推荐值，配置决策变得可理解，减少配置错误。

## 对 workbench 协同的影响

间接改善。减少配置错误后，Agent 面板和知识库 RAG 的成功率提升。

## 对 1.0 用户价值的影响

高优先级，且性价比极高（1-2 天工作量）。推荐模型是 Gemini，但表单无任何 Gemini 示例，
新用户大概率配错或放弃。

## 建议落地方式

- [ ] 直接改代码：修改 `apps/desktop/src/pages/SettingsPage.tsx`
  - LLM Section：加 Gemini placeholder + "一键填入推荐值" 按钮
  - Embedding Section：加 Jina placeholder + "一键填入推荐值" 按钮
  - Rerank Section：加"默认跳过"说明文字，修改 empty state
- [ ] 直接改代码：修改 `apps/desktop/src/pages/WorkspaceSettingsPage.tsx`
  - 模型路由"不指定"选项旁加 warning badge

## 不做的理由（如适用）

无。此项性价比极高，应优先于 wizard 完成（实现成本远低于 wizard）。
