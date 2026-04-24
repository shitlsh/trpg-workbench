---
status: proposed
date: 2026-04-24
source: TRPG System Analysis (CoC / D&D 5e / The One Ring / Delta Green / OSR)
theme: 资产类型枚举覆盖率与跨系统扩展性
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: plan
---

# AssetType / LibraryType 枚举的跨系统覆盖率评估

## 来源与借鉴理由

用户希望 trpg-workbench 能支持多种主流 TRPG 系统，而非仅限于 CoC。本 review 对当前
固定枚举值（`AssetType`、`LibraryType`）进行系统性评估，判断其对以下系统的适配情况：
- 克苏鲁的呼唤（CoC 7e）
- D&D 5e
- The One Ring / LOTR TRPG（魔戒）
- Delta Green（三角机构）
- OSR（老派要典，如 OSE / Cairn）

---

## 当前枚举全览

### AssetType（10 种）
```
outline | stage | npc | monster | location | clue | branch | timeline | map_brief | lore_note
```

### LibraryType（6 种）
```
core_rules | expansion | module_reference | monster_manual | lore | house_rules
```

### 架构关键发现

1. **TypeScript 层有类型，后端无 Enum 约束**：后端 `schemas.py` 中 `type` 字段是 `str`，
   不是 Pydantic `Literal`，数据库层存储为 TEXT，没有 CHECK constraint。
   这意味着写入任意字符串在技术上不会报错——自定义类型的最大阻力不在数据库层。

2. **`ASSET_TYPE_DIRS` 已有降级策略**（`asset_service.py:110`）：
   ```python
   subdir = ASSET_TYPE_DIRS.get(asset_type, asset_type + "s")
   ```
   未知类型自动使用 `{type}s` 作为子目录名，文件系统层已经支持任意类型。

3. **Agent prompt 层是真正的约束**：各 Agent 的 system prompt 中硬编码了资产类型列表
   （如 Document Agent 的格式化规则、Consistency Agent 的检查范围）。添加新 AssetType
   需要同步更新相关 prompt 文件。

---

## 各 TRPG 系统覆盖率分析

### CoC 7e ✅ 覆盖良好

| CoC 概念 | 当前 AssetType | 适配度 |
|---------|--------------|-------|
| 场景/幕次 | `stage` | ✅ 完全适配 |
| 关键 NPC | `npc` | ✅ 完全适配 |
| 怪物/神话生物 | `monster` | ✅ 完全适配 |
| 地点/场所 | `location` | ✅ 完全适配 |
| 线索 | `clue` | ✅ 完全适配 |
| 神话知识/典籍条目 | `lore_note` | ✅ 基本适配 |
| 地图说明 | `map_brief` | ✅ 适配 |
| 剧情分支 | `branch` | ✅ 适配 |
| 时间线 | `timeline` | ✅ 适配 |
| **调查员（PC）** | ❌ 无 | 需要 `player_character` 或 `investigator` |
| **道具/物证（Handout）** | ❌ 无（clue 只是文字线索，不是物理道具） | 需要 `handout` |

**结论**：CoC 是当前 AssetType 的隐性设计标准，覆盖率 ~85%。缺失的两个类型（调查员、道具）
是中等重要性，不阻断 CoC 创作，但会影响完整度。

---

### D&D 5e ⚠️ 覆盖部分，缺失关键类型

| D&D 概念 | 当前 AssetType | 适配度 |
|---------|--------------|-------|
| 遭遇设计 | `stage`（近似）| ⚠️ 凑合可用，但 D&D 遭遇是战术性的，与 CoC 叙事场景语义不同 |
| NPC | `npc` | ✅ |
| 怪物 | `monster` | ✅ |
| 地点/地下城房间 | `location` | ✅ 基本适配 |
| 地图 | `map_brief` | ✅ |
| 世界观 | `lore_note` | ✅ |
| **法术** | ❌ 无 | `spell` 类型缺失 |
| **魔法物品/装备** | ❌ 无 | `item` 类型缺失 |
| **陷阱** | ❌ 无 | `trap` 类型缺失（或归入 `location`？语义模糊） |
| **任务/委托** | ❌ 无 | `quest` 类型缺失 |
| **势力/派系** | ❌ 无 | `faction` 类型缺失 |

**结论**：D&D 5e 覆盖率 ~50%。核心叙事部分可用，但 D&D 的核心资产（法术、物品、陷阱）
完全缺失。用 lore_note 勉强填充这些概念会导致语义混乱。

---

### The One Ring / LOTR TRPG ⚠️ 覆盖基础结构，缺失系统特色

| TOR 概念 | 当前 AssetType | 适配度 |
|---------|--------------|-------|
| 旅途阶段（Journey Stage）| `stage` | ✅ 基本适配 |
| NPC/Fellowship | `npc` | ✅ |
| 怪物/黑暗力量实体 | `monster` | ✅ |
| 地点（Middle-earth locations）| `location` | ✅ |
| 世界观词条 | `lore_note` | ✅ |
| **文化特质/美德（Cultural Virtues）** | ❌ 无 | 系统核心机制，无合适类型 |
| **黯影/腐化积累（Shadow Paths）** | ❌ 无 | 系统特色机制，无合适类型 |
| **旅行事件表** | ❌ 无 | `event_table` 类型缺失 |

