# M6：模型配置管理

**前置条件**：M5 完成（全功能可用）。

**状态：✅ 已完成（完成，具体提交待补充）**

**目标**：将 M1 遗留的单薄 `ModelProfile`（仅能保存一个聊天模型配置）升级为完整的"模型管理体系"，涵盖 LLM 配置、Embedding 配置、Workspace 级路由绑定，以及 Agent 调度层的决策逻辑。

---

## 范围声明

### M6 负责

1. LLM Profile 管理（CRUD、测试连接）
2. Embedding Profile 管理（CRUD、测试连接）
3. Workspace 级模型路由绑定（default / rules / embedding 三路由）
4. Agent / Workflow / Ingest / Search 的模型选择逻辑
5. Usage 调用数据的轻量埋点（只记录，不展示）
6. 模型发现的最小边界（仅接口预留，详见下方说明）

### M6 明确不做（推迟到 M7）

- 完整 provider catalog / plugin 体系
- 统一自动发现所有 provider 模型列表
- 余额 / 余量 / 额度展示
- 精确计费 / 预算系统
- Usage dashboard 与聚合统计
- Context window / context 使用率 UI
- 每个 Agent 单独模型配置
- 自动智能路由 / 成本优化路由
- Provider 能力自动探测（/test 只测连通性，不推断 capability）

---

## 背景与动机

当前实现的问题：

1. `ModelProfile` 把 LLM 和 Embedding 混为一谈，导致 ingest 管道无法独立配置 embedding 模型
2. Workspace 仅绑定 `default_model_profile_id`，没有 rules 模型和 embedding 模型的分离路由
3. Agent 调度层（`model_adapter.py`、`get_default_model()`）硬编码 `gpt-4o-mini`，不受 Workspace 配置影响
4. Provider 类型中 `"custom"` 语义模糊，应明确为 `"openai_compatible"`（支持中转站、Qwen、DeepSeek 等）
5. `api_key_encrypted` 字段已存在但调度层从未实际解密使用

本里程碑不做"每 Agent 单独模型"的高级路由（留 M7+），只做 **LLM + Embedding + Workspace 三层路由**。

---

## 数据模型变更

### 存储策略：彻底拆表

**采用方案 A：彻底拆表**，旧 `model_profiles` 表重命名为 `llm_profiles`，新建独立的 `embedding_profiles` 表。不在旧表里加 `kind` 列——两类 profile 语义不同、字段集合不同，混表只会增加 nullable 字段和理解负担。

### 1. `llm_profiles` 表（原 `model_profiles` 重命名 + 扩展）

字段变更：
- **表名**：`model_profiles` → `llm_profiles`
- **新增**：`supports_json_mode: bool`（无数据库默认值，由用户配置）
- **新增**：`supports_tools: bool`（无数据库默认值，由用户配置）
- **新增**：`timeout_seconds: int = 120`
- **`provider_type` 枚举**：直接使用 `"openai_compatible"`，去掉 `"custom"`

> `supports_json_mode` / `supports_tools` **不在数据模型层面设置默认值**。不同 provider、不同模型的能力差异显著，强制默认 `true` 会导致对不支持的模型发送 JSON mode / tool call 请求时静默失败。正确做法是由前端在用户选择 provider / 填入 model_name 时，通过预填建议值（见前端章节）引导用户填写，用户可手动修改。创建 profile 时这两个字段为必填。

保留字段：`id`、`name`、`provider_type`、`base_url`、`api_key_encrypted`、`model_name`、`temperature`、`max_tokens`、`created_at`、`updated_at`

Provider type 枚举：
```
"openai" | "anthropic" | "google" | "openrouter" | "openai_compatible"
```

响应 schema 新增 `has_api_key: bool`（派生自 `api_key_encrypted IS NOT NULL`），**永远不返回明文或加密 key**。

### 2. `embedding_profiles` 表（新建）

字段：
- `id`、`name`
- `provider_type: "openai" | "openai_compatible" | "jina"`
- `base_url: str | None`
- `api_key_encrypted: str | None`
- `model_name`（如 `text-embedding-3-small`、`jina-embeddings-v3`）
- `dimensions: int | None`（如 1536，部分模型支持自定义维度）
- `embedding_task: "retrieval" | "classification" | "clustering" | None`（Jina 需要指定）
- `created_at`、`updated_at`

响应 schema 同样新增 `has_api_key: bool`，不返回明文 key。

