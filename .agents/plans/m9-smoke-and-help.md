# M9：前端 Smoke Test、截图与帮助文档系统

**前置条件**：M8 完成（知识库预览与 Rerank 已落地），前端主要功能页面已稳定。

**目标**：为当前 UI 状态建立可重复的 smoke verification 流程，产出可用的应用内帮助文档，并在 Tauri 应用中接入 Help / Getting Started 入口。

---

## 背景与动机

M1–M8 完成后，项目已具备完整的核心功能链路：工作空间管理、知识库导入与预览、模型配置与路由、Agent 创作工作台。但目前：

- 没有任何 UI 层面的 smoke verification——每次改动后只能靠人工点击验证
- 没有面向用户的引导文档——新用户首次打开不知道从哪里开始
- Tauri 应用没有 Help 菜单入口——用户无法在应用内找到帮助
- 截图记录为空——PR review 和 onboarding 都缺乏视觉参考

M9 填补这三个空白，同时建立"每次里程碑完成后运行 smoke + 更新文档"的工作习惯。

---

## 范围声明

### M9 当前实现（A 类）

**A1：前端 Smoke Test 与截图产物**
1. 基于 `webapp-testing` skill 实现关键页面 smoke test 脚本
2. 每个关键页面产出 raw full-page PNG 截图
3. 产出 `smoke-report.md`（pass/fail/skipped 表格）
4. 输出目录：`docs/ui-snapshots/<YYYY-MM-DD>/`
5. 维护 `docs/ui-snapshots/latest-manifest.json`

**A2：帮助文档草稿生成**
6. 基于截图和 DOM 状态生成四篇 Markdown 帮助文档草稿
7. 草稿输出到 `docs/ui-snapshots/<date>/help/*.md`（不自动覆盖应用内源文件）
8. 用户明确确认后，手动同步到 `apps/desktop/src/help/*.md`

**A3：Tauri Help 菜单接入**
9. 在 `src-tauri/src/lib.rs` 中注册 Help 菜单（MenuBuilder）
10. 菜单点击触发 Tauri event → 前端 React Router 跳转到 `/help/getting-started`

**A4：应用内帮助页（最小可行版）**
11. 新增路由 `/help/:doc`
12. 页面组件加载并渲染对应 Markdown 文件
13. 包含四篇文档的侧边导航

### M9 后续扩展（B 类，规划为扩展，不强制当前实现）

- **B1：截图回归对比** — 两次运行之间的 pixel diff，自动标注变化区域
- **B2：帮助页搜索** — 在 `/help` 页内全文搜索四篇文档
- **B3：多语言帮助** — 英文版帮助文档（英文 UI 支持）
- **B4：自动同步触发** — CI/CD 中在里程碑 tag 时自动运行 smoke + 同步文档
- **B5：更完整的 onboarding** — 交互式引导（tour / highlight），首次启动引导流程

### M9 明确不承诺（C 类）

- 完整 E2E 回归测试（不是 M9 的目标，属于独立测试体系）
- 后端 API 测试（M9 只测前端渲染）
- 自动化截图对比门控 PR 合并
- 图片压缩、截图 CDN 分发

---

## 关键页面范围

| 优先级 | Slug | 路由 | 说明 |
|--------|------|------|------|
| P0 | `home` | `/` | 首页，工作空间入口 |
| P0 | `settings-models` | `/settings/models` | 模型配置，LLM/Embedding/Rerank |
| P0 | `knowledge` | `/knowledge` | 知识库管理，文档预览 |
| P1 | `workspace` | `/workspace/:id` | 主工作台（需有 workspace） |
| P1 | `workspace-settings` | `/workspace/:id/settings` | Workspace 模型路由配置 |

P0 页面始终测试；P1 页面若无 workspace 则标记为 `skipped`，不算失败。

> 运行前须根据当前 `apps/desktop/src/App.tsx` 确认实际路由，以代码为准。

---

## 文件结构

### 截图与报告产物

