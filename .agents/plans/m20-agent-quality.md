# M20：Agent 创作质量与上下文感知增强

**前置条件**：M19 完成（tool-calling Director、SSE streaming、PatchProposal 确认流全部就位）。

**目标**：补齐 M19 遗留的创作质量缺口——子 Agent 专业 prompt 内化、资产语义搜索、知识库检索主动性约束，以及减少确认疲劳的信任模式和上下文可视化。

---

## 背景与动机

M19 将 Director 升级为 tool-calling 自主 Agent，但留下三处已知缺口：

**缺口 1（A6.6 遗留）：子 Agent 专业 prompt 未内化**

`npc.py`/`plot.py`/`monster.py`/`lore.py` 这四个子 Agent 文件保留在 `agents/` 目录但无人调用。Director 创建任意类型资产时，`content_md` 由通用 LLM 自由生成，缺少 NPC 动机关系、怪物能力块、场景叙事等专业结构约束。表现为：创建 NPC 时可能只有描述段落而没有 motivation/relationships 字段；创建怪物时没有 CR/能力块结构。

**缺口 2（B3）：search_assets 只做关键词匹配**

`search_assets` 目前仅对 name/summary/slug 做 `in` 字符串匹配。用户问"有没有跟码头相关的 NPC"，如果资产 summary 里只写了"港口守卫"而没有出现"码头"，就会漏检。向量搜索基础设施（lancedb/hnswlib + embedding profile）已在 M2/M9a 完成，资产文件（Markdown）与知识库 chunk 同构，复用现有 retriever 即可。

**缺口 3（B3 的另一面）：Director 不主动检索知识库**

`search_knowledge` 已经接通语义检索（`retrieve_knowledge` 调用 embedding retriever），但 Director 的 system prompt 只是软性建议"涉及规则时先检索"。实际对话中 LLM 经常跳过这步直接生成，导致规则细节不准确。需要更强的 few-shot 约束或工具调用顺序引导。

**缺口 4（B1）：确认疲劳**

每次写入都弹确认框，对熟悉工作流的用户体验差。需要一个信任模式让用户可以切换为"自动确认"。

**缺口 5（B2）：上下文不可见**

用户不知道当前对话消耗了多少 token、知识库检索返回了多少内容，导致当 Agent 开始"失忆"或"忽略规则"时难以诊断。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：子 Agent 专业 prompt 内化到 Director 系统 prompt**

最轻量的修复方案：不在工具函数里跑额外 LLM 调用，而是将每种资产类型的专业创作规范直接注入 Director 的 `system.txt`，形成"类型创作手册"章节。Director 在调用 `create_asset` 之前，已经从 system prompt 里获得了目标类型的结构要求。

方案：
- `prompts/director/system.txt` 新增"资产类型创作规范"章节，覆盖 npc/plot/monster/lore/location 五种主要类型
  - NPC：必须包含 motivation、relationships、secrets 字段
  - Monster：必须包含 CR、HP、AC、特殊能力块
  - Plot：必须包含 act 结构（setup/confrontation/resolution）、关键 NPC 列表
  - Location/Stage：必须包含 atmosphere、sensory_details、points_of_interest
  - Lore Note：必须包含 significance、known_to（哪些 NPC 知道）
- `npc.py`/`plot.py`/`monster.py`/`lore.py` 删除（死代码清理）
- 各对应 `prompts/{type}/` 下的 system.txt 内容合并进 director system.txt 后删除（或保留为文档参考，不删除以防需要单独运行）

> 注：此方案比"工具函数内跑子 Agent LLM"更简单、延迟更低，缺点是 Director context window 增大约 800 token。对于当前支持 32k+ 的模型，可接受。

**A2：资产语义搜索（search_assets 升级）**

在资产写入时（create/update），为资产内容生成 embedding 并存入本地向量索引，使 `search_assets` 支持语义相似度检索。

方案：
- `asset_service.py` 的 `create_asset_file` / `update_asset_content` 中，写入完成后异步触发 embedding 生成
- embedding 使用 workspace 绑定的 embedding profile（与知识库使用同一套基础设施）
- 向量索引存入 `.trpg/asset_index/`（与 knowledge chunk 索引分开存放）
- `tools.py` 的 `search_assets` 增加 semantic 路径：当 embedding profile 可用时，用向量相似度检索；无 embedding profile 时 fallback 到现有关键词搜索
- `configure()` 传入 embedding_fn（从 workspace_context 解析 embedding profile）

**A3：Director 知识库检索主动性强化**

方案：
- `prompts/director/system.txt` 新增强制检索规则 + few-shot 示例，明确"在生成任何怪物/规则相关内容前，必须先调用 search_knowledge"
- 在 `search_knowledge` 工具的 docstring 中强化触发条件（LLM 依赖 docstring 决策）
- 若 `library_ids` 为空，`search_knowledge` 返回提示引导用户绑定知识库，而非静默返回空

**A4：信任模式（B1）**

用户可以在 AgentPanel 或 WorkspaceSettings 中开启"信任模式"，开启后写入工具直接执行不弹确认框。

