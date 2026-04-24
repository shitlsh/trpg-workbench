---
status: proposed
date: 2026-04-24
source: Internal (baseline goal reassessment)
theme: File-first 自包含 Workspace 架构
priority: high
affects_creative_control: yes
affects_workbench_collab: yes
recommended_action: plan
---

# File-first 自包含 Workspace 架构

## 问题

当前架构中 SQLite DB 是几乎所有数据的唯一 source of truth，workspace 目录只是一个不完整的只写镜像。全面审计发现：

| 数据 | 在 workspace 目录里？ | 应用会读回？ | 可独立使用？ |
|------|---------------------|------------|------------|
| 资产内容 (.md/.json) | 有镜像 | **否** | 否 |
| 对话历史 | **不在** | N/A | 否 |
| Workspace 配置（名称、模型绑定、rerank 设置） | **不在** | N/A | 否 |
| RuleSet 定义 | **不在** | N/A | 否 |
| PromptProfile | **不在** | N/A | 否 |
| 自定义资产类型 | **不在** | N/A | 否 |
| 知识库（PDF + 向量索引） | 在全局目录 | 是 | 否（绑定关系在 DB） |
| 生成的图片 | **在** | 是 | 部分（元数据丢失） |
| Skill 文件 | **在** | **是** | **是** |

**只有 Skill 文件（M17）是真正 file-first 的。** 其余数据都依赖 DB，workspace 目录不是自描述的，无法复制/分享/备份。

这导致：
- 用户在文件管理器中直接编辑 `.md` 文件不会反映到应用中
- "local-first" 的价值主张被削弱——数据被锁在 DB 中
- 复制 workspace 目录到另一台机器完全不可用
- DB 损坏时大量数据不可恢复

## 目标

让 workspace 目录成为**自包含的项目文件夹**：
- 复制整个目录到另一台机器即可使用
- 用户可以用任何编辑器打开和修改资产文件
- DB 降级为索引/缓存，可从文件系统完整重建
- 不再需要"导出"功能——目录本身就是成果

## 当前架构 vs 目标架构

```
当前:
  写入: Agent/用户编辑 → DB → 文件系统（副本）
  读取: 应用 → DB [文件系统从不被读取]

目标:
  写入: Agent/用户编辑 → 文件系统 → DB 索引更新
  外部编辑: 用户直接改文件 → 变更检测 → DB 索引更新 → 应用刷新
  读取: 应用 → 文件系统 [DB 仅用于列表/搜索/缓存]
```

---

## 设计要点

### 1. 目录结构

```
~/trpg-workbench-data/workspaces/{workspace-name}/
├── .trpg/                          ← 应用内部数据（对用户透明但不鼓励手动编辑）
│   ├── config.yaml                 ← workspace 配置（见下文）
│   ├── revisions/                  ← 资产版本快照
│   │   └── {slug}/v{N}.md
│   ├── chat/                       ← 对话历史
│   │   └── {session-id}.jsonl
│   └── cache.db                    ← 本地索引缓存（可删除重建）
├── outline.md
├── scenes/
│   ├── scene-01-opening.md
│   └── scene-02-investigation.md
├── npcs/
│   ├── zhao-detective.md
│   └── mysterious-stranger.md
├── monsters/
├── locations/
├── clues/
├── images/
└── skills/                         ← 已有，保持不变
```

**关键变化**：
- 目录名用 workspace 名称（可读）而非 UUID
- `.trpg/` 目录存放应用内部数据，与用户内容分离
- `.trpg/cache.db` 是可重建的 SQLite 索引，替代全局 `app.db` 中的 workspace 相关数据
- 文件名直接用 slug，不加类型前缀（已在子目录中区分）

### 2. 资产文件格式：Markdown + Frontmatter

将当前的双文件（`.md` + `.json`）合并为单个 Markdown 文件，使用 YAML frontmatter：

```markdown
---
type: npc
name: 赵探长
slug: zhao-detective
status: draft
version: 3
created_at: 2026-04-24T10:00:00Z
updated_at: 2026-04-24T15:30:00Z
tags: [调查员, 关键NPC]
---

# 赵探长

## 基本信息
...
```

**理由**：
- 单文件比双文件更易管理（git、文件管理器、外部编辑器）
- YAML frontmatter 是 Obsidian、Hugo、Jekyll 等工具的事实标准
- `python-frontmatter` 已在依赖中（M17 Skill 系统使用）

**JSON 结构化数据**：需要机器解析的结构化字段（如 NPC 属性值、怪物数据）保留在 frontmatter 嵌套字段中，或作为 Markdown 中的 code block。

### 3. Workspace 配置文件化：`.trpg/config.yaml`

当前 DB-only 的 workspace 配置改为文件：

```yaml
name: 暗影庄园
description: 一个克苏鲁风格的密室调查模组
created_at: 2026-04-24T10:00:00Z

# 规则集（引用名称，非 UUID）
rule_set: coc-7e

# 模型绑定（引用 profile 名称，非 UUID）
models:
  default_llm: gemini-2.5-flash
  rules_llm: claude-sonnet     # 可选，缺省用 default
  embedding: jina-v3
  rerank: jina-reranker         # 可选

# Rerank 配置
rerank:
  enabled: true
  top_n: 5
  top_k: 20

# 知识库绑定（引用 library 名称）
knowledge_libraries:
  - name: CoC 7E 核心规则
    scope: rules
    priority: 1
  - name: 补充怪物手册
    scope: reference
    priority: 2
```

**注意**：模型 profile、rule set、知识库用**名称引用**而非 UUID，使配置文件在不同机器间可移植。应用启动时按名称解析到本机的实际 ID。

### 4. 对话历史落盘

当前 `ChatSessionORM` / `ChatMessageORM` 完全在 DB 中，改为：

