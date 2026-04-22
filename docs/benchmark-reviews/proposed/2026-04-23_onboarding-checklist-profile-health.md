---
status: proposed
date: 2026-04-23
source: Inscriptor / OpenPawz
theme: 首次配置引导 — Onboarding Checklist & Profile 健康度
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: plan
---

# Onboarding Checklist + Profile 健康度指示

## 来源与借鉴理由

**Onboarding Checklist（来源：Inscriptor）：**
Inscriptor 在新项目首次打开时显示可折叠 checklist，项目初始化完成后自动消失。
比 wizard 更轻量，不打断工作流，适合"已有部分配置但未完成全部步骤"的用户。

**Profile 健康度（来源：OpenPawz）：**
OpenPawz 对每个 integration 显示 connected / disconnected / not configured 状态。
用户在工作台中能看到当前 AI 使用了哪些配置，不需要跳转到设置页确认。

## 当前差距

**Checklist：**
- 首页空状态只有一行"建议先在知识库导入规则书"，无可追踪进度的 checklist
- 用户不知道"配置完成"的标准是什么

**健康度：**
- WorkspaceSettingsPage 模型路由是纯下拉选择，无任何连接状态展示
- `settingsStore` 中 Profile 无 `lastTestResult` 字段
- 用户只能在 SettingsPage 手动点"测试连接"才能验证配置

## 推荐 Checklist 内容

```
□ 配置 LLM Profile（推荐 Gemini）           → 去配置
□ 配置 Embedding Profile（推荐 Jina）        → 去配置
□ Rerank Profile（可选，默认跳过）           → 去配置 / 跳过
□ 创建第一个工作空间                         → 去创建
□ 导入规则书 PDF（可选）                     → 去导入
```

已完成项显示 ✅，未完成项显示 ⬜ + CTA 链接。
全部必填项完成后，checklist 可折叠并标注"工作台已就绪"。

## 推荐 Profile 健康度实现（简化版）

- `settingsStore` 中每个 Profile 加 `verified: boolean`（通过连接测试后置为 true）
- WorkspaceSettingsPage 模型路由下拉项旁显示：
  - ✅ 已验证
  - ⚠️ 未验证（提示"建议先测试连接"）
  - ❌ 未配置

## 对创作控制感的影响

有。用户在启动 AI 任务前能确认"我的模型配置是健康的"，而不是运行后才报错发现。

## 对 workbench 协同的影响

间接改善右栏 Agent 面板的启动可靠性。

## 对 1.0 用户价值的影响

中等优先级。Checklist 可作为 Setup Wizard 的补充（wizard 完成后展示 summary checklist）。
健康度指示独立于 wizard，单独实现成本低，价值中等。

## 建议落地方式

- [ ] plan：追加到 Setup Wizard 同一 milestone
  - Checklist 作为 wizard 完成后的 summary，以及首页常驻（可折叠）
  - Profile 健康度：`settingsStore` 加 `verified` 字段，WorkspaceSettingsPage 加 badge 展示

## 不做的理由（如适用）

若 Setup Wizard 已完整实现（含 summary 页），checklist 可降级为 wizard summary，
不需要在首页单独实现常驻 checklist 组件。健康度指示应独立判断是否实现。
