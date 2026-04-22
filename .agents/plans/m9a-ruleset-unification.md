# M9a：规则集统一管理——知识库、Prompt 与工作空间的完整串联

**前置条件**：M9 完成（smoke test 与帮助文档体系已建立）

**目标**：将当前割裂的「知识库」「Prompt 配置」「规则体系」三个模块重新组织为以 **RuleSet（规则集）** 为核心的统一管理体系，并将 RuleSet 的 PromptProfile 和 KnowledgeLibrary 真正接入 Agent 运行时，使知识库检索和创作风格提示词在工作空间内实际生效。

---

## 背景与动机

### 当前问题诊断

经 M9 后 review，系统存在三个相互关联的断点：

**断点 1：规则集无管理 UI**
- 用户只能在新建/编辑工作空间时从下拉选择规则集
- 没有任何页面可以创建、编辑、删除规则集
- 两个内置规则集是唯一选项，用户无法自定义

**断点 2：PromptProfile 运行时未接入**
- `PromptProfile` 表存在完整的 CRUD，用户可以创建和编辑提示词
- 但所有 Agent 使用各自文件中的**硬编码字符串常量**作为 system prompt
- `PromptProfile.rule_set_id` 只是装饰性标签，从未被任何运行时代码读取
- 「Prompt 配置」页面在当前版本对 AI 行为**零影响**

**断点 3：知识库无法绑定到工作空间**
- 后端有完整的 `WorkspaceLibraryBinding` 表和 bind/list/unbind API
- 但前端没有任何 UI 页面实现知识库与工作空间的绑定操作
- `WorkspaceSettingsPage` 中没有知识库绑定入口
- 帮助文档中「进入工作空间设置关联知识库」的描述指向一个不存在的功能

### 用户视角的正确心智模型

用户期望的使用流程：

```
① 创建规则集（如"恐怖调查"）
    ├── 上传规则书 PDF → 知识库（挂载在规则集下）
    └── 编写创作风格提示词（挂载在规则集下）

② 新建工作空间，选择规则集
    → 工作空间自动继承规则集的知识库集合和提示词

③ 打开工作空间，与 Agent 对话
    → Agent 使用规则集提示词作为风格基底
    → Agent 检索时使用规则集绑定的知识库
```

当前实现距离这个模型的差距：
- ① 缺少规则集管理 UI，知识库是全局平铺的，不属于任何规则集
- ② 工作空间只存了 `rule_set_id` 字符串，没有实际行为
- ③ Agent 完全不读取 PromptProfile，知识库检索依赖手动设置的 `WorkspaceLibraryBinding`（但该 UI 不存在）

---

## 概念澄清与设计决策

### RuleSet 的定位重新定义

**M9a 后的 RuleSet 是知识库和提示词的父级容器：**

```
RuleSet（规则集）
  ├── PromptProfile（风格提示词，1个规则集最多1个活跃）
  └── KnowledgeLibrary[]（归属该规则集的知识库，一对多）
```

- RuleSet 是**用户可创建和管理的**，不再只有内置项
- KnowledgeLibrary **归属**某个 RuleSet，在规则集管理页内创建和上传，不再是全局平铺的独立资产
- PromptProfile 通过 `rule_set_id` 关联到规则集（现有字段，调整为业务上有意义的 1:1 关系）
- 工作空间选择规则集后，继承规则集的知识库集合和提示词——这是运行时行为，不只是 metadata

### PromptProfile 的职责边界

PromptProfile 是**创作风格提示词**，负责：
- 定义 AI 助手的写作腔调、叙事风格、氛围约束
- 不替换专项 Agent 的技术性 system prompt（Director/NPC/Plot 等的硬编码提示词保持不变）
- 作为**前置上下文**注入到每次 Agent 调用，告知当前工作空间的风格期望

具体注入方式：将 PromptProfile 的 `system_prompt` 字段作为额外上下文（prefix）传入 Agent，而不是替换 Agent 自身的 system prompt。

### 知识库与规则集的关系

```
RuleSet
  └── KnowledgeLibrary[]（一对多，归属关系）
        └── KnowledgeDocument / KnowledgeChunk
```

