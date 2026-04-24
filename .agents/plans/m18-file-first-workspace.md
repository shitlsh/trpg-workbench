# M18：File-first 自包含 Workspace

**前置条件**：M3 完成（资产系统 CRUD 可用）、M17 完成（Skill 已是 file-first 参考实现）。

**目标**：将 workspace 目录从 DB 的只写镜像重构为自包含的项目文件夹——文件系统是 source of truth，DB 降级为可重建的索引缓存。

---

## 背景与动机

基础目标达成度 review 发现：当前除 Skill 文件外，几乎所有数据都锁在 SQLite DB 中，workspace 目录不是自描述的、不可移植。这与 local-first 创作工具的核心预期矛盾。

- 来源：`docs/benchmark-reviews/accepted/2026-04-24_file-first-asset-storage.md`

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：资产文件格式统一为 Frontmatter Markdown**

将当前的双文件（`.md` + `.json`）合并为单个 Markdown 文件，使用 YAML frontmatter 存储结构化元数据。

```markdown
---
type: npc
name: 赵探长
slug: zhao-detective
status: draft
version: 3
created_at: 2026-04-24T10:00:00Z
updated_at: 2026-04-24T15:30:00Z
---

# 赵探长

## 基本信息
...
```

- `python-frontmatter` 已在依赖中（M17 Skill 使用）
- 结构化字段（NPC 属性、怪物数据）保留在 frontmatter 嵌套字段或 Markdown code block 中

**A2：资产读写改为 file-first**

- 写入路径：Agent/用户编辑 → 写文件 → 更新 DB 索引
- 读取路径：应用从文件系统读取资产内容（不再从 DB 读）
- DB 中 `AssetORM` 简化为索引（id, workspace_id, type, name, slug, status, summary, file_path, file_hash, updated_at）
- `AssetRevisionORM` 不再存储 `content_md` / `content_json`，改为指向 `.trpg/revisions/{slug}/v{N}.md` 快照文件

**A3：Workspace 配置文件化**

将当前 DB-only 的 workspace 配置写入 `.trpg/config.yaml`：

```yaml
name: 暗影庄园
description: 一个克苏鲁风格的密室调查模组
created_at: 2026-04-24T10:00:00Z

rule_set: coc-7e                 # 引用名称，非 UUID

models:
  default_llm: gemini-2.5-flash
  rules_llm: claude-sonnet
  embedding: jina-v3
  rerank: jina-reranker

rerank:
  enabled: true
  top_n: 5
  top_k: 20

knowledge_libraries:
  - name: CoC 7E 核心规则
    scope: rules
    priority: 1
```

- 模型 profile、rule set、知识库用**名称引用**（非 UUID），使配置跨机器可移植
- 应用启动时按名称解析到本机实际 ID；找不到时提示用户重新绑定

**A4：对话历史落盘**

- 每个 chat session 存为 `.trpg/chat/{session-id}.jsonl`（每行一条消息 JSON）
- 应用读取时从文件加载
- `ChatSessionORM` / `ChatMessageORM` 降级为索引缓存

**A5：DB 降级为可重建缓存**

| 数据 | Source of truth | DB 角色 |
|------|----------------|---------|
| 资产内容 | 文件系统 `.md` | `.trpg/cache.db` 索引 |
| 版本历史 | `.trpg/revisions/` | `.trpg/cache.db` 索引 |
| Workspace 配置 | `.trpg/config.yaml` | 全局 `app.db` 注册条目（路径指针） |
| 对话历史 | `.trpg/chat/*.jsonl` | `.trpg/cache.db` 索引 |

全局 `app.db` 保留：LLM/Embedding/Rerank Profiles、RuleSet、KnowledgeLibrary、PromptProfile、UsageLog、ModelCatalog。

全局 `app.db` 中的 workspace 表简化为注册条目：`id`, `name`, `path`（指向磁盘目录）。

**A6：目录结构调整**

