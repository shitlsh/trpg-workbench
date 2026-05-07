# M34：模型配置 UX 改进

**前置条件**：无强依赖（纯前端交互改动，不依赖后端新能力；`/settings/model-catalog/probe-models` 接口在 M7 已存在）。

**目标**：消除模型配置流程中的三类核心摩擦——模型列表信息过载（Gemini 49 个）、新建时无法测试连接、WorkspaceSettings 中 provider 与 model 两控件视觉割裂——让用户能在一个页面内完整走完「选 provider → 填 Key → 验证 → 选模型 → 保存」的配置闭环。

---

## 背景与动机

基于 Playwright 截图分析（2026-05-07）与代码审查，发现模型配置 UI 存在系统性摩擦点，
详见 benchmark review proposal：
- `docs/benchmark-reviews/accepted/2026-05-07_model-config-ux-overhaul.md`

核心发现：
- Google Gemini probe 返回 49 个模型全部平铺，用户不知道选哪个
- `ModelNameInput` 在不同状态下随机渲染 `<select>` / `<datalist>` / 自定义 panel，视觉跳变
- 新建 LLM profile 时只有「保存」按钮，无法测试连接，必须先保存再编辑才能验证
- WorkspaceSettings 里 profile 下拉和 model 输入框是两个孤立控件，联动关系不可见
- `strict_compatible` checkbox 直接暴露给所有用户，认知负担高
- 「配置名称」是表单第一个字段，但用户此时尚未选择 provider，填写顺序反直觉

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：ModelNameInput — 推荐模型分组 + legacy 折叠**

为每个 LLM provider 硬编码推荐模型列表，rich picker 分两组渲染：
- **★ 推荐**：来自 `RECOMMENDED_LLM_MODELS[providerType]` 与 probe 结果的交集（probe 到则正常显示，未 probe 到则灰显但仍可选）
- **其他可用模型（N 个）**：默认折叠，点「展开全部」后显示剩余 probe 结果

推荐列表常量（初始值，可随版本迭代更新）：
```typescript
const RECOMMENDED_LLM_MODELS: Record<string, string[]> = {
  google:           ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  openai:           ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  anthropic:        ["claude-sonnet-4-5", "claude-3-5-haiku-20241022"],
  openrouter:       [], // 动态，不预设推荐
  openai_compatible: [], // 本地模型无推荐
};
```

文件：`apps/desktop/src/components/ModelNameInput.tsx`

---

**A2：ModelNameInput — 统一为单一 Combobox 形态**

删除 embedding 分支的 `<select>` 和 `<datalist>` render path（当前第 158–238 行），
所有情况（llm / embedding，有无 fetchedModels）统一使用自定义浮动 panel（rich combobox）：

- `fetchedModels.length > 0`：combobox 展示全部候选，支持推荐分组（A1）
- 无 fetchedModels 但有 `knownModels`（静态 embedding 列表）：combobox 展示 knownModels 作为初始候选
- 两者均无：combobox 展示空 panel + 提示「填写 Base URL 后点「获取模型列表」可加载可用模型」

消灭视觉跳变：probe 前后组件形态一致，只有列表内容变化。

文件：`apps/desktop/src/components/ModelNameInput.tsx`

---

**A3：Settings / Wizard — 「配置名称」移至表单末尾并自动建议**

将「配置名称 *」字段从表单顶部移到底部，字段顺序改为：
`供应商 → API Key → 模型（新增，见 A4） → 配置名称`

在 provider + model 均选定后，自动填入建议名称（用户可覆盖）：
```typescript
function suggestProfileName(provider: string, model: string): string {
  const labels: Record<string, string> = {
    google: "Gemini", openai: "OpenAI", anthropic: "Claude",
    openrouter: "OpenRouter", openai_compatible: "本地",
  };
  const shortModel = model.split("/").pop() ?? model;
  return `${labels[provider] ?? provider} ${shortModel}`;
}
```

文件：`apps/desktop/src/pages/SettingsPage.tsx`（LLMSection 模态框）、`apps/desktop/src/components/setup/WizardStep1LLM.tsx`

---

**A4：Settings 新建 LLM 模态框 — 内联 API Key 验证 + 模型选择**

新建 profile 时增加「验证 Key」按钮，调用已有的 `probe-models` endpoint（支持直接传 `api_key` + `base_url`，无需先保存）：

