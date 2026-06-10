---
status: proposed
date: 2026-06-09
source: Inscriptor
theme: Wizard / 模型配置表单字段顺序不符合用户认知流
priority: medium
affects_creative_control: no
affects_workbench_collab: no
recommended_action: code
---

# 配置名称放在表单最后，Preset 自动填名后用户无法第一时间看到

## 来源与借鉴理由

参考 Inscriptor 的表单设计原则：**锚点字段（用于识别和区分的字段）应放在最前面**。"配置名称"是这个配置的身份标识，用户在整个工作台后续都会通过名称来选择使用哪个配置，它应该是第一个被关注的字段。

## 当前差距

`WizardStep1LLM.tsx` 的字段顺序：
1. 供应商
2. Base URL（条件渲染）
3. 高级设置（strict_compatible）
4. API Key
5. **配置名称**（最后）

`SettingsPage.tsx` LLM 编辑弹窗同样：名称在最后，且 `autoFocus={!!editTarget}` 会 focus 到最底部。

**Preset 填入的问题：**
```tsx
// WizardStep1LLM 的 Preset 按钮：
onClick={() => {
  setForm(f => ({
    ...f,
    provider_type: "google",
    name: f.name || "Gemini 2.5 Flash"  // ← 自动填名
  }))
}}
```
用户点击 Preset 快捷填入后，名称字段会被自动填为 "Gemini 2.5 Flash"，但因为名称在最底部，用户视线聚焦在上方，很容易忽略这个自动填入的值，导致所有配置都叫默认名，日后难以区分。

`WizardStep2Embedding.tsx` 同样：名称在最后，Preset 也会自动填名。

## 适合性判断

**纯字段顺序调整**，改动极小（调换 JSX 顺序），零风险。

## 对创作控制感的影响

**无直接影响**，但改善配置的可识别性，长期有助于用户管理多套配置。

## 对 workbench 协同的影响

**无直接影响**。

## 对 1.0 用户价值的影响

中等。不是阻塞性问题，但会影响配置体验整洁度。

## 建议落地方式

将「配置名称」字段上移至**供应商选择之后、API Key 之前**：

```
新顺序：
1. 配置名称 *（autoFocus，方便用户先命名）
2. 供应商
3. Base URL（条件渲染）
4. API Key
5. 高级设置（折叠）
```

Preset 填入时，名称自动填写后，光标应跳到名称字段，让用户第一时间确认或修改名称。

同样适用于：
- `WizardStep2Embedding.tsx`
- `SettingsPage.tsx` 的 LLM / Embedding / Rerank 新建弹窗

- [x] 直接改代码（JSX 字段顺序调整）：
  - `apps/desktop/src/components/setup/WizardStep1LLM.tsx`
  - `apps/desktop/src/components/setup/WizardStep2Embedding.tsx`
  - `apps/desktop/src/pages/SettingsPage.tsx`（三个 Section 的新建/编辑表单）

## 不做的理由（如适用）

N/A。
