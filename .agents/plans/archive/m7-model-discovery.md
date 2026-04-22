# M7：模型发现、用量观测与成本估算

**前置条件**：M6 完成（LLM/Embedding Profile 管理、Workspace 路由绑定、usage 埋点全部就绪）。

**状态：✅ 已完成（完成，具体提交待补充）**

**目标**：在 M6 的基础数据之上，增加三类增强能力：
1. **模型发现**：静态 catalog + 可选动态拉取，让用户不必纯手填 model_name
2. **用量观测**：将 M6 埋下的 `llm_usage_records` 数据变成可读的统计视图
3. **成本估算**：基于静态 pricing catalog 给出 estimated cost，不做精确账单

---

## 范围声明

### M7 负责

1. Provider model catalog（静态清单 + 可选动态拉取）
2. Model metadata 管理（context_window、pricing 等）
3. Usage 统计 API 与前端展示
4. 成本估算（estimated，非精确账单）
5. Context window / usage 百分比展示
6. 用量聚合视图（按 workspace / provider / model / task_type / 时间）

### M7 明确不做

- 精确账单 / 实时账单系统
- Provider 余额 / 剩余额度统一查询（大多数 provider 无稳定公开接口）
- 每个 Agent 单独模型配置（若需要可做 M8）
- 自动智能路由 / 成本优化路由（超出范围）
- Embedding usage 的精细统计（M7 先做 LLM，Embedding 可作为扩展）

---

## 背景与动机

M6 完成后的残留问题：

1. 用户仍需手填 model_name，对不熟悉各 provider 模型命名的用户体验差
2. `llm_usage_records` 表已有数据，但无任何查询和展示
3. 没有 context window 信息，用户无法判断当前模型是否适合长上下文任务
4. 没有成本感知，用户不清楚每次 workflow 大概消耗多少 token / 费用

---

## 数据模型

### 1. `model_catalog_entries` 表（静态 + 可选动态）

```sql
id                TEXT PRIMARY KEY   -- "{provider_type}:{model_name}"
provider_type     TEXT NOT NULL      -- 与 LLMProviderType 对齐
model_name        TEXT NOT NULL
display_name      TEXT               -- 如 "GPT-4o (Latest)"
context_window    INTEGER            -- tokens，如 128000
max_output_tokens INTEGER            -- 可选，部分模型有输出限制
supports_json_mode  BOOLEAN
supports_tools      BOOLEAN
input_price_per_1m  REAL             -- USD per 1M input tokens，可为 null
output_price_per_1m REAL             -- USD per 1M output tokens，可为 null
pricing_currency    TEXT DEFAULT 'USD'
is_deprecated     BOOLEAN DEFAULT 0
source            TEXT               -- "static" | "api_fetched"
fetched_at        TEXT               -- source=api_fetched 时的拉取时间
metadata_json     TEXT               -- provider 特定的额外字段（JSON）
updated_at        TEXT NOT NULL
```

**说明**：
- 主键设计为 `{provider_type}:{model_name}`，便于精确匹配 LLM/Embedding Profile 的字段
- 静态清单随代码发布（`static_catalog.json`），保证离线可用
- 动态拉取是可选增强，失败不影响主流程

### 2. `embedding_catalog_entries` 表

服务于 Workspace 设置页和 Embedding Profile 展示（如显示模型的 dimensions / pricing），**不进入 usage 聚合主线**。M7 的 usage 统计只覆盖 LLM 调用，Embedding usage 聚合推迟到后续版本。

```sql
id                TEXT PRIMARY KEY   -- "{provider_type}:{model_name}"
provider_type     TEXT NOT NULL
model_name        TEXT NOT NULL
display_name      TEXT
dimensions        INTEGER
max_input_tokens  INTEGER
input_price_per_1m REAL
source            TEXT
fetched_at        TEXT
updated_at        TEXT NOT NULL
```

### 3. `llm_usage_records` 表（M6 已建，M7 扩展查询）

