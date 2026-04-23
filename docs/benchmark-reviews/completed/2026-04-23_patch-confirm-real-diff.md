---
status: completed
date: 2026-04-23
completed_date: 2026-04-23
source: Inscriptor
theme: 创作控制感
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# Patch 确认应展示真正的 Diff，而非只展示新内容

## 来源与借鉴理由

Inscriptor 在内容修订时，以"变更对比"而非"新版本预览"的形式呈现修改。用户能精确看到
"删了什么 / 加了什么"，而不是被迫全文阅读猜测改动范围。

这是创作工具的基础信任机制——用户愿意接受 AI 修改，前提是能看清楚改了什么。

## 当前差距

`PatchConfirmDialog.tsx` 中 Monaco DiffEditor 的 `original` 写死为空字符串：

```tsx
// 当前实现
<DiffEditor original="" modified={patch.content} ... />
```

效果是：左侧永远是空白，右侧是 AI 生成的新内容。用户看到的不是"改了什么"，而是"AI
写了什么全文"。这不是 diff，是一个只读的内容预览。

## 适合性判断

高度适合，改动范围极小。`AssetRevision` 机制已有历史版本数据。方案：

1. 后端 `GET /workflows/{id}/patches` 响应中，每个 patch 增加 `original_content` 字段
   （从最新 AssetRevision 读取，或从资产当前 content 读取）
2. 前端 `PatchConfirmDialog.tsx` 将 `original_content` 传入 DiffEditor 的 `original`

不需要新增数据结构，不涉及 schema 变更。

## 对创作控制感的影响

显著改善。Patch 确认是整个创作流程中最关键的"人工审查"节点。真正的 diff 是这个节点
让用户感到"有掌控感"的最低门槛——用户点"应用变更"时，应该是有意识地接受了具体改动，
而不是盲目信任 AI 的全文替换。

## 对 workbench 协同的影响

改善右栏 Agent 面板与中栏编辑器的信任关系。用户在右栏确认 patch 时，能理解中栏资产将被
如何改变，减少"确认后去编辑器看结果"的验证成本。

## 对 1.0 用户价值的影响

高。当前的 PatchConfirmDialog 是容易让用户产生不信任感的 UI——看不出 AI 改了哪里，
只能"接受全文"或"拒绝全文"。这会导致用户倾向于拒绝所有 patch，或接受后反复手动修改。

## 建议落地方式

- [x] 直接改代码：
  - `apps/backend/` — `GET /workflows/{id}/patches` 返回值增加 `original_content` 字段
  - `apps/desktop/src/components/agent/PatchConfirmDialog.tsx` — 将 `original_content` 传入 DiffEditor

## 不做的理由（如适用）

不适用。这是一个明确的 bug 级 UX 问题，没有理由推迟。
