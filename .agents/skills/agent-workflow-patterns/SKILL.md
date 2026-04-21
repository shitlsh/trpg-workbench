---
name: agent-workflow-patterns
description: 约束 trpg-workbench 中所有 AI Agent 的职责边界、调度规则和 Workflow 设计模式。当实现或讨论任何 Agent 相关功能时必须加载本 skill，包括：新建 Agent、设计 Agent 间协作、实现 Workflow、处理用户创作请求的路由、Director Agent 调度逻辑、Rules/Plot/NPC/Monster/Lore/Consistency/Document Agent 的分工，或任何"让 AI 做某件事"的功能设计。
---

# Skill: agent-workflow-patterns

## 用途

本 skill 约束 `trpg-workbench` 中所有 AI Agent 的分工边界、调度规则和 Workflow 设计模式。**严禁万能 Agent，严禁绕过 Director 直接调用专项 Agent。**

---

## Agent 体系总览

```
Director Agent         总控调度，唯一入口
  ├── Plot Agent       剧情与模组结构
  ├── NPC Agent        角色设定
  ├── Monster Agent    怪物/实体设定
  ├── Lore Agent       世界观与地点设定
  ├── Rules Agent      规则顾问（建议型）
  ├── Consistency Agent 一致性检查
  └── Document Agent   结构化格式化与 patch 生成
```

**所有用户请求必须先经过 Director Agent 解析意图，再由 Director 决定是直接调用子 Agent 还是启动完整 Workflow。Director 是唯一的请求入口，没有例外。**

---

## Director Agent

### 职责（仅此，不可扩展）

- 理解用户意图（新建 / 修改 / 查询 / 审查）
- 判断涉及哪些资产类型
- 决定是单次 Agent 调用还是启动完整 Workflow
- 汇总子 Agent 输出，生成变更计划
- 输出变更摘要给用户确认

### 必须输出的结构

```json
{
  "intent": "create_asset | modify_asset | rules_review | image_gen | query",
  "affected_asset_types": ["npc", "stage"],
  "workflow": "create_module | modify_asset | rules_review | generate_image | null",
  "agents_to_call": ["plot", "npc"],
  "change_plan": "将新增一个 NPC 并更新第一幕的线索列表",
  "requires_user_confirm": true
}
```

### 禁止 Director 做的事

- 禁止直接生成具体资产内容（交给专项 Agent）
- 禁止直接写文件或调用存储层（交给应用服务层）
- 禁止跳过子 Agent 独立完成全部创作
- 禁止承担长篇内容生成职责，Director 只做意图解析、路由规划、检索策略规划和结果汇总

---

## 专项 Agent 分工（严格边界）

### Plot Agent

**负责**：
- 故事主线与 premise
- 场景（Stage）结构设计
- 分支（Branch）设计
- 线索链（Clue chain）规划
- 节奏与张力控制

**不负责**：NPC 具体设定、怪物能力、规则数值

### NPC Agent

**负责**：
- 角色基本设定（身份、外貌、性格）
- 动机与秘密
- 人物关系网
- 台词风格建议
- 与玩家互动建议

**不负责**：剧情走向、规则数值、怪物设计

### Monster / Entity Agent

**负责**：
- 怪物或异常实体概念设定
- 行为模式与触发条件
- 威胁表现形式（物理伤害 / 认知污染 / 精神攻击等）
- 与当前规则体系的适配建议（不承诺精确数值）

**不负责**：剧情植入方式（交给 Plot）、规则裁定（交给 Rules）

### Lore Agent

**负责**：
- 地点（Location）设定与氛围描述
- 历史背景与势力关系
- 世界观词条（Lore Note）
- 地图说明文字（Map Brief）

**不负责**：具体 NPC 设定、场景流程

### Rules Agent

**职责定位：建议型，不是规则引擎**

**负责**：
- 依据知识库回答规则问题
- 对怪物、检定、遭遇进行建议性审查
- 提示潜在规则风险点
- 给出"建议修改"而非"强制修改"

**不负责**：
- 绝对规则裁定（第一版不承诺）
- 自动修改资产（用户确认后才触发修改流程）

**必须标注**：每条建议必须注明引用来源（知识库文档名 + 页码），无引用的建议标注 "基于通用经验，未找到对应规则原文"。

### Consistency Agent