- 知识库**归属**某个规则集，在规则集管理页内创建、上传和管理
- 删除规则集时，其下的知识库也一并删除（或提示用户确认）
- 知识库不跨规则集复用；需要在多个规则集中使用同类资料，需分别上传
- 原有的全局知识库页（`/knowledge`）职责调整：**变为规则集管理页的入口或完全合并**（见 A5 导航调整）

---

## 范围声明

### M9a 当前实现（A 类）

**A1：规则集管理页面**
1. 新增路由 `/settings/rule-sets`，对应 `RuleSetPage.tsx`
2. 规则集列表：展示所有规则集（内置 + 用户创建），每项可展开查看关联的知识库和提示词
3. 创建规则集：弹窗填写名称、描述、风格类型（genre）
4. 编辑规则集：修改名称/描述（内置规则集只读）
5. 删除规则集：删除前检查是否有工作空间依赖（有则提示不可删除）
6. 规则集详情：显示该规则集关联的知识库列表和提示词
7. 在规则集详情内：添加/移除关联知识库（从全局知识库中选择）
8. 在规则集详情内：指定/更换该规则集的提示词（从 PromptProfile 列表选择，或快速新建）

**A2：后端 RuleSet API 补全**
9. `PATCH /rule-sets/{id}` — 编辑规则集名称/描述（内置项拒绝）
10. `DELETE /rule-sets/{id}` — 删除规则集（检查工作空间依赖；有依赖则拒绝，无依赖则级联删除其下知识库）
11. `KnowledgeLibraryORM` 添加 `rule_set_id` 外键（迁移），知识库在创建时必须指定所属规则集
12. 知识库 CRUD API 调整：`POST /knowledge-libraries` 新增必填字段 `rule_set_id`；新增 `GET /rule-sets/{id}/libraries` 按规则集列出知识库
13. `shared-schema` 更新：补充新 API 的 TypeScript 类型

**A3：PromptProfile 接入 Agent 运行时**
14. 修改 `get_workspace_context()`（`workflows/utils.py`）：查询工作空间所属规则集，获取该规则集绑定的 PromptProfile，将其 `system_prompt` 加入 workspace_context
15. 修改 `workflows/create_module.py` 和 `workflows/modify_asset.py`：将 workspace_context 中的 `style_prompt` 作为前置上下文传入各专项 Agent
16. 注入方式：在每个专项 Agent 调用时，将 `style_prompt` 拼接到用户 prompt 的前面（作为系统级风格约束），而非替换 Agent 的 system_prompt 常量

**A4：工作空间知识库来源简化**
17. 修改 `workflows/utils.py`：`get_workspace_context()` 的 `library_ids` 来源改为：该工作空间所属规则集下的所有知识库（直接查 `KnowledgeLibrary.rule_set_id`）+ 工作空间自身的 `WorkspaceLibraryBinding`（额外扩充）
18. 工作空间级别的额外绑定 UI：在 `WorkspaceSettingsPage` 中新增「额外知识库」区域，允许为单个工作空间追加规则集之外的知识库（WorkspaceLibraryBinding 保持现有语义）

**A5：导航与页面整合**
19. 顶部导航：「知识库」入口**合并进规则集页**；「Prompt 配置」独立入口移除；主导航变为「规则集 | 模型配置 | 用量观测」
20. `/knowledge` 路由调整为重定向到 `/settings/rule-sets`，或保留为独立的知识库浏览页（只读展示所有库，不含上传操作）
21. 更新四篇帮助文档，反映新的 UI 结构和操作流程

### M9a 后续扩展（B 类）

- **B1：规则集模板导出/导入** — 将规则集（含知识库配置和提示词）导出为可分享的 JSON 包
- **B2：工作空间继承规则集变更** — 规则集更新时，工作空间可选择同步或保留旧版本
- **B3：规则集版本管理** — 对规则集的历史快照进行追踪

### M9a 明确不做（C 类）

- 规则集市场 / 在线分享
- 多规则集混用（工作空间绑定多个规则集）
- 规则集级别的精细权限控制

---

## UI 改进方向详细设计

### 导航结构调整

**当前导航（顶部 4 项）：**
```
知识库 | 模型配置 | Prompt 配置 | 用量观测
```

