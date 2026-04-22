# M8：知识库预览、质量检查与增强解析扩展

**前置条件**：M2 完成（PDF ingest 基础链路）、M6 完成（EmbeddingProfile 管理与路由）。

**目标**：在已有 ingest 能力的基础上，分两层推进知识库可观测性与后续增强能力：
1. **第一层（优先）**：知识库预览与质量检查——让用户能看见 ingest 结果是否可信，便于调试与验证
2. **第二层（后续扩展）**：图片资源提取、AI 增强解析、检索 rerank——先规划架构边界，不强制当前全部实现

---

## 范围声明

### M8 当前优先实现（A 类）

1. 知识库管理页增加文档状态预览（manifest 可视化）
2. chunk 列表预览与页级文本预览
3. 检索测试面板（输入查询 → 看命中结果）
4. 质量告警展示（parse_status / parse_quality_notes / 异常 chunk 标注）
5. 后端 API 支持：文档预览、chunk 列表、页级文本、检索测试

### M8 后续可扩展（B 类）

6. 图片资源提取：从 PDF 中保存图片并记录元数据
7. AI 增强解析：扫描版 vision fallback、复杂版式 AI 重建、结构化条目抽取
8. 检索 rerank：作为 `retrieve → rerank → top_k` 的可插拔增强步骤

### M8 明确不承诺（C 类，暂不进入当前版本主链路）

- vision AI 作为默认 PDF 解析器
- 图片进入主向量检索链路
- 图片自动作为生成怪物/地图的参考输入
- rerank 默认启用作为检索必经步骤
- 全面支持扫描版（仅标注风险，不承诺高精度）

---

## 背景与动机

M2 完成了 ingest 的技术链路，但用户导入 PDF 后缺乏反馈：
- 不知道哪些页提取失败
- 不知道 chunk 切分是否合理
- 不知道检索能不能命中正确内容
- 不知道哪些文档有质量风险

在引入任何增强能力（AI 解析、rerank）之前，应先让用户能看清楚基础链路的输出质量。这也是 rerank 被推后的核心原因——rerank 解决的是"召回到了但排序不够准"，而用户目前连"有没有召回到"都看不见。

---

## A 类：知识库预览与质量检查

### 数据层

#### 新增后端 API 端点

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
     body: { "query": "...", "top_k": 10 }
     → 检索测试，返回命中 chunk 列表（不写 usage 记录）
```

#### shared-schema 新增类型

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

// 检索测试结果
interface SearchTestResult {
  chunk_id: string
  content: string
  document_filename: string
  page_from: number
  page_to: number
  section_title: string | null
  relevance_score: number
}
```

### 前端页面与交互

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

#### 检索测试面板

点击"检索测试"后打开对话框：

```
┌─────────────────────────────────────────┐
│ 检索测试                                 │
│ ┌─────────────────────────────────┐     │
│ │ 输入查询语句...              [搜索] │   │
│ └─────────────────────────────────┘     │
│ top_k: [10 ▼]                           │
│                                         │
│ 结果（3 条命中）：                       │
│ ─────────────────                        │
│ [0.92] 第三章：检定规则 (p.45-46)        │
│ "当角色尝试执行一个困难的..."            │
│ 来源：coc7e_core_rules.pdf              │
│ ─────────────────                        │
│ [0.87] 第三章：检定规则 (p.47)           │
│ ...                                     │
└─────────────────────────────────────────┘
```

### Todo（A 类）

- [ ] 后端：`GET /knowledge/libraries/{id}/documents` 接口
- [ ] 后端：`GET /knowledge/documents/{id}/manifest` 接口
- [ ] 后端：`GET /knowledge/documents/{id}/pages/{n}` 接口
- [ ] 后端：`GET /knowledge/documents/{id}/chunks` 分页接口
- [ ] 后端：`GET /knowledge/documents/{id}/chunks/{chunk_id}` 接口
- [ ] 后端：`POST /knowledge/libraries/{id}/search/test` 检索测试接口
- [ ] 后端：ingest 完成后写入质量告警字段（quality_warnings 写入 manifest）
- [ ] shared-schema：新增 `KnowledgeDocumentSummary`、`QualityWarning`、`PageTextPreview`、`ChunkListItem`、`SearchTestResult`
- [ ] 前端：KnowledgePage 文档条目展开显示 manifest 摘要 + 质量告警
- [ ] 前端：文档预览侧边面板（Chunk 列表 Tab + 页面文本 Tab）
- [ ] 前端：检索测试对话框
- [ ] 前端：质量告警 badge / 颜色标注（failed 红、partial/scanned 黄、success 绿）

### 验证步骤（A 类）

1. 导入一个文本型 PDF，文档列表正确显示 manifest 信息
2. 导入一个含双栏/表格的 PDF，质量告警正确显示
3. 导入一个扫描版 PDF，parse_status = scanned_fallback，告警显示
4. chunk 列表能显示所有 chunk，点击展开能看到 content
5. 页面文本预览能显示某页的 raw_text，页码关联的 chunk_id 正确
6. 检索测试能返回命中结果，relevance_score 合理，来源信息完整
7. 检索测试不写入 LLMUsageRecord

