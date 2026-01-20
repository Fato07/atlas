"""Pytest fixtures for Attio MCP tool tests.

Provides:
- Mock Attio API server with httpx-mock
- Sample data fixtures for people, activities, tasks
- Client fixtures with test configuration
- Environment variable management
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any
from unittest.mock import patch

import pytest
from httpx import Response

if TYPE_CHECKING:
    from collections.abc import Generator

# =============================================================================
# Environment Fixtures
# =============================================================================


@pytest.fixture
def env_api_key() -> Generator[str, None, None]:
    """Provide a test API key via environment variable."""
    test_key = "test_attio_api_key_12345"
    with patch.dict(os.environ, {"ATTIO_API_KEY": test_key}):
        yield test_key


@pytest.fixture
def env_pipeline_list_id() -> Generator[str, None, None]:
    """Provide a test pipeline list ID via environment variable."""
    test_list_id = "list_test_pipeline_12345"
    with patch.dict(os.environ, {"ATTIO_PIPELINE_LIST_ID": test_list_id}):
        yield test_list_id


@pytest.fixture
def env_vars(env_api_key: str, env_pipeline_list_id: str) -> Generator[dict[str, str], None, None]:
    """Provide all required environment variables."""
    yield {"ATTIO_API_KEY": env_api_key, "ATTIO_PIPELINE_LIST_ID": env_pipeline_list_id}


# =============================================================================
# Sample Data Fixtures
# =============================================================================


@pytest.fixture
def sample_person() -> dict[str, Any]:
    """Sample person record from Attio API."""
    return {
        "id": {"object_id": "obj_people", "record_id": "rec_person_12345678901234"},
        "values": {
            "email_addresses": [{"email_address": "john@example.com", "attribute_type": "email-address"}],
            "name": [{"full_name": "John Doe", "first_name": "John", "last_name": "Doe"}],
            "job_title": [{"value": "Software Engineer"}],
        },
        "created_at": "2024-01-15T10:30:00.000Z",
    }


@pytest.fixture
def sample_person_create_response() -> dict[str, Any]:
    """Sample response from creating a person."""
    return {
        "data": {
            "id": {"object_id": "obj_people", "record_id": "rec_person_new_12345678"},
            "values": {
                "email_addresses": [{"email_address": "jane@example.com"}],
                "name": [{"full_name": "Jane Smith"}],
            },
            "created_at": "2024-01-20T14:00:00.000Z",
        }
    }


@pytest.fixture
def sample_pipeline_entry() -> dict[str, Any]:
    """Sample pipeline entry from Attio API."""
    return {
        "id": {"list_id": "list_test_pipeline_12345", "entry_id": "entry_12345678901234"},
        "record_id": "rec_person_12345678901234",
        "entry_values": {
            "status": [{"status": "status_new_reply_12345"}],
        },
        "created_at": "2024-01-15T10:30:00.000Z",
    }


@pytest.fixture
def sample_list_config() -> dict[str, Any]:
    """Sample list configuration with status attribute."""
    return {
        "data": {
            "id": {"list_id": "list_test_pipeline_12345"},
            "name": "Sales Pipeline",
            "attributes": [
                {
                    "type": "status",
                    "name": "Status",
                    "config": {
                        "statuses": [
                            {"id": {"status_id": "status_new_reply_12345"}, "title": "New Reply"},
                            {"id": {"status_id": "status_qualifying_12345"}, "title": "Qualifying"},
                            {"id": {"status_id": "status_meeting_scheduled_12345"}, "title": "Meeting Scheduled"},
                            {"id": {"status_id": "status_meeting_held_12345"}, "title": "Meeting Held"},
                            {"id": {"status_id": "status_proposal_12345"}, "title": "Proposal"},
                            {"id": {"status_id": "status_closed_won_12345"}, "title": "Closed Won"},
                            {"id": {"status_id": "status_closed_lost_12345"}, "title": "Closed Lost"},
                        ]
                    },
                }
            ],
        }
    }


@pytest.fixture
def sample_note() -> dict[str, Any]:
    """Sample note/activity from Attio API."""
    return {
        "id": {"note_id": "note_12345678901234"},
        "parent_object": "people",
        "parent_record_id": "rec_person_12345678901234",
        "title": "Note: Activity Log",
        "content": "Had a great conversation about the product.",
        "format": "plaintext",
        "created_at": "2024-01-20T14:00:00.000Z",
    }


@pytest.fixture
def sample_task() -> dict[str, Any]:
    """Sample task from Attio API."""
    return {
        "id": {"task_id": "task_12345678901234"},
        "content": "Follow up with lead about demo",
        "format": "plaintext",
        "deadline_at": "2024-12-31T15:00:00.000Z",
        "is_completed": False,
        "linked_records": [
            {"target_object": "people", "target_record_id": "rec_person_12345678901234"}
        ],
        "created_at": "2024-01-20T14:00:00.000Z",
    }


# =============================================================================
# Mock Response Builders
# =============================================================================


def make_attio_response(data: Any, status_code: int = 200) -> dict[str, Any]:
    """Build a standard Attio API response wrapper."""
    return {"data": data}


def make_attio_list_response(items: list[Any], status_code: int = 200) -> dict[str, Any]:
    """Build a standard Attio API list response."""
    return {"data": items}


def make_attio_error_response(
    message: str,
    status_code: int = 400,
    error_code: str | None = None
) -> dict[str, Any]:
    """Build an Attio API error response."""
    error: dict[str, Any] = {"message": message}
    if error_code:
        error["code"] = error_code
    return {"error": error}


# =============================================================================
# Client Fixture with Cache Cleanup
# =============================================================================


@pytest.fixture
def clean_attio_cache() -> Generator[None, None, None]:
    """Clean the Attio module-level caches before and after each test."""
    from atlas_gtm_mcp.attio import _list_status_cache

    # Clear before test
    _list_status_cache.clear()

    yield

    # Clear after test
    _list_status_cache.clear()


@pytest.fixture
def reset_attio_client() -> Generator[None, None, None]:
    """Reset the global Attio client between tests."""
    import atlas_gtm_mcp.attio as attio_module

    # Save and clear existing client
    old_client = attio_module._attio_client
    attio_module._attio_client = None

    yield

    # Restore (or leave as None)
    attio_module._attio_client = old_client
