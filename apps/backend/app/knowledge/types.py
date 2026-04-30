"""Chunk-level type classification for knowledge library content.

ChunkType is the single source of truth for content classification.
The TypeScript union in shared-schema/src/index.ts must stay in sync.
"""
from enum import Enum


class ChunkType(str, Enum):
    """Semantic type tag applied per chunk during PDF/CHM ingest.

    All types are content-dimension (not format-dimension):
    - RULE:      规则系统 — executable rules, mechanics, procedures
    - ENTITY:    游戏实体 — structured stat blocks, tables of values
    - LORE:      世界观背景 — world-building, narrative, flavor text
    - ADVENTURE: 冒险剧情 — module scenes, encounter setups, GM guidance
    - APPENDIX:  辅助资料 — indexes, glossaries, copyright pages
    - NONE:      无分类   — TOC pages, covers, unclassifiable content
                           (treated as conservative fallback in retrieval)
    """
    RULE      = "rule"       # 规则系统：技能定义、检定机制、战斗规则、操作流程等可执行规则正文
    ENTITY    = "entity"     # 游戏实体：怪物/装备/物品/NPC 数值数据块，以结构化数据为主
    LORE      = "lore"       # 世界观背景：世界设定、历史叙述、背景故事、氛围文字等叙述性内容
    ADVENTURE = "adventure"  # 冒险剧情：模组场景、遭遇设定、剧情描述、GM 指引、跑团日志
    APPENDIX  = "appendix"   # 辅助资料：索引、术语表、版权页、参考文献等导航/辅助内容
    NONE      = "none"       # 无分类：目录页、封面、空白页、无法明确归类的内容


# ChunkType values for rules/mechanics consultation (used by consult_rules tool)
RULE_CHUNK_TYPES: list[str] = [
    ChunkType.RULE,
    ChunkType.ENTITY,
]

# ChunkType values for lore/narrative consultation (used by consult_lore tool)
LORE_CHUNK_TYPES: list[str] = [
    ChunkType.LORE,
    ChunkType.ADVENTURE,
]


def build_chunk_types_section() -> str:
    """生成 chunk type 枚举说明段落，供注入各 Agent system prompt。

    Returns a formatted Chinese description of all ChunkType values,
    their semantics, and retrieval grouping hints.
    """
    return """\
## 知识库内容分类（Chunk Types）

知识库中的每个内容块（chunk）带有一个语义类型标签，用于精准过滤检索结果：

- **rule**（规则系统）：可执行规则正文，包括技能定义、检定机制、战斗规则、操作流程等。
- **entity**（游戏实体）：怪物、装备、物品、NPC 等结构化数值数据块（如生物属性表、装备清单）。
- **lore**（世界观背景）：世界设定、历史叙述、背景故事、氛围文字等叙述性内容。
- **adventure**（冒险剧情）：模组场景描述、遭遇设定、剧情说明、GM 指引、跑团日志等剧情类内容。
- **appendix**（辅助资料）：索引、术语表、版权页、参考文献等导航或辅助性内容。
- **none**（无分类）：目录页、封面等无法明确归类的内容；检索时作为兜底候选自动保留。

检索建议：
- 查询规则机制/数值数据 → 优先使用 rule + entity
- 查询世界观/剧情/场景 → 优先使用 lore + adventure
- 不确定时留空，系统自动全库检索"""
