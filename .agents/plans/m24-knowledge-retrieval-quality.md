# M24：知识库检索质量提升

**前置条件**：M23 完成（Agent 澄清问题机制可用，Agent 工具链稳定）。

**目标**：将 `library.type` 从无效装饰字段替换为 chunk 级类型标签，修复 chunker 切割边界，将 top_k 和 rerank 配置化，使知识库检索质量和 Agent 检索行为对用户真正透明。

---

## 背景与动机

来源：`docs/benchmark-reviews/accepted/2026-04-27_knowledge-library-type-routing.md`

当前知识库存在三个相互关联的缺陷：
1. `library.type` 字段定义了 6 种类型但从未被读取（`pdf_ingest.py:166` 写入 `None`），是已承诺但未兑现的能力
2. Chunker 不在标题边界强制分割，导致两个章节内容混入同一 chunk，检索精度下降
3. `top_k` 在 3 处工具中硬编码，rerank 已实现但未接入 Agent

---

## 范围声明

### A 类：当前实现

**A1：删除 library.type，引入 chunk 级 ChunkType**

删除 `KnowledgeLibrary.type` 字段（0.1a 之前，直接删除不保留），替换为 chunk metadata 中的 `chunk_type` 字段。类型枚举在后端定义为单一真实来源，前端 TypeScript 与之保持一致。

**A2：Chunker 质量改善**

- A2.1：标题处强制切割（检测到标题且当前 chunk 已超过最小字符时立即 flush）
- A2.2：收紧标题正则（长度 < 50 字符，以 `#`/数字+点/第N章/`Chapter` 开头，排除纯数字行）

**A3：ingest 写入 chunk_type**

`run_ingest()` 增加 `default_chunk_type: str` 参数，所有 chunk 写入 `chunk_type` metadata（替换现有的 `library_type: None`）。上传 endpoint 从创建库时的用户选择传入该值。

**A4：检索层 type_filter**

`retrieve_knowledge()` 增加可选 `type_filter: list[str] | None`。`chunk_type=None` 的 chunk 始终包含在结果中（保守包含，防止漏数据）。

**A5：Agent 工具接入 chunk_types**

- `search_knowledge` 增加可选 `chunk_types` 参数
- `consult_rules` 内部默认传入 `chunk_types=["core_rules","expansion","house_rules"]`
- `create_skill` 内部调用 `retrieve_knowledge` 时同样走统一 config
- 当指定 `chunk_types` 但结果为空时，自动降级为全库检索并在 tool result 中附 warning

**A6：top_k 配置化 + rerank 接入**

- workspace config 增加 `retrieval.knowledge_top_k`（默认 5）和 `rerank` 区块
- `retrieve_knowledge()` 读取 config：rerank 关闭时直接取 `knowledge_top_k`，开启时取 `rerank.top_k` 候选再 rerank 到 `rerank.top_n`
- 前端设置页面：rerank 关闭时只显示"召回数量"，开启后展开显示候选数量（含提示"建议为召回数量的 3–4 倍"）

**A7：导入时选择 chunk_type（替代原 library.type UI）**

创建知识库时删除类型下拉菜单，改为在上传文档时显示"此文档的默认内容类型"选择器。

### B 类：后续扩展

- **B1：CHM 格式支持**：需新增 `pychmlib` 依赖和 `chm_ingest.py`，工作量独立，建议 M25
- **B2：PDF 目录感知分割（TOC + LLM + 确认 UI）**：交互复杂，建议独立 milestone
- **B3：Chunker 中英文差异化字符上限**：低优先级后续优化
- **B4：导入预览按 chunk_type 分组展示**：现有预览功能扩展，可独立 PR

### C 类：明确不承诺

- 资产向量检索（`search_assets_semantic`）的 top_k 配置化：资产数量有限，top_k=8 足够
- 单个 chunk 的 chunk_type 手动编辑：粒度过细，收益不明显

---

## 文件结构

### 新建文件

```
apps/backend/app/knowledge/types.py       ← ChunkType 枚举，单一真实来源
```

### 修改文件

```
packages/shared-schema/src/index.ts       ← 删除 LibraryType / KnowledgeLibrary.type / CreateKnowledgeLibraryRequest.type
                                            新增 ChunkType union（与 Python 枚举保持一致）
                                            WorkspaceConfig 增加 retrieval.knowledge_top_k
apps/backend/app/knowledge/chunker.py     ← 标题强制分割 + 收紧正则
apps/backend/app/knowledge/pdf_ingest.py  ← run_ingest() 增加 default_chunk_type，写入 chunk metadata
apps/backend/app/knowledge/retriever.py   ← retrieve_knowledge() 增加 type_filter + rerank 路径
apps/backend/app/agents/tools.py          ← search_knowledge/consult_rules/create_skill 接入 chunk_types + config top_k
apps/backend/app/routers/knowledge.py     ← 上传 endpoint 传入 default_chunk_type；删除 library type 相关
apps/desktop/src/pages/RuleSetPage.tsx    ← 删除创建库时的类型下拉；上传文档时增加 chunk_type 选择
apps/desktop/src/components/settings/     ← 检索配置 UI（召回数量 + rerank 开关 + 候选数量）
```

---

## 关键设计约束

### ChunkType 枚举一致性

```python
# apps/backend/app/knowledge/types.py
class ChunkType(str, Enum):
    CORE_RULES       = "core_rules"
    EXPANSION        = "expansion"
    HOUSE_RULES      = "house_rules"
    MONSTER_MANUAL   = "monster_manual"
    LORE             = "lore"
    MODULE_REFERENCE = "module_reference"
```

