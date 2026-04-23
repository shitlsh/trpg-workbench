# M15：知识库归属规则集

**前置条件**：M14 完成（Help 文档重建已归档）。

**目标**：将知识库从独立顶级页面合并为规则集的下级管理面板，消除 `/knowledge` 独立路由，统一后端数据模型为严格一对多（`KnowledgeLibrary.rule_set_id` NOT NULL），移除冗余的 M:N binding 表。

---

## 背景与动机

M9a 引入了规则集统一管理，确立了 RuleSet → KnowledgeLibrary 的一对多所属关系（见 `trpg-workbench-architecture/SKILL.md:90`："KnowledgeLibrary 属于 RuleSet（一对多），不是全局独立资产"）。

但当前实现存在三层矛盾：

1. **数据模型矛盾**：后端同时存在 `KnowledgeLibrary.rule_set_id` FK（nullable，一对多）和 `rule_set_library_bindings` M:N 表。RuleSetPage 实际使用 M:N 表管理关联，`rule_set_id` FK 始终为 NULL（KnowledgePage 创建知识库时不传 `rule_set_id`）。
2. **UI 矛盾**：首页「知识库」是独立顶级入口，KnowledgePage 完全不感知 RuleSet，与架构 skill 约束相悖。
3. **Skill 矛盾**：`frontend-ui-patterns/SKILL.md:169` 写"保持独立（全局知识库管理，不合并到规则集页）"，与 `trpg-workbench-architecture/SKILL.md:90` "不是全局独立资产"直接冲突。

本 milestone 消除这三层矛盾，让数据模型、UI 层次和架构约束保持一致。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：后端数据模型统一**

方案：
- `KnowledgeLibrary.rule_set_id` 改为 NOT NULL
- 删除 `rule_set_library_bindings` 表和相关 ORM、API 端点
- `POST /knowledge/libraries` 必须携带 `rule_set_id` 参数
- `GET /knowledge/libraries` 支持 `rule_set_id` 查询参数筛选（保留全量查询能力供 workspace settings 使用）
- Agent 运行时读取知识库来源：从 `SELECT * FROM knowledge_libraries WHERE rule_set_id = ?` 获取（替代原来的 M:N join）
- 1.0 前不做数据迁移，直接删库重建

**A2：前端 RuleSetPage 扩展**

方案：选中规则集后，detail 区域从当前的两段式（提示词 + 知识库列表）扩展为三段式：
- **提示词** section（保持不变）
- **知识库** section：展示该规则集下的知识库列表（替代原 KnowledgePage 的左侧 sidebar 功能）
  - 每个知识库卡片：名称、类型 badge、文档数、展开/收起
  - 「新建知识库」按钮，创建时自动绑定当前 rule_set_id
  - 点击知识库 → 展开详情面板（文档列表、上传区、检索测试）
- 知识库详情面板复用 KnowledgePage 的核心组件：DocumentRow、DocumentPreviewPanel、SearchTestDialog

路由调整：
- `/settings/rule-sets` 保持不变（或简化为 `/rule-sets`）
- 可选深链接：`/rule-sets?rs={id}&lib={libId}`，通过 query params 定位

**A3：删除独立 KnowledgePage**

方案：
- 删除 `/knowledge` 路由
- 删除 `KnowledgePage.tsx`（或保留为内部组件重构后的一部分）
- 删除 `KnowledgePage.module.css`
- 首页移除「知识库」按钮

**A4：首页和引用更新**

方案：
- HomePage 移除「知识库」nav 按钮
- 首页空状态提示文案更新（原"建议先在知识库中导入规则书" → "建议先在规则集中导入规则书"）
- WorkspaceSettingsPage 的"额外知识库"选择器：改为从所有知识库中选（已有 `workspace_library_bindings` 机制不变）
- Setup Wizard Step 4（创建工作空间）无影响（它不涉及知识库操作）
- Help 文档 `knowledge-import.md` 和 `rule-set-management.md` 需更新

**A5：Skill 约束同步**

