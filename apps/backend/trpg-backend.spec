# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for trpg-workbench backend.

Build (from apps/backend/):
    pyinstaller trpg-backend.spec

The resulting binary at dist/trpg-backend can be tested with:
    ./dist/trpg-backend --port 17821

macOS prerequisite: brew install chmlib
"""

import sys
from pathlib import Path

backend_dir = Path(SPECPATH)  # apps/backend/

a = Analysis(
    [str(backend_dir / "server.py")],
    pathex=[str(backend_dir)],
    binaries=[],
    datas=[
        # Prompt templates
        (str(backend_dir / "app/prompts"), "app/prompts"),
    ],
    hiddenimports=[
        # uvicorn
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.loops.uvloop",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.off",
        "uvicorn.lifespan.on",
        # SQLAlchemy SQLite dialect
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.dialects.sqlite.pysqlite",
        # lancedb and dependencies
        "lancedb",
        "pyarrow",
        "pyarrow.lib",
        # pdfplumber
        "pdfplumber",
        # pychm
        "chm",
        "chm.chm",
        "chm.chmlib",
        # Providers
        "anthropic",
        "openai",
        "google.genai",
        # DuckDuckGo search
        "ddgs",
        # frontmatter
        "frontmatter",
        # FastAPI / Pydantic extras
        "fastapi",
        "pydantic",
        "pydantic_settings",
        "multipart",
        "aiofiles",
        # App entry point — must be explicit so PyInstaller includes it
        "app.main",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="trpg-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # Single-file executable
    onefile=True,
)
