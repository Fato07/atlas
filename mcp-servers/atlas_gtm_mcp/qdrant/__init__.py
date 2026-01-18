"""Qdrant MCP tools for Knowledge Base operations."""

import os
from typing import Optional

from fastmcp import FastMCP
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
import voyageai

# Initialize clients
qdrant = QdrantClient(
    host=os.getenv("QDRANT_HOST", "localhost"),
    port=int(os.getenv("QDRANT_PORT", "6333")),
)
voyage = voyageai.Client(api_key=os.getenv("VOYAGE_API_KEY"))


class ICPRule(BaseModel):
    """ICP rule from Knowledge Base."""
    id: str
    category: str
    attribute: str
    condition: dict
    score_weight: int
    reasoning: str
    is_knockout: bool = False


class KBMatch(BaseModel):
    """Knowledge Base search result."""
    id: str
    content: str
    score: float
    metadata: dict


def embed_query(text: str) -> list[float]:
    """Generate embedding for a query using Voyage AI."""
    result = voyage.embed(
        texts=[text],
        model="voyage-3.5-lite",
        input_type="query",
    )
    return result.embeddings[0]


def register_qdrant_tools(mcp: FastMCP) -> None:
    """Register all Qdrant/KB tools with the MCP server."""

    @mcp.tool()
    async def query_icp_rules(
        brain_id: str,
        query: str,
        limit: int = 10,
    ) -> list[dict]:
        """
        Query ICP rules from the Knowledge Base.

        Args:
            brain_id: The brain ID to scope the query (REQUIRED)
            query: Semantic search query
            limit: Maximum number of rules to return

        Returns:
            List of matching ICP rules with scores
        """
        query_vector = embed_query(query)

        results = qdrant.search(
            collection_name="icp_rules",
            query_vector=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
            ),
            limit=limit,
        )

        return [
            {
                "id": hit.id,
                "score": hit.score,
                **hit.payload,
            }
            for hit in results
        ]

    @mcp.tool()
    async def get_response_template(
        brain_id: str,
        reply_type: str,
        tier: Optional[int] = None,
    ) -> Optional[dict]:
        """
        Get a response template from the Knowledge Base.

        Args:
            brain_id: The brain ID to scope the query (REQUIRED)
            reply_type: Type of reply (positive, objection, question, etc.)
            tier: Optional tier filter (1, 2, or 3)

        Returns:
            Best matching template or None
        """
        must_conditions = [
            FieldCondition(key="brain_id", match=MatchValue(value=brain_id)),
            FieldCondition(key="reply_type", match=MatchValue(value=reply_type)),
        ]

        if tier is not None:
            must_conditions.append(
                FieldCondition(key="tier", match=MatchValue(value=tier))
            )

        results = qdrant.scroll(
            collection_name="response_templates",
            scroll_filter=Filter(must=must_conditions),
            limit=1,
        )

        points, _ = results
        if points:
            return {"id": points[0].id, **points[0].payload}
        return None

    @mcp.tool()
    async def find_objection_handler(
        brain_id: str,
        objection_text: str,
        limit: int = 3,
    ) -> list[dict]:
        """
        Find matching objection handlers using semantic search.

        Args:
            brain_id: The brain ID to scope the query (REQUIRED)
            objection_text: The objection text to match against
            limit: Maximum handlers to return

        Returns:
            List of matching handlers with confidence scores
        """
        query_vector = embed_query(objection_text)

        results = qdrant.search(
            collection_name="objection_handlers",
            query_vector=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
            ),
            limit=limit,
        )

        return [
            {
                "id": hit.id,
                "confidence": hit.score,
                "objection_type": hit.payload.get("objection_type"),
                "handler_template": hit.payload.get("handler_template"),
                "notes": hit.payload.get("notes"),
            }
            for hit in results
        ]

    @mcp.tool()
    async def search_market_research(
        brain_id: str,
        query: str,
        limit: int = 5,
    ) -> list[dict]:
        """
        Search market research documents in the Knowledge Base.

        Args:
            brain_id: The brain ID to scope the query (REQUIRED)
            query: Semantic search query
            limit: Maximum documents to return

        Returns:
            List of relevant research documents
        """
        query_vector = embed_query(query)

        results = qdrant.search(
            collection_name="market_research",
            query_vector=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
            ),
            limit=limit,
        )

        return [
            {
                "id": hit.id,
                "score": hit.score,
                "title": hit.payload.get("title"),
                "content": hit.payload.get("content"),
                "source": hit.payload.get("source"),
            }
            for hit in results
        ]

    @mcp.tool()
    async def add_insight(
        brain_id: str,
        content: str,
        category: str,
        source_type: str,
        source_id: str,
        confidence: float,
        importance: str = "medium",
    ) -> dict:
        """
        Add a new insight to the Knowledge Base (with quality gate check).

        Args:
            brain_id: The brain ID to add the insight to (REQUIRED)
            content: The insight content
            category: Category (buying_process, pain_point, objection, competitive_intel, etc.)
            source_type: Source type (reply, meeting, research)
            source_id: ID of the source (reply_id, meeting_id, etc.)
            confidence: Confidence score (0.0 to 1.0)
            importance: Importance level (low, medium, high)

        Returns:
            Created insight with ID, or rejection reason
        """
        # Quality gate: minimum confidence
        if confidence < 0.7:
            return {
                "status": "rejected",
                "reason": f"Confidence {confidence} below threshold 0.7",
            }

        # Check for duplicates using semantic search
        query_vector = embed_query(content)
        similar = qdrant.search(
            collection_name="insights",
            query_vector=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="brain_id", match=MatchValue(value=brain_id))]
            ),
            limit=1,
            score_threshold=0.9,  # Very similar = duplicate
        )

        if similar:
            return {
                "status": "duplicate",
                "reason": "Similar insight already exists",
                "existing_id": similar[0].id,
            }

        # Generate embedding and insert
        content_vector = embed_query(content)  # Use same embedding for consistency

        import uuid
        insight_id = str(uuid.uuid4())

        qdrant.upsert(
            collection_name="insights",
            points=[
                {
                    "id": insight_id,
                    "vector": content_vector,
                    "payload": {
                        "brain_id": brain_id,
                        "content": content,
                        "category": category,
                        "source_type": source_type,
                        "source_id": source_id,
                        "confidence": confidence,
                        "importance": importance,
                        "validated": importance == "high",  # High importance needs validation
                    },
                }
            ],
        )

        return {
            "status": "created",
            "id": insight_id,
            "needs_validation": importance == "high",
        }

    @mcp.tool()
    async def get_brain(
        brain_id: Optional[str] = None,
        vertical: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Get a brain configuration.

        Args:
            brain_id: Specific brain ID to fetch
            vertical: Or fetch by vertical name

        Returns:
            Brain configuration or None
        """
        if brain_id:
            results = qdrant.scroll(
                collection_name="brains",
                scroll_filter=Filter(
                    must=[FieldCondition(key="id", match=MatchValue(value=brain_id))]
                ),
                limit=1,
            )
        elif vertical:
            results = qdrant.scroll(
                collection_name="brains",
                scroll_filter=Filter(
                    must=[
                        FieldCondition(key="vertical", match=MatchValue(value=vertical)),
                        FieldCondition(key="status", match=MatchValue(value="active")),
                    ]
                ),
                limit=1,
            )
        else:
            # Get default active brain
            results = qdrant.scroll(
                collection_name="brains",
                scroll_filter=Filter(
                    must=[FieldCondition(key="status", match=MatchValue(value="active"))]
                ),
                limit=1,
            )

        points, _ = results
        if points:
            return {"id": points[0].id, **points[0].payload}
        return None

    @mcp.tool()
    async def list_brains() -> list[dict]:
        """
        List all available brains.

        Returns:
            List of brain configurations
        """
        results = qdrant.scroll(
            collection_name="brains",
            limit=100,
        )

        points, _ = results
        return [{"id": p.id, **p.payload} for p in points]