方案：
- `frontend-ui-patterns/SKILL.md`：删除 `:169` 行"保持独立"约束，路由表更新（删 `/knowledge`，RuleSetPage 描述改为"规则集+知识库管理"）
- `trpg-workbench-architecture/SKILL.md`：确认一对多约束已实现，移除任何 M:N 残留描述
- `agent-workflow-patterns/SKILL.md`：更新知识库来源获取方式（从 FK 直接查询，不再 join binding 表）
- `pdf-knowledge-ingestion/SKILL.md`：更新知识库创建流程（必须指定 rule_set_id）

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：知识库跨规则集共享**：若未来需要多个规则集共享同一知识库，可通过"引用"机制（只读别名）实现，而非回退到 M:N。当前无此需求。
- **B2：RuleSetPage 三栏布局**：当知识库内容变多时，可将 RuleSetPage 从 master-detail 扩展为三栏（规则集列表 | 知识库列表 | 知识库详情）。视 A2 实现后的体验决定。

### C 类：明确不承诺

- 恢复独立知识库页面：本 milestone 的核心就是消除它
- 知识库多归属（M:N）：架构约束已明确一对多
- 知识库全局搜索页：当前规模不需要

---

## 文件结构

### 修改文件

```
# 后端
apps/backend/app/models/orm.py                — rule_set_id NOT NULL, 删 RuleSetLibraryBindingORM
apps/backend/app/models/schemas.py             — 删 RuleSetLibraryBinding schema, rule_set_id 改必填
apps/backend/app/api/rule_sets.py              — 删 library-bindings 端点
apps/backend/app/api/knowledge_libraries.py    — rule_set_id 参数处理
apps/backend/app/services/workspace_context.py — 知识库来源改为 FK 查询（如存在）
packages/shared-schema/src/index.ts            — 删 RuleSetLibraryBinding 类型, 更新 CreateKnowledgeLibraryRequest

# 前端
apps/desktop/src/pages/RuleSetPage.tsx         — 大幅扩展，嵌入知识库管理
apps/desktop/src/pages/RuleSetPage.module.css  — 新增知识库相关样式
apps/desktop/src/pages/HomePage.tsx            — 删除知识库按钮，更新文案
apps/desktop/src/App.tsx                       — 删除 /knowledge 路由
apps/desktop/src/pages/WorkspaceSettingsPage.tsx — 更新知识库选择器

# Help 文档
apps/desktop/src/help/getting-started.md       — 更新知识库操作路径
apps/desktop/src/help/knowledge-import.md      — 重写，改为"在规则集中管理知识库"
apps/desktop/src/help/rule-set-management.md   — 补充知识库管理内容

# Skills
.agents/skills/frontend-ui-patterns/SKILL.md
.agents/skills/trpg-workbench-architecture/SKILL.md
.agents/skills/agent-workflow-patterns/SKILL.md
.agents/skills/pdf-knowledge-ingestion/SKILL.md
```

### 删除文件

```
apps/desktop/src/pages/KnowledgePage.tsx        — 独立页面删除（核心组件提取后）
apps/desktop/src/pages/KnowledgePage.module.css — 配套样式
```

---

## 关键设计约束

### 数据库变更策略

1.0 发布前不考虑历史数据迁移（见 `trpg-workbench-architecture/SKILL.md`）。直接修改 ORM 定义，删除旧 `trpg-workbench-data/` 数据库文件重建即可。

### Agent 运行时知识库获取

```python
# 原来（M:N binding）:
# SELECT kl.* FROM knowledge_libraries kl
# JOIN rule_set_library_bindings b ON b.library_id = kl.id
# WHERE b.rule_set_id = ?

# 改为（直接 FK）:
# SELECT * FROM knowledge_libraries WHERE rule_set_id = ?

# workspace 额外知识库不变：
# SELECT kl.* FROM knowledge_libraries kl
# JOIN workspace_library_bindings wb ON wb.library_id = kl.id
# WHERE wb.workspace_id = ?
```

### RuleSetPage 知识库 section 交互

```
选中规则集后的 detail 区域：

┌─────────────────────────────────────────┐
│ 规则集名称         [编辑] [删除]         │
│ 描述文本                                │
├─────────────────────────────────────────┤
│ 📝 创作风格提示词            [指定提示词] │
│   当前提示词卡片或"暂未指定"             │
├─────────────────────────────────────────┤
│ 📚 知识库 (N)                [新建知识库] │
│ ┌─────────────────────────────────┐     │
│ │ COC7 核心规则  核心规则  3篇  ▶ │     │
│ │ 马尔堡模组    参考模组  1篇  ▶ │     │
│ └─────────────────────────────────┘     │
│                                         │
│ ▼ COC7 核心规则 展开后：                 │
│   [上传 PDF]  [检索测试]  [删除知识库]   │
│   ┌ 文档列表 ─────────────────────┐     │
│   │ ▶ coc7-core.pdf   成功  128页 │     │
│   │ ▶ coc7-magic.pdf  成功  45页  │     │
│   └───────────────────────────────┘     │
└─────────────────────────────────────────┘
```

