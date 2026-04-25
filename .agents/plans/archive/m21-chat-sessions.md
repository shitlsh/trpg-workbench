# M21：聊天会话管理

**前置条件**：无强依赖（ChatSession ORM、JSONL 存储、消息读取接口均已在 M4/M18 中完成；本 milestone 仅为补全 UI 入口和缺失的 CRUD 路由）。

**状态：✅ 已完成（2026-04-25）**

**目标**：让用户可以查看、切换、重命名和删除同一工作空间下的多条聊天历史，彻底解决"刷新即失忆"和"无法回溯历史对话"的体验断点。

---

## 背景与动机

> **来源**：`docs/benchmark-reviews/completed/2026-04-25_chat-session-management.md`

当前 AgentPanel 采用"永远只有一个 session"的简化模型：

- 页面挂载时如果 `agentStore.session === null` 就立即创建新 session，历史对话无处可见
- "新对话"按钮 `handleReset` 调用 `setSession(null)` + `setMessages([])`，上一轮对话被彻底遗忘（尽管 JSONL 文件仍在磁盘上）
- 没有 `GET /chat/sessions?workspace_id=` 路由——`chat_service.list_sessions()` 在 M18 中已经实现了服务层逻辑，但没有暴露为 API
- `GET /chat/sessions/{id}/messages` 路由已存在，但前端从不调用它（切换到已有 session 时不加载历史）

这导致：
1. 每次刷新/关闭 AgentPanel 都从空白重开，与 LLM 的对话上下文连贯性丧失
2. 用户无法回顾几天前与 Agent 的创作讨论
3. 多工作空间场景下，不同项目的对话历史无法区分浏览

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：补全后端 Session CRUD 路由**

当前 `api/chat.py` 缺少列表、删除、重命名三个端点，而服务层逻辑已存在。

方案：
- `GET /chat/sessions?workspace_id={id}` — 调用 `chat_service.list_sessions()`，返回 `ChatSession[]`（按 mtime 倒序）
- `DELETE /chat/sessions/{session_id}` — 删除 JSONL 文件 + DB 记录
- `PATCH /chat/sessions/{session_id}` — 更新 title 字段（DB + `session_metadata` 缓存）

**A2：会话列表面板（SessionDrawer）**

在 AgentPanel 左侧或顶部增加可折叠的会话列表面板。

方案：
- 新建 `SessionDrawer.tsx`：竖向列表，每项显示 title（截断到 2 行）、相对时间（"2 天前"）、message_count
- 列表项交互：点击切换，hover 显示重命名（`✏`）和删除（`🗑`）操作
- "新对话"按钮移入 SessionDrawer 顶部
- AgentPanel 顶部增加展开/收起 SessionDrawer 的 toggle 按钮（列表图标 + session title 或"新对话"提示）
- 使用 TanStack Query 的 `useQuery` 拉取 session 列表，`queryKey: ["sessions", workspaceId]`；每次创建/删除/切换后 `invalidateQueries`

**A3：切换 session 时加载历史消息**

当前切换 session 后 `messages` 直接被清空，不加载 JSONL 历史。

方案：
- `agentStore` 新增 `sessions: ChatSession[]` 列表 + `setActiveSesison(session, messages)` action
- 切换 session 时 `GET /chat/sessions/{id}/messages`，将返回的 `ChatMessage[]` 反序列化后写入 `agentStore.messages`
- `ChatMessage.tool_calls_json` 解析为 `ToolCall[]`，历史 ToolCallCard 正常渲染（只读，不可再确认）
- 加载中显示骨架屏（3 条灰色消息气泡）

**A4：页面初始化时恢复上次会话**

当前刷新页面后总是创建新 session，上一轮对话消失。

方案：
- 打开工作空间/AgentPanel 时，先 `GET /chat/sessions?workspace_id={id}&limit=1`，若存在最近 session 则直接加载（而非创建新 session）
- `localStorage` 缓存 `last_session_{workspaceId}`：存储 session id，下次打开优先恢复该 session；若 JSONL 不存在则 fallback 到列表中最新一条；若列表为空则创建新 session
- 首次进入工作空间（无历史 session）行为不变

**A5：shared-schema 类型修正**

修正已知的类型漏洞：

