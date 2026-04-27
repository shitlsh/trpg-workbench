---
name: agent-workflow-patterns
description: 约束 trpg-workbench 中所有 AI Agent 的职责边界、调度规则和 Workflow 设计模式。当实现或讨论任何 Agent 相关功能时必须加载本 skill，包括：新建 Agent、设计 Agent 间协作、实现 Workflow、处理用户创作请求的路由、Director Agent 调度逻辑、Consistency/Rules/Skill Agent 的工具化委托，或任何"让 AI 做某件事"的功能设计。
---

# Skill: agent-workflow-patterns

## 用途

本 skill 约束 `trpg-workbench` 中所有 AI Agent 的分工边界、调度规则和工具调用（tool-calling）设计模式。**M19 起，固定 Workflow 流水线已废弃，Director Agent 通过 tool-calling 自主完成所有创作任务。M20 起，专审查型子 Agent（Consistency、Rules、Skill）通过工具委托模式接回主流程。**

---

## M20 架构总览：Director + 专项子 Agent 委托

```
用户请求
  └─► Director Agent（Agno，tool-calling 模式）
        ├── 读取工具（直接执行）
        │     ├── list_assets(type?)
        │     ├── read_asset(slug)
        │     ├── search_assets(query)
        │     ├── read_config()
        │     ├── search_knowledge(query)       ← 通用知识检索
        │     └── consult_rules(question)       ← 委托 Rules Agent 推理
        │
        ├── 审查工具（委托子 Agent，只读，不写文件）
        │     └── check_consistency(name, type, draft_md)  ← 委托 Consistency Agent
        │
        └── 写入工具（触发 PatchProposalInterrupt，需用户确认）
              ├── create_asset(type, name, content_md)
              ├── update_asset(slug, content_md)
              └── create_skill(user_intent)      ← 委托 Skill Agent 生成内容
                    ↕ SSE streaming
              前端（AgentPanel）
                ├── text_delta    → 流式消息气泡
                ├── tool_call_start → ToolCallCard
                ├── tool_call_result → ToolCallCard（含审查报告、规则意见）
                ├── patch_proposal → PatchConfirmDialog
                └── done
```

**M26：Explore 会话** — 与 Director 共用 `POST /chat/sessions` + `POST .../messages` 的 SSE 流，但创建会话时 `agent_scope: "explore"` 时由 `run_explore_stream`（`apps/backend/app/agents/explore.py`）处理。工具集为 `EXPLORE_TOOLS`（`tools.py`）：**只读** `list` / `read` / `grep` / `search_*` / `web_search` / `consult_rules`，**不含**写入、`check_consistency`、`create_skill`、`ask_user`。用户侧在 Agent 侧栏可建「新探索（只读）」会话。

---

## Agent 分工原则

### 哪些任务用 prompt 内化（不需要独立 Agent）

纯生成型任务——任务是"写内容"，用 Director system prompt 里的类型创作规范覆盖即可：

- NPC 创作、怪物设计、情节构建、地点描写、世界设定
- 这类子 Agent 文件（`npc.py`/`plot.py`/`monster.py`/`lore.py`）已删除

### 哪些任务需要独立子 Agent（工具委托）

推理模式与通用创作不同，或有独立专业 prompt 的任务：

| 子 Agent | 任务性质 | 接入方式 |
|---|---|---|
| `consistency.py` | 批评性审查——跨资产一致性检查 | `check_consistency` 工具委托 |
| `rules.py` | 规则推理——RAG 密集 + 结构化裁判 | `consult_rules` 工具委托 |
| `skill_agent.py` | 专项创作——编写 Agent 指令框架 | `create_skill` 工具委托 |

**判断标准**：若一个任务需要"否定性思维"（找问题）、"规则权威引用"（带 citation 的推理）、或"专项指令写作"（生成 Agent 指令），则应保留独立子 Agent。若只是"创作内容"，用 Director system prompt 内化。

---

## Director Agent

### 职责

- 理解用户意图（创建、修改、查询、审查）
- 自主决定调用哪些工具、以何种顺序调用
- 通过工具读取工作空间资产、搜索知识库、生成创作内容
- 在写入前委托 `check_consistency` 检查冲突
- 生成 PatchProposal 供用户确认（写操作不直接落盘）
- 流式输出思考过程和响应文本

### 工具调用顺序约束

Director system prompt 中必须明确以下顺序规则：

1. **写入前必须先 check_consistency**：调用 `create_asset`/`update_asset`/`create_skill` 前，必须先调用 `check_consistency`；若返回 `conflict` 级别冲突，须向用户说明后再决定是否继续
2. **规则问题用 consult_rules**：涉及规则裁判、平衡性审查 → `consult_rules`；宽泛背景资料检索 → `search_knowledge`

### 运行入口

