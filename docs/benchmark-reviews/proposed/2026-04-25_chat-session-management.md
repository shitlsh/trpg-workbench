---
status: proposed
date: 2026-04-25
source: Internal (M19 agent-context-control review spillover)
theme: 聊天会话管理（多会话列表、切换、历史浏览）
priority: medium
affects_creative_control: no
affects_workbench_collab: yes
recommended_action: plan
---

# 聊天会话管理

## 问题

当前 Agent 面板只有一个"当前会话"，无法管理多个对话：

- 打开 AgentPanel 时自动创建新 session，无 session 选择 UI
- "新建对话"按钮丢弃当前会话（从 UI 角度），无法回到旧会话
- 旧会话的 JSONL 文件存在磁盘上但完全不可访问
- `list_sessions()` 在 `chat_service.py` 中已实现，但没有对应的 API 端点

## 目标

用户可以创建、切换、浏览、删除聊天会话，支持多个并行对话。

## 设计

### 会话列表侧栏

在 Agent 面板左侧或顶部增加会话列表：
- 显示所有会话（按时间倒序），每条显示首条消息摘要和时间
- 点击切换当前会话
- 右键或滑动可删除会话
- "新建对话"创建空白会话并切换过去

### API 端点补全

| 端点 | 功能 |
|------|------|
| `GET /chat/sessions` | 列出工作空间下所有会话 |
| `DELETE /chat/sessions/{id}` | 删除会话（删除 JSONL 文件） |

### 涉及改动

| 模块 | 改动 |
|------|------|
| `api/chat.py` | 新增 list/delete 端点 |
| `AgentPanel.tsx` | 新增会话列表 UI，session 切换逻辑 |
| `services/chat_service.py` | 新增 `delete_session()` |

## 建议落地方式

- [ ] 可作为独立小型 milestone 或并入其他 UX 改进 milestone
- [ ] 不阻塞 M19（Agent 上下文控制），可在 M19 之后做
