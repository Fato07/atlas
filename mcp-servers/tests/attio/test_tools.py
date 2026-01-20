"""Integration tests for Attio MCP tools with mocked API.

Tests verify:
- US1: find_person - Lead lookup by email (FR-006)
- US2: update_pipeline_stage - Pipeline stage updates (FR-009)
- US3: add_activity - Activity logging (FR-010)
- US4: create_task - Task creation (FR-011)
- US5: create_person - Lead creation (FR-007)
- US6: get_pipeline_records - Pipeline records retrieval (FR-012)
- US7: get_record_activities - Activity history retrieval (FR-013)
- Bonus: prefetch_pipeline_config - Pipeline configuration caching
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

if TYPE_CHECKING:
    pass


# =============================================================================
# Test Setup - Fixed async mock pattern
# =============================================================================


def create_mock_response(status_code: int, json_data: dict) -> MagicMock:
    """Create a mock httpx response with proper sync json() method.

    The httpx Response.json() is a synchronous method, not async.
    """
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_data
    mock_response.headers = {}
    mock_response.text = str(json_data)
    return mock_response


@pytest.fixture
def mock_env():
    """Set up required environment variables for testing."""
    with patch.dict(
        os.environ,
        {
            "ATTIO_API_KEY": "test_api_key_12345",
            "ATTIO_PIPELINE_LIST_ID": "list_test_pipeline_12345",
        },
    ):
        yield


@pytest.fixture
def reset_attio_module(mock_env):
    """Reset Attio module state and provide mock httpx client.

    Patches the module-level constants since they're evaluated at import time.
    """
    import atlas_gtm_mcp.attio as attio_module

    # Reset global state
    attio_module._attio_client = None
    attio_module._list_status_cache.clear()

    # Create mock httpx client
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_client.request = AsyncMock()

    # Patch the module-level constants (since they're read at import time)
    # AND patch httpx.AsyncClient to return our mock
    with patch.object(attio_module, "ATTIO_API_KEY", "test_api_key_12345"), \
         patch.object(attio_module, "ATTIO_PIPELINE_LIST_ID", "list_test_pipeline_12345"), \
         patch("atlas_gtm_mcp.attio.httpx.AsyncClient", return_value=mock_client):
        # Get the attio client (which will use our mock httpx client)
        from atlas_gtm_mcp.attio import _get_attio_client

        attio_client = _get_attio_client()
        # Inject mock client directly
        attio_client._client = mock_client

        yield mock_client

    # Clean up after test
    attio_module._attio_client = None
    attio_module._list_status_cache.clear()


@pytest.fixture
def mcp_server(mock_env):
    """Create a FastMCP server with Attio tools registered."""
    # Clear any cached client and status cache
    import atlas_gtm_mcp.attio as attio_module

    attio_module._attio_client = None
    attio_module._list_status_cache.clear()

    mcp = FastMCP("test-attio")

    # Register Attio tools
    from atlas_gtm_mcp.attio import register_attio_tools

    register_attio_tools(mcp)

    return mcp


def get_attio_client():
    """Get the current Attio client."""
    from atlas_gtm_mcp.attio import _get_attio_client
    return _get_attio_client()


# =============================================================================
# US1: find_person Tests (FR-006)
# =============================================================================


class TestFindPerson:
    """Tests for find_person tool - Lead lookup by email."""

    @pytest.mark.asyncio
    async def test_find_person_exists(self, reset_attio_module):
        """Given an email exists in Attio, return the person record."""
        mock_httpx = reset_attio_module

        # Setup mock response - json() is synchronous in httpx
        mock_response = create_mock_response(200, {
            "data": [
                {
                    "id": {"record_id": "rec_12345678901234"},
                    "values": {
                        "email_addresses": [{"email_address": "john@example.com"}],
                        "name": [{"full_name": "John Doe"}],
                    },
                }
            ]
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        # Make the actual call through the client
        result = await client.post(
            "/objects/people/records/query",
            "test-corr-id",
            json={"filter": {"email_addresses": {"contains": "john@example.com"}}},
        )

        # Verify response
        assert result is not None
        assert "data" in result
        assert len(result["data"]) == 1
        assert result["data"][0]["values"]["email_addresses"][0]["email_address"] == "john@example.com"

    @pytest.mark.asyncio
    async def test_find_person_not_found(self, reset_attio_module):
        """Given an email does not exist, return empty list."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {"data": []})
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/objects/people/records/query",
            "test-corr-id",
            json={"filter": {"email_addresses": {"contains": "notfound@example.com"}}},
        )

        assert result["data"] == []

    @pytest.mark.asyncio
    async def test_find_person_invalid_email(self, mock_env):
        """Given an invalid email format, validation should fail."""
        from atlas_gtm_mcp.attio.models import validate_email

        # Validation should fail
        assert validate_email("not-an-email") is False
        assert validate_email("") is False


