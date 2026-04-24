---
status: proposed
date: 2026-04-24
source: Internal (creative software interaction review)
theme: 资产全文搜索
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: plan
---

# 资产全文搜索

## 来源与借鉴理由

当前资产树仅支持按名称过滤（客户端 `string.includes`），无法搜索资产内容。创作者经常需要回答"哪个资产里提到了某个地名/人名/关键词"这类问题，缺乏全文搜索意味着只能逐个打开资产查找。

几乎所有创作工具（Scrivener、Obsidian、Notion、甚至简单的笔记应用）都提供全文搜索，这是创作软件的基线期望。

## 当前差距

- 资产树搜索仅过滤名称，不检索 `content_md` 或 `content_json`
- 无全局搜索入口（如 Cmd+K / Cmd+Shift+F）
- 无搜索结果高亮或跳转
- 项目已有 lancedb 向量搜索能力（用于知识库 RAG），但未应用于资产内容搜索

## 适合性判断

高度适合，且实现成本相对可控。两种可选方案：

1. **SQLite FTS**：对 `content_md` 建立 SQLite FTS5 全文索引，支持精确关键词匹配。实现简单，查询快，适合"找到提到某个名字的资产"场景。
2. **复用 lancedb 向量搜索**：对资产内容也做 embedding，支持语义搜索。实现成本高一些，但能回答"哪个资产描述了类似的情节"这类模糊查询。

建议先做方案 1（SQLite FTS），按需再扩展方案 2。

## 对创作控制感的影响

改善。创作者能快速定位内容，减少"我记得写过但找不到在哪"的挫败感。

## 对 workbench 协同的影响

间接改善——搜索结果可直接打开对应资产的编辑器标签页，减少在资产树中手动翻找的认知负担。

## 对 1.0 用户价值的影响

中等。模组只有几个资产时不明显，但一个完整模组通常有 15-30 个资产，此时全文搜索价值显现。

## 建议落地方式

- [x] plan：可纳入现有或新 milestone
- [ ] skill：不需要新 skill
- [ ] 直接改代码：后端 FTS 索引 + 前端搜索 UI，适合作为一个小 milestone
- [ ] 暂缓：触发条件 — 若用户反馈"找不到之前写的内容"

## 涉及模块

- 后端：`AssetORM` 新增 FTS5 虚拟表，新增 `/workspaces/{id}/assets/search?q=` 端点
- 前端：全局搜索入口（Cmd+K 或资产树中的搜索增强），搜索结果列表，点击跳转到对应标签页并高亮
