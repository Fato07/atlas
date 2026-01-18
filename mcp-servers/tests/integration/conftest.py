"""Integration test fixtures for Qdrant MCP tools.

Provides:
- Deterministic embedding mocks (avoid Voyage AI costs)
- Test data seeding fixtures
- Cleanup after test session
"""

import hashlib
import random
import uuid
from datetime import datetime, timezone

import pytest
from qdrant_client.models import FieldCondition, Filter, MatchValue, PointStruct

from tests.conftest import TEST_BRAIN_ID, TEST_VERTICAL


def string_to_uuid(s: str) -> str:
    """Convert a string to a deterministic UUID.

    Uses MD5 hash of string to generate consistent UUID for same input.
    This is required because Qdrant point IDs must be UUIDs or integers.
    """
    return str(uuid.UUID(hashlib.md5(s.encode()).hexdigest()))

# Embedding dimension (must match Voyage AI voyage-3.5-lite)
EMBEDDING_DIM = 1024


# =============================================================================
# Embedding Mocks
# =============================================================================


def deterministic_embedding(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    """Generate deterministic embedding from text for reproducible tests.

    Uses MD5 hash as seed for random number generator to produce
    consistent vectors for the same input text.
    """
    seed = int(hashlib.md5(text.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(dim)]


@pytest.fixture(autouse=True)
def mock_voyage_embeddings(monkeypatch):
    """Mock Voyage AI embeddings for all integration tests.

    This fixture auto-applies to all integration tests to avoid:
    - Voyage AI API costs
    - Rate limiting issues
    - Network latency

    Embeddings are deterministic based on input text hash.
    """

    def mock_embed_query(text: str) -> list[float]:
        return deterministic_embedding(text)

    def mock_embed_document(text: str) -> list[float]:
        return deterministic_embedding(text)

    # Mock at module level where functions are imported
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embeddings.embed_query",
        mock_embed_query,
    )
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embeddings.embed_document",
        mock_embed_document,
    )
    # Also mock at the __init__ level where they're used
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embed_query",
        mock_embed_query,
    )
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embed_document",
        mock_embed_document,
    )
    # Also mock at quality_gates module level
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.quality_gates.embed_query",
        mock_embed_query,
    )


# =============================================================================
# Test Data Seeding
# =============================================================================