- `ChatSession` 补充 `message_count: number` 字段（ORM 和服务层均已有此字段）
- `ToolCall.status` 扩展为 `"running" | "done" | "error" | "auto_applied" | "pending_confirm"`（AgentPanel 中已使用但 schema 未声明）
- 新增 `UpdateChatSessionRequest { title: string }`
- 新增 `ChatSessionListResponse { sessions: ChatSession[] }`

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：会话搜索**：在 SessionDrawer 顶部增加搜索框，按 title 或消息内容全文检索。依赖 JSONL 全量扫描，性能未知，推迟到有实际需求时实现。
- **B2：会话导出**：将单条 session 的对话历史导出为 Markdown 或 JSON。与 M12 的导出系统协同规划。
- **B3：跨会话上下文引用**：Agent 在新会话中主动引用往期创作决策。需要会话摘要向量化，复杂度高，推迟。
- **B4：Pending proposals 持久化**：当前 `_pending_proposals` 是进程内 dict，进程重启或 session 切换后提案丢失。可写入 `.trpg/chat/{session_id}_proposals.json`，但实际 PatchProposal 的生命周期很短（创建即确认/拒绝），优先级低。

### C 类：明确不承诺

- 多用户协作/共享会话：本项目是本地单用户工具，不考虑
- 会话云同步：M21 专注本地体验，网络同步留给未来
- Agent 跨会话长期记忆/个性化：需要专门的记忆系统，不在本 milestone 范围

---

## 文件结构

### 新增文件

```
apps/desktop/src/components/agent/SessionDrawer.tsx   — 会话列表面板组件
```

### 修改文件

```
apps/backend/app/api/chat.py                           — 新增 GET /sessions、DELETE /sessions/{id}、PATCH /sessions/{id}
apps/desktop/src/components/agent/AgentPanel.tsx       — 接入 SessionDrawer；初始化改为恢复上次会话；消息历史加载
apps/desktop/src/stores/agentStore.ts                  — 新增 sessions 列表 + setActiveSession action
packages/shared-schema/src/index.ts                    — ChatSession + ToolCall 类型修正；新增 UpdateChatSessionRequest
```

---

## 关键设计约束

### 1. 列表数据来源

`list_sessions()` 扫描 `.trpg/chat/*.jsonl` 文件，按 mtime 排序，不依赖 DB 查询——这意味着：

- 若 JSONL 文件被手动删除，DB 记录会产生孤儿（但不影响列表正确性，因为列表以文件为准）
- DELETE 操作必须同时删除 JSONL 文件 **和** DB 记录，顺序：先删文件，再删 DB row，失败时安全：文件已删但 DB 残留可在下次 `list_sessions` 时过滤掉

```python
# api/chat.py
@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, workspace_id: str = Query(...), db = Depends(get_db)):
    ws = db.query(WorkspaceORM).filter_by(id=workspace_id).first()
    jsonl_path = chat_dir(ws.workspace_path) / f"{session_id}.jsonl"
    if jsonl_path.exists():
        jsonl_path.unlink()
    db.query(ChatSessionORM).filter_by(id=session_id).delete()
    db.commit()
```

### 2. 历史消息反序列化

`GET /chat/sessions/{id}/messages` 返回的 `ChatMessage[]` 中：
- `tool_calls_json` 字段是 JSON 字符串，前端需解析为 `ToolCall[]`
- 历史消息中的 `ToolCall.status` 可能包含非标准值（`"pending_confirm"` 来自 M19 旧代码），前端需做 fallback 处理

```tsx
// AgentPanel.tsx — switchToSession
async function switchToSession(s: ChatSession) {
  setActiveSession(s, []);  // 先切 session，清空 messages 显示骨架屏
  const raw = await apiFetch<ChatMessage[]>(`/chat/sessions/${s.id}/messages`);
  const messages: ChatMessage[] = raw.map(m => ({
    ...m,
    // 历史消息中 assistant 含 tool_calls_json，需反序列化为 ToolCall[]
  }));
  setActiveSession(s, messages);
  localStorage.setItem(`last_session_${workspaceId}`, s.id);
}
```

### 3. 初始化顺序（A4）

```
AgentPanel mount
  → GET /chat/sessions?workspace_id=X&limit=20
  → if sessions.length > 0:
      target = localStorage["last_session_X"] ?? sessions[0].id
      switchToSession(target)
  → else:
      POST /chat/sessions  →  setActiveSession(newSession, [])
```

### 4. SessionDrawer 布局约束

- **不可用路由 / 独立页面**：AgentPanel 是工作空间右侧面板，SessionDrawer 在 AgentPanel 内部实现，不引入新路由
- **折叠状态持久化**：`localStorage` 存 `agent_drawer_open_{workspaceId}`，默认 closed（不影响首次使用体验）
- **宽度**：SessionDrawer 展开时占 AgentPanel 左侧 200px，不影响聊天区滚动逻辑

---

## Todo

### A1：后端 Session CRUD 路由

- [x] **A1.1**：`api/chat.py` — 新增 `GET /chat/sessions?workspace_id=&limit=` 路由，调用 `chat_service.list_sessions()`
- [x] **A1.2**：`api/chat.py` — 新增 `DELETE /chat/sessions/{session_id}?workspace_id=` 路由，删除 JSONL + DB 记录
- [x] **A1.3**：`api/chat.py` — 新增 `PATCH /chat/sessions/{session_id}` 路由，更新 title
- [x] **A1.4**：验证 `chat_service.list_sessions()` 对空目录、单文件、多文件场景的边界处理（服务层已有 `if not cdir.exists(): return []` 防护）

