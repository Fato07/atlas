"""Tests for Instantly MCP models and validation utilities.

Tests verify:
- Enum validation (CampaignStatus, LeadStatus, AccountStatus)
- Input validation functions (email, campaign_id, pagination, etc.)
- Pydantic model validation (LeadInput, BulkLeadInput)
- Error type classification
"""

from __future__ import annotations

import pytest

from atlas_gtm_mcp.instantly.models import (
    AccountStatus,
    BulkLeadInput,
    CampaignStatus,
    InstantlyErrorType,
    LeadInput,
    LeadStatus,
    classify_http_error,
    validate_campaign_id,
    validate_email,
    validate_limit,
    validate_skip,
)


# =============================================================================
# Enum Tests
# =============================================================================


class TestCampaignStatus:
    """Tests for CampaignStatus enum."""

    def test_valid_values(self):
        """Test all valid campaign status values."""
        assert CampaignStatus.DRAFT.value == "draft"
        assert CampaignStatus.ACTIVE.value == "active"
        assert CampaignStatus.PAUSED.value == "paused"
        assert CampaignStatus.COMPLETED.value == "completed"
        assert CampaignStatus.ARCHIVED.value == "archived"

    def test_values_method(self):
        """Test values() returns all status values."""
        values = CampaignStatus.values()
        assert "draft" in values
        assert "active" in values
        assert "paused" in values
        assert "completed" in values
        assert "archived" in values
        assert len(values) == 5

    def test_validate_valid_status(self):
        """Test validate() accepts valid status strings."""
        assert CampaignStatus.validate("active") is True
        assert CampaignStatus.validate("ACTIVE") is True
        assert CampaignStatus.validate("Active") is True
        assert CampaignStatus.validate("draft") is True

    def test_validate_invalid_status(self):
        """Test validate() rejects invalid status strings."""
        assert CampaignStatus.validate("INVALID") is False
        assert CampaignStatus.validate("") is False
        assert CampaignStatus.validate("running") is False


class TestLeadStatus:
    """Tests for LeadStatus enum."""

    def test_valid_values(self):
        """Test all valid lead status values."""
        assert LeadStatus.ACTIVE.value == "active"
        assert LeadStatus.PAUSED.value == "paused"
        assert LeadStatus.CONTACTED.value == "contacted"
        assert LeadStatus.REPLIED.value == "replied"
        assert LeadStatus.BOUNCED.value == "bounced"

    def test_values_method(self):
        """Test values() returns all status values."""
        values = LeadStatus.values()
        assert "active" in values
        assert "contacted" in values
        assert "replied" in values
        assert "interested" in values
        assert "not_interested" in values
        assert "unsubscribed" in values
        assert "bounced" in values

    def test_validate_valid_status(self):
        """Test validate() accepts valid status strings."""
        assert LeadStatus.validate("contacted") is True
        assert LeadStatus.validate("CONTACTED") is True
        assert LeadStatus.validate("replied") is True
        assert LeadStatus.validate("REPLIED") is True

    def test_validate_invalid_status(self):
        """Test validate() rejects invalid status strings."""
        assert LeadStatus.validate("invalid") is False
        assert LeadStatus.validate("SENT") is False


class TestAccountStatus:
    """Tests for AccountStatus enum."""

    def test_valid_values(self):
        """Test all valid account status values."""
        assert AccountStatus.ACTIVE.value == "active"
        assert AccountStatus.PAUSED.value == "paused"
        assert AccountStatus.WARMING.value == "warming"
        assert AccountStatus.ERROR.value == "error"
        assert AccountStatus.DISCONNECTED.value == "disconnected"

    def test_values_method(self):
        """Test values() returns all status values."""
        values = AccountStatus.values()
        assert "active" in values
        assert "paused" in values
        assert "warming" in values
        assert "error" in values
        assert "disconnected" in values
        assert len(values) == 5


# =============================================================================
# Validation Function Tests
# =============================================================================