- API Key 输入框右侧新增「验证」按钮（loading 状态：「验证中…」）
- 验证成功：Key 输入框右侧显示 ✓，下方展开模型选择器（复用 A1/A2 改进后的 `ModelNameInput`）
- 验证失败：显示错误原因（invalid key / network error / 超时）
- 「测试连接」按钮保留在编辑模态框中（对已保存 profile 有效），不影响现有编辑流程

注意：`probe-models` 接口已支持 `?api_key=...&base_url=...` 直接传参，无需新建后端接口。

文件：`apps/desktop/src/pages/SettingsPage.tsx`（LLMSection）

---

**A5：Settings / Wizard — `strict_compatible` 折叠为高级选项**

将 `strict_compatible` checkbox 及说明文字包裹在可折叠区域，默认收起：

```tsx
<details style={{ marginTop: 4 }}>
  <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
    高级设置（遇到角色兼容问题时展开）
  </summary>
  {/* strict_compatible checkbox + 说明 */}
</details>
```

文件：`apps/desktop/src/pages/SettingsPage.tsx`（LLMSection 模态框）、`apps/desktop/src/components/setup/WizardStep1LLM.tsx`

---

**A6：WorkspaceSettings — 模型路由区域卡片化**

将「默认 LLM（profile 下拉）」和「模型名称（rich picker）」用卡片容器包裹，
明确传达"这是同一件事的两个层级"：

```
┌─ 默认 AI 模型 ──────────────────────────────────────────┐
│  供应商配置   [Gemini tw (Google) ▾]                    │
│  模型         [gemini-2.0-flash ▾]    ✓ tool JSON       │
│                                        [测试 ▶]          │
│  ⓘ 仅显示推荐模型 · 共 49 个可用                        │
└──────────────────────────────────────────────────────────┘
  前往模型配置 →
```

关键变化：
- 卡片边框把两个控件视觉上绑定为一个逻辑单元
- 供应商下拉 label 大小写修正：`(google)` → `(Google)`
- 「✓ 49 个模型」替换为「ⓘ 仅显示推荐模型 · 共 N 个可用」
- 增加内联「测试 ▶」按钮，测试当前选中 profile + model 组合的连通性
- 卡片底部加「前往模型配置 →」链接（`navigate("/settings/models")`）

文件：`apps/desktop/src/pages/WorkspaceSettingsPage.tsx`

---

**A7：Setup Wizard Step 1 — 验证后预填模型至 WizardSummary / WorkspaceSettings**

Wizard Step 1 验证 Key 成功并选定模型后，将 `(profileId, modelName)` 作为 `suggestedModel` 状态通过 `SetupWizardPage` 的 `onComplete` 回调向上传递。
Wizard Step 4（Workspace 创建）和 `WizardSummary` 接收该建议，预填 `defaultLlmModel`，使用户在工作空间创建时不必重新选模型。

状态流：
```
WizardStep1LLM.onComplete(profile, suggestedModel?)
  └─→ SetupWizardPage: llmProfile + llmSuggestedModel state
        └─→ WizardStep4Workspace: 接收 suggestedLlmModel prop，在 /workspaces POST body 中附带 default_llm_model
              └─→ Backend: /workspaces POST 支持可选 config.models.default_llm_model（已有字段）
```

文件：`apps/desktop/src/components/setup/WizardStep1LLM.tsx`、`apps/desktop/src/pages/SetupWizardPage.tsx`、`apps/desktop/src/components/setup/WizardStep4Workspace.tsx`

---

**A8：Embedding 新增模态框 — 内联验证（与 A4 对齐）**

Embedding 新增 profile 时，在 Base URL + API Key 填写后同样提供「验证」按钮，调用 `probe-models` endpoint 获取可用 embedding 模型列表，成功后展开模型选择器（替代当前的纯文本输入 + 静态 datalist），对齐 LLM A4 的体验。

注意：Rerank 新建不做内联验证（Rerank 模型列表无法通过 probe-models 获取，跳过）。

文件：`apps/desktop/src/pages/SettingsPage.tsx`（EmbeddingSection）

---

### B 类：明确不做

- **Setup Wizard provider card 图形化**：native `<select>` 改为带 Logo 的 provider card。Wizard 是一次性流程，ROI 偏低，暂缓至 1.0 后。

### C 类：明确不承诺

- **后端接口改造**：本 milestone 全部基于已有 `probe-models` endpoint，不新增后端接口。
- **Rerank 模态框重设计**：Rerank 使用频率低，不在本次改进范围内。

---

## 文件结构

