---
status: accepted
date: 2026-05-07
source: OpenPawz / OpenCode Desktop
theme: 模型配置与 provider 抽象 — UX 全面改进
priority: high
affects_creative_control: indirect
affects_workbench_collab: indirect
recommended_action: plan
---

# 模型配置 UX 全面改进

> 本 proposal 基于 Playwright 实际截图分析（2026-05-07），对照
> OpenPawz 和 OpenCode Desktop 的 provider/model 配置交互模式，
> 提出可落地的具体改进方案。截图位于：
> `/var/folders/rb/c8h2n4gx7dvgpj89sg9_5srr0000gn/T/opencode/shots/`

---

## 来源与借鉴理由

**主参考：OpenPawz**
OpenPawz 在"provider 配置 → 模型选择 → 验证"这条链路上做到了：
- 选完 provider 就能在同一屏选模型（无二次跳转）
- API Key 验证是即时内联的，而不是"先保存再测试"
- 模型下拉按用途分组（Chat / Embedding / Completion），不是一个无序平铺列表
- provider card 选择代替 native `<select>`，有品牌 Logo 和描述

**补充参考：OpenCode Desktop**
OpenCode 的 provider 配置页面做到了：
- 新增 provider 时，Key 验证和模型 fetch 是同一步骤的两个子动作，完成后直接进入可选状态
- 已配置的 provider 在列表上直接显示"当前模型"，而不是只显示名字和 Key 状态

---

## 当前差距（基于截图逐点分析）

### 截图 01：Setup Wizard Step 1 (LLM)

**观察到的问题：**

1. **供应商是 native `<select>`（「Google」下拉框）**
   — 宽度占满表单，但只有 4 个选项，视觉重量与信息量不成比例
   — 没有品牌差异化：OpenAI / Google / OpenRouter / OpenAI Compatible 看起来完全相同
   — 「OpenAI Compatible（含本地模型）」这个标签太长，在 select 里截断

2. **「此步骤只配置供应商凭据，模型名称在工作空间设置中单独选择」**
   — 这句话是对"跨步骤心智链接"的文字补偿，本质上是用 copy 来弥补流程断裂
   — 用户完成 Step 1 后仍然不清楚自己最终会用什么模型

3. **「配置名称」字段是第一个输入**
   — 用户对"配置名"毫无概念（还没选 provider），这时要填名字是反向的
   — 实际上名字应该是最后一步（选完 provider + 模型后自动建议）

4. **两个 preset 提示卡片（Gemini / LM Studio）布局紧凑但信息重复**
   — 提示文本和按钮传达的意思完全相同，卡片没有比 placeholder 更好
   — 按照截图，LM Studio preset 点击后才展示出 Base URL、strict_compatible、API Key 等字段
   — 但这几个"进阶字段"的出现没有视觉层级，与基础字段完全平铺

### 截图 05/06：Settings 新增 LLM 模态框

**观察到的问题：**

5. **新增 profile 时完全没有"测试连接"功能**
   — 截图 05 中：新增模态框只有「取消」和「保存」按钮
   — 测试连接只在编辑已有 profile 时出现（截图 08）
   — 用户心智：填完 API Key → 想立即验证是否有效 → 没有测试按钮 → 只能盲保存 → 再回来编辑测试
   — 这是一个明确的"操作流程断裂"，参考 OpenPawz 都是"填 Key → 立即测试"

6. **「测试用模型名称」是一个专用字段，概念奇怪**
   — 截图 08：编辑模态框里有"配置名称"、"供应商"、"API Key"，然后是"测试用模型名称"
   — 这个字段名传达的意思是：「我只是用来测试的，不算真实配置」
   — 但实际上用户在这里选的模型，正好就是他们接下来想用的模型
   — 字段名误导了用户，应该直接叫「默认模型」或「选择模型」

7. **「已从供应商获取 9 个模型 / ✓」反馈位置不好**
   — 截图 08 底部有「✓ 已从供应商获取 9 个模型」，但这个信息在模态框下半部分，容易被忽略
   — 模型列表的"已获取"状态和模型名称输入框之间没有视觉关联

