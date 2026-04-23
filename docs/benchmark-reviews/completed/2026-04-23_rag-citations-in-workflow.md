---
status: completed
date: 2026-04-23
accepted_date: 2026-04-23
milestone: M12
source: OpenPawz
theme: 创作控制感 / workbench 协同
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# RAG 引用来源应在普通创作流程中可见

## 来源与借鉴理由

OpenPawz 在每次 Agent 响应中，都会清晰标注"此次回答参考了哪些知识片段"，用户可以展开查看
原文摘要、文档名、段落位置。这不是装饰性功能——它让用户理解 AI 的推理依据：哪些生成内容有
知识库支撑、哪些是模型自由发挥，从而做出更有依据的编辑决策。

对于 TRPG 创作场景，这个机制尤为关键：用户需要知道"这个 NPC 背景是从哪本规则书里来的"，
才能判断 AI 生成的内容是否符合世界观设定。

## 当前差距

trpg-workbench 的 `create_module` / `modify_asset` 流程中：

- Knowledge Retriever 检索结果作为 prompt context 传入各 Agent
- 但前端**完全不展示**这些 citations
- 执行日志中只显示 `检索到 N 条相关内容`（数量），无文档名、无摘要
- 只有点击「规则审查」快捷按钮才能看到带 citation 的 `RulesReviewView`

用户在整个创作流程中，无法知道知识库里的哪些内容影响了 AI 的生成结果。

## 适合性判断

适合，但需要改造——不能直接照搬 OpenPawz 的气泡级引用展示（太噪，trpg-workbench 的
Workflow 一次会调用多个 Agent，每个 Agent 都有 retrieval，全部展示会信息过载）。

**建议方案：在 WorkflowProgress 步骤列表中，retrieval 步骤可展开查看 citations**

```
步骤列表：
✓ 知识库检索（检索到 4 条）     ← 点击展开
  └── 📄 克苏鲁神话入门 p.12-15：「深潜者是...」
  └── 📄 COC规则书 p.88：「SAN值减少时...」
  └── 📄 用户自定义世界观 p.3：「Arkham 城的地理...」
✓ Plot Agent（生成主线）
```

这样引用来源在需要时可见，不在时不占空间。

## 对创作控制感的影响

显著改善。用户能追溯"NPC 的背景是从哪条规则/世界观文档里来的"——这是创作工具的引用透明度
保证。当 AI 生成的内容与用户预期不符时，用户可以判断是"知识库里没有对应内容"还是
"AI 没有正确理解检索到的内容"，而不是只能整体拒绝。

## 对 workbench 协同的影响

改善左栏知识库与右栏 Agent 面板的可见连接。用户能看到知识库在创作中实际起了什么作用，
让"知识库 → Agent → 资产"这条链路变得透明。

## 对 1.0 用户价值的影响

中。知识库是 M2 的核心功能，但"知识库真的被用了吗"对用户来说是黑箱。这个黑箱会降低用户
继续维护知识库的意愿——如果看不到效果，用户会停止向知识库添加内容。

## 建议落地方式

- [ ] plan：新 milestone M12 或追加到现有 milestone
  - 后端：Workflow step 执行完 retrieval 后，将 citations（document name + page range + 摘要前 100 字）写入 step 的 `detail` 字段
  - 前端：`WorkflowProgress.tsx` — retrieval 类型的步骤展开后显示 citation 列表
  - Rules Agent 的 citation 展示已有，可复用 `RulesReviewView` 的引用卡片组件

## 不做的理由（如适用）

当前阶段可以暂缓：改动涉及后端 Workflow step 数据结构，需要一定设计。但应在 1.0 发布前完成，
否则知识库功能对用户的可感知价值会大打折扣。
