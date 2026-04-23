---
name: milestone-management
description: 约束 trpg-workbench 中所有 milestone plan 文件的命名、格式、完成状态标注和归档规范。当新建 milestone、标记 milestone 完成、归档已完成 milestone、或同步更新 roadmap.md / README.md 时必须加载本 skill，包括：新建 plan 文件、判断 milestone 是否已完成、执行归档操作、更新进度标注、或任何"这个 milestone 完成了吗"的判断。当用户说"xx 完成了"、"帮我归档"、"roadmap 没更新"、"新建一个 milestone"、"当前状态是什么"，或任何涉及 .agents/plans/ 目录操作的情况，都应加载本 skill。
---

# Skill: milestone-management

## 用途

本 skill 约束 trpg-workbench 所有 milestone plan 文件的生命周期管理：命名规范、文件格式、
完成状态标注、归档流程，以及 roadmap.md 和 README.md 的同步更新规则。

**必须加载本 skill 的场景：**
- 新建任何 milestone plan 文件
- 判断某个 milestone 是否已完成（尤其是状态标注不规范的 plan 文件）
- 执行 milestone 归档操作
- 更新 roadmap.md 或 README.md 的当前状态

---

## 目录结构

```
.agents/plans/
├── roadmap.md               ← 唯一的路线图总览，必须与实际归档状态保持一致
├── m{N}-{slug}.md           ← 进行中 / 待启动的 milestone（活跃 plan）
└── archive/
    └── m{N}-{slug}.md       ← 已完成 milestone（归档 plan，只读）
```

**活跃 plan 目录**（`.agents/plans/`）中只应存在：
- `roadmap.md`
- 当前进行中或尚未启动的 milestone 文件
- `archive/` 子目录

已完成的 milestone 文件必须移入 `archive/`，不得留在活跃目录中。

---

## 文件命名规范

### 格式

```
m{N}-{slug}.md
```

- `N`：连续整数，从 1 开始递增，不可跳号（特殊追加里程碑可用 `{N}a`，如 `m9a`）
- `slug`：小写英文 + 连字符，2-4 个词，描述该里程碑的核心主题
- 示例：`m11-onboarding.md`、`m12-export-system.md`

### 禁止的命名方式

- 不可使用日期前缀（日期属于 benchmark review，不属于 plan）
- 不可使用 `milestone-` 前缀
- 不可在文件名中使用中文

---

## Plan 文件格式规范

### 必填头部（文件前 5 行）

```markdown
# M{N}：{中文标题}

**前置条件**：{前置 milestone} 完成（{简要说明}）。

**目标**：{一句话描述本 milestone 要解决的问题}。
```

### 完成状态标注（完成时追加）

milestone 完成后，必须在文件头部的**前置条件行之后、目标行之前**追加以下标注：

```markdown
**状态：✅ 已完成（{完成标识，如 commit hash 或日期}）**
```

示例：
```markdown
# M3：资产系统

**前置条件**：M1 完成（Workspace CRUD、SQLite 可用）。

**状态：✅ 已完成（commit c2329f6）**

**目标**：三栏编辑器，资产 CRUD，双视图，Revision 回溯。
```

### 完成标识的优先级

1. git commit hash（最精确，优先使用）
2. 完成日期（`YYYY-MM-DD` 格式）
3. 若均不确定，使用 `（完成，具体提交待补充）`

---

## 判断 Milestone 是否已完成

由于历史 plan 文件存在状态标注不规范的情况，判断时必须**多重核验**，不能只依赖状态行。

### 判断顺序

1. **检查状态行**：文件中是否有 `**状态：✅ 已完成**` 或 `**M{N} 已完成**` 字样
2. **检查 Todo 完成率**：若文件中有 `- [x]` / `- [ ]` 列表，统计完成率；**全部为 `[x]`** 才视为完成
3. **检查 roadmap.md**：看"进行中"表格中是否还有该里程碑条目
4. **检查 README.md**：看当前状态描述是否已超越该里程碑
5. **检查 git log（可选）**：若上述信息冲突，用 `git log --oneline` 查找相关 commit 判断

