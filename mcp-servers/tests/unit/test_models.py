"""Unit tests for Pydantic models.

Tests for T1: All model validations tested.
"""

import pytest
from pydantic import ValidationError

from atlas_gtm_mcp.qdrant.models import (
    AddInsightInput,
    BrainId,
    BrainResult,
    BrainStatus,
    ContentType,
    FindObjectionHandlerInput,
    GetBrainInput,
    GetResponseTemplateInput,
    ICPCategory,
    ICPRuleResult,
    Importance,
    InsightCategory,
    ObjectionType,
    QueryICPRulesInput,
    ReplyType,
    SearchMarketResearchInput,
    SourceMetadata,
    ValidationStatus,
    validate_brain_id,
)


class TestBrainIdValidation:
    """Tests for BrainId branded type validation."""

    def test_valid_brain_id_patterns(self):
        """Test valid brain_id patterns."""
        valid_ids = [
            "brain_iro_v1",
            "brain_fintech_v2",
            "brain_saas_v10",
            "brain_ai_v1",
        ]
        for brain_id in valid_ids:
            assert validate_brain_id(brain_id), f"Should be valid: {brain_id}"

    def test_invalid_brain_id_patterns(self):
        """Test invalid brain_id patterns."""
        invalid_ids = [
            "brain_IRO_v1",  # Uppercase
            "brain_iro",  # Missing version
            "iro_v1",  # Missing 'brain_' prefix
            "brain__v1",  # Missing vertical
            "brain_iro_v",  # Missing version number
            "brain_iro_1",  # Missing 'v' prefix
            "brain_iro-v1",  # Hyphen instead of underscore
            "",  # Empty
            "brain_123_v1",  # Numeric vertical
        ]
        for brain_id in invalid_ids:
            assert not validate_brain_id(brain_id), f"Should be invalid: {brain_id}"


class TestEnums:
    """Tests for all enum definitions."""

    def test_icp_category_values(self):
        """Test ICPCategory enum values."""
        assert ICPCategory.FIRMOGRAPHIC == "firmographic"
        assert ICPCategory.TECHNOGRAPHIC == "technographic"
        assert ICPCategory.BEHAVIORAL == "behavioral"
        assert ICPCategory.INTENT == "intent"
        assert len(ICPCategory) == 4

    def test_reply_type_values(self):
        """Test ReplyType enum values."""
        expected = [
            "positive_interest",
            "pricing_question",
            "timeline_question",
            "feature_question",
            "integration_question",
            "timing_objection",
            "budget_objection",
            "competitor_mention",
            "referral",
            "unsubscribe",
            "negative",
        ]
        assert len(ReplyType) == len(expected)
        for value in expected:
            assert ReplyType(value) is not None

    def test_objection_type_values(self):
        """Test ObjectionType enum values."""
        expected = ["pricing", "timing", "competitor", "authority", "need", "trust"]
        assert len(ObjectionType) == len(expected)
        for value in expected:
            assert ObjectionType(value) is not None

    def test_insight_category_values(self):
        """Test InsightCategory enum values."""
        expected = [
            "buying_process",
            "pain_point",
            "objection",
            "competitive_intel",
            "messaging_effectiveness",
            "icp_signal",
        ]
        assert len(InsightCategory) == len(expected)
        for value in expected:
            assert InsightCategory(value) is not None

    def test_importance_values(self):
        """Test Importance enum values."""
        assert Importance.LOW == "low"
        assert Importance.MEDIUM == "medium"
        assert Importance.HIGH == "high"
        assert len(Importance) == 3

    def test_validation_status_values(self):
        """Test ValidationStatus enum values."""
        assert ValidationStatus.PENDING == "pending"
        assert ValidationStatus.VALIDATED == "validated"
        assert ValidationStatus.REJECTED == "rejected"
        assert len(ValidationStatus) == 3

    def test_brain_status_values(self):
        """Test BrainStatus enum values."""
        assert BrainStatus.ACTIVE == "active"
        assert BrainStatus.DRAFT == "draft"
        assert BrainStatus.ARCHIVED == "archived"
        assert len(BrainStatus) == 3

    def test_content_type_values(self):
        """Test ContentType enum values."""
        expected = [
            "market_overview",
            "competitor_analysis",
            "buyer_persona",
            "pain_points",
            "trends",
            "case_study",
        ]
        assert len(ContentType) == len(expected)
        for value in expected:
            assert ContentType(value) is not None


