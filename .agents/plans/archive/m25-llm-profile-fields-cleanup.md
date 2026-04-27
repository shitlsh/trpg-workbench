# M25：LLM Profile 字段瘦身与模型选择体验升级

**前置条件**：无强依赖（纯 LLM 配置层重构与前端组件升级，不依赖前序 milestone 的新能力）。

**状态：✅ 已完成（commit cb1aa48）**

**目标**：移除 LLMProfile 上 5 个未被读取的死字段，把模型能力归位到 ModelCatalog，升级模型选择下拉框（按能力过滤、搜索、能力/token 展示），在 UI 层守住「任务依赖 JSON/tools」的硬约束。

---

## 背景与动机

LLM Profile 上 temperature / max_tokens / supports_* / timeout 等字段长期未被运行时读取，却暴露在设置表单中，容易误导用户；模型能力本应来自模型目录而非供应商 Profile。同时默认模型下拉缺少搜索与能力展示，用户易选到不支持 tool calling 或 JSON 输出的模型。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

- 从 `LLMProfileORM` 与 API schema 中移除死字段（0.1a 前可不写数据库迁移）。
- `model_capabilities` / `llm_defaults` / 全局 LLM 超时 settings。
- `get_llm_for_task` 返回温度；`chat` / 摘要 / `toc_analyzer` / `generate_prompt` 使用任务温度。
- `model_from_profile` 接入全局请求超时。
- 升级 `ModelNameInput`：catalog + probe 合并、搜索、能力过滤、能力徽章与 token 展示。
- 各调用方传入 `requireTools` / `requireJsonMode`；Settings 中 LLM 表单仅保留 name / provider / base_url / api_key。

### B 类：后续扩展

- `toc_analyzer` 使用 API 级 `response_format=json_object`（若供应商支持）。
- Director 按 `supports_tools` 动态决定是否挂全量 tools。

### C 类：明确不承诺

- 不修改 EmbeddingProfile / RerankProfile。
- 不扩大 probe API 协议；不自动批量补全 catalog 能力字段。

---

## 文件结构

### 修改/新增

- `apps/backend/app/models/orm.py` — 精简 `LLMProfileORM`
- `apps/backend/app/models/schemas.py` — 同步 LLM profile schema
- `apps/backend/app/services/llm_defaults.py` — 新建
- `apps/backend/app/services/model_capabilities.py` — 新建
- `apps/backend/app/core/settings.py` — 新建
- `apps/backend/app/services/model_routing.py` / `app/agents/model_adapter.py` / `app/agents/director.py` / `app/api/chat.py` / `app/knowledge/toc_analyzer.py` / `app/api/prompt_profiles.py`
- `packages/shared-schema/src/index.ts`
- `apps/desktop/src/components/ModelNameInput.tsx`（及可选 CSS 模块）
- `apps/desktop/src/pages/SettingsPage.tsx` / `WorkspaceSettingsPage.tsx` / `RuleSetPage.tsx` / `WizardStep1LLM.tsx` / `components/setup/`

---

## Todo

- [x] 里程碑与 roadmap 登记
- [x] 后端字段清理与服务层
- [x] 前端 shared-schema 与 ModelNameInput
- [x] 调用方与 LLM 表单清理
- [x] 构建与冒烟验证（`apps/desktop`：`pnpm run build`）

---

## 验收标准

1. 创建/更新 LLM Profile 时仅提交 name、provider、base_url、api_key 仍可成功。
2. 聊天与摘要使用 `llm_defaults` 中的任务温度（摘要非硬编码 0.3 散落）。
3. 工作区默认模型下拉在开启过滤时隐式排除目录中明确标为不支持 tools/JSON 的项；能力未知的 probe 项仍可见并标灰。
4. `pnpm` 与后端导入无因类型/schema 不一致导致的报错。

---

## 非目标

- 不保证 Agno/各云 SDK 对 `timeout` / `temperature` 的每个参数在全部供应商上一致；无法注入时在代码中回退并保留 TODO 注释即可。

---

## 与其他里程碑的关系

```
M24（知识库检索）
  └── M25（本 milestone）
        └── B 类：真 JSON mode / 动态 tools（后续）
```