---

## B 类：后续可扩展能力（规划为扩展，不强制当前实现）

### B1：图片资源提取

**定位**：从 PDF 中提取图片并归档，为未来的图片检索和创作参考做准备。不进入第一版主链路。

**规划设计**：

新增数据表 `knowledge_document_images`：
```
id                  string PK
document_id         string FK
page_number         int
image_index         int     # 该页第几张图
file_path           string  # 保存路径（相对于 data 根目录）
width               int
height              int
format              string  # png / jpeg / etc
image_type_tag      string  # 可选：map / monster / decoration / table_screenshot / unknown
extracted_at        datetime
```

规划 API：
```
GET  /knowledge/documents/{id}/images        → 图片列表
GET  /knowledge/documents/{id}/images/{img_id} → 图片元数据
POST /knowledge/documents/{id}/images/{img_id}/tag  → 手动打标签
```

**实现前提**：A 类预览与质量检查完成后再启动。

### B2：AI 增强解析

**定位**：解决扫描版、复杂版式、结构化条目抽取等基础文本工具无法覆盖的场景。不作为默认主链路。

**规划设计**：

作为 ingest 流水线的可选增强步骤，在步骤 2（文本提取）后可插入：
```
步骤 2：提取文本
  └── [可选 AI 增强] 若 parse_status = scanned_fallback 且启用 vision fallback
        → 调用 vision model 对页面图像进行 OCR 兜底
        → 标注来源为 "ai_ocr"，不覆盖原始 raw_text

步骤 3 后可插入：[可选 AI 增强] 复杂版式页的 AI 结构重建
步骤 8 后可插入：[可选 AI 增强] 结构化条目抽取（怪物/NPC/法术/地点候选）
```

**配置设计**：
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

**实现前提**：需要 LLMProfile 支持 vision 能力（provider = openai，model = gpt-4o 等）；A 类完成后再启动。

### B3：检索 Rerank

**定位**：`retrieve → rerank → top_k` 的可插拔增强步骤，解决"召回到了但排序不够准"的问题。不作为默认检索步骤。

**Rerank 解决的问题**：
- 多知识库联合检索时噪声较多，语义相近但不相关的 chunk 排在前列
- 创作型自然语言查询（Plot/NPC/Monster/Lore）需要更高质量的 top results
- 规则检索中最直接的规则原文未排在前列

**Rerank 不解决的问题**：
- 文本提取失败 → 应通过质量检查和 AI 增强解析解决
- chunk 切分错误 → 应调整 chunking 策略
- citation 错误 → 应通过质量检查验证
- library 绑定错误 → 应通过检索测试验证

**规划设计**：

作为检索后的可选步骤：
```python
# 当前默认链路
results = vector_search(query, top_k=top_k)

# 启用 rerank 后
candidates = vector_search(query, top_n=top_n)   # top_n > top_k
results = rerank(query, candidates)[:top_k]
```

配置字段（规划，挂载在 WorkspaceRAGConfig 或全局 RAGConfig）：
```json
{
  "rerank_config": {
    "enabled": false,
    "provider": "cohere | openai | local",
    "model": "rerank-english-v3.0",
    "top_n": 20,
    "top_k": 5,
    "apply_to_task_types": ["rules_review", "plot_creation", "npc_creation", "monster_creation", "lore_creation"]
  }
}
```

**优先级说明**：
- 应先完成 A 类知识库预览与质量检查，确认 citation 可靠性和文本提取质量达标
- 再考虑启用 rerank 进一步提升排序质量
- rerank 与 EmbeddingProfile 解耦，独立配置

**实现前提**：A 类完成，基础检索质量已验证；需要新增 rerank provider 配置（类似 EmbeddingProfile 的管理方式）。

---

## 非目标（M8 不承诺）

- 当前版本全面支持扫描版（仅标注风险）
- 当前版本图片进入主向量检索链路
- 当前版本默认使用 vision AI 解析所有 PDF
- 当前版本自动把图片直接变成生成怪物/地图的参考输入
- 当前版本默认启用 rerank 作为检索必经步骤
- 精确的图片语义检索

---

## 里程碑完成标准

M8 完成条件（以 A 类为准）：

1. 所有已导入文档在知识库管理页均能显示 manifest 摘要
2. 质量告警对 scanned_fallback、partial、has_table、has_multi_column 均有可视化标注
3. chunk 列表预览可用，能展开查看 content
4. 页级文本预览可用
5. 检索测试面板可用，能返回带来源信息的命中结果
6. B 类能力的数据结构设计已文档化（本 plan），代码中无 B 类实现代码

---

## 与其他里程碑的关系

```
M2（ingest 基础链路）
  └── M8 A类（预览与质量检查）—— 优先
        └── M8 B3（rerank）—— 确认质量后
              └── M8 B1（图片提取）—— 独立
              └── M8 B2（AI 增强解析）—— 独立，需要 vision LLM
```
