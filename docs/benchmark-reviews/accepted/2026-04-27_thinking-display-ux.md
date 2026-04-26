---
status: accepted
date: 2026-04-27
source: OpenPawz / Claude.ai / Cursor
theme: Agent 面板消息流过程可见性 UX（thinking 展示 + tool call 顺序）
priority: high
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# Agent 面板消息流过程可见性 UX 改进

本 proposal 覆盖两个相关问题，根因相同：**消息气泡把"过程"和"结果"混在一起，且历史渲染时过程信息丢失顺序**。

## 背景与现状

trpg-workbench 已完整支持三种模型的 thinking token 路由：

| 模型 | 机制 |
|------|------|
| Qwen3 / DeepSeek-R1 | `<think>…</think>` 状态机解析 → `thinking_delta` SSE |
| Gemini 2.5 | `reasoning_content` 字段读取 → `thinking_delta` SSE |
| Claude 3.x | 原生 `ReasoningContentDelta` → `thinking_delta` SSE |

前端 `ThinkingBlock` 组件已存在于 `AgentPanel.tsx:101`，但当前实现在**用户体验层**存在明显缺口，在 Qwen3 35B 这类需要数分钟推理的模型上问题尤为突出。

---

## 当前已做到的部分

**产品骨架已完成：**
- Thinking token 完整路由（三种模型全部支持）
- `ThinkingBlock` 组件存在，支持折叠/展开
- Streaming 期间有 `blink` 指示灯（header 上小圆点）
- 历史消息中的 `thinking_json` 可被读取和展示

**骨架到位但体验细节未完成：**
- `expanded` 初始值为 `false`：streaming 期间 ThinkingBlock 默认折叠，用户看不到任何推理内容
- `StreamingBubble` 在 `thinking` 非空时才渲染 `ThinkingBlock`，此前只有三点弹跳动画
- `<pre>` 有 `maxHeight: 300` + `overflowY: auto`，但没有自动滚动到底部——内容流入时用户看不到最新内容
- Streaming 结束后没有"Thought for Xs"时长摘要——用户不知道模型花了多少时间推理
- **Tool call 顺序在历史消息中丢失**（见下节）

---

## 问题 B：Tool Call 顺序在历史消息中丢失

### 根因分析

**Streaming 时**（`StreamingBubble`）：事件按 `events` 数组顺序渲染，`text_chunk` 和 `tool_call` 交错，顺序正确——用户看到的是"工具调用 → 继续生成文字"的真实执行流。

**完成后**（`StoredMessageBubble`，`AgentPanel.tsx:49`）：数据库把 `content`（文字）和 `tool_calls_json`（工具调用列表）分开存储，渲染时先输出全部文字，再在底部输出全部工具调用——**原始顺序完全丢失**。

这会造成：
- 用户回看历史时看到一段完整答复文字，下方堆着若干工具调用卡片，不知道工具是什么时候被调用的
- 如果模型是"调用工具 → 根据结果生成文字"，历史里显示的是相反顺序
- 多步工具链（tool_A → text → tool_B → text）在历史中完全无法还原

### 当前数据结构

```
ChatMessage {
  content: string           // 最终文字内容，合并后的整体
  tool_calls_json: string   // JSON array of ToolCall，无顺序标注
  thinking_json: string
}
```

顺序信息在 streaming 结束后落库时被丢弃。

---

## 参考对象分析

### 借鉴点 1：Streaming 期间自动展开 ThinkingBlock

**来源：** Claude.ai、Cursor

**借鉴理由：**
Claude.ai 在 thinking streaming 开始时自动展开 ThinkingBlock，内容实时流入；streaming 结束后自动折叠并显示"Thought for Xs"摘要。Cursor 同样在 thinking 期间保持内容可见。用户可以看到模型正在"想什么"，大幅降低长时推理的等待焦虑。

