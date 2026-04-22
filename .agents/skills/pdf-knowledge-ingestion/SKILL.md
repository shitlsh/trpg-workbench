---
name: pdf-knowledge-ingestion
description: 约束 trpg-workbench 中 PDF 知识库的导入、解析、切块、向量化和检索全流程规范。当实现或讨论任何与 PDF 处理相关的功能时必须加载本 skill，包括：PDF 导入流程、文本提取、chunk 划分、embedding 生成、向量索引建立、知识库检索策略、引用来源展示，或 KnowledgeDocument/KnowledgeChunk 相关数据结构设计。
---

# Skill: pdf-knowledge-ingestion

## 用途

本 skill 约束 `trpg-workbench` 中 PDF 知识库导入与处理的全流程规范。**所有 PDF 处理相关代码必须遵守本 skill，不允许跳过任何必要步骤。**

---

## 第一版范围约束

- **只处理 PDF 格式**（不处理 Word、HTML、EPUB 等）
- **文本型 PDF 优先**：使用文本提取工具直接提取，不引入 AI/vision 参与主解析流程
- **扫描版 PDF**：第一版只做弱支持，明确标注解析质量风险，不承诺高精度引用
- **双栏/表格 PDF**：解析质量可能下降，记录告警但不阻断流程
- **图片不进入第一版主链路**：PDF 中的图片、插图、地图等不进入文本向量索引流程，不做图片 embedding、OCR、图片检索

---

## 主链路原则（第一版）

第一版主链路坚持以下顺序，**不得引入 AI 参与默认解析步骤，不得引入外部向量服务，不得默认启用 rerank**：

```
文本提取工具 → 基础清洗 → chunking → embedding → 本地向量索引
```

- **AI 解析**（vision AI、LLM 重建）不属于当前版本默认能力，是后续可扩展方向
- **rerank** 不属于当前版本必须实现的检索步骤，是后续可扩展方向
- **图片提取与图片索引**不属于当前版本主链路

---

## 标准处理流水线（8步，顺序不可打乱）

```
步骤 1：保存原始文件
  └── 将 PDF 复制到 knowledge/libraries/<library-id>/source/
  └── 不修改原始文件

步骤 2：提取文本
  └── 优先使用 pdfplumber 或 pymupdf（fitz）提取文本
  └── 记录每页文本和页码映射
  └── 若提取文本为空（疑似扫描版），标记 parse_status = "scanned_fallback"

步骤 3：基础清洗
  └── 去除页眉页脚（基于重复行检测）
  └── 合并被强制换行的段落
  └── 不做语义层面的修改

步骤 4：按段落/标题切块（chunking）
  └── 优先按标题层级切块（H1/H2/H3 边界）
  └── 无标题时按段落 + 滑动窗口切块
  └── 目标 chunk 大小：300~800 tokens（可配置）
  └── 相邻 chunk 保留 50 token 重叠（overlap）

步骤 5：记录页码映射（必须，不可省略）
  └── 每个 chunk 必须记录 page_from 和 page_to
  └── 若跨页，记录起止页码范围
  └── section_title 记录最近一个标题（无则为 null）

步骤 6：生成 Embedding
  └── 调用与该 KnowledgeLibrary 绑定的 EmbeddingProfile（通过 embedding_profile_id 解析）
  └── EmbeddingProfile 存储在后端 DB（embedding_profiles 表），通过 get_embedding_for_ingest() 获取
  └── 若未绑定 EmbeddingProfile，抛出 ModelNotConfiguredError，不做静默回退
  └── embedding 结果引用存入 chunk 的 embedding_ref 字段
  └── ingest 完成后将 EmbeddingProfile 快照写入 KnowledgeLibrary.embedding_model_snapshot（JSON 字段）
  └── manifest 中必须记录实际使用的 embedding_provider 和 embedding_model

步骤 7：建立向量索引
  └── 使用本地向量库（lancedb 或 hnswlib）
  └── 索引存入 knowledge/libraries/<library-id>/index/
  └── 不依赖外部向量服务

步骤 8：生成 manifest
  └── 写入 knowledge/libraries/<library-id>/parsed/manifest.json
  └── 写入 knowledge/libraries/<library-id>/parsed/chunks.jsonl
```

---

## KnowledgeChunk 必须字段

每个 chunk 在 `chunks.jsonl` 中必须包含：

```json
{
  "id": "chunk_<uuid>",
  "document_id": "doc_<uuid>",
  "chunk_index": 0,
  "content": "实际文本内容",
  "embedding_ref": "index内的向量ID或路径",
  "page_from": 12,
  "page_to": 13,
  "section_title": "第三章：检定规则",
  "char_count": 450,
  "metadata": {
    "library_type": "core_rules",
    "parse_quality": "good | degraded | scanned_fallback",
    "has_table": false,
    "has_multi_column": false
  }
}
```

