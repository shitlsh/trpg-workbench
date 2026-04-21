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
- **文本型 PDF 优先**：使用文本提取工具直接提取
- **扫描版 PDF**：第一版只做弱支持，明确标注解析质量风险，不承诺高精度引用
- **双栏/表格 PDF**：解析质量可能下降，记录告警但不阻断流程

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
  └── 调用当前系统配置的 embedding provider/model
  └── 若未配置 embedding provider，回退到默认预设（如 OpenAI text-embedding-3-small）
  └── 支持本地 embedding 模型（如 sentence-transformers）
  └── embedding 结果引用存入 chunk 的 embedding_ref 字段
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
  "embedding_provider": "openai | sentence-transformers | custom",
  "embedding_model": "text-embedding-3-small",
  "indexed_at": "2025-01-01T00:00:00Z",
  "library_type": "core_rules",
  "tags": ["基础规则", "COC", "第七版"]
}
```

---

## 检索策略（禁止做全库无差别检索）

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
  "relevance_score": 0.87
}
```

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

---

## 检索调用边界

本 skill 的职责边界：**负责文档处理能力（解析、切块、向量化、索引、检索过滤、citation 结构），不负责决定何时检索、检索谁、如何注入 Agent。**

- Knowledge 检索由 Director 或 Workflow 层按任务类型统一驱动
- 检索不只用于规则问答，Plot / NPC / Monster / Lore 等创作型任务在执行前同样需要检索相关上下文
- 具体的"何时检索、检索哪些库、结果如何注入 Agent"，由 `agent-workflow-patterns` skill 统一约束