**结论**：TOR 的通用叙事部分（NPC、地点、怪物）覆盖良好，但该系统的核心机制特色
（腐化、美德、事件表）在当前 AssetType 中完全无法表达。对 TOR 支持度约 60%。

---

### Delta Green ✅ 覆盖较好，语义可复用

| Delta Green 概念 | 当前 AssetType | 适配度 |
|----------------|--------------|-------|
| 行动简报（Operation Brief）| `outline` | ✅ |
| 场景/地点突袭 | `stage` | ✅ |
| NPC/线人/友军 | `npc` | ✅ |
| 异常实体 | `monster` | ✅ |
| 地点 | `location` | ✅ |
| 证据/线索 | `clue` | ✅ |
| 非自然知识 | `lore_note` | ✅ |
| **特工角色（Agent PC）** | ❌ 无 | 同 CoC 调查员问题 |
| **政府文件/机密档案** | ❌ 无 | `document` 或 `handout` 缺失 |

**结论**：Delta Green 与 CoC 在叙事结构上高度相似（都是调查型），覆盖率约 80%。

---

### OSR ✅ 覆盖基本足够（系统本身极简）

OSR 规则（OSE、Cairn、Mörk Borg 等）天然简化，场景描述、NPC、怪物、地点是主要创作对象，
当前 AssetType 基本满足需求。缺失的 `item`（宝物/魔法物品）是个缺口。

---

## LibraryType 评估

**结论：LibraryType 的设计是系统无关的，覆盖率高。**

| LibraryType | CoC | D&D | TOR | DG | OSR |
|------------|-----|-----|-----|----|----|
| `core_rules` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `expansion` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `module_reference` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `monster_manual` | ✅ | ✅ | ✅（类似）| ✅ | ✅ |
| `lore` | ✅ | ✅ | ✅（重要）| ✅ | ✅ |
| `house_rules` | ✅ | ✅ | ✅ | ✅ | ✅ |

LibraryType 不需要修改，6 种类型足以覆盖所有主流系统的知识库分类需求。

---

## 当前差距

1. **AssetType 对 CoC 以外的系统存在明显语义空白**：`spell`、`item`、`handout`、
   `player_character`、`faction`、`trap`、`quest` 在不同系统中具有重要意义
2. **类型语义复用导致混乱**：用 `lore_note` 装载 D&D 法术，用 `stage` 代替 D&D 遭遇，
   会使资产树在多系统工作区中语义模糊
3. **无用户自定义类型机制**：用户无法在不修改代码的情况下添加系统特定的类型

---

## 适合性判断

**现阶段不建议大幅扩充 AssetType 枚举**，理由：
- 每增加一种 AssetType，都需要：(1) 更新 Document Agent 的格式化 prompt，(2) 更新
  Consistency Agent 的检查范围，(3) 更新前端资产树图标和筛选器
- 扩充枚举和"支持多系统"是两个不同的问题——支持多系统的正确方向是**自定义类型扩展**，
  而不是把所有系统的类型全部塞进一个固定枚举

**更好的方向（分阶段）：**

**Phase A（1.0 前，小改）**：
- 将 `AssetType` 在 TypeScript 中改为 `string`（保留当前值作为"预置类型"）
- 后端 schemas.py 的 `type` 字段本已是 `str`，无需修改
- 前端资产树对未知类型使用通用图标 + 原始标签展示

**Phase B（1.x，计划项）**：
- 引入 RuleSet 级别的"自定义 AssetType 注册表"（per-ruleset asset type config）
- 用户可为某个 RuleSet 注册新类型名称、图标、字段模板
- Agent prompt 通过 `workspace_context` 注入当前工作空间的有效类型列表

---

## 对创作控制感的影响

有。当用户使用 D&D 工作区但只能用 `lore_note` 填写法术时，他们会感到资产组织混乱、
缺乏语义对应，创作控制感下降。

## 对 workbench 协同的影响

有，影响资产树（左栏）的组织结构和筛选体验。语义模糊的类型会使左栏资产树难以导航。

## 对 1.0 用户价值的影响

**Phase A 影响中等**：当前 1.0 用户以 CoC 为主，AssetType 覆盖足够。但若 1.0 期间
有用户尝试其他系统，会卡在类型不匹配上。

**Phase A 的小改风险低**，代码改动量极小（TypeScript 类型放宽 + 前端通用图标降级）。

---

## 建议落地方式

- [x] **Phase A - 直接小改代码**：
  - `packages/shared-schema/src/index.ts`：`AssetType` 改为 `type AssetType = string`，
    同时 `export const BUILTIN_ASSET_TYPES` 枚举当前预置值，供前端图标映射使用
  - `apps/desktop/src/` 资产树组件：对非内置类型用通用图标 + `type` 原始标签
  - 预计改动量：~30 行
- [ ] **Phase B - 新 milestone**：RuleSet 级别自定义 AssetType 注册表，进入 M13 或 M14
- [ ] **暂缓**：扩充内置 AssetType 枚举（`spell`/`item`/`handout` 等），
  触发重新评估的条件：用户反馈明确需要某个系统的完整支持，且 Phase A 宽松化后仍不满足

## 不做的理由

不直接将 `spell`、`item` 等 D&D 特有类型加入 `AssetType` 枚举：
这会使枚举膨胀到 20+ 种，同时每种新类型都需要更新 Agent prompt，
维护成本高但对非 D&D 用户无意义。正确解法是 Phase B 的自定义注册机制。
