# M26：探索子 Agent 与 Prompt 体系统一

**前置条件**：M25 完成（LLM Profile 与聊天、模型选择基础稳定；M20 子 Agent 工具委托与 Director 流式聊天已存在）。

**目标**：以**类 vibe coding** 的「先逛后写」为目标，落地**只读探索子 Agent（Explore）** 与独立中文 system，减轻「全揉在 Director 里」的创作偏置；同步完成 **P0 契约**、**全栈 prompt 统一中文化**（含 Rules/Consistency/Skill、**PDF 与 CHM 两条 TOC 线**、散落任务句）、**死 prompt 清理**与**注册表文档纠偏**；并补齐 **聊天历史摘要** 的 `prompts/` 化与 **PromptProfile 生成** 复查。**不**在本 milestone 承诺通用 LLM 埋点落库（见 B1）。不恢复已否定的旧顺序多 Agent 主创作链。

**实施优先级**：**先**完成「prompt 迁出 + 规范化 + P0/死 prompt/中文化」（见下节 **阶段 1**），**再**做 Explore 与会话分支（**阶段 2**），最后文档与 skill（**阶段 3**）。避免在仍含内联文案的基线上叠新 Agent，降低回归面。

---

## 实施顺序（与 A 类编号正交，执行时依此分 PR/迭代）

| 阶段 | 范围 | 对应 A 类 |
|------|------|-----------|
| **1 — 优先** | 所有 **仍内联 / 未规范** 的 prompt **迁出**或收编、**统一中文化**、**A3** P0、**A5** 清理、**A7.1–A7.2**、**A4**（含 A4.2 TOC 双文件 + user 模板；consistency/skill user 英文见 A7 §4） | 地基先干净 |
| **2** | **A1** Explore 子 Agent、**A2** Director 边界、前端 `agent_scope`、**chat** 中按 scope 分流的非 prompt 逻辑 | 产品能力 |
| **3** | **A6** skill/架构文档、**A7.3**（pdf-knowledge skill 更新）、验收扫尾；**内建 Help 全文不纳入本阶段**（待系统再稳定后**统一重建** `apps/desktop/src/help/`，见「非目标」） | 文档与闭环 |

> 若资源紧缺：**不得**裁掉阶段 1 去赶阶段 2；阶段 1 可拆多 PR，但**顺序**保持「先迁出、再 Explore」。

---

## 背景与动机

- 产品处于**持续创建期**，希望**少绕路**：若业界与架构上更常见、体验上更清晰的是**创作（Director）与探索（Explore）分流**，则本 milestone **直接**按该方向交付，**不做**「先试点轻量提示词再二选一」的折中。
- 审计结论（见会话与 `.cursor/plans` 中的 System Prompt 审计计划）：`director/system` 与 Consistency 的 `overall_status` 枚举不一致、局部修改指引自相矛盾、大量未使用的旧阶段 prompt 与 `__init__.py` 幽灵示例混在仓库中；Rules / Consistency / Skill 与 Director **语言不统一**。
- 后续扫库：[`_summarize_dropped_messages`](apps/backend/app/api/chat.py) 仍把**摘要 system 文案**写在代码里，未走 `load_prompt`；**PromptProfile 生成**、**PDF/CHM 两条 TOC** 已使用 [`prompt_profiles/generate.txt`](apps/backend/app/prompts/prompt_profiles/generate.txt) 与 [`toc_analyzer/system.txt`](apps/backend/app/prompts/toc_analyzer/system.txt) / [`chm_classify_system.txt`](apps/backend/app/prompts/toc_analyzer/chm_classify_system.txt)（**两文件对应两种目录格式，非重复**），纳入 M26 **统一中文化**与**规范化**。
- 现已有子 Agent（Consistency、Rules、Skill）均为**委托推理**（审查、规则、生成 Skill 指令），**不可替代**「在工作区内搜索、通读、帮用户建立 mental map」的探索会话；**Explore 不替代**上述子 Agent，而是**补齐**与创作主脑不同的心智模式。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A0：本 milestone 与路线图已落地（第一项）**

