# M16：AssetType 开放化与自定义类型注册

**前置条件**：无强依赖（独立功能，可与 M17 并行）。

**状态：✅ 已完成（commit 98e121a）**

**目标**：将 `AssetType` 从封闭枚举改为开放字符串，并允许用户在 RuleSet 中注册自定义资产类型（名称、标签、图标），使 trpg-workbench 对 CoC 以外的系统具备基本可用性。

---

## 背景与动机

当前 `AssetType` 是 10 种固定值的 TypeScript 联合类型。分析表明：

- **CoC 覆盖率 ~85%**，D&D 5e ~50%，The One Ring ~60%，Delta Green ~80%
- 用户使用 D&D 或 TOR 工作区时，`spell`、`item`、`handout` 等核心概念无对应类型，只能用语义错误的 `lore_note` 勉强填充
- 后端 `schemas.py` 的 `type` 字段本已是 `str`，数据库无 constraint，文件服务有 fallback；**真正的障碍只在 TypeScript 类型层、前端展示层，以及缺乏注册机制**

来源：`docs/benchmark-reviews/completed/2026-04-24_asset-type-coverage-across-trpg-systems.md`

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：TypeScript AssetType 开放化**

```typescript
// packages/shared-schema/src/index.ts
export type AssetType = string;  // 原联合类型改为 string

export const BUILTIN_ASSET_TYPES = [
  "outline", "stage", "npc", "monster", "location",
  "clue", "branch", "timeline", "map_brief", "lore_note"
] as const;
export type BuiltinAssetType = typeof BUILTIN_ASSET_TYPES[number];

export function isBuiltinAssetType(t: string): t is BuiltinAssetType {
  return (BUILTIN_ASSET_TYPES as readonly string[]).includes(t);
}

// 新增自定义类型配置接口
export interface CustomAssetTypeConfig {
  id: string;
  rule_set_id: string;
  type_key: string;    // 存入数据库的 type 值，如 "spell"
  label: string;       // 展示名称，如 "法术"
  icon: string;        // emoji 或图标 key，如 "✨"
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomAssetTypeRequest {
  type_key: string;
  label: string;
  icon: string;
  sort_order?: number;
}

export interface UpdateCustomAssetTypeRequest {
  label?: string;
  icon?: string;
  sort_order?: number;
}
```

**A2：后端 — custom_asset_type_configs 表与 CRUD API**

数据库（`CREATE TABLE IF NOT EXISTS`，无迁移文件）：
```sql
CREATE TABLE IF NOT EXISTS custom_asset_type_configs (
  id TEXT PRIMARY KEY,
  rule_set_id TEXT NOT NULL,
  type_key TEXT NOT NULL,   -- 存入 assets.type 的值
  label TEXT NOT NULL,      -- 展示名称
  icon TEXT NOT NULL,       -- emoji 或图标标识
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id),
  UNIQUE (rule_set_id, type_key)
);
```

API（挂载在 `/rule-sets/{rule_set_id}/asset-type-configs`）：
- `GET` — 列出该 RuleSet 的所有自定义类型
- `POST` — 创建（type_key 不可与内置类型重名）
- `PATCH /{config_id}` — 更新 label / icon / sort_order
- `DELETE /{config_id}` — 删除

**A3：workspace_context 注入自定义类型列表**

在 `get_workspace_context()` 中追加 `custom_asset_types` 字段：

```python
# apps/backend/app/workflows/utils.py
custom_types = []
if ws.rule_set_id:
    custom_types = [
        {"type_key": c.type_key, "label": c.label, "icon": c.icon}
        for c in db.query(CustomAssetTypeConfigORM)
                   .filter_by(rule_set_id=ws.rule_set_id)
                   .order_by(CustomAssetTypeConfigORM.sort_order)
                   .all()
    ]

return {
    ...
    "custom_asset_types": custom_types,  # 新增
}
```

Director 的 planning prompt 中追加说明：当 `custom_asset_types` 非空时，这些类型也是有效的 `affected_asset_types` 选项。

**A4：前端 — 资产树兼容非内置类型**

