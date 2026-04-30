# M31：Chunk 类型系统重构

**前置条件**：M30 完成（ChunkType 分类体系先例、`_build_asset_types_section()` 注入模式可参照）。

**目标**：将 ChunkType 从维度混乱的 6 种精简为语义统一的 5 种（+none），将定义通过 `_build_chunk_types_section()` 注入到所有使用知识库的 Agent 上下文中，并新增 `consult_lore` 工具补全规则/叙事双路检索，消除各模型对 chunk type 含义理解不对齐的问题。

---

## 背景与动机

当前 `ChunkType`（`app/knowledge/types.py`）存在两个核心问题：

**问题一：维度不统一，分类易混淆**

| 类型 | 问题 |
|---|---|
| `table` | 格式维度（以表格为主），与其他内容维度类型不正交；一张装备数值表同时是 `table` 也是 entity 数据，歧义大 |
| `lore` vs `flavor` | 两者均为叙事/背景，区别（"有无规则信息"）在实际文本中极难判断，LLM 大概率随机选择 |
| `procedure` vs `rule` | 战斗流程/操作步骤本质是规则的子集，LLM 归类结果不稳定 |
| `example` | 范例总是规则或实体的附属，独立成类意义不大 |

**问题二：定义未传递给使用知识库的 Agent**

- `toc_analyzer.py` 中 valid set 为**硬编码内联字符串**，与 `types.py` 没有导入关系
- Director、Skill Agent、Consistency Agent 等从未见过 ChunkType 定义，依赖猜测
- `LORE_CHUNK_TYPES` 定义后从未被使用（无 `consult_lore` 工具）

新分类基于实际导入内容（核心规则书、怪物手册、官方/同人模组、跑团日志）的语义，统一为**内容维度**分类，参照 M30 的 `_build_asset_types_section()` 注入模式。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：重定义 ChunkType enum（`types.py`）**

新的 5 种类型（+ none）：

| 值 | 中文 | 含义 | 典型内容 |
|---|---|---|---|
| `rule` | 规则系统 | 可执行规则正文：技能定义、检定机制、战斗规则、分步流程 | 核心规则书规则章节、流程说明 |
| `entity` | 游戏实体 | 怪物/物品/装备/NPC 数值数据块，以结构化数据为主 | 怪物手册条目、装备清单、技能数值表 |
| `lore` | 世界观背景 | 世界设定、历史叙述、背景故事、氛围文字等非规则叙述 | 背景章节、世界观设定、叙事引文 |
| `adventure` | 冒险剧情 | 模组场景描述、遭遇设定、剧情说明、GM 指引、跑团日志 | 官方/同人模组正文、场景描述、冒险路线 |
| `appendix` | 辅助资料 | 索引、术语表、版权页、参考文献、作者前言等导航/辅助内容 | 书末索引、版权声明、词汇表 |
| `none` | 无分类 | 目录页、封面、空白页、无法明确归类的内容 | 目录导航页、封面、章节过渡页 |

删除的类型：`example`（归入 `rule` 或 `entity`）、`table`（归入 `entity`）、`procedure`（归入 `rule`）、`flavor`（归入 `lore`）。

新分组：
```python
RULE_CHUNK_TYPES = ["rule", "entity"]
LORE_CHUNK_TYPES = ["lore", "adventure"]
```

**A2：添加 `_build_chunk_types_section()` 函数（`types.py`）**

参照 M30 的 `director.py:_build_asset_types_section()` 模式，在 `types.py` 中实现：

```python
def _build_chunk_types_section() -> str:
    """生成 chunk type 枚举说明段落，供注入各 Agent system prompt。"""
    # 返回包含每个类型的中文名、英文值、含义说明的格式化文本
    # none 类型单独说明其在检索中作为兜底的语义
```

输出格式示例：
```
## 知识库内容分类（Chunk Types）

知识库中的每个内容块（chunk）带有一个语义类型标签：

- **rule**（规则系统）：可执行规则正文，包括技能定义、检定机制、战斗规则、操作流程等。
- **entity**（游戏实体）：怪物、装备、物品、NPC 等结构化数值数据块。
- **lore**（世界观背景）：世界设定、历史叙述、背景故事、氛围文字等叙述性内容。
- **adventure**（冒险剧情）：模组场景、遭遇设定、剧情描述、GM 指引、跑团日志等剧情类内容。
- **appendix**（辅助资料）：索引、术语表、版权页、参考文献等导航或辅助性内容。
- **none**（无分类）：目录页、封面等无法明确归类的内容；检索时作为兜底候选保留。

检索规则类内容时使用 rule + entity；检索叙事/剧情内容时使用 lore + adventure。
```

**A3：更新 `toc_analyzer.py` 的三处提示词**

