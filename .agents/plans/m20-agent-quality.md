# M20：Agent 创作质量与上下文感知增强

**前置条件**：M19 完成（tool-calling Director、SSE streaming、PatchProposal 确认流全部就位）。

**目标**：补齐 M19 遗留的创作质量缺口——子 Agent 专业 prompt 内化、Consistency/Rules 子 Agent 接回 Director 工具链、资产语义搜索、知识库检索主动性约束，以及减少确认疲劳的信任模式。

---

## 背景与动机

M19 将 Director 升级为 tool-calling 自主 Agent，但留下三类已知缺口：

**缺口 1（A6.6 遗留）：纯生成型子 Agent prompt 未内化**

`npc.py`/`plot.py`/`monster.py`/`lore.py` 保留在 `agents/` 目录但无人调用。Director 创建资产时 `content_md` 由通用 LLM 自由生成，缺少类型专属的结构约束（NPC 动机关系、怪物能力块、场景叙事格式等）。

**缺口 2：审查型子 Agent 未接回**

`consistency.py` 和 `rules.py` 是 M10 时实现的两个专业审查 Agent，在 M19 tool-calling 重构后成为死代码，但其任务性质与生成完全不同（批评性审查 vs 创作），值得独立存在并作为 Director 的委托工具：

- **Consistency Agent**：跨资产一致性检查——新资产与现有资产是否有命名冲突、时间线矛盾、世界观违背
- **Rules Agent**：规则裁判——规则 Q&A、平衡性审查，输出带引用的结构化意见

这两类任务有独立的推理模式（审查 vs 生成），有独立的工具子集（Consistency 读大量现有资产，Rules 做 RAG 密集检索），不应合并进 Director system prompt。

**缺口 3（B3）：search_assets 只做关键词匹配**

`search_assets` 仅对 name/summary/slug 做字符串匹配。语义相关但词汇不重叠的查询会漏检。向量搜索基础设施（embedding profile + retriever）已在 M2/M9a 完成，可直接复用。

**缺口 4：Director 不主动检索知识库**

`search_knowledge` 已接通语义检索，但 Director system prompt 只是软性建议。LLM 实际对话中频繁跳过，导致规则细节不准确。

**缺口 5（B1）：确认疲劳**

每次写入都弹确认框，熟练用户体验差，需要信任模式。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A0：开发 Skill 更新（先于一切代码改动）**

`agent-workflow-patterns` skill 必须先更新，补充多 Agent 委托模式的规范描述：Director 如何将专业任务委托给 Consistency Agent 和 Rules Agent（作为工具调用），以及这两类 Agent 的职责边界。

**A1：纯生成型子 Agent prompt 内化 + 死代码清理**

将 NPC/Plot/Monster/Lore/Location 五种资产的专业创作规范注入 Director `system.txt`，不增加额外 LLM 调用。

方案：
- `prompts/director/system.txt` 新增"资产类型创作规范"章节：
  - NPC：motivation、relationships（与现有 NPC 的关系）、secrets、行为模式
  - Monster：CR/HP/AC、能力块（STR-CHA）、特殊能力、战斗行为、剧情钩子
  - Plot：act 结构（setup/confrontation/resolution）、关键 NPC 列表、clue chain
  - Location/Stage：atmosphere、sensory_details（视觉/听觉/嗅觉）、points_of_interest
  - Lore Note：significance、known_to（哪些角色知道）、rumor_vs_truth
- 删除确认无外部调用的纯生成型子 Agent：`npc.py`/`plot.py`/`monster.py`/`lore.py`/`document.py`
- 对应的 `prompts/npc/`、`prompts/plot/`、`prompts/monster/`、`prompts/lore/`、`prompts/document/` 内容合并后删除（或保留为只读参考）

**A2：Consistency Agent 接回 Director 工具链**

将 `consistency.py` 包装为 Director 可调用的工具，在写入前检查新资产与现有资产的一致性。

方案：
- `tools.py` 新增 `check_consistency(draft_content_md, asset_type, asset_name)` 工具
  - 加载现有资产列表（从 `_workspace_context["existing_assets"]` 及按需 `read_asset`）
  - 调用 `run_consistency_agent(asset_summaries, model)` 
  - 返回结构化冲突报告 JSON（`{"issues": [...], "overall_status": "clean|warning|conflict"}`）
