"""Embedding generation.

Reads the configured embedding provider from ModelProfile or falls back
to OpenAI text-embedding-3-small.

Supports:
- openai: text-embedding-3-small (default), text-embedding-3-large, ada-002
- local: sentence-transformers (optional, install separately)
"""
from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass
class EmbedderConfig:
    provider: str = "openai"
    model: str = "text-embedding-3-small"
    api_key: str | None = None
    base_url: str | None = None
    dimensions: int = 1536


def get_default_config() -> EmbedderConfig:
    """Return embedder config, preferring env vars for dev convenience."""
    return EmbedderConfig(
        provider="openai",
        model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
        api_key=os.environ.get("OPENAI_API_KEY"),
        dimensions=1536,
    )


async def embed_texts(texts: list[str], config: EmbedderConfig | None = None) -> list[list[float]]:
    """Embed a list of texts. Returns list of float vectors."""
    if config is None:
        config = get_default_config()

    if config.provider in ("openai", "custom"):
        return await _embed_openai(texts, config)
    elif config.provider == "local":
        return _embed_local(texts, config)
    else:
        raise ValueError(f"Unknown embedding provider: {config.provider}")


async def _embed_openai(texts: list[str], config: EmbedderConfig) -> list[list[float]]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=config.api_key or os.environ.get("OPENAI_API_KEY"),
        base_url=config.base_url,
    )
    # Batch in groups of 100 to stay within API limits
    results: list[list[float]] = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = await client.embeddings.create(model=config.model, input=batch)
        results.extend(item.embedding for item in response.data)
    return results


def _embed_local(texts: list[str], config: EmbedderConfig) -> list[list[float]]:
    """Local embedding via sentence-transformers (optional dependency)."""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise ImportError(
            "sentence-transformers not installed. "
            "Run: PIP_USER=false .venv/bin/pip install sentence-transformers"
        )
    model = SentenceTransformer(config.model)
    embeddings = model.encode(texts, convert_to_numpy=True)
    return [e.tolist() for e in embeddings]