- `prompts/toc_analyzer/system.txt`（PDF TOC 分析）：更新枚举列表
- `prompts/toc_analyzer/chm_classify_system.txt`（CHM 批量分类）：更新枚举列表
- `toc_analyzer.py` 中的 hardcoded valid set（`parse_pdf_toc_response` 和 CHM 对应函数）：改为从 `types.py` 动态导入，不再内联

**A4：注入 Director agent system prompt**

在 `apps/backend/app/agents/director.py` 中找到 `_build_asset_types_section()` 的注入位置，同位置追加 `_build_chunk_types_section()` 的输出，让 Director 在规划知识库检索时理解各类型的语义。

**A5：更新 `consult_rules` 工具描述（`tools.py`）**

在 `consult_rules` 工具的 docstring / 描述字符串中补充：
- 说明 `RULE_CHUNK_TYPES = ["rule", "entity"]` 的语义
- 说明 `none` 类型 chunk 作为兜底仍会被包含在结果中

**A6：检查并更新其他 skill/agent 的 system prompt**

搜索 `apps/backend/app/prompts/` 和 `apps/backend/app/agents/` 中所有引用 chunk type / knowledge retrieval 的 prompt 文件，确保：
- 引用 ChunkType 的地方使用新枚举值
- 有必要的注入 `_build_chunk_types_section()` 的地方已注入

**A7：同步 shared-schema TypeScript 类型**

更新 `packages/shared-schema/src/index.ts` 中对应的 ChunkType union 类型，与后端 Python enum 保持一致。

**A8：验证 `retriever.py` none 类型兜底行为**

当前 `retriever.py:88-90` 的逻辑：
```python
chunk_type = hit.get("chunk_type") or None
# Apply type filter: chunks with no type are conservatively included
if type_filter and chunk_type and chunk_type not in type_filter:
    continue
```

`none` 值在此逻辑中会被当作有类型的非目标 chunk 而**过滤掉**（因为 `"none"` 是 truthy 字符串）。需要修正为：`none` 类型也应作为兜底保留，与 `chunk_type` 为 null/空 的行为一致。

修正方案：
```python
# chunk_type 为空或为 "none" 时作为兜底保留
effective_type = chunk_type if chunk_type and chunk_type != "none" else None
if type_filter and effective_type and effective_type not in type_filter:
    continue
```

> **注意**：`retriever.py:105-114` 的全局 fallback（type_filter 完全无命中时递归调用无 filter）保持不变，不需要改动。

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：前端知识库预览页的 chunk type 标签展示更新**：在 chunk 预览 UI 中同步展示新的类型标签中文名

### C 类：明确不承诺

- 不做历史数据迁移（0.1a 阶段，旧 chunk_type 值将保留在 jsonl/索引中，重建库时自动更新）
- 不做前端 chunk type 选择/编辑 UI（chunk type 是 ingest 时自动打标的内部分类）

---

## 文件结构

### 修改文件

```
apps/backend/app/knowledge/types.py              # A1: 重定义枚举 + A2: 添加 _build_chunk_types_section()
apps/backend/app/knowledge/retriever.py          # A8: none 类型兜底修正
apps/backend/app/knowledge/toc_analyzer.py       # A3: 从 types.py 导入 valid set（不再内联）
apps/backend/app/prompts/toc_analyzer/system.txt         # A3: 更新枚举列表
apps/backend/app/prompts/toc_analyzer/chm_classify_system.txt  # A3: 更新枚举列表
apps/backend/app/agents/director.py              # A4: 注入 _build_chunk_types_section()
apps/backend/app/agents/tools.py                 # A5: 更新 consult_rules 描述 + A9: 新增 consult_lore
packages/shared-schema/src/index.ts             # A7: 同步 TypeScript 类型
```

### 可能涉及的 prompt 文件（A6 排查范围）

```
apps/backend/app/prompts/                        # 全部扫描，更新引用旧 chunk type 值的文件
```

---

## 关键设计约束

### none 类型的检索语义

`none` 类型是**内容无法归类**的兜底标记，在检索时应与 `chunk_type` 为 null 的行为一致：**始终作为候选保留，不被 type_filter 过滤**。这确保了目录页边的正文附近的内容（可能被误打标为 none）不会在检索中消失。

### types.py 作为单一来源

所有代码中引用 ChunkType 枚举值的地方（toc_analyzer.py 的 valid set、tools.py 的过滤列表、director.py 的注入函数）都必须从 `types.py` 导入，禁止在其他文件中硬编码枚举字符串。

### 不破坏现有检索行为

`retriever.py` 的两条兜底规则必须保留：
1. `chunk_type` 为 null/空 的 chunk 保守包含（已有，扩展至 `none`）
2. type_filter 完全无命中时递归 fallback 到无 filter（已有，不改动）

