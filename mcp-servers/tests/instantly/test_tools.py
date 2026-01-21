"""Integration tests for Instantly MCP tools with mocked API.

Tests verify:
- Campaign tools (list, get, create, update, launch, pause, analytics, sequence)
- Lead tools (list, get, add, bulk add, update, move, status, pause, resume)
- Email tools (thread, reply, recent_replies, inbox, mark_as_read/replied, analytics, schedule)
- Account tools (list, get, status, update, pause, resume)
- Analytics tools (account, campaign, daily, inbox stats)
- Job tools (status, list, cancel)
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

if TYPE_CHECKING:
    pass

from .conftest import create_mock_response


# =============================================================================
# Test Setup
# =============================================================================


@pytest.fixture
def mock_env():
    """Set up required environment variables for testing."""
    with patch.dict(
        os.environ,
        {
            "INSTANTLY_API_KEY": "test_api_key_12345",
        },
    ):
        yield


@pytest.fixture
def reset_instantly_module(mock_env):
    """Reset Instantly module state and provide mock httpx client."""
    import atlas_gtm_mcp.instantly.client as client_module

    # Reset global state
    client_module._instantly_client = None

    # Create mock httpx client
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_client.request = AsyncMock()

    with patch.object(client_module, "INSTANTLY_API_KEY", "test_api_key_12345"), \
         patch("atlas_gtm_mcp.instantly.client.httpx.AsyncClient", return_value=mock_client):
        from atlas_gtm_mcp.instantly.client import get_instantly_client

        instantly_client = get_instantly_client()
        instantly_client._client = mock_client

        yield mock_client

    # Clean up after test
    client_module._instantly_client = None


def get_instantly_client():
    """Get the current Instantly client."""
    from atlas_gtm_mcp.instantly.client import get_instantly_client as _get_client
    return _get_client()


# =============================================================================
# Campaign Tools Tests
# =============================================================================


class TestListCampaigns:
    """Tests for list_campaigns tool."""

    @pytest.mark.asyncio
    async def test_list_campaigns_success(self, reset_instantly_module):
        """Given campaigns exist, return paginated list."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "items": [
                {"id": "camp_123", "name": "Test Campaign", "status": "ACTIVE"},
                {"id": "camp_456", "name": "Other Campaign", "status": "PAUSED"},
            ],
            "total": 2,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/campaigns", "test-corr-id", params={"limit": 100, "skip": 0})

        assert result is not None
        assert "items" in result
        assert len(result["items"]) == 2

    @pytest.mark.asyncio
    async def test_list_campaigns_with_status_filter(self, reset_instantly_module):
        """Given status filter, return only matching campaigns."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "items": [{"id": "camp_123", "name": "Active Campaign", "status": "ACTIVE"}],
            "total": 1,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get(
            "/campaigns",
            "test-corr-id",
            params={"status": "ACTIVE", "limit": 100, "skip": 0}
        )

        assert len(result["items"]) == 1
        assert result["items"][0]["status"] == "ACTIVE"

    @pytest.mark.asyncio
    async def test_list_campaigns_empty(self, reset_instantly_module):
        """Given no campaigns, return empty list."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {"items": [], "total": 0})
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/campaigns", "test-corr-id", params={"limit": 100, "skip": 0})

        assert result["items"] == []


class TestGetCampaign:
    """Tests for get_campaign tool."""

    @pytest.mark.asyncio
    async def test_get_campaign_success(self, reset_instantly_module):
        """Given valid campaign ID, return campaign details."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "camp_123",
            "name": "Test Campaign",
            "status": "ACTIVE",
            "leads_count": 150,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/campaigns/camp_123", "test-corr-id")

        assert result["id"] == "camp_123"
        assert result["name"] == "Test Campaign"

    @pytest.mark.asyncio
    async def test_get_campaign_not_found(self, reset_instantly_module):
        """Given invalid campaign ID, raise error."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(404, {"error": {"message": "Campaign not found"}})
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.instantly.client import InstantlyNonRetriableError

        client = get_instantly_client()
        with pytest.raises(InstantlyNonRetriableError):
            await client.get("/campaigns/invalid_id", "test-corr-id")


