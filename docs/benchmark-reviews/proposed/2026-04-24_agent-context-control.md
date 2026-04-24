---
status: proposed
date: 2026-04-24
source: Internal (baseline goal reassessment)
theme: Agent 上下文控制（@引用 + 选择面板 + 智能自动）
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# Agent 上下文控制：@引用 + 选择面板 + 智能自动

## 问题

当前用户无法主动控制 Agent 看到哪些资产内容：

- 聊天输入框是纯文本 `<textarea>`，没有 @mention、文件引用、附件功能
- Director 只看到所有资产的元数据（类型/名称/slug），不看内容
- 修改资产时，目标资产通过 Director 澄清问答间接确定
- 用户无法说"参考这个 NPC 来修改那个场景"并确保 Agent 真的读了这两个资产

对比成熟的 AI 创作/编码工具（Cursor @file、OpenCode @file、Copilot Chat 文件附加），这是一个明显的控制感缺失。

## 目标

提供三层上下文控制机制，从显式到隐式：

### Layer 1：@资产引用（显式、精确）

在聊天输入框中支持 `@资产名` 引用语法。

**交互设计**：
- 用户输入 `@` 时，弹出资产自动补全列表（按类型分组，支持模糊搜索）
- 选中后插入 `@赵探长` 标记（渲染为带颜色的 chip/tag）
- 发送消息时，引用的资产 ID 随消息一起发到后端
- 后端将引用资产的完整内容（Markdown + JSON）注入 Agent 上下文

**数据流**：
```
用户输入 "参考 @赵探长 修改 @开场场景 的描述"
  → 前端解析出 asset_ids: ["zhao-detective", "scene-01-opening"]
  → SendMessageRequest 增加 referenced_asset_ids 字段
  → 后端加载这些资产的完整内容
  → 注入到 Agent prompt 中作为 [参考资产]
```

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `AgentPanel.tsx` | textarea 改为支持 @mention 的富文本输入（或用库如 `@draft-js-plugins/mention`、`@tiptap/extension-mention`，或简单正则匹配） |
| `SendMessageRequest` (schema) | 新增 `referenced_asset_ids: list[str]` |
| `chat.py` | 根据 referenced_asset_ids 加载完整资产内容并注入上下文 |
| Director prompt | 增加 [用户引用的资产] 区块 |

### Layer 2：上下文选择面板（显式、批量）

在 Agent 面板中增加可折叠的"上下文资产"区域，用户可勾选要包含在对话上下文中的资产。

**交互设计**：
- Agent 面板顶部（或输入框上方）有"上下文"折叠区
- 展开后显示当前 workspace 的资产列表（按类型分组，带 checkbox）
- 勾选的资产在整个对话期间持续提供给 Agent
- 类似 Cursor 的 Context 面板或 VS Code Copilot Chat 的 #file 引用

**适用场景**：
- 用户在一次对话中需要反复引用同一组资产
- 比逐条 @mention 更高效

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `AgentPanel.tsx` | 新增 ContextPanel 子组件 |
| `editorStore.ts` 或新 store | 存储当前会话的 pinned context asset IDs |
| `chat.py` | 从 session 级上下文读取 pinned assets |

### Layer 3：智能自动模式（隐式、改进现有）

改进 Director 使其能在需要时自动读取相关资产的完整内容，而不只是看元数据。

**当前问题**：Director 看到的 `existing_assets` 只有 `{"type", "name", "slug"}`，无法判断内容是否相关。

**改进方案**：
- Director 的第一轮分析后，如果判断需要参考某些资产，自动触发一个"资产读取"步骤
- 或者：在 `existing_assets` 中包含每个资产的 `summary`（摘要，已在 AssetORM 中有此字段），让 Director 基于摘要判断哪些资产需要深入读取
- 或者：引入 Agent tool-calling，让 Director 可以调用 `read_asset(slug)` 工具获取完整内容

**建议实现**：先在 `existing_assets` 中加入 `summary` 字段（改动最小），让 Director 能做出更好的判断。Tool-calling 作为后续增强。

**涉及改动**：

| 模块 | 改动 |
|------|------|
| `utils.py` / `get_workspace_context` | existing_assets 中增加 summary 字段 |
| Director prompt | 指导 Director 基于 summary 判断相关性 |
| （后续）Agent tool-calling | Director 可调用 read_asset 工具 |

## 三层机制的关系

```
精确度高 ←────────────────────────────→ 精确度低
用户主动 ←────────────────────────────→ 系统自动

  @引用          上下文面板          智能自动
  (单次精确)     (会话级批量)       (Agent 自行判断)
```

三层互补，不冲突：
- @引用解决"这条消息我要 Agent 看这个"
- 上下文面板解决"这轮对话我都要 Agent 参考这些"
- 智能自动兜底"用户没指定时 Agent 自己别瞎猜"

## 实施优先级

| 阶段 | 内容 | 价值 |
|------|------|------|
| **P0** | @资产引用 | 最直接解决"我要 Agent 看这个"的需求 |
| **P1** | 智能自动改进（summary 注入） | 改动最小，立即提升 Director 判断质量 |
| **P2** | 上下文选择面板 | 批量场景的效率优化 |

P1 改动极小（`get_workspace_context` 中加一个字段），建议和 P0 一起做。

## 风险

1. **@mention 输入组件**：纯 textarea 不支持富文本 mention，需要引入输入组件库或自行实现。可考虑简单方案：正则匹配 `@xxx` 后弹浮层，不需要完整的富文本编辑器
2. **上下文长度**：勾选太多资产会超出 LLM 上下文窗口。需要在 UI 上显示 token 估算，或限制最大勾选数量
3. **与 file-first 的协同**：如果同时做 file-first 重构，资产读取路径会变化，需协调

## 开发 Skill 更新

实施本 proposal 时，以下 `.agents/skills/` 必须同步更新：

| Skill | 需要更新的内容 |
|-------|---------------|
| `frontend-ui-patterns` | 新增 @mention 输入组件模式、上下文面板组件规范 |
| `agent-workflow-patterns` | Agent 上下文注入方式变化，新增 referenced_asset_ids 数据流 |
| `trpg-workbench-architecture` | SendMessageRequest schema 变化、上下文组装逻辑 |

## 建议落地方式

- [x] plan：新 milestone，P0+P1 一起做
- [ ] P2 可以延后到下一个 milestone
