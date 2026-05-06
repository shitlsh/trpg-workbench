"""System-level logging configuration for the TRPG Workbench backend.

Writes to:
  <data_dir>/logs/backend.log   (rotating, max 5 MB × 3 files)

This is separate from the workspace business logs (workspace/logs/*.jsonl)
which record model calls, retrievals, and asset writes.

Call setup_logging() once at startup in server.py before uvicorn starts.
"""
from __future__ import annotations

import logging
import logging.handlers
import os
from pathlib import Path


def get_log_dir() -> Path:
    """Return the system log directory, creating it if needed.

    Uses TRPG_DATA_DIR env var if set (same as get_data_dir() in paths.py),
    so the log file is always next to app.db for easy discovery.
    """
    data_dir = Path(os.environ.get("TRPG_DATA_DIR", Path.home() / "trpg-workbench-data"))
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def setup_logging(level: str = "INFO") -> Path:
    """Configure root logger to write to backend.log and stdout.

    Returns the path of the log file.
    """
    log_dir = get_log_dir()
    log_file = log_dir / "backend.log"

    fmt = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotating file handler: 5 MB × 3 backup files
    file_handler = logging.handlers.RotatingFileHandler(
        log_file,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)

    # Console handler (captured by Tauri sidecar reader in release builds)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Avoid duplicate handlers if called more than once
    if not root.handlers:
        root.addHandler(file_handler)
        root.addHandler(console_handler)
    else:
        # Replace existing handlers (e.g. uvicorn default setup)
        root.handlers.clear()
        root.addHandler(file_handler)
        root.addHandler(console_handler)

    # Suppress noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("multipart").setLevel(logging.WARNING)

    return log_file
