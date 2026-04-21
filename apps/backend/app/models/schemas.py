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


class WorkspaceSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    rule_set_id: str
    name: str
    description: str | None
    workspace_path: str
    default_model_profile_id: str | None
    created_at: datetime
    updated_at: datetime


class WorkspaceCreate(BaseModel):
    name: str
    description: str | None = None
    rule_set_id: str


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    rule_set_id: str | None = None
    default_model_profile_id: str | None = None


class ModelProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    provider_type: str
    base_url: str | None
    model_name: str
    temperature: float
    max_tokens: int
    created_at: datetime
    updated_at: datetime


class ModelProfileCreate(BaseModel):
    name: str
    provider_type: str
    model_name: str
    base_url: str | None = None
    api_key: str
    temperature: float = 0.7
    max_tokens: int = 4096


class ModelProfileUpdate(BaseModel):
    name: str | None = None
    provider_type: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


# ─── M2: Knowledge ────────────────────────────────────────────────────────────

class KnowledgeLibrarySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    rule_set_id: str | None
    name: str
    type: str
    description: str | None
    embedding_config: str | None
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class KnowledgeLibraryCreate(BaseModel):
    name: str
    type: str = "core_rules"
    description: str | None = None
    rule_set_id: str | None = None


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
    path: str
    status: str
    summary: str | None
    metadata_json: str | None
    latest_revision_id: str | None
    created_at: datetime
    updated_at: datetime


class AssetRevisionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    asset_id: str
    version: int
    content_md: str
    content_json: str
    change_summary: str
    source_type: str
    created_at: datetime


class AssetWithContentSchema(AssetSchema):
    content_md: str = ""
    content_json: str = "{}"
    version: int = 0


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
    created_at: datetime
    updated_at: datetime


class ChatMessageSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_id: str
    role: str
    content: str
    references_json: str | None
    tool_calls_json: str | None
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
    current_step: int
    total_steps: int
    input_snapshot: str
    step_results: str
    result_summary: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class StartWorkflowRequest(BaseModel):
    type: str
    workspace_id: str
    input: dict


class ApplyPatchRequest(BaseModel):
    content_md: str
    content_json: str
    change_summary: str
    source_type: str = "agent"
