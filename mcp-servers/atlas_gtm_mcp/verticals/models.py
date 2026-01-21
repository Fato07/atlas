"""Pydantic models for Vertical MCP tools."""

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class DetectionWeights(BaseModel):
    """Detection weight configuration for rule-based matching."""

    industry: float = Field(default=0.9, ge=0.0, le=1.0, description="Weight for industry keyword matches")
    title: float = Field(default=0.5, ge=0.0, le=1.0, description="Weight for title keyword matches")
    campaign: float = Field(default=0.7, ge=0.0, le=1.0, description="Weight for campaign pattern matches")


class VerticalInput(BaseModel):
    """Input for creating a new vertical."""

    slug: str = Field(..., min_length=1, max_length=50, description="Unique identifier slug (e.g., 'defense', 'fintech')")
    name: str = Field(..., min_length=1, max_length=100, description="Display name")
    description: str = Field(..., min_length=10, description="Description for AI classification context")

    # Optional fields with defaults
    parent_slug: Optional[str] = Field(default=None, description="Parent vertical slug for hierarchy")
    industry_keywords: list[str] = Field(default_factory=list, description="Industry keywords for detection")
    title_keywords: list[str] = Field(default_factory=list, description="Title keywords for detection")
    campaign_patterns: list[str] = Field(default_factory=list, description="Campaign ID patterns (supports wildcards)")
    detection_weights: DetectionWeights = Field(default_factory=DetectionWeights, description="Detection weights")
    aliases: list[str] = Field(default_factory=list, description="Aliases/synonyms for the vertical")
    exclusion_keywords: list[str] = Field(default_factory=list, description="Keywords to exclude from matching")
    ai_fallback_threshold: float = Field(default=0.5, ge=0.0, le=1.0, description="Confidence threshold to trigger AI fallback")
    example_companies: list[str] = Field(default_factory=list, description="Example companies for AI classification")
    classification_prompt: Optional[str] = Field(default=None, description="Custom AI prompt for this vertical")
    is_active: bool = Field(default=True, description="Whether the vertical is active for detection")


class VerticalUpdateInput(BaseModel):
    """Input for updating a vertical."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, min_length=10)
    parent_slug: Optional[str] = Field(default=None)
    industry_keywords: Optional[list[str]] = Field(default=None)
    title_keywords: Optional[list[str]] = Field(default=None)
    campaign_patterns: Optional[list[str]] = Field(default=None)
    detection_weights: Optional[DetectionWeights] = Field(default=None)
    aliases: Optional[list[str]] = Field(default=None)
    exclusion_keywords: Optional[list[str]] = Field(default=None)
    ai_fallback_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    example_companies: Optional[list[str]] = Field(default=None)
    classification_prompt: Optional[str] = Field(default=None)
    is_active: Optional[bool] = Field(default=None)


class DetectionInput(BaseModel):
    """Input for vertical detection."""

    industry: Optional[str] = Field(default=None, description="Industry field from lead")
    title: Optional[str] = Field(default=None, description="Job title from lead")
    campaign_id: Optional[str] = Field(default=None, description="Campaign ID for pattern matching")
    company_name: Optional[str] = Field(default=None, description="Company name for AI context")
    vertical: Optional[str] = Field(default=None, description="Explicit vertical field (highest priority)")
    use_ai_fallback: bool = Field(default=False, description="Enable AI classification for ambiguous cases")


class DetectionMethod(str, Enum):
    """Detection method used."""

    EXPLICIT = "explicit"
    INDUSTRY = "industry"
    TITLE = "title"
    CAMPAIGN = "campaign"
    AI = "ai"
    DEFAULT = "default"


class DetectionSignal(BaseModel):
    """Signal from detection."""

    attribute: str
    value: str
    matched_vertical: str
    weight: float
    matched_keyword: Optional[str] = None


class DetectionResult(BaseModel):
    """Result from vertical detection."""

    vertical: str
    confidence: float
    method: DetectionMethod
    signals: list[DetectionSignal]
    reasoning: Optional[str] = None


class VerticalResponse(BaseModel):
    """Response containing vertical data."""

    id: str
    slug: str
    name: str
    description: str
    level: int
    parent_id: Optional[str]
    industry_keywords: list[str]
    title_keywords: list[str]
    campaign_patterns: list[str]
    detection_weights: DetectionWeights
    aliases: list[str]
    exclusion_keywords: list[str]
    ai_fallback_threshold: float
    example_companies: list[str]
    classification_prompt: Optional[str]
    default_brain_id: Optional[str]
    is_active: bool
    version: int
    created_at: str
    updated_at: str


class LinkBrainInput(BaseModel):
    """Input for linking a brain to a vertical."""

    vertical_slug: str = Field(..., description="Slug of the vertical to link")
    brain_id: str = Field(..., description="ID of the brain to link")
