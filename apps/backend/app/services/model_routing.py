"""Model routing service: resolves which LLM/Embedding/Rerank profile to use for a given task."""
import json
from sqlalchemy.orm import Session
from app.models.orm import WorkspaceORM, LLMProfileORM, EmbeddingProfileORM, KnowledgeLibraryORM, RerankProfileORM


class ModelNotConfiguredError(Exception):
    """Raised when no LLM profile is configured for the requested task."""
    def __init__(self, message: str = "No LLM profile configured for this workspace"):
        super().__init__(message)
        self.message = message


class LibraryNotIndexedError(Exception):
    """Raised when a knowledge library has not been indexed with an embedding profile."""
    def __init__(self, library_id: str):
        super().__init__(f"Library {library_id} has not been indexed yet")
        self.library_id = library_id
        self.message = f"Library {library_id} has not been indexed yet"


def get_llm_for_task(workspace_id: str, task_type: str, db: Session) -> LLMProfileORM:
    """
    Resolve the LLM profile to use for a given task.

    task_type:
      - "rules_review": uses workspace.rules_llm_profile_id, falls back to default
      - everything else: uses workspace.default_llm_profile_id

    Raises ModelNotConfiguredError if no profile is configured.
    """
    workspace = db.get(WorkspaceORM, workspace_id)
    if not workspace:
        raise ModelNotConfiguredError(f"Workspace {workspace_id} not found")

    profile_id: str | None = None
    if task_type == "rules_review" and workspace.rules_llm_profile_id:
        profile_id = workspace.rules_llm_profile_id
    else:
        profile_id = workspace.default_llm_profile_id

    if not profile_id:
        raise ModelNotConfiguredError(
            "No LLM profile configured for this workspace. "
            "Please configure a default LLM profile in workspace settings."
        )

    profile = db.get(LLMProfileORM, profile_id)
    if not profile:
        raise ModelNotConfiguredError(
            f"LLM profile {profile_id} not found. "
            "Please reconfigure the LLM profile in workspace settings."
        )

    return profile


def get_embedding_for_ingest(workspace_id: str, db: Session) -> EmbeddingProfileORM:
    """
    Resolve the embedding profile to use for ingesting documents.
    Uses workspace.embedding_profile_id.

    Raises ModelNotConfiguredError if no embedding profile is configured.
    """
    workspace = db.get(WorkspaceORM, workspace_id)
    if not workspace:
        raise ModelNotConfiguredError(f"Workspace {workspace_id} not found")

    if not workspace.embedding_profile_id:
        raise ModelNotConfiguredError(
            "No embedding profile configured for this workspace. "
            "Please configure an embedding profile in workspace settings."
        )

    profile = db.get(EmbeddingProfileORM, workspace.embedding_profile_id)
    if not profile:
        raise ModelNotConfiguredError(
            f"Embedding profile {workspace.embedding_profile_id} not found. "
            "Please reconfigure the embedding profile in workspace settings."
        )

    return profile


def get_embedding_for_query(library_id: str, db: Session) -> EmbeddingProfileORM:
    """
    Resolve the embedding profile to use for querying a knowledge library.
    Must use the library's embedding snapshot profile — no fallback allowed.

    Raises LibraryNotIndexedError if the library has no indexed embedding snapshot.
    Raises ModelNotConfiguredError if the snapshot profile no longer exists.
    """
    library = db.get(KnowledgeLibraryORM, library_id)
    if not library:
        raise LibraryNotIndexedError(library_id)

    if not library.embedding_model_snapshot:
        raise LibraryNotIndexedError(library_id)

    snapshot = json.loads(library.embedding_model_snapshot)
    profile_id = snapshot.get("profile_id")
    if not profile_id:
        raise LibraryNotIndexedError(library_id)

    profile = db.get(EmbeddingProfileORM, profile_id)
    if not profile:
        raise ModelNotConfiguredError(
            f"Embedding profile {profile_id} (used during indexing) no longer exists. "
            "Please re-index this library with an available embedding profile."
        )

    return profile


def get_reranker_for_workspace(workspace_id: str, task_type: str, db: Session) -> RerankProfileORM | None:
    """
    Resolve the rerank profile for a workspace + task_type.
    Returns None if rerank is disabled, not configured, or task_type is not in apply_to_task_types.
    Never raises — rerank is optional and its absence is not an error.
    """
    workspace = db.get(WorkspaceORM, workspace_id)
    if not workspace:
        return None
    if not workspace.rerank_enabled:
        return None
    if not workspace.rerank_profile_id:
        return None

    # Check task_type filter
    if workspace.rerank_apply_to_task_types:
        try:
            allowed = json.loads(workspace.rerank_apply_to_task_types)
            if task_type not in allowed:
                return None
        except Exception:
            return None

    profile = db.get(RerankProfileORM, workspace.rerank_profile_id)
    return profile  # may be None if profile was deleted
