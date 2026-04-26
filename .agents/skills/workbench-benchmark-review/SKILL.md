---
name: workbench-benchmark-review
description: >
  对 trpg-workbench 做"创作型 AI workbench"参考项目对标 review。
  当用户提到"对标分析"、"benchmark review"、"参考 Inscriptor/OpenPawz/OpenCode"、
  "参考 leaked-system-prompts"、"system prompt 参考"、"如何写更好的 system prompt"、
  "milestone 后的产品 review"、"post-milestone review"、"横向产品对比"、
  "看看我们还缺什么"、"workbench 体验"、"agent 协作体验"、"信息架构"、
  "创作控制感"、"workbench 协同"等场景时必须加载本 skill。
  本 skill 只做 review 和分析，不直接改代码，不直接新建 milestone，
  结论最终落入 docs/benchmark-reviews/ 目录下的分类文件中。
---

# workbench-benchmark-review

## 这个 skill 是做什么的

对 trpg-workbench 做"创作型 AI workbench"参考项目对标 review。

trpg-workbench 的核心定位是：**AI 驱动的创作型工作台**——用户在这里管理 TRPG 资产、调度 AI Agent 协作、查阅知识库、审查规则，最终生成高质量创作物。Desktop 是承载形态之一，而不是产品定位本身。

本 skill 所说的 **workbench**，不只是 UI 布局与信息架构，还包括：
- **Agent 编排**：Director/Plot/NPC/Monster/Lore/Rules/Consistency/Document 各 Agent 的分工与调度方式
- **人机协作流程**：澄清→计划确认→执行→patch 确认的交互节点设计
- **知识库 / RAG / 规则审查与创作流程的耦合方式**：知识在什么时机注入、规则审查如何呈现、引用如何可见

**核心目标：**
- 对照成熟的 AI workspace / creative workbench 参考对象，评估 trpg-workbench 还缺哪些高价值能力
- 提炼能帮助 trpg-workbench 成为更好的"创作型 AI workbench"的机制
- 在 milestone 完成后做横向产品 review，输出可操作结论
- 结论落入 `docs/benchmark-reviews/` 目录的分类文件，而不是只在对话中消失

**不做什么：**
- 不直接改代码
- 不直接新建 milestone（除非用户明确要求）
- 不追求"和参考产品长得像"或"功能数量追齐"
- 不以 desktop 体验为首要评估维度

---

## 默认参考对象

如果用户没有特别指定，默认使用以下三个参考对象，**主次有别**：

### 主参考：Inscriptor
**定位：** 创作型 workspace 的信息架构与内容编排标杆

**借鉴侧重：**
- 信息密度控制与视觉层次
- 内容组织方式（项目 / 文档 / 侧栏 / 工作区编排）
- 左栏导航 + 中栏编辑器 + 右栏面板的协同模式
- 创作工作流中的状态持久化与切换体验
- 非线性内容编辑与关联展示

**为什么是主参考：**
Inscriptor 的核心场景与 trpg-workbench 最接近——都是"创作者在工作台上管理复杂内容"。它代表了创作型 workspace 在信息架构上的成熟解法，是 trpg-workbench 最直接的参照系。

**不照搬的部分：**
- 视觉样式与品牌风格
- 不针对 TRPG 场景的纯写作流程

---

### 次参考：OpenPawz
**定位：** AI + desktop + local-first 产品骨架

**借鉴侧重：**
- 本地优先桌面 AI 应用的能力边界设定
- Provider / model / integration 抽象层设计
- Memory / agent / session 的组织方式
- **用户可感知的 AI 状态**：
  - 用户是否清楚 AI 当前在做什么（生成中 / 审查中 / 等待输入 / 等待确认）
  - 当前使用了哪些模型、哪些知识库、哪些规则
  - AI 状态切换时用户是否得到足够提示，而不是"黑箱进行中"

**为什么是次参考：**
OpenPawz 代表了"桌面 AI 产品如何把 agent 能力做成用户可理解、可控的工作台体验"，这与 trpg-workbench 中 Agent 面板 + 知识库 + rules 的设计方向高度相关。

