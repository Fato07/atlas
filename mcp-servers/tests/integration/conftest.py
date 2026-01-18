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

    def mock_embed_batch(texts: list[str], input_type: str = "document") -> list[list[float]]:
        return [deterministic_embedding(text) for text in texts]

    # Mock at module level where functions are imported
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embeddings.embed_query",
        mock_embed_query,
    )
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embeddings.embed_document",
        mock_embed_document,
    )
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embeddings.embed_batch",
        mock_embed_batch,
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
    monkeypatch.setattr(
        "atlas_gtm_mcp.qdrant.embed_batch",
        mock_embed_batch,
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


# =============================================================================
# Brain Lifecycle Test Fixtures (003-brain-lifecycle)
# =============================================================================

# Constants for lifecycle tests
TEST_LIFECYCLE_BRAIN_ID = "brain_lifecycle_test_1705590000000"
TEST_LIFECYCLE_VERTICAL = "lifecycle_test"


@pytest.fixture
def lifecycle_brain_id():
    """Return the standard lifecycle test brain ID."""
    return TEST_LIFECYCLE_BRAIN_ID


@pytest.fixture
def lifecycle_vertical():
    """Return the standard lifecycle test vertical."""
    return TEST_LIFECYCLE_VERTICAL


@pytest.fixture
def draft_brain_factory(qdrant_client):
    """Factory fixture to create draft brains for testing.

    Returns a function that creates a draft brain with given parameters.
    Automatically cleans up created brains after the test.
    """
    created_brain_ids = []

    def _create_draft_brain(
        brain_id: str,
        vertical: str,
        name: str = "Test Draft Brain",
        description: str = "A brain for testing",
    ) -> str:
        brain_point = PointStruct(
            id=string_to_uuid(brain_id),
            vector=deterministic_embedding(f"brain {vertical}"),
            payload={
                "id": brain_id,
                "name": name,
                "vertical": vertical,
                "version": "1.0",
                "status": "draft",
                "description": description,
                "config": {
                    "default_tier_thresholds": {"tier1": 90, "tier2": 70, "tier3": 50},
                    "auto_response_enabled": False,
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
        created_brain_ids.append((brain_id, vertical))
        return brain_id

    yield _create_draft_brain

    # Cleanup created brains after test
    for brain_id, vertical in created_brain_ids:
        _cleanup_brain_lifecycle_data(qdrant_client, brain_id, vertical)


@pytest.fixture
def active_brain_factory(qdrant_client):
    """Factory fixture to create active brains for testing.

    Returns a function that creates an active brain with given parameters.
    Automatically cleans up created brains after the test.
    """
    created_brain_ids = []

    def _create_active_brain(
        brain_id: str,
        vertical: str,
        name: str = "Test Active Brain",
        description: str = "An active brain for testing",
    ) -> str:
        brain_point = PointStruct(
            id=string_to_uuid(brain_id),
            vector=deterministic_embedding(f"brain {vertical}"),
            payload={
                "id": brain_id,
                "name": name,
                "vertical": vertical,
                "version": "1.0",
                "status": "active",
                "description": description,
                "config": {
                    "default_tier_thresholds": {"tier1": 90, "tier2": 70, "tier3": 50},
                    "auto_response_enabled": True,
                    "learning_enabled": True,
                    "quality_gate_threshold": 0.8,
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
        created_brain_ids.append((brain_id, vertical))
        return brain_id

    yield _create_active_brain

    # Cleanup created brains after test
    for brain_id, vertical in created_brain_ids:
        _cleanup_brain_lifecycle_data(qdrant_client, brain_id, vertical)


@pytest.fixture
def archived_brain_factory(qdrant_client):
    """Factory fixture to create archived brains for testing.

    Returns a function that creates an archived brain with given parameters.
    Automatically cleans up created brains after the test.
    """
    created_brain_ids = []

    def _create_archived_brain(
        brain_id: str,
        vertical: str,
        name: str = "Test Archived Brain",
        description: str = "An archived brain for testing",
    ) -> str:
        brain_point = PointStruct(
            id=string_to_uuid(brain_id),
            vector=deterministic_embedding(f"brain {vertical}"),
            payload={
                "id": brain_id,
                "name": name,
                "vertical": vertical,
                "version": "1.0",
                "status": "archived",
                "description": description,
                "config": {
                    "default_tier_thresholds": {"tier1": 90, "tier2": 70, "tier3": 50},
                    "auto_response_enabled": False,
                    "learning_enabled": False,
                    "quality_gate_threshold": 0.7,
                },
                "stats": {
                    "icp_rules_count": 5,
                    "templates_count": 3,
                    "handlers_count": 2,
                    "research_docs_count": 4,
                    "insights_count": 10,
                },
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        qdrant_client.upsert(collection_name="brains", points=[brain_point])
        created_brain_ids.append((brain_id, vertical))
        return brain_id

    yield _create_archived_brain

    # Cleanup created brains after test
    for brain_id, vertical in created_brain_ids:
        _cleanup_brain_lifecycle_data(qdrant_client, brain_id, vertical)


@pytest.fixture
def clean_lifecycle_data(qdrant_client, lifecycle_brain_id, lifecycle_vertical):
    """Clean up lifecycle test data before and after test.

    Use this fixture for tests that need a clean slate.
    """
    _cleanup_brain_lifecycle_data(qdrant_client, lifecycle_brain_id, lifecycle_vertical)
    yield
    _cleanup_brain_lifecycle_data(qdrant_client, lifecycle_brain_id, lifecycle_vertical)


def _cleanup_brain_lifecycle_data(client, brain_id: str, vertical: str):
    """Clean up all data associated with a lifecycle test brain."""
    collections = [
        "icp_rules",
        "response_templates",
        "objection_handlers",
        "market_research",
        "insights",
    ]

    # Delete content scoped to brain_id
    for collection in collections:
        try:
            client.delete(
                collection_name=collection,
                points_selector=Filter(
                    must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
                ),
            )
        except Exception:
            pass

    # Delete the brain by both ID and vertical (to catch any orphaned brains)
    try:
        client.delete(
            collection_name="brains",
            points_selector=Filter(
                must=[FieldCondition(key="id", match=MatchValue(value=brain_id))]
            ),
        )
    except Exception:
        pass

    try:
        client.delete(
            collection_name="brains",
            points_selector=Filter(
                must=[FieldCondition(key="vertical", match=MatchValue(value=vertical))]
            ),
        )
    except Exception:
        pass


# Sample test data for seeding operations
SAMPLE_ICP_RULES = [
    {
        "name": "Large Enterprise",
        "category": "firmographic",
        "attribute": "company_size",
        "criteria": "Companies with 1000+ employees in defense sector",
        "weight": 25,
        "match_condition": {"min_employees": 1000},
        "is_knockout": False,
        "reasoning": "Large enterprises have budget for our offering",
    },
    {
        "name": "Government Contractor",
        "category": "firmographic",
        "attribute": "customer_type",
        "criteria": "Active DoD or federal government contractor",
        "weight": 30,
        "match_condition": {"has_gov_contract": True},
        "is_knockout": False,
        "reasoning": "Government contractors are our primary target",
    },
]

SAMPLE_TEMPLATES = [
    {
        "name": "Positive Interest Response",
        "intent": "positive_interest",
        "template_text": "Hi {{first_name}}, Thanks for your interest! I'd love to show you how we've helped companies like {{company_name}}.",
        "variables": ["first_name", "company_name"],
        "tier": 1,
        "personalization_instructions": "Be enthusiastic and mention specific value propositions",
    },
]

SAMPLE_HANDLERS = [
    {
        "objection_text": "We don't have budget right now",
        "objection_type": "pricing",
        "category": "budget_constraint",
        "response": "I understand budget is always a consideration. Many of our customers started with a pilot program...",
        "handler_strategy": "Acknowledge, offer pilot, align with budget cycles",
        "variables": [],
        "follow_up_actions": ["Send pilot program details"],
    },
]

SAMPLE_RESEARCH = [
    {
        "topic": "Defense Procurement Cycles",
        "content": "Defense contractors operate on government fiscal year cycles. Budget decisions are typically made in Q4, with 18-month procurement cycles common for major programs.",
        "content_type": "market_overview",
        "source": "Industry Research 2024",
        "date": "2024-01-15",
        "key_facts": ["Budget decisions in Q4", "18-month procurement cycles"],
        "source_url": "https://example.com/defense-research",
    },
]


@pytest.fixture
def sample_icp_rules():
    """Sample ICP rules for seeding tests."""
    return SAMPLE_ICP_RULES.copy()


@pytest.fixture
def sample_templates():
    """Sample templates for seeding tests."""
    return SAMPLE_TEMPLATES.copy()


@pytest.fixture
def sample_handlers():
    """Sample handlers for seeding tests."""
    return SAMPLE_HANDLERS.copy()


@pytest.fixture
def sample_research():
    """Sample research for seeding tests."""
    return SAMPLE_RESEARCH.copy()
