"""Integration tests for add_insight tool."""

import pytest
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from atlas_gtm_mcp.qdrant import register_qdrant_tools
from tests.conftest import TEST_BRAIN_ID, requires_qdrant


@pytest.fixture
def mcp_server(seed_test_brain, clean_insights_collection):
    """Create MCP server with clean insights collection."""
    mcp = FastMCP("test-qdrant")
    register_qdrant_tools(mcp)
    return mcp


@requires_qdrant
class TestAddInsightIntegration:
    """Integration tests for add_insight against real Qdrant."""

    @pytest.mark.asyncio
    async def test_creates_insight_successfully(self, mcp_server):
        """Test creates new insight with quality gates passing."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content="Prospects in mid-market segment prefer monthly billing over annual contracts due to budget flexibility requirements",
            category="buying_process",
            importance="medium",
            source={
                "type": "call_transcript",
                "id": "call_test_001",
                "company_name": "Test Corp",
            },
        )

        assert result["status"] == "created"
        assert "id" in result
        assert "confidence" in result
        assert result["confidence"] >= 0.70  # Must pass minimum threshold

    @pytest.mark.asyncio
    async def test_detects_duplicate_insight(self, mcp_server, qdrant_client):
        """Test detects duplicate when similar insight exists."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        # Create first insight
        content = "Customers prefer self-service onboarding documentation over guided setup calls for simple integrations"
        first_result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content=content,
            category="pain_point",
            importance="medium",
            source={"type": "call_transcript", "id": "call_dup_001"},
        )

        assert first_result["status"] == "created"

        # Try to create exact same insight (should be duplicate)
        second_result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content=content,  # Exact same content = definite duplicate
            category="pain_point",
            importance="medium",
            source={"type": "call_transcript", "id": "call_dup_002"},
        )

        assert second_result["status"] == "duplicate"
        assert "existing_id" in second_result

    @pytest.mark.asyncio
    async def test_high_importance_requires_validation(self, mcp_server):
        """Test high importance insight is flagged for validation."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content="Critical strategic insight: Enterprise customers are shifting away from legacy vendors due to integration limitations",
            category="competitive_intel",
            importance="high",
            source={
                "type": "call_transcript",
                "id": "call_high_001",
                "company_name": "Important Client",
                "extracted_quote": "We're moving away from competitor X",
            },
        )

        assert result["status"] == "created"
        assert result["needs_validation"] is True

    @pytest.mark.asyncio
    async def test_buying_process_requires_validation(self, mcp_server):
        """Test buying_process category requires validation regardless of importance."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content="Decision makers typically need CFO approval for purchases over 10k annual commitment",
            category="buying_process",
            importance="low",  # Even low importance
            source={
                "type": "email_reply",  # +0.1 bonus
                "id": "email_bp_001",
                "company_name": "Budget Corp",  # +0.1 bonus to reach 0.7 threshold
            },
        )

        assert result["status"] == "created"
        assert result["needs_validation"] is True

    @pytest.mark.asyncio
    async def test_icp_signal_requires_validation(self, mcp_server):
        """Test icp_signal category requires validation."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content="Companies with 50-200 employees show highest conversion rates when they have a dedicated ops team",
            category="icp_signal",
            importance="medium",
            source={
                "type": "manual_entry",  # +0.0 bonus
                "id": "manual_icp_001",
                "company_name": "ICP Insights Inc",  # +0.1 bonus
                "extracted_quote": "50-200 employees is the sweet spot",  # +0.1 bonus to reach 0.7
            },
        )

        assert result["status"] == "created"
        assert result["needs_validation"] is True

    @pytest.mark.asyncio
    async def test_source_metadata_required(self, mcp_server):
        """Test source metadata is required."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id=TEST_BRAIN_ID,
                content="Some insight content that needs a source",
                category="pain_point",
                source=None,
            )
        assert "Source metadata is required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_source_type_required(self, mcp_server):
        """Test source type is required."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id=TEST_BRAIN_ID,
                content="Some insight content that needs source type",
                category="pain_point",
                source={"id": "some_id"},  # Missing type
            )
        assert "Source type is required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_confidence_calculation_call_transcript(self, mcp_server):
        """Test confidence is boosted for call_transcript source."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        # call_transcript + company_name + extracted_quote = 0.5 + 0.2 + 0.1 + 0.1 = 0.9
        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content="Insight with full metadata for high confidence score testing purposes",
            category="pain_point",
            importance="medium",
            source={
                "type": "call_transcript",  # +0.2 bonus
                "id": "call_conf_001",
                "company_name": "Acme Corp",  # +0.1 bonus
                "extracted_quote": "We need this feature",  # +0.1 bonus
            },
        )

        assert result["status"] == "created"
        assert result["confidence"] == 0.9

    @pytest.mark.asyncio
    async def test_confidence_calculation_email_reply(self, mcp_server):
        """Test confidence is boosted for email_reply source."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        # email_reply = 0.5 + 0.1 = 0.6, but needs minimum 0.7 to pass
        # Adding company_name: 0.5 + 0.1 + 0.1 = 0.7
        result = await tool.fn(
            brain_id=TEST_BRAIN_ID,
            content="Insight from email reply with company name for adequate confidence",
            category="pain_point",
            importance="low",
            source={
                "type": "email_reply",  # +0.1 bonus
                "id": "email_conf_001",
                "company_name": "Beta Inc",  # +0.1 bonus
            },
        )

        assert result["status"] == "created"
        assert result["confidence"] == 0.7

    @pytest.mark.asyncio
    async def test_content_too_short_rejected(self, mcp_server):
        """Test insight with content too short is rejected."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id=TEST_BRAIN_ID,
                content="Short",  # Less than 10 chars
                category="pain_point",
                source={"type": "manual_entry", "id": "short_001"},
            )
        assert "too short" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_invalid_category_rejected(self, mcp_server):
        """Test invalid category is rejected."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id=TEST_BRAIN_ID,
                content="Valid content that is long enough for the minimum requirement",
                category="invalid_category",
                source={"type": "manual_entry", "id": "invalid_001"},
            )
        assert "Invalid category" in str(exc_info.value)
