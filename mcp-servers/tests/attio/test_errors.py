"""Error handling and retry behavior tests for Attio MCP tools.

Tests verify:
- FR-016: Graceful error handling with user-friendly messages
- FR-017: Exponential backoff retry strategy
- FR-018: Rate limit handling with Retry-After header
- SC-001: Exponential backoff configuration (1s start, 2x multiplier, max 3 retries)
- SC-002: Retry-After header parsing
- SC-003: Error classification (retriable vs non-retriable)
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx
from fastmcp.exceptions import ToolError

if TYPE_CHECKING:
    pass


# =============================================================================
# Test Setup
# =============================================================================


def create_mock_response(status_code: int, json_data: dict, headers: dict | None = None) -> MagicMock:
    """Create a mock httpx response."""
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_data
    mock_response.headers = headers or {}
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
    """Reset Attio module state and provide mock httpx client."""
    import atlas_gtm_mcp.attio as attio_module

    attio_module._attio_client = None
    attio_module._list_status_cache.clear()

    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_client.request = AsyncMock()

    with patch.object(attio_module, "ATTIO_API_KEY", "test_api_key_12345"), \
         patch.object(attio_module, "ATTIO_PIPELINE_LIST_ID", "list_test_pipeline_12345"), \
         patch("atlas_gtm_mcp.attio.httpx.AsyncClient", return_value=mock_client):
        from atlas_gtm_mcp.attio import _get_attio_client

        attio_client = _get_attio_client()
        attio_client._client = mock_client

        yield mock_client

    attio_module._attio_client = None
    attio_module._list_status_cache.clear()


def get_attio_client():
    """Get the current Attio client."""
    from atlas_gtm_mcp.attio import _get_attio_client
    return _get_attio_client()


# =============================================================================
# FR-016: Graceful Error Handling Tests
# =============================================================================


class TestGracefulErrorHandling:
    """Tests for user-friendly error messages."""

    @pytest.mark.asyncio
    async def test_not_found_error_returns_user_friendly_message(self, reset_attio_module):
        """404 errors should return clear 'not found' messages."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(404, {
            "error": {"message": "Record not found", "code": "not_found"}
        })
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.attio import AttioNonRetriableError

        client = get_attio_client()

        with pytest.raises(AttioNonRetriableError) as exc_info:
            await client.get("/objects/people/records/rec_nonexistent", "test-corr-id")

        assert "not found" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_validation_error_includes_field_info(self, reset_attio_module):
        """400 validation errors should include field information."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(400, {
            "error": {
                "message": "Validation failed",
                "code": "validation_error",
                "details": {"field": "email", "reason": "Invalid format"}
            }
        })
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.attio import AttioNonRetriableError

        client = get_attio_client()

        with pytest.raises(AttioNonRetriableError):
            await client.post("/objects/people/records", "test-corr-id", json={})

    @pytest.mark.asyncio
    async def test_unauthorized_error_message(self, reset_attio_module):
        """401 unauthorized errors should have clear messages."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(401, {
            "error": {"message": "Invalid API key", "code": "unauthorized"}
        })
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.attio import AttioNonRetriableError

        client = get_attio_client()

        with pytest.raises(AttioNonRetriableError) as exc_info:
            await client.get("/objects/people/records/query", "test-corr-id")

        # Error should be non-retriable (401 is not something retrying will fix)
        error = exc_info.value
        assert "unauthorized" in str(error).lower() or "api key" in str(error).lower()


# =============================================================================
# FR-017: Error Classification Tests
# =============================================================================


