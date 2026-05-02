# M32：资产体验增强

**前置条件**：无强依赖（各项功能均基于现有资产 CRUD 和文件结构，无需新能力前置）。

**目标**：修复 Stage 排序缺陷、移除遗留 content_json 技术债、在 AssetMetaPanel 中实现轻量级跨资产关系可视化、引入类 Obsidian 的双链语法与快速导航、为 config.yaml 增加 author 字段、实现模组手册 PDF 导出功能。

---

## 背景与动机

当前资产体验存在几个明显短板：

1. **Stage 无序**：stage 类型资产在面板中按名称字母序排列，没有体现幕次结构；用户创建"第一幕/第二幕"时无法直观看到叙事顺序。
2. **无关系可视化**：资产之间的引用关系（NPC 出现在哪些场景、线索指向哪个地点）只存在于 frontmatter 字段中，不可导航，创作者无法"看到全局结构"。
3. **content_json 技术债**：M18 File-first 改造后，`content_json` 字段已是无意义的兼容垫片，PATCH 写入路径完全不使用它，应予清除。
4. **缺少作者信息**：导出手册时无法填写作者，workspace config 没有此字段。
5. **无导出能力**：用户有将模组打印成完整手册的需求，当前 workspace 目录虽是真相源，但无法直接打印。

来源 proposal：`docs/benchmark-reviews/accepted/2026-04-24_asset-relationship-visualization.md`

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：Stage 排序修复**

方案：
- 修改 `stage.txt` 资产类型 prompt，要求 `name` 字段格式必须为"第 N 幕：{场景名}"，示例同步更新
- 更新 `asset-schema-authoring` skill 的 Stage frontmatter 示例（已有"第一幕：抵达村庄"，检查并对齐）
- 在 `AssetTree.tsx` 中，对 `type === 'stage'` 的 assets 组，按 `name` 开头的中文数字（一/二/三/四/五/六/七/八/九/十）或阿拉伯数字排序，未能解析则排在末尾

中文数字映射表（前端）：
```ts
const CN_NUM: Record<string, number> = {
  一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10,
  十一:11, 十二:12, 十三:13, 十四:14, 十五:15
}
// 从 name 中提取：/^第([一二三四五六七八九十]+|\d+)幕/ → 映射为数字
```

**A2：移除 content_json 技术债**

方案：无迁移，直接删除。当前 v0.1a 前阶段，无需兼容。
- 后端 `asset_service.py`：删除 `content_json` 生成逻辑
- 后端 `assets.py`：`AssetUpdate` schema 中删除 `content_json` 字段；`ApplyPatchRequest` 中删除 `content_json` 字段
- `packages/shared-schema/src/index.ts`：`AssetWithContent` 接口删除 `content_json` 字段
- 前端：全局搜索 `content_json` 引用，确保无遗漏

**A3：AssetMetaPanel 关系引用展示（轻量级关系可视化）**

方案：纯前端解析，无需后端 API 改动。

数据来源：`useWorkspaceAssets(workspaceId)` 已拉取所有资产（含 frontmatter 字段）。解析各类型已知引用字段：

```
stage:    key_npcs[], key_locations[], clues_available[]
npc:      relationships[].target
map:      accessible_in_stages[]
clue:     (按 clue.txt 确认字段)
monster:  (按 monster.txt 确认字段)
outline:  (按 outline.txt 确认字段)
```

新建 `apps/desktop/src/hooks/useAssetRelations.ts`：
```ts
// 输入：所有 assets（含 frontmatter 可解析的 slug 引用字段）
// 输出：Map<slug, { outgoing: AssetRef[], incoming: AssetRef[] }>
```

AssetMetaPanel 底部新增"关联资产"区块，分两行显示：
- **引用了**（outgoing）：当前资产 frontmatter 中列出的 slug → 解析为资产名 + 类型图标，点击跳转
- **被引用**（incoming）：其他资产中有字段引用了当前资产 slug 的，同样显示名称 + 类型图标，点击跳转
- 均为空时不显示该区块

**A4：`[[双链]]` 语法支持（中等难度，纳入本 milestone）**

