/**
 * Hard-coded well-known model names per provider.
 * Used by ModelNameInput to offer datalist suggestions when the provider
 * doesn't support dynamic model listing (no base_url to probe).
 *
 * openai_compatible / openrouter can be probed dynamically so they don't
 * need a static list here (openrouter entry is left empty as a reminder).
 */

export const KNOWN_LLM_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-3-5",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
  ],
  google: [
    "gemini-2.5-pro-preview-06-05",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
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
    "embedding-001",
  ],
  openai_compatible: [], // probe via base_url
};
