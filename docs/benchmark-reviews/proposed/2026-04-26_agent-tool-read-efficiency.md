---
status: proposed
date: 2026-04-26
source: OpenCode Desktop
theme: Agent 工具组文件读写层次化设计
priority: high
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: code
---

# Agent 工具组补全中间读取层：grep_asset + read_asset_section

## 来源与借鉴理由

**参考来源：OpenCode Desktop 工具集设计**

OpenCode 的文件操作工具分为明确的五个层次，每层职责单一：

```
glob(pattern)                  → 找到哪些文件符合条件
        ↓
grep(pattern, include?)        → 在文件内搜索内容，返回匹配行+上下文，不加载全文
        ↓
read(path, offset?, limit?)    → 按行范围加载文件片段
        ↓
edit(path, old_str, new_str)   → 精确字符串替换（str_replace）
        ↓
write(path, content)           → 全量覆盖
```

**核心设计原则**：永远不因为只需要一小块内容而加载整个文件。`grep` 和带行范围的 `read`
是专门为"定点定位"而存在的中间层工具，它们让 Agent 在调用 `edit` 之前，不必把整个文件
内容推入 LLM 上下文。

值得注意的是，OpenCode 的 `grep` 内部使用 `ripgrep`，速度极快，支持跨文件搜索、
正则语法、文件模式过滤——Agent 可以先用 `grep` 确认 `old_str` 在哪个文件的哪一行，
再用 `read(offset, limit)` 只加载那几行，最后 `edit` 替换，全程不需要 LLM 看到完整文件。

## 当前差距

trpg-workbench 当前的工具层次：

```
list_assets / search_assets    → 找到哪个资产（name+summary，token 少）✅
        ↓
read_asset(slug)               → 加载完整文件（全文进 LLM 上下文）❌ 无中间层
        ↓
patch_asset(slug, old_str, …) → 精确字符串替换 ✅
update_asset(slug, content_md) → 全量覆盖 ✅
```

对照 OpenCode 的五层结构，trpg-workbench **缺失 grep 和按范围读取两个中间层**：

| OpenCode 层次 | trpg-workbench 对应 | 状态 |
|--------------|-------------------|------|
| `glob` 找文件 | `list_assets / search_assets` | ✅ 已有（语义更丰富） |
| `grep` 搜内容 | —— | ❌ **缺失** |
| `read(offset, limit)` 按范围读 | —— | ❌ **缺失** |
| `edit` str_replace | `patch_asset` | ✅ 已有 |
| `write` 全量覆盖 | `update_asset` | ✅ 已有 |

**实际 token 消耗对比（以修改 NPC 年龄为例）：**

| 工作流 | 消耗 tokens（估算） |
|--------|-------------------|
| 当前：`read_asset`(全文 ~600字) + `patch_asset` | ~800 tokens |
| OpenCode 模式：`grep_asset`(匹配行 ~30字) + `patch_asset` | ~80 tokens |
| 节省比例 | ~90% |

对大型资产（Stage/Location，2000~4000字）差距更大：全文 `read_asset` 可能消耗
2000~5000 tokens，而 `grep_asset` 返回值通常只有 50~150 tokens。

## 适合性判断

**适合**，且和 trpg-workbench 的资产结构高度匹配：

- 资产文件是结构化 Markdown（frontmatter + 标题化章节），天然适合按标题范围加载
- `grep_asset` 实现纯内存字符串操作，零外部依赖，比 OpenCode 使用 ripgrep 更轻量
- `read_asset_section` 按 Markdown 标题切分比 OpenCode 的行号范围对 LLM 更友好——
  LLM 知道"读取秘密章节"，但不知道"秘密章节在第几行"
- 复用 `patch_asset` 已有的路径解析逻辑，实现成本极低

**与 OpenCode 的差异化改造**：OpenCode 的 `grep` 和 `read(offset, limit)` 是面向
代码文件设计的（行号有语义，文件结构扁平）。trpg-workbench 的资产是 Markdown 创作
内容，**标题层次比行号更有意义**。因此：
- `grep_asset` 保留 OpenCode `grep` 的核心思路（不加载全文，返回匹配上下文）
- `read_asset_section` 替代 OpenCode `read(offset, limit)`，改用 Markdown 标题作为
  定位单元，更符合创作工具的语义

## 对创作控制感的影响

间接改善。用户感知不到工具调用细节，但会体验到：
- Agent 局部修改请求的响应速度更快（减少推理轮次）
- 大型 workspace（资产总量 >20 个，总字数 >15,000 字）时 Agent 不再因上下文耗尽
  而失败，对创作流程的打断减少

## 对 workbench 协同的影响

