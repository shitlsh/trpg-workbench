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
| 代码/文档编辑 | Monaco Editor | CodeMirror、Quill（用于资产主编辑器） |
| 图标 | Lucide React | FontAwesome、Material Icons |

> **不做 SSR、不做服务端路由**：产品是纯本地桌面工具，所有路由均为客户端路由（React Router 或 TanStack Router）。

---

## 主界面布局（三栏式，不可改变）

```
┌─────────────────────────────────────────────────────┐
│  左栏（320px）    │  中栏（flex-1）  │  右栏（240px）  │
│                  │                  │                │
│  Agent 面板       │  主编辑区         │  项目树         │
│  ─ 对话区         │  ─ 资产 .md      │  ─ Workspace   │
│  ─ 快捷动作       │  ─ Diff 视图     │  ─ 知识库       │
│  ─ 执行日志       │  ─ 引用预览      │  ─ 资产树       │
│                  │  ─ 编辑器        │  ─ 搜索         │
│                  │                  │                │
└─────────────────────────────────────────────────────┘
```

**约束**：
- 左栏宽度可拖拽调整，最小 280px，最大 480px（`ThreePanelLayout.tsx` minWidth 与 `editorStore` 默认值必须对齐，均为 280px）
- 右栏宽度可拖拽调整，最小 180px，最大 360px
- 中栏始终 flex-1，不可隐藏
- 左栏和右栏可折叠（collapse），但不可完全消失（保留折叠条）
- **面板宽度和折叠状态通过 `editorStore` 的 `zustand/middleware persist` 持久化**（`partialize` 只持久化 layout 四键：`leftWidth`、`rightWidth`、`leftCollapsed`、`rightCollapsed`），刷新后恢复上次状态
- 拖拽 handle 视觉宽度 **12px**（`padding: 0 4px`），hover 时背景高亮、中线颜色加深（pill 视觉反馈）
- **单击 handle 触发折叠/展开；拖拽（mousemove > 4px）触发 resize**，通过 `hasMoved` ref 区分意图，不能共用同一逻辑
- 折叠/展开加 `transition: width 150ms ease`
- **Zen Mode**：`Cmd+Shift+\` 同时切换左右栏折叠状态（若任一栏展开则全部折叠，否则全部展开），在 `WorkspacePage.tsx` 注册 keydown 事件

---

## 编辑器规范（Monaco Editor）

### 使用场景

| 内容类型 | 编辑器语言模式 | 说明 |
|---------|-------------|------|
| 资产文件 | `markdown` | frontmatter + Markdown body |
| Prompt 模板 | `markdown` | 可选编辑 |

### 单文件编辑 + Diff 切换

中栏编辑区展示资产的单个 `.md` 文件（frontmatter + Markdown body）：

```
[ 编辑视图 ] | [ Diff 视图 ]
```

- **编辑视图**：Monaco markdown 模式，可直接编辑 frontmatter + body
- **Diff 视图**：Monaco diff editor，对比当前版本与上一 revision

### 禁止

- 禁止引入 Quill 作为主编辑器
- 禁止在 Monaco 中实现复杂的所见即所得（WYSIWYG）渲染
- **TipTap 仅允许用于 @mention 输入组件（MentionInput），禁止用作资产主编辑器**

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
useSettingsStore     // UI 偏好、后端启动状态
```

### 持久化

