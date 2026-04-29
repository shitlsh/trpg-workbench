---
name: asset-schema-authoring
description: 约束 trpg-workbench 中所有结构化资产的格式、命名、字段和版本管理规范。当创建或修改任何资产文件时必须加载本 skill，包括：新建 NPC/怪物/场景/地点/线索等任意类型资产、编写 frontmatter 字段、处理 AssetRevision、设计资产字段结构，或讨论资产存储格式时。
---

# Skill: asset-schema-authoring

## 用途

本 skill 约束 `trpg-workbench` 中所有结构化资产的创建、格式、命名和版本管理规范。**每次生成或修改资产时都必须遵守本 skill。**

---

## 核心原则

**每个资产是一个单文件：`{slug}.md`，包含 YAML frontmatter + Markdown body。**

```markdown
---
type: npc
name: Arthur Hale
slug: mayor-arthur
status: draft
version: 3
summary: 镇长，表面亲和，实则掩盖旧案
---

# Arthur Hale

## 概述
温和可靠的镇长，掩盖十五年前的失踪案...
```

### 真相源规则

**文件系统是真相源，SQLite 是可重建的缓存索引。**

- 资产的所有信息（元数据 + 内容）都在单个 `.md` 文件中
- frontmatter 中的字段是结构化元数据，Markdown body 是人类可读内容
- SQLite 中的 AssetORM 只是缓存索引（file_path、file_hash、type、slug 等），可从文件完全重建
- Agent 修改资产时，直接修改 `.md` 文件（frontmatter + body），然后触发 sync 更新缓存

---

## Convention + Tolerance 策略

- **资产类型由 frontmatter `type` 字段决定，不由目录决定**
- 应用写入时按惯例存入 `{type}/` 目录
- 读取时递归扫描整个工作空间，接受文件放在任意位置
- 有 frontmatter 但缺少 `type` → 诊断错误（IDE Problems 风格）
- 无 frontmatter → 静默忽略（用户笔记）
- 不预建 type 目录 — 只在首次写入该类型资产时创建

---

## 资产类型与惯例目录

> **M30 更新**：内置类型从 10 种精简为 6 种。已废弃 `location`、`branch`、`timeline`、`map_brief`、`lore_note`（已有此类型的旧资产继续可读，但 AI 不再创建这些类型）。

| type 值 | 惯例目录 | 说明 |
|---------|---------|------|
| `outline` | `outlines/` | 整体故事框架，含世界背景和分支结局（原 outline + lore_note + branch 合并） |
| `stage` | `stages/` | 故事单元（幕），含事件序列和 NPC 出场（原 stage + timeline 合并） |
| `npc` | `npcs/` | 玩家会直接交互的人物角色 |
| `monster` | `monsters/` | 玩家的威胁来源（怪物/异常实体/敌人） |
| `map` | `maps/` | 地点网络和连接路径（原 location + map_brief 合并） |
| `clue` | `clues/` | 可被玩家发现的关键信息载体 |
| `{custom}` | `{custom}s/` | 用户在 RuleSet 中注册的自定义类型 |

每种内置类型的完整规范（范围说明 + 必要信息 + Markdown 模板）位于：
`apps/backend/app/prompts/asset_types/{type_key}.txt`

新建资产时，Director 会先调用 `get_asset_type_spec(type_key)` 工具获取完整规范，再编写 `content_md`。

---

## 命名规范

```
格式：{slug}.md（不含 type 前缀）

示例：
  mayor-arthur.md        → 放在 npcs/ 下
  deep-one-elder.md      → 放在 monsters/ 下
  act1-village-arrival.md → 放在 stages/ 下
  arkham-town.md         → 放在 maps/ 下
```

**slug 规范**：
- 全小写
- 单词间用 `-` 连接
- 不使用中文、空格、下划线
- 尽量简短但有辨识度

---

## Frontmatter 必填字段（所有资产类型）

```yaml
---
type: string      # 对应上方 type 值
name: string      # 显示名称，可用中文
slug: string      # 文件名中的 slug 部分
status: draft | review | final
version: integer  # 从 1 开始，每次落盘递增
summary: string   # 一两句话摘要，供 Director Agent 决策时快速读取
---
```

---

## 各资产类型 frontmatter 扩展字段示例

### NPC

```yaml
---
type: npc
name: Arthur Hale
slug: mayor-arthur
status: draft
version: 1
summary: 镇长，表面亲和，实则掩盖旧案，是核心对抗势力之一
role: 镇长
public_persona: 温和可靠
hidden_truth: 掩盖十五年前的失踪案
motivation:
  - 维持秩序
  - 保护名誉
relationships:
  - target: doctor-elsa
    type: alliance
    note: 共谋隐瞒旧案
appearance_brief: 中年，衣着体面，神色疲惫
dialogue_style: 克制、官方、绕弯子
secrets:
  - 知道失踪案真相
  - 与 Elsa 有旧约
---
```

### Monster / 实体

