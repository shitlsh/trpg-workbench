---
status: accepted
date: 2026-04-27
source: Internal (post-M26 agent capabilities discussion; benchmark review pattern)
theme: Agent 与工作区文件 — 是否引入通用命令行 / CLI 能力
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: structured_tools_via_m27
milestone_plan: .agents/plans/m27-asset-ops-and-batch.md
---

# Agent 通用 CLI / 命令执行能力（工作区内）

## 产品决策

**不**默认提供通用可变的 shell/CLI 工具；**采用**结构化工具补足 **移动 / 删除** 与 **批处理（含 preview）**，工程落地见计划 **[M27：资产单步操作与批处理](https://github.com/tailongshi/Projects/blob/master/.agents/plans/m27-asset-ops-and-batch.md)**（仓库内路径：`.agents/plans/m27-asset-ops-and-batch.md`）。

> 注：上链接若 fork 后路径不同，以仓库中 `.agents/plans/m27-asset-ops-and-batch.md` 为准。

---

## 背景

trpg-workbench 的 Director 通过 **tool-calling** 操作工作区：读资产、语义搜索、`patch_asset` 等。资产文件在**本机工作区目录**中真实存在，与「纯云文档」不同，理论上可用 **移动、批量替换、管道** 等 shell 工作流一次完成复杂整理。

**问题**：是否应引入**通用「执行命令行」类工具**（或等价能力），让模型像本地 coding agent 一样调用 `mv`/`rg`/`sed` 等，从而**少扩展专用工具**？

本文给出可选方案、**推荐路线**、以及**强烈不建议**的默认能力边界。

## 与对标参考的关系

| 参考 | 相关性 | 本 proposal 的立场 |
|------|--------|-------------------|
| **OpenCode / Cursor 类 coding agent** | 普遍提供 **Terminal / run command**，用户心智是「在代码仓里改文件」 | TRPG 工作区**不是**通用代码仓；创作资产需 **可审计、可 revision、与规则一致**，不能默认等同 coding 终端。 |
| **Inscriptor 等创作 workspace** | 强调**结构化内容**与受控编辑，而非任意文件系统操作 | 更贴近 **专用编辑动作** 而非开放 shell。 |
| **OpenPawz 本地优先** | 能力边界、用户可感知状态 | 若引入「跑命令」，必须在 UI 中可解释（跑了什么、影响了哪些文件）。 |

结论：**不**以「和 coding agent 对齐终端能力」为默认目标；以 **file-first + 可审计** 为优先。

## 需求陈述（真实痛点）

- 批量重命名、跨多个 `.md` 的批量替换、复杂过滤，**专用工具**若未覆盖，模型只能多次 `patch_asset` 或反复 `grep_asset`，**token/轮次**成本高。
- 用户清楚风险时，可能希望**一行命令**解决问题。

## 方案谱系

### A. 完全开放的 shell（`subprocess` + 用户工作区为 `cwd`）

- **实现**：依赖仅 Python 标准库；无「魔法安全库」。
- **风险**：与当前系统用户、本机环境**同权限**；提示词注入可导向读写工作区外路径、读环境变量、网络调用等。**Explore 只读**与**任意写命令**在概念上冲突。
- **结论**：**默认不推荐**作为产品化能力；若存在，必须**独立高风险开关** + 强提示，且不宜作为「省工具」的默认路径。

### B. 白名单 / 只读 CLI 包装

- **实现**：仅允许例如 `rg` / `fd` / `git status` 等固定可执行名 + 参数校验 + `cwd` 锁在工作区根 + `timeout` + 无 `shell=True`（或极窄场景）。
- **价值**：补全「全库 grep、列文件」而**不**把 `rm`/`curl` 交给模型。
- **与现有能力**：已存在 `grep_asset`、`search_assets`；全工作区只读搜索更贴近**专用 API** 或**受控 rg**，而非开放 shell。

### C. 结构化批处理工具（推荐的核心增量）— **已接受**

- **实现**：例如 `bulk_find_replace`（先 **dry-run 预览** diff → 用户确认 → 执行）、`move_asset` / `rename_slug` 等，内部可用 `pathlib` 或一次 `subprocess` 调 `rg` **只读**。
- **价值**：行为可测、可记 revision、可在 Agent 面板展示**结构化结果**；**不**重复造「整个 shell」，只造「高频批量操作」的薄封装。
- **与已有 proposal**：同目录下已有 `batch-asset-write` 等 completed 项，**方向一致**。

### D. 脚本 / 宏 + 显式确认

- **实现**：模型生成**小脚本**或步骤列表（或限定 `python -c` 只调用你们封装的 **Workspace API**），**用户点击执行**后再落盘。
- **价值**：复杂操作仍可比「无限扩工具」省力，且保留**人类闸门**。

## 推荐结论（可执行、相对稳妥）

1. **默认不增加「通用执行任意 shell 命令」的 Agent 工具**（理由：安全面、可审计性、与 file-first/Explore 边界冲突；无行业现成「零配置又安全」的依赖可替代你们自己的策略）。
2. **优先**在需要时 **扩展结构化工具**（批处理、移动、带预览的批量替换），与现有 `patch_asset` / `check_consistency` 流程一致。参见已归档的 batch / patch 类 completed proposals。
3. **可选的中期能力**（单独 milestone 设计）：**受控只读**包装（如工作区内 `rg` 结果供模型消费）+ **受控写**仅通过**带预览的批处理 API**，仍**不**暴露通用 shell。
4. 若产品明确面向「高级用户 / 自承风险」：**用户级**「允许在工作区执行已审核命令列表」或 **Tauri 侧**二次确认，**不作为** Director 默认可用工具。

## 对创作控制感与协同的影响

- **开放 shell**：短期爽、长期**难解释、难回放**，削弱「创作控制感」。
- **结构化批处理 + 确认**：与「信任模式 / patch 确认」家族一致，**更利于** workbench 协同叙事。

## 与 M26 Explore 的约束

- **Explore** 为只读；任何「写盘命令」工具**不得**出现在 Explore 工具集。若未来有「只读 `rg`」，可仅挂 Explore；写操作仅 Director（或显式模式）。

## 建议的后续动作

| 动作 | 说明 |
|------|------|
| `proposed` → `accepted` | ✅ 已接受：不默认可变 shell、优先结构化批处理；见 M27 计划。 |
| 新 milestone | ✅ M27 承担：删除/移动 + 批处理 preview/apply（见上链接）。 |

## 参考链接（实现层）

- Python `subprocess` 最佳实践：避免无界 `shell=True`、设置 `cwd` / `timeout` / 最小环境
- 项目内相关：`apps/backend/app/agents/tools.py`（工具边界）、`docs/benchmark-reviews/completed/2026-04-26_batch-asset-write.md`（批写方向已有讨论基础）

---

**一句话**：**不推荐**把「通用 CLI」作为省工具量的默认手段；**推荐**用**结构化批处理 + 预览/确认**与**有限只读 CLI 包装**覆盖高频 pain，与 trpg-workbench 的 file-first、可审计、Explore 分流的架构一致。  
**工程落地**：[M27 资产单步操作与批处理](../../.agents/plans/m27-asset-ops-and-batch.md)（以仓库内该文件为准）。



I need to fix the accepted file - remove the broken github links and use clean relative path only. Remove the "raw.githubusercontent" garbage at the end



StrReplace