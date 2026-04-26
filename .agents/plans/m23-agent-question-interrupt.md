# M23：Agent 澄清问题机制（Question Interrupt）

**前置条件**：M22 完成（规则集 UX 打磨，Director tool-calling + SSE 流式协议稳定可用）。

**目标**：让 Director 在推理过程中能够结构化地向用户提问并等待点选答复，减少"猜错方向→重试"的来回成本。

---

## 背景与动机

来源：`docs/benchmark-reviews/accepted/2026-04-26_agent-mid-task-question-interrupt.md`

当前 Director 遇到方向歧义时只能猜测或在流式文本中用自然语言提问，用户需要手动回复自由文本。
参考 OpenCode 的 `question` 工具，引入结构化选项卡片，让 Director 在写入资产之前可以先收集关键决策。

采用"澄清前置中断"方案——Director 做完读取类工具调用（search/list）之后、写入之前，
调用 `ask_user` 工具触发 `AgentQuestionInterrupt`，前端渲染 `QuestionCard`，
用户点选后前端自动拼装答复消息发送，Director 下一轮 arun() 以完整历史继续执行。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：后端 `ask_user` 工具 + `AgentQuestionInterrupt`**

新增 `ask_user` 工具，Director 调用时抛出 `AgentQuestionInterrupt`，director.py 捕获后
yield `agent_question` SSE 事件并终止当前 stream。

**A2：Director system prompt 约束段落**

在 `director/system.txt` 补充 `## ask_user 工具调用规范`，明确调用时机、限制和禁止滥用约束。

**A3：shared-schema 类型扩展**

新增 `AgentQuestion`、`AgentQuestionOption`、`AgentQuestionItem` 类型；
SSE 事件联合类型追加 `agent_question` 分支。

**A4：前端 `QuestionCard` 组件**

新建 `src/components/agent/QuestionCard.tsx`：
- 每个 question item 渲染为独立卡片区块，包含 header、question text、选项按钮列表
- 选中选项高亮，支持单选（`multiple: false`）和多选（`multiple: true`）
- 底部"提交"按钮，点击后：(1) 卡片变为只读状态；(2) 调用 `onSubmit(answers)` 回调

**A5：AgentPanel 处理 `agent_question` SSE 事件**

在 streaming 事件序列中新增 `question_interrupt` 类型，streaming 结束时渲染 `QuestionCard`；
用户提交后前端自动调用 `sendMessage()` 发送结构化答复文本，触发下一轮 Director 推理。

### B 类：后续扩展

- **B1：问题超时**：用户长时间未答复时显示"继续等待"提示（当前无超时机制，无害）
- **B2：多轮澄清**：Director 根据第一轮答复再次提问（当前每次请求最多 1 次问题卡片）

### C 类：明确不承诺

- 真正的 mid-task suspend/resume（arun() 中途暂停后恢复）——Agno 不明确支持，复杂度过高
- 问题答复的服务端持久化——答复以用户消息形式进入会话历史，已由现有消息持久化覆盖

---

## 文件结构

### 新建文件

```
apps/desktop/src/components/agent/QuestionCard.tsx    前端问题卡片组件
```

### 修改文件

```
apps/backend/app/agents/tools.py                      新增 ask_user 工具 + AgentQuestionInterrupt
apps/backend/app/agents/director.py                   捕获 AgentQuestionInterrupt，yield SSE 事件
apps/backend/app/prompts/director/system.txt          补充 ask_user 调用约束段落
packages/shared-schema/src/index.ts                   新增类型定义
apps/desktop/src/components/agent/AgentPanel.tsx      处理 agent_question 事件
```

---

## 关键设计约束

### SSE 新事件协议

```python
{"event": "agent_question", "data": {
    "id": "q_xxx",
    "questions": [
        {
            "header": "BOSS 的强力类型",
            "question": "这个 BOSS 的核心设计是？",
            "options": [
                {"label": "战斗强力", "description": "高数值、多阶段、机制复杂"},
                {"label": "叙事重量", "description": "剧情核心、有复杂动机"},
                {"label": "双重威胁", "description": "数值和叙事都要强"}
            ],
            "multiple": false
        }
    ]
}}
```

### ask_user 工具约束（system prompt 须明确）