### 判断规则

- 以上 5 项中，满足 **2 项及以上** 指向"已完成"，则视为已完成
- 若仅有文档更新（如 roadmap 描述）而无代码 commit 对应，优先询问用户确认，不自动归档
- 不可仅凭"文件中大量 `[x]`"就断定完成，必须结合 roadmap 或状态行

---

## 归档流程（完整步骤）

当判断某个 milestone 已完成后，按以下顺序执行：

### Step 0：Code Review + Todo Checklist（归档前必做）

归档前必须按顺序完成以下两项检查，**两项均通过才能继续归档**：

#### Step 0a：Code Review（实现质量检查）

对本次 milestone 改动的所有文件做 diff review：

```bash
git diff <base-commit>..HEAD -- <改动文件>
```

检查项：
- **逻辑正确性**：核心逻辑是否按照 plan 描述正确实现
- **边界条件**：空值/空列表/null/undefined/空字符串是否有正确处理
- **数据流**：数据从哪来、写到哪去、提交时机是否正确（尤其涉及 db.commit）
- **副作用**：是否有意外的重复调用、遗漏清理、或状态污染
- **类型安全**：前端 TypeScript 类型是否与后端 schema 一致

发现任何问题，必须先修复并提交，再继续 Step 0b。不得在有已知 bug 的情况下归档。

#### Step 0b：Todo Checklist Review（功能完整性检查）

在追加状态行、移动文件之前，逐项 review plan 文件中的 Todo checklist：

1. 读取 plan 文件，找到所有 `- [ ]` 条目
2. 对照实际代码/文件逐一核查每个条目是否已实现
3. 将已实现的条目从 `- [ ]` 改为 `- [x]`
4. 若发现某条目未实现但 milestone 整体已完成，在条目后追加备注，例如：
   - `- [x] **A3.4**：... （实现时与 plan 有偏差：保留了跳过按钮）`
   - `- [ ] **B1**：...（B 类扩展，推迟到后续 milestone）`
5. **禁止在 Todo 仍有未勾选条目的情况下直接归档**（B 类/C 类扩展除外，这些允许保持 `[ ]` 并注明推迟）

> **原则**：归档文件应如实反映实现状态，让 plan 文件具备自说明能力，方便日后回溯。

### Step 1：在 plan 文件中追加完成状态行

若文件中尚无 `**状态：✅ 已完成**` 行，在前置条件行后追加：

```markdown
**状态：✅ 已完成（{完成标识}）**
```

**注意**：对于历史遗留的 plan 文件（已在 `archive/` 中但内部无状态行的），同样需要补充状态行。
判断方式：读取 archive 中的文件，若缺少状态行则直接编辑补充，这不影响归档的有效性，但能让文件本身自说明。

### Step 2：移动文件到 archive

```bash
mv .agents/plans/m{N}-{slug}.md .agents/plans/archive/
```

确认 `archive/` 目录存在（若不存在先创建）。

### Step 3：更新 roadmap.md

必须同时完成以下两处更新：

**a. 总览图（文件顶部的 ASCII 树）**：
- 将对应节点前缀从空白改为 `✅`
- 示例：`└── M6 模型配置管理` → `└── ✅ M6 模型配置管理`

**b. 里程碑表格**：
- 将该里程碑从"进行中 / 待启动"表格移入"已完成（归档）"表格
- 在名称后加 ` ✅` 标记
- 更新文件链接为 `archive/m{N}-{slug}.md`

### Step 4：更新 README.md

找到 README.md 中的当前状态行（通常是 `> **当前状态：...`），更新为：

```markdown
> **当前状态：M{N} 已完成，M{N+1}（{标题}）进行中**
```

若下一个 milestone 尚未启动（无对应 plan 文件），改为：

```markdown
> **当前状态：M{N} 已完成**
```

### Step 4b：移动 benchmark-review proposals（如有）

若本 milestone 的 plan 文件中引用了 `docs/benchmark-reviews/` 来源（通常在"背景与动机"或"来源"章节），
需要将对应 proposals 从 `accepted/` 移动到 `completed/`：

