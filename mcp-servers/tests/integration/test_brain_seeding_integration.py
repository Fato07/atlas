"""Integration tests for Brain Seeding tools (User Story 1).

Tests for:
- create_brain: Create new draft brain
- seed_icp_rules: Seed ICP rules to brain
- seed_templates: Seed response templates to brain
- seed_handlers: Seed objection handlers to brain
- seed_research: Seed market research to brain
- Partial failure handling

Per tasks.md Phase 3: Tests written FIRST, ensure they FAIL before implementation.
"""

import pytest
from fastmcp.exceptions import ToolError

from tests.conftest import requires_qdrant


@requires_qdrant
class TestCreateBrain:
    """Tests for create_brain tool."""

    @pytest.mark.asyncio
    async def test_create_brain_success(self, clean_lifecycle_data, lifecycle_vertical):
        """T012: Create a new draft brain successfully."""
        # Import here to get mocked version
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        # Create MCP instance and register tools
        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        # Get the create_brain tool
        create_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "create_brain":
                create_brain = tool.fn
                break

        assert create_brain is not None, "create_brain tool not found"

        # Create brain
        result = await create_brain(
            vertical=lifecycle_vertical,
            name="Test Brain for US1",
            description="A test brain for User Story 1 integration testing",
        )

        # Verify result
        assert result is not None
        assert "brain_id" in result
        assert result["brain_id"].startswith(f"brain_{lifecycle_vertical}_")
        assert result["status"] == "draft"
        assert "message" in result

    @pytest.mark.asyncio
    async def test_create_brain_with_config(self, clean_lifecycle_data, lifecycle_vertical):
        """Create brain with custom configuration."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        create_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "create_brain":
                create_brain = tool.fn
                break

        result = await create_brain(
            vertical=lifecycle_vertical,
            name="Test Brain with Config",
            description="A test brain with custom configuration",
            config={
                "auto_response_enabled": True,
                "quality_gate_threshold": 0.85,
                "default_tier_thresholds": {"tier1": 95, "tier2": 75, "tier3": 55},
            },
        )

        assert result is not None
        assert result["status"] == "draft"

    @pytest.mark.asyncio
    async def test_create_brain_invalid_vertical(self, clean_lifecycle_data):
        """Create brain with invalid vertical format should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        create_brain = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "create_brain":
                create_brain = tool.fn
                break

        # Invalid vertical (starts with number)
        with pytest.raises(ToolError) as exc_info:
            await create_brain(
                vertical="123invalid",
                name="Invalid Brain",
                description="A brain with invalid vertical",
            )

        assert "vertical" in str(exc_info.value).lower() or "invalid" in str(exc_info.value).lower()


@requires_qdrant
class TestSeedICPRules:
    """Tests for seed_icp_rules tool."""

    @pytest.mark.asyncio
    async def test_seed_icp_rules_success(
        self, draft_brain_factory, lifecycle_vertical, sample_icp_rules
    ):
        """T013: Seed ICP rules to a draft brain successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        # Create a draft brain first
        brain_id = draft_brain_factory(
            brain_id="brain_seed_rules_test_1",
            vertical=lifecycle_vertical,
        )

        seed_icp_rules = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_icp_rules":
                seed_icp_rules = tool.fn
                break

        assert seed_icp_rules is not None, "seed_icp_rules tool not found"

        # Seed rules
        result = await seed_icp_rules(
            brain_id=brain_id,
            rules=sample_icp_rules,
        )

        # Verify result
        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["collection"] == "icp_rules"
        assert result["seeded_count"] == len(sample_icp_rules)
        assert result["errors"] == []

    @pytest.mark.asyncio
    async def test_seed_icp_rules_to_nonexistent_brain(self, sample_icp_rules):
        """Seed to non-existent brain should fail."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        seed_icp_rules = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_icp_rules":
                seed_icp_rules = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await seed_icp_rules(
                brain_id="brain_nonexistent_1234567890",
                rules=sample_icp_rules,
            )

        assert "not found" in str(exc_info.value).lower()


