---
name: knowledge-library-ingest
description: 约束 trpg-workbench 中知识库文档（PDF/CHM）的导入、TOC 与 ingest 预览、切块、向量化、索引与检索。实现或讨论 Knowledge Library、ingest、TOC、`knowledge_documents` 相关 API 时必须加载本 skill。
---

# Skill: knowledge-library-ingest

## 用途

本 skill 约束 `trpg-workbench` 中 **Knowledge Library** 的端到端处理：**支持 `.pdf` 与 `.chm` 两种来源**，共享「清洗 → 切块 → 向量 → manifest」主链路，在**目录（TOC）与页码语义**上与 **PDF 线 / CHM 线**分叉。实现或改 ingest、预览、检索、引用时须遵守本文，不得跳过与存储布局强相关的步骤。

> **曾用名**：本 skill 由 `pdf-knowledge-ingestion` 重命名而来；历史 plan 中的旧路径指同一职责。

---

## 支持格式与范围

| 格式 | 现状 | 主提取手段 |
|------|------|------------|
| **PDF** | 支持 | `pdfplumber` 按页抽文本（见 `pdf_ingest.py`） |
| **CHM** | 支持 | `pychm` + chmlib，枚举 `.htm/.html` 话题去 HTML 取纯文本（见 `chm_ingest.py`） |

- **不**在本 skill 主链路内支持：Word、纯 HTML 包、EPUB 等；若未来扩展，应**新增**独立 ingest 模块而非混用 PDF 管道。
- **文本型 PDF 优先**；扫描版只做弱支持（空页比例高时 `scanned_fallback`）。
- **CHM** 无真实「纸面页码」：ingest 用**话题顺序下标**作为与 chunk 对齐的**逻辑页**（1…N），与 PDF 的物理页是不同语义，但写入 chunk 的字段名仍为 `page_from` / `page_to` 以保持检索与 citation 结构一致。
- **图片**不进入当前主链路（不向量化图片、默认不做 OCR）。

---

## 主链路原则

默认 ingest **不以 vision/LLM 参与正文提取**；**LLM 仅用于**可选的 **TOC / 章节类型** 分析（见下节「目录（TOC）两轨」），与 8 步落盘管道分离（先预览确认映射，再带 `toc_mapping` 执行 ingest）。

以下顺序在两种格式上**结构一致**（实现上分别为 `run_ingest` in `pdf_ingest.py` / `chm_ingest.py`）：

```
保存原始文件 → 提取文本 → 基础清洗 → 切块 → 页码/区间写入 chunk → 生成 embedding → 本地向量索引 → manifest + chunks.jsonl
```

- **不得**默认依赖外部向量服务；**rerank** 为可选增强，见检索节。
- 库目录布局：`knowledge/libraries/<library_id>/source/`（原文）、`parsed/`（manifest、chunks.jsonl）、`index/`（向量索引，如 LanceDB）。

---

## 实现入口（代码地图）

| 环节 | PDF | CHM |
|------|-----|-----|
| 上传与任务 | `app/api/knowledge_documents.py`（`SUPPORTED_EXTS = {".pdf", ".chm"}`） | 同左 |
| Ingest 管道 | `app/knowledge/pdf_ingest.py` | `app/knowledge/chm_ingest.py` |
| 目录原始抽取 | `app/knowledge/toc_extractor.py`（PDF 目录页；CHM 的 `.hhc` / TopicsTree） | 同左 |
| LLM 目录/类型 | `app/knowledge/toc_analyzer.py` | 同左（函数不同，见下） |
| 切块 | `app/knowledge/chunker.py`（`chunk_pages`） | 同左 |
| 向量索引 | `app/knowledge/vector_index.py` | 同左 |
| 检索 | `app/knowledge/retriever.py` | 同左 |

---

## 目录（TOC）两轨

`app/api/knowledge_documents.py`：临时上传得 `file_id`；`ingest-confirmed` 时提交 `toc_mapping`。

| 顺序 | 端点 |
|------|------|
| 1 | `POST /knowledge/documents/upload-preview` |
| 2 | `POST /knowledge/documents/preview/{file_id}/detect-toc` |
| 3a | `POST /knowledge/documents/preview/{file_id}/analyze-toc`（PDF，SSE） |
| 3b | `POST /knowledge/documents/preview/{file_id}/classify-chm-sections`（CHM，SSE，须 `llm_model_name` 非空） |
| 4 | `POST /knowledge/libraries/{library_id}/documents/ingest-confirmed` |

**PDF**：`detect-toc` 用 `toc_extractor.detect_toc_pages_sync`（前 **20** 页启发式：点线+页、无点线「行末词+页码」、**夹心**抬中间薄弱页，单段至 **10** 页）或手选 `toc_page_start`/`end` 时 `extract_pages_text_sync` → 返回 `toc_text`、`page_start`/`end`（1-based）、`is_structural: false`、无 `sections`。`analyze-toc`：`fetch_pdf_toc_llm_raw` → `parse_pdf_toc_response`；`toc_text` 入模截断 `PDF_TOC_LLM_MAX_INPUT_CHARS`（**12000**）；`system.txt`、`user_pdf.txt`；`toc_analysis` 温度 **0.2**；单次 LLM 墙钟 `TOC_LLM_MAX_WAIT_SECONDS`（**900**）；`is_toc: false` → `TocNotRecognizedError`。