**不照搬的部分：**
- 非创作场景的 agent 能力
- 其全部 integration 体系（trpg-workbench 范围更聚焦）

---

### 补充参考：OpenCode Desktop
**定位：** 桌面 AI 工具的成熟产品机制（特别是基础设施层）

**借鉴侧重：**
- 桌面端启动与错误恢复机制
- 模型配置与 provider 抽象（API key、provider 切换）
- Help / onboarding / 文档入口
- 构建与发布结构

**为什么是补充参考：**
OpenCode 在 desktop 基础设施层（启动恢复、provider config、发布体系）上是成熟参照，但它的产品人格是 coding agent，与 trpg-workbench 的创作工具定位存在本质差异。因此只借鉴其"桌面机制"层，不借鉴其"agent 交互人格"层。

**明确不照搬：**
- Terminal / coder-centric 交互模式
- Coding agent 特有的产品人格与输出风格

---

### 补充参考：leaked-system-prompts
**来源：** https://github.com/jujumilk3/leaked-system-prompts（14.5k stars）

**定位：** 工业级 system prompt 工程学习资源

**借鉴侧重：**
- 主流 AI 产品（ChatGPT、Claude、Gemini、Cursor、Copilot、Manus 等）生产级 system prompt 的结构与约束写法
- 工具调用规范的表达方式（伪代码 vs 自然语言）
- 负向约束（negative constraints）段落的设计
- 输出格式控制段落的写法
- 多轮上下文感知与 fallback 行为描述

**为什么是补充参考：**
trpg-workbench 的 Agent system prompt（`apps/backend/app/prompts/` 下各 Agent）是产品核心竞争力之一。工业级产品的 system prompt 在约束清晰度、歧义消除和 LLM 行为可预测性上明显优于早期写法。参考此资源有助于系统性提升 Director / Rules / Consistency Agent 的 prompt 质量。

**借鉴时的参考文件：**
- `apps/backend/app/prompts/director/system.txt` — 主要改进对象
- `apps/backend/app/prompts/director/planning.txt`
- `apps/backend/app/prompts/director/clarification.txt`
- `apps/backend/app/prompts/_shared/` — 共享 prompt 片段

**明确不照搬：**
- 其他产品特有的业务约束（如 Cursor 的 coding 场景规则）
- 英文写法（trpg-workbench prompt 保持中文为主）

---

## 默认 review 主题

如果用户没有指定具体主题，优先从以下方向进行 benchmark review（按重要性排序）：

1. **Workbench 信息架构与内容编排** — 左栏/中栏/右栏的协同、资产树组织、编辑器与面板的关系
2. **Agent 编排与人机协作体验** — 用户如何感知 Agent 在做什么、如何介入和控制、澄清/确认流程
3. **知识库 / RAG / 规则审查如何服务创作** — 知识查阅路径、规则审查结果的呈现与应用；具体关注：
   - RAG 是否在合适时机介入创作，而不是静默注入或完全不可见
   - Rules review 是否更像"协作建议"而不是"事后批改"
   - 引用来源是否足够可见，用户能否追溯某段生成内容的知识依据
   - 用户是否能理解知识库结果如何影响了当前生成
4. **模型配置与 provider 抽象** — 多模型支持、API key 管理、切换体验
5. **Help / onboarding / 文档入口** — 新用户引导、功能发现、帮助文档
6. **桌面端启动、错误恢复与发布结构** — 冷启动、崩溃恢复、更新机制

若用户指定了具体主题，只聚焦该主题，不扩展到其他方面。

---

## 参考判断原则

在分析每个借鉴点时，必须遵循以下原则：

### 1. 优先评估是否提升"创作控制感"
用户在使用 trpg-workbench 时，核心诉求是**掌控自己的创作过程**——知道 AI 在做什么、能随时调整、能审查结果、能修改资产。

借鉴一个机制之前，先问：它是否让用户对创作内容有更强的掌控感？还是只是让产品"看起来更完整"？

