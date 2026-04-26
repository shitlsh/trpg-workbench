---
status: proposed
date: 2026-04-26
source: OpenCode Desktop
theme: Agent 推理中途澄清问题机制（Question Interrupt）
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# Agent 推理中途澄清问题机制（Question Interrupt）

## 来源与借鉴理由

OpenCode 有内置的 `question` 工具：LLM 在任务执行过程中，可以随时调用此工具向用户提问，
每次提问可含多个 header + options 结构，用户可从选项中点选或输入自定义答案，
多问题时可逐一导航再统一提交。其本质是**一次有结构的输入收集**，而非纯自由文本对话。

TRPG 创作场景中，Director 经常面对需要创作者决策的分叉点：
- "这个 NPC 应该是反派、中立还是盟友？"
- "情节调性是黑暗惊悚、中性悬疑还是轻松冒险？"
- "你说的'强力 BOSS'是战斗强力（高数值）还是叙事重量（剧情核心）？"

目前 Director 要么猜测、要么在流式文本中用中文问句提问但用户需要手动回复自由文本。
这使得创作方向的控制感丢失，且增加来回沟通成本。

---

## 当前差距

| 维度 | OpenCode | trpg-workbench |
|---|---|---|
| Agent 提问机制 | `question` 工具，结构化选项 + 自定义输入 | 无，只能在流式文本中自然语言提问 |
| 用户确认形式 | 点击选项卡片，可多选/单选 | 手动打字回复 |
| 前端组件 | 选项渲染为可交互卡片 | 无对应组件 |
| 后端流程 | 工具调用 → 前端阻塞 → 用户答复 → 继续执行 | 无阻塞，Director 单次 `arun()` |

目前 `director.py` 的执行模型是单次 `arun()`，全程流式输出，没有暂停/恢复机制，
`PatchProposalInterrupt` 是唯一的中断机制，且只在写操作时触发，不作为通用交互模式使用。

---

## 适合性判断

**适合，但推荐采用"澄清前置"方案而非"真正的中途暂停"。**

理由：TRPG 创作的歧义大多在**执行前**就能发现。Director 在决定生成 500 字 NPC 描述之前，
如果意图不明确，在起点澄清比中途打断成本低，对用户体验更可预测。

相比之下，OpenCode 的真正 mid-task interrupt（工具执行中途暂停整个 arun()）
对 Agno 框架的 suspend/resume 能力有依赖，当前不确定 Agno 是否支持无状态恢复。

---

## 实现方案（推荐：轻量澄清中断）

### 核心思路

Director 调用 `ask_user` 工具 → 触发类似 `PatchProposalInterrupt` 的中断 →
后端 yield `agent_question` SSE 事件 → 前端渲染 `QuestionCard` →
用户点选后前端**自动拼装答案作为下一条消息发送** → Director 在下一轮 arun() 中
以完整对话历史（含问题和答案）继续创作。

这不需要真正的 suspend/resume，复用现有的 session 历史机制。

### 后端变更

**1. 新增工具：`ask_user`（tools.py）**

```python
class AgentQuestionInterrupt(Exception):
    def __init__(self, questions: list[dict]):
        self.questions = questions  # 同 OpenCode question tool schema

@tool
def ask_user(questions: list[dict]) -> str:
    """当任务方向不明确时，向用户提问以收集关键决策。
    questions 列表中每项含：header(str)、question(str)、options(list[{label, description}])、
    multiple(bool, 默认 False)。
    调用此工具会中断当前任务，等待用户答复后继续。
    仅在真正需要用户决策时调用，不要为了"礼貌"而询问。"""
    raise AgentQuestionInterrupt(questions)
```

**2. director.py 中捕获 AgentQuestionInterrupt**

```python
except AgentQuestionInterrupt as e:
    yield {
        "event": "agent_question",
        "data": {
            "id": f"q_{uuid.uuid4().hex[:12]}",
            "questions": e.questions,
        },
    }
    yield {"event": "done", "data": {}}
    return
```

**3. 新增 SSE 事件类型**

