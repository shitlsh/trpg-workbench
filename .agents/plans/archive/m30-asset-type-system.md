# M30：资产类型系统重构

**前置条件**：无强依赖（独立数据模型和 prompt 层改动，M29 的 ask_user 规范变化是同方向延续，但无技术依赖）。

**状态：✅ 已完成（2026-04-29）**

**目标**：为每种资产类型引入 description + template_md，让 AI 能准确判断「该创建哪种类型」并生成符合格式的内容；同时将内置类型从 10 种精简到 6 种，并支持自定义类型达到与内置类型同等的 AI 感知能力。

---

## 背景与动机

当前系统存在三个根本性问题：

1. **AI 对「该创建哪种类型」没有判断依据**：内置类型只有名字，没有范围描述，LLM 凭名字猜测。用户请求「创建大纲」时，AI 可能创建 stage / lore_note / outline 中的任意一种，正确率极低。

2. **自定义类型对 AI 完全不透明**：创建自定义类型后 AI 只知道有一个叫 `spell` 的类型，不知道它的用途、必要信息和内容格式，无法有效创建。

3. **模板机制与类型定义脱钩**：章节模板静态硬编码在 `director/system.txt` 里，新增自定义类型时永远无法拥有规范的 AI 感知能力。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：精简内置类型常量（10 → 6 种）**

将内置类型从 10 种精简为 6 种，合并逻辑如下：

| 保留类型 | 中文名 | 合并来源 | 核心范围 |
|---|---|---|---|
| `outline` | 大纲 | outline + lore_note + branch | 整体故事概述、世界背景设定、主要分支结局 |
| `stage` | 场景 | stage + timeline | 故事单元（幕），事件序列、NPC 出场、时间结构 |
| `npc` | NPC | npc | 玩家会交互的人物，含动机、秘密、关系 |
| `monster` | 敌人 | monster | 玩家的威胁，含战斗定位、行为模式、弱点 |
| `map` | 地图 | location + map_brief | 地点网络：有哪些地点、连接方式、移动路径 |
| `clue` | 线索 | clue | 关键物品或事件，与特定 stage 相关，触发条件 |

废弃 4 种：`lore_note`、`branch`、`timeline`、`map_brief`（不迁移，不兼容，0.1a 前无需）。

**A2：新建 asset_types prompt 文件体系**

在 `apps/backend/app/prompts/asset_types/` 新建目录，每个内置类型一个独立 `.txt` 文件，统一格式：

```
# {中文名}（{type_key}）

## 范围与用途
{这个类型是什么、什么时候用、和其他类型的区别}

## 创建前必须提供
{必要信息清单，供 ask_user 触发判断和 create_asset 校验}

## 内容模板
{完整的 frontmatter + Markdown 章节骨架}
```

新建 6 个文件：`outline.txt / stage.txt / npc.txt / monster.txt / map.txt / clue.txt`

**A3：数据库迁移 + ORM + Schema 扩展**

`custom_asset_type_configs` 表新增两列：
- `description TEXT` — 类型的范围说明 + 必要信息清单（可空）
- `template_md TEXT` — 完整 Markdown 章节模板（可空）

ORM、shared-schema 接口、API 端点同步更新。

**A4：Prompt 注入重构**

修改 `director.py` 的 `_build_workspace_snapshot()` 和 `build_director_prompt()`：
- 新增 `_build_asset_types_section()` 函数：动态加载 6 个内置类型的 `asset_types/*.txt` + 自定义类型的 `description` 字段，拼接为结构化的「可用资产类型」注入段
- 修复 Bug：`t.get("name")` → `t.get("label")`（自定义类型名称在快照中显示为空的 bug）

`system.txt`：
- 删除第 162-358 行的静态「资产类型创作规范」大章节（由动态注入取代）
- 删除 `ask_user` 规范里从 M29 写入的「最低信息清单」段落（现已内嵌于各类型文件的「创建前必须提供」）
- 更新工具描述中 `list_assets` 的 `asset_type` 说明（更新为 6 种）

**A5：create_asset 工具类型校验**

`create_asset` 和 `create_assets` 工具新增 `asset_type` 合法性校验：
- 合法范围 = 6 种内置类型 + 当前工作空间注册的自定义 `type_key`
- 不合法时返回结构化错误，附带可用类型列表，提示 AI 修正