新建工作空间时只创建 `.trpg/` 内部结构，不预建任何资产类型目录：

```
~/trpg-workbench-data/workspaces/{workspace-name}/
├── .trpg/
│   ├── config.yaml
│   ├── revisions/{slug}/v{N}.md
│   ├── chat/{session-id}.jsonl
│   └── cache.db
└── skills/                    ← 已有，保持不变
```

资产类型目录（`npcs/`、`scenes/` 等）在第一个该类型资产被创建时按需生成。

**Convention + Tolerance 策略**：

- **写入时**（app/Agent 创建资产）：按类型放入 `{type}/` 目录，目录不存在则自动创建
- **读取时**：递归扫描 workspace 根目录下所有 `.md` 文件，解析 frontmatter `type` 字段判断类型。文件在哪个目录不影响识别
- 用户可自由重新组织目录结构（如按章节 `act-1/`），app 始终以 frontmatter 为准
- `.trpg/` 和 `skills/` 是保留目录，扫描时跳过
- 没有合法 frontmatter 或缺少 `type` 字段的 `.md` 文件直接忽略
- 目录名用 workspace 名称（可读）而非 UUID
- 文件名直接用 slug

**A7：文件诊断与错误提示**

文件扫描时区分三种情况：合法资产文件正常索引；有 frontmatter 但格式不合法的文件记录诊断错误并在前端类似 IDE Problems 面板提示；无 frontmatter 的 `.md` 静默忽略（视为用户笔记）。

**A8：App 内手动创建资产**

用户无需通过 Agent 也能创建资产：在资产树工具栏点击"新建资产" → 选择类型 → 自动生成带正确 frontmatter 模板的文件 → 打开编辑器。三种创建方式并存：Agent 创建、App 内手动创建、文件管理器手动创建。

**A9：文件变更检测**

- 启动时扫描 workspace 目录，对比 `cache.db` 中 file_hash，同步新增/修改/删除
- 运行时使用文件系统 watcher（`notify` crate 或 `tauri-plugin-fs-watch`）
- 冲突处理：last-write-wins + UI 提示文件已被外部修改

**A10：移除导出功能**

当前 `/workspaces/{id}/export` ZIP 导出不再需要——目录本身就是成果。替换为"在文件管理器中打开 workspace 目录"的操作。

**A11：Workflow / Agent 资产读取路径适配**

- `create_module.py`、`modify_asset.py`、`rules_review.py` 等 workflow 中的资产读取从 DB 改为文件读取
- `get_workspace_context()` 中的 `existing_assets` 从 DB 查询改为文件系统扫描 + frontmatter 解析
- Document Agent 输出改为生成合规的 frontmatter Markdown

**A12：工作空间管理 UX 重构**

File-first 后工作空间不再是 DB 记录，而是磁盘上的目录。交互模型从"在 DB 中新建"变为类似 VS Code / Unity 的"打开文件夹"模式：

- "新建工作空间"：选目录 → 输入名称/描述 → 初始化 `.trpg/` 结构
- "打开已有工作空间"：Tauri 文件夹选择器 → 验证 `.trpg/config.yaml` 存在 → 注册到 `app.db`
- "最近打开的工作空间"：`app.db` 记录路径 + `last_opened_at`，按时间排序展示
- 路径失效处理：目录不存在时提示"已移动或删除"，可重新定位或移除

### B 类：后续扩展

- **B1：Git-based 版本历史**：每个 workspace 作为 git repo，每次保存自动 commit。当前用快照目录，git 作为后续增强
- **B2：RuleSet 导入/导出包**：将 rule set + prompt profiles + 自定义资产类型 + 知识库打包为可分享的包。当前 rule set 保留全局管理
- **B3：Workspace 模板**：预置 workspace 模板（含示例资产），新建时可选择

### C 类：明确不承诺

