 # M13：UI 视觉语言升级

**前置条件**：无强依赖（纯前端视觉改动，可独立于其他 milestone 启动）。参考背景来自 M1–M12 完成后对产品现状的 benchmark review。

**状态：✅ 已完成（commit f2cd73c）**

**目标**：参照 Inscriptor 的彩色 per-type 图标体系与排版密度机制，为 trpg-workbench 建立一套清晰的视觉语言——每种资产类型有独立彩色图标、文字颜色有三档梯度、选中状态有持久焦点指示，让工作台在资产数量增多后仍保持可扫视性与创作控制感。

---

## 背景与动机

当前产品的视觉体验存在三个明显短板，在 benchmark review 中被评级为 high priority：

- `docs/benchmark-reviews/completed/2026-04-23_inscriptor-visual-language.md`
- `docs/benchmark-reviews/completed/2026-04-23_inscriptor-layout-density.md`

**问题一**：所有资产类型在资产树中使用同一个灰色 `<File>` 图标（`AssetTree.tsx:250`），用户只能靠读文字标签来区分类型，资产数量 > 10 后扫视成本高。

**问题二**：颜色系统只有 `--text` / `--text-muted` 两档，缺少第三档 `--text-subtle`，导致时间戳、计数、占位提示与辅助说明文字在同一视觉重量层，信息层次不清晰。

**问题三**：资产树选中状态与 hover 状态视觉上无区别，用户无法直观判断"当前打开的是哪个资产"。

---

## 范围声明

### A 类：当前实现（本 milestone 必须完成）

**A1：CSS 颜色变量扩充**

在 `apps/desktop/src/index.css` 中新增：
- 10 个资产类型颜色变量（`--color-type-*`），dark/light 双套
- `--text-subtle` 第三档文字颜色变量
- `--sp-1` ~ `--sp-6` spacing scale 变量
- `--active-bar-width: 3px`

**A2：资产类型视觉辅助函数**

新建 `apps/desktop/src/lib/assetTypeVisual.ts`，导出：
- `getAssetTypeIcon(type)` → Lucide 图标组件
- `getAssetTypeColor(type)` → CSS 变量字符串
- `getAssetTypeLabel(type)` → 中文标签（从 AssetTree 中迁移过来）

**A3：AssetTree 彩色图标 + Active 状态**

修改 `apps/desktop/src/components/editor/AssetTree.tsx`：
- 每个资产条目使用对应类型的 Lucide 图标 + 颜色（通过 `assetTypeVisual.ts`）
- 选中态：左侧 3px 彩色 border + 类型色 8% 透明度背景
- 区分 hover / active / default 三种状态
- 使用 `useEditorStore` 中的 `activeTabId` 判断当前选中资产

**A4：首页功能导航图标**

修改 `apps/desktop/src/pages/HomePage.tsx`：
- 顶部四个功能按钮（规则集/知识库/模型配置/用量观测）各加一个 Lucide 图标
- 规则集 → `BookMarked`，知识库 → `Library`，模型配置 → `Cpu`，用量观测 → `BarChart2`

**A5：Agent 面板资产引用列表图标对齐**

修改 `apps/desktop/src/components/agent/AgentPanel.tsx`（以及相关子组件）：
- Agent 响应中"将修改/创建的资产列表"使用相同的彩色图标体系
- 保证左栏资产树 ↔ 右栏 Agent 面板视觉语言一致

### B 类：后续扩展（不强制当前实现）

- **B1：全局 spacing 统一**：将存量组件的硬编码 padding/margin 收敛到 `--sp-*` 变量。工程量大，分散到后续各 milestone 中自然推进。
- **B2：资产类型颜色在 Tab 标签中展示**：当前 Tab 栏无颜色区分，可在 Tab 标题左侧加一个 3px 彩色点。优先级次于 A3。

### C 类：明确不承诺

- 不引入任何新 UI 组件库或图标库（Lucide React 已满足需求）
- 不修改三栏布局结构或路由
- 不修改后端任何逻辑
- 不改变 AssetType 枚举定义（只改前端视觉映射）
- 不照搬 Inscriptor 的品牌色或整体视觉风格

---

## 文件结构

### 新增文件

```
apps/desktop/src/lib/assetTypeVisual.ts   ← 资产类型视觉映射辅助函数（新建）
```

