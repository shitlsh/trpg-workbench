# M19：Agent 上下文控制与工具能力

**前置条件**：M18 完成（资产/配置/聊天全部 file-first，DB 为可重建缓存索引）。

**状态：✅ 已完成（commit e856f68）**

**目标**：将 Agent 从"固定流水线 + 纯文本对话"升级为"拥有工具、能自主读写工作空间"的自主协作者。

---

## 背景与动机

当前 Agent 系统存在六大缺陷：无 streaming、无多轮记忆、无 tool-calling、响应格式僵化（`ChangePlan`）、创作路径固定（硬编码流水线）、上下文盲区（只看到资产元数据）。

本 milestone 基于 Agno 框架的原生 tool-calling 能力，一次性完成七层能力体系建设。0.1.0 尚未发布，无兼容性包袱，直接删除旧架构。

- 来源 proposal：`docs/benchmark-reviews/completed/2026-04-24_agent-context-control.md`

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A0：开发 Skill 更新（先于一切代码改动）**

三个开发 skill 必须先更新到新架构描述，确保后续实现时 Agent 参考正确的约束：
- `agent-workflow-patterns`：全面重写为 tool-calling 模式
- `trpg-workbench-architecture`：更新通信协议、数据类型、架构分层
- `frontend-ui-patterns`：更新 UI 组件规范

**A1：自由响应格式（Layer 7）**

废弃 `ChangePlan`/`AgentIntent`/`AgentResponse` 类型，新增 `ToolCall`/`ToolResult`/`AssistantMessage` 类型。Agent 响应变为"文本 + tool_calls"混合流。

方案：
- shared-schema 删除旧类型，定义新类型
- 后端 `ChatMessage` 的 `tool_calls_json` 字符串字段改为结构化 `tool_calls: ToolCall[]`
- 前端删除 `ChangePlanView.tsx`

**A2：上下文增强（Layer 2）**

`get_workspace_context()` 的 `existing_assets` 增加 `summary` 字段（从 frontmatter description 读取）。改动极小但立即提升 Director 判断质量。

**A3：多轮对话记忆（Layer 6）**

`run_director` 接收对话历史，构建多轮 messages。

方案：
- `chat_service.py` 新增 `read_recent_messages(session_id, limit)`
- 截取最近 10 轮或 token 预算内的历史
- 工具调用结果只保留摘要（"已读取赵探长，4200 字"）

**A4：SSE Streaming（Layer 5）**

`POST /chat/sessions/{id}/messages` 从同步 JSON 改为 SSE 流式推送。

方案：
- 后端使用 `sse-starlette` 的 `EventSourceResponse`
- 事件类型：`text_delta`、`tool_call_start`、`tool_call_result`、`patch_proposal`、`done`、`error`
- 前端使用 `fetch` + `ReadableStream` 接收 SSE
- `MessageBubble.tsx` 支持增量渲染

**A5：Agent Tool-calling（Layer 3）**

为 Director 注册工具函数，使其能自主读写工作空间。

方案：使用 Agno 原生 tool 注册（`Agent(tools=[...])`），LLM 通过 function-calling 协议自主调用。

读取类工具（静默执行，不需用户确认）：
- `list_assets(type?: string)` — 列出资产清单（含 summary）
- `read_asset(asset_id: string)` — 读取资产完整内容
- `search_assets(query: string)` — 关键词搜索资产
- `read_config()` — 读取工作空间配置
- `search_knowledge(query: string)` — 检索知识库（RAG）

写入类工具（生成 PatchProposal，暂停等用户确认/拒绝）：
- `create_asset(type, name, content_md)` — 创建新资产
- `update_asset(asset_id, content_md)` — 修改已有资产

确认机制：写入工具不直接执行，拦截生成 PatchProposal → 前端展示 diff → 用户确认才写入 / 拒绝则 Agent 收到反馈可重新生成。

**Agno tool-calling 行为与重试**：Agno 框架自动处理 tool-call 循环——Agent 调用工具 → 获取结果 → 决定下一步 → 循环直到输出最终文本，无需手动编排。若工具返回错误（如资产不存在、写入失败），LLM 自然看到错误结果并自主调整策略（换参数重试、向用户澄清、改用其他工具），不需要应用层实现重试逻辑。`agent.arun(stream=True)` 支持异步流式输出，多个并发 tool-call 会自动并行执行。

**A6：废弃固定流水线，Director 重构（Layer 4）**

Director 从"意图分类 → 路由到固定 workflow"重构为"拥有工具的自主规划 Agent"。