```
docs/
├── ui-snapshots/
│   ├── latest-manifest.json          ← 指向最新一次运行的日期目录
│   └── 2026-04-22/
│       ├── screenshots/
│       │   ├── home.png
│       │   ├── settings-models.png
│       │   ├── knowledge.png
│       │   ├── workspace.png
│       │   └── workspace-settings.png
│       ├── smoke-report.md
│       └── help/
│           ├── getting-started.md
│           ├── model-setup.md
│           ├── knowledge-import.md
│           └── start-creating.md
```

### 应用内帮助源文件（用户确认后同步）

```
apps/desktop/src/help/
├── getting-started.md
├── model-setup.md
├── knowledge-import.md
└── start-creating.md
```

这四个文件由 Tauri `bundle.resources` 打包进二进制，运行时通过
`@tauri-apps/api/path` 的 `resolveResource()` 读取。

### Tauri / 前端新增文件

```
apps/desktop/src-tauri/src/lib.rs    ← 修改：注册 Help 菜单
apps/desktop/src/pages/HelpPage.tsx  ← 新建：帮助页组件
apps/desktop/src/App.tsx             ← 修改：新增 /help/:doc 路由
```

---

## Tauri Help 菜单接入方案

### 推荐方案：Tauri Event → React Router

1. **`lib.rs`** 中用 `MenuBuilder` 注册 Help 菜单，包含"Getting Started"入口
2. `on_menu_event` 触发时通过 `app.emit("open_help", "getting-started")` 向前端发事件
3. **`App.tsx`** 中用 `@tauri-apps/api/event` 的 `listen()` 接收事件，调用 `navigate("/help/getting-started")`

选择此方案原因：
- 复用现有 SPA 路由和深色主题 CSS 变量，零额外样式负担
- 无第二窗口的独立加载周期
- 后续扩展帮助页（搜索、多语言）在同一 React 树内完成

### 备选方案（不推荐）

开一个独立 `WebviewWindow` 指向 `help.html`。实现更简单，但样式隔离、无法共享状态，B2/B3 扩展成本更高。

---

## 应用内帮助页设计

路由：`/help/:doc`

组件结构：
```
HelpPage
├── 左侧导航（四篇文档链接，高亮当前激活项）
└── 右侧内容区
    └── Markdown 渲染器（react-markdown 或等效库）
```

Markdown 文件加载方式（两种可选）：
- **Vite `?raw` import**（开发期，第一版优先保证此路径可用）：`import content from "../help/getting-started.md?raw"`
- **`resolveResource()` + `readTextFile()`**（打包后 Tauri 环境）：在运行时读取 bundled resource；此路径作为后续验证项，不要求第一步同时打通

第一版 HelpPage 只需在 `pnpm tauri dev` 模式下可用即为验收通过。

---

## Todo

### A1：Smoke Test 脚本（从零实现）

> `tauri-ui-smoke-and-docs` skill 中提到的脚本**尚不存在**，A1 的第一项工作就是创建它。

#### A1.0：决策前置

在写任何脚本之前，先完成以下确认：

- [ ] 读取 `apps/desktop/src/App.tsx`，列出当前实际路由（不依赖 plan 中的推荐值）
- [ ] 检查 `apps/desktop/package.json` 和 `apps/backend/.venv`，确认 Playwright 运行时：
  - Python：`apps/backend/.venv/lib/python*/site-packages/playwright`
  - Node：`apps/desktop/node_modules/playwright` 或 `@playwright/test`
  - **以实际存在的运行时为准，不假定哪个已安装**

#### A1.1：确定脚本位置与输出目录

脚本放在项目根目录下的专用目录，与其他 tooling 脚本并排：

```
scripts/smoke/
└── smoke_and_screenshot.py   # 或 .js/.ts，取决于 A1.0 的运行时决策
```

输出目录：

```
docs/ui-snapshots/<YYYY-MM-DD>/
├── screenshots/
├── smoke-report.md
└── help/          ← A2 阶段填充，A1 阶段可为空目录
```

`docs/ui-snapshots/latest-manifest.json` 由脚本自动写入。

#### A1.2：最小可运行版本（P0 页面，无断言）

第一版脚本只做一件事：启动 Playwright，访问三个 P0 页面，各截一张图，不报错即为成功。

