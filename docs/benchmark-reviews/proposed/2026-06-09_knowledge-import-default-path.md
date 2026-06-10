---
status: proposed
date: 2026-06-09
source: OpenPawz
theme: 知识库导入 Wizard 的「选择分析模型」步骤认知成本过高
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# 知识库导入「选择 AI 分析模型」步骤出现突然，且缺少默认路径

## 来源与借鉴理由

参考 OpenPawz 对复杂配置步骤的处理方式：**当用户已在上下文中设置过某个配置时，后续流程应优先使用已有配置作为默认值，而不是要求用户重新选择**。"已配置过的东西不应该每次都重新问"是降低操作心智的核心原则。

## 当前差距

`RuleSetPage.tsx` 知识库导入 Wizard 的 `select_llm` 步骤：

**流程：** 上传 PDF → 检测目录页 → 确认目录页范围 → **弹出"选择分析模型"步骤** → 选 LLM profile + 手动填写 model_name → AI 分析 → 章节确认

**三个具体问题：**

### 问题 A：`select_llm` 步骤不使用工作空间已有的默认模型
```tsx
// RuleSetPage.tsx wizard state：select_llm 步骤
// 代码里需要用户手动选 llmProfileId + modelName
// 没有从 workspaceConfig.models.default_llm / default_llm_model 预填
```
用户在工作空间设置里已经配好了「默认 AI 模型」，但导入文档时还要再选一遍，逻辑上重复。

### 问题 B：没有解释"为什么需要 AI 分析目录"
用户突然看到"选择分析模型"，不理解 AI 在这里做什么。导入一个 PDF 为什么需要 AI？这个分析跳过行不行？

### 问题 C：章节分类确认（`section_confirm`）缺少「全部接受」快捷路径
TOC 树完整展示 + 每行都有 chunk_type 下拉，信息密度极高。对于信任 AI 推荐分类的用户，没有一键接受的出口——必须看完整个表格才能找到继续按钮。

同时缺少安全感说明：「导入后能不能修改分类？」用户不知道，所以会更谨慎地逐行检查，消耗大量时间。

## 适合性判断

这是**中等改动**，但每个子问题都可以独立修复，可以分批做：
- 问题 A（预填默认模型）：小改，从工作空间 config 读取默认值
- 问题 B（解释说明）：纯文案，5 分钟
- 问题 C（全部接受按钮）：小改，加一个按钮 + 提示文案

## 对创作控制感的影响

**改善**。知识库是 RAG 的前提，导入摩擦减少，用户能更快让 AI 参考规则书进行创作。

## 对 workbench 协同的影响

**改善**。知识库 → RAG → AI 创作 是核心链路。导入环节的摩擦直接影响整条链路能否顺畅运转。

## 对 1.0 用户价值的影响

**是 1.0 前应解决的体验问题**。知识库导入是 TRPG 创作工具的差异化功能，如果导入体验很差，用户会绕过知识库功能，直接削弱产品价值。

## 建议落地方式

### 修复 A：`select_llm` 步骤预填工作空间默认模型

```tsx
// 在 LibrarySection 中拿到工作空间的 config
// 进入 select_llm 步骤时：
setWizard({
  step: "select_llm",
  // 预填已有默认值
  llmProfileId: workspaceConfig.models?.default_llm_profile_id ?? "",
  modelName: workspaceConfig.models?.default_llm_model ?? "",
  ...
})
```

如果预填成功（有默认模型），可以直接显示确认界面而非空白选择框：
```
正在使用：Gemini 2.5 Flash（工作空间默认）
[更换模型]    [继续 →]
```

### 修复 B：在 `select_llm` 步骤顶部加解释说明

```
AI 将读取你文档的目录文字，识别每个章节的内容类型（规则 / 世界观 / 实体等），
让知识库检索更精准。这一步大约需要 10-30 秒。
```

同时在步骤底部加「跳过 AI 分析，直接导入（精度较低）」的文字链接，给不想用 AI 分析的用户提供出口。

### 修复 C：章节分类确认加「全部接受 AI 推荐」主按钮

在 `section_confirm` 步骤的操作区：
```
[全部接受 AI 推荐分类]    ← 主按钮，主要路径
[查看并手动调整 ▼]        ← 展开详细 TOC 树（默认收起）
```

底部加说明文字：「导入后可在文档详情中随时修改分类，不影响基础检索」

- [ ] 直接改代码：
  - `apps/desktop/src/pages/RuleSetPage.tsx`
    - `select_llm` 步骤：从 workspaceConfig 预填默认模型
    - `select_llm` 步骤：加 AI 分析说明 + 跳过链接
    - `section_confirm` 步骤：加「全部接受」主按钮 + 安全感说明
  - 需要 `LibrarySection` 组件能访问到 `workspaceConfig`（当前已有 `workspace.id`，可以在 Section 内查询 config）

## 不做的理由（如适用）

N/A。三个子修复都是小改，建议随 UI 优化迭代一起做。
