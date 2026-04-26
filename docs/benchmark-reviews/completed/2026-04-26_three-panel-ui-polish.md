---
status: completed
date: 2026-04-26
source: Inscriptor, OpenPawz, Playwright DOM Audit
theme: 三栏布局 + 聊天体验全面打磨
priority: high
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: code
---

# 三栏 UI 深度打磨：布局持久化、聊天渲染、资产树、编辑器 UX

## 来源与借鉴理由

本 proposal 基于 **Playwright 实时 DOM 审计**（2026-04-26，本地服务运行中）+ Inscriptor / OpenPawz benchmark review 综合得出。所有宽度数据均来自 `getBoundingClientRect()` 实测，颜色值来自 `getComputedStyle()` 实测，非估算。

---

## Playwright DOM 审计：实测发现（优先级最高）

### F-1 SessionDrawer 主题色硬编码为亮色，应用整体为深色主题 【极高】

**根因（已定位到源码）**：`SessionDrawer.tsx` 第 93–295 行共 8 处使用 `--color-surface-2`、`--color-border`、`--color-text`、`--color-primary` 等 CSS 变量。这些变量在当前主题 CSS 中**完全未定义**（`getComputedStyle(root).getPropertyValue('--color-surface-2')` 返回空字符串），因此全部回退到硬编码的亮色默认值：

| SessionDrawer 中的值 | 实际渲染颜色 | 应用其他区域使用的变量 |
|---|---|---|
| `var(--color-surface-2, #f8fafc)` | `#f8fafc`（近白） | `var(--bg-surface)` = `#1a1a1a` |
| `var(--color-border, #e2e8f0)` | `#e2e8f0`（浅灰） | `var(--border)` = `#2e2e2e` |
| `var(--color-text, #1e293b)` | `#1e293b`（深蓝黑） | `var(--text)` |
| `var(--color-primary, #2563eb)` | `#2563eb`（蓝） | `var(--accent)` = `#7c6af7` |
| `#e2e8f0`（直接硬编码，第 249/280/295 行） | `#e2e8f0` | `var(--border)` = `#2e2e2e` |

**修复**：将所有 `--color-*` 变量替换为应用已有的 `--bg-surface`、`--border`、`--text`、`--accent`，删除硬编码的 `#e2e8f0`。

---

### F-2 会话历史按钮激活态 accent 色与应用 accent 不一致 【高】

**根因（已定位）**：`AgentPanel.tsx:563-564`：
```
background: drawerOpen ? "rgba(99,102,241,0.1)" : "none",
color: drawerOpen ? "var(--accent, #6366f1)" : "var(--text-muted)",
```
这里使用了硬编码的 `rgba(99,102,241,0.1)` 和 `#6366f1`（靛蓝），而应用实际 accent 是 `--accent: #7c6af7`（紫）。发送按钮则正确使用了 `var(--accent, rgba(74,144,217,0.15))`。

**修复**：`background: drawerOpen ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "none"`，删除硬编码颜色值。

---

### F-3 SessionDrawer 挤占聊天列，实际聊天宽度仅 80px 【极高】

**实测数据**（`getBoundingClientRect()`）：
- 左栏容器：实际渲染宽度 **280px**（min-width 约束生效，因为 store 存 240px < min 280px）
- SessionDrawer：占用 **200px**（`flex-shrink: 0; width: 200px`，与聊天列在同一 flex row 竞争宽度）
- 实际聊天区：280 - 200 = **80px**（完全不可读）

**根因**：`SessionDrawer` 是聊天列内的 flex 兄弟节点而非覆盖层。`ThreePanelLayout.tsx` 的 `left` slot 被 `AgentPanel` 渲染为 `flex-direction: row` 包含 `SessionDrawer(200px) + 聊天列(flex:1)`，聊天列在 280px 总宽内被压缩到 80px。

**修复**：将 SessionDrawer 改为绝对定位覆盖层（`position: absolute; z-index: 10; top: header高度; left: 0; width: 100%`），打开时覆盖聊天区而不占用宽度。