- `prompts/director/system.txt` 增加规则：**在调用 `create_asset` 或 `update_asset` 之前，必须先调用 `check_consistency`，若有 conflict 级别冲突须向用户说明**
- `check_consistency` 的返回结果在前端 ToolCallCard 中折叠展示（status badge + issues 列表）
- `consistency.py` 保留，但调整接口适配新的调用方式（接收 model 参数从 workspace_context 解析）

**A3：Rules Agent 接回 Director 工具链**

将 `rules.py` 包装为 Director 可调用的工具，替代裸 `search_knowledge` 用于规则 Q&A 和平衡性审查。

方案：
- `tools.py` 新增 `consult_rules(question, review_mode=False)` 工具
  - 内部先调用 `retrieve_knowledge(query=question, library_ids=...)` 拉取规则原文 chunks
  - 再调用 `run_rules_agent(question, knowledge_context, model, review_mode)` 做结构化推理
  - 返回 `{"suggestions": [...], "summary": str}`，每条 suggestion 含 citation
- `search_knowledge` 工具保留，用于非规则性的通用知识检索；`consult_rules` 专用于规则裁判
- `prompts/director/system.txt` 增加调用区分规则：涉及规则判定/平衡审查用 `consult_rules`；宽泛的背景资料检索用 `search_knowledge`
- `rules.py` 保留，接口小幅调整（model 从外部传入）

**A4：Skill Agent 工具化接回 Director**

`skill_agent.py` 是 M17 实现的"通过 chat 创建 Agent Skill"功能的后端组件，M19 重构后调用路径可能已断。Skill 创作是专项任务（写 Agent 指令框架），其 system prompt 与 Director 的通用创作 prompt 性质不同，**保留独立 Agent，工具化接回主流程**，模式与 Consistency/Rules Agent 完全一致。

方案：
- `prompts/skill/system.txt` 更新：要求 skill_agent **直接输出 Frontmatter Markdown**，格式与其他资产的 `content_md` 完全一致：
  ```markdown
  ---
  name: skill-slug
  description: 一句话描述
  agent_types:
    - npc
  ---
  # Skill 名称
  正文指令...
  ```
- `skill_agent.py` 返回值从结构化 dict 改为直接返回 `content_md` 字符串，无需工具函数做格式转换
- `tools.py` 新增 `create_skill(user_intent)` 工具：
  - 调用 `retrieve_knowledge` 拉取规则相关上下文
  - 调用 `run_skill_agent(user_intent, knowledge_ctx, workspace_context, model)` 得到 `content_md`
  - 打包 PatchProposal（写入工作空间 `skills/` 目录），raise `PatchProposalInterrupt`
- `skill_agent.py` 接口调整：model 从 `_workspace_context` 解析传入；返回 `str`（Markdown）而非 `dict`
- 检查并移除 M19 前遗留的旧调用路径（若有）

**A5：search_assets 语义搜索升级**

复用现有 embedding 基础设施，为资产内容建立向量索引，使 `search_assets` 支持语义相似度检索。

方案：
- 新建 `knowledge/asset_indexer.py`：`index_asset()`、`search_assets_semantic()`、`delete_asset_from_index()`
- `asset_service.py` 的 `create_asset_file` / `update_asset_content` 写入后异步触发 `index_asset()`
- 向量索引存入 `.trpg/asset_index/{workspace_id}.lance`（与 knowledge chunk 索引分开）
- `tools.py` `configure()` 从 workspace_context 解析 embedding profile 初始化 embedding_fn
- `tools.py` `search_assets`：embedding_fn 可用时走语义路径，否则 fallback 到关键词

**A6：知识库检索主动性强化**

- `prompts/director/system.txt` 新增强制检索规则 + 2 条 few-shot 示例（展示"先检索后生成"的正确行为）
- `search_knowledge` docstring 强化触发条件
- `library_ids` 为空时 `search_knowledge` 返回引导提示而非静默空结果

**A7：信任模式（B1）**

- `WorkspaceORM` 或 `config.yaml` 新增 `trust_mode: bool = False`
- `workspace_context` 传入 `trust_mode`
- 写入工具在 `trust_mode=True` 时直接 `execute_patch_proposal`，不抛 `PatchProposalInterrupt`，返回含 `auto_applied: true` 字段
- SSE 层检测 `auto_applied`，yield `{"event": "auto_applied", "data": {...}}`
- 前端 AgentPanel header 增加信任模式开关；ToolCallCard 写入结果显示"已自动应用" badge

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：Token 预算 UI（原 M19 B2）**：实时显示 token 估算和知识库命中段落数，工程量独立，不阻塞 A 类
- **B2：Consistency 自动触发（后台静默）**：目前 A2 要求 Director 主动调用 check_consistency；后续可改为每次 PatchProposal confirm 前后台自动触发，不占用 Director 的 tool-call 轮次

