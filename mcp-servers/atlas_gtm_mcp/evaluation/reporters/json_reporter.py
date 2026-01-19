"""
JSON Reporter for RAG Evaluation

Outputs evaluation results to JSON format.
"""

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

import structlog

from ..evaluators.collection_evaluator import AggregatedResults
from ..evaluators.qdrant_evaluator import EvaluationResult

logger = structlog.get_logger()


class JSONReporter:
    """
    Formats and outputs evaluation results as JSON.

    Provides both file output and console output options.
    """

    def __init__(self, output_dir: Optional[str | Path] = None):
        """
        Initialize the JSON reporter.

        Args:
            output_dir: Directory to save reports (defaults to ./reports)
        """
        if output_dir is None:
            output_dir = Path.cwd() / "reports"
        self.output_dir = Path(output_dir)

    def format_result(self, result: EvaluationResult) -> dict:
        """
        Format a single evaluation result.

        Args:
            result: Evaluation result to format

        Returns:
            Dictionary representation
        """
        return {
            "collection_name": result.collection_name,
            "metrics": result.metrics.to_dict() if result.metrics else None,
            "test_cases_evaluated": result.test_cases_evaluated,
            "passed": result.passed,
            "failures": result.failures,
            "duration_seconds": result.duration_seconds,
            "error": result.error,
        }

    def format_aggregated(self, results: AggregatedResults) -> dict:
        """
        Format aggregated results from multiple collections.

        Args:
            results: Aggregated evaluation results

        Returns:
            Dictionary representation
        """
        return {
            "summary": {
                "total_test_cases": results.total_test_cases,
                "overall_passed": results.overall_passed,
                "collections_passed": results.collections_passed,
                "collections_failed": results.collections_failed,
                "total_duration_seconds": results.total_duration_seconds,
            },
            "collections": [
                self.format_result(r) for r in results.collection_results
            ],
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }

    def save_report(
        self,
        results: AggregatedResults | EvaluationResult,
        filename: Optional[str] = None,
    ) -> Path:
        """
        Save evaluation results to a JSON file.

        Args:
            results: Results to save
            filename: Custom filename (defaults to timestamped name)

        Returns:
            Path to saved report
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"rag_evaluation_{timestamp}.json"

        output_path = self.output_dir / filename

        if isinstance(results, AggregatedResults):
            data = self.format_aggregated(results)
        else:
            data = {
                "collection": self.format_result(results),
                "generated_at": datetime.utcnow().isoformat() + "Z",
            }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        logger.info(
            "Saved evaluation report",
            path=str(output_path),
            size_bytes=output_path.stat().st_size,
        )

        return output_path

    def print_summary(self, results: AggregatedResults) -> None:
        """
        Print a human-readable summary to console.

        Args:
            results: Aggregated results to summarize
        """
        print("\n" + "=" * 60)
        print("RAG EVALUATION SUMMARY")
        print("=" * 60)

        status = "✅ PASSED" if results.overall_passed else "❌ FAILED"
        print(f"\nOverall Status: {status}")
        print(f"Collections Passed: {results.collections_passed}/{len(results.collection_results)}")
        print(f"Total Test Cases: {results.total_test_cases}")
        print(f"Total Duration: {results.total_duration_seconds:.2f}s")

        print("\n" + "-" * 60)
        print("COLLECTION DETAILS")
        print("-" * 60)

        for result in results.collection_results:
            status_icon = "✅" if result.passed else "❌"
            print(f"\n{status_icon} {result.collection_name}")

            if result.metrics:
                metrics = result.metrics
                print(f"   Context Precision: {metrics.context_precision:.2%}")
                print(f"   Context Recall:    {metrics.context_recall:.2%}")
                print(f"   Faithfulness:      {metrics.faithfulness:.2%}")
                print(f"   Answer Relevancy:  {metrics.answer_relevancy:.2%}")

            if result.failures:
                print(f"   Failures:")
                for failure in result.failures:
                    print(f"     - {failure}")

            if result.error:
                print(f"   Error: {result.error}")

        print("\n" + "=" * 60)


def save_json_report(
    results: AggregatedResults | EvaluationResult,
    output_path: str | Path,
) -> Path:
    """
    Convenience function to save a JSON report.

    Args:
        results: Evaluation results
        output_path: Full path to output file

    Returns:
        Path to saved report
    """
    output_path = Path(output_path)
    reporter = JSONReporter(output_dir=output_path.parent)
    return reporter.save_report(results, filename=output_path.name)