class TestQueryICPRulesInput:
    """Tests for QueryICPRulesInput model."""

    def test_valid_input(self):
        """Test valid input creation."""
        input_model = QueryICPRulesInput(
            brain_id="brain_iro_v1",
            query="company size employees",
            limit=10,
        )
        assert input_model.brain_id == "brain_iro_v1"
        assert input_model.query == "company size employees"
        assert input_model.limit == 10
        assert input_model.category is None

    def test_valid_input_with_category(self):
        """Test valid input with category filter."""
        input_model = QueryICPRulesInput(
            brain_id="brain_iro_v1",
            query="tech stack",
            category=ICPCategory.TECHNOGRAPHIC,
        )
        assert input_model.category == ICPCategory.TECHNOGRAPHIC

    def test_query_min_length(self):
        """Test query minimum length validation."""
        with pytest.raises(ValidationError) as exc_info:
            QueryICPRulesInput(
                brain_id="brain_iro_v1",
                query="",  # Empty
            )
        assert "query" in str(exc_info.value)

    def test_query_max_length(self):
        """Test query maximum length validation."""
        with pytest.raises(ValidationError) as exc_info:
            QueryICPRulesInput(
                brain_id="brain_iro_v1",
                query="x" * 1001,  # Too long
            )
        assert "query" in str(exc_info.value)

    def test_limit_range(self):
        """Test limit range validation."""
        # Valid limits
        for limit in [1, 10, 50]:
            model = QueryICPRulesInput(
                brain_id="brain_iro_v1",
                query="test",
                limit=limit,
            )
            assert model.limit == limit

        # Invalid limits
        for limit in [0, 51, -1]:
            with pytest.raises(ValidationError):
                QueryICPRulesInput(
                    brain_id="brain_iro_v1",
                    query="test",
                    limit=limit,
                )


class TestGetResponseTemplateInput:
    """Tests for GetResponseTemplateInput model."""

    def test_valid_input(self):
        """Test valid input creation."""
        input_model = GetResponseTemplateInput(
            brain_id="brain_iro_v1",
            reply_type=ReplyType.POSITIVE_INTEREST,
        )
        assert input_model.reply_type == ReplyType.POSITIVE_INTEREST
        assert input_model.tier is None
        assert input_model.auto_send_only is False

    def test_tier_validation(self):
        """Test tier range validation."""
        # Valid tiers
        for tier in [1, 2, 3]:
            model = GetResponseTemplateInput(
                brain_id="brain_iro_v1",
                reply_type=ReplyType.POSITIVE_INTEREST,
                tier=tier,
            )
            assert model.tier == tier

        # Invalid tiers
        for tier in [0, 4]:
            with pytest.raises(ValidationError):
                GetResponseTemplateInput(
                    brain_id="brain_iro_v1",
                    reply_type=ReplyType.POSITIVE_INTEREST,
                    tier=tier,
                )

    def test_auto_send_only(self):
        """Test auto_send_only flag."""
        model = GetResponseTemplateInput(
            brain_id="brain_iro_v1",
            reply_type=ReplyType.PRICING_QUESTION,
            auto_send_only=True,
        )
        assert model.auto_send_only is True


class TestFindObjectionHandlerInput:
    """Tests for FindObjectionHandlerInput model."""

    def test_valid_input(self):
        """Test valid input creation."""
        input_model = FindObjectionHandlerInput(
            brain_id="brain_iro_v1",
            objection_text="This is too expensive for our budget",
        )
        assert "expensive" in input_model.objection_text

    def test_objection_text_max_length(self):
        """Test objection_text maximum length validation."""
        with pytest.raises(ValidationError):
            FindObjectionHandlerInput(
                brain_id="brain_iro_v1",
                objection_text="x" * 2001,  # Too long
            )