- `useSettingsStore` 使用 `zustand/middleware` 的 `persist` 持久化到本地
- `useEditorStore` 使用 `zustand/middleware` 的 `persist`，**仅通过 `partialize` 持久化 layout 四键**（`leftWidth`、`rightWidth`、`leftCollapsed`、`rightCollapsed`），Tab 列表等运行时状态不持久化
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
| PDF ingest / Agent SSE 流式响应等长任务进度 | polling 或 SSE，封装在专用 hook 或组件中，不强制 Query |
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
/workspace/:id/settings    工作空间设置（config.yaml：规则集、模型绑定、Rerank 设置 + 额外知识库绑定）
/settings/rule-sets        规则集管理（规则集 + 知识库管理 + 关联提示词）
/settings/models           模型配置（LLM / Embedding / Rerank Profiles + 模型目录）
/settings/prompts          Prompt 配置（不再出现在主导航，路由保留供规则集页面跳转）
/usage                     用量观测（token 用量 + 成本汇总）
/help/:doc                 应用内帮助文档
```

**顶部主导航（3 项）：**
```
规则集 | 模型配置 | 用量观测
```
- 「规则集」指向 `/settings/rule-sets`，知识库在规则集详情中管理（M15 合并）
- 「Prompt 配置」不再出现在主导航，可从规则集详情页跳转访问

路由使用 **TanStack Router** 或 **React Router v6**（选其一，不混用）。

---

## Workspace 数据模型（M18 变更）

`Workspace` 类型（shared-schema）现在只有注册表字段：

```typescript
interface Workspace {
  id: string
  name: string
  workspace_path: string
  last_opened_at: string | null
  status: string
  created_at: string
  updated_at: string
}
```

所有配置（rule_set、模型绑定、rerank）在 `config.yaml` 中，通过 config API 读写：

```typescript
// 读取配置
GET /workspaces/:id/config → WorkspaceConfigResponse

// 修改配置
PATCH /workspaces/:id/config  body: Partial<WorkspaceConfig>
```

### 模型引用使用名称（非 UUID）

config.yaml 中的模型引用是 **名称字符串**（如 `"gemini-2.5-flash"`），不是 UUID。前端下拉框需要：
1. 获取 LLM/Embedding profiles 列表
2. 用 `name` 匹配 config 中的值
3. 保存时写回 `name`，不写 `id`

### HomePage 功能

- 显示 workspace 卡片列表（显示 `workspace_path` + `last_opened_at`）
- 新建 workspace：使用 `rule_set` 名称（非 UUID），可选指定 `workspace_path`
- 打开已有 workspace：`POST /workspaces/open` 注册已有目录
- 删除 = 从注册表移除（不删磁盘文件）

### WorkspacePage 顶部工具栏

路径：`src/pages/WorkspacePage.tsx`，顶部 toolbar 右侧区域，从左到右：

1. **PanelRight 图标**：折叠/展开右侧资产树
2. **BookDown 图标**（导出手册）：点击打开 `ExportDialog`，触发模组手册 PDF 导出流程
3. **Settings 图标**：跳转工作空间设置页

导出流程：
- `ExportDialog` 先 `POST /workspaces/{id}/export/validate` 检查草稿资产和断裂引用
- 用户确认后 `GET /workspaces/{id}/export/html` 取自包含 HTML
- 注入隐藏 `<iframe>` 并调用 `iframe.contentWindow.print()` 触发系统打印对话框

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

### ModelNameInput 组件（必须使用）

所有需要输入模型名称的地方**必须使用** `src/components/ModelNameInput.tsx`，禁止重复写 select/input 逻辑。

```tsx
import { ModelNameInput } from "../components/ModelNameInput";

<ModelNameInput
  catalog="llm"              // 或 "embedding"
  providerType={form.provider_type}
  value={modelName}
  onChange={setModelName}
  fetchedModels={fetchedModels}   // 动态 probe 结果（可选，默认 []）
  placeholder="例：gemini-2.0-flash"
  className={styles.input}
