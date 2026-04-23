---
status: proposed
date: 2026-04-23
source: Inscriptor
theme: 彩色图标体系与视觉语言
priority: high
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: plan + skill
---

# Inscriptor 视觉语言参考：彩色 Icon 体系与排版密度

## 来源与借鉴理由

Inscriptor 的核心 UI 辨识度来自两个机制：

1. **彩色 per-type 图标**：每种内容类型（人物、场景、笔记、地图…）有独立颜色编码的图标。用户在资产树中扫视时，颜色先于文字传达信息——不需要读标签就知道"这是个 NPC"、"这是个场景"。
2. **视觉层次密度**：左栏不只是文字列表，通过颜色、图标、badge、分隔线建立了清晰的视觉层次，让信息密集但不拥挤。

trpg-workbench 的 TRPG 资产天然有强类型语义（NPC / 怪物 / 场景 / 地点 / 线索 / 时间线…），比通用写作工具更适合用颜色区分类型。

## 当前差距

**AssetTree（`components/editor/AssetTree.tsx:250`）**：
- 所有资产类型都用同一个 `<File size={12} color="var(--text-muted)" />` 灰色图标
- 类型区分只靠大写文字 label（如"NPC"、"场景"），颜色无差异
- 状态仅靠右侧一个 7px 小圆点，在扫视时几乎不可见

**颜色系统（`index.css`）**：
- 只有一个 `--accent: #7c6af7` accent 色
- 没有语义化的多彩色变量（如 `--color-npc`, `--color-stage` 等）
- 按钮、标签、高亮全部复用同一紫色，视觉单调

**首页卡片（`pages/HomePage.tsx`）**：
- 工作空间卡片无图标/颜色差异，全部长得一样
- 功能导航（规则集/知识库/模型配置/用量观测）用普通文字按钮，辨识度低

## 适合性判断

**高度适合**。原因：

- trpg-workbench 的资产类型是固定枚举（10 种），完全可以为每种类型分配一个语义颜色 + 图标，无需动态生成
- Lucide React（已锁定图标库）提供了丰富的语义图标可供选择（Users/UserCircle=NPC, Sword/Skull=怪物, Map=地图, Clock=时间线…）
- 改动范围可控：主要是 `index.css`（新增颜色变量）+ `AssetTree.tsx`（替换图标）+ 少量其他组件
- 不破坏任何现有 API / 数据模型 / 后端逻辑

**不需要照搬 Inscriptor 的品牌风格**，只借鉴"彩色 per-type 图标"这个机制本身。

## 对创作控制感的影响

**间接改善**。颜色编码让用户在资产树中能更快定位目标资产，减少视觉扫描时间，特别是在资产数量增多后（20+ 资产）效果明显。不直接改变创作控制力，但降低了"找资产"的认知摩擦。

## 对 workbench 协同的影响

**改善左栏 → 中栏的协同**。当左栏资产树视觉清晰度提升后，用户在左栏选择资产、在中栏编辑、在右栏与 Agent 对话的节奏更流畅。特别是 Agent 面板中的"将修改的资产列表"如果也用相同的彩色图标，能让用户快速对应资产类型与 Agent 操作。

## 对 1.0 用户价值的影响

**是 1.0 前应解决的体验问题**。理由：

- 这是用户每次打开 Workspace 都会感受到的东西（每次）
- 成本低、收益明显
- 当前灰色 File 图标方案在资产数量 > 10 后会让左栏变成难以扫视的文字堆

## 建议落地方式

### 分三个层次实施：

**Layer 1（核心 — 必做）：资产树彩色图标**
- 在 `index.css` 新增 per-type 颜色变量
- 在 `AssetTree.tsx` 为每种 AssetType 分配专属 Lucide 图标 + 颜色
- 参考映射：
  ```
  outline    → BookOpen    #7c6af7 (紫，当前 accent)
  stage      → Theater     #e05252 (红)
  npc        → Users       #52b4c9 (青)
  monster    → Skull        #f07030 (橙)
  location   → MapPin      #52c97e (绿)
  clue       → Search      #f0c050 (黄)
  branch     → GitBranch   #c97052 (棕)
  timeline   → Clock       #a07af0 (浅紫)
  map_brief  → Map         #52c9a8 (青绿)
  lore_note  → Scroll      #9090b0 (蓝灰)
  ```

**Layer 2（次优先）：导航/页面级图标**
- 首页顶部导航四个功能按钮（规则集/知识库/模型配置/用量观测）加彩色图标
- 让功能入口在视觉上更易区分，减少对文字标签的依赖

**Layer 3（可选扩展）：Agent 面板资产引用卡**
- Agent 面板中"将修改的资产列表"使用相同的彩色图标体系
- 保证左栏 ↔ 右栏的视觉语言一致

- [x] plan：建议新建 M13（UI 视觉语言升级）
- [ ] skill：frontend-ui-patterns skill 需要增加"资产类型颜色与图标规范"章节
- [ ] 直接改代码：改动范围见上
- [ ] 暂缓：—

## 不做的理由（如适用）

Layer 3 如果排期紧张可暂缓，但 Layer 1 是高价值低成本的改动，建议作为 M13 的核心交付。
