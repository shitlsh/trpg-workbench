# M27：资产单步操作与批处理（结构化工具）

**前置条件**：M26 完成（Explore 与 prompt 体系统一已归档）。

**目标**：在**不引入通用 shell / 任意 CLI** 的前提下，用**结构化、可审计**的 Agent 工具补上 **移动 / 删除** 等当前 Director 无法直接表达的能力，并提供 **批量化** 能力（减少多轮 `patch_asset` 与 token 消耗），与 [benchmark：Agent CLI 取舍](../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md) 中 **方案 C** 一致。

---

## 背景与动机

- HTTP 层已有资产 [删除](apps/backend/app/api/assets.py) 等能力，**Agent 工具集**中仍缺少对等的 `delete` / `move` 等，模型只能多轮绕路，**效率与 token** 差。
- 用户已审阅 [2026-04-27 agent CLI proposal](../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md)：**不采用**开放命令行，**采用**结构化批处理；本 milestone 为该决策的**工程落地**。
- 与已完成 [batch-asset-write](../docs/benchmark-reviews/completed/2026-04-26_batch-asset-write.md) 相区别：后者解决的是 **连续单资产写入不中断**；**未**从协议上把「N 个新建」收束为**单次工具调用**，因此一话生成十几个 asset 仍是 **N 次 `create_asset`**，与随后 **M 次 `patch_asset`** 的 **模型往返与上下文膨胀** 问题，需在本 milestone 的 **A4** 中单独解决。
- 用户核心场景：故事驱动 **批量新建** 与 **小范围多资产改细节**；倾向 CLI 的动机是 **脚本一次编排**——本处用 **结构化批工具** 达到「一轮工具调用提交多项」的等效，**不**用任意 shell。

---

## 实现手段（技术基线，开发必须遵守）

以下均基于**现有写路径**扩展，**禁止**为批处理平行实现第二套落盘逻辑。

| 能力 | 实现手段 | 说明 |
|------|----------|------|
| 单次落盘、索引、revision | 已存在 | [`execute_patch_proposal`](apps/backend/app/agents/tools.py)：`action` 为 `create` / `update` 时与 HTTP/API 及 file-first 约定一致。 |
| **批创建** `create_assets`（名可定） | 新 `@tool` + **Python 循环** | 入参为 **一个 JSON 字符串**（或 Agno 支持的等效结构），解析为 `List[{asset_type, name, content_md, change_summary?}, ...]`。**每一项**在进程内顺序调用与 `create_asset` **相同** 的 `proposal` 拼法 + `execute_patch_proposal(..., action=create)`。一次工具返回中输出 **`results: [{index, success, slug?, asset_id?, error?}, ...]`**；**部分失败**是否继续余项由实现时定稿（建议继续并带 `partial: true`）。**不**依赖 subprocess。 |
| **批局替** `patch_assets`（名可定） | 新 `@tool` + 循环 | 入参为 JSON 数组 `[{asset_slug, old_str, new_str, change_summary?}, ...]`。**每一项**复刻当前 `patch_asset` 的：读文件 → 唯一性校验 → 替换 1 处 → `execute_patch_proposal`（`update`）。同一次性返回 `results` 表。 |
| **批删** `delete_assets`（名可定） | 新 `@tool` + 循环 | 入参为 JSON 数组（`asset_slug` 或 `asset_id` 列表，与单删字段对齐）。**每一项**调用与单资产 **删除** 相同的底层逻辑（与 [DELETE /assets](apps/backend/app/api/assets.py) / `asset_service` 一致），**不**重复造删文件语义。一次返回 `results: [{index, success, error?}, ...]`；部分失败是否继续余项实现时定稿。 |
| **批移** `move_assets`（名可定） | 新 `@tool` + 循环 | 入参为 `[{from_slug, to_slug?, to_type?}, ...]`（与 **A1.2 单移** 参数对齐）。每项顺序执行单移路径，返回 `results` 表；与单移同**引用/跨链接**限制说明。 |
| **跨资产统一文本替换**（A2.1） | 可 **先** 只读扫（`Path.walk` + 读 `*.md` 或白名单内 `subprocess` 只读 `rg` 列文件）得候选 slug，再 **preview** JSON；**apply** 时或复用与单文件相同的 `patch_asset` 逻辑，或走 `patch_assets` 多行入参。 | 禁止对用户传入整段内容执行 `shell=True`。 |
| **多轮后 snapshot** | 批创建若在同一 Director 步内还有后续 tool，需谨慎：`existing_assets` 可能来自本请求开始时的快照；**实现时**在批写工具**末尾**触发一次与工作区一致的 **列表刷新**（如复用与 `list_assets` 同源的数据，或写清文档要求模型**下一步先 `list_assets`**）。此条以 PR 中具体实现为准，须在返回 JSON 中提示若需要。 | 避免「刚建的 slug 同一轮里搜不到」类 bug。 |
| **check_consistency** | 批写 **是否**每项前调用由产品定：默认可 **不要求** 每项都跑（防 token 爆）；**建议** 在 `director/system` 中约定「批量同主题创建可事后审查」等，与现有 P0 文案对齐。 | 与 A4 批建配套 |