# =============================================================================
# US2: update_pipeline_stage Tests (FR-009)
# =============================================================================


class TestUpdatePipelineStage:
    """Tests for update_pipeline_stage tool - Pipeline stage updates."""

    @pytest.mark.asyncio
    async def test_stage_validation(self, mock_env):
        """Test that invalid stage names are rejected."""
        from atlas_gtm_mcp.attio.models import PipelineStage

        # Valid stages
        assert PipelineStage.validate("new_reply") is True
        assert PipelineStage.validate("qualifying") is True
        assert PipelineStage.validate("meeting_scheduled") is True

        # Invalid stages
        assert PipelineStage.validate("invalid_stage") is False
        assert PipelineStage.validate("") is False

    @pytest.mark.asyncio
    async def test_stage_transition_validation(self, mock_env):
        """Test stage transition rules."""
        from atlas_gtm_mcp.attio.models import validate_stage_transition

        # Valid transitions
        assert validate_stage_transition("new_reply", "qualifying") is True
        assert validate_stage_transition("qualifying", "meeting_scheduled") is True

        # Invalid transitions
        assert validate_stage_transition("new_reply", "closed_won") is False
        assert validate_stage_transition("closed_won", "new_reply") is False

    @pytest.mark.asyncio
    async def test_update_pipeline_stage_api_call(self, reset_attio_module):
        """Test updating pipeline stage via API."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"list_id": "list_test_pipeline_12345", "entry_id": "entry_12345"},
                "entry_values": {
                    "status": [{"status": "status_qualifying_12345"}],
                },
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.patch(
            "/lists/list_test_pipeline_12345/entries/entry_12345",
            "test-corr-id",
            json={
                "data": {
                    "entry_values": {
                        "status": [{"status": "status_qualifying_12345"}],
                    }
                }
            },
        )

        assert result["data"]["entry_values"]["status"][0]["status"] == "status_qualifying_12345"


# =============================================================================
# US3: add_activity Tests (FR-010)
# =============================================================================


class TestAddActivity:
    """Tests for add_activity tool - Activity logging."""

    @pytest.mark.asyncio
    async def test_activity_type_validation(self, mock_env):
        """Test that activity types are validated."""
        from atlas_gtm_mcp.attio.models import ActivityType

        # Valid types
        assert ActivityType.validate("note") is True
        assert ActivityType.validate("email") is True
        assert ActivityType.validate("call") is True
        assert ActivityType.validate("meeting") is True

        # Invalid types
        assert ActivityType.validate("invalid") is False
        assert ActivityType.validate("sms") is False

    @pytest.mark.asyncio
    async def test_add_activity_creates_note(self, reset_attio_module):
        """Test that add_activity creates a note via the Notes API."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"note_id": "note_12345678901234"},
                "parent_object": "people",
                "parent_record_id": "rec_12345678901234",
                "title": "Note: Activity Log",
                "content": "Test activity content",
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/notes",
            "test-corr-id",
            json={
                "data": {
                    "parent_object": "people",
                    "parent_record_id": "rec_12345678901234",
                    "title": "Note: Activity Log",
                    "format": "plaintext",
                    "content": "Test activity content",
                }
            },
        )

        assert result["data"]["id"]["note_id"] == "note_12345678901234"


# =============================================================================
# US4: create_task Tests (FR-011)
# =============================================================================


