"""Integration tests for get_response_template tool."""

import pytest
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from atlas_gtm_mcp.qdrant import register_qdrant_tools
from tests.conftest import TEST_BRAIN_ID, requires_qdrant


@pytest.fixture
def mcp_server(seed_response_templates):
    """Create MCP server with seeded templates."""
    mcp = FastMCP("test-qdrant")
    register_qdrant_tools(mcp)
    return mcp


@requires_qdrant
class TestGetResponseTemplateIntegration:
    """Integration tests for get_response_template against real Qdrant."""

    @pytest.mark.asyncio
    async def test_returns_templates_for_reply_type(self, mcp_server):
        """Test retrieves templates for given reply type."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            reply_type="positive_interest",
        )

        assert isinstance(result, list)
        assert len(result) >= 2  # We seeded 2 positive_interest templates
        for template in result:
            assert template["reply_type"] == "positive_interest"

    @pytest.mark.asyncio
    async def test_tier_filter_tier1(self, mcp_server):
        """Test tier filter returns only tier 1 templates."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            reply_type="positive_interest",
            tier=1,
        )

        assert isinstance(result, list)
        for template in result:
            assert template["tier"] == 1

    @pytest.mark.asyncio
    async def test_tier_filter_tier2(self, mcp_server):
        """Test tier filter returns only tier 2 templates."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            reply_type="positive_interest",
            tier=2,
        )

        assert isinstance(result, list)
        for template in result:
            assert template["tier"] == 2

    @pytest.mark.asyncio
    async def test_auto_send_only_returns_tier1(self, mcp_server):
        """Test auto_send_only=True returns only tier 1."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            reply_type="positive_interest",
            auto_send_only=True,
        )

        assert isinstance(result, list)
        for template in result:
            assert template["tier"] == 1

    @pytest.mark.asyncio
    async def test_nonexistent_reply_type_returns_empty(self, mcp_server):
        """Test non-matching reply type returns empty list."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            reply_type="unsubscribe",  # We didn't seed this type
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_invalid_reply_type_raises_error(self, mcp_server):
        """Test invalid reply_type raises ToolError."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id=TEST_BRAIN_ID,
                reply_type="invalid_type",
            )
        assert "Invalid reply_type" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_result_structure(self, mcp_server):
        """Test returned templates have correct structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            reply_type="positive_interest",
        )

        assert len(result) > 0
        template = result[0]

        # Verify all required fields per ResponseTemplateResult
        assert "id" in template
        assert "reply_type" in template
        assert "tier" in template
        assert "template_text" in template
        assert "variables" in template
        assert "personalization_instructions" in template
