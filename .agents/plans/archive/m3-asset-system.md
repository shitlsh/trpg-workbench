# M3：资产系统

**前置条件**：M1 完成（Workspace CRUD、SQLite 可用）。

**目标**：完整的资产创建/编辑/保存/版本回溯，三栏布局编辑器可用，JSON 与 Markdown 双视图同步。

**状态：✅ 已完成（commit c2329f6）**

---

## Todo

### 数据库

- [x] 建表 migration：`assets`
  - `id`、`workspace_id`、`type`、`name`、`slug`、`path`、`status`、`summary`、`metadata_json`、`created_at`、`updated_at`
- [x] 建表 migration：`asset_revisions`
  - `id`、`asset_id`、`version`、`content_md`、`content_json`、`change_summary`、`source_type`（agent/user）、`created_at`

### 后端（`app/services/`）

- [x] `asset_service.py`：资产 CRUD，每次更新自动写 revision
  - 创建资产时：写数据库 + 写本地文件（`{type}-{slug}.json` + `{type}-{slug}.md`）
  - 更新资产时：更新数据库 + 覆写本地文件 + **追加一条 revision**（不覆盖旧 revision）
  - revision version 从 1 开始，每次 +1
- [x] `revision_service.py`：revision 历史查询、回滚
  - 回滚 = 用指定 revision 的内容创建一条新 revision（不删除历史）
- [x] Workspace 创建时自动建资产子目录树：
  - `assets/outline/`、`assets/stages/`、`assets/npcs/`、`assets/monsters/`
  - `assets/locations/`、`assets/clues/`、`assets/branches/`、`assets/timelines/`
  - `assets/map_briefs/`、`assets/lore_notes/`、`revisions/`、`images/`、`logs/`
- [x] MD → JSON 受限反向同步逻辑：
  - 按固定标题结构提取段落（如 `## 动机` → `motivation` 字段）
  - 无法映射的自由文本段落：保留到 JSON 的 `notes` 字段，并返回警告

### 后端 API（`app/api/`）

- [x] `GET /workspaces/:id/assets`：列出资产（支持按 type 过滤）
- [x] `POST /workspaces/:id/assets`：新建资产（含 type、name、slug）
- [x] `GET /assets/:id`：获取资产详情（最新 revision 的 content_json + content_md）
- [x] `PATCH /assets/:id`：更新资产（body 含 content_json 或 content_md，自动写 revision）
- [x] `DELETE /assets/:id`：删除资产（软删除，revision 保留）
- [x] `GET /assets/:id/revisions`：列出 revision 历史
- [x] `POST /assets/:id/revisions/:rev_id/rollback`：回滚到指定 revision

### 前端三栏布局

- [x] 三栏骨架组件
  - 左栏默认 240px，可拖拽调整（180px~360px），可折叠（保留折叠条）
  - 中栏 flex-1，不可隐藏
  - 右栏默认 320px，可拖拽调整（280px~480px），可折叠
  - 折叠/展开状态持久化到 `useEditorStore`

- [x] 左栏：资产树组件
  - 按 type 分组，每组可折叠展开
  - 资产名称 + status 图标（draft/review/final）
  - 搜索过滤（按名称模糊搜索）
  - 右键菜单：新建、重命名、删除

- [x] 左栏：新建资产面板
  - 选择资产类型（下拉）
  - 填写 name 和 slug（slug 自动从 name 生成，可手动改）
  - 确认后在资产树中出现并自动打开

- [x] 中栏：Tab 管理
  - 单例原则：同一 asset 只能有一个 Tab
  - 脏状态标识：未保存时标题后显示 `●`
  - 关闭确认：脏状态 Tab 关闭时弹确认对话框
  - Tab 上限：最多同时 10 个，超出时提示
  - Tab 切换更新 URL（`/workspace/:id/asset/:aid`）

- [x] 中栏：Monaco Editor 集成
  - 视图切换 Tab：`[ Markdown ]` | `[ JSON ]` | `[ Diff ]`
  - Markdown 视图：`markdown` 语言模式，可直接编辑
  - JSON 视图：`json` 语言模式，Schema 校验，格式化按钮
  - Diff 视图：Monaco diff editor，左侧上一 revision，右侧当前内容
  - 保存快捷键：`Cmd/Ctrl+S`，触发 PATCH API + 写 revision

- [x] 中栏：MD → JSON 同步
  - 保存 MD 视图时，调用后端同步接口
  - 若无法完全映射，显示黄色警告提示（"部分内容无法同步到 JSON，建议在 JSON 视图补充"）

- [x] 中栏：Revision 历史侧边栏
  - 点击中栏工具栏"历史"图标打开
  - 列出所有 revision（版本号、时间、change_summary、source_type）
  - 点击某条 revision：Diff 视图展示该版本 vs 当前
  - "回滚到此版本"按钮

- [x] 右栏：资产元信息面板（M3 阶段简版）
  - 显示：name、type、slug、status、summary
  - status 可直接在右栏修改（draft/review/final）
  - 跨资产引用列表（key_npcs、key_locations 等，点击可跳转）

### shared-schema

- [x] 定义类型：`Asset`、`AssetRevision`、`AssetType`
- [x] 定义 API 类型：`CreateAssetRequest`、`UpdateAssetRequest`

---

## 验证步骤

1. 打开"测试空间" Workspace，确认进入三栏布局
2. 在左栏新建一个 NPC 资产，name 填"Arthur Hale"，slug 填"mayor-arthur"
3. 确认左栏资产树出现该 NPC，中栏自动打开编辑器
4. 在 Markdown 视图下，在 `## 动机` 段落填写内容，按 `Cmd+S` 保存
5. 切换到 JSON 视图，确认 `motivation` 字段已有对应内容
6. 再次修改 Markdown 内容并保存
7. 切换到 Diff 视图，确认能看到两次保存之间的差异
8. 打开 Revision 历史侧边栏，确认有 2 条 revision 记录
9. 点击第 1 条 revision 的"回滚"，确认内容恢复，且历史中新增第 3 条 revision
10. 打开终端，确认以下文件存在且内容正确：
    - `trpg-workbench-data/workspaces/<id>/assets/npcs/npc-mayor-arthur.json`
    - `trpg-workbench-data/workspaces/<id>/assets/npcs/npc-mayor-arthur.md`
11. 新建第 2 个 NPC，打开后确认两个 Tab 同时存在，中栏 Tab 切换正常
12. 在未保存状态下关闭 Tab，确认弹出关闭确认对话框

---

## 关键约束提示

- 每次更新资产**必须**追加一条 revision，禁止直接覆盖旧 revision
- revision 的 `change_summary` 不可为空（用户手动编辑时自动填"用户手动编辑"）
- 文件命名必须遵守 `{type}-{slug}.json/md` 格式
- JSON 是真相源：MD 视图编辑保存后必须尝试同步回 JSON，无法同步要给用户提示
- 回滚操作 = 创建新 revision，不删除任何历史记录
