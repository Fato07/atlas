"""Unit tests for quality gates module.

Tests for T2: All quality gate logic tested.
"""

import pytest

from atlas_gtm_mcp.qdrant.models import (
    Importance,
    InsightCategory,
    QualityGateResult,
    SourceMetadata,
)
from atlas_gtm_mcp.qdrant.quality_gates import (
    DUPLICATE_SIMILARITY_THRESHOLD,
    MIN_CONFIDENCE_THRESHOLD,
    calculate_confidence,
    should_require_validation,
)


class TestCalculateConfidence:
    """Tests for confidence calculation."""

    def test_base_score(self):
        """Test base score is 0.5 for manual_entry with no extras."""
        source = SourceMetadata(
            type="manual_entry",
            id="manual_123",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.5

    def test_call_transcript_bonus(self):
        """Test call_transcript adds 0.2 to score."""
        source = SourceMetadata(
            type="call_transcript",
            id="call_123",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.7  # 0.5 + 0.2

    def test_email_reply_bonus(self):
        """Test email_reply adds 0.1 to score."""
        source = SourceMetadata(
            type="email_reply",
            id="email_123",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.6  # 0.5 + 0.1

    def test_linkedin_message_bonus(self):
        """Test linkedin_message adds 0.05 to score."""
        source = SourceMetadata(
            type="linkedin_message",
            id="linkedin_123",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.55  # 0.5 + 0.05

    def test_extracted_quote_bonus(self):
        """Test extracted_quote adds 0.1 to score."""
        source = SourceMetadata(
            type="manual_entry",
            id="manual_123",
            extracted_quote="This is a direct quote",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.6  # 0.5 + 0.1

    def test_company_name_bonus(self):
        """Test company_name adds 0.1 to score."""
        source = SourceMetadata(
            type="manual_entry",
            id="manual_123",
            company_name="Acme Corp",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.6  # 0.5 + 0.1

    def test_combined_bonuses(self):
        """Test all bonuses combined."""
        source = SourceMetadata(
            type="call_transcript",  # +0.2
            id="call_123",
            company_name="Acme Corp",  # +0.1
            extracted_quote="Direct quote",  # +0.1
        )
        confidence = calculate_confidence("Test content", source)
        # 0.5 + 0.2 + 0.1 + 0.1 = 0.9
        assert confidence == 0.9

    def test_max_confidence_capped_at_1(self):
        """Test confidence is capped at 1.0."""
        # Even with all bonuses that might exceed 1.0, it should cap
        source = SourceMetadata(
            type="call_transcript",  # +0.2
            id="call_123",
            company_name="Acme Corp",  # +0.1
            extracted_quote="Direct quote",  # +0.1
            lead_id="lead_123",  # Additional context, no bonus
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence <= 1.0

    def test_unknown_source_type(self):
        """Test unknown source type gets no bonus."""
        source = SourceMetadata(
            type="unknown_type",
            id="unknown_123",
        )
        confidence = calculate_confidence("Test content", source)
        assert confidence == 0.5  # Base score only


class TestShouldRequireValidation:
    """Tests for validation flag logic."""

    def test_high_importance_requires_validation(self):
        """Test high importance always requires validation."""
        result = should_require_validation(
            importance=Importance.HIGH,
            category=InsightCategory.PAIN_POINT,
            confidence=0.95,
        )
        assert result is True

    def test_buying_process_requires_validation(self):
        """Test buying_process category requires validation."""
        result = should_require_validation(
            importance=Importance.LOW,
            category=InsightCategory.BUYING_PROCESS,
            confidence=0.95,
        )
        assert result is True

    def test_icp_signal_requires_validation(self):
        """Test icp_signal category requires validation."""
        result = should_require_validation(
            importance=Importance.LOW,
            category=InsightCategory.ICP_SIGNAL,
            confidence=0.95,
        )
        assert result is True

    def test_low_confidence_requires_validation(self):
        """Test confidence < 0.80 requires validation."""
        result = should_require_validation(
            importance=Importance.LOW,
            category=InsightCategory.PAIN_POINT,
            confidence=0.75,
        )
        assert result is True

    def test_no_validation_needed(self):
        """Test when no validation is required."""
        result = should_require_validation(
            importance=Importance.MEDIUM,
            category=InsightCategory.PAIN_POINT,
            confidence=0.85,
        )
        assert result is False

    def test_boundary_confidence_80(self):
        """Test boundary case at exactly 0.80 confidence."""
        # At exactly 0.80, should NOT require validation (< 0.80 is the condition)
        result = should_require_validation(
            importance=Importance.LOW,
            category=InsightCategory.PAIN_POINT,
            confidence=0.80,
        )
        assert result is False

    def test_boundary_confidence_79(self):
        """Test boundary case at 0.79 confidence."""
        result = should_require_validation(
            importance=Importance.LOW,
            category=InsightCategory.PAIN_POINT,
            confidence=0.79,
        )
        assert result is True

    def test_string_enum_values(self):
        """Test with string values instead of enum objects."""
        result = should_require_validation(
            importance="high",
            category="pain_point",
            confidence=0.95,
        )
        assert result is True


class TestThresholds:
    """Tests for threshold constants."""

    def test_duplicate_threshold(self):
        """Test duplicate similarity threshold is 0.85 per FR-011."""
        assert DUPLICATE_SIMILARITY_THRESHOLD == 0.85

    def test_min_confidence_threshold(self):
        """Test minimum confidence threshold is 0.70 per contract."""
        assert MIN_CONFIDENCE_THRESHOLD == 0.70


class TestQualityGateResult:
    """Tests for QualityGateResult model."""

    def test_passed_result(self):
        """Test a passing quality gate result."""
        result = QualityGateResult(
            passed=True,
            confidence_score=0.85,
            is_duplicate=False,
            requires_validation=False,
        )
        assert result.passed is True
        assert result.duplicate_id is None
        assert result.rejection_reason is None

    def test_rejected_low_confidence(self):
        """Test rejected due to low confidence."""
        result = QualityGateResult(
            passed=False,
            confidence_score=0.55,
            is_duplicate=False,
            requires_validation=False,
            rejection_reason="Confidence 0.55 below threshold 0.70",
        )
        assert result.passed is False
        assert "0.55" in result.rejection_reason

    def test_duplicate_result(self):
        """Test duplicate detection result."""
        result = QualityGateResult(
            passed=False,
            confidence_score=0.85,
            is_duplicate=True,
            duplicate_id="existing_insight_123",
            similarity_score=0.92,
            requires_validation=False,
        )
        assert result.passed is False
        assert result.is_duplicate is True
        assert result.duplicate_id == "existing_insight_123"
        assert result.similarity_score == 0.92

    def test_requires_validation(self):
        """Test result with validation required."""
        result = QualityGateResult(
            passed=True,
            confidence_score=0.75,
            is_duplicate=False,
            requires_validation=True,
        )
        assert result.passed is True
        assert result.requires_validation is True