**为何能减 token 与轮次**：模型从「调 10 次 `create_asset`」变为「调 1 次 `create_assets` 带 10 条 spec」，**少 9 次**「assistant 声明 tool + tool_result 再进下文」的往返；批 patch、**批删、批移** 同理。单条 spec 与结果仍在上下文中，总字符未必等比例下降，**主要省的是工具协议往返与可调度的轮数**。

---

## 范围声明

### A 类：本 milestone 必须完成

**A1：单资产与批量 — 移动 / 重命名、删除（Director 工具）**

**单条**

- **移动 / 重命名**（可合并为同一工具或分两参数）：在**工作区内**将资产改 slug / 改路径，同步移动 `{type}/{slug}.md`（及 JSON 若存在）、更新 ORM 与 file_path、**维护 revision 与引用完整性**；禁止移到工作区外。
- **删除**：与现有 API 语义对齐（**硬删文件** + 索引标记 `deleted` 等，以现网 `delete_asset` 行为为准），通过工具返回结构化 JSON，便于 Agent 与 `check_consistency` 后续衔接（若适用）。

**批量（与 A4 的 create/patch 并列，同「一次 tool、多项、results 表」）**

- **批删** `delete_assets`：入参为 slug/id 的 JSON 数组，**内层语义与单删相同**，见上文 **实现手段** 表；**必须** A 类完成。
- **批移** `move_assets`：入参为多条移动项的 JSON 数组，**与单条 `move_asset` 同参语义**，见上文表；**必须** A 类完成（在 **A1.2 单移** 已实现或可复用之后实现）。

- **注册**：`ALL_TOOLS` 与 Director `system` 提示中的工具表同步；**Explore 不包含**写删移及任一批量写删移（与 M26 一致）。

**A2：批处理 — 减 token 的结构化能力**

- **跨资产查找 / 替换**（建议优先）：参数包括工作区、过滤条件（如 `asset_type`、名称 glob 或 `grep_asset` 式子集）、`old_str` / `new_str` 或正则策略（**实现时二选一定稿**）、**先 preview**（返回将影响的 `slug` 列表 + 每文件命中数或短 diff 摘要）再 **apply**；apply 时仍走**逐文件** revision，便于回溯。
- **可选（资源允许时）**：批量**重命名 slug**（规则表达到 preview → apply）、或「按 list 移动目录 / 子类型」等；以 **A2.1 查找替换** 为**必须**，其余为**加分项**并在 Todo 中单独勾选。

**A3：产品化底线**

- 对 **A2.1 跨资产替换** 等会改多个文件的：**apply 前**须有可展示给用户的 **preview**（与前端对仗）。
- 对 **A4 批建**：至少返回**逐条 `results`** 表；是否增加 **dry_run 预检** 在 Todo 可选。
- **不**使用 `subprocess` 调用户任意 shell 字符串；若内部用 `rg` 等，仅允许**白名单、固定参数**、工作区为根。

**A4：多资产批创建与批局替**（对齐全景「一话十几个 asset + 多文件小改」）

- **A4.1 批创建**：`create_assets` — 实现见上文 **实现手段** 表；与单次 `create_asset` 同 `proposal` / `execute_patch_proposal` 路径。
- **A4.2 批局替**：`patch_assets` — 实现见上文表；与单次 `patch_asset` 同一**单文件、单处**替换规则。
- **A4.3** Director 提示：多资产新建/多 slug 小改**优先**批工具；`system` 中写清与 **snapshot**、**check_consistency** 的软约束（见上表末行）。

### B 类：后续 / 不强制本 milestone

- **B1：回收站 / 软删除**若与现网「硬删」冲突，可另开讨论；本 milestone 以**对齐当前 API 行为**为主。
- **B2：全工作区只读 `rg` 作为独立工具**：若 A2.1 已覆盖「跨文件查找」，可推迟。

### C 类：明确不承诺

- **不**提供通用 `run_shell` / `run_terminal` / 任意 CLI。
- **不**在 Explore 会话中开放任何写盘批处理（仅 Director 或显式未来「创作模式」工具集）。

---

## 文件与模块（预期）

