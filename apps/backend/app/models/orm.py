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


class WorkspaceORM(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    workspace_path: Mapped[str] = mapped_column(Text, nullable=False)
    default_model_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    rule_set: Mapped["RuleSetORM"] = relationship("RuleSetORM", back_populates="workspaces")


class ModelProfileORM(Base):
    __tablename__ = "model_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─── M2: Knowledge ────────────────────────────────────────────────────────────

class KnowledgeLibraryORM(Base):
    __tablename__ = "knowledge_libraries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    rule_set_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("rule_sets.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="core_rules")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_config: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
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
