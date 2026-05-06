"""Lazy import for pychm (Python bindings to chmlib).

On Windows, pychm depends on chmlib which cannot be compiled with MSVC.
Use `is_windows_platform()` to check if we should fall back to the
Windows-native hh.exe decompile approach instead.
"""
from __future__ import annotations

import sys
from typing import Any, Tuple

_PyChmT = Any


def is_windows_platform() -> bool:
    """Return True when running on Windows."""
    return sys.platform == "win32"


def _install_hint() -> str:
    return (
        "CHM support needs the Python package pychm (import name: chm). "
        "Installing only the system chmlib (e.g. brew install chmlib) is not enough — "
        "run `pip install pychm` inside apps/backend's virtualenv. "
        "If pip fails with 'chm_lib.h' not found on macOS, install headers then:\n"
        '  CFLAGS="-I$(brew --prefix chmlib)/include" '
        'LDFLAGS="-L$(brew --prefix chmlib)/lib" pip install pychm\n'
        "Linux: apt-get install libchm-dev && pip install pychm. "
        "Windows: CHM is handled via the built-in hh.exe decompiler (no pychm needed)."
    )


def import_pychm() -> Tuple[_PyChmT, _PyChmT]:
    """Return (`chm.chm` high-level module, `chm.chmlib` C API: enumerate, resolve, …).

    Raises RuntimeError on Windows (use hh.exe path instead) or when pychm is not installed.
    """
    if is_windows_platform():
        raise RuntimeError(
            "pychm is not available on Windows. Use the hh.exe decompile path instead."
        )
    try:
        from chm import chm as chm_hl
        from chm import chmlib as chm_c

        return chm_hl, chm_c
    except ImportError as e:
        raise RuntimeError(_install_hint()) from e


def import_chm():
    """Return only the high-level `chm.chm` module (class CHMFile, …)."""
    chm_hl, _c = import_pychm()
    return chm_hl
