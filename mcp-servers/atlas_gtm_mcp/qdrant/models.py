"""Pydantic models for Qdrant MCP tools.

Data models for tool inputs, outputs, and internal data structures.
All models enforce `brain_id` filtering for vertical isolation.
"""

from __future__ import annotations

import hashlib
import re
import time
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, Field, model_validator


# =============================================================================
# Branded Types
# =============================================================================

# Pattern: brain_{vertical}_{timestamp} (e.g., brain_defense_1705590000000)
# Also supports legacy: brain_{vertical}_v{version} (e.g., brain_defense_v1)
BRAIN_ID_PATTERN = re.compile(r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$")

BrainId = Annotated[str, Field(pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$")]


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


# Valid status transitions: from_status -> [to_status, ...]
VALID_TRANSITIONS: dict[BrainStatus, list[BrainStatus]] = {
    BrainStatus.DRAFT: [BrainStatus.ACTIVE],
    BrainStatus.ACTIVE: [BrainStatus.ARCHIVED],
    BrainStatus.ARCHIVED: [BrainStatus.ACTIVE],
}


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
# Lifecycle Tool Input Models (003-brain-lifecycle)
# =============================================================================


class BrainConfigInput(BaseModel):
    """Optional brain configuration during creation."""

    default_tier_thresholds: dict[str, int] = Field(
        default={"tier1": 90, "tier2": 70, "tier3": 50},
        description="Score thresholds for response tiers",
    )
    auto_response_enabled: bool = Field(
        default=False,
        description="Enable automatic responses for tier 1",
    )
    learning_enabled: bool = Field(
        default=True,
        description="Enable insight learning from conversations",
    )
    quality_gate_threshold: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Minimum confidence for auto-responses",
    )


class CreateBrainInput(BaseModel):
    """Input for create_brain tool."""

    vertical: str = Field(
        ...,
        min_length=2,
        max_length=50,
        pattern=r"^[a-z][a-z0-9_-]*$",
        description="Vertical identifier (lowercase, alphanumeric with hyphens/underscores)",
    )
    name: str = Field(
        ...,
        min_length=3,
        max_length=100,
        description="Human-readable brain name",
    )
    description: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description="Brain description explaining its purpose",
    )
    config: BrainConfigInput | None = Field(
        default=None,
        description="Optional configuration (uses defaults if not provided)",
    )


class UpdateBrainStatusInput(BaseModel):
    """Input for update_brain_status tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Brain ID to update",
    )
    status: BrainStatus = Field(
        ...,
        description="New status (must be valid transition from current)",
    )


class DeleteBrainInput(BaseModel):
    """Input for delete_brain tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Brain ID to delete (must be draft or archived)",
    )
    confirm: bool = Field(
        default=False,
        description="Confirmation flag (must be true to proceed)",
    )


# =============================================================================
# Seeding Tool Input Models (003-brain-lifecycle)
# =============================================================================


class ICPRuleItem(BaseModel):
    """Single ICP rule for seeding."""

    name: str = Field(
        ...,
        min_length=3,
        max_length=100,
        description="Rule display name",
    )
    category: ICPCategory = Field(
        ...,
        description="Rule category (firmographic, technographic, behavioral, intent)",
    )
    attribute: str = Field(
        ...,
        min_length=2,
        max_length=100,
        description="Attribute being evaluated (e.g., 'company_size', 'technology_stack')",
    )
    criteria: str = Field(
        ...,
        min_length=10,
        max_length=1000,
        description="Rule criteria description for semantic matching",
    )
    weight: int = Field(
        ...,
        ge=1,
        le=100,
        description="Score weight (1-100)",
    )
    match_condition: dict = Field(
        ...,
        description="Structured condition for rule matching",
    )
    is_knockout: bool = Field(
        default=False,
        description="Whether this rule is a knockout criterion",
    )
    reasoning: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description="Explanation of why this rule matters",
    )