M7 不修改表结构，只在此表上增加查询 API 和聚合视图。

---

## 静态 Catalog 设计

### 文件位置

```
apps/backend/app/data/
  static_llm_catalog.json
  static_embedding_catalog.json
```

### 内容示例（`static_llm_catalog.json` 片段）

```json
[
  {
    "provider_type": "openai",
    "model_name": "gpt-4o",
    "display_name": "GPT-4o",
    "context_window": 128000,
    "max_output_tokens": 16384,
    "supports_json_mode": true,
    "supports_tools": true,
    "input_price_per_1m": 2.50,
    "output_price_per_1m": 10.00
  },
  {
    "provider_type": "anthropic",
    "model_name": "claude-3-5-sonnet-20241022",
    "display_name": "Claude 3.5 Sonnet",
    "context_window": 200000,
    "max_output_tokens": 8192,
    "supports_json_mode": false,
    "supports_tools": true,
    "input_price_per_1m": 3.00,
    "output_price_per_1m": 15.00
  },
  {
    "provider_type": "google",
    "model_name": "gemini-2.0-flash",
    "display_name": "Gemini 2.0 Flash",
    "context_window": 1048576,
    "max_output_tokens": 8192,
    "supports_json_mode": true,
    "supports_tools": true,
    "input_price_per_1m": 0.10,
    "output_price_per_1m": 0.40
  }
]
```

### 静态 catalog 的维护策略

- 静态 catalog 随代码版本管理，人工维护
- 每个 M 版本可更新一次 catalog 数据
- 不要求实时同步 provider 官网价格，允许有滞后（用户知情）
- 用户可在 UI 中手动覆盖 pricing（见下方 API）

---

## 动态模型发现（可选增强）

### 支持的 Provider（优先级顺序）

| Provider | 拉取方式 | 稳定性 |
|----------|---------|--------|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | 稳定，有完整 pricing |
| Google Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models` | 稳定 |
| OpenAI | `GET https://api.openai.com/v1/models` | 稳定，但无 pricing |
| Anthropic | 无官方列表 API | 不支持 |

### 行为规则

- 动态拉取需要用户主动触发（"刷新模型列表"按钮），不自动后台拉取
- 拉取失败时，静默降级为静态 catalog，显示 warning："无法拉取最新模型列表，显示内置清单"
- 拉取结果合并到 `model_catalog_entries`，`source = "api_fetched"`，不覆盖用户手动修改的 pricing
- 不要求 OpenAI / Anthropic 这类无 pricing API 的 provider 有动态价格

### 触发入口

`POST /settings/model-catalog/refresh`，请求体：

```json
{
  "provider_type": "openrouter",
  "llm_profile_id": "prof_xxx"
}
```

**行为约束**：
- refresh 仅借用该 profile 的 `api_key` / `base_url` 做目录拉取请求，**不修改 profile 本身的任何字段**
- 不自动回填 profile 的 `supports_json_mode` / `supports_tools`（capability 字段由用户在 profile 表单中维护）
- 不自动回填 profile 的任何 pricing 信息（pricing 只写入 `model_catalog_entries`，不写回 `llm_profiles`）

---

## API

### Model Catalog API

```
GET    /settings/model-catalog                    # 列出所有条目（可按 provider_type 过滤）
GET    /settings/model-catalog/:id                # 获取单个条目
PATCH  /settings/model-catalog/:id               # 用户手动覆盖 pricing / metadata（写入 catalog，不写回 profile）
POST   /settings/model-catalog/refresh            # 触发动态拉取（只借用 profile 的认证信息，不修改 profile）
```

### Usage API

```
GET    /usage/summary                             # 全局汇总（总 tokens、估算总费用）
GET    /usage/by-workspace/:workspace_id          # 按 workspace 汇总
GET    /usage/by-model                            # 按 provider/model 聚合
GET    /usage/recent                              # 最近 N 条记录（默认 50）
```