```python
{"event": "agent_question", "data": {
    "id": "q_xxx",
    "questions": [
        {
            "header": "NPC 阵营",
            "question": "这个 NPC 在故事中的定位是？",
            "options": [
                {"label": "反派", "description": "故事主要对立方，有明确的对抗目标"},
                {"label": "中立", "description": "立场模糊，可能成为盟友也可能成为障碍"},
                {"label": "盟友", "description": "支持玩家角色，提供资源或信息"}
            ],
            "multiple": false
        }
    ]
}}
```

### 前端变更

**1. AgentPanel 中处理 `agent_question` 事件**

在消息流中渲染 `QuestionCard` 组件，而不是普通气泡。

**2. `QuestionCard` 组件**

```tsx
// 渲染每个问题的选项按钮
// 用户点选后，按钮高亮为选中状态
// 底部"提交"按钮收集所有问题答案
// 提交后：
//   1. QuestionCard 变为只读（显示已选答案）
//   2. 自动调用 sendMessage() 发送结构化答复：
//      "关于你的问题：\n- NPC阵营：反派\n（如有其他：...）"
//   3. Director 在下一轮继续执行
```

**3. shared-schema 新增类型**

```typescript
interface AgentQuestion {
    id: string
    questions: {
        header: string
        question: string
        options: { label: string; description: string }[]
        multiple?: boolean
    }[]
}

// SSE 事件扩展
| { type: "agent_question"; data: AgentQuestion }
```

---

## 工具调用约束（Director system prompt 补充）

需在 `director/system.txt` 中明确：

```
## ask_user 工具调用规范
- 仅当任务方向存在关键分叉且无法从上下文推断时调用
- 每次最多提 2 个问题（避免打断过于频繁）
- 选项数量控制在 2-4 个
- 禁止为了"礼貌确认"而调用（如"我准备创建 NPC，你确认吗？"）
- 写操作前的一致性检查不需要此工具，用 check_consistency 替代
- 已有对话历史能推断答案时不调用
```

---

## 对创作控制感的影响

**明显提升。** 创作者不再被动地等待 Director 猜测意图，而是在关键分叉点
以结构化方式表达偏好。选项格式降低了用户思考成本（比自由文本回复更快）。

---

## 对 workbench 协同的影响

**改善 Agent 面板与用户之间的信息交换密度。**
目前 Agent 面板只有单向输出（流式文本 + tool card + patch confirm），
引入 QuestionCard 使面板变成双向协作界面，与 patch confirm 机制形成对称结构：
- patch confirm = 写操作前的确认（已有）
- question interrupt = 创作方向上的决策（新增）

---

## 对 1.0 用户价值的影响

**中等。** 不是 blocking 问题（Director 不询问也能工作），但能显著减少"Agent 猜错方向
→ 生成不符合预期 → 用户重新描述 → 重试"的来回成本，对首次使用的新用户尤其友好。

---

## 建议落地方式

- [ ] plan：追加到 M23 或新建 M23（与其他 Agent 体验类工作合并）
- [ ] 改代码范围：
  - `apps/backend/app/agents/tools.py`：新增 `ask_user` 工具 + `AgentQuestionInterrupt`
  - `apps/backend/app/agents/director.py`：捕获 interrupt，yield `agent_question` 事件
  - `apps/backend/app/prompts/director/system.txt`：新增工具调用约束段落
  - `packages/shared-schema/`：新增 `AgentQuestion` 类型 + SSE 事件扩展
  - `apps/desktop/src/`：新增 `QuestionCard` 组件，AgentPanel 处理新事件类型
- [ ] skill：不需要新建 skill，agent-workflow-patterns skill 更新一节即可

## 不做的理由（如适用）

真正的"mid-task suspend/resume"（arun() 中途暂停后恢复）暂不做，原因：
1. Agno 当前不明确支持无状态 suspend/resume
2. 对于 TRPG 创作场景，"澄清前置"已覆盖 90% 的使用场景
3. 实现复杂度高（需要 session 状态机、恢复协议、超时处理）