方案：在实现任何功能代码之前，**先**完成本文件的提交与 `roadmap.md` 的同步，使 M26 成为全仓库**单一事实源**；后续子任务均引用本 plan 的编号。

**A1：Explore 子 Agent（只读、中文 system）**

方案：

- 新增 `app/prompts/explore/system.txt`：**中文**短 system，专责「理解工作区结构、多查少写、帮助用户选读与总结」，**禁止**调用任何写盘工具；明确鼓励在快照过时时使用 `list_assets` / `search_assets` 等刷新认知。
- 新增 `app/agents/explore.py`：实现与 Director 对等的**流式**入口（如 `run_explore_stream`），但 Agent **仅**绑定只读工具子集（与 [tools.py](apps/backend/app/agents/tools.py) 中 list/read/grep/section、语义搜索、**可选**只读向的 `search_knowledge` / `web_search` / `consult_rules` 的策略一致——**不**提供 `create_asset` / `patch` / `update` / `create_skill` / `check_consistency` 等写入或重推理委托，**具体白名单在实现前在 code review 中定稿**）。
- **会话分支**：`ChatSessionORM` 上已有 [agent_scope](apps/backend/app/models/orm.py) 字段。在 [chat.py](apps/backend/app/api/chat.py) 的 `send_message` 中，根据 `session.agent_scope`（如 `explore` vs 默认 `director` 或 `null`）**分支**到 `run_explore_stream` 与 `run_director_stream`。
- **前端**：新建会话时可选类型「探索 / 创作」（或等效 UI），将 `agent_scope` 写入会话创建请求；Session 列表/标题区可标识当前会话模式（避免用户误以为探索会话会改文件）。Explore 侧 **LLM 的解析与绑定** 与现网**发消息**时一致（复用已有逻辑，不新增任何为 Explore 单独设的配置或代码路径）。

**A2：Director「创作」与 Explore「探索」职责边界在 prompt 层显式化**

方案：在 [director/system.txt](apps/backend/app/prompts/director/system.txt) 中**删除或收束**与 Explore 重复的长篇「仅问答/仅总结」说明负担（避免双份）；突出 Director 的**落稿、改资产、写前一致性**主责；**禁止**在 Director 中再堆一套「只读长教程」来替代 A1。保留一条交叉引用式说明：「只逛不写请使用探索类会话（Explore）」。

**A3：P0 契约修复（prompt 与 schema 一致）**

- 修正 Director 中关于 `check_consistency` 返回的 `overall_status` 描述，与 [consistency/system.txt](apps/backend/app/prompts/consistency/system.txt) 及 [shared-schema](packages/shared-schema/src/index.ts) 一致（`clean` | `has_warnings` | `has_errors`）。
- 统一「局部修改」指引：**优先** `grep_asset` 定位再 `patch_asset`，避免与 `read_asset` 全文策略矛盾。

**A4：统一中文化（子 Agent + 知识管线 prompt）**

方案：将以下 **system/任务说明** 全面改为**中文叙述**（与 Director / 产品 UI 一致；**JSON 键名、chunk 类型枚举值**等若与解析器/TS 类型耦合，可保留英文键值，但说明句用中文）：

- [rules/system.txt](apps/backend/app/prompts/rules/system.txt)、[rules/review.txt](apps/backend/app/prompts/rules/review.txt)
- [consistency/system.txt](apps/backend/app/prompts/consistency/system.txt)、[skill/system.txt](apps/backend/app/prompts/skill/system.txt)
- **TOC 两条线（非重复，是两种来源格式）**  
  - [`toc_analyzer/system.txt`](apps/backend/app/prompts/toc_analyzer/system.txt)：**PDF / 印刷型规则书**目录页抽文本 → 解析章节树与 `chunk_type` 建议。  
  - [`toc_analyzer/chm_classify_system.txt`](apps/backend/app/prompts/toc_analyzer/chm_classify_system.txt)：**CHM** 帮助包目录（HHC 扁平序）→ 对浅层节点打 `suggested_chunk_type`、深层继承。  
  两条 prompt **职责不同**，**必须都**纳入中文化，不得因「已有一套」合并为一个文件。

