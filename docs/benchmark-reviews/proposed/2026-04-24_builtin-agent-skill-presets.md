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

在用户自定义 Skill 机制（见 `2026-04-24_user-defined-agent-skills.md`）基础上，
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
| 绑定粒度 | Workspace 级 | RuleSet 级 |
| 触发方式 | 用户主动创建 | 创建对应 RuleSet 工作区时自动激活 |
| 可关闭 | ✅ 用户可 disable | ✅ 用户可 disable 或 override |
| 依赖条件 | 只需 Skill 机制上线 | 需要 Skill 机制上线 + 内容质量保证 |
| 是否已实现 | ❌（见 Part A）| ❌ |

**预置 Skill 依赖用户自定义 Skill 的基础设施**，两者共用同一张 `agent_skills` 表，
区别仅在于 `is_builtin = TRUE` 标记和绑定到 `rule_set_id` 而非 `workspace_id`。

---

## 内置 Skill 示例内容（草案）

### CoC 7e NPC Agent Skill（内置）

```
[CoC 7e NPC 框架]
在创作 NPC 时必须包含：
- 职业（1920s 社会角色）
- 神话接触程度：无/轻微/深度
- 心理稳定性：正常/不稳定/已崩溃
- 秘密动机（区别于表面动机）
- 作为线索载体：能揭示哪条调查线索（可为空）
```

### CoC 7e Monster Agent Skill（内置）

```
[CoC 7e 怪物/神话实体框架]
在设计怪物或神话实体时，区分两个威胁维度：
- 物理威胁：直接伤害、追踪、束缚等可见危险
- 精神/认知威胁：目击带来的理智损失、知识污染、意志瓦解
两个维度至少各包含一个具体表现形式，不得将所有内容归为"物理攻击"。
```

### D&D 5e Monster Agent Skill（内置）

```
[D&D 5e 怪物设计框架]
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
2. **内容质量是真正的瓶颈**：基础设施（数据库表、注入逻辑）相对简单，
   但每个系统的每个 Agent 都需要精心设计 prompt_patch，需要反复测试生成质量。
   CoC 有 5 个主要 Agent（NPC/Monster/Plot/Lore/Rules），D&D 类似，
   加起来轻松 20+ 条内容，这是内容工作量，不是工程工作量
3. **1.0 用户以 CoC 为主**：CoC 用户可以自己写 skill（Part A），不需要等预置包
4. **预置内容错误比没有内容伤害更大**：写得不好的内置 skill 会系统性降低生成质量，
   且用户会默认这是"正确"的，不会怀疑 skill 本身有问题

### 适合从 1.x 开始的理由

- 用户自定义 Skill 上线后，可以观察用户实际写了什么——这是最好的预置内容素材来源
- 社区可以贡献 skill 包，开发者做审核而不是从零撰写
- 预置 CoC skill 包可以作为 1.x 的一个独立功能点，配合多系统支持一起发布

---

## 对创作控制感的影响

**间接。** 用户无需编写即可获得系统贴合的 Agent 行为，
但这是"系统帮用户做了一件事"，不是"用户主动掌控了什么"。
对创作控制感的直接贡献不如 Part A（用户自定义 skill）。

## 对 1.0 用户价值的影响

**低**（1.0 前），**中**（1.x 配合多系统支持时）。

---

## 建议落地方式

- [ ] **暂缓（defer）**：1.0 前不实现
  - 前置条件：用户自定义 Skill（Part A）已上线
  - 触发重新评估的条件：1.0 发布后，用户反馈"不知道该怎么写 skill"或"希望有开箱即用的 CoC 模板"
- [ ] **1.x 计划**：
  1. 在 `app/storage/seed.py` 中增加 CoC 7e 的内置 skill 种子数据
  2. `agent_skills` 表增加 `is_builtin` + `rule_set_id` 字段（Part A 设计时预留，此时激活）
  3. 工作区设置页展示内置 skill（只读展示 + enable/disable 开关）

## 不做的理由（当前阶段）

内容质量无法在 1.0 前保证；基础机制（Part A）尚未上线；1.0 用户可以自己编写 skill。
先做机制，后做预置内容，顺序不可颠倒。