```python
# apps/backend/app/agents/director.py

async def run_director_stream(
    user_message: str,
    workspace_context: dict,
    model,
    history: list[dict] | None = None,
    referenced_assets: list[dict] | None = None,
    db=None,
) -> AsyncGenerator[dict, None]:
    """异步生成器，yield SSE 事件 dict，由 api/chat.py 的 StreamingResponse 消费。"""
```

### SSE 事件协议

```python
{"event": "text_delta",      "data": {"content": "正在分析..."}}
{"event": "tool_call_start", "data": {"id": "tc_1", "name": "check_consistency", "arguments": "..."}}
{"event": "tool_call_result","data": {"id": "tc_1", "success": true, "summary": "无冲突"}}
{"event": "patch_proposal",  "data": {"id": "pp_xxx", "action": "create", "asset_type": "npc", ...}}
{"event": "auto_applied",    "data": {"action": "created", "asset_name": "赵探长"}}  # 信任模式
{"event": "done",            "data": {}}
{"event": "error",           "data": {"message": "..."}}
```

---

## 工具注册规范（tools.py）

所有工具在 `apps/backend/app/agents/tools.py` 中定义，通过 `configure(workspace_context, db)` 注入运行时依赖。

### 读取工具（直接执行，不需用户确认）

```python
ALL_TOOLS = [
    list_assets,        # 列出资产（可按 type 过滤）
    read_asset,         # 读取单个资产完整内容
    search_assets,      # 关键词/语义搜索资产（M20：升级语义路径）
    read_config,        # 读取工作空间配置
    search_knowledge,   # 通用知识库检索（RAG）
    consult_rules,      # 规则推理（委托 Rules Agent + RAG）
    check_consistency,  # 一致性审查（委托 Consistency Agent）
    create_asset,       # 写入：新建资产 → PatchProposalInterrupt
    update_asset,       # 写入：修改资产 → PatchProposalInterrupt
    create_skill,       # 写入：新建 Skill（委托 Skill Agent 生成内容）→ PatchProposalInterrupt
]
```

### 子 Agent 委托工具的实现模式

```python
@tool
def check_consistency(asset_name: str, asset_type: str, draft_content_md: str) -> str:
    """写入资产前检查与现有资产的一致性。返回冲突报告 JSON。
    overall_status 为 conflict 时须向用户说明。"""
    from app.agents.consistency import run_consistency_agent
    relevant = [a for a in _workspace_context.get("existing_assets", [])
                if a.get("type") == asset_type][:20]
    report = run_consistency_agent(
        asset_summaries=relevant,
        draft={"name": asset_name, "type": asset_type, "content": draft_content_md},
        model=_get_model(),
    )
    return json.dumps(report, ensure_ascii=False)

@tool
def consult_rules(question: str, review_mode: bool = False) -> str:
    """咨询规则集，返回带原文引用的规则裁判意见。适用于规则 Q&A 和平衡性审查。"""
    from app.agents.rules import run_rules_agent
    from app.knowledge.retriever import retrieve_knowledge
    library_ids = _workspace_context.get("library_ids", [])
    if not library_ids:
        return json.dumps({"summary": "未绑定知识库，请在规则集设置中添加知识库后再使用此功能。"})
    ctx = retrieve_knowledge(question, library_ids, _db, top_k=8)
    return json.dumps(run_rules_agent(question, ctx, _get_model(), review_mode))

@tool
def create_skill(user_intent: str) -> str:
    """根据用户意图创建一个 Agent Skill。Skill 以 Frontmatter Markdown 格式落盘到 skills/ 目录。
    此操作需要用户确认。"""
    from app.agents.skill_agent import run_skill_agent
    from app.knowledge.retriever import retrieve_knowledge
    library_ids = _workspace_context.get("library_ids", [])
    ctx = retrieve_knowledge(user_intent, library_ids, _db, top_k=5) if library_ids else []
    content_md = run_skill_agent(user_intent, ctx, _workspace_context, _get_model())
    proposal = {
        "id": f"pp_{uuid.uuid4().hex[:12]}",
        "action": "create_skill",
        "content_md": content_md,
        "change_summary": f"新建 Skill：{user_intent[:50]}",
    }
    raise PatchProposalInterrupt(proposal)
```

### PatchProposalInterrupt 机制

```python
class PatchProposalInterrupt(AgentRunException):
    """写入工具通过此异常中断 Agent 执行，触发用户确认流程。
    继承 AgentRunException(stop_execution=True) 确保 Agno re-raise 而非 swallow。"""
    def __init__(self, proposal: dict):
        self.proposal = proposal
        super().__init__("patch_proposal", stop_execution=True)
```

### 信任模式

`workspace_context["trust_mode"] == True` 时，写入工具直接调用 `execute_patch_proposal` 落盘，不 raise `PatchProposalInterrupt`，改为返回含 `auto_applied: true` 的结果。SSE 层检测并 yield `auto_applied` 事件。

