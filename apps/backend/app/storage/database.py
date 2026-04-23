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
    # M12: add director_intent column if missing (SQLite doesn't auto-add columns)
    _migrate_add_column(engine, "workflow_states", "director_intent", "TEXT")


def _migrate_add_column(engine, table: str, column: str, col_type: str):
    """Idempotently add a column to an existing table if it doesn't exist."""
    with engine.connect() as conn:
        from sqlalchemy import text
        result = conn.execute(text(f"PRAGMA table_info({table})"))
        columns = [row[1] for row in result.fetchall()]
        if column not in columns:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
            conn.commit()


def get_db():
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
