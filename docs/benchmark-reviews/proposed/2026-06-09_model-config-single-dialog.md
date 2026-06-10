---
status: proposed
date: 2026-06-09
source: OpenPawz / OpenCode Desktop
theme: 模型配置新建流程合并为单弹窗
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# 模型配置「新建」走两个弹窗，用户感知为"弹窗套弹窗"

## 来源与借鉴理由

参考 OpenPawz 和 OpenCode Desktop 中 provider 配置的设计：填写凭据 → 触发连接验证 → 在同一界面展开模型选择，整个流程在一个面板内完成，没有跳转。

## 当前差距

`SettingsPage.tsx` 中 `LLMSection`、`EmbeddingSection`、`RerankSection` 的新建逻辑：

```tsx
// 三个 Section 的 createMutation.onSuccess 都是：
onSuccess: (newProfile) => {
  queryClient.invalidateQueries(...);
  openEdit(newProfile);  // ← 保存后立即打开编辑弹窗
}
```

这导致：
1. 用户点「新增 LLM 配置」→ 弹出表单（标题："新增 LLM 配置"）
2. 用户填完 provider + API Key + 名称，点「保存并选择模型 →」
3. **表单关闭，立刻又弹出另一个弹窗**（标题："编辑 LLM 配置"）
4. 用户在新弹窗里才能选具体模型、测试连接

**额外问题：**
- 新建弹窗里**没有**模型选择字段，编辑弹窗才有——用户不知道为什么两步才能完成
- 两个弹窗标题不同（"新增" vs "编辑"），用户会困惑："我刚才保存了吗？这是在编辑什么？"
- Embedding 新建弹窗里虽然有 `ModelNameInput`（可以先手填模型名），但保存后仍然会跳到编辑弹窗，行为不一致

**Wizard Step1 和 Settings 页行为不一致：**
- `WizardStep1LLM` 是直接在同一步骤内完成保存 + 验证（不跳弹窗）
- `SettingsPage` 是两步弹窗
- 用户在两处使用"同一功能"会有不同体验

## 适合性判断

这是**中等改动**（重构新建弹窗，在一个弹窗内分阶段展示字段），但视觉影响大，能明显消除"弹窗套弹窗"的困惑感。

## 对创作控制感的影响

**改善**。配置流程越清晰，用户越能快速完成设置进入创作状态。

## 对 workbench 协同的影响

**改善**。减少配置环节的摩擦，降低用户在模型配置页花费的认知成本，让他们更快进入工作台。

## 对 1.0 用户价值的影响

**是 1.0 前应解决的体验问题**。模型配置是用户在 wizard 之外第二高频的设置操作（换模型、加新供应商）。

## 建议落地方式

### 方案：单弹窗分阶段展示

在新建弹窗内实现两阶段 UI，无需关闭再打开：

**阶段 1（初始状态）：** 供应商 / API Key / 名称 → 点「保存并获取模型列表」

**阶段 2（保存成功后，弹窗内自动展开）：** 显示模型选择器 + 测试连接按钮，标题改为「选择模型（可选）」，底部按钮改为「完成」

关键交互逻辑：
```
新建弹窗
├── 阶段1: 填写凭据（provider / api_key / name）
│     → 点「保存并获取模型」: POST 创建 profile，拿到 profile.id
│     → 成功后：弹窗内展开阶段2（不关闭弹窗）
└── 阶段2: 模型选择（展开在同一弹窗底部）
      - 自动触发 probe，展示模型下拉
      - 测试连接按钮
      - 「完成」按钮关闭弹窗
```

这样"新增"和"编辑"在用户体验上对齐：都是在同一个弹窗内完成所有操作。

**同样适用于 Embedding 和 Rerank Section。**

- [ ] plan：进入下一个 milestone（UI 优化）
- [x] 直接改代码：
  - `apps/desktop/src/pages/SettingsPage.tsx` 的 `LLMSection`、`EmbeddingSection`、`RerankSection`
  - 新建弹窗内加 `phase: "credentials" | "model_select"` 状态，阶段2自动展开

## 不做的理由（如适用）

N/A，建议做。如果当前迭代资源紧张，最低成本的替代方案是：在新建弹窗的保存按钮旁加一行说明文字 `「保存后将引导你选择具体模型」`，让用户有心理预期（5 分钟改动，解决最大的困惑点）。
