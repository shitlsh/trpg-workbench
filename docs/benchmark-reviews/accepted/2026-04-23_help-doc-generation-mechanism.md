---
status: proposed
date: 2026-04-23
source: OpenCode Desktop / Inscriptor / OpenPawz
theme: Help 文档生成与管理机制
priority: high
affects_creative_control: yes
affects_workbench_collab: no
recommended_action: plan + skill
---

# Help 文档生成与管理机制 Review

## 背景

trpg-workbench 当前的 Help 文档生成依赖 `tauri-ui-smoke-and-docs` skill 的工作流：通过 Playwright 访问页面 → 提取 DOM 文本（按钮名、标签页名、标题等）→ 生成 Markdown 草稿 → 写入 `docs/ui-snapshots/<date>/help/` → 用户批准后手动同步到 `apps/desktop/src/help/`。

本 review 聚焦于这套机制本身是否合理，以及应如何改进。

---

## Section 1：当前已做到的部分

### 产品骨架已完成
- Help 页面（`/help/:doc`）+ 侧栏导航 + ReactMarkdown 渲染
- 5 篇中文文档覆盖核心主题（快速入门、模型配置、知识库导入、开始创作、规则集管理）
- `tauri-ui-smoke-and-docs` skill 定义了完整的三模式工作流（dom_only / dom_plus_screenshot / vision_review）
- 两阶段同步规则（草稿→快照目录，同步→src/help 需用户批准）

### 骨架到位但体验未完成
- 文档只跑过一次（2026-04-22），此后 UI 经历了 M9a（规则集统一）、M11（Setup Wizard）等重大变更，文档未重新生成
- `src/help/` 已与 `docs/ui-snapshots/` 脱钩——src/help 被手动修改过（加了 rule-set-management.md），但快照目录的版本没更新
- 文档中有 2 篇自带"待人工核对"注释，说明内容从未被验证

---

## Section 2：机制层面的核心问题

### 问题 1：DOM 提取生成的文档质量天花板很低

**现象：** 当前 skill 的文档生成逻辑是"从 DOM 提取按钮名、标签名、标题 → 拼成 Markdown"。这种方式只能产出**界面元素清单**，不是**使用指南**。

**具体表现：**
- getting-started.md 本质上是"顶部导航有 4 个按钮 → 首页有工作空间卡片 → 模型配置有 4 个标签页"的元素罗列
- 文档无法描述**操作流程中的决策点**——比如"为什么要先配模型""如何判断模型配置是否成功""Rerank 什么时候需要什么时候不需要"
- 文档无法描述**跨页面的操作链路**——比如"配完模型后需要回到工作空间设置页绑定"

**根本原因：** DOM 数据只是页面的**结构快照**，而好的 help 文档需要传达**操作意图、决策逻辑和概念关系**。这些信息不在 DOM 里。

**参考对比：** Inscriptor 和 OpenCode Desktop 的帮助文档都是人工编写或至少人工深度编辑的，不是从 UI 元素自动生成的。

### 问题 2：生成与同步机制形同虚设

**设计意图：** skill 定义了"每次 milestone 后重新跑 smoke → 重新生成文档 → 用户批准后同步"的流程。

**实际发生的：**
1. 只在 M9 跑过一次（2026-04-22）
2. M9a 加了规则集功能后，是直接手写了 `rule-set-management.md` 放进 `src/help/`，根本没走 smoke 流程
3. M11 加了 Setup Wizard 后，**没有更新任何文档**——getting-started.md 至今不知道 Wizard 的存在
4. `docs/ui-snapshots/2026-04-22/help/` 和 `apps/desktop/src/help/` 已经完全脱钩

**根本原因：** 这套机制的触发成本太高——需要启动前后端 → 跑 Playwright → 生成草稿 → 人工审阅 → 批准同步。在快速迭代中没有人会每次都做这一套。而且即使跑了，生成的内容质量也不够高（问题 1），还是需要大量人工编辑。

### 问题 3：文档内容与实际 UI 已严重不一致

经核查发现的偏差：