- 不做多用户协作 / workspace 同步
- 不做 RuleSet 文件化（保留全局 DB 管理，B2 中通过导入/导出解决可移植性）
- 不做自动冲突合并（外部编辑冲突使用 last-write-wins）

---

## 文件结构

### 修改文件

```
# 后端 — 核心重构
apps/backend/app/models/orm.py                 — AssetORM/AssetRevisionORM/ChatORM 简化，WorkspaceORM 简化
apps/backend/app/services/asset_service.py      — 读写改为文件系统
apps/backend/app/services/revision_service.py   — 版本快照改为文件
apps/backend/app/services/chat_service.py       — 对话读写改为 JSONL 文件（新建或重构）
apps/backend/app/services/workspace_service.py  — config.yaml 读写（新建或重构）
apps/backend/app/services/sync_service.py       — 文件↔DB 索引同步（新建）
apps/backend/app/utils/paths.py                 — workspace 内部路径工具函数
apps/backend/app/api/assets.py                  — 适配新读写路径
apps/backend/app/api/workspaces.py              — 适配 config.yaml
apps/backend/app/api/chat.py                    — 适配 JSONL 读写
apps/backend/app/api/agent_tools.py             — 移除 export endpoint

# 后端 — Workflow 适配
apps/backend/app/workflows/create_module.py     — 资产读写路径
apps/backend/app/workflows/modify_asset.py      — 资产读写路径
apps/backend/app/workflows/rules_review.py      — 资产读取路径
apps/backend/app/agents/document.py             — 输出 frontmatter Markdown

# 后端 — 上下文组装
apps/backend/app/agents/utils.py                — get_workspace_context 改为文件扫描

# 前端
apps/desktop/src/lib/api.ts                     — 适配新 API
apps/desktop/src/components/editor/AssetTree.tsx — 数据源改为文件系统扫描结果
apps/desktop/src/components/editor/EditorCenter.tsx — 保存逻辑适配
apps/desktop/src/stores/editorStore.ts           — 适配新数据流
apps/desktop/src/pages/WorkspaceSettingsPage.tsx  — 配置项来源改为 config.yaml
apps/desktop/src/pages/WorkspaceListPage.tsx       — 重构为"最近打开 + 新建 + 打开已有"模式

# 开发 Skill 更新
.agents/skills/trpg-workbench-architecture/SKILL.md  — 数据层架构描述
.agents/skills/asset-schema-authoring/SKILL.md        — 资产文件格式
.agents/skills/agent-workflow-patterns/SKILL.md       — 资产读写路径
.agents/skills/frontend-ui-patterns/SKILL.md          — 编辑器保存流程、资产树数据源
```

---

## 关键设计约束

### 约束 1：frontmatter 是资产元数据的 source of truth

```python
import frontmatter

# 读取资产
post = frontmatter.load("npcs/zhao-detective.md")
asset_type = post["type"]       # "npc"
asset_name = post["name"]       # "赵探长"
content_md = post.content       # Markdown 正文

# 写入资产
post = frontmatter.Post(content_md, **metadata_dict)
frontmatter.dump(post, filepath)
```

Agent 输出必须生成合规的 frontmatter Markdown。Document Agent 的输出格式从当前的 JSON patch 改为 frontmatter Markdown 文件内容。

### 约束 2：config.yaml 中用名称引用全局资源

```yaml
rule_set: coc-7e              # 不是 UUID
models:
  default_llm: gemini-2.5-flash  # profile 名称
```

应用启动时解析：
```python
profile = db.query(LLMProfileORM).filter_by(name=config["models"]["default_llm"]).first()
if not profile:
    # 提示用户重新绑定
```

### 约束 3：cache.db 可安全删除

`.trpg/cache.db` 是纯索引缓存。删除后应用启动时自动从文件系统重建：
```python
def rebuild_cache(workspace_path):
    # 扫描所有 .md 文件，解析 frontmatter，写入 cache.db
    # 扫描 .trpg/chat/*.jsonl，建立会话索引
    # 扫描 .trpg/revisions/，建立版本索引
```