### 3. `workspaces` 表增加三路由字段

新增：
- `default_llm_profile_id: str | None`（原 `default_model_profile_id` 语义替代）
- `rules_llm_profile_id: str | None`（规则审查 / 一致性检查用；留空则回退到 default）
- `embedding_profile_id: str | None`（PDF ingest + RAG 查询用）

**迁移**：无存量数据，直接以新字段重建表结构，删除 `default_model_profile_id`。

### 4. `knowledge_libraries` 表记录 Embedding 索引事实

新增：
- `embedding_profile_id: str | None`：**最近一次成功建立当前索引所使用的 embedding profile ID**（事实快照，不跟随 workspace 设置实时变化）
- `embedding_model_snapshot: str | None`：ingest 时 `model_name` 的文本快照，用于 profile 被删后仍能知道旧索引用了什么模型

**重要语义**：
- 修改 workspace 的 `embedding_profile_id` **不会自动改写** library 的索引事实记录
- 只有重建索引成功完成后，才更新 library 的 `embedding_profile_id` 和 `embedding_model_snapshot`
- library 上的这两个字段代表"当前索引的向量是用什么模型生成的"，是不可篡改的事实，不是配置

---

## Consistency Agent 使用规则模型说明

**当前阶段**：`consistency_check` 复用 `rules_llm_profile_id`（两者都偏向"保守、少幻觉"的模型诉求）。若 `rules_llm_profile_id` 未配置，回退到 `default_llm_profile_id`。

**后续扩展**：若一致性检查与规则审查的模型诉求出现分歧（一致性检查更偏跨资产比对，规则审查更偏引用准确），可在 M7+ 中拆出独立的 `consistency_llm_profile_id` 字段，不影响本里程碑设计。

---

## Agent 调度层：模型路由规则

### 路由优先级（从高到低）

```
1. 调用方显式传入 model 参数（当前 API 已支持）
2. Workspace.rules_llm_profile_id（仅 rules_review / consistency_check 任务）
3. Workspace.default_llm_profile_id
4. 系统级 fallback：抛出 ModelNotConfiguredError，不再硬编码 gpt-4o-mini
```

### Embedding 路由规则（独立，与 LLM 路由分开）

#### ingest / rebuild 索引

使用 `workspace.embedding_profile_id`。若未配置，ingest 任务失败并提示用户配置 embedding 模型。

#### query 某个 library

使用该 **library 的 `embedding_profile_id` 快照**（即建索引时使用的 profile），而非 workspace 当前配置。

**library 未建索引时的行为**：若 `library.embedding_profile_id` 为空（即从未完成过 ingest），**不回退到 workspace embedding 直接查询**。此时搜索返回明确错误：
```json
{
  "results": [],
  "warnings": [],
  "error": "知识库「{library_name}」尚未建立索引，请先完成 PDF 导入并等待索引构建完成后再搜索。"
}
```
HTTP 状态码返回 422（语义为"请求合法但当前状态不满足"），不返回 500。

**一致性校验**：在执行 query 前，检查 `workspace.embedding_profile_id` 与 `library.embedding_profile_id` 是否一致：
- 若一致：正常执行
- 若不一致：**不允许静默混用**，返回告警信息：
  ```
  当前 workspace 的 embedding 模型（{new_model}）与知识库索引使用的模型（{old_model}）不一致，
  检索结果可能不准确。建议重建知识库索引后再使用。
  ```
  但不阻断查询（允许用户知情后继续），将告警附在搜索响应的 `warnings` 字段中。

### 路由函数（`app/services/model_routing.py`）

