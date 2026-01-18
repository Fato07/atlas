"""Integration tests for Brain Status Management (User Story 2).

Tests for:
- update_brain_status: Update brain status with transition validation
- Auto-archival of active brains when activating another in same vertical
- Valid/invalid status transitions

Per tasks.md Phase 4: Tests written FIRST, ensure they FAIL before implementation.
"""

import pytest
from fastmcp.exceptions import ToolError

from tests.conftest import requires_qdrant


@requires_qdrant
class TestUpdateBrainStatus:
    """Tests for update_brain_status tool."""

    @pytest.mark.asyncio
    async def test_activate_draft_brain(self, draft_brain_factory, lifecycle_vertical):
        """T025: Activate a draft brain successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        # Create a draft brain
        brain_id = draft_brain_factory(
            brain_id="brain_activate_draft_test_1",
            vertical=lifecycle_vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        assert update_brain_status is not None, "update_brain_status tool not found"

        # Activate the brain
        result = await update_brain_status(
            brain_id=brain_id,
            status="active",
        )

        # Verify result
        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["previous_status"] == "draft"
        assert result["new_status"] == "active"
        assert "message" in result

    @pytest.mark.asyncio
    async def test_archive_active_brain(self, active_brain_factory, lifecycle_vertical):
        """T026: Archive an active brain successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = active_brain_factory(
            brain_id="brain_archive_active_test_1",
            vertical=lifecycle_vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        result = await update_brain_status(
            brain_id=brain_id,
            status="archived",
        )

        assert result["brain_id"] == brain_id
        assert result["previous_status"] == "active"
        assert result["new_status"] == "archived"

    @pytest.mark.asyncio
    async def test_reactivate_archived_brain(
        self, archived_brain_factory, lifecycle_vertical
    ):
        """T027: Reactivate an archived brain successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = archived_brain_factory(
            brain_id="brain_reactivate_test_1",
            vertical=lifecycle_vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        result = await update_brain_status(
            brain_id=brain_id,
            status="active",
        )

        assert result["brain_id"] == brain_id
        assert result["previous_status"] == "archived"
        assert result["new_status"] == "active"


@requires_qdrant
class TestAutoArchival:
    """Tests for automatic archival when activating a brain."""

    @pytest.mark.asyncio
    async def test_activating_brain_archives_previous_active(
        self,
        active_brain_factory,
        draft_brain_factory,
        qdrant_client,
    ):
        """T028: Activating a new brain auto-archives the currently active one in same vertical."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        vertical = "auto_archive_vertical"

        # Create an active brain first
        active_brain_id = active_brain_factory(
            brain_id="brain_active_first_1",
            vertical=vertical,
        )

        # Create a draft brain in the same vertical
        draft_brain_id = draft_brain_factory(
            brain_id="brain_draft_second_1",
            vertical=vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        # Activate the draft brain
        result = await update_brain_status(
            brain_id=draft_brain_id,
            status="active",
        )

        # Verify the result includes deactivated brain info
        assert result["new_status"] == "active"
        assert result.get("deactivated_brain_id") == active_brain_id

        # Verify the previously active brain is now archived
        results, _ = qdrant_client.scroll(
            collection_name="brains",
            scroll_filter=Filter(
                must=[
                    FieldCondition(key="id", match=MatchValue(value=active_brain_id))
                ]
            ),
            limit=1,
            with_payload=True,
        )

        assert len(results) == 1
        assert results[0].payload["status"] == "archived"

    @pytest.mark.asyncio
    async def test_activating_only_brain_in_vertical(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T029: Activating when no other active brain exists (no deactivation needed)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_only_one_test_1",
            vertical=lifecycle_vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        result = await update_brain_status(
            brain_id=brain_id,
            status="active",
        )

        assert result["new_status"] == "active"
        assert result.get("deactivated_brain_id") is None


@requires_qdrant
class TestInvalidTransitions:
    """Tests for invalid status transitions."""

    @pytest.mark.asyncio
    async def test_cannot_transition_active_to_draft(
        self, active_brain_factory, lifecycle_vertical
    ):
        """T030: Cannot transition from active back to draft (invalid)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = active_brain_factory(
            brain_id="brain_active_to_draft_test_1",
            vertical=lifecycle_vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await update_brain_status(
                brain_id=brain_id,
                status="draft",
            )

        assert "invalid" in str(exc_info.value).lower() or "transition" in str(
            exc_info.value
        ).lower()

    @pytest.mark.asyncio
    async def test_cannot_transition_draft_to_archived(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T031: Cannot transition from draft directly to archived (must activate first)."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_draft_to_archived_test_1",
            vertical=lifecycle_vertical,
        )

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await update_brain_status(
                brain_id=brain_id,
                status="archived",
            )

        assert "invalid" in str(exc_info.value).lower() or "transition" in str(
            exc_info.value
        ).lower()

    @pytest.mark.asyncio
    async def test_nonexistent_brain_fails(self):
        """T032: Updating status of non-existent brain should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        update_brain_status = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "update_brain_status":
                update_brain_status = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await update_brain_status(
                brain_id="brain_nonexistent_status_test_1234567890",
                status="active",
            )

        assert "not found" in str(exc_info.value).lower()