class TestCreateCampaign:
    """Tests for create_campaign tool."""

    @pytest.mark.asyncio
    async def test_create_campaign_success(self, reset_instantly_module):
        """Given valid parameters, create campaign."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "camp_new_123",
            "name": "New Campaign",
            "status": "DRAFT",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post(
            "/campaigns",
            "test-corr-id",
            json={"name": "New Campaign"},
        )

        assert result["id"] == "camp_new_123"
        assert result["status"] == "DRAFT"


class TestCampaignControls:
    """Tests for launch_campaign and pause_campaign tools."""

    @pytest.mark.asyncio
    async def test_launch_campaign_success(self, reset_instantly_module):
        """Given draft campaign, launch it."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "camp_123",
            "status": "ACTIVE",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post("/campaigns/camp_123/launch", "test-corr-id")

        assert result["status"] == "ACTIVE"

    @pytest.mark.asyncio
    async def test_pause_campaign_success(self, reset_instantly_module):
        """Given active campaign, pause it."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "camp_123",
            "status": "PAUSED",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post("/campaigns/camp_123/pause", "test-corr-id")

        assert result["status"] == "PAUSED"


# =============================================================================
# Lead Tools Tests
# =============================================================================


class TestListLeads:
    """Tests for list_leads tool."""

    @pytest.mark.asyncio
    async def test_list_leads_success(self, reset_instantly_module):
        """Given leads exist, return paginated list."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "items": [
                {"email": "john@example.com", "status": "CONTACTED"},
                {"email": "jane@example.com", "status": "REPLIED"},
            ],
            "total": 2,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get(
            "/leads",
            "test-corr-id",
            params={"campaign_id": "camp_123", "limit": 100, "skip": 0}
        )

        assert len(result["items"]) == 2


class TestGetLead:
    """Tests for get_lead tool."""

    @pytest.mark.asyncio
    async def test_get_lead_by_email(self, reset_instantly_module):
        """Given valid email, return lead details."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "email": "john@example.com",
            "first_name": "John",
            "last_name": "Doe",
            "status": "CONTACTED",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get(
            "/leads/john@example.com",
            "test-corr-id",
            params={"campaign_id": "camp_123"}
        )

        assert result["email"] == "john@example.com"


class TestAddLead:
    """Tests for add_lead tool."""

    @pytest.mark.asyncio
    async def test_add_lead_success(self, reset_instantly_module):
        """Given valid lead data, add to campaign."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "email": "newlead@example.com",
            "status": "NEW",
            "campaign_id": "camp_123",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post(
            "/leads",
            "test-corr-id",
            json={
                "campaign_id": "camp_123",
                "email": "newlead@example.com",
                "first_name": "New",
                "last_name": "Lead",
            }
        )

        assert result["email"] == "newlead@example.com"


class TestAddLeadsBulk:
    """Tests for add_leads_bulk tool."""

    @pytest.mark.asyncio
    async def test_add_leads_bulk_success(self, reset_instantly_module):
        """Given valid bulk lead data, add all to campaign."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "success": 10,
            "failed": 0,
            "total": 10,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post(
            "/leads/bulk",
            "test-corr-id",
            json={
                "campaign_id": "camp_123",
                "leads": [{"email": f"lead{i}@example.com"} for i in range(10)],
            }
        )

        assert result["success"] == 10
        assert result["failed"] == 0


class TestLeadStatusOperations:
    """Tests for lead status tools."""

    @pytest.mark.asyncio
    async def test_update_lead_status_success(self, reset_instantly_module):
        """Given valid lead, update status."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "email": "john@example.com",
            "status": "INTERESTED",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.patch(
            "/leads/john@example.com/status",
            "test-corr-id",
            json={"campaign_id": "camp_123", "status": "INTERESTED"}
        )

        assert result["status"] == "INTERESTED"

    @pytest.mark.asyncio
    async def test_pause_lead_success(self, reset_instantly_module):
        """Given active lead, pause sequence."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {"paused": True})
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post(
            "/leads/john@example.com/pause",
            "test-corr-id",
            json={"campaign_id": "camp_123"}
        )

        assert result["paused"] is True


# =============================================================================
# Email Tools Tests
# =============================================================================


class TestGetEmailThread:
    """Tests for get_email_thread tool."""

    @pytest.mark.asyncio
    async def test_get_email_thread_success(self, reset_instantly_module):
        """Given valid thread ID, return conversation."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "thread_id": "thread_123",
            "lead_email": "john@example.com",
            "messages": [
                {"id": "msg_1", "type": "outbound", "body": "Hello"},
                {"id": "msg_2", "type": "inbound", "body": "Hi there"},
            ],
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/threads/thread_123", "test-corr-id")

        assert len(result["messages"]) == 2