**M9a 后导航（顶部 4 项）：**
```
规则集 | 知识库 | 模型配置 | 用量观测
```

说明：
- 「规则集」替代原有独立的「Prompt 配置」入口
- 「知识库」保留，仍为全局知识库管理（上传 PDF、查看分块等），不归属规则集页面
- 规则集详情中通过引用关系连接知识库，操作入口保持分离
- 原「Prompt 配置」路由 `/settings/prompts` 可保留（向后兼容），但不再出现在主导航

### 规则集页面（新建 `/settings/rule-sets`）

**布局：两栏（与知识库页面风格一致）**

```
┌─────────────────────────────────────────────────────────┐
│ 规则集                              [＋ 新建规则集]      │
├──────────────────┬──────────────────────────────────────┤
│ 左侧：规则集列表  │  右侧：选中规则集详情                 │
│                  │                                      │
│ ● 空白规则集     │  【恐怖调查】  [编辑名称] [删除]        │
│ ● 恐怖调查  ←选中│  恐怖调查主题创作框架                  │
│ ● 我的奇幻世界   │                                      │
│                  │  ── 创作风格提示词 ──────────────────│
│                  │  [恐怖调查标准风格]  [更换] [查看/编辑]│
│                  │  "压抑调查氛围，间接恐惧…"            │
│                  │  （无提示词时显示：[指定提示词] 按钮） │
│                  │                                      │
│                  │  ── 关联知识库 ──────────────────────│
│                  │  [＋ 添加知识库]                      │
│                  │  ▪ 恐怖调查核心规则  [移除]            │
│                  │  ▪ 怪物手册参考     [移除]            │
│                  │  （空时提示：暂无关联知识库）           │
└──────────────────┴──────────────────────────────────────┘
```

交互细节：
- 内置规则集（`is_builtin=true`）：名称加「内置」徽章，不显示删除按钮，名称/描述只读；**但可以添加/移除关联知识库和提示词**（内置规则集的内容配置用户可自定义）
- 删除确认弹窗：若有工作空间使用该规则集，显示受影响工作空间列表，禁止删除
- 「更换提示词」弹窗：从 PromptProfile 全局列表中选择（显示名称和 style_notes 摘要）
- 「添加知识库」弹窗：从全局知识库列表中多选（已关联的显示为禁用，避免重复）
- 规则集详情页右侧的提示词卡片：显示 `style_notes`，点击「查看/编辑」跳转到 `/settings/prompts` 对应条目

### 工作空间设置页调整

**新增「额外知识库」区域**，置于「模型路由」之后：

```
── 额外知识库（规则集之外的补充）──
当前规则集「恐怖调查」已关联 2 个知识库（继承，不可在此修改）
[＋ 添加额外知识库]
▪ 我的私有素材库  [移除]
```

说明：
- 规则集继承的知识库以只读方式展示，不可在此移除（需要去规则集管理页调整）
- 工作空间额外绑定的知识库在此管理
- 两者合并后共同作为该工作空间的知识库检索范围

### 创建工作空间弹窗调整

- 规则集选择后，在弹窗内用小字预览规则集摘要（关联知识库数量、提示词名称）
- 帮助用户在创建时就了解规则集的内容，减少误选

---

## 后端改动说明

### 新增数据表：`rule_set_library_bindings`

```python
class RuleSetLibraryBindingORM(Base):
    __tablename__ = "rule_set_library_bindings"
    id           # UUID PK
    rule_set_id  # FK → rule_sets.id
    library_id   # FK → knowledge_libraries.id
    priority     # Integer default 0
    created_at
```

### `RuleSet` 表无 schema 变更

PromptProfile 通过 `rule_set_id` 字段已关联到规则集，无需新增字段。需要注意的是，一个规则集理论上可以有多个 PromptProfile，但实际上应只有一个「活跃」提示词。第一版约束：每个规则集最多绑定一个 PromptProfile（后端 API 在创建 PromptProfile 时检查唯一性，或在查询时取最新一条）。

### `get_workspace_context()` 修改（`workflows/utils.py`）

当前：
```python
return {
    "workspace_name": ws.name,
    "rule_set": ws.rule_set_id,
    "existing_assets": [...],
}
```