### 约束 4：Convention + Tolerance — 目录不决定类型

资产类型**仅由 frontmatter `type` 字段决定**，与文件所在目录无关：

```
# 以下三种放法，app 都能正确识别为 type: npc
npcs/zhao-detective.md          ← app 默认写入位置
act-1/zhao-detective.md         ← 用户手动移动后仍可识别
zhao-detective.md               ← 放在根目录也行
```

写入时 app 按 `{type}/` 约定放置；读取时递归扫描全部 `.md` 并解析 frontmatter。

### 约束 5：workspace 目录名即 workspace 名称

目录名从 UUID 改为 workspace 名称（URL-safe slug 化）。重命名 workspace 时同步重命名目录。

---

## Todo

### A1：资产文件格式统一

- [ ] **A1.1**：定义 frontmatter schema（各资产类型的必填/可选字段）
- [ ] **A1.2**：`apps/backend/app/services/asset_service.py` — 资产创建改为写 frontmatter Markdown 文件
- [ ] **A1.3**：`apps/backend/app/services/asset_service.py` — 资产读取改为从文件解析 frontmatter
- [ ] **A1.4**：`apps/backend/app/services/asset_service.py` — 资产更新改为写文件 + 更新 DB 索引

### A2：资产读写 file-first

- [ ] **A2.1**：`apps/backend/app/models/orm.py` — `AssetORM` 简化（移除 content 相关字段，增加 file_path, file_hash）
- [ ] **A2.2**：`apps/backend/app/models/orm.py` — `AssetRevisionORM` 简化（移除 content_md/content_json，增加 snapshot_path）
- [ ] **A2.3**：`apps/backend/app/api/assets.py` — 所有 endpoint 适配新读写路径
- [ ] **A2.4**：`apps/backend/app/services/revision_service.py` — 版本快照改为复制文件到 `.trpg/revisions/`

### A3：Workspace 配置文件化

- [ ] **A3.1**：`apps/backend/app/services/workspace_service.py` — 新建/重构，读写 `.trpg/config.yaml`
- [ ] **A3.2**：`apps/backend/app/models/orm.py` — `WorkspaceORM` 简化为注册条目（id, name, path）
- [ ] **A3.3**：`apps/backend/app/api/workspaces.py` — 适配 config.yaml（创建/读取/更新 workspace 配置）
- [ ] **A3.4**：名称引用解析逻辑 — 启动时按名称匹配 rule set / model profile，找不到时返回警告

### A4：对话历史落盘

- [ ] **A4.1**：`apps/backend/app/services/chat_service.py` — 新建/重构，消息写入 `.trpg/chat/{session-id}.jsonl`
- [ ] **A4.2**：`apps/backend/app/services/chat_service.py` — 消息读取从 JSONL 文件加载
- [ ] **A4.3**：`apps/backend/app/api/chat.py` — 适配新读写路径
- [ ] **A4.4**：`apps/backend/app/models/orm.py` — `ChatSessionORM`/`ChatMessageORM` 降级为缓存索引

### A5：DB 降级为缓存

- [ ] **A5.1**：`apps/backend/app/services/sync_service.py` — 新建，实现文件→DB 索引同步逻辑
- [ ] **A5.2**：`apps/backend/app/services/sync_service.py` — 实现 cache.db 全量重建逻辑
- [ ] **A5.3**：启动时自动检测 cache.db 是否存在/过期，必要时重建

### A6：目录结构调整

