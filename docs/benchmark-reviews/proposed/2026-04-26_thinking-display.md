---
status: proposed
date: 2026-04-26
source: OpenPawz, 用户实测反馈
theme: Thinking/Reasoning 过程展示 + 工具调用 UX 打磨
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# Thinking Token 折叠展示 + 工具调用顺序感 UX

## 来源与借鉴理由

OpenPawz 将模型的 reasoning/thinking 内容以折叠块展示——默认收起，点击展开看完整推理链。用户不必被强迫看到，但需要时可以审查 Agent 的推理过程。

此外，用户实测反馈当前工具调用展示缺乏"思考顺序感"：所有 ToolCallCard 被统一打包渲染在文本上方，用户无法感知 Agent 先调用了什么工具、再输出了什么文字，整体像一个静态的结果块而非动态推理过程。

---

## 当前差距

### A. Thinking Token 不可见

后端 agno 层完全丢弃 thinking token（`director.py` 不处理任何 thinking 事件类型）。前端固定显示"思考中..."占位符，是纯 UI 状态而非真实推理内容。对于 Qwen 3 这类支持 `enable_thinking=True` 的模型，推理过程完全不可见。

### B. 工具调用无顺序感（用户实测）

**问题**：`StreamingBubble` 先渲染所有 `toolCalls`，再渲染 `content` 文本。这意味着 ToolCallCard 始终出现在文字上方，而不是按调用发生的先后顺序插入。用户看到的是：

```
[工具调用1] [工具调用2] [工具调用3]   ← 全部打包在顶部
然后是 Agent 的文字回复...
```

而理想的顺序感应为：

```
💭 思考中（或 thinking block）
[工具调用1：running → done]
[工具调用2：running → done]
Agent 开始写文字...（流式追加）
[工具调用3（若在文字后触发）]
```

**根因**：`AgentPanel.tsx` 的 streaming state 将 `streamingToolCalls` 和 `streamingContent` 分开存储，`StreamingBubble` 先渲染所有 toolCalls 再渲染文字，没有统一的时序序列。

### C. ToolCallCard 布局 bug（已修复）

- `web_search` 无中文标签 → **已修复**：加入 `TOOL_LABELS`
- 知识库检索等工具在窄左栏中 header 行文字被压缩为"一次一个字"竖排 → **已修复**：flex 子元素加 `flexShrink: 0` / `minWidth: 0`

---

## 适合性判断

适合，且有 TRPG 场景特有的额外价值——用户可以看到"Agent 为什么这样设计这个 NPC 的背景故事"，这本身就是创作参考。

---

## 对创作控制感的影响

显著改善——用户可以审查 Agent 的推理是否符合创作意图，及时发现偏差。

---

## 对 workbench 协同的影响

改善 Agent 面板信息密度，让 Agent 面板从"黑箱结果输出"变为"可审查的推理过程"。

---

## 对 1.0 用户价值的影响

中。非紧急但差异化价值较高，是 trpg-workbench 区别于普通 chatbot 的体验标志。

---

## 建议落地方式

### Phase 1 — 工具调用顺序感（纯前端，无需后端）

将 streaming state 从"两个独立列表"改为"统一时序事件序列"：

```typescript
// 当前
streamingContent: string
streamingToolCalls: ToolCall[]

// 目标
type StreamEvent =
  | { kind: "text_chunk"; text: string }
  | { kind: "tool_call"; toolCall: ToolCall }

streamingEvents: StreamEvent[]
```

- `text_delta` SSE 事件 → `push({ kind: "text_chunk", text })`（追加到最后一个 text_chunk 或新建）
- `tool_call` SSE 事件 → `push({ kind: "tool_call", toolCall })`
- `tool_result` SSE 事件 → 更新对应 toolCall 的 status/result_summary
- `StreamingBubble` 按 `streamingEvents` 顺序渲染：text_chunk 用 `<ReactMarkdown>`，tool_call 用 `<ToolCallCard>`

**效果**：用户看到工具调用与文字按实际发生顺序交替出现。

### Phase 2 — Thinking Token 折叠展示（需后端配合）

1. **后端** `apps/backend/app/agents/director.py`：在 agno event 处理循环中捕获 `ThinkingContent` / `ReasoningContent` 类型事件，emit 新 SSE 类型 `thinking_delta`（`{"content": "..."}` 增量流）
2. **前端** `AgentPanel.tsx`：新增 `thinkingText` 累积 state，处理 `thinking_delta` 事件；在 `streamingEvents` 序列最前方插入 thinking block
3. **UI**：在助手气泡最顶部显示折叠块"💭 推理过程"，默认收起，点击展开显示 thinking 内容（monospace 小字，`var(--text-subtle)` 色）
4. **持久化**：thinking 内容在 `done` 事件后随消息存入新字段（DB schema 扩展或 `tool_calls_json` 旁新增 `thinking_json`）

---

## 前置验证

当前 agno 版本（2.5.x）对 thinking token 的事件类型需要确认，实现 Phase 2 前需验证 agno 是否透传 thinking 事件。如 agno 不支持，则需要通过 model_adapter 层直接捕获原始 API 响应。

Phase 1 无此依赖，可独立先行。