```
- 仅当任务方向存在关键分叉且无法从上下文推断时调用
- 每次最多提 2 个问题
- 每个问题选项数量控制在 2-4 个
- 禁止为"礼貌确认"调用（"我准备创建 NPC，你确认吗？"）
- 已有对话历史能推断答案时不调用
- 已知规则集/工作空间配置能推断时不调用
```

### 前端答复自动拼装格式

```
用户点选"战斗强力" + "全新角色"后，前端自动发送：
"[问题答复]
- BOSS 的强力类型：战斗强力
- 与现有资产的关系：全新独立角色"
```

Director 下一轮以此消息为上下文继续执行，无需额外协议层。

---

## Todo

### A1：后端 ask_user 工具

- [ ] **A1.1**：`apps/backend/app/agents/tools.py` — 定义 `AgentQuestionInterrupt(Exception)` 类，含 `questions: list[dict]` 属性
- [ ] **A1.2**：`apps/backend/app/agents/tools.py` — 实现 `ask_user` 工具函数，校验 questions 格式，抛出 `AgentQuestionInterrupt`
- [ ] **A1.3**：`apps/backend/app/agents/tools.py` — 将 `ask_user` 加入 `ALL_TOOLS` 列表

### A2：director.py SSE 捕获

- [ ] **A2.1**：`apps/backend/app/agents/director.py` — 在 `run_director_stream` 的 `except` 块前捕获 `AgentQuestionInterrupt`
- [ ] **A2.2**：`apps/backend/app/agents/director.py` — yield `agent_question` SSE 事件（含 id + questions），再 yield `done`

### A3：system prompt 约束

- [ ] **A3.1**：`apps/backend/app/prompts/director/system.txt` — 在工具调用规范章节末尾追加 `ask_user` 使用约束段落

### A4：shared-schema 类型

- [ ] **A4.1**：`packages/shared-schema/src/index.ts` — 新增 `AgentQuestionOption`、`AgentQuestionItem`、`AgentQuestion` 接口
- [ ] **A4.2**：`packages/shared-schema/src/index.ts` — 在 `SSEEvent` 联合类型中追加 `agent_question` 分支

### A5：前端 QuestionCard

- [ ] **A5.1**：`apps/desktop/src/components/agent/QuestionCard.tsx` — 实现 QuestionCard 组件（选项按钮、单/多选、只读态、提交回调）
- [ ] **A5.2**：`apps/desktop/src/components/agent/AgentPanel.tsx` — StreamEvent 联合类型追加 `question_interrupt` 分支
- [ ] **A5.3**：`apps/desktop/src/components/agent/AgentPanel.tsx` — SSE 解析时处理 `agent_question` 事件，push `question_interrupt` 到 streamingEvents
- [ ] **A5.4**：`apps/desktop/src/components/agent/AgentPanel.tsx` — `StreamingBubble` 中渲染 `question_interrupt` 事件为 `QuestionCard`
- [ ] **A5.5**：`apps/desktop/src/components/agent/AgentPanel.tsx` — `QuestionCard.onSubmit` 回调：拼装答复文本，调用 `handleSend()` 自动发送

---

## 验收标准

1. Director 调用 `ask_user` 后，前端渲染问题卡片，选项可点击高亮，"提交"按钮可用
2. 提交后，卡片变为只读（显示已选答案），聊天区出现格式化的"[问题答复]"用户消息
3. 该用户消息触发新一轮 Director 推理，Director 以完整历史（含问题和答复）继续执行
4. 未绑定知识库/意图明确时，Director 不调用 `ask_user`（避免滥用）
5. 多问题（最多 2 个）时，两个 question block 在同一卡片中渲染，一次提交全部

---

## 与其他里程碑的关系

```
M22（规则集 UX 打磨）
  └── M23（本 milestone：Agent 澄清问题机制）
        └── B 类扩展：多轮澄清、问题超时（后续视需求决定）
```

---

## 非目标

- 真正的 mid-task suspend/resume（arun() 中途暂停后从相同位置恢复）
- 问题答复的服务端专项存储（由会话消息历史覆盖）
- 选项内容的 LLM 动态生成（选项由 Director 在调用 ask_user 时现场决定，不另起模型）
- 问题卡片的撤销/修改（提交后只读，如需更改发新消息即可）
