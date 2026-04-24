from pydantic import BaseModel, ConfigDict
from datetime import datetime


class RuleSetSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    slug: str
    description: str | None
    genre: str | None
    created_at: datetime
    updated_at: datetime


class RuleSetCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    genre: str | None = None


class RuleSetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    genre: str | None = None


class WorkspaceSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    workspace_path: str
    last_opened_at: datetime
    status: str  # ok / missing
    created_at: datetime
    updated_at: datetime


class WorkspaceCreate(BaseModel):
    name: str
    description: str | None = None
    rule_set: str | None = None  # rule_set name for config.yaml
    workspace_path: str | None = None  # if None, auto-create under workspaces root


class WorkspaceOpen(BaseModel):
    """Open an existing workspace directory."""
    workspace_path: str


class WorkspaceUpdate(BaseModel):
    name: str | None = None


# ─── M6: LLM Profiles ─────────────────────────────────────────────────────────

class LLMProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    provider_type: str
    base_url: str | None
    model_name: str
    temperature: float
    max_tokens: int
    supports_json_mode: bool
    supports_tools: bool
    timeout_seconds: int
    has_api_key: bool = False
    created_at: datetime
    updated_at: datetime


class LLMProfileCreate(BaseModel):
    name: str
    provider_type: str
    model_name: str
    base_url: str | None = None
    api_key: str | None = None
    temperature: float = 0.7
    max_tokens: int = 4096
    supports_json_mode: bool
    supports_tools: bool
    timeout_seconds: int = 60


class LLMProfileUpdate(BaseModel):
    name: str | None = None
    provider_type: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    supports_json_mode: bool | None = None
    supports_tools: bool | None = None
    timeout_seconds: int | None = None


class LLMTestResult(BaseModel):
    success: bool
    latency_ms: int | None = None
    error: str | None = None


# ─── M6: Embedding Profiles ───────────────────────────────────────────────────

class EmbeddingProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    provider_type: str
    base_url: str | None
    model_name: str
    dimensions: int | None
    has_api_key: bool = False
    created_at: datetime
    updated_at: datetime


class EmbeddingProfileCreate(BaseModel):
    name: str
    provider_type: str
    model_name: str
    base_url: str | None = None
    api_key: str | None = None
    dimensions: int | None = None


class EmbeddingProfileUpdate(BaseModel):
    name: str | None = None
    provider_type: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    dimensions: int | None = None


class EmbeddingTestResult(BaseModel):
    success: bool
    dimensions: int | None = None
    latency_ms: int | None = None
    error: str | None = None


# ─── M2: Knowledge ────────────────────────────────────────────────────────────

class KnowledgeLibrarySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    rule_set_id: str
    name: str
    type: str
    description: str | None
    embedding_profile_id: str | None
    embedding_model_snapshot: str | None
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class KnowledgeLibraryCreate(BaseModel):
    name: str
    type: str = "core_rules"
    description: str | None = None
    rule_set_id: str


class KnowledgeDocumentSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    library_id: str
    filename: str
    original_path: str
    mime_type: str
    parse_status: str
    page_count: int | None
    chunk_count: int | None
    metadata_json: str | None
    created_at: datetime
    updated_at: datetime


class IngestTaskSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    document_id: str
    status: str
    current_step: int
    total_steps: int
    step_label: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class WorkspaceLibraryBindingSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    library_id: str
    priority: int
    enabled: bool
    library: KnowledgeLibrarySchema | None = None


class WorkspaceLibraryBindingCreate(BaseModel):
    library_id: str
    priority: int = 0
    enabled: bool = True


class SearchRequest(BaseModel):
    query: str
    library_ids: list[str]
    top_k: int = 5


class CitationSchema(BaseModel):
    chunk_id: str
    content: str
    document_id: str
    document_filename: str
    page_from: int
    page_to: int
    section_title: str | None
    relevance_score: float


# ─── M3: Assets ───────────────────────────────────────────────────────────────

class AssetSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    type: str
    name: str
    slug: str
    status: str
    summary: str | None
    file_path: str
    file_hash: str | None
    version: int
    metadata_json: str | None
    created_at: datetime
    updated_at: datetime


class AssetRevisionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    asset_id: str
    version: int
    snapshot_path: str
    change_summary: str
    source_type: str
    created_at: datetime


class AssetWithContentSchema(AssetSchema):
    """Asset with file content loaded from disk."""
    content_md: str = ""
    content_json: str = "{}"


class AssetCreate(BaseModel):
    type: str
    name: str
    slug: str
    summary: str | None = None


class AssetUpdate(BaseModel):
    content_md: str | None = None
    content_json: str | None = None
    change_summary: str | None = None
    name: str | None = None
    status: str | None = None
    summary: str | None = None


# ─── M4: Chat & Workflow ──────────────────────────────────────────────────────

class ChatSessionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    agent_scope: str | None
    title: str | None
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class ChatMessageSchema(BaseModel):
    """Chat message — loaded from JSONL file, not from DB."""
    id: str
    session_id: str
    role: str
    content: str
    references_json: str | None = None
    tool_calls_json: str | None = None
    created_at: datetime


class ChatSessionCreate(BaseModel):
    workspace_id: str
    agent_scope: str | None = None
    title: str | None = None


class SendMessageRequest(BaseModel):
    content: str
    workspace_id: str


class WorkflowStateSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    type: str
    status: str
    current_step: int = 0
    total_steps: int = 0
    input_snapshot: str | None = None
    clarification_questions: str | None = None
    clarification_answers: str | None = None
    step_results: str | None = None
    result_summary: str | None = None
    error_message: str | None = None
    director_intent: str | None = None  # M12
    created_at: datetime
    updated_at: datetime


