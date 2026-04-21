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
from app.storage.database import init_db
from app.storage.seed import seed_default_data

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


app.include_router(health.router)
app.include_router(workspaces.router)
app.include_router(rule_sets.router)
app.include_router(llm_profiles_router)
app.include_router(embedding_profiles_router)
app.include_router(knowledge_libraries.router)
app.include_router(knowledge_documents.router)
app.include_router(tasks.router)
app.include_router(knowledge_search.router)
app.include_router(assets_router)
app.include_router(asset_router)
app.include_router(chat_router)
app.include_router(workflows_router)
app.include_router(agent_tools_router)
app.include_router(prompt_profiles_router)
app.include_router(logs_router)
