"""Lazy import for pychm (Python bindings to chmlib)."""
from __future__ import annotations

from typing import Any, Tuple

_PyChmT = Any


def _install_hint() -> str:
    return (
        "CHM support needs the Python package pychm (import name: chm). "
        "Installing only the system chmlib (e.g. brew install chmlib) is not enough — "
        "run `pip install pychm` inside apps/backend's virtualenv. "
        "If pip fails with 'chm_lib.h' not found on macOS, install headers then:\n"
        '  CFLAGS="-I$(brew --prefix chmlib)/include" '
        'LDFLAGS="-L$(brew --prefix chmlib)/lib" pip install pychm\n'
        "Linux: apt-get install libchm-dev && pip install pychm. "
        "Windows: CHM 文件导入在 Windows 上暂不支持（pychm 依赖的 C 扩展无法在 MSVC 下编译）。"
    )


def import_pychm() -> Tuple[_PyChmT, _PyChmT]:
    """Return (`chm.chm` high-level module, `chm.chmlib` C API: enumerate, resolve, …)."""
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
