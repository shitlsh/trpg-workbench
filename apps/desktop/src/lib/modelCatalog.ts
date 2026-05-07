/**
 * 嵌入模型：无 probe 结果时仍可用 combobox 给常见 id 做补全。
 * Rerank 模型：各供应商已知型号的静态列表，用于 combobox 候选。
 *
 * LLM 模型名由供应商 probe 提供，不再维护静态 LLM 列表。
 *
 * Last updated: 2026-05
 */

export const KNOWN_EMBEDDING_MODELS: Record<string, string[]> = {
  openai: [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
  ],
  google: [
    "text-embedding-004",
    "text-multilingual-embedding-002",
    "embedding-001",
  ],
  openai_compatible: [], // probe via base_url
};

export const KNOWN_RERANK_MODELS: Record<string, string[]> = {
  jina: [
    "jina-reranker-v2-base-multilingual",
    "jina-reranker-v1-base-en",
    "jina-reranker-v1-turbo-en",
    "jina-reranker-v1-tiny-en",
  ],
  cohere: [
    "rerank-multilingual-v3.0",
    "rerank-english-v3.0",
    "rerank-multilingual-v2.0",
    "rerank-english-v2.0",
  ],
  openai_compatible: [], // manual input
};