查询参数支持：
- `from` / `to`：ISO 8601 时间范围
- `task_type`：过滤 creative / rules / general
- `provider_type`：过滤特定 provider

### Usage 响应结构示例

```json
// GET /usage/by-workspace/:id
{
  "workspace_id": "ws_xxx",
  "workspace_name": "COC 模组：永恒的黑暗",
  "period": { "from": "2025-04-01", "to": "2025-04-22" },
  "total_input_tokens": 284500,
  "total_output_tokens": 61200,
  "estimated_cost_usd": 1.47,
  "by_model": [
    {
      "provider_type": "openai",
      "model_name": "gpt-4o",
      "input_tokens": 180000,
      "output_tokens": 42000,
      "estimated_cost_usd": 0.87,
      "call_count": 23
    }
  ]
}
```

---

## 成本估算规则

**M7 的成本展示定位是"估算参考"，不是账单**，必须在 UI 上显著标注 `estimated`。

### 估算逻辑

```
estimated_cost = (input_tokens / 1_000_000) × input_price_per_1m
               + (output_tokens / 1_000_000) × output_price_per_1m
```

- 若 catalog 中无该模型的 pricing：显示 `—`（未知），不显示 0
- 若用户手动覆盖了 pricing：使用覆盖值，显示 `*` 标注为"自定义价格"
- 中转站 / openai_compatible：默认无 pricing，用户可手动在 **catalog 条目**上填入价格

**数据层归属**：pricing / context_window / capability 的覆盖值只写入 `model_catalog_entries`，**不写回 `llm_profiles`**。`llm_profiles` 只表示"我实际调用哪个模型及其认证信息"，不承载 metadata。

### 注意事项

- 价格数据可能落后于 provider 官网，用户须自行核对
- 不承诺与 provider 实际账单一致
- 不做多币种换算（全部以 USD 展示）

---

## Context Window 展示

### 数据来源

`model_catalog_entries.context_window`（静态或动态拉取得到）

### 展示场景

1. **LLM Profile 列表页**：每条 profile 显示对应 catalog 中的 `context_window`（若能匹配到）
2. **Workspace 设置页**：模型路由绑定处，绑定后显示该模型的 context window
3. **Agent 面板**（可选）：显示当前会话预估已用 context / 总 context 的进度条

### Context 使用率估算

基于当前 chat session 的历史消息进行本地 token 数估算，精度允许有 ±10% 误差。

**估算策略（优先级顺序）**：
1. **第一版**：简单字符估算（`字符数 / 4` 作为 token 近似值），实现成本低，足以支撑进度条展示
2. **后续增强**（不在 M7 第一版内）：引入精确 tokenizer（如 tiktoken），按 provider 选择对应编码器

不要在 M7 第一版就绑定 tiktoken——不同 provider 的 tokenizer 兼容性问题会显著影响开发进度，而 ±10% 的近似误差对 context 预警场景完全够用。

接近阈值时（>80%）：在 Agent 面板输入框上方显示 warning：
```
⚠ 当前对话上下文已使用约 83%（~105,000 / 128,000 tokens），建议开启新对话或精简历史。
```

---

## 前端变更

### `/settings` 页新增 Tab 3：模型发现

```
Tab 1: LLM 配置（M6）
Tab 2: Embedding 配置（M6）
Tab 3: 模型发现（M7 新增）
```

**Tab 3 内容**：
- 按 provider 分组列出 `model_catalog_entries`
- 每条显示：model_name / display_name / context_window / pricing / source（静态/动态）
- "刷新"按钮（按 provider）→ 触发动态拉取（需选择对应的 LLM Profile 提供 api_key）
- 价格支持手动覆盖（inline 编辑）
- 未匹配到 catalog 的手填 profile 显示"无 catalog 数据"标注

### Usage 面板（新增路由或嵌入 Settings）

建议作为独立路由 `/usage`，或嵌入 `/settings` 页最底部。