class SeedICPRulesInput(BaseModel):
    """Input for seed_icp_rules tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Target brain ID",
    )
    rules: list[ICPRuleItem] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="ICP rules to seed",
    )


class ResponseTemplateItem(BaseModel):
    """Single response template for seeding."""

    name: str = Field(
        ...,
        min_length=3,
        max_length=100,
        description="Template name",
    )
    intent: ReplyType = Field(
        ...,
        description="Reply type this template handles",
    )
    template_text: str = Field(
        ...,
        min_length=20,
        max_length=5000,
        description="Template text with {{variable}} placeholders",
    )
    variables: list[str] = Field(
        default=[],
        description="List of variable names used in template",
    )
    tier: int = Field(
        default=2,
        ge=1,
        le=3,
        description="Response tier (1=auto-send, 2=draft, 3=human only)",
    )
    personalization_instructions: str | None = Field(
        default=None,
        max_length=500,
        description="Instructions for personalizing the template",
    )


class SeedTemplatesInput(BaseModel):
    """Input for seed_templates tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Target brain ID",
    )
    templates: list[ResponseTemplateItem] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Response templates to seed",
    )


class ObjectionHandlerItem(BaseModel):
    """Single objection handler for seeding."""

    objection_text: str = Field(
        ...,
        min_length=10,
        max_length=1000,
        description="Example objection text for semantic matching",
    )
    objection_type: ObjectionType = Field(
        ...,
        description="Objection category",
    )
    response: str = Field(
        ...,
        min_length=20,
        max_length=3000,
        description="Handler response text",
    )
    category: str = Field(
        ...,
        min_length=2,
        max_length=50,
        description="Subcategory within objection type",
    )
    handler_strategy: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description="Strategy description for this handler",
    )
    variables: list[str] = Field(
        default=[],
        description="Variable placeholders in response",
    )
    follow_up_actions: list[str] = Field(
        default=[],
        description="Recommended follow-up actions",
    )


class SeedHandlersInput(BaseModel):
    """Input for seed_handlers tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Target brain ID",
    )
    handlers: list[ObjectionHandlerItem] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Objection handlers to seed",
    )


class MarketResearchItem(BaseModel):
    """Single market research document for seeding."""

    topic: str = Field(
        ...,
        min_length=5,
        max_length=200,
        description="Research topic/title",
    )
    content: str = Field(
        ...,
        min_length=50,
        max_length=20000,
        description="Research content",
    )
    content_type: ContentType = Field(
        ...,
        description="Type of research content",
    )
    source: str = Field(
        ...,
        min_length=3,
        max_length=200,
        description="Source attribution",
    )
    date: str = Field(
        ...,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Research date (YYYY-MM-DD)",
    )
    key_facts: list[str] = Field(
        default=[],
        description="Key facts extracted from research",
    )
    source_url: str | None = Field(
        default=None,
        description="Optional source URL",
    )


class SeedResearchInput(BaseModel):
    """Input for seed_research tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Target brain ID",
    )
    documents: list[MarketResearchItem] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Market research documents to seed (max 50 due to larger content size)",
    )


# =============================================================================
# Analytics Tool Input Models (003-brain-lifecycle)
# =============================================================================


