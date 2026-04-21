---
name: asset-schema-authoring
description: 约束 trpg-workbench 中所有结构化资产的格式、命名、字段和版本管理规范。当创建或修改任何资产文件时必须加载本 skill，包括：新建 NPC/怪物/场景/地点/线索等任意类型资产、定义 JSON schema、编写 Markdown 文档、处理 AssetRevision、设计资产字段结构，或讨论资产存储格式时。
---

# Skill: asset-schema-authoring

## 用途

本 skill 约束 `trpg-workbench` 中所有结构化资产的创建、格式、命名和版本管理规范。**每次生成或修改资产时都必须遵守本 skill。**

---

## 核心原则

**每个资产必须同时维护两份文件：**

| 文件 | 用途 | 格式 |
|------|------|------|
| `{type}-{slug}.md` | 供人阅读，叙述性内容 | Markdown |
| `{type}-{slug}.json` | 供程序读写、依赖分析、patch、图像 prompt 生成 | JSON |

示例：`npc-mayor-arthur.json` / `npc-mayor-arthur.md`

**禁止**：只写 MD 不写 JSON，或只写 JSON 不写 MD。

### JSON 与 Markdown 的真相源规则

**JSON 是结构真相源，Markdown 是人类阅读视图。**

- 当 JSON 与 MD 内容不一致时，**以 JSON 为准**，并重新从 JSON 渲染/更新 MD
- 用户通过 Markdown 视图手动编辑后，保存时必须将变更同步回 JSON 对应字段
- **第一版仅支持基于固定标题结构的受限同步**：系统按已知标题（如 `## 动机`、`## 秘密`）提取对应段落映射到 JSON 字段；复杂自由文本编辑若无法可靠映射，应提示用户改在 JSON 视图或结构化表单中编辑，不得试图实现完整 Markdown 语义解析器
- Agent 修改资产时，始终先修改 JSON，再由 Document Agent 从 JSON 重新生成 MD
- 禁止仅更新 MD 而不同步 JSON（这会造成两者静默不一致）

---

## 资产类型与存储目录

| type 值 | 目录 | 说明 |
|---------|------|------|
| `outline` | `assets/outline/` | 故事大纲，通常只有一个 |
| `stage` | `assets/stages/` | 场景/幕 |
| `npc` | `assets/npcs/` | 人物角色 |
| `monster` | `assets/monsters/` | 怪物/异常实体 |
| `location` | `assets/locations/` | 地点 |
| `clue` | `assets/clues/` | 线索 |
| `branch` | `assets/branches/` | 分支 |
| `timeline` | `assets/timelines/` | 时间线 |
| `map_brief` | `assets/map_briefs/` | 地图说明 |
| `lore_note` | `assets/lore_notes/` | 设定词条 |

---

## 命名规范

```
格式：{type}-{slug}.json / {type}-{slug}.md

示例：
  npc-mayor-arthur.json
  npc-mayor-arthur.md
  monster-deep-one-elder.json
  monster-deep-one-elder.md
  stage-act1-village-arrival.json
  stage-act1-village-arrival.md
  location-old-lighthouse.json
  location-old-lighthouse.md
```

**slug 规范**：
- 全小写
- 单词间用 `-` 连接
- 不使用中文、空格、下划线
- 尽量简短但有辨识度

---

## JSON 最低必填字段（所有资产类型）

```json
{
  "id": "string，格式：{type}_{slug_underscored}，如 npc_mayor_arthur",
  "type": "string，对应上方 type 值",
  "name": "string，显示名称，可用中文",
  "slug": "string，同文件名中的 slug 部分",
  "workspace_id": "string",
  "status": "draft | review | final",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "summary": "string，一两句话摘要，供 Director Agent 决策时快速读取"
}
```

---

## 各资产类型扩展字段示例

### NPC

```json
{
  "id": "npc_mayor_arthur",
  "type": "npc",
  "name": "Arthur Hale",
  "slug": "mayor-arthur",
  "role": "镇长",
  "public_persona": "温和可靠",
  "hidden_truth": "掩盖十五年前的失踪案",
  "motivation": ["维持秩序", "保护名誉"],
  "relationships": [
    {"target": "npc_doctor_elsa", "type": "alliance", "note": "共谋隐瞒旧案"}
  ],
  "appearance_brief": "中年，衣着体面，神色疲惫",
  "dialogue_style": "克制、官方、绕弯子",
  "secrets": ["知道失踪案真相", "与 Elsa 有旧约"],
  "status": "draft",
  "summary": "镇长，表面亲和，实则掩盖旧案，是核心对抗势力之一"
}
```

### Monster / 实体

```json
{
  "id": "monster_deep_one_elder",
  "type": "monster",
  "name": "深海长老",
  "slug": "deep-one-elder",
  "concept": "克苏鲁神话深海种族的高阶个体",
  "behavior_pattern": "潜伏、引导、精神污染，不直接攻击",
  "threat_type": "cognitive_corruption",
  "threat_level": "lethal",
  "rule_adaptation_notes": "COC：理智检定难度极高，接触即触发",
  "abilities": ["telepathy", "shape_shifting", "fear_aura"],
  "status": "draft",
  "summary": "深海长老，认知污染型威胁，不直接杀伤但会摧毁理智"
}
```

