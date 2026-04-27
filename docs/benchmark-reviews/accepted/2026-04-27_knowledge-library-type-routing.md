---
status: accepted
date: 2026-04-27
source: OpenPawz
theme: 知识库导入能力增强：chunk 级类型标签、CHM 支持、PDF 目录感知分割、chunker 质量改善
priority: medium
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# 知识库导入能力增强

涵盖四个相互关联的改进方向：
1. chunk 级类型标签（替代废弃的 library.type）
2. CHM 格式支持
3. PDF 目录感知分割（TOC-aware ingestion）
4. Chunker 质量改善

---

## 背景与根本问题

trpg-workbench 的知识库导入流程存在两个假设，与现实 TRPG 规则书不符：

1. **"一个文件 = 一种类型的知识"**：规则书往往前半是核心规则、后半是怪物手册
2. **"PDF 是唯一格式"**：大量中文 TRPG 规则书以 CHM 格式发行

同时，现有 chunker 的切块策略存在几个已知问题，直接影响检索质量。

---

## 架构决策：删除 library.type，转向 chunk 级 type tag

### 为什么删除 library.type（而非废弃）

项目处于 0.1a 之前，直接删除，不保留技术债：
- `KnowledgeLibrary.type` 字段从未被读取（`pdf_ingest.py:166` 写入 `"library_type": None`）
- library 级单一 type 无法表达"一本书包含多种内容类型"的现实
- 把一本书拆成多个 Library 会造成左栏条目膨胀，管理复杂度高

**需要删除的位置：**
- `packages/shared-schema/src/index.ts` — `KnowledgeLibrary` 的 `type` 字段和相关枚举
- `apps/desktop/src/pages/RuleSetPage.tsx` — 创建库时的类型下拉菜单
- `apps/backend/app/knowledge/pdf_ingest.py:166` — `"library_type": None`
- 对应的后端 schema 和 DB 字段

### 替代方案：chunk 级 chunk_type

```
Library: "D&D 5e 规则书"  ← 不再有 type 字段
  ├── chunk_001 { chunk_type: "core_rules",     section: "基础规则", page: 10 }
  ├── chunk_120 { chunk_type: "monster_manual", section: "怪物手册", page: 120 }
  └── chunk_280 { chunk_type: "lore",           section: "世界传说", page: 280 }
```

### chunk_type 的来源

| 情况 | chunk_type 的确定方式 |
|------|----------------------|
| PDF 有目录，LLM 置信度高 | TOC 分析 → LLM 建议类型 → 用户确认 |
| PDF 无目录 / 置信度低 | 用户在导入时指定整份文档的默认类型，所有 chunk 继承 |
| CHM 文件 | 解析 HHC 目录 → 按章节自动打标，用户可调整 |
| 用户强制整份文档为单一类型 | 覆盖 TOC 分析结果 |

---

## 问题一：chunk 级类型路由基础设施

### 类型枚举单一真实来源

在后端定义 Python 枚举作为权威来源，前端 TypeScript 枚举与之保持一致（CI 可验证）：

```python
# apps/backend/app/knowledge/types.py（新建）
from enum import Enum

class ChunkType(str, Enum):
    CORE_RULES       = "core_rules"
    EXPANSION        = "expansion"
    HOUSE_RULES      = "house_rules"
    MONSTER_MANUAL   = "monster_manual"
    LORE             = "lore"
    MODULE_REFERENCE = "module_reference"
```

- `search_knowledge` 工具的参数 `description` 中列出所有合法值（LLM 会看到）
- 工具层对传入的 `chunk_types` 参数做枚举校验，非法值返回明确错误，**不静默忽略**
- TOC 分析的 LLM prompt 中也给出同一枚举列表，避免 LLM 自由发挥字符串

### 检索层改动

```python
# retriever.py
def retrieve_knowledge(query, library_ids, type_filter: list[str] | None = None, ...):
    # chunk_type=None 的 chunk 始终包含（保守包含，防止漏数据）
    # 实际 filter：chunk_type IN type_filter OR chunk_type IS NULL
```

**`chunk_type=None` 保守包含策略**：宁可精度略降，不能因类型缺失而静默丢失内容。

