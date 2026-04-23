---
name: frontend-ui-patterns
description: 约束 trpg-workbench 前端的布局结构、组件选型、状态管理和数据请求规范。当实现或讨论任何前端相关功能时必须加载本 skill，包括：页面布局设计、新建 React 组件、选择 UI 组件库、实现编辑器功能、管理全局状态、调用后端 API、设计 Agent 面板交互，或任何涉及前端技术选型的讨论。
---

# Skill: frontend-ui-patterns

## 用途

本 skill 约束 `trpg-workbench` 前端的布局模式、组件选型、状态管理、数据请求规范。**不允许引入与本 skill 冲突的 UI 框架或架构模式。**

---

## 技术栈（锁死）

| 用途 | 技术 | 禁止替换为 |
|------|------|-----------|
| 前端框架 | React + Vite + TypeScript | Next.js、Remix、SvelteKit |
| 桌面壳 | Tauri | Electron |
| 状态管理 | Zustand | Redux、MobX、Context+useReducer（复杂状态） |
| 数据请求 | TanStack Query | SWR、react-query v3、Axios 裸用 |
| UI 组件库 | shadcn/ui | Ant Design、MUI（Material UI） |
| 代码/文档编辑 | Monaco Editor | CodeMirror、Quill、TipTap（富文本） |
| 图标 | Lucide React | FontAwesome、Material Icons |

> **不做 SSR、不做服务端路由**：产品是纯本地桌面工具，所有路由均为客户端路由（React Router 或 TanStack Router）。

---

## 主界面布局（三栏式，不可改变）

```
┌─────────────────────────────────────────────────────┐
│  左栏（240px）    │  中栏（flex-1）  │  右栏（320px）  │
│                  │                  │                │
│  项目树           │  主编辑区         │  Agent 面板     │
│  ─ Workspace     │  ─ 资产 MD/JSON  │  ─ 对话区       │
│  ─ 知识库         │  ─ Diff 视图     │  ─ 快捷动作     │
│  ─ 资产树         │  ─ 引用预览      │  ─ 执行日志     │
│  ─ 搜索           │  ─ 编辑器        │  ─ patch 摘要   │
│                  │                  │                │
└─────────────────────────────────────────────────────┘
```

**约束**：
- 左栏宽度可拖拽调整，最小 180px，最大 360px
- 右栏宽度可拖拽调整，最小 280px，最大 480px
- 中栏始终 flex-1，不可隐藏
- 左栏和右栏可折叠（collapse），但不可完全消失（保留折叠条）

---

## 编辑器规范（Monaco Editor）

### 使用场景

| 内容类型 | 编辑器语言模式 | 说明 |
|---------|-------------|------|
| 资产 Markdown | `markdown` | 供用户阅读/手动编辑 |
| 资产 JSON | `json` | 程序结构化数据 |
| Prompt 模板 | `markdown` | 可选编辑 |

### 双视图切换

中栏编辑区必须支持在同一资产的 MD 和 JSON 之间切换：

```
[ Markdown 视图 ] | [ JSON 视图 ] | [ Diff 视图 ]
```

- **Markdown 视图**：Monaco markdown 模式，可直接编辑
- **JSON 视图**：Monaco json 模式，格式验证，Schema 提示
- **Diff 视图**：Monaco diff editor，对比当前版本与上一 revision

### 禁止

- 禁止引入 Quill、TipTap、Slate 等富文本编辑器作为主编辑器
- 禁止在 Monaco 中实现复杂的所见即所得（WYSIWYG）渲染

---

## 状态管理规范（Zustand）

### Store 划分原则

每个关注点独立一个 store，不做大一统 store：

```typescript
// 工作空间相关
useWorkspaceStore    // 当前 workspace、asset 树
useEditorStore       // 当前打开的资产、编辑状态、diff 模式
useAgentStore        // Agent 面板状态、对话历史、执行日志
useKnowledgeStore    // 知识库列表、解析状态
useSettingsStore     // UI 偏好、后端启动状态（模型配置已迁移到后端 DB，通过 TanStack Query 获取）
```

### 持久化

- `useSettingsStore` 使用 `zustand/middleware` 的 `persist` 持久化到本地
- 其他 store 不持久化，刷新后从后端重新加载

---

## 数据请求规范（TanStack Query）

### 适用范围

TanStack Query 用于**查询型、请求-响应型 API 调用**，不是所有网络交互的强制方案：

| 场景 | 使用方式 |
|------|---------|
| 资产、知识库、会话等数据查询 | `useQuery`，必须走 TanStack Query |
| 资产创建、修改、删除等写操作 | `useMutation`，必须走 TanStack Query |
| 后端健康检查 / 启动握手 | 独立 service 函数，不需要 Query |
| PDF ingest / Workflow 等长任务进度 | polling 或 SSE，封装在专用 hook 中，不强制 Query |
| Tauri 事件订阅 | Tauri event API，不走 Query |
| 编辑器自动保存（局部静默保存） | 独立 debounce 逻辑，不走 Query |

**禁止在页面组件里随手裸 fetch**（不走 Query 也不走封装 hook 的直接 fetch 调用）。

