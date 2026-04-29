from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.utils.paths import get_db_path


class Base(DeclarativeBase):
    pass


def _get_engine():
    db_url = f"sqlite:///{get_db_path()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = _get_engine()
    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())
    return _SessionLocal


def init_db():
    from app.models import orm  # noqa: F401 – ensure models are registered
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _run_migrations(engine)


def _run_migrations(engine) -> None:
    """Lightweight column-add migrations for SQLite (no Alembic)."""
    migrations = [
        "ALTER TABLE rule_sets ADD COLUMN default_prompt_profile_id TEXT",
        "ALTER TABLE llm_profiles ADD COLUMN strict_compatible BOOLEAN DEFAULT 0",
        # M30: add description and template_md to custom asset type configs
        "ALTER TABLE custom_asset_type_configs ADD COLUMN description TEXT",
        "ALTER TABLE custom_asset_type_configs ADD COLUMN template_md TEXT",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(__import__("sqlalchemy").text(sql))
                conn.commit()
            except Exception:
                # Column already exists – ignore
                pass


def get_db():
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
