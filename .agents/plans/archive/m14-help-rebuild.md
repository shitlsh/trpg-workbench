# M14：Help 文档重建与维护机制

**前置条件**：M13 完成（UI 视觉语言升级已归档）。

**状态：✅ 已完成（commit 2a38fc7）**

**目标**：重建 Help 文档内容（人工编写、任务导向、嵌入截图），调整文档维护机制（src/help 为 source of truth，smoke skill 解耦），增强 HelpPage 交互（应用内链接跳转、上下文 Help 入口）。

---

## 背景与动机

Benchmark review 发现当前 Help 文档存在严重的内容与 UI 不一致问题，且文档生成机制（DOM 提取→自动拼接→同步到 src）的质量天花板太低，无法产出合格的使用指南。详见：

- `docs/benchmark-reviews/completed/2026-04-23_help-doc-generation-mechanism.md`
- `docs/benchmark-reviews/completed/2026-04-23_help-module-improvements.md`

核心问题：
1. getting-started.md 完全未提及 Setup Wizard，步骤顺序与实际相反
2. 2 篇文档自带"待人工核对"注释，从未被验证
3. 文档是"界面元素清单"而非"使用指南"，缺少操作意图和决策逻辑
4. 14 张截图存在于 ui-snapshots 但 0 张嵌入文档
5. 文档内页面引用为纯文本，无法跳转
6. 仅首页有 HelpButton，功能页面内无帮助入口
7. smoke skill 的文档生成职责与 smoke test 职责混合，导致两者都不好用

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：重写 Help 文档内容（人工编写，任务导向）**

方案：以"用户任务"为组织维度重写 5 篇文档。每篇围绕"我想做 X，怎么做"展开，而非"这个页面有哪些按钮"。

- getting-started.md：加入 Setup Wizard 流程，修正步骤顺序为实际流程（先配模型→再建工作空间）
- model-setup.md：核对模型供应商列表、Embedding 模型列表是否与代码一致
- knowledge-import.md：移除"基于 DOM 状态生成"注释，核实操作流程
- start-creating.md：移除"待人工核对"注释，补充 Agent 面板的实际交互描述
- rule-set-management.md：核对规则集页面布局和操作流程

**A2：文档嵌入截图**

方案：为每篇文档补充 1-3 张关键截图，截图存放在 `apps/desktop/src/help/images/`。利用 tauri-ui-smoke-and-docs skill 或手动截图。HelpPage.tsx 的 ReactMarkdown 需加 custom image renderer 处理图片路径。

技术约束：`src/help/*.md` 通过 Vite `?raw` 导入，图片不能用相对路径引用。方案选择：
- 方案 a：图片用 Vite import 导入为 URL，在 ReactMarkdown 的 image renderer 中映射
- 方案 b：图片放到 `public/help-images/`，用绝对路径 `/help-images/xxx.png` 引用
- 优先选方案 b（更简单，无需额外映射逻辑）

**A3：HelpPage 交互增强**

方案：
- ReactMarkdown 加 custom link renderer：以 `/` 开头的链接用 `navigate()` 跳转，实现文档内应用导航
- 文档中的页面引用改为 Markdown 链接格式（如 `[模型配置](/settings/models)`）

**A4：各功能页面增加上下文 Help 入口**

方案：在 SettingsPage、KnowledgePage、RuleSetPage、WorkspaceSettingsPage 头部各加一个 HelpButton，传入对应的 doc slug。复用已有 HelpButton 组件。

**A5：调整文档维护机制**

方案：
- 明确 `apps/desktop/src/help/` 为 Help 文档的 source of truth，人工维护
- `tauri-ui-smoke-and-docs` skill 中 help 文档生成降级为"可选初稿参考"，不再作为文档更新的主路径
- `milestone-management` skill 的归档 checklist（Step 0b 或 Step 5）增加一项："检查 help 文档是否需要因本 milestone 的 UI 变更而更新"

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：Help 文档 TOC 锚点**：从 markdown heading 自动生成 TOC 侧栏锚点。当前 5 篇文档内容不长，价值有限，文档增加后再评估。
- **B2：Onboarding Checklist**：首页持续性配置进度展示。已有独立 proposed review（`onboarding-checklist-profile-health.md`），可在后续 milestone 中独立实现。

### C 类：明确不承诺

- Tauri 原生 Help 菜单：之前试过不好用，且不利于 web 版兼容
- Help 文档搜索：当前文档量不需要搜索
- 多语言文档：1.0 目标用户为中文用户
- Feature Discovery Tooltips：已有独立 proposed review（deferred）

---

## 文件结构

### 修改文件