@requires_qdrant
class TestSeedTemplates:
    """Tests for seed_templates tool."""

    @pytest.mark.asyncio
    async def test_seed_templates_success(
        self, draft_brain_factory, lifecycle_vertical, sample_templates
    ):
        """T014: Seed response templates successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_seed_templates_test_1",
            vertical=lifecycle_vertical,
        )

        seed_templates = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_templates":
                seed_templates = tool.fn
                break

        assert seed_templates is not None, "seed_templates tool not found"

        result = await seed_templates(
            brain_id=brain_id,
            templates=sample_templates,
        )

        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["collection"] == "response_templates"
        assert result["seeded_count"] == len(sample_templates)
        assert result["errors"] == []


@requires_qdrant
class TestSeedHandlers:
    """Tests for seed_handlers tool."""

    @pytest.mark.asyncio
    async def test_seed_handlers_success(
        self, draft_brain_factory, lifecycle_vertical, sample_handlers
    ):
        """T015: Seed objection handlers successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_seed_handlers_test_1",
            vertical=lifecycle_vertical,
        )

        seed_handlers = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_handlers":
                seed_handlers = tool.fn
                break

        assert seed_handlers is not None, "seed_handlers tool not found"

        result = await seed_handlers(
            brain_id=brain_id,
            handlers=sample_handlers,
        )

        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["collection"] == "objection_handlers"
        assert result["seeded_count"] == len(sample_handlers)
        assert result["errors"] == []