M9a 后：
```python
# 1. 查 rule_set 绑定的 PromptProfile
style_prompt = None
pp = db.query(PromptProfileORM).filter_by(rule_set_id=ws.rule_set_id).first()
if pp:
    style_prompt = pp.system_prompt

# 2. 合并知识库 ID：规则集归属的知识库 + 工作空间额外绑定
rs_libs = [lib.id for lib in db.query(KnowledgeLibraryORM).filter_by(rule_set_id=ws.rule_set_id).all()]
ws_libs = [b.library_id for b in db.query(WorkspaceLibraryBindingORM).filter_by(workspace_id=workspace_id, enabled=True).all()]
library_ids = list(dict.fromkeys(rs_libs + ws_libs))  # 去重，保持顺序

return {
    "workspace_name": ws.name,
    "rule_set": ws.rule_set_id,
    "style_prompt": style_prompt,
    "library_ids": library_ids,
    "existing_assets": [...],
}
```

### Agent 风格提示词注入方式

不替换 Agent 的硬编码 system_prompt。在每次专项 Agent 调用时，若 `workspace_context["style_prompt"]` 非空，将其作为 user prompt 的 prefix 注入：

```python
style_prefix = ""
if workspace_context.get("style_prompt"):
    style_prefix = f"[创作风格约束]\n{workspace_context['style_prompt']}\n\n"

prompt = f"{style_prefix}{actual_task_prompt}"
```

这样 Agent 的任务指令保持技术清晰，风格约束作为显式上下文传入，不造成 system_prompt 混乱。

---

## 路由变更

| 变更类型 | 路由 | 说明 |
|---------|------|------|
| 新增 | `/settings/rule-sets` | 规则集管理页（含知识库和提示词管理） |
| 保留 | `/settings/prompts` | PromptProfile 管理页（不再出现在主导航，路由保留供规则集页面跳转） |
| 调整 | `/knowledge` | 重定向至 `/settings/rule-sets`，或保留为只读的知识库浏览视图 |

---

## 与现有 Skill 的冲突点（需同步更新）

以下 skill 中的描述在 M9a 实施后需要调整：

### `trpg-workbench-architecture/SKILL.md`

- **核心业务模型层次关系**：需更新，明确 KnowledgeLibrary 归属 RuleSet（一对多，通过 `rule_set_id` 外键），不再是全局独立资产
- **`workspace_context` 结构**：需说明新增 `style_prompt` 和 `library_ids` 字段
- **设置目录**：`settings/prompt_profiles.json` 已由数据库管理，该条可删除

### `agent-workflow-patterns/SKILL.md`

- **RAG 使用规则**：当前说明知识库通过 `WorkspaceLibraryBinding` 获取，M9a 后来源变为 `workspace_context["library_ids"]`（合并了规则集绑定和工作空间额外绑定），需更新说明
- **风格提示词注入**：新增说明，专项 Agent 在生成内容时应将 `workspace_context["style_prompt"]` 作为 prompt prefix 传入，而非替换 system_prompt

### `frontend-ui-patterns/SKILL.md`

- **页面/路由结构表**：需新增 `/settings/rule-sets` 路由
- **导航结构**：说明顶部导航从「知识库、模型配置、Prompt 配置、用量观测」调整为「规则集、知识库、模型配置、用量观测」

### `asset-schema-authoring/SKILL.md`

- 无需调整（资产结构与规则集管理无直接关联）

---

## Todo

### A1：规则集管理页面（前端）

#### A1.1：路由与骨架
- [ ] 新建 `apps/desktop/src/pages/RuleSetPage.tsx` 和 `RuleSetPage.module.css`
- [ ] 在 `App.tsx` 中注册 `/settings/rule-sets` 路由
- [ ] 调整顶部导航：将「Prompt 配置」替换为「规则集」，保留「知识库」

#### A1.2：规则集列表与详情
- [ ] 左侧列表：展示所有规则集，内置项加徽章
- [ ] 右侧详情：选中规则集后显示关联提示词（可更换）和关联知识库列表（可添加/移除）
- [ ] 创建规则集弹窗（名称、描述、genre）
- [ ] 编辑规则集弹窗（内置项禁用名称/描述编辑）
- [ ] 删除确认弹窗（有依赖工作空间时展示列表并禁止删除）

