# M8：知识库预览、质量检查与可选 Rerank

**前置条件**：M2 完成（PDF ingest 基础链路）、M6 完成（EmbeddingProfile 管理与路由）。

**目标**：在已有 ingest 能力的基础上，完成两项当前版本实现能力，并规划后续扩展：
1. **A1（优先）**：知识库预览与质量检查——让用户能看见 ingest 结果是否可信，便于调试与验证
2. **A2（A1 完成后）**：可选 rerank 能力——作为 `retrieve → rerank → top_k` 的可配置增强步骤，默认不启用
3. **B 类（后续扩展）**：图片资源提取、AI 增强解析——规划架构边界，不强制当前实现

---

## 范围声明

### M8 当前实现（A 类）

**A1：知识库预览与质量检查**
1. 知识库管理页增加文档状态预览（manifest 可视化）
2. chunk 列表预览与页级文本预览
3. 检索测试面板（输入查询 → 看命中结果，支持 rerank 对比）
4. 质量告警展示（parse_status / parse_quality_notes / 异常 chunk 标注）
5. 后端 API 支持：文档预览、chunk 列表、页级文本、检索测试

**A2：可选 Rerank**
6. RerankProfile 数据模型（provider / model / API key / top_n / top_k）
7. Workspace RAG 配置新增 rerank 路由字段（rerank_profile_id + apply_to_task_types）
8. 后端 rerank adapter（Jina 为默认推荐，支持 Cohere、OpenAI Compatible）
9. 检索链路支持可选 rerank（`retrieve top_n → rerank → top_k`）
10. `search/test` 接口支持 `use_rerank` 参数，便于对比验证
11. 前端：全局设置页新增 Rerank Profiles Tab；Workspace 设置页新增 rerank 路由配置；检索测试面板支持 rerank 开关对比

### M8 后续可扩展（B 类）

- 图片资源提取：从 PDF 中保存图片并记录元数据（B1）
- AI 增强解析：扫描版 vision fallback、复杂版式 AI 重建、结构化条目抽取（B2）

### M8 明确不承诺（C 类，暂不进入主链路）

- vision AI 作为默认 PDF 解析器
- 图片进入主向量检索链路
- 图片自动作为生成怪物/地图的参考输入
- rerank 默认启用为检索必经步骤（必须通过配置显式开启）
- 全面支持扫描版（仅标注风险，不承诺高精度）

---

## 背景与动机

M2 完成了 ingest 技术链路，但用户导入 PDF 后缺乏反馈：
- 不知道哪些页提取失败、哪些 chunk 切分有问题
- 不知道检索能不能命中正确内容
- 不知道哪些文档有质量风险

**A1 优先**：在引入任何增强能力之前，先让用户能看清楚基础链路的输出质量。

**A2 在 A1 之后**：rerank 解决的是"召回到了但排序不够准"——向量检索已能命中相关 chunk，但最相关的结果未排在最前。在基础检索质量可观测之后，rerank 才能发挥其价值（否则无法判断排序改善是否真实有效）。rerank 不设为默认，是因为它引入额外 API 调用成本，且多数场景下向量检索的排序已能满足需求。

---

## A1：知识库预览与质量检查

### 后端 API 端点

```
GET  /knowledge/libraries/{library_id}/documents
     → 文档列表，含 manifest 摘要

GET  /knowledge/libraries/{library_id}/documents/{document_id}/manifest
     → 完整 manifest.json 内容

GET  /knowledge/libraries/{library_id}/documents/{document_id}/pages/{page_number}
     → 该页提取的原始文本 + 清洗后文本

GET  /knowledge/libraries/{library_id}/documents/{document_id}/chunks
     → chunk 列表（支持分页：?offset=0&limit=50）
     → 每条含 chunk_index, page_from, page_to, section_title, char_count, metadata

GET  /knowledge/libraries/{library_id}/documents/{document_id}/chunks/{chunk_id}
     → 单条 chunk 完整内容（含 content 文本）

POST /knowledge/libraries/{library_id}/search/test
     body: { "query": "...", "top_k": 10, "use_rerank": false }
     → 检索测试，返回命中 chunk 列表（不写 usage 记录）
```

### shared-schema 新增类型（A1）

