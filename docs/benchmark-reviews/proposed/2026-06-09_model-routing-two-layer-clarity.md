---
status: proposed
date: 2026-06-09
source: OpenPawz / OpenCode Desktop
theme: 模型配置 Profile 层与工作空间模型路由层的关系对用户不透明
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# 用户不清楚「模型配置页」和「工作空间设置 - 模型路由」的分工关系

## 来源与借鉴理由

参考 OpenPawz 和 OpenCode Desktop 的 provider 抽象设计：**两层抽象（凭据层 vs 使用层）需要在 UI 上明确说明各自的职责**，否则用户会在两处重复配置或不知道改哪里。

## 当前差距

### 两个配置入口的功能分工：

| 页面 | 管理的是什么 |
|------|-------------|
| 菜单 → 模型配置（`SettingsPage`） | LLM Profile：供应商类型 + API Key + Base URL（凭据层） |
| 工作空间 → 设置 → 模型路由（`WorkspaceSettingsPage`） | 选「用哪个 Profile」+ 选「Profile 下的哪个具体模型」（使用层） |

**用户困惑的来源：**

1. **两处都叫"模型"相关**：`SettingsPage` 标题是「模型配置」，`WorkspaceSettingsPage` 里有「模型路由」section，两个词都含"模型"但含义不同

2. **工作空间设置里的「供应商配置」下拉**：选的是 LLM Profile（凭据对象），但下拉 label 是 profile 的名字（如"Gemini 2.5 Flash"），用户以为这里直接选模型，而不知道这是选"凭据档案"

3. **导航关系不明确**：`WorkspaceSettingsPage` 底部有「前往模型配置 →」按钮，但字体只有 12px、颜色是淡紫色，极易被忽略。当用户在工作空间设置里发现没有想要的 profile 时，不知道要去哪里加

4. **Wizard Step4 的 model 选择** 和 **WorkspaceSettingsPage 的 model 路由** 是同一功能的两个入口，但用户在 wizard 里设置完后不知道工作空间设置里还能改

### 代码层面的表现：
```tsx
// WorkspaceSettingsPage.tsx
<label className={styles.label}>
  <span>供应商配置</span>
  <select value={defaultLlmName}>
    {llmProfiles.map(p => <option>{p.name} ({provLabel})</option>)}
  </select>
</label>
// ↑ "供应商配置"这个 label 不够清晰，用户以为在选 provider 类型，实际是选 profile 名称
```

## 适合性判断

主要是**文案和 UI 层级说明**的修改，可以通过在两处加说明文字来解决大部分困惑，不需要重构架构。

## 对创作控制感的影响

**改善**。用户理解了两层抽象后，能主动管理"我这个工作空间用哪套模型"，而不是混乱地猜测。

## 对 workbench 协同的影响

**间接改善**。模型配置清晰后，用户能更自信地切换模型（比如：某个工作空间用 Gemini，另一个用本地 LM Studio），提升多工作空间的使用体验。

## 对 1.0 用户价值的影响

中等。不是 blocker，但涉及用户对产品核心概念的理解。

## 建议落地方式

### 修复 1：`WorkspaceSettingsPage` 模型路由 section 顶部加关系说明

```
模型路由

「供应商配置」管理 API 凭证（在模型配置页维护）。
选择供应商后，再指定该供应商下用于此工作空间的具体模型。
```

或更简洁的行内说明，放在「供应商配置」label 旁边：
```
供应商配置  （API 凭证在 → 模型配置页 管理）
```

### 修复 2：`WorkspaceSettingsPage` 的「前往模型配置 →」按钮提升可见性

当前：
```tsx
<button style={{ fontSize: 12, color: "var(--accent)", background: "transparent", border: "none" }}>
  前往模型配置 →
</button>
```

改为更醒目的位置和样式，或改成 profile 下拉框为空时显示的引导：
```
下拉框 options 为空时 → 显示提示：
「还没有 LLM 配置，请先前往模型配置页添加供应商」+ 「去添加 →」链接
```

### 修复 3：`WorkspaceSettingsPage` 中「供应商配置」下拉的 label 优化

将 label 从「供应商配置」改为「LLM 供应商 / 凭证配置」，或在 label 旁加 tooltip 说明：
```
供应商配置 ⓘ
（选择此工作空间使用的 API 凭证档案）
```

- [x] 直接改代码（文案 + 小 UI 调整）：
  - `apps/desktop/src/pages/WorkspaceSettingsPage.tsx`
    - 模型路由 section 顶部加说明文字
    - 「前往模型配置 →」提升可见性（或改为空状态引导）
    - 「供应商配置」label 增加说明

## 不做的理由（如适用）

N/A，建议做。全部是文案和 CSS 调整，改动量极小。
