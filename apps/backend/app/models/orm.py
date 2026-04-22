import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Float, Integer, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.storage.database import Base


def _now():
    return datetime.now(timezone.utc)


def _uuid():
    return str(uuid.uuid4())


class RuleSetORM(Base):
    __tablename__ = "rule_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    genre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    workspaces: Mapped[list["WorkspaceORM"]] = relationship("WorkspaceORM", back_populates="rule_set")
    library_bindings: Mapped[list["RuleSetLibraryBindingORM"]] = relationship("RuleSetLibraryBindingORM", back_populates="rule_set", cascade="all, delete-orphan")


class WorkspaceORM(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    workspace_path: Mapped[str] = mapped_column(Text, nullable=False)
    default_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rules_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    embedding_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rerank_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rerank_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    rerank_top_n: Mapped[int] = mapped_column(Integer, default=20)
    rerank_top_k: Mapped[int] = mapped_column(Integer, default=5)
    rerank_apply_to_task_types: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    rule_set: Mapped["RuleSetORM"] = relationship("RuleSetORM", back_populates="workspaces")


# ─── M6: Model Profiles ───────────────────────────────────────────────────────

class LLMProfileORM(Base):
    __tablename__ = "llm_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)  # openai/anthropic/google/openrouter/openai_compatible
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096)
    supports_json_mode: Mapped[bool] = mapped_column(Boolean, nullable=False)
    supports_tools: Mapped[bool] = mapped_column(Boolean, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=60)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class EmbeddingProfileORM(Base):
    __tablename__ = "embedding_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)  # openai/openai_compatible
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    dimensions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class LLMUsageRecordORM(Base):
    __tablename__ = "llm_usage_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    llm_profile_id: Mapped[str] = mapped_column(String(36), nullable=False)
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_type: Mapped[str] = mapped_column(String(100), nullable=False)  # e.g. "create_module", "rules_review"
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ─── M2: Knowledge ────────────────────────────────────────────────────────────

class KnowledgeLibraryORM(Base):
    __tablename__ = "knowledge_libraries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="core_rules")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_config: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON, M2 legacy field
    embedding_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    embedding_model_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON snapshot at index time
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    documents: Mapped[list["KnowledgeDocumentORM"]] = relationship("KnowledgeDocumentORM", back_populates="library", cascade="all, delete-orphan")
    workspace_bindings: Mapped[list["WorkspaceLibraryBindingORM"]] = relationship("WorkspaceLibraryBindingORM", back_populates="library", cascade="all, delete-orphan")


class KnowledgeDocumentORM(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    library_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_libraries.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), default="application/pdf")
    parse_status: Mapped[str] = mapped_column(String(50), default="pending")
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    library: Mapped["KnowledgeLibraryORM"] = relationship("KnowledgeLibraryORM", back_populates="documents")
    ingest_tasks: Mapped[list["IngestTaskORM"]] = relationship("IngestTaskORM", back_populates="document", cascade="all, delete-orphan")


class WorkspaceLibraryBindingORM(Base):
    __tablename__ = "workspace_library_bindings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), ForeignKey("workspaces.id"), nullable=False)
    library_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_libraries.id"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    scope_rules_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    library: Mapped["KnowledgeLibraryORM"] = relationship("KnowledgeLibraryORM", back_populates="workspace_bindings")


class RuleSetLibraryBindingORM(Base):
    __tablename__ = "rule_set_library_bindings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=False)
    library_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_libraries.id"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    rule_set: Mapped["RuleSetORM"] = relationship("RuleSetORM", back_populates="library_bindings")
    library: Mapped["KnowledgeLibraryORM"] = relationship("KnowledgeLibraryORM")


class IngestTaskORM(Base):
    __tablename__ = "ingest_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_documents.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=8)
    step_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    document: Mapped["KnowledgeDocumentORM"] = relationship("KnowledgeDocumentORM", back_populates="ingest_tasks")


# ─── M3: Assets ───────────────────────────────────────────────────────────────

class AssetORM(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), ForeignKey("workspaces.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    latest_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    revisions: Mapped[list["AssetRevisionORM"]] = relationship(
        "AssetRevisionORM", back_populates="asset",
        cascade="all, delete-orphan",
        foreign_keys="AssetRevisionORM.asset_id"
    )


class AssetRevisionORM(Base):
    __tablename__ = "asset_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content_md: Mapped[str] = mapped_column(Text, default="")
    content_json: Mapped[str] = mapped_column(Text, default="{}")
    change_summary: Mapped[str] = mapped_column(String(500), default="用户手动编辑")
    source_type: Mapped[str] = mapped_column(String(20), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    asset: Mapped["AssetORM"] = relationship("AssetORM", back_populates="revisions", foreign_keys=[asset_id])


# ─── M4: Chat & Workflow ──────────────────────────────────────────────────────

class ChatSessionORM(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), ForeignKey("workspaces.id"), nullable=False)
    agent_scope: Mapped[str | None] = mapped_column(String(100), nullable=True)
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    messages: Mapped[list["ChatMessageORM"]] = relationship(
        "ChatMessageORM", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessageORM(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("chat_sessions.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user/assistant/system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    references_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_calls_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped["ChatSessionORM"] = relationship("ChatSessionORM", back_populates="messages")


# ─── M5: Image Generation ─────────────────────────────────────────────────────

class ImageGenerationJobORM(Base):
    __tablename__ = "image_generation_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), ForeignKey("workspaces.id"), nullable=False)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="dalle3")
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending/running/completed/failed
    result_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─── M5: Prompt Profiles ──────────────────────────────────────────────────────

class PromptProfileORM(Base):
    __tablename__ = "prompt_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    style_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_schema_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─── M4: Workflow State ───────────────────────────────────────────────────────

class WorkflowStateORM(Base):
    __tablename__ = "workflow_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), ForeignKey("workspaces.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    input_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    clarification_questions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    clarification_answers: Mapped[str | None] = mapped_column(Text, nullable=True)    # JSON
    step_results: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─── M8: Rerank Profiles ──────────────────────────────────────────────────────

class RerankProfileORM(Base):
    __tablename__ = "rerank_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)  # jina/cohere/openai_compatible
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

class ModelCatalogEntryORM(Base):
    __tablename__ = "model_catalog_entries"

    id: Mapped[str] = mapped_column(String(300), primary_key=True)  # "{provider_type}:{model_name}"
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    supports_json_mode: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    supports_tools: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    input_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    pricing_currency: Mapped[str] = mapped_column(String(10), default="USD")
    is_deprecated: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(20), default="static")  # "static" | "api_fetched"
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class EmbeddingCatalogEntryORM(Base):
    __tablename__ = "embedding_catalog_entries"

    id: Mapped[str] = mapped_column(String(300), primary_key=True)  # "{provider_type}:{model_name}"
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    dimensions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_price_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="static")
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
