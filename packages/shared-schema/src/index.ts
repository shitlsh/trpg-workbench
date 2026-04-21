// ─── Common ───────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ─── RuleSet ──────────────────────────────────────────────────────────────────

export interface RuleSet {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  genre: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleSetRequest {
  name: string;
  slug: string;
  description?: string;
  genre?: string;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  rule_set_id: string;
  name: string;
  description: string | null;
  workspace_path: string;
  default_model_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  rule_set_id: string;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
  rule_set_id?: string;
  default_model_profile_id?: string | null;
}

// ─── ModelProfile ─────────────────────────────────────────────────────────────

export type ProviderType = "openai" | "anthropic" | "google" | "openrouter" | "custom";

export interface ModelProfile {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  model_name: string;
  temperature: number;
  max_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface CreateModelProfileRequest {
  name: string;
  provider_type: ProviderType;
  model_name: string;
  base_url?: string;
  api_key: string;
  temperature?: number;
  max_tokens?: number;
}

export interface UpdateModelProfileRequest {
  name?: string;
  provider_type?: ProviderType;
  model_name?: string;
  base_url?: string;
  api_key?: string;
  temperature?: number;
  max_tokens?: number;
}