| 问题 | 严重性 |
|------|--------|
| getting-started.md 完全不提 Setup Wizard，但新用户首次进入会被重定向到 `/setup` | **高** |
| getting-started.md 步骤顺序"先建工作空间→再配模型"，实际 Wizard 是"先配模型→再建工作空间" | **高** |
| 快照版 getting-started.md 列出"Prompt 配置"为顶栏入口，但 M9a 后已改为"规则集"——src/help 版修了，但快照版没修 | **中** |
| start-creating.md 顶部注释"基于代码结构编写，待人工核对" | **中** |
| knowledge-import.md 顶部注释"基于 DOM 状态生成" | **中** |
| 文档中提到的页面（如 `/settings/models`）是纯文本，无法点击跳转 | **低** |

### 问题 4：截图存在但文档中未使用

`docs/ui-snapshots/2026-04-22/screenshots/` 下有 14 张页面截图（包括 help 页面本身的截图），但没有一张被嵌入到 help 文档中。截图的存在价值仅限于"人工翻看"，没有服务于最终用户。

### 问题 5：smoke skill 的职责混合

`tauri-ui-smoke-and-docs` skill 同时承担了三个职责：
1. UI smoke test（验证页面不崩溃）
2. 截图记录（视觉存档）
3. Help 文档生成

这三个职责的触发频率和质量标准不同：
- Smoke test 应该**频繁、自动**跑
- 截图记录可以**按需**跑
- Help 文档生成需要**高质量、人工把关**

把它们绑在一起的结果是：要么全跑（太重），要么全不跑（文档就腐烂了）。

---

## Section 3：参考项目中值得借鉴的机制

### 借鉴点 1：Help 文档应以人工编写为主，UI 数据为辅

**来源：** Inscriptor / OpenCode Desktop
**借鉴理由：** 两者的帮助文档都是人工维护的，内容组织围绕"用户任务"（我想做 X，怎么做）而非"界面结构"（这个页面有哪些按钮）

**当前差距：**
- 当前文档是 DOM 提取 → 拼接，内容组织是"页面导览"风格
- 缺少任务导向的内容（如"如何让 Agent 使用我的知识库"这种跨页面任务的说明）

**适合性判断：** 高度适合。Help 文档总量小（5 篇 × 50-80 行），人工维护完全可控

**建议：**
- 承认 DOM 自动生成作为"初稿工具"的价值，但不把它当作文档的长期维护方式
- 文档的 source of truth 是 `apps/desktop/src/help/`，由人工编写和维护
- `docs/ui-snapshots/<date>/help/` 仅作为 smoke 副产物参考，不再试图"同步"到 src/help

### 借鉴点 2：截图应嵌入文档，而非独立存放

**来源：** Inscriptor（文档内嵌操作截图）/ OpenCode Desktop（README 内嵌截图）
**借鉴理由：** 截图只有嵌入文档上下文中才有价值，独立存放的截图几乎不会有人去看

**当前差距：** 14 张截图存在于 `docs/ui-snapshots/` 下，文档中 0 张截图

**适合性判断：** 适合，但需要解决技术问题——`src/help/*.md` 通过 Vite `?raw` 导入，图片路径需要是相对路径或 base64 内嵌

**建议：**
- 截图存放在 `apps/desktop/src/help/images/` 下
- 文档中用相对路径引用 `![首页](./images/home.png)`
- HelpPage.tsx 的 ReactMarkdown 需要加 custom image renderer 来正确解析路径
- 截图数量克制——每篇文档 1-3 张关键截图即可

### 借鉴点 3：文档内链应支持应用内导航

**来源：** OpenCode Desktop（文档内链接可跳转）
**借鉴理由：** 文档中提到"前往「模型配置」页面"时，应该是可点击跳转的，而非纯文本提示

**当前差距：** ReactMarkdown 的 `<a>` 标签只能打开外部链接，不支持 React Router 导航

**适合性判断：** 高度适合，改动量小

**建议：**
- HelpPage.tsx 给 ReactMarkdown 加 custom link renderer
- 以 `/` 开头的链接用 `navigate()` 跳转
- 文档中将"点击顶部导航的「模型配置」"改为 `[模型配置](/settings/models)` 格式

### 借鉴点 4：Smoke test 与文档生成应解耦

**来源：** 工程实践常识
**借鉴理由：** Smoke test 的目标是"页面不崩溃"，文档的目标是"用户能看懂"——这两个目标的质量标准和触发时机完全不同

