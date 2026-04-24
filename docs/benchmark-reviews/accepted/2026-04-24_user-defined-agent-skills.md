---
status: accepted
date: 2026-04-24
source: 用户需求 + .agents/skills/ 机制参照
theme: Workspace Skill 框架——用户可发现、可加载的 Agent 扩展机制
priority: high
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: plan
milestone: M17
---

# Workspace Skill 框架——让 Agent 可扩展、可发现、用户可定义

## 来源与借鉴理由

用户提出：希望 trpg-workbench 允许用户在工作区中添加自定义 skill，Agent 能够发现并在合适时
机加载执行。这是 workbench 可扩展性的核心基础设施需求，与"创作控制感"直接相关。

参考：当前 `.agents/skills/` 目录已经实现了这套机制——Skill 是带有 YAML frontmatter 的
Markdown 文件，包含 `name + description`（用于发现）和正文指令（用于执行）。Agent 读取可
用 skill 列表，根据 description 判断是否加载，按需执行。这个模式成熟、清晰，可以直接移植
到 trpg-workbench 的 workspace 层。

---

## 原始认知偏差与修正

**原始 review（第一版）的错误假设：**

第一版将 AgentSkill 定义为"prompt patch DB 表"——用户写一段文字，后端硬编码路由到对应
agent_type 注入。这个实现能解决"重复说明创作要求"的痛点，但存在根本缺陷：

- 是封闭结构——skill 只能是文字，无法承载脚本、工具调用等未来能力
- 不可发现——路由是硬编码的，不是 Agent 自己判断
- 不可共享——DB 行无法像文件一样被复制、分发、版本化
- 命名借用了行业通用词"Skill"，但实现与 Coze/Dify 等平台的 Skill 概念完全不同，
  造成预期偏差

**修正后的定位：**

Skill 不是"prompt patch 的持久化"，而是 **workspace 级别的 Agent 扩展单元**。它的核心
价值不在于某一条具体指令的内容，而在于**发现和加载框架**——这决定了 trpg-workbench 未来
的可扩展边界。

---

## 核心概念（修正后）

### Skill 是什么

Skill = 一个 Markdown 文件，放在 workspace 的 `skills/` 目录下：

```
workspace-data/{workspace_id}/skills/
  coc-npc-framework.md
  dnd-monster-cr.md
  plot-rhythm-coc.md
```

每个文件结构：

```markdown
---
name: coc-npc-framework
description: CoC 7e NPC 创作框架。当创作任何 NPC 时自动应用，确保包含神话接触程度、
             职业背景、心理稳定性、线索载体角色等 CoC 场景必要维度。
agent_types: [npc]   # 适用的 agent 类型；留空表示所有创作型 Agent
enabled: true
---

在创作 NPC 时，必须包含以下维度：
- 职业：NPC 在 1920s 社会中扮演的角色
- 神话接触程度：无 / 轻微（听说过传言）/ 深度（亲历或研究过）
- 心理稳定性：正常 / 不稳定（曾受冲击）/ 已崩溃（无法正常行事）
- 作为线索载体：此 NPC 能揭示哪条调查线索（可为空，表示纯背景角色）
```

### 发现机制

Workflow 启动时扫描 `skills/` 目录，收集所有已启用 skill 的 `name + description`，
注入 workspace_context。Director Agent 和专项 Agent 据此感知当前工作区有哪些 skill。

### 加载机制

专项 Agent（NPC/Monster/Plot/Lore 等）调用前，Workflow 查找 `agent_types` 匹配的 skill，
加载其完整正文内容，注入 task prompt。

### 与 PromptProfile 的层次关系

```
Agent System Prompt        （roles/rules，全局，开发者维护）
  + style_prompt            （PromptProfile，RuleSet 级，风格约束）
  + skill content           （Workspace Skill，Workspace 级，扩展指令）  ← M17 新增
  + task_prompt             （运行时任务描述）
  + knowledge_context       （RAG，运行时动态）
```

### 与 PromptProfile 的本质区别

| 维度 | PromptProfile | Workspace Skill |
|-----|--------------|----------------|
| 粒度 | RuleSet 级，全局生效 | Workspace 级，per-agent 按需加载 |
| 存储形式 | DB 字段 | 文件（Markdown） |
| 内容类型 | 纯文字风格约束 | 当前：指令；未来：可包含工具定义、脚本 |
| 发现方式 | 硬绑定（有 rule_set_id 就注入） | 声明式（Agent 根据 description 匹配） |
| 可扩展性 | 封闭 | 开放（文件格式决定上限） |

---

## 用户场景示例

**场景 A：CoC 用户为 NPC Agent 定义调查员框架**（约束型 skill）

创建文件 `coc-npc-framework.md`，`agent_types: [npc]`，正文包含神话接触程度等维度要求。
此后每次调用 NPC Agent，这个框架自动应用，用户不必每次在对话中重复。

**场景 B：D&D 用户为 Monster Agent 定义战斗设计框架**（约束型 skill）

创建文件 `dnd-monster-cr.md`，`agent_types: [monster]`，正文包含 CR 估算、动作经济等。

**场景 C：社区用户分享一个"怪物文字描述→配图"skill**（未来能力型 skill，M17 框架支撑，
具体工具定义在 B 类扩展中）

用户下载 `monster-image-gen.md`，放入 workspace skills 目录，Workflow 即可发现并在
Monster Agent 完成文字生成后调用图像生成工具。**M17 建立的文件框架让这个 skill 能被
加载——工具调用能力本身是 skill 自己定义的，不需要改 Workflow 核心逻辑。**

---

## 为什么文件比 DB 行更合适

1. **可移植**：skill 文件可以复制、分享、版本化，DB 行不能
2. **自描述**：文件包含所有元数据，无需额外查询
3. **可扩展**：未来在 frontmatter 中加 `tools:` 字段即可支持工具型 skill，
   不需要改数据库 schema
4. **与现有 `.agents/skills/` 完全一致**：用户和开发者已经理解这套机制

---

## 适合性判断

**结论：纳入 M17，作为 1.0 前的可扩展性基础设施。**

1.0 阶段只需支持约束型 skill（正文为 Markdown 指令），但文件格式和加载框架按
"未来能力型 skill"的需求设计，留好 frontmatter 扩展槽位。

---

## 对创作控制感的影响

**直接正向，且具有长期价值。** 用户不仅能设定当次创作的要求，还能持久化自己对 Agent
行为的期望，并在未来从社区获取他人积累的创作框架。这是"工具属于我"的体验升级。

## 对 workbench 协同的影响

**间接改善。** skill 在后台发现和加载，不占用 Agent 面板的交互空间，但因为生成结果
更贴合预期，减少"生成→大量修改→重试"的循环。

## 对 1.0 用户价值的影响

**中到高。** 框架本身的价值不取决于 skill 数量，第一个 CoC NPC 约束 skill 上线即可
让用户感受到差异。同时为 1.x 的社区 skill 生态打好地基。

---

## 建议落地方式

- [x] **纳入 M17**：Workspace Skill 加载框架
  - 后端：skill 文件 CRUD API + Workflow 发现/注入逻辑（~1.5 天）
  - 前端：工作区设置页 skill 管理 UI（~1 天）
  - 帮助文档：skill 是什么、如何写、CoC 示例（~0.5 天）

## 不做的理由（已被采纳，此项不适用）
