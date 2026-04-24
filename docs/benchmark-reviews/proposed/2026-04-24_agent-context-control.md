---
status: proposed
date: 2026-04-24
updated: 2026-04-25
source: Internal (baseline goal reassessment)
theme: Agent 上下文控制与工具能力（@引用 + Tool-calling + 自主读写）
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# Agent 上下文控制与工具能力

## 问题

当前 Agent 交互系统极度基础，对比成熟的 AI 创作/编码工具（Cursor、OpenCode、Windsurf）存在**六个层面**的差距：

### 1. 上下文盲区：Agent 看不到资产内容

- Director 只看到所有资产的元数据 `{type, name, slug}`，**完全看不到内容**
- 用户无法说"参考这个 NPC 来修改那个场景"并确保 Agent 真的读了这两个资产
- 聊天输入框是纯 `<textarea>`，没有 @mention、文件引用、附件功能

### 2. 能力盲区：Agent 没有工具

- Agent（Director、NPC、Plot 等）全部是"接收 prompt → 返回文本"的无工具模型调用
- 不能自主搜索资产（"找出所有与这个线索相关的 NPC"）
- 不能自主读取资产内容（"让我看看这个场景的具体描述"）
- 不能探索工作空间结构（"当前有多少个场景？有哪些未被任何线索引用的 NPC？"）

### 3. 写入盲区：创作路径僵化

- `create_module` 是一条预定义的固定流水线（Plot → NPC → Monster → Lore → Clues），不允许用户在中间干预或选择性执行
- `modify_asset` 只能修改已有资产，不能在修改过程中决定"还需要新建一个关联 NPC"
- 用户不能在对话中直接说"帮我新建一个 NPC，名叫赵探长，特点是……"然后 Agent 自己完成创建
- 写入只发生在 workflow 的固定步骤中，Agent 自身没有写入工具

### 4. 无 Streaming：用户盯着空白等结果

- `POST /chat/sessions/{id}/messages` 是同步阻塞请求，整个 Director 调用完成后才返回
- 前端只显示静态的"AI 思考中..."文字，无打字动画、无 token 逐字渲染、无工具调用进度
- Tool-calling 架构下 Agent 会做多步操作（读取 → 思考 → 写入），如果无 streaming，用户完全看不到过程
- 现有 workflow 进度通过 2 秒轮询实现，延迟明显

### 5. 无多轮记忆：每条消息都是孤立的

- `run_director(user_message, workspace_context)` 只接收当前这一条消息，**不传入对话历史**
- 聊天记录存在 JSONL 文件中，但 `send_message` 端点从不读取历史
- 用户不能说"修改一下刚才那个 NPC 的背景"——Agent 不知道"刚才"是什么
- Vibe coding 的核心是多轮迭代（"再改改"、"加一点"、"不对，我是说……"），没有记忆就无法迭代

### 6. 响应格式僵化：Agent 不能自然对话

- 所有回复都被强制包装为 `ChangePlan` 结构体（`{intent, workflow, change_plan, ...}`）
- 即使是纯问答（"CoC 7e 的理智检定怎么做？"），也返回 `ChangePlan` 格式
- Agent 不能混合"对话文本 + 工具调用"——而这正是 tool-calling 的标准输出模式
- 没有"对话消息"和"操作消息"的区分

## 目标

从"固定流水线 + 纯文本对话"升级为"Agent 拥有工具、能自主读写工作空间"的交互模型。

核心变化：**Agent 从"被动执行预设流程"变为"拥有工具的自主协作者"**。

---

## 设计：七层能力体系

### Layer 1：@资产引用（用户显式指定上下文）

在聊天输入框中支持 `@资产名` 引用语法，用户精确控制 Agent 看到什么。

**交互设计**：
- 用户输入 `@` 时，弹出资产自动补全列表（按类型分组，支持模糊搜索）
- 选中后插入 `@赵探长` 标记（渲染为带颜色的 chip/tag）
- 发送消息时，引用的资产 ID 随消息一起发到后端
- 后端将引用资产的完整内容（frontmatter markdown）注入 Agent 上下文

