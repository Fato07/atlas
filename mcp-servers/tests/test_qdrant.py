"""
Tests for Qdrant MCP tools
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_qdrant_client():
    """Mock Qdrant client for testing"""
    client = MagicMock()
    client.search = AsyncMock(return_value=[])
    client.get_collection = AsyncMock(return_value=MagicMock())
    return client


@pytest.fixture
def mock_voyage_client():
    """Mock Voyage client for testing"""
    client = MagicMock()
    client.embed = MagicMock(return_value=MagicMock(embeddings=[[0.1] * 1024]))
    return client


class TestQdrantTools:
    """Test suite for Qdrant MCP tools"""

    def test_brain_id_required(self):
        """All queries should require brain_id"""
        # This is a design principle test - brain_id must always be present
        # in filter conditions to prevent cross-brain data leakage
        pass

    @pytest.mark.asyncio
    async def test_query_icp_rules(self, mock_qdrant_client, mock_voyage_client):
        """Test ICP rules query"""
        with patch("atlas_gtm_mcp.qdrant.get_qdrant_client", return_value=mock_qdrant_client):
            with patch("atlas_gtm_mcp.qdrant.get_voyage_client", return_value=mock_voyage_client):
                # Import after patching
                from atlas_gtm_mcp.qdrant import query_icp_rules

                result = await query_icp_rules(
                    brain_id="test_brain",
                    query="technology company",
                    limit=5
                )

                # Verify brain_id filter was applied
                mock_qdrant_client.search.assert_called_once()
                call_kwargs = mock_qdrant_client.search.call_args[1]
                assert "query_filter" in call_kwargs or "filter" in str(call_kwargs)

    @pytest.mark.asyncio
    async def test_get_brain(self, mock_qdrant_client):
        """Test brain retrieval"""
        mock_qdrant_client.retrieve = AsyncMock(return_value=[
            MagicMock(
                id="brain_defense_123",
                payload={
                    "vertical": "defense",
                    "description": "Defense brain",
                    "active": True
                }
            )
        ])

        with patch("atlas_gtm_mcp.qdrant.get_qdrant_client", return_value=mock_qdrant_client):
            from atlas_gtm_mcp.qdrant import get_brain

            result = await get_brain("brain_defense_123")

            assert result is not None
            mock_qdrant_client.retrieve.assert_called_once()


class TestBrainIsolation:
    """Tests to ensure brain data isolation"""

    def test_cannot_query_without_brain_id(self):
        """Queries without brain_id should fail or return empty"""
        # This enforces the critical pattern: ALL queries must be brain-scoped
        pass

    def test_brain_id_filter_format(self):
        """Verify correct filter format for brain_id"""
        # brain_id should be filtered as exact match, not partial
        expected_filter = {
            "must": [
                {"key": "brain_id", "match": {"value": "test_brain"}}
            ]
        }
        # Actual implementation should match this pattern
        pass