**A6：前端自定义类型表单扩展**

`RuleSetPage.tsx` 「添加类型」表单新增 `description` 和 `template_md` 两个输入区（可选填），并在 UI 上提示「不填时 AI 无法感知该类型的创作规范」。

**A7：AI 辅助创建自定义资产类型**

参照 style prompt 的「用户描述 → AI 生成」模式：
- 后端新增 SSE 端点 `POST /rule-sets/{id}/asset-type-configs/generate`
- 新建 prompt 模板 `apps/backend/app/prompts/asset_types/generate.txt`
- 输出：`type_key + label + icon + description + template_md`
- 前端 RuleSetPage 添加「AI 生成」按钮，流式预览 + 手动调整后确认提交

**A8：前端资产类型选择器描述展示**

`AssetTree.tsx` 的 `NewAssetForm` 中，类型选择器每个选项增加 description tooltip 或说明文字；`RuleSetPage` 资产类型列表卡片同步展示 description。

---

### B 类：后续扩展

- **B1：template_md 可视化 Markdown 编辑器**：为自定义类型的 `template_md` 字段提供实时预览的编辑器（当前仅 textarea）
- **B2：类型迁移工具**：将旧类型（lore_note/branch 等）资产批量更改为新类型的 CLI 或 UI 工具（0.1a 后需要时再做）
- **B3：create_asset 自动补全模板**：当 Agent 未提供 `content_md` 时，从 `asset_types/*.txt` 的 `template_md` 段读取默认内容（当前 fallback 模板极简）

### C 类：明确不承诺

- 不提供旧类型资产的自动迁移（0.1a 前无需）
- 不引入 JSON Schema 字段约束（B2/字段模板推迟）
- 不改变资产文件的目录结构（`map` 类型目录名为 `maps/`）
- 不删除已有数据库中旧类型（`lore_note` 等）的资产记录

---

## 文件结构

### 新建文件

```
apps/backend/app/prompts/asset_types/
  outline.txt          — 大纲类型定义
  stage.txt            — 场景类型定义
  npc.txt              — NPC 类型定义
  monster.txt          — 敌人类型定义
  map.txt              — 地图类型定义
  clue.txt             — 线索类型定义
  generate.txt         — AI 生成自定义类型的 prompt 模板

apps/backend/app/db/versions/{hash}_add_description_template_to_asset_type.py
  — Alembic 迁移文件
```

### 修改文件

```
packages/shared-schema/src/index.ts
  — BUILTIN_ASSET_TYPES 精简为 6 种
  — CustomAssetTypeConfig 新增 description/template_md 字段

apps/desktop/src/lib/assetTypeVisual.ts
  — 删除 4 个废弃类型，location 改名为 map，新增 map 定义

apps/desktop/src/components/AssetTree.tsx (或 NewAssetForm)
  — 类型选择器新增 description 展示

apps/desktop/src/pages/RuleSetPage.tsx
  — 自定义类型表单新增 description/template_md 输入
  — 新增「AI 生成」按钮和流式预览

apps/backend/app/models/orm.py
  — CustomAssetTypeConfigORM 新增两列

apps/backend/app/schemas.py
  — CustomAssetTypeConfig / CreateCustomAssetTypeRequest / UpdateCustomAssetTypeRequest 更新

apps/backend/app/api/custom_asset_type_configs.py
  — POST/PATCH 端点支持 description/template_md
  — 新增 /generate SSE 端点

apps/backend/app/api/custom_asset_type_configs.py (新端点)
  — generate 路由

apps/backend/app/agents/director.py
  — _build_asset_types_section() 新函数
  — 修复 t.get("name") Bug
  — build_director_prompt() 注入资产类型段

apps/backend/app/prompts/director/system.txt
  — 删除静态资产类型创作规范大章节
  — 删除 ask_user 规范里的最低信息清单
  — 更新 list_assets 工具描述

apps/backend/app/agents/tools.py
  — create_asset / create_assets 新增类型校验

apps/backend/app/api/custom_asset_type_configs.py
  — _BUILTIN_TYPES 更新为 6 种
```

---

## 关键设计约束

### 资产类型 prompt 文件格式