**数据流**：
```
用户输入 "参考 @赵探长 修改 @开场场景 的描述"
  → 前端解析出 referenced_asset_ids: ["npc_zhao_detective", "scene_opening"]
  → SendMessageRequest 增加 referenced_asset_ids 字段
  → 后端加载这些资产的完整 .md 文件内容
  → 注入到 Agent prompt 中作为 [参考资产] 区块
```

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `AgentPanel.tsx` | textarea 改为支持 @mention 的输入组件（可用 `@tiptap/extension-mention` 或简单正则 + 浮层方案） |
| `SendMessageRequest` (shared-schema) | 新增 `referenced_asset_ids: string[]` |
| `chat.py` | 根据 referenced_asset_ids 通过 file-first 路径加载完整资产内容并注入上下文 |
| Director/Agent prompts | 增加 `[用户引用的资产]` 区块模板 |

### Layer 2：上下文增强（existing_assets 注入 summary）

改进 `get_workspace_context()` 使 Agent 能基于摘要做相关性判断。

**当前问题**：`existing_assets` 只有 `{type, name, slug}`，Agent 连资产讲了什么都不知道。

**方案**：在 `existing_assets` 中增加 `summary` 字段（从 frontmatter 的 description 或自动生成的摘要中读取），改动极小但立即提升 Director 判断质量。

```python
# 当前
existing_assets = [{"type": "npc", "name": "赵探长", "slug": "zhao-detective"}]

# 改进后
existing_assets = [
    {"type": "npc", "name": "赵探长", "slug": "zhao-detective",
     "summary": "上海公共租界巡捕房探长，正直但多疑，与案件核心人物有旧交"}
]
```

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `utils.py` / `get_workspace_context` | existing_assets 中增加 summary 字段，从 frontmatter description 读取 |
| Director prompt | 指导 Director 基于 summary 判断哪些资产与用户请求相关 |

### Layer 3：Agent Tool-calling（Agent 自主读取与探索）

为 Director 和子 Agent 注册工具函数，使其能**自主决定读取什么**。

**核心工具集（读取类）**：

| 工具 | 功能 | 使用场景 |
|------|------|---------|
| `list_assets(type?: string)` | 列出资产清单（含 summary） | "当前有哪些 NPC？" |
| `read_asset(asset_id: string)` | 读取资产完整内容 | "让我看看赵探长的详细设定" |
| `search_assets(query: string)` | 基于关键词/语义搜索资产 | "找出所有与码头相关的场景" |
| `read_config()` | 读取工作空间配置（规则集、风格等） | Agent 需要了解世界观设定 |
| `search_knowledge(query: string)` | 检索知识库（RAG） | "CoC 7e 中理智检定的规则是什么？" |

**核心工具集（写入类）**：

| 工具 | 功能 | 使用场景 |
|------|------|---------|
| `create_asset(type, name, content_md)` | 创建新资产 | "帮我新建一个 NPC 赵探长" |
| `update_asset(asset_id, content_md)` | 修改已有资产 | "把赵探长的背景改成……" |
| `create_revision(asset_id, content_md)` | 创建新版本（不覆盖当前） | "保存一个备选版本" |

**确认机制**：

写入工具不直接执行，而是生成 `PatchProposal`，暂停等待用户确认：
```
Agent 调用 create_asset(type="npc", name="赵探长", content_md="...")
  → 系统拦截，生成 PatchProposal
  → 前端展示 diff 预览（新建时为全文预览）
  → 用户确认 → 实际写入文件
  → 用户拒绝 → Agent 收到拒绝反馈，可重新生成
```

这与 Cursor 的 Apply/Reject 模式一致：Agent 提议，用户决定。

**实现方式**：