```python
def get_llm_for_task(
    db: Session,
    workspace_id: str,
    task_type: str,  # "creative" | "rules" | "general"
) -> Any:
    """
    Returns an Agno model object.
    Raises ModelNotConfiguredError if no profile is configured.
    """
    ws = db.get(WorkspaceORM, workspace_id)
    if task_type == "rules":
        profile_id = ws.rules_llm_profile_id or ws.default_llm_profile_id
    else:  # "creative" | "general"
        profile_id = ws.default_llm_profile_id

    if not profile_id:
        raise ModelNotConfiguredError(
            f"Workspace '{ws.name}' 未配置{'规则' if task_type == 'rules' else '默认'}模型，"
            "请在工作空间设置中绑定模型配置。"
        )
    profile = db.get(LLMProfileORM, profile_id)
    if not profile:
        raise ModelNotConfiguredError("模型配置已被删除，请重新绑定。")
    return model_from_profile(profile)


def get_embedding_for_ingest(db: Session, workspace_id: str):
    """用于 ingest/rebuild，使用 workspace 当前配置的 embedding profile。"""
    ws = db.get(WorkspaceORM, workspace_id)
    if not ws.embedding_profile_id:
        raise ModelNotConfiguredError(
            f"Workspace '{ws.name}' 未配置 Embedding 模型，请在工作空间设置中绑定。"
        )
    profile = db.get(EmbeddingProfileORM, ws.embedding_profile_id)
    if not profile:
        raise ModelNotConfiguredError("Embedding 配置已被删除，请重新绑定。")
    return embedding_from_profile(profile)


def get_embedding_for_query(
    db: Session,
    workspace_id: str,
    library_id: str,
) -> tuple[Any, list[str]]:
    """
    用于 RAG query，必须使用 library 的索引快照 profile。
    若 library 尚未建索引（snapshot 为空），抛出 LibraryNotIndexedError。
    返回 (embedding_callable, warnings)。
    warnings 非空时表示 workspace 与 library 的 embedding 模型不一致。
    """
    library = db.get(KnowledgeLibraryORM, library_id)
    ws = db.get(WorkspaceORM, workspace_id)
    warnings = []

    # library 未建索引：不回退，直接报错
    if not library or not library.embedding_profile_id:
        raise LibraryNotIndexedError(
            f"知识库「{library.name if library else library_id}」尚未建立索引，"
            "请先完成 PDF 导入并等待索引构建完成后再搜索。"
        )

    profile_id = library.embedding_profile_id

    # 一致性检查
    if (library and library.embedding_profile_id and ws.embedding_profile_id
            and library.embedding_profile_id != ws.embedding_profile_id):
        old_model = library.embedding_model_snapshot or library.embedding_profile_id
        new_profile = db.get(EmbeddingProfileORM, ws.embedding_profile_id)
        new_model = new_profile.model_name if new_profile else ws.embedding_profile_id
        warnings.append(
            f"当前 workspace 的 embedding 模型（{new_model}）与知识库索引使用的模型"
            f"（{old_model}）不一致，检索结果可能不准确。建议重建知识库索引后再使用。"
        )

    profile = db.get(EmbeddingProfileORM, profile_id)
    if not profile:
        raise ModelNotConfiguredError("Embedding 配置已被删除，请重新绑定。")
    return embedding_from_profile(profile), warnings
```

### 各 Workflow / Agent 调用点变更

| 调用位置 | task_type | 变更说明 |
|----------|-----------|---------|
| `create_module.py` | `"creative"` | 用 `get_llm_for_task(db, workspace_id, "creative")` |
| `modify_asset.py` | `"creative"` | 同上 |
| `rules_review.py` | `"rules"` | 用 `get_llm_for_task(db, workspace_id, "rules")` |
| `generate_image.py` | `"creative"` | 同上 |
| `agent_tools.py`（consistency） | `"rules"` | 用 `get_llm_for_task(db, workspace_id, "rules")` |
| `chat.py` | `"general"` | 用 `get_llm_for_task(db, workspace_id, "general")` |
| PDF ingest 管道 | N/A | 用 `get_embedding_for_ingest(db, workspace_id)` |
| 知识库搜索 | N/A | 用 `get_embedding_for_query(db, workspace_id, library_id)`，并将 warnings 附在响应中 |

---

## PATCH Profile 时 API Key 的更新语义

**必须遵守，不可用空字符串表达多义**：

| 请求体 | 行为 |
|--------|------|
| 不传 `api_key` 字段 | 保留原有加密 key，不修改 |
| 传非空字符串 `api_key` | 替换为新 key（重新加密存储） |
| 传 `clear_api_key: true` | 清空 key（设为 NULL） |
| 同时传 `api_key` 和 `clear_api_key: true` | **拒绝**，返回 400，两者互斥 |
| 传空字符串 `api_key: ""` | **拒绝**，返回 400，提示使用 `clear_api_key` |

此规则同时适用于 `PATCH /settings/llm-profiles/:id` 和 `PATCH /settings/embedding-profiles/:id`。

---

## API 变更

### LLM Profile API