- [ ] **A6.1**：`apps/backend/app/utils/paths.py` — 新增 workspace 内部路径工具函数（trpg_dir, revisions_dir, chat_dir 等）
- [ ] **A6.2**：Workspace 创建时只生成 `.trpg/` 子目录结构（config.yaml, chat/, revisions/），不预建资产类型目录
- [ ] **A6.3**：资产创建时按需生成 `{type}/` 目录
- [ ] **A6.4**：目录名使用 workspace 名称（slug 化），重命名时同步重命名目录
- [ ] **A6.5**：文件扫描时递归扫描根目录，跳过 `.trpg/` 和 `skills/`，按以下规则分类：
  - 合法 frontmatter + 有 `type` → 正常识别为资产
  - 有 frontmatter 但缺 `type` 或字段不合法 → 记录为诊断错误（返回给前端）
  - 没有 frontmatter 的 `.md` → 静默忽略（视为用户笔记）
  - 非 `.md` 文件 → 忽略

### A7：文件诊断与错误提示

- [ ] **A7.1**：后端 — `sync_service.py` 扫描时收集诊断信息（文件路径 + 错误原因），通过 API 返回
- [ ] **A7.2**：前端 — 资产树底部或工具栏显示诊断徽标（如"2 个文件格式有误"），点击展开详情
- [ ] **A7.3**：前端 — 诊断详情列出问题文件路径和具体错误（如"缺少 type 字段"、"type 值不在已注册类型中"），类似 IDE 的 Problems 面板

### A8：App 内手动创建资产

用户不经过 Agent 也能快速创建资产：点击"新建资产"按钮 → 选择类型 → 生成带正确 frontmatter 模板的文件 → 打开编辑器。

- [ ] **A8.1**：后端 — 新增资产模板生成逻辑，根据资产类型的 schema 生成默认 frontmatter Markdown
- [ ] **A8.2**：前端 — 资产树工具栏新增"新建资产"按钮，弹出类型选择器
- [ ] **A8.3**：前端 — 创建后自动在编辑器中打开新文件

### A9：文件变更检测

- [ ] **A9.1**：启动时扫描 + file_hash 对比同步
- [ ] **A9.2**：运行时文件 watcher（`notify` crate 或 Tauri 插件）
- [ ] **A9.3**：外部修改检测到时通知前端刷新
- [ ] **A9.4**：前端新增"文件已被外部修改"提示 UI

### A10：移除导出功能

- [ ] **A10.1**：移除 `/workspaces/{id}/export` endpoint
- [ ] **A10.2**：前端 WorkspaceSettingsPage 中的导出区域替换为"在文件管理器中打开"

### A11：Workflow / Agent 适配

- [ ] **A11.1**：`apps/backend/app/agents/utils.py` — `get_workspace_context` 改为文件系统扫描 + frontmatter 解析
- [ ] **A11.2**：`apps/backend/app/workflows/create_module.py` — 资产持久化改为写文件
- [ ] **A11.3**：`apps/backend/app/workflows/modify_asset.py` — 资产读取改为从文件读
- [ ] **A11.4**：`apps/backend/app/agents/document.py` — 输出格式改为 frontmatter Markdown
- [ ] **A11.5**：`apps/backend/app/workflows/rules_review.py` — 资产读取适配

### A12：工作空间管理 UX 重构

File-first 后工作空间不再是 DB 记录，而是磁盘上的目录。交互模型从"在 DB 中新建"变为类似 VS Code / Unity 的"打开文件夹"模式。

- [ ] **A12.1**：全局 `app.db` — `WorkspaceORM` 增加 `last_opened_at` 字段，记录最近打开时间
- [ ] **A12.2**：后端 API — 新增 `POST /workspaces/open` endpoint（接收路径，扫描 `.trpg/config.yaml`，注册到 `app.db`）
- [ ] **A12.3**：后端 API — `GET /workspaces` 按 `last_opened_at` 排序，返回最近工作空间列表
- [ ] **A12.4**：后端 API — 启动时检测已注册 workspace 路径是否存在，不存在的标记为 `missing`
- [ ] **A12.5**：前端 — 工作空间选择页重构：显示"最近打开的工作空间"列表 + "新建工作空间" + "打开已有工作空间"
- [ ] **A12.6**：前端 — "新建工作空间"流程：选择目录 → 输入名称/描述 → 初始化 `.trpg/` 结构
- [ ] **A12.7**：前端 — "打开已有工作空间"流程：Tauri 文件夹选择器 → 验证 `.trpg/config.yaml` 存在 → 注册并打开
- [ ] **A12.8**：前端 — 路径不存在时显示"目录已移动或删除"，提供"重新定位"和"从列表移除"操作

