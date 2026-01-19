"""
Collection Evaluator

Evaluates multiple collections and aggregates results.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import asyncio

import structlog

from ..config import EvaluationConfig, COLLECTION_THRESHOLDS
from ..datasets.loader import load_golden_dataset, GoldenDataset
from .qdrant_evaluator import QdrantRAGEvaluator, EvaluationResult

logger = structlog.get_logger()


@dataclass
class AggregatedResults:
    """Aggregated results across all collections."""

    collection_results: list[EvaluationResult]
    total_test_cases: int
    overall_passed: bool
    collections_passed: int
    collections_failed: int
    total_duration_seconds: float

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "total_test_cases": self.total_test_cases,
            "overall_passed": self.overall_passed,
            "collections_passed": self.collections_passed,
            "collections_failed": self.collections_failed,
            "total_duration_seconds": self.total_duration_seconds,
            "collections": [
                {
                    "name": r.collection_name,
                    "metrics": r.metrics.to_dict(),
                    "test_cases": r.test_cases_evaluated,
                    "passed": r.passed,
                    "failures": r.failures,
                    "duration_seconds": r.duration_seconds,
                    "error": r.error,
                }
                for r in self.collection_results
            ],
        }


class CollectionEvaluator:
    """
    Evaluates multiple Qdrant collections.

    Provides batch evaluation and result aggregation.
    """

    def __init__(
        self,
        config: EvaluationConfig,
        datasets_dir: Optional[str | Path] = None,
    ):
        """
        Initialize the collection evaluator.

        Args:
            config: Evaluation configuration
            datasets_dir: Directory containing golden datasets
        """
        self.config = config
        self.evaluator = QdrantRAGEvaluator(config)

        # Default to package datasets directory
        if datasets_dir is None:
            datasets_dir = Path(__file__).parent.parent / "datasets"
        self.datasets_dir = Path(datasets_dir)

    async def evaluate_collection(
        self,
        collection_name: str,
        brain_id: Optional[str] = None,
        golden_dataset: Optional[GoldenDataset] = None,
    ) -> EvaluationResult:
        """
        Evaluate a single collection.

        Args:
            collection_name: Collection to evaluate
            brain_id: Optional brain filter
            golden_dataset: Optional pre-loaded dataset

        Returns:
            EvaluationResult
        """
        # Load golden dataset if not provided
        if golden_dataset is None:
            collection_config = self.config.get_collection_config(collection_name)

            if collection_config.golden_dataset_path:
                dataset_path = self.datasets_dir / collection_config.golden_dataset_path.replace(
                    "datasets/", ""
                )
            else:
                dataset_path = self.datasets_dir / f"{collection_name}_golden.json"

            try:
                golden_dataset = load_golden_dataset(
                    dataset_path,
                    max_samples=self.config.max_samples,
                )
            except FileNotFoundError:
                logger.warning(
                    "Golden dataset not found",
                    collection=collection_name,
                    path=str(dataset_path),
                )
                return EvaluationResult(
                    collection_name=collection_name,
                    metrics=None,
                    test_cases_evaluated=0,
                    passed=False,
                    failures=["Golden dataset not found"],
                    duration_seconds=0,
                    error=f"Golden dataset not found: {dataset_path}",
                )

        return await self.evaluator.evaluate_collection(
            collection_name=collection_name,
            golden_dataset=golden_dataset,
            brain_id=brain_id,
        )

    async def evaluate_all(
        self,
        collection_names: Optional[list[str]] = None,
        brain_id: Optional[str] = None,
    ) -> AggregatedResults:
        """
        Evaluate all specified collections.

        Args:
            collection_names: Collections to evaluate (defaults to all configured)
            brain_id: Optional brain filter for all collections

        Returns:
            AggregatedResults with all collection results
        """
        import time

        start_time = time.time()

        # Default to all configured collections
        if collection_names is None:
            collection_names = list(COLLECTION_THRESHOLDS.keys())

        logger.info(
            "Starting batch evaluation",
            collections=collection_names,
            brain_id=brain_id,
        )

        # Evaluate each collection
        results = []
        for collection_name in collection_names:
            logger.info("Evaluating collection", collection=collection_name)
            result = await self.evaluate_collection(
                collection_name=collection_name,
                brain_id=brain_id,
            )
            results.append(result)

        # Aggregate results
        total_test_cases = sum(r.test_cases_evaluated for r in results)
        collections_passed = sum(1 for r in results if r.passed)
        collections_failed = len(results) - collections_passed
        overall_passed = collections_failed == 0
        total_duration = time.time() - start_time

        aggregated = AggregatedResults(
            collection_results=results,
            total_test_cases=total_test_cases,
            overall_passed=overall_passed,
            collections_passed=collections_passed,
            collections_failed=collections_failed,
            total_duration_seconds=total_duration,
        )

        logger.info(
            "Batch evaluation completed",
            overall_passed=overall_passed,
            collections_passed=collections_passed,
            collections_failed=collections_failed,
            total_duration_seconds=total_duration,
        )

        return aggregated


async def evaluate_collections(
    config: EvaluationConfig,
    collection_names: Optional[list[str]] = None,
    brain_id: Optional[str] = None,
    datasets_dir: Optional[str | Path] = None,
) -> AggregatedResults:
    """
    Convenience function to evaluate collections.

    Args:
        config: Evaluation configuration
        collection_names: Collections to evaluate
        brain_id: Optional brain filter
        datasets_dir: Directory containing golden datasets

    Returns:
        AggregatedResults
    """
    evaluator = CollectionEvaluator(
        config=config,
        datasets_dir=datasets_dir,
    )
    return await evaluator.evaluate_all(
        collection_names=collection_names,
        brain_id=brain_id,
    )