```
apps/backend/app/services/asset_service.py   # 移动/删；若有共享「单条 create/update」可抽给批工具
apps/backend/app/agents/tools.py             # create_assets / patch_assets / delete(s) / move(s) + execute_patch_proposal 复用
apps/backend/app/prompts/director/system.txt  # 批工具优先、check_consistency 与批的关系
apps/desktop/...（可选：批量结果表格/折叠展示）
packages/shared-schema/...（若 tool 的 JSON 形状需前后端共类型）
```

---

## 关键设计约束

- **file-first**：落盘、`.trpg/cache`、revision 与 [asset-schema-authoring](.agents/skills/asset-schema-authoring/SKILL.md) 一致。
- **工作区根锁定**：所有路径解析经既有 `workspace_path`，禁止 `..` 逃逸。
- 批量 **apply** 可内部循环调用与 `patch_asset` 相同底层写入，以保证 **单文件 revision** 与一致性。

---

## Todo

### A1：单资产

- [x] **A1.1**：`delete_asset` 或 `remove_asset` 工具：参数 `asset_slug` 或 `asset_id`，行为与 `DELETE /assets/{id}` 一致；返回 JSON 摘要。
- [x] **A1.2**：`move_asset` 或 `rename_asset` 工具：源 slug → 目标 slug 或目标类型+slug；更新文件与 DB；文档化对跨资产引用的影响（若无法自动更新，在返回中提示或限制）。
- [x] **A1.3**：`director/system.txt` 工具列表与**写入前** `check_consistency` 的说明更新（若删除/移动也要求先检查，则写明）。
- [x] **A1.4**：`delete_assets`：JSON 数组，内层与单删一致；循环复用现网删除逻辑；`results` 表；见「实现手段」表。
- [x] **A1.5**：`move_assets`：JSON 数组，与 **A1.2** 单移同参；循环 + `results` 表；依赖 A1.2 单移路径可用。

### A2：批处理（跨库文本）

- [x] **A2.1**：`preview_bulk_text_replace`（名可定）+ `apply_bulk_text_replace`（或合并为两阶段单工具 + `confirm` 参数，实现时定稿），必须含 **preview 输出**。
- [ ] **A2.2**（可选）：批量 slug 重命名或批量「同类型下移动」。

### A4：多资产批创建与批局替

- [x] **A4.1**：`create_assets`：JSON 数组，内层字段对齐 `create_asset`；内部循环 `execute_patch_proposal`；见上文「实现手段」表。
- [x] **A4.2**：`patch_assets`：JSON 数组，内层字段对齐 `patch_asset` 单次语义；见上文「实现手段」表。
- [x] **A4.3**：`director/system.txt` 补充批工具**优先**与**何时仍用单工具**的说明；批写后 **snapshot** 与后续轮行为见实现手段中「多轮后 snapshot」。

### A3：联调

- [x] **A3.1**：`ALL_TOOLS` 与 **EXPLORE_TOOLS** 显式对比文档或注释，确保 Explore 无 A1（含**批删/批移**）/A2/**A4** 写能力。

---

## 验收标准

1. Director 在**不显式**多轮 `patch` 的情况下，能用语义清晰的工具**删除**、**移动/重命名** 指定资产，且工作区与 DB 状态一致、文件真实存在/删除。
2. **A1 批量**：`delete_assets` / `move_assets` 各能 **一次工具调用**处理多项（与连调多次单删/单移相比，**round-trip 次数** 减少），且 `results` 逐条可辨；批移在单移语义稳定后验收。
3. 至少一种 **批处理** 能力（以 **跨资产文本替换** 为优先）支持 **先 preview 再 apply**（A2.1），单轮或两轮工具调用可完成「多文件同一替换」类任务，相较纯多次 `patch_asset` **可观测地**减少轮次与重复。
4. **A4**：可用 **一次** `create_assets` 提交**多项**创建；可用 **一次** `patch_assets` 对多个 slug 做局替。实现须复用 `execute_patch_proposal`，**验收**时对比 **round-trip 次数** 少于单条工具累加（不要求总 token 数学最优）。
5. 与 benchmark [accepted/2026-04-27_agent-cli-workspace-commands.md](../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md) 的「不默认可变 shell、结构化批处理」**一致**；代码审查中**无**对用户字符串直接 `shell=True` 的调用。
6. Explore 会话**不能**通过工具完成写删或批量改（用工具列表或 E2E 自测可证）。

---

## 与其他里程碑的关系

```
M26（Explore + prompt 体系统一）✅
  └── M27（本 milestone：资产操作 + 批处理工具）
        └── 后续：B1 用量落库、回收站等视反馈另列
```

---

## 非目标

- 通用终端、MCP 式「任意命令」。
- 在资产仍简单时，为「万能批处理」一次性实现全部业界编辑器功能；**优先**删除/移动 + 一批量替换 **MVP**。