```
GET    /settings/llm-profiles             # 列出（响应含 has_api_key，不含 key）
POST   /settings/llm-profiles             # 新建
GET    /settings/llm-profiles/:id         # 获取单个
PATCH  /settings/llm-profiles/:id         # 更新（api_key 语义见上方规则）
DELETE /settings/llm-profiles/:id         # 删除（需检查是否被 workspace 引用，被引用时返回 409）
POST   /settings/llm-profiles/:id/test    # 测试连接
```

### Embedding Profile API

```
GET    /settings/embedding-profiles             # 列出（响应含 has_api_key）
POST   /settings/embedding-profiles             # 新建
GET    /settings/embedding-profiles/:id         # 获取单个
PATCH  /settings/embedding-profiles/:id         # 更新（api_key 语义同上）
DELETE /settings/embedding-profiles/:id         # 删除（双重引用检查，见下方规则）
POST   /settings/embedding-profiles/:id/test    # 测试（embed "test"，验证 dimensions）
```

#### EmbeddingProfile 删除规则

DELETE 前必须执行双重引用检查，任一条件满足即返回 409：

1. **被 workspace 引用**：存在 `workspace.embedding_profile_id = :id` 的记录
2. **被 library 索引快照引用**：存在 `knowledge_library.embedding_profile_id = :id` 的记录（即有知识库的当前索引是用此 profile 建立的）

返回 409 时响应体说明引用来源，例如：
```json
{
  "detail": "该 Embedding 配置仍被引用，无法删除。",
  "referenced_by": {
    "workspaces": ["ws_xxx（工作空间名）"],
    "libraries": ["lib_yyy（知识库名）"]
  }
}
```

**不允许**删除后让已有知识库在搜索时因找不到 profile 而 silently 失效（silently 失效等价于静默返回空结果或 500，均不可接受）。用户必须先解绑 workspace 引用、或重建知识库索引切换到其他 profile，才能删除。

### Workspace 路由绑定

复用已有 `PATCH /workspaces/:id`，新增字段：
```json
{
  "default_llm_profile_id": "...",
  "rules_llm_profile_id": "...",
  "embedding_profile_id": "..."
}
```

Workspace 创建/更新时允许这三个字段全为 `null`（不强制配置），但触发具体功能时按功能需求拦截（见前端错误处理）。

### 知识库搜索响应新增 `warnings` 和 `error`

`POST /knowledge/search` 响应结构：
```json
{
  "results": [...],
  "warnings": ["当前 workspace 的 embedding 模型...与知识库索引...不一致"],
  "error": null
}
```

- `warnings`：非阻断性提示（如 embedding 不一致），结果仍返回
- `error`：阻断性错误（如 library 未建索引），此时 `results` 为空，HTTP 状态码 422

---

## 连接测试端点

### LLM 测试（`POST /settings/llm-profiles/:id/test`）

发送极短 prompt `"Reply with only: OK"`，timeout 10s。
返回：
```ts
interface LLMTestResult {
  success: boolean;
  latency_ms: number;
  model_echo: string | null;
  error: string | null;
}
```

### Embedding 测试（`POST /settings/embedding-profiles/:id/test`）

对字符串 `"test"` 生成 embedding，验证返回 vector 维度与 profile 配置的 `dimensions` 一致（若配置了 dimensions）。
返回：
```ts
interface EmbeddingTestResult {
  success: boolean;
  latency_ms: number;
  dimensions: number | null;
  error: string | null;
}
```

LLM 和 Embedding 的测试结果类型**分开定义**，不混用同一个 `ModelTestResult` 接口。

---

## 前端变更

### 全局设置页 `/settings`（重构）

重构为两个 Tab：

**Tab 1：LLM 配置**
- 列出所有 LLMProfile，每条显示 name / provider / model_name / `has_api_key`（已配置/未配置）
- 新建/编辑表单字段：名称、Provider、Base URL（`openai_compatible` 时显示）、API Key（保存后仅显示"已配置"标记）、模型名称、Temperature、Max Tokens、supports_json_mode / supports_tools（checkbox，**必填**）
- `supports_json_mode` / `supports_tools` 的建议预填逻辑（用户可修改）：
  - Provider = `openai`：两者预填 `true`
  - Provider = `anthropic`：`supports_tools=true`，`supports_json_mode=false`（Claude 不支持 JSON mode，用 system prompt 代替）
  - Provider = `google`：两者预填 `true`
  - Provider = `openrouter` / `openai_compatible`：两者预填 `false`（来源不明，保守默认，用户自行确认后改为 `true`）
