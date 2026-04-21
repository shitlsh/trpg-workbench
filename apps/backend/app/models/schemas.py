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
