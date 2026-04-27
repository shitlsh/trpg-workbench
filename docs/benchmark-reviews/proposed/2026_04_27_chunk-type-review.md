# Proposal: ChunkType 枚举 Review

**状态**：待讨论  
**来源**：2026-04-27 开发会话

## 背景

当前 `ChunkType` 枚举定义在 `apps/backend/app/knowledge/types.py`：

```python
class ChunkType(str, Enum):
    rule      = "rule"
    example   = "example"
    lore      = "lore"
    table     = "table"
    procedure = "procedure"
    flavor    = "flavor"
```

前端对应 `CHUNK_TYPES` 常量（`RuleSetPage.tsx`）：
```ts
rule      → 规则：规则说明、技能定义
example   → 示例：举例说明、示例场景
lore      → 设定：世界设定、背景叙述
table     → 表格：数值表格、装备清单
procedure → 流程：步骤性内容、战斗流程
flavor    → 氛围：纯叙事文字
```

## 问题

用户认为当前分类「不太合理」，需要 review。具体问题待讨论。

## 联动范围（改动时必须同步）

ChunkType 不只是存储标签，在以下位置有联动：

1. **后端 `ChunkType` 枚举** — `apps/backend/app/knowledge/types.py`
2. **`search_knowledge` tool schema** — AI 调用知识检索工具时，`chunk_type` 是过滤参数，工具描述/枚举会告知 AI 各类型含义
3. **前端 `CHUNK_TYPES` 常量** — `apps/desktop/src/pages/RuleSetPage.tsx`
4. **TOC 分析 LLM prompt** — `apps/backend/app/knowledge/toc_analyzer.py` 中 analyze_toc 的 system prompt 包含 chunk_type 枚举说明
5. **已入库的历史数据** — 0.1a 之前可以直接改（不考虑迁移），0.1a 之后需要迁移脚本

## 建议议题

- `rule` vs `procedure` 的边界是否清晰？
- `flavor` vs `lore` 是否需要合并？
- 是否需要增加类型（例：`stat_block` 专门用于怪物数据块）？
- 类型粒度：是否应该更粗（3–4 类）或保持现有 6 类？
