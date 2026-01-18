"""Integration tests for query_icp_rules tool."""

import pytest
from fastmcp import FastMCP

from atlas_gtm_mcp.qdrant import register_qdrant_tools
from tests.conftest import TEST_BRAIN_ID, requires_qdrant


@pytest.fixture
def mcp_server(seed_icp_rules):
    """Create MCP server with seeded test data."""
    mcp = FastMCP("test-qdrant")
    register_qdrant_tools(mcp)
    return mcp


@requires_qdrant
class TestQueryICPRulesIntegration:
    """Integration tests for query_icp_rules against real Qdrant."""

    @pytest.mark.asyncio
    async def test_returns_matching_rules(self, mcp_server):
        """Test semantic search returns relevant ICP rules."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="company size employees mid-market",
            limit=10,
        )

        assert isinstance(result, list)
        assert len(result) > 0
        # Verify we got valid ICP rules
        for rule in result:
            assert "id" in rule
            assert "score" in rule
            assert "category" in rule

    @pytest.mark.asyncio
    async def test_category_filter_firmographic(self, mcp_server):
        """Test category filter returns only firmographic rules."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="company",
            category="firmographic",
            limit=10,
        )

        assert isinstance(result, list)
        for rule in result:
            assert rule["category"] == "firmographic"

    @pytest.mark.asyncio
    async def test_category_filter_technographic(self, mcp_server):
        """Test category filter returns only technographic rules."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="technology python",
            category="technographic",
            limit=10,
        )

        assert isinstance(result, list)
        for rule in result:
            assert rule["category"] == "technographic"

    @pytest.mark.asyncio
    async def test_limit_respected(self, mcp_server):
        """Test limit parameter restricts results."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="company",
            limit=1,
        )

        assert len(result) <= 1

    @pytest.mark.asyncio
    async def test_nonexistent_brain_returns_empty(self, mcp_server):
        """Test querying non-existent brain returns empty list."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id="brain_nonexistent_v1",
            query="anything",
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_result_structure(self, mcp_server):
        """Test returned rules have correct structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            query="company size",
            limit=5,
        )

        assert len(result) > 0
        rule = result[0]

        # Verify all required fields per ICPRuleResult
        assert "id" in rule
        assert "score" in rule
        assert "category" in rule
        assert "attribute" in rule
        assert "condition" in rule
        assert "score_weight" in rule
        assert "is_knockout" in rule
        assert "reasoning" in rule

        # Verify score is valid (-1 to 1 range for cosine similarity)
        # Note: With deterministic/random embeddings, scores can be negative
        assert -1 <= rule["score"] <= 1
