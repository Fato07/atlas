"""Integration tests for get_brain and list_brains tools."""

import pytest
from fastmcp import FastMCP

from atlas_gtm_mcp.qdrant import register_qdrant_tools
from tests.conftest import TEST_BRAIN_ID, TEST_VERTICAL, requires_qdrant


@pytest.fixture
def mcp_server(seed_test_brain):
    """Create MCP server with seeded brain."""
    mcp = FastMCP("test-qdrant")
    register_qdrant_tools(mcp)
    return mcp


@requires_qdrant
class TestGetBrainIntegration:
    """Integration tests for get_brain against real Qdrant."""

    @pytest.mark.asyncio
    async def test_get_brain_by_vertical(self, mcp_server):
        """Test retrieves brain by vertical name."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical=TEST_VERTICAL)

        assert result is not None
        assert result["vertical"] == TEST_VERTICAL
        assert result["status"] == "active"

    @pytest.mark.asyncio
    async def test_get_brain_by_id(self, mcp_server):
        """Test retrieves brain by brain_id."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(brain_id=TEST_BRAIN_ID)

        assert result is not None
        assert result["id"] == TEST_BRAIN_ID

    @pytest.mark.asyncio
    async def test_get_brain_returns_none_for_missing_vertical(self, mcp_server):
        """Test returns None when vertical not found."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical="nonexistent_vertical")

        assert result is None

    @pytest.mark.asyncio
    async def test_get_brain_returns_none_for_missing_id(self, mcp_server):
        """Test returns None when brain_id not found."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(brain_id="brain_nonexistent_v1")

        assert result is None

    @pytest.mark.asyncio
    async def test_get_brain_result_structure(self, mcp_server):
        """Test returned brain has correct structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical=TEST_VERTICAL)

        assert result is not None
        # Verify all required fields per BrainResult
        assert "id" in result
        assert "name" in result
        assert "vertical" in result
        assert "status" in result
        assert "config" in result
        assert "stats" in result
        assert "created_at" in result
        assert "updated_at" in result

    @pytest.mark.asyncio
    async def test_get_brain_config_structure(self, mcp_server):
        """Test brain config has expected structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical=TEST_VERTICAL)

        assert result is not None
        config = result["config"]
        assert isinstance(config, dict)
        # Verify config has expected keys from seeded data
        assert "default_tier_thresholds" in config
        assert "auto_response_enabled" in config

    @pytest.mark.asyncio
    async def test_get_brain_stats_structure(self, mcp_server):
        """Test brain stats has expected structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical=TEST_VERTICAL)

        assert result is not None
        stats = result["stats"]
        assert isinstance(stats, dict)


@requires_qdrant
class TestListBrainsIntegration:
    """Integration tests for list_brains against real Qdrant."""

    @pytest.mark.asyncio
    async def test_list_brains_returns_list(self, mcp_server):
        """Test returns list of all brains."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("list_brains")

        result = await tool.fn()

        assert isinstance(result, list)
        # Should contain at least our test brain
        assert len(result) >= 1

    @pytest.mark.asyncio
    async def test_list_brains_includes_test_brain(self, mcp_server):
        """Test list includes the seeded test brain."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("list_brains")

        result = await tool.fn()

        test_brains = [b for b in result if b["id"] == TEST_BRAIN_ID]
        assert len(test_brains) == 1
        assert test_brains[0]["vertical"] == TEST_VERTICAL

    @pytest.mark.asyncio
    async def test_list_brains_result_structure(self, mcp_server):
        """Test each brain in list has correct structure."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("list_brains")

        result = await tool.fn()

        assert len(result) > 0
        brain = result[0]

        # Verify structure matches get_brain result
        assert "id" in brain
        assert "name" in brain
        assert "vertical" in brain
        assert "status" in brain