---

### F-4 左栏初始宽度 vs min-width 约束冲突 【高】

**实测**：
- `editorStore` 默认存储 `leftWidth = 240`
- `ThreePanelLayout.tsx:128` 传入 `minWidth={280}`
- 结果：渲染宽度始终为 280px（min-width 覆盖 store 值），store 中的值永远不生效

**修复**：`editorStore` 默认值改为 `leftWidth: 280`，与 `ThreePanelLayout` 的 `minWidth={280}` 对齐。

---

### F-5 折叠条 4px 宽、无 hover 反馈、拖拽与折叠共用同一元素造成意图模糊 【高】

**实测**（`ThreePanelLayout.tsx:78-100`）：
- 折叠条宽度：非折叠态 `width: 4px`，极难点击/拖拽
- hover 时无任何视觉变化（无 `:hover` CSS，无宽度/颜色变化）
- 单击触发折叠；拖拽（`onMouseDown`）触发 resize——同一个元素承担两种操作，用户无法区分
- 折叠后该元素变为 `width: "100%"`（在 28px 容器内），显示 `▶ / ◀` 图标，样式切换生硬无动画

**修复**：
1. 折叠条设置 `width: 12px`，`padding: 0 4px`，`touch-action: none`
2. 添加 `:hover` 状态：背景 `var(--border)` 高亮，中线颜色加深
3. 拆分折叠触发：单击触发折叠，拖拽触发 resize（用 `onClick` vs `onMouseDown` 的时间区分，或加独立折叠按钮）
4. 折叠/展开加 `transition: width 150ms ease`

---

### F-6 中间编辑区（浏览窗）无法手动调整宽度 【中】

**实测**：中间列 `style="flex: 1 1 0%; overflow: hidden; display: flex; flex-direction: column;"` 被动接受剩余空间（280px 到 960px 之间），无任何 resize handle，无法直接调整。左右两侧的 handle 只移动对应侧面板，中间列被动响应。

**用户感知**：浏览窗（编辑区）无折叠控制、无法主动调整大小，体验上"被锁死"。

**修复**：无需新增中间 handle；通过左右两侧 handle 的拖拽隐式调整中间宽度（当前逻辑已如此），但需明确在 handle hover tooltip 中说明"拖拽可调整"。中间区缺少的是**折叠快捷操作**（见 F-5 和 Phase 3 Zen Mode）。

---

### F-7 折叠状态与宽度无 localStorage 持久化 【高】

**实测**：刷新后左栏回到 240px（但实渲染 280px），右栏回到 320px，折叠状态不保留。`editorStore` 无 `persist` middleware。

---

## 参考：OpenCode Desktop / TUI 的关键设计模式

1. **Session history 是切换视图，不是侧边栏**：打开历史会话列表时，主内容区全宽切换为历史列表；关闭后切回聊天内容。会话历史不与聊天区争宽度。
2. **文件变更展示内联在聊天流中**：AI 修改了哪些文件，以卡片形式嵌在消息流里，不在单独的侧边面板中。
3. **拖拽 handle 有明显 hover 反馈**：handle 悬停时高亮放大，用户能感知"这里可以拖"。
4. **面板折叠是图标切换 + 动画**：toggle 按钮明确标识状态（展开/收起），不是隐晦的 4px 细线。
5. **聊天区永远是全宽主角**：任何辅助面板（文件树、设置、历史）都不压缩聊天区宽度——要么覆盖，要么替换，要么在聊天区之外独立布局。

---

## 当前差距全量清单

### A. 面板布局与拖拽

