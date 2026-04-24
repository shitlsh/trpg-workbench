---
status: proposed
date: 2026-04-24
source: agent-workflow-patterns skill + TRPG 系统分析
theme: Agent Skills 基础机制——用户自定义 per-Agent 创作指令
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: plan
---

# 用户自定义 Agent Skill——让创作者掌控每个 Agent 的创作框架

## 来源与借鉴理由

用户提出：希望 trpg-workbench 允许用户**自己定义 skill**，而不只是依靠系统预设的 Agent 能力。
这是对"创作控制感"的直接延伸——用户不仅控制最终资产内容，也控制 Agent 以什么方式、
什么框架去生成内容。

当前机制中最接近的是 `PromptProfile`（已实现），它允许用户编写全局风格提示词，
注入所有创作型 Agent。Skill 是 PromptProfile 的**精细化版本**：
粒度从"所有 Agent 共享一份风格"，变为"每个 Agent 可以有独立的创作框架指令"。

---

## 核心概念

**Agent Skill** = 用户为某个 Agent 类型编写的**创作框架补丁**，
与当前工作区（或 RuleSet）绑定，在 Agent 执行前注入 user prompt。

### 与现有机制的层次关系

```
Agent System Prompt         （roles/rules，全局，开发者维护）
  + style_prompt             （PromptProfile，RuleSet 级，用户可编辑，风格约束）
  + skill patch              （AgentSkill，Workspace × Agent 级，用户可编辑，创作框架）  ← 新增
  + knowledge_context        （RAG，运行时动态，知识引用）
```

### 与 PromptProfile 的区别

| 维度 | PromptProfile | AgentSkill |
|-----|--------------|-----------|
| 作用范围 | 所有创作型 Agent | 指定 Agent 类型 |
| 约束内容 | 全局风格/腔调 | 某 Agent 的创作维度/输出结构 |
| 粒度 | RuleSet 级，一份 | Workspace × Agent，按需定义 |
| 用户可编辑 | ✅ 已支持 | 本 proposal 要求支持 |
| 是否已实现 | ✅ | ❌ |

---

## 用户场景示例

**场景 A：CoC 用户为 NPC Agent 定义调查员框架**

用户在工作区设置中，为"NPC Agent"添加一条 skill：
```
在生成 NPC 时，必须包含以下字段：
- 职业：NPC 在 1920s 社会中的角色
- 神话接触程度：无/轻微/深度（影响其对怪诞事件的反应）
- 心理稳定性：正常/不稳定/已崩溃
- 作为线索载体：此 NPC 能揭示哪条调查线索
```

此后每次调用 NPC Agent，这个框架都会自动应用，用户不需要每次在对话中重复说明。

**场景 B：D&D 用户为 Monster Agent 定义战斗设计框架**

```
设计怪物时需包含：
- 挑战等级估算（CR）
- 动作经济：动作/附赠动作/反应
- 标志性战术行为（1-2 条）
- 建议适用的遭遇规模（小组 / 精英 / Boss）
```

**场景 C：任意系统用户为 Plot Agent 定义节奏偏好**

```
规划故事结构时遵循以下节奏：
- 每幕至少有一个"调查发现"节点和一个"压力升级"节点
- 最终幕必须包含玩家做出不可逆选择的时刻
- 避免给出单一解法，保留至少两条可行路径
```

---

## 设计边界（重要）

**Skill 是用户的创作框架指令，不是 AI 角色扮演设定，不是风格腔调覆盖。**

- ✅ 合法 skill：定义 Agent 应该包含哪些维度、遵循什么输出结构
- ✅ 合法 skill：限定某 Agent 的创作偏好（如"Plot Agent 避免悲剧结局"）
- ❌ 不应用 skill 做的：完全覆盖 Agent 角色（用 skill 把 NPC Agent 变成 Monster Agent）
- ❌ 不应用 skill 做的：写全局风格（这是 PromptProfile 的职责）

---

## 技术实现要点

### 数据库

```sql
CREATE TABLE agent_skills (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,          -- 归属工作区（Workspace 级别）
  agent_type TEXT NOT NULL,            -- "npc" | "monster" | "plot" | "lore" | "rules"
  name TEXT NOT NULL,                  -- 用户起的名称
  prompt_patch TEXT NOT NULL,          -- 注入内容
  enabled BOOLEAN DEFAULT TRUE,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
```

