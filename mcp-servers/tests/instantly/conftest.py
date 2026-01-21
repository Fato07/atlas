"""Pytest fixtures for Instantly MCP tool tests.

Provides:
- Mock Instantly API server with httpx-mock
- Sample data fixtures for campaigns, leads, emails, accounts
- Client fixtures with test configuration
- Environment variable management
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any
from unittest.mock import MagicMock, patch

import pytest

if TYPE_CHECKING:
    from collections.abc import Generator


# =============================================================================
# Environment Fixtures
# =============================================================================


@pytest.fixture
def env_api_key() -> Generator[str, None, None]:
    """Provide a test API key via environment variable."""
    test_key = "test_instantly_api_key_12345"
    with patch.dict(os.environ, {"INSTANTLY_API_KEY": test_key}):
        yield test_key


@pytest.fixture
def env_vars(env_api_key: str) -> Generator[dict[str, str], None, None]:
    """Provide all required environment variables."""
    yield {"INSTANTLY_API_KEY": env_api_key}


# =============================================================================
# Sample Data Fixtures
# =============================================================================


@pytest.fixture
def sample_campaign() -> dict[str, Any]:
    """Sample campaign record from Instantly API."""
    return {
        "id": "camp_12345678901234567890",
        "name": "Q1 Outreach Campaign",
        "status": "ACTIVE",
        "created_at": "2024-01-15T10:30:00.000Z",
        "account_ids": ["acc_sender_12345"],
        "leads_count": 150,
        "emails_sent": 75,
        "emails_opened": 45,
        "replies": 12,
    }


@pytest.fixture
def sample_campaign_list() -> dict[str, Any]:
    """Sample list of campaigns response."""
    return {
        "items": [
            {
                "id": "camp_12345678901234567890",
                "name": "Q1 Outreach Campaign",
                "status": "ACTIVE",
                "leads_count": 150,
            },
            {
                "id": "camp_22345678901234567891",
                "name": "Product Launch",
                "status": "PAUSED",
                "leads_count": 300,
            },
        ],
        "total": 2,
        "skip": 0,
        "limit": 100,
    }


@pytest.fixture
def sample_lead() -> dict[str, Any]:
    """Sample lead record from Instantly API."""
    return {
        "email": "john.doe@example.com",
        "first_name": "John",
        "last_name": "Doe",
        "company": "Example Corp",
        "title": "VP of Engineering",
        "campaign_id": "camp_12345678901234567890",
        "status": "CONTACTED",
        "custom_variables": {"industry": "Technology"},
        "created_at": "2024-01-16T09:00:00.000Z",
    }


@pytest.fixture
def sample_lead_list() -> dict[str, Any]:
    """Sample list of leads response."""
    return {
        "items": [
            {
                "email": "john.doe@example.com",
                "first_name": "John",
                "last_name": "Doe",
                "status": "CONTACTED",
            },
            {
                "email": "jane.smith@example.com",
                "first_name": "Jane",
                "last_name": "Smith",
                "status": "REPLIED",
            },
        ],
        "total": 2,
    }


@pytest.fixture
def sample_email_thread() -> dict[str, Any]:
    """Sample email thread from Instantly API."""
    return {
        "thread_id": "thread_12345678901234567890",
        "lead_email": "john.doe@example.com",
        "campaign_id": "camp_12345678901234567890",
        "messages": [
            {
                "id": "msg_001",
                "from": "sender@company.com",
                "to": "john.doe@example.com",
                "subject": "Introducing our solution",
                "body": "Hi John, I wanted to reach out...",
                "sent_at": "2024-01-16T10:00:00.000Z",
                "type": "outbound",
            },
            {
                "id": "msg_002",
                "from": "john.doe@example.com",
                "to": "sender@company.com",
                "subject": "Re: Introducing our solution",
                "body": "Thanks for reaching out. I'd love to learn more...",
                "sent_at": "2024-01-16T14:30:00.000Z",
                "type": "inbound",
            },
        ],
    }


@pytest.fixture
def sample_account() -> dict[str, Any]:
    """Sample sending account from Instantly API."""
    return {
        "id": "acc_sender_12345",
        "email": "sender@company.com",
        "name": "Sales Sender Account",
        "status": "ACTIVE",
        "warmup_status": "COMPLETED",
        "daily_limit": 50,
        "sent_today": 23,
        "health_score": 95,
        "created_at": "2024-01-01T00:00:00.000Z",
    }


@pytest.fixture
def sample_account_list() -> dict[str, Any]:
    """Sample list of accounts response."""
    return {
        "items": [
            {
                "id": "acc_sender_12345",
                "email": "sender@company.com",
                "status": "ACTIVE",
                "warmup_status": "COMPLETED",
            },
            {
                "id": "acc_sender_67890",
                "email": "sales@company.com",
                "status": "WARMING",
                "warmup_status": "IN_PROGRESS",
            },
        ],
        "total": 2,
    }


@pytest.fixture
def sample_analytics() -> dict[str, Any]:
    """Sample analytics data from Instantly API."""
    return {
        "campaign_id": "camp_12345678901234567890",
        "period": {"start": "2024-01-01", "end": "2024-01-31"},
        "emails_sent": 500,
        "emails_opened": 275,
        "unique_opens": 200,
        "clicks": 85,
        "replies": 45,
        "bounces": 12,
        "unsubscribes": 3,
        "open_rate": 55.0,
        "reply_rate": 9.0,
        "bounce_rate": 2.4,
    }


@pytest.fixture
def sample_job() -> dict[str, Any]:
    """Sample background job from Instantly API."""
    return {
        "id": "job_12345678901234567890",
        "type": "BULK_LEAD_IMPORT",
        "status": "COMPLETED",
        "progress": 100,
        "total_items": 100,
        "processed_items": 100,
        "failed_items": 2,
        "created_at": "2024-01-20T10:00:00.000Z",
        "completed_at": "2024-01-20T10:05:00.000Z",
    }


# =============================================================================
# Mock Response Builders
# =============================================================================


def create_mock_response(status_code: int, json_data: dict) -> MagicMock:
    """Create a mock httpx response with proper sync json() method."""
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_data
    mock_response.headers = {}
    mock_response.text = str(json_data)
    mock_response.request = MagicMock()
    mock_response.request.method = "GET"
    mock_response.request.url = MagicMock()
    mock_response.request.url.path = "/test"
    return mock_response


def make_instantly_response(data: Any) -> dict[str, Any]:
    """Build a standard Instantly API response wrapper."""
    return data


def make_instantly_list_response(items: list[Any], total: int = None) -> dict[str, Any]:
    """Build a standard Instantly API list response."""
    return {
        "items": items,
        "total": total if total is not None else len(items),
    }


def make_instantly_error_response(
    message: str,
    status_code: int = 400,
    error_code: str | None = None
) -> dict[str, Any]:
    """Build an Instantly API error response."""
    error: dict[str, Any] = {"message": message}
    if error_code:
        error["code"] = error_code
    return {"error": error}


# =============================================================================
# Client Fixture with Cache Cleanup
# =============================================================================


@pytest.fixture
def reset_instantly_client(env_api_key) -> Generator[None, None, None]:
    """Reset the global Instantly client between tests."""
    import atlas_gtm_mcp.instantly.client as client_module

    # Save and clear existing client
    old_client = client_module._instantly_client
    client_module._instantly_client = None

    yield

    # Restore (or leave as None)
    client_module._instantly_client = old_client