| 问题 | 严重程度 | 根因 | 实测数据 |
|------|---------|------|---------|
| SessionDrawer 主题色全部回退为亮色 | **极高** | `--color-*` 变量未定义，8 处硬编码 | `getComputedStyle` 返回空字符串 |
| SessionDrawer 挤占聊天列至 80px | **极高** | `flex-shrink:0; width:200px` 在 flex row 内 | 左栏 280px - Drawer 200px = **80px** |
| 会话历史按钮 accent 色不一致 | 高 | `rgba(99,102,241)` 硬编码 vs `--accent:#7c6af7` | `AgentPanel.tsx:563` |
| 左栏初始宽度 < minWidth，约束冲突 | 高 | store `leftWidth=240` vs `minWidth=280` | 实渲染 280px |
| 折叠/拖拽共用 4px 条，操作意图不清 | 高 | `ThreePanelLayout.tsx:82` | width=4px，无 hover 反馈 |
| 折叠状态 + 宽度不持久化 | 高 | `editorStore` 无 persist | 刷新即重置 |
| 中间编辑区无显式调整控制（用户感知锁死） | 中 | `flex:1` 被动接受剩余空间 | 无 handle，无折叠按钮 |
| 左栏 min/max 约束两处不一致 | 中 | 组件写 `[280,480]`，store 写 `[180,360]` | — |
| 无法同时折叠两侧栏（Zen Mode） | 中 | 无 layout preset 逻辑 | — |
| 无键盘快捷键切换折叠 | 低 | 未实现 | — |

### B. 聊天消息渲染

| 问题 | 严重程度 | 根因 |
|------|---------|------|
| Assistant 消息不渲染 Markdown | 高 | `AgentPanel` 直接渲染 `message.text`，`MarkdownPreview` 存在但未接入 |
| Tool call 参数展开后显示裸字符串 | 中 | `ToolCallCard.tsx` 展开体直接用字符串展示 |
| `auto_applied` 状态用类型 hack 判断 | 中 | `toolCall.status === ("auto_applied" as string)` — 类型不安全 |
| Tool call 展开后不显示 result 内容 | 中 | `ToolCallCard` 只渲染 args |
| 无消息时间戳 | 低 | 消息对象无 `created_at` 展示逻辑 |
| 无消息类型区分样式 | 低 | 无专属样式类 |
| 无日期分隔线 | 低 | 未实现 |

### C. 资产树

| 问题 | 严重程度 | 根因 |
|------|---------|------|
| **非 NPC 类型无法创建（slug 始终为空，按钮永远 disabled）** | **极高** | `AssetTree.tsx:25` `slugify()` 将中文替换为 `-` 后清空非字母字符，纯中文名称结果为空字符串；NPC 能用是因为名称含英文"NPC" |
| **删除仅软删除 DB 行，`.md` 文件保留在磁盘** | **高** | `assets.py:204` 仅 `asset.status = "deleted"`，不删除文件；sync_service 下次扫描到该文件若哈希变化会覆写 status 为 "draft"，相当于复活已删资产 |
| 无 rename 操作 | 中 | 右键菜单仅有 delete |
| 无 duplicate 操作 | 中 | 同上 |
| 无 inline 新建 | 中 | 新建只能通过顶部按钮 |
| delete 用 `window.confirm()` 原生弹框 | 中 | 未接入 shadcn/ui Dialog |
| 无多选支持 | 低 | 未实现 |
| 大型 workspace 无虚拟化 | 低 | 全量渲染 |

### D. 编辑器与 Tab

| 问题 | 严重程度 | 根因 |
|------|---------|------|
| Tab 超出上限时用 `alert()` 弹框 | 高 | `EditorCenter.tsx` 硬编码 `alert()` |
| `AssetMetaPanel` 完整实现但从未挂载 | 中 | 无父组件 import |
| 无 Tab 拖拽重排 | 低 | 未实现 |

### E. 代码质量 / 隐性 Bug

| 问题 | 严重程度 | 根因 |
|------|---------|------|
| `MentionInput` 每次 render 向 `document.head` 注入 `<style>` | 中 | TipTap mention 样式用 JS 注入 |
| `workspaceStore.activeWorkspaceId` 永远为 null | 中 | `WorkspacePage` 读 `useParams().id` 但从不写入 store |