### C 类：明确不承诺

- 工具函数内嵌子 Agent LLM 二次增强（A1 的 prompt 内化方案已覆盖质量需求）
- 资产 embedding 的增量删除同步（rename/delete 时不更新向量索引，0.1.0 未发布可接受脏数据）
- Consistency Agent 作为独立 UI 面板（当前只作为 Director 工具，不独立暴露给用户）
- 多 Agent 并行生成（Director 同时派发多个子任务）：当前 Agno 单 Agent 够用

---

## 文件结构

### 删除文件

```
apps/backend/app/agents/npc.py           — 死代码，prompt 内化到 director system.txt
apps/backend/app/agents/plot.py          — 同上
apps/backend/app/agents/monster.py       — 同上
apps/backend/app/agents/lore.py          — 同上
apps/backend/app/agents/document.py      — 旧 workflow patch 格式化器，M19 后死代码
apps/backend/app/prompts/npc/            — 合并后删除（或保留为只读参考）
apps/backend/app/prompts/plot/           — 同上
apps/backend/app/prompts/monster/        — 同上
apps/backend/app/prompts/lore/           — 同上
apps/backend/app/prompts/document/       — 同上
```

### 保留文件（调整接口后接回主流程）

```
apps/backend/app/agents/consistency.py  — 接回：由 check_consistency 工具调用
apps/backend/app/agents/rules.py        — 接回：由 consult_rules 工具调用
apps/backend/app/agents/skill_agent.py  — 接回：由 create_skill 工具调用（不可删除）
```

### 修改文件

```
apps/backend/app/agents/tools.py                  — 新增 check_consistency、consult_rules、create_skill；search_assets 语义路径；写入工具信任模式逻辑
apps/backend/app/agents/director.py               — build_director 传入 trust_mode；ALL_TOOLS 更新
apps/backend/app/prompts/director/system.txt      — 新增类型创作规范、一致性检查规则、知识库检索强制规则、few-shot 示例
apps/backend/app/services/asset_service.py        — create/update 后异步触发 asset embedding
apps/backend/app/workflows/utils.py               — get_workspace_context 传入 trust_mode 和 embedding profile
apps/desktop/src/components/agent/AgentPanel.tsx  — 信任模式开关 + auto_applied 事件渲染
apps/desktop/src/components/agent/ToolCallCard.tsx — 新增"已自动应用" badge；Consistency 冲突报告折叠渲染
packages/shared-schema/src/index.ts               — 新增 AutoAppliedEvent、ConsistencyReport 类型
.agents/skills/agent-workflow-patterns/SKILL.md   — A0：补充多 Agent 委托模式规范
```

### 新增文件

```
apps/backend/app/knowledge/asset_indexer.py       — 资产 embedding 生成与向量索引管理
```

---

## 关键设计约束

### 1. 子 Agent 调用模式（A2/A3）

Consistency 和 Rules Agent 作为 Director 工具被调用，而不是直接注册进 `Agent(tools=[...])`：

```python
@tool
def check_consistency(asset_name: str, asset_type: str, draft_content_md: str) -> str:
    """在创建或修改资产前，检查草稿与现有资产的一致性。返回冲突报告 JSON。
    有 conflict 级别问题时，必须向用户说明后再决定是否继续。"""
    from app.agents.consistency import run_consistency_agent
    existing = _workspace_context.get("existing_assets", [])
    # 只传入同类型资产 + 名称相近资产，控制 context size
    relevant = [a for a in existing if a.get("type") == asset_type][:20]
    report = run_consistency_agent(
        asset_summaries=relevant + [{"name": asset_name, "type": asset_type, "content_json": draft_content_md}],
        model=_get_model(),
    )
    return json.dumps(report, ensure_ascii=False)

@tool
def consult_rules(question: str, review_mode: bool = False) -> str:
    """咨询规则集，返回带原文引用的规则裁判意见。用于规则 Q&A 和平衡性审查。
    比 search_knowledge 更适合需要推理解释的规则问题。"""
    from app.agents.rules import run_rules_agent
    from app.knowledge.retriever import retrieve_knowledge
    library_ids = _workspace_context.get("library_ids", [])
    knowledge_ctx = retrieve_knowledge(question, library_ids, _db, top_k=8) if library_ids else []
    result = run_rules_agent(question, knowledge_ctx, model=_get_model(), review_mode=review_mode)
    return json.dumps(result, ensure_ascii=False)
```