```bash
# 查看 plan 文件中引用的 proposal 路径
grep "benchmark-reviews" .agents/plans/archive/m{N}-{slug}.md

# 移动对应文件
mv docs/benchmark-reviews/accepted/{filename}.md docs/benchmark-reviews/completed/
```

**判断方法**：
- 在 plan 文件中搜索 `docs/benchmark-reviews/` 路径
- 若路径指向 `accepted/`，则对应文件需移动到 `completed/`
- 若路径指向 `proposed/`，说明 proposal 已在 milestone 规划时被接受但未手动移到 accepted，跳过此步（不追溯）
- 若 plan 文件中无 benchmark-reviews 引用，跳过此步

### Step 5（原 Step 5）：验证一致性

归档完成后，检查以下一致性：

- [ ] Todo checklist 已逐项 review，所有 A 类条目均已勾选（或注明偏差）
- [ ] `archive/` 中存在该文件
- [ ] 活跃 plans 目录中该文件已不存在
- [ ] roadmap.md 总览图中该 milestone 标注为 ✅
- [ ] roadmap.md 表格中该 milestone 已移入"已完成"节
- [ ] roadmap.md 文件链接指向 `archive/` 路径
- [ ] README.md 当前状态描述已更新
- [ ] 若 plan 引用了 benchmark-reviews proposals，已从 `accepted/` 移至 `completed/`

---

## 新建 Milestone 规范

### 编号规则

- 新 milestone 编号 = 当前最大编号 + 1
- 在新建前，必须先查阅 `roadmap.md` 和 `archive/` 确认当前最大编号
- 禁止自行猜测编号，必须以实际文件为准

### 前置条件的定义与判断规则

**前置条件**是指"技术或逻辑上必须先存在某个能力，本 milestone 才能实现"，不是"串行执行顺序"。

判断是否需要写前置条件：

| 情况 | 前置条件写法 |
|------|------------|
| 本 milestone 依赖另一个 milestone 产出的 API / 数据结构 / 组件 | `M{N} 完成（{具体说明依赖什么}）` |
| 本 milestone 是纯独立功能（如纯前端视觉、独立页面、独立配置项） | `无强依赖（{一句话说明为什么独立}）` |
| 多个 milestone 之间互相独立，可并行规划 | 各自写 `无强依赖`，在 roadmap 中并列 |

**常见错误**：把"编号最大的已完成 milestone"当作前置条件填入，仅因为它是"最新"的——这是错误的。前置条件必须有实际技术依赖，不可凭编号顺序填写。

**允许并行 plan**：可以在 `.agents/plans/` 中同时存在多个没有相互依赖的 milestone 文件，按实际需要选择启动顺序，不必强制串行。

### 新建 checklist

新建 plan 文件时必须：

- [ ] 文件名符合 `m{N}-{slug}.md` 规范
- [ ] 文件头部包含标题、前置条件、目标三行
- [ ] **前置条件已按上述规则判断**：是真实技术依赖才写 `M{N} 完成`，否则写 `无强依赖`
- [ ] 正文使用下方模板结构，各章节按实际情况填写（不可省略 A/B/C 类范围、验收标准、非目标）
- [ ] 在 roadmap.md"进行中 / 待启动"表格中追加新行
- [ ] 在 roadmap.md 总览图中追加新节点
- [ ] README.md 当前状态**不需要**在新建时更新（仅在完成时更新）
- [ ] 若 plan 来源于 benchmark review proposal，确认对应文件已移入 `docs/benchmark-reviews/accepted/`，并在 plan 的"背景与动机"中引用 `accepted/` 路径

### Plan 文件正文模板

