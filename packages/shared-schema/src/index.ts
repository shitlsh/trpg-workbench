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
export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed";

export interface WorkflowStepResult {
  step: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "waiting_confirm";
  summary: string | null;
  error?: string | null;
}

export interface WorkflowState {
  id: string;
  workspace_id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  current_step: number;
  total_steps: number;
  input_snapshot: string; // JSON string
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
}

export interface ConsistencyIssue {
  type: "naming_conflict" | "timeline_conflict" | "motivation_gap" | "clue_break" | "branch_conflict";
  severity: "warning" | "error";
  description: string;
  affected_assets: string[];
  suggestion: string;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  overall_status: "clean" | "has_warnings" | "has_errors";
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
}