验收时核对：中文化后 **JSON 结构、`is_toc`、`sections`、CHM 批量输出格式** 与 [toc_analyzer.py](apps/backend/app/knowledge/toc_analyzer.py) 解析逻辑仍一致；必要时在代码注释中标注「键名与 CHM/PDF 流程一致」。

**A5：死 prompt 与注册表清理**

- 将 [director/clarification.txt](apps/backend/app/prompts/director/clarification.txt)、[director/planning.txt](apps/backend/app/prompts/director/planning.txt) **移出热路径**（删除或移入如 `archive/` 子目录 / 文档说明「旧顺序编排已废弃」），**不得**接回为默认运行路径。
- 处理 [_shared/rag_injection.txt](apps/backend/app/prompts/_shared/rag_injection.txt)、[_shared/style_prefix.txt](apps/backend/app/prompts/_shared/style_prefix.txt)：**要么**由 [skill_agent.py](apps/backend/app/agents/skill_agent.py) / [director.py](apps/backend/app/agents/director.py) 通过 `load_prompt` 正式使用，**要么**删除以免误导（二选一在 PR 中给出理由）。
- 修正 [__init__.py](apps/backend/app/prompts/__init__.py) 文档与示例，**仅**列真实存在的 `load_prompt` 组合，去掉 `plot/outline` 等幽灵引用。

**A6：协作 skill 与架构文档同步**

方案：在 [agent-workflow-patterns/SKILL.md](.agents/skills/agent-workflow-patterns/SKILL.md) 与 [trpg-workbench-architecture/SKILL.md](.agents/skills/trpg-workbench-architecture/SKILL.md) 中**增补 Explore** 的分工表：与 Consistency / Rules / Skill 的**区别**（探索 ≠ 审查/规则/写 Skill），并明确 **Explore 非「纯生成型子 Agent」**，不违反「内容由 Director 内化、禁止多生成型子 Agent」的原则。

**A7：散落 prompt 规范化与已迁移文件复查**

1. **`_summarize_dropped_messages`（[chat.py](apps/backend/app/api/chat.py)）**  
   - **现状**：`AsyncOpenAI.chat.completions.create` 的 **system** 内容为**内联中文字符串**（「用一两句中文…概括…」），**未**放在 `app/prompts/` 下，与 **Prompt Registry** 约定不一致。  
   - **M26**：新增如 `app/prompts/chat/summary_system.txt`（或 `_shared/history_summary_system.txt`），经 `load_prompt` 读取；`task_temperature("summary")` 等调用方式**不变**。

2. **PromptProfile 生成（[prompt_profiles.py](apps/backend/app/api/prompt_profiles.py)）**  
   - **现状**：已用 `load_prompt("prompt_profiles", "generate", ...)`，源文件 [generate.txt](apps/backend/app/prompts/prompt_profiles/generate.txt) 为中文、与产品一致。  
   - **M26**：与 A4 一并**通读**：字段说明、输出 JSON 约束是否与前端/解析一致；无需再迁出代码。

3. **TOC 分析（[toc_analyzer.py](apps/backend/app/knowledge/toc_analyzer.py)）— 与 A4 一致：统一中文**  
   - **两套 `load_prompt` 的原因**：**PDF 目录**与 **CHM 目录**是两种结构输入（见 A4），故 **`system`（PDF）** 与 **`chm_classify_system`（CHM）** 两个文件并存，**不是**重复维护同一功能。  
   - **M26**：与 A4 一并完成 **中文化**；**user 侧**内联英文任务句（*Here is the extracted TOC…*、CHM batch 说明）**一并**改为中文，可迁为 `load_prompt("toc_analyzer", "user_pdf", toc_text=...)` / `user_chm` 等（实现者在 PR 中定名），避免代码里留英文长句。