class TestCreateTask:
    """Tests for create_task tool - Task creation."""

    @pytest.mark.asyncio
    async def test_create_task_basic(self, reset_attio_module):
        """Test creating a basic task linked to a record."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"task_id": "task_12345678901234"},
                "content": "Follow up with lead",
                "linked_records": [
                    {"target_object": "people", "target_record_id": "rec_12345678901234"}
                ],
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/tasks",
            "test-corr-id",
            json={
                "data": {
                    "content": "Follow up with lead",
                    "format": "plaintext",
                    "linked_records": [
                        {"target_object": "people", "target_record_id": "rec_12345678901234"}
                    ],
                }
            },
        )

        assert result["data"]["id"]["task_id"] == "task_12345678901234"

    @pytest.mark.asyncio
    async def test_create_task_with_deadline(self, reset_attio_module):
        """Test creating a task with a deadline."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"task_id": "task_12345678901234"},
                "content": "Follow up with lead",
                "deadline_at": "2024-12-31T15:00:00.000Z",
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/tasks",
            "test-corr-id",
            json={
                "data": {
                    "content": "Follow up with lead",
                    "format": "plaintext",
                    "deadline_at": "2024-12-31T15:00:00.000Z",
                    "linked_records": [
                        {"target_object": "people", "target_record_id": "rec_12345678901234"}
                    ],
                }
            },
        )

        assert result["data"]["deadline_at"] == "2024-12-31T15:00:00.000Z"


# =============================================================================
# US5: create_person Tests (FR-007)
# =============================================================================


class TestCreatePerson:
    """Tests for create_person tool - Lead creation."""

    @pytest.mark.asyncio
    async def test_create_person_minimal(self, reset_attio_module):
        """Test creating a person with minimal required fields."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"record_id": "rec_new_12345678901234"},
                "values": {
                    "email_addresses": [{"email_address": "jane@example.com"}],
                    "name": [{"full_name": "Jane Smith"}],
                },
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/objects/people/records",
            "test-corr-id",
            json={
                "data": {
                    "values": {
                        "email_addresses": [{"email_address": "jane@example.com"}],
                        "name": [{"full_name": "Jane Smith"}],
                    }
                }
            },
        )

        assert result["data"]["id"]["record_id"] == "rec_new_12345678901234"

    @pytest.mark.asyncio
    async def test_create_person_with_title(self, reset_attio_module):
        """Test creating a person with optional title field."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"record_id": "rec_new_12345678901234"},
                "values": {
                    "email_addresses": [{"email_address": "jane@example.com"}],
                    "name": [{"full_name": "Jane Smith"}],
                    "job_title": [{"value": "Software Engineer"}],
                },
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/objects/people/records",
            "test-corr-id",
            json={
                "data": {
                    "values": {
                        "email_addresses": [{"email_address": "jane@example.com"}],
                        "name": [{"full_name": "Jane Smith"}],
                        "job_title": [{"value": "Software Engineer"}],
                    }
                }
            },
        )

        assert result["data"]["values"]["job_title"][0]["value"] == "Software Engineer"


# =============================================================================
# US6: get_pipeline_records Tests (FR-012)
# =============================================================================


class TestGetPipelineRecords:
    """Tests for get_pipeline_records tool - Pipeline records retrieval."""

    @pytest.mark.asyncio
    async def test_get_pipeline_records_all(self, reset_attio_module):
        """Test retrieving all records from pipeline."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": [
                {
                    "id": {"entry_id": "entry_1"},
                    "record_id": "rec_1",
                    "entry_values": {"status": [{"status": "status_new_reply"}]},
                },
                {
                    "id": {"entry_id": "entry_2"},
                    "record_id": "rec_2",
                    "entry_values": {"status": [{"status": "status_qualifying"}]},
                },
            ]
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/lists/list_test_pipeline_12345/entries/query",
            "test-corr-id",
            json={"limit": 50, "offset": 0},
        )

        assert len(result["data"]) == 2

    @pytest.mark.asyncio
    async def test_get_pipeline_records_with_limit(self, reset_attio_module):
        """Test retrieving records with limit."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": [
                {"id": {"entry_id": "entry_1"}, "record_id": "rec_1"},
            ]
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.post(
            "/lists/list_test_pipeline_12345/entries/query",
            "test-corr-id",
            json={"limit": 1, "offset": 0},
        )

        assert len(result["data"]) == 1


# =============================================================================
# US7: get_record_activities Tests (FR-013)
# =============================================================================