**`page_from` 和 `page_to` 是强制字段，不允许为 null（扫描版除外，降级为 -1 并标注）。**

---

## manifest.json 格式

```json
{
  "document_id": "doc_<uuid>",
  "library_id": "lib_<uuid>",
  "filename": "coc7e_core_rules.pdf",
  "page_count": 320,
  "chunk_count": 487,
  "parse_status": "success | partial | scanned_fallback | failed",
  "parse_quality_notes": "检测到双栏布局，部分段落合并可能有误",
  "embedding_provider": "openai | openai_compatible",
  "embedding_model": "text-embedding-3-small",
  "indexed_at": "2025-01-01T00:00:00Z",
  "library_type": "core_rules",
  "tags": ["基础规则", "COC", "第七版"]
}
```

---

## 检索策略（禁止做全库无差别检索）

### 默认检索链路

```
retrieve → top_k → 注入 Agent / 返回结果
```

### 可选 rerank 链路（默认不启用，可通过配置开关开启）

```
retrieve（top_n，仅作用于已按 library/type/priority 过滤后的候选集） → rerank → top_k → 注入 Agent / 返回结果
```

- rerank **不属于默认检索主链路**，当前版本允许作为可选增强能力实现，必须通过配置显式启用
- **rerank 只能作用于已按 library / library_type / WorkspaceLibraryBinding.priority 过滤后的候选集合**，不得在全库无差别候选上执行 rerank
- 启用建议：应先完成知识库预览与质量检查，确认基础文本提取质量和 citation 可靠性达标
- rerank 解决的是"召回到了但排序不够准"——向量检索已能命中相关 chunk，但最相关的结果未排在最前
- rerank 不解决：文本提取失败、chunk 切分错误、citation 错误、library 绑定错误
- rerank 不得替代基础文本提取质量、chunk 质量、citation 质量建设
- 默认推荐模型：Jina Reranker（`jina-reranker-v2-base-multilingual`）；支持 Cohere、OpenAI Compatible 等其他 provider
- RerankProfile 只保存 provider / model / api_key / base_url；top_n / top_k / rerank_enabled / apply_to_task_types 放在 WorkspaceRAGConfig

### 必须支持的检索维度

1. **按 library 优先级检索**：通过 WorkspaceLibraryBinding.priority 决定检索顺序
2. **按资产类型选择 library**：不同生成任务使用不同的库优先级
3. **按 library_type 过滤**：可指定只检索 core_rules / module_reference 等

### 推荐检索优先级配置

| 生成任务 | 优先库顺序 |
|---------|-----------|
| 生成怪物 | monster_manual > core_rules > module_reference |
| 生成剧情 | module_reference > lore > core_rules |
| 规则审查 | core_rules > house_rules |
| 生成 NPC | module_reference > lore > core_rules |
| 生成地点 | lore > module_reference > core_rules |

### 引用结果必须附带来源

每条检索结果必须返回：

```json
{
  "chunk_id": "chunk_xxx",
  "content": "相关片段文本",
  "document_filename": "coc7e_core_rules.pdf",
  "page_from": 45,
  "page_to": 46,
  "section_title": "第四章：怪物与NPC",
  "vector_score": 0.87,      // 向量相似度分数（始终返回）
  "rerank_score": 0.94,      // rerank 分数（仅启用 rerank 时返回，否则为 null）
  "reranked": false           // true = 经过 rerank 排序；false = 原始向量排序
}
```

- `vector_score`：向量检索的余弦相似度，范围 [0, 1]，始终返回
- `rerank_score`：reranker 模型的相关性分数（各 provider 取值范围不同，一般为 [0, 1] 或 [-∞, +∞]），仅启用 rerank 时返回，否则为 `null`
- Agent 注入时只使用 content / citation 字段，不使用分数

---

## 知识库预览与质量检查能力（第一版必须支持）

ingest 不是终点。第一版知识库处理必须同时提供基础预览和检查能力，让用户能验证 PDF 提取质量和检索质量，不能只有"导入成功"状态而无法查看内容。

### 文档级预览（必须）

每个已导入文档必须能展示：

| 字段 | 说明 |
|------|------|
| `filename` | 原始文件名 |
| `page_count` | 总页数 |
| `parse_status` | success / partial / scanned_fallback / failed |
| `chunk_count` | 切块数量 |
| `parse_quality_notes` | 质量风险说明 |
| `embedding_provider` | 使用的 embedding provider |
| `embedding_model` | 使用的 embedding model |

