"""
Langfuse Reporter for RAG Evaluation

Reports evaluation metrics to Langfuse for unified observability.
"""

import os
from datetime import datetime
from typing import Optional

import structlog

try:
    from langfuse import Langfuse

    LANGFUSE_AVAILABLE = True
except ImportError:
    LANGFUSE_AVAILABLE = False

from ..evaluators.collection_evaluator import AggregatedResults
from ..evaluators.qdrant_evaluator import EvaluationResult

logger = structlog.get_logger()


class LangfuseReporter:
    """
    Reports RAG evaluation metrics to Langfuse.

    Creates traces and scores for evaluation runs.
    """

    def __init__(
        self,
        public_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        host: Optional[str] = None,
    ):
        """
        Initialize the Langfuse reporter.

        Args:
            public_key: Langfuse public key (defaults to LANGFUSE_PUBLIC_KEY env)
            secret_key: Langfuse secret key (defaults to LANGFUSE_SECRET_KEY env)
            host: Langfuse host URL (defaults to LANGFUSE_BASE_URL env)
        """
        if not LANGFUSE_AVAILABLE:
            raise ImportError(
                "Langfuse is not installed. Install with: pip install 'atlas-gtm-mcp[evaluation]'"
            )

        self.client = Langfuse(
            public_key=public_key or os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=secret_key or os.getenv("LANGFUSE_SECRET_KEY"),
            host=host or os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com"),
        )

    def report_result(
        self,
        result: EvaluationResult,
        brain_id: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> str:
        """
        Report a single evaluation result to Langfuse.

        Args:
            result: Evaluation result to report
            brain_id: Optional brain ID for filtering
            run_id: Optional run ID for grouping

        Returns:
            Trace ID created in Langfuse
        """
        # Create evaluation trace
        trace = self.client.trace(
            name=f"rag_evaluation_{result.collection_name}",
            metadata={
                "collection_name": result.collection_name,
                "brain_id": brain_id,
                "run_id": run_id,
                "test_cases_evaluated": result.test_cases_evaluated,
                "passed": result.passed,
                "duration_seconds": result.duration_seconds,
            },
            tags=["evaluation", "ragas", result.collection_name],
        )

        # Record metrics as scores
        if result.metrics:
            self.client.score(
                trace_id=trace.id,
                name="context_precision",
                value=result.metrics.context_precision,
                comment=f"RAG context precision for {result.collection_name}",
            )

            self.client.score(
                trace_id=trace.id,
                name="context_recall",
                value=result.metrics.context_recall,
                comment=f"RAG context recall for {result.collection_name}",
            )

            self.client.score(
                trace_id=trace.id,
                name="faithfulness",
                value=result.metrics.faithfulness,
                comment=f"RAG faithfulness for {result.collection_name}",
            )

            self.client.score(
                trace_id=trace.id,
                name="answer_relevancy",
                value=result.metrics.answer_relevancy,
                comment=f"RAG answer relevancy for {result.collection_name}",
            )

        # Record pass/fail as binary score
        self.client.score(
            trace_id=trace.id,
            name="evaluation_passed",
            value=1.0 if result.passed else 0.0,
            comment=f"Evaluation {'passed' if result.passed else 'failed'}",
        )

        # Record failures if any
        if result.failures:
            trace.update(
                metadata={
                    **trace.metadata,
                    "failures": result.failures,
                }
            )

        # Record error if any
        if result.error:
            trace.update(
                metadata={
                    **trace.metadata,
                    "error": result.error,
                },
                level="ERROR",
            )

        logger.info(
            "Reported evaluation to Langfuse",
            trace_id=trace.id,
            collection=result.collection_name,
            passed=result.passed,
        )

        return trace.id

    def report_aggregated(
        self,
        results: AggregatedResults,
        brain_id: Optional[str] = None,
    ) -> str:
        """
        Report aggregated results to Langfuse.

        Creates a parent trace with child traces for each collection.

        Args:
            results: Aggregated results to report
            brain_id: Optional brain ID for filtering

        Returns:
            Parent trace ID
        """
        run_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

        # Create parent trace for the evaluation run
        parent_trace = self.client.trace(
            name="rag_evaluation_batch",
            metadata={
                "brain_id": brain_id,
                "run_id": run_id,
                "total_test_cases": results.total_test_cases,
                "overall_passed": results.overall_passed,
                "collections_passed": results.collections_passed,
                "collections_failed": results.collections_failed,
                "total_duration_seconds": results.total_duration_seconds,
                "collection_names": [r.collection_name for r in results.collection_results],
            },
            tags=["evaluation", "ragas", "batch"],
        )

        # Record overall scores on parent trace
        self.client.score(
            trace_id=parent_trace.id,
            name="batch_pass_rate",
            value=results.collections_passed / len(results.collection_results)
            if results.collection_results
            else 0,
            comment=f"{results.collections_passed}/{len(results.collection_results)} collections passed",
        )

        self.client.score(
            trace_id=parent_trace.id,
            name="overall_passed",
            value=1.0 if results.overall_passed else 0.0,
            comment="All collections passed thresholds" if results.overall_passed else "Some collections failed",
        )

        # Calculate average metrics across collections
        metrics_count = 0
        avg_precision = 0.0
        avg_recall = 0.0
        avg_faithfulness = 0.0
        avg_relevancy = 0.0

        for result in results.collection_results:
            if result.metrics:
                metrics_count += 1
                avg_precision += result.metrics.context_precision
                avg_recall += result.metrics.context_recall
                avg_faithfulness += result.metrics.faithfulness
                avg_relevancy += result.metrics.answer_relevancy

        if metrics_count > 0:
            self.client.score(
                trace_id=parent_trace.id,
                name="avg_context_precision",
                value=avg_precision / metrics_count,
                comment="Average context precision across collections",
            )
            self.client.score(
                trace_id=parent_trace.id,
                name="avg_context_recall",
                value=avg_recall / metrics_count,
                comment="Average context recall across collections",
            )
            self.client.score(
                trace_id=parent_trace.id,
                name="avg_faithfulness",
                value=avg_faithfulness / metrics_count,
                comment="Average faithfulness across collections",
            )
            self.client.score(
                trace_id=parent_trace.id,
                name="avg_answer_relevancy",
                value=avg_relevancy / metrics_count,
                comment="Average answer relevancy across collections",
            )

        # Report individual collection results
        for result in results.collection_results:
            self.report_result(
                result=result,
                brain_id=brain_id,
                run_id=run_id,
            )

        logger.info(
            "Reported batch evaluation to Langfuse",
            parent_trace_id=parent_trace.id,
            collections_count=len(results.collection_results),
            overall_passed=results.overall_passed,
        )

        return parent_trace.id

    def flush(self) -> None:
        """Flush any pending data to Langfuse."""
        self.client.flush()

    def shutdown(self) -> None:
        """Shutdown the Langfuse client."""
        self.client.shutdown()
