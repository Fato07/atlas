"""Contract tests for MCP tool signatures and return types.

Tests for T3: Tool signatures match contracts.

These tests verify that the tool implementations match the contract specifications
without requiring a live Qdrant instance. They use mocks to verify:
- Input parameter types and validation
- Return value structures
- Error handling behavior
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

# Import the registration function
from atlas_gtm_mcp.qdrant import register_qdrant_tools


@pytest.fixture
def mock_qdrant():
    """Mock Qdrant client."""
    with patch("atlas_gtm_mcp.qdrant.QdrantClient") as mock:
        client = MagicMock()
        mock.return_value = client
        yield client


@pytest.fixture
def mock_embeddings():
    """Mock embedding functions."""
    with patch("atlas_gtm_mcp.qdrant.embed_query") as mock_query, patch(
        "atlas_gtm_mcp.qdrant.embed_document"
    ) as mock_doc:
        mock_query.return_value = [0.1] * 512  # 512-dim vector
        mock_doc.return_value = [0.1] * 512
        yield mock_query, mock_doc


@pytest.fixture
def mcp_server(mock_qdrant, mock_embeddings):
    """Create MCP server with registered tools."""
    mcp = FastMCP("test-server")
    register_qdrant_tools(mcp)
    return mcp


class TestQueryICPRulesContract:
    """Contract tests for query_icp_rules tool."""

    @pytest.mark.asyncio
    async def test_returns_list_of_icp_rules(self, mcp_server, mock_qdrant):
        """Test that query_icp_rules returns list of ICPRuleResult structure."""
        # Setup mock response
        mock_hit = MagicMock()
        mock_hit.id = "rule_001"
        mock_hit.score = 0.89
        mock_hit.payload = {
            "category": "firmographic",
            "attribute": "company_size",
            "display_name": "Company Size",
            "condition": {"type": "range", "min": 50, "max": 500},
            "score_weight": 30,
            "is_knockout": False,
            "reasoning": "Sweet spot for adoption",
        }
        mock_qdrant.search.return_value = [mock_hit]

        # Get the tool
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")
        assert tool is not None, "query_icp_rules tool should be registered"

        # Call the tool (through the FastMCP internal mechanism)
        result = await tool.fn(
            brain_id="brain_iro_v1",
            query="company size employees",
            limit=10,
        )

        # Verify structure per ICPRuleResult contract
        assert isinstance(result, list)
        assert len(result) == 1

        rule = result[0]
        assert "id" in rule
        assert "score" in rule
        assert "category" in rule
        assert "attribute" in rule
        assert "condition" in rule
        assert "score_weight" in rule
        assert "is_knockout" in rule
        assert "reasoning" in rule

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_no_matches(self, mcp_server, mock_qdrant):
        """Test returns empty list when no matches found."""
        mock_qdrant.search.return_value = []

        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        result = await tool.fn(
            brain_id="brain_iro_v1",
            query="nonexistent query",
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_invalid_brain_id_raises_error(self, mcp_server):
        """Test invalid brain_id raises ToolError."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id="invalid_format",
                query="test query",
            )
        assert "Invalid brain_id format" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_category_filter(self, mcp_server, mock_qdrant):
        """Test category filter is applied."""
        mock_qdrant.search.return_value = []

        tools = mcp_server._tool_manager._tools
        tool = tools.get("query_icp_rules")

        await tool.fn(
            brain_id="brain_iro_v1",
            query="tech stack",
            category="technographic",
        )

        # Verify filter includes category
        call_kwargs = mock_qdrant.search.call_args[1]
        filter_conditions = call_kwargs["query_filter"].must
        assert len(filter_conditions) == 2  # brain_id + category


