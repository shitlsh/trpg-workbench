---
status: proposed
date: 2026-04-24
source: agent-workflow-patterns skill + TRPG 系统分析
theme: Agent Skills 预置库——开发者为各 TRPG 系统编写内置 skill 包
priority: low
affects_creative_control: indirect
affects_workbench_collab: indirect
recommended_action: defer
---

# 开发者预置 Agent Skill 包——为各 TRPG 系统提供内置创作框架

## 来源与借鉴理由

在用户自定义 Skill 机制（见 `accepted/2026-04-24_user-defined-agent-skills.md`）基础上，
这是第二层能力：**开发者（或社区）为特定 TRPG 规则系统编写并预置好的 skill 包**，
随 RuleSet 一起分发，用户创建对应规则系统的工作区后自动获得。

目标是让不熟悉"如何写 prompt 框架指令"的用户，也能立即获得系统贴合的 Agent 行为——
无需自己编写 skill，内置 skill 已经帮他们定义好了 CoC NPC 的调查员维度、
D&D 怪物的 CR 估算框架、TOR 的旅途/冒险双阶段结构等。

---

## 与用户自定义 Skill 的关系

| 维度 | 用户自定义 Skill | 开发者预置 Skill |
|-----|---------------|---------------|
| 编写者 | 用户 | 开发者 / 社区 |
| 绑定粒度 | Workspace 级 | RuleSet 级（复制到 Workspace） |
| 触发方式 | 用户主动创建 | 创建对应 RuleSet 工作区时自动复制 |
| 可关闭 | ✅ 用户可 disable | ✅ 用户可 disable 或直接编辑覆盖 |
| 依赖条件 | 只需 Skill 机制上线 | 需要 Skill 机制上线 + 内容质量保证 |
| 是否已实现 | ❌（见 accepted/2026-04-24_user-defined-agent-skills.md）| ❌ |

**预置 Skill 依赖用户自定义 Skill 的基础设施**，两者共用同一套文件框架和注入逻辑。
区别在于来源：用户 skill 由用户在工作区设置中创建，预置 skill 是应用打包的 `.md` 文件，
在创建工作区时由后端复制到 `{workspace_id}/skills/` 目录。

---

## 实现机制（与原版 DB 方案的差异说明）

**原版（已废弃）**：在 `agent_skills` DB 表中增加 `is_builtin` + `rule_set_id` 字段，
依赖数据库 seed 脚本分发内置 skill。

**新版（文件框架）**：
- 内置 skill 存储为 `.md` 文件，打包在应用内（如 `apps/backend/app/builtin_skills/{system_slug}/`）
- 文件格式与用户 skill 完全一致：YAML frontmatter（name/description/agent_types/enabled）+ Markdown 正文
- 创建新工作区时，后端根据 `rule_set_id` 查找对应目录，将匹配文件复制到 `{workspace_id}/skills/`
- 复制后的文件归属 workspace，用户可以自由编辑或 disable（frontmatter `enabled: false`）
- **无新 DB 表**，无 `is_builtin` 字段——内置/用户 skill 在数据层完全同构

---

## 内置 Skill 示例内容（草案）

### CoC 7e NPC Agent Skill（内置）

```
---
name: CoC 7e NPC 框架
description: 为克苏鲁神话体系 NPC 提供调查员维度和线索载体结构
agent_types: [npc]
enabled: true
---

在创作 NPC 时必须包含：
- 职业（1920s 社会角色）
- 神话接触程度：无/轻微/深度
- 心理稳定性：正常/不稳定/已崩溃
- 秘密动机（区别于表面动机）
- 作为线索载体：能揭示哪条调查线索（可为空）
```

### D&D 5e Monster Agent Skill（内置）

```
---
name: D&D 5e 怪物设计框架
description: 确保怪物数据完整，包含 CR 估算和战斗策略
agent_types: [monster]
enabled: true
---

设计怪物时需包含：
- 挑战等级估算（CR）：基于 HP/AC/伤害的粗略估算
- 动作经济：动作/附赠动作/反应动作分配
- 战斗策略倾向（1-2 条简述）
- 建议遭遇规模：散兵群 / 精英单体 / Boss 战
- 弱点与抗性提示（若适用）
```

---

## 适合性判断：是否应进入 1.0？

**结论：不应进入 1.0，建议 defer 到 1.x。**

### 不纳入 1.0 的理由

1. **依赖用户自定义 Skill 先落地**：基础机制未上线时，预置内容无法分发
2. **内容质量是真正的瓶颈**：文件框架（复制逻辑）工程量很小，
   但每个系统的每个 Agent 都需要精心设计 skill 内容，需要反复测试生成质量。
   CoC 有 5 个主要 Agent（NPC/Monster/Plot/Lore/Rules），D&D 类似，
   加起来 20+ 个 skill 文件，这是内容工作量，不是工程工作量
3. **1.0 用户以 CoC 为主**：CoC 用户可以自己写 skill，不需要等预置包
4. **预置内容错误比没有内容伤害更大**：写得不好的内置 skill 会系统性降低生成质量

### 适合从 1.x 开始的理由

- 用户自定义 Skill 上线后，可以观察用户实际写了什么——这是最好的预置内容素材来源
- 社区可以贡献 skill 文件，开发者做审核而不是从零撰写
- 预置 CoC skill 包可以作为 1.x 的一个独立功能点，配合多系统支持一起发布

---

## 对创作控制感的影响

**间接。** 用户无需编写即可获得系统贴合的 Agent 行为，
但这是"系统帮用户做了一件事"，不是"用户主动掌控了什么"。
对创作控制感的直接贡献不如用户自定义 skill。

## 对 1.0 用户价值的影响

**低**（1.0 前），**中**（1.x 配合多系统支持时）。

---

## 建议落地方式

- [ ] **暂缓（defer）**：1.0 前不实现
  - 前置条件：用户自定义 Skill（M17）已上线
  - 触发重新评估的条件：1.0 发布后，用户反馈"不知道该怎么写 skill"或"希望有开箱即用的 CoC 模板"
- [ ] **1.x 计划**：
  1. 在 `apps/backend/app/builtin_skills/` 下按系统创建 skill `.md` 文件目录结构
  2. 后端创建工作区时，按 `rule_set_id` 匹配并复制对应 skill 文件到 workspace
  3. 工作区设置页展示来源标记（"预置"标签），用户可 disable 或自由编辑

## 不做的理由（当前阶段）

内容质量无法在 1.0 前保证；基础机制（M17）尚未上线；1.0 用户可以自己编写 skill。
先做机制，后做预置内容，顺序不可颠倒。
