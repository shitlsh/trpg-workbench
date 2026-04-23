# M5：产品打磨

**前置条件**：M4 完成（Agent 创作、Workflow 持久化全部可用）。

**目标**：补全剩余 Agent，图像生成拓展，体验完整，可用于真实跑团准备。

**状态：✅ 已完成（commit b171146）**

---

## Todo

### 补全 Agent

- [x] `monster.py`：Monster / Entity Agent
  - 检索 `monster_manual > core_rules > module_reference` 库
  - 生成：怪物概念、行为模式、威胁表现形式、规则适配建议
  - 威胁类型支持：physical / cognitive_corruption / fear / environmental
  - 不做精确数值计算，只给适配建议

- [x] `lore.py`：Lore Agent
  - 检索 `lore > module_reference > core_rules` 库
  - 生成：地点（Location）、世界观词条（Lore Note）、地图说明（Map Brief）
  - 历史背景、势力关系、氛围描述

- [x] 将 Monster Agent 和 Lore Agent 接入 Director 路由和 `create_module` Workflow
  - `create_module` Workflow 第 7 步由 Lore Agent 正式接管（替换 M4 的占位版本）
  - Director 的 `agents_to_call` 支持 `monster` 和 `lore`

### rules_review Workflow

- [x] `rules_review.py`：规则咨询 Workflow（`app/workflows/`）
  1. 读取选中资产的 JSON + MD 内容
  2. Rules Agent 检索 `core_rules > house_rules` 库
  3. Rules Agent 生成建议列表（含引用来源）
  4. 返回建议列表，**不自动落盘**
  5. 用户点击"应用建议" → 触发 `modify_asset` Workflow

- [x] 前端：规则审查入口
  - Agent 面板快捷按钮增加"规则审查"按钮
  - 触发后在 Agent 面板显示建议列表（含引用展开）
  - 每条建议有"应用此建议"按钮，点击后走 modify_asset 流程

### 图像生成拓展

- [x] `image_brief` 字段支持：在所有资产 JSON schema 中开放 `image_brief` 可选字段
- [x] `generate_image.py`：图像生成 Workflow（`app/workflows/`）
  1. 读取资产 JSON（含 `image_brief` 或由 Document Agent 生成 `image_brief`）
  2. Document Agent 生成图像 prompt（基于 image_brief 的 subject/mood/key_elements/style）
  3. 等待用户确认或编辑 prompt
  4. 调用外部图像 API（支持 DALL-E 3 / Stable Diffusion API / 自定义 base URL）
  5. 保存图像到 `workspaces/<id>/images/<asset_id>_<timestamp>.png`
  6. 更新资产 JSON 的 `image_brief.generated_image_path`
  7. 写 revision（source_type = "agent"，change_summary = "生成图像"）

- [x] `ImageGenerationJob` 建表（`id`、`workspace_id`、`asset_id`、`prompt`、`provider`、`status`、`result_path`、`created_at`）
- [x] 图像生成 API：`POST /assets/:id/generate-image`
- [x] 前端：资产详情页图像区域（AssetMetaPanel）
  - 有 `image_brief` 的资产显示"生成图像"按钮
  - 弹出 prompt 确认/编辑对话框
  - 生成中显示 loading，完成后显示图像缩略图
  - 支持点击查看大图

### Prompt 配置

- [x] `prompt_profiles` 建表（`id`、`rule_set_id`、`name`、`system_prompt`、`style_notes`、`output_schema_hint`）
- [x] 内置 COC 风格预设模板（氛围偏向、线索组织方式、NPC 写法、调查场景节奏）
- [x] Prompt 配置页（路由：`/settings/prompts`）
  - 列出所有 PromptProfile
  - 新建/编辑（内置 `<details>` 折叠展示 system_prompt）
  - 内置 profile 只读，用户自定义 profile 可编辑删除
- [x] 首页导航增加 Prompt 配置入口

### 日志与可观测性

- [x] 执行日志完善（`app/utils/logger.py`）
  - 记录：模型调用（provider、model、token 用量、耗时）
  - 记录：检索命中（query、library、top_k 结果摘要）
  - 记录：资产写入（asset_id、revision_version、source_type）
  - 日志写入 `workspaces/<id>/logs/` 目录（按日期分文件，JSONL 格式）

- [x] 前端执行日志面板（Agent 面板中，可折叠展开）
  - 日志条目列表（时间、类型图标、摘要）
  - 支持按类型过滤（model_call / retrieval / asset_write）
  - 点击条目展开 JSON 详情

### 体验补全

- [x] 全局一致性检查（已在 M4 实现，M5 保持并可从 Agent 面板快捷触发）

- [x] Workspace 导出
  - 导出格式：按资产类型分目录的 Markdown 文档包（zip）
  - 导出入口：Workspace 设置页
  - 导出内容：所有 `final` 状态资产的 `.md` 文件（可选包含 `review` 状态）
  - 包含 `index.md` 文件

- [x] 错误恢复 UI 完善
  - API 调用失败显示具体错误原因（非通用"出错了"）
  - 长任务失败时显示具体错误 + 提示检查 API Key
  - Workflow 失败时显示"关闭"按钮

- [x] 整体 UI 打磨
  - 首次使用引导（空工作空间时显示带图标的欢迎文案和步骤提示）
  - Agent 面板发送失败显示具体错误原因

---

## 验证步骤

1. **Monster Agent**：在 Agent 面板输入"给我创建一个克苏鲁风格的认知污染型实体"，确认生成结果包含 `threat_type: cognitive_corruption` 和规则适配建议（附引用）

2. **Lore Agent**：输入"描述一个废弃的维多利亚时代灯塔"，确认生成 location 资产，`atmosphere` 字段有内容，`image_brief` 字段有 subject/mood/key_elements

3. **rules_review Workflow**：点击 Agent 面板"规则审查"按钮，确认建议列表含来源页码，点击"应用建议"能将建议文本填入输入框

4. **图像生成**：选中一个有 `image_brief` 的 NPC 资产，点击"生成图像"，确认 prompt 确认对话框内容合理，（配置外部 API key 后）生成完成后图像显示在资产详情页

5. **Prompt 配置**：进入 Prompt 配置页，确认 COC 预设模板存在且只读，可新建自定义 profile 并保存

6. **执行日志**：触发一次 Agent 对话，展开执行日志面板，确认今日日志条目可见（需要后端实际调用时写入）

7. **Workspace 导出**：进入 Workspace 设置页，点击"导出 ZIP"，下载成功，解压后目录结构清晰

8. **完整流程**：从零走一遍：新建 Workspace → 导入 PDF → 生成 COC 模组（大纲+场景+NPC+怪物+地点）→ 规则审查 → 一致性检查 → 生成 NPC 图像 → 导出文档包，全程无阻塞性错误

---

## 关键约束提示

- rules_review Workflow 结束后不自动落盘，必须等用户确认"应用建议"
- Monster Agent 和 Lore Agent 的检索重点与 Plot/NPC 不同（见 agent-workflow-patterns skill 中的 RAG 检索优先级表）
- 图像生成是拓展功能，不影响主创作流，generate_image Workflow 独立运行
- 导出只包含 MD 文件，不导出 app.db 和向量索引