```typescript
// 文档预览摘要
interface KnowledgeDocumentSummary {
  document_id: string
  library_id: string
  filename: string
  page_count: number
  chunk_count: number
  parse_status: "success" | "partial" | "scanned_fallback" | "failed"
  parse_quality_notes: string | null
  embedding_provider: string | null
  embedding_model: string | null
  indexed_at: string | null
  quality_warnings: QualityWarning[]
}

// 质量告警
interface QualityWarning {
  type: "scanned_fallback" | "partial" | "has_table" | "has_multi_column" | "page_range_anomaly" | "empty_page"
  detail: string
  affected_pages?: number[]
}

// 页级文本预览
interface PageTextPreview {
  page_number: number
  raw_text: string
  cleaned_text: string | null
  chunk_ids: string[]
}

// chunk 预览条目（列表用，不含 content）
interface ChunkListItem {
  chunk_id: string
  chunk_index: number
  page_from: number
  page_to: number
  section_title: string | null
  char_count: number
  metadata: {
    parse_quality: string
    has_table: boolean
    has_multi_column: boolean
  }
}

// 检索测试结果（A1/A2 共用）
interface SearchTestResult {
  chunk_id: string
  content: string
  document_filename: string
  page_from: number
  page_to: number
  section_title: string | null
  vector_score: number        // 向量相似度分数 [0,1]，始终返回
  rerank_score: number | null // reranker 分数，仅启用 rerank 时返回，否则为 null
  reranked: boolean           // true = 经过 rerank 排序；false = 原始向量排序
}
```

### 前端页面与交互（A1）

#### 知识库管理页（KnowledgePage）增强

在已有 Library 列表基础上，每个 Document 条目展开后显示：

```
┌─────────────────────────────────────────────┐
│ 📄 coc7e_core_rules.pdf                      │
│ 状态：✅ success  页数：320  Chunks：487     │
│ Embedding：openai / text-embedding-3-small   │
│ [预览] [检索测试]                            │
│                                              │
│ ⚠ 质量告警：                                 │
│   • 检测到双栏布局（第 45-120 页）           │
│   • 3 页提取文本为空（第 8, 67, 201 页）     │
└─────────────────────────────────────────────┘
```

#### 文档预览侧边面板 / 抽屉

点击"预览"后打开侧边面板，包含两个子 Tab：

**Tab 1：Chunk 列表**
- 虚拟化列表（文档较大时 chunk 数量多）
- 每行显示：chunk_index、page_from-page_to、section_title（截断）、char_count、质量标记
- 点击行展开显示 content 全文

**Tab 2：页面文本**
- 页码输入框（或上下翻页）
- 显示该页 raw_text 和 cleaned_text（双列对比，若清洗后有差异则高亮）
- 显示该页关联的 chunk_id 列表（可点击跳转到 chunk）

#### 检索测试面板（A1 基础版）

```
┌─────────────────────────────────────────┐
│ 检索测试                                 │
│ ┌─────────────────────────────────┐     │
│ │ 输入查询语句...              [搜索] │   │
│ └─────────────────────────────────┘     │
│ top_k: [10 ▼]   □ 启用 Rerank（需配置） │
│                                         │
│ 结果（3 条命中）：                       │
│ [0.92] 第三章：检定规则 (p.45-46)        │
│ "当角色尝试执行一个困难的..."            │
│ 来源：coc7e_core_rules.pdf              │
└─────────────────────────────────────────┘
```

### Todo（A1）

- [x] 后端：`GET /knowledge/libraries/{id}/documents` 接口
- [x] 后端：`GET /knowledge/documents/{id}/manifest` 接口（实现为 `/knowledge/documents/{id}/summary`，包含 manifest 摘要 + 质量告警，路径与 plan 略有差异但语义等同）
- [x] 后端：`GET /knowledge/documents/{id}/pages/{n}` 接口
- [x] 后端：`GET /knowledge/documents/{id}/chunks` 分页接口
- [x] 后端：`GET /knowledge/documents/{id}/chunks/{chunk_id}` 接口
- [x] 后端：`POST /knowledge/libraries/{id}/search/test` 基础检索测试接口（含 `use_rerank` 参数占位）
- [x] 后端：ingest 完成后写入质量告警字段（quality_warnings 写入 manifest）
- [x] shared-schema：新增 `KnowledgeDocumentSummary`、`QualityWarning`、`PageTextPreview`、`ChunkListItem`、`SearchTestResult`
- [x] 前端：KnowledgePage 文档条目展开显示 manifest 摘要 + 质量告警
- [x] 前端：文档预览侧边面板（Chunk 列表 Tab + 页面文本 Tab）
- [x] 前端：检索测试对话框（含 rerank 开关，A1 阶段未配置 rerank 时禁用该开关）
- [x] 前端：质量告警 badge / 颜色标注（failed 红、partial/scanned 黄、success 绿）

