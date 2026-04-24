from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, workspaces, rule_sets
from app.api import knowledge_libraries, knowledge_documents, tasks, knowledge_search
from app.api.assets import router as assets_router, asset_router
from app.api.chat import router as chat_router
from app.api.workflows import router as workflows_router
from app.api.agent_tools import router as agent_tools_router
from app.api.prompt_profiles import router as prompt_profiles_router
from app.api.logs import router as logs_router
from app.api.llm_profiles import router as llm_profiles_router
from app.api.embedding_profiles import router as embedding_profiles_router
from app.api.rerank_profiles import router as rerank_profiles_router
from app.api.knowledge_preview import router as knowledge_preview_router
from app.api.model_catalog import router as model_catalog_router
from app.api.usage import router as usage_router
from app.api.custom_asset_type_configs import router as custom_asset_type_configs_router
from app.api.workspace_skills import router as workspace_skills_router
from app.storage.database import init_db, get_db
from app.storage.seed import seed_default_data
from app.services.catalog_service import load_static_catalog

app = FastAPI(title="TRPG Workbench Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    init_db()
    seed_default_data()
    # M7: seed static model catalog
    db = next(get_db())
    try:
        load_static_catalog(db)
    finally:
        db.close()


app.include_router(health.router)
app.include_router(workspaces.router)
app.include_router(rule_sets.router)
app.include_router(llm_profiles_router)
app.include_router(embedding_profiles_router)
app.include_router(rerank_profiles_router)
app.include_router(model_catalog_router)
app.include_router(usage_router)
app.include_router(knowledge_libraries.router)
app.include_router(knowledge_documents.router)
app.include_router(tasks.router)
app.include_router(knowledge_search.router)
app.include_router(knowledge_preview_router)
app.include_router(assets_router)
app.include_router(asset_router)
app.include_router(chat_router)
app.include_router(workflows_router)
app.include_router(agent_tools_router)
app.include_router(prompt_profiles_router)
app.include_router(logs_router)
app.include_router(custom_asset_type_configs_router)
app.include_router(workspace_skills_router)
