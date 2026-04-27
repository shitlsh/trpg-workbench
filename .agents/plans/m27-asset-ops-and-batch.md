# M27：资产单步操作与批处理（结构化工具）

**前置条件**：M26 完成（Explore 与 prompt 体系统一已归档）。

**目标**：在**不引入通用 shell / 任意 CLI** 的前提下，用**结构化、可审计**的 Agent 工具补上 **移动 / 删除** 等当前 Director 无法直接表达的能力，并提供 **批量化** 能力（减少多轮 `patch_asset` 与 token 消耗），与 [benchmark：Agent CLI 取舍](../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md) 中 **方案 C** 一致。

---

## 背景与动机

- HTTP 层已有资产 [删除](apps/backend/app/api/assets.py) 等能力，**Agent 工具集**中仍缺少对等的 `delete` / `move` 等，模型只能多轮绕路，**效率与 token** 差。
- 用户已审阅 [2026-04-27 agent CLI proposal](../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md)：**不采用**开放命令行，**采用**结构化批处理；本 milestone 为该决策的**工程落地**。
- 与已完成 [batch-asset-write](docs/benchmark-reviews/completed/2026-04-26_batch-asset-write.md) 相区别：后者解决的是 **连续写入不中断**；本 milestone 解决的是 **单步文件级操作** 与 **跨多资产的批量转换**，仍通过**专用工具**完成，而非 7–8 次独立小工具调用的堆叠。

---

## 范围声明

### A 类：本 milestone 必须完成

**A1：单资产 — 移动 / 重命名、删除（Director 工具）**

- **移动 / 重命名**（可合并为同一工具或分两参数）：在**工作区内**将资产改 slug / 改路径，同步移动 `{type}/{slug}.md`（及 JSON 若存在）、更新 ORM 与 file_path、**维护 revision 与引用完整性**；禁止移到工作区外。
- **删除**：与现有 API 语义对齐（**硬删文件** + 索引标记 `deleted` 等，以现网 `delete_asset` 行为为准），通过工具返回结构化 JSON，便于 Agent 与 `check_consistency` 后续衔接（若适用）。
- **注册**：`ALL_TOOLS` 与 Director `system` 提示中的工具表同步；**Explore 不包含**写删移动（与 M26 一致）。

**A2：批处理 — 减 token 的结构化能力**

- **跨资产查找 / 替换**（建议优先）：参数包括工作区、过滤条件（如 `asset_type`、名称 glob 或 `grep_asset` 式子集）、`old_str` / `new_str` 或正则策略（**实现时二选一定稿**）、**先 preview**（返回将影响的 `slug` 列表 + 每文件命中数或短 diff 摘要）再 **apply**；apply 时仍走**逐文件** revision，便于回溯。
- **可选（资源允许时）**：批量**重命名 slug**（规则表达到 preview → apply）、或「按 list 移动目录 / 子类型」等；以 **A2.1 查找替换** 为**必须**，其余为**加分项**并在 Todo 中单独勾选。

**A3：产品化底线**

- 任一批量 **apply 前**须有可展示给用户的 **preview 结果**（Agent 流式中可用 tool 结果 JSON 或专用事件，具体与前端对仗）。
- **不**使用 `subprocess` 调用户任意 shell 字符串；若内部用 `rg` 等，仅允许**白名单、固定参数**、工作区为根。

### B 类：后续 / 不强制本 milestone

- **B1：回收站 / 软删除**若与现网「硬删」冲突，可另开讨论；本 milestone 以**对齐当前 API 行为**为主。
- **B2：全工作区只读 `rg` 作为独立工具**：若 A2.1 已覆盖「跨文件查找」，可推迟。

### C 类：明确不承诺

- **不**提供通用 `run_shell` / `run_terminal` / 任意 CLI。
- **不**在 Explore 会话中开放任何写盘批处理（仅 Director 或显式未来「创作模式」工具集）。

---

## 文件与模块（预期）

```
apps/backend/app/services/asset_service.py   # 移动/删逻辑复用或抽函数
apps/backend/app/agents/tools.py             # 新工具注册
apps/backend/app/prompts/director/system.txt  # 工具说明与顺序约束
apps/desktop/...（可选：批量结果展示）
packages/shared-schema/...（若 API 有新增类型）
```

---

## 关键设计约束

- **file-first**：落盘、`.trpg/cache`、revision 与 [asset-schema-authoring](.agents/skills/asset-schema-authoring/SKILL.md) 一致。
- **工作区根锁定**：所有路径解析经既有 `workspace_path`，禁止 `..` 逃逸。
- 批量 **apply** 可内部循环调用与 `patch_asset` 相同底层写入，以保证 **单文件 revision** 与一致性。

---

## Todo

### A1：单资产

- [ ] **A1.1**：`delete_asset` 或 `remove_asset` 工具：参数 `asset_slug` 或 `asset_id`，行为与 `DELETE /assets/{id}` 一致；返回 JSON 摘要。
- [ ] **A1.2**：`move_asset` 或 `rename_asset` 工具：源 slug → 目标 slug 或目标类型+slug；更新文件与 DB；文档化对跨资产引用的影响（若无法自动更新，在返回中提示或限制）。
- [ ] **A1.3**：`director/system.txt` 工具列表与**写入前** `check_consistency` 的说明更新（若删除/移动也要求先检查，则写明）。

### A2：批处理

- [ ] **A2.1**：`preview_bulk_text_replace`（名可定）+ `apply_bulk_text_replace`（或合并为两阶段单工具 + `confirm` 参数，实现时定稿），必须含 **preview 输出**。
- [ ] **A2.2**（可选）：批量 slug 重命名或批量「同类型下移动」。

### A3：联调

- [ ] **A3.1**：`ALL_TOOLS` 与 **EXPLORE_TOOLS** 显式对比文档或注释，确保 Explore 无 A1/A2 写能力。

---

## 验收标准

1. Director 在**不显式**多轮 `patch` 的情况下，能用语义清晰的工具**删除**、**移动/重命名** 指定资产，且工作区与 DB 状态一致、文件真实存在/删除。
2. 至少一种 **批处理** 能力（以 **跨资产文本替换** 为优先）支持 **先 preview 再 apply**，单轮或两轮工具调用可完成「多文件同一替换」类任务，相较纯多次 `patch_asset` **可观测地**减少轮次与重复。
3. 与 benchmark [accepted/2026-04-27_agent-cli-workspace-commands.md](../docs/benchmark-reviews/accepted/2026-04-27_agent-cli-workspace-commands.md) 的「不默认可变 shell、结构化批处理」**一致**；代码审查中**无**对用户字符串直接 `shell=True` 的调用。
4. Explore 会话**不能**通过工具完成写删或批量改（用工具列表或 E2E 自测可证）。

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
