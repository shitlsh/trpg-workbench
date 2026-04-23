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

export interface UpdateRuleSetRequest {
  name?: string;
  description?: string;
  genre?: string;
}

export interface RuleSetLibraryBinding {
  id: string;
  rule_set_id: string;
  library_id: string;
  priority: number;
  created_at: string;
  library?: KnowledgeLibrary | null;
}

export interface CreateRuleSetLibraryBindingRequest {
  library_id: string;
  priority?: number;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  rule_set_id: string;
  name: string;
  description: string | null;
  workspace_path: string;
  default_llm_profile_id: string | null;
  rules_llm_profile_id: string | null;
  embedding_profile_id: string | null;
  rerank_profile_id: string | null;
  rerank_enabled: boolean;
  rerank_top_n: number;
  rerank_top_k: number;
  rerank_apply_to_task_types: string | null; // JSON
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
  default_llm_profile_id?: string | null;
  rules_llm_profile_id?: string | null;
  embedding_profile_id?: string | null;
}

// ─── M6: LLM Profiles ─────────────────────────────────────────────────────────

export type LLMProviderType = "openai" | "anthropic" | "google" | "openrouter" | "openai_compatible";

export interface LLMProfile {
  id: string;
  name: string;
  provider_type: LLMProviderType;
  base_url: string | null;
  model_name: string;
  temperature: number;
  max_tokens: number;
  supports_json_mode: boolean;
  supports_tools: boolean;
  timeout_seconds: number;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLLMProfileRequest {
  name: string;
  provider_type: LLMProviderType;
  model_name: string;
  base_url?: string;
  api_key?: string;
  temperature?: number;
  max_tokens?: number;
  supports_json_mode: boolean;
  supports_tools: boolean;
  timeout_seconds?: number;
}

export interface UpdateLLMProfileRequest {
  name?: string;
  provider_type?: LLMProviderType;
  model_name?: string;
  base_url?: string;
  api_key?: string;
  clear_api_key?: boolean;
  temperature?: number;
  max_tokens?: number;
  supports_json_mode?: boolean;
  supports_tools?: boolean;
  timeout_seconds?: number;
}

export interface LLMTestResult {
  success: boolean;
  latency_ms?: number;
  error?: string;
}

// ─── M6: Embedding Profiles ───────────────────────────────────────────────────

export type EmbeddingProviderType = "openai" | "openai_compatible";

export interface EmbeddingProfile {
  id: string;
  name: string;
  provider_type: EmbeddingProviderType;
  base_url: string | null;
  model_name: string;
  dimensions: number | null;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEmbeddingProfileRequest {
  name: string;
  provider_type: EmbeddingProviderType;
  model_name: string;
  base_url?: string;
  api_key?: string;
  dimensions?: number;
}

export interface UpdateEmbeddingProfileRequest {
  name?: string;
  provider_type?: EmbeddingProviderType;
  model_name?: string;
  base_url?: string;
  api_key?: string;
  clear_api_key?: boolean;
  dimensions?: number;
}

export interface EmbeddingTestResult {
  success: boolean;
  dimensions?: number;
  latency_ms?: number;
  error?: string;
}

// ─── M6: LLM Usage Records ────────────────────────────────────────────────────

export interface LLMUsageRecord {
  id: string;
  llm_profile_id: string;
  workspace_id: string | null;
  task_type: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

// ─── M2: Knowledge ────────────────────────────────────────────────────────────

export type LibraryType =
  | "core_rules"
  | "expansion"
  | "module_reference"
  | "monster_manual"
  | "lore"
  | "house_rules";

export interface KnowledgeLibrary {
  id: string;
  rule_set_id: string | null;
  name: string;
  type: LibraryType;
  description: string | null;
  embedding_config: string | null;
  embedding_profile_id: string | null;
  embedding_model_snapshot: string | null;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeLibraryRequest {
  name: string;
  type: LibraryType;
  description?: string;
  rule_set_id?: string;
}

export type ParseStatus =
  | "pending"
  | "running"
  | "success"
  | "partial"
  | "scanned_fallback"
  | "failed";

export interface KnowledgeDocument {
  id: string;
  library_id: string;
  filename: string;
  original_path: string;
  mime_type: string;
  parse_status: ParseStatus;
  page_count: number | null;
  chunk_count: number | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface IngestTask {
  id: string;
  document_id: string;
  status: TaskStatus;
  current_step: number;
  total_steps: number;
  step_label: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceLibraryBinding {
  id: string;
  workspace_id: string;
  library_id: string;
  priority: number;
  enabled: boolean;
  library?: KnowledgeLibrary;
}

export interface CreateBindingRequest {
  library_id: string;
  priority?: number;
  enabled?: boolean;
}

export interface SearchRequest {
  query: string;
  library_ids: string[];
  top_k?: number;
}

export interface Citation {
  chunk_id: string;
  content: string;
  document_id: string;
  document_filename: string;
  page_from: number;
  page_to: number;
  section_title: string | null;
  relevance_score: number;
}

export interface SearchResponse {
  results: Citation[];
  warnings: string[];
  error: string | null;
}

export type SearchResult = Citation;

// ─── M3: Assets ───────────────────────────────────────────────────────────────

export type AssetType =
  | "outline"
  | "stage"
  | "npc"
  | "monster"
  | "location"
  | "clue"
  | "branch"
  | "timeline"
  | "map_brief"
  | "lore_note";

export type AssetStatus = "draft" | "review" | "final" | "deleted";

export interface Asset {
  id: string;
  workspace_id: string;
  type: AssetType;
  name: string;
  slug: string;
  path: string;
  status: AssetStatus;
  summary: string | null;
  metadata_json: string | null;
  latest_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRevision {
  id: string;
  asset_id: string;
  version: number;
  content_md: string;
  content_json: string;
  change_summary: string;
  source_type: "agent" | "user";
  created_at: string;
}

export interface AssetWithContent extends Asset {
  content_md: string;
  content_json: string;
  version: number;
}

export interface CreateAssetRequest {
  type: AssetType;
  name: string;
  slug: string;
  summary?: string;
}

export interface UpdateAssetRequest {
  content_md?: string;
  content_json?: string;
  change_summary?: string;
  name?: string;
  status?: AssetStatus;
  summary?: string;
}

// ─── M4: Chat & Workflow ──────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  workspace_id: string;
  agent_scope: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  references_json: string | null;
  tool_calls_json: string | null;
  created_at: string;
}

export type WorkflowType = "create_module" | "modify_asset" | "rules_review" | "generate_image";
export type WorkflowStatus =
  | "pending"
  | "planning"
  | "waiting_for_clarification"
  | "executing"
  | "paused"
  | "awaiting_confirmation"
  | "completed"
  | "failed";

export interface WorkflowStepResult {
  step: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "waiting_confirm";
  summary: string | null;
  error?: string | null;
}

export interface ClarificationOption {
  id: string;
  label: string;
  description: string | null;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  type: "single_choice" | "multi_choice" | "free_text";
  options: ClarificationOption[];
  recommended_default: string | null;
}

export interface ClarifyRequest {
  answers: Record<string, string | string[]>;
}

export interface WorkflowState {
  id: string;
  workspace_id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  current_step: number;
  total_steps: number;
  input_snapshot: string; // JSON string
  clarification_questions: ClarificationQuestion[] | null;
  clarification_answers: Record<string, string | string[]> | null;
  step_results: string;   // JSON array string
  result_summary: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type AgentIntent = "create_asset" | "modify_asset" | "rules_review" | "image_gen" | "query";

export interface ChangePlan {
  intent: AgentIntent;
  affected_asset_types: string[];
  workflow: WorkflowType | null;
  agents_to_call: string[];
  change_plan: string;
  requires_user_confirm: boolean;
}

export interface PatchProposal {
  asset_id: string;
  asset_name: string;
  content_md: string;
  content_json: string;
  change_summary: string;
  original_content?: string;
}

export interface ConsistencyIssue {
  type: "naming_conflict" | "timeline_conflict" | "motivation_gap" | "clue_break" | "branch_conflict";
  severity: "warning" | "error";
  description: string;
  affected_assets: string[];
  suggestion: string;
  auto_fixable: boolean;
  suggested_fix: string | null;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  overall_status: "clean" | "has_warnings" | "has_errors";
}

export interface RulesSuggestion {
  severity: "info" | "warning" | "error";
  type: "stat_violation" | "missing_required_field" | "balance_concern" | "lore_inconsistency" | "general_advice";
  text: string;
  citation: { document: string; page_from: number; page_to: number } | null;
  has_citation: boolean;
  affected_field: string | null;
  suggestion_patch: string | null;
}

export interface RulesReviewResult {
  suggestions: RulesSuggestion[];
  summary: string;
}

export interface AgentResponse {
  explanation: string | null;
  change_plan: ChangePlan | null;
  patch_proposals: PatchProposal[];
  consistency_report: ConsistencyReport | null;
  citations: Citation[];
  workflow_id: string | null;
  persist_status: "none" | "pending_confirm" | "saved";
}

export interface SendMessageRequest {
  content: string;
  workspace_id: string;
}

export interface StartWorkflowRequest {
  type: WorkflowType;
  workspace_id: string;
  input: Record<string, unknown>;
}

// ─── M5: Image Generation ─────────────────────────────────────────────────────

export interface ImageBrief {
  subject: string;
  mood: string;
  key_elements: string[];
  style: string;
  generated_image_path?: string;
}

export interface ImageGenerationJob {
  id: string;
  asset_id: string;
  prompt: string;
  provider: string;
  status: "pending" | "running" | "completed" | "failed";
  result_path: string | null;
  error_message: string | null;
}

// ─── M5: Prompt Profiles ──────────────────────────────────────────────────────

export interface PromptProfile {
  id: string;
  rule_set_id: string | null;
  name: string;
  system_prompt: string;
  style_notes: string | null;
  output_schema_hint: string | null;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePromptProfileRequest {
  name: string;
  system_prompt: string;
  style_notes?: string;
  rule_set_id?: string;
}

export interface UpdatePromptProfileRequest {
  name?: string;
  system_prompt?: string;
  style_notes?: string;
  rule_set_id?: string | null;
}

// ─── M7: Model Catalog ────────────────────────────────────────────────────────

export interface ModelCatalogEntry {
  id: string; // "{provider_type}:{model_name}"
  provider_type: LLMProviderType;
  model_name: string;
  display_name: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_json_mode: boolean | null;
  supports_tools: boolean | null;
  input_price_per_1m: number | null; // USD
  output_price_per_1m: number | null;
  pricing_currency: string;
  is_deprecated: boolean;
  source: "static" | "api_fetched" | "user";
  fetched_at: string | null;
  updated_at: string;
}

export interface EmbeddingCatalogEntry {
  id: string; // "{provider_type}:{model_name}"
  provider_type: EmbeddingProviderType;
  model_name: string;
  display_name: string | null;
  dimensions: number | null;
  max_input_tokens: number | null;
  input_price_per_1m: number | null;
  source: "static" | "api_fetched" | "user";
  fetched_at: string | null;
  updated_at: string;
}

export interface UpdateModelCatalogEntryRequest {
  input_price_per_1m?: number | null;
  output_price_per_1m?: number | null;
  context_window?: number | null;
  supports_json_mode?: boolean | null;
  supports_tools?: boolean | null;
}

export interface CatalogRefreshRequest {
  provider_type: LLMProviderType;
  llm_profile_id: string;
}

export interface CatalogRefreshResult {
  provider_type: LLMProviderType;
  models_added: number;
  models_updated: number;
  error: string | null;
}

// ─── M7: Usage ────────────────────────────────────────────────────────────────

export interface UsageByModel {
  provider_type: LLMProviderType;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
  call_count: number;
}

export interface UsageSummary {
  period: { from: string | null; to: string | null };
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number | null;
  call_count: number;
  by_model: UsageByModel[];
}

export interface UsageRecord {
  id: string;
  workspace_id: string | null;
  provider_type: string;
  model_name: string;
  task_type: string;
  workflow_source: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
}

// ─── M8: Rerank Profiles ──────────────────────────────────────────────────────

export type RerankProviderType = "jina" | "cohere" | "openai_compatible";

export interface RerankProfile {
  id: string;
  name: string;
  provider_type: RerankProviderType;
  model: string;
  base_url: string | null;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRerankProfileRequest {
  name: string;
  provider_type: RerankProviderType;
  model: string;
  api_key?: string;
  base_url?: string;
}

export interface UpdateRerankProfileRequest {
  name?: string;
  provider_type?: RerankProviderType;
  model?: string;
  api_key?: string;
  clear_api_key?: boolean;
  base_url?: string;
}

export interface WorkspaceRerankConfig {
  rerank_profile_id: string | null;
  rerank_enabled: boolean;
  rerank_top_n: number;
  rerank_top_k: number;
  rerank_apply_to_task_types: string[]; // parsed from JSON
}

export interface RerankTestResult {
  success: boolean;
  latency_ms?: number;
  error?: string;
}

// ─── M8: Knowledge Preview ────────────────────────────────────────────────────

export interface QualityWarning {
  type: "scanned_fallback" | "partial" | "has_table" | "has_multi_column" | "page_range_anomaly" | "empty_page";
  detail: string;
  affected_pages?: number[];
}

export interface KnowledgeDocumentSummary {
  id: string;
  library_id: string;
  filename: string;
  page_count: number | null;
  chunk_count: number | null;
  parse_status: ParseStatus;
  parse_quality_notes: string | null;
  embedding_provider: string | null;
  embedding_model: string | null;
  indexed_at: string | null;
  quality_warnings: QualityWarning[];
  created_at: string;
  updated_at: string;
}

export interface PageTextPreview {
  page_number: number;
  raw_text: string;
  cleaned_text: string | null;
  chunk_ids: string[];
}

export interface ChunkListItem {
  chunk_id: string;
  chunk_index: number;
  page_from: number;
  page_to: number;
  section_title: string | null;
  char_count: number;
  content?: string; // only when fetching single chunk
  parse_quality: string;
  has_table: boolean;
  has_multi_column: boolean;
}

export interface SearchTestResult {
  chunk_id: string;
  content: string;
  document_filename: string;
  page_from: number;
  page_to: number;
  section_title: string | null;
  vector_score: number;
  rerank_score: number | null;
  reranked: boolean;
}

export interface SearchTestRequest {
  query: string;
  library_ids: string[];
  top_k?: number;
  top_n?: number;
  use_rerank?: boolean;
  workspace_id?: string;
}

export interface SearchTestResponse {
  results: SearchTestResult[];
  reranked: boolean;
  warnings: string[];
  error: string | null;
}
