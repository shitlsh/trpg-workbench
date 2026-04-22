"""Prompt Registry – unified loader for all Agent prompts.

Usage:
    from app.prompts import load_prompt
    system_prompt = load_prompt("director", "system")
    filled = load_prompt("plot", "outline", premise="...", rule_set="...", knowledge_context="...")
"""
import os
import re
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent


def load_prompt(agent: str, phase: str, **vars) -> str:
    """
    Load and render a prompt template.
    agent: "director" | "plot" | "npc" | "monster" | "lore" | "rules" | "consistency" | "document"
    phase: "system" | "clarification" | "planning" | "outline" | "stages" | "clues" | etc.
    vars: template variables substituted via str.format_map()
    """
    path = _PROMPTS_DIR / agent / f"{phase}.txt"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {agent}/{phase}.txt")
    
    text = path.read_text(encoding="utf-8")
    
    # Expand {{include:_shared/foo.txt}} directives
    def _include(match):
        inc_path = _PROMPTS_DIR / match.group(1)
        if inc_path.exists():
            return inc_path.read_text(encoding="utf-8").strip()
        return f"[MISSING INCLUDE: {match.group(1)}]"
    
    text = re.sub(r"\{\{include:([^}]+)\}\}", _include, text)
    
    # Substitute template variables if any are provided
    if vars:
        text = text.format_map(vars)
    
    return text
