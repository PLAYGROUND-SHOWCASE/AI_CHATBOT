"""Memory, Tools, Files, Settings API routes"""
from __future__ import annotations
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db, User, UserSettings
from app.database import File as FileModel
from app.auth import get_current_user
from app.memory.service import memory_service
from app.tools.registry import tool_registry
from app.config import settings

# ── Memory ─────────────────────────────────────────────────────────────────

memory_router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryUpsertRequest(BaseModel):
    category: str
    key: str
    value: str
    importance: float = 0.5


@memory_router.get("")
async def get_memories(
    category: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await memory_service.get_memories(db, current_user.id, category)


@memory_router.post("")
async def upsert_memory(
    data: MemoryUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await memory_service.upsert_memory(db, current_user.id, data.category, data.key, data.value, data.importance)


@memory_router.delete("/{memory_id}")
async def delete_memory(
    memory_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await memory_service.delete_memory(db, current_user.id, memory_id)
    if not deleted:
        raise HTTPException(404, "Memory not found")
    return {"deleted": True}


@memory_router.delete("")
async def clear_memory(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await memory_service.clear_all(db, current_user.id)
    return {"cleared": True}


# ── Tools ──────────────────────────────────────────────────────────────────

tools_router = APIRouter(prefix="/api/tools", tags=["tools"])


class ToolExecuteRequest(BaseModel):
    arguments: dict = {}


@tools_router.get("")
async def list_tools(_: User = Depends(get_current_user)):
    return tool_registry.all_tools()


@tools_router.post("/{tool_name}/execute")
async def execute_tool(
    tool_name: str,
    data: ToolExecuteRequest,
    _: User = Depends(get_current_user),
):
    result = await tool_registry.execute(tool_name, data.arguments)
    return result


# ── Files ──────────────────────────────────────────────────────────────────

files_router = APIRouter(prefix="/api/files", tags=["files"])

ALLOWED_MIME_TYPES = {
    "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/json", "image/jpeg", "image/png", "image/webp",
    "audio/mpeg", "audio/wav", "audio/webm",
}


@files_router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, f"File type {file.content_type} not allowed")

    content = await file.read()
    if len(content) > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(400, f"File exceeds {settings.max_file_size_mb}MB limit")

    # Save to storage
    os.makedirs(settings.storage_path, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    storage_name = f"{uuid.uuid4()}{ext}"
    storage_path = os.path.join(settings.storage_path, storage_name)

    with open(storage_path, "wb") as f:
        f.write(content)

    db_file = FileModel(
        user_id=current_user.id,
        filename=storage_name,
        original_name=file.filename or storage_name,
        mime_type=file.content_type,
        storage_path=storage_path,
        size_bytes=len(content),
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)

    return {
        "id": db_file.id,
        "filename": db_file.original_name,
        "mime_type": db_file.mime_type,
        "size_bytes": db_file.size_bytes,
    }


@files_router.get("")
async def list_files(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileModel).where(FileModel.user_id == current_user.id).order_by(FileModel.created_at.desc())
    )
    files = result.scalars().all()
    return [
        {
            "id": f.id,
            "filename": f.original_name,
            "mime_type": f.mime_type,
            "size_bytes": f.size_bytes,
            "created_at": f.created_at.isoformat(),
        }
        for f in files
    ]


@files_router.delete("/{file_id}")
async def delete_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FileModel).where(FileModel.id == file_id, FileModel.user_id == current_user.id)
    )
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "File not found")
    try:
        os.remove(f.storage_path)
    except OSError:
        pass
    await db.delete(f)
    await db.commit()
    return {"deleted": True}


# ── Settings ───────────────────────────────────────────────────────────────

settings_router = APIRouter(prefix="/api/settings", tags=["settings"])


@settings_router.get("")
async def get_settings_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == current_user.id))
    us = result.scalar_one_or_none()
    if not us:
        return {}
    return us.settings_data


@settings_router.put("")
async def update_settings(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == current_user.id))
    us = result.scalar_one_or_none()
    if us:
        us.settings_data = {**us.settings_data, **data}
    else:
        us = UserSettings(user_id=current_user.id, settings_data=data)
        db.add(us)
    await db.commit()
    return {"updated": True}
