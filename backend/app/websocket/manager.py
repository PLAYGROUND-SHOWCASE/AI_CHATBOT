"""WebSocket manager for real-time ZARVIS communication"""
from __future__ import annotations
import asyncio
import json
import logging
from typing import Optional
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self._connections[client_id] = websocket
        logger.info("WebSocket connected: %s", client_id)

    def disconnect(self, client_id: str):
        self._connections.pop(client_id, None)
        logger.info("WebSocket disconnected: %s", client_id)

    async def send(self, client_id: str, event: dict):
        ws = self._connections.get(client_id)
        if ws:
            try:
                await ws.send_text(json.dumps(event))
            except Exception as e:
                logger.error("Send error to %s: %s", client_id, e)
                self.disconnect(client_id)

    async def broadcast(self, event: dict):
        for client_id in list(self._connections.keys()):
            await self.send(client_id, event)

    # ── Convenience event senders ──────────────────────────────────────────

    async def send_state(self, client_id: str, state: str):
        await self.send(client_id, {"type": "state", "state": state})

    async def send_transcript(self, client_id: str, text: str):
        await self.send(client_id, {"type": "transcript", "text": text})

    async def send_assistant_chunk(self, client_id: str, text: str):
        await self.send(client_id, {"type": "assistant_chunk", "text": text})

    async def send_assistant_done(self, client_id: str, full_text: str):
        await self.send(client_id, {"type": "assistant_done", "text": full_text})

    async def send_tool_start(self, client_id: str, tool: str, args: dict | None = None):
        await self.send(client_id, {"type": "tool_start", "tool": tool, "args": args or {}})

    async def send_tool_complete(self, client_id: str, tool: str, result: dict):
        await self.send(client_id, {"type": "tool_complete", "tool": tool, "result": result})

    async def send_tool_error(self, client_id: str, tool: str, error: str):
        await self.send(client_id, {"type": "tool_error", "tool": tool, "error": error})

    async def send_error(self, client_id: str, message: str):
        await self.send(client_id, {"type": "error", "message": message})

    async def send_audio(self, client_id: str, audio_b64: str):
        await self.send(client_id, {"type": "audio", "data": audio_b64})


ws_manager = ConnectionManager()