class TestValidateEmail:
    """Tests for validate_email function."""

    def test_valid_emails(self):
        """Test that valid email formats are accepted."""
        assert validate_email("user@example.com") is True
        assert validate_email("user.name@example.com") is True
        assert validate_email("user+tag@example.com") is True
        assert validate_email("user@subdomain.example.com") is True

    def test_invalid_emails(self):
        """Test that invalid email formats are rejected."""
        assert validate_email("") is False
        assert validate_email("notanemail") is False
        assert validate_email("@example.com") is False
        assert validate_email("user@") is False
        assert validate_email(None) is False
        assert validate_email(123) is False


class TestValidateCampaignId:
    """Tests for validate_campaign_id function."""

    def test_valid_campaign_ids(self):
        """Test that valid campaign IDs are accepted."""
        assert validate_campaign_id("camp_12345678901234567890") is True
        assert validate_campaign_id("abc123") is True
        assert validate_campaign_id("a" * 50) is True

    def test_invalid_campaign_ids(self):
        """Test that invalid campaign IDs are rejected."""
        assert validate_campaign_id("") is False
        assert validate_campaign_id("abc") is False  # Too short
        assert validate_campaign_id("abcd") is False  # Still too short
        assert validate_campaign_id("a" * 101) is False  # Too long
        assert validate_campaign_id(None) is False
        assert validate_campaign_id(123) is False


class TestValidateLimit:
    """Tests for validate_limit function."""

    def test_valid_limits(self):
        """Test that valid limit values are returned unchanged."""
        assert validate_limit(10) == 10
        assert validate_limit(100) == 100
        assert validate_limit(1) == 1

    def test_high_limits_capped(self):
        """Test that limits above 100 are capped."""
        assert validate_limit(200) == 100
        assert validate_limit(1000) == 100

    def test_invalid_limits_use_default(self):
        """Test that invalid limits fall back to default."""
        assert validate_limit(0) == 100
        assert validate_limit(-1) == 100


class TestValidateSkip:
    """Tests for validate_skip function."""

    def test_valid_skip_values(self):
        """Test that valid skip values are returned unchanged."""
        assert validate_skip(0) == 0
        assert validate_skip(10) == 10
        assert validate_skip(1000) == 1000

    def test_negative_skip_uses_zero(self):
        """Test that negative skip values become 0."""
        assert validate_skip(-1) == 0
        assert validate_skip(-100) == 0


# =============================================================================
# Error Classification Tests
# =============================================================================


class TestClassifyHttpError:
    """Tests for classify_http_error function."""

    def test_authentication_errors(self):
        """Test 401 errors are classified as authentication."""
        assert classify_http_error(401, "") == InstantlyErrorType.AUTHENTICATION

    def test_permission_errors(self):
        """Test 403 errors are classified as permission denied."""
        assert classify_http_error(403, "") == InstantlyErrorType.PERMISSION_DENIED

    def test_not_found_errors(self):
        """Test 404 errors are classified as not found."""
        assert classify_http_error(404, "") == InstantlyErrorType.NOT_FOUND

    def test_rate_limit_errors(self):
        """Test 429 errors are classified as rate limited."""
        assert classify_http_error(429, "") == InstantlyErrorType.RATE_LIMITED

    def test_validation_errors(self):
        """Test 422 errors are classified as validation."""
        assert classify_http_error(422, "") == InstantlyErrorType.VALIDATION

    def test_server_errors(self):
        """Test 5xx errors are classified as service unavailable."""
        assert classify_http_error(500, "") == InstantlyErrorType.SERVICE_UNAVAILABLE
        assert classify_http_error(502, "") == InstantlyErrorType.SERVICE_UNAVAILABLE
        assert classify_http_error(503, "") == InstantlyErrorType.SERVICE_UNAVAILABLE

    def test_bad_request_errors(self):
        """Test other 4xx errors are classified as bad request."""
        assert classify_http_error(400, "") == InstantlyErrorType.BAD_REQUEST

    def test_instantly_specific_errors(self):
        """Test Instantly-specific error classification from message content."""
        assert classify_http_error(409, "Lead already exists") == InstantlyErrorType.LEAD_EXISTS
        assert classify_http_error(409, "Duplicate entry") == InstantlyErrorType.LEAD_EXISTS
        assert classify_http_error(400, "Campaign not active") == InstantlyErrorType.CAMPAIGN_NOT_ACTIVE
        assert classify_http_error(400, "Campaign is paused") == InstantlyErrorType.CAMPAIGN_NOT_ACTIVE
        assert classify_http_error(400, "Account error") == InstantlyErrorType.ACCOUNT_ERROR

    def test_retriable_classification(self):
        """Test that retriable errors are correctly identified."""
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.RATE_LIMITED) is True
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.NETWORK_ERROR) is True
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.TIMEOUT) is True
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.SERVICE_UNAVAILABLE) is True

    def test_non_retriable_classification(self):
        """Test that non-retriable errors are correctly identified."""
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.AUTHENTICATION) is False
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.NOT_FOUND) is False
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.VALIDATION) is False
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.LEAD_EXISTS) is False
        assert InstantlyErrorType.is_retriable(InstantlyErrorType.CAMPAIGN_NOT_ACTIVE) is False


