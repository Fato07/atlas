"""Qdrant MCP tools for Knowledge Base operations.

This module implements the MCP tools for the Atlas GTM Knowledge Base:
- query_icp_rules: Semantic search for ICP scoring rules
- get_response_template: Retrieve response templates by reply type
- find_objection_handler: Find objection handlers with confidence threshold
- search_market_research: Search market research documents
- add_insight: Add insights with quality gate validation
- get_brain / list_brains: Brain management tools
"""

from __future__ import annotations

import os
import time
import uuid
from typing import TYPE_CHECKING

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue, PointStruct

from .embeddings import embed_document, embed_query
from .logging import log_tool_error, log_tool_result
from .models import (
    ContentType,
    ICPCategory,
    Importance,
    InsightCategory,
    ReplyType,
    SourceMetadata,
    ValidationStatus,
    validate_brain_id,
)
from .quality_gates import run_quality_gate

if TYPE_CHECKING:
    pass


# Thresholds per spec
OBJECTION_CONFIDENCE_THRESHOLD = 0.70  # FR-012


def _get_qdrant_client() -> QdrantClient:
    """Get Qdrant client instance."""
    return QdrantClient(
        host=os.getenv("QDRANT_HOST", "localhost"),
        port=int(os.getenv("QDRANT_PORT", "6333")),
    )


def _handle_qdrant_error(e: Exception) -> None:
    """Convert Qdrant errors to ToolError."""
    error_type = type(e).__name__
    if "Connection" in error_type or "Timeout" in error_type:
        raise ToolError("Knowledge base unavailable, retry later") from e
    raise ToolError(f"Knowledge base error: {e}") from e


