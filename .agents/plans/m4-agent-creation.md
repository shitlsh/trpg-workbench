# M4：Agent 创作

**前置条件**：M2（知识库检索可用）+ M3（资产系统、三栏编辑器可用）均完成。

**目标**：通过对话驱动生成和修改资产，Workflow 状态持久化可中断恢复，Agent 分工正确不越界。

**状态：✅ 已完成（commit 983dbf7）**

---

## Todo

### 数据库

- [x] 建表 migration：`chat_sessions`
  - `id`、`workspace_id`、`agent_scope`、`title`、`created_at`、`updated_at`
- [x] 建表 migration：`chat_messages`
  - `id`、`session_id`、`role`（user/assistant/system）、`content`、`references_json`、`tool_calls_json`、`created_at`
- [x] 建表 migration：`workflow_states`
  - `id`（workflow_id）、`workspace_id`、`type`、`status`、`current_step`、`total_steps`、`input_snapshot`（JSON）、`step_results`（JSON）、`result_summary`、`error_message`、`created_at`、`updated_at`

### 后端 Agent 层（`app/agents/`）

- [x] Agno 依赖安装，配置 ModelProfile → Agno model provider 适配层
  - 支持：OpenAI、Anthropic、Google、OpenRouter、自定义 base URL
- [x] `director.py`：Director Agent
  - 输入：用户意图文本 + workspace 上下文（已有资产列表摘要）
  - 输出：结构化 change_plan（intent、affected_asset_types、workflow、agents_to_call、change_plan 文本、requires_user_confirm）
  - 禁止：直接生成资产内容，不承担长篇创作职责
- [x] `rules.py`：Rules Agent
  - 检索 `core_rules > house_rules` 库
  - 输出：建议列表（含引用来源：文档名 + 页码）
  - 无引用时标注"基于通用经验，未找到对应规则原文"
- [x] `plot.py`：Plot Agent
  - 检索 `module_reference > lore > core_rules` 库
  - 生成：大纲、Stage 列表、线索链
  - 不处理具体 NPC 设定
- [x] `npc.py`：NPC Agent
  - 检索 `module_reference > lore > core_rules` 库
  - 生成：角色设定、动机、关系网（引用用 asset_id）、台词风格
- [x] `consistency.py`：Consistency Agent
  - 输入：workspace 内所有资产的 JSON 摘要
  - 输出：issues 数组（type、severity、description、affected_assets、suggestion）
  - 不自动修改任何资产
- [x] `document.py`：Document Agent
  - 输入：其他 Agent 的原始输出
  - 输出：符合 asset-schema-authoring 规范的 JSON + MD 内容，以及 change_summary 和 patch 方案
  - 禁止：写文件、写数据库，只返回 patch 数据

### 后端 Workflow 层（`app/workflows/`）

- [x] `create_module.py`：新建模组 Workflow（9 步）
  1. 读取 Workspace 配置（RuleSet、绑定的 Library、优先级）
  2. Director 生成变更计划，等待用户确认
  3. Rules Agent 检索相关知识库（了解规则风格约束）
  4. Plot Agent 生成故事 premise + 大纲
  5. Plot Agent 生成 Stage 列表
  6. NPC Agent 生成关键 NPC 初稿
  7. Lore Agent（简版占位，M5 补全）生成地点初稿
  8. Plot Agent 生成线索链
  9. Consistency Agent 运行一致性检查
  - 每步执行前后更新 workflow_states 的 status 和 step_results
  - 支持从 current_step 恢复（进程重启后可续接）
- [x] `modify_asset.py`：修改资产 Workflow（8 步）
  1. Director 识别改动意图，定位受影响资产
  2. 检索相关知识库
  3. 调用对应专项 Agent 重写受影响部分
  4. Consistency Agent 运行一致性检查
  5. Document Agent 生成 patch 方案
  6. 等待用户查看 diff 并确认
  7. 应用服务层落盘（写 revision）
  8. 返回 diff 摘要

### 后端 API（`app/api/`）

