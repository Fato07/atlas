"""Vertical MCP tools for managing verticals and detection.

This module implements MCP tools for the Atlas GTM Vertical Registry:
- create_vertical: Create a new vertical with detection configuration
- list_verticals: List all verticals
- get_vertical: Get a vertical by slug
- update_vertical: Update vertical configuration
- delete_vertical: Delete a vertical (soft or hard delete)
- detect_vertical: Detect vertical using waterfall strategy
- link_brain_to_vertical: Link a brain to a vertical
"""

from __future__ import annotations

import os
import time
import re
from typing import TYPE_CHECKING

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue, PointStruct

from .models import (
    VerticalInput,
    VerticalUpdateInput,
    DetectionInput,
    DetectionMethod,
    DetectionSignal,
    DetectionResult,
    VerticalResponse,
    LinkBrainInput,
)

if TYPE_CHECKING:
    pass


# Collection name
VERTICALS_COLLECTION = "verticals"

# Vector dimension for voyage-3.5-lite
VECTOR_DIMENSION = 1024


def _get_qdrant_client() -> QdrantClient:
    """Get Qdrant client instance."""
    host = os.getenv("QDRANT_HOST", "localhost")
    port = os.getenv("QDRANT_PORT", "6333")
    api_key = os.getenv("QDRANT_API_KEY")

    return QdrantClient(
        url=f"http://{host}:{port}",
        api_key=api_key,
    )


def _handle_qdrant_error(e: Exception) -> None:
    """Convert Qdrant errors to ToolError."""
    error_type = type(e).__name__
    if "Connection" in error_type or "Timeout" in error_type:
        raise ToolError("Vertical registry unavailable, retry later") from e
    raise ToolError(f"Vertical registry error: {e}") from e


def _ensure_collection_exists(qdrant: QdrantClient) -> None:
    """Ensure the verticals collection exists."""
    try:
        collections = qdrant.get_collections()
        exists = any(c.name == VERTICALS_COLLECTION for c in collections.collections)

        if not exists:
            qdrant.create_collection(
                VERTICALS_COLLECTION,
                vectors_config={
                    "size": VECTOR_DIMENSION,
                    "distance": "Cosine",
                },
            )

            # Create payload indexes
            qdrant.create_payload_index(
                VERTICALS_COLLECTION,
                field_name="slug",
                field_schema="keyword",
            )
            qdrant.create_payload_index(
                VERTICALS_COLLECTION,
                field_name="is_active",
                field_schema="bool",
            )
            qdrant.create_payload_index(
                VERTICALS_COLLECTION,
                field_name="parent_id",
                field_schema="keyword",
            )
    except Exception as e:
        _handle_qdrant_error(e)


def _get_vertical_by_slug(qdrant: QdrantClient, slug: str) -> dict | None:
    """Get a vertical by its slug."""
    try:
        results, _ = qdrant.scroll(
            collection_name=VERTICALS_COLLECTION,
            scroll_filter=Filter(
                must=[FieldCondition(key="slug", match=MatchValue(value=slug.lower()))]
            ),
            limit=1,
            with_payload=True,
        )

        if not results:
            return None

        point = results[0]
        return {
            "id": str(point.id),
            **point.payload,
        }
    except Exception as e:
        _handle_qdrant_error(e)