- 资产 icon 映射函数：对非内置类型，先查 `CustomAssetTypeConfig`（从 API 获取），有匹配的用其 `icon` 字段；否则用通用 fallback icon
- type badge/label：内置类型用现有中文翻译，自定义类型用 `label` 字段，未注册的类型直接展示 `type_key` 原始字符串
- 资产树筛选器：内置类型分组不变；自定义类型追加在下方；完全未注册的类型归入"其他"分组

**A5：前端 — RuleSet 设置页新增类型管理 UI**

在 RuleSetPage（或规则集设置）中新增"资产类型"标签页：
- 列表展示该 RuleSet 已注册的自定义类型（type_key + label + icon + 排序）
- 每条：icon 输入（纯文本，用户输入 emoji）+ 标签名 + type_key（创建后只读）+ 删除按钮
- "添加类型"按钮 + 简单表单
- 校验：type_key 不可与内置类型重名，提示明确

**A6：前端 — 资产新建 / 类型选择器**

资产新建对话框的 type 下拉：
- 上半部分：内置类型（现有列表）
- 下半部分：当前 RuleSet 的自定义类型（来自 API）
- 两部分用分割线隔开

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：create_module Workflow 自动生成自定义类型资产**：当前 create_module 落盘逻辑（`create_module.py` 第 255-272 行）把类型硬编码在 patch 列表中。让 Workflow 自动感知并生成自定义类型资产需要重构这段逻辑——Director 输出的 `affected_asset_types` 中包含自定义类型时，Workflow 用通用 Document Agent 路由处理。**推迟原因**：需要重构 Workflow 落盘结构，风险较高，1.0 阶段用户可以手动创建自定义类型资产，已足够使用。详见 `docs/benchmark-reviews/deferred/2026-04-24_custom-asset-type-workflow-generation.md`
- **B2：自定义类型的字段模板**：用户可为某个类型定义默认字段结构（JSON schema），Document Agent 格式化时参考。依赖 B1 落地后评估。详见同上 deferred 文件。

### C 类：明确不承诺

- 不扩充内置 `BUILTIN_ASSET_TYPES` 枚举（`spell`/`item` 等不进内置列表，用户通过注册表添加）
- 不为 `create_module` Workflow 提供自定义类型自动生成（B1）
- type_key 创建后不可修改（已有资产引用该 type 值，改了会导致孤儿资产）
- 不提供 RuleSet 级内置类型包（由 B1 完成后再考虑）

---

## 文件结构

### 新增文件

```
apps/backend/app/api/custom_asset_type_configs.py   ← CRUD API
```

### 修改文件

```
apps/backend/app/models/orm.py                      ← 追加 CustomAssetTypeConfigORM
apps/backend/app/models/schemas.py                  ← 追加相关 Pydantic schema
apps/backend/app/storage/database.py                ← 追加建表语句
apps/backend/app/main.py                            ← 注册 router
apps/backend/app/workflows/utils.py                 ← get_workspace_context() 追加 custom_asset_types
apps/backend/app/prompts/director/planning.txt      ← 追加对 custom_asset_types 的说明
packages/shared-schema/src/index.ts                 ← AssetType 开放化 + CustomAssetTypeConfig 类型
apps/desktop/src/                                   ← 资产树 icon/label 兼容、筛选器、新建对话框
apps/desktop/src/pages/RuleSetPage.tsx (或同等)     ← 类型管理 UI 标签页
```

---

## 关键设计约束

### type_key 唯一性校验

创建时后端校验：
```python
# type_key 不可与 BUILTIN_ASSET_TYPES 重名
BUILTIN = {"outline","stage","npc","monster","location","clue","branch","timeline","map_brief","lore_note"}
if body.type_key in BUILTIN:
    raise HTTPException(400, f"'{body.type_key}' 是内置类型，不可注册为自定义类型")
```

### Director 感知注入格式

`planning.txt` 追加段落（仅在 `custom_asset_types` 非空时有效）：
```
当前工作区的自定义资产类型（可在 affected_asset_types 中使用）：
{custom_asset_types_block}
```
`workspace_context` 中的 `custom_asset_types` 由 Workflow 层在构造 Director prompt 时动态注入。

### 前端类型配置缓存

自定义类型配置按 rule_set_id 缓存（TanStack Query），在资产树渲染时不每次重新请求。

---

## Todo

