"""Structured JSON logging for Qdrant MCP tools.

Provides structured logging with required fields per FR-008:
- tool: Tool name
- params: Tool parameters (sanitized)
- result_count: Number of results returned
- latency_ms: Execution time in milliseconds
- error_type: Error type if applicable
"""

from __future__ import annotations

import logging
import os
import sys
import time
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
    # Get configuration from environment with fallbacks
    if json_output is None:
        json_output = os.getenv("LOG_JSON", "").lower() in ("1", "true", "yes")
        # Auto-detect: use JSON if not a TTY
        if not json_output:
            json_output = not sys.stderr.isatty()

    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()

    # Map string level to logging constant
    numeric_level = getattr(logging, log_level, logging.INFO)

    shared_processors: list[structlog.types.Processor] = [
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.contextvars.merge_contextvars,
    ]

    if json_output:
        # Production: JSON output
        processors = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(sort_keys=True),
        ]
    else:
        # Development: Pretty console output
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
        # Check if any sensitive field name is in the key
        if any(sensitive in lower_key for sensitive in SENSITIVE_FIELDS):
            sanitized[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized[key] = _sanitize_params(value)
        elif isinstance(value, str) and len(value) > 500:
            # Truncate very long strings
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
        # For single results like get_brain, count as 1
        return 1
    return 1


@asynccontextmanager
async def log_tool_invocation(
    tool_name: str, params: dict[str, Any]
) -> AsyncGenerator[None, None]:
    """Context manager for logging tool invocations.

    Args:
        tool_name: Name of the tool being invoked.
        params: Tool parameters.

    Yields:
        None (context for the tool execution).

    Example:
        async with log_tool_invocation("query_icp_rules", {"brain_id": "brain_iro_v1"}):
            result = await do_query()
    """
    start = time.perf_counter()
    sanitized_params = _sanitize_params(params)

    try:
        yield
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        log.error(
            "tool_invocation",
            tool=tool_name,
            params=sanitized_params,
            latency_ms=round(latency_ms, 2),
            error_type=type(e).__name__,
        )
        raise


def log_tool_result(
    tool_name: str,
    params: dict[str, Any],
    result: Any,
    start_time: float,
) -> None:
    """Log successful tool invocation.

    Args:
        tool_name: Name of the tool.
        params: Tool parameters (will be sanitized).
        result: Tool result.
        start_time: Start time from time.perf_counter().
    """
    latency_ms = (time.perf_counter() - start_time) * 1000
    result_count = _count_results(result)
    sanitized_params = _sanitize_params(params)

    log.info(
        "tool_invocation",
        tool=tool_name,
        params=sanitized_params,
        result_count=result_count,
        latency_ms=round(latency_ms, 2),
    )


def log_tool_error(
    tool_name: str,
    params: dict[str, Any],
    error: Exception,
    start_time: float,
) -> None:
    """Log failed tool invocation.

    Args:
        tool_name: Name of the tool.
        params: Tool parameters (will be sanitized).
        error: The exception that occurred.
        start_time: Start time from time.perf_counter().
    """
    latency_ms = (time.perf_counter() - start_time) * 1000
    sanitized_params = _sanitize_params(params)

    log.error(
        "tool_invocation",
        tool=tool_name,
        params=sanitized_params,
        latency_ms=round(latency_ms, 2),
        error_type=type(error).__name__,
    )


def with_logging(tool_name: str) -> Callable[[F], F]:
    """Decorator for automatic tool invocation logging.

    Args:
        tool_name: Name of the tool for logging.

    Returns:
        Decorator function.

    Example:
        @with_logging("query_icp_rules")
        async def query_icp_rules(brain_id: str, query: str) -> list[dict]:
            ...
    """

    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            # Build params dict from kwargs
            params = kwargs.copy()

            try:
                result = await func(*args, **kwargs)
                log_tool_result(tool_name, params, result, start)
                return result
            except Exception as e:
                log_tool_error(tool_name, params, e, start)
                raise

        return wrapper  # type: ignore[return-value]

    return decorator
