"""Google Gemini AI service"""
from __future__ import annotations
import asyncio
import logging
from typing import AsyncGenerator, Optional
import google.generativeai as genai
from app.config import settings

logger = logging.getLogger(__name__)

# Personality mode modifiers
PERSONALITY_MODIFIERS = {
    "professional": "Respond in a formal, business-like tone.",
    "friendly": "Respond in a warm, friendly, conversational tone.",
    "concise": "Keep all responses as brief as possible.",
    "technical": "Use technical terminology and provide detailed technical explanations.",
    "creative": "Be imaginative and creative in your responses.",
    "researcher": "Cite reasoning, be thorough, and explore multiple angles.",
    "executive": "Be direct, results-oriented, and focus on key points.",
}


class GeminiService:
    def __init__(self):
        if not settings.gemini_api_key:
            logger.warning("GEMINI_API_KEY not set – demo mode active")
            self._available = False
            return

        genai.configure(api_key=settings.gemini_api_key)
        self._model = genai.GenerativeModel(
            model_name=settings.gemini_model,
            system_instruction=settings.system_prompt,
        )
        self._available = True

    @property
    def is_available(self) -> bool:
        return self._available

    def _build_history(self, messages: list[dict]) -> list[dict]:
        """Convert stored messages to Gemini history format."""
        history = []
        for msg in messages[:-1]:  # exclude the latest user message
            role = "user" if msg["role"] == "user" else "model"
            history.append({"role": role, "parts": [msg["content"]]})
        return history

    async def chat(
        self,
        user_message: str,
        history: list[dict] | None = None,
        personality: str = "professional",
        tools_schema: list[dict] | None = None,
    ) -> str:
        """Single-turn chat, returns full response."""
        if not self._available:
            return self._demo_response(user_message)

        try:
            modifier = PERSONALITY_MODIFIERS.get(personality, "")
            prompt = f"{modifier}\n\n{user_message}" if modifier else user_message

            convo = self._model.start_chat(history=self._build_history(history or []))
            response = await asyncio.to_thread(convo.send_message, prompt)
            return response.text
        except Exception as exc:
            logger.error("Gemini chat error: %s", exc)
            return f"I encountered an error processing your request: {str(exc)}"

    async def stream_chat(
        self,
        user_message: str,
        history: list[dict] | None = None,
        personality: str = "professional",
    ) -> AsyncGenerator[str, None]:
        """Streaming chat – yields text chunks."""
        if not self._available:
            demo = self._demo_response(user_message)
            for word in demo.split():
                yield word + " "
                await asyncio.sleep(0.05)
            return

        try:
            modifier = PERSONALITY_MODIFIERS.get(personality, "")
            prompt = f"{modifier}\n\n{user_message}" if modifier else user_message

            convo = self._model.start_chat(history=self._build_history(history or []))

            def _stream():
                return convo.send_message(prompt, stream=True)

            response = await asyncio.to_thread(_stream)
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as exc:
            logger.error("Gemini stream error: %s", exc)
            yield f"Error: {str(exc)}"

    async def analyze_image(self, image_bytes: bytes, prompt: str) -> str:
        """Analyze an image with Gemini Vision."""
        if not self._available:
            return "Image analysis is not available in demo mode."

        try:
            import PIL.Image
            import io
            image = PIL.Image.open(io.BytesIO(image_bytes))
            response = await asyncio.to_thread(self._model.generate_content, [prompt, image])
            return response.text
        except Exception as exc:
            logger.error("Gemini vision error: %s", exc)
            return f"Image analysis failed: {str(exc)}"

    async def analyze_document(self, text_content: str, prompt: str) -> str:
        """Analyze document text content."""
        combined = f"{prompt}\n\nDocument content:\n{text_content[:30000]}"
        return await self.chat(combined)

    def _demo_response(self, message: str) -> str:
        """Fallback demo responses when API key is not set."""
        msg_lower = message.lower()
        if "hello" in msg_lower or "hi" in msg_lower:
            return "Hello! I'm ZARVIS, your AI command intelligence. I'm currently running in demo mode. Please configure your Gemini API key to unlock my full capabilities."
        if "weather" in msg_lower:
            return "I'd check the weather for you, but I'm in demo mode. Configure GEMINI_API_KEY to enable live weather queries."
        if "calculate" in msg_lower or "math" in msg_lower:
            return "I can perform calculations! Try asking me something like 'What is 245 times 82?' once the API key is configured."
        if "what can you do" in msg_lower:
            return "I'm ZARVIS – I can have voice conversations, answer questions, search the web, analyze files, check the weather, do calculations, manage your tasks, and much more. Add your Gemini API key to get started!"
        if "joke" in msg_lower:
            return "Why did the AI go to school? To improve its neural network! 😄"
        return "I'm ZARVIS running in demo mode. Please set your GEMINI_API_KEY environment variable to enable full AI capabilities."


# Singleton
gemini_service = GeminiService()
