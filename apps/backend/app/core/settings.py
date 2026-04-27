"""App-wide settings loaded from the environment (no per-profile secrets)."""
import os

# HTTP timeout for outbound LLM API calls (seconds). Used by model_from_profile / OpenAI-compatible clients.
LLM_REQUEST_TIMEOUT_SECONDS: int = int(os.getenv("LLM_REQUEST_TIMEOUT_SECONDS", "60"))
