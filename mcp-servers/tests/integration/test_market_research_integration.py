"""Integration tests for search_market_research tool."""

import pytest
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from atlas_gtm_mcp.qdrant import register_qdrant_tools
from tests.conftest import TEST_BRAIN_ID, requires_qdrant


@pytest.fixture
def mcp_server(seed_market_research):
    """Create MCP server with seeded research."""
    mcp = FastMCP("test-qdrant")
    register_qdrant_tools(mcp)
    return mcp


@requires_qdrant
class TestSearchMarketResearchIntegration:
    """Integration tests for search_market_research against real Qdrant."""

    @pytest.mark.asyncio
    async def test_returns_matching_research(self, mcp_server):
        """Test semantic search returns relevant research docs."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="market overview trends growth automation",
            limit=5,
        )

        assert isinstance(result, list)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_content_type_filter_market_overview(self, mcp_server):
        """Test content_type filter returns only market_overview docs."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="market trends growth",
            content_type="market_overview",
            limit=5,
        )

        assert isinstance(result, list)
        for doc in result:
            assert doc["content_type"] == "market_overview"

    @pytest.mark.asyncio
    async def test_content_type_filter_competitor(self, mcp_server):
        """Test content_type filter returns only competitor_analysis docs."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="competitor analysis acme",
            content_type="competitor_analysis",
            limit=5,
        )

        assert isinstance(result, list)
        for doc in result:
            assert doc["content_type"] == "competitor_analysis"

    @pytest.mark.asyncio
    async def test_limit_respected(self, mcp_server):
        """Test limit parameter restricts results."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="market",
            limit=1,
        )

        assert len(result) <= 1

    @pytest.mark.asyncio
    async def test_nonexistent_brain_returns_empty(self, mcp_server):
        """Test querying non-existent brain returns empty list."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id="brain_nonexistent_v1",
            query="anything",
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_invalid_content_type_raises_error(self, mcp_server):
        """Test invalid content_type raises ToolError."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id=TEST_BRAIN_ID,
                query="market",
                content_type="invalid_type",
            )
        assert "Invalid content_type" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_result_structure(self, mcp_server):
        """Test returned docs have correct structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="market overview",
            limit=5,
        )

        assert len(result) > 0
        doc = result[0]

        # Verify all required fields per MarketResearchResult
        assert "id" in doc
        assert "score" in doc
        assert "content_type" in doc
        assert "title" in doc
        assert "content" in doc
        assert "key_facts" in doc
        assert "source_url" in doc

        # Verify score is valid
        assert 0 <= doc["score"] <= 1
