# M11：首次配置引导与 Onboarding 体验

**前置条件**：M9 / M9a 完成（帮助文档系统、规则集统一管理已落地），前端设置页功能稳定。

**状态：✅ 已完成（commit 8e5d6f5）**

**目标**：解决新用户冷启动必然遭遇 AI 调用失败的根本问题。通过分步配置向导（Setup Wizard）
主动引导用户完成 LLM / Embedding 配置，并通过 Inline Hint 让配置表单的每个字段都变得可理解。

---

## 背景与动机

当前冷启动路径存在必然失败点：

```
启动应用 → 空首页（无引导）→ 创建工作空间 → Agent 面板调用 AI → 报错（未配置 LLM）
```

用户需要自己摸索到 `/settings/models`，但表单字段无任何说明，
不知道 Gemini 的 model_name 格式，不知道 Jina 的 base_url，不知道 Rerank 是否必填。

M10 通过两条并行改进线解决这个问题：
- **主线 A（Wizard）**：分步配置引导，强制用户在进入工作空间前完成最低配置
- **主线 B（Inline Hint）**：在表单字段层面给出推荐值和说明，降低配错概率

来源：benchmark review `docs/benchmark-reviews/accepted/2026-04-23_setup-wizard-onboarding.md`
和 `docs/benchmark-reviews/accepted/2026-04-23_inline-hint-recommended-defaults.md`。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：Inline Hint + 推荐默认值（优先实现，成本低）**
- LLM Section 加 Gemini 推荐配置示例和"一键填入推荐值"按钮
- Embedding Section 加 Jina 推荐配置示例和"一键填入推荐值"按钮
- Rerank Section 顶部加"可选，默认不启用"说明，修改 empty state 文案
- WorkspaceSettingsPage 模型路由"不指定"选项旁加 ⚠️ warning badge

**A2：Setup Wizard 核心流程**
- 新增 `SetupWizard` 组件（stepper + skip + summary）
- `settingsStore` 新增 `hasCompletedSetup: boolean` 持久化字段
- `App.tsx` 加首次启动检测：`!hasCompletedSetup` 时重定向到 `/setup` 路由
- Wizard 完成后跳转首页（`hasCompletedSetup` 置为 `true`）

**A3：Wizard 步骤内容**

| 步骤 | 内容 | 可跳过 | 默认行为 |
|------|------|--------|---------|
| Step 1 | 配置 LLM Profile | 是（显示"稍后配置"按钮） | 进入即显示，推荐 Gemini |
| Step 2 | 配置 Embedding Profile | 是（显示"稍后配置"按钮） | 推荐 Jina Embeddings |
| Step 3 | 配置 Rerank Profile | **默认跳过**（Step 2 完成后直接跳到 Step 4） | 显示"可选，默认跳过"说明 |
| Step 4 | 创建第一个工作空间 | 否（必须完成才能进入应用） | 复用现有 CreateWorkspace 流程 |
| Summary | 展示已完成/已跳过各步骤状态 | — | 点击"开始创作"进入首页 |

**A4：Wizard 中的 Inline Hint**
- Step 1 内嵌 LLM 配置表单时，直接使用 A1 的推荐值 hint，保持一致性
- Step 2 内嵌 Embedding 配置表单时，同上
- Step 3 如用户主动展开，显示 Rerank 配置表单 + "可选，默认跳过"说明

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：Onboarding Checklist 首页常驻**（详见 `proposed/2026-04-23_onboarding-checklist-profile-health.md`）
  首页显示可折叠 checklist，追踪未完成的配置步骤，全部完成后自动消失
- **B2：Profile 健康度 badge**
  `settingsStore` 加 `verified` 字段，WorkspaceSettingsPage 模型路由旁显示连接状态
- **B3：Feature Discovery Hints**
  首次进入 Agent 面板、知识库等区域时显示一次性 tooltip（详见 `proposed/2026-04-23_feature-discovery-hints.md`）

### C 类：明确不承诺

- 完整 in-app tutorial / walkthrough（高亮遮罩引导）
- 多语言 wizard
- 重置 wizard 的管理入口（用户如需重新引导，直接重置 `hasCompletedSetup`）