### 验证步骤（A1）

1. 导入一个文本型 PDF，文档列表正确显示 manifest 信息
2. 导入一个含双栏/表格的 PDF，质量告警正确显示
3. 导入一个扫描版 PDF，parse_status = scanned_fallback，告警显示
4. chunk 列表能显示所有 chunk，点击展开能看到 content
5. 页面文本预览能显示某页的 raw_text，页码关联的 chunk_id 正确
6. 检索测试（use_rerank=false）能返回命中结果，relevance_score 合理，来源信息完整
7. 检索测试不写入 LLMUsageRecord

---

## A2：可选 Rerank

> **实现顺序**：A1 完成、基础检索质量已可验证后启动 A2。

### 数据模型

#### 新增 ORM：`RerankProfileORM`

```
id                  string PK
name                string         # 用户自定义名称
provider_type       string         # "jina" | "cohere" | "openai_compatible"
model               string         # 默认：jina-reranker-v2-base-multilingual
api_key             string encrypted
base_url            string | null  # openai_compatible 时需要
created_at          datetime
updated_at          datetime
```

#### Workspace RAG 配置扩展

在 `WorkspaceORM` 新增（top_n/top_k/enabled/task_types 属于 per-workspace 调参，不属于 provider 配置）：

```
rerank_profile_id          string | null FK → rerank_profiles.id
rerank_enabled             bool default false
rerank_top_n               int default 20   # retrieve 候选数（> top_k）
rerank_top_k               int default 5    # rerank 后保留数
rerank_apply_to_task_types JSON             # 默认：["rules_review"]
                                            # 可选：rules_review / plot_creation /
                                            #       npc_creation / monster_creation /
                                            #       lore_creation / consistency_check
```

#### 默认推荐模型

| Provider | 推荐模型 | 说明 |
|----------|---------|------|
| **jina**（默认推荐） | `jina-reranker-v2-base-multilingual` | 多语言，支持中文，API 调用简单 |
| cohere | `rerank-multilingual-v3.0` | 多语言，质量高，需 Cohere API key |
| openai_compatible | 用户自填 | 兼容 OpenAI 格式的自托管 reranker |

### shared-schema 新增类型（A2）

```typescript
type RerankProviderType = "jina" | "cohere" | "openai_compatible"

// RerankProfile 只保存 provider 连接信息，不含调参字段
interface RerankProfile {
  id: string
  name: string
  provider_type: RerankProviderType
  model: string
  base_url: string | null
  has_api_key: boolean   // api_key 不返回明文
  created_at: string
  updated_at: string
}

interface CreateRerankProfileRequest {
  name: string
  provider_type: RerankProviderType
  model: string
  api_key: string
  base_url?: string
}

// WorkspaceRerankConfig 含调参字段（top_n/top_k/enabled/task_types）
interface WorkspaceRerankConfig {
  rerank_profile_id: string | null
  rerank_enabled: boolean
  rerank_top_n: number
  rerank_top_k: number
  rerank_apply_to_task_types: string[]
}
```

### 后端 API 端点（A2）

```
# RerankProfile CRUD（挂载在 /settings/rerank-profiles）
GET    /settings/rerank-profiles
POST   /settings/rerank-profiles
GET    /settings/rerank-profiles/{id}
PATCH  /settings/rerank-profiles/{id}
DELETE /settings/rerank-profiles/{id}
POST   /settings/rerank-profiles/{id}/test
       # 最小测试约定：
       # - 使用配置的 api_key 向 provider 发送一个最短 rerank 请求
       #   （query="test", documents=["hello", "world"]）
       # - 验证 API key 有效、网络可达、返回排序结果
       # - 不验证 model 是否匹配业务场景，只验证连接与鉴权

# Workspace rerank 路由配置
GET    /workspaces/{id}/rerank-config
PATCH  /workspaces/{id}/rerank-config

# 检索测试（search/test）支持 rerank，top_n/top_k 作为本次请求覆盖值
POST   /knowledge/libraries/{library_id}/search/test
       body: {
         "query": "...",
         "top_k": 5,          # 可选，覆盖 workspace 默认 rerank_top_k
         "top_n": 20,         # 可选，覆盖 workspace 默认 rerank_top_n
         "use_rerank": false   # 明确指定本次是否启用 rerank（优先级高于 workspace rerank_enabled）
       }
       # rerank 只作用于已按 library/type/priority 过滤后的候选集，不做全库 rerank
       # 返回结果中 reranked=true/false 标注，含 vector_score 和 rerank_score（null 时未 rerank）
```

