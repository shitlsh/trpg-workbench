# M22：规则集管理 UX 打磨

**前置条件**：无强依赖（规则集 CRUD 和 PromptProfile 已在 M9a 完成，本次为体验修复）。

**状态：✅ 已完成（commit 待补充）**

**目标**：修复规则集管理页的多个 UX 问题——移除内置规则集限制、Setup Wizard 补充规则集创建步骤、展示内置 AssetType、创作风格提示词支持手动创建与 AI 生成。

---

## 背景与动机

手动测试（`docs/test/manual_test.md`）发现以下问题：

1. 内置规则集"恐怖调查"无法修改和删除，且用途不明确，应移除
2. Setup Wizard 缺少规则集创建步骤（工作空间依赖规则集）
3. 规则集页面未展示系统内置 AssetType（NPC/Plot 等），用户不清楚默认支持哪些类型
4. 创作风格提示词无法新增自定义内容，现有"选择"弹窗也报错"Cannot modify builtin profiles"

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：移除内置规则集与 builtin 限制**

- 移除 `seed.py` 中的 `DEFAULT_RULE_SETS` 和 `DEFAULT_PROMPT_PROFILES` 播种数据
- 删除 `rule_sets.py` 中的 `_is_builtin()` 保护逻辑（PATCH/DELETE）
- 删除 `prompt_profiles.py` 中的 `is_builtin` 检查（PATCH/DELETE）
- 删除前端 `RuleSetPage.tsx` 中的 `isBuiltin()` 函数和所有条件渲染（badge、只读按钮）

**A2：Setup Wizard 增加规则集步骤**

- 新建 `WizardStepRuleSet.tsx`：名称/描述/风格类型表单，支持"稍后创建"跳过
- `SetupWizardPage.tsx` 改为 4 步：LLM → Embedding → 规则集 → 工作空间
- `WizardSummary.tsx` 增加 `ruleSet` prop，在完成摘要中展示

**A3：RuleSetPage 展示内置 AssetType**

- 从 `BUILTIN_ASSET_TYPES`（shared-schema）取 10 个内置类型
- 使用 `getAssetTypeIcon / getAssetTypeColor / getAssetTypeLabel`（assetTypeVisual.ts）渲染图标
- 内置类型只读展示（opacity 0.75），置于自定义类型前

**A4：创作风格提示词三标签弹窗 + AI 生成**

- `SetPromptModal` 改为三标签页：选择已有 / 手动创建 / AI 生成
- AI 生成：用户选 LLM Profile，调用新后端接口，结果可编辑后保存
- 后端：新增 `POST /prompt-profiles/generate` 接口（`GeneratePromptRequest/Response` schema）

### B 类：后续扩展

- **B1：提示词模板库**：预置多种风格模板供选择，推迟至后续
- **B2：批量删除内置数据迁移**：现有数据库中的 builtin 记录需手动清理，推迟提供 migration 工具

### C 类：明确不承诺

- 不为规则集增加"复制"功能
- 不自动将旧 builtin 数据迁移为普通数据

---

## 文件结构

### 修改文件

```
apps/backend/app/storage/seed.py               — 改为空函数 seed_default_data()
apps/backend/app/api/rule_sets.py              — 移除 _is_builtin() 保护
apps/backend/app/api/prompt_profiles.py        — 移除 is_builtin 检查，增加 /generate 端点
apps/backend/app/models/schemas.py             — 增加 GeneratePromptRequest/Response
apps/desktop/src/pages/SetupWizardPage.tsx     — 改为 4 步
apps/desktop/src/components/setup/WizardSummary.tsx — 增加 ruleSet prop
apps/desktop/src/pages/RuleSetPage.tsx         — 移除 isBuiltin，展示内置类型，三标签弹窗
```

### 新增文件

```
apps/desktop/src/components/setup/WizardStepRuleSet.tsx  — 新规则集创建步骤
```

---

## Todo

### A1：移除内置规则集

- [x] **A1.1**：`seed.py` — 移除 DEFAULT_RULE_SETS / DEFAULT_PROMPT_PROFILES，改为空函数
- [x] **A1.2**：`rule_sets.py` — 删除 `_is_builtin()` 函数和 PATCH/DELETE 中的调用
- [x] **A1.3**：`prompt_profiles.py` — 删除 is_builtin 检查（PATCH/DELETE）
- [x] **A1.4**：`RuleSetPage.tsx` — 删除 `isBuiltin()` 函数及所有条件渲染

### A2：Setup Wizard 规则集步骤

- [x] **A2.1**：新建 `WizardStepRuleSet.tsx`
- [x] **A2.2**：`SetupWizardPage.tsx` 改为 4 步，插入规则集步骤
- [x] **A2.3**：`WizardSummary.tsx` 增加 ruleSet 展示

### A3：内置 AssetType 展示

- [x] **A3.1**：`RuleSetPage.tsx` — 从 BUILTIN_ASSET_TYPES 渲染内置类型（只读，带图标/颜色）

### A4：三标签提示词弹窗

- [x] **A4.1**：`schemas.py` — 增加 GeneratePromptRequest / GeneratePromptResponse
- [x] **A4.2**：`prompt_profiles.py` — 实现 POST /prompt-profiles/generate（Agno Agent 调用）
- [x] **A4.3**：`RuleSetPage.tsx` — SetPromptModal 改为三标签（选择已有/手动创建/AI 生成）

---

## 验收标准

1. 重启后端，数据库不再自动插入任何 builtin 规则集或提示词
2. 用户可以正常编辑和删除任意规则集（不再报 403/400）
3. 首次打开 Setup Wizard 时步骤显示为：LLM → Embedding → 规则集 → 工作空间
4. 规则集页面资产类型区域显示 10 个内置类型（NPC、地点、场景、线索…）
5. 点击「设置提示词」弹出三标签弹窗，可手动填写或使用 AI 生成后编辑保存

---

## 与其他里程碑的关系

```
M9a（规则集统一管理）
  └── M22（规则集 UX 打磨，本 milestone）
        └── 后续：规则集导出/导入、模板库
```

---

## 非目标

- 不实现规则集导出/导入功能（推迟）
- 不清理已有 builtin 数据库记录（用户需手动清理，或删库重建）
- 不修改工作空间页面的规则集选择 UI
