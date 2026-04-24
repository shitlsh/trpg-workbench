# M16：AssetType 开放化与跨系统资产树兼容

**前置条件**：无强依赖（纯 TypeScript 类型放宽 + 前端降级展示，不依赖后端新功能）。

**目标**：将 `AssetType` 从封闭枚举改为开放字符串类型，使资产树对任意 type 值具备基本展示能力，为后续多系统支持打基础。

---

## 背景与动机

当前 `AssetType` 是 TypeScript 联合类型枚举（10 种固定值），前端所有 icon 映射、筛选逻辑均假设 type 值在这 10 种内。然而：

1. 后端 `schemas.py` 中 `type` 字段本已是 `str`，数据库层无 constraint
2. `asset_service.py` 的 `ASSET_TYPE_DIRS` 已有 `asset_type + "s"` 降级策略
3. 真正阻止跨系统使用的只是 TypeScript 类型层和前端 icon 映射层

用户若想在 D&D 工作区中使用 `spell` 类型资产（通过 API 创建），前端会出现类型错误或 icon 渲染崩溃。本 milestone 修复这个问题。

来源：`docs/benchmark-reviews/accepted/2026-04-24_asset-type-coverage-across-trpg-systems.md`（Phase A）

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：TypeScript AssetType 改为开放字符串 + 保留内置常量**

方案：
- `packages/shared-schema/src/index.ts`：`AssetType` 改为 `type AssetType = string`
- 同文件新增：`export const BUILTIN_ASSET_TYPES = ["outline", "stage", "npc", "monster", "location", "clue", "branch", "timeline", "map_brief", "lore_note"] as const`
- 前端所有使用 `AssetType` 做 `===` 判断的地方改为从 `BUILTIN_ASSET_TYPES` 检查

**A2：前端资产树 / icon 映射降级处理**

方案：
- 找到前端 icon 映射函数（通常是 `switch(asset.type)` 或 `Record<AssetType, Icon>`）
- 将 `default` / fallback 改为返回通用图标（如 `FileText` 或现有的通用资产图标）
- 资产名称旁的 type badge 对非内置类型展示原始 type 字符串（不做翻译/映射）

**A3：前端资产树筛选器兼容**

方案：
- 资产树的 type 筛选器目前只列出 `BUILTIN_ASSET_TYPES`；行为保持不变
- 若工作区中存在非内置类型的资产，筛选器底部追加"其他类型"分组，或列出实际存在的非内置类型值
- 不要求精美 UI，能正确筛选即可

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：RuleSet 级别自定义 AssetType 注册表**：用户可为某个 RuleSet 注册新类型名称、图标、字段模板，Agent prompt 通过 `workspace_context` 注入有效类型列表。进入 M17 或更晚。
- **B2：扩充内置 AssetType 枚举**（`spell`/`item`/`handout` 等）：等用户明确反馈需要，且 B1 机制上线后评估是否仍有必要。

### C 类：明确不承诺

- 不修改后端任何 Python 文件（后端已天然支持任意 type）
- 不为非内置类型自动生成 Agent prompt 的格式化规则（Document Agent 只处理内置类型）
- 不引入数据库迁移

---

## 文件结构

### 修改文件

```
packages/shared-schema/src/index.ts
  ← AssetType 改为 string，新增 BUILTIN_ASSET_TYPES 常量

apps/desktop/src/components/
  ← 找到 asset type → icon 映射，增加 fallback 处理

apps/desktop/src/pages/ 或 components/
  ← 资产树筛选器，兼容非内置类型分组展示
```

---

## 关键设计约束

### 类型兼容性

```typescript
// Before
export type AssetType = "outline" | "stage" | "npc" | ...;

// After
export type AssetType = string;
export const BUILTIN_ASSET_TYPES = [
  "outline", "stage", "npc", "monster", "location",
  "clue", "branch", "timeline", "map_brief", "lore_note"
] as const;
export type BuiltinAssetType = typeof BUILTIN_ASSET_TYPES[number];

// 工具函数（可选，按需添加）
export function isBuiltinAssetType(t: string): t is BuiltinAssetType {
  return (BUILTIN_ASSET_TYPES as readonly string[]).includes(t);
}
```

### Icon 映射降级

```typescript
function getAssetIcon(type: string): IconComponent {
  const iconMap: Record<BuiltinAssetType, IconComponent> = {
    npc: UserIcon,
    monster: SkullIcon,
    // ... 其余内置类型
  };
  return iconMap[type as BuiltinAssetType] ?? FileTextIcon; // fallback
}
```

---

## Todo

### A1：TypeScript 类型放宽

- [ ] **A1.1**：`packages/shared-schema/src/index.ts` — 将 `AssetType` 改为 `string`，新增 `BUILTIN_ASSET_TYPES` 常量和 `BuiltinAssetType` 类型别名
- [ ] **A1.2**：前端中使用了 `AssetType` 做穷举判断的地方（如 `switch` 或 Record key）— 改用 `BuiltinAssetType` 或 `isBuiltinAssetType()` 守卫

### A2：Icon 映射降级

- [ ] **A2.1**：找到资产 icon 映射函数 — 确认 fallback 分支存在，对非内置 type 返回通用 icon
- [ ] **A2.2**：资产树中 type badge/label 展示 — 非内置类型展示原始字符串，不报错/不空白

### A3：资产树筛选器

- [ ] **A3.1**：资产树 type 筛选器 — 检查是否硬编码了内置类型列表；若有，改为从实际数据动态生成，确保非内置类型资产可被筛选到

---

## 验收标准

1. 通过 API 直接创建一个 `type = "spell"` 的资产后，前端资产树能正确显示该资产（通用 icon + "spell" label），不报 TypeScript 错误，不渲染崩溃
2. 资产树筛选器能筛选出 `type = "spell"` 的资产（归入通用分组或直接列出）
3. 原有 10 种内置类型的 icon、label、筛选行为与修改前完全一致
4. `packages/shared-schema/src/index.ts` 中 `BUILTIN_ASSET_TYPES` 导出正常，前端可 import 使用
5. 后端无任何修改，后端测试（若有）全部通过

---

## 与其他里程碑的关系

```
M15（知识库归属规则集）
  └── M16（AssetType 开放化）← 本 milestone
        └── M17+（B1：RuleSet 级自定义 AssetType 注册表，待规划）
```

---

## 非目标

- 不为非内置类型提供 Agent 创作支持（Document Agent 格式化仍只处理内置类型）
- 不引入 RuleSet 级 AssetType 注册表（B1，留给后续 milestone）
- 不修改后端 Python 代码（后端已支持）
- 不扩充内置类型列表（不加 `spell`/`item` 等）