方案：
- 删除 `workflows/create_module.py`、`modify_asset.py`、`rules_review.py`、`generate_image.py`
- 删除 `api/workflows.py`
- 删除 `WorkflowType`/`WorkflowORM`/`WorkflowStatus`
- 子 Agent（NPC/Plot/Monster/Lore）的专业 prompt 内化到写入工具函数中（方案 A）。例如 `create_asset(type="npc", ...)` 内部使用 NPC Agent 的 prompt 模板生成高质量内容
- Director system prompt 重写为 tool-calling 风格
- 前端删除 `WorkflowProgress.tsx`，新增 `ToolCallCard.tsx`

**A7：@资产引用（Layer 1）**

聊天输入框支持 `@资产名` 引用，用户精确控制 Agent 看到什么。

方案：
- 输入组件使用 tiptap + `@tiptap/extension-mention`
- `SendMessageRequest` 新增 `referenced_asset_ids: string[]`
- 后端加载引用资产完整内容注入 Agent prompt

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：信任模式**：用户授权后连续执行多步写入无需逐个确认，减少确认疲劳
- **B2：Token 预算 UI**：实时显示上下文 token 估算，可视化上下文占比
- **B3：search_knowledge 语义检索**：当前 search_assets 为关键词搜索，后续可升级为 embedding 语义搜索

### C 类：明确不承诺

- 多会话管理（独立 proposal `2026-04-25_chat-session-management.md`）
- 图片生成展示（独立 proposal `2026-04-25_image-generation-display.md`）
- 不支持 function-calling 的模型的 fallback（当前仅支持有 tool-calling 能力的模型）
- 数据迁移——0.1.0 未发布，直接删除旧结构

---

## 文件结构

### 删除文件

```
apps/backend/app/workflows/create_module.py     — 固定流水线
apps/backend/app/workflows/modify_asset.py       — 固定流水线
apps/backend/app/workflows/rules_review.py       — 固定流水线
apps/backend/app/workflows/generate_image.py     — 固定流水线
apps/backend/app/api/workflows.py                — workflow 路由
apps/desktop/src/components/agent/WorkflowProgress.tsx  — 流水线进度 UI
apps/desktop/src/components/agent/ChangePlanView.tsx    — ChangePlan 渲染
```

### 新增文件

```
apps/backend/app/agents/tools.py                 — Agent 工具函数定义
apps/desktop/src/components/agent/ToolCallCard.tsx — 工具调用卡片组件
```

### 修改文件

```
packages/shared-schema/src/index.ts              — 删旧类型，增新类型（ToolCall/ToolResult/AssistantMessage/SSE events）
apps/backend/app/agents/director.py              — 从路由器重构为 tool-calling Agent
apps/backend/app/agents/npc.py                   — prompt 内化到 tools.py 后可能简化或删除
apps/backend/app/agents/plot.py                  — 同上
apps/backend/app/agents/monster.py               — 同上
apps/backend/app/agents/lore.py                  — 同上
apps/backend/app/api/chat.py                     — SSE streaming + tool-call 循环
apps/backend/app/services/chat_service.py        — read_recent_messages()
apps/backend/app/workflows/utils.py              — get_workspace_context() 增加 summary
apps/backend/app/prompts/director/               — 重写为 tool-calling system prompt
apps/desktop/src/components/agent/AgentPanel.tsx  — SSE 接收 + @mention 输入 + tool-call 渲染
apps/desktop/src/components/agent/MessageBubble.tsx — streaming 增量渲染 + 混合内容
apps/desktop/src/components/agent/PatchConfirmDialog.tsx — 适配 tool-call confirm 流
.agents/skills/agent-workflow-patterns/SKILL.md  — A0 全面重写
.agents/skills/trpg-workbench-architecture/SKILL.md — A0 更新
.agents/skills/frontend-ui-patterns/SKILL.md     — A0 更新
```

---

## 关键设计约束

### 1. Agno tool-calling 协议

```python
from agno.agent import Agent
from agno.tools import tool

@tool
def read_asset(asset_id: str) -> str:
    """读取指定资产的完整 Markdown 内容"""
    path = workspace.asset_path(asset_id)
    return path.read_text()

@tool
def create_asset(type: str, name: str, content_md: str) -> dict:
    """创建新资产，返回 PatchProposal 供用户确认"""
    # 不直接写入，返回 proposal
    return {"action": "patch_proposal", "type": type, "name": name, "content": content_md}

director = Agent(
    model=model,
    tools=[read_asset, list_assets, search_assets, create_asset, update_asset, ...],
    instructions=[system_prompt],
)

# Agno 自动处理 tool-call 循环：
# Agent 调用工具 → 获取结果 → 决定下一步 → 循环直到最终文本
# 错误结果（如资产不存在）由 LLM 自然处理，无需应用层重试
async for chunk in director.arun(message=user_msg, messages=history, stream=True):
    yield sse_event(chunk)
```