@pytest.fixture(scope="session")
def seed_test_brain(qdrant_client):
    """Seed test brain configuration.

    Creates a dedicated test brain that all integration tests use.
    Cleaned up after the test session.
    """
    brain_point = PointStruct(
        id=string_to_uuid(TEST_BRAIN_ID),  # Use UUID for Qdrant point ID
        vector=deterministic_embedding(f"brain {TEST_VERTICAL}"),
        payload={
            "id": TEST_BRAIN_ID,  # Keep string ID in payload for lookups
            "name": "Test Brain",
            "vertical": TEST_VERTICAL,
            "version": "1.0",
            "status": "active",
            "description": "Brain for integration testing",
            "config": {
                "default_tier_thresholds": {"high": 70, "low": 50},
                "auto_response_enabled": True,
                "learning_enabled": True,
                "quality_gate_threshold": 0.7,
            },
            "stats": {
                "icp_rules_count": 0,
                "templates_count": 0,
                "handlers_count": 0,
                "research_docs_count": 0,
                "insights_count": 0,
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    qdrant_client.upsert(collection_name="brains", points=[brain_point])
    yield TEST_BRAIN_ID

    # Cleanup after all tests
    _cleanup_test_data(qdrant_client)


@pytest.fixture(scope="session")
def seed_icp_rules(qdrant_client, seed_test_brain):
    """Seed ICP rules for testing."""
    rules = [
        {
            "id": "rule_test_firmographic_001",
            "brain_id": TEST_BRAIN_ID,
            "category": "firmographic",
            "attribute": "company_size",
            "display_name": "Company Size",
            "condition": {"type": "range", "min": 50, "max": 500},
            "score_weight": 30,
            "is_knockout": False,
            "reasoning": "Mid-market companies have best adoption rate",
        },
        {
            "id": "rule_test_technographic_001",
            "brain_id": TEST_BRAIN_ID,
            "category": "technographic",
            "attribute": "tech_stack",
            "display_name": "Technology Stack",
            "condition": {"type": "contains", "values": ["python", "javascript"]},
            "score_weight": 25,
            "is_knockout": False,
            "reasoning": "Modern tech stack indicates readiness",
        },
        {
            "id": "rule_test_behavioral_001",
            "brain_id": TEST_BRAIN_ID,
            "category": "behavioral",
            "attribute": "website_visits",
            "display_name": "Website Engagement",
            "condition": {"type": "threshold", "min": 3},
            "score_weight": 20,
            "is_knockout": False,
            "reasoning": "Multiple visits indicate interest",
        },
    ]

    points = [
        PointStruct(
            id=string_to_uuid(rule["id"]),  # Use UUID for Qdrant point ID
            vector=deterministic_embedding(
                f"{rule['category']} {rule['attribute']} {rule['reasoning']}"
            ),
            payload=rule,  # Keep string ID in payload
        )
        for rule in rules
    ]

    qdrant_client.upsert(collection_name="icp_rules", points=points)
    yield rules


@pytest.fixture(scope="session")
def seed_response_templates(qdrant_client, seed_test_brain):
    """Seed response templates for testing."""
    templates = [
        {
            "id": "template_test_positive_t1",
            "brain_id": TEST_BRAIN_ID,
            "reply_type": "positive_interest",
            "tier": 1,
            "template_text": "Hi {{first_name}}, Thanks for your interest!",
            "variables": ["first_name"],
            "personalization_instructions": "Be enthusiastic and friendly",
        },
        {
            "id": "template_test_positive_t2",
            "brain_id": TEST_BRAIN_ID,
            "reply_type": "positive_interest",
            "tier": 2,
            "template_text": "Hi {{first_name}}, Great to hear from you at {{company}}!",
            "variables": ["first_name", "company"],
            "personalization_instructions": "Acknowledge their company",
        },
        {
            "id": "template_test_pricing",
            "brain_id": TEST_BRAIN_ID,
            "reply_type": "pricing_question",
            "tier": 1,
            "template_text": "Great question about pricing, {{first_name}}!",
            "variables": ["first_name"],
            "personalization_instructions": "Be transparent about value",
        },
    ]

    points = [
        PointStruct(
            id=string_to_uuid(tpl["id"]),  # Use UUID for Qdrant point ID
            vector=deterministic_embedding(f"{tpl['reply_type']} {tpl['template_text']}"),
            payload=tpl,  # Keep string ID in payload
        )
        for tpl in templates
    ]

    qdrant_client.upsert(collection_name="response_templates", points=points)
    yield templates


@pytest.fixture(scope="session")
def seed_objection_handlers(qdrant_client, seed_test_brain):
    """Seed objection handlers for testing."""
    handlers = [
        {
            "id": "handler_test_pricing_001",
            "brain_id": TEST_BRAIN_ID,
            "objection_type": "pricing",
            "handler_strategy": "roi_reframe",
            "handler_response": "I understand budget is a concern. Let me show you the ROI our customers typically see within 90 days.",
            "variables": ["first_name"],
            "follow_up_actions": ["send_case_study", "schedule_demo"],
        },
        {
            "id": "handler_test_timing_001",
            "brain_id": TEST_BRAIN_ID,
            "objection_type": "timing",
            "handler_strategy": "urgency_create",
            "handler_response": "I understand timing is important. Here's why many companies choose to start now rather than waiting.",
            "variables": ["first_name"],
            "follow_up_actions": ["send_timeline"],
        },
    ]

    points = [
        PointStruct(
            id=string_to_uuid(h["id"]),  # Use UUID for Qdrant point ID
            vector=deterministic_embedding(
                f"{h['objection_type']} {h['handler_response']}"
            ),
            payload=h,  # Keep string ID in payload
        )
        for h in handlers
    ]

    qdrant_client.upsert(collection_name="objection_handlers", points=points)
    yield handlers


@pytest.fixture(scope="session")
def seed_market_research(qdrant_client, seed_test_brain):
    """Seed market research documents for testing."""
    research = [
        {
            "id": "research_test_overview_001",
            "brain_id": TEST_BRAIN_ID,
            "content_type": "market_overview",
            "title": "Test Market Overview 2024",
            "content": "The test market is growing rapidly with key trends including automation, AI adoption, and digital transformation. Market size is estimated at $10B with 25% YoY growth.",
            "key_facts": ["Market size: $10B", "Growth: 25% YoY"],
            "source_url": "https://example.com/market-overview",
        },
        {
            "id": "research_test_competitor_001",
            "brain_id": TEST_BRAIN_ID,
            "content_type": "competitor_analysis",
            "title": "Competitor Analysis: Acme Corp",
            "content": "Acme Corp is a major competitor with strengths in enterprise sales and established brand recognition. Their weakness is lack of modern API integrations.",
            "key_facts": ["Market share: 15%", "Founded: 2015"],
            "source_url": "https://example.com/competitor-acme",
        },
    ]

    points = [
        PointStruct(
            id=string_to_uuid(r["id"]),  # Use UUID for Qdrant point ID
            vector=deterministic_embedding(
                f"{r['content_type']} {r['title']} {r['content']}"
            ),
            payload=r,  # Keep string ID in payload
        )
        for r in research
    ]

    qdrant_client.upsert(collection_name="market_research", points=points)
    yield research


@pytest.fixture
def clean_insights_collection(qdrant_client, seed_test_brain):
    """Clean insights collection before and after each test that modifies insights.

    Use this fixture for tests that write to the insights collection
    to ensure test isolation.
    """
    # Clean before test
    _delete_test_insights(qdrant_client)
    yield
    # Clean after test
    _delete_test_insights(qdrant_client)


# =============================================================================
# Cleanup Helpers
# =============================================================================


def _delete_test_insights(client):
    """Delete all insights for the test brain."""
    try:
        client.delete(
            collection_name="insights",
            points_selector=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=TEST_BRAIN_ID))]
            ),
        )
    except Exception:
        pass  # Collection might be empty or not exist


def _cleanup_test_data(client):
    """Clean up all test data after test session."""
    collections = [
        "icp_rules",
        "response_templates",
        "objection_handlers",
        "market_research",
        "insights",
    ]

    for collection in collections:
        try:
            client.delete(
                collection_name=collection,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="brain_id", match=MatchValue(value=TEST_BRAIN_ID)
                        )
                    ]
                ),
            )
        except Exception:
            pass

    # Delete the brain itself
    try:
        client.delete(
            collection_name="brains",
            points_selector=Filter(
                must=[
                    FieldCondition(key="vertical", match=MatchValue(value=TEST_VERTICAL))
                ]
            ),
        )
    except Exception:
        pass