### A2：SessionDrawer 组件

- [x] **A2.1**：`SessionDrawer.tsx` — 创建组件骨架：折叠/展开状态、"新对话"按钮、会话列表容器
- [x] **A2.2**：`SessionDrawer.tsx` — 实现会话列表项：title 截断、相对时间、message_count 徽章
- [x] **A2.3**：`SessionDrawer.tsx` — 实现 hover 操作：重命名内联编辑（`input` 替换 title span）、删除确认（inline 二次确认，不用 modal）
- [x] **A2.4**：`AgentPanel.tsx` — 接入 SessionDrawer，顶部增加 toggle 按钮（MessageSquare 图标，折叠状态持久化至 localStorage）
- [x] **A2.5**：TanStack Query `useQuery` 接入：`queryKey: ["sessions", workspaceId]`，`queryFn: GET /chat/sessions?workspace_id=`

### A3：切换 session 加载历史

- [x] **A3.1**：`agentStore.ts` — 新增 `sessions: ChatSession[]`、`setActiveSession(session, messages)` action
- [x] **A3.2**：`AgentPanel.tsx` — 实现 `switchToSession(s)`：先清空展示骨架屏，再 `GET /sessions/{id}/messages`，反序列化后写入 store
- [x] **A3.3**：`AgentPanel.tsx` — 历史消息中 assistant 类型消息的 `tool_calls_json` 解析为 `ToolCall[]`，渲染已有 ToolCallCard（只读）（`StoredMessageBubble` 已在 M19 实现，本 milestone 无需额外改动）

### A4：初始化恢复上次会话

- [x] **A4.1**：`AgentPanel.tsx` — 移除 `useEffect` 中的无条件 `POST /chat/sessions` 逻辑
- [x] **A4.2**：`AgentPanel.tsx` — 实现初始化流程：拉取 session 列表 → 按 `localStorage` 恢复 or 取最新 → 无历史时创建新 session
- [x] **A4.3**：`AgentPanel.tsx` — 创建/切换 session 时写 `localStorage["last_session_{workspaceId}"]`

### A5：shared-schema 类型修正

- [x] **A5.1**：`shared-schema/index.ts` — `ChatSession` 补充 `message_count: number`
- [x] **A5.2**：`shared-schema/index.ts` — `ToolCall.status` 扩展为 `"running" | "done" | "error" | "auto_applied" | "pending_confirm"`
- [x] **A5.3**：`shared-schema/index.ts` — 新增 `UpdateChatSessionRequest { title: string }`

---

## 验收标准

1. 打开工作空间的 AgentPanel，顶部有会话列表 toggle 按钮，点击展开 SessionDrawer，能看到该工作空间下所有历史 session（按最新在前排列）
2. 刷新页面后，AgentPanel 自动恢复上次打开的 session，聊天记录完整显示（包括历史 ToolCallCard）
3. 在 SessionDrawer 中点击另一条 session，聊天区切换为该 session 的历史消息，加载过程显示骨架屏
4. hover 一条 session 项，出现重命名按钮；点击进入内联编辑状态，回车保存，session 标题立即更新
5. hover 一条 session 项，出现删除按钮；点击出现内联二次确认；确认后该 session 从列表消失，对应 JSONL 文件从磁盘删除
6. 点击"新对话"按钮，创建新 session，AgentPanel 切换到空白对话，新 session 出现在列表顶部
7. 同一工作空间开两个窗口（重载一次），列表内容一致（以文件系统为准）
8. TypeScript 编译无与 `ToolCall.status` 或 `ChatSession.message_count` 相关的类型错误

---

## 与其他里程碑的关系

```
M4（ChatSession ORM + /chat/sessions POST + JSONL 消息存储）
M18（file-first workspace，.trpg/chat/ 目录布局，list_sessions 服务层）
  └── M21（本 milestone）：补全 CRUD 路由 + 补全前端 session 管理 UI
```

---

## 非目标

- **跨工作空间的会话管理**：AgentPanel 始终在单个工作空间上下文内，跨空间聚合视图不做
- **会话数量上限 / 自动归档**：0.1.0 未发布，磁盘管理交给用户，不加限制逻辑
- **实时消息推送（WebSocket）**：刷新列表用轮询或手动 invalidate 即可，WebSocket 复杂度不值得
- **Pending proposals 持久化**：PatchProposal 生命周期极短（秒级确认/拒绝），切换 session 前应完成当前提案；不实现跨 session 提案持久化
- **会话内搜索（消息全文检索）**：列为 B1，不在本 milestone 实现