```markdown
# M{N}：{中文标题}

**前置条件**：M{N-1} 完成（{具体说明依赖什么能力，例如：Workspace CRUD 可用}）。
<!-- 若无技术依赖，改为：无强依赖（{一句话说明为什么独立，例如：纯前端视觉改动}）。 -->

**目标**：{一句话描述本 milestone 要解决的核心问题}。

---

## 背景与动机

{说明为什么要做这个 milestone，当前产品/代码的哪个问题驱动了它。
若来源于 benchmark review，在此注明 proposal 路径：
- `docs/benchmark-reviews/accepted/YYYY-MM-DD_xxx.md`}

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

{列出本 milestone 必须交付的功能，每项用简短标题 + 方案描述。}

**A1：{功能名}**

方案：{描述实现方式，可包含示意图或伪代码}

**A2：{功能名}**

...

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：{扩展名}**：{一句话描述，说明为什么推迟}

### C 类：明确不承诺

- {不做的功能或方向，防止 scope creep}

---

## 文件结构

### 修改文件

\`\`\`
{列出本 milestone 需要改动的文件路径，简注改动目的}
\`\`\`

---

## 关键设计约束

{描述实现时必须遵守的技术约束、数据流、接口契约等。
每个约束配一段伪代码或流程图说明。}

---

## Todo

### A1：{功能名}

- [ ] **A1.1**：`{文件}` — {具体任务描述}
- [ ] **A1.2**：`{文件}` — {具体任务描述}

### A2：{功能名}

- [ ] **A2.1**：...

---

## 验收标准

{列出可观测的验收条件，每条以"在...情况下，...应该..."的形式描述。
避免写"功能正常"这类无法验证的空话。}

1. {验收条件 1}
2. {验收条件 2}

---

## 与其他里程碑的关系

\`\`\`
M{N-1}（前置）
  └── M{N}（本 milestone）
        └── {可能的后续 milestone 或 B 类扩展}
\`\`\`

---

## 非目标

- {明确列出不做的事情，防止实现时范围扩大}
- {每条都应说明为什么不做，或推迟到何时做}
```

> **说明**：
> - A/B/C 类范围声明是防止 scope creep 的关键，**不可省略**
> - 验收标准是归档时 Step 0b Todo review 的判断依据，**不可省略**
> - 非目标是边界防护，避免实现时逐渐扩展，**不可省略**
> - B/C 类内容较少时可合并为一节

---

## 常见错误与修正

| 错误 | 修正方式 |
|------|---------|
| 归档前未做 Code Review（Step 0a）| 对 milestone diff 做系统 review，修复发现的 bug 后再归档 |
| 归档前 Todo checklist 有未勾选 A 类条目 | 逐项 review 代码，勾选已实现项，未实现项注明原因后再归档 |
| 活跃目录中存在已完成 milestone 文件 | 执行完整归档流程（Step 0–5） |
| roadmap.md 总览图未更新但表格已更新 | 补全总览图的 ✅ 标注 |
| README 状态描述落后 2 个以上 milestone | 一次性更新到最新已完成 milestone |
| 新建时编号与已有文件冲突 | 检查 archive/ 后重新分配编号 |
| plan 文件无前置条件行 | 不强制修正历史文件，新建时必须遵守 |
| 完成标识缺失（无 commit hash）| 使用日期或 `（完成，具体提交待补充）` 占位 |
| benchmark-reviews accepted/ 中仍有本 milestone 的 proposal | 执行 Step 4b，将对应文件移至 completed/ |
| 将"编号最大的已完成 milestone"填为前置条件，实际上无技术依赖 | 改为 `无强依赖（{原因}）`；前置条件必须有真实技术依赖，不可凭编号顺序填写 |
| 来源于 benchmark review 的 plan，背景中引用了 `proposed/` 路径 | 确认 proposal 已移入 `accepted/`，并更新 plan 中的引用路径 |

---

## 调用示例

**归档一个已完成的 milestone：**
```
请基于 milestone-management skill，将 m8-knowledge-preview.md 标记为已完成并归档，
同步更新 roadmap.md 和 README.md。
```

**新建下一个 milestone：**
```
请基于 milestone-management skill，新建下一个 milestone，
主题是 XXX，前置条件为 M11 完成。
```

**批量检查并归档：**
```
请基于 milestone-management skill，检查 .agents/plans/ 中所有未归档的 milestone
是否已完成，对已完成的执行归档，并同步 roadmap 和 README。
```
