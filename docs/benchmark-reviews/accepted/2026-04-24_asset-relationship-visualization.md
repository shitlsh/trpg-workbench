---
status: proposed
date: 2026-04-24
source: Internal (creative software interaction review)
theme: 资产间关系可视化
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# 资产间关系可视化

## 来源与借鉴理由

TRPG 模组中的资产天然互相关联——NPC 出现在特定场景中、线索指向特定地点、分支连接不同场景。当前资产以扁平列表（按类型分组）呈现，用户无法直观看到这些关联。

成熟的创作工具（如 Scrivener 的 corkboard、Obsidian 的 graph view、Notion 的 relation/rollup）都提供了某种形式的关联可视化，因为创作者需要"看到全局结构"来做决策。

## 当前差距

- 资产树按类型分组，无法看到跨类型关联（如"这个 NPC 出现在哪些场景"）
- NPC JSON 中有 `relationship_to_players` 等文本字段，但不是可导航的结构化链接
- Consistency Agent 能检查跨资产一致性，但结果是一次性的文本输出，不是持久化的关系数据
- 无关系图谱、无反向引用、无"被引用者"列表

## 适合性判断

高度适合。TRPG 模组本质上是一个关系网络（场景-NPC-线索-地点），关系可视化直接服务于创作者对模组结构的理解和调整。

实现上可以分层推进：
1. **轻量级**：在 AssetMetaPanel 中展示"相关资产"列表（基于 AI 生成时的上下文关联或内容中的 mention 匹配）
2. **中量级**：资产编辑器中支持 `[[asset-name]]` 式内链，自动建立双向引用
3. **重量级**：独立的关系图谱视图（graph view）

建议从轻量级开始，不必一步到位。

## 对创作控制感的影响

改善。创作者能看到"改动一个 NPC 会影响哪些场景"，对模组结构的掌控感显著提升。

## 对 workbench 协同的影响

改善资产树与编辑器之间的协同——用户可以从关系视角（而非类型视角）导航资产。

## 对 1.0 用户价值的影响

中等。模组规模小时（10-20 个资产）用户可以靠记忆管理关联，但随着模组复杂度增加，缺乏关系可视化会成为明显的效率瓶颈。

## 建议落地方式

- [x] plan：建议作为新 milestone，从轻量级（AssetMetaPanel 相关资产列表）开始
- [ ] skill：不需要新 skill
- [ ] 直接改代码：范围较大，不适合直接改
- [ ] 暂缓：触发条件 — 若用户反馈模组资产超过 20 个时管理困难

## 涉及模块

- 后端：需要新增资产关系数据模型（或基于内容分析的动态关联）
- 前端：AssetMetaPanel 扩展、可能的 graph view 组件
- Agent：Document Agent 输出时可标注引用的其他资产 slug
