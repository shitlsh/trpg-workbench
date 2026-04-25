---
name: agent-workflow-patterns
description: 约束 trpg-workbench 中所有 AI Agent 的职责边界、调度规则和 Workflow 设计模式。当实现或讨论任何 Agent 相关功能时必须加载本 skill，包括：新建 Agent、设计 Agent 间协作、实现 Workflow、处理用户创作请求的路由、Director Agent 调度逻辑、Rules/Plot/NPC/Monster/Lore/Consistency/Document Agent 的分工，或任何"让 AI 做某件事"的功能设计。
---

# Skill: agent-workflow-patterns

## 用途

本 skill 约束 `trpg-workbench` 中所有 AI Agent 的分工边界、调度规则和工具调用（tool-calling）设计模式。**M19 起，固定 Workflow 流水线已废弃，Director Agent 通过 tool-calling 自主完成所有创作任务。**

---

## M19 架构总览：Tool-Calling Director

```
用户请求
  └─► Director Agent（Agno，tool-calling 模式）
        ├── read_asset(slug)
        ├── list_assets(type?)
        ├── get_workspace_context()
        ├── search_knowledge(query, library_ids)
        ├── create_asset(type, name, content)   → raise PatchProposalInterrupt
        └── update_asset(slug, patch)            → raise PatchProposalInterrupt
              ↕ SSE streaming
          前端（AgentPanel）
            ├── text delta → 流式消息气泡
            ├── tool_call  → ToolCallCard
            ├── patch_proposal → PatchConfirmDialog
            └── done
```

**核心原则**：
- Director 是唯一的 Agent，通过自主 LLM 推理决定调用哪些工具、调用几次
- 旧的 Plot/NPC/Monster/Lore/Consistency/Document Agent 文件保留但不再被调用
- 不存在固定 Workflow 流水线（create_module/modify_asset/rules_review/generate_image 均已删除）
- 所有写操作通过 `PatchProposalInterrupt` 中断，用户确认后才落盘

---

## Director Agent

### 职责

- 理解用户意图（创建、修改、查询、审查）
- 自主决定调用哪些工具、以何种顺序调用
- 通过工具读取工作空间资产、搜索知识库、生成创作内容
- 生成 patch proposal 供用户确认（写操作不直接落盘）
- 流式输出思考过程和响应文本

### 运行入口

```python
# apps/backend/app/agents/director.py

async def run_director_stream(
    user_message: str,
    session_id: str,
    workspace_id: str,
    referenced_asset_ids: list[str],  # 用户 @mention 的资产
    db: Session,
) -> AsyncGenerator[dict, None]:
    """
    异步生成器，yield SSE 事件 dict，由 api/chat.py 的 StreamingResponse 消费。
    """
```

### SSE 事件协议

Director 生成器 yield 以下类型的事件 dict：

```python
# 文本增量（流式打字机效果）
{"type": "text_delta", "content": "正在分析..."}

# 工具调用开始
{"type": "tool_call", "tool_name": "read_asset", "args": {"slug": "mayor-arthur"}, "call_id": "tc_001"}

# 工具调用结果
{"type": "tool_result", "call_id": "tc_001", "result": {...}, "is_error": false}

# 写入工具触发 patch proposal（需用户确认）
{"type": "patch_proposal", "proposal": {
    "id": "pp_<uuid>",
    "operation": "create" | "update",
    "asset_type": "npc",
    "asset_name": "Arthur Hale",
    "slug": "mayor-arthur",
    "content_preview": "---\ntype: npc\nname: Arthur Hale\n...",
    "diff_summary": "新增 NPC：Arthur Hale 镇长",
}}

# 流结束
{"type": "done", "session_id": "...", "message_id": "..."}

# 错误
{"type": "error", "message": "...", "code": "..."}
```

### 禁止 Director 做的事

- 禁止直接写文件或数据库（通过 `PatchProposalInterrupt` 走用户确认流程）
- 禁止一次性生成超长内容而不分工具调用步骤
- 禁止跳过 patch proposal 直接落盘

---

## 工具注册规范（tools.py）

所有工具在 `apps/backend/app/agents/tools.py` 中定义和注册。

### 读取工具（直接执行，不需用户确认）

```python
ALL_TOOLS = [
    read_asset,          # 读取单个资产内容
    list_assets,         # 列出工作空间资产（可按 type 过滤）
    get_workspace_context,  # 读取工作空间配置和资产概览
    search_knowledge,    # 搜索知识库
    get_recent_messages, # 读取最近对话历史
]
```

### 写入工具（触发 PatchProposalInterrupt，需用户确认）

```python
WRITE_TOOLS = [
    create_asset,   # 新建资产 → raise PatchProposalInterrupt(proposal)
    update_asset,   # 修改资产 → raise PatchProposalInterrupt(proposal)
]
```

