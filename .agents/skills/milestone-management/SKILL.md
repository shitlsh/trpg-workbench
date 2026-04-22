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

### Step 5：验证一致性

归档完成后，检查以下一致性：

- [ ] `archive/` 中存在该文件
- [ ] 活跃 plans 目录中该文件已不存在
- [ ] roadmap.md 总览图中该 milestone 标注为 ✅
- [ ] roadmap.md 表格中该 milestone 已移入"已完成"节
- [ ] roadmap.md 文件链接指向 `archive/` 路径
- [ ] README.md 当前状态描述已更新

---

## 新建 Milestone 规范

### 编号规则

- 新 milestone 编号 = 当前最大编号 + 1
- 在新建前，必须先查阅 `roadmap.md` 和 `archive/` 确认当前最大编号
- 禁止自行猜测编号，必须以实际文件为准

### 新建 checklist

新建 plan 文件时必须：

- [ ] 文件名符合 `m{N}-{slug}.md` 规范
- [ ] 文件头部包含标题、前置条件、目标三行
- [ ] 在 roadmap.md"进行中 / 待启动"表格中追加新行
- [ ] 在 roadmap.md 总览图中追加新节点
- [ ] README.md 当前状态**不需要**在新建时更新（仅在完成时更新）

---

## 常见错误与修正

| 错误 | 修正方式 |
|------|---------|
| 活跃目录中存在已完成 milestone 文件 | 执行完整归档流程（Step 1–5） |
| roadmap.md 总览图未更新但表格已更新 | 补全总览图的 ✅ 标注 |
| README 状态描述落后 2 个以上 milestone | 一次性更新到最新已完成 milestone |
| 新建时编号与已有文件冲突 | 检查 archive/ 后重新分配编号 |
| plan 文件无前置条件行 | 不强制修正历史文件，新建时必须遵守 |
| 完成标识缺失（无 commit hash）| 使用日期或 `（完成，具体提交待补充）` 占位 |

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