### 修改文件

```
apps/desktop/src/components/
  ModelNameInput.tsx              A1/A2：推荐分组 + 统一 combobox 形态
  ModelNameInput.module.css       A1/A2：折叠区域样式（展开/收起按钮）

apps/desktop/src/pages/
  SettingsPage.tsx                A3/A4/A5/A8：配置名称移底、内联验证、高级设置折叠、Embedding验证
  WorkspaceSettingsPage.tsx       A6：模型路由卡片化

apps/desktop/src/components/setup/
  WizardStep1LLM.tsx              A3/A5/A7：配置名称移底、高级设置折叠、预填模型回调
  SetupWizardPage.tsx             A7：传递 suggestedModel 状态
  WizardStep4Workspace.tsx        A7：接收并预填 default_llm_model
```

---

## 关键设计约束

### A1/A2：Combobox 状态管理

推荐模型和 probe 结果合并后的渲染逻辑：

```typescript
type Section = { label: string; rows: MergedRow[]; collapsible: boolean };

function buildSections(
  providerType: string,
  merged: MergedRow[],
  search: string,
  onlyTools: boolean,
  onlyJson: boolean,
): Section[] {
  const recommended = RECOMMENDED_LLM_MODELS[providerType] ?? [];
  const recSet = new Set(recommended);

  const recRows = merged.filter(r => recSet.has(r.model_name) && rowPassesFilters(r, search, onlyTools, onlyJson));
  const otherRows = merged.filter(r => !recSet.has(r.model_name) && rowPassesFilters(r, search, onlyTools, onlyJson));

  const sections: Section[] = [];
  if (recRows.length > 0) sections.push({ label: "★ 推荐", rows: recRows, collapsible: false });
  if (otherRows.length > 0) sections.push({ label: `其他可用（${otherRows.length} 个）`, rows: otherRows, collapsible: true });
  return sections;
}
```

折叠状态用本地 `useState<boolean>` 控制，不持久化。

### A4：内联验证的 API 调用

使用已有 endpoint，临时传 key（不保存）：

```typescript
// 验证时调用（新建 profile 场景，无 profile id）
const params = new URLSearchParams({ base_url: form.base_url ?? "" });
if (form.api_key) params.set("api_key", form.api_key);
const result = await apiFetch<ProbeModelsResponse>(
  `/settings/model-catalog/probe-models?${params.toString()}`
);
// 成功：result.models.length > 0，result.error === null
// 失败：result.error 非空，显示给用户
```

验证状态机：`idle → verifying → success(models) | error(msg)`

### A6：大小写修正

provider_type 在 UI label 中始终首字母大写：

```typescript
const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI", google: "Google", anthropic: "Anthropic",
  openrouter: "OpenRouter", openai_compatible: "OpenAI Compatible",
};
// 用于 WorkspaceSettingsPage profile 下拉 label：
`${p.name} (${PROVIDER_DISPLAY[p.provider_type] ?? p.provider_type})`
```

---

## Todo

### A1：推荐模型分组 + legacy 折叠

- [ ] **A1.1**：`ModelNameInput.tsx` — 在文件顶部添加 `RECOMMENDED_LLM_MODELS` 常量（含 google/openai/anthropic/openrouter/openai_compatible 五个 provider）
- [ ] **A1.2**：`ModelNameInput.tsx` — 实现 `buildSections()` 函数，将 merged 列表分为「★ 推荐」和「其他可用（N 个）」两组
- [ ] **A1.3**：`ModelNameInput.tsx` — 富选择器 list 区域改为按 section 渲染，推荐组直接展示，其他组默认折叠（`<button>展开全部 N 个</button>`）
- [ ] **A1.4**：`ModelNameInput.module.css` — 添加 `.sectionHeader`、`.sectionToggle`、`.sectionCollapsed` 样式

### A2：统一 Combobox 形态

- [ ] **A2.1**：`ModelNameInput.tsx` — 删除 embedding `<select>` 分支（第 159–175 行），替换为 rich panel 渲染路径
- [ ] **A2.2**：`ModelNameInput.tsx` — 删除 embedding `<datalist>` 分支（第 177–195 行），替换为 rich panel（knownModels 作为初始候选列表）
- [ ] **A2.3**：`ModelNameInput.tsx` — 删除 llm 无 catalog 时的原生 `<select>` 分支（第 211–227 行），改为 rich panel
- [ ] **A2.4**：`ModelNameInput.tsx` — 无任何候选时，panel 内显示提示文字（「填写 Base URL 后点「获取模型列表」可加载可用模型」）
- [ ] **A2.5**：验证：`SettingsPage.tsx` 中 embedding 的 `ModelNameInput` 调用不需要改动，只改组件内部；确认 props 接口不变