/>
```

**行为规则：**
- `fetchedModels.length > 0` → 渲染 `<select>` 下拉（动态 probe 结果优先）
- 无 probe 结果但 `providerType` 在 `KNOWN_LLM_MODELS` / `KNOWN_EMBEDDING_MODELS` 中 → `<input>` + `<datalist>` 建议
- 其余（如 `openai_compatible` 未 probe）→ 纯 `<input>`

**已知模型静态列表**维护在 `src/lib/modelCatalog.ts`，新增供应商只改这一个文件：

```
KNOWN_LLM_MODELS:   anthropic / google / openai（openrouter 留空，支持 probe）
KNOWN_EMBEDDING_MODELS: openai / google（openai_compatible 留空，支持 probe）
```

**当前覆盖的 5 处入口：**

| 文件 | 位置 | catalog |
|------|------|---------|
| `WorkspaceSettingsPage.tsx` | 工作空间设置 — 默认 LLM 模型 | llm |
| `SettingsPage.tsx` | 模型配置 — LLM 测试用模型名称 | llm |
| `SettingsPage.tsx` | 模型配置 — Embedding 模型名称 | embedding |
| `RuleSetPage.tsx` | 规则集 — AI 生成提示词模型名称 | llm |
| `WizardStep2Embedding.tsx` | Setup Wizard — Embedding 模型名称 | embedding |

**AgentPanel 底部模型选择器**（`src/components/agent/AgentPanel.tsx`）是 `<select>` 形式，不使用 `ModelNameInput`，但同样从 `KNOWN_LLM_MODELS` 取 fallback：

```tsx
const modelOptions = availableModels.length > 0
  ? availableModels
  : (KNOWN_LLM_MODELS[activeProfile?.provider_type ?? ""] ?? []);