**当前差距：**
trpg-workbench 的 `ThinkingBlock` `expanded` 初始为 `false`，streaming 期间用户只看到一个小呼吸灯。对于 Qwen3 35B 数分钟的推理过程，这等于完全黑盒。

**适合性判断：**
完全适合。trpg-workbench 用户的创作请求（生成 NPC、写剧情、做规则审查）都需要长时推理，让用户看到推理过程能显著提升信任感和掌控感。

**对创作控制感的影响：**
改善——用户能看到模型在"考虑哪些因素"，感知 AI 是认真在做判断而不是随机生成。

**对 workbench 协同的影响：**
间接改善右栏 Agent 面板的体验，减少"AI 在不在？"的困惑。

**对 1.0 用户价值的影响：**
是 1.0 前必须解决的体验问题——首次体验 Qwen3 的用户极可能误以为卡住了。

**建议落地方式：**
- [x] 直接改代码：`AgentPanel.tsx` ThinkingBlock，`streaming` prop 为 `true` 时将 `expanded` 初始值改为 `true`；streaming 结束后（`isStreaming` 变为 `false`）自动折叠

---

### 借鉴点 2：Thinking 内容自动滚动到底部

**来源：** Claude.ai、Cursor

**借鉴理由：**
streaming 期间内容持续追加，但用户停留在顶部看不到最新内容，体验等同于"看日志但不跟随"。主流工具的 thinking 区域在 streaming 期间自动滚动到底部。

**当前差距：**
`<pre>` 有 `maxHeight: 300` + `overflowY: auto` 但没有 `useEffect` 监听 `content` 变化并调用 `scrollTop = scrollHeight`。

**适合性判断：**
完全适合，改动极小（约 5 行）。

**对创作控制感的影响：**
改善——用户能追踪推理"最新进展"，而不是只看到推理开头。

**对 1.0 用户价值的影响：**
高——是 streaming UX 的基础质量保证。

**建议落地方式：**
- [x] 直接改代码：`ThinkingBlock` 的 `<pre>` 加 `ref`，在 `useEffect` 中监听 `content` 变化，`streaming` 为 `true` 时自动 `scrollTop = scrollHeight`

---

### 借鉴点 3：Thinking 结束后显示时长摘要

**来源：** Claude.ai

**借鉴理由：**
Claude.ai 在 thinking 结束后显示"Thought for 47 seconds"，让用户感知推理消耗的成本与深度，同时也作为"已完成"的状态信号。

**当前差距：**
trpg-workbench 的 `ThinkingBlock` 没有时长信息，streaming 结束后只是安静折叠（如果实现了自动折叠的话），用户不知道模型到底思考了多久。

**适合性判断：**
适合，但稍复杂——需要在 streaming 开始时记录时间戳，结束时计算 delta 并传入 `ThinkingBlock`。后端不需要改动，纯前端状态管理。

**对创作控制感的影响：**
间接改善——用户对"这次推理值不值"有感知，也能对比不同模型的推理效率。

**对 1.0 用户价值的影响：**
中——锦上添花，但不是阻塞性问题。

**建议落地方式：**
- [ ] 直接改代码：`AgentPanel` 在 `thinking` 非空时记录 `thinkingStartedAt`，`isStreaming` 变为 `false` 后计算时长，传入 `ThinkingBlock` 作为可选 `duration` prop，在折叠的 header 中显示"推理 Xs"

---

### 借鉴点 4：Tool Call 与文字按执行顺序交错展示（历史消息）

**来源：** Claude.ai、Cursor、OpenPawz

**借鉴理由：**
Claude.ai 和 Cursor 在历史消息中都保留了工具调用与文字的交错顺序——用户能看到"模型先查了知识库，再写了这段话"，而不是"一段话 + 底部一堆工具卡片"。这对理解 AI 的推理决策过程至关重要，在创作工具场景中尤其有价值（用户想知道哪段内容是基于 RAG 结果生成的）。

