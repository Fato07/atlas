"""Quality gates for insight validation.

Implements quality control checks per the add_insight contract:
- Confidence calculation based on source type and metadata
- Duplicate detection via semantic similarity (0.85 threshold per FR-011)
- Validation flag logic for human review requirements
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import structlog
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue

from .embeddings import embed_query
from .models import (
    Importance,
    InsightCategory,
    QualityGateResult,
    SourceMetadata,
)

if TYPE_CHECKING:
    pass

log = structlog.get_logger()

# Thresholds per spec
DUPLICATE_SIMILARITY_THRESHOLD = 0.85  # FR-011
MIN_CONFIDENCE_THRESHOLD = 0.70  # Contract requirement

# Qdrant client - initialized lazily
_qdrant_client: QdrantClient | None = None


def _get_qdrant_client() -> QdrantClient:
    """Get or create the Qdrant client."""
    global _qdrant_client
    if _qdrant_client is None:
        host = os.getenv("QDRANT_HOST", "localhost")
        port = os.getenv("QDRANT_PORT", "6333")
        api_key = os.getenv("QDRANT_API_KEY")

        # Use url parameter to explicitly specify HTTP (not HTTPS)
        _qdrant_client = QdrantClient(
            url=f"http://{host}:{port}",
            api_key=api_key,
        )
    return _qdrant_client


# Confidence scoring weights per contract
SOURCE_TYPE_SCORES: dict[str, float] = {
    "call_transcript": 0.20,
    "email_reply": 0.10,
    "linkedin_message": 0.05,
    "manual_entry": 0.0,
}

# Categories requiring validation
VALIDATION_REQUIRED_CATEGORIES = frozenset(
    {
        InsightCategory.BUYING_PROCESS,
        InsightCategory.ICP_SIGNAL,
    }
)


def calculate_confidence(content: str, source: SourceMetadata) -> float:
    """Calculate confidence score for an insight.

    Scoring formula per add_insight contract:
    - Base score: 0.5
    - Source type bonus: +0.20 (call_transcript), +0.10 (email_reply), +0.05 (linkedin_message)
    - Extracted quote bonus: +0.10
    - Company name bonus: +0.10

    Args:
        content: The insight content.
        source: Source provenance metadata.

    Returns:
        Confidence score between 0.0 and 1.0.
    """
    # Base score
    confidence = 0.5

    # Source type bonus
    source_bonus = SOURCE_TYPE_SCORES.get(source.type, 0.0)
    confidence += source_bonus

    # Extracted quote bonus
    if source.extracted_quote:
        confidence += 0.10

    # Company name bonus
    if source.company_name:
        confidence += 0.10

    # Cap at 1.0
    confidence = min(confidence, 1.0)

    log.debug(
        "confidence_calculation",
        source_type=source.type,
        has_quote=bool(source.extracted_quote),
        has_company=bool(source.company_name),
        final_score=round(confidence, 2),
    )

    return round(confidence, 2)


def check_duplicate(
    brain_id: str,
    content: str,
) -> tuple[bool, str | None, float | None]:
    """Check if content is a duplicate of an existing insight.

    Uses semantic similarity with 0.85 threshold per FR-011.

    Args:
        brain_id: Brain ID to scope the search.
        content: The insight content to check.

    Returns:
        Tuple of (is_duplicate, existing_id, similarity_score).
        If not a duplicate, returns (False, None, None).
    """
    client = _get_qdrant_client()

    # Generate embedding for the content
    content_vector = embed_query(content)

    # Search for similar insights
    results = client.query_points(
        collection_name="insights",
        query=content_vector,
        query_filter=Filter(
            must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
        ),
        limit=1,
        score_threshold=DUPLICATE_SIMILARITY_THRESHOLD,
    ).points

    if results:
        # Found a similar insight
        existing_id = str(results[0].id)
        similarity_score = results[0].score
        log.info(
            "duplicate_detected",
            brain_id=brain_id,
            existing_id=existing_id,
            similarity=round(similarity_score, 3),
        )
        return (True, existing_id, similarity_score)

    return (False, None, None)


def should_require_validation(
    importance: Importance | str,
    category: InsightCategory | str,
    confidence: float,
) -> bool:
    """Determine if an insight requires human validation.

    Per add_insight contract, validation is required when:
    - importance="high"
    - category in ["buying_process", "icp_signal"]
    - confidence < 0.80

    Args:
        importance: Importance level.
        category: Insight category.
        confidence: Calculated confidence score.

    Returns:
        True if validation is required.
    """
    # Normalize to enum values if strings
    if isinstance(importance, str):
        importance = Importance(importance)
    if isinstance(category, str):
        category = InsightCategory(category)

    # High importance always requires validation
    if importance == Importance.HIGH:
        return True

    # Specific categories require validation
    if category in VALIDATION_REQUIRED_CATEGORIES:
        return True

    # Low confidence requires validation
    if confidence < 0.80:
        return True

    return False


def run_quality_gate(
    brain_id: str,
    content: str,
    category: InsightCategory | str,
    importance: Importance | str,
    source: SourceMetadata,
) -> QualityGateResult:
    """Run all quality gate checks for an insight.

    Performs:
    1. Confidence calculation
    2. Minimum confidence check (0.70 threshold)
    3. Duplicate detection (0.85 similarity threshold)
    4. Validation flag determination

    Args:
        brain_id: Brain ID for duplicate checking.
        content: The insight content.
        category: Insight category.
        importance: Importance level.
        source: Source provenance metadata.

    Returns:
        QualityGateResult with all check results.
    """
    # Calculate confidence
    confidence = calculate_confidence(content, source)

    # Check minimum confidence threshold
    if confidence < MIN_CONFIDENCE_THRESHOLD:
        log.info(
            "quality_gate_rejected",
            reason="confidence_below_threshold",
            confidence=confidence,
            threshold=MIN_CONFIDENCE_THRESHOLD,
        )
        return QualityGateResult(
            passed=False,
            confidence_score=confidence,
            is_duplicate=False,
            requires_validation=False,
            rejection_reason=f"Confidence {confidence} below threshold {MIN_CONFIDENCE_THRESHOLD}",
        )

    # Check for duplicates
    is_duplicate, duplicate_id, similarity_score = check_duplicate(brain_id, content)

    if is_duplicate:
        return QualityGateResult(
            passed=False,
            confidence_score=confidence,
            is_duplicate=True,
            duplicate_id=duplicate_id,
            similarity_score=similarity_score,
            requires_validation=False,
            rejection_reason=f"Similar insight exists (ID: {duplicate_id}, similarity: {similarity_score})",
        )

    # Determine validation requirement
    requires_validation = should_require_validation(importance, category, confidence)

    log.info(
        "quality_gate_passed",
        confidence=confidence,
        requires_validation=requires_validation,
    )

    return QualityGateResult(
        passed=True,
        confidence_score=confidence,
        is_duplicate=False,
        requires_validation=requires_validation,
    )
