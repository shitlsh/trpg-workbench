# M28：Agent 运行时切换到原生 SDK

**前置条件**：M27 完成（资产单步/批处理工具链稳定，可作为新运行时回归基线）。

**目标**：将聊天主链路从 Agno 强依赖迁移为 Provider 原生 SDK 驱动，保留现有记忆、RAG、LanceDB、SSE 协议与前端交互体验。

---

## 背景与动机

当前实现中，记忆（JSONL）、知识库 ingest/RAG（chunk/embedding/retriever）、向量索引（LanceDB）、SSE 前端协议等核心能力均由项目自研；Agno 主要承担 Agent/tool-calling 运行时。

在 DeepSeek thinking 与部分 provider 流式事件场景下，Agno 运行时出现协议兼容瓶颈（如 reasoning_content 回传约束、事件粒度不一致导致的可视化断层），使系统稳定性和可控性受限。

M28 目标是“去框架化核心运行时”：保留数据与知识层投资，替换聊天编排层为原生 SDK，建立 provider capability policy。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：聊天主链路原生化（Director/Explore）**

方案：在 `api/chat.py` 与 `agents/` 下引入统一 provider runtime adapter，替代 `Agent.arun` 主循环；保持现有 SSE 事件契约（`text_delta` / `thinking_delta` / `tool_call_start` / `tool_call_result` / `agent_question` / `done` / `error`）不变。

**A2：工具调用循环与问答中断机制迁移**

方案：用原生 SDK 实现 tool-calling loop，支持 `ask_user -> agent_question interrupt`、工具执行结果回灌、异常恢复；确保与现有 `tools.py`/`QuestionCard` 兼容。

**A3：provider 能力矩阵与降级策略**

方案：为各 provider 建立能力声明（thinking、reasoning 回传、tool-call 流式粒度、JSON mode），运行时按策略自动降级（如 disable thinking、retry without reasoning），避免会话中断。

**A4：兼容层收敛与回归验证**

方案：将 Agno 相关适配缩到可选兼容层（非主链路）；完成会话流、工具卡片实时展示、ask_user 往返、资产写入与回滚的端到端回归。

**A5：全量去 Agno 收尾（允许移除依赖）**

方案：将剩余 Agno 调用点（TOC 分析、profile 测试、子 Agent）统一迁移到原生 SDK runtime，清理 requirements 与代码引用，确保 M28 完成时可移除 `agno` 依赖且业务行为保持一致。

### B 类：后续扩展（规划为扩展，不强制当前实现）

- **B1：provider replay harness**：加入多 provider 协议回放测试与录制。
- **B2：跨 provider 成本/延迟观测面板**：把 runtime policy 命中与降级次数可视化。

### C 类：明确不承诺

- 不在 M28 内重写知识库 ingest/RAG 数据层。
- 不在 M28 内引入新的外部云向量服务或消息队列。
- 不在 M28 内做前端大改版（只做必要协议兼容 UI 调整）。

---

## 文件结构

### 修改文件

```
apps/backend/app/api/chat.py
apps/backend/app/agents/director.py
apps/backend/app/agents/explore.py
apps/backend/app/agents/tools.py
apps/backend/app/agents/model_adapter.py
apps/backend/app/agents/chat_input_messages.py
apps/backend/app/agents/consistency.py
apps/backend/app/agents/rules.py
apps/backend/app/agents/skill_agent.py
apps/backend/app/services/chat_service.py
apps/backend/app/models/schemas.py
apps/backend/app/api/llm_profiles.py
apps/backend/app/api/prompt_profiles.py
apps/backend/app/knowledge/toc_analyzer.py
apps/backend/requirements.txt
apps/desktop/src/components/agent/AgentPanel.tsx
packages/shared-schema/src/index.ts
```

### 新增文件（建议）

```
apps/backend/app/agents/runtime/
  provider_runtime.py
  openai_compatible_runtime.py
  anthropic_runtime.py
  google_runtime.py
  policy.py
```

---

## 关键设计约束

1. **SSE 协议向后兼容**
   - 前端不应感知到协议字段变化；新增字段只能追加，不可替换现有字段。

2. **记忆与数据真相源不迁移**
   - `chat_service` 的 JSONL 历史与 `knowledge/*` 数据结构保持不变。

3. **工具接口不破坏**
   - `tools.py` 的输入输出 contract 不变；运行时仅替换调度层。

4. **provider 降级显式且可观测**
   - 每次触发降级必须有结构化日志，便于回溯兼容问题。