**当前差距：**
`StoredMessageBubble` 渲染逻辑：先渲染 `msg.content`（全部文字），再渲染 `tool_calls_json`（全部工具调用）——两者都是平铺的，历史中工具调用永远在文字下方，顺序被丢弃。

根因在数据层：`ChatMessage` 只有 `content: string` 和 `tool_calls_json: string`，落库时没有保存交错顺序的 `segments` 或 `events` 列表。

**适合性判断：**
完全适合，且对 trpg-workbench 的创作场景价值极高——用户能追溯"AI 是先查了哪个知识库、才写出这段内容的"。

**对创作控制感的影响：**
显著改善——用户能重建 AI 的执行轨迹，而不是只看到结果。

**对 workbench 协同的影响：**
改善右栏 Agent 面板与知识库/工具层的可见性关联。

**对 1.0 用户价值的影响：**
高——多步工具链是 Director Agent 的核心工作方式，历史中无法还原顺序会让用户对 AI 的决策过程失去信任。

**改动范围评估：**

方案 A（推荐）：**在 `content` 字段中内联占位符**
- 落库时将 `content` 存为带 `{{tool:tool_id}}` 占位符的字符串，表示工具调用在文字中的位置
- `StoredMessageBubble` 渲染时按占位符分段，交替渲染文字片段和 `ToolCallCard`
- **后端改动**：`director.py` 落库逻辑在拼接 `content` 时插入占位符
- **前端改动**：`StoredMessageBubble` 解析占位符并分段渲染
- **数据库**：无 schema 变更，兼容存量消息（无占位符时降级为原有渲染）

方案 B：**新增 `segments_json` 字段**
- 新增 `ChatMessage.segments_json`，存储 `Array<{type: 'text'|'tool', content?: string, tool_id?: string}>`
- 需要 DB migration，对存量数据有兼容压力

**推荐方案 A**，无 schema 变更，向后兼容，改动集中在前后端各一处。

**建议落地方式：**
- [ ] 直接改代码：后端 `director.py` 落库时在 content 中插入 `{{tool:id}}` 占位符；前端 `StoredMessageBubble` 按占位符分段渲染

---

### 借鉴点 5：Agent 回复去除气泡边框，改为自然文档流排版

**来源：** OpenCode Desktop、Cursor

**借鉴理由：**
OpenCode 和 Cursor 的 AI 回复没有气泡边框——内容直接渲染在面板背景上，像阅读文档而不是聊天对话框。这种排版方式的优势：
- 视觉噪音更少，长内容更易阅读
- AI 回复与用户消息的对比通过字体/颜色/留白区分，而不是"框"来区分
- 适合 trpg-workbench 这类内容密集的创作工具——生成的 NPC、剧情、规则裁定往往篇幅较长，气泡边框对长内容体验极差

**当前差距：**
`StoredMessageBubble`（`AgentPanel.tsx:56`）和 `StreamingBubble`（`AgentPanel.tsx:171`）都使用：
```
background: "var(--bg-surface)"
border: "1px solid var(--border)"
borderRadius: "12px 12px 12px 4px"
padding: "8px 12px"
maxWidth: "88%"
```
AI 回复被装在一个圆角边框气泡里，与聊天 App 风格一致但不适合 workbench 创作工具定位。

**适合性判断：**
完全适合。trpg-workbench 的核心用户场景是"创作者与 AI 协作生成长内容"，不是"快问快答的 IM 聊天"。去掉气泡后：
- AI 回复：无边框，左对齐，内容直接流入，用 `padding-left` 留出与用户消息的视觉层次差异
- 用户消息：保留气泡（右对齐，有背景色），作为"对话发起"的视觉锚点
- tool call / thinking block：作为嵌套的内联元素自然出现在内容流中

**对创作控制感的影响：**
改善——去掉装饰性边框让用户更专注于内容本身，长内容阅读体验大幅提升。