### 修改文件

```
apps/desktop/src/index.css                ← 新增颜色变量、spacing scale
apps/desktop/src/components/editor/AssetTree.tsx   ← 彩色图标 + active 状态
apps/desktop/src/pages/HomePage.tsx       ← 功能导航图标
apps/desktop/src/components/agent/AgentPanel.tsx   ← 资产列表彩色图标对齐
```

---

## 关键设计约束

### 颜色变量不硬编码

所有图标颜色通过 `assetTypeVisual.ts` 的 `getAssetTypeColor()` 返回 CSS 变量字符串（如 `"var(--color-type-npc)"`），组件直接使用此字符串，不硬编码十六进制值。

### Active 状态由 Store 驱动

```tsx
// AssetTree 中判断 active
const { activeTabId } = useEditorStore();
const isActive = activeTabId === asset.id;
```

不使用组件内 local state 跟踪选中状态，确保关闭 Tab 时 active 高亮能正确消失。

### 图标尺寸统一

- 资产树中图标：`size={13}`
- Agent 面板资产列表中图标：`size={13}`
- 首页导航按钮图标：`size={15}`

---

## Todo

### A1：CSS 颜色变量扩充

- [x] **A1.1**：`index.css` — 在 dark theme 中新增 10 个 `--color-type-*` 变量
- [x] **A1.2**：`index.css` — 在 light theme 中新增对应的 10 个 `--color-type-*` 变量（适当调深以保证对比度）
- [x] **A1.3**：`index.css` — 新增 `--text-subtle`（dark: `#666`，light: `#a0998f`）
- [x] **A1.4**：`index.css` — 新增 `--sp-1` ~ `--sp-6` spacing scale 变量

### A2：资产类型视觉辅助函数

- [x] **A2.1**：新建 `src/lib/assetTypeVisual.ts`，实现 `getAssetTypeIcon` / `getAssetTypeColor` / `getAssetTypeLabel`，覆盖全部 10 种 AssetType

### A3：AssetTree 彩色图标 + Active 状态

- [x] **A3.1**：`AssetTree.tsx` — 引入 `assetTypeVisual.ts`，替换分类标题区域的图标（每个分类标题旁加对应颜色图标）
- [x] **A3.2**：`AssetTree.tsx` — 替换每个资产条目的 `<File>` 图标为对应类型图标
- [x] **A3.3**：`AssetTree.tsx` — 从 `useEditorStore` 读取 `activeTabId`，实现 active 高亮（左 border + 浅色背景）
- [x] **A3.4**：`AssetTree.tsx` — 确保 hover / active / default 三种状态视觉可区分

### A4：首页功能导航图标

- [x] **A4.1**：`HomePage.tsx` — 四个功能按钮各加对应 Lucide 图标（BookMarked / Library / Cpu / BarChart2）

### A5：Agent 面板资产引用列表图标对齐

- [x] **A5.1**：`AgentPanel.tsx` — 找到资产列表渲染位置，引入 `assetTypeVisual.ts`，替换为彩色图标

---

## 验收标准

1. 打开 Workspace 后，资产树中 NPC 类型条目显示青色 `Users` 图标，怪物类型显示橙色 `Skull` 图标，其余类型同理，不出现灰色 `File` 图标
2. 点击资产树中某个资产，该条目出现左侧 3px 彩色 border 和浅色背景高亮；切换到其他资产后，前一个高亮消失
3. 在 dark/light 两种主题下，10 种类型颜色均清晰可辨（无对比度不足情况）
4. 首页顶部四个功能按钮均有对应图标显示
5. Agent 面板中"将修改的资产"列表与资产树使用相同图标体系（同类型图标颜色一致）
6. 无 TypeScript 类型错误，`pnpm build` 通过

---

## 与其他里程碑的关系

```
M12（Agent 透明度，RAG 引用可展开）
  └── M13（UI 视觉语言升级）← 本 milestone
        └── B2（Tab 标签颜色点，可并入后续 milestone）
```

---

## 非目标

- 不修改三栏布局、路由、状态管理架构
- 不引入新的图标库或 UI 组件库
- 不全量替换存量组件的 spacing（只新增变量，不做全局替换）
- 不修改后端任何代码
- 不要求 Inscriptor 品牌风格一致，只借鉴"彩色 per-type 图标 + 信息层次"机制