### 后端 base URL

统一从配置读取：`VITE_BACKEND_URL`（默认 `http://127.0.0.1:7821`）

### Query Key 命名规范

```typescript
// 格式：['资源类型', 'action', ...params]
['workspaces', 'list']
['workspace', workspaceId]
['assets', workspaceId, 'list']
['asset', assetId]
['asset', assetId, 'revisions']
['knowledge', 'libraries', 'list']
['chat', sessionId, 'messages']
// M6/M7 新增资源
['llm-profiles', 'list']
['embedding-profiles', 'list']
['model-catalog', providerType]          // providerType 可为 undefined（全部）
['embedding-catalog', providerType]
['usage', 'summary']
['usage', 'by-workspace', workspaceId]
['usage', 'by-model']
['usage', 'recent']
```

---

## 页面/路由结构

```
/                          首页（最近 Workspace + 新建入口 + 用量观测入口）
/workspace/:id             工作空间主界面（三栏布局）
/workspace/:id/asset/:aid  资产详情（在三栏中栏打开）
/workspace/:id/settings    工作空间设置（LLM/Embedding/RAG 路由配置 + 额外知识库绑定）
/knowledge                 知识库管理（全局，独立于规则集）
/settings/rule-sets        规则集管理（规则集 + 关联知识库 + 关联提示词）
/settings/models           模型配置（LLM / Embedding / Rerank Profiles + 模型目录）
/settings/prompts          Prompt 配置（不再出现在主导航，路由保留供规则集页面跳转）
/usage                     用量观测（token 用量 + 成本汇总）
/help/:doc                 应用内帮助文档
```

**顶部主导航（4 项）：**
```
规则集 | 知识库 | 模型配置 | 用量观测
```
- 「规则集」指向 `/settings/rule-sets`，替代原有的「Prompt 配置」入口
- 「知识库」指向 `/knowledge`，保持独立（全局知识库管理，不合并到规则集页）
- 「Prompt 配置」不再出现在主导航，可从规则集详情页跳转访问

路由使用 **TanStack Router** 或 **React Router v6**（选其一，不混用）。

---

## 组件设计规范

### 命名

- 页面级组件：`PascalCase`，放在 `src/pages/`
- 可复用 UI 组件：放在 `src/components/`
- Agent 相关组件：放在 `src/components/agent/`
- 编辑器相关：放在 `src/components/editor/`

### shadcn/ui 使用约定

- 优先使用 shadcn/ui 提供的基础组件（Button、Input、Dialog、Tabs、Tooltip 等）
- 自定义组件通过 shadcn/ui 基础组件组合，不写裸 HTML + CSS（除非必要）
- 主题色与设计系统在 `src/styles/globals.css` 中统一定义 CSS 变量

---

## Agent 面板规范

右栏 Agent 面板必须包含以下区域：

```
┌─────────────────────────┐
│  对话区（可滚动）          │
│  ─ 用户消息               │
│  ─ AI 响应                │
│    ├── 解释文本            │
│    ├── 将修改的资产列表     │
│    ├── 变更摘要            │
│    └── 引用来源（可展开）   │
├─────────────────────────┤
│  执行日志（可折叠）        │
├─────────────────────────┤
│  快捷动作按钮组            │
│  [新建资产] [一致性检查]   │
│  [规则审查] [生成图像]     │
├─────────────────────────┤
│  输入框 + 发送按钮         │
└─────────────────────────┘
```

**AI 响应必须分层展示**（不能是纯文本块）：
1. 解释说明
2. 将要修改/创建的资产清单
3. 变更摘要
4. 引用来源（文档名 + 页码，可折叠展开）
5. 落盘状态（已保存 / 待确认）

---

## 禁止事项

- 禁止在前端直接操作本地文件系统（必须通过 Python 后端 API）
- 禁止引入 Next.js / SSR 相关逻辑
- 禁止在组件内随手裸 fetch 后端 API（必须走 TanStack Query 或封装 hook）
- 禁止用 Context + useReducer 替代 Zustand 管理全局状态
- 禁止引入重型富文本编辑器（Quill、TipTap）作为资产主编辑器
- 禁止 AI 响应以纯文本块展示（必须分层结构化展示）

---

## 应用启动态规范

后端服务启动需要时间，前端必须处理启动握手过程，不能假设后端立即可用。

### 启动状态机

```
backend_status: "starting" → "ready" | "failed"
```

| 状态 | UI 表现 |
|------|---------|
| `starting` | 全屏启动加载界面，显示进度提示（"正在启动服务..."） |
| `ready` | 正常渲染主界面 |
| `failed` | 全屏错误界面，显示错误原因 + 重试按钮 |
| `disconnected`（运行中断连） | 顶部 Banner 提示 + 自动重连倒计时 |

- 启动握手通过轮询 `/health` 端点实现，间隔 500ms，超时 30s
- 握手成功前不渲染任何业务 UI，避免空数据闪烁
- `backend_status` 存入 `useSettingsStore`（持久化中跳过此字段）

---