### A3：配置名称移底 + 自动建议

- [ ] **A3.1**：`SettingsPage.tsx` — LLMSection 新增/编辑模态框：将「配置名称」字段从表单顶部移到最后（API Key 之后）
- [ ] **A3.2**：`SettingsPage.tsx` — 实现 `suggestProfileName(provider, model)` 工具函数，在 `testModelName` 改变时若 `form.name` 为空则自动填入
- [ ] **A3.3**：`WizardStep1LLM.tsx` — 同样将「配置名称」字段移到表单末尾
- [ ] **A3.4**：`WizardStep1LLM.tsx` — 在 provider 改变时若 name 仍为默认值则更新建议名称（避免覆盖用户已手动填写的名称）

### A4：新建时内联 API Key 验证

- [ ] **A4.1**：`SettingsPage.tsx` — LLMSection 新增模态框：新增 `verifyState: "idle"|"verifying"|"ok"|"error"` 和 `verifyError: string|null` 状态
- [ ] **A4.2**：`SettingsPage.tsx` — API Key 输入框右侧新增「验证 Key」按钮，点击时调用 `probe-models` endpoint（不保存 profile）
- [ ] **A4.3**：`SettingsPage.tsx` — 验证成功后：在 API Key 下方展开模型选择区域（`ModelNameInput`，使用 probe 返回的 models），并触发 A3.2 的名称建议
- [ ] **A4.4**：`SettingsPage.tsx` — 验证失败后：展示错误信息（在 Key 输入框下方，红色，与现有 `formError` 样式一致）
- [ ] **A4.5**：`SettingsPage.tsx` — 对于 `openai_compatible` provider（本地模型），验证按钮逻辑：若 base_url 为空禁用验证，若 base_url 已填则直接探测；不要求 api_key 非空
- [ ] **A4.6**：`SettingsPage.tsx` — 编辑模态框维持现有逻辑（「刷新模型列表」+「测试连接」），不受影响

### A5：strict_compatible 折叠

- [ ] **A5.1**：`SettingsPage.tsx` — LLMSection 模态框：用 `<details>`/`<summary>` 包裹 `strict_compatible` 区域，summary 文字「高级设置（遇到角色兼容问题时展开）」
- [ ] **A5.2**：`WizardStep1LLM.tsx` — 同样用 `<details>`/`<summary>` 包裹
- [ ] **A5.3**：确认折叠时 `strict_compatible` 的默认值仍为 `false`，不因折叠而改变保存行为

### A6：WorkspaceSettings 模型路由卡片化

- [ ] **A6.1**：`WorkspaceSettingsPage.tsx` — 将「默认 LLM」下拉 + 「模型名称」输入（含 ModelNameInput）用 `<div>` 卡片容器包裹（border、border-radius 与页面其他卡片一致）
- [ ] **A6.2**：`WorkspaceSettingsPage.tsx` — 修正 provider_type 大小写显示：使用 `PROVIDER_DISPLAY` 常量（见设计约束），替换直接使用 `p.provider_type` 的地方
- [ ] **A6.3**：`WorkspaceSettingsPage.tsx` — 「✓ N 个模型」提示改为「ⓘ 仅显示推荐模型 · 共 N 个可用」（若 probe 结果为 0 则不显示此提示）
- [ ] **A6.4**：`WorkspaceSettingsPage.tsx` — 卡片内增加内联「测试 ▶」按钮，复用已有 `/test` endpoint 调用逻辑（需 profile id + model name）
- [ ] **A6.5**：`WorkspaceSettingsPage.tsx` — 卡片底部加「前往模型配置 →」文字链接（`navigate("/settings/models")`）

### A7：Setup Wizard — 验证后预填模型至 WorkspaceSettings