#### A1.3：规则集知识库绑定 UI
- [ ] 「添加知识库」弹窗：从全局知识库列表多选
- [ ] 「移除知识库」操作
- [ ] 调用 `POST/DELETE /rule-sets/{id}/library-bindings`

#### A1.4：规则集提示词关联 UI
- [ ] 「指定/更换提示词」弹窗：从 PromptProfile 列表选择
- [ ] 「查看/编辑」跳转到 `/settings/prompts`
- [ ] 调用 `PATCH /rule-sets/{id}`（或通过 PromptProfile 的 `rule_set_id` 字段关联）

#### A1.5：工作空间创建弹窗增强
- [ ] 选中规则集后，在弹窗内展示该规则集的知识库数量和提示词名称摘要

### A2：后端 API 补全

- [ ] `PATCH /rule-sets/{id}` — 编辑名称/描述（内置项返回 403）
- [ ] `DELETE /rule-sets/{id}` — 检查工作空间依赖（有依赖返回 409 并附列表）
- [ ] 新建 `RuleSetLibraryBindingORM` 和 Alembic migration
- [ ] `GET /rule-sets/{id}/library-bindings`
- [ ] `POST /rule-sets/{id}/library-bindings`（重复绑定返回 409）
- [ ] `DELETE /rule-sets/{id}/library-bindings/{binding_id}`
- [ ] `shared-schema` 更新：补充新 API 的 TypeScript 类型

### A3：PromptProfile 接入 Agent 运行时

- [ ] 修改 `get_workspace_context()`：查询规则集 PromptProfile 并加入 `style_prompt`
- [ ] 修改 `get_workspace_context()`：合并知识库 ID 列表（规则集绑定 + 工作空间额外绑定）
- [ ] 修改 `create_module.py`：专项 Agent 调用时注入 `style_prompt` 前缀
- [ ] 修改 `modify_asset.py`：同上

### A4：工作空间设置页知识库区域

- [ ] `WorkspaceSettingsPage.tsx` 新增「额外知识库」区域
- [ ] 显示从规则集继承的知识库（只读）
- [ ] 工作空间额外绑定的知识库管理（添加/移除）
- [ ] 调用 `WorkspaceLibraryBinding` 相关 API

### A5：文档与帮助更新

- [ ] 更新 `apps/desktop/src/help/getting-started.md`：反映新导航结构
- [ ] 更新 `apps/desktop/src/help/knowledge-import.md`：修正知识库绑定描述，说明通过规则集关联
- [ ] 新增帮助文档 `rule-set-management.md`：规则集的概念和使用流程
- [ ] 更新 HelpPage 侧边导航，加入新文档入口

---

## 验证步骤

### A1 验证
1. 可创建新规则集，可为其添加知识库和提示词
2. 内置规则集名称不可编辑，但知识库和提示词可配置
3. 有工作空间依赖的规则集无法删除，显示正确提示

### A2 验证
4. `PATCH /rule-sets/{id}` 对内置项返回 403
5. `DELETE /rule-sets/{id}` 在有工作空间依赖时返回 409
6. 规则集知识库绑定 CRUD 全部正常

### A3 验证
7. 工作空间所属规则集有 PromptProfile 时，`workspace_context["style_prompt"]` 非空
8. 触发 `create_module` 工作流后，Agent 收到的 prompt 包含风格前缀
9. 触发 `create_module` 工作流后，知识库检索使用规则集绑定的 library_ids

### A4 验证
10. WorkspaceSettingsPage 显示规则集继承的知识库列表
11. 可为工作空间额外绑定知识库，验证检索时额外知识库也被查询

### A5 验证
12. 帮助文档中不再存在指向不存在 UI 的错误描述
13. 新规则集管理文档内容与实际 UI 一致

---

## 与其他里程碑的关系

```
M9（Smoke Test + 帮助文档）
  └── M9a（规则集统一管理）
        └── M10（规划中）
```

M9a 修复的是 M1–M5 中设计了但未完成连接的功能链路。完成后，整个「规则集 → 知识库 → 提示词 → 工作空间 → Agent」的数据流将完全打通。
