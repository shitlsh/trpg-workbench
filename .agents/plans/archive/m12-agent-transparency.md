# M12：Agent 透明度 — RAG 引用可见 + Director 意图摘要

**前置条件**：M11 完成（Setup Wizard、首次配置引导链路已落地）。

**状态：✅ 已完成（2026-04-23）**

**目标**：消除创作流程中的两处关键黑箱——让用户在 Workflow 执行过程中看到知识库检索到了什么、Director 理解了什么意图，从而对 AI 的创作决策建立真实的信任感。

---

## 背景与动机

M11 解决了"冷启动配置"问题，用户现在能顺利进入创作流程。但进入之后，面对的是新的不透明：

```
用户发出请求 → Director 规划（黑箱）→ Knowledge 检索（黑箱）→ 多 Agent 执行 → 资产落盘
```

两处核心黑箱：

1. **知识库检索黑箱**：Knowledge Retriever 检索到了哪些文档、哪些段落，用户完全不知道。
   执行日志中只显示"检索到 N 条相关内容"，没有文档名和摘要。
   这使用户无法判断："这个 NPC 的背景设定是从我的规则书里来的，还是模型自由发挥的？"

2. **Director 意图黑箱**：Director Agent 解析了用户意图、规划了执行方案（`intent` +
   `affected_asset_types` + `change_plan`），但这些信息从不展示给用户。
   `create_module` 步骤 2 的"确认执行"卡片只显示资产类型列表，用户确认的是一个
   没有上下文的决定。

来源：benchmark review
- `docs/benchmark-reviews/proposed/2026-04-23_rag-citations-in-workflow.md`
- `docs/benchmark-reviews/proposed/2026-04-23_director-plan-visibility.md`

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：RAG 引用来源在 WorkflowProgress 中可展开查看**

方案：在 WorkflowProgress 步骤列表中，retrieval 类型步骤完成后可点击展开，
显示检索到的 citations（文档名 + 页码范围 + 摘要前 100 字）。

```
✓ 知识库检索（检索到 4 条）     ← 点击展开
  └── 📄 克苏鲁神话入门 p.12-15：「深潜者是...」
  └── 📄 COC规则书 p.88：「SAN值减少时...」
  └── 📄 用户自定义世界观 p.3：「Arkham 城的地理...」
✓ Plot Agent（生成主线）
```

**A2：Director 意图摘要在"确认执行"卡片中展示**

方案：在 `create_module` / `modify_asset` 的步骤 2"确认执行"卡片中，
增加 Director 解析出的 `intent`（自然语言意图描述）展示区域。
不展示 `agents_to_call`（用户不需要知道内部调用顺序）。

```
┌─────────────────────────────────────────┐
│ AI 理解的任务意图：                       │
│ "创建一个以 Arkham 为背景的克苏鲁短篇模组， │
│  包含 3 个主要 NPC 和 2 幕剧情"           │
│                                         │
│ 预计影响资产类型：plot · npc · location  │
│                                         │
│  [确认执行]  [取消]                       │
└─────────────────────────────────────────┘
```

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：`agents_to_call` 动态调度**
  修复 Director 返回的 `agents_to_call` 未被 Workflow 实际读取的问题，
  让 Director 规划真正影响执行顺序。
  需要 `agent-workflow-patterns` skill 参与设计，复杂度较高，单独评估。

### C 类：明确不承诺

- 气泡级 RAG 引用展示（每个 AI 消息都显示引用来源，信息过载）
- 让用户修改 Director 规划（调整 Agent 调用顺序、修改 intent）

---

## 文件结构

### 修改文件