方案：
- `WorkspaceORM` 新增 `trust_mode: bool = False` 字段（或存入 config.yaml）
- `workspace_context` 传入 `trust_mode` 标志
- `tools.py` 的写入工具：`trust_mode=True` 时直接调用 `execute_patch_proposal` 写入，不抛 `PatchProposalInterrupt`；同时 yield 一个 `auto_applied` SSE 事件通知前端
- 前端 AgentPanel：信任模式下 ToolCallCard 写入结果显示"已自动应用"标签，不展示确认框
- 前端 AgentPanel header 或 WorkspaceSettings 增加信任模式开关

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：Token 预算 UI（原 M19 B2）**：实时显示当前对话 token 估算和知识库命中段落数，作为独立面板或 tooltip；依赖 tiktoken 或模型 API 的 usage 字段。工程量独立，不阻塞 A 类。

### C 类：明确不承诺

- 子 Agent 作为独立调用节点（工具函数内跑额外 LLM）：增加延迟和复杂度，A1 方案已覆盖质量需求
- 资产 embedding 的增量更新（rename/delete 时同步删除向量）：0.1.0 未发布，暂不做
- 多 Agent 并行创作（Director 同时派发多个子任务）：当前 Agno 单 Agent 够用
- 不支持 tool-calling 的模型 fallback：同 M19 非目标

---

## 文件结构

### 删除文件

```
apps/backend/app/agents/npc.py          — 死代码，prompt 已内化到 director
apps/backend/app/agents/plot.py         — 同上
apps/backend/app/agents/monster.py      — 同上
apps/backend/app/agents/lore.py         — 同上
apps/backend/app/agents/consistency.py  — 同上（若确认未被调用）
apps/backend/app/agents/document.py     — 同上（若确认未被调用）
apps/backend/app/agents/rules.py        — 同上（若确认未被调用）
apps/backend/app/agents/skill_agent.py  — 同上（若确认未被调用）
```

> 删除前逐一确认无外部调用。

### 修改文件

```
apps/backend/app/agents/tools.py                  — search_assets 增加 semantic 路径；write tools 增加 trust_mode 逻辑
apps/backend/app/agents/director.py               — build_director 传入 trust_mode；workspace_context 增加 embedding_fn
apps/backend/app/prompts/director/system.txt      — 新增类型创作规范章节 + 知识库检索强制规则
apps/backend/app/services/asset_service.py        — create/update 后异步触发 asset embedding
apps/backend/app/workflows/utils.py               — get_workspace_context 传入 trust_mode
apps/desktop/src/components/agent/AgentPanel.tsx  — 信任模式开关 + auto_applied 事件渲染
apps/desktop/src/components/agent/ToolCallCard.tsx — 新增"已自动应用"标签
packages/shared-schema/src/index.ts               — 新增 trust_mode 相关类型、auto_applied SSE 事件类型
```

### 新增文件

```
apps/backend/app/knowledge/asset_indexer.py       — 资产 embedding 生成与向量索引管理
```

---

## 关键设计约束

### 1. A1 类型创作规范注入格式

```
## 资产类型创作规范

### NPC
创建 NPC 时，content_md 正文必须包含以下章节（Markdown 二级标题）：
- ## 基本信息（身份、年龄、外貌）
- ## 动机与目标（核心驱动力，明面目标 vs 隐藏目标）
- ## 人际关系（与其他 NPC/玩家角色的关系）
- ## 秘密（至少一个不为人知的秘密）
- ## 行为模式（在场景中的典型行为）

### Monster（怪物）
- ## 基础属性（CR / HP / AC / 速度）
- ## 能力块（STR/DEX/CON/INT/WIS/CHA）
- ## 特殊能力（每项含名称、触发条件、效果描述）
- ## 战斗行为（行动/附赠行动/反应）
- ## 剧情钩子（如何与模组剧情关联）

...（plot/location/lore 类似）
```

### 2. A2 资产 embedding 数据流

```
用户确认 PatchProposal
  → execute_patch_proposal 写入磁盘 + 更新 DB
  → 异步触发 asset_indexer.index_asset(asset_id, content_md, workspace_context)
    → 切分 content_md 为 chunks（按 ## 标题切分）
    → 调用 workspace embedding profile 生成向量
    → 存入 .trpg/asset_index/{workspace_id}.lance（lancedb）或 hnswlib
  → search_assets 工具：
    if embedding_fn available:
        results = asset_index.query(embed(query), top_k=5)
    else:
        fallback to keyword search
```

### 3. A4 信任模式数据流

```
workspace_context["trust_mode"] = True/False
  ↓
tools.py create_asset / update_asset:
  if trust_mode:
      result = execute_patch_proposal(proposal, workspace_path, db)
      # 不 raise PatchProposalInterrupt
      return json.dumps({"auto_applied": True, **result})
  else:
      raise PatchProposalInterrupt(proposal)  # 现有流程
  ↓
director.py run_director_stream:
  # trust_mode 下无 PatchProposalInterrupt，tool_result 中含 auto_applied
  # SSE 层检测 auto_applied 字段，yield {"event": "auto_applied", "data": {...}}
```

---

## Todo