目标：能在本地 `pnpm dev` + 后端运行的环境下跑通，产出三张 PNG。

验收：
- [ ] 脚本存在于 `scripts/smoke/`，有 `--help` 输出
- [ ] 在 dev server 已运行的前提下可直接执行（单步命令，无需额外配置）
- [ ] 产出 `home.png`、`settings-models.png`、`knowledge.png`（文件 > 10KB）

#### A1.3：加入断言与完整页面集

在 A1.2 跑通后扩展：

- [ ] 为三个 P0 页面添加最小 DOM 断言（以实际 UI 为准，不硬编码文案）
- [ ] 加入 P1 页面（workspace、workspace-settings）；若无 workspace 则 `skipped`
- [ ] 所有断言失败非致命：记录错误，继续执行下一页面

#### A1.4：生成 smoke-report.md 和 latest-manifest.json

- [ ] 脚本结束时写入 `smoke-report.md`（格式见 plan 的 Smoke Report 节）
- [ ] 写入 `docs/ui-snapshots/latest-manifest.json`
- [ ] README 或脚本顶部注释中说明如何运行（dev server 已启动时和未启动时两种入口）

### A2：帮助文档草稿

- [ ] 基于截图和 DOM 生成 `getting-started.md` 草稿
- [ ] 基于截图和 DOM 生成 `model-setup.md` 草稿
- [ ] 基于截图和 DOM 生成 `knowledge-import.md` 草稿
- [ ] 基于截图和 DOM 生成 `start-creating.md` 草稿（若 workspace 页面被 skipped，相关段落应写为条件说明或跳过，不得假定该页面已存在）
- [ ] 用户确认后，将草稿同步到 `apps/desktop/src/help/`

### A3：Tauri Help 菜单

- [ ] 修改 `lib.rs`：注册 Help 菜单（MenuBuilder + on_menu_event）
- [ ] 修改 `App.tsx`：监听 `open_help` 事件，navigate 到 `/help/:doc`
- [ ] 在 `tauri.conf.json` `bundle.resources` 中注册 `src/help/**/*`

### A4：应用内帮助页

- [ ] 新建 `apps/desktop/src/pages/HelpPage.tsx`
- [ ] 实现左侧文档导航 + 右侧 Markdown 渲染
- [ ] 新增 `/help/:doc` 路由到 `App.tsx`
- [ ] 确认在 Tauri dev 模式下帮助页可正常渲染

---

## 验证步骤

### A1 验证

1. 运行 smoke 脚本，`smoke-report.md` 产出五个页面的结果（至少 home、settings、knowledge 为 pass）
2. 截图文件存在且可正常打开（不规定最小字节数；空文件或损坏文件为失败）
3. `latest-manifest.json` 指向当次日期目录

### A2 验证

4. 四篇帮助文档草稿存在于 `docs/ui-snapshots/<date>/help/`
5. 文档中的 tab 名称、按钮文案与截图一致（人工 review）
6. 同步操作仅在用户明确指令后执行

### A3 验证

7. Tauri 应用菜单中出现 Help / Getting Started 入口
8. 点击后前端跳转到 `/help/getting-started`，页面不空白

### A4 验证

9. `/help/getting-started` 渲染 Markdown，排版正常
10. 四篇文档均可通过侧边导航切换
11. 帮助页使用应用深色主题，与主界面视觉一致

---

## 与其他里程碑的关系

```
M8（知识库预览 + Rerank）
  └── M9（Smoke Test + Help Docs + Tauri Help 菜单）
        └── B1（截图回归对比，独立扩展）
        └── B2/B3（帮助页搜索/多语言，独立扩展）
```

M9 不依赖任何未完成的功能，是对已有 UI 状态的验证与文档化，可在 M8 合并后立即启动。

---

## 非目标

- 完整 E2E 回归测试体系
- 后端 API 自动化测试
- 截图 pixel diff 自动门控
- 打包版（production build）的 smoke 测试（优先测 dev server）
- 帮助内容的多语言翻译（B 类）
- 自动 onboarding tour / 高亮引导（B 类）