---

## 文件结构

### 新增文件

```
apps/desktop/src/
├── pages/
│   └── SetupWizardPage.tsx          ← Wizard 主组件（stepper + 各步骤内容 + summary）
├── components/setup/
│   ├── WizardStep1LLM.tsx           ← Step 1：LLM 配置（内嵌 LLMProfileForm）
│   ├── WizardStep2Embedding.tsx     ← Step 2：Embedding 配置（内嵌 EmbeddingProfileForm）
│   ├── WizardStep3Rerank.tsx        ← Step 3：Rerank 配置（可选，默认跳过）
│   ├── WizardStep4Workspace.tsx     ← Step 4：创建工作空间（复用现有逻辑）
│   └── WizardSummary.tsx            ← Summary：展示各步骤完成状态
```

### 修改文件

```
apps/desktop/src/
├── App.tsx                          ← 新增 /setup 路由，首次启动重定向逻辑
├── stores/settingsStore.ts          ← 新增 hasCompletedSetup: boolean
└── pages/SettingsPage.tsx           ← A1：各 Section 加 Inline Hint + 推荐默认值按钮
apps/desktop/src/pages/
└── WorkspaceSettingsPage.tsx        ← A1：模型路由"不指定"加 warning badge
```

---

## 关键设计约束

### Wizard 与现有 SettingsPage 的关系

Wizard 中的 LLM / Embedding 配置表单**复用**现有 SettingsPage 中的 Profile 表单组件，
不另立一套逻辑。保持配置数据写入路径一致（写入 `settingsStore`）。

### 跳过逻辑

- Step 1 / Step 2 跳过后：进入 summary 时标注"未配置（建议稍后完成）"
- Step 3 默认跳过：不在步骤列表中显眼显示，summary 中列为"可选，已跳过"
- 用户可在 wizard 完成后随时通过 `/settings/models` 补充配置

### hasCompletedSetup 持久化

- 存于 `settingsStore`（Zustand + persist），写入 localStorage
- 首次安装时默认为 `false`，wizard 最后一步完成后置为 `true`
- **不提供 UI 入口重置**（避免误操作），仅在开发环境可通过 devtools 手动清除

### 推荐默认值内容

**Gemini（LLM）推荐配置：**
- Provider：Google
- Model Name：`gemini-2.0-flash`
- Base URL：留空（使用 Google 官方默认）
- API Key：用户填写

**Jina（Embedding）推荐配置：**
- Model Name：`jina-embeddings-v3`
- Base URL：`https://api.jina.ai/v1`
- API Key：用户填写

**Rerank（默认跳过）：**
- Section 顶部说明：`Rerank 为可选功能，默认不启用。仅在需要更精准的知识库检索时配置。`
- Empty state：`未配置 Rerank（不影响基础 AI 功能）`

---

## Todo

### A1：Inline Hint + 推荐默认值（优先，独立小改）

- [x] **A1.1**：`SettingsPage.tsx` LLM Section
  - 新增"一键填入 Gemini 推荐值"按钮（填入 provider=Google, model_name=`gemini-2.0-flash`）
  - model_name 字段加 placeholder：`gemini-2.0-flash`
  - 表单新增 description 文字：推荐用于日常创作，支持长上下文

- [x] **A1.2**：`SettingsPage.tsx` Embedding Section
  - 新增"一键填入 Jina 推荐值"按钮（填入 model_name=`jina-embeddings-v3`, base_url=`https://api.jina.ai/v1`）
  - model_name 字段加 placeholder：`jina-embeddings-v3`
  - base_url 字段加 placeholder：`https://api.jina.ai/v1`

- [x] **A1.3**：`SettingsPage.tsx` Rerank Section
  - Section 顶部加说明文字
  - 修改 empty state 文案为"未配置 Rerank（不影响基础 AI 功能）"

- [x] **A1.4**：`WorkspaceSettingsPage.tsx`
  - 默认 LLM 路由"不指定"选项旁加 ⚠️ warning badge + tooltip 说明

### A2：Setup Wizard 骨架