### 2. SSE 事件协议

```
event: text_delta
data: {"content": "我来帮你"}

event: tool_call_start
data: {"id": "tc_1", "name": "search_assets", "arguments": {"query": "码头"}}

event: tool_call_result
data: {"id": "tc_1", "success": true, "summary": "找到 2 个资产"}

event: patch_proposal
data: {"id": "tc_2", "tool_call_id": "tc_2", "type": "npc", "name": "赵探长", "diff": "..."}

event: done
data: {}
```

### 3. 写入工具确认流程

```
Agent 调用 create_asset(...)
  → 后端拦截，不执行写入
  → SSE 推送 patch_proposal 事件
  → SSE 连接暂停（保持活跃，等待用户操作）
  → 用户点击 确认 → POST /chat/sessions/{id}/confirm/{proposal_id}
    → 执行写入 → 将结果注入 Agent 上下文 → Agent 继续
  → 用户点击 拒绝 → POST /chat/sessions/{id}/reject/{proposal_id}
    → 将拒绝反馈注入 Agent 上下文 → Agent 可重新生成或调整策略
```

### 4. 对话历史裁剪

```python
def trim_to_budget(messages, max_rounds=10, max_tokens=4000):
    # 1. 取最近 max_rounds 轮
    # 2. 工具调用结果替换为摘要（"已读取赵探长，4200 字"）
    # 3. 超出 token 预算时从最早消息开始丢弃
    # 4. 始终保留最新一条用户消息
```

### 5. 子 Agent prompt 内化

NPC/Plot/Monster/Lore 子 Agent 的专业 system prompt 不作为独立 Agent 保留，而是内化到对应写入工具函数中：

```python
@tool
def create_asset(type: str, name: str, content_md: str) -> dict:
    """创建新资产"""
    # 若 type == "npc"，内部使用 NPC 专业 prompt 模板增强 content_md
    # 若 type == "scene"，使用场景专业 prompt 模板
    # prompt 模板来源于原 npc.py / plot.py 等文件的 system prompt
    ...
```

---

## Todo

### A0：开发 Skill 更新

- [x] **A0.1**：`.agents/skills/agent-workflow-patterns/SKILL.md` — 全面重写为 tool-calling 模式
- [x] **A0.2**：`.agents/skills/trpg-workbench-architecture/SKILL.md` — 更新通信协议、数据类型、架构分层
- [x] **A0.3**：`.agents/skills/frontend-ui-patterns/SKILL.md` — 更新 UI 组件规范

### A1：自由响应格式

- [x] **A1.1**：`packages/shared-schema/src/index.ts` — 删除旧类型，新增 `ToolCall`/`ToolResult`/`AssistantMessage`/SSE 事件类型
- [x] **A1.2**：后端 `ChatMessage` 模型 — `tool_calls_json` 字段保留为 JSON 字符串（结构化序列化存储）
- [x] **A1.3**：前端删除 `ChangePlanView.tsx` 及其引用

### A2：上下文增强

- [x] **A2.1**：`apps/backend/app/workflows/utils.py` — `get_workspace_context()` 的 existing_assets 增加 summary 字段
- [x] **A2.2**：Director prompt 更新 — 重写为 tool-calling 风格，指导基于 summary 判断资产相关性

### A3：多轮对话记忆

- [x] **A3.1**：`apps/backend/app/services/chat_service.py` — 新增 `read_recent_messages(session_id, limit)`
- [x] **A3.2**：`apps/backend/app/agents/director.py` — `run_director_stream` 接收 history 参数，构建多轮 messages
- [x] **A3.3**：实现 `trim_to_budget()` 历史裁剪函数

### A4：SSE Streaming

- [x] **A4.1**：`apps/backend/app/api/chat.py` — `send_message` 改为 `StreamingResponse(text/event-stream)`
- [x] **A4.2**：`apps/backend/app/agents/director.py` — 使用 `agent.arun(stream=True)` 异步生成器
- [x] **A4.3**：`apps/desktop/src/components/agent/AgentPanel.tsx` — SSE 接收逻辑（fetch + ReadableStream）
- [x] **A4.4**：`apps/desktop/src/components/agent/AgentPanel.tsx` — 增量渲染（流式文本气泡 + ToolCallCard，未单独抽 MessageBubble.tsx）