使用 Agno 的 tool 注册机制（`Agent(tools=[...])` 或 `@tool` 装饰器），将上述函数注册为 Agent 可调用的工具。LLM 通过 function-calling 协议自主决定何时调用哪个工具。

**涉及改动**：

| 模块 | 改动 |
|------|------|
| 新文件 `agents/tools.py` | 定义所有 Agent 工具函数 |
| `agents/director.py` | Director Agent 注册读取类工具 |
| `agents/npc.py` 等子 Agent | 注册 read_asset、search_assets 等读取工具，使其能参考其他资产 |
| `api/chat.py` | 处理 tool-call 产生的 PatchProposal，暂停等待确认 |
| `AgentPanel.tsx` | 展示 Agent 工具调用过程（"Agent 正在读取赵探长……"） |
| `WorkflowProgress.tsx` | 适配新的 tool-call 暂停/确认流程 |

### Layer 4：自由对话式创作（废弃固定流水线）

基于 Layer 3 的工具能力，Director 从"路由到固定 workflow"重构为"拥有工具的自主创作 Agent"。

**废弃的旧架构**：
- 删除 `create_module` 固定流水线（硬编码的 Plot → NPC → Monster → Lore → Clues 13 步）
- 删除 `modify_asset` 固定流水线（硬编码的 8 步修改流程）
- 删除 `rules_review` 固定流水线
- 删除 Director 的"分类路由"角色（不再将请求路由到预设 workflow）
- 删除 `WorkflowType`、`WorkflowORM` 等固定流水线相关类型和 ORM

**新架构**：

Director 拥有完整的读写工具，根据用户请求**动态规划**执行步骤：

```
用户："帮我设计一个码头场景，要有两个 NPC 和一条关键线索"

Director（拥有工具）→ 自主规划：
  1. search_assets("码头") → 检查是否已有相关场景
  2. read_config() → 了解规则集和风格
  3. search_knowledge("码头 场景设计") → 检索知识库
  4. create_asset(type="scene", ...) → 生成场景 → 等待用户确认
  5. create_asset(type="npc", ...) → 生成 NPC 1 → 等待用户确认
  6. "第二个 NPC 要和第一个有什么关系？" → 向用户澄清
  7. create_asset(type="npc", ...) → 生成 NPC 2 → 用户确认
  8. create_asset(type="clue", ...) → 生成线索 → 用户确认
```

每一步用户都可以：确认、拒绝并要求修改、追加指示、或中断。

**子 Agent 的定位变化**：

现有的 NPC Agent、Plot Agent、Monster Agent 等不再作为 workflow 步骤中被编排调用的"子流程"，而是变为 **Director 可调用的专业工具**或**生成 prompt 模板**：

- 方案 A（推荐）：将子 Agent 的专业知识（system prompt）内化到 Director 的工具函数中。例如 `create_asset(type="npc", ...)` 内部使用 NPC Agent 的 prompt 模板生成高质量 NPC 内容。Director 只需调用工具，不需要知道背后是哪个子 Agent。
- 方案 B：保留子 Agent 作为 Director 可调用的 tool（`call_npc_agent(premise, constraints)`），Director 自主决定何时调用。

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `agents/director.py` | 从"分类路由器"重构为"拥有工具的规划 Agent" |
| Director prompts | 重写 system prompt，指导 Agent 使用工具自主完成任务 |
| `api/chat.py` | 重构为 tool-call 循环（call → confirm → resume → call → ...），替代现有 workflow 启动逻辑 |
| `api/workflows.py` | 删除，功能由 tool-call 循环替代 |
| `workflows/create_module.py` | 删除 |
| `workflows/modify_asset.py` | 删除 |
| `workflows/rules_review.py` | 删除 |
| `AgentPanel.tsx` | 重构：展示 Agent 工具调用链、每步确认/拒绝 UI，替代 WorkflowProgress |
| `WorkflowProgress.tsx` | 删除，功能合并到新的 ToolCallChain 组件 |
| 新组件 `ToolCallCard.tsx` | 展示单次工具调用的参数、结果、确认按钮 |
| shared-schema | 删除 `WorkflowType`/`WorkflowStatus` 等固定流水线类型，新增 `ToolCall`/`ToolResult` 类型 |