### 截图 07：OpenAI Compatible 展开状态

**观察到的问题：**

8. **「角色兼容模式 / strict_compatible」是面向开发者的高级选项，直接暴露**
   — 截图 07 显示选 OpenAI Compatible 后出现：Base URL、角色兼容模式（带 checkbox）、API Key
   — 「strict_compatible（将 `developer` / `latest_reminder` 映射为 `system`）」这句话新用户完全无法理解
   — 这类高级选项应该收折（默认隐藏），只有在用户遇到问题时才展开

### 截图 14/15：Workspace Settings 模型路由

**观察到的问题：**

9. **「默认 LLM」下拉和「模型名称」输入框是两个完全独立的视觉区域**
   — 截图 14：先有「默认 LLM（用于创建模组...）」下拉选 provider profile
   — 截图 15：选完 provider 后，下方才出现「模型名称」输入框（`gemini-3-flash-preview`）
   — 这个联动是隐藏的——用户不知道选 profile 之后会出现模型输入框
   — 而且「模型名称」是独立的文本输入（带 rich picker），与上方的 provider 下拉视觉上没有关联

10. **「✓ 49 个模型」出现在模型名称输入框下方**
    — 这个 49 指的是 Google Gemini 返回了 49 个模型，对用户来说是信息过载
    — 用户不需要知道有多少个模型，他们需要知道「我应该选哪个」

11. **模型路由区域没有「测试」入口**
    — 选好 provider + model 之后，没有办法直接验证这个配置是否可用
    — 用户必须回到 Settings → 找到对应 profile → 编辑 → 测试连接

---

## 适合性判断

以上问题全部与"用户能否快速、正确地完成模型配置并投入创作"直接相关。

对于 trpg-workbench 用户来说，模型配置是**前置障碍**——配不好模型，AI 功能全部失效。现有设计把这个障碍人为地复杂化了：
- 三个不同地方都有模型相关配置（Setup Wizard / Settings / WorkspaceSettings）
- 核心操作（测试连接）被藏在次要入口
- 模型选择 UI 在不同上下文表现不一致

这些是**用户体验缺口，不是功能缺口**——后端能力完备，前端交互有优化空间。

---

## 对创作控制感的影响

**间接改善。**

模型配置属于"准备阶段"，不直接影响创作流程。但配置的清晰度直接影响用户对「AI 在用什么模型」的感知：
- 如果用户在 WorkspaceSettings 里清楚地看到「当前使用 Gemini 2.5 Pro (Google)」，他们对 AI 行为的预期会更准确
- 如果配置混乱，用户不确定 AI 用的是哪个模型，会导致对生成结果的不信任

---

## 对 workbench 协同的影响

**改善 Settings ↔ WorkspaceSettings 之间的心智流转。**

当前状态：用户在 Settings 配置 provider（第一步），在 WorkspaceSettings 选模型（第二步），两步之间有跨页面的认知跳转。

改进后：Settings 内就能完成"配置 provider + 选模型 + 测试连通"的完整闭环，WorkspaceSettings 只是"确认/切换"，不是"从零开始选"。

---

## 对 1.0 用户价值的影响

**是 1.0 前需要解决的体验问题。**

原因：
1. 模型配置是所有用户的必经路径（AI 功能前置依赖）
2. 当前 UX 对非技术用户不友好（尤其是 Gemini 49 个模型下拉、strict_compatible 直接暴露）
3. 「先保存再测试」的断裂流程会导致用户误以为配置失败，产生支持负担

---

## 具体改进方案（可直接落地）

### 改进 A：ModelNameInput 增加推荐分组 + 折叠 legacy 模型

**文件：** `apps/desktop/src/components/ModelNameInput.tsx`
**改动规模：** 小（~80 行）

在 `ModelNameInput.tsx` 顶部添加 `RECOMMENDED_LLM_MODELS` 常量：