- [ ] **A7.1**：`WizardStep1LLM.tsx` — `onComplete` 回调签名扩展为 `(profile: LLMProfile, suggestedModel?: string) => void`，在保存成功且用户在验证后选定了模型时传入 suggestedModel
- [ ] **A7.2**：`SetupWizardPage.tsx` — 新增 `llmSuggestedModel: string` state，在 `handleStep1Complete` 中接收并存储
- [ ] **A7.3**：`WizardStep4Workspace.tsx` — 接收 `suggestedLlmProfileName?: string` 和 `suggestedLlmModel?: string` props，在 Workspace 创建 POST body 中附带 `config: { models: { default_llm: suggestedLlmProfileName, default_llm_model: suggestedLlmModel } }`
- [ ] **A7.4**：`SetupWizardPage.tsx` — 将 `llmProfile.name` 和 `llmSuggestedModel` 传给 Step 4 的 props
- [ ] **A7.5**：`WizardSummary.tsx` — 在摘要表格中显示已选模型名称（如有），让用户确认

### A8：Embedding 新增模态框 — 内联验证

- [ ] **A8.1**：`SettingsPage.tsx` — EmbeddingSection 新增模态框：新增 `verifyState`（同 A4 状态机）和 `verifyModels: string[]` 状态
- [ ] **A8.2**：`SettingsPage.tsx` — Base URL + API Key 区域右侧新增「验证」按钮，调用 `probe-models` endpoint
- [ ] **A8.3**：`SettingsPage.tsx` — 验证成功后：`ModelNameInput` 的 `fetchedModels` 改由 `verifyModels` 提供（替代当前仅通过 `handleFetchEmbeddingModels` 手动触发的方式），统一 A2 的 combobox 形态
- [ ] **A8.4**：`SettingsPage.tsx` — 验证失败：展示错误原因，与 A4 错误样式一致

---

## 验收标准

1. **Gemini 模型分组**：进入 WorkspaceSettings 或 Settings 编辑模态框，选择 Google provider 并 probe 成功后，rich picker 顶部显示「★ 推荐」组（含 gemini-2.5-pro / gemini-2.0-flash / gemini-2.0-flash-lite），其余模型默认折叠，点「展开全部 N 个」后才显示完整列表。
2. **Combobox 统一**：在 Settings Embedding 新增模态框中，无论是否 probe 成功，模型名称区域始终显示 combobox 输入框形态，不出现原生 `<select>` 或 `<datalist>` 控件。
3. **配置名称自动建议**：在 Settings 新增 LLM 模态框中，当用户完成 Key 验证并选定模型（如 `gemini-2.0-flash`）后，「配置名称」字段自动填入「Gemini gemini-2.0-flash」，用户可手动覆盖。
4. **新建时可验证**：在 Settings 新增 LLM 模态框中，填写 API Key 后点「验证 Key」，若 Key 有效则展示可选模型列表；若 Key 无效则显示错误原因（如「API key invalid」），全程不需要先保存 profile。
5. **高级设置折叠**：Setup Wizard Step 1 和 Settings 编辑模态框中，选择 OpenAI Compatible provider 时，`strict_compatible` 区域默认隐藏在「高级设置」折叠块中，不直接展示。
6. **模型路由卡片**：WorkspaceSettings 页面中，「默认 LLM」下拉和「模型名称」输入被卡片边框包裹为一个视觉单元；provider_type 标签显示为首字母大写（如 `Google`，而非 `google`）；卡片内有「测试 ▶」按钮和「前往模型配置 →」链接。
7. **Wizard 预填模型**：完成 Setup Wizard Step 1（验证 Key + 选定模型）后，进入 Step 4 创建工作空间时，工作空间的默认 LLM 和模型名称已预填（无需用户在 WorkspaceSettings 重新选择）。
8. **Embedding 内联验证**：Settings Embedding 新增模态框中，填写 Base URL + API Key 后点「验证」，成功后模型名称选择器自动展开并显示可用模型列表（combobox 形态，与 LLM 一致）。

---

## 与其他里程碑的关系

```
M25（LLM Profile 字段瘦身，提供了 probe-models endpoint 和 ModelNameInput rich picker 基础）
  └── M34（模型配置 UX 改进，在现有组件上做交互层改进）
        └── B1（Wizard 预填模型到 WorkspaceSettings，后续可选扩展）
```

---

## 非目标

- **不新增后端接口**：全部改动基于已有 `probe-models` endpoint，不需要后端配合
- **不改动 Rerank 模态框**：Rerank 使用率低，不在本次范围
- **不做 provider card 图形化**：Setup Wizard provider 选择维持 `<select>` 形态，暂缓
- **不改动 Rerank 验证流程**：Rerank 模型无法通过 probe-models 获取，不做内联验证
- **不改动 API / 数据模型**：profile 的 schema、存储、路由逻辑均不变
