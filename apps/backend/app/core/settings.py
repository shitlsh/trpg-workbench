"""App-wide settings loaded from the environment (no per-profile secrets)."""
import os

# Per-request HTTP timeout for outbound LLM/embedding API calls (OpenAI-compatible clients, Agno models).
# Default 600s: aligns with long SSE tasks (e.g. CHM 600s) and slow local inference (LM Studio);
# not a second "deadline" on top of those — it only bounds each HTTP read/write. Override if needed.
LLM_REQUEST_TIMEOUT_SECONDS: int = int(os.getenv("LLM_REQUEST_TIMEOUT_SECONDS", "600"))
