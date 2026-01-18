"""Voyage AI embeddings with tenacity retry logic.

Handles embedding generation for queries and documents with:
- Exponential backoff for rate limits (HTTP 429) per FR-013
- Truncation for texts exceeding max tokens
- Separate input_type handling for queries vs documents
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import httpx
import structlog
import voyageai
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

if TYPE_CHECKING:
    pass

log = structlog.get_logger()


class RateLimitError(Exception):
    """Voyage AI rate limit exceeded (HTTP 429)."""

    pass


class EmbeddingError(Exception):
    """General embedding error."""

    pass


# Voyage AI client - initialized lazily
_voyage_client: voyageai.Client | None = None


def _get_voyage_client() -> voyageai.Client:
    """Get or create the Voyage AI client."""
    global _voyage_client
    if _voyage_client is None:
        api_key = os.getenv("VOYAGE_API_KEY")
        if not api_key:
            raise EmbeddingError("VOYAGE_API_KEY environment variable not set")
        _voyage_client = voyageai.Client(api_key=api_key)
    return _voyage_client


# Embedding configuration per spec
EMBEDDING_CONFIG = {
    "model": "voyage-3.5-lite",
    "dimension": 512,
    "input_type_document": "document",
    "input_type_query": "query",
    "truncation": True,
    "max_tokens": 8000,
}


@retry(
    wait=wait_random_exponential(multiplier=1, max=60),
    stop=stop_after_attempt(6),
    retry=retry_if_exception_type(RateLimitError),
)
def _embed_with_retry(
    texts: list[str],
    input_type: str,
) -> list[list[float]]:
    """Embed texts with automatic retry on rate limits.

    Args:
        texts: List of texts to embed.
        input_type: Either "query" or "document".

    Returns:
        List of embedding vectors.

    Raises:
        RateLimitError: On HTTP 429 (triggers retry).
        EmbeddingError: On other embedding failures.
    """
    client = _get_voyage_client()

    try:
        result = client.embed(
            texts=texts,
            model=EMBEDDING_CONFIG["model"],
            input_type=input_type,
            truncation=EMBEDDING_CONFIG["truncation"],
        )
        return result.embeddings
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            log.warning(
                "voyage_rate_limit",
                status_code=429,
                input_type=input_type,
                text_count=len(texts),
            )
            raise RateLimitError("Rate limit exceeded") from e
        log.error(
            "voyage_http_error",
            status_code=e.response.status_code,
            input_type=input_type,
        )
        raise EmbeddingError(f"Voyage API error: {e.response.status_code}") from e
    except Exception as e:
        log.error(
            "voyage_error",
            error_type=type(e).__name__,
            input_type=input_type,
        )
        raise EmbeddingError(f"Embedding failed: {e}") from e


def embed_query(text: str) -> list[float]:
    """Generate embedding for a search query.

    Uses input_type="query" for optimal search performance.

    Args:
        text: The query text to embed.

    Returns:
        512-dimensional embedding vector.

    Raises:
        RateLimitError: If all retries exhausted.
        EmbeddingError: On other failures.
    """
    embeddings = _embed_with_retry([text], input_type="query")
    return embeddings[0]


def embed_document(text: str) -> list[float]:
    """Generate embedding for document storage.

    Uses input_type="document" for storage optimization.

    Args:
        text: The document text to embed.

    Returns:
        512-dimensional embedding vector.

    Raises:
        RateLimitError: If all retries exhausted.
        EmbeddingError: On other failures.
    """
    embeddings = _embed_with_retry([text], input_type="document")
    return embeddings[0]


def embed_batch(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Batch embed multiple texts.

    Args:
        texts: List of texts to embed (max 100 per batch).
        input_type: Either "query" or "document".

    Returns:
        List of embedding vectors.

    Raises:
        ValueError: If batch size exceeds 100.
        RateLimitError: If all retries exhausted.
        EmbeddingError: On other failures.
    """
    if len(texts) > 100:
        raise ValueError("Batch size cannot exceed 100 texts")

    return _embed_with_retry(texts, input_type=input_type)
