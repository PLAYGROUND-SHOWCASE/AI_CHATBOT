"""FastAPI application entry point"""
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.config import settings
from app.database import init_db
from app.api.auth import router as auth_router
from app.api.conversations import router as conv_router
from app.api.resources import memory_router, tools_router, files_router, settings_router
from app.websocket.routes import router as ws_router

logging.basicConfig(level=getattr(logging, settings.log_level), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ZARVIS backend starting up...")
    try:
        await init_db()
        logger.info("Database initialized")
    except Exception as e:
        logger.warning("DB init skipped (no DB configured): %s", e)

    os.makedirs(settings.storage_path, exist_ok=True)
    logger.info("ZARVIS backend ready")
    yield
    logger.info("ZARVIS backend shutting down")


app = FastAPI(
    title="ZARVIS API",
    description="AI Command Intelligence Backend",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router)
app.include_router(conv_router)
app.include_router(memory_router)
app.include_router(tools_router)
app.include_router(files_router)
app.include_router(settings_router)
app.include_router(ws_router)


@app.get("/api/health")
async def health():
    from app.ai.gemini_service import gemini_service
    return {
        "status": "online",
        "version": settings.app_version,
        "gemini_available": gemini_service.is_available,
        "demo_mode": not gemini_service.is_available,
    }