---

## 建议落地方式

### Phase 1 — Bug 修复（直接影响可用性，优先执行）

- [x] **修复 SessionDrawer 主题色**（F-1）：将所有 `--color-surface-2` → `--bg-surface`，`--color-border` → `--border`，`--color-text` → `--text`，`--color-primary` → `--accent`，删除 `#e2e8f0` 硬编码（`SessionDrawer.tsx` 第 93/108/112/177/249/280/295 行共 8 处）。
- [x] **修复 SessionDrawer 架构**（F-3，最高优先级）：改为绝对定位覆盖层。打开时用 `position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; background: var(--bg-surface)` 覆盖聊天区，关闭时 `display: none`。删除 200px 硬编码宽度。
- [x] **修复 accent 色硬编码**（F-2）：`AgentPanel.tsx:563` 的 `rgba(99,102,241,0.1)` 改为 `color-mix(in srgb, var(--accent) 12%, transparent)`。
- [x] **对齐 leftWidth 默认值**（F-4）：`editorStore` 中 `leftWidth` 默认值改为 `280`。
- [x] **面板持久化**（F-7）：`editorStore` 通过 `zustand/middleware persist` + `partialize` 持久化 layout 四键（leftWidth/rightWidth/leftCollapsed/rightCollapsed）。
- [x] **Markdown 渲染**：`AgentPanel.tsx` 中 assistant 消息文本接入 `react-markdown + remark-gfm`，`.agent-md` CSS class。
- [x] **`ToolCallCard` 类型修复**：ToolCallStatus union 添加 `"auto_applied"`，删除 `as string`。
- [x] **Tab 超限改 Toast**：`EditorCenter.tsx` 的 `alert()` 改为 `sonner` Toast。
- [x] **修复非 NPC 类型无法创建**：`AssetTree.tsx` `slugify()` 结果为空时回退到 `${type}-${Date.now().toString(36)}`。
- [x] **修复删除：同时删除磁盘文件**：`assets.py` 删除操作调用 `file_path.unlink(missing_ok=True)` 后再软删除 DB 行。
- [x] **`workspaceStore` 同步**：`WorkspacePage` 添加 `useEffect(() => setActiveWorkspaceId(id), [id])`。

### Phase 2 — 折叠条 UX + 聊天打磨

- [x] **折叠条 UX 重设计**（F-5）：宽度 12px，`padding: 0 4px`，hover 背景高亮，折叠/展开加 `transition: width 150ms ease`，`hasMoved` ref 区分单击折叠 vs 拖拽 resize。
- [x] **ToolCallCard 结构化展示**：展开后格式化 JSON 参数，result 截断 500 字符附"展开全部"按钮。
- [x] **消息时间戳**：每条消息下方显示 `--text-subtle` 色的 `HH:mm`，hover（`title` 属性）显示完整日期时间。
- [x] **`window.confirm` → AlertDialog**：`AssetTree.tsx` 删除操作改用自定义深色主题 AlertDialog。

### Phase 3 — 资产树动作 + 面板增强

- [x] **资产树 rename / duplicate / inline 新建**：右键菜单支持重命名/复制；每个 section header 右侧加 `+` 按钮预设类型直接新建。
- [x] **挂载 `AssetMetaPanel`**：在 `EditorCenter` Tab bar 下方折叠展示 slug、status、version。
- [x] **Panel maximize（Zen Mode）**：快捷键 `Cmd+Shift+\` 同时折叠/展开左右栏。
- [x] **资产树虚拟化**：`@tanstack/react-virtual`，拍平分组树为一维行数组，`useVirtualizer` 只渲染可见区域。

---

## 不做的理由

- Tab 拖拽重排：延后，优先交互正确性
- `react-resizable-panels` 完整迁移：Phase 1 通过修复现有逻辑可解决核心痛点，迁移成本高，推迟评估
- 多选资产：需要设计 bulk action 体系，暂不在本 proposal 范围内
