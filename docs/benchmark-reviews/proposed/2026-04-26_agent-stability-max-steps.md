---
status: proposed
date: 2026-04-26
source: OpenPawz, OpenCode Desktop
theme: Agent 稳定性与编排守卫
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# Agent 稳定性：max_steps 保护 + 结构化错误类型

## 来源与借鉴理由

OpenPawz 和 OpenCode Desktop 均有明确的 agent run 生命周期守卫——最大步数限制、工具调用失败时的结构化错误诊断、以及"Agent 卡住"的用户可见提示。OpenCode 还会在模型返回无效响应时显式告知用户，而非静默超时。

## 当前差距

- Director 没有向 agno 传递 `max_iterations`/`max_steps` 参数
- 本地模型调用失败或循环时，唯一终止机制是前端 10 分钟 AbortSignal 超时
- `except Exception` 只 emit 一个无类型 error 事件，用户无法判断是模型超时、工具调用失败、还是 Agent 逻辑循环
- 对于 Qwen 27B 等本地模型，工具调用可靠性低，循环情况较常见

## 适合性判断

强烈适合，且成本低。对本地模型尤其关键，是当前"不知道是模型原因还是 Agent 原因"这个感受的直接根因。

## 对创作控制感的影响

改善——用户知道 Agent 在做什么、是否卡住、应该怎么应对

## 对 workbench 协同的影响

改善 Agent 面板的可信赖感，用户能区分"任务失败"和"需要换个说法重试"

## 对 1.0 用户价值的影响

高优先级。这是当前最常见的使用挫折感根源之一。

## 建议落地方式

- [x] 直接改代码：
  1. `apps/backend/app/agents/director.py`：`Agent(max_iterations=8)` 加入构造参数
  2. `apps/backend/app/api/chat.py` / `director.py`：error SSE 事件增加 `reason` 字段区分 `max_steps_exceeded` / `tool_call_failed` / `model_timeout` / `unknown`
  3. `apps/desktop/src/components/agent/AgentPanel.tsx`：对 `max_steps_exceeded` 显示特殊提示："Agent 达到最大步数上限，请尝试将任务描述得更具体，或拆分为子任务"

## 不做的理由

无，应立即实施。