4. **全库再扫（截至当前）**  
   - 通过 `load_prompt(` 引用的入口已覆盖：Director、Rules、Consistency、Skill、prompt_profiles、toc_analyzer。  
   - **仍内联的 LLM 指令**：除 **history 摘要 system** 外，[consistency.py](apps/backend/app/agents/consistency.py) / [skill_agent.py](apps/backend/app/agents/skill_agent.py) 的 **user 任务包裹** 若仍为英文，**纳入 A4 统一中文化**（可迁出到 `prompts` 小模板）。

### B 类：后续扩展（不纳入本 milestone 必交付；由来见下）

- **B1：LLM 用量与耗时落库（`llm_usage_records` 等）**  
  **由来**：规划时的可选项；因系统内**尚无**成体系的 chat 落表（`record_llm_usage` 无调用点），**不纳入**本 milestone。将来若要有，**另开 milestone** 讨论，**不**与 M26 挂钩。

### C 类：明确不承诺

- **不**恢复多 Agent **顺序传稿**的旧主创作链，**不**将 `clarification`/`planning` 接回为默认阶段。
- **不**在缺少强产品决策前删除 **Consistency / Rules / Skill** 子 Agent；本 milestone **以新增 Explore 与修 prompt 为主**，不削弱现有审查/规则/Skill 能力。

---

## 文件结构

### 新增/重点修改

```
apps/backend/app/prompts/explore/system.txt          # 新建
apps/backend/app/agents/explore.py                   # 新建
apps/backend/app/agents/tools.py                     # 只读工具子集/Explore 用注册
apps/backend/app/api/chat.py                          # 按 session.agent_scope 分支
apps/backend/app/prompts/director/system.txt         # 瘦身+边界+ P0
apps/backend/app/prompts/consistency|rules|skill/   # 中文
apps/backend/app/prompts/__init__.py                 # 文档
apps/backend/app/prompts/chat/summary_system.txt   # A7：历史摘要 system（新建）
apps/backend/app/prompts/prompt_profiles/            # A7 复查
apps/backend/app/prompts/toc_analyzer/               # A7 复查
apps/desktop/... (chat 会话创建)                     # agent_scope UI
.agents/skills/...                                    # 分工说明更新
```

---

## 关键设计约束

- Explore **不直接写盘**；若用户从探索会话明确要求「就帮我改掉」，**产品策略**二选一在实现中明确（**引导用户切换到创作会话**，或 **提示将意图再发一条到 Director**）；UI/会话内已有说明即可，**完整 Help 与「写入 Help」留待系统稳定后统一重建**。
- `shared-schema` 与前后端对 `agent_scope` 的枚举若需扩展，**唯一**在 [packages/shared-schema](packages/shared-schema) 中扩展再同步后端/前端。

---

## Todo

> **执行顺序**：先勾选 **阶段 1**（A3、A4 含 A4.2、A5、A7.1、A7.2），再 **阶段 2**（A1、A2），最后 **阶段 3**（A6、A7.3）。详见上文「实施顺序」表。

### A0：计划与路线图

- [x] **A0.1**：本 plan 已存在于 `.agents/plans/m26-explore-prompt-integrity.md`，`roadmap.md` 已追加 M26 节点与「进行中」表行；`README.md` 当前状态已指向 M26 进行中。

### 阶段 1（优先）

### A3：P0 修复

- [ ] **A3.1**：`overall_status` 与 patch/grep 指引已修正。

### A4：统一中文化

- [ ] **A4.1**：Rules / Consistency / Skill 的 `load_prompt` 源文件为中文，解析契约未破坏。
- [ ] **A4.2**：`toc_analyzer/system.txt`（PDF 目录）与 `toc_analyzer/chm_classify_system.txt`（CHM 目录）均已中文化，且与 [toc_analyzer.py](apps/backend/app/knowledge/toc_analyzer.py) 的 JSON 解析仍匹配；**user 任务**英文已清掉或外置中文化。

### A5：死 prompt 与 `__init__`

- [ ] **A5.1**：旧 clarification/planning 已移出热路径；`rag`/`style` 共享件已用或删；`__init__.py` 示例已净化。