### A13：前端编辑器适配

- [ ] **A13.1**：`apps/desktop/src/components/editor/AssetTree.tsx` — 数据源适配
- [ ] **A13.2**：`apps/desktop/src/components/editor/EditorCenter.tsx` — 保存逻辑适配（frontmatter 感知）
- [ ] **A13.3**：`apps/desktop/src/stores/editorStore.ts` — 数据流适配
- [ ] **A13.4**：`apps/desktop/src/pages/WorkspaceSettingsPage.tsx` — 配置来源改为 config.yaml API

### A14：开发 Skill 更新

- [ ] **A14.1**：`.agents/skills/trpg-workbench-architecture/SKILL.md` — 数据层架构描述更新
- [ ] **A14.2**：`.agents/skills/asset-schema-authoring/SKILL.md` — 资产格式改为 frontmatter Markdown
- [ ] **A14.3**：`.agents/skills/agent-workflow-patterns/SKILL.md` — 资产读写路径更新
- [ ] **A14.4**：`.agents/skills/frontend-ui-patterns/SKILL.md` — 编辑器保存流程、资产树数据源更新

---

## 验收标准

1. 在 workspace 目录中手动创建一个符合 frontmatter 格式的 `.md` 文件，启动应用后该资产自动出现在资产树中
2. 在应用内编辑资产并保存，用外部编辑器打开对应 `.md` 文件可看到最新内容
3. 用外部编辑器修改资产 `.md` 文件，应用内自动检测到变更并提示刷新
4. 删除 `.trpg/cache.db`，重启应用，所有资产、对话历史、版本记录自动恢复
5. 复制整个 workspace 目录到另一个位置，用"打开已有工作空间"选择该目录后所有资产和对话历史可见（模型绑定需重新配置）
6. 启动应用显示"最近打开的工作空间"列表，可直接点击进入
7. 已注册的 workspace 目录被删除/移动后，列表中显示"目录不存在"提示，可重新定位或移除
8. 在应用内发送 Agent 对话，`.trpg/chat/` 下可看到对应 JSONL 文件
9. 修改 `.trpg/config.yaml` 中的 workspace 名称，应用中名称同步更新
10. Agent 生成的新资产以 frontmatter Markdown 格式保存在正确的子目录中
11. 版本回滚后，`.trpg/revisions/` 中存在对应的历史快照文件
12. 手动创建一个有 frontmatter 但缺少 `type` 字段的 `.md` 文件，资产树底部显示诊断错误提示
13. 将资产文件从 `npcs/` 移动到 `act-1/`，app 仍然正确识别其类型（Convention + Tolerance）
14. 在 app 内点击"新建资产" → 选择类型 → 自动生成带正确 frontmatter 的模板文件并打开编辑器

---

## 与其他里程碑的关系

```
M17（用户自定义 Agent Skill — file-first 参考实现）
  └── M18（本 milestone — 整个 workspace file-first）
        ├── M19（Agent 上下文控制 — 依赖稳定的资产读取路径）
        └── M20（打包发布 0.1.0）
```

---

## 非目标

- 不做 RuleSet / KnowledgeLibrary / PromptProfile 的文件化（保留全局 DB，通过 B2 导入/导出解决）
- 不做多用户 / 多设备同步
- 不做自动冲突合并（外部编辑冲突使用 last-write-wins）
- 不做 git 集成（B1 后续扩展）
- 不做数据迁移脚本（0.1.0 未发布，无历史数据）