### 2. 优先评估是否改善"workbench 协同"
trpg-workbench 的核心工作流是：
```
左栏资产树 ↔ 中栏编辑器 ↔ 右栏 Agent 面板
         ↕              ↕
      知识库/RAG    rules/patch/confirm
```
每个借鉴点都应评估：它是否改善了这几个区域之间的协同体验？是否减少用户在区域间切换的认知负担？

### 3. 不以"更强大"为唯一标准
优先判断：
- 是否适合当前阶段的 trpg-workbench（1.0 之前的范围控制）
- 是否会破坏当前 skill / plan / 架构边界
- 是否和核心定位（TRPG 创作工具）契合

### 4. 不追求 feature parity
不要求 trpg-workbench 长得像参考产品、功能数量与之齐平、或交互风格趋同。

### 5. 优先借鉴机制，不借鉴外观
优先分析：协作机制、信息架构、onboarding 流程、配置抽象、help/docs/release 体系。

### 6. 每个结论都必须给出"为什么不做"的判断
如果某个参考点不适合当前项目，也必须明确说明理由，不能只列"可以参考的点"。

### 7. 结论必须可落地
不应停留在"可以优化"这类空话，必须落到：
- 写 skill
- 写 plan（进入哪个 milestone）
- 直接改代码（小改）
- 先不做（并说明触发重新评估的条件）

---

## 标准输出结构

每次 benchmark review 必须按以下结构输出：

### Section 1：当前项目已做到的部分

按三个层次分别说明：

- **产品骨架已完成**：功能链路打通，核心流程可运行
- **用户体验已完成**：不只是能用，还有良好的感知、反馈与控制
- **骨架到位但体验细节未完成**：功能存在但缺少状态可见性、错误提示、引导、或流程流畅度

### Section 2：参考项目中最值得借鉴的点
只提炼 **3~5 个高价值点**，不罗列太多。每个点必须包含：

```
## 借鉴点 N：<简述>

**来源：** Inscriptor / OpenPawz / OpenCode Desktop
**借鉴理由：** 为什么这个机制值得关注
**当前差距：** trpg-workbench 现在的状态 vs 参考产品
**适合性判断：** 为什么适合 / 为什么不适合 trpg-workbench
**对创作控制感的影响：** 改善 / 无关 / 可能削弱（说明理由）
**对 workbench 协同的影响：** 改善哪个区域间的协同，或无关
**对 1.0 用户价值的影响：** 是否是 1.0 前必须解决的体验问题
**建议修改范围：** 需要改哪些模块 / 哪些 skill / 哪些 plan
**落地方式：** plan / skill / 直接改代码 / 先不做
```

### Section 3：三类结论区分

| 类别 | 含义 | 判断依据 |
|------|------|---------|
| 可直接参考的成熟机制 | 机制成熟，适合直接移植或小改即可用 | 与 trpg-workbench 场景高度匹配 |
| 可借鉴但需改造 | 核心思路可用，但实现需适配创作工具场景 | 机制好但目标用户/场景有差异 |
| 当前不应优先做 | 价值认可，但不适合当前阶段或范围 | 超出 1.0 范围或会破坏现有边界 |

### Section 4：优先级结论

输出 Top 3 推荐改进方向，每项说明：

```
### Top N：<方向名>
- 建议行动：小改 / 新 milestone / 新 skill / 仅记录
- 预估影响：高 / 中 / 低
- 创作控制感提升：有 / 无 / 间接
- workbench 协同改善：有 / 无 / 间接
- 触发条件（若暂缓）：...
```

---

## 输出文件规范

review 完成后，必须将每个高价值结论单独写入 `docs/benchmark-reviews/proposed/` 目录，文件名格式：

```
YYYY-MM-DD_<主题简述>.md
```

每个文件使用以下模板：

