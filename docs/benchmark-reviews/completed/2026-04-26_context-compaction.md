---
status: completed
date: 2026-04-26
source: OpenCode Desktop
theme: 上下文窗口管理与 Compaction
priority: high
affects_creative_control: yes
affects_workbench_collab: indirect
recommended_action: code
---

# 上下文即将耗尽时的主动 Compaction 与用户提示

## 来源与借鉴理由

OpenCode Desktop 在上下文接近上限时会自动触发 compaction——将历史会话压缩成摘要注入新上下文，而非静默截断。用户会看到明确提示，对话可以继续而无需手动开新会话。

## 当前差距

`trim_to_budget()` 直接从头丢弃旧消息（字符数 ≤ 8000，最多 10 轮），无任何提示。ContextUsageBadge 显示进度条但只建议"开新会话"——这对正在进行的长对话来说是破坏性的中断。被静默丢弃的历史直接导致 Agent 失忆、重复工作。

## 适合性判断

高度适合。TRPG 冒险策划往往是长对话，背景设定、已生成资产、用户偏好都需要在上下文中保持。

## 对创作控制感的影响

显著改善——用户知道发生了什么，可以决定是否继续，而不是困惑于"为什么 Agent 不记得之前说的话"

## 对 workbench 协同的影响

间接改善 Agent 面板的可预期性

## 对 1.0 用户价值的影响

高。是当前最常见的"莫名其妙不记得了"体验问题根因。

## 建议落地方式

分两阶段：

**Phase 1（直接改代码，1小时，高价值）：**
- [ ] `apps/backend/app/services/chat_service.py`：`trim_to_budget()` 触发截断时返回一个 flag（如 `truncated: bool`）
- [ ] `apps/backend/app/api/chat.py`：在发送给 director 之前，若 `truncated=True`，在历史消息队列头部插入一条 `system` 角色消息："[系统提示：对话历史较长，部分早期内容已移出上下文窗口]"
- [ ] 前端：历史中出现 `role=system` 的截断提示消息时，以浅色分割线样式区别于普通气泡展示

**Phase 2（中改，需额外 LLM 调用）：**
- [ ] 截断前调用轻量 LLM 生成历史摘要（≤200字），将摘要作为 system 消息注入替代被丢弃的原始轮次
- [ ] 摘要生成失败时降级到 Phase 1 的静默截断+提示

## 不做的理由

Phase 1 无理由不做。Phase 2 等 Phase 1 验证有效后再推进。