- "测试连接"按钮 → 显示延迟和 echo / 错误
- 内置快速预填按钮：OpenAI gpt-4o / Anthropic claude-3-5-sonnet / Google gemini-2.0-flash

**Tab 2：Embedding 配置**
- 列出所有 EmbeddingProfile，每条显示 name / provider / model_name / dimensions / `has_api_key`
- 新建/编辑表单：名称、Provider、Base URL（兼容时显示）、API Key、模型名称、Dimensions（可选）、Task（可选）
- "测试连接"按钮 → 显示维度和延迟 / 错误
- 内置快速预填：OpenAI text-embedding-3-small / Jina jina-embeddings-v3

### Workspace 设置页（扩展）

在保存表单下方增加"模型路由"区域：

```
─── 模型路由 ─────────────────────────────────────
默认创作模型    [下拉：LLM Profile 列表 ▼]
规则审查模型    [下拉：LLM Profile 列表 ▼]（留空则使用默认创作模型）
Embedding 模型  [下拉：Embedding Profile 列表 ▼]
──────────────────────────────────────────────────
```

下拉选项格式：`{name} · {provider}/{model_name}` + 有无 API Key 标记。

### 功能入口的未配置 Warning

各功能入口在触发前检查配置，未配置时显示 inline warning，**不等到 workflow 失败再报错**：

| 触发功能 | 检查项 | Warning 文案 |
|----------|--------|-------------|
| 发送创作请求 | `default_llm_profile_id` | ⚠ 未配置创作模型，[前往工作空间设置] |
| 规则审查 | `rules_llm_profile_id` 或 `default_llm_profile_id` | ⚠ 未配置规则模型，[前往工作空间设置] |
| PDF 导入 | `embedding_profile_id` | ⚠ 未配置 Embedding 模型，无法导入 PDF，[前往工作空间设置] |

### Workflow 失败时的 ModelNotConfiguredError 处理

`WorkflowProgress` 识别 error_message 包含 `ModelNotConfiguredError` 特征时，显示：
```
✕ 未配置[创作/规则]模型
[前往工作空间设置] 按钮（导航到 /workspaces/:id/settings）
```

### 知识库搜索结果中的 Embedding 不一致 Warning

知识库页搜索结果顶部显示来自响应 `warnings` 字段的告警（黄色 banner），不阻断显示结果。

---

---

## Usage 调用数据埋点（轻量记录）

M6 只做"记录"，不做 dashboard、聚合统计、成本计算，这些能力留给 M7。

### 数据结构：`llm_usage_records` 表

```sql
id              TEXT PRIMARY KEY
workspace_id    TEXT NOT NULL  -- 冗余存，便于后续按 workspace 聚合
provider_type   TEXT NOT NULL  -- 如 "openai" / "anthropic"
model_name      TEXT NOT NULL
task_type       TEXT NOT NULL  -- "creative" | "rules" | "general"
workflow_source TEXT           -- 如 "create_module" / "chat"，可为 null
input_tokens    INTEGER        -- provider 响应中的 prompt_tokens，可为 null
output_tokens   INTEGER        -- provider 响应中的 completion_tokens，可为 null
total_tokens    INTEGER        -- 可为 null（部分 provider 不返回 usage）
created_at      TEXT NOT NULL
```

**注意**：
- 若 provider 不返回 usage 数据（如部分 openai_compatible 中转站），所有 token 字段记为 `null`，不报错
- 不记录请求内容（prompt / response），只记录 token 计数和来源元数据
- 不做写失败重试——usage 记录是"尽力而为"，写入失败只记日志，不影响主调用链

### 埋点位置

在 `get_llm_for_task()` 返回 model 对象并完成实际调用后，在调用方处提取 usage 并异步写入。由各 workflow / agent 调用点负责传入 `workflow_source`。

### 对应 Todo

- [x] `orm.py`：新增 `LLMUsageRecordORM` 表（`llm_usage_records`）
- [x] `app/services/usage_recorder.py`：新建，实现 `record_llm_usage()` 异步写入函数
- [x] 各 workflow 调用点：在 LLM 调用后取 usage 并调用 `record_llm_usage()`

> Embedding 的 usage 记录同样预留字段设计，但 M6 内仅对 LLM 做实际埋点；Embedding usage 埋点推迟到 M7，因为向量化调用通常批量且 token 语义不同。

---

## 模型发现最小边界说明

M6 **不构建 provider catalog 体系**。模型发现能力的完整实现属于 M7。