### Stage / 场景

```json
{
  "id": "stage_act1_village_arrival",
  "type": "stage",
  "name": "第一幕：抵达村庄",
  "slug": "act1-village-arrival",
  "act": 1,
  "mood": "压抑、雨天、村民警惕",
  "objectives": ["建立背景氛围", "引入第一条线索"],
  "key_npcs": ["npc_mayor_arthur", "npc_innkeeper_tom"],
  "key_locations": ["location_village_square", "location_inn"],
  "clues_available": ["clue_missing_persons_poster"],
  "branches_from": [],
  "branches_to": ["branch_investigate_church", "branch_talk_to_elder"],
  "status": "draft",
  "summary": "玩家抵达小镇，初步感受压抑氛围，获得第一条线索"
}
```

### Location / 地点

```json
{
  "id": "location_old_lighthouse",
  "type": "location",
  "name": "废弃灯塔",
  "slug": "old-lighthouse",
  "description_brief": "建于1890年代，海崖边，长期废弃，海鸟聚集",
  "atmosphere": "荒凉、潮湿、隐约有腐烂气息",
  "accessible_in_stages": ["stage_act2_cliffside"],
  "hidden_elements": ["地下密室入口", "旧日记碎页"],
  "danger_level": "moderate",
  "status": "draft",
  "summary": "废弃灯塔，关键地点，藏有推进主线的隐秘线索"
}
```

---

## AssetRevision 写法（必须遵守）

每次落盘都要创建一条 revision，格式：

```json
{
  "id": "rev_<uuid>",
  "asset_id": "npc_mayor_arthur",
  "version": 3,
  "content_md": "# Arthur Hale\n\n## 概述\n...",
  "content_json": { "...完整 JSON..." },
  "change_summary": "补强动机描述，增加与 Elsa 的关系条目",
  "source_type": "agent | user",
  "created_at": "2025-01-01T00:00:00Z"
}
```

**revision 约束**：
- `version` 从 1 开始，每次递增
- `change_summary` 必填，不可为空字符串
- `source_type` 必须标明来源：`agent`（AI 生成）或 `user`（用户手动编辑）
- **revision 不可删除**，只能追加

---

## 跨资产引用规范

资产之间相互引用时，必须遵守统一规则，保证 Consistency Agent 和依赖分析可以机器处理。

### 引用统一使用 asset_id

- **所有跨资产引用字段中，值必须是 `asset_id`**（格式：`{type}_{slug_underscored}`）
- 禁止使用自然语言名称（如 `"镇长Arthur"`）或文件名（如 `"npc-mayor-arthur.json"`）做引用
- 禁止混用 asset_id 和 slug

```json
// 正确
"key_npcs": ["npc_mayor_arthur", "npc_innkeeper_tom"]

// 错误
"key_npcs": ["镇长Arthur", "npc-mayor-arthur"]
```

### 多引用字段命名（复数数组）

指向多个资产的字段，使用复数命名，值为 asset_id 数组：

| 字段名 | 引用类型 | 示例 |
|--------|---------|------|
| `key_npcs` | NPC 列表 | `["npc_mayor_arthur"]` |
| `key_locations` | 地点列表 | `["location_old_lighthouse"]` |
| `clues_available` | 线索列表 | `["clue_missing_poster"]` |
| `branches_from` | 来源分支 | `["branch_investigate_church"]` |
| `branches_to` | 去向分支 | `["branch_confront_mayor"]` |
| `accessible_in_stages` | 出现的场景 | `["stage_act2_cliffside"]` |

### 单引用字段命名（`<type>_id`）

指向单个资产的字段，使用 `<type>_id` 格式：

```json
{
  "parent_stage_id": "stage_act1_village_arrival",
  "origin_location_id": "location_village_square"
}
```

### relationships 数组中的引用

NPC 关系网中的 `target` 字段也必须是 asset_id：

```json
"relationships": [
  {"target": "npc_doctor_elsa", "type": "alliance", "note": "共谋隐瞒旧案"}
]
```

---

## image_brief 扩展字段（可选，图像生成用）

当资产需要图像生成时，在 JSON 中附加此字段：

```json
{
  "image_brief": {
    "subject": "破败维多利亚时代乡村宅邸",
    "mood": "潮湿、阴冷、压抑",
    "key_elements": ["长廊", "煤油灯", "发霉墙纸"],
    "camera": "俯视斜角",
    "style": "写实概念图",
    "generated_image_path": null
  }
}
```

`generated_image_path` 在图像生成完成后填写，未生成时保持 `null`。

---

## Markdown 文档结构规范

每类资产的 `.md` 文件应有固定的标题结构：

### NPC

```markdown
# {名称}

## 概述
（一两句话，和 JSON summary 保持一致）

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

- 禁止只保存 MD 不保存 JSON
- 禁止 JSON 缺少 `summary` 字段（Director Agent 依赖此字段做快速决策）
- 禁止 revision 的 `change_summary` 为空
- 禁止删除或覆盖历史 revision
- 禁止 slug 使用中文或空格
- 禁止跨资产引用使用自然语言名称或文件名，必须使用 asset_id
- 禁止仅更新 Markdown 而不同步 JSON（JSON 是真相源）
