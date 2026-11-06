"""WebSocket route handler – the heart of ZARVIS real-time communication"""
from __future__ import annotations
import asyncio
import json
import logging
import re
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db, Conversation, Message, ToolExecution, User
from app.auth import decode_token
from app.ai.gemini_service import gemini_service
from app.tools.registry import tool_registry
from app.memory.service import memory_service
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter()

# Detect tool intent patterns
TOOL_PATTERNS = {
    "weather": r"\b(weather|temperature|forecast|rain|sunny|humid)\b",
    "calculator": r"\b(calculate|compute|math|multiply|divide|add|subtract|\d+\s*[\+\-\*\/]\s*\d+)\b",
    "time": r"\b(time|date|today|now|clock|what day)\b",
    "web_search": r"\b(search|find|look up|google|latest|news|who is|what is|tell me about)\b",
    "system_status": r"\b(system status|cpu|memory|ram|disk|system info)\b",
}


def detect_tool(message: str) -> str | None:
    msg_lower = message.lower()
    for tool_name, pattern in TOOL_PATTERNS.items():
        if re.search(pattern, msg_lower, re.IGNORECASE):
            return tool_name
    return None


def extract_tool_args(tool_name: str, message: str) -> dict:
    if tool_name == "weather":
        # Try to extract location
        match = re.search(r"(?:weather|temperature|forecast)\s+(?:in|at|for)?\s+([A-Za-z\s]+)", message, re.IGNORECASE)
        return {"location": match.group(1).strip() if match else "current location"}
    if tool_name == "calculator":
        match = re.search(r"[\d\s\+\-\*\/\(\)\.]+", message)
        expr = match.group(0).strip() if match else message
        return {"expression": expr}
    if tool_name == "web_search":
        # Strip common prefixes
        query = re.sub(r"^(search for|find|look up|google|search)\s+", "", message, flags=re.IGNORECASE).strip()
        return {"query": query}
    return {}


@router.websocket("/ws/zarvis")
async def zarvis_ws(
    websocket: WebSocket,
    token: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    client_id = str(uuid.uuid4())

    # Auth
    user: User | None = None
    if token:
        payload = decode_token(token)
        if payload:
            result = await db.execute(select(User).where(User.id == int(payload.get("sub", 0))))
            user = result.scalar_one_or_none()

    await ws_manager.connect(websocket, client_id)
    await ws_manager.send_state(client_id, "idle")
    await ws_manager.send(client_id, {
        "type": "init",
        "gemini_available": gemini_service.is_available,
        "demo_mode": not gemini_service.is_available,
        "client_id": client_id,
    })

    # Conversation management
    conversation_id: int | None = None
    message_history: list[dict] = []

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            # ── Handle incoming message ────────────────────────────────────
            if msg_type == "user_message":
                user_text = data.get("text", "").strip()
                if not user_text:
                    continue

                personality = data.get("personality", "professional")
                conv_id = data.get("conversation_id")

                # Ensure conversation exists in DB
                if user and not conv_id:
                    conv = Conversation(user_id=user.id, title=user_text[:60])
                    db.add(conv)
                    await db.commit()
                    await db.refresh(conv)
                    conversation_id = conv.id
                    await ws_manager.send(client_id, {"type": "conversation_id", "id": conversation_id})
                elif conv_id:
                    conversation_id = conv_id

                # Save user message
                if user and conversation_id:
                    db.add(Message(conversation_id=conversation_id, role="user", content=user_text))
                    await db.commit()

                # Add to local history
                message_history.append({"role": "user", "content": user_text})

                # Notify transcript received
                await ws_manager.send_transcript(client_id, user_text)
                await ws_manager.send_state(client_id, "thinking")

                # Memory context
                memory_ctx = ""
                if user:
                    memory_ctx = await memory_service.get_context_for_gemini(db, user.id)

                # Tool detection
                detected_tool = detect_tool(user_text)
                tool_result_str = ""

                if detected_tool:
                    await ws_manager.send_state(client_id, "executing")
                    tool_args = extract_tool_args(detected_tool, user_text)
                    await ws_manager.send_tool_start(client_id, detected_tool, tool_args)

                    result = await tool_registry.execute(detected_tool, tool_args)

                    # Save tool execution
                    if user and conversation_id:
                        exec_rec = ToolExecution(
                            conversation_id=conversation_id,
                            tool_name=detected_tool,
                            arguments=tool_args,
                            result=result,
                            status="completed" if "error" not in result else "failed",
                        )
                        db.add(exec_rec)
                        await db.commit()

                    await ws_manager.send_tool_complete(client_id, detected_tool, result)
                    tool_result_str = f"\n\nTool result ({detected_tool}): {json.dumps(result)}"

                # Stream Gemini response
                await ws_manager.send_state(client_id, "speaking")
                full_prompt = user_text
                if memory_ctx:
                    full_prompt = f"{memory_ctx}\n\n{user_text}"
                if tool_result_str:
                    full_prompt += tool_result_str

                full_response = ""
                async for chunk in gemini_service.stream_chat(full_prompt, message_history[:-1], personality):
                    full_response += chunk
                    await ws_manager.send_assistant_chunk(client_id, chunk)

                await ws_manager.send_assistant_done(client_id, full_response)

                # Save assistant message
                if user and conversation_id:
                    db.add(Message(conversation_id=conversation_id, role="assistant", content=full_response))
                    await db.commit()

                message_history.append({"role": "assistant", "content": full_response})

                # Keep history manageable
                if len(message_history) > 40:
                    message_history = message_history[-30:]

                await ws_manager.send_state(client_id, "idle")

            elif msg_type == "stop":
                await ws_manager.send_state(client_id, "idle")

            elif msg_type == "ping":
                await ws_manager.send(client_id, {"type": "pong"})

    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)
    except Exception as exc:
        logger.error("WS error for %s: %s", client_id, exc)
        try:
            await ws_manager.send_error(client_id, "Internal server error")
        except Exception:
            pass
        ws_manager.disconnect(client_id)