每个 `asset_types/{type_key}.txt` 文件使用固定的三段式结构，由后端解析函数识别段落边界：

```
# {中文名}（{type_key}）

## 范围与用途
...

## 创建前必须提供
...

## 内容模板
...（从此行到文件末尾均为模板内容）
```

**解析策略**：不做复杂解析，直接将整个文件内容注入 Director prompt；文件本身就是可读的 Markdown，LLM 能直接理解各段语义。

### 动态注入段结构

`_build_asset_types_section()` 生成的注入段格式：

```
## 可用资产类型（创建资产时必须从此列表选择）

### 大纲（outline）
{outline.txt 的完整内容}

### 场景（stage）
{stage.txt 的完整内容}

... （其余内置类型）

### 【自定义】法术（spell）
{description 字段内容}
{template_md 字段内容（若有）}
```

### 类型校验逻辑

```python
valid_types = set(BUILTIN_ASSET_TYPES_6) | {
    c["type_key"] for c in workspace_context.get("custom_asset_types", [])
}
if asset_type not in valid_types:
    return error_response(f"asset_type '{asset_type}' 不合法，可用类型：{sorted(valid_types)}")
```

---

## Todo

### A1：精简内置类型常量

- [x] **A1.1**：`packages/shared-schema/src/index.ts` — `BUILTIN_ASSET_TYPES` 更新为 6 种（outline/stage/npc/monster/map/clue），删除 4 个废弃类型
- [x] **A1.2**：`apps/desktop/src/lib/assetTypeVisual.ts` — 删除 branch/timeline/map_brief/lore_note 的定义，将 location 改名为 map，新增 map 的图标/颜色/标签（保留旧类型的 fallback 渲染，旧资产继续正常显示）
- [x] **A1.3**：`apps/backend/app/api/custom_asset_type_configs.py` — `_BUILTIN_TYPES` 更新为 6 种

### A2：新建 asset_types prompt 文件体系

- [x] **A2.1**：新建 `apps/backend/app/prompts/asset_types/outline.txt`
- [x] **A2.2**：新建 `apps/backend/app/prompts/asset_types/stage.txt`
- [x] **A2.3**：新建 `apps/backend/app/prompts/asset_types/npc.txt`
- [x] **A2.4**：新建 `apps/backend/app/prompts/asset_types/monster.txt`
- [x] **A2.5**：新建 `apps/backend/app/prompts/asset_types/map.txt`
- [x] **A2.6**：新建 `apps/backend/app/prompts/asset_types/clue.txt`

### A3：数据库迁移 + ORM + Schema

- [x] **A3.1**：无 Alembic，直接在 `apps/backend/app/storage/database.py` 的 `_run_migrations()` 追加两条 ALTER TABLE（项目统一使用轻量迁移方式）
- [x] **A3.2**：`apps/backend/app/models/orm.py` — `CustomAssetTypeConfigORM` 新增两个 `Mapped[str | None]` 字段
- [x] **A3.3**：`apps/backend/app/models/schemas.py` — `CustomAssetTypeConfigSchema` / `CustomAssetTypeConfigCreate` / `CustomAssetTypeConfigUpdate` 新增 description/template_md 可选字段
- [x] **A3.4**：`packages/shared-schema/src/index.ts` — `CustomAssetTypeConfig` / `CreateCustomAssetTypeRequest` / `UpdateCustomAssetTypeRequest` 同步新增字段
- [x] **A3.5**：`apps/backend/app/api/custom_asset_type_configs.py` — POST 端点写入新字段；PATCH 端点通过 `model_dump(exclude_none=True)` 自动支持；`apps/backend/app/workflows/utils.py` 将 description/template_md 注入 workspace_context

### A4：Prompt 注入重构

- [x] **A4.1**：`apps/backend/app/agents/director.py` — 新增 `_build_asset_types_section(workspace_context)` 函数，动态加载 6 个 `asset_types/*.txt` + 自定义类型描述
- [x] **A4.2**：`apps/backend/app/agents/director.py` — 修复 `t.get("name")` → `t.get("label")` Bug
- [x] **A4.3**：`apps/backend/app/agents/director.py` — `build_director_prompt()` 中调用 `_build_asset_types_section()` 并追加到 prompt
- [x] **A4.4**：`apps/backend/app/prompts/director/system.txt` — 删除「资产类型创作规范」大章节（从 162 行删到 355 行，减少约 200 行静态内容）
- [x] **A4.5**：`apps/backend/app/prompts/director/system.txt` — 删除 `ask_user` 规范中「常见资产类型最低信息量清单」段落，改为引用类型文件；更新 `list_assets` 工具描述中 `asset_type` 的说明