改善 Agent 面板（右栏）与资产树（左栏）之间的协同可靠性：
- 资产数量增多后，Agent 处理多资产任务（如"检查所有 NPC 的年龄并统一格式"）时
  不再受单次上下文窗口的硬性约束
- 为后续 self-correction 循环中的多资产一致性修正铺路

## 对 1.0 用户价值的影响

**中高**。少量资产时（<10 个）影响不明显；资产数量和单文件大小增长后会成为
Agent 可靠性的关键瓶颈。越早实现，越不会在 1.0 发布前突然暴露。

## 建议落地方式

### 新增 `grep_asset(asset_slug, pattern, context_lines=2)` 工具

**对标**：OpenCode `grep` 工具（搜索内容，返回匹配行 + 上下文，不加载全文）

**功能说明：**
- 在单个资产文件内做字面量或简单正则搜索
- 返回所有匹配行及其上下 `context_lines` 行上下文
- 包含行号（帮助理解位置，`patch_asset` 不依赖行号）
- 匹配数 > 10 时截断并提示
- 无匹配时明确返回空 matches，不静默

**示例返回：**
```json
{
  "asset_slug": "wang-wu",
  "pattern": "年龄",
  "matches": [
    {
      "line": 12,
      "context": "## 基本信息\n年龄：35 岁，外貌沧桑\n动机：寻找失踪的女儿"
    }
  ]
}
```

**典型 Agent 使用模式：**
```
grep_asset("wang-wu", "年龄")
  → 得到 context，从中复制精确 old_str
patch_asset("wang-wu", "年龄：35 岁", "年龄：45 岁")
  → 直接替换，无需 read_asset 全文
```

**实现位置：** `apps/backend/app/agents/tools.py`，复用 `patch_asset` 路径解析逻辑。
加入 `ALL_TOOLS`，更新 `system.txt`。

---

### 新增 `read_asset_section(asset_slug, heading)` 工具

**对标**：OpenCode `read(path, offset, limit)` 的语义升级版——用 Markdown 标题
代替行号作为定位单元，更适合创作内容

**功能说明：**
- 按 Markdown 标题名（支持模糊匹配，不区分大小写）截取单章节内容
- 返回从匹配标题行到下一个同级或更高级标题之前的全部文本
- 找不到标题时返回明确错误，**不回退到全文加载**（防止 token 意外暴增）
- 支持多级标题（`##`、`###`）

**示例返回：**
```json
{
  "asset_slug": "old-mill",
  "heading": "秘密",
  "content": "## 秘密\n\n磨坊地下室有一个封印已久的传送门……"
}
```

**典型场景：** Agent 需要修改 Stage 资产的"幕结构"章节（Stage 全文可能 2000+ 字，
该章节只有 300 字），先 `read_asset_section` 加载章节，再 `patch_asset` 精确修改。

**实现位置：** `apps/backend/app/agents/tools.py`。加入 `ALL_TOOLS`，更新 `system.txt`。

---

### `system.txt` 更新

**工具列表"读取类"新增两条：**
```
- `grep_asset(asset_slug, pattern, context_lines?)` — 在资产文件内搜索文本，返回匹配行及上下文；
  **局部修改前定位 old_str 的首选，无需 read_asset 全文**
- `read_asset_section(asset_slug, heading)` — 按 Markdown 标题名加载单章节；
  适合大型资产（Stage/Location/Lore）的章节级修改
```

**"行为规范"新增第 7 条：**
```
7. **读取策略**：需要查找资产内特定内容时，优先 `grep_asset` 定位（极低 token）；
   需要理解某个章节时用 `read_asset_section`；仅在需要理解资产完整结构时才使用
   `read_asset` 全文加载。避免用 `read_asset` 只为了找一个字段值。
```

**在示例 3 中替换为更完整的局部修改示范：**
```
示例 3（正确，局部修改）：
用户："把 NPC 王五的年龄改成 45 岁"
正确顺序：
  grep_asset("wang-wu", "年龄")  → 得到精确原文
  patch_asset("wang-wu", "年龄：35 岁，外貌沧桑", "年龄：45 岁，外貌沧桑")

示例 4（错误，不必要的全文加载）：
用户："把 NPC 王五的年龄改成 45 岁"
错误行为：read_asset("wang-wu")（加载全文）→ patch_asset(...)
```

---

## 暂不实现的能力（及理由）

**跨资产 grep（扫描整个 workspace）：**
暂缓。跨文件扫描返回结果噪音大，且 `search_assets` + 逐个 `grep_asset` 已能覆盖
绝大多数场景。待资产量到达 50+ 后再评估。

**`read_asset` 行范围参数：**
不做。行号对 Markdown 创作内容无语义意义，Agent 无法预判目标在哪几行。
`read_asset_section` 基于标题语义定位是更适合的替代方案。