**内容**：
- 顶部汇总卡片：总 tokens、估算费用、调用次数（支持时间范围选择器）
- 按 Workspace 饼图 / 列表
- 按 Model 表格（provider / model_name / tokens / 估算费用 / 调用次数）
- 最近请求列表（task_type / model / tokens / 时间）

所有数字标注为"估算"，不声称精确。

### Workspace 设置页增强（M7 扩展）

在模型路由绑定处，绑定后额外显示：
```
gpt-4o · 128K context window · ~$2.5/M input · ~$10/M output
```

### Context Usage Badge（Agent 面板）

在 Agent 面板输入区上方增加轻量 badge：
```
Context: ~12,400 / 128,000 tokens (10%)  [████░░░░░░]
```
超过 80% 时变为黄色 warning 样式。

---

## shared-schema 变更

```ts
// ─── M7: Model Catalog ────────────────────────────────────────────────────────

export interface ModelCatalogEntry {
  id: string;                        // "{provider_type}:{model_name}"
  provider_type: LLMProviderType;
  model_name: string;
  display_name: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_json_mode: boolean | null;
  supports_tools: boolean | null;
  input_price_per_1m: number | null;   // USD
  output_price_per_1m: number | null;
  is_deprecated: boolean;
  source: "static" | "api_fetched";
  fetched_at: string | null;
  updated_at: string;
}

export interface UpdateModelCatalogEntryRequest {
  input_price_per_1m?: number | null;
  output_price_per_1m?: number | null;
  context_window?: number | null;
  supports_json_mode?: boolean | null;
  supports_tools?: boolean | null;
}

export interface CatalogRefreshRequest {
  provider_type: LLMProviderType;
  llm_profile_id: string;   // 提供 api_key 的 profile
}

export interface CatalogRefreshResult {
  provider_type: LLMProviderType;
  models_added: number;
  models_updated: number;
  error: string | null;
}

// ─── M7: Usage ────────────────────────────────────────────────────────────────

export interface UsageSummary {
  period: { from: string; to: string };
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number | null;
  call_count: number;
  by_model: UsageByModel[];
}

export interface UsageByModel {
  provider_type: LLMProviderType;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
  call_count: number;
}

export interface UsageRecord {
  id: string;
  workspace_id: string;
  provider_type: LLMProviderType;
  model_name: string;
  task_type: "creative" | "rules" | "general";
  workflow_source: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;  // 派生字段，查询时实时计算
  created_at: string;
}
```

---

## Todo

### 数据层

- [x] `orm.py`：新增 `ModelCatalogEntryORM` 表（`model_catalog_entries`）
- [x] `apps/backend/app/data/static_llm_catalog.json`：新建，初始包含 OpenAI gpt-4o/gpt-4o-mini/gpt-4-turbo、Anthropic claude-3-5-sonnet/claude-3-haiku、Google gemini-2.0-flash/gemini-1.5-pro、OpenRouter 常用模型
- [x] `apps/backend/app/data/static_embedding_catalog.json`：新建，包含 OpenAI text-embedding-3-small/large、Jina jina-embeddings-v3
- [x] `orm.py`：新增 `EmbeddingCatalogEntryORM` 表（`embedding_catalog_entries`）——用于 Embedding Profile 详情展示，不进入 usage 聚合，优先级低于 LLM catalog
- [x] `schemas.py`：新增 `ModelCatalogEntrySchema`、`UsageSummarySchema`、`UsageByModelSchema`、`UsageRecordSchema`

### 服务层

- [x] `app/services/catalog_service.py`：新建，实现静态 catalog 加载（启动时写入 DB）、动态拉取（OpenRouter / Google）、合并去重逻辑
- [x] `app/services/usage_aggregator.py`：新建，实现按 workspace / model / 时间聚合查询；成本估算逻辑（查 catalog 得 pricing，计算 estimated_cost）

### API 层