方案：在 Markdown 编辑器的**预览/渲染层**，将 `[[slug]]` 或 `[[slug|显示文字]]` 解析为可点击的内链，点击打开对应资产 tab。同时反向引用索引也要扫描 Markdown body 中的 `[[]]` 语法，补充到 A3 的关系图。

- 不修改 frontmatter，双链仅在 Markdown body 中使用
- 编辑器侧（CodeMirror 或当前使用的方案）：识别 `[[...]]` 高亮为链接样式
- 预览侧（Markdown 渲染）：将 `[[slug]]` 渲染为 `<a>` 标签，点击触发 `openAssetTab(slug)`
- 无法解析的 slug（资产不存在）：渲染为红色断链样式
- `useAssetRelations` hook 同时扫描 body 中的 `[[slug]]` 引用

**A5：Workspace config 新增 author 字段**

方案：
- `.trpg/config.yaml` 新增 `author: ""` 字段（可选，默认空）
- `WorkspaceConfig` Python Pydantic 模型新增 `author: str = ""`
- `WorkspaceConfigSchema`（shared-schema）新增 `author?: string`
- WorkspaceSettingsPage 新增"作者"输入框，可编辑保存

**A6：模组手册 PDF 导出**

方案：利用 Tauri WebView 的 `window.print()` 能力，后端生成结构化 HTML，前端在隐藏 iframe 中加载后触发打印（用户可选择"另存为 PDF"）。

流程：
```
用户点击"导出手册" →
  前端调用 POST /workspaces/{id}/export/validate →
    后端返回校验结果（draft 资产列表 + 断裂引用列表）→
  弹出 ExportDialog（显示警告，允许用户强制导出）→
  用户确认 →
  前端调用 GET /workspaces/{id}/export/html →
    后端拼装 HTML（按结构顺序：封面→目录→大纲→场景→NPC→怪物→地图→线索→附录）→
  前端在隐藏 iframe 中加载 HTML，调用 iframe.contentWindow.print()
```

校验规则：
- **警告**：status 为 `draft` 的资产（列出名称）
- **警告**：frontmatter 中引用了不存在 slug 的字段（断裂引用，列出资产名 + 字段）
- 用户可忽略警告强制导出，也可取消去修改

HTML 结构：
```
封面：模组名、作者（from config.author）、规则体系（from config.rule_set）、导出日期
目录：自动生成，各章节锚链接
第一章 大纲（outline 类，按名称排序）
第二章 场景（stage 类，按幕次排序）
第三章 人物（npc 类，按名称排序）
第四章 威胁（monster 类，按名称排序）
第五章 地图（map 类，按名称排序）
第六章 线索（clue 类，按名称排序）
附录 自定义类型资产（按 type 分组，再按名称）
```

Print CSS：适配 A4 纸，章节分页，标题样式，无侧边导航元素。

### B 类：后续扩展

- **B1：Graph View（关系图谱视图）**：基于 A3/A4 的关系数据，引入 `react-flow` 或 `d3-force` 渲染节点-边图谱。工作量较大（~1周），且需要 UI 布局调整（独立视图或侧滑面板），推迟到确有用户需求时再做。
- **B2：资产状态过滤**：AssetTree 顶部增加按 draft/review/final 过滤的 toggle，目前混排可接受。
- **B3：快速打开面板**（Cmd+P 搜索跳转资产）：类 Obsidian 的 Quick Open，中等工作量。

### C 类：明确不承诺

- Obsidian 式自由文件夹层级：与 File-first 的 Convention+Tolerance 策略有摩擦，且意义不大（资产已按类型组织）
- 实时协作编辑
- 导出为 `.epub` 或 Word 格式（当前 PDF/打印已满足需求）
- `content_json` 的任何迁移或兼容层（v0.1a 前直接删除）

---

## 文件结构

### 修改文件