### A7：摘要 system 与迁出（阶段 1 子集）

- [ ] **A7.1**：`chat._summarize_dropped_messages` 的 system 文案已迁入 `app/prompts/`，经 `load_prompt` 使用。
- [ ] **A7.2**：`prompt_profiles/generate.txt` 与生成流程已通读，与 A4/解析契约无冲突（或已修正）。

### 阶段 2

### A1：Explore 子 Agent 与会话分支

- [x] **A1.1**：`app/prompts/explore/system.txt` 与 `run_explore_stream` 行为就绪。
- [x] **A1.2**：`chat.py` 中按 `agent_scope` 分支；默认会话行为与现网一致（向后兼容）。
- [x] **A1.3**：前端可创建/展示「探索」与「创作」会话（`agent_scope` 贯通 API）。

### A2：Director 与 Explore 边界

- [x] **A2.1**：`director/system.txt` 与 Explore 无职责重叠的冗长段已收束，并显式引导探索类会话使用 Explore。

### 阶段 3

### A6：技能文档

- [x] **A6.1**：`agent-workflow-patterns` / `trpg-workbench-architecture` 已反映 Explore 与已有子 Agent 关系。

### A7：skill 补充（A7.3）

- [ ] **A7.3**：若需，在 [pdf-knowledge-ingestion/SKILL.md](.agents/skills/pdf-knowledge-ingestion/SKILL.md) 增加一句「`system` = PDF 目录 / `chm_classify_system` = CHM 目录」。

---

## 验收标准

1. 创建 **agent_scope=explore** 的会话时，流式端点**只**调用 Explore 流式方法，**不应**出现写资产类工具调用；创建默认/创作类会话时行为与 M25 前**一致**（无回归）。
2. `director/system` 中关于 `check_consistency` 状态的描述与 Consistency 实际 JSON 与 TS 类型**一致**。
3. 探索会话中，用户可仅通过对话与只读工具完成「列举/搜索/按章节阅读工作区资产」的闭环；**Session / Agent 面板**已有**探索不写盘**与切回创作之提示即可；**内建 Help 文档不强制本 milestone 更新**（见上）。
4. 仓库内**不再**在热路径保留未使用的 clarification/planning 而无说明；`prompts/__init__.py` **无**对不存在路径的示例。
5. `agent-workflow-patterns` 中 M20 子 Agent 表**包含 Explore**，并说明其与 Rules/Consistency/Skill 的分工，且**不**与已否定的旧顺序多 Agent 链混淆。
6. 聊天**历史截断摘要**的 system 内容**仅**来自 `app/prompts/`（满足 A7.1），无与此重复的内联长文案。
7. `prompt_profiles/generate` 已按 A7.2 复查；**TOC 中文化与双格式说明** 以 **A4.2** 与 A7.3（skill 一句）为准。

---

## 与其他里程碑的关系

```
M25（LLM Profile 与聊天基础）
  └── M26（本 milestone：Explore + prompt 体系统一）
        └── 后续可接：B1 全链路 usage、benchmark 等（另 milestone）
```

---

## 非目标

- 不实现**全新**的 Plot/NPC/Monster 等独立**生成**子 Agent（与 M20 技能原则一致）；Explore 仅**只读探索**。
- 不将本 milestone 与「旧 M10 顺序阶段 Director」混为一谈；**不**以 clar/plan 文件接回为交付内容。
- **不**在本 milestone 对内建 **Help**（`apps/desktop/src/help/` 等）做体系化补全或重排；等核心流程与 copy 再成熟一轮后，**再单独开迭代统一重建** Help，避免与仍在演进的 Agent/知识库能力重复劳动。

---

## 来源（可选同步）

- 本 plan 可引用会话内 System Prompt 审计与 `.cursor/plans` 中 System Prompt 审计 plan；若之后写入 `docs/benchmark-reviews/`，可将对应 proposal 移入 `accepted/` 并在本文件「背景与动机」增加链接（按 milestone-management Step 4b 执行）。
