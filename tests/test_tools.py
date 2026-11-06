"""Tests for ZARVIS backend tools"""
import pytest
import asyncio
from app.tools.registry import CalculatorTool, TimeTool, ToolRegistry


@pytest.mark.asyncio
async def test_calculator_basic():
    tool = CalculatorTool()
    result = await tool.execute({"expression": "2 + 2"})
    assert result["result"] == 4


@pytest.mark.asyncio
async def test_calculator_complex():
    tool = CalculatorTool()
    result = await tool.execute({"expression": "245 * 82"})
    assert result["result"] == 20090


@pytest.mark.asyncio
async def test_calculator_invalid():
    tool = CalculatorTool()
    result = await tool.execute({"expression": "import os"})
    assert "error" in result


@pytest.mark.asyncio
async def test_time_tool():
    tool = TimeTool()
    result = await tool.execute({})
    assert "datetime" in result
    assert "date" in result
    assert "time" in result


@pytest.mark.asyncio
async def test_registry_list():
    registry = ToolRegistry()
    tools = registry.all_tools()
    names = [t["name"] for t in tools]
    assert "calculator" in names
    assert "weather" in names
    assert "time" in names
    assert "web_search" in names


@pytest.mark.asyncio
async def test_registry_execute_unknown():
    registry = ToolRegistry()
    result = await registry.execute("nonexistent_tool", {})
    assert "error" in result


@pytest.mark.asyncio
async def test_registry_execute_calculator():
    registry = ToolRegistry()
    result = await registry.execute("calculator", {"expression": "10 * 10"})
    assert result.get("result") == 100