---

## Todo

### A1：重定义 ChunkType enum

- [ ] **A1.1**：`app/knowledge/types.py` — 将 enum 改为 `RULE / ENTITY / LORE / ADVENTURE / APPENDIX / NONE`，删除 `EXAMPLE / TABLE / PROCEDURE / FLAVOR`
- [ ] **A1.2**：`app/knowledge/types.py` — 更新 `RULE_CHUNK_TYPES = ["rule", "entity"]` 和 `LORE_CHUNK_TYPES = ["lore", "adventure"]`

### A2：添加 `_build_chunk_types_section()`

- [ ] **A2.1**：`app/knowledge/types.py` — 实现 `_build_chunk_types_section()` 函数，输出标准中文描述段落，包含每个类型的中英文名、含义说明、`none` 的兜底语义说明

### A3：更新 toc_analyzer

- [ ] **A3.1**：`app/prompts/toc_analyzer/system.txt` — 更新 `suggested_chunk_type` 枚举注释为新的 5 种
- [ ] **A3.2**：`app/prompts/toc_analyzer/chm_classify_system.txt` — 更新 CHM 分类枚举注释为新的 5 种
- [ ] **A3.3**：`app/knowledge/toc_analyzer.py` — `parse_pdf_toc_response` 中的 `valid_chunk_types` 改为从 `types.py` 导入（`{t.value for t in ChunkType}`）
- [ ] **A3.4**：`app/knowledge/toc_analyzer.py` — CHM 对应的 `valid` set 同样改为从 `types.py` 导入

### A4：注入 Director system prompt

- [ ] **A4.1**：`app/agents/director.py` — 找到 `_build_asset_types_section()` 的使用位置，同位置调用 `_build_chunk_types_section()` 并注入

### A5：更新 consult_rules 工具描述

- [ ] **A5.1**：`app/agents/tools.py` — 在 `consult_rules` 工具定义中补充 `RULE_CHUNK_TYPES` 语义说明，注明 `none` 类型作为兜底的行为

### A6：排查其他 prompt 文件

- [ ] **A6.1**：搜索 `app/prompts/` 全目录，定位引用旧 chunk type 值（`example/table/procedure/flavor`）的 prompt 文件并更新

### A7：同步 TypeScript 类型

- [ ] **A7.1**：`packages/shared-schema/src/index.ts` — 更新 `ChunkType` union 为 `"rule" | "entity" | "lore" | "adventure" | "appendix" | "none"`

### A8：修正 retriever.py none 类型兜底

- [ ] **A8.1**：`app/knowledge/retriever.py` — 修正 type_filter 逻辑，使 `chunk_type == "none"` 与 `chunk_type == null` 等价处理（均作为兜底保留）

### A9：新增 consult_lore 工具

- [ ] **A9.1**：`app/agents/tools.py` — 参照 `consult_rules` 实现 `consult_lore` 工具，使用 `LORE_CHUNK_TYPES = ["lore", "adventure"]` 过滤，面向世界观/剧情类检索
- [ ] **A9.2**：`app/agents/tools.py` — 将 `consult_lore` 注册到对应 agent tool list（与 `consult_rules` 相同的注册位置）

---

## 验收标准

1. `types.py` 中 `ChunkType` enum 仅包含 `rule / entity / lore / adventure / appendix / none` 六个值，`RULE_CHUNK_TYPES = ["rule", "entity"]`，`LORE_CHUNK_TYPES = ["lore", "adventure"]`
2. `toc_analyzer.py` 中不再有内联的 valid set 字符串，均从 `types.py` 动态生成
3. PDF TOC 分析和 CHM 分类的 system prompt 中的枚举说明与新定义一致
4. Director 的 system prompt 动态内容包含 chunk types 说明段落
5. 对一个 `chunk_type = "none"` 的 chunk，当 `type_filter = ["rule"]` 时，该 chunk 不被过滤（作为兜底保留）
6. shared-schema TypeScript 类型与 Python enum 一致
7. 在 Python 代码中 grep `"example"\|"table"\|"procedure"\|"flavor"` 不再有与 ChunkType 相关的硬编码字符串
8. `consult_lore` 工具存在且可被 Agent 调用，使用 `LORE_CHUNK_TYPES` 过滤检索结果

---

## 与其他里程碑的关系

```
M30（资产类型系统重构）→ 提供 _build_asset_types_section() 注入模式参照
  └── M31（Chunk 类型系统重构）← 本 milestone
        └── B1：前端 chunk type 标签展示（后续）
```

---

## 非目标

- 不迁移历史 chunk 数据（重新 ingest 文档自动获得新标签）
- 不为 chunk type 添加前端 UI 管理入口
- 不做多维度 chunk 标签（当前单类型单标签足够）
