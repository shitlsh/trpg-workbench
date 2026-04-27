/**
 * Hard-coded well-known model names per provider.
 * Used by ModelNameInput to offer datalist suggestions when the provider
 * doesn't support dynamic model listing (no base_url to probe).
 *
 * openai_compatible / openrouter can be probed dynamically so they don't
 * need a static list here (openrouter entry is left empty as a reminder).
 *
 * Last updated: 2026-04
 */

export const KNOWN_LLM_MODELS: Record<string, string[]> = {
  anthropic: [
    // Claude 4 family (2025)
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    // Claude 3.7 family
    "claude-3-7-sonnet-20250219",
    // Claude 3.5 family
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    // Claude 3 family
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
  ],
  google: [
    // Gemini 2.5 family (2025)
    "gemini-2.5-pro-preview-06-05",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    // Gemini 2.0 family
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-pro-exp",
    // Gemini 1.5 family
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
  ],
  openai: [
    // GPT-4o family
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4o-2024-11-20",
    // o-series reasoning models
    "o3",
    "o3-mini",
    "o4-mini",
    "o1",
    "o1-mini",
    "o1-pro",
    // GPT-4 family
    "gpt-4-turbo",
    "gpt-4",
  ],
  openrouter: [], // supports probe via base_url; static list not needed
};

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