```
后端
apps/backend/app/prompts/asset_types/stage.txt           — A1：更新 name 格式说明
apps/backend/app/models/workspace.py（或 config.py）     — A5：WorkspaceConfig 新增 author 字段
apps/backend/app/storage/asset_service.py                — A2：删除 content_json 生成逻辑
apps/backend/app/api/assets.py                           — A2：AssetUpdate/ApplyPatchRequest 删除 content_json
apps/backend/app/api/workspaces.py（或新建 export.py）   — A6：/export/validate + /export/html 端点

前端
apps/desktop/src/components/AssetTree.tsx                — A1：stage 组内按幕次排序
apps/desktop/src/components/AssetMetaPanel.tsx           — A3：新增关联资产区块
apps/desktop/src/pages/WorkspaceSettingsPage.tsx         — A5：新增 author 输入框
packages/shared-schema/src/index.ts                      — A2：删除 content_json；A5：新增 author 字段

新建文件
apps/desktop/src/hooks/useAssetRelations.ts              — A3/A4：关系图构建 hook
apps/backend/app/services/export_service.py              — A6：HTML 拼装服务
apps/desktop/src/components/ExportDialog.tsx             — A6：导出确认对话框

Skill/文档
.agents/skills/asset-schema-authoring/SKILL.md           — A1：确认 stage name 格式规范
.agents/plans/roadmap.md                                 — 更新总览图与表格（底部旧约定也需清理）
```

---

## 关键设计约束

### A2 content_json 删除范围

后端 `build_asset_with_content()` 中只构建 `content_md`，不再序列化 `content_json`。
`ApplyPatchRequest` 保留 `content_md` 字段，删除 `content_json`。
前端任何读取 `asset.content_json` 的地方全部改为从 `content_md` 解析（或直接不用，因前端本来就不依赖它）。

### A3/A4 引用解析约束

- 只扫描已知的结构化引用字段（列表见 A3），不做全文 NLP 分析
- `[[slug]]` 语法只用于 Markdown body，不出现在 frontmatter
- 引用图在 `useAssetRelations` 中构建，接受 `Asset[]`（列表接口的所有资产），**不做额外 API 调用**
- `AssetWithContent`（单资产全量）才有 `content_md`，列表接口没有。双链扫描需要 content_md，因此只在资产**已打开（已 fetch 全量）**时扫描 body；未打开的资产只扫描 frontmatter 字段（通过 AssetSchema 中的已有字段）

### A6 导出约束

- 后端只生成 HTML 字符串，不依赖 chromium 或其他 PDF 工具
- 前端通过 `<iframe>` + `contentWindow.print()` 触发系统打印对话框，用户在系统对话框中选择"另存为 PDF"
- Print CSS 必须设置 `@page { size: A4; margin: 2cm; }` 和 `page-break-before: always` 分章
- 导出 HTML 中资产内容使用已有 Markdown 渲染逻辑（复用前端 marked/remark 渲染器，或后端用 python-markdown 处理）

---

## Todo

### A1：Stage 排序修复

- [ ] **A1.1**：`apps/backend/app/prompts/asset_types/stage.txt` — 更新 `name` 字段说明，要求格式"第 N 幕：{名称}"，更新示例
- [ ] **A1.2**：`apps/desktop/src/components/AssetTree.tsx` — 对 stage 组资产按中文/阿拉伯数字幕次排序，添加 `extractActNumber(name)` 辅助函数

### A2：移除 content_json

- [ ] **A2.1**：`apps/backend/app/storage/asset_service.py` — 删除 `content_json` 序列化逻辑
- [ ] **A2.2**：`apps/backend/app/api/assets.py` — `AssetUpdate`、`ApplyPatchRequest` 删除 `content_json` 字段
- [ ] **A2.3**：`packages/shared-schema/src/index.ts` — `AssetWithContent` 删除 `content_json`
- [ ] **A2.4**：全局搜索 `content_json`，清除前端任何引用（预期无实际使用，确认即可）

### A3：AssetMetaPanel 关系引用展示

- [ ] **A3.1**：`apps/desktop/src/hooks/useAssetRelations.ts` — 新建 hook，扫描所有资产 frontmatter 字段，构建 `outgoing/incoming` 引用 Map
- [ ] **A3.2**：确认各资产类型的引用字段（对照 stage.txt / npc.txt / clue.txt / map.txt / outline.txt）
- [ ] **A3.3**：`apps/desktop/src/components/AssetMetaPanel.tsx` — 底部新增"关联资产"区块，显示 outgoing + incoming 引用列表，点击跳转

### A4：[[双链]] 语法

