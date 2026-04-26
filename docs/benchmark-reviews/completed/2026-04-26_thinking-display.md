---
status: completed
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

## 实现进度

### Phase 1 — 工具调用顺序感（纯前端）✅ 已完成

提交：`f3fa24b`

- [x] 将 streaming state 从两个独立列表（`streamingText` + `streamingToolCalls`）改为统一时序事件序列 `StreamEvent[]`
- [x] `text_delta` → 追加到最后一个 `text_chunk` 或新建
- [x] `tool_call_start` / `auto_applied` → push `{ kind: "tool_call" }`
- [x] `tool_call_result` → 用 id 更新对应 tool_call 的 status/result_summary
- [x] `StreamingBubble` 按 `events` 顺序渲染，blinking cursor 在最后一个 text_chunk 末尾
- [x] TypeScript 零错误

### Phase 2 — Thinking Token 折叠展示 ✅ 已完成

agno 2.5.17 透传 `ReasoningContentDelta` 事件（`reasoning_content` 字段），无需绕过 model_adapter。

#### 后端

- [x] `director.py`：捕获 `ReasoningContentDelta` 事件，emit `thinking_delta` SSE
- [x] `chat.py`：增加 `thinking_buffer: list[str]`，处理 `thinking_delta`，`done` 时将 `"".join(thinking_buffer)` 作为 `thinking_json` 写入 JSONL
- [x] `chat_service.append_message`：新增 `thinking_json: str | None = None` 参数
- [x] `ChatMessageSchema`（`schemas.py`）：新增 `thinking_json: str | None = None` 字段
- [x] 向后兼容：旧 JSONL 记录无此字段，Pydantic 默认填 `None`

#### 前端

- [x] `shared-schema`：`ChatMessage` 增加 `thinking_json: string | null`
- [x] 新增 `ThinkingBlock` 组件：默认折叠，点击展开；streaming 时 header 有呼吸灯小圆点
- [x] `StreamingBubble`：接受 `thinking` + `isStreaming` props，在顶部渲染 `ThinkingBlock`
- [x] `StoredMessageBubble`：历史消息如有 `thinking_json` 则渲染 `ThinkingBlock`
- [x] 新增 `streamingThinking` state，处理 `thinking_delta` SSE 事件
- [x] 所有 `ChatMessage` 构造（fakeUserMsg / assistantMsg / errMsg）补全 `thinking_json` 字段
- [x] `@keyframes blink` 添加到 `index.css`（修复 code review 发现的遗漏）
- [x] `streamDone` flag 在 `done`/`error` 后提前退出读循环（修复 code review 发现的问题）

#### 存储格式说明

`thinking_json` 字段名沿用 `_json` 后缀约定，但存储的是**纯文本字符串**（不是 JSON 序列化的数组），与 `tool_calls_json`（存 `json.dumps(list)`）有所不同。原因：thinking 内容是单一文本，无需数组包装；TS 注释已说明这一点。