- [x] **A2.1**：`settingsStore.ts` 新增 `hasCompletedSetup: boolean`（默认 `false`，持久化）

- [x] **A2.2**：`App.tsx` 新增 `/setup` 路由 + 首次启动重定向逻辑
  - 若 `!hasCompletedSetup`，访问任意路由时重定向到 `/setup`
  - 例外：`/setup` 路由本身不重定向

- [x] **A2.3**：新建 `SetupWizardPage.tsx`
  - Stepper 组件（Step 1-4 + Summary）
  - 步骤状态管理：completed / skipped / pending
  - "下一步" / "稍后配置（跳过）" / "完成" 按钮逻辑

### A3：Wizard 各步骤内容

- [x] **A3.1**：`WizardStep1LLM.tsx`
  - 内嵌 LLM Profile 表单（复用 SettingsPage 的表单组件）
  - 使用 A1.1 的推荐默认值 hint
  - 底部"稍后配置"跳过按钮

- [x] **A3.2**：`WizardStep2Embedding.tsx`
  - 内嵌 Embedding Profile 表单（复用 SettingsPage 的表单组件）
  - 使用 A1.2 的推荐默认值 hint
  - 底部"稍后配置"跳过按钮

- [x] **A3.3**：`WizardStep3Rerank.tsx`
  - 默认跳过（Step 2 完成后直接跳到 Step 4）
  - 如用户点击"展开配置 Rerank"，显示 Rerank 表单 + "可选"说明

- [x] **A3.4**：`WizardStep4Workspace.tsx`
  - 内嵌创建工作空间表单（复用现有 CreateWorkspace Modal 逻辑）
  - 实现时保留了"稍后创建"跳过按钮（与 plan 略有偏差，考虑 UX 灵活性保留）

- [x] **A3.5**：`WizardSummary.tsx`
  - 列出 Step 1-4 的完成状态（✅ 已配置 / ⏭ 已跳过 / ⚠️ 待完成）
  - "开始创作"按钮：将 `hasCompletedSetup` 置为 `true`，跳转首页

### A4：Wizard 内 Inline Hint 一致性检查

- [x] 确认 Wizard 中的 LLM / Embedding 表单 hint 与 SettingsPage 的 A1 改动保持一致

---

## 验收标准

### A1 验收

1. `SettingsPage` LLM Section 有"一键填入 Gemini 推荐值"按钮，点击后表单填入正确默认值
2. `SettingsPage` Embedding Section 有"一键填入 Jina 推荐值"按钮，点击后表单填入正确默认值
3. `SettingsPage` Rerank Section 顶部有"可选，默认不启用"说明文字
4. `WorkspaceSettingsPage` 模型路由"不指定"旁有 ⚠️ badge，hover 有 tooltip

### A2 验收

5. 全新安装（清空 localStorage）启动后，自动跳转到 `/setup` 路由
6. 已完成 wizard 的用户启动后，直接进入首页（不再重定向到 `/setup`）

### A3 验收

7. Wizard Step 1 可跳过：点击"稍后配置"后进入 Step 2，summary 中 Step 1 显示"已跳过"
8. Wizard Step 2 可跳过：同上
9. Wizard Step 3 默认不显示在主流程中（Step 2 完成后直接跳到 Step 4）
10. Wizard Step 4（创建工作空间）无法跳过，必须完成后才能进入 Summary
11. Summary 页"开始创作"后进入首页，再次启动不触发 wizard

---

## 与其他里程碑的关系

```
M9（Smoke Test + Help 文档）
M9a（规则集统一管理）✅
M10（Agent 编排升级）
  └── M11（首次配置引导 + Onboarding 体验）
        └── B1（Onboarding Checklist + Profile 健康度，按需推进）
        └── B3（Feature Discovery Hints，1.0 后根据用户反馈）
```

---

## 非目标

- 完整 in-app tutorial / walkthrough（高亮遮罩交互引导）
- 重置 wizard 的用户可见入口
- Rerank 在 wizard 中的显眼引导（保持默认跳过，不增加认知负担）
- Profile 健康度 badge（B 类，待 M10 完成后单独评估）