class TestSendReply:
    """Tests for send_reply tool."""

    @pytest.mark.asyncio
    async def test_send_reply_success(self, reset_instantly_module):
        """Given valid thread, send reply."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "msg_new",
            "thread_id": "thread_123",
            "status": "QUEUED",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post(
            "/threads/thread_123/reply",
            "test-corr-id",
            json={"body": "Thank you for your response!"}
        )

        assert result["status"] == "QUEUED"


# =============================================================================
# Account Tools Tests
# =============================================================================


class TestListAccounts:
    """Tests for list_accounts tool."""

    @pytest.mark.asyncio
    async def test_list_accounts_success(self, reset_instantly_module):
        """Given accounts exist, return list."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "items": [
                {"id": "acc_123", "email": "sender@company.com", "status": "ACTIVE"},
                {"id": "acc_456", "email": "sales@company.com", "status": "WARMING"},
            ],
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/accounts", "test-corr-id")

        assert len(result["items"]) == 2


class TestGetAccountStatus:
    """Tests for get_account_status tool."""

    @pytest.mark.asyncio
    async def test_get_account_status_success(self, reset_instantly_module):
        """Given valid account, return status details."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "acc_123",
            "status": "ACTIVE",
            "warmup_status": "COMPLETED",
            "daily_limit": 50,
            "sent_today": 23,
            "health_score": 95,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/accounts/acc_123/status", "test-corr-id")

        assert result["health_score"] == 95


# =============================================================================
# Analytics Tools Tests
# =============================================================================


class TestGetCampaignAnalytics:
    """Tests for get_campaign_analytics tool."""

    @pytest.mark.asyncio
    async def test_get_campaign_analytics_success(self, reset_instantly_module):
        """Given valid campaign, return analytics."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "campaign_id": "camp_123",
            "emails_sent": 500,
            "emails_opened": 275,
            "replies": 45,
            "open_rate": 55.0,
            "reply_rate": 9.0,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/campaigns/camp_123/analytics", "test-corr-id")

        assert result["open_rate"] == 55.0
        assert result["reply_rate"] == 9.0


class TestGetDailyStats:
    """Tests for get_daily_stats tool."""

    @pytest.mark.asyncio
    async def test_get_daily_stats_success(self, reset_instantly_module):
        """Given date range, return daily breakdown."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "stats": [
                {"date": "2024-01-15", "sent": 50, "opened": 25, "replied": 5},
                {"date": "2024-01-16", "sent": 48, "opened": 30, "replied": 8},
            ],
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get(
            "/analytics/daily",
            "test-corr-id",
            params={"start_date": "2024-01-15", "end_date": "2024-01-16"}
        )

        assert len(result["stats"]) == 2


# =============================================================================
# Job Tools Tests
# =============================================================================


class TestGetJobStatus:
    """Tests for get_job_status tool."""

    @pytest.mark.asyncio
    async def test_get_job_status_success(self, reset_instantly_module):
        """Given valid job ID, return status."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "job_123",
            "type": "BULK_LEAD_IMPORT",
            "status": "COMPLETED",
            "progress": 100,
            "total_items": 100,
            "processed_items": 100,
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.get("/jobs/job_123", "test-corr-id")

        assert result["status"] == "COMPLETED"
        assert result["progress"] == 100


class TestCancelJob:
    """Tests for cancel_job tool."""

    @pytest.mark.asyncio
    async def test_cancel_job_success(self, reset_instantly_module):
        """Given pending job, cancel it."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(200, {
            "id": "job_123",
            "status": "CANCELLED",
        })
        mock_httpx.request.return_value = mock_response

        client = get_instantly_client()
        result = await client.post("/jobs/job_123/cancel", "test-corr-id")

        assert result["status"] == "CANCELLED"


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for error handling across tools."""

    @pytest.mark.asyncio
    async def test_rate_limit_error_is_retriable(self, reset_instantly_module):
        """Given 429 response, raise retriable error."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(429, {"error": {"message": "Rate limit exceeded"}})
        mock_response.headers = {"Retry-After": "60"}
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.instantly.client import InstantlyRetriableError

        client = get_instantly_client()
        with pytest.raises(InstantlyRetriableError):
            await client.get("/campaigns", "test-corr-id")

    @pytest.mark.asyncio
    async def test_auth_error_is_non_retriable(self, reset_instantly_module):
        """Given 401 response, raise non-retriable error."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(401, {"error": {"message": "Invalid API key"}})
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.instantly.client import InstantlyNonRetriableError

        client = get_instantly_client()
        with pytest.raises(InstantlyNonRetriableError):
            await client.get("/campaigns", "test-corr-id")

    @pytest.mark.asyncio
    async def test_server_error_is_retriable(self, reset_instantly_module):
        """Given 5xx response, raise retriable error."""
        mock_httpx = reset_instantly_module

        mock_response = create_mock_response(500, {"error": {"message": "Internal error"}})
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.instantly.client import InstantlyRetriableError

        client = get_instantly_client()
        with pytest.raises(InstantlyRetriableError):
            await client.get("/campaigns", "test-corr-id")