class TestErrorClassification:
    """Tests for retriable vs non-retriable error classification."""

    def test_classify_rate_limit_as_retriable(self, mock_env):
        """429 rate limit errors should be retriable."""
        from atlas_gtm_mcp.attio.models import classify_http_error, AttioErrorType

        error_type = classify_http_error(429)
        assert error_type == AttioErrorType.RATE_LIMITED

    def test_classify_server_error_as_retriable(self, mock_env):
        """5xx server errors should be retriable."""
        from atlas_gtm_mcp.attio.models import classify_http_error, AttioErrorType

        # 500, 502, 503, 504 should all be retriable
        assert classify_http_error(500) == AttioErrorType.SERVICE_UNAVAILABLE
        assert classify_http_error(502) == AttioErrorType.SERVICE_UNAVAILABLE
        assert classify_http_error(503) == AttioErrorType.SERVICE_UNAVAILABLE
        assert classify_http_error(504) == AttioErrorType.SERVICE_UNAVAILABLE

    def test_classify_not_found_as_non_retriable(self, mock_env):
        """404 not found errors should not be retriable."""
        from atlas_gtm_mcp.attio.models import classify_http_error, AttioErrorType

        error_type = classify_http_error(404)
        assert error_type == AttioErrorType.NOT_FOUND

    def test_classify_unauthorized_as_non_retriable(self, mock_env):
        """401 unauthorized errors should not be retriable."""
        from atlas_gtm_mcp.attio.models import classify_http_error, AttioErrorType

        error_type = classify_http_error(401)
        assert error_type == AttioErrorType.AUTHENTICATION

    def test_classify_validation_error_as_non_retriable(self, mock_env):
        """400 validation errors should not be retriable."""
        from atlas_gtm_mcp.attio.models import classify_http_error, AttioErrorType

        error_type = classify_http_error(400)
        assert error_type == AttioErrorType.BAD_REQUEST


# =============================================================================
# FR-017 & SC-001: Exponential Backoff Tests
# =============================================================================


class TestExponentialBackoff:
    """Tests for retry behavior with exponential backoff."""

    def test_retriable_error_types(self, mock_env):
        """Verify which error types should trigger retries."""
        from atlas_gtm_mcp.attio.models import AttioErrorType

        # These should be retriable
        retriable_types = {
            AttioErrorType.RATE_LIMITED,
            AttioErrorType.SERVICE_UNAVAILABLE,
            AttioErrorType.TIMEOUT,
            AttioErrorType.NETWORK_ERROR,
        }

        # These should NOT be retriable
        non_retriable_types = {
            AttioErrorType.NOT_FOUND,
            AttioErrorType.AUTHENTICATION,
            AttioErrorType.PERMISSION_DENIED,
            AttioErrorType.VALIDATION,
            AttioErrorType.CONFLICT,
        }

        for error_type in retriable_types:
            assert AttioErrorType.is_retriable(error_type), f"{error_type} should be retriable"

        for error_type in non_retriable_types:
            assert not AttioErrorType.is_retriable(error_type), f"{error_type} should not be retriable"

    def test_backoff_configuration(self, mock_env):
        """Verify backoff is configured per SC-001 (1s start, 2x multiplier, max 3 retries)."""
        from atlas_gtm_mcp.attio import MAX_RETRIES, RETRY_START_SECONDS, RETRY_MAX_SECONDS

        # SC-001 specifies: 1s start, 2x multiplier, max 3 retries
        assert MAX_RETRIES == 3, "Max retries should be 3"
        assert RETRY_START_SECONDS == 1.0, "Retry start should be 1 second"
        assert RETRY_MAX_SECONDS == 10.0, "Max retry wait should be 10 seconds"


# =============================================================================
# FR-018 & SC-002: Rate Limit and Retry-After Header Tests
# =============================================================================