### Agent 工具改动

- `search_knowledge` 增加可选 `chunk_types: list[ChunkType]` 参数，透传给 `retrieve_knowledge`
- `consult_rules` 内部默认传入 `chunk_types=["core_rules","expansion","house_rules"]`
- 当指定 `chunk_types` 但结果为空时，**自动降级为全库检索**并在 tool result 中附带 warning：
  ```json
  { "results": [...], "warning": "指定类型无匹配，已降级为全库检索" }
  ```
  该 warning 在 Agent 面板的 tool call 结果中可见，用户可以感知到类型过滤未生效
- Director 的 `workspace_context` 注入 workspace 内所有已有的 `chunk_type` 种类列表

### 落地步骤

- **Step 1A**：新建 `knowledge/types.py`，定义 `ChunkType` 枚举
- **Step 1B**：删除 `library.type` 相关字段和 UI（schema + frontend + ingest）
- **Step 1C**：`run_ingest()` 增加 `default_chunk_type: str` 参数，写入 chunk metadata
- **Step 1D**：`retrieve_knowledge()` 增加 `type_filter` + 保守包含逻辑
- **Step 1E**：`search_knowledge` / `consult_rules` 工具改动 + 0 结果降级保护

---

## 问题二：CHM 格式支持

### 现实背景

大量中文 TRPG 规则书以 CHM 格式发行。CHM 自带 HHC 目录文件（机器可读 XML），天然适配 chunk 级类型打标，且**不需要 LLM 解析结构**。

### CHM 结构

```
rulebook.chm
├── toc.hhc          ← 树形目录（标准 XML），直接解析得到章节树
├── rules/ch1.html   ← 核心规则
├── monsters/        ← 怪物手册
└── lore/            ← 世界观
```

### 落地步骤

- **Step 2A**：新建 `chm_ingest.py`，用 `pychmlib` 或 `subprocess 7z` 解压，解析 HHC
- **Step 2B**：HHC 章节树 → 与 PDF TOC 对齐的 `section_type_map` 结构（两种格式共用同一确认 UI）
- **Step 2C**：HTML → BeautifulSoup 清洗正文，保留标题层级 → 现有 chunk → embed 流程
- **Step 2D**：前端文件类型限制增加 `.chm`，后端按扩展名路由到 `chm_ingest`

---

## 问题三：PDF 目录感知分割

### 设计原则

> 用户知道（或不知道）目录在哪里，AI 负责解析结构，两者共同确认每个章节的类型标签。结果是单一 Library，chunk 携带分段的 `chunk_type`，不拆成多个 Library。

### 交互流程

#### 阶段 A：目录探测

```
上传 PDF
  → [自动] 提取前 20 页文本 → 发给 LLM
  → LLM 返回：
    {
      "has_toc": true,
      "toc_page_range": [3, 7],
      "sections": [
        { "title": "基础规则", "page_start": 10, "page_end": 119, "suggested_type": "core_rules" },
        { "title": "怪物手册", "page_start": 120, "page_end": 279, "suggested_type": "monster_manual" },
        { "title": "世界传说", "page_start": 280, "page_end": 310, "suggested_type": "lore" }
      ],
      "confidence": "high",
      "note": "目录页码使用罗马数字，实际页码有 +8 偏移"
    }
  → high confidence  → 展示确认 UI
  → low confidence   → 提示用户手动指定，或不分段
  → has_toc=false    → 跳过分割，用户仅需选择整份文档默认类型
```

**LLM Prompt 设计要点：**
- 输入：PDF 前 20 页纯文本（已过 `_clean_pages` 处理）
- 严格 JSON 输出，schema 固定
- `suggested_type` 必须从 `ChunkType` 枚举中选择（prompt 中列出合法值）
- 提示 LLM 注意 Roman 数字页码和页码偏移问题
- 低置信度触发条件：文本质量差、扫描版、前 20 页无明显目录结构

#### 阶段 B：确认 UI

