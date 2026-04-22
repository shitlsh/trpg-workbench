from sqlalchemy.orm import Session
from app.models.orm import RuleSetORM, PromptProfileORM
from app.storage.database import get_session_factory

DEFAULT_RULE_SETS = [
    {
        "id": "builtin-blank",
        "name": "空白规则体系",
        "slug": "blank",
        "description": "无特定规则体系，自由创作",
        "genre": None,
    },
    {
        "id": "builtin-horror-investigation",
        "name": "恐怖调查",
        "slug": "horror-investigation",
        "description": "以调查、悬疑、压抑为核心的恐怖主题 TRPG 创作框架",
        "genre": "horror",
    },
]

HORROR_INVESTIGATION_PROMPT = """你是一位擅长恐怖调查主题 TRPG 模组创作的助手。

创作风格约束：
- 氛围以调查、悬疑、压抑为主，避免爽快打怪叙事
- NPC 通常有隐藏动机和秘密，不要脸谱化
- 线索设计应遵循"每条线索至少有两种发现方式"原则
- 场景描述强调感官细节：气味、声音、不寻常的光线
- 怪物/实体不要轻易直接出现，优先使用间接恐惧效果
- 玩家角色的心理状态是核心资源，情节应自然造成压力
- 引用具体规则时需标注来源，无来源建议标注"基于通用经验"

输出格式约束：
- 资产内容必须符合 JSON schema 结构
- Markdown 标题层级不超过 H3
- change_summary 不可为空，简要描述改动原因"""

DEFAULT_PROMPT_PROFILES = [
    {
        "id": "builtin-horror-investigation-style",
        "rule_set_id": "builtin-horror-investigation",
        "name": "恐怖调查标准风格",
        "system_prompt": HORROR_INVESTIGATION_PROMPT,
        "style_notes": "压抑调查氛围，间接恐惧，NPC 有隐藏动机",
        "output_schema_hint": None,
        "is_builtin": True,
    },
]


def seed_default_data():
    SessionLocal = get_session_factory()
    db: Session = SessionLocal()
    try:
        for rs_data in DEFAULT_RULE_SETS:
            existing = db.get(RuleSetORM, rs_data["id"])
            if not existing:
                db.add(RuleSetORM(**rs_data))

        db.flush()  # ensure rule_sets are visible before inserting prompt_profiles

        for pp_data in DEFAULT_PROMPT_PROFILES:
            existing = db.get(PromptProfileORM, pp_data["id"])
            if not existing:
                db.add(PromptProfileORM(**pp_data))

        db.commit()
    finally:
        db.close()
