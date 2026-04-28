"""Lightweight local tool decorator and JSON-schema utilities.

Replaces Agno's @tool dependency while keeping existing function contracts.
"""
from __future__ import annotations

import inspect
from typing import Any, get_args, get_origin


def tool(fn):
    """Mark a callable as agent tool (Agno-compatible no-op replacement)."""
    setattr(fn, "__is_agent_tool__", True)
    return fn


def _json_type_from_annotation(annotation: Any) -> dict[str, Any]:
    if annotation is inspect._empty:
        return {"type": "string"}

    origin = get_origin(annotation)
    args = get_args(annotation)

    if origin in (list, tuple):
        item_ann = args[0] if args else str
        return {"type": "array", "items": _json_type_from_annotation(item_ann)}
    if origin is dict:
        return {"type": "object"}
    if origin is Any:
        return {"type": "string"}
    if origin is None:
        return {"type": "string"}

    if annotation in (str,):
        return {"type": "string"}
    if annotation in (int,):
        return {"type": "integer"}
    if annotation in (float,):
        return {"type": "number"}
    if annotation in (bool,):
        return {"type": "boolean"}

    # Optional[T] / Union[T, None]
    if origin is not None and args:
        non_none = [a for a in args if a is not type(None)]  # noqa: E721
        if len(non_none) == 1:
            return _json_type_from_annotation(non_none[0])

    return {"type": "string"}


def build_openai_tool_specs(tools: list[Any]) -> list[dict[str, Any]]:
    """Build OpenAI-compatible function-tool schema from Python callables."""
    specs: list[dict[str, Any]] = []
    for fn in tools:
        sig = inspect.signature(fn)
        props: dict[str, Any] = {}
        required: list[str] = []
        for name, param in sig.parameters.items():
            props[name] = _json_type_from_annotation(param.annotation)
            if param.default is inspect._empty:
                required.append(name)
        doc = (inspect.getdoc(fn) or "").strip()
        desc = doc.splitlines()[0].strip() if doc else f"Tool: {fn.__name__}"
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": fn.__name__,
                    "description": desc,
                    "parameters": {
                        "type": "object",
                        "properties": props,
                        "required": required,
                        "additionalProperties": False,
                    },
                },
            }
        )
    return specs
