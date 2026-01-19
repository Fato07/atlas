"""
Ragas RAG Evaluation Module for Atlas GTM

Measures retrieval quality from Qdrant to ensure brain queries return relevant results.

Usage:
    python -m atlas_gtm_mcp.evaluation.cli evaluate --collection icp_rules --brain-id brain_test_v1
"""

from .config import EvaluationConfig, COLLECTION_THRESHOLDS
from .evaluators.qdrant_evaluator import QdrantRAGEvaluator, EvaluationResult, EvaluationMetrics
from .evaluators.collection_evaluator import CollectionEvaluator, AggregatedResults, evaluate_collections
from .datasets.loader import GoldenDataset, GoldenTestCase, load_golden_dataset
from .reporters.json_reporter import JSONReporter, save_json_report
from .reporters.langfuse_reporter import LangfuseReporter

__all__ = [
    # Config
    "EvaluationConfig",
    "COLLECTION_THRESHOLDS",
    # Evaluators
    "QdrantRAGEvaluator",
    "CollectionEvaluator",
    "EvaluationResult",
    "EvaluationMetrics",
    "AggregatedResults",
    "evaluate_collections",
    # Datasets
    "GoldenDataset",
    "GoldenTestCase",
    "load_golden_dataset",
    # Reporters
    "JSONReporter",
    "LangfuseReporter",
    "save_json_report",
]
