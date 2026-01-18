"""Integration tests for Brain Deletion (User Story 4).

Tests for:
- delete_brain: Delete brain with cascade content deletion
- Prevention of active brain deletion
- Confirmation requirement

Per tasks.md Phase 6: Tests written FIRST, ensure they FAIL before implementation.
"""

import pytest
from fastmcp.exceptions import ToolError
from qdrant_client.models import FieldCondition, Filter, MatchValue

from tests.conftest import requires_qdrant


@requires_qdrant
class TestDeleteBrain:
    """Tests for delete_brain tool."""

    @pytest.mark.asyncio
    async def test_delete_draft_brain_with_content(
        self,
        draft_brain_factory,
        lifecycle_vertical,
        sample_icp_rules,
        sample_templates,
        qdrant_client,
    ):
        """T043: Delete a draft brain cascades to all content."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_delete_draft_test_1",
            vertical=lifecycle_vertical,
        )

        tools = {}
        for tool in mcp._tool_manager._tools.values():
            tools[tool.name] = tool.fn

        # Seed some content
        await tools["seed_icp_rules"](brain_id=brain_id, rules=sample_icp_rules)
        await tools["seed_templates"](brain_id=brain_id, templates=sample_templates)

        # Verify content exists
        icp_results, _ = qdrant_client.scroll(
            collection_name="icp_rules",
            scroll_filter=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
            ),
            limit=100,
        )
        assert len(icp_results) > 0

        # Delete the brain with confirmation
        result = await tools["delete_brain"](brain_id=brain_id, confirm=True)

        # Verify result
        assert result is not None
        assert result["brain_id"] == brain_id
        assert "deleted_content" in result
        assert result["deleted_content"]["icp_rules"] == len(sample_icp_rules)
        assert result["deleted_content"]["response_templates"] == len(sample_templates)
        assert "message" in result

        # Verify brain is gone
        brain_results, _ = qdrant_client.scroll(
            collection_name="brains",
            scroll_filter=Filter(
                must=[FieldCondition(key="id", match=MatchValue(value=brain_id))]
            ),
            limit=1,
        )
        assert len(brain_results) == 0

        # Verify content is gone
        icp_results_after, _ = qdrant_client.scroll(
            collection_name="icp_rules",
            scroll_filter=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
            ),
            limit=100,
        )
        assert len(icp_results_after) == 0

    @pytest.mark.asyncio
    async def test_delete_archived_brain(
        self, archived_brain_factory, lifecycle_vertical, qdrant_client
    ):
        """T044: Delete an archived brain succeeds."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = archived_brain_factory(
            brain_id="brain_delete_archived_test_1",
            vertical=lifecycle_vertical,
        )

        delete_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "delete_brain":
                delete_brain = tool.fn
                break

        result = await delete_brain(brain_id=brain_id, confirm=True)

        assert result["brain_id"] == brain_id

        # Verify brain is gone
        brain_results, _ = qdrant_client.scroll(
            collection_name="brains",
            scroll_filter=Filter(
                must=[FieldCondition(key="id", match=MatchValue(value=brain_id))]
            ),
            limit=1,
        )
        assert len(brain_results) == 0

    @pytest.mark.asyncio
    async def test_cannot_delete_active_brain(
        self, active_brain_factory, lifecycle_vertical
    ):
        """T045: Cannot delete an active brain (FR-016)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = active_brain_factory(
            brain_id="brain_delete_active_test_1",
            vertical=lifecycle_vertical,
        )

        delete_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "delete_brain":
                delete_brain = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await delete_brain(brain_id=brain_id, confirm=True)

        error_msg = str(exc_info.value).lower()
        assert "active" in error_msg or "cannot delete" in error_msg


@requires_qdrant
class TestDeleteConfirmation:
    """Tests for confirmation requirement."""

    @pytest.mark.asyncio
    async def test_delete_without_confirm_fails(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T046: Delete without confirmation flag should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_delete_no_confirm_test_1",
            vertical=lifecycle_vertical,
        )

        delete_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "delete_brain":
                delete_brain = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await delete_brain(brain_id=brain_id, confirm=False)

        assert "confirm" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_delete_with_confirm_false_fails(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T047: Explicit confirm=False should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_delete_confirm_false_test_1",
            vertical=lifecycle_vertical,
        )

        delete_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "delete_brain":
                delete_brain = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await delete_brain(brain_id=brain_id, confirm=False)

        assert "confirm" in str(exc_info.value).lower()


@requires_qdrant
class TestDeleteEdgeCases:
    """Edge case tests for brain deletion."""

    @pytest.mark.asyncio
    async def test_delete_nonexistent_brain(self):
        """T048: Delete non-existent brain should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        delete_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "delete_brain":
                delete_brain = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await delete_brain(
                brain_id="brain_nonexistent_delete_1234567890",
                confirm=True,
            )

        assert "not found" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_delete_brain_with_no_content(
        self, draft_brain_factory, lifecycle_vertical, qdrant_client
    ):
        """T049: Delete brain with no content succeeds."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_delete_empty_test_1",
            vertical=lifecycle_vertical,
        )

        delete_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "delete_brain":
                delete_brain = tool.fn
                break

        result = await delete_brain(brain_id=brain_id, confirm=True)

        # All content counts should be 0
        assert result["deleted_content"]["icp_rules"] == 0
        assert result["deleted_content"]["response_templates"] == 0
        assert result["deleted_content"]["objection_handlers"] == 0
        assert result["deleted_content"]["market_research"] == 0

        # Brain should be gone
        brain_results, _ = qdrant_client.scroll(
            collection_name="brains",
            scroll_filter=Filter(
                must=[FieldCondition(key="id", match=MatchValue(value=brain_id))]
            ),
            limit=1,
        )
        assert len(brain_results) == 0