### 后端 Rerank Adapter

```python
# services/rerank_adapter.py（示意，非实现代码）
# 统一接口，按 provider_type 路由到不同实现
# - JinaRerankAdapter：调用 https://api.jina.ai/v1/rerank
# - CohereRerankAdapter：调用 Cohere Rerank API
# - OpenAICompatibleRerankAdapter：调用 base_url/rerank

# 检索链路（示意）——rerank 只作用于已过滤候选集
def search_with_optional_rerank(query, workspace_id, library_filter, rerank_config, override_top_n=None, override_top_k=None):
    top_n = override_top_n or rerank_config.rerank_top_n
    top_k = override_top_k or rerank_config.rerank_top_k
    # 先按 library/type/priority 过滤，再 retrieve
    candidates = vector_search(query, library_filter=library_filter, top_n=top_n)
    if rerank_config.rerank_enabled and rerank_profile is not None:
        results = rerank_adapter.rerank(query, candidates)[:top_k]
        return results, reranked=True
    return candidates[:top_k], reranked=False
```

### 前端（A2）

#### SettingsPage：新增 Rerank Profiles Tab

在现有 LLM Profiles / Embedding Profiles / 模型目录三个 Tab 后，新增第四个 Tab：

```
┌──────────────────────────────────────────────┐
│ LLM Profiles | Embedding Profiles | 模型目录 | Rerank Profiles │
├──────────────────────────────────────────────┤
│ [+ 新建 Rerank Profile]                       │
│                                              │
│ Jina Reranker（默认）                         │
│ jina / jina-reranker-v2-base-multilingual    │
│ top_n: 20  top_k: 5                          │
│ [编辑] [测试] [删除]                         │
└──────────────────────────────────────────────┘
```

#### WorkspaceSettingsPage：新增 Rerank 路由配置

在现有 LLM / Embedding / RAG 路由配置区域后，新增 Rerank 区块：

```
Rerank 配置
  Rerank Profile：[Jina Reranker ▼]（未配置时显示"-"）
  默认关闭 □ 启用 Rerank
  应用任务类型：[rules_review ✓] [plot_creation] [npc_creation] [monster_creation] [lore_creation]
```

#### 检索测试面板：Rerank 对比（A2 完成后）

当 Workspace 已配置 RerankProfile 时，检索测试面板解锁 rerank 开关，并支持双栏对比模式：

```
┌─────────────────────────────────────────────────────┐
│ 检索测试                                             │
│ ┌─────────────────────────────────────┐             │
│ │ 输入查询语句...                  [搜索] │           │
│ └─────────────────────────────────────┘             │
│ top_k: [5 ▼]   top_n: [20]   ☑ 启用 Rerank 对比    │
│                                                     │
│  向量检索排序（原始）   │   Rerank 后排序            │
│ ─────────────────────  │  ───────────────────────   │
│ [0.87] p.23 怪物属性   │  [0.94] p.23 怪物属性      │
│ [0.85] p.45 规则说明   │  [0.91] p.67 怪物数值表    │
│ [0.83] p.12 序言       │  [0.88] p.45 规则说明      │
└─────────────────────────────────────────────────────┘
```

### Todo（A2）

**数据层**
- [x] 后端：新增 `rerank_profiles` ORM 表（provider_type / model / api_key encrypted / base_url / top_n / top_k）
- [x] 后端：WorkspaceORM 新增 rerank_profile_id / rerank_enabled / rerank_apply_to_task_types 字段
- [x] shared-schema：新增 `RerankProfile`、`RerankProviderType`、`CreateRerankProfileRequest`、`WorkspaceRerankConfig`

**服务层**
- [x] 后端：`rerank_adapter.py`（Jina / Cohere / OpenAI Compatible 三路实现）
- [x] 后端：`model_routing.py` 新增 `get_reranker_for_workspace()` 函数
- [x] 后端：检索链路（knowledge_search）接入可选 rerank（retrieve top_n → rerank → top_k）