M6 在此只做一件事：**为 LLM / Embedding profile 的"新建"表单，提供若干 provider 的快速预填 preset**，以便用户不必手动填写所有字段。

### preset 形式（前端静态数据，不调用 API）

```ts
// 存放在前端，不从后端获取
const LLM_PRESETS = [
  { label: "OpenAI gpt-4o",           provider_type: "openai",     model_name: "gpt-4o",                  supports_json_mode: true,  supports_tools: true  },
  { label: "Anthropic claude-3-5-sonnet", provider_type: "anthropic", model_name: "claude-3-5-sonnet-20241022", supports_json_mode: false, supports_tools: true  },
  { label: "Google gemini-2.0-flash", provider_type: "google",     model_name: "gemini-2.0-flash",        supports_json_mode: true,  supports_tools: true  },
]

const EMBEDDING_PRESETS = [
  { label: "OpenAI text-embedding-3-small", provider_type: "openai",          model_name: "text-embedding-3-small", dimensions: 1536 },
  { label: "Jina jina-embeddings-v3",       provider_type: "jina",            model_name: "jina-embeddings-v3",     dimensions: 1024 },
]
```

用户点击 preset 按钮后，表单字段自动填入建议值，用户可手动修改后保存。

**M6 不做**：
- 调用 provider API 拉取模型列表
- 动态更新 preset
- 统一 provider catalog 数据库

这些能力全部在 M7 中实现。

---

## shared-schema 变更

```ts
// ─── M6: Model Management ─────────────────────────────────────────────────────

export type LLMProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "openai_compatible";

export type EmbeddingProviderType =
  | "openai"
  | "openai_compatible"
  | "jina";

export interface LLMProfile {
  id: string;
  name: string;
  provider_type: LLMProviderType;
  base_url: string | null;
  model_name: string;
  temperature: number;
  max_tokens: number;
  supports_json_mode: boolean;
  supports_tools: boolean;
  timeout_seconds: number;
  has_api_key: boolean;       // 派生字段，表示是否已配置 key
  created_at: string;
  updated_at: string;
}

export interface EmbeddingProfile {
  id: string;
  name: string;
  provider_type: EmbeddingProviderType;
  base_url: string | null;
  model_name: string;
  dimensions: number | null;
  embedding_task: "retrieval" | "classification" | "clustering" | null;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLLMProfileRequest {
  name: string;
  provider_type: LLMProviderType;
  model_name: string;
  api_key: string;
  supports_json_mode: boolean;   // 必填，由前端预填建议值，用户可修改
  supports_tools: boolean;       // 必填，由前端预填建议值，用户可修改
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  timeout_seconds?: number;
}

export interface UpdateLLMProfileRequest {
  name?: string;
  provider_type?: LLMProviderType;
  model_name?: string;
  api_key?: string;          // 传则替换；不传则保留原值
  clear_api_key?: boolean;   // true 则清空 key
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  supports_json_mode?: boolean;
  supports_tools?: boolean;
  timeout_seconds?: number;
}

export interface CreateEmbeddingProfileRequest {
  name: string;
  provider_type: EmbeddingProviderType;
  model_name: string;
  api_key: string;
  base_url?: string;
  dimensions?: number;
  embedding_task?: "retrieval" | "classification" | "clustering";
}

export interface UpdateEmbeddingProfileRequest {
  name?: string;
  provider_type?: EmbeddingProviderType;
  model_name?: string;
  api_key?: string;
  clear_api_key?: boolean;
  base_url?: string;
  dimensions?: number;
  embedding_task?: "retrieval" | "classification" | "clustering" | null;
}

export interface LLMTestResult {
  success: boolean;
  latency_ms: number;
  model_echo: string | null;
  error: string | null;
}

export interface EmbeddingTestResult {
  success: boolean;
  latency_ms: number;
  dimensions: number | null;
  error: string | null;
}

// UpdateWorkspaceRequest 新增字段：
// default_llm_profile_id?: string | null
// rules_llm_profile_id?: string | null
// embedding_profile_id?: string | null

// KnowledgeLibrary 新增只读字段：
// embedding_profile_id: string | null   （最近一次索引使用的 profile ID）
// embedding_model_snapshot: string | null  （最近一次索引使用的 model_name 快照）

// ─── M6: Usage Record（只写，不查）────────────────────────────────────────────
// LLMUsageRecord 仅作为后端写入结构，前端 M6 阶段不查询；保留类型供 M7 展示层使用
export interface LLMUsageRecord {
  id: string;
  workspace_id: string;
  provider_type: LLMProviderType;
  model_name: string;
  task_type: "creative" | "rules" | "general";
  workflow_source: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}
```