```typescript
const RECOMMENDED_LLM_MODELS: Record<string, string[]> = {
  google: [
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "o3-mini",
  ],
  anthropic: [
    "claude-sonnet-4-5",
    "claude-3-5-haiku-20241022",
  ],
  openrouter: [], // 动态，不预设
  openai_compatible: [], // 本地模型无推荐
};
```

rich picker panel 的 list 改为两组渲染：
1. **推荐** — 来自 `RECOMMENDED_LLM_MODELS[providerType]` 与 probe 结果的交集（probe 到则显示，否则灰显）
2. **其他可用模型（N 个）** — 默认折叠，点「展开」后显示完整列表

这直接解决 Google Gemini 49 个模型平铺的问题，同时让推荐模型在无 probe 时也能显示。

---

### 改进 B：Settings 编辑模态框合并"选模型 + 测试"为单一流程

**文件：** `apps/desktop/src/pages/SettingsPage.tsx`（LLMSection）
**改动规模：** 中

**当前流程：**
```
新建 profile → 保存 → 编辑 → 出现「测试用模型名称」→ 选模型 → 点「测试连接」
```

**改进后流程：**
```
新建/编辑 profile → 填 API Key → [立即验证 Key] → 出现模型选择 → 选模型 → 保存
```

关键变化：
1. 在 API Key 输入框右侧增加「验证」按钮，调用已有的 `probe-models` endpoint（传入临时 key）
2. 验证成功后：直接在模态框内显示模型选择器（原「测试用模型名称」重命名为「选择模型」）
3. 验证失败：显示错误原因（invalid key / network error）
4. 「测试连接」按钮保留，移到保存旁边（对已保存 profile 可用）
5. 新建时无需先保存即可测试（通过 `/settings/model-catalog/probe-models?api_key=...&base_url=...` 临时验证）

注意：现有 `/settings/model-catalog/probe-models` 接口已支持直接传 `api_key` 和 `base_url` 参数，无需新建后端接口。

---

### 改进 C：「配置名称」字段移到表单最后，并自动建议

**文件：** `apps/desktop/src/pages/SettingsPage.tsx`、`apps/desktop/src/components/setup/WizardStep1LLM.tsx`
**改动规模：** 小

将「配置名称 *」字段从表单顶部移到底部（供应商 → API Key → 模型 → 配置名称），并在用户选定模型后自动填入建议名称：

```typescript
// 当 provider + model 都选定后，自动建议名称
function suggestProfileName(provider: string, model: string): string {
  const labels: Record<string, string> = {
    google: "Gemini",
    openai: "OpenAI",
    anthropic: "Claude",
    openrouter: "OpenRouter",
    openai_compatible: "本地",
  };
  const shortModel = model.split("/").pop() ?? model; // openrouter 格式 provider/model
  return `${labels[provider] ?? provider} ${shortModel}`;
}
```

---

### 改进 D：「角色兼容模式」折叠为高级选项

**文件：** `apps/desktop/src/pages/SettingsPage.tsx`、`WizardStep1LLM.tsx`
**改动规模：** 小

将 `strict_compatible` checkbox 及其说明文字包裹在可折叠的「高级设置」中：

```tsx
<details>
  <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
    高级设置（遇到角色兼容问题时展开）
  </summary>
  <label>
    <input type="checkbox" checked={strict_compatible} ... />
    strict_compatible（将 developer/latest_reminder 映射为 system）
  </label>
  <span>...说明文字...</span>
</details>
```

---

### 改进 E：WorkspaceSettings 模型路由视觉整合

**文件：** `apps/desktop/src/pages/WorkspaceSettingsPage.tsx`
**改动规模：** 小

将「默认 LLM（profile 下拉）」和「模型名称（rich picker）」用一个卡片容器包裹，明确传达"这是同一件事的两个层级"：

