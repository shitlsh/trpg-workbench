---
status: proposed
date: 2026-04-26
source: OpenPawz
theme: Thinking/Reasoning 过程展示
priority: medium
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# Thinking Token 的折叠展示

## 来源与借鉴理由

OpenPawz 将模型的 reasoning/thinking 内容以折叠块展示——默认收起，点击展开看完整推理链。用户不必被强迫看到，但需要时可以审查 Agent 的推理过程。

## 当前差距

后端 agno 层完全丢弃 thinking token（director.py 不处理任何 thinking 事件类型）。前端固定显示"思考中..."占位符，是纯 UI 状态而非真实推理内容。对于 Qwen 3 这类支持 `enable_thinking=True` 的模型，推理过程完全不可见。

## 适合性判断

适合，且有 TRPG 场景特有的额外价值——用户可以看到"Agent 为什么这样设计这个 NPC 的背景故事"，这本身就是创作参考。

## 对创作控制感的影响

显著改善——用户可以审查 Agent 的推理是否符合创作意图，及时发现偏差

## 对 workbench 协同的影响

改善 Agent 面板信息密度，让 Agent 面板从"黑箱结果输出"变为"可审查的推理过程"

## 对 1.0 用户价值的影响

中。非紧急但差异化价值较高，是 trpg-workbench 区别于普通 chatbot 的体验标志。

## 建议落地方式

- [ ] 直接改代码：
  1. `apps/backend/app/agents/director.py`：在 agno event 处理循环中捕获 `ThinkingContent` / `ReasoningContent` 类型事件，emit 新 SSE 类型 `thinking_delta`（`{"content": "..."}` 增量流）
  2. `apps/desktop/src/components/agent/AgentPanel.tsx`：新增 `thinkingText` 累积 state，处理 `thinking_delta` 事件
  3. `apps/desktop/src/components/agent/StreamingBubble.tsx`（或新增组件）：在助手气泡上方显示折叠块"💭 推理过程"，默认收起，点击展开显示 thinking 内容（monospace 小字，浅色）
  4. thinking 内容在 `done` 事件后随消息一起持久化存储（`tool_calls_json` 扩展或新字段）

## 不做的理由

当前 agno 版本（2.5.x）对 thinking token 的事件类型需要确认，实现前需验证 agno 是否透传 thinking 事件。如 agno 不支持，则需要通过 model_adapter 层直接捕获原始 API 响应。