### 页级 / 文本预览（必须）

必须支持：
- 查看某页提取出的原始文本
- 查看清洗后的文本（如已做清洗处理）
- 查看该页或该范围关联的 chunks
- 查看每个 chunk 的 `page_from`、`page_to`、`section_title`

### 检索测试预览（必须）

提供基础测试检索能力，用于验证 ingest 结果可用性：
- 输入关键词或查询语句，返回命中的：
  - chunk 文本
  - 文档名
  - 页码
  - section_title
  - relevance_score
- 检索测试结果不写入 usage 记录（仅用于调试）

### 质量告警（必须）

至少支持识别并展示以下异常：

| 告警类型 | 触发条件 |
|---------|---------|
| `scanned_fallback` | 疑似扫描版，文本提取质量低 |
| `partial` | 部分页面提取失败 |
| `has_table` | 检测到表格，chunk 切分可能有误 |
| `has_multi_column` | 检测到双栏布局，段落合并可能有误 |
| `page_range_anomaly` | page_from / page_to 异常（缺失、负值、乱序） |
| `empty_page` | 疑似空文本页或抽取失败页 |

---

## 知识库三层层次

```
层 1：RuleSet 层
  - 只定义框架和 schema，不含版权内容
  - 不内置任何规则书文本

层 2：Library 层（按用途分库）
  - core_rules       基础规则
  - expansion        扩展规则
  - module_reference 参考模组
  - monster_manual   怪物手册
  - lore             世界观资料
  - house_rules      房规补充

层 3：Document 层
  - 具体 PDF 文件
  - 一个 Library 可包含多个 Document
```

---

## 错误处理规范

| 情况 | 处理方式 |
|------|---------|
| PDF 完全无法提取文本 | 标记 parse_status = "failed"，记录原因，不阻断其他文件 |
| 部分页面无法提取 | 标记 parse_status = "partial"，记录页码范围 |
| embedding 调用失败 | 保留 chunk 文本，标记 embedding_ref = null，可后续重建 |
| 向量索引写入失败 | 回滚并记录日志，chunk.jsonl 保留原始文本 |

---

## 禁止事项

- 禁止修改 `source/` 目录下的原始 PDF
- 禁止 chunk 缺少 `page_from` / `page_to`（扫描版降级为 -1 并标注，但不可省略字段）
- 禁止做全 workspace 无差别向量检索（必须按 library 和优先级过滤）
- 禁止在 citation 展示中省略来源文件名和页码
- 禁止第一版引入外部向量数据库服务（只用本地文件型向量库）
- 禁止第一版在主解析流程中引入 vision AI 或 LLM 参与文本提取
- 禁止将 rerank 设为默认必经检索步骤（必须通过配置开关显式启用）
- 禁止在 rerank 执行前跳过 library/type/priority 过滤（rerank 只能作用于已过滤后的候选集）
- 禁止第一版将图片进入向量索引主链路

---

## 检索调用边界

本 skill 的职责边界：**负责文档处理能力（解析、切块、向量化、索引、检索过滤、citation 结构），不负责决定何时检索、检索谁、如何注入 Agent。**

- Knowledge 检索由 Director 或 Workflow 层按任务类型统一驱动
- 检索不只用于规则问答，Plot / NPC / Monster / Lore 等创作型任务在执行前同样需要检索相关上下文
- 具体的"何时检索、检索哪些库、结果如何注入 Agent"，由 `agent-workflow-patterns` skill 统一约束

---

## 后续扩展方向（不属于当前版本主链路）

以下能力已规划但不进入当前版本实现，不得在当前版本代码中预先引入：

| 扩展能力 | 说明 |
|---------|------|
| 扫描版 vision AI fallback | 使用 vision model 对扫描版 PDF 进行 OCR 兜底解析 |
| 图片提取与资源归档 | 从 PDF 中提取图片、保存文件、记录 page/image_index |
| 图片分类 | 怪物图、地图、装饰图、表格截图等类型标签 |
| 表格 / 流程图增强解析 | 使用 AI 对复杂版式页面进行结构重建 |
| 结构化条目抽取 | 基于 AI 从规则书中抽取怪物/NPC/法术/地点候选条目 |
| 图片作为创作参考源 | 地图/怪物插图作为 image brief / 概念生成的后续参考输入 |

**rerank 已纳入当前版本实现范围（M8 A2），但默认不启用，不属于默认检索主链路。** 需通过 WorkspaceRAGConfig 配置开关显式开启，且只能作用于已按 library/type/priority 过滤后的候选集。