TypeScript 端 `ChunkType` union 必须与上述值完全对应，工具层对传入的 `chunk_types` 做枚举校验。

### 检索层逻辑

```python
# retriever.py retrieve_knowledge()
# 1. type_filter：chunk_type IN filter OR chunk_type IS NULL（保守包含）
# 2. rerank 分支：
if rerank_config.enabled:
    results = vector_search(top_k=rerank_config.top_k)
    results = rerank_adapter.rerank(results, top_n=rerank_config.top_n)
else:
    results = vector_search(top_k=retrieval_config.knowledge_top_k)
```

### 0 结果降级

```python
# tools.py search_knowledge
results = retrieve_knowledge(query, type_filter=chunk_types)
if not results and chunk_types:
    results = retrieve_knowledge(query)  # 全库降级
    # tool result 附 warning 字段
```

---

## Todo

### A1：删除 library.type，定义 ChunkType

- [ ] **A1.1**：`apps/backend/app/knowledge/types.py` — 新建，定义 `ChunkType` 枚举
- [ ] **A1.2**：`packages/shared-schema/src/index.ts` — 删除 `LibraryType`、`KnowledgeLibrary.type`、`CreateKnowledgeLibraryRequest.type`；新增 `ChunkType` union
- [ ] **A1.3**：后端 DB/model 层 — 删除 `library.type` 字段（migration 或重建）
- [ ] **A1.4**：`apps/backend/app/routers/knowledge.py` — 删除 library type 相关参数和逻辑

### A2：Chunker 质量改善

- [ ] **A2.1**：`apps/backend/app/knowledge/chunker.py` — 标题处强制 flush
- [ ] **A2.2**：`apps/backend/app/knowledge/chunker.py` — 收紧 `_HEADING_RE`

### A3：ingest 写入 chunk_type

- [ ] **A3.1**：`apps/backend/app/knowledge/pdf_ingest.py` — `run_ingest()` 增加 `default_chunk_type: str` 参数
- [ ] **A3.2**：`pdf_ingest.py` — chunk metadata 写入 `chunk_type: default_chunk_type`（替换 `library_type: None`）
- [ ] **A3.3**：上传 endpoint — 从请求中读取 `default_chunk_type` 并传入 `run_ingest()`

### A4：检索层 type_filter

- [ ] **A4.1**：`apps/backend/app/knowledge/retriever.py` — 增加 `type_filter` 参数
- [ ] **A4.2**：`retriever.py` — 实现保守包含逻辑（`chunk_type IS NULL` 也包含）

### A5：Agent 工具接入 chunk_types

- [ ] **A5.1**：`apps/backend/app/agents/tools.py` — `search_knowledge` 增加 `chunk_types` 参数 + 枚举校验
- [ ] **A5.2**：`tools.py` — `consult_rules` 默认传入 `chunk_types=["core_rules","expansion","house_rules"]`
- [ ] **A5.3**：`tools.py` — `create_skill` 内部调用走统一 config top_k
- [ ] **A5.4**：`tools.py` — 0 结果降级保护 + warning 字段

### A6：top_k 配置化 + rerank 接入

- [ ] **A6.1**：`packages/shared-schema/src/index.ts` — `WorkspaceConfig` 增加 `retrieval.knowledge_top_k`
- [ ] **A6.2**：`apps/backend/app/knowledge/retriever.py` — 读取 config，实现 rerank/非 rerank 双路径
- [ ] **A6.3**：前端设置页面 — 召回数量输入框 + rerank 开关 + 条件展开候选数量

### A7：导入时选择 chunk_type

- [ ] **A7.1**：`apps/desktop/src/pages/RuleSetPage.tsx` — 删除创建库类型下拉，上传文档时增加 `default_chunk_type` 选择

---

## 验收标准

1. 创建知识库时 UI 中不再显示类型下拉；上传文档时可选择该文档的内容类型
2. 导入 PDF 后，`chunks.jsonl` 中每个 chunk 的 `metadata.chunk_type` 有值（不为 None）
3. `search_knowledge` 工具传入 `chunk_types=["monster_manual"]` 时，返回结果均来自 monster_manual 类型 chunk（或无类型 chunk 作为 fallback）
4. `consult_rules` 不传 `chunk_types` 时默认只检索规则类 chunk
5. 传入不合法 `chunk_types` 值时工具返回明确错误，不静默
6. 0 结果时降级为全库检索，tool result 中有 warning 字段
7. workspace 设置页面可以修改"召回数量"；开启 rerank 后出现候选数量设置项
8. Chunker 在标题行处产生切割边界，同一 chunk 不混合两个不同章节标题下的内容

---

## 与其他里程碑的关系

```
M23（Agent 澄清问题）
  └── M24（知识库检索质量提升）← 当前
        ├── M25（CHM 格式支持）← B1 扩展
        └── M25/M26（PDF TOC 目录感知分割）← B2 扩展
```

---

## 非目标

- CHM 格式支持（B1，推迟到 M25）
- PDF 目录感知分割和确认 UI（B2，交互复杂，独立 milestone）
- 资产向量检索 top_k 配置化（C 类，资产数量有限不需要）
- 单个 chunk 的 chunk_type 手动编辑（C 类）
- 导入预览按 chunk_type 分组统计（B4，可独立 PR 追加）