# =============================================================================
# Pydantic Model Tests
# =============================================================================


class TestLeadInput:
    """Tests for LeadInput Pydantic model."""

    def test_valid_lead_input(self):
        """Test creating a valid lead input."""
        lead = LeadInput(
            email="john@example.com",
            first_name="John",
            last_name="Doe",
            company_name="Example Corp",
        )
        assert lead.email == "john@example.com"
        assert lead.first_name == "John"
        assert lead.last_name == "Doe"

    def test_lead_input_required_email(self):
        """Test that email is required."""
        with pytest.raises(Exception):  # ValidationError
            LeadInput(first_name="John")

    def test_lead_input_email_validation(self):
        """Test that invalid email is rejected."""
        with pytest.raises(Exception):  # ValidationError
            LeadInput(email="notanemail")

    def test_lead_input_with_custom_variables(self):
        """Test lead input with custom variables."""
        lead = LeadInput(
            email="john@example.com",
            custom_variables={"industry": "Tech", "source": "LinkedIn"},
        )
        assert lead.custom_variables["industry"] == "Tech"

    def test_lead_input_name_length_limits(self):
        """Test name field length limits."""
        # Should accept reasonable length names
        lead = LeadInput(email="john@example.com", first_name="A" * 100)
        assert lead.first_name == "A" * 100

        # Should reject names that are too long
        with pytest.raises(Exception):  # ValidationError
            LeadInput(email="john@example.com", first_name="A" * 101)

    def test_lead_input_email_normalized(self):
        """Test that email is normalized to lowercase."""
        lead = LeadInput(email="JOHN@EXAMPLE.COM")
        assert lead.email == "john@example.com"


class TestBulkLeadInput:
    """Tests for BulkLeadInput Pydantic model."""

    def test_valid_bulk_input(self):
        """Test creating valid bulk lead input."""
        bulk = BulkLeadInput(
            leads=[
                LeadInput(email="john@example.com"),
                LeadInput(email="jane@example.com"),
            ],
        )
        assert len(bulk.leads) == 2

    def test_bulk_input_requires_leads(self):
        """Test that leads list is required."""
        with pytest.raises(Exception):  # ValidationError
            BulkLeadInput()

    def test_bulk_input_max_leads(self):
        """Test that max 100 leads are allowed."""
        # Should accept 100 leads
        leads = [LeadInput(email=f"user{i}@example.com") for i in range(100)]
        bulk = BulkLeadInput(leads=leads)
        assert len(bulk.leads) == 100

        # Should reject more than 100 leads
        leads_101 = [LeadInput(email=f"user{i}@example.com") for i in range(101)]
        with pytest.raises(Exception):  # ValidationError
            BulkLeadInput(leads=leads_101)

    def test_bulk_input_empty_leads_rejected(self):
        """Test that empty leads list is rejected."""
        with pytest.raises(Exception):  # ValidationError
            BulkLeadInput(leads=[])
