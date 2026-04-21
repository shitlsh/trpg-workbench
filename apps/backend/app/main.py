from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, workspaces, rule_sets, model_profiles
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
app.include_router(model_profiles.router)
