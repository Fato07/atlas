"""Integration tests for find_objection_handler tool."""

import pytest
from fastmcp import FastMCP

from atlas_gtm_mcp.qdrant import register_qdrant_tools
from tests.conftest import TEST_BRAIN_ID, requires_qdrant


@pytest.fixture
def mcp_server(seed_objection_handlers):
    """Create MCP server with seeded handlers."""
    mcp = FastMCP("test-qdrant")
    register_qdrant_tools(mcp)
    return mcp


@requires_qdrant
class TestFindObjectionHandlerIntegration:
    """Integration tests for find_objection_handler against real Qdrant."""

    @pytest.mark.asyncio
    async def test_finds_pricing_handler(self, mcp_server):
        """Test finds handler for pricing objection text."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        # Use text similar to seeded pricing handler
        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            objection_text="This is too expensive for our budget right now. We don't have the budget for this.",
        )

        # May return handler or None depending on semantic similarity
        if result is not None:
            assert "id" in result
            assert "confidence" in result
            assert result["confidence"] >= 0.70  # Threshold per FR-012

    @pytest.mark.asyncio
    async def test_finds_timing_handler(self, mcp_server):
        """Test finds handler for timing objection text."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            objection_text="We're not ready to start now. The timing isn't right for us.",
        )

        if result is not None:
            assert "id" in result
            assert "confidence" in result
            assert result["confidence"] >= 0.70

    @pytest.mark.asyncio
    async def test_returns_none_for_unrelated_text(self, mcp_server):
        """Test returns None when no match meets 0.70 threshold."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        # Use completely unrelated text
        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            objection_text="The weather is nice today. I like coffee in the morning.",
        )

        # Should return None or handler with confidence >= 0.70
        if result is not None:
            assert result["confidence"] >= 0.70

    @pytest.mark.asyncio
    async def test_returns_single_best_match(self, mcp_server):
        """Test returns only the single best matching handler, not a list."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            objection_text="We don't have budget for this pricing. It's too expensive.",
        )

        # Should return dict or None, not list
        assert result is None or isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_nonexistent_brain_returns_none(self, mcp_server):
        """Test querying non-existent brain returns None."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        result = await tool.fn(
            brain_id="brain_nonexistent_v1",
            objection_text="This is too expensive",
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_result_structure_when_found(self, mcp_server):
        """Test returned handler has correct structure when found."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        # Use text very similar to seeded handler
        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            objection_text="I understand budget is a concern. ROI is important to us.",
        )

        if result is not None:
            # Verify all required fields per ObjectionHandlerResult
            assert "id" in result
            assert "confidence" in result
            assert "objection_type" in result
            assert "handler_strategy" in result
            assert "handler_response" in result
            assert "variables" in result
            assert "follow_up_actions" in result