`_get_model()` 从 `_workspace_context` 或单独的 `_model` 模块变量中取，与 `configure()` 一起注入。

### 2. Director 工具调用顺序约束（system.txt 新增规则）

```
## 工具调用规范

### 写入前必须执行的检查
1. 调用 create_asset 或 update_asset 前，必须先调用 check_consistency
2. 若 check_consistency 返回 overall_status == "conflict"，必须向用户说明冲突详情，
   由用户决定是否继续；"warning" 级别可继续但需在回复中提及

### 知识库工具选择
- 涉及规则裁判、能力平衡、规则 Q&A → 使用 consult_rules
- 涉及宽泛背景资料、地名、历史、NPC 传说 → 使用 search_knowledge
- 两者均适用时，优先 consult_rules
```

### 3. A5 资产 embedding 数据流

```
用户确认 PatchProposal
  → execute_patch_proposal 写磁盘 + 更新 DB
  → 后台线程：asset_indexer.index_asset(slug, content_md, workspace_context)
    → 按 ## 标题切分 chunks
    → 调用 embedding profile 生成向量
    → 存入 .trpg/asset_index/{workspace_id}.lance
search_assets 工具：
  if embedding_fn:
      return semantic_search(query, top_k=8)
  else:
      return keyword_search(query)   # 现有逻辑
```

### 4. 信任模式数据流（A7）

```python
# tools.py write tool
def create_asset(...):
    proposal = {...}
    if _workspace_context.get("trust_mode"):
        result = execute_patch_proposal(proposal, workspace_path, _db)
        return json.dumps({"auto_applied": True, **result})
    raise PatchProposalInterrupt(proposal)

# director.py SSE 层
if hasattr(chunk, "tool_results"):
    for tr in chunk.tool_results:
        content = json.loads(tr.content or "{}")
        if content.get("auto_applied"):
            yield {"event": "auto_applied", "data": content}
        else:
            yield {"event": "tool_call_result", ...}
```

---

## Todo

### A0：开发 Skill 更新

- [ ] **A0.1**：`.agents/skills/agent-workflow-patterns/SKILL.md` — 补充多 Agent 委托模式：Director 作为编排者、Consistency/Rules 作为专业工具代理的职责边界与调用规范

### A1：纯生成型子 Agent prompt 内化

- [ ] **A1.1**：确认 `npc.py`/`plot.py`/`monster.py`/`lore.py`/`document.py` 无外部调用
- [ ] **A1.2**：`prompts/director/system.txt` — 新增五类资产创作规范（NPC/Monster/Plot/Location/Lore）
- [ ] **A1.3**：删除 `npc.py`/`plot.py`/`monster.py`/`lore.py`/`document.py` 及对应 prompts 目录

### A2：Consistency Agent 接回

- [ ] **A2.1**：`agents/tools.py` — 新增 `check_consistency` 工具函数
- [ ] **A2.2**：`agents/consistency.py` — 调整接口：model 参数从外部传入（从 `_workspace_context` 解析）
- [ ] **A2.3**：`prompts/director/system.txt` — 新增"写入前必须 check_consistency"规则
- [ ] **A2.4**：前端 `ToolCallCard.tsx` — check_consistency 结果渲染：status badge + issues 折叠列表
- [ ] **A2.5**：`packages/shared-schema/src/index.ts` — 新增 `ConsistencyReport` 类型

### A3：Rules Agent 接回

- [ ] **A3.1**：`agents/tools.py` — 新增 `consult_rules` 工具函数（内部调用 retriever + rules agent）
- [ ] **A3.2**：`agents/rules.py` — 确认接口兼容，model 从外部传入
- [ ] **A3.3**：`agents/tools.py` `configure()` — 增加 `_model` 注入，供子 Agent 工具调用
- [ ] **A3.4**：`prompts/director/system.txt` — 新增 consult_rules vs search_knowledge 选择规则 + 2 条 few-shot 示例
- [ ] **A3.5**：`search_knowledge` — library_ids 为空时返回引导提示

### A4：Skill Agent 工具化接回