class GetBrainStatsInput(BaseModel):
    """Input for get_brain_stats tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Brain ID to get stats for",
    )


class GetBrainReportInput(BaseModel):
    """Input for get_brain_report tool."""

    brain_id: str = Field(
        ...,
        pattern=r"^brain_[a-z][a-z0-9_-]*_(\d+|v\d+)$",
        description="Brain ID to generate report for",
    )


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
# Lifecycle Tool Output Models (003-brain-lifecycle)
# =============================================================================


class CreateBrainResult(BaseModel):
    """Result of create_brain operation."""

    brain_id: str = Field(
        ...,
        description="Generated brain ID",
    )
    status: str = Field(
        default="draft",
        description="Initial status (always 'draft')",
    )
    message: str = Field(
        ...,
        description="Success message",
    )


class UpdateBrainStatusResult(BaseModel):
    """Result of update_brain_status operation."""

    brain_id: str
    previous_status: BrainStatus
    new_status: BrainStatus
    deactivated_brain_id: str | None = Field(
        default=None,
        description="ID of brain that was deactivated (when activating)",
    )
    message: str


class DeleteBrainResult(BaseModel):
    """Result of delete_brain operation."""

    brain_id: str
    deleted_content: dict[str, int] = Field(
        ...,
        description="Count of deleted items per collection",
    )
    message: str


# =============================================================================
# Seeding Tool Output Models (003-brain-lifecycle)
# =============================================================================


class SeedingError(BaseModel):
    """Error detail for failed seeding item."""

    index: int = Field(
        ...,
        description="Index of failed item in input list",
    )
    name: str = Field(
        ...,
        description="Name/identifier of failed item",
    )
    error: str = Field(
        ...,
        description="Error message",
    )


class SeedingResult(BaseModel):
    """Result of any seeding operation."""

    brain_id: str
    collection: str = Field(
        ...,
        description="Target collection name",
    )
    seeded_count: int = Field(
        ge=0,
        description="Number of items successfully seeded",
    )
    errors: list[SeedingError] = Field(
        default=[],
        description="List of failed items with error details",
    )
    message: str


# =============================================================================
# Analytics Tool Output Models (003-brain-lifecycle)
# =============================================================================


class BrainStatsResult(BaseModel):
    """Result of get_brain_stats operation."""

    brain_id: str
    icp_rules_count: int = Field(ge=0)
    templates_count: int = Field(ge=0)
    handlers_count: int = Field(ge=0)
    research_docs_count: int = Field(ge=0)
    insights_count: int = Field(ge=0)


class ContentDetail(BaseModel):
    """Content stats with last updated timestamp."""

    collection: str
    count: int = Field(ge=0)
    last_updated: str | None = Field(
        ...,
        description="ISO timestamp or null if empty",
    )


class BrainReportResult(BaseModel):
    """Result of get_brain_report operation."""

    brain_id: str
    name: str
    vertical: str
    status: BrainStatus
    completeness: float = Field(
        ge=0.0,
        le=1.0,
        description="Content completeness (0.0-1.0, based on 4 content types)",
    )
    content_details: list[ContentDetail] = Field(
        ...,
        description="Per-collection stats with last updated timestamps",
    )
    created_at: str
    updated_at: str
    message: str


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


# =============================================================================
# Helper Functions (003-brain-lifecycle)
# =============================================================================


def generate_brain_id(vertical: str) -> str:
    """Generate unique brain ID in format brain_{vertical}_{timestamp}.

    Args:
        vertical: Vertical identifier (lowercase, alphanumeric with hyphens/underscores)

    Returns:
        Unique brain ID like 'brain_defense_1705590000000'
    """
    timestamp_ms = int(time.time() * 1000)
    return f"brain_{vertical}_{timestamp_ms}"


def validate_status_transition(current: BrainStatus, new: BrainStatus) -> bool:
    """Check if status transition is valid.

    Args:
        current: Current brain status
        new: Desired new status

    Returns:
        True if transition is valid, False otherwise

    Valid transitions:
        - draft -> active
        - active -> archived
        - archived -> active
    """
    return new in VALID_TRANSITIONS.get(current, [])


def calculate_completeness(stats: BrainStatsResult) -> float:
    """Calculate content completeness as percentage of content types present.

    Completeness is based on having at least 1 item in each of:
    - icp_rules
    - response_templates
    - objection_handlers
    - market_research

    insights are NOT required for completeness (auto-generated).

    Args:
        stats: Brain statistics with content counts

    Returns:
        Completeness as float (0.0, 0.25, 0.5, 0.75, or 1.0)
    """
    content_types = [
        stats.icp_rules_count,
        stats.templates_count,
        stats.handlers_count,
        stats.research_docs_count,
    ]
    present = sum(1 for count in content_types if count > 0)
    return present / len(content_types)


def generate_point_id(brain_id: str, key_field: str) -> str:
    """Generate deterministic point ID for upsert behavior.

    Creates a consistent UUID from brain_id + key_field composite,
    enabling upsert semantics (update if exists, create if new).

    Args:
        brain_id: Brain ID for scoping
        key_field: Unique key field (e.g., name, topic, objection_text)

    Returns:
        UUID string in format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        suitable for Qdrant point ID
    """
    composite_key = f"{brain_id}:{key_field}"
    hex_str = hashlib.sha256(composite_key.encode()).hexdigest()[:32]
    # Format as UUID: 8-4-4-4-12
    return f"{hex_str[:8]}-{hex_str[8:12]}-{hex_str[12:16]}-{hex_str[16:20]}-{hex_str[20:32]}"