### A1：子 Agent prompt 内化

- [ ] **A1.1**：确认 `npc.py`/`plot.py`/`monster.py`/`lore.py`/`consistency.py`/`document.py`/`rules.py`/`skill_agent.py` 无外部调用，标记可删除
- [ ] **A1.2**：`prompts/director/system.txt` — 新增"资产类型创作规范"章节（npc/monster/plot/location/lore 五类）
- [ ] **A1.3**：`prompts/director/system.txt` — 新增知识库检索强制规则 + 2 条 few-shot 示例
- [ ] **A1.4**：`agents/tools.py` `search_knowledge` docstring — 强化触发条件描述；library_ids 为空时返回引导提示
- [ ] **A1.5**：删除确认无外部调用的子 Agent 文件及对应 prompts 目录
- [ ] **A1.6**：`agents/__init__.py` 清理死代码导入

### A2：资产语义搜索

- [ ] **A2.1**：新建 `knowledge/asset_indexer.py` — `index_asset()`、`search_assets_semantic()`、`delete_asset_from_index()`
- [ ] **A2.2**：`services/asset_service.py` — `create_asset_file` 和 `update_asset_content` 写入后调用 `asset_indexer.index_asset()`（后台线程，不阻塞响应）
- [ ] **A2.3**：`agents/tools.py` `configure()` — 从 workspace_context 解析 embedding profile，初始化 embedding_fn
- [ ] **A2.4**：`agents/tools.py` `search_assets` — 增加 semantic 路径，fallback 到关键词
- [ ] **A2.5**：`workflows/utils.py` `get_workspace_context()` — 传入 embedding profile 配置到 context

### A3：知识库检索主动性（已在 A1.3/A1.4 覆盖，此处补充验证）

- [ ] **A3.1**：手动测试：创建一个怪物，验证 Director 自动调用 `search_knowledge` 拉取规则集内容
- [ ] **A3.2**：`search_knowledge` 返回为空时，确认提示文案引导用户绑定知识库

### A4：信任模式

- [ ] **A4.1**：`models/orm.py` `WorkspaceORM` — 新增 `trust_mode: bool` 字段（或写入 config.yaml）
- [ ] **A4.2**：`workflows/utils.py` `get_workspace_context()` — 传入 `trust_mode`
- [ ] **A4.3**：`agents/tools.py` 写入工具 — `trust_mode=True` 时直接 execute，返回含 `auto_applied` 的结果
- [ ] **A4.4**：`api/chat.py` SSE 层 — 检测 tool_result 中的 `auto_applied` 字段，yield `auto_applied` 事件
- [ ] **A4.5**：`packages/shared-schema/src/index.ts` — 新增 `AutoAppliedEvent` SSE 类型
- [ ] **A4.6**：前端 `AgentPanel.tsx` — header 区域增加信任模式开关（Checkbox/Toggle），绑定 workspace 设置
- [ ] **A4.7**：前端 `ToolCallCard.tsx` — 新增"已自动应用"badge 渲染逻辑
- [ ] **A4.8**：API 端点 `PATCH /workspaces/{id}` — 支持更新 `trust_mode` 字段（或通过现有 workspace update 端点）

---

## 验收标准

1. 让 Director 创建一个 NPC，生成的 content_md 中必须包含动机、人际关系、秘密三个章节，不能只有描述段落
2. 让 Director 创建一个怪物，生成的 content_md 中必须包含 CR/HP/AC 和至少一条特殊能力块
3. 在已绑定规则集知识库的工作空间中，让 Director 回答"这个怪物的先攻值怎么算"，前端 ToolCallCard 中必须出现 `search_knowledge` 调用记录
4. 搜索"码头相关 NPC"，即使 NPC summary 没有出现"码头"字样，只要内容语义相关，`search_assets` 仍应返回该 NPC（semantic 路径生效）；无 embedding profile 时 fallback 到关键词不报错
5. 开启信任模式后，Director 调用 `create_asset` 或 `update_asset` 时不弹确认框，前端 ToolCallCard 显示"已自动应用"，资产文件实际写入磁盘
6. 关闭信任模式后，写入工具恢复弹出确认框（PatchProposal 流程不变）
7. `npc.py`/`plot.py`/`monster.py`/`lore.py` 已从代码库中删除，`git grep "from app.agents.npc"` 无输出

---

## 与其他里程碑的关系

```
M19（Agent 上下文控制与工具能力）
  └── M20（Agent 创作质量与上下文感知增强）← 本 milestone
        ├── 多会话管理（独立 proposal，待规划）
        └── 图片生成展示（独立 proposal，待规划）
```

---

## 非目标

- **工具函数内嵌子 Agent LLM 调用**：增加延迟与复杂度，A1 的 prompt 内化方案已覆盖质量需求
- **资产 embedding 的增量删除同步**：rename/delete 时不更新向量索引，0.1.0 未发布，可接受脏数据
- **Token 预算 UI（原 M19 B2）**：列为 B 类，不阻塞本 milestone 交付
- **发布打包 & CI/CD**：原 M20 规划的发布流水线，与本 milestone 无技术依赖，可并行规划为独立 milestone