def register_vertical_tools(mcp: FastMCP) -> None:
    """Register all vertical management tools with the MCP server."""

    # ==========================================================================
    # Create Vertical
    # ==========================================================================

    @mcp.tool()
    async def create_vertical(
        slug: str,
        name: str,
        description: str,
        parent_slug: str | None = None,
        industry_keywords: list[str] | None = None,
        title_keywords: list[str] | None = None,
        campaign_patterns: list[str] | None = None,
        aliases: list[str] | None = None,
        exclusion_keywords: list[str] | None = None,
        ai_fallback_threshold: float = 0.5,
        example_companies: list[str] | None = None,
        classification_prompt: str | None = None,
        is_active: bool = True,
    ) -> dict:
        """
        Create a new vertical in the registry with full detection configuration.

        Args:
            slug: Unique identifier slug (e.g., 'defense', 'fintech')
            name: Display name
            description: Description for AI classification context
            parent_slug: Parent vertical slug for hierarchy (optional)
            industry_keywords: Industry keywords for detection (optional)
            title_keywords: Title keywords for detection (optional)
            campaign_patterns: Campaign ID patterns with wildcards (optional)
            aliases: Aliases/synonyms for the vertical (optional)
            exclusion_keywords: Keywords to exclude from matching (optional)
            ai_fallback_threshold: Confidence threshold to trigger AI fallback (default: 0.5)
            example_companies: Example companies for AI classification (optional)
            classification_prompt: Custom AI prompt for this vertical (optional)
            is_active: Whether the vertical is active for detection (default: True)

        Returns:
            Created vertical with id, slug, name, and all configuration
        """
        try:
            # Validate slug format
            slug_lower = slug.lower()
            if not re.match(r"^[a-z][a-z0-9_-]*$", slug_lower):
                raise ToolError(
                    f"Invalid slug format: {slug}. "
                    "Must be lowercase, start with letter, alphanumeric with hyphens/underscores."
                )

            if len(slug_lower) < 2 or len(slug_lower) > 50:
                raise ToolError("Slug must be 2-50 characters")

            if len(name) < 1 or len(name) > 100:
                raise ToolError("Name must be 1-100 characters")

            if len(description) < 10:
                raise ToolError("Description must be at least 10 characters")

            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            # Check if slug already exists
            existing = _get_vertical_by_slug(qdrant, slug_lower)
            if existing:
                raise ToolError(f"Vertical with slug '{slug_lower}' already exists")

            # Resolve parent if provided
            parent_id = None
            level = 0
            if parent_slug:
                parent = _get_vertical_by_slug(qdrant, parent_slug)
                if not parent:
                    raise ToolError(f"Parent vertical not found: {parent_slug}")
                parent_id = parent["slug"]
                level = parent.get("level", 0) + 1

            # Generate point ID
            import uuid
            point_id = str(uuid.uuid4())

            timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            # Build payload
            payload = {
                "slug": slug_lower,
                "name": name,
                "description": description,
                "parent_id": parent_id,
                "level": level,
                "industry_keywords": industry_keywords or [],
                "title_keywords": title_keywords or [],
                "campaign_patterns": campaign_patterns or [],
                "detection_weights": {
                    "industry": 0.9,
                    "title": 0.5,
                    "campaign": 0.7,
                },
                "aliases": aliases or [],
                "exclusion_keywords": exclusion_keywords or [],
                "ai_fallback_threshold": ai_fallback_threshold,
                "example_companies": example_companies or [],
                "classification_prompt": classification_prompt,
                "default_brain_id": None,
                "is_active": is_active,
                "created_at": timestamp,
                "updated_at": timestamp,
                "version": 1,
            }

            # Use zero vector (in production, embed the description)
            vector = [0.0] * VECTOR_DIMENSION

            qdrant.upsert(
                collection_name=VERTICALS_COLLECTION,
                points=[
                    PointStruct(
                        id=point_id,
                        vector=vector,
                        payload=payload,
                    )
                ],
            )

            return {
                "id": point_id,
                **payload,
                "message": f"Vertical '{name}' created with slug '{slug_lower}'",
            }

        except ToolError:
            raise
        except Exception as e:
            _handle_qdrant_error(e)

    # ==========================================================================
    # List Verticals
    # ==========================================================================

    @mcp.tool()
    async def list_verticals(
        include_inactive: bool = False,
    ) -> list[dict]:
        """
        List all verticals with their detection configuration.

        Args:
            include_inactive: Include inactive verticals (default: False)

        Returns:
            List of all verticals with full configuration
        """
        try:
            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            # Build filter
            filter_conditions = []
            if not include_inactive:
                filter_conditions.append(
                    FieldCondition(key="is_active", match=MatchValue(value=True))
                )

            scroll_filter = Filter(must=filter_conditions) if filter_conditions else None

            results, _ = qdrant.scroll(
                collection_name=VERTICALS_COLLECTION,
                scroll_filter=scroll_filter,
                limit=100,
                with_payload=True,
            )

            return [
                {
                    "id": str(point.id),
                    **point.payload,
                }
                for point in results
            ]

        except Exception as e:
            _handle_qdrant_error(e)

    # ==========================================================================
    # Get Vertical
    # ==========================================================================

    @mcp.tool()
    async def get_vertical(slug: str) -> dict | None:
        """
        Get a single vertical by its slug.

        Args:
            slug: The vertical slug to look up

        Returns:
            Vertical configuration or None if not found
        """
        try:
            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            return _get_vertical_by_slug(qdrant, slug)

        except Exception as e:
            _handle_qdrant_error(e)

    # ==========================================================================
    # Update Vertical
    # ==========================================================================

    @mcp.tool()
    async def update_vertical(
        slug: str,
        name: str | None = None,
        description: str | None = None,
        industry_keywords: list[str] | None = None,
        title_keywords: list[str] | None = None,
        campaign_patterns: list[str] | None = None,
        aliases: list[str] | None = None,
        exclusion_keywords: list[str] | None = None,
        ai_fallback_threshold: float | None = None,
        example_companies: list[str] | None = None,
        classification_prompt: str | None = None,
        is_active: bool | None = None,
    ) -> dict:
        """
        Update vertical configuration (keywords, examples, description).

        Args:
            slug: The vertical slug to update
            name: New display name (optional)
            description: New description (optional)
            industry_keywords: New industry keywords (optional)
            title_keywords: New title keywords (optional)
            campaign_patterns: New campaign patterns (optional)
            aliases: New aliases (optional)
            exclusion_keywords: New exclusion keywords (optional)
            ai_fallback_threshold: New AI threshold (optional)
            example_companies: New example companies (optional)
            classification_prompt: New classification prompt (optional)
            is_active: New active status (optional)

        Returns:
            Updated vertical configuration
        """
        try:
            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            existing = _get_vertical_by_slug(qdrant, slug)
            if not existing:
                raise ToolError(f"Vertical not found: {slug}")

            # Build update payload
            timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            update_payload = {
                "updated_at": timestamp,
                "version": existing.get("version", 0) + 1,
            }

            if name is not None:
                update_payload["name"] = name
            if description is not None:
                update_payload["description"] = description
            if industry_keywords is not None:
                update_payload["industry_keywords"] = industry_keywords
            if title_keywords is not None:
                update_payload["title_keywords"] = title_keywords
            if campaign_patterns is not None:
                update_payload["campaign_patterns"] = campaign_patterns
            if aliases is not None:
                update_payload["aliases"] = aliases
            if exclusion_keywords is not None:
                update_payload["exclusion_keywords"] = exclusion_keywords
            if ai_fallback_threshold is not None:
                update_payload["ai_fallback_threshold"] = ai_fallback_threshold
            if example_companies is not None:
                update_payload["example_companies"] = example_companies
            if classification_prompt is not None:
                update_payload["classification_prompt"] = classification_prompt
            if is_active is not None:
                update_payload["is_active"] = is_active

            qdrant.set_payload(
                collection_name=VERTICALS_COLLECTION,
                points=[existing["id"]],
                payload=update_payload,
            )

            # Return updated vertical
            return {
                **existing,
                **update_payload,
                "message": f"Vertical '{slug}' updated",
            }

        except ToolError:
            raise
        except Exception as e:
            _handle_qdrant_error(e)

    # ==========================================================================
    # Delete Vertical
    # ==========================================================================

    @mcp.tool()
    async def delete_vertical(
        slug: str,
        hard_delete: bool = False,
    ) -> dict:
        """
        Delete a vertical (with safeguards).

        By default, performs a soft delete (sets is_active=False).
        Use hard_delete=True to permanently remove the vertical.

        Args:
            slug: The vertical slug to delete
            hard_delete: Permanently remove instead of soft delete (default: False)

        Returns:
            Deletion result with status
        """
        try:
            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            existing = _get_vertical_by_slug(qdrant, slug)
            if not existing:
                raise ToolError(f"Vertical not found: {slug}")

            # Check if vertical has linked brain
            if existing.get("default_brain_id"):
                raise ToolError(
                    f"Cannot delete vertical '{slug}' - it has a linked brain. "
                    "Unlink the brain first."
                )

            if hard_delete:
                qdrant.delete(
                    collection_name=VERTICALS_COLLECTION,
                    points_selector=[existing["id"]],
                )
                return {
                    "slug": slug,
                    "action": "hard_delete",
                    "message": f"Vertical '{slug}' permanently deleted",
                }
            else:
                # Soft delete
                timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                qdrant.set_payload(
                    collection_name=VERTICALS_COLLECTION,
                    points=[existing["id"]],
                    payload={
                        "is_active": False,
                        "updated_at": timestamp,
                    },
                )
                return {
                    "slug": slug,
                    "action": "soft_delete",
                    "message": f"Vertical '{slug}' deactivated (soft delete)",
                }

        except ToolError:
            raise
        except Exception as e:
            _handle_qdrant_error(e)

    # ==========================================================================
    # Detect Vertical
    # ==========================================================================

    @mcp.tool()
    async def detect_vertical(
        industry: str | None = None,
        title: str | None = None,
        campaign_id: str | None = None,
        company_name: str | None = None,
        vertical: str | None = None,
        use_ai_fallback: bool = False,
    ) -> dict:
        """
        Detect vertical using waterfall strategy. Returns vertical, confidence, method.

        Waterfall order:
        1. Explicit vertical field (confidence: 1.0)
        2. Industry keyword match (confidence: 0.9)
        3. Campaign pattern match (confidence: 0.7)
        4. Title keyword match (confidence: 0.5)
        5. AI classification (if enabled, confidence: 0.6+)
        6. Default fallback (confidence: 0.1)

        Args:
            industry: Industry field from lead
            title: Job title from lead
            campaign_id: Campaign ID for pattern matching
            company_name: Company name for AI context
            vertical: Explicit vertical field (highest priority)
            use_ai_fallback: Enable AI classification for ambiguous cases (default: False)

        Returns:
            Detection result with vertical, confidence, method, and signals
        """
        try:
            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            signals = []
            default_vertical = "saas"

            # Get all active verticals
            results, _ = qdrant.scroll(
                collection_name=VERTICALS_COLLECTION,
                scroll_filter=Filter(
                    must=[FieldCondition(key="is_active", match=MatchValue(value=True))]
                ),
                limit=100,
                with_payload=True,
            )

            if not results:
                # No verticals in database, return default
                return {
                    "vertical": default_vertical,
                    "confidence": 0.1,
                    "method": DetectionMethod.DEFAULT.value,
                    "signals": [],
                    "message": "No verticals configured, using default",
                }

            # Build detection index
            industry_to_vertical = {}
            title_to_vertical = {}
            campaign_to_vertical = {}
            alias_to_vertical = {}
            exclusions = {}

            for point in results:
                payload = point.payload
                v_slug = payload.get("slug", "")

                # Index industry keywords
                for kw in payload.get("industry_keywords", []):
                    industry_to_vertical[kw.lower()] = v_slug

                # Index title keywords
                for kw in payload.get("title_keywords", []):
                    title_to_vertical[kw.lower()] = v_slug

                # Index campaign patterns
                for pattern in payload.get("campaign_patterns", []):
                    campaign_to_vertical[pattern.lower()] = v_slug

                # Index aliases
                for alias in payload.get("aliases", []):
                    alias_to_vertical[alias.lower()] = v_slug

                # Index exclusions
                excl_list = payload.get("exclusion_keywords", [])
                if excl_list:
                    exclusions[v_slug] = set(kw.lower() for kw in excl_list)

            # 1. Explicit vertical check
            if vertical and vertical.strip():
                v_lower = vertical.lower()
                matched = alias_to_vertical.get(v_lower, v_lower)
                signals.append({
                    "attribute": "vertical",
                    "value": vertical,
                    "matched_vertical": matched,
                    "weight": 1.0,
                })
                return {
                    "vertical": matched,
                    "confidence": 1.0,
                    "method": DetectionMethod.EXPLICIT.value,
                    "signals": signals,
                }

            # 2. Industry keyword match
            if industry:
                industry_lower = industry.lower()
                for kw, v_slug in industry_to_vertical.items():
                    if kw in industry_lower or industry_lower in kw:
                        # Check exclusions
                        excl_set = exclusions.get(v_slug, set())
                        excluded = any(ex in industry_lower for ex in excl_set)
                        if not excluded:
                            signals.append({
                                "attribute": "industry",
                                "value": industry,
                                "matched_vertical": v_slug,
                                "weight": 0.9,
                                "matched_keyword": kw,
                            })
                            return {
                                "vertical": v_slug,
                                "confidence": 0.9,
                                "method": DetectionMethod.INDUSTRY.value,
                                "signals": signals,
                            }

            # 3. Campaign pattern match
            if campaign_id:
                campaign_lower = campaign_id.lower()
                for pattern, v_slug in campaign_to_vertical.items():
                    # Convert glob pattern to regex
                    regex_pattern = pattern.replace("*", ".*").replace("?", ".")
                    import re as regex_module
                    if regex_module.match(f"^{regex_pattern}$", campaign_lower, regex_module.IGNORECASE):
                        signals.append({
                            "attribute": "campaign",
                            "value": campaign_id,
                            "matched_vertical": v_slug,
                            "weight": 0.7,
                            "matched_keyword": pattern,
                        })
                        return {
                            "vertical": v_slug,
                            "confidence": 0.7,
                            "method": DetectionMethod.CAMPAIGN.value,
                            "signals": signals,
                        }

            # 4. Title keyword match
            if title:
                title_lower = title.lower()
                for kw, v_slug in title_to_vertical.items():
                    if kw in title_lower:
                        signals.append({
                            "attribute": "title",
                            "value": title,
                            "matched_vertical": v_slug,
                            "weight": 0.5,
                            "matched_keyword": kw,
                        })
                        return {
                            "vertical": v_slug,
                            "confidence": 0.5,
                            "method": DetectionMethod.TITLE.value,
                            "signals": signals,
                        }

            # 5. AI classification (not implemented in MCP, return info)
            if use_ai_fallback:
                return {
                    "vertical": default_vertical,
                    "confidence": 0.1,
                    "method": DetectionMethod.DEFAULT.value,
                    "signals": signals,
                    "message": "AI classification not available in MCP tools. Use TypeScript AI classifier for AI fallback.",
                }

            # 6. Default fallback
            signals.append({
                "attribute": "default",
                "value": "none",
                "matched_vertical": default_vertical,
                "weight": 0.1,
            })
            return {
                "vertical": default_vertical,
                "confidence": 0.1,
                "method": DetectionMethod.DEFAULT.value,
                "signals": signals,
            }

        except ToolError:
            raise
        except Exception as e:
            _handle_qdrant_error(e)

    # ==========================================================================
    # Link Brain to Vertical
    # ==========================================================================

    @mcp.tool()
    async def link_brain_to_vertical(
        vertical_slug: str,
        brain_id: str,
    ) -> dict:
        """
        Link a brain to a vertical.

        Args:
            vertical_slug: Slug of the vertical to link
            brain_id: ID of the brain to link

        Returns:
            Updated vertical with linked brain_id
        """
        try:
            qdrant = _get_qdrant_client()
            _ensure_collection_exists(qdrant)

            existing = _get_vertical_by_slug(qdrant, vertical_slug)
            if not existing:
                raise ToolError(f"Vertical not found: {vertical_slug}")

            # Update with brain_id
            timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            qdrant.set_payload(
                collection_name=VERTICALS_COLLECTION,
                points=[existing["id"]],
                payload={
                    "default_brain_id": brain_id,
                    "updated_at": timestamp,
                },
            )

            return {
                "vertical_slug": vertical_slug,
                "brain_id": brain_id,
                "message": f"Brain '{brain_id}' linked to vertical '{vertical_slug}'",
            }

        except ToolError:
            raise
        except Exception as e:
            _handle_qdrant_error(e)
