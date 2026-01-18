"""Pydantic models for Qdrant MCP tools.

Data models for tool inputs, outputs, and internal data structures.
All models enforce `brain_id` filtering for vertical isolation.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, Field, model_validator


# =============================================================================
# Branded Types
# =============================================================================

# Pattern: brain_{vertical}_v{version}
BRAIN_ID_PATTERN = re.compile(r"^brain_[a-z]+_v\d+$")

BrainId = Annotated[str, Field(pattern=r"^brain_[a-z]+_v\d+$")]


def validate_brain_id(value: str) -> bool:
    """Validate brain_id format."""
    return bool(BRAIN_ID_PATTERN.match(value))


# =============================================================================
# Enums
# =============================================================================


class ICPCategory(StrEnum):
    """ICP rule categories."""

    FIRMOGRAPHIC = "firmographic"
    TECHNOGRAPHIC = "technographic"
    BEHAVIORAL = "behavioral"
    INTENT = "intent"


class ReplyType(StrEnum):
    """Response template reply types."""

    POSITIVE_INTEREST = "positive_interest"
    PRICING_QUESTION = "pricing_question"
    TIMELINE_QUESTION = "timeline_question"
    FEATURE_QUESTION = "feature_question"
    INTEGRATION_QUESTION = "integration_question"
    TIMING_OBJECTION = "timing_objection"
    BUDGET_OBJECTION = "budget_objection"
    COMPETITOR_MENTION = "competitor_mention"
    REFERRAL = "referral"
    UNSUBSCRIBE = "unsubscribe"
    NEGATIVE = "negative"


class ObjectionType(StrEnum):
    """Objection handler types."""

    PRICING = "pricing"
    TIMING = "timing"
    COMPETITOR = "competitor"
    AUTHORITY = "authority"
    NEED = "need"
    TRUST = "trust"


class InsightCategory(StrEnum):
    """Insight categories."""

    BUYING_PROCESS = "buying_process"
    PAIN_POINT = "pain_point"
    OBJECTION = "objection"
    COMPETITIVE_INTEL = "competitive_intel"
    MESSAGING_EFFECTIVENESS = "messaging_effectiveness"
    ICP_SIGNAL = "icp_signal"


class Importance(StrEnum):
    """Importance levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ValidationStatus(StrEnum):
    """Insight validation status."""

    PENDING = "pending"
    VALIDATED = "validated"
    REJECTED = "rejected"


class BrainStatus(StrEnum):
    """Brain status values."""

    ACTIVE = "active"
    DRAFT = "draft"
    ARCHIVED = "archived"


class ContentType(StrEnum):
    """Market research content types."""

    MARKET_OVERVIEW = "market_overview"
    COMPETITOR_ANALYSIS = "competitor_analysis"
    BUYER_PERSONA = "buyer_persona"
    PAIN_POINTS = "pain_points"
    TRENDS = "trends"
    CASE_STUDY = "case_study"


# =============================================================================
# Tool Input Models
# =============================================================================


class QueryICPRulesInput(BaseModel):
    """Input for query_icp_rules tool."""

    brain_id: str = Field(
        ...,
        description="Brain ID to scope the query (required for vertical isolation)",
    )
    query: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="Semantic search query to match against ICP rules",
    )
    category: ICPCategory | None = Field(
        default=None,
        description="Optional filter by ICP category",
    )
    limit: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of rules to return",
    )


class GetResponseTemplateInput(BaseModel):
    """Input for get_response_template tool."""

    brain_id: str = Field(
        ...,
        description="Brain ID to scope the query",
    )
    reply_type: ReplyType = Field(
        ...,
        description="Type of reply to get templates for",
    )
    tier: int | None = Field(
        default=None,
        ge=1,
        le=3,
        description="Optional tier filter (1=auto-send, 2=draft, 3=human only)",
    )
    auto_send_only: bool = Field(
        default=False,
        description="Shortcut filter for tier=1 templates only (overrides tier)",
    )


class FindObjectionHandlerInput(BaseModel):
    """Input for find_objection_handler tool."""

    brain_id: str = Field(
        ...,
        description="Brain ID to scope the query",
    )
    objection_text: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="The objection text to find a handler for",
    )


class SearchMarketResearchInput(BaseModel):
    """Input for search_market_research tool."""

    brain_id: str = Field(
        ...,
        description="Brain ID to scope the query",
    )
    query: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="Semantic search query",
    )
    content_type: ContentType | None = Field(
        default=None,
        description="Optional filter by content type",
    )
    limit: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Maximum documents to return",
    )