```

---

## Agent 面板规范（M19）

左栏 Agent 面板采用 SSE 流式响应模式，**废弃旧的 WorkflowProgress/ClarificationCard 组件**。

### 面板布局

```
┌─────────────────────────┐
│  对话区（可滚动，全宽）    │
│  ─ 用户消息               │
│  ─ AI 流式响应气泡         │
│    ├── 流式文本（Markdown）│
│    └── ToolCallCard[]    │
├─────────────────────────┤
│  输入框（MentionInput）   │
│  ─ @mention 资产支持      │
│  ─ Enter 发送             │
│  ─ 发送/停止按钮           │
└─────────────────────────┘
```

**SessionDrawer（会话历史）约束**：
- SessionDrawer **不得**渲染为聊天列的 flex 兄弟节点（否则竞争宽度，导致消息被压缩到 ~100px）
- 打开历史时，以**覆盖视图**方式展示：在 AgentPanel 内用绝对定位覆盖聊天区，或切换渲染内容（聊天视图 ↔ 历史列表视图）
- 聊天列永远占满左栏全宽，不与任何侧边元素分割宽度

> **注意**：`PatchConfirmDialog` 已删除（M19 后期废弃）。所有资产写入均直接执行，无需用户逐条确认。

### SSE 流式响应消费规范

Agent 响应通过 SSE 流式推送，前端用 `fetch` + `ReadableStream` 消费，**不用 TanStack Query**：

```typescript
// AgentPanel.tsx 内，不抽为独立 hook（状态与渲染强耦合）
const res = await fetch(`${baseUrl}/workspaces/${wsId}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: abortRef.current.signal,
})
const reader = res.body!.getReader()
const decoder = new TextDecoder()
let buf = ""
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  // 按 "data: {...}\n\n" 解析 SSE 行
}
```

事件处理：

| SSE event type    | UI 动作 |
|-------------------|---------|
| `text_delta`      | 追加到流式消息气泡的文本（Markdown 渲染，见下方规范） |
| `tool_call_start` | 追加 `ToolCallCard`（状态: running） |
| `tool_call_result`| 更新对应 `ToolCallCard`（`done` / `error`；若 `data.workspace_mutating` 则为成功写盘，状态用 `auto_applied` 绿标并刷新资产列表） |
| `done`            | 关闭流，finalizing message |
| `error`           | 显示错误提示，关闭流 |

### Streaming State 规范（统一时序事件序列）

**禁止**将 `streamingText` 和 `streamingToolCalls` 分开存储为两个独立 state——这会导致 ToolCallCard 永远被渲染在文字上方，丢失"顺序感"。

**必须**使用统一事件序列 + 独立 thinking state：

```typescript
type StreamEvent =
  | { kind: "text_chunk"; text: string }
  | { kind: "tool_call"; toolCall: ToolCall }

const [streamingEvents, setStreamingEvents] = useState<StreamEvent[]>([]);
const [streamingThinking, setStreamingThinking] = useState("");
```

更新规则：
- `text_delta` → 找最后一个 `text_chunk` 并追加，或 push 新 `text_chunk`
- `thinking_delta` → 追加到 `streamingThinking` 字符串
- `tool_call_start` / `tool_call_result`（含 `workspace_mutating` 时与写盘成功同效） → push 或更新 `{ kind: "tool_call" }`
- `tool_call_result` → 用 id map 更新对应 `tool_call` 的 status/result_summary
- `done` → 从 events 派生 `accText`（合并所有 text_chunk）和 `accToolCalls`（Object.values(byId)），存入 ChatMessage（含 `thinking_json: accThinking || null`）

`StreamingBubble` 按 events 顺序渲染：text_chunk 用 `<ReactMarkdown>`，tool_call 用 `<ToolCallCard>`。
Blinking cursor 只放在最后一个 text_chunk 末尾。
若有 thinking，在气泡顶部渲染 `<ThinkingBlock>` 折叠块，传入 `isStreaming` prop 控制呼吸灯。

`ThinkingBlock` 规范：
- 默认折叠，点击展开
- streaming 时 header 显示小圆点呼吸灯（`animation: blink`）
- 内容用 `<pre>` 渲染（monospace，`var(--text-muted)` 色）
- `streaming` prop 来自父级 `isStreaming`，**不要**用 `events.length === 0` 来判断——这会在第一个 event 到达后立刻关掉指示灯

SSE 读取循环：当收到 `done` 或 `error` 事件后，**必须**设置 `streamDone = true` 来提前退出 `while(true)` 读循环，不要等待 `reader.read()` 返回 `{done: true}`。

> `patch_proposal` 事件已废弃，`PatchConfirmDialog` 已删除。所有资产写入直接执行。

### 聊天消息 Markdown 渲染规范

Assistant 消息文本**必须经过 Markdown 渲染**，不得以纯文本显示：
- 使用 `react-markdown`（`<ReactMarkdown>`）+ `remark-gfm` 插件（项目已安装）
- 消息气泡添加 `className="agent-md"` CSS 类，对应 `index.css` 中的 `.agent-md` 样式规则（p/ul/ol/h1-h3/code/pre/blockquote/table/strong/em/a）
- 代码块显示语法高亮
- 流式文本更新时每次 `text_delta` 触发重渲染（React 状态更新即可，无需手动 DOM 操作）
- 禁止用 `<pre>` 或 `<p>` 裸展示 assistant 消息文本

### ToolCallCard 规范

组件路径：`src/components/agent/ToolCallCard.tsx`

```
┌─ 工具调用 ─────────────────────┐
│  [▶] read_asset  ✓            │
│      slug: "mayor-arthur"     │
│      → 读取成功（1234 字节）    │
└───────────────────────────────┘
```

- 默认折叠，点击展开参数和结果详情
- 状态图标：`running` → spinner；`done` → ✓；`auto_applied` → ✓（绿色）；`error` → ✗
- 展开后显示格式化 JSON 参数（不是 `JSON.stringify` 裸字符串），结构化字段展示
- 展开后也显示 tool result（截断超长内容，提供"展开全部"）
- **禁止用 `toolCall.status === ("auto_applied" as string)` 这类类型 hack**；`auto_applied` 应作为合法 union 类型成员定义在 ToolCallStatus 类型中

### MentionInput 规范

组件路径：`src/components/agent/MentionInput.tsx`
技术：TipTap v3（`@tiptap/react` + `@tiptap/extension-mention` + `@tiptap/suggestion`）

```typescript
<MentionInput
  workspaceId={workspaceId}
  onSubmit={(text: string, mentionedAssetIds: string[]) => handleSend(text, mentionedAssetIds)}
  disabled={isStreaming}
/>
```

- `@` 触发建议下拉列表，通过 `GET /workspaces/{id}/assets?page_size=200` 加载资产
- 建议列表显示资产名称 + 类型标签
- Enter（无 Shift）提交，Shift+Enter 换行
- 提交时提取所有 mention 节点的 `id` 属性，传入 `mentionedAssetIds`
- 发送后清空编辑器
- **样式通过 CSS module 或 `src/styles/globals.css` 定义，禁止在组件 render 内通过 `document.head` 注入 `<style>` 标签**

### PatchConfirmDialog 规范

> **已废弃（M19 后期删除）**。`patch_proposal` SSE 事件已不再发出，所有资产写入直接执行。
> 禁止重建此组件。

### agentStore 状态（精简后）

```typescript
// src/stores/agentStore.ts
interface AgentStore {
  session: ChatSession | null
  messages: ChatMessage[]
  isTyping: boolean
  setSession: (s: ChatSession | null) => void
  setMessages: (msgs: ChatMessage[]) => void
  setTyping: (v: boolean) => void
}
```

旧的 `workflowState`、`consistencyResult`、`pendingClarification` 字段已删除。

---

## 禁止事项

- 禁止在前端直接操作本地文件系统（必须通过 Python 后端 API）
- 禁止引入 Next.js / SSR 相关逻辑
- 禁止在组件内随手裸 fetch 后端 API（SSE 流式消费除外，封装在 AgentPanel 内）
- 禁止用 Context + useReducer 替代 Zustand 管理全局状态
- 禁止引入 Quill 等富文本编辑器作为资产主编辑器（TipTap 仅限 MentionInput）
- 禁止 AI 响应以纯文本块展示（必须有 ToolCallCard 结构和流式气泡 + Markdown 渲染）
- **禁止重建 WorkflowProgress、ClarificationCard、PatchConfirmDialog 组件**（M19 已废弃）
- **禁止用 TanStack Query 消费 SSE 流**（SSE 流必须用 fetch + ReadableStream）
- **禁止用 `alert()` / `window.alert()` 弹框**（统一用 shadcn/ui Toast 或 Dialog）
- **禁止在组件 render 内通过 `document.head` 注入 `<style>` 标签**（用 CSS module 或 globals.css）

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

PDF ingest 等长任务必须有统一的进度展示模式。Agent SSE 流式响应本身不走此规范（见 Agent 面板规范）。

### 进度状态类型

```typescript
type TaskStatus = "idle" | "pending" | "running" | "completed" | "failed"

interface TaskProgress {
  task_id: string
  type: "pdf_ingest"
  status: TaskStatus
  current_step: number
  total_steps: number
  step_label: string
  progress_pct: number     // 0-100
  error_message?: string
}
```

### UI 表现规则

| 任务类型 | 进度展示位置 |
|---------|------------|
| PDF ingest | 知识库管理页面内联进度条 |

- 通过 polling（每 2s 查询一次任务状态）实现，封装在 `useTaskProgress` hook 中
- 任务完成后自动触发相关 Query 的 invalidation
- 任务失败时显示错误原因 + 重试入口

---

## Tab 管理规范

中栏编辑区采用多 Tab 模式，打开资产时在 Tab 中展示。

### Tab 行为规则

- **单例原则**：同一个 asset 只能有一个 Tab，再次点击时激活已有 Tab，不重复打开
- **脏状态标识**：有未保存改动的 Tab，标题后显示 `●` 标记
- **关闭确认**：关闭脏状态 Tab 时弹出确认对话框（"有未保存的改动，确认关闭？"）
- **Tab 上限**：最多同时打开 10 个 Tab，超出时用 shadcn/ui `Toast` 提示用户关闭部分 Tab（**禁止用 `alert()` 或 `window.alert()`**）
- **恢复策略**：应用重启后不恢复上次打开的 Tab，从空白状态开始（避免加载失败的空 Tab）

### Tab 与路由的关系

- URL 反映当前**激活**的 Tab：`/workspace/:id/asset/:aid`
- 切换 Tab 时更新 URL，支持浏览器前进/后退
- 直接访问 URL 时自动打开对应资产的 Tab
- Tab 列表状态存入 `useEditorStore`，不持久化到本地（刷新后清空）

### AssetMetaPanel（资产元信息面板）

组件路径：`src/components/editor/AssetMetaPanel.tsx`

- **已挂载**到 `EditorCenter.tsx` 的 TabBar 下方，作为可折叠条展示
- 折叠条显示：slug、status badge、version
- 点击折叠条展开完整 `AssetMetaPanel`，max-height 约 280px
- 折叠状态用 `EditorCenter` 内部的 `metaOpen` state 管理

**关联资产区块（M32）**：

面板底部展示跨资产引用关系，分"引用了"和"被引用"两列：

- 数据来源：`useAssetRelations(workspaceId, slug, allAssets, contentMd)` hook
  - 向后端请求 `GET /workspaces/{id}/assets/relations`（frontmatter 字段引用）
  - 同时扫描当前资产 `content_md` 中的 `[[slug]]` wikilink 引用
- 点击条目调用 `apiFetch(/assets/{id})` + `useEditorStore.openTab()` 跳转
- 状态更新后需 invalidate `["asset-relations", workspaceId]` query key

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
  - LLM Step：`name` 和 `model_name` 必填；`api_key` 仅对非 `openai_compatible` 供应商必填（本地模型无需 key）
- 不允许在 Wizard 期间跳转到主业务路由

---

## 资产类型视觉规范（Asset Type Visual Identity）

> **来源**：参照 Inscriptor 的彩色 per-type 图标机制（benchmark review `2026-04-23_inscriptor-visual-language.md`）。
> 每种资产类型必须有独立的语义颜色 + Lucide 图标，**不可全部使用 `<File>` 或统一灰色**。

### 图标与颜色映射表（强制约束）

> **M30 更新**：内置类型精简为 6 种。旧类型（location/branch/timeline/map_brief/lore_note）保留 fallback 渲染，
> 不出现在新建资产流程中。

| AssetType | 中文标签 | Lucide 图标  | CSS 变量               | 颜色值（dark） |
|-----------|---------|-------------|----------------------|--------------|
| `outline` | 大纲     | `BookOpen`  | `--color-type-outline` | `#7c6af7`   |
| `stage`   | 场景     | `Theater`   | `--color-type-stage`   | `#e05252`   |
| `npc`     | NPC      | `Users`     | `--color-type-npc`     | `#52b4c9`   |
| `monster` | 敌人     | `Skull`     | `--color-type-monster` | `#f07030`   |
| `map`     | 地图     | `Map`       | `--color-type-map`     | `#52c97e`   |
| `clue`    | 线索     | `Search`    | `--color-type-clue`    | `#f0c050`   |
| 自定义类型 | 取 config.label | — (emoji via config.icon) | `--text-muted` (fallback) | — |

### 使用规则

- 图标颜色使用对应 CSS 变量，不得硬编码颜色值
- 所有用到 AssetType 的地方（资产树、Agent 面板资产列表、Tab 标签）必须使用上表中对应的图标和颜色
- 禁止在资产列表/树中使用通用 `<File>` 图标替代
- 自定义类型用 `getCustomTypeEmoji(type, customConfigs)` 获取 emoji；内置类型返回 null

### 辅助函数约定

在 `src/lib/assetTypeVisual.ts` 中统一导出以下辅助函数，各组件从此处引入，不得各自重复定义：

```typescript
import type { CustomAssetTypeConfig } from "@trpg-workbench/shared-schema";

export function getAssetTypeIcon(type: string): LucideIcon { ... }
export function getAssetTypeColor(type: string): string { ... }        // 返回 CSS 变量字符串，如 "var(--color-type-npc)"
export function getAssetTypeLabel(type: string, customConfigs?: CustomAssetTypeConfig[]): string { ... }  // 返回中文标签
export function getCustomTypeEmoji(type: string, customConfigs: CustomAssetTypeConfig[]): string | null { ... }
export function getAssetTypeDescription(type: string, customConfigs?: CustomAssetTypeConfig[]): string { ... }  // M30 新增，用于 tooltip
```

---

## 颜色梯度规范（Text Color Hierarchy）

> **来源**：参照 Inscriptor 排版密度控制（benchmark review `2026-04-23_inscriptor-layout-density.md`）。

### 三档文字颜色（强制）

| 变量名            | 用途                                         | dark 值   | light 值  |
|------------------|----------------------------------------------|-----------|-----------|
| `--text`         | 主内容：资产名、输入值、正文                  | `#e8e8e8` | `#1a1814` |
| `--text-muted`   | 辅助信息：分类标签、描述、次要操作            | `#999`    | `#6b6560` |
| `--text-subtle`  | 最低优先级：时间戳、计数 badge、占位提示文字  | `#666`    | `#a0998f` |

**规则**：
- 新组件中出现三种以上视觉重量的文字时，必须对应使用三档变量
- 禁止用 `opacity` 或硬编码颜色实现文字层次（统一用 CSS 变量）
- `--text-subtle` 不得用于可交互元素（按钮/链接），仅用于纯展示信息

### Spacing Scale（推荐，逐步收敛）

在 `index.css` 中定义如下 spacing 变量，新组件优先使用这些变量，存量组件遇到修改时顺带收敛：

```css
--sp-1: 4px;
--sp-2: 8px;
--sp-3: 12px;
--sp-4: 16px;
--sp-5: 20px;
--sp-6: 24px;
```

> **注**：不要求全量替换现有硬编码间距，只约束新增代码必须使用变量。

---

## Active / Selected 状态规范

> **来源**：参照 Inscriptor 焦点感设计（benchmark review `2026-04-23_inscriptor-layout-density.md`）。

### 资产树 Active 条目

当某资产被选中并在中栏打开时，其在资产树中必须有**持久高亮状态**，不仅仅是 hover 效果：

```
选中状态 = 左侧 3px 彩色 border + 浅色背景（该类型颜色 8% 透明度）
```

具体实现：
```tsx
// 选中时的样式
{
  borderLeft: `3px solid var(--color-type-${type.replace('_','-')})`,
  background: `color-mix(in srgb, var(--color-type-${type.replace('_','-')}) 8%, transparent)`,
  paddingLeft: "21px",  // 比普通行少 3px，补偿 border 宽度
}

// 未选中时
{
  borderLeft: "3px solid transparent",
  paddingLeft: "21px",
}
```

### Hover vs. Active 的区别

| 状态       | 背景                  | 左侧 border               |
|-----------|----------------------|--------------------------|
| 默认       | 无                    | 3px transparent           |
| Hover      | `var(--bg-hover)`    | 3px transparent           |
| Active（选中）| 类型色 8% 透明度     | 3px 实色（类型颜色）         |

- Active 状态由 `useEditorStore` 中的 `activeTabId` 驱动，不使用本地 state
- 资产树中的 active 判断：当前 tab 对应的 asset id 与树中条目 id 一致时为 active

---

## 资产树操作规范（AssetTree）

组件路径：`src/components/editor/AssetTree.tsx`

### 新建资产

- 名称输入框 + 类型选择，点击"新建"按钮提交
- **`slugify()` 结果为空时（纯中文名称等），必须回退到 `{type}-{Date.now().toString(36)}` 作为 slug**，保证 slug 不为空
- 创建按钮 disabled 条件为 `!name`（名称为空），不依赖 slug 是否为空

### 删除资产

- **禁止用 `window.confirm()` 弹框**，改用 shadcn/ui `AlertDialog` 确认弹窗
- AlertDialog 显示资产名称，标注"永久删除"警告
- 确认删除后，后端需同时删除磁盘 `.md` 文件（`os.unlink`）和软删除 DB 行，防止 sync_service 复活已删资产

### 重命名资产

- 右键菜单提供"重命名"选项
- 触发 inline modal dialog（autoFocus，Enter 确认，Escape 取消）
- 提交时调用 `PATCH /assets/{id}` with `{ name: newName }`

### 复制资产

- 右键菜单提供"复制"选项
- 复制时新名称为 `{原名} 副本`，slug 附加 timestamp（保证唯一性）
- 调用 POST create API 创建新资产

### 右键菜单顺序

重命名 → 复制 → （分隔线）→ 删除