```
apps/backend/
├── app/workflows/create_module.py      ← A1：retrieval step 将 citations 写入 step detail
├── app/workflows/modify_asset.py       ← A1：同上
├── app/api/workflows.py                ← A2：GET /{id} 响应中暴露 Director intent 字段
└── app/models/orm.py / schemas.py      ← A2：WorkflowStateORM 增加 director_intent 字段（或写入 extra_data）

apps/desktop/src/components/agent/
├── WorkflowProgress.tsx                ← A1：retrieval step 展开显示 citations
│                                       ← A2：步骤 2 确认卡增加 intent 展示
packages/shared-schema/src/index.ts     ← A1：WorkflowStepResult 增加 citations 字段
                                        ← A2：WorkflowState 增加 director_intent 字段
```

---

## 关键设计约束

### A1 citations 数据流

```
Knowledge Retriever 检索
  → 返回 chunks（含 document_name, page_from, page_to, content 前100字）
  → Workflow step result 的 detail 字段写入 citations JSON
  → 前端 WorkflowProgress 读取 step.detail 渲染展开列表
```

citations 写入 step 的 `detail` 字段（新增），格式：
```json
{
  "citations": [
    { "document": "COC规则书", "page_from": 88, "page_to": 90, "excerpt": "SAN值减少时..." }
  ]
}
```

### A2 Director intent 数据流

```
Director Agent 返回 ChangePlan（含 intent 字段）
  → create_module Step 1 完成后，将 intent 写入 WorkflowState 的 extra_data（JSON）
  → 前端 WorkflowProgress 步骤 2 暂停卡读取并展示
```

使用已有的 `extra_data` 字段（JSON 扩展列），不需要新增数据库列。

### 不修改澄清流程

ClarificationCard 和澄清相关逻辑不受本 milestone 影响。

---

## Todo

### A1：RAG 引用在 WorkflowProgress 中可展开

- [x] **A1.1**：`create_module.py` — retrieval step 完成后，将 citations 序列化写入 step result 的 `detail` 字段
- [x] **A1.2**：`modify_asset.py` — 同上
- [x] **A1.3**：`shared-schema` — `WorkflowStepResult` 增加可选 `detail` 字段（`string | null`，JSON）
- [x] **A1.4**：`WorkflowProgress.tsx` — retrieval 类型步骤展开后，解析 `step.detail` 并渲染 citation 列表（文档名 + 页码 + 摘要）

### A2：Director 意图摘要在确认卡展示

- [x] **A2.1**：`create_module.py` — Step 1 完成后将 `Director.intent` 写入 `WorkflowStateORM.extra_data`（`{"director_intent": "..."}` 格式）
- [x] **A2.2**：`shared-schema` — `WorkflowState` 增加可选 `director_intent` 字段（`string | null`）
- [x] **A2.3**：后端 `GET /workflows/{id}` 响应中从 `extra_data` 读取并暴露 `director_intent`
- [x] **A2.4**：`WorkflowProgress.tsx` — 步骤 2 暂停卡中，若 `activeWorkflow.director_intent` 存在，展示意图摘要区域

---

## 验收标准

### A1 验收

1. 在 `create_module` 执行过程中，WorkflowProgress 的 retrieval 步骤完成后显示"检索到 N 条"
2. 点击该步骤可展开，显示每条检索结果的文档名 + 页码范围 + 摘要（前 100 字）
3. `modify_asset` 流程中同样可展开查看 retrieval citations

### A2 验收

4. `create_module` 步骤 2 暂停时，确认卡中显示 Director 解析出的 intent 文字
5. intent 文字描述了 AI 对用户请求的理解（自然语言，非技术字段）
6. 若 intent 为空（Director 未返回），确认卡退化为当前样式，不显示该区域

---

## 与其他里程碑的关系

```
M11（首次配置引导）
  └── M12（Agent 透明度）
        └── B1（Director 动态调度，按需推进）
```

---

## 非目标

- 气泡级 citations（每条消息都显示引用来源）
- 用户可编辑 Director 规划
- `agents_to_call` 动态调度（B 类，单独评估）
- Rerank 结果可见性（超出本 milestone 范围）
