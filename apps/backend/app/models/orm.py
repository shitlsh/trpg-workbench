import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Float, Integer, ForeignKey, DateTime, Boolean, UniqueConstraint
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
    default_prompt_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    libraries: Mapped[list["KnowledgeLibraryORM"]] = relationship("KnowledgeLibraryORM", back_populates="rule_set", cascade="all, delete-orphan")


class WorkspaceORM(Base):
    """Workspace registry entry in global app.db.

    Most configuration now lives in .trpg/config.yaml (file-first).
    Model routing fields are synced here from config.yaml for fast lookup.
    """
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    workspace_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    last_opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok / missing
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    # Model routing — synced from config.yaml on every PATCH /config
    default_llm_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    default_llm_model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rerank_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rerank_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    rerank_apply_to_task_types: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list


# ─── M6: Model Profiles ───────────────────────────────────────────────────────

class LLMProfileORM(Base):
    __tablename__ = "llm_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)  # openai/anthropic/google/openrouter/openai_compatible
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    strict_compatible: Mapped[bool] = mapped_column(Boolean, default=False)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    rule_set_id: Mapped[str] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    embedding_model_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON snapshot at index time
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    rule_set: Mapped["RuleSetORM"] = relationship("RuleSetORM", back_populates="libraries")
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
    workspace_id: Mapped[str] = mapped_column(String(36), nullable=False)
    library_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_libraries.id"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    scope_rules_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    library: Mapped["KnowledgeLibraryORM"] = relationship("KnowledgeLibraryORM", back_populates="workspace_bindings")


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
    """Asset index entry in workspace cache.db.

    Content lives in the filesystem (frontmatter Markdown).
    This table is a search/filter index only.
    """
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)  # relative to workspace root
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # SHA-256 hex
    version: Mapped[int] = mapped_column(Integer, default=1)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    revisions: Mapped[list["AssetRevisionORM"]] = relationship(
        "AssetRevisionORM", back_populates="asset",
        cascade="all, delete-orphan",
        foreign_keys="AssetRevisionORM.asset_id"
    )


class AssetRevisionORM(Base):
    """Revision index entry. Actual content lives in .trpg/revisions/{slug}/v{N}.md"""
    __tablename__ = "asset_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_path: Mapped[str] = mapped_column(Text, nullable=False)  # relative to workspace .trpg/
    change_summary: Mapped[str] = mapped_column(String(500), default="用户手动编辑")
    source_type: Mapped[str] = mapped_column(String(20), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    asset: Mapped["AssetORM"] = relationship("AssetORM", back_populates="revisions", foreign_keys=[asset_id])


# ─── M4: Chat & Workflow ──────────────────────────────────────────────────────

class ChatSessionORM(Base):
    """Chat session index in workspace cache.db. Messages stored in .trpg/chat/{id}.jsonl."""
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), nullable=False)
    agent_scope: Mapped[str | None] = mapped_column(String(100), nullable=True)
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ChatMessageORM removed — messages now stored in .trpg/chat/{session-id}.jsonl





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


# ─── M16: Custom Asset Type Configs ──────────────────────────────────────────

class CustomAssetTypeConfigORM(Base):
    __tablename__ = "custom_asset_type_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=False)
    type_key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    icon: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # M30: description explains the type's scope and required fields for AI;
    #       template_md provides the Markdown chapter skeleton for content generation.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    __table_args__ = (UniqueConstraint("rule_set_id", "type_key", name="uq_rule_set_type_key"),)