class StartWorkflowRequest(BaseModel):
    type: str
    workspace_id: str
    input: dict


class ClarifyRequest(BaseModel):
    answers: dict  # Record[str, str | list[str]]


class ApplyPatchRequest(BaseModel):
    content_md: str
    content_json: str
    change_summary: str
    source_type: str = "agent"


# ─── M5: Prompt Profiles ──────────────────────────────────────────────────────

class PromptProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    rule_set_id: str | None
    name: str
    system_prompt: str
    style_notes: str | None
    output_schema_hint: str | None
    is_builtin: bool
    created_at: datetime
    updated_at: datetime


class PromptProfileCreate(BaseModel):
    name: str
    system_prompt: str
    style_notes: str | None = None
    rule_set_id: str | None = None
    output_schema_hint: str | None = None


class PromptProfileUpdate(BaseModel):
    name: str | None = None
    system_prompt: str | None = None
    style_notes: str | None = None
    output_schema_hint: str | None = None
    rule_set_id: str | None = None


# ─── M7: Model Catalog ────────────────────────────────────────────────────────

class ModelCatalogEntrySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    provider_type: str
    model_name: str
    display_name: str | None
    context_window: int | None
    max_output_tokens: int | None
    supports_json_mode: bool | None
    supports_tools: bool | None
    input_price_per_1m: float | None
    output_price_per_1m: float | None
    pricing_currency: str
    is_deprecated: bool
    source: str
    fetched_at: datetime | None
    updated_at: datetime


class UpdateModelCatalogEntryRequest(BaseModel):
    input_price_per_1m: float | None = None
    output_price_per_1m: float | None = None
    context_window: int | None = None
    supports_json_mode: bool | None = None
    supports_tools: bool | None = None


class CatalogRefreshRequest(BaseModel):
    provider_type: str
    llm_profile_id: str


class CatalogRefreshResult(BaseModel):
    provider_type: str
    models_added: int
    models_updated: int
    error: str | None


class EmbeddingCatalogEntrySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    provider_type: str
    model_name: str
    display_name: str | None
    dimensions: int | None
    max_input_tokens: int | None
    input_price_per_1m: float | None
    source: str
    fetched_at: datetime | None
    updated_at: datetime


# ─── M7: Usage ────────────────────────────────────────────────────────────────

class UsageByModelSchema(BaseModel):
    provider_type: str
    model_name: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float | None
    call_count: int


class UsageSummarySchema(BaseModel):
    period: dict  # {"from": str, "to": str}
    total_input_tokens: int
    total_output_tokens: int
    estimated_cost_usd: float | None
    call_count: int
    by_model: list[UsageByModelSchema]


class UsageRecordSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str | None
    provider_type: str
    model_name: str
    task_type: str
    workflow_source: str | None
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    estimated_cost_usd: float | None
    created_at: datetime


# ─── M8: Rerank Profiles ──────────────────────────────────────────────────────

class RerankProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    provider_type: str
    base_url: str | None
    model_name: str
    has_api_key: bool = False
    created_at: datetime
    updated_at: datetime


class RerankProfileCreate(BaseModel):
    name: str
    provider_type: str
    model_name: str = "jina-reranker-v2-base-multilingual"
    base_url: str | None = None
    api_key: str | None = None


class RerankProfileUpdate(BaseModel):
    name: str | None = None
    provider_type: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False


class RerankTestResult(BaseModel):
    success: bool
    latency_ms: int | None = None
    error: str | None = None


# ─── M8: Knowledge Preview ────────────────────────────────────────────────────

class QualityWarningSchema(BaseModel):
    type: str   # scanned_fallback/partial/has_table/has_multi_column/page_range_anomaly/empty_page
    detail: str
    affected_pages: list[int] | None = None


class KnowledgeDocumentSummarySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    library_id: str
    filename: str
    page_count: int | None
    chunk_count: int | None
    parse_status: str
    parse_quality_notes: str | None
    embedding_provider: str | None
    embedding_model: str | None
    indexed_at: str | None
    quality_warnings: list[QualityWarningSchema] = []
    created_at: datetime
    updated_at: datetime


class PageTextPreviewSchema(BaseModel):
    page_number: int
    raw_text: str
    cleaned_text: str | None
    chunk_ids: list[str]


class ChunkListItemSchema(BaseModel):
    chunk_id: str
    chunk_index: int
    page_from: int
    page_to: int
    section_title: str | None
    char_count: int
    content: str | None = None  # only when fetching single chunk
    parse_quality: str
    has_table: bool
    has_multi_column: bool


class SearchTestRequest(BaseModel):
    query: str
    library_ids: list[str]
    top_k: int = 5
    top_n: int = 20
    use_rerank: bool = False
    workspace_id: str | None = None  # to resolve rerank profile


class SearchTestResultSchema(BaseModel):
    chunk_id: str
    content: str
    document_filename: str
    page_from: int
    page_to: int
    section_title: str | None
    vector_score: float
    rerank_score: float | None
    reranked: bool


class SearchTestResponse(BaseModel):
    results: list[SearchTestResultSchema]
    reranked: bool
    warnings: list[str] = []


# ─── M16: Custom Asset Type Configs ──────────────────────────────────────────

class CustomAssetTypeConfigSchema(BaseModel):
    id: str
    rule_set_id: str
    type_key: str
    label: str
    icon: str
    sort_order: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class CustomAssetTypeConfigCreate(BaseModel):
    type_key: str
    label: str
    icon: str
    sort_order: int = 0


class CustomAssetTypeConfigUpdate(BaseModel):
    label: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    error: str | None = None