### A5：Agent Tool-calling

- [x] **A5.1**：新建 `apps/backend/app/agents/tools.py` — 定义读取类工具（list_assets, read_asset, search_assets, read_config, search_knowledge）
- [x] **A5.2**：`tools.py` — 定义写入类工具（create_asset, update_asset）+ PatchProposalInterrupt 拦截机制（继承 AgentRunException）
- [x] **A5.3**：`agents/director.py` — Director Agent 注册所有工具
- [x] **A5.4**：`api/chat.py` — 实现 confirm/reject 端点（`POST /sessions/{id}/confirm/{proposal_id}` 和 reject）
- [x] **A5.5**：新建 `apps/desktop/src/components/agent/ToolCallCard.tsx` — 工具调用卡片 UI
- [x] **A5.6**：`PatchConfirmDialog.tsx` — 适配 tool-call 产生的 PatchProposal 确认流

### A6：废弃固定流水线

- [x] **A6.1**：删除 `workflows/create_module.py`、`modify_asset.py`、`rules_review.py`、`generate_image.py`
- [x] **A6.2**：删除 `api/workflows.py` 路由
- [x] **A6.3**：删除 `WorkflowType`/`WorkflowORM`/`WorkflowStatus` 相关代码
- [x] **A6.4**：删除 `WorkflowProgress.tsx` 及其引用
- [x] **A6.5**：`agents/director.py` — system prompt 重写为 tool-calling 风格
- [x] **A6.6**：子 Agent prompt 内化 — Director 作为 LLM 自主 agent 已具备创作能力，无需在工具函数中嵌入子 Agent prompt；npc.py/plot.py 等文件保留但不被调用（与 plan 方案 A 描述有偏差：保留文件，不嵌入 prompt，依赖 LLM 能力）
- [x] **A6.7**：清理图片生成残留 — 删除 generate_image.py、assets.py 图片端点、ImageGenerationJobORM、ImageBrief 类型、ImageSection 组件、lore agent 的 image_brief 引用

### A7：@资产引用

- [x] **A7.1**：`packages/shared-schema/src/index.ts` — `SendMessageRequest` 新增 `referenced_asset_ids: string[]`
- [x] **A7.2**：新建 `apps/desktop/src/components/agent/MentionInput.tsx` — tiptap @mention 输入组件，集成到 AgentPanel
- [x] **A7.3**：`apps/backend/app/api/chat.py` — 根据 referenced_asset_ids 加载完整资产内容注入 Agent prompt

---

## 验收标准

1. 在聊天中输入"当前有哪些 NPC？"，Agent 应自主调用 `list_assets(type="npc")` 并以自然语言回答，不返回 `ChangePlan` 结构
2. 在聊天中输入"帮我新建一个 NPC 赵探长"，Agent 应调用 `create_asset`，前端展示 diff 预览和确认/拒绝按钮，确认后资产文件写入磁盘
3. 用户拒绝 PatchProposal 后，Agent 收到拒绝反馈并能根据用户追加指示重新生成
4. Agent 响应过程中，前端实时展示：逐字输出文本 + 工具调用卡片（折叠/展开）
5. 在聊天中输入"修改一下刚才那个 NPC 的背景"，Agent 能理解"刚才"指代上文创建的 NPC（多轮记忆生效）
6. 输入 `@` 时弹出资产补全列表，选择后以 chip 形式展示，发送后 Agent 能看到引用资产的完整内容
7. existing_assets 中包含 summary 字段，Agent 能基于摘要判断资产相关性
8. 工具调用出错时（如资产不存在），Agent 自然看到错误结果并调整策略（Agno 自动循环），无需用户手动重试
9. 所有旧 workflow 文件和类型已删除，无残留引用

---

## 与其他里程碑的关系

```
M18（File-first Workspace）
  └── M19（Agent 上下文控制与工具能力）← 本 milestone
        ├── 多会话管理（独立 proposal，未排期）
        └── 图片生成展示（独立 proposal，未排期）
```

---

## 非目标

- **多会话管理**：当前保持单会话模式，独立 proposal 已创建（`2026-04-25_chat-session-management.md`）
- **图片生成展示**：图片文件已保存到磁盘但不在 UI 渲染，独立 proposal 已创建（`2026-04-25_image-generation-display.md`）
- **不支持 function-calling 的模型 fallback**：当前只支持有 tool-calling 能力的模型，不做 prompt-based fallback
- **数据迁移**：0.1.0 未发布，直接删除旧结构，不保留任何过渡/兼容代码
- **Tool-call 并行上限控制**：Agno 默认并发即可，不做额外限流