```
┌──────────────────────────────────────────────────────────┐
│  已检测到目录（第 3-7 页）                                │
│  AI 为以下章节建议了类型，请确认：                        │
│                                                          │
│  [✓] 基础规则    p.10–119   → core_rules    ▼           │
│  [✓] 怪物手册    p.120–279  → monster_manual▼           │
│  [✓] 世界传说    p.280–310  → lore          ▼           │
│                                                          │
│  [编辑页码]  [合并段落]  [添加段落]                       │
│                                                          │
│  ◉ 按以上方案打标，导入为单一知识库                      │
│  ○ 不分段，整份文档使用类型：core_rules ▼                │
│                                                          │
│                    [取消]  [确认并导入]                   │
└──────────────────────────────────────────────────────────┘
```

#### 阶段 C：分段 ingest 执行

```python
# pdf_ingest.py 新增参数
async def run_ingest(
    *,
    default_chunk_type: str,
    section_type_map: list[dict] | None = None,
    # [{ "page_start": 10, "page_end": 119, "chunk_type": "core_rules" }, ...]
    # 每个 chunk 根据 page_from 查 section_type_map 确定 chunk_type
    # 落在边界外的 chunk 使用 default_chunk_type
    ...
)
```

#### 阶段 D：降级路径

| 情况 | 降级行为 |
|------|---------|
| LLM 未检测到目录 | 用户选择整份文档默认类型 |
| LLM 请求超时 | 跳过分析，降级为不分段，UI 提示 |
| 用户选择"不分段" | 整份文档使用用户指定的单一类型 |
| 页码范围重叠/空白 | 前端校验，提示修正 |

### 导入后的类型覆盖率提示（扩展现有预览功能）

ingest 完成后在现有"导入预览"面板中展示：

```
导入完成 — 412 个 chunk

  core_rules      238 个  [展开预览]
  monster_manual   92 个  [展开预览]
  lore             70 个  [展开预览]
  （无类型）        12 个  ⚠ 建议重新导入并指定默认类型
```

- 每类可展开查看 chunk 摘要（标题 + 页码范围）
- 无类型 chunk > 20% 时显示警告和建议操作

---

## 问题四：Chunker 质量改善

### 当前 chunker 参数

- 目标最小：600 字符 / 目标最大：1600 字符 / 重叠：200 字符
- 位于 `apps/backend/app/knowledge/chunker.py`

### Chunk 大小评估

**当前 1600 字符上限对规则书是合适的，不应缩小。**

规则书的核心内容单元（一条规则 + 说明 + 示例）通常需要 800–1500 token 才能保持语义完整。1600 中文字符 ≈ 1000 token，1600 英文字符 ≈ 400 token。把上限降到 512 token 会把规则条文和其配套示例切开，检索到规则说明时缺失示例，检索到示例时又找不到对应条文——对 TRPG 场景是严重的语义破坏。

**真正的问题不是 chunk 太大，而是切割边界不够语义化。** 当前可能把"战斗规则"和"魔法系统"混在同一个 chunk 里，核心修复是改善 A（标题强制分割）。

针对中英文 chunk 大小不一致的问题：英文规则书（如 D&D PHB）1600 字符只有约 400 token，可考虑对英文文档提高上限，但这是后续优化，不是紧急项。

### 已知问题

| 问题 | 影响 |
|------|------|
| 标题检测到后不强制分割，只更新 `current_section` | 两个章节的内容可能混在同一个 chunk 里 |
| `_HEADING_RE` 太宽松，误判页码、注释为标题 | `section_title` 字段不可靠 |
| 中文 PDF 换行混乱，段落切分依赖 `\n{2,}` | 大量单行 segment，切块粒度随机 |
| 中英文字符数到 token 数的映射差异大 | 英文文档 chunk 偏小，中文文档 chunk 偏大 |

### 建议改动

**改善 A：标题处强制分割**（高优先级，检索质量直接受益）

```python
if is_heading and current_chars >= target_min:
    rc = flush(current_parts)
    if rc: chunks.append(rc)
    current_parts = []
    current_chars = 0
current_section = para.lstrip("# ").strip()
```

**改善 B：收紧标题正则**（低成本）

当前：`^(#{1,3}\s+.+|[A-Z\u4e00-\u9fff][^\n]{0,60})$`

建议增加条件：
- 长度 < 50 字符（不是 120）
- 以 `#` 开头，或以数字+点/顿号开头（`1. / 第一章 / Chapter 1`），或全大写
- 排除纯数字行（页码）