**适合性判断：** 高度适合

**建议：**
- `tauri-ui-smoke-and-docs` skill 保留 smoke test + 截图能力
- 从 skill 中移除"Help 文档生成"职责，或将其降级为"可选的初稿参考"
- Help 文档维护改为人工驱动：每次 milestone 完成后，作为 milestone 归档 checklist 的一项——"检查 help 文档是否需要更新"
- 截图能力保留，但截图的用途从"独立存档"转变为"嵌入文档"

### 借鉴点 5：各功能页面增加上下文 Help 入口

**来源：** Inscriptor / OpenCode Desktop
**借鉴理由：** 用户在功能页面遇到困惑时应能直接跳到对应帮助，而非退回首页

**当前差距：** 仅首页有 HelpButton

**建议：**
- 在 SettingsPage、KnowledgePage、RuleSetPage、WorkspaceSettingsPage 头部各加一个 HelpButton
- 传入对应的 doc slug，跳转到对应文档

---

## Section 4：三类结论区分

| 类别 | 内容 |
|------|------|
| **必须立即修复** | 文档内容与 UI 不一致（getting-started.md 未提及 Wizard、步骤顺序错误） |
| **可直接参考的成熟机制** | 文档人工维护为主 + DOM 辅助、截图嵌入文档、文档内链跳转、上下文 Help 入口 |
| **可借鉴但需改造** | Smoke test 与文档生成解耦（需调整 skill 职责边界） |
| **当前不应优先做** | Help 搜索、Feature Discovery Tooltips、多语言文档 |

---

## Section 5：优先级结论

### Top 1：重写文档内容（人工编写，任务导向）
- 建议行动：plan（进入下一个 milestone）
- 预估影响：高
- 创作控制感提升：有——正确的文档 = 用户信任
- workbench 协同改善：无
- 工作内容：
  - 重写 getting-started.md（加入 Setup Wizard 流程，修正步骤顺序）
  - 核对其余 4 篇文档，移除"待核对"注释，修正不一致内容
  - 文档内容从"界面元素导览"转向"任务导向"（如"如何配置你的第一个模型"）
  - 补充关键截图（每篇 1-3 张），嵌入文档
  - 文档中的页面引用改为可点击链接

### Top 2：调整 Help 文档维护机制
- 建议行动：修改 skill + 补充 milestone-management checklist
- 预估影响：中（长期价值高）
- 创作控制感提升：间接
- workbench 协同改善：无
- 工作内容：
  - `src/help/` 明确为 source of truth，人工维护
  - `tauri-ui-smoke-and-docs` skill 中 help 文档生成降级为"可选参考"
  - `milestone-management` skill 的归档 checklist 增加"检查 help 文档是否需要更新"
  - 截图能力保留，输出用于嵌入文档

### Top 3：HelpPage.tsx 技术增强
- 建议行动：直接改代码
- 预估影响：中
- 创作控制感提升：间接
- workbench 协同改善：无
- 工作内容：
  - ReactMarkdown custom link renderer（应用内路由跳转）
  - ReactMarkdown custom image renderer（正确解析截图路径）
  - 各功能页面增加上下文 HelpButton

---

## 总结：当前机制的本质问题

当前的 Help 文档生成机制（DOM 提取 → 自动拼接 → 同步到 src）在 M9 时是合理的"快速产出初稿"方案，但它有一个根本假设：**文档的主要信息来源是 UI 的结构**。

实际上，好的帮助文档的信息来源是**用户的任务和困惑**，这些无法从 DOM 中提取。当产品进入 Setup Wizard、规则集统一等阶段后，文档需要描述的是"为什么要这样做""什么情况下选 A 不选 B"——这是 DOM 提取永远无法覆盖的维度。

建议的转变：
- **文档编写**：从"DOM 自动生成"转为"人工编写 + 截图辅助"
- **文档维护**：从"跑 smoke 后同步"转为"milestone 归档时 checklist 检查"
- **smoke skill**：保留 smoke test + 截图能力，help 文档生成降为可选
- **截图用途**：从"独立存档供人工翻看"转为"嵌入文档服务终端用户"