**对 workbench 协同的影响：**
间接改善——右栏 Agent 面板视觉密度降低，内容层级更清晰。

**对 1.0 用户价值的影响：**
高——这是面板的基础视觉定位问题，越早确定越好，因为后续所有 Agent 面板的 UI 改动都依赖这个基础样式。

**改动范围：**
- `StoredMessageBubble`：AI 回复（`isUser === false`）去掉 `border`、`background`、`borderRadius`，改为 `padding-left: 12px` + `border-left: 2px solid var(--border)` 或直接无装饰；用户消息保持现有气泡样式
- `StreamingBubble`：同上，去掉外层容器的边框和背景
- 时间戳等附属元素样式微调

**建议落地方式：**
- [ ] 直接改代码：`AgentPanel.tsx` 中 `StoredMessageBubble` 和 `StreamingBubble` 的 AI 回复容器去掉气泡样式

---

## 三类结论区分

| 类别 | 结论 |
|------|------|
| **可直接参考的成熟机制** | 借鉴点 1（streaming 自动展开）、借鉴点 2（自动滚动）、借鉴点 5（去气泡）——逻辑简单，直接改 |
| **可借鉴但需改造** | 借鉴点 3（时长摘要）、借鉴点 4（tool call 顺序）——需要适配当前数据结构 |
| **当前不应优先做** | 在历史消息中回放 thinking（需要持久化 thinking duration，超出当前范围） |

---

## 优先级结论

### Top 1：Agent 回复去除气泡边框
- **建议行动：** 直接改代码（纯 CSS，小改）
- **预估影响：** 高——面板基础视觉定位，影响所有后续 UI 改动的基准
- **创作控制感提升：** 有（长内容阅读体验）
- **workbench 协同改善：** 间接
- **触发条件（若暂缓）：** N/A，应最先做，确定基线后其他改动在此基础上叠加

### Top 2：Streaming 期间自动展开 ThinkingBlock
- **建议行动：** 直接改代码（小改，约 3 行）
- **预估影响：** 高——Qwen3/DeepSeek 用户首次体验决定性改善
- **创作控制感提升：** 有
- **workbench 协同改善：** 间接（右栏 Agent 面板）
- **触发条件（若暂缓）：** N/A，建议立即做

### Top 3：Thinking 内容自动滚动到底部
- **建议行动：** 直接改代码（约 5 行）
- **预估影响：** 高——streaming UX 基础质量
- **创作控制感提升：** 有
- **workbench 协同改善：** 无
- **触发条件（若暂缓）：** N/A，建议随 Top 2 一起做

### Top 4：Tool Call 与文字按执行顺序交错展示（历史消息）
- **建议行动：** 直接改代码（方案 A，后端 + 前端各一处，中等改动）
- **预估影响：** 高——多步工具链是 Director 核心模式，历史可读性直接影响用户信任
- **创作控制感提升：** 有
- **workbench 协同改善：** 有（Agent 面板与知识库/工具可见性）
- **触发条件（若暂缓）：** N/A，建议与 Top 1+2+3 同批实施

### Top 5：Thinking 结束后显示时长摘要
- **建议行动：** 直接改代码（前端时间戳，中等改动）
- **预估影响：** 中
- **创作控制感提升：** 间接
- **workbench 协同改善：** 无
- **触发条件（若暂缓）：** Top 1-4 完成后再评估

---

## 不做的部分

- **在历史消息中展示 thinking 耗时**：需要后端持久化 `thinking_duration_ms` 字段，超出当前范围，暂缓
- **Thinking 内容的关键词摘要/折叠预览**：LLM 二次处理推理内容，成本高且意义有限，不做
- **用户可配置"是否展示 thinking"**：当前阶段用户群体全部有意使用推理模型，默认展示即可，配置项增加复杂度不值得
- **Tool call 顺序方案 B（新增 segments_json 字段）**：需要 DB migration，兼容压力大，不如方案 A 占位符方案轻量
