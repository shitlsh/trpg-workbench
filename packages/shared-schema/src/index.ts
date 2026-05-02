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
  default_prompt_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleSetRequest {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateRuleSetRequest {
  name?: string;
  description?: string;
  default_prompt_profile_id?: string | null;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

/**
 * Workspace registry entry (from global app.db).
 * Config lives in .trpg/config.yaml — fetch via GET /workspaces/:id/config.
 */
export interface Workspace {
  id: string;
  name: string;
  workspace_path: string;
  last_opened_at: string;
  status: string; // "ok" | "missing"
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  rule_set?: string; // rule_set name (written to config.yaml)
  workspace_path?: string; // optional custom path
}

export interface UpdateWorkspaceRequest {
  name?: string;
}

/**
 * Workspace config from .trpg/config.yaml.
 * Model references are by profile **name**, not UUID, for portability.
 */
export interface WorkspaceConfig {
  name: string;
  description: string;
  author: string; // M32: module author name, used in PDF export cover
  created_at: string;
  rule_set: string; // rule_set name
  prompt_profile: string; // prompt profile name scoped to the selected rule set (empty = use first)
  models: {
    default_llm: string;
    default_llm_model: string;
    rerank: string;
  };
  rerank: {
    enabled: boolean;
    top_n: number;
    top_k: number;
  };
  retrieval: {
    knowledge_top_k: number; // number of chunks injected into LLM context (when rerank disabled)
  };
  knowledge_libraries: string[];
  trust_mode?: boolean; // M20: skip confirmation dialogs and auto-apply writes
}

export interface WorkspaceConfigResponse {
  config: WorkspaceConfig;
}

// ─── M6: LLM Profiles ─────────────────────────────────────────────────────────

export type LLMProviderType = "openai" | "anthropic" | "google" | "openrouter" | "openai_compatible";

export interface LLMProfile {
  id: string;
  name: string;
  provider_type: LLMProviderType;
  base_url: string | null;
  strict_compatible: boolean;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLLMProfileRequest {
  name: string;
  provider_type: LLMProviderType;
  base_url?: string;
  api_key?: string;
  strict_compatible?: boolean;
}

export interface UpdateLLMProfileRequest {
  name?: string;
  provider_type?: LLMProviderType;
  base_url?: string;
  api_key?: string;
  strict_compatible?: boolean;
  clear_api_key?: boolean;
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

// ─── M2: Knowledge ────────────────────────────────────────────────────────────

/**
 * Chunk-level semantic type tag.
 * Single source of truth: apps/backend/app/knowledge/types.py ChunkType enum.
 * All types are content-dimension (not format-dimension).
 */
export type ChunkType =
  | "rule"        // 规则系统：技能定义、检定机制、战斗规则、操作流程等可执行规则正文
  | "entity"      // 游戏实体：怪物/装备/物品/NPC 数值数据块，以结构化数据为主
  | "lore"        // 世界观背景：世界设定、历史叙述、背景故事、氛围文字等叙述性内容
  | "adventure"   // 冒险剧情：模组场景、遭遇设定、剧情描述、GM 指引、跑团日志
  | "appendix"    // 辅助资料：索引、术语表、版权页、参考文献等导航或辅助性内容
  | "none";       // 无分类：目录页、封面等无法明确归类的内容（检索时作为兜底保留）

export interface KnowledgeLibrary {
  id: string;
  rule_set_id: string;
  name: string;
  description: string | null;
  embedding_profile_id: string | null;
  embedding_model_snapshot: string | null;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeLibraryRequest {
  name: string;
  description?: string;
  rule_set_id: string;
}

// ─── TOC-driven ingest preview flow (M24 B2 revision) ────────────────────────

/** Temporary upload result — file held server-side pending TOC confirmation. */
export interface UploadPreviewResult {
  file_id: string;
  filename: string;
  file_ext: string;       // ".pdf" | ".chm"
  size_bytes: number;
}

/** Raw TOC page detection result (before LLM analysis). */
export interface TocDetectResult {
  toc_text: string;       // raw extracted text from the detected/specified pages
  page_start: number;     // PDF page number (1-indexed)
  page_end: number;
  is_structural: boolean; // true for CHM (skip analyze step, use sections directly)
  sections?: TocSection[]; // populated when is_structural=true
}

/** A single section entry as parsed from the TOC by the LLM (or CHM structure). */
export interface TocSection {
  title: string;
  page_from: number;      // book page number from TOC listing (before page_offset applied)
  page_to: number | null; // null = inferred from next section start
  depth: number;          // 1 = top-level chapter, 2 = sub-section
  suggested_chunk_type: ChunkType | null;
}

/** PDF：模型额外给出的完整目录层（扁平行或树形），子行不含 chunk 类型，由客户端/程序与章级 `sections` 对齐。 */
export type PdfFullToc =
  | { rows: Array<{ title: string; page_from: number; depth: number; page_to?: number }> }
  | { nodes: unknown[] }
  | Record<string, unknown>;

/** LLM analysis result for a TOC. */
export interface TocAnalysisResult {
  sections: TocSection[];
  /** PDF analyze-toc：完整目录结构，与章级 `sections` 同时返回。 */
  full_toc?: PdfFullToc | null;
  /** 行级预览（由 `full_toc` 展开），供 UI 核对。 */
  preview_expanded?: unknown[];
}

/** Confirmed section→chunk_type mapping sent when starting real ingest. */
export interface TocMapping {
  title: string;
  page_from: number;
  page_to: number;
  chunk_type: ChunkType | "";
}

/** Request body for the confirmed ingest endpoint. */
export interface IngestConfirmedRequest {
  file_id: string;
  embedding_profile_id: string;
  page_offset: number;
  toc_mapping: TocMapping[];
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

// M16: AssetType is now an open string to support custom asset types.
// Use BuiltinAssetType / isBuiltinAssetType() when you need to distinguish built-ins.
export type AssetType = string;

// M30: Reduced from 10 to 6 types. Merged: lore_note+branch→outline, timeline→stage,
// location+map_brief→map. Deprecated types (lore_note, branch, timeline, map_brief, location)
// are no longer created by AI but existing assets of those types continue to render.
export const BUILTIN_ASSET_TYPES = [
  "outline",   // 大纲：故事概述、世界背景、分支结局
  "stage",     // 场景：故事单元（幕），事件序列、NPC出场
  "npc",       // NPC：玩家会交互的人物
  "monster",   // 敌人：玩家的威胁
  "map",       // 地图：地点网络、连接方式、移动路径
  "clue",      // 线索：关键物品或事件，与特定场景相关
] as const;

export type BuiltinAssetType = (typeof BUILTIN_ASSET_TYPES)[number];

export function isBuiltinAssetType(t: string): t is BuiltinAssetType {
  return (BUILTIN_ASSET_TYPES as readonly string[]).includes(t);
}

// M16: Custom asset type registered by the user for a specific RuleSet.
export interface CustomAssetTypeConfig {
  id: string;
  rule_set_id: string;
  type_key: string;
  label: string;
  icon: string;
  sort_order: number;
  /** M30: scope description + required fields for AI, used in Director prompt injection */
  description?: string;
  /** M30: Markdown chapter skeleton used by Director when creating assets of this type */
  template_md?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomAssetTypeRequest {
  type_key: string;
  label: string;
  icon: string;
  sort_order?: number;
  description?: string;
  template_md?: string;
}

export interface UpdateCustomAssetTypeRequest {
  label?: string;
  icon?: string;
  sort_order?: number;
  description?: string;
  template_md?: string;
}

/** M30: AI-assisted generation of a custom asset type definition */
export interface GenerateAssetTypeRequest {
  rule_set_id: string;
  llm_profile_id: string;
  model_name: string;
  type_intent: string;
}

export interface GenerateAssetTypeResult {
  type_key: string;
  label: string;
  icon: string;
  description: string;
  template_md: string;
}

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
  change_summary: string;
  source_type: "agent" | "user";
  created_at: string;
}

export interface AssetWithContent extends Asset {
  content_md: string;
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
  change_summary?: string;
  name?: string;
  status?: AssetStatus;
  summary?: string;
}

export interface AssetRelationsMap {
  /** slug → list of outgoing slug references (from known frontmatter fields) */
  relations: Record<string, string[]>;
}

// ─── M4: Chat ─────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  workspace_id: string;
  agent_scope: string | null;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionCreate {
  workspace_id: string;
  /** `explore` = 只读探索；`null` 省略 = 创作向 Director */
  agent_scope?: string | null;
  title?: string | null;
}

export interface UpdateChatSessionRequest {
  title: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  references_json: string | null;
  /** JSON-serialised ToolCall[] stored per message */
  tool_calls_json: string | null;
  /** Raw reasoning/thinking text from the model (plain string, not JSON) */
  thinking_json: string | null;
  created_at: string;
}

// ─── M19: Tool-calling types ──────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-serialised arguments object */
  arguments: string;
  /** `auto_applied` = successful immediate asset/skill write (green badge in UI), not a separate “trust” mode */
  status: "running" | "done" | "error" | "auto_applied" | "pending_confirm";
  /** Brief human-readable summary of the result */
  result_summary: string | null;
  /** Optional execution trace lines for delegated sub-agent tools */
  trace_logs?: string[];
}

export interface ToolResult {
  tool_call_id: string;
  success: boolean;
  summary: string;
}

// ─── M20: Agent Quality Types ─────────────────────────────────────────────────

export type ConsistencyIssueType =
  | "naming_conflict"
  | "timeline_conflict"
  | "motivation_gap"
  | "clue_break"
  | "branch_conflict";

export type ConsistencyIssueSeverity = "warning" | "error";

export interface ConsistencyIssue {
  type: ConsistencyIssueType;
  severity: ConsistencyIssueSeverity;
  description: string;
  affected_assets: string[];
  suggestion: string;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  overall_status: "clean" | "has_warnings" | "has_errors";
}

// ─── M19: SSE Event types ─────────────────────────────────────────────────────

export type SSEEventType =
  | "text_delta"
  | "tool_call_start"
  | "tool_call_result"
  | "agent_question"
  | "agent_plan"
  | "agent_plan_update"
  | "done"
  | "error";

export interface SSETextDelta {
  event: "text_delta";
  data: { content: string };
}

export interface SSEToolCallStart {
  event: "tool_call_start";
  data: { id: string; name: string; arguments: string };
}

export interface SSEToolCallResult {
  event: "tool_call_result";
  data: { id: string; success: boolean; summary: string; workspace_mutating?: boolean };
}

export interface SSEToolTrace {
  event: "tool_trace";
  data: { id: string; trace?: string[]; delta?: string };
}

export interface SSEDone {
  event: "done";
  data: Record<string, never>;
}

export interface SSEError {
  event: "error";
  data: { message: string };
}

// ─── M23: Agent Question Interrupt ───────────────────────────────────────────

export interface AgentQuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestionItem {
  header: string;
  question: string;
  options: AgentQuestionOption[];
  multiple?: boolean;
}

export interface AgentQuestion {
  id: string;
  questions: AgentQuestionItem[];
}

export interface SSEAgentQuestion {
  event: "agent_question";
  data: AgentQuestion;
}

// ─── M29: Agent Plan (structured task list) ──────────────────────────────────

export type PlanStepStatus = "pending" | "running" | "done" | "error";

export interface AgentPlanStep {
  id: string;
  index: number;
  label: string;
  status: PlanStepStatus;
}

export interface AgentPlan {
  plan_id: string;
  steps: AgentPlanStep[];
}

export interface AgentPlanUpdate {
  plan_id: string;
  step_id: string;
  status: PlanStepStatus;
  tool_call_id?: string;
}

export interface SSEAgentPlan {
  event: "agent_plan";
  data: AgentPlan;
}

export interface SSEAgentPlanUpdate {
  event: "agent_plan_update";
  data: AgentPlanUpdate;
}

export type SSEEvent =
  | SSETextDelta
  | SSEToolCallStart
  | SSEToolTrace
  | SSEToolCallResult
  | SSEAgentQuestion
  | SSEAgentPlan
  | SSEAgentPlanUpdate
  | SSEDone
  | SSEError;

export interface SendMessageRequest {
  content: string;
  workspace_id: string;
  /** Asset IDs to inject as full context (@mention) */
  referenced_asset_ids?: string[];
  /** Turn-level mode override in same session */
  turn_scope?: "director" | "explore";
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
  chunk_type: ChunkType | null;
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
  /** 与索引中 chunk 的 chunk_type 一致；未标注时为空 */
  chunk_type?: string | null;
}

export interface SearchTestRequest {
  query: string;
  library_ids: string[];
  top_k?: number;
  top_n?: number;
  use_rerank?: boolean;
  workspace_id?: string;
  /** 仅检索这些类型的 chunk；空数组 = 不过滤 */
  chunk_type_filter?: string[];
}

export interface SearchTestResponse {
  results: SearchTestResult[];
  reranked: boolean;
  warnings: string[];
  error: string | null;
}

// ─── Model Catalog Probe ─────────────────────────────────────────────────────

export interface ProbeModelsResponse {
  models: string[];
  error: string | null;
}

// ─── Workspace Skill (M17) ───────────────────────────────────────────────────

export interface WorkspaceSkillMeta {
  slug: string;
  name: string;
  description: string;
  agent_types: string[]; // empty = applies to all creative agents
  enabled: boolean;
}

export interface WorkspaceSkill extends WorkspaceSkillMeta {
  body: string; // Markdown body (everything after frontmatter)
}

export interface CreateWorkspaceSkillRequest {
  name: string;
  description?: string;
  agent_types?: string[];
  body?: string;
  enabled?: boolean;
}

export interface UpdateWorkspaceSkillRequest {
  name?: string;
  description?: string;
  agent_types?: string[];
  body?: string;
  enabled?: boolean;
}