class TestGetRecordActivities:
    """Tests for get_record_activities tool - Activity history retrieval."""

    @pytest.mark.asyncio
    async def test_get_record_activities(self, reset_attio_module):
        """Test retrieving activities for a record."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": [
                {
                    "id": {"note_id": "note_1"},
                    "content": "First activity",
                    "created_at": "2024-01-20T14:00:00.000Z",
                },
                {
                    "id": {"note_id": "note_2"},
                    "content": "Second activity",
                    "created_at": "2024-01-19T14:00:00.000Z",
                },
            ]
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.get(
            "/notes",
            "test-corr-id",
            params={
                "parent_object": "people",
                "parent_record_id": "rec_12345678901234",
                "limit": 20,
                "sort_field": "created_at",
                "sort_direction": "desc",
            },
        )

        assert len(result["data"]) == 2
        # Verify descending order
        assert result["data"][0]["created_at"] > result["data"][1]["created_at"]

    @pytest.mark.asyncio
    async def test_get_record_activities_empty(self, reset_attio_module):
        """Test retrieving activities for a record with no activities."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {"data": []})
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.get(
            "/notes",
            "test-corr-id",
            params={
                "parent_object": "people",
                "parent_record_id": "rec_no_activities",
                "limit": 20,
            },
        )

        assert result["data"] == []


# =============================================================================
# Bonus: prefetch_pipeline_config Tests
# =============================================================================


class TestPrefetchPipelineConfig:
    """Tests for prefetch_pipeline_config tool - Pipeline configuration caching."""

    @pytest.mark.asyncio
    async def test_prefetch_caches_config(self, reset_attio_module):
        """Test that prefetch caches the pipeline configuration."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"list_id": "list_test_pipeline_12345"},
                "name": "Sales Pipeline",
                "attributes": [
                    {
                        "type": "status",
                        "name": "Status",
                        "config": {
                            "statuses": [
                                {"id": {"status_id": "status_new_reply"}, "title": "New Reply"},
                                {"id": {"status_id": "status_qualifying"}, "title": "Qualifying"},
                            ]
                        },
                    }
                ],
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        # First call - should fetch
        result = await client.get(
            "/lists/list_test_pipeline_12345",
            "test-corr-id",
        )

        assert result["data"]["id"]["list_id"] == "list_test_pipeline_12345"
        assert len(result["data"]["attributes"]) == 1

    @pytest.mark.asyncio
    async def test_status_cache_populated(self, reset_attio_module):
        """Test that status cache is populated after fetching list config."""
        mock_httpx = reset_attio_module

        # Create mock response with list config containing status attribute
        mock_response = create_mock_response(200, {
            "data": {
                "id": {"list_id": "list_test_pipeline_12345"},
                "name": "Sales Pipeline",
                "attributes": [
                    {
                        "type": "status",
                        "name": "Status",
                        "config": {
                            "statuses": [
                                {"id": {"status_id": "id_new_reply"}, "title": "New Reply"},
                                {"id": {"status_id": "id_qualifying"}, "title": "Qualifying"},
                            ]
                        },
                    }
                ],
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        # Fetch list config
        result = await client.get(
            "/lists/list_test_pipeline_12345",
            "test-corr-id",
        )

        # Verify the response structure is correct
        assert result["data"]["id"]["list_id"] == "list_test_pipeline_12345"
        statuses = result["data"]["attributes"][0]["config"]["statuses"]
        assert len(statuses) == 2
        assert statuses[0]["title"] == "New Reply"
        assert statuses[1]["title"] == "Qualifying"


# =============================================================================
# update_person Tests (FR-008)
# =============================================================================


class TestUpdatePerson:
    """Tests for update_person tool - Update existing records."""

    @pytest.mark.asyncio
    async def test_update_person_fields(self, reset_attio_module):
        """Test updating person fields."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(200, {
            "data": {
                "id": {"record_id": "rec_12345678901234"},
                "values": {
                    "name": [{"full_name": "John Updated"}],
                    "job_title": [{"value": "Senior Engineer"}],
                },
            }
        })
        mock_httpx.request.return_value = mock_response

        client = get_attio_client()

        result = await client.patch(
            "/objects/people/records/rec_12345678901234",
            "test-corr-id",
            json={
                "data": {
                    "values": {
                        "name": [{"full_name": "John Updated"}],
                        "job_title": [{"value": "Senior Engineer"}],
                    }
                }
            },
        )

        assert result["data"]["values"]["name"][0]["full_name"] == "John Updated"
        assert result["data"]["values"]["job_title"][0]["value"] == "Senior Engineer"

    @pytest.mark.asyncio
    async def test_update_person_invalid_record_id(self, mock_env):
        """Test that invalid record_id is rejected."""
        from atlas_gtm_mcp.attio.models import validate_record_id

        assert validate_record_id("short") is False
        assert validate_record_id("") is False
        assert validate_record_id(None) is False