**CHM**：`detect-toc`：`extract_chm_toc_sync` → `chm_structure_to_sections`；`page_from` 为话题序 **1…N**；`is_structural: true`；`toc_text` 空。`classify-chm-sections`：每批 `user_chm_batch` + 行表；`CHM_CLASSIFY_MAX_DEPTH` 默认 **1**（最外大节，与 PDF 章级粗粒度一致；`body.max_classify_depth=2` 可标到 HHC 第二层）；深行 `_inherit_chm_chunk_types`；`CHM_CLASSIFY_BATCH` **120**；温度 **0.2**；每批/总墙钟见 `TOC_LLM_MAX_WAIT_SECONDS` 与 `knowledge_documents`。

---

## 标准处理流水线（8 步）

步骤标签与实现以 `pdf_ingest.STEP_LABELS` / `chm_ingest.STEP_LABELS` 为准；CHM 第 2 步为「提取 CHM 内容」。

1. **保存原始文件**到 `knowledge/libraries/<library-id>/source/`，不覆盖用户证据需求则不改名规则以代码为准。  
2. **提取文本**：PDF 为逐页；CHM 为枚举 HTML 话题并 strip 标签。  
3. **基础清洗**：PDF 与 CHM 共用或复用 `_clean_pages` 等（CHM 在 HTML 已剥除后仍过一遍去噪/合并断行逻辑）。  
4. **切块**：`chunk_pages`，标题感知 + 滑动窗口（见 `chunker.py`）。  
5. **页码与章节**：chunk 侧带 `page_from` / `page_to` / `section_title`；**PDF** 可配置 `page_offset` 与印刷目录对齐；**CHM** 为逻辑序号。  
6. **Embedding**：须绑定 `EmbeddingProfile`；失败策略以当前代码为准（例如零向量降级 + 记 notes）。  
7. **本地向量索引**（如 LanceDB），`knowledge/libraries/<library-id>/index/`。  
8. **manifest**（多文档可追加同一 `manifest.json` 列表）与 **chunks.jsonl** 逐行 JSON。

---

## KnowledgeChunk 与 manifest（落盘约定）

`chunks.jsonl` 中每条与 `pdf_ingest` / `chm_ingest` 写出结构一致，核心字段包括：

- `id`、`document_id`、`chunk_index`、`content`
- `embedding_ref`（与索引侧 id 对齐）
- `page_from` / `page_to`（PDF 为逻辑页；CHM 为话题序号；扫描版异常时按代码约定可为 `-1` 等）
- `section_title`
- `metadata`：含 `parse_quality`、`chunk_type`（由 TOC 映射 / 默认 `default_chunk_type` 等推导）等

**禁止**在 citation 中省略来源文档名与页码/区间（面向用户的「页」在 CHM 场景即逻辑序号说明）。

---

## 检索策略（禁止全库无差别检索）

- 默认：`retrieve` → `top_k`；可选 **rerank**（工作区配置显式开启），且 **仅**在已按 library / 绑定优先级过滤后的候选集上重排。  
- 必须支持按 **WorkspaceLibraryBinding.priority**、按 **chunk_type**（`type_filter`）等维度限制。  
- 返回 dict / `Citation` 需含 `document_name`、`page_from` / `page_to`、`section_title`、`vector_score`；若启用 rerank 则多 `rerank_score` 等。  
- 「何时检索、如何注入 Agent」由 **`agent-workflow-patterns`** 约束，本 skill 只保证 **chunk 与 citation 形状**一致。

---

## 知识库预览与质量

- 文档级：页数/话题数、chunk 数、parse 状态、embedding 模型等。  
- 文本级：按页或按话题查看提取正文与关联 chunk。  
- 检索自测：关键词命中 chunk + 来源信息。  
- 告警类型可含：`scanned_fallback`（PDF 空页过多）、`partial`、及页码异常等（与实现一致）。

---

## 三层层次（业务模型）

```
RuleSet
  └── KnowledgeLibrary（可绑定 embedding 快照等）
        └── KnowledgeDocument（单文件 .pdf 或 .chm；同一 Library 多 Document）
              └── Chunk（manifest + 向量索引 + jsonl）
```

库用途分类（`core_rules` / `lore` 等）在 **Library/绑定** 层表达；chunk 上可有 **`chunk_type`** 用于过滤，勿与 **library 用途** 混称。

---

## 错误处理与禁止事项

| 情况 | 处理 |
|------|------|
| PDF/CHM 无法解析正文 | `failed` / `partial`，记原因，不拖死整个库服务 |
| embedding/索引失败 | 记录 `parse_notes` / 日志；策略与现网代码一致 |

- 禁止修改 `source/` 下已归档原文用于「修正内容」(仅可复制入库)。  
- 禁止全 workspace 无向量边界检索。  
- 禁止主解析链用 LLM 替代 `pdfplumber`/`pychm` 做正文 OCR（扩展方向见下）。  
- CHM 依赖 **pychm + chmlib**；环境要求见 `chm_ingest.py` 与后端 `requirements` 说明。

---

## 后续扩展（非当前主链路）

| 方向 | 说明 |
|------|------|
| 扫描版 vision/OCR | 可选兜底，非默认 |
| 图片/表格结构化 | 增强解析，单独立项 |
| 更多格式（EPUB 等） | 新 ingest，不复用 PDF 文件名语义 |

**rerank**：已实现则默认关闭，配置开启；细节见 `WorkspaceRAGConfig` 与 `retriever.py`。
