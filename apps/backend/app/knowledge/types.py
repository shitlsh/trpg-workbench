"""Chunk-level type classification for knowledge library content.

ChunkType is the single source of truth for content classification.
The TypeScript union in shared-schema/src/index.ts must stay in sync.
"""
from enum import Enum


class ChunkType(str, Enum):
    """Semantic type tag applied per chunk during PDF ingest."""
    RULE = "rule"               # 规则说明、技能定义、判定机制
    EXAMPLE = "example"         # 举例说明、示例场景
    LORE = "lore"               # 世界设定、背景叙述
    TABLE = "table"             # 数值表格、技能列表、装备清单
    PROCEDURE = "procedure"     # 程序性内容：行动顺序、战斗流程
    FLAVOR = "flavor"           # 纯叙事/氛围文字，无规则信息


# ChunkType values that are relevant for rules consultation
RULE_CHUNK_TYPES: list[str] = [
    ChunkType.RULE,
    ChunkType.TABLE,
    ChunkType.PROCEDURE,
]

# ChunkType values that are relevant for lore/world-building
LORE_CHUNK_TYPES: list[str] = [
    ChunkType.LORE,
    ChunkType.EXAMPLE,
    ChunkType.FLAVOR,
]