### Layer 5：Streaming 实时交互

将 Agent 响应从"阻塞等待 → 一次性返回"改为"SSE 流式推送 → 逐步呈现"。

**当前问题**：`POST /chat/sessions/{id}/messages` 是同步阻塞的 JSON 响应。Agent 做多步 tool-call 时，用户只看到"AI 思考中..."直到全部完成。

**新架构**：

```
POST /chat/sessions/{id}/messages
  → 返回 SSE (Server-Sent Events) 流

事件类型：
  event: text_delta      → Agent 正在输出文本（逐 token）
  event: tool_call_start → Agent 开始调用工具（显示工具名和参数）
  event: tool_call_result→ 工具执行完成（显示结果摘要）
  event: patch_proposal  → 写入工具产生 PatchProposal（暂停等待确认）
  event: done            → Agent 完成本轮响应
  event: error           → 错误信息
```

**前端渲染**：
- `text_delta`：逐字追加到消息气泡（打字机效果）
- `tool_call_start`：显示折叠的工具调用卡片（"正在读取 @赵探长..."）
- `tool_call_result`：卡片展开显示结果摘要
- `patch_proposal`：弹出 diff 预览 + 确认/拒绝按钮

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `api/chat.py` | `send_message` 改为 `EventSourceResponse`（使用 `sse-starlette`） |
| `agents/director.py` | 使用 `agent.run_stream()` 替代 `agent.run()`（Agno 支持 streaming） |
| `AgentPanel.tsx` | 使用 `EventSource` 或 `fetch` + `ReadableStream` 接收 SSE |
| `MessageBubble.tsx` | 支持增量渲染（streaming text + tool call cards） |
| 新组件 `ToolCallCard.tsx` | 展示工具调用状态（pending → running → done/error） |
| shared-schema | 新增 SSE 事件类型定义 |

### Layer 6：多轮对话记忆

将对话历史注入 Agent 上下文，使 Agent 能理解上下文、支持迭代式创作。

**当前问题**：`run_director(user_message, ...)` 只接收当前消息，不知道前文。

**新架构**：

```python
# 改前
change_plan = run_director(body.content, ws_ctx)

# 改后
history = chat_service.read_messages(session_id)
# 截取最近 N 轮或 token 预算内的历史
trimmed_history = trim_to_budget(history, max_tokens=4000)
response = run_director(body.content, ws_ctx, history=trimmed_history)
```

Agent 使用标准的多轮消息格式（`messages: [{role, content}, ...]`），而非单条 `user_message` 字符串。

**历史裁剪策略**：
- 保留最近 N 轮对话（默认 10 轮）
- 超出 token 预算时，优先保留：最新消息 > 包含 tool-call 的消息 > 旧消息
- 工具调用结果可以只保留摘要（"已读取赵探长，4200 字"而非完整内容）

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `agents/director.py` | `run_director` 接收 `history: list[dict]`，构建多轮 messages |
| `api/chat.py` | 发送消息前加载并裁剪对话历史 |
| `services/chat_service.py` | 新增 `read_recent_messages(session_id, limit)` |
| shared-schema | `ChatMessage` 增加 `tool_calls` 结构化字段（替代 `tool_calls_json` 字符串） |

### Layer 7：自由响应格式（对话 + 工具调用混合）

废弃 `ChangePlan` 作为唯一响应格式，Agent 可以自然对话、提问、解释，同时穿插工具调用。

**当前问题**：所有回复都被强制包装为 `ChangePlan`。Agent 不能混合"我觉得你说的场景可以这样设计……"（对话）和 `create_asset(...)` （工具调用）。

**新架构**：