```markdown
---
status: proposed
date: YYYY-MM-DD
source: Inscriptor / OpenPawz / OpenCode Desktop
theme: <review 主题>
priority: high / medium / low
affects_creative_control: yes / no / indirect
affects_workbench_collab: yes / no / indirect
recommended_action: plan / skill / code / defer
---

# <借鉴点标题>

## 来源与借鉴理由
...

## 当前差距
...

## 适合性判断
...

## 对创作控制感的影响
...

## 对 workbench 协同的影响
...

## 对 1.0 用户价值的影响
...

## 建议落地方式
- [ ] plan：进入哪个 milestone
- [ ] skill：写什么 skill
- [ ] 直接改代码：改哪里
- [ ] 暂缓：触发重新评估的条件

## 不做的理由（如适用）
...
```

文件创建后，告知用户文件路径，等待用户决策后手动（或指示 AI）将文件移动到 `accepted/` / `rejected/` / `deferred/`。

---

## 如何与 plans/milestones 衔接

本 skill 只做 review，不直接修改 `.agents/plans/`。但 review 结论中会明确标注：

- 若建议"写 plan"：指出应进入哪个 milestone（新建或追加到现有 milestone）
- 若建议"写 skill"：给出 skill 名称建议和职责边界
- 若建议"直接改代码"：给出文件范围和改动描述

用户决策后，由用户或单独指令来驱动具体实现。

---

## Proposal 生命周期

`docs/benchmark-reviews/` 中的 proposal 文件有四个状态，每个状态转移都有明确的触发时机和执行方：

| 状态转移 | 触发时机 | 执行方 |
|---------|---------|-------|
| `proposed → accepted` | 用户决策"要做"，确认进入某个 milestone 时 | 用户指令 / milestone 规划阶段 |
| `proposed → rejected` | 用户明确决策"不做" | 用户指令 |
| `proposed → deferred` | 用户决策"暂缓，条件满足后再评估" | 用户指令 |
| `accepted → completed` | 对应 milestone 归档时，由 `milestone-management` Step 4b 执行 | milestone 归档流程 |

**本 skill 的职责边界**：
- 本 skill 只负责将结论写入 `proposed/`，并告知用户文件路径
- `proposed → accepted/rejected/deferred` 的转移由**用户决策后下达指令**来执行
- `accepted → completed` 的转移由 **`milestone-management` skill 的 Step 4b** 负责，本 skill 不介入

**注意**：`accepted/` 目录中的文件应在 milestone plan 的"背景与动机"或"来源"章节中被引用。如果某个 proposal 已被采纳进入 milestone 但未引用路径，归档时 Step 4b 将无法自动发现它，需要手动移动。

---

## 推荐调用模板

以下模板可直接复制使用：

**通用对标 review（默认主题）：**
```
请基于 workbench-benchmark-review，对照 Inscriptor + OpenPawz + OpenCode Desktop，
对当前仓库做一次 benchmark review，使用默认主题顺序。
先只输出 review，不改代码，不新建 plan，结论写入 docs/benchmark-reviews/proposed/。
```

**Milestone post-review：**
```
请基于 workbench-benchmark-review，对 M10 完成后的当前产品形态做一次 post-milestone benchmark review，
重点评估：workbench 信息架构、agent 编排与人机协作体验。
结论写入 docs/benchmark-reviews/proposed/。
```

**单主题深度 review：**
```
请基于 workbench-benchmark-review，只参考 Inscriptor，
深度分析 trpg-workbench 当前的左栏/中栏/右栏信息架构与参考产品的差距。
重点判断哪些机制能改善 workbench 协同，哪些不适合。
```

**决策后落地：**
```
docs/benchmark-reviews/proposed/2026-04-23_workbench-layout.md
这条结论我决定要做，请将其移入 accepted/ 并在 .agents/plans/ 中追加到合适的 milestone。
```

**Agent 协作专项 review：**
```
请基于 workbench-benchmark-review，只参考 Inscriptor + OpenPawz，
聚焦以下三个主题：agent 编排与人机协作体验、创作控制感、workbench 协同。
不讨论桌面启动、发布结构、provider config。
先只输出 review，结论写入 docs/benchmark-reviews/proposed/。
```
