"""Tool registry and built-in tools"""
from __future__ import annotations
import asyncio
import json
import logging
import math
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any
import aiohttp

logger = logging.getLogger(__name__)


class Tool(ABC):
    name: str
    description: str
    parameters: dict
    enabled: bool = True

    @abstractmethod
    async def execute(self, arguments: dict) -> dict:
        pass


class CalculatorTool(Tool):
    name = "calculator"
    description = "Perform mathematical calculations safely."
    parameters = {
        "expression": {"type": "string", "description": "The math expression to evaluate"},
    }

    async def execute(self, arguments: dict) -> dict:
        expr = arguments.get("expression", "")
        try:
            # Safe eval with only math functions
            allowed = {k: getattr(math, k) for k in dir(math) if not k.startswith("_")}
            allowed.update({"abs": abs, "round": round, "min": min, "max": max})
            result = eval(expr, {"__builtins__": {}}, allowed)  # noqa: S307
            return {"expression": expr, "result": result, "formatted": f"{expr} = {result:,}"}
        except Exception as e:
            return {"error": str(e), "expression": expr}


class WeatherTool(Tool):
    name = "weather"
    description = "Get current weather for a location."
    parameters = {
        "location": {"type": "string", "description": "City or location name"},
    }

    async def execute(self, arguments: dict) -> dict:
        location = arguments.get("location", "")
        try:
            url = f"https://wttr.in/{location}?format=j1"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        current = data["current_condition"][0]
                        area = data["nearest_area"][0]
                        city = area["areaName"][0]["value"]
                        country = area["country"][0]["value"]
                        return {
                            "location": f"{city}, {country}",
                            "temperature_c": int(current["temp_C"]),
                            "temperature_f": int(current["temp_F"]),
                            "condition": current["weatherDesc"][0]["value"],
                            "humidity": int(current["humidity"]),
                            "wind_kmph": int(current["windspeedKmph"]),
                            "feels_like_c": int(current["FeelsLikeC"]),
                        }
        except Exception as e:
            logger.error("Weather tool error: %s", e)
        # Fallback demo data
        return {
            "location": location or "Unknown",
            "temperature_c": 28,
            "temperature_f": 82,
            "condition": "Partly Cloudy",
            "humidity": 72,
            "wind_kmph": 15,
            "feels_like_c": 30,
            "note": "Live weather unavailable – showing demo data",
        }


class TimeTool(Tool):
    name = "time"
    description = "Get the current date and time."
    parameters = {}

    async def execute(self, arguments: dict) -> dict:
        now = datetime.now()
        return {
            "datetime": now.isoformat(),
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%I:%M %p"),
            "timezone": "local",
        }


class WebSearchTool(Tool):
    name = "web_search"
    description = "Search the web for information."
    parameters = {
        "query": {"type": "string", "description": "The search query"},
    }

    async def execute(self, arguments: dict) -> dict:
        query = arguments.get("query", "")
        # Use DuckDuckGo instant answers (no API key required)
        try:
            url = f"https://api.duckduckgo.com/?q={query}&format=json&no_redirect=1"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        abstract = data.get("AbstractText", "")
                        source = data.get("AbstractSource", "")
                        related = [r.get("Text", "") for r in data.get("RelatedTopics", [])[:3] if isinstance(r, dict)]
                        return {
                            "query": query,
                            "abstract": abstract or "No direct answer found.",
                            "source": source,
                            "related_topics": related,
                            "search_url": f"https://duckduckgo.com/?q={query}",
                        }
        except Exception as e:
            logger.error("Web search error: %s", e)
        return {
            "query": query,
            "abstract": "Search service temporarily unavailable.",
            "source": "",
            "related_topics": [],
        }


class SystemStatusTool(Tool):
    name = "system_status"
    description = "Get current system status (CPU, memory, network)."
    parameters = {}

    async def execute(self, arguments: dict) -> dict:
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            return {
                "cpu_percent": cpu,
                "memory_percent": mem.percent,
                "memory_used_gb": round(mem.used / 1e9, 2),
                "memory_total_gb": round(mem.total / 1e9, 2),
                "status": "online",
            }
        except ImportError:
            return {
                "cpu_percent": 32,
                "memory_percent": 54,
                "memory_used_gb": 8.6,
                "memory_total_gb": 16.0,
                "status": "online",
                "note": "Install psutil for real system metrics",
            }


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}
        self._register_defaults()

    def _register_defaults(self):
        for tool in [CalculatorTool(), WeatherTool(), TimeTool(), WebSearchTool(), SystemStatusTool()]:
            self.register(tool)

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all_tools(self) -> list[dict]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
                "enabled": t.enabled,
            }
            for t in self._tools.values()
        ]

    async def execute(self, tool_name: str, arguments: dict) -> dict:
        tool = self.get(tool_name)
        if not tool:
            return {"error": f"Tool '{tool_name}' not found"}
        if not tool.enabled:
            return {"error": f"Tool '{tool_name}' is disabled"}
        return await tool.execute(arguments)


tool_registry = ToolRegistry()