---

## Todo

### A1：后端数据模型统一

- [ ] **A1.1**：`orm.py` — `KnowledgeLibrary.rule_set_id` 改为 NOT NULL
- [ ] **A1.2**：`orm.py` — 删除 `RuleSetLibraryBindingORM` 类
- [ ] **A1.3**：`schemas.py` — 删除 `RuleSetLibraryBinding*` schema，`CreateKnowledgeLibraryRequest.rule_set_id` 改必填
- [ ] **A1.4**：`rule_sets.py` — 删除 `/{rule_set_id}/library-bindings` 相关端点
- [ ] **A1.5**：`knowledge_libraries.py` — `GET` 按 `rule_set_id` 筛选，`POST` 必须传 `rule_set_id`
- [ ] **A1.6**：Agent 运行时知识库获取逻辑更新（如 `workspace_context` 相关代码）

### A2：前端 RuleSetPage 扩展

- [ ] **A2.1**：提取 KnowledgePage 核心组件为可复用模块（DocumentRow, DocumentPreviewPanel, SearchTestDialog）
- [ ] **A2.2**：RuleSetPage detail 区域新增知识库 section（列表 + 展开详情）
- [ ] **A2.3**：新建知识库 modal — 自动绑定当前 rule_set_id
- [ ] **A2.4**：知识库展开后显示文档列表、上传区、检索测试入口

### A3：删除独立 KnowledgePage

- [ ] **A3.1**：`App.tsx` — 删除 `/knowledge` 路由
- [ ] **A3.2**：删除 `KnowledgePage.tsx` 和 `KnowledgePage.module.css`
- [ ] **A3.3**：清理 `HelpPage.tsx` 中 knowledge-import doc 的链接引用（如有指向 `/knowledge` 的）

### A4：首页和引用更新

- [ ] **A4.1**：`HomePage.tsx` — 删除「知识库」按钮，更新空状态文案
- [ ] **A4.2**：`WorkspaceSettingsPage.tsx` — 额外知识库选择器适配（改为直接查全部知识库）
- [ ] **A4.3**：`shared-schema` — 删除 `RuleSetLibraryBinding` 等类型
- [ ] **A4.4**：Help 文档更新（getting-started, knowledge-import, rule-set-management）
- [ ] **A4.5**：Help 截图更新（`refresh-help-images.sh`）

### A5：Skill 约束同步

- [ ] **A5.1**：`frontend-ui-patterns/SKILL.md` — 删除"保持独立"约束，更新路由表
- [ ] **A5.2**：`trpg-workbench-architecture/SKILL.md` — 确认一对多约束，清理 M:N 残留
- [ ] **A5.3**：`agent-workflow-patterns/SKILL.md` — 更新知识库获取方式
- [ ] **A5.4**：`pdf-knowledge-ingestion/SKILL.md` — 更新知识库创建流程

---

## 验收标准

1. 首页只有三个 nav 按钮（规则集、模型配置、用量观测），无独立「知识库」按钮
2. 在规则集页面选中任一规则集后，可直接新建知识库、上传 PDF、查看文档列表
3. 新建知识库时自动绑定当前规则集，无需手动选择
4. 后端 `knowledge_libraries` 表的 `rule_set_id` 列为 NOT NULL
5. 后端无 `rule_set_library_bindings` 表和相关 API
6. WorkspaceSettingsPage 的"额外知识库"功能仍正常工作
7. Agent 创作时的知识库检索功能不受影响
8. `/knowledge` 路由访问重定向到 `/settings/rule-sets`（或 404）
9. Help 文档中无过时的"知识库页面"引用
10. 四个 skill 文件中无 M:N / `rule_set_library_bindings` 残留描述

---

## 与其他里程碑的关系

```
M9a（规则集统一管理，引入 M:N binding）
  └── M15（知识库归属规则集，消除 M:N，统一为 1:N）
        └── B1: 知识库跨规则集共享（如有需求）
```

---

## 非目标

- 不改动 `workspace_library_bindings` 机制——工作空间额外知识库是独立的补充机制，不在本次范围
- 不新增知识库类型或导入格式——保持现有 PDF 导入能力
- 不做知识库搜索/筛选 UI——当前规模（每个规则集 1-5 个知识库）不需要
- 不做知识库在规则集间迁移/复制——如有需求在 B1 中处理