def register_qdrant_tools(mcp: FastMCP) -> None:
    """Register all Qdrant/KB tools with the MCP server."""

    # ==========================================================================
    # US1: Query ICP Rules (P1)
    # ==========================================================================

    @mcp.tool()
    async def query_icp_rules(
        brain_id: str,
        query: str,
        category: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """
        Query ICP scoring rules from the Knowledge Base using semantic search.

        Used by the Lead Scorer agent to score incoming leads based on the
        current vertical's criteria.

        Args:
            brain_id: Brain ID for vertical isolation (pattern: brain_{vertical}_v{version})
            query: Semantic search query to match against ICP rules (1-1000 chars)
            category: Optional filter by ICP category (firmographic, technographic, behavioral, intent)
            limit: Maximum number of rules to return (1-50, default: 10)

        Returns:
            List of matching ICP rules sorted by relevance score, each containing:
            id, score, category, attribute, display_name, condition, score_weight,
            is_knockout, reasoning
        """
        start = time.perf_counter()
        params = {"brain_id": brain_id, "query": query, "category": category, "limit": limit}

        try:
            # Input validation
            if not validate_brain_id(brain_id):
                raise ToolError(f"Invalid brain_id format: {brain_id}")

            if not query or len(query) < 1:
                raise ToolError("Query cannot be empty")

            if len(query) > 1000:
                raise ToolError("Query exceeds 1000 characters")

            if limit < 1 or limit > 50:
                raise ToolError("Limit must be between 1 and 50")

            if category is not None:
                try:
                    ICPCategory(category)
                except ValueError:
                    valid_categories = ", ".join([c.value for c in ICPCategory])
                    raise ToolError(f"Invalid category: {category}. Valid: {valid_categories}")

            # Build filter
            must_conditions = [
                FieldCondition(key="brain_id", match=MatchValue(value=brain_id))
            ]

            if category is not None:
                must_conditions.append(
                    FieldCondition(key="category", match=MatchValue(value=category))
                )

            # Generate embedding and search
            query_vector = embed_query(query)
            qdrant = _get_qdrant_client()

            results = qdrant.search(
                collection_name="icp_rules",
                query_vector=query_vector,
                query_filter=Filter(must=must_conditions),
                limit=limit,
            )

            # Map to result format
            output = [
                {
                    "id": str(hit.id),
                    "score": round(hit.score, 3),
                    "category": hit.payload.get("category"),
                    "attribute": hit.payload.get("attribute"),
                    "display_name": hit.payload.get("display_name", hit.payload.get("attribute")),
                    "condition": hit.payload.get("condition", {}),
                    "score_weight": hit.payload.get("score_weight", 0),
                    "is_knockout": hit.payload.get("is_knockout", False),
                    "reasoning": hit.payload.get("reasoning", ""),
                }
                for hit in results
            ]

            log_tool_result("query_icp_rules", params, output, start)
            return output

        except ToolError:
            raise
        except Exception as e:
            log_tool_error("query_icp_rules", params, e, start)
            _handle_qdrant_error(e)

    # ==========================================================================
    # US2: Get Response Template (P1)
    # ==========================================================================

    @mcp.tool()
    async def get_response_template(
        brain_id: str,
        reply_type: str,
        tier: int | None = None,
        auto_send_only: bool = False,
    ) -> list[dict]:
        """
        Get response templates from the Knowledge Base by reply type.

        Used by the Reply Handler agent to draft appropriate responses
        to lead communications.

        Args:
            brain_id: Brain ID for vertical isolation
            reply_type: Type of reply to get templates for (positive_interest, pricing_question, etc.)
            tier: Optional tier filter (1=auto-send, 2=draft, 3=human only)
            auto_send_only: Shortcut filter for tier=1 templates only (overrides tier param)

        Returns:
            List of matching templates, each containing:
            id, reply_type, tier, template_text, variables, personalization_instructions
        """
        start = time.perf_counter()
        params = {
            "brain_id": brain_id,
            "reply_type": reply_type,
            "tier": tier,
            "auto_send_only": auto_send_only,
        }

        try:
            # Input validation
            if not validate_brain_id(brain_id):
                raise ToolError(f"Invalid brain_id format: {brain_id}")

            try:
                ReplyType(reply_type)
            except ValueError:
                valid_types = ", ".join([r.value for r in ReplyType])
                raise ToolError(f"Invalid reply_type: {reply_type}. Valid: {valid_types}")

            if tier is not None and (tier < 1 or tier > 3):
                raise ToolError("Tier must be 1, 2, or 3")

            # Build filter
            must_conditions = [
                FieldCondition(key="brain_id", match=MatchValue(value=brain_id)),
                FieldCondition(key="reply_type", match=MatchValue(value=reply_type)),
            ]

            # auto_send_only overrides tier parameter
            effective_tier = 1 if auto_send_only else tier

            if effective_tier is not None:
                must_conditions.append(
                    FieldCondition(key="tier", match=MatchValue(value=effective_tier))
                )

            # Query
            qdrant = _get_qdrant_client()
            results, _ = qdrant.scroll(
                collection_name="response_templates",
                scroll_filter=Filter(must=must_conditions),
                limit=10,
                with_payload=True,
            )

            # Map to result format
            output = [
                {
                    "id": str(point.id),
                    "reply_type": point.payload.get("reply_type"),
                    "tier": point.payload.get("tier"),
                    "template_text": point.payload.get("template_text", ""),
                    "variables": point.payload.get("variables", []),
                    "personalization_instructions": point.payload.get(
                        "personalization_instructions"
                    ),
                }
                for point in results
            ]

            log_tool_result("get_response_template", params, output, start)
            return output

        except ToolError:
            raise
        except Exception as e:
            log_tool_error("get_response_template", params, e, start)
            _handle_qdrant_error(e)

    # ==========================================================================
    # US3: Find Objection Handler (P1)
    # ==========================================================================

    @mcp.tool()
    async def find_objection_handler(
        brain_id: str,
        objection_text: str,
    ) -> dict | None:
        """
        Find the best matching objection handler using semantic search.

        Returns the best matching handler if confidence >= 0.70, otherwise None.
        Used by the Reply Handler agent to respond to objections.

        Args:
            brain_id: Brain ID for vertical isolation
            objection_text: The objection text to match against (1-2000 chars)

        Returns:
            Best matching handler with confidence score, or None if no match meets threshold.
            Contains: id, confidence, objection_type, handler_strategy, handler_response,
            variables, follow_up_actions
        """
        start = time.perf_counter()
        params = {"brain_id": brain_id, "objection_text": objection_text}

        try:
            # Input validation
            if not validate_brain_id(brain_id):
                raise ToolError(f"Invalid brain_id format: {brain_id}")

            if not objection_text or len(objection_text) < 1:
                raise ToolError("Objection text cannot be empty")

            if len(objection_text) > 2000:
                raise ToolError("Objection text exceeds 2000 characters")

            # Generate embedding and search with threshold
            query_vector = embed_query(objection_text)
            qdrant = _get_qdrant_client()

            results = qdrant.search(
                collection_name="objection_handlers",
                query_vector=query_vector,
                query_filter=Filter(
                    must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
                ),
                limit=1,
                score_threshold=OBJECTION_CONFIDENCE_THRESHOLD,  # FR-012
            )

            # Return None if no match meets threshold
            if not results:
                log_tool_result("find_objection_handler", params, None, start)
                return None

            hit = results[0]
            output = {
                "id": str(hit.id),
                "confidence": round(hit.score, 3),
                "objection_type": hit.payload.get("objection_type"),
                "handler_strategy": hit.payload.get("handler_strategy", ""),
                "handler_response": hit.payload.get(
                    "handler_response", hit.payload.get("handler_template", "")
                ),
                "variables": hit.payload.get("variables", []),
                "follow_up_actions": hit.payload.get("follow_up_actions", []),
            }

            log_tool_result("find_objection_handler", params, output, start)
            return output

        except ToolError:
            raise
        except Exception as e:
            log_tool_error("find_objection_handler", params, e, start)
            _handle_qdrant_error(e)

    # ==========================================================================
    # US4: Search Market Research (P2)
    # ==========================================================================

    @mcp.tool()
    async def search_market_research(
        brain_id: str,
        query: str,
        content_type: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        """
        Search market research documents in the Knowledge Base using semantic search.

        Used by the Meeting Prep agent to gather background information.

        Args:
            brain_id: Brain ID for vertical isolation
            query: Semantic search query (1-1000 chars)
            content_type: Optional filter (market_overview, competitor_analysis, buyer_persona, pain_points, trends, case_study)
            limit: Maximum documents to return (1-20, default: 5)

        Returns:
            List of relevant research documents sorted by relevance, each containing:
            id, score, content_type, title, content, key_facts, source_url
        """
        start = time.perf_counter()
        params = {
            "brain_id": brain_id,
            "query": query,
            "content_type": content_type,
            "limit": limit,
        }

        try:
            # Input validation
            if not validate_brain_id(brain_id):
                raise ToolError(f"Invalid brain_id format: {brain_id}")

            if not query or len(query) < 1:
                raise ToolError("Query cannot be empty")

            if len(query) > 1000:
                raise ToolError("Query exceeds 1000 characters")

            if limit < 1 or limit > 20:
                raise ToolError("Limit must be between 1 and 20")

            if content_type is not None:
                try:
                    ContentType(content_type)
                except ValueError:
                    valid_types = ", ".join([c.value for c in ContentType])
                    raise ToolError(f"Invalid content_type: {content_type}. Valid: {valid_types}")

            # Build filter
            must_conditions = [
                FieldCondition(key="brain_id", match=MatchValue(value=brain_id))
            ]

            if content_type is not None:
                must_conditions.append(
                    FieldCondition(key="content_type", match=MatchValue(value=content_type))
                )

            # Generate embedding and search
            query_vector = embed_query(query)
            qdrant = _get_qdrant_client()

            results = qdrant.search(
                collection_name="market_research",
                query_vector=query_vector,
                query_filter=Filter(must=must_conditions),
                limit=limit,
            )

            # Map to result format
            output = [
                {
                    "id": str(hit.id),
                    "score": round(hit.score, 3),
                    "content_type": hit.payload.get("content_type"),
                    "title": hit.payload.get("title", ""),
                    "content": hit.payload.get("content", ""),
                    "key_facts": hit.payload.get("key_facts", []),
                    "source_url": hit.payload.get("source_url"),
                }
                for hit in results
            ]

            log_tool_result("search_market_research", params, output, start)
            return output

        except ToolError:
            raise
        except Exception as e:
            log_tool_error("search_market_research", params, e, start)
            _handle_qdrant_error(e)

    # ==========================================================================
    # US5: Add Insight (P2)
    # ==========================================================================

    @mcp.tool()
    async def add_insight(
        brain_id: str,
        content: str,
        category: str,
        importance: str = "medium",
        source: dict | None = None,
    ) -> dict:
        """
        Add a new insight to the Knowledge Base with quality gate validation.

        Includes quality gates for:
        - Confidence calculation based on source reliability
        - Duplicate detection (>85% similarity = duplicate)
        - Validation flag for high-importance or uncertain insights

        Args:
            brain_id: Brain ID to add the insight to
            content: The insight content (10-5000 chars)
            category: Insight category (buying_process, pain_point, objection, competitive_intel, messaging_effectiveness, icp_signal)
            importance: Importance level (low, medium, high)
            source: Source provenance metadata with fields:
                - type: Source type (call_transcript, email_reply, linkedin_message, manual_entry)
                - id: Source ID
                - lead_id: Optional lead ID
                - company_name: Optional company name
                - extracted_quote: Optional direct quote

        Returns:
            Result with status (created, duplicate, rejected) and relevant details
        """
        start = time.perf_counter()
        params = {
            "brain_id": brain_id,
            "category": category,
            "importance": importance,
        }

        try:
            # Input validation
            if not validate_brain_id(brain_id):
                raise ToolError(f"Invalid brain_id format: {brain_id}")

            if not content or len(content) < 10:
                raise ToolError("Insight content too short (minimum 10 characters)")

            if len(content) > 5000:
                raise ToolError("Insight content exceeds 5000 characters")

            try:
                InsightCategory(category)
            except ValueError:
                valid_categories = ", ".join([c.value for c in InsightCategory])
                raise ToolError(f"Invalid category: {category}. Valid: {valid_categories}")

            try:
                Importance(importance)
            except ValueError:
                raise ToolError("Importance must be: low, medium, or high")

            # Validate source
            if source is None:
                raise ToolError("Source metadata is required")

            if not source.get("type"):
                raise ToolError("Source type is required")

            if not source.get("id"):
                raise ToolError("Source ID is required")

            # Convert source dict to SourceMetadata
            source_metadata = SourceMetadata(
                type=source["type"],
                id=source["id"],
                lead_id=source.get("lead_id"),
                company_name=source.get("company_name"),
                extracted_quote=source.get("extracted_quote"),
            )

            # Run quality gates
            gate_result = run_quality_gate(
                brain_id=brain_id,
                content=content,
                category=InsightCategory(category),
                importance=Importance(importance),
                source=source_metadata,
            )

            # Handle rejection
            if not gate_result.passed:
                if gate_result.is_duplicate:
                    output = {
                        "status": "duplicate",
                        "existing_id": gate_result.duplicate_id,
                        "reason": f"Similar insight already exists (similarity: {gate_result.similarity_score})",
                    }
                else:
                    output = {
                        "status": "rejected",
                        "reason": gate_result.rejection_reason,
                    }
                log_tool_result("add_insight", params, output, start)
                return output

            # Create the insight
            insight_id = str(uuid.uuid4())
            content_vector = embed_document(content)
            qdrant = _get_qdrant_client()

            payload = {
                "brain_id": brain_id,
                "content": content,
                "category": category,
                "importance": importance,
                "source": source,
                "confidence": gate_result.confidence_score,
                "validation": {
                    "status": ValidationStatus.PENDING.value,
                    "needs_validation": gate_result.requires_validation,
                },
            }

            qdrant.upsert(
                collection_name="insights",
                points=[
                    PointStruct(
                        id=insight_id,
                        vector=content_vector,
                        payload=payload,
                    )
                ],
            )

            output = {
                "status": "created",
                "id": insight_id,
                "confidence": gate_result.confidence_score,
                "needs_validation": gate_result.requires_validation,
            }

            log_tool_result("add_insight", params, output, start)
            return output

        except ToolError:
            raise
        except Exception as e:
            log_tool_error("add_insight", params, e, start)
            _handle_qdrant_error(e)

    # ==========================================================================
    # US6: Brain Management (P2)
    # ==========================================================================

    @mcp.tool()
    async def get_brain(
        brain_id: str | None = None,
        vertical: str | None = None,
    ) -> dict | None:
        """
        Get a brain configuration from the Knowledge Base.

        Args:
            brain_id: Specific brain ID to fetch
            vertical: Or fetch active brain by vertical name

        Returns:
            Brain configuration with id, name, vertical, version, status, description,
            config, stats, created_at, updated_at. Returns None if not found.

        Note:
            If neither brain_id nor vertical provided, returns the default active brain.
        """
        start = time.perf_counter()
        params = {"brain_id": brain_id, "vertical": vertical}

        try:
            qdrant = _get_qdrant_client()

            if brain_id:
                # Fetch by exact ID
                results, _ = qdrant.scroll(
                    collection_name="brains",
                    scroll_filter=Filter(
                        must=[FieldCondition(key="id", match=MatchValue(value=brain_id))]
                    ),
                    limit=1,
                    with_payload=True,
                )
            elif vertical:
                # Fetch active brain for vertical
                results, _ = qdrant.scroll(
                    collection_name="brains",
                    scroll_filter=Filter(
                        must=[
                            FieldCondition(key="vertical", match=MatchValue(value=vertical)),
                            FieldCondition(key="status", match=MatchValue(value="active")),
                        ]
                    ),
                    limit=1,
                    with_payload=True,
                )
            else:
                # Get default active brain
                results, _ = qdrant.scroll(
                    collection_name="brains",
                    scroll_filter=Filter(
                        must=[FieldCondition(key="status", match=MatchValue(value="active"))]
                    ),
                    limit=1,
                    with_payload=True,
                )

            if not results:
                log_tool_result("get_brain", params, None, start)
                return None

            point = results[0]
            output = {
                "id": str(point.id),
                **point.payload,
            }

            log_tool_result("get_brain", params, output, start)
            return output

        except Exception as e:
            log_tool_error("get_brain", params, e, start)
            _handle_qdrant_error(e)

    @mcp.tool()
    async def list_brains() -> list[dict]:
        """
        List all available brains from the Knowledge Base.

        Returns:
            List of all brain configurations, each containing:
            id, name, vertical, version, status, description, config, stats,
            created_at, updated_at
        """
        start = time.perf_counter()
        params = {}

        try:
            qdrant = _get_qdrant_client()

            results, _ = qdrant.scroll(
                collection_name="brains",
                limit=100,
                with_payload=True,
            )

            output = [{"id": str(point.id), **point.payload} for point in results]

            log_tool_result("list_brains", params, output, start)
            return output

        except Exception as e:
            log_tool_error("list_brains", params, e, start)
            _handle_qdrant_error(e)