**API 层**
- [x] 后端：`rerank_profiles.py` CRUD 路由（含 /test）
- [x] 后端：`PATCH /workspaces/{id}/rerank-config` 路由（注：rerank 配置通过 `PATCH /workspaces/{id}` 统一保存，未单独建路由，语义等同）
- [x] 后端：`POST /knowledge/libraries/{id}/search/test` 支持 `use_rerank` 参数

**前端**
- [x] SettingsPage：新增第四 Tab Rerank Profiles（列表 + 新建/编辑/测试/删除）
- [x] WorkspaceSettingsPage：新增 Rerank 路由配置区块（含 apply_to_task_types 复选框）
- [x] 检索测试面板：rerank 开关 + vector_score/rerank_score 分数对比显示（注：实现为单列带双分数标注，非双栏布局，功能等同）

### 验证步骤（A2）

1. 新建 Jina RerankProfile，填入 API Key，/test 返回成功
2. Workspace 设置绑定 RerankProfile，启用 rules_review 任务类型
3. 检索测试面板：use_rerank=false 与 use_rerank=true 结果排序不同，reranked 字段正确标注
4. rules_review 场景：rerank 后最相关规则原文排在 top_1，优于纯向量排序
5. 未配置 RerankProfile 时，rerank 开关禁用，检索链路回退为标准 top_k，不报错
6. rerank_enabled=false 时，workflow 检索不经过 rerank adapter，不产生额外 API 调用
7. rerank 结果不写入 LLMUsageRecord（rerank 调用独立于 LLM usage）

---

## B 类：后续可扩展能力（规划为扩展，不强制当前实现）

### B1：图片资源提取

**定位**：从 PDF 中提取图片并归档，为未来的图片检索和创作参考做准备。不进入当前主链路。

**规划数据表** `knowledge_document_images`：
```
id                  string PK
document_id         string FK
page_number         int
image_index         int
file_path           string
width               int
height              int
format              string  # png / jpeg
image_type_tag      string  # map / monster / decoration / table_screenshot / unknown
extracted_at        datetime
```

**规划 API**：
```
GET  /knowledge/documents/{id}/images
GET  /knowledge/documents/{id}/images/{img_id}
POST /knowledge/documents/{id}/images/{img_id}/tag
```

**实现前提**：A1 完成后启动。

### B2：AI 增强解析

**定位**：解决扫描版、复杂版式、结构化条目抽取等文本工具无法覆盖的场景。不作为默认主链路。

**规划配置**：
```json
{
  "ai_parse_config": {
    "enable_vision_fallback": false,
    "enable_layout_rebuild": false,
    "enable_entity_extraction": false,
    "vision_llm_profile_id": null
  }
}
```

**实现前提**：需要 LLMProfile 支持 vision 能力（如 gpt-4o）；A1 完成后启动。

---

## 非目标（M8 不承诺）

- 全面支持扫描版（仅标注风险，不承诺高精度）
- 图片进入主向量检索链路
- 默认使用 vision AI 解析所有 PDF
- 图片自动作为生成怪物/地图的参考输入
- rerank 默认启用（必须通过配置显式开启）
- 精确的图片语义检索

---

## 里程碑完成标准

### A1 完成条件

1. 所有已导入文档在知识库管理页均能显示 manifest 摘要
2. 质量告警对 scanned_fallback、partial、has_table、has_multi_column 均有可视化标注
3. chunk 列表预览可用，能展开查看 content
4. 页级文本预览可用
5. 检索测试面板（use_rerank=false）可用，能返回带来源信息的命中结果

### A2 完成条件

6. RerankProfile CRUD 可用（含 /test 验证——发送最小 rerank 请求确认 API key 有效）
7. Workspace 可绑定 RerankProfile 并配置 top_n / top_k / apply_to_task_types
8. 检索测试支持 use_rerank + top_n/top_k 覆盖，双栏视图展示 vector_score 与 rerank_score 差异
9. 未配置 rerank 时，现有检索链路不受影响
10. **rules_review workflow 已接入可选 rerank**：task_type = rules_review 时，若 workspace rerank_enabled=true 且绑定有效 RerankProfile，检索结果经过 rerank 排序
11. B 类能力的数据结构设计已文档化（本 plan），代码中无 B 类实现代码

---

## 与其他里程碑的关系

```
M2（ingest 基础链路）
M6（EmbeddingProfile）
  └── M8 A1（预览与质量检查）—— 优先
        └── M8 A2（可选 rerank）—— A1 完成后
              └── M8 B1（图片提取）—— 独立扩展
              └── M8 B2（AI 增强解析）—— 独立扩展，需要 vision LLM
```