Agent 的响应不再是一个 JSON 结构体，而是 LLM 原生的"文本 + tool_calls"混合流：

```
Agent 响应流：
  "我来帮你设计这个码头场景。先看看现有资产中有没有相关的..."  ← 文本
  [tool_call: search_assets("码头")]                            ← 工具调用
  "找到了一个'旧码头'位置，但没有场景。我来新建一个..."        ← 文本
  [tool_call: create_asset(type="scene", ...)]                  ← 工具调用（暂停确认）
```

前端按事件流顺序渲染：文本 → 工具卡片 → 文本 → 工具卡片。

**废弃的类型**：
- `ChangePlan`（`{intent, workflow, change_plan, ...}`）
- `AgentIntent`（`"create_asset" | "modify_asset" | ..."`）
- `AgentResponse`（`{change_plan, patch_proposals, ...}`）
- `ChangePlanView.tsx` 组件

**替代类型**：

```typescript
// Agent 消息 = 文本段 + 工具调用的有序序列
interface AssistantMessage {
  role: "assistant";
  content: string;            // Agent 的文本输出
  tool_calls?: ToolCall[];    // Agent 发起的工具调用
}

interface ToolCall {
  id: string;
  name: string;               // "read_asset", "create_asset", etc.
  arguments: Record<string, any>;
  status: "pending" | "running" | "waiting_confirm" | "confirmed" | "rejected" | "done" | "error";
  result?: ToolResult;
}

interface ToolResult {
  success: boolean;
  summary: string;             // 简短摘要（用于显示和历史裁剪）
  data?: any;                  // 完整数据（前端按需展示）
  patch_proposal?: PatchProposal;  // 写入工具特有
}
```

**涉及改动**：

| 模块 | 改动 |
|------|------|
| shared-schema | 删除 `ChangePlan`/`AgentIntent`/`AgentResponse`，新增 `ToolCall`/`ToolResult`/`AssistantMessage` |
| `api/chat.py` | 响应从 JSON 改为 SSE 流（与 Layer 5 合并） |
| `AgentPanel.tsx` | `MessageBubble` 渲染混合内容（文本段 + 工具调用卡片交替排列） |
| `ChangePlanView.tsx` | 删除 |
| JSONL 存储格式 | `tool_calls_json` 字符串字段改为结构化的 `tool_calls: ToolCall[]` |

---

## 七层机制的关系

```
基础设施层（必须先做，其他层依赖）：
  Layer 5  Streaming        ── 所有工具调用和对话都需要实时反馈
  Layer 6  多轮记忆          ── 迭代式创作的前提
  Layer 7  自由响应格式      ── Agent 能自然对话 + 调用工具

能力层（核心功能）：
  Layer 2  summary 注入      ── Agent 对资产不再完全无知
  Layer 3  Tool-calling      ── Agent 能自主读写
  Layer 4  自由对话式创作    ── 废弃固定流水线

体验层（用户控制感）：
  Layer 1  @资产引用         ── 用户精确指定上下文
```

依赖关系：
- Layer 4 依赖 Layer 3（没有工具就没有自由创作）
- Layer 4 依赖 Layer 5（多步 tool-call 必须 streaming）
- Layer 4 依赖 Layer 6（迭代创作必须有记忆）
- Layer 4 依赖 Layer 7（Agent 需要混合对话和工具调用）
- Layer 3 依赖 Layer 7（工具调用是响应格式的一部分）
- Layer 1 独立，可并行

---

## 实施顺序

全部纳入 M19，不分阶段、不做过渡。未发布过版本，无兼容性包袱。

基础设施先行，能力层次第，体验层并行：

```
Phase 1（基础设施）：
  Layer 2  summary 注入（极小改动，先做）
  Layer 7  自由响应格式（定义新类型，删除 ChangePlan）
  Layer 6  多轮记忆（chat history 注入 Agent）
  Layer 5  Streaming（SSE 推送）

Phase 2（核心能力）：
  Layer 3  Tool-calling（读取 + 写入 + 确认机制）
  Layer 4  废弃固定 workflow，Director 重构

Phase 3（体验增强，可与 Phase 2 并行）：
  Layer 1  @资产引用
```