```yaml
---
type: monster
name: 深海长老
slug: deep-one-elder
status: draft
version: 1
summary: 深海长老，认知污染型威胁，不直接杀伤但会摧毁理智
concept: 克苏鲁神话深海种族的高阶个体
behavior_pattern: 潜伏、引导、精神污染，不直接攻击
threat_type: cognitive_corruption
threat_level: lethal
abilities:
  - telepathy
  - shape_shifting
  - fear_aura
---
```

### Stage / 场景

```yaml
---
type: stage
name: 第一幕：抵达村庄
slug: act1-village-arrival
status: draft
version: 1
summary: 玩家抵达小镇，初步感受压抑氛围，获得第一条线索
act: 1
mood: 压抑、雨天、村民警惕
objectives:
  - 建立背景氛围
  - 引入第一条线索
key_npcs:
  - mayor-arthur
  - innkeeper-tom
key_locations:
  - village-square
  - inn
clues_available:
  - missing-persons-poster
---
```

### Map / 地图（含地点网络）

> M30 起 `location` 和 `map_brief` 合并为 `map` 类型，描述地点网络和连接路径。

```yaml
---
type: map
name: 废弃灯塔区域
slug: old-lighthouse-area
status: draft
version: 1
summary: 海崖边废弃灯塔及周边地点，藏有推进主线的隐秘线索
description_brief: 建于1890年代，海崖边，长期废弃，海鸟聚集
atmosphere: 荒凉、潮湿、隐约有腐烂气息
accessible_in_stages:
  - act2-cliffside
hidden_elements:
  - 地下密室入口
  - 旧日记碎页
danger_level: moderate
---
```

---

## AssetRevision 规范（必须遵守）

每次落盘都要创建一份 revision 快照文件，保存在 `.trpg/revisions/{slug}/v{N}.md`。

快照文件是资产文件的**完整副本**（包含 frontmatter + body），不是 diff。

**revision 约束**：
- `version` 从 1 开始，每次递增
- 快照文件不可删除，只能追加
- `change_summary` 和 `source_type` 记录在 AssetRevisionORM 中（缓存索引）
- `source_type` 必须标明来源：`agent`（AI 生成）或 `user`（用户手动编辑）
- AssetRevisionORM 不存储 content — 内容在快照文件中

---

## 跨资产引用规范

资产之间相互引用时，使用 **slug** 引用（不再使用 `{type}_{slug_underscored}` 格式的 asset_id）。

### 引用统一使用 slug

```yaml
# 正确
key_npcs:
  - mayor-arthur
  - innkeeper-tom

# 错误
key_npcs:
  - 镇长Arthur
  - npc-mayor-arthur.md
```

### relationships 数组中的引用

NPC 关系网中的 `target` 字段也使用 slug：

```yaml
relationships:
  - target: doctor-elsa
    type: alliance
    note: 共谋隐瞒旧案
```

---

## Markdown Body 结构规范

frontmatter 之后的 Markdown body 应有固定的标题结构：

### NPC

```markdown
# {名称}

## 概述
（一两句话，和 frontmatter summary 保持一致）

## 外在形象

## 动机

## 秘密

## 关系网

## 与玩家的互动建议
```

### Monster

```markdown
# {名称}

## 概念与来源

## 外形描述

## 行为模式

## 威胁表现

## 规则适配建议
```

### Stage

```markdown
# {名称}

## 场景概述

## 氛围描述

## 可用线索

## 关键 NPC 行为

## 分支出口
```

---

## 禁止事项

- 禁止创建双文件（JSON + MD）— 资产只有一个 `.md` 文件
- 禁止 frontmatter 缺少 `type` 或 `summary` 字段
- 禁止 revision 快照文件被删除或覆盖
- 禁止 slug 使用中文或空格
- 禁止跨资产引用使用自然语言名称或文件名，必须使用 slug
- 禁止绕过 frontmatter 在 DB 中存储资产内容（DB 只是缓存索引）

## 版权合规约定

**禁止在内置数据、seed 数据、帮助文档、UI 文案、skill 文档中直接引用任何受版权保护的具体 TRPG 品牌名称或规则系统名称。**

具体禁止事项：
- 禁止在内置规则体系（`seed.py`）、Prompt Profile、帮助文档、UI 占位文字中出现"COC"、"Call of Cthulhu"、"克苏鲁的呼唤"、"D&D"、"Dungeons & Dragons"等受商标/版权保护的游戏系统名称
- 禁止内置 Prompt 中引用特定游戏的专有机制名称（如"理智值 SAN"、"BRP 系统"等与特定商业产品强绑定的术语）

允许的做法：
- 使用通用风格描述代替品牌名称，例如：
  - "恐怖调查" 代替 "COC/克苏鲁的呼唤"
  - "奇幻冒险" 代替 "D&D/龙与地下城"
  - "科幻太空歌剧" 代替具体品牌
- 可描述通用机制概念（如"心理压力资源"），不绑定具体品牌术语
- 用户自行创建的规则体系和 Prompt Profile 不受此约束（用户输入内容的版权责任由用户自负）

背景说明：
> TRPG Workbench 是通用创作工具，不依附于任何特定 TRPG 规则系统。内置示例和默认配置应使用风格描述，避免隐含对特定商业产品的背书或侵权风险。