### A5：create_asset 工具类型校验

- [x] **A5.1**：`apps/backend/app/agents/tools.py` — `create_asset` 工具新增 `asset_type` 合法性校验，不合法返回带可用列表的错误
- [x] **A5.2**：`apps/backend/app/agents/tools.py` — `create_assets` 批量工具同样加入逐项类型校验

### A6：前端自定义类型表单扩展

- [x] **A6.1**：`apps/desktop/src/pages/RuleSetPage.tsx` — 「添加类型」表单新增 `description` 多行文本框 + `template_md` 文本区（均可选填，有提示文案），提交时传递新字段
- [x] **A6.2**：`apps/desktop/src/pages/RuleSetPage.tsx` — 编辑功能当前不存在（A5 文档中无 updateTypeMutation），此条目推迟到 B 类（当前只支持增删，不支持编辑，属于遗留情况）

### A7：AI 辅助创建自定义资产类型

- [x] **A7.1**：新建 `apps/backend/app/prompts/asset_types/generate.txt` — AI 生成自定义类型的 prompt 模板
- [x] **A7.2**：`apps/backend/app/api/custom_asset_type_configs.py` — 新增 `POST /rule-sets/{id}/asset-type-configs/generate` SSE 端点
- [x] **A7.3**：`apps/desktop/src/pages/RuleSetPage.tsx` — 「添加类型」界面新增「AI 生成」模式，含意图输入框、LLM 选择、流式预览、生成后自动填入手动表单供编辑确认提交

### A8：前端资产类型选择器描述展示

- [x] **A8.1**：`apps/desktop/src/components/editor/AssetTree.tsx` — `NewAssetForm` 类型预览区下方展示 description 简短说明；`apps/desktop/src/lib/assetTypeVisual.ts` 新增 `getAssetTypeDescription()` 函数（内置类型有静态描述，自定义类型读 config.description 首行）
- [x] **A8.2**：`apps/desktop/src/pages/RuleSetPage.tsx` — 自定义类型卡片列表展示 description 摘要（首行非标题文字，60 字截断）

---

## 验收标准

1. **类型识别测试**：发送「帮我创建大纲」，Director 应创建 `outline` 类型资产，不应创建 stage / lore_note / branch。
2. **类型校验测试**：Director 尝试调用 `create_asset(asset_type="lore_note", ...)` 时，工具应返回错误提示并列出可用类型。
3. **自定义类型感知测试**：创建一个带有 description + template_md 的自定义类型（如「法术」），发送「帮我创建一个法术」，Director 应创建该类型的资产，且 content 结构符合 template_md 的章节骨架。
4. **AI 生成自定义类型测试**：在 RuleSetPage 输入「我想要一个记录咒文的类型」，AI 应生成合理的 description 和 template_md，可在前端预览和编辑后保存。
5. **前端描述展示测试**：AssetTree 的新建资产类型选择器中，鼠标悬停内置类型应显示 description 摘要。

---

## 与其他里程碑的关系

```
M16（AssetType 开放化，已完成）
  — 建立了 custom_asset_type_configs 表和 API 基础
M29（Agent 交互质量，已完成）
  — ask_user 触发规则（最低信息清单将迁移到资产类型 description）
    └── M30（资产类型系统重构，本 milestone）
          ├── B1：template_md 可视化编辑器（后续）
          ├── B2：类型迁移工具（后续）
          └── B3：create_asset 自动补全模板（后续）
```

---

## 非目标

- 不提供旧类型（lore_note/branch/timeline/map_brief）资产的自动迁移工具
- 不删除数据库中已存在的旧类型资产记录
- 不引入 JSON Schema 字段约束（推迟到 B2）
- 不修改资产文件的目录结构（map 类型目录名为 `maps/`，与当前 location 的 `locations/` 不同，需注意）
- 不修改资产 frontmatter 的 `type` 字段格式
