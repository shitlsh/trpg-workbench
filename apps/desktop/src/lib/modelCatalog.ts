/**
 * Static fallback model lists shown as combobox candidates BEFORE a profile
 * has been saved and probed.  After saving, the live probe result replaces
 * these lists entirely.
 *
 * Sources (verified 2026-05):
 *   Jina  — https://api.jina.ai/v1/models (live probe filtered to rerankers)
 *   Cohere — https://docs.cohere.com/v2/docs/models (Rerank section)
 *   OpenAI — https://platform.openai.com/docs/models (Embeddings section)
 */

// ── Embedding ─────────────────────────────────────────────────────────────────
// Shown as combobox hints when user hasn't yet saved + probed the profile.

export const KNOWN_EMBEDDING_MODELS: Record<string, string[]> = {
  openai: [
    "text-embedding-3-large",
    "text-embedding-3-small",
    "text-embedding-ada-002",
  ],
  google: [
    "text-embedding-004",
    "text-multilingual-embedding-002",
  ],
  openai_compatible: [], // probe via base_url after saving
};

// ── Rerank ────────────────────────────────────────────────────────────────────
// Shown as combobox hints when the profile exists but probe hasn't run yet,
// or when provider doesn't support live probe.

export const KNOWN_RERANK_MODELS: Record<string, string[]> = {
  // Current Jina rerankers (2026-05). Live probe filters /v1/models to these.
  jina: [
    "jina-reranker-v3",           // 0.6B, latest, multilingual
    "jina-reranker-m0",           // 2.4B, multimodal (text + image)
    "jina-reranker-v2-base-multilingual", // 278M, widely used
    "jina-colbert-v2",            // 560M, ColBERT-style
  ],
  // Current Cohere rerankers (2026-05). Live probe validates key then returns this list.
  cohere: [
    "rerank-v4.0-pro",            // multilingual, best quality
    "rerank-v4.0-fast",           // multilingual, low latency
    "rerank-v3.5",                // multilingual
    "rerank-multilingual-v3.0",   // multilingual
    "rerank-english-v3.0",        // English only
  ],
  openai_compatible: [], // probe via base_url after saving
};