**废弃清单**（直接删除，不保留）：
- `workflows/create_module.py`、`workflows/modify_asset.py`、`workflows/rules_review.py`、`workflows/generate_image.py`
- `api/workflows.py`（路由）
- `WorkflowType` / `WorkflowStatus` / `WorkflowORM` 等类型
- `ChangePlan` / `AgentIntent` / `AgentResponse` 类型
- `WorkflowProgress.tsx`、`ChangePlanView.tsx`
- Director 的 clarification/planning 两阶段 prompt（重写为单一 tool-calling prompt）
- `tool_calls_json` 字符串字段（改为结构化 `tool_calls: ToolCall[]`）

---

## 风险

1. **Token 预算**：@引用 + 对话历史 + tool-call 读取的资产内容可能超出 LLM 上下文窗口。需要：
   - UI 显示实时 token 估算（已有 `ContextUsageBadge`，需增强）
   - 对话历史裁剪策略（保留最近 N 轮，工具结果只保留摘要）
   - 工具返回值的长度限制

2. **Tool-calling 兼容性**：不同 LLM provider 对 function-calling 的支持程度不同。需要验证 Agno 框架是否统一了 tool-calling 协议。对于不支持 function-calling 的模型，需要 fallback 到 prompt-based 工具调用。

3. **确认疲劳**：如果 Agent 每步都暂停等确认，用户体验会很差。需要设计：
   - 读取工具静默执行（不需确认）
   - 写入工具才暂停确认
   - 可选的"信任模式"：用户授权后连续执行多步写入

4. **Streaming 复杂度**：SSE 流式推送涉及前后端同时改造，需要处理：
   - 连接断开重连
   - tool-call 暂停时 SSE 连接的保持/恢复
   - 前端消息增量拼装和渲染性能

5. **子 Agent 处置**：NPC/Plot/Monster/Lore 等子 Agent 的专业 prompt 不能丢失，需要合理内化到工具函数或 prompt 模板中。方案 A（内化到工具）更简洁，方案 B（保留为 Director 可调用 tool）更灵活，需在 milestone plan 中明确选择。

6. **@mention 输入组件**：纯 textarea 不支持富文本 mention。建议直接用 tiptap + mention extension，一步到位。

---

## 开发 Skill 更新

实施本 proposal 时，以下 `.agents/skills/` 必须同步更新：

| Skill | 需要更新的内容 |
|-------|---------------|
| `frontend-ui-patterns` | @mention 输入组件、ToolCallCard 组件、SSE streaming 消息渲染、确认流程交互、删除 WorkflowProgress/ChangePlanView 相关规范 |
| `agent-workflow-patterns` | 全面重写：从 workflow 编排模式改为 tool-calling 模式，新增工具注册规范、确认/拒绝循环、子 Agent 内化策略、多轮记忆管理 |
| `trpg-workbench-architecture` | SendMessageRequest schema 变化、SSE 通信协议、删除 workflow 架构层、新增 Agent tools 架构层、对话历史裁剪策略 |

---

## 建议落地方式

- [x] plan：新 milestone（M19），Layer 1-7 全部纳入 A 类范围
- [x] 废弃所有固定 workflow，不做过渡（未发版，无兼容性包袱）

---

## 不在本 proposal 范围内（可独立 proposal）

| 主题 | 说明 |
|------|------|
| 会话管理（多会话列表、切换、历史浏览） | 中优，当前只有单会话，新建后旧会话不可访问。独立 UX 改进。 |
| 图片生成展示 | 图片保存到磁盘但从未在 UI 渲染。独立修复。 |
| 错误重试 UI | 当前无重试按钮，用户需重新输入。可作为 ToolCallCard 的子功能随 M19 实现。 |