旧的 `ModelProfile` 及 `ProviderType = ... | "custom"` 直接删除，不保留 deprecated 标注。

---

## Todo

### 数据层

- [x] `orm.py`：将 `ModelProfileORM` 直接重写为 `LLMProfileORM`，表名 `llm_profiles`；字段包含 `supports_json_mode`、`supports_tools`、`timeout_seconds`；`provider_type` 枚举去掉 `"custom"`，只保留 `"openai_compatible"`
- [x] `orm.py`：新增 `EmbeddingProfileORM` 表（`embedding_profiles`）
- [x] `orm.py`：`WorkspaceORM` 直接包含 `default_llm_profile_id`、`rules_llm_profile_id`、`embedding_profile_id`；删除旧 `default_model_profile_id` 字段
- [x] `orm.py`：`KnowledgeLibraryORM` 新增 `embedding_profile_id`、`embedding_model_snapshot` 列
- [x] `orm.py`：新增 `LLMUsageRecordORM` 表（`llm_usage_records`）
- [x] `schemas.py`：新增 `LLMProfileSchema/Create/Update`、`EmbeddingProfileSchema/Create/Update`、`LLMTestResult`、`EmbeddingTestResult`、`LLMUsageRecord`；直接删除旧 `ModelProfileSchema`

### 服务层

- [x] `app/services/model_routing.py`：新建，实现 `get_llm_for_task()`、`get_embedding_for_ingest()`、`get_embedding_for_query()`，定义 `ModelNotConfiguredError`、`LibraryNotIndexedError`
- [x] `app/services/usage_recorder.py`：新建，实现 `record_llm_usage()` 异步写入函数；写入失败只记日志，不抛出异常影响主调用链
- [x] `app/agents/model_adapter.py`：新增 `embedding_from_profile()` 支持 OpenAI / Jina / openai_compatible embedding；`model_from_profile()` 支持 `"openai_compatible"` provider；删除 `get_default_model()` 及所有调用点

### API 层

- [x] `app/api/llm_profiles.py`：新建，CRUD + `/test` 端点；PATCH 实现 api_key 保留/替换/清空三语义；DELETE 检查 workspace 引用返回 409
- [x] `app/api/embedding_profiles.py`：新建，CRUD + `/test` 端点；DELETE 执行双重引用检查（workspace + library 快照），返回 409 含 referenced_by 详情
- [x] `app/api/workspaces.py`：`PATCH` 支持 `default_llm_profile_id`、`rules_llm_profile_id`、`embedding_profile_id`；删除 `default_model_profile_id` 字段
- [x] `app/api/knowledge_search.py`：搜索响应新增 `warnings` 和 `error` 字段；调用 `get_embedding_for_query()`，捕获 `LibraryNotIndexedError` 返回 422
- [x] `app/main.py`：注册 `llm_profiles`、`embedding_profiles` 路由；移除旧 `model_profiles` 路由

### Workflow / Agent 接入

- [x] `app/workflows/create_module.py`：用 `get_llm_for_task(db, workspace_id, "creative")` 替代 `get_default_model()`；调用后提取 usage 写入 `record_llm_usage()`
- [x] `app/workflows/modify_asset.py`：同上
- [x] `app/workflows/rules_review.py`：用 `get_llm_for_task(db, workspace_id, "rules")`；写入 usage
- [x] `app/workflows/generate_image.py`：用 `get_llm_for_task(db, workspace_id, "creative")`；写入 usage
- [x] `app/api/agent_tools.py`（consistency_check）：用 `get_llm_for_task(db, workspace_id, "rules")`；写入 usage
- [x] `app/api/chat.py`：用 `get_llm_for_task(db, workspace_id, "general")`；写入 usage
- [x] PDF ingest 管道：用 `get_embedding_for_ingest(db, workspace_id)` 替代硬编码 embedding；ingest 成功后更新 `library.embedding_profile_id` 和 `library.embedding_model_snapshot`

### shared-schema

- [x] `packages/shared-schema/src/index.ts`：按上方"shared-schema 变更"章节更新；直接删除旧 `ModelProfile` 类型和 `ProviderType = ... | "custom"` 枚举值

### 前端

