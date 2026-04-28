from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ProviderCapabilityPolicy:
    provider: str
    role_map: dict[str, str]
    disable_thinking: bool
    supports_tools: bool
    supports_reasoning_content: bool
    supports_stream: bool


def resolve_policy(profile, model_name: str) -> ProviderCapabilityPolicy:
    provider = (getattr(profile, "provider_type", "") or "").strip().lower()
    strict = bool(getattr(profile, "strict_compatible", False))
    base = (getattr(profile, "base_url", "") or "").lower()
    model = (model_name or "").lower()
    looks_like_deepseek = ("deepseek" in base) or ("deepseek" in model) or model.startswith("ds-")

    role_map = {
        "system": "system",
        "developer": "developer",
        "latest_reminder": "latest_reminder",
        "user": "user",
        "assistant": "assistant",
        "tool": "tool",
        "model": "assistant",
    }
    if strict:
        role_map["developer"] = "system"
        role_map["latest_reminder"] = "system"

    supports_tools = provider in {"openai", "openrouter", "openai_compatible", "anthropic", "google"}
    supports_reasoning = provider in {"openai", "openrouter", "openai_compatible"}
    supports_stream = provider in {"openai", "openrouter", "openai_compatible", "anthropic"}
    disable_thinking = strict or looks_like_deepseek

    return ProviderCapabilityPolicy(
        provider=provider,
        role_map=role_map,
        disable_thinking=disable_thinking,
        supports_tools=supports_tools,
        supports_reasoning_content=supports_reasoning,
        supports_stream=supports_stream,
    )