```
┌─ 默认 AI 模型 ──────────────────────────────────────────┐
│  供应商配置   [Gemini tw (Google) ▾]                    │
│  模型         [gemini-2.0-flash ▾]    ✓ tool JSON       │
│                                        [测试 ▶]          │
│  ⓘ 从供应商获取了 49 个模型 · 仅显示推荐及常用          │
└──────────────────────────────────────────────────────────┘
```

关键变化：
- 卡片边框把两个控件视觉上绑定
- 「模型」下方小字显示「从供应商获取了 N 个模型 · 仅显示推荐及常用」替代当前「✓ 49 个模型」
- 增加内联「测试」按钮（对当前选中 profile + model 组合测试连通）
- 供应商下拉显示更友好的标签：`Gemini tw (Google)` 而非 `Gemini tw (google)`（大小写）

---

### 改进 F：统一 `ModelNameInput` 为单一 Combobox 形态

**文件：** `apps/desktop/src/components/ModelNameInput.tsx`
**改动规模：** 中

**来源：** 纯代码分析发现的结构性问题，截图无法观察到。

当前 `ModelNameInput` 在不同条件下渲染三种完全不同的 UI 形态：

| 条件 | 渲染结果 |
|------|---------|
| `catalog=embedding` + `fetchedModels.length > 0` | 原生 `<select>` 下拉 |
| `catalog=embedding` + `knownModels.length > 0` | `<input list>` + `<datalist>` |
| `catalog=embedding` + 无模型 | 纯 `<input>` |
| `catalog=llm` + 无 fetchedModels | 纯 `<input>` |
| `catalog=llm` + fetchedModels (no rich) | 原生 `<select>` |
| `catalog=llm` + has any models | 自定义浮动 panel |

这会导致视觉跳变：当 Google provider 从「无 fetchedModels」切换到「probe 成功后有 fetchedModels」，输入框会突然变成下拉框。

**改进方案：** 删除 embedding 分支的 `<select>` 和 `<datalist>` render path（第 158-238 行），所有情况统一使用自定义浮动 panel（rich combobox）。

- `<select>` 分支替换为 combobox 展示全部 fetchedModels（同样支持推荐分组，改进 A）
- `<datalist>` 分支替换为 combobox 展示 KNOWN_EMBEDDING_MODELS 作为初始候选列表
- 无模型时 combobox 展示空 panel + 提示「填写 Base URL 后点获取可加载模型列表」

---

## 优先级与落地建议

| 改进项 | 改动规模 | 用户体验提升 | 推荐优先级 |
|--------|----------|-------------|-----------|
| A：ModelNameInput 推荐分组 + 折叠 | 小 | 高（直接解决 Gemini 49 个模型问题） | **P0** |
| F：ModelNameInput 统一 Combobox 形态 | 中 | 高（消灭三态视觉跳变） | **P0** |
| C：配置名称移底 + 自动建议 | 小 | 中（降低首次填表摩擦） | **P0** |
| D：strict_compatible 折叠 | 小 | 中（降低认知负担） | **P0** |
| B：新建时内联验证 + 选模型 | 中 | 高（消灭「先保存再测试」断裂） | **P1** |
| E：WorkspaceSettings 卡片化 | 小 | 中（视觉联动更清晰） | **P1** |

**建议行动：** 全部 A–F 进入 M34「模型配置 UX 改进」milestone。

---

## 不做的理由（暂缓项）

**Setup Wizard provider card 选择（方案五）：**
将 native `<select>` 改为图形化 provider card（带 Logo）在视觉上吸引力较高，但：
- 实现成本偏高（需要引入或自制 card 组件，处理选中状态、accessibility）
- Wizard 是一次性流程，用户只走一次，视觉精致度对完成率的影响有限
- 目前 preset 卡片（「填入 Gemini 推荐值」）已经承担了快速引导的功能

暂缓条件：1.0 发布后、有用户调研显示 Wizard 完成率低于预期时重新评估。

---

## 建议落地方式

- [ ] 改进 A–F：**进入 M34 plan**（`docs/benchmark-reviews/accepted/2026-05-07_model-config-ux-overhaul.md`）
- [ ] 暂缓：provider card（条件见上）
