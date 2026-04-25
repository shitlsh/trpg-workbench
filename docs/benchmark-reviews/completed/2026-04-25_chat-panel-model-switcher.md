---
status: completed
date: 2026-04-25
source: OpenPawz / 主流 LLM 客户端惯例（Claude.ai, ChatGPT, Cursor）
theme: 模型配置体验
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: code
---

# Chat 面板底栏模型切换器

## 来源与借鉴理由

所有成熟的 LLM 对话产品（Claude.ai、ChatGPT、Cursor Chat、OpenPawz）在输入框下方或旁边都提供模型选择器，这是用户感知"当前对话使用哪个模型"的标准 UI 位置。这不只是功能问题，而是 AI 状态可见性（AI visibility）的基础机制。

## 当前差距

- `AgentPanel.tsx` 底栏只有 `MentionInput` + 快捷键提示行，无模型 selector
- 当前模型名通过 `ContextUsageBadge` 在顶部只读展示，用户无法切换
- 切换模型必须离开对话页，进入 `WorkspaceSettingsPage` → 保存 → 返回，流程中断
- 后端 `SendMessageRequest`（packages/shared-schema）中 `model?: string` 字段**已存在**，只需前端传入

## 适合性判断

完全适合当前阶段：
- `SendMessageRequest.model` 已定义，后端已有 per-request model override 语义
- 实现为"本次会话临时覆盖"，不修改 workspace config，对架构零影响
- 不引入新的数据模型或 API 端点

## 对创作控制感的影响

直接改善——用户在创作过程中能实时感知并切换 AI 模型，是"AI 状态可见性"的核心体验之一。用户不应需要猜测"现在用的是哪个模型"。

## 对 workbench 协同的影响

改善 AgentPanel 的独立性——消除"切换模型必须离开对话"的页面跳转中断，让 AgentPanel 能独立完成完整的创作对话流程。

## 对 1.0 用户价值的影响

高——这是用户最直观判断"这是不是一个成熟 AI workbench"的视觉锚点。缺少底栏模型切换器会让产品感觉"不完整"。

## 建议落地方式

- [ ] 直接改代码：
  - `apps/desktop/src/components/agent/AgentPanel.tsx`（lines ~644-652 底栏区域）
    - 添加模型 selector（`<select>` 或 Popover 下拉）
    - 读取所有 LLMProfile 列表（已有 `useLLMProfiles` query）
    - 选中值为本次会话的临时 override（本地 state，不写入 workspace config）
    - 发送消息时将 `model` 字段传入 `SendMessageRequest`
  - `apps/backend/app/api/chat.py`（或对应聊天端点）
    - 确认 per-request model override 已被 backend 正确处理

## 不做的理由（如适用）

不适用——此功能明确建议实现。

## 实现细节建议

```typescript
// AgentPanel 底栏参考布局
<div className="flex items-center justify-between px-3 py-1 border-t text-xs text-muted-foreground">
  <ModelSelector
    profiles={llmProfiles}
    value={sessionModel ?? defaultLlmName}
    onChange={setSessionModel}
    placeholder="使用工作空间默认模型"
  />
  <span>Enter 发送 · Shift+Enter 换行 · @ 引用资产</span>
</div>
```

`sessionModel` 为 null 时发送请求不传 `model` 字段，后端使用 workspace config 的 `default_llm`。