class SourceMetadata(BaseModel):
    """Source provenance for insights."""

    type: str = Field(
        ...,
        description="Source type (call_transcript, email_reply, linkedin_message, manual_entry)",
    )
    id: str = Field(
        ...,
        description="Source ID (e.g., call_id, email_id)",
    )
    lead_id: str | None = Field(
        default=None,
        description="Associated lead ID",
    )
    company_name: str | None = Field(
        default=None,
        description="Company name for context",
    )
    extracted_quote: str | None = Field(
        default=None,
        description="Direct quote from conversation",
    )


class AddInsightInput(BaseModel):
    """Input for add_insight tool."""

    brain_id: str = Field(
        ...,
        description="Brain ID to add the insight to",
    )
    content: str = Field(
        ...,
        min_length=10,
        max_length=5000,
        description="The insight content",
    )
    category: InsightCategory = Field(
        ...,
        description="Insight category",
    )
    importance: Importance = Field(
        default=Importance.MEDIUM,
        description="Importance level",
    )
    source: SourceMetadata = Field(
        ...,
        description="Source provenance metadata",
    )


class GetBrainInput(BaseModel):
    """Input for get_brain tool."""

    brain_id: str | None = Field(
        default=None,
        description="Specific brain ID to fetch",
    )
    vertical: str | None = Field(
        default=None,
        description="Fetch active brain by vertical name",
    )

    @model_validator(mode="after")
    def validate_one_of(self) -> Self:
        """Ensure at least one identifier is provided, or return default."""
        # Both None is valid - returns default active brain
        return self


# =============================================================================
# Tool Output Models
# =============================================================================


class ICPRuleResult(BaseModel):
    """ICP rule from query results."""

    id: str
    score: float = Field(ge=0, le=1, description="Relevance score")
    category: ICPCategory
    attribute: str
    display_name: str
    condition: dict
    score_weight: int = Field(ge=0, le=100)
    is_knockout: bool = False
    reasoning: str


class ResponseTemplateResult(BaseModel):
    """Response template from query results."""

    id: str
    reply_type: ReplyType
    tier: int = Field(ge=1, le=3)
    template_text: str
    variables: list[str]
    personalization_instructions: str | None = None


class ObjectionHandlerResult(BaseModel):
    """Objection handler with confidence score."""

    id: str
    confidence: float = Field(ge=0, le=1)
    objection_type: ObjectionType
    handler_strategy: str
    handler_response: str
    variables: list[str]
    follow_up_actions: list[str]


class MarketResearchResult(BaseModel):
    """Market research document from search."""

    id: str
    score: float = Field(ge=0, le=1)
    content_type: ContentType
    title: str
    content: str
    key_facts: list[str]
    source_url: str | None = None


class AddInsightResult(BaseModel):
    """Result of add_insight operation."""

    status: str = Field(description="created | duplicate | rejected")
    id: str | None = Field(default=None, description="Created insight ID")
    existing_id: str | None = Field(
        default=None, description="Existing insight ID if duplicate"
    )
    reason: str | None = Field(default=None, description="Rejection or duplicate reason")
    needs_validation: bool = Field(
        default=False, description="Whether human validation required"
    )
    confidence: float | None = Field(
        default=None, description="Calculated confidence score"
    )


class BrainConfig(BaseModel):
    """Brain configuration settings."""

    default_tier_thresholds: dict[str, int]
    auto_response_enabled: bool
    learning_enabled: bool
    quality_gate_threshold: float


class BrainStats(BaseModel):
    """Brain statistics."""

    icp_rules_count: int
    templates_count: int
    handlers_count: int
    research_docs_count: int
    insights_count: int


class BrainResult(BaseModel):
    """Brain configuration from get_brain/list_brains."""

    id: str
    name: str
    vertical: str
    version: str
    status: BrainStatus
    description: str
    config: BrainConfig
    stats: BrainStats
    created_at: str
    updated_at: str


# =============================================================================
# Internal Models
# =============================================================================


class EmbeddingRequest(BaseModel):
    """Internal model for embedding requests."""

    texts: list[str] = Field(..., min_length=1, max_length=100)
    input_type: str = Field(default="query", pattern="^(query|document)$")


class ToolInvocationLog(BaseModel):
    """Structured log entry for tool invocations (FR-008)."""

    tool: str
    params: dict
    result_count: int
    latency_ms: float
    error_type: str | None = None
    timestamp: str  # ISO format


class QualityGateResult(BaseModel):
    """Result of quality gate checks for insights."""

    passed: bool
    confidence_score: float
    is_duplicate: bool
    duplicate_id: str | None = None
    similarity_score: float | None = None
    requires_validation: bool
    rejection_reason: str | None = None