**改善 C：中英文差异化字符上限**（低优先级，后续优化）

不引入 tiktoken 依赖，采用粗估：检测文档语言，中文文档保持 1600 字符上限，英文文档提高到 4000 字符（约 1000 token），使两者的 token 粒度对齐。

**改善 D：TOC 驱动的章节边界强制切割**（与问题三结合）

当 `section_type_map` 可用时，章节边界（`page_start`）作为强制切割点传入 chunker，确保章节内容不跨 chunk 混合。

---

## 问题五：召回策略改善（top_k 硬编码 + Rerank 未接入）

### 当前状态

top_k 在知识库相关的 3 处工具中硬编码（`search_assets_semantic` 是资产向量检索，性质不同，不在本次范围内）：

| 工具 | 文件 | 当前 top_k | 性质 |
|------|------|-----------|------|
| `search_knowledge` | `tools.py:294` | 5 | 知识库检索，面向用户可见 |
| `consult_rules` | `tools.py:656` | 6 | 知识库检索，面向用户可见 |
| `create_skill` | `tools.py:691` | 4 | 知识库检索，**工具内部隐式调用** |

Rerank 已实现但未接入 Agent：`rerank_adapter.py` 完整，`knowledge_preview.py:321` 有完整的"大 top_k 召回 → rerank → 取 top_n"逻辑，只在知识库预览接口中使用。`workspace config.yaml` 已有 `rerank.enabled/top_k/top_n` 字段。

### create_skill 内置知识库检索的合理性分析

`create_skill` 在工具内部用 `user_intent`（如"COC 探索者人格创建框架"）查知识库，将结果传给 `skill_agent`。

**合理之处：** 创建技能模板时，如果知识库里有对应规则书，检索到相关规则内容（如 COC 人格创建的具体机制和属性字段）能帮助 skill_agent 生成更符合规则的模板框架，而不是凭空设计。

**存疑之处：**
- Skill 是"怎么做"的程序性模板，知识库里的规则内容是"是什么"的描述，两者匹配程度有限
- 检索在工具内部静默发生，用户和 Agent 面板都看不到——与 `search_knowledge` / `consult_rules` 的可见性不一致
- top_k=4 非常保守，如果检索结果不相关（规则书里没有对应内容），这 4 个 chunk 反而可能干扰 skill_agent 的输出

**建议：** 短期内统一纳入 config 管理（与另外两个工具使用同一 `retrieval.knowledge_top_k`），长期可以考虑把这个隐式检索改为显式（在 Agent 面板可见），或者在知识库为空时直接跳过，避免无关内容注入。

### 问题

- top_k 硬编码，引入 chunk 级类型过滤后风险更高：过滤后候选集缩小，原有数量可能不够
- 不经过 rerank 时 cosine 排名不稳定，同一术语多处出现时召回质量随机
- `create_skill` 的隐式检索对用户不透明

### 建议改动

**Step 5A：top_k 从 workspace config 读取，设置页面可调整**

`workspace config.yaml` 结构：
```yaml
retrieval:
  knowledge_top_k: 5    # rerank 关闭时使用

rerank:
  enabled: false
  top_k: 20
  top_n: 5
```

设置页面 UI 设计：