### A1：TypeScript 类型放宽

- [x] **A1.1**：`packages/shared-schema/src/index.ts` — `AssetType` 改为 `string`，新增 `BUILTIN_ASSET_TYPES`、`BuiltinAssetType`、`isBuiltinAssetType()`、`CustomAssetTypeConfig` 及请求类型
- [x] **A1.2**：前端使用了 `AssetType` 做穷举的地方 — 改用 `BuiltinAssetType` 或 `isBuiltinAssetType()` 守卫（`AgentPanel.tsx` 移除 cast，`assetTypeVisual.ts` 改为 `Partial<Record<string, ...>>`）

### A2：后端数据库与 API

- [x] **A2.1**：`database.py` — 追加 `custom_asset_type_configs` 建表语句（实现时通过 ORM `Base.metadata.create_all()` 自动建表，无需手写 SQL）
- [x] **A2.2**：`orm.py` — 追加 `CustomAssetTypeConfigORM`（含 `UniqueConstraint("rule_set_id", "type_key")`）
- [x] **A2.3**：`schemas.py` — 追加 `CustomAssetTypeConfigSchema`、`CustomAssetTypeConfigCreate`、`CustomAssetTypeConfigUpdate`
- [x] **A2.4**：`api/custom_asset_type_configs.py` — GET / POST / PATCH / DELETE 端点，含 builtin 名冲突 400、重复 type_key 409
- [x] **A2.5**：`main.py` — 注册 router，前缀 `/rule-sets/{rule_set_id}/asset-type-configs`

### A3：workspace_context 注入

- [x] **A3.1**：`workflows/utils.py` `get_workspace_context()` — 追加 `custom_asset_types` 字段
- [x] **A3.2**：`prompts/director/planning.txt` — 追加 custom_asset_types 的使用说明

### A4：前端资产树兼容

- [x] **A4.1**：资产 icon/label 映射函数 — 新增 `getCustomTypeEmoji()`，自定义类型优先用 emoji，未注册类型 fallback `Folder` icon + 原始 type_key 字符串
- [x] **A4.2**：资产树筛选器 — 三组分类（内置→自定义→`__other__`），section header 按类型渲染 emoji 或 Lucide icon

### A5：前端 RuleSet 类型管理 UI

- [x] **A5.1**：RuleSetPage — 新增"资产类型"section，展示当前 RuleSet 的自定义类型列表
- [x] **A5.2**：每条类型的显示组件：icon（emoji）+ label + type_key（只读）+ 删除按钮
- [x] **A5.3**："添加类型"按钮与新建表单，含 type_key 冲突提示；builtin RuleSet 只读（隐藏新增/删除按钮）

### A6：前端资产新建对话框

- [x] **A6.1**：资产新建 type 选择器 — 用 `<optgroup>` 分内置/自定义类型（`AssetTree.tsx` `NewAssetForm`）

---

## 验收标准

1. 在 D&D RuleSet 的类型管理页注册 `type_key="spell", label="法术", icon="✨"` 后，在该 RuleSet 的工作区新建资产时可以选择"法术"类型
2. 创建 `type="spell"` 的资产后，资产树展示 ✨ 图标和"法术"标签（不是通用 fallback）
3. 资产树筛选器可以单独筛选"法术"类型资产
4. 尝试注册 `type_key="npc"` 等内置类型时，后端返回 400 错误，前端提示明确
5. 不存在自定义类型的工作区，所有现有功能与修改前完全一致
6. `workspace_context["custom_asset_types"]` 正确包含当前 RuleSet 的自定义类型列表
7. TypeScript 编译无错误，原有 10 种内置类型的展示行为不变

---

## 与其他里程碑的关系

```
M15（知识库归属规则集）
  ├── M16（AssetType 开放化与自定义类型注册）← 本 milestone
  │     └── M18+（B1：create_module 自动生成自定义类型资产）
  └── M17（用户自定义 Agent Skill）← 可并行
```

---

## 非目标

- 不修改 `create_module` Workflow 的 patch 列表生成逻辑（B1，推迟）
- 不扩充内置类型枚举（正确方式是用户自行注册）
- type_key 创建后不可修改（数据完整性保护）
- 不提供类型字段模板（B2，推迟）
