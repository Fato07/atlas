"""Instantly data models and validation utilities.

Provides:
- Lead status enum and validation
- Campaign status enum
- Error type classification
- Input validation functions
- Pydantic models for structured data
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

# =============================================================================
# Lead Status
# =============================================================================


class LeadStatus(str, Enum):
    """Valid lead statuses in Instantly."""

    ACTIVE = "active"
    PAUSED = "paused"
    CONTACTED = "contacted"
    REPLIED = "replied"
    INTERESTED = "interested"
    NOT_INTERESTED = "not_interested"
    MEETING_BOOKED = "meeting_booked"
    MEETING_COMPLETED = "meeting_completed"
    CLOSED = "closed"
    UNSUBSCRIBED = "unsubscribed"
    BOUNCED = "bounced"
    OUT_OF_OFFICE = "out_of_office"

    @classmethod
    def values(cls) -> list[str]:
        """Return all valid status values."""
        return [status.value for status in cls]

    @classmethod
    def validate(cls, status: str) -> bool:
        """Check if a status name is valid."""
        return status.lower() in cls.values()


# =============================================================================
# Campaign Status
# =============================================================================


class CampaignStatus(str, Enum):
    """Valid campaign statuses in Instantly."""

    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"

    @classmethod
    def values(cls) -> list[str]:
        """Return all valid status values."""
        return [status.value for status in cls]

    @classmethod
    def validate(cls, status: str) -> bool:
        """Check if a status name is valid."""
        return status.lower() in cls.values()


# =============================================================================
# Account Status
# =============================================================================


class AccountStatus(str, Enum):
    """Valid account statuses in Instantly."""

    ACTIVE = "active"
    PAUSED = "paused"
    WARMING = "warming"
    ERROR = "error"
    DISCONNECTED = "disconnected"

    @classmethod
    def values(cls) -> list[str]:
        """Return all valid status values."""
        return [status.value for status in cls]


# =============================================================================
# Input Validation
# =============================================================================

# Email validation regex (basic RFC 5322 compliant)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def validate_email(email: str) -> bool:
    """Validate email format.

    Args:
        email: Email address to validate

    Returns:
        True if email format is valid, False otherwise
    """
    if not email or not isinstance(email, str):
        return False
    return bool(EMAIL_REGEX.match(email.strip()))


def validate_non_empty_string(value: str, field_name: str) -> str:
    """Validate that a string is non-empty.

    Args:
        value: String value to validate
        field_name: Name of the field for error messages

    Returns:
        The trimmed string value

    Raises:
        ValueError: If string is empty or not a string
    """
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    trimmed = value.strip()
    if not trimmed:
        raise ValueError(f"{field_name} cannot be empty")
    return trimmed


def validate_campaign_id(campaign_id: str) -> bool:
    """Validate Instantly campaign ID format.

    Args:
        campaign_id: Campaign ID to validate

    Returns:
        True if format looks valid, False otherwise
    """
    if not campaign_id or not isinstance(campaign_id, str):
        return False
    trimmed = campaign_id.strip()
    return len(trimmed) >= 5 and len(trimmed) <= 100


def validate_account_email(email: str) -> bool:
    """Validate account email format.

    Args:
        email: Account email to validate

    Returns:
        True if format looks valid, False otherwise
    """
    return validate_email(email)


def validate_limit(limit: int, default: int = 100, max_limit: int = 100) -> int:
    """Validate and normalize pagination limit.

    Args:
        limit: Requested limit
        default: Default limit if invalid
        max_limit: Maximum allowed limit

    Returns:
        Validated limit value
    """
    if not isinstance(limit, int) or limit <= 0:
        return default
    return min(limit, max_limit)


def validate_skip(skip: int) -> int:
    """Validate and normalize pagination skip/offset.

    Args:
        skip: Requested skip/offset value

    Returns:
        Validated skip value (minimum 0)
    """
    if not isinstance(skip, int) or skip < 0:
        return 0
    return skip


# =============================================================================
# Pydantic Models for Structured Data
# =============================================================================


class LeadInput(BaseModel):
    """Input model for adding a lead."""

    email: str = Field(..., description="Lead's email address (required)")
    first_name: str | None = Field(None, max_length=100, description="First name")
    last_name: str | None = Field(None, max_length=100, description="Last name")
    company_name: str | None = Field(None, max_length=200, description="Company name")
    personalization: str | None = Field(None, max_length=500, description="Personalization text")
    phone: str | None = Field(None, max_length=50, description="Phone number")
    website: str | None = Field(None, max_length=500, description="Website URL")
    custom_variables: dict[str, str] | None = Field(None, description="Custom variables")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        if not validate_email(v):
            raise ValueError("Invalid email format")
        return v.strip().lower()


class BulkLeadInput(BaseModel):
    """Input model for bulk adding leads."""

    leads: list[LeadInput] = Field(..., min_length=1, max_length=100)

    @field_validator("leads")
    @classmethod
    def validate_lead_count(cls, v: list[LeadInput]) -> list[LeadInput]:
        if len(v) > 100:
            raise ValueError("Maximum 100 leads per bulk operation")
        return v


class CampaignInput(BaseModel):
    """Input model for creating a campaign."""

    name: str = Field(..., min_length=1, max_length=200, description="Campaign name")
    from_email: str = Field(..., description="Sending email account")
    subject: str = Field(..., min_length=1, max_length=500, description="Email subject")
    body: str = Field(..., min_length=1, max_length=50000, description="Email body (HTML)")

    @field_validator("from_email")
    @classmethod
    def validate_from_email(cls, v: str) -> str:
        if not validate_email(v):
            raise ValueError("Invalid from_email format")
        return v.strip().lower()


class EmailReplyInput(BaseModel):
    """Input model for sending a reply."""

    email: str = Field(..., description="Lead's email address")
    campaign_id: str = Field(..., description="Campaign ID")
    body: str = Field(..., min_length=1, max_length=50000, description="Reply body (HTML)")
    subject: str | None = Field(None, max_length=500, description="Subject (optional)")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        if not validate_email(v):
            raise ValueError("Invalid email format")
        return v.strip().lower()

    @field_validator("campaign_id")
    @classmethod
    def validate_campaign(cls, v: str) -> str:
        if not validate_campaign_id(v):
            raise ValueError("Invalid campaign_id format")
        return v.strip()


# =============================================================================
# Error Types for Classification
# =============================================================================


class InstantlyErrorType(str, Enum):
    """Classification of Instantly errors for handling strategy."""

    # Retriable errors
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    TIMEOUT = "timeout"
    SERVICE_UNAVAILABLE = "service_unavailable"

    # Non-retriable errors
    AUTHENTICATION = "authentication"
    VALIDATION = "validation"
    NOT_FOUND = "not_found"
    PERMISSION_DENIED = "permission_denied"
    CAMPAIGN_NOT_ACTIVE = "campaign_not_active"
    LEAD_EXISTS = "lead_exists"
    ACCOUNT_ERROR = "account_error"
    BAD_REQUEST = "bad_request"
    UNKNOWN = "unknown"

    @classmethod
    def is_retriable(cls, error_type: "InstantlyErrorType") -> bool:
        """Check if an error type should be retried."""
        return error_type in {
            cls.RATE_LIMITED,
            cls.NETWORK_ERROR,
            cls.TIMEOUT,
            cls.SERVICE_UNAVAILABLE,
        }


def classify_http_error(status_code: int, error_message: str = "") -> InstantlyErrorType:
    """Classify HTTP status code into error type.

    Args:
        status_code: HTTP response status code
        error_message: Optional error message for more specific classification

    Returns:
        InstantlyErrorType classification
    """
    error_lower = error_message.lower()

    if status_code == 401:
        return InstantlyErrorType.AUTHENTICATION
    elif status_code == 403:
        return InstantlyErrorType.PERMISSION_DENIED
    elif status_code == 404:
        return InstantlyErrorType.NOT_FOUND
    elif status_code == 409:
        if "already exists" in error_lower or "duplicate" in error_lower:
            return InstantlyErrorType.LEAD_EXISTS
        return InstantlyErrorType.BAD_REQUEST
    elif status_code == 422:
        return InstantlyErrorType.VALIDATION
    elif status_code == 429:
        return InstantlyErrorType.RATE_LIMITED
    elif status_code >= 400 and status_code < 500:
        if "campaign" in error_lower and ("not active" in error_lower or "paused" in error_lower):
            return InstantlyErrorType.CAMPAIGN_NOT_ACTIVE
        if "account" in error_lower:
            return InstantlyErrorType.ACCOUNT_ERROR
        return InstantlyErrorType.BAD_REQUEST
    elif status_code >= 500 and status_code < 600:
        return InstantlyErrorType.SERVICE_UNAVAILABLE
    else:
        return InstantlyErrorType.UNKNOWN


# =============================================================================
# Response Models
# =============================================================================


class Account(BaseModel):
    """Instantly email account."""

    email: str
    status: str | None = None
    warmup_status: str | None = None
    daily_limit: int | None = None
    sent_today: int | None = None


class Campaign(BaseModel):
    """Instantly campaign."""

    id: str
    name: str
    status: str | None = None
    from_emails: list[str] | None = None
    lead_count: int | None = None
    created_at: str | None = None


class Lead(BaseModel):
    """Instantly lead."""

    email: str
    first_name: str | None = None
    last_name: str | None = None
    company_name: str | None = None
    status: str | None = None
    campaign_id: str | None = None
    last_contacted_at: str | None = None


class EmailThread(BaseModel):
    """Email conversation thread."""

    email: str
    campaign_id: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    message_count: int = 0


class AnalyticsData(BaseModel):
    """Analytics data."""

    sent: int = 0
    opened: int = 0
    clicked: int = 0
    replied: int = 0
    bounced: int = 0
    unsubscribed: int = 0


class BackgroundJob(BaseModel):
    """Background job status."""

    id: str
    status: str
    type: str | None = None
    progress: int | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