### 工具上下文注入

每次请求前调用 `configure(workspace_context, db)` 注入运行时依赖：

```python
# api/chat.py
configure_tools(workspace_context, db)
# 之后调用 run_director_stream(...)
```

`_get_model()` 从 `_workspace_context` 中解析 LLM model 实例，供子 Agent 委托工具内部调用。

---

## 子 Agent 规范

### 共同约束

- 子 Agent **不拥有工具**，只做 LLM 推理
- 子 Agent **不写文件**，只返回内容（content_md 字符串或结构化 JSON）
- 子 Agent 的 model 由父工具函数从 `_workspace_context` 解析后传入，不自行获取
- system prompt 必须通过 `load_prompt(agent_type, phase)` 加载，禁止 inline 字符串

### Consistency Agent（consistency.py）

```python
def run_consistency_agent(
    asset_summaries: list[dict],  # 现有同类型资产
    draft: dict,                   # 待写入的草稿 {name, type, content}
    model,
) -> dict:                         # {"issues": [...], "overall_status": "clean|warning|conflict"}
```

- `overall_status == "conflict"`：Director 必须向用户说明冲突，不可静默继续
- `overall_status == "warning"`：Director 在回复中提及，可继续
- `overall_status == "clean"`：Director 直接继续写入流程

### Rules Agent（rules.py）

```python
def run_rules_agent(
    question: str,
    knowledge_context: list[dict],  # 由 retrieve_knowledge 预先获取
    model,
    review_mode: bool = False,
) -> dict:  # {"suggestions": [...], "summary": str}
            # 每条 suggestion 含 citation（原文引用）
```

- `review_mode=True`：用于平衡性审查，suggestion 含 severity/affected_field/suggestion_patch
- `review_mode=False`：用于规则 Q&A，返回带引用的解释

### Skill Agent（skill_agent.py）

```python
def run_skill_agent(
    user_intent: str,
    knowledge_context: list[dict],
    workspace_context: dict,
    model,
) -> str:  # Frontmatter Markdown 字符串（直接作为 content_md 落盘）
```

- 输出格式必须是 Frontmatter Markdown，字段包含 `name`、`description`、`agent_types`、正文指令
- 不返回 JSON dict，无需工具层做格式转换

---

## Patch Proposal 确认/拒绝流程

```
前端 PatchConfirmDialog
  ├── POST /chat/sessions/{id}/confirm/{proposal_id}
  │     → execute_patch_proposal() → asset_service.create/update 或写 skills/ 文件
  └── POST /chat/sessions/{id}/reject/{proposal_id}
        → 移除 pending proposal，不落盘
```

**约束**：
- `_pending_proposals` 是内存存储（`{session_id: {proposal_id: proposal_dict}}`）
- confirm/reject 端点仅操作 pending proposals，不重新运行 Agent
- 信任模式下不进入此流程，直接落盘

---

## workspace_context 结构（M20）

```python
{
    "workspace_name": str,
    "workspace_path": str,
    "rule_set": str,
    "rule_set_id": str | None,
    "style_prompt": str | None,
    "library_ids": list[str],
    "trust_mode": bool,           # M20 新增：信任模式开关
    "model": Any,                  # M20 新增：LLM model 实例，供子 Agent 委托工具使用
    "existing_assets": [
        {"type": str, "name": str, "slug": str, "summary": str | None}
    ],
    "custom_asset_types": list[dict],
    "skills": list[dict],
    "config": dict,
}
```

---

## Prompt 目录结构（M20）

```
apps/backend/app/prompts/
  __init__.py               # load_prompt() 统一入口
  _shared/                  # 共享片段
  director/
    system.txt              # 含类型创作规范 + 工具调用顺序约束 + 知识库检索规则
  consistency/
    system.txt              # 批评性审查 prompt
  rules/
    system.txt              # 规则 Q&A prompt
    review.txt              # 平衡性审查 prompt
  skill/
    system.txt              # Skill 指令框架创作 prompt（输出 Frontmatter Markdown）
  # 以下已删除（M20）：
  # npc/ plot/ monster/ lore/ document/
```

---

## 禁止事项

- **禁止重建固定 Workflow 流水线**：不得创建 `create_module.py`、`modify_asset.py` 等固定步骤文件
- **禁止写操作跳过 PatchProposalInterrupt**（信任模式除外，信任模式由 workspace_context 控制）
- **禁止子 Agent 直接写文件或数据库**：子 Agent 只返回内容，写入统一由工具函数/execute_patch_proposal 完成
- **禁止在 tools.py 以外注册工具**：所有工具函数必须在 tools.py 中定义
- **禁止子 Agent 自行获取 model**：model 必须由父工具函数从 `_workspace_context["model"]` 解析后传入
- **禁止新增纯生成型子 Agent**：NPC/怪物/场景等内容生成由 Director system prompt 内化覆盖