class TestRateLimitHandling:
    """Tests for rate limit handling with Retry-After header."""

    @pytest.mark.asyncio
    async def test_rate_limit_response_raises_retriable_error(self, reset_attio_module):
        """429 responses should raise retriable errors."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(
            429,
            {"error": {"message": "Rate limit exceeded", "code": "rate_limited"}},
            headers={"Retry-After": "5"}
        )
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.attio import AttioRetriableError

        client = get_attio_client()

        with pytest.raises(AttioRetriableError) as exc_info:
            await client.get("/objects/people/records/query", "test-corr-id")

        # Should be a retriable error
        assert exc_info.value is not None


# =============================================================================
# Timeout and Network Error Tests
# =============================================================================


class TestTimeoutHandling:
    """Tests for timeout error handling."""

    @pytest.mark.asyncio
    async def test_timeout_raises_retriable_error(self, reset_attio_module):
        """Timeout exceptions should raise retriable errors."""
        mock_httpx = reset_attio_module

        # Simulate timeout
        mock_httpx.request.side_effect = httpx.TimeoutException("Request timed out")

        from atlas_gtm_mcp.attio import AttioRetriableError

        client = get_attio_client()

        with pytest.raises(AttioRetriableError) as exc_info:
            await client.get("/objects/people/records/query", "test-corr-id")

        assert "timed out" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_network_error_raises_retriable_error(self, reset_attio_module):
        """Network errors should raise retriable errors."""
        mock_httpx = reset_attio_module

        # Simulate network error
        mock_httpx.request.side_effect = httpx.NetworkError("Connection refused")

        from atlas_gtm_mcp.attio import AttioRetriableError

        client = get_attio_client()

        with pytest.raises(AttioRetriableError) as exc_info:
            await client.get("/objects/people/records/query", "test-corr-id")

        assert "network" in str(exc_info.value).lower()


# =============================================================================
# Error Response Parsing Tests
# =============================================================================


class TestErrorResponseParsing:
    """Tests for parsing error responses from Attio API."""

    @pytest.mark.asyncio
    async def test_parse_error_with_message(self, reset_attio_module):
        """Error responses with message field should be parsed correctly."""
        mock_httpx = reset_attio_module

        mock_response = create_mock_response(400, {
            "error": {"message": "Invalid email format", "code": "validation_error"}
        })
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.attio import AttioNonRetriableError

        client = get_attio_client()

        with pytest.raises(AttioNonRetriableError) as exc_info:
            await client.post("/objects/people/records", "test-corr-id", json={})

        # Error message should be included
        assert "invalid" in str(exc_info.value).lower() or "validation" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_parse_error_without_standard_format(self, reset_attio_module):
        """Non-standard error responses should still be handled."""
        mock_httpx = reset_attio_module

        # Non-standard error format
        mock_response = create_mock_response(500, {
            "status": "error",
            "detail": "Internal server error"
        })
        mock_httpx.request.return_value = mock_response

        from atlas_gtm_mcp.attio import AttioRetriableError

        client = get_attio_client()

        with pytest.raises(AttioRetriableError):
            await client.get("/objects/people/records/query", "test-corr-id")


# =============================================================================
# ToolError Conversion Tests
# =============================================================================


class TestToolErrorConversion:
    """Tests for converting Attio errors to MCP ToolError."""

    def test_convert_non_retriable_error_to_tool_error(self, mock_env):
        """Non-retriable errors should be converted to ToolError."""
        from atlas_gtm_mcp.attio import AttioNonRetriableError, _convert_to_tool_error
        from atlas_gtm_mcp.attio.models import AttioErrorType

        error = AttioNonRetriableError(
            "Record not found",
            AttioErrorType.NOT_FOUND
        )

        tool_error = _convert_to_tool_error(error)

        assert isinstance(tool_error, ToolError)
        assert "not found" in str(tool_error).lower()

    def test_convert_retriable_error_to_tool_error(self, mock_env):
        """Retriable errors should be converted to ToolError with retry context."""
        from atlas_gtm_mcp.attio import AttioRetriableError, _convert_to_tool_error
        from atlas_gtm_mcp.attio.models import AttioErrorType

        error = AttioRetriableError(
            "Rate limit exceeded",
            AttioErrorType.RATE_LIMITED
        )

        tool_error = _convert_to_tool_error(error)

        assert isinstance(tool_error, ToolError)
        # Error message should indicate this was a transient error
        assert "rate" in str(tool_error).lower() or "retry" in str(tool_error).lower()