> **绑定粒度选择**：绑定到 `workspace_id` 而非 `rule_set_id`，
> 因为用户对具体工作区的感知比对 RuleSet 抽象层的感知更强。
> 同一 RuleSet 的不同工作区可能有不同的 skill 配置。

### 注入时机

Workflow 层在调用专项 Agent 前，查询 `agent_skills` 表，
找到当前工作区 + 对应 agent_type 的所有 `enabled=True` 的 skill，
将 `prompt_patch` 拼接注入 user prompt：

```python
skills = get_agent_skills(db, workspace_id, agent_type)
if skills:
    skill_block = "\n\n".join(f"[用户创作框架指令]\n{s.prompt_patch}" for s in skills)
    task_prompt = f"{skill_block}\n\n{task_prompt}"
```

### 前端 UI（最简可行实现）

工作区设置页，新增"Agent Skills"标签页：
- 列表展示当前工作区已定义的所有 skill（按 agent_type 分组）
- 每条 skill：agent_type 下拉选择 + name 输入框 + prompt_patch 文本域 + enable/disable 开关
- 无需复杂编辑器，纯文本域足够（类似当前 PromptProfile 的编辑界面）

---

## 适合性判断：是否应进入 1.0？

**结论：建议纳入 1.0，理由如下。**

### 支持纳入 1.0 的理由

1. **实现成本相对可控**：
   - 后端：1 张新表 + Workflow 注入逻辑中增加约 20-30 行 skill 查询和拼接
   - 前端：复用 PromptProfile 编辑组件，在工作区设置中增加一个标签页
   - 不需要修改任何现有 Agent 的 system prompt

2. **直接提升创作控制感**：
   - PromptProfile 已经证明用户有"自定义 AI 创作框架"的需求和能力
   - AgentSkill 是 PromptProfile 的自然延伸，学习成本低
   - 用户在 1.0 阶段使用 CoC 时，就可以立即受益（自定义调查员 NPC 维度等）

3. **不依赖系统预置内容**：
   - 与 Part B（开发者预置 skill）不同，用户自定义 skill 不需要开发者先写好内容
   - 机制上线即可使用，价值不依赖于内置 skill 库的丰富程度

4. **风险可控**：
   - skill 写得不好只影响当前工作区的生成质量，不影响其他功能
   - enable/disable 开关让用户可以随时关闭某条 skill，排除干扰

### 反对纳入 1.0 的理由（及反驳）

| 顾虑 | 反驳 |
|-----|-----|
| "prompt patch" 概念对普通用户太技术化 | UI 可以用"Agent 创作指令"命名，不出现"prompt"；帮助文档提供示例即可 |
| 用户可能写出破坏 Agent 行为的 skill | 这同样适用于 PromptProfile，当前已接受这个风险；enable 开关已覆盖降级路径 |
| 1.0 功能已经够多，增加范围风险 | 实现量估计 < 2 天，且复用已有组件，范围可控 |

---

## 对创作控制感的影响

**直接正向。** 用户不再只是"调用 AI 然后修改结果"，而是可以主动设定 AI 的创作框架。
这是从"被动接受"到"主动塑造"的体验升级，与 workbench 的核心产品定位高度吻合。

## 对 workbench 协同的影响

**间接改善。** skill 在后台注入，不占用右栏 Agent 面板的交互空间，
但因为生成结果更贴合用户预期，减少"生成→大量修改→重试"的循环，
实际上降低了中栏编辑器与 Agent 面板之间的来回切换频率。

## 对 1.0 用户价值的影响

**中到高。** 即使只是 CoC 用户，能为 NPC Agent/Plot Agent 设定个性化创作框架，
就已经能明显感受到"这个工具是为我的风格量身定制的"，提升留存意愿。

---

## 建议落地方式

- [ ] **纳入 1.0（plan）**：进入当前或下一个 milestone
  - 后端：`agent_skills` 表 + CRUD API + Workflow 注入（~1天）
  - 前端：工作区设置页新增 AgentSkills 标签页（~1天，复用 PromptProfile UI 组件）
  - 帮助文档：补充"Agent 创作指令"使用说明和 CoC 示例（~0.5天）

## 不做的理由（如适用）

若评估后决定延后：触发重新评估的条件为用户反馈"每次都要在对话里重复说明创作要求很麻烦"。