- [ ] **A4.1**：检查现有调用路径（`api/chat.py` 等），移除 M19 前的旧调用方式
- [ ] **A4.2**：`agents/tools.py` — 新增 `create_skill(user_intent)` 工具（内部调用 retrieve_knowledge + run_skill_agent，raise PatchProposalInterrupt 写入 skills/ 目录）
- [ ] **A4.3**：`agents/skill_agent.py` — 接口调整：model 从 `_workspace_context` 解析传入（与 consistency.py/rules.py 一致）

### A5：资产语义搜索

- [ ] **A5.1**：新建 `knowledge/asset_indexer.py` — `index_asset()`、`search_assets_semantic()`
- [ ] **A5.2**：`services/asset_service.py` — 写入后后台触发 `index_asset()`
- [ ] **A5.3**：`agents/tools.py` `configure()` — 解析 embedding profile，初始化 embedding_fn
- [ ] **A5.4**：`agents/tools.py` `search_assets` — 增加语义路径，fallback 到关键词

### A6：知识库检索主动性强化（部分已在 A3.4/A3.5 覆盖）

- [ ] **A6.1**：手动测试：创建怪物时 Director 是否自动调用 `consult_rules`
- [ ] **A6.2**：手动测试：`library_ids` 为空时 `search_knowledge` 是否返回引导提示

### A7：信任模式

- [ ] **A7.1**：`models/orm.py` `WorkspaceORM` — 新增 `trust_mode: bool = False` 字段（或写入 config.yaml）
- [ ] **A7.2**：`workflows/utils.py` `get_workspace_context()` — 传入 `trust_mode`
- [ ] **A7.3**：`agents/tools.py` 写入工具 — trust_mode 分支逻辑
- [ ] **A7.4**：`api/chat.py` SSE 层 — 检测 `auto_applied` 字段，yield `auto_applied` 事件
- [ ] **A7.5**：`packages/shared-schema/src/index.ts` — 新增 `AutoAppliedEvent` 类型
- [ ] **A7.6**：前端 `AgentPanel.tsx` — header 信任模式开关（绑定 workspace 设置 PATCH 接口）
- [ ] **A7.7**：前端 `ToolCallCard.tsx` — "已自动应用" badge

---

## 验收标准

1. Director 创建 NPC 时，`content_md` 必须包含 motivation、relationships、secrets 三个章节
2. Director 创建怪物时，`content_md` 必须包含 CR/HP/AC 和至少一条特殊能力块
3. 创建任意资产前，前端 ToolCallCard 中必须出现 `check_consistency` 调用记录；若有冲突，Assistant 回复中必须说明冲突详情
4. 在已绑定规则集知识库的工作空间中，询问"这个怪物的先攻值怎么算"，前端 ToolCallCard 必须出现 `consult_rules` 调用，返回结果含原文引用
5. 语义搜索：搜索"码头相关 NPC"，即使 summary 无"码头"字样，内容语义相关的 NPC 仍应返回；无 embedding profile 时 fallback 到关键词不报错
6. 开启信任模式后，写入工具不弹确认框，ToolCallCard 显示"已自动应用"，资产文件实际写入磁盘
7. 关闭信任模式，恢复 PatchProposal 确认流
8. `npc.py`/`plot.py`/`monster.py`/`lore.py`/`document.py` 已删除，`git grep "from app.agents.npc"` 无输出
9. `consistency.py` / `rules.py` / `skill_agent.py` 均有明确调用路径（分别通过 `check_consistency` / `consult_rules` / `create_skill` 工具），不再是死代码

---

## 与其他里程碑的关系

```
M19（Agent 上下文控制与工具能力）
  └── M20（Agent 创作质量与上下文感知增强）← 本 milestone
        ├── 多会话管理（独立 proposal，待规划）
        └── M21 发布打包 & CI/CD（无技术依赖，可并行规划）
```

---

## 非目标

- **工具函数内嵌子 Agent LLM 二次增强**：A1 的 prompt 内化方案已覆盖质量需求，不增加额外 LLM 调用
- **资产 embedding 的增量删除同步**：0.1.0 未发布，可接受脏数据
- **Consistency Agent 作为独立 UI 面板**：当前只作为 Director 工具，不独立暴露
- **多 Agent 并行生成**：Director 串行调用已够用，并行调度复杂度不值得现在投入
- **Token 预算 UI（原 M19 B2）**：列为 B 类，不阻塞本 milestone 交付