- [x] `POST /chat/sessions`：新建对话 session
- [x] `GET /chat/sessions/:id/messages`：获取历史消息
- [x] `POST /chat/sessions/:id/messages`：发送消息，触发 Director 处理
- [x] `POST /workflows`：启动 Workflow（body 含 type、workspace_id、input）
- [x] `GET /workflows/:id`：查询 Workflow 状态
- [x] `POST /workflows/:id/confirm`：用户确认变更计划（继续执行）
- [x] `POST /workflows/:id/cancel`：取消 Workflow
- [x] `POST /assets/:id/apply-patch`：接收 Document Agent patch，执行落盘 + 写 revision
- [x] `GET /workspaces/:id/consistency-check`：触发全局一致性检查

### 前端 Agent 面板（右栏）

- [x] 对话输入框 + 发送按钮（支持 Enter 发送，Shift+Enter 换行）
- [x] 消息列表（用户消息 / AI 响应，可滚动）
- [x] AI 响应分层展示（**不能是纯文本块**）：
  - 解释说明（折叠默认收起）
  - 将要修改/创建的资产清单（资产名称 + 类型列表）
  - 变更摘要
  - 引用来源（文档名 + 页码，可展开）
  - 落盘状态（"待确认" / "已保存"）
- [x] Workflow 进度 UI
  - 步骤列表，当前步骤高亮 + loading 动画
  - 已完成步骤显示 ✓ + step summary
  - 失败步骤显示错误原因 + 重试按钮
  - "等待用户确认"步骤显示确认/取消按钮
- [x] Patch 确认流程
  - 弹出 Diff 预览（Monaco diff editor，显示 JSON 和 MD 的变更）
  - 用户点"应用变更" → 调用 apply-patch API → 资产树刷新
  - 用户点"取消" → Workflow 状态回到等待确认
- [x] Consistency 结果展示
  - issues 列表，error 用红色，warning 用黄色
  - 每条 issue 显示：类型、描述、受影响资产（可点击跳转）、建议
- [x] 快捷动作按钮组
  - `[新建资产]`：快捷触发新建资产流程
  - `[一致性检查]`：触发 Consistency Agent
  - `[规则审查]`（M5 补全）

### shared-schema

- [x] 定义类型：`ChatSession`、`ChatMessage`、`WorkflowState`
- [x] 定义类型：`ChangePlan`、`PatchProposal`、`ConsistencyIssue`

---

## 验证步骤

1. 确认 Workspace 已绑定至少一个 Library（M2 完成的知识库）
2. 在 Agent 面板输入："帮我创建一个 COC 乡村调查模组，包含故事大纲和 3 个场景"
3. 确认 Director 返回变更计划，列出将要创建的资产类型（outline、stage×3 等）
4. 点击"确认执行"，观察 Workflow 步骤列表逐步推进
5. 等待 Workflow 完成，确认左栏资产树出现 outline 和若干 stage
6. 点击 outline 资产，确认中栏编辑器有内容，JSON 和 MD 都有内容
7. 在 Agent 面板输入："把第一幕改得更压抑一点"
8. 确认 Director 识别出受影响资产，Patch 确认界面弹出
9. 查看 Diff，点击"应用变更"，确认资产内容更新，新 revision 写入
10. 点击"一致性检查"，确认返回 issues 列表（即使无问题也要返回 `overall_status: clean`）
11. **完全关闭应用**，重启后进入同一 Workspace
12. 确认 Workflow 历史记录在数据库中（`/workflows` 列表可查）
13. 确认资产内容仍然存在，revision 历史完整

---

## 关键约束提示

- Director 是唯一入口，专项 Agent 不接受来自前端的直接调用
- Workflow 状态每步必须持久化，禁止只存内存
- Document Agent 只返回 patch 数据，禁止直接写文件或数据库
- Consistency Agent 只输出 issues，禁止自动修改任何资产
- Rules Agent 的建议必须附引用，无引用时明确标注
- 子 Agent 不得自行无约束全库检索，检索范围由 Director/Workflow 层指定