```
apps/desktop/src/help/getting-started.md     — 重写
apps/desktop/src/help/model-setup.md          — 核对更新
apps/desktop/src/help/knowledge-import.md     — 核对更新，移除注释
apps/desktop/src/help/start-creating.md       — 核对更新，移除注释
apps/desktop/src/help/rule-set-management.md  — 核对更新
apps/desktop/src/pages/HelpPage.tsx           — custom link/image renderer
apps/desktop/src/pages/SettingsPage.tsx        — 加 HelpButton
apps/desktop/src/pages/KnowledgePage.tsx       — 加 HelpButton
apps/desktop/src/pages/RuleSetPage.tsx         — 加 HelpButton
apps/desktop/src/pages/WorkspaceSettingsPage.tsx — 加 HelpButton（如存在）
.agents/skills/tauri-ui-smoke-and-docs/SKILL.md — 降级 help 文档生成职责
.agents/skills/milestone-management/SKILL.md    — 归档 checklist 增加 help 文档检查项
```

### 新增文件

```
apps/desktop/public/help-images/              — 截图目录
apps/desktop/public/help-images/setup-wizard.png
apps/desktop/public/help-images/home.png
apps/desktop/public/help-images/model-config.png
apps/desktop/public/help-images/knowledge.png
apps/desktop/public/help-images/workspace.png
apps/desktop/public/help-images/ruleset.png
```

---

## 关键设计约束

### 截图路径处理

```
# 文档中的写法（方案 b）
![首页](/help-images/home.png)

# Vite 处理：public/ 下的文件以绝对路径提供
# ReactMarkdown 的 img 标签直接使用 src="/help-images/home.png"
```

### 应用内链接跳转

```tsx
// HelpPage.tsx — custom link renderer
const components = {
  a: ({ href, children }) => {
    if (href?.startsWith("/")) {
      return <Link to={href}>{children}</Link>;
    }
    return <a href={href} target="_blank" rel="noopener">{children}</a>;
  },
};

<ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
  {content}
</ReactMarkdown>
```

---

## Todo

### A1：重写 Help 文档内容

- [x] **A1.1**：`getting-started.md` — 重写，加入 Setup Wizard 流程，修正步骤顺序
- [x] **A1.2**：`model-setup.md` — 核对供应商列表、模型列表，更新不一致内容
- [x] **A1.3**：`knowledge-import.md` — 移除"基于 DOM 状态生成"注释，核实流程
- [x] **A1.4**：`start-creating.md` — 移除"待人工核对"注释，补充 Agent 面板交互
- [x] **A1.5**：`rule-set-management.md` — 核对规则集页面，确认操作步骤准确

### A2：文档嵌入截图

- [x] **A2.1**：创建 `apps/desktop/public/help-images/` 目录
- [x] **A2.2**：截取关键页面截图（首页、Setup Wizard、模型配置、知识库、工作台、规则集）
- [x] **A2.3**：在各文档中嵌入对应截图

### A3：HelpPage 交互增强

- [x] **A3.1**：`HelpPage.tsx` — 添加 custom link renderer（`/` 开头用 React Router 导航）
- [x] **A3.2**：5 篇文档中页面引用改为 Markdown 链接格式

### A4：各功能页面 Help 入口

- [x] **A4.1**：`SettingsPage.tsx` — 头部加 HelpButton，跳转 `/help/model-setup`
- [x] **A4.2**：`KnowledgePage.tsx` — 头部加 HelpButton，跳转 `/help/knowledge-import`
- [x] **A4.3**：`RuleSetPage.tsx` — 头部加 HelpButton，跳转 `/help/rule-set-management`
- [x] **A4.4**：`WorkspaceSettingsPage.tsx` — 头部加 HelpButton（如页面存在）

### A5：调整文档维护机制

- [x] **A5.1**：`tauri-ui-smoke-and-docs/SKILL.md` — help 文档生成降级为可选，明确 src/help 为 truth
- [x] **A5.2**：`milestone-management/SKILL.md` — 归档 checklist 增加 help 文档检查项

---

## 验收标准

1. 在首次启动（未完成 Setup）时，getting-started.md 的描述与实际体验（重定向到 /setup）一致
2. 5 篇文档中无"待人工核对"或"基于 DOM 状态生成"等临时注释
3. 每篇文档至少嵌入 1 张截图，截图在 HelpPage 中正确渲染
4. 文档中的 `[模型配置](/settings/models)` 等链接可点击跳转到对应页面
5. 在 SettingsPage、KnowledgePage、RuleSetPage 头部可见 HelpButton，点击跳转到对应帮助文档
6. `tauri-ui-smoke-and-docs` skill 中 help 文档生成标注为"可选参考"而非"同步来源"

---

## 与其他里程碑的关系

```
M9（Smoke/Help 初始实现）
  └── M14（Help 文档重建与维护机制）
        └── B2: Onboarding Checklist（后续 milestone）
```

---

## 非目标

- 不重建 smoke test 流程本身——smoke test 能力保留，仅解耦 help 文档生成
- 不新增 help 文档篇目——保持 5 篇，不扩展范围
- 不做 Tauri 原生 Help 菜单——已确认不好用且不利于 web 兼容
- 不做 Help 文档国际化——1.0 目标用户为中文用户
