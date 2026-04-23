---
status: accepted
date: 2026-04-23
source: Inscriptor
theme: 排版密度与信息层次
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan + skill
---

# Inscriptor 参考：排版密度控制与信息层次设计

## 来源与借鉴理由

Inscriptor 的界面即使在信息密集时也保持可读性，核心机制是：

1. **分隔线 + 区域标题**有明确的视觉重量层次（一级标题 > 区域标题 > 行内标签）
2. **间距系统有节奏**：不是随机 padding，而是 4px 倍数的栅格系统，让界面呼吸感一致
3. **Muted 色有梯度**：不只有"正常色"和"muted 色"两档，而是有 3-4 档灰度，用于区分主内容 / 辅助信息 / 时间戳 / 占位符
4. **hover 状态反馈及时**：不只是背景色变化，还有左边 border 或 icon 颜色微变，给用户清晰的焦点感

## 当前差距

**颜色梯度不足（`index.css`）**：
- 只有 `--text` 和 `--text-muted` 两档文字颜色
- 缺少第三档 `--text-subtle`（用于时间戳、计数、占位提示等最低优先级信息）
- 导致 AssetTree 中资产名称、分类标签、数量计数都在同一视觉重量层

**hover 反馈单一（`AssetTree.tsx:247-248`）**：
- 只有 `background: var(--bg-hover)` 变化
- 缺少左侧 active 指示条（4px 宽的彩色 border-left）
- 当前激活的 Tab/资产在树中没有持久高亮状态

**间距不统一**：
- 部分组件用 `padding: "12px"` 硬编码，部分用 `padding: "10px 12px 8px"`
- 没有统一的 spacing scale（4 / 8 / 12 / 16 / 20 / 24px）
- 视觉上各区域间距参差，缺少节奏感

**区域标题权重不足**：
- 资产树的分类标题（"NPC"、"场景"）只靠 `fontSize: 11, fontWeight: 600, textTransform: uppercase` 区分
- 没有左侧色块或图标加持，在视觉扫视时不够突出

## 适合性判断

**适合，但需要逐步推进**。不建议一次性重写所有间距，而是：

1. 先在 `index.css` 增加 spacing scale 变量和第三档文字颜色（低成本高收益）
2. 再在 AssetTree 中补充 active 状态指示（与彩色图标改动同批次）
3. 后续在发现问题的地方逐步统一间距

不需要引入新依赖，也不破坏现有布局逻辑。

## 对创作控制感的影响

**直接改善**。清晰的视觉层次让用户在三栏布局中能更快定位当前焦点：

- 左栏：当前选中资产有明确高亮
- 中栏：Tab 激活状态更明显
- 右栏：Agent 消息中信息层次更清晰（解释文本 vs. 资产列表 vs. 时间戳）

## 对 workbench 协同的影响

**改善三栏整体协同体验**。用户在左/中/右栏切换时，能通过一致的视觉语言（颜色梯度、active 状态、间距节奏）快速判断"我在哪里、焦点在哪"。

## 对 1.0 用户价值的影响

**是 1.0 前应解决的基础体验问题**。间距混乱和颜色梯度不足是用户不自觉会感受到的"廉价感"来源，即使用户说不清楚，也会影响对产品品质的整体判断。

## 建议落地方式

**具体改动（可拆分为两个 PR）：**

**PR 1：CSS 基础变量扩充**（`index.css`）
```css
/* 文字颜色第三档 */
--text-subtle: #666;   /* dark */  
--text-subtle: #a0998f; /* light */

/* Spacing scale */
--sp-1: 4px;
--sp-2: 8px;
--sp-3: 12px;
--sp-4: 16px;
--sp-5: 20px;
--sp-6: 24px;

/* Active/selected 状态 */
--active-bar-width: 3px;
```

**PR 2：AssetTree active 状态**（`AssetTree.tsx`）
- 选中资产时显示左侧彩色 border（使用该 asset type 的颜色）
- 选中资产的背景用 `rgba(type-color, 0.08)` 而不是通用 `--bg-hover`

- [x] plan：建议合并到 M13（UI 视觉语言升级）
- [ ] skill：frontend-ui-patterns skill 需要增加 spacing scale 和颜色梯度规范章节
- [ ] 直接改代码：见 PR 1/PR 2 描述
- [ ] 暂缓：—

## 不做的理由（如适用）

全局间距统一工程量大，建议只做变量定义，不做全量替换。替换工作可分散到后续各 milestone 中自然推进。
