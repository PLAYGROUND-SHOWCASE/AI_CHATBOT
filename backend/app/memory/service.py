"""Memory service for persistent user context"""
from __future__ import annotations
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import Memory

logger = logging.getLogger(__name__)

MEMORY_CATEGORIES = ["preferences", "personal_context", "projects", "important_information", "conversation_summary"]


class MemoryService:
    async def get_memories(self, db: AsyncSession, user_id: int, category: Optional[str] = None) -> list[dict]:
        query = select(Memory).where(Memory.user_id == user_id)
        if category:
            query = query.where(Memory.category == category)
        query = query.order_by(Memory.importance.desc(), Memory.updated_at.desc())
        result = await db.execute(query)
        memories = result.scalars().all()
        return [
            {
                "id": m.id,
                "category": m.category,
                "key": m.key,
                "value": m.value,
                "importance": m.importance,
                "created_at": m.created_at.isoformat(),
            }
            for m in memories
        ]

    async def upsert_memory(
        self,
        db: AsyncSession,
        user_id: int,
        category: str,
        key: str,
        value: str,
        importance: float = 0.5,
    ) -> dict:
        result = await db.execute(
            select(Memory).where(
                Memory.user_id == user_id,
                Memory.category == category,
                Memory.key == key,
            )
        )
        memory = result.scalar_one_or_none()
        if memory:
            memory.value = value
            memory.importance = importance
        else:
            memory = Memory(
                user_id=user_id,
                category=category,
                key=key,
                value=value,
                importance=importance,
            )
            db.add(memory)
        await db.commit()
        await db.refresh(memory)
        return {"id": memory.id, "category": memory.category, "key": memory.key, "value": memory.value}

    async def delete_memory(self, db: AsyncSession, user_id: int, memory_id: int) -> bool:
        result = await db.execute(
            select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
        )
        memory = result.scalar_one_or_none()
        if memory:
            await db.delete(memory)
            await db.commit()
            return True
        return False

    async def clear_all(self, db: AsyncSession, user_id: int):
        await db.execute(delete(Memory).where(Memory.user_id == user_id))
        await db.commit()

    async def get_context_for_gemini(self, db: AsyncSession, user_id: int) -> str:
        """Return top relevant memories as a context string for Gemini."""
        memories = await self.get_memories(db, user_id)
        if not memories:
            return ""
        lines = ["User memory context:"]
        for m in memories[:20]:  # cap at 20
            lines.append(f"- [{m['category']}] {m['key']}: {m['value']}")
        return "\n".join(lines)


memory_service = MemoryService()