## 长任务进度 UI 规范

PDF ingest、Workflow 执行、图像生成等长任务，必须有统一的进度展示模式。

### 进度状态类型

```typescript
type TaskStatus = "idle" | "pending" | "running" | "completed" | "failed"

interface TaskProgress {
  task_id: string
  type: "pdf_ingest" | "workflow" | "image_gen"
  status: TaskStatus
  current_step: number
  total_steps: number
  step_label: string       // 当前步骤的人类可读描述
  progress_pct: number     // 0-100
  error_message?: string
}
```

### UI 表现规则

| 任务类型 | 进度展示位置 |
|---------|------------|
| PDF ingest | 知识库管理页面内联进度条 |
| Workflow（新建模组/修改资产） | Agent 面板执行日志区域，带步骤列表 |
| 图像生成 | 资产详情图像区域内联进度 |

- 所有长任务通过 polling（每 2s 查询一次任务状态）实现，封装在 `useTaskProgress` hook 中
- 任务完成后自动触发相关 Query 的 invalidation（刷新受影响数据）
- 任务失败时显示错误原因 + 重试入口，不自动清除

---

## Tab 管理规范

中栏编辑区采用多 Tab 模式，打开资产时在 Tab 中展示。

### Tab 行为规则

- **单例原则**：同一个 asset 只能有一个 Tab，再次点击时激活已有 Tab，不重复打开
- **脏状态标识**：有未保存改动的 Tab，标题后显示 `●` 标记
- **关闭确认**：关闭脏状态 Tab 时弹出确认对话框（"有未保存的改动，确认关闭？"）
- **Tab 上限**：最多同时打开 10 个 Tab，超出时提示用户关闭部分 Tab
- **恢复策略**：应用重启后不恢复上次打开的 Tab，从空白状态开始（避免加载失败的空 Tab）

### Tab 与路由的关系

- URL 反映当前**激活**的 Tab：`/workspace/:id/asset/:aid`
- 切换 Tab 时更新 URL，支持浏览器前进/后退
- 直接访问 URL 时自动打开对应资产的 Tab
- Tab 列表状态存入 `useEditorStore`，不持久化到本地（刷新后清空）

---

## Onboarding Wizard 规范（M11）

首次启动或无可用 LLM Profile 时，应进入 Onboarding Wizard，引导用户完成最低配置，**不得跳过直接进入主界面**。

### 触发条件

- 应用首次启动（无任何 LLM Profile）
- 用户从设置页手动触发重置

### 步骤结构（线性，不可跳步）

```
Step 1: 欢迎 + 产品简介
Step 2: 配置 LLM Provider（必填）
Step 3: 配置 Embedding Provider（可跳过，但需明确提示影响）
Step 4: 创建第一个 RuleSet（必填）
Step 5: 完成 → 跳转到新建 Workspace
```

### UI 约束

- 使用全屏 Dialog 或独立 `/onboarding` 路由，不使用主界面三栏布局
- 每步顶部显示步骤指示器（Step 1 / 5）
- 「下一步」按钮在当前步必填项未完成时禁用
- 不允许在 Wizard 期间跳转到主业务路由

---

## WorkflowProgress 展开 UI 规范（M12）

Agent 面板的执行日志区域，在 Workflow 运行时必须展示步骤列表和透明度信息。

### director_intent 展示

```
┌─────────────────────────────────┐
│  AI 意图                         │
│  "根据用户请求，将修改 NPC 张三的  │
│   背景故事并关联已有的地点资产"    │
└─────────────────────────────────┘
```

- `director_intent` 非空时，在步骤列表上方渲染一个浅色信息卡片
- `director_intent` 为 null 时，不渲染该区域（不占位）

### CitationsPanel 展示

当步骤的 `detail` 字段为非 null JSON 字符串时，解析为 citations 列表并展示：

```
┌─ 步骤：检索知识库 ✓ ─────────────┐
│  [▶ 查看 3 条引用来源]            │
│                                  │
│  • coc7e_core_rules.pdf          │
│    p.45–46                       │
│    「深潜者是一种栖息于...」       │
│                                  │
│  • module_ref.pdf                │
│    p.12                          │
│    「Arkham 城的地理位置...」      │
└──────────────────────────────────┘
```

- citations 默认折叠，点击"查看 N 条引用来源"展开（`<ChevronRight>` → `<ChevronDown>`）
- `detail` 为 null 时不显示引用区域
- `detail` 解析失败（非法 JSON）时，不渲染 CitationsPanel，不报错崩溃
- 每条 citation 展示：文档名、页码范围（`p.from–to`）、content 截断预览（前 200 字，前端截断）
- **不显示 vector_score / rerank_score**（这些是后端检索分数，不对用户展示）
- `step.status === "completed"` 时才渲染 CitationsPanel（运行中和失败步骤不展示）

### WorkflowProgress 组件位置

- 组件路径：`src/components/agent/WorkflowProgress.tsx`
- 在 Agent 面板的「执行日志（可折叠）」区域内渲染
- Workflow 运行时自动展开日志区域；完成后保持展开，允许用户手动折叠