```
┌─────────────────────────────────────────────────┐
│  知识库检索                                      │
│                                                 │
│  召回数量        [  5  ]                         │
│  每次检索注入 AI 的知识片段数，建议 5–8。          │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  [ ] 启用 Rerank                        │   │
│  │  开启后使用独立模型对候选结果重新排序，      │   │
│  │  可提升检索相关性，需配置 Rerank 服务。     │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘

── 开启 Rerank 后展开 ──────────────────────────────

┌─────────────────────────────────────────────────┐
│  知识库检索                                      │
│                                                 │
│  召回数量        [  5  ]                         │
│  Rerank 后注入 AI 的片段数。                      │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  [✓] 启用 Rerank                        │   │
│  │                                         │   │
│  │  候选召回数量    [ 20  ]                  │   │
│  │  ⚠ 建议设置为"召回数量"的 3–4 倍，        │   │
│  │    过小会降低 Rerank 的筛选效果。          │   │
│  │                                         │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**交互要点：**
- Rerank 关闭时只显示"召回数量"一个参数，含义是直接注入 AI 的数量，默认 5
- Rerank 开启后"候选召回数量"展开，默认 20，并显示建议提示（建议为召回数量的 3–4 倍）
- "召回数量"在两种状态下标签不变，但 rerank 关闭时说明文字为"直接注入 AI"，开启后改为"Rerank 后注入 AI"
- 用户可自由修改两个数值，不做强制校验，仅在候选数 < 召回数时显示警告

**Step 5B：Agent tools 接入 rerank**

在 `retrieve_knowledge()` 调用处读取配置，两条路径明确分离：

```python
# retriever.py
if rerank_config.enabled:
    # rerank 开启：大 top_k 召回 → reranker 过滤 → 只有 top_n 注入 LLM
    results = vector_search(query, top_k=rerank_config.top_k)
    results = rerank_adapter.rerank(query, results, top_n=rerank_config.top_n)
else:
    # rerank 关闭：直接召回小 top_k，全部注入 LLM
    results = vector_search(query, top_k=retrieval_config.knowledge_top_k)
```

改动集中在 `retrieve_knowledge()`，三个工具（`search_knowledge`、`consult_rules`、`create_skill` 内部）均无需修改工具层代码。

**与 chunk 级类型过滤的配合：**
`type_filter 缩小候选库 → top_k 召回 → （若开启）rerank → 结果注入 LLM`，两者不冲突。

---

## 依赖关系与优先级

```
Step 1A（ChunkType 枚举）
  └── Step 1B（删除 library.type）
  └── Step 1C（ingest 写入 chunk_type）
       └── Step 1D（检索层 type_filter）
            └── Step 1E（Agent 工具 + 0 结果保护）

Step 2（CHM）→ 独立，与上并行

Step 3（PDF TOC 分割）→ 依赖 1C

Chunker 改善 A+B → 独立，可最早做
Chunker 改善 C+D → C 独立低优先级，D 依赖 Step 3

Step 5A（top_k from config）→ 独立
Step 5B（Rerank 接入）→ 依赖 5A，与 1D 配合效果最佳
```

| 步骤 | 优先级 | 理由 |
|------|--------|------|
| 1A+1B（枚举 + 删除 library.type） | **高** | 清理技术债，是后续基础 |
| Chunker A+B（标题分割 + 正则收紧） | **高** | 独立、低风险、检索质量立竿见影 |
| 1C+1D+1E（ingest 写 type + 检索路由 + 工具） | **高** | 核心功能链路 |
| 5A+5B（top_k from config + Rerank 接入） | **高** | 架构已支持，改动集中，召回质量直接受益 |
| Step 2（CHM 支持） | **中** | 中文 TRPG 用户硬需求 |
| Chunker C（中英文差异化上限） | **低** | 后续优化，不急 |
| Step 3（PDF TOC 分割 + 确认 UI） | **低（复杂度高）** | 交互复杂，建议独立 milestone |
| Chunker D（TOC 驱动边界） | **低** | 依赖 Step 3 |

---

## 对创作控制感的影响

**直接提升：**
- 用户确认每个章节的类型后，Agent 检索行为对用户完全透明（面板可见 `chunk_types` 参数）
- 导入预览展示类型分布，用户对知识库内容有清晰的掌控感
- 0 结果降级 warning 让用户知道类型过滤未生效，而不是 AI "凭空"生成

## 对 workbench 协同的影响

**改善左栏知识库管理 ↔ 右栏 Agent 检索的协同：**
- 删除无意义的 library.type 标签，左栏显示更干净
- chunk 级类型信息使右栏 Agent 的检索行为与知识库内容真正对应

## 建议落地方式

- [x] plan：
  - **阶段一（M12 或独立 milestone）：** 1A+1B+1C+1D+1E + Chunker A+B + 5A+5B（Rerank 接入）+ CHM 支持
  - **阶段二（独立 milestone）：** PDF TOC 分割确认 UI + Chunker C+D
- [ ] 直接改代码：Chunker A+B 最简单，可最先合并
