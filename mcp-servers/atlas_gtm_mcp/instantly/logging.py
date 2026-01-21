"""Structured JSON logging for Instantly MCP tools.

Provides structured logging with required fields:
- tool: Tool name
- params: Tool parameters (sanitized)
- result_count: Number of results returned
- latency_ms: Execution time in milliseconds
- error_type: Error type if applicable
- correlation_id: For request tracing
"""

from __future__ import annotations

import logging
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from functools import wraps
from typing import TYPE_CHECKING, Any, Callable, TypeVar

import structlog

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

# Type vars for decorator typing
F = TypeVar("F", bound=Callable[..., Any])


def configure_logging(json_output: bool | None = None, log_level: str | None = None) -> None:
    """Configure structlog for JSON output.

    Args:
        json_output: Force JSON output. If None, auto-detect (JSON if not a TTY).
        log_level: Logging level (default: INFO).
    """
    if json_output is None:
        json_output = os.getenv("LOG_JSON", "").lower() in ("1", "true", "yes")
        if not json_output:
            json_output = not sys.stderr.isatty()

    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()

    numeric_level = getattr(logging, log_level, logging.INFO)

    shared_processors: list[structlog.types.Processor] = [
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.contextvars.merge_contextvars,
    ]

    if json_output:
        processors = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(sort_keys=True),
        ]
    else:
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        cache_logger_on_first_use=True,
    )


# Initialize logging on module import
configure_logging()

# Get the configured logger
log = structlog.get_logger()


# Fields that should not be logged (sensitive data)
SENSITIVE_FIELDS = frozenset(
    {
        "api_key",
        "password",
        "secret",
        "token",
        "credential",
        "authorization",
        "email",
        "body",
        "message",
        "content",
    }
)


def _sanitize_params(params: dict[str, Any]) -> dict[str, Any]:
    """Remove sensitive data from parameters before logging.

    Args:
        params: Tool parameters to sanitize.

    Returns:
        Sanitized parameters with sensitive values redacted.
    """
    sanitized = {}
    for key, value in params.items():
        lower_key = key.lower()
        if any(sensitive in lower_key for sensitive in SENSITIVE_FIELDS):
            if isinstance(value, str) and "@" in value:
                parts = value.split("@")
                if len(parts) == 2:
                    sanitized[key] = f"{parts[0][:2]}***@{parts[1]}"
                else:
                    sanitized[key] = "[REDACTED]"
            elif isinstance(value, str) and len(value) > 50:
                sanitized[key] = f"[REDACTED:{len(value)} chars]"
            else:
                sanitized[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized[key] = _sanitize_params(value)
        elif isinstance(value, str) and len(value) > 500:
            sanitized[key] = f"{value[:500]}... [truncated {len(value)} chars]"
        else:
            sanitized[key] = value
    return sanitized


def _count_results(result: Any) -> int:
    """Count the number of results for logging.

    Args:
        result: Tool result (may be list, dict, or None).

    Returns:
        Number of results.
    """
    if result is None:
        return 0
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict):
        if "data" in result and isinstance(result["data"], list):
            return len(result["data"])
        return 1
    return 1


def generate_correlation_id() -> str:
    """Generate a unique correlation ID for request tracing."""
    return str(uuid.uuid4())[:8]


@asynccontextmanager
async def log_tool_invocation(
    tool_name: str, params: dict[str, Any], correlation_id: str | None = None
) -> AsyncGenerator[str, None]:
    """Context manager for logging tool invocations.

    Args:
        tool_name: Name of the tool being invoked.
        params: Tool parameters.
        correlation_id: Optional correlation ID for tracing.

    Yields:
        The correlation ID for this invocation.
    """
    start = time.perf_counter()
    sanitized_params = _sanitize_params(params)
    corr_id = correlation_id or generate_correlation_id()

    log.info(
        "instantly_tool_start",
        tool=tool_name,
        params=sanitized_params,
        correlation_id=corr_id,
    )

    try:
        yield corr_id
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        log.error(
            "instantly_tool_error",
            tool=tool_name,
            params=sanitized_params,
            latency_ms=round(latency_ms, 2),
            error_type=type(e).__name__,
            correlation_id=corr_id,
        )
        raise


def log_tool_result(
    tool_name: str,
    params: dict[str, Any],
    result: Any,
    start_time: float,
    correlation_id: str | None = None,
) -> None:
    """Log successful tool invocation.

    Args:
        tool_name: Name of the tool.
        params: Tool parameters (will be sanitized).
        result: Tool result.
        start_time: Start time from time.perf_counter().
        correlation_id: Optional correlation ID for tracing.
    """
    latency_ms = (time.perf_counter() - start_time) * 1000
    result_count = _count_results(result)
    sanitized_params = _sanitize_params(params)

    log.info(
        "instantly_tool_success",
        tool=tool_name,
        params=sanitized_params,
        result_count=result_count,
        latency_ms=round(latency_ms, 2),
        correlation_id=correlation_id,
    )


def log_tool_error(
    tool_name: str,
    params: dict[str, Any],
    error: Exception,
    start_time: float,
    correlation_id: str | None = None,
) -> None:
    """Log failed tool invocation.

    Args:
        tool_name: Name of the tool.
        params: Tool parameters (will be sanitized).
        error: The exception that occurred.
        start_time: Start time from time.perf_counter().
        correlation_id: Optional correlation ID for tracing.
    """
    latency_ms = (time.perf_counter() - start_time) * 1000
    sanitized_params = _sanitize_params(params)

    log.error(
        "instantly_tool_error",
        tool=tool_name,
        params=sanitized_params,
        latency_ms=round(latency_ms, 2),
        error_type=type(error).__name__,
        error_message=str(error)[:200],
        correlation_id=correlation_id,
    )


def log_api_call(
    method: str,
    path: str,
    status_code: int | None = None,
    latency_ms: float | None = None,
    error: str | None = None,
    retry_attempt: int = 0,
    correlation_id: str | None = None,
    retry_after: float | None = None,
) -> None:
    """Log Instantly API calls for debugging.

    Args:
        method: HTTP method (GET, POST, PATCH, etc.)
        path: API endpoint path
        status_code: HTTP status code (if available)
        latency_ms: Request latency in milliseconds
        error: Error message if failed
        retry_attempt: Which retry attempt (0 = first try)
        correlation_id: Request correlation ID
        retry_after: Retry-After header value in seconds (for 429 responses)
    """
    log_data = {
        "method": method,
        "path": path,
        "correlation_id": correlation_id,
    }

    if status_code is not None:
        log_data["status_code"] = status_code
    if latency_ms is not None:
        log_data["latency_ms"] = round(latency_ms, 2)
    if retry_attempt > 0:
        log_data["retry_attempt"] = retry_attempt
    if retry_after is not None:
        log_data["retry_after"] = retry_after

    if error:
        log_data["error"] = error[:200]
        log.warning("instantly_api_call", **log_data)
    else:
        log.debug("instantly_api_call", **log_data)


def with_logging(tool_name: str) -> Callable[[F], F]:
    """Decorator for automatic tool invocation logging.

    Args:
        tool_name: Name of the tool for logging.

    Returns:
        Decorator function.
    """

    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            params = kwargs.copy()
            correlation_id = generate_correlation_id()

            try:
                result = await func(*args, **kwargs)
                log_tool_result(tool_name, params, result, start, correlation_id)
                return result
            except Exception as e:
                log_tool_error(tool_name, params, e, start, correlation_id)
                raise

        return wrapper  # type: ignore[return-value]

    return decorator