---

## Todo

### A1：聊天主链路原生化（Director/Explore）

- [ ] **A1.1**：`apps/backend/app/agents/runtime/*` — 新建 provider runtime 抽象与统一 stream event 适配器
- [ ] **A1.2**：`apps/backend/app/api/chat.py` — 切换到新 runtime 调度入口，保留现有 SSE 外观
- [ ] **A1.3**：`apps/backend/app/agents/director.py` — 将 Agno 依赖改为 runtime 驱动
- [ ] **A1.4**：`apps/backend/app/agents/explore.py` — 将 Agno 依赖改为 runtime 驱动

### A2：工具调用循环与问答中断机制迁移

- [ ] **A2.1**：`apps/backend/app/agents/tools.py` — 校验 ask_user payload 与中断语义，补齐边界处理
- [ ] **A2.2**：`apps/backend/app/api/chat.py` — tool_call_start/result、agent_question、done 事件顺序一致性保障
- [ ] **A2.3**：`apps/desktop/src/components/agent/AgentPanel.tsx` — 工具卡片与问题卡片流式显示回归修复
- [ ] **A2.4**：`apps/backend/app/api/chat.py` + `apps/desktop/src/components/agent/AgentPanel.tsx` — 同一会话支持 turn-level `explore/director` 模式切换（不再强制分会话）
- [ ] **A2.5**：`apps/backend/app/agents/tools.py` + `apps/backend/app/agents/runtime/provider_runtime.py` + `apps/desktop/src/components/agent/ToolCallCard.tsx` — 子 Agent 执行轨迹（trace）透传与 UI 展示

### A3：provider 能力矩阵与降级策略

- [ ] **A3.1**：`apps/backend/app/agents/runtime/policy.py` — 能力声明（thinking/reasoning/tool-stream/json）
- [ ] **A3.2**：`apps/backend/app/agents/model_adapter.py` — 收敛为配置与鉴权层，移除主运行时职责
- [ ] **A3.3**：`apps/backend/app/api/chat.py` — 特定协议错误自动降级重试（一次）

### A4：兼容层收敛与回归验证

- [ ] **A4.1**：`apps/backend/app/services/chat_service.py` — 历史消息回放字段（reasoning/tool）一致性校验
- [ ] **A4.2**：`packages/shared-schema/src/index.ts` — 如有新增 stream 字段，更新共享类型
- [ ] **A4.3**：`apps/backend` + `apps/desktop` — 端到端回归（DeepSeek、Haiku、Gemini 至少各 1 条）

### A5：全量去 Agno 收尾（允许移除依赖）

- [ ] **A5.1**：`apps/backend/app/knowledge/toc_analyzer.py` — TOC PDF/CHM 分析切到原生 SDK runtime
- [ ] **A5.2**：`apps/backend/app/api/llm_profiles.py` + `apps/backend/app/api/prompt_profiles.py` — 测试接口改为原生 runtime
- [ ] **A5.3**：`apps/backend/app/agents/consistency.py` / `rules.py` / `skill_agent.py` — 子 Agent 推理链路去 Agno
- [ ] **A5.4**：`apps/backend/requirements.txt` — 移除 `agno` 依赖并补齐原生 SDK 所需依赖
- [ ] **A5.5**：全仓 `from agno` 扫描归零（注：允许 docs 历史记录中保留文本引用）

---

## 验收标准

1. 在 DeepSeek v4 thinking 场景下，工具调用链不再因 reasoning_content 协议报错中断。
2. 在 Claude Haiku 场景下，流式文本不再出现“半句截断”且工具卡片按过程展示。
3. `ask_user` 触发时前端稳定显示问题卡片，用户回答后可继续同一任务链路。
4. 历史会话回放与新会话行为一致，不出现 provider 特定的回放崩溃。
5. 现有 RAG 检索、知识库 ingest、资产写入流程在 M28 后无行为回退。
6. 运行时代码路径不再依赖 Agno；`apps/backend` 安装依赖中可移除 `agno` 并通过启动与回归测试。

---

## 与其他里程碑的关系

```
M27（资产单步操作与批处理）
  └── M28（原生 SDK Agent 运行时替换）
        ├── B1：provider replay harness
        └── B2：跨 provider 成本/延迟观测面板
```

---

## 非目标

- 不在本 milestone 中重做 Prompt 体系。
- 不在本 milestone 中调整 RuleSet/Workspace 业务模型。
- 不在本 milestone 中引入新的前端状态管理框架或通信协议。