- [ ] **A4.1**：确认当前编辑器使用的 Markdown 渲染库（CodeMirror? marked? remark?）
- [ ] **A4.2**：编辑器预览/渲染层：将 `[[slug]]` / `[[slug|文字]]` 渲染为可点击链接（正常 slug=绿色链接，断链 slug=红色样式）
- [ ] **A4.3**：`useAssetRelations.ts` — 补充扫描已打开资产的 `content_md` 中的 `[[slug]]` 引用

### A5：Workspace config author 字段

- [ ] **A5.1**：后端 `WorkspaceConfig` Pydantic 模型新增 `author: str = ""`
- [ ] **A5.2**：`packages/shared-schema/src/index.ts` — `WorkspaceConfig` 新增 `author?: string`
- [ ] **A5.3**：`apps/desktop/src/pages/WorkspaceSettingsPage.tsx` — 新增"作者"输入框，保存到 config.yaml

### A6：模组手册 PDF 导出

- [ ] **A6.1**：`apps/backend/app/services/export_service.py` — 新建，实现 `validate_export()` 和 `build_export_html()` 函数
- [ ] **A6.2**：后端路由 — 新增 `POST /workspaces/{id}/export/validate` 和 `GET /workspaces/{id}/export/html`
- [ ] **A6.3**：`packages/shared-schema/src/index.ts` — 新增 `ExportValidateResult` 类型
- [ ] **A6.4**：`apps/desktop/src/components/ExportDialog.tsx` — 新建导出确认对话框（展示校验结果 + 确认/取消按钮）
- [ ] **A6.5**：前端导出触发入口 — 在 WorkspaceSettingsPage 或顶部工具栏新增"导出手册"按钮
- [ ] **A6.6**：前端 print 逻辑 — `<iframe>` 加载 HTML + `contentWindow.print()` 触发系统打印对话框

---

## 验收标准

1. 在 stage 资产组中，"第一幕：xxx" 始终排在"第二幕：xxx" 前面，无论创建顺序如何。
2. 调用 `GET /assets/{id}` 返回的 JSON 中不再包含 `content_json` 字段；前端编译无 `content_json` 相关类型错误。
3. 在 AssetMetaPanel 中，选中一个 stage 资产后，若该 stage 的 `key_npcs` 中有"mayor-arthur"，则关联资产区块显示该 NPC 的名称并可点击跳转。
4. 选中"mayor-arthur" NPC 资产后，关联资产区块的"被引用"部分显示引用了该 NPC 的所有 stage 资产名称。
5. 在 Markdown body 中输入 `[[mayor-arthur]]`，预览中渲染为可点击的带颜色链接；若 slug 不存在，渲染为红色断链样式。
6. WorkspaceSettingsPage 中有"作者"字段，填写并保存后 `.trpg/config.yaml` 中出现 `author:` 字段。
7. 点击"导出手册"，若有 draft 状态资产，弹出对话框提示数量，用户确认后触发浏览器打印对话框，可选择"另存为 PDF"；生成的内容包含封面（含模组名、作者）、目录和各章节内容。
8. 若 workspace 中无任何 draft 资产且无断裂引用，点击"导出手册"直接触发打印对话框，不弹校验提示。

---

## 与其他里程碑的关系

```
M18（File-first）+ M30（资产类型重构）
  └── M32（资产体验增强）← 本 milestone
        └── B1：Graph View（未来按需，独立规划）
```

---

## 非目标

- **不做 Graph View**：工作量较大（约 1 周），且 A3/A4 的关系列表已满足核心导航需求，图谱视图作为 B1 推迟。
- **不做状态过滤 UI**：AssetTree 中按 status 过滤是便利功能，不影响核心工作流，作为 B2 推迟。
- **不做 content_json 迁移或兼容层**：v0.1a 前，直接删除，无技术债需处理。
- **不做 Obsidian 式自由目录层级**：与 Convention+Tolerance 的按类型分目录策略冲突，且用户资产数量有限，扁平分组已足够。
- **不做 epub/Word 导出**：PDF 打印路径已满足需求，其他格式价值低。
- **不依赖 chromium/weasyprint 等外部工具**：坚持 local-first 开箱即用，使用 Tauri WebView 打印。