class TestGetResponseTemplateContract:
    """Contract tests for get_response_template tool."""

    @pytest.mark.asyncio
    async def test_returns_list_of_templates(self, mcp_server, mock_qdrant):
        """Test that get_response_template returns list of ResponseTemplateResult."""
        mock_point = MagicMock()
        mock_point.id = "template_001"
        mock_point.payload = {
            "reply_type": "positive_interest",
            "tier": 1,
            "template_text": "Thanks {{first_name}}!",
            "variables": ["first_name"],
            "personalization_instructions": "Be friendly",
        }
        mock_qdrant.scroll.return_value = ([mock_point], None)

        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        result = await tool.fn(
            brain_id="brain_iro_v1",
            reply_type="positive_interest",
        )

        # Verify structure per ResponseTemplateResult contract
        assert isinstance(result, list)
        assert len(result) == 1

        template = result[0]
        assert "id" in template
        assert "reply_type" in template
        assert "tier" in template
        assert "template_text" in template
        assert "variables" in template
        assert "personalization_instructions" in template

    @pytest.mark.asyncio
    async def test_auto_send_only_filters_tier_1(self, mcp_server, mock_qdrant):
        """Test auto_send_only=True filters for tier=1."""
        mock_qdrant.scroll.return_value = ([], None)

        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        await tool.fn(
            brain_id="brain_iro_v1",
            reply_type="positive_interest",
            auto_send_only=True,
        )

        # Verify tier=1 filter is applied
        call_kwargs = mock_qdrant.scroll.call_args[1]
        filter_conditions = call_kwargs["scroll_filter"].must
        tier_conditions = [c for c in filter_conditions if c.key == "tier"]
        assert len(tier_conditions) == 1
        assert tier_conditions[0].match.value == 1

    @pytest.mark.asyncio
    async def test_invalid_reply_type_raises_error(self, mcp_server):
        """Test invalid reply_type raises ToolError."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_response_template")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id="brain_iro_v1",
                reply_type="invalid_type",
            )
        assert "Invalid reply_type" in str(exc_info.value)


class TestFindObjectionHandlerContract:
    """Contract tests for find_objection_handler tool."""

    @pytest.mark.asyncio
    async def test_returns_handler_or_none(self, mcp_server, mock_qdrant):
        """Test returns ObjectionHandlerResult or None."""
        mock_hit = MagicMock()
        mock_hit.id = "handler_001"
        mock_hit.score = 0.85
        mock_hit.payload = {
            "objection_type": "pricing",
            "handler_strategy": "roi_reframe",
            "handler_response": "I understand budget is key...",
            "variables": ["first_name"],
            "follow_up_actions": ["send_case_study"],
        }
        mock_qdrant.search.return_value = [mock_hit]

        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        result = await tool.fn(
            brain_id="brain_iro_v1",
            objection_text="This is too expensive",
        )

        # Verify structure per ObjectionHandlerResult contract
        assert result is not None
        assert "id" in result
        assert "confidence" in result
        assert "objection_type" in result
        assert "handler_strategy" in result
        assert "handler_response" in result
        assert "variables" in result
        assert "follow_up_actions" in result

    @pytest.mark.asyncio
    async def test_returns_none_below_threshold(self, mcp_server, mock_qdrant):
        """Test returns None when no match meets 0.70 threshold."""
        mock_qdrant.search.return_value = []  # No matches above threshold

        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        result = await tool.fn(
            brain_id="brain_iro_v1",
            objection_text="Random unrelated text",
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_uses_070_threshold(self, mcp_server, mock_qdrant):
        """Test uses 0.70 score_threshold per FR-012."""
        mock_qdrant.search.return_value = []

        tools = mcp_server._tool_manager._tools
        tool = tools.get("find_objection_handler")

        await tool.fn(
            brain_id="brain_iro_v1",
            objection_text="test objection",
        )

        call_kwargs = mock_qdrant.search.call_args[1]
        assert call_kwargs["score_threshold"] == 0.70


class TestSearchMarketResearchContract:
    """Contract tests for search_market_research tool."""

    @pytest.mark.asyncio
    async def test_returns_list_of_research_docs(self, mcp_server, mock_qdrant):
        """Test returns list of MarketResearchResult."""
        mock_hit = MagicMock()
        mock_hit.id = "research_001"
        mock_hit.score = 0.92
        mock_hit.payload = {
            "content_type": "market_overview",
            "title": "IRO Market Overview",
            "content": "The market is...",
            "key_facts": ["Fact 1", "Fact 2"],
            "source_url": "https://example.com",
        }
        mock_qdrant.search.return_value = [mock_hit]

        tools = mcp_server._tool_manager._tools
        tool = tools.get("search_market_research")

        result = await tool.fn(
            brain_id="brain_iro_v1",
            query="market overview",
        )

        # Verify structure per MarketResearchResult contract
        assert isinstance(result, list)
        assert len(result) == 1

        doc = result[0]
        assert "id" in doc
        assert "score" in doc
        assert "content_type" in doc
        assert "title" in doc
        assert "content" in doc
        assert "key_facts" in doc
        assert "source_url" in doc


class TestAddInsightContract:
    """Contract tests for add_insight tool."""

    @pytest.mark.asyncio
    async def test_returns_created_result(self, mcp_server, mock_qdrant):
        """Test returns AddInsightResult with created status."""
        mock_qdrant.search.return_value = []  # No duplicates
        mock_qdrant.upsert.return_value = None

        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        # Mock both the quality_gates Qdrant client and embeddings
        with patch("atlas_gtm_mcp.qdrant.quality_gates._get_qdrant_client") as mock_qg_client, \
             patch("atlas_gtm_mcp.qdrant.quality_gates.embed_query") as mock_embed:
            mock_qg_client.return_value = mock_qdrant
            mock_embed.return_value = [0.1] * 512  # 512-dim vector
            result = await tool.fn(
                brain_id="brain_iro_v1",
                content="This is a meaningful insight about buying process",
                category="buying_process",
                importance="high",
                source={
                    "type": "call_transcript",
                    "id": "call_123",
                    "company_name": "Acme Corp",
                },
            )

        # Verify structure per AddInsightResult contract
        assert result["status"] == "created"
        assert "id" in result
        assert "confidence" in result
        assert "needs_validation" in result

    @pytest.mark.asyncio
    async def test_returns_duplicate_result(self, mcp_server, mock_qdrant):
        """Test returns duplicate status when similar insight exists."""
        mock_hit = MagicMock()
        mock_hit.id = "existing_insight"
        mock_hit.score = 0.92
        mock_qdrant.search.return_value = [mock_hit]

        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        # Mock both the quality_gates Qdrant client and embeddings
        with patch("atlas_gtm_mcp.qdrant.quality_gates._get_qdrant_client") as mock_qg_client, \
             patch("atlas_gtm_mcp.qdrant.quality_gates.embed_query") as mock_embed:
            mock_qg_client.return_value = mock_qdrant
            mock_embed.return_value = [0.1] * 512  # 512-dim vector
            result = await tool.fn(
                brain_id="brain_iro_v1",
                content="This is a meaningful insight content",
                category="pain_point",
                source={
                    "type": "call_transcript",
                    "id": "call_123",
                },
            )

        assert result["status"] == "duplicate"
        assert "existing_id" in result
        assert "reason" in result

    @pytest.mark.asyncio
    async def test_source_required(self, mcp_server):
        """Test source metadata is required."""
        tools = mcp_server._tool_manager._tools
        tool = tools.get("add_insight")

        with pytest.raises(ToolError) as exc_info:
            await tool.fn(
                brain_id="brain_iro_v1",
                content="This is a meaningful insight content",
                category="pain_point",
                source=None,
            )
        assert "Source metadata is required" in str(exc_info.value)


class TestBrainManagementContract:
    """Contract tests for get_brain and list_brains tools."""

    @pytest.mark.asyncio
    async def test_get_brain_returns_brain_result(self, mcp_server, mock_qdrant):
        """Test get_brain returns BrainResult or None."""
        mock_point = MagicMock()
        mock_point.id = "brain_iro_v1"
        mock_point.payload = {
            "name": "IRO Brain",
            "vertical": "iro",
            "version": "1.0",
            "status": "active",
            "description": "IR Operations brain",
            "config": {
                "default_tier_thresholds": {"high": 70, "low": 50},
                "auto_response_enabled": True,
                "learning_enabled": True,
                "quality_gate_threshold": 0.7,
            },
            "stats": {
                "icp_rules_count": 47,
                "templates_count": 52,
                "handlers_count": 23,
                "research_docs_count": 156,
                "insights_count": 0,
            },
            "created_at": "2025-01-15T00:00:00Z",
            "updated_at": "2025-01-15T00:00:00Z",
        }
        mock_qdrant.scroll.return_value = ([mock_point], None)

        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical="iro")

        # Verify structure per BrainResult contract
        assert result is not None
        assert "id" in result
        assert "name" in result
        assert "vertical" in result
        assert "status" in result
        assert "config" in result
        assert "stats" in result

    @pytest.mark.asyncio
    async def test_get_brain_returns_none_for_missing(self, mcp_server, mock_qdrant):
        """Test get_brain returns None when brain not found."""
        mock_qdrant.scroll.return_value = ([], None)

        tools = mcp_server._tool_manager._tools
        tool = tools.get("get_brain")

        result = await tool.fn(vertical="nonexistent")

        assert result is None

    @pytest.mark.asyncio
    async def test_list_brains_returns_list(self, mcp_server, mock_qdrant):
        """Test list_brains returns list of BrainResult."""
        mock_point = MagicMock()
        mock_point.id = "brain_iro_v1"
        mock_point.payload = {"name": "IRO Brain", "status": "active"}
        mock_qdrant.scroll.return_value = ([mock_point], None)

        tools = mcp_server._tool_manager._tools
        tool = tools.get("list_brains")

        result = await tool.fn()

        assert isinstance(result, list)
        assert len(result) == 1
        assert "id" in result[0]