@requires_qdrant
class TestSeedResearch:
    """Tests for seed_research tool."""

    @pytest.mark.asyncio
    async def test_seed_research_success(
        self, draft_brain_factory, lifecycle_vertical, sample_research
    ):
        """T016: Seed market research documents successfully."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_seed_research_test_1",
            vertical=lifecycle_vertical,
        )

        seed_research = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_research":
                seed_research = tool.fn
                break

        assert seed_research is not None, "seed_research tool not found"

        result = await seed_research(
            brain_id=brain_id,
            documents=sample_research,
        )

        assert result is not None
        assert result["brain_id"] == brain_id
        assert result["collection"] == "market_research"
        assert result["seeded_count"] == len(sample_research)
        assert result["errors"] == []


@requires_qdrant
class TestPartialFailureHandling:
    """Tests for partial failure handling during seeding."""

    @pytest.mark.asyncio
    async def test_partial_failure_seeds_valid_items(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T017: Valid items are seeded even when some items are invalid."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_partial_failure_test_1",
            vertical=lifecycle_vertical,
        )

        seed_icp_rules = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_icp_rules":
                seed_icp_rules = tool.fn
                break

        # Mix of valid and invalid rules
        rules_with_errors = [
            {
                "name": "Valid Rule 1",
                "category": "firmographic",
                "attribute": "company_size",
                "criteria": "Valid criteria text for matching",
                "weight": 25,
                "match_condition": {"min": 100},
                "is_knockout": False,
                "reasoning": "Valid reasoning",
            },
            {
                # Missing required 'criteria' field
                "name": "Invalid Rule",
                "category": "firmographic",
                "attribute": "revenue",
                "weight": 30,
                "match_condition": {"min": 1000000},
                "is_knockout": False,
                "reasoning": "Missing criteria",
            },
            {
                "name": "Valid Rule 2",
                "category": "technographic",
                "attribute": "tech_stack",
                "criteria": "Another valid criteria for tech stack",
                "weight": 20,
                "match_condition": {"includes": ["python"]},
                "is_knockout": False,
                "reasoning": "Tech stack matters",
            },
        ]

        result = await seed_icp_rules(
            brain_id=brain_id,
            rules=rules_with_errors,
        )

        # Should seed 2 valid items and report 1 error
        assert result["seeded_count"] == 2
        assert len(result["errors"]) == 1
        assert result["errors"][0]["index"] == 1
        assert "Invalid Rule" in result["errors"][0]["name"]

    @pytest.mark.asyncio
    async def test_seed_to_archived_brain_fails(
        self, archived_brain_factory, lifecycle_vertical, sample_icp_rules
    ):
        """Seeding to archived brain should fail per FR-004.1."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        # Create an archived brain
        brain_id = archived_brain_factory(
            brain_id="brain_archived_seed_test_1",
            vertical=lifecycle_vertical,
        )

        seed_icp_rules = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_icp_rules":
                seed_icp_rules = tool.fn
                break

        with pytest.raises(ToolError) as exc_info:
            await seed_icp_rules(
                brain_id=brain_id,
                rules=sample_icp_rules,
            )

        assert "archived" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_seed_to_active_brain_succeeds(
        self, active_brain_factory, lifecycle_vertical, sample_icp_rules
    ):
        """Seeding to active brain should succeed."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = active_brain_factory(
            brain_id="brain_active_seed_test_1",
            vertical=lifecycle_vertical,
        )

        seed_icp_rules = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_icp_rules":
                seed_icp_rules = tool.fn
                break

        result = await seed_icp_rules(
            brain_id=brain_id,
            rules=sample_icp_rules,
        )

        assert result["seeded_count"] == len(sample_icp_rules)
        assert result["errors"] == []


@requires_qdrant
class TestEdgeCases:
    """Edge case tests for seeding operations."""

    @pytest.mark.asyncio
    async def test_upsert_duplicate_content(
        self, draft_brain_factory, lifecycle_vertical
    ):
        """T051: Seeding duplicate content should update rather than create duplicate."""
        from atlas_gtm_mcp.qdrant import register_qdrant_tools
        from fastmcp import FastMCP

        mcp = FastMCP("test")
        register_qdrant_tools(mcp)

        brain_id = draft_brain_factory(
            brain_id="brain_upsert_test_1",
            vertical=lifecycle_vertical,
        )

        seed_icp_rules = None
        for tool in mcp._tool_manager._tools.values():
            if tool.name == "seed_icp_rules":
                seed_icp_rules = tool.fn
                break

        # First seed
        rules_v1 = [
            {
                "name": "Upsert Test Rule",
                "category": "firmographic",
                "attribute": "company_size",
                "criteria": "Original criteria text",
                "weight": 25,
                "match_condition": {"min": 100},
                "is_knockout": False,
                "reasoning": "Original reasoning",
            },
        ]

        result1 = await seed_icp_rules(brain_id=brain_id, rules=rules_v1)
        assert result1["seeded_count"] == 1

        # Second seed with same name but different criteria
        rules_v2 = [
            {
                "name": "Upsert Test Rule",  # Same name = same key
                "category": "firmographic",
                "attribute": "company_size",
                "criteria": "Updated criteria text",  # Changed
                "weight": 30,  # Changed
                "match_condition": {"min": 200},  # Changed
                "is_knockout": False,
                "reasoning": "Updated reasoning",  # Changed
            },
        ]

        result2 = await seed_icp_rules(brain_id=brain_id, rules=rules_v2)
        assert result2["seeded_count"] == 1

        # Query to verify only one rule exists (upsert, not duplicate)
        from qdrant_client.models import FieldCondition, Filter, MatchValue
        from tests.conftest import _create_qdrant_client

        client = _create_qdrant_client()
        results, _ = client.scroll(
            collection_name="icp_rules",
            scroll_filter=Filter(
                must=[
                    FieldCondition(key="brain_id", match=MatchValue(value=brain_id)),
                    FieldCondition(key="name", match=MatchValue(value="Upsert Test Rule")),
                ]
            ),
            limit=10,
        )

        assert len(results) == 1
        # Verify it's the updated version
        assert results[0].payload["criteria"] == "Updated criteria text"
        assert results[0].payload["weight"] == 30
