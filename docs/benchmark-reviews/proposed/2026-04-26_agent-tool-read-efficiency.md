---
status: proposed
date: 2026-04-26
source: 内部审查（工具协调分析）
theme: Agent 工具组读写协调增强
priority: high
affects_creative_control: indirect
affects_workbench_collab: yes
recommended_action: code
---

# Agent 工具组读写协调增强：补全 grep_asset、实现定点读写闭环

## 来源与借鉴理由

本 proposal 来自对当前 Director Agent 工具组的内部协调审查，非参考产品 benchmark。
审查触发点：`patch_asset` 已实现 token-efficient 写入，但**读取侧没有对等的定点工具**，
导致 Agent 每次局部修改都必须先 `read_asset` 加载全文，token 节省只完成了一半。

同期已修复的协调 Bug（已提交 `742775b`，本 proposal 不再重复）：
- `execute_patch_proposal` 双重 frontmatter（create + update 路径均受影响）
- `execute_patch_proposal` fallback scan slug 匹配不一致
- `list_assets` 缺少 `name_contains / status / limit` 过滤参数

---

## 当前差距

### 读写不对等

| 操作 | 当前工具 | token 消耗 | 问题 |
|------|---------|-----------|------|
| 找到 slug | `list_assets` / `search_assets` | 低（name+summary）| ✅ 已够用 |
| 找到文件内精确原文 | `read_asset` | **高（全文）** | ❌ 无定点工具 |
| 写入局部修改 | `patch_asset` | 低（old/new_str） | ✅ 已够用 |
| 写入全量重写 | `update_asset` | 低（仅写，不读）| ✅ 可接受 |

### 当前局部修改工作流

```
list_assets / search_assets       (~50 tokens)  → 找 slug
        ↓
read_asset(slug)                  (~数百~数千 tokens)  ← 瓶颈
        ↓
patch_asset(slug, old_str, ...)   (~50 tokens)  → 写入
```

`read_asset` 对一个 800 字的 NPC 文件会向 LLM 上下文注入完整内容，而 Agent
实际需要的只是 "年龄：35 岁" 这一行的上下文（约 30 字）。

### 没有跨资产内容定位能力

`search_assets` 搜索 name + summary，无法定位**资产内部**特定字段或文本片段。
当用户说"把所有 NPC 里提到'某组织'的描述改一下"，Agent 必须逐个 `read_asset`
才能确认哪些资产受影响，token 消耗随资产数量线性增长。

### read_asset 无法做章节级加载

大型 Stage / Lore 资产（可达 3000+ 字）如果只需修改"幕结构"这一章节，
`read_asset` 仍然加载全文，没有按 Markdown 标题切分的能力。

---

## 适合性判断

适合，且改动范围集中：
- 全部是纯后端工具函数（`tools.py`）
- 不涉及 DB schema、前端、SSE 流
- 可以复用现有的文件路径解析逻辑（与 `patch_asset` / `read_asset` 共享）
- `grep_asset` 实现本质是 Python 内存字符串操作，无外部依赖

---

## 对创作控制感的影响

间接改善。用户感知不到工具调用细节，但会感受到：
- Agent 响应更快（token 少，推理轮次少）
- 对大型 workspace 的局部修改请求更可靠（不会因上下文耗尽而出错）

---

## 对 workbench 协同的影响

改善 Agent 面板（右栏）← → 资产树（左栏）的协同效率：
- 减少 Agent 因读取全文占满上下文而无法完成多资产任务的情况
- 为后续"批量局部修改"能力铺路（如 self-correction 循环中的多资产一致性修正）

---

## 对 1.0 用户价值的影响

中高。在工作区资产数量增多（>20 个，总字数 >10,000 字）之后会明显影响 Agent
的可靠性。当前阶段少量资产时影响较小，但越早实现越不会留下技术债。

---

## 建议落地方式

### 1. 新增 `grep_asset(asset_slug, pattern, context_lines=2)` 工具

**功能：**
- 在单个资产文件内做字面量或正则搜索
- 返回所有匹配行及其上下 `context_lines` 行的上下文
- 包含行号信息（供 Agent 理解位置，但 `patch_asset` 不依赖行号）
- 若无匹配，明确返回 `{"matches": [], "message": "未找到匹配内容"}`
- 若匹配数 > 10，截断并提示

**返回格式（JSON）：**
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

**用途：**
Agent 从 `context` 里精确复制 `old_str`（含周边文本保证唯一性）直接传给 `patch_asset`，
无需 `read_asset` 全文。

**实现位置：** `apps/backend/app/agents/tools.py`，复用 `patch_asset` 的路径解析逻辑。

**加入 `ALL_TOOLS` 和 `system.txt`。**

---

### 2. 新增 `read_asset_section(asset_slug, heading)` 工具

**功能：**
- 按 Markdown 标题名（支持模糊匹配，不区分大小写）截取单个章节内容
- 返回从匹配标题到下一个同级或更高级标题之间的全部文本
- 找不到标题时返回错误，不回退到全文（避免 token 意外暴增）

**返回格式：**
```json
{
  "asset_slug": "old-mill",
  "heading": "秘密",
  "content": "## 秘密\n\n磨坊地下室有一个封印已久的传送门……"
}
```

**用途：**
对大型资产（Stage / Location / Lore）的单章节修改，Agent 先 `read_asset_section`
获取章节内容，再 `patch_asset` 精确替换，比 `read_asset` 省 60%~80% token。

**实现位置：** `apps/backend/app/agents/tools.py`。

---

### 3. `system.txt` 更新

在"行为规范"章节补充工具选择规则：

```
7. **读取策略**：需要查找资产内特定内容时，优先使用 `grep_asset` 定位（token 极低），
   或 `read_asset_section` 加载单章节；仅在需要理解资产整体结构或内容时才使用 `read_asset` 全文加载。
```

在工具列表"读取类"新增两条：
```
- `grep_asset(asset_slug, pattern, context_lines?)` — 在资产内搜索文本，返回匹配行及上下文，**局部修改前定位 old_str 的首选**
- `read_asset_section(asset_slug, heading)` — 加载资产的单个章节，避免大型资产全文加载
```

---

## 不做的理由（如适用）

**跨资产 grep（`grep_workspace(pattern)`）**：
此次暂不实现。跨资产扫描返回结果可能包含大量文件路径和片段，
反而可能造成上下文噪音，且场景相对低频。待工作区资产量到达 50+ 后再评估。

**`read_asset` 行范围参数（`offset/limit`）**：
不做。行号对 Markdown 内容没有语义意义，Agent 很难准确预判目标内容在哪几行。
`read_asset_section` 基于标题语义定位，更符合创作内容的结构。

**结构化 frontmatter 字段读取工具**：
不做。`grep_asset` 已能在 frontmatter 区域内搜索字段值（`pattern="status:"` 等），
不需要独立工具。
