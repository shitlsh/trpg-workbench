from sqlalchemy.orm import Session
from app.models.orm import RuleSetORM
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
        "id": "builtin-coc7",
        "name": "克苏鲁的呼唤 7版 (COC7)",
        "slug": "coc7",
        "description": "基于 BRP 系统的恐怖调查主题 TRPG",
        "genre": "horror",
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
        db.commit()
    finally:
        db.close()