- [x] `apps/desktop/src/pages/SettingsPage.tsx`：重构为双 Tab（LLM / Embedding），含 CRUD、has_api_key 展示、测试连接、快速预填
- [x] `apps/desktop/src/pages/WorkspaceSettingsPage.tsx`：新增"模型路由"绑定区域（三个下拉）
- [x] `apps/desktop/src/components/agent/WorkflowProgress.tsx`：识别 `ModelNotConfiguredError`，显示跳转设置按钮
- [x] `apps/desktop/src/components/agent/AgentPanel.tsx`：发送前检查 `default_llm_profile_id`，未配置显示 inline warning
- [x] 知识库搜索结果页：显示来自 `warnings` 字段的 Embedding 不一致告警
- [x] `apps/desktop/src/App.tsx`：确保 `/settings` 路由已注册

### 清理旧实现

- [x] 删除旧 `ModelProfileORM`、`ModelProfileSchema` 及所有引用（无存量数据，直接删除）
- [x] 删除 shared-schema 中旧 `ModelProfile`、`ProviderType = ... | "custom"` 的所有引用

---

## 验证步骤

1. **LLM Profile 创建**：新建 OpenRouter / Claude profile，填 API key，点"测试连接"，确认延迟和 echo 正常；列表显示"已配置"标记
2. **API Key 更新语义**：PATCH 不传 `api_key` → 保留；传新 key → 替换（`has_api_key` 仍为 true）；传 `clear_api_key=true` → 清空（`has_api_key` 变 false）；传空字符串 → 返回 400
3. **Embedding Profile 创建**：新建 OpenAI `text-embedding-3-small`，测试连接返回 `dimensions=1536`
4. **Workspace 路由绑定**：绑定创作模型 + embedding 模型，保存成功；下拉显示 `{name} · {provider}/{model_name}`
5. **PDF ingest 使用 embedding 模型**：导入 PDF 后，`library.embedding_model_snapshot` 字段有正确 model_name
6. **query embedding 一致性校验**：改 workspace embedding profile 后搜索，响应 `warnings` 非空且内容提示不一致；搜索结果仍正常返回
7. **创作任务路由**：触发 create_module，确认 workflow 使用 workspace 绑定的 LLM
8. **rules 路由回退**：仅配置 default LLM，不配 rules LLM，触发规则审查，确认回退到 default
9. **未配置错误**：新 workspace 不配任何模型，触发创作任务 → WorkflowProgress 显示"未配置创作模型"和跳转按钮，不 crash；触发 PDF 导入 → inline warning 阻断
10. **embedding profile 被删后 query**：删除已用于建索引的 embedding profile，触发搜索，确认返回明确错误而非 500 crash
11. **library 未建索引时搜索**：对未完成 ingest 的 library 发起搜索，确认返回 422 + error 字段提示"尚未建立索引"，`results` 为空，不静默返回空数组也不报 500
12. **EmbeddingProfile 删除保护**：删除被 workspace 引用的 embedding profile → 409，响应包含 `referenced_by.workspaces`；删除被 library 索引快照引用的 → 409，响应包含 `referenced_by.libraries`；两者都解绑后再删除 → 成功

---

## 关键约束

- `get_default_model()` 在本里程碑内删除，所有调用点改为 `get_llm_for_task()`
- `model_profiles` 表在本里程碑内重命名为 `llm_profiles`，不保留旧表名兼容
- API 响应**永远不返回** `api_key_encrypted` 或任何形式的明文 key；只返回 `has_api_key: bool`
- query 时必须使用 library 的 embedding 快照 profile，不允许静默用 workspace 当前配置替代
- library 未建索引时（`embedding_profile_id` 为空），搜索返回 422 + 明确 error，不允许静默返回空数组
- EmbeddingProfile 删除前必须同时检查 workspace 引用和 library 快照引用，任一存在即返回 409
- 同一 library 换 embedding 模型重建索引时必须清空旧向量数据，不允许新旧向量混存
- Workspace 创建时不强制绑定任何模型，但触发具体功能时按能力硬性拦截
- `supports_json_mode` / `supports_tools` 不设数据库默认值，创建 LLMProfile 时为必填字段，由前端预填建议值
- usage 记录写入失败不影响主调用链，只记日志；M6 阶段不暴露任何 usage 查询 API
- /test 端点只测试基本连通性，不自动推断或修改任何 capability 字段
- 前端不允许硬编码任何 provider 的 API endpoint URL，所有 base_url 由用户配置