class TestSourceMetadata:
    """Tests for SourceMetadata model."""

    def test_required_fields(self):
        """Test required fields validation."""
        source = SourceMetadata(
            type="call_transcript",
            id="call_123",
        )
        assert source.type == "call_transcript"
        assert source.id == "call_123"
        assert source.lead_id is None
        assert source.company_name is None
        assert source.extracted_quote is None

    def test_optional_fields(self):
        """Test optional fields."""
        source = SourceMetadata(
            type="email_reply",
            id="email_456",
            lead_id="lead_789",
            company_name="Acme Corp",
            extracted_quote="We need CFO approval for this",
        )
        assert source.lead_id == "lead_789"
        assert source.company_name == "Acme Corp"
        assert source.extracted_quote == "We need CFO approval for this"


class TestAddInsightInput:
    """Tests for AddInsightInput model."""

    def test_valid_input(self):
        """Test valid input creation."""
        source = SourceMetadata(type="call_transcript", id="call_123")
        input_model = AddInsightInput(
            brain_id="brain_iro_v1",
            content="This is a meaningful insight with enough content",
            category=InsightCategory.BUYING_PROCESS,
            source=source,
        )
        assert input_model.importance == Importance.MEDIUM  # Default

    def test_content_min_length(self):
        """Test content minimum length validation."""
        source = SourceMetadata(type="call_transcript", id="call_123")
        with pytest.raises(ValidationError) as exc_info:
            AddInsightInput(
                brain_id="brain_iro_v1",
                content="short",  # Less than 10 chars
                category=InsightCategory.PAIN_POINT,
                source=source,
            )
        assert "content" in str(exc_info.value)

    def test_content_max_length(self):
        """Test content maximum length validation."""
        source = SourceMetadata(type="call_transcript", id="call_123")
        with pytest.raises(ValidationError):
            AddInsightInput(
                brain_id="brain_iro_v1",
                content="x" * 5001,  # Too long
                category=InsightCategory.PAIN_POINT,
                source=source,
            )


class TestGetBrainInput:
    """Tests for GetBrainInput model."""

    def test_both_none_is_valid(self):
        """Test that both brain_id and vertical can be None (returns default)."""
        input_model = GetBrainInput()
        assert input_model.brain_id is None
        assert input_model.vertical is None

    def test_brain_id_only(self):
        """Test with only brain_id."""
        input_model = GetBrainInput(brain_id="brain_iro_v1")
        assert input_model.brain_id == "brain_iro_v1"
        assert input_model.vertical is None

    def test_vertical_only(self):
        """Test with only vertical."""
        input_model = GetBrainInput(vertical="iro")
        assert input_model.brain_id is None
        assert input_model.vertical == "iro"

    def test_both_provided(self):
        """Test with both provided (both allowed)."""
        input_model = GetBrainInput(brain_id="brain_iro_v1", vertical="iro")
        assert input_model.brain_id == "brain_iro_v1"
        assert input_model.vertical == "iro"


class TestSearchMarketResearchInput:
    """Tests for SearchMarketResearchInput model."""

    def test_valid_input(self):
        """Test valid input creation."""
        input_model = SearchMarketResearchInput(
            brain_id="brain_iro_v1",
            query="competitor pricing analysis",
        )
        assert input_model.limit == 5  # Default

    def test_limit_range(self):
        """Test limit range validation (1-20)."""
        # Valid limits
        for limit in [1, 10, 20]:
            model = SearchMarketResearchInput(
                brain_id="brain_iro_v1",
                query="test",
                limit=limit,
            )
            assert model.limit == limit

        # Invalid limits
        for limit in [0, 21]:
            with pytest.raises(ValidationError):
                SearchMarketResearchInput(
                    brain_id="brain_iro_v1",
                    query="test",
                    limit=limit,
                )
