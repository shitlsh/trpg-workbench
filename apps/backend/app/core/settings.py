"""App-wide settings loaded from the environment (no per-profile secrets)."""
import os


def _optional_positive_int_env(name: str) -> int | None:
    """Parse a positive integer from the environment, or None if unset/empty/invalid."""
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return None
    try:
        v = int(str(raw).strip(), 10)
    except ValueError:
        return None
    return v if v > 0 else None


# If unset: do not pass ``timeout`` to OpenAI/Agno clients (SDK / httpx defaults apply).
# If set (e.g. ``LLM_REQUEST_TIMEOUT_SECONDS=600``): per-request HTTP read timeout in seconds.
LLM_REQUEST_TIMEOUT_SECONDS: int | None = _optional_positive_int_env("LLM_REQUEST_TIMEOUT_SECONDS")
