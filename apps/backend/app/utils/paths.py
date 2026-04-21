import os
from pathlib import Path


def get_data_dir() -> Path:
    """Return the data directory, creating it if needed."""
    data_dir = Path(os.environ.get("TRPG_DATA_DIR", Path.home() / "trpg-workbench-data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_db_path() -> Path:
    return get_data_dir() / "app.db"