- 每个 chat session 存为 `.trpg/chat/{session-id}.jsonl`
- 每行一条消息，JSON 格式，包含 role、content、timestamp、citations、tool_calls
- 应用读取时从文件加载，DB 中只缓存索引

**价值**：对话历史是创作过程的记录，本身有价值。用户可以备份、搜索、甚至分享创作对话。

### 5. DB 降级为可重建的缓存

全局 `app.db` 中与 workspace 相关的表拆分：

| 当前位置 | 目标位置 |
|---------|---------|
| WorkspaceORM | `.trpg/config.yaml`（source of truth）+ `app.db` 中保留注册条目 |
| AssetORM + AssetRevisionORM | 资产文件 + `.trpg/revisions/`（source of truth）+ `.trpg/cache.db`（索引） |
| ChatSessionORM + ChatMessageORM | `.trpg/chat/*.jsonl`（source of truth）+ `.trpg/cache.db`（索引） |
| WorkspaceLibraryBindingORM | `.trpg/config.yaml` |
| ImageGenerationJobORM | `.trpg/cache.db`（元数据缓存，图片文件本身在 `images/`） |

保留在全局 `app.db` 中不变的：
| 数据 | 理由 |
|------|------|
| LLM/Embedding/Rerank Profiles | 全局配置，与具体 workspace 无关 |
| RuleSet + KnowledgeLibrary | 可被多个 workspace 共享 |
| PromptProfile | 绑定在 RuleSet 上，跨 workspace |
| UsageLog | 全局统计 |
| ModelCatalog | 全局缓存 |

### 6. RuleSet / 知识库 / PromptProfile 的处理

这三者绑定在 RuleSet 层面而非 Workspace 层面，且可被多个 workspace 共享。因此**不放入 workspace 目录**，保留在全局层面。

但需要增加**导入/导出机制**（后续 milestone），使 rule set 包可以打包分享：
```
coc-7e-ruleset/
├── ruleset.yaml            ← 名称、描述、genre
├── prompt-profiles/
│   └── default-style.yaml
├── custom-asset-types/
│   └── investigation.yaml
└── knowledge/
    ├── core-rules.pdf
    └── monster-manual.pdf
```

当前 milestone 不做此项，但 `config.yaml` 中用名称引用 rule set 为未来打好基础。

### 7. 版本历史

使用快照目录：`.trpg/revisions/{slug}/v{N}.md`，每次保存时复制当前文件为快照。

未来可选支持 git（每个 workspace 作为 git repo）。

### 8. 文件变更检测

- **应用启动时**：扫描 workspace 目录，对比 `.trpg/cache.db` 中的 file_hash，同步变更
- **运行时**：文件系统 watcher（Tauri `tauri-plugin-fs-watch` 或 Rust `notify` crate）
- **冲突处理**：last-write-wins + UI 提示

---

## 影响范围

### 后端（大改）

| 模块 | 改动 |
|------|------|
| `asset_service.py` | 读写逻辑从 DB 改为文件系统 |
| `revision_service.py` | 版本管理改为快照文件 |
| `orm.py` / AssetORM | 简化为索引，移除 content 字段（无历史数据，直接改 schema） |
| `orm.py` / AssetRevisionORM | 改为版本快照引用（直接重建，无需迁移） |
| `orm.py` / WorkspaceORM | 核心字段迁移到 config.yaml，ORM 简化为注册条目 |
| `orm.py` / ChatSessionORM, ChatMessageORM | 改为从 JSONL 文件读写 |
| Workflow 中的资产读取 | 从 DB 读改为文件读 |
| Workspace 导出 | 直接移除——目录本身就是成果 |
| `paths.py` | 新增 workspace 内部路径工具函数 |
| 新增 `sync_service.py` | 文件系统 ↔ DB 索引同步逻辑 |

### 前端（中改）

| 模块 | 改动 |
|------|------|
| 编辑器 | 保存逻辑改为写文件（通过 API） |
| 资产树 | 来源改为文件系统扫描结果 |
| 外部修改提示 | 新增：检测到文件变更时提示刷新 |
| Workspace 设置页 | 配置项来源从 DB 改为 config.yaml |
| 导出功能 | 移除或改为"在文件管理器中打开" |

### 开发 Skill 更新

以下 `.agents/skills/` 必须同步更新：

| Skill | 需要更新的内容 |
|-------|---------------|
| `trpg-workbench-architecture` | 数据层从 DB-first → file-first，全局 DB vs workspace 本地数据的边界 |
| `asset-schema-authoring` | 资产格式从 JSON+MD 双文件 → frontmatter Markdown 单文件 |
| `agent-workflow-patterns` | Workflow 中资产读写路径变化，上下文组装方式 |
| `frontend-ui-patterns` | 编辑器保存流程、资产树数据源、外部修改提示 UI |

### 数据迁移

不需要。0.1.0 尚未发布，没有用户历史数据需要迁移，直接重构即可。

---

## 风险

1. **工作量大**：这是对数据层的根本性重构，涉及几乎所有后端服务
2. **并发写入**：文件系统不如 DB 擅长处理并发（但桌面单用户场景下不是问题）
3. **性能**：文件系统扫描比 DB 查询慢（但 workspace 资产数量通常 < 100，可忽略）
4. **Frontmatter 解析**：需要定义清晰的 frontmatter schema，且 Agent 输出需要生成合规的 frontmatter
5. **config.yaml 中的名称引用**：模型 profile / rule set 用名称引用，如果用户在目标机器上没有同名配置，需要提示重新绑定

## 建议落地方式

- [x] plan：需要新 milestone，直接重构，无需考虑历史数据兼容
- [ ] 建议在打包发布（release proposal）之前完成，因为这决定了用户看到的核心数据模型
