"""Integration tests for Brain Analytics (User Story 3).

Tests for:
- get_brain_stats: Get content counts for a brain
- get_brain_report: Get detailed brain report with completeness

Per tasks.md Phase 5: Tests written FIRST, ensure they FAIL before implementation.
"""

import pytest
from fastmcp.exceptions import ToolError

from tests.conftest import requires_qdrant


@requires_qdrant
class TestGetBrainStats:
    """Tests for get_brain_stats tool."""

    @pytest.mark.asyncio
    async def test_get_stats_for_brain_with_content(
        self,
        draft_brain_factory,
        lifecycle_vertical,
        sample_icp_rules,
        sample_templates,
        sample_handlers,
        sample_research,
    ):
        """T033: Get stats for a brain with seeded content."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        # Create a brain
        brain_id = draft_brain_factory(
            brain_id="brain_stats_test_1",
            vertical=lifecycle_vertical,
        )

        # Get tool functions
        tools = {}
        for tool in mcp._tool_manager._tools.values():
            tools[tool.name] = tool.fn

        # Seed content
        await tools["seed_icp_rules"](brain_id=brain_id, rules=sample_icp_rules)
        await tools["seed_templates"](brain_id=brain_id, templates=sample_templates)
        await tools["seed_handlers"](brain_id=brain_id, handlers=sample_handlers)
        await tools["seed_research"](brain_id=brain_id, documents=sample_research)

        # Get stats
        result = await tools["get_brain_stats"](brain_id=brain_id)

        # Verify result
        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["icp_rules_count"] == len(sample_icp_rules)
        assert result["templates_count"] == len(sample_templates)
        assert result["handlers_count"] == len(sample_handlers)
        assert result["research_docs_count"] == len(sample_research)
        assert "insights_count" in result

    @pytest.mark.asyncio
    async def test_get_stats_for_empty_brain(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T034: Get stats for a brain with no content."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_stats_empty_test_1",
            vertical=lifecycle_vertical,
        )

        get_brain_stats = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "get_brain_stats":
                get_brain_stats = tool.fn
                break

        result = await get_brain_stats(brain_id=brain_id)

        # All counts should be zero
        assert result["icp_rules_count"] == 0
        assert result["templates_count"] == 0
        assert result["handlers_count"] == 0
        assert result["research_docs_count"] == 0
        assert result["insights_count"] == 0

    @pytest.mark.asyncio
    async def test_get_stats_for_nonexistent_brain(self):
        """T035: Get stats for non-existent brain should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        get_brain_stats = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "get_brain_stats":
                get_brain_stats = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await get_brain_stats(brain_id="brain_nonexistent_stats_1234567890")

        assert "not found" in str(exc_info.value).lower()


@requires_qdrant
class TestGetBrainReport:
    """Tests for get_brain_report tool."""

    @pytest.mark.asyncio
    async def test_get_report_full_completeness(
        self,
        draft_brain_factory,
        lifecycle_vertical,
        sample_icp_rules,
        sample_templates,
        sample_handlers,
        sample_research,
    ):
        """T036: Get report with 100% completeness (all content types present)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_report_full_test_1",
            vertical=lifecycle_vertical,
            name="Full Content Brain",
        )

        tools = {}
        for tool in mcp._tool_manager._tools.values():
            tools[tool.name] = tool.fn

        # Seed all content types
        await tools["seed_icp_rules"](brain_id=brain_id, rules=sample_icp_rules)
        await tools["seed_templates"](brain_id=brain_id, templates=sample_templates)
        await tools["seed_handlers"](brain_id=brain_id, handlers=sample_handlers)
        await tools["seed_research"](brain_id=brain_id, documents=sample_research)

        # Get report
        result = await tools["get_brain_report"](brain_id=brain_id)

        # Verify result
        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["name"] == "Full Content Brain"
        assert result["vertical"] == lifecycle_vertical
        assert result["status"] == "draft"
        assert result["completeness"] == 1.0  # 100% complete

        # Check content_details
        assert "content_details" in result
        assert len(result["content_details"]) == 4  # 4 content types

        # Verify each content type has last_updated and count
        collections_found = set()
        for detail in result["content_details"]:
            assert "collection" in detail
            assert "last_updated" in detail
            assert "count" in detail
            collections_found.add(detail["collection"])

        assert collections_found == {
            "icp_rules",
            "response_templates",
            "objection_handlers",
            "market_research",
        }

    @pytest.mark.asyncio
    async def test_get_report_partial_completeness(
        self, draft_brain_factory, lifecycle_vertical, sample_icp_rules
    ):
        """T037: Get report with partial completeness (only ICP rules)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_report_partial_test_1",
            vertical=lifecycle_vertical,
        )

        tools = {}
        for tool in mcp._tool_manager._tools.values():
            tools[tool.name] = tool.fn

        # Only seed ICP rules
        await tools["seed_icp_rules"](brain_id=brain_id, rules=sample_icp_rules)

        result = await tools["get_brain_report"](brain_id=brain_id)

        # 25% completeness (1 of 4 content types)
        assert result["completeness"] == 0.25

    @pytest.mark.asyncio
    async def test_get_report_zero_completeness(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T038: Get report with 0% completeness (empty brain)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_report_empty_test_1",
            vertical=lifecycle_vertical,
        )

        get_brain_report = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "get_brain_report":
                get_brain_report = tool.fn
                break

        result = await get_brain_report(brain_id=brain_id)

        assert result["completeness"] == 0.0

        # All content_details should have count 0 and last_updated None
        for detail in result["content_details"]:
            assert detail["count"] == 0
            assert detail["last_updated"] is None

    @pytest.mark.asyncio
    async def test_get_report_includes_timestamps(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T039: Report includes created_at and updated_at timestamps."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_report_timestamps_test_1",
            vertical=lifecycle_vertical,
        )

        get_brain_report = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "get_brain_report":
                get_brain_report = tool.fn
                break

        result = await get_brain_report(brain_id=brain_id)

        assert "created_at" in result
        assert "updated_at" in result
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    @pytest.mark.asyncio
    async def test_get_report_for_nonexistent_brain(self):
        """T040: Get report for non-existent brain should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        get_brain_report = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "get_brain_report":
                get_brain_report = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await get_brain_report(brain_id="brain_nonexistent_report_1234567890")

        assert "not found" in str(exc_info.value).lower()