- [x] `app/api/model_catalog.py`：新建，GET list / GET single / PATCH 手动覆盖 / POST refresh
- [x] `app/api/usage.py`：新建，GET summary / GET by-workspace / GET by-model / GET recent
- [x] `app/main.py`：注册 `model_catalog`、`usage` 路由

### 前端

- [x] `apps/desktop/src/pages/SettingsPage.tsx`：新增 Tab 3"模型发现"，含 catalog 列表、刷新按钮、价格覆盖
- [x] `apps/desktop/src/pages/UsagePage.tsx`：新建，汇总卡片 + Workspace 分组 + Model 表格 + 最近请求列表
- [x] `apps/desktop/src/pages/WorkspaceSettingsPage.tsx`：模型路由绑定处显示 catalog 数据（context_window / pricing）
- [x] `apps/desktop/src/components/agent/ContextUsageBadge.tsx`：新建，本地估算 token 用量，显示进度条和 warning
- [x] `apps/desktop/src/App.tsx`：注册 `/usage` 路由

### shared-schema

- [x] `packages/shared-schema/src/index.ts`：按上方"shared-schema 变更"章节新增 M7 类型

---

## 验证步骤

1. **静态 catalog 加载**：启动后端，确认 `model_catalog_entries` 表已有静态数据；GET `/settings/model-catalog` 返回正确条目
2. **Catalog 手动覆盖价格**：PATCH 某模型的 `input_price_per_1m` → 返回成功；再次 GET 确认新价格；UI 显示 `*` 标注
3. **动态拉取 OpenRouter**：配置 OpenRouter profile 后点"刷新" → 返回 `models_added/updated` 数字；catalog 列表新增 openrouter 模型；**原 profile 的字段（model_name / capability）不变**
4. **动态拉取失败降级**：传入无效 api_key 触发刷新 → 返回 error，静态 catalog 数据不受影响，UI 显示 warning
5. **pricing 覆盖不回写 profile**：PATCH catalog 条目价格 → `model_catalog_entries` 更新；对应 `llm_profiles` 记录不变
5. **Usage 查询**：执行若干 workflow，GET `/usage/summary` 返回 token 统计；有 pricing 的模型显示 `estimated_cost_usd`；无 pricing 的显示 null
6. **按 Workspace 聚合**：GET `/usage/by-workspace/:id` 返回该 workspace 的 token 和估算费用分解
7. **Context window 展示**：绑定了有 catalog 的模型的 workspace 设置页，显示 "128K context window"；未匹配 catalog 的手填 profile 显示"无 catalog 数据"
8. **Context usage badge**：在有历史消息的 workspace 发送新消息，AgentPanel 显示估算 context 用量进度条；超 80% 变为黄色 warning
9. **前端不暴露精确账单**：所有 cost 数字旁边有 "estimated" 标注，不出现"账单"字样

---

## 关键约束

- Usage 成本展示必须始终标注为 `estimated`，不声称与 provider 实际账单一致
- 动态拉取 catalog 失败时必须降级为静态数据，不可报错阻断用户操作
- `model_catalog_entries` 的手动覆盖价格不可被动态拉取静默覆盖（拉取只更新 `source=api_fetched` 的字段，不覆盖用户手动改写的字段）
- refresh 端点只借用 profile 的认证信息做目录拉取，**不修改 profile 本身任何字段**，不回填 capability / pricing 到 `llm_profiles`
- pricing / context_window / capability 覆盖只写入 `model_catalog_entries`，**不写回 `llm_profiles`**
- `ContextUsageBadge` 第一版使用简单字符估算（字符数 / 4），不在 M7 引入 tiktoken；精确 tokenizer 适配作为后续增强
- Provider 余额 / 剩余额度不作为 M7 的功能承诺（可在未来 M8+ 按需扩展）
- Context window 估算允许 ±10% 误差，不要求精确
- `EmbeddingCatalogEntry` 用于 Embedding Profile 展示，不进入 usage 聚合主线
- Embedding usage 在 M7 中不做精细统计，仅展示 LLM usage；Embedding 可在后续版本扩展