**负责**：
- 命名一致性检查（同一实体在不同资产中名称是否统一）
- 时间线冲突检测
- 动机/行为逻辑矛盾检测
- 线索断裂检测（线索能否被玩家发现并形成完整链）
- 分支矛盾检测

**触发时机**：
- 每次新建模组 Workflow 结束前必须运行
- 每次修改资产 Workflow 结束前必须运行
- 用户可手动触发"全局一致性检查"

**输出格式**：
```json
{
  "issues": [
    {
      "type": "naming_conflict | timeline_conflict | motivation_gap | clue_break | branch_conflict",
      "severity": "warning | error",
      "description": "NPC 在 stage-act1 中称为 '镇长Arthur'，在 stage-act3 中称为 'Arthur Hale 市长'，建议统一",
      "affected_assets": ["stage_act1_village_arrival", "stage_act3_confrontation"],
      "suggestion": "统一使用 'Arthur Hale 镇长'"
    }
  ],
  "overall_status": "clean | has_warnings | has_errors"
}
```

### Document Agent

**职责定位：结构化格式化器，不是写文件的角色**

**负责**：
- 将其他 Agent 的输出格式化为标准资产 JSON + Markdown
- 遵守 `asset-schema-authoring` skill 的所有规范
- 生成变更摘要（change_summary）
- 生成 patch 方案，返回给应用服务层

**不负责**：
- 任何文件写入或数据库写入（实际落盘只由应用服务层执行）
- 任何创作判断，只做格式转换，不改变内容语义

---

## Workflow 设计（大任务必须走 Workflow）

### 判断标准

所有请求先经过 Director，由 Director 决定处理路径：

| 用户意图 | Director 的处理路径 |
|---------|-------------------|
| 规则提问（单次问答） | Director 直接路由到 Rules Agent，不启动 Workflow |
| 修改单个资产的某个字段 | Director 路由到对应专项 Agent + Document Agent，不走完整 Workflow |
| 新建模组（涉及多种资产） | Director 启动 `create_module` Workflow |
| 修改影响多个资产的改动 | Director 启动 `modify_asset` Workflow |
| 规则全面审查 | Director 启动 `rules_review` Workflow |
| 图像生成 | Director 启动 `generate_image` Workflow |

> **说明**：Director 路由到 Rules Agent 处理规则问题，是 Director 做出的调度决策，不是绕过 Director。所有请求的入口始终是 Director。

### Workflow 1：新建模组（create_module）

```
1. 读取 Workspace 配置（规则体系、绑定的 Library）
2. Director 生成变更计划，用户确认
3. Rules Agent 检索相关知识库（了解规则风格约束）
4. Plot Agent 生成故事 premise + 大纲
5. Plot Agent 生成 Stage 列表
6. NPC Agent 生成关键 NPC 初稿
7. Lore Agent 生成地点初稿
8. Plot Agent 生成线索链
9. Consistency Agent 运行一致性检查
10. Document Agent 格式化所有资产
11. 应用服务层落盘（写 JSON + MD + revision）
12. 返回变更摘要给用户
```

### Workflow 2：修改资产（modify_asset）

```
1. Director 识别改动意图，定位受影响资产
2. 检索相关知识库（规则约束 / 上下文）
3. 调用对应专项 Agent 重写受影响部分
4. Consistency Agent 运行一致性检查
5. Document Agent 生成 patch 方案
6. 用户查看 diff 摘要，确认应用
7. 应用服务层落盘（写 revision，更新资产文件）
8. 返回 diff 摘要
```

### Workflow 3：规则咨询（rules_review）

```
1. 读取选中资产（JSON + MD）
2. Rules Agent 检索知识库
3. Rules Agent 汇总引用与建议
4. 输出建议列表（含引用来源）
5. 不自动落盘
6. 用户选择"应用建议"才触发 modify_asset Workflow
```

### Workflow 4：图像生成（generate_image）

```
1. 读取资产 JSON（含 image_brief 或生成 image_brief）
2. Document Agent 生成图像 prompt
3. 用户确认或编辑 prompt
4. 调用外部图像 API
5. 保存图像到 workspaces/<id>/images/
6. 更新资产 JSON 中的 image_brief.generated_image_path
7. 写 revision（source_type = "agent"）
```

---

## 禁止事项

