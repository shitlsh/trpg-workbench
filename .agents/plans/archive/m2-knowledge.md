# M2：知识库 MVP

**前置条件**：M1 完成（后端骨架、SQLite、Workspace CRUD 可用）。

**目标**：PDF 导入 → 解析 → 切块 → 向量化 → 索引 → 检索 → 引用显示，全链路打通。

**状态：✅ 已完成（commit 27bc244）**

---

## Todo

### 数据库

- [x] 建表：`knowledge_libraries`（id、rule_set_id、name、type、description、embedding_config、created_at、updated_at）
- [x] 建表：`knowledge_documents`（id、library_id、filename、original_path、mime_type、parse_status、page_count、chunk_count、metadata_json、created_at、updated_at）
- [x] 建表：`workspace_library_bindings`（id、workspace_id、library_id、priority、enabled、scope_rules_json）
- [x] 建表：`ingest_tasks`（id、document_id、status、current_step、total_steps、step_label、error_message、created_at、updated_at）
- [x] KnowledgeChunk 不存 SQLite，直接落 chunks.jsonl + lancedb（避免 SQLite 存海量行）

### 后端 PDF 处理（`app/knowledge/`）

- [x] `pdf_ingest.py`：主流程编排，8 步顺序执行
  - 步骤 1：保存原始文件到 `knowledge/libraries/<lib-id>/source/`
  - 步骤 2：pdfplumber 提取文本，记录每页文本和页码映射
  - 步骤 3：基础清洗（去重复页眉页脚、合并强制换行段落）
  - 步骤 4：chunking（按标题/段落切块，600-1600 字符，200 字符 overlap）
  - 步骤 5：记录 page_from/page_to/section_title（扫描版降级为 -1）
  - 步骤 6：embedding 生成（读取 EmbedderConfig，支持 OpenAI / 本地 sentence-transformers）
  - 步骤 7：lancedb 向量索引建立，写入 `index/`
  - 步骤 8：写 manifest.json 和 chunks.jsonl
- [x] `chunker.py`：切块逻辑，标题检测 + 段落滑动窗口
- [x] `embedder.py`：embedding 调用，支持 OpenAI / sentence-transformers（可选）
- [x] `vector_index.py`：lancedb 封装（upsert_chunks、search_library、delete_document_chunks）
- [x] `retriever.py`：检索逻辑，按 library 优先级过滤，返回 Citation 列表
- [x] `citations.py`：Citation dataclass（document_filename、page_from/to、section_title、relevance_score）
- [x] 每步执行前后通过 progress_callback 更新 ingest_tasks

### 后端 API（`app/api/`）

- [x] `POST /knowledge/libraries`：新建 Library
- [x] `GET /knowledge/libraries`：列出（可按 rule_set_id 过滤）
- [x] `GET /knowledge/libraries/:id`：查询单个
- [x] `DELETE /knowledge/libraries/:id`：删除
- [x] `POST /knowledge/libraries/:id/documents`：上传 PDF，触发异步 ingest（asyncio.create_task）
- [x] `GET /knowledge/libraries/:id/documents`：列出文档（含 parse_status）
- [x] `GET /tasks/:id/status`：查询任务状态（polling 用）
- [x] `POST /knowledge/search`：检索 API，body 含 query、library_ids、top_k
- [x] `POST /workspaces/:id/library-bindings`：绑定 Library 到 Workspace
- [x] `GET /workspaces/:id/library-bindings`：列出 Workspace 绑定
- [x] `DELETE /workspaces/:id/library-bindings/:binding_id`：解除绑定
- [x] `POST /knowledge/libraries/:id/reindex`：占位（后续实现完整 reindex）

### 前端

- [x] 知识库管理页（路由：`/knowledge`）
  - Library 列表（名称/类型/文档数），点击展开详情
  - 新建 Library（填名称、选类型）
  - 首页 Header 新增「知识库」入口
- [x] PDF 上传组件（拖拽 + 点击选择，调用 multipart/form-data upload）
- [x] Ingest 进度条（polling `/tasks/:id/status`，每 2s 一次，显示步骤标签）
- [x] 文档列表（文件名、parse_status 彩色显示、页数、块数、创建日期）
- [x] CitationCard 可复用组件（文档名、页码、section_title、片段预览/展开、相关度%）
- [x] 检索测试面板（输入查询词 → 搜索 → 展示 CitationCard 列表）
- [x] `useTaskProgress` hook（轮询单个 task，完成/失败后停止 polling）

### shared-schema

- [x] 定义类型：`KnowledgeLibrary`、`KnowledgeDocument`、`LibraryType`、`ParseStatus`
- [x] 定义类型：`IngestTask`、`TaskStatus`、`WorkspaceLibraryBinding`
- [x] 定义类型：`SearchRequest`、`Citation`、`SearchResult`

---

## 验证步骤

1. 进入知识库管理页，新建一个 Library，类型选 `core_rules` ← **待人工验证**
2. 上传一个文本型 PDF
3. 观察进度条依次经过：保存→提取文本→清洗→切块→Embedding→建索引→生成 manifest
4. 完成后确认文档列表显示 `成功` 状态和正确的页数/块数
5. 确认以下文件存在：
   - `~/trpg-workbench-data/knowledge/libraries/<id>/source/<filename>.pdf`
   - `~/trpg-workbench-data/knowledge/libraries/<id>/parsed/manifest.json`
   - `~/trpg-workbench-data/knowledge/libraries/<id>/parsed/chunks.jsonl`
   - `~/trpg-workbench-data/knowledge/libraries/<id>/index/`（lancedb 文件）
6. 在检索测试面板输入 PDF 中的关键词
7. 确认返回结果包含相关文本片段、文件名、页码

---

## 关键约束提示

- `page_from` / `page_to` 是强制字段（扫描版降级为 -1，但字段存在）
- Embedding 读取 EmbedderConfig，不硬编码模型名
- 向量索引只用本地 lancedb，不引入外部向量服务
- 检索时必须按 library_ids 过滤，禁止全库无差别检索

---

## 实现备注

- KnowledgeChunk 不建 SQLite 表，直接用 chunks.jsonl + lancedb，避免海量行写 SQLite
- embedding 默认 OpenAI text-embedding-3-small（需配置 OPENAI_API_KEY），本地 sentence-transformers 可选
- lancedb 向量维度在 upsert 时动态读取，默认 1536（OpenAI），支持 pad/truncate
- 多 document 共享同一 library 的 lancedb index（按 document_id 过滤）
- PDF 上传使用 multipart/form-data（前端绕过 TanStack Query 直接 fetch，因为 Query 不支持 FormData 上传进度）
