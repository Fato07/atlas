"""
Evaluation Configuration for Atlas GTM

Defines thresholds, collection configurations, and evaluation settings.
"""

from dataclasses import dataclass, field
from typing import Optional
import os


@dataclass
class MetricThresholds:
    """Thresholds for Ragas metrics."""

    context_precision: float = 0.80
    context_recall: float = 0.75
    context_relevance: float = 0.80
    faithfulness: float = 0.85


@dataclass
class CollectionConfig:
    """Configuration for a Qdrant collection evaluation."""

    name: str
    description: str
    thresholds: MetricThresholds = field(default_factory=MetricThresholds)
    golden_dataset_path: Optional[str] = None


# Default thresholds per collection type
COLLECTION_THRESHOLDS: dict[str, CollectionConfig] = {
    "icp_rules": CollectionConfig(
        name="icp_rules",
        description="ICP (Ideal Customer Profile) rules for lead scoring",
        thresholds=MetricThresholds(
            context_precision=0.85,  # Higher precision for scoring rules
            context_recall=0.80,
            context_relevance=0.80,
            faithfulness=0.85,
        ),
        golden_dataset_path="datasets/icp_rules_golden.json",
    ),
    "response_templates": CollectionConfig(
        name="response_templates",
        description="Email response templates for outreach",
        thresholds=MetricThresholds(
            context_precision=0.80,
            context_recall=0.75,
            context_relevance=0.85,  # Higher relevance for templates
            faithfulness=0.85,
        ),
        golden_dataset_path="datasets/templates_golden.json",
    ),
    "objection_handlers": CollectionConfig(
        name="objection_handlers",
        description="Objection handling scripts and responses",
        thresholds=MetricThresholds(
            context_precision=0.80,
            context_recall=0.80,  # Higher recall - don't miss objection patterns
            context_relevance=0.80,
            faithfulness=0.90,  # Higher faithfulness for accurate responses
        ),
        golden_dataset_path="datasets/handlers_golden.json",
    ),
    "market_research": CollectionConfig(
        name="market_research",
        description="Market research and industry insights",
        thresholds=MetricThresholds(
            context_precision=0.75,  # More lenient - research is broad
            context_recall=0.70,
            context_relevance=0.75,
            faithfulness=0.80,
        ),
        golden_dataset_path="datasets/research_golden.json",
    ),
}


@dataclass
class EvaluationConfig:
    """Main evaluation configuration."""

    # Qdrant settings
    qdrant_url: str = field(
        default_factory=lambda: os.getenv("QDRANT_URL", "http://localhost:6333")
    )
    qdrant_api_key: Optional[str] = field(
        default_factory=lambda: os.getenv("QDRANT_API_KEY")
    )

    # OpenAI settings (for Ragas evaluator LLM)
    openai_api_key: Optional[str] = field(
        default_factory=lambda: os.getenv("OPENAI_API_KEY")
    )
    evaluator_model: str = "gpt-4o-mini"  # Cost-effective for evaluation

    # Langfuse settings (for reporting)
    langfuse_public_key: Optional[str] = field(
        default_factory=lambda: os.getenv("LANGFUSE_PUBLIC_KEY")
    )
    langfuse_secret_key: Optional[str] = field(
        default_factory=lambda: os.getenv("LANGFUSE_SECRET_KEY")
    )
    langfuse_base_url: str = field(
        default_factory=lambda: os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com")
    )

    # Voyage AI settings (for embeddings)
    voyage_api_key: Optional[str] = field(
        default_factory=lambda: os.getenv("VOYAGE_API_KEY")
    )

    # Evaluation settings
    max_samples: int = 50  # Max test cases per collection
    batch_size: int = 10  # Batch size for evaluation
    timeout_seconds: int = 300  # Timeout per evaluation run
    fail_on_threshold: bool = True  # Fail if metrics below threshold

    # Collection configurations
    collections: dict[str, CollectionConfig] = field(
        default_factory=lambda: COLLECTION_THRESHOLDS.copy()
    )

    def get_collection_config(self, collection_name: str) -> CollectionConfig:
        """Get configuration for a specific collection."""
        if collection_name not in self.collections:
            # Return default config for unknown collections
            return CollectionConfig(
                name=collection_name,
                description=f"Unknown collection: {collection_name}",
            )
        return self.collections[collection_name]

    def validate(self) -> list[str]:
        """Validate configuration and return list of errors."""
        errors = []

        if not self.openai_api_key:
            errors.append("OPENAI_API_KEY is required for Ragas evaluation")

        if not self.voyage_api_key:
            errors.append("VOYAGE_API_KEY is required for embeddings")

        return errors


def load_config() -> EvaluationConfig:
    """Load evaluation configuration from environment."""
    return EvaluationConfig()