### PatchProposalInterrupt 机制

```python
class PatchProposalInterrupt(Exception):
    def __init__(self, proposal: dict): ...

# 在 create_asset / update_asset 中：
async def create_asset(type: str, name: str, content: str) -> dict:
    proposal = build_proposal(...)
    store_pending_proposal(session_id, proposal)
    raise PatchProposalInterrupt(proposal)  # 中断 Agent 执行
```

`_event_generator()` 捕获 `PatchProposalInterrupt`，yield `patch_proposal` 事件，Agent 暂停等待用户交互。

### 工具上下文注入

每次请求前调用 `configure_tools(ws_ctx, db)` 注入工作空间上下文：

```python
# api/chat.py
configure_tools(workspace_context, db)
# 之后调用 run_director_stream(...)
```

---

## Patch Proposal 确认/拒绝流程

```
前端 PatchConfirmDialog
  ├── POST /workspaces/{ws_id}/chat/confirm
  │     body: {"session_id": "...", "proposal_id": "pp_..."}
  │     → execute_patch_proposal() → asset_service.create/update
  └── POST /workspaces/{ws_id}/chat/reject
        body: {"session_id": "...", "proposal_id": "pp_..."}
        → 移除 pending proposal，不落盘
```

**约束**：
- `_pending_proposals` 是内存存储（`{session_id: {proposal_id: proposal_dict}}`）
- confirm/reject 端点仅操作 pending proposals，不重新运行 Agent
- 用户可逐条确认或拒绝多个 proposals

---

## 多轮记忆规范

```python
# services/chat_service.py

def read_recent_messages(session_id: str, n: int = 20) -> list[dict]:
    """读取最近 N 条消息，从 .trpg/chat/{session_id}.jsonl"""

def trim_to_budget(messages: list[dict], max_tokens: int = 4000) -> list[dict]:
    """按 token 预算裁剪消息列表（从最旧的截断）"""
```

Director 在每次请求时注入最近对话历史作为上下文，不依赖 Agno 的内置记忆。

---

## workspace_context 结构

```python
{
    "workspace_name": str,
    "rule_set": str,            # 规则集名称（如 "coc-7e"）
    "style_prompt": str | None, # 规则集 PromptProfile（创作风格约束）
    "library_ids": list[str],   # 可用知识库 ID（规则集 + 工作空间额外绑定，已去重）
    "existing_assets": [
        {
            "type": str,
            "name": str,
            "slug": str,
            "summary": str | None,  # M19 新增：资产摘要，供 Director 快速了解现有内容
        }
    ],
}
```

---

## Prompt Registry（必须遵守）

所有 Agent 的 system prompt 必须通过 `load_prompt()` 加载，**禁止在 Agent `.py` 文件内定义 prompt 字符串常量**。

```python
from app.prompts import load_prompt

system_prompt = load_prompt("director", "system")  # 加载 prompts/director/system.txt
```

目录结构：
```
apps/backend/app/prompts/
  __init__.py               # load_prompt() 统一入口
  _shared/                  # 共享片段（citation_rules 等）
  director/                 # system.txt
  plot/                     # system.txt（遗留，不再调用）
  npc/                      # system.txt（遗留，不再调用）
  monster/                  # system.txt（遗留，不再调用）
  lore/                     # system.txt（遗留，不再调用）
  rules/                    # system.txt（遗留，不再调用）
```

---

## RAG 在创作流程中的使用规则

Director 通过 `search_knowledge` 工具按需检索知识库，而非固定 Workflow 中的"步骤 3"检索。

### 知识库来源

Agent 可用的知识库 ID 列表由 `workspace_context["library_ids"]` 提供：
1. **规则集归属的知识库**：`KnowledgeLibrary.rule_set_id` 关联
2. **工作空间额外绑定**：`WorkspaceLibraryBinding`

**禁止 Director 绕过 `workspace_context["library_ids"]` 自行查询工作空间之外的知识库。**

### 风格提示词注入

`workspace_context["style_prompt"]` 注入到 Director 的 system prompt 中作为创作风格约束。

---

## 禁止事项

- **禁止重建固定 Workflow 流水线**：不得创建 `create_module.py`、`modify_asset.py` 等固定步骤 Workflow
- **禁止绕过 PatchProposalInterrupt 直接落盘**：所有写操作必须经用户确认
- **禁止 Director 直接调用旧的专项 Agent 文件**（plot.py/npc.py 等）
- **禁止写操作不 raise PatchProposalInterrupt**：新的工具函数如涉及写入，必须遵守此机制
- **禁止在 tools.py 以外注册工具**：所有工具函数必须在 tools.py 中定义并通过 `configure_tools()` 注入