- **禁止万能 Agent**：禁止创建一个"什么都能做"的 Agent，每个 Agent 职责必须单一
- **禁止绕过 Director**：用户请求不得直接路由到专项 Agent，Director 是唯一入口
- **禁止 Rules Agent 自动落盘**：规则建议必须经用户确认才能触发修改
- **禁止 Consistency Agent 自动修改资产**：只输出问题报告，不自动改
- **禁止 Document Agent 做创作判断**：只做格式转换，不改变内容语义
- **禁止 Document Agent 直接写文件或数据库**：它只生成 patch，落盘由应用服务层执行
- **禁止大任务绕过 Workflow 直接单次调用**：凡涉及多种资产类型的任务必须走对应 Workflow
- **禁止单次对话上下文承担 Workflow 状态**：Workflow 状态必须持久化，支持中断恢复

---

## Workflow State 持久化（最低字段要求）

Workflow 执行状态必须持久化到 SQLite，不能只存在内存或对话上下文中。最低字段：

```json
{
  "workflow_id": "wf_<uuid>",
  "workspace_id": "ws_<uuid>",
  "type": "create_module | modify_asset | rules_review | generate_image",
  "status": "pending | running | paused | completed | failed",
  "current_step": 4,
  "total_steps": 12,
  "input_snapshot": {
    "user_intent": "帮我做一个 COC 乡村调查模组",
    "affected_asset_ids": []
  },
  "step_results": [
    {"step": 1, "name": "读取 Workspace 配置", "status": "completed", "summary": "..."},
    {"step": 2, "name": "生成变更计划", "status": "completed", "summary": "..."}
  ],
  "result_summary": null,
  "error_message": null,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:01:30Z"
}
```

**约束**：
- `status` 变更时立即写库，不允许批量延迟更新
- `step_results` 按步骤追加，不覆盖已完成步骤
- Workflow 中断（进程崩溃或用户退出）后，重启时可从 `current_step` 恢复
- `input_snapshot` 在 Workflow 启动时快照一次，不随后续变更

---

## RAG 在创作流程中的使用规则

RAG（Knowledge 检索）不仅服务于 Rules Agent，也服务于所有创作型 Agent。其作用是为 Agent 提供与任务相关的规则约束、风格参考、世界观资料和术语上下文，而不是替代 Agent 自身的创作能力。

### 基本原则

1. **创作前先检索**
   - Plot / NPC / Monster / Lore 等 Agent 在执行前，必须先获得与任务类型匹配的知识上下文
   - 检索由 Director 或 Workflow 层统一规划，**专项 Agent 不得自行无约束全库检索**

2. **生成后可再审查**
   - 内容生成完成后，Rules Agent 可再次检索知识库，对生成结果做建议性规则审查
   - 这是"生成后校验"阶段，与生成前的参考检索是两个独立阶段

3. **检索范围由任务类型决定**
   - 检索必须按 task type、library_type、WorkspaceLibraryBinding.priority 过滤
   - 禁止任意 Agent 无约束检索整个 workspace 的所有知识库

### 不同 Agent 的默认检索重点

| Agent | 优先库顺序 | 参照强度 |
|-------|-----------|---------|
| Plot Agent | `module_reference > lore > core_rules` | 轻到中等，重点参考模组结构、调查节奏、风格氛围 |
| NPC Agent | `module_reference > lore > core_rules` | 中等，重点参考角色定位、世界观背景、互动功能 |
| Monster Agent | `monster_manual > core_rules > module_reference` | 中到强，重点参考怪物设定、威胁形式、术语与规则适配 |
| Lore Agent | `lore > module_reference > core_rules` | 中等，重点参考地点、势力、时代背景和世界观一致性 |
| Rules Agent | `core_rules > house_rules` | 强，以知识库内容为主要依据 |

### 无检索命中时的降级策略

- 若未找到直接相关资料，允许 Agent 基于通用创作能力生成结果
- 但必须在结果元数据或用户可见说明中标记"未找到直接参考资料"
- **Rules Agent 不得将无来源建议表述为"规则原文结论"**

### 引用保留原则

- 创作型 Agent（Plot/NPC/Monster/Lore）不要求逐段引用，但若输出明显受知识库影响，应在最终响应中保留来源片段（文档名 + 页码）供用户展开查看
- Rules Agent 的每条建议应尽可能附带来源文件名与页码；无来源时标注"基于通用经验，未找到对应规则原文"
