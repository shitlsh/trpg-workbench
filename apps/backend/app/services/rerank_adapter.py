"""Rerank adapter: routes rerank calls to Jina / Cohere / OpenAI-compatible."""
from __future__ import annotations
import time
from typing import Any
import httpx


class RerankResult:
    def __init__(self, index: int, score: float, text: str):
        self.index = index
        self.score = score
        self.text = text


def rerank(
    query: str,
    documents: list[str],
    *,
    provider_type: str,
    model_name: str,
    api_key: str | None,
    base_url: str | None = None,
    top_n: int | None = None,
) -> list[RerankResult]:
    """
    Rerank documents given a query.

    Returns a list of RerankResult sorted by score descending (best first).
    The list may be shorter than top_n if fewer documents are available.
    top_n=None returns all documents reranked.

    Raises RuntimeError on API error or missing credentials.
    """
    if not documents:
        return []

    if provider_type == "jina":
        return _rerank_jina(query, documents, model_name=model_name, api_key=api_key, top_n=top_n)
    elif provider_type == "cohere":
        return _rerank_cohere(query, documents, model_name=model_name, api_key=api_key, top_n=top_n)
    elif provider_type == "openai_compatible":
        if not base_url:
            raise RuntimeError("base_url is required for openai_compatible rerank provider")
        return _rerank_openai_compatible(query, documents, model_name=model_name, api_key=api_key, base_url=base_url, top_n=top_n)
    else:
        raise RuntimeError(f"Unknown rerank provider_type: {provider_type}")


def test_connection(
    *,
    provider_type: str,
    model_name: str,
    api_key: str | None,
    base_url: str | None = None,
) -> tuple[bool, int | None, str | None]:
    """
    Minimal connectivity test: send a 2-doc rerank request and confirm response.
    Returns (success, latency_ms, error_message).
    """
    start = time.monotonic()
    try:
        results = rerank(
            "test",
            ["hello world", "foo bar"],
            provider_type=provider_type,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
            top_n=2,
        )
        if not results:
            return False, None, "Rerank returned empty results"
        latency_ms = int((time.monotonic() - start) * 1000)
        return True, latency_ms, None
    except Exception as exc:
        return False, None, str(exc)


def _rerank_jina(
    query: str,
    documents: list[str],
    *,
    model_name: str,
    api_key: str | None,
    top_n: int | None,
) -> list[RerankResult]:
    if not api_key:
        raise RuntimeError("Jina rerank requires an API key")

    payload: dict[str, Any] = {
        "model": model_name,
        "query": query,
        "documents": documents,
        "return_documents": False,
    }
    if top_n is not None:
        payload["top_n"] = top_n

    resp = httpx.post(
        "https://api.jina.ai/v1/rerank",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Jina rerank error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    results = []
    for item in data.get("results", []):
        idx = item["index"]
        score = item["relevance_score"]
        results.append(RerankResult(index=idx, score=score, text=documents[idx]))
    results.sort(key=lambda r: r.score, reverse=True)
    return results


def _rerank_cohere(
    query: str,
    documents: list[str],
    *,
    model_name: str,
    api_key: str | None,
    top_n: int | None,
) -> list[RerankResult]:
    if not api_key:
        raise RuntimeError("Cohere rerank requires an API key")

    payload: dict[str, Any] = {
        "model": model_name,
        "query": query,
        "documents": documents,
        "return_documents": False,
    }
    if top_n is not None:
        payload["top_n"] = top_n

    resp = httpx.post(
        "https://api.cohere.ai/v1/rerank",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Cohere rerank error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    results = []
    for item in data.get("results", []):
        idx = item["index"]
        score = item["relevance_score"]
        results.append(RerankResult(index=idx, score=score, text=documents[idx]))
    results.sort(key=lambda r: r.score, reverse=True)
    return results


def _rerank_openai_compatible(
    query: str,
    documents: list[str],
    *,
    model_name: str,
    api_key: str | None,
    base_url: str,
    top_n: int | None,
) -> list[RerankResult]:
    url = base_url.rstrip("/") + "/rerank"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload: dict[str, Any] = {
        "model": model_name,
        "query": query,
        "documents": documents,
    }
    if top_n is not None:
        payload["top_n"] = top_n

    resp = httpx.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"Rerank error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    results = []
    for item in data.get("results", []):
        idx = item["index"]
        score = item.get("relevance_score", item.get("score", 0.0))
        results.append(RerankResult(index=idx, score=score, text=documents[idx]))
    results.sort(key=lambda r: r.score, reverse=True)
    return results
