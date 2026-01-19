"""
Qdrant RAG Evaluator

Main evaluator class for measuring RAG quality against Qdrant collections.
Uses Ragas metrics for evaluation.
"""

from dataclasses import dataclass
from typing import Optional
import asyncio
import math

try:
    from ragas import evaluate
    from ragas.metrics import (
        ContextPrecision,
        ContextRecall,
        Faithfulness,
        AnswerRelevancy,
    )
    from ragas.llms import llm_factory
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from langchain_openai.embeddings import OpenAIEmbeddings as LangchainOpenAIEmbeddings
    from openai import OpenAI as OpenAIClient
    from datasets import Dataset

    RAGAS_AVAILABLE = True
except ImportError:
    RAGAS_AVAILABLE = False

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
import structlog

from ..config import EvaluationConfig, MetricThresholds
from ..datasets.loader import GoldenDataset, GoldenTestCase

logger = structlog.get_logger()


@dataclass
class EvaluationMetrics:
    """Results from RAG evaluation."""

    context_precision: float
    context_recall: float
    faithfulness: float
    answer_relevancy: float

    def to_dict(self) -> dict[str, float]:
        """Convert to dictionary."""
        return {
            "context_precision": self.context_precision,
            "context_recall": self.context_recall,
            "faithfulness": self.faithfulness,
            "answer_relevancy": self.answer_relevancy,
        }

    def passes_thresholds(self, thresholds: MetricThresholds) -> tuple[bool, list[str]]:
        """
        Check if metrics pass the given thresholds.

        Returns:
            Tuple of (passes, list of failed metric names)
        """
        failures = []

        if self.context_precision < thresholds.context_precision:
            failures.append(
                f"context_precision ({self.context_precision:.2f} < {thresholds.context_precision:.2f})"
            )

        if self.context_recall < thresholds.context_recall:
            failures.append(
                f"context_recall ({self.context_recall:.2f} < {thresholds.context_recall:.2f})"
            )

        if self.faithfulness < thresholds.faithfulness:
            failures.append(
                f"faithfulness ({self.faithfulness:.2f} < {thresholds.faithfulness:.2f})"
            )

        # Note: We map answer_relevancy to context_relevance threshold
        if self.answer_relevancy < thresholds.context_relevance:
            failures.append(
                f"answer_relevancy ({self.answer_relevancy:.2f} < {thresholds.context_relevance:.2f})"
            )

        return len(failures) == 0, failures


@dataclass
class EvaluationResult:
    """Complete evaluation result for a collection."""

    collection_name: str
    metrics: EvaluationMetrics
    test_cases_evaluated: int
    passed: bool
    failures: list[str]
    duration_seconds: float
    error: Optional[str] = None


class QdrantRAGEvaluator:
    """
    Evaluates RAG quality for Qdrant collections.

    Uses Ragas metrics to measure:
    - Context Precision: Are retrieved results relevant?
    - Context Recall: Are all relevant docs retrieved?
    - Faithfulness: Is response faithful to retrieved context?
    - Answer Relevancy: How relevant is the answer to the question?
    """

    def __init__(self, config: EvaluationConfig):
        """
        Initialize the evaluator.

        Args:
            config: Evaluation configuration
        """
        if not RAGAS_AVAILABLE:
            raise ImportError(
                "Ragas is not installed. Install with: pip install 'atlas-gtm-mcp[evaluation]'"
            )

        self.config = config
        self.client = QdrantClient(
            url=config.qdrant_url,
            api_key=config.qdrant_api_key,
        )
        self._embedding_cache: dict[str, list[float]] = {}

    async def evaluate_collection(
        self,
        collection_name: str,
        golden_dataset: GoldenDataset,
        brain_id: Optional[str] = None,
    ) -> EvaluationResult:
        """
        Evaluate RAG quality for a collection.

        Args:
            collection_name: Name of the Qdrant collection
            golden_dataset: Golden test cases
            brain_id: Optional brain_id filter

        Returns:
            EvaluationResult with metrics and pass/fail status
        """
        import time

        start_time = time.time()

        try:
            # Get collection config and thresholds
            collection_config = self.config.get_collection_config(collection_name)

            # Prepare evaluation data
            questions = []
            contexts_list = []
            ground_truths = []
            answers = []

            for test_case in golden_dataset.test_cases:
                # Retrieve contexts from Qdrant
                retrieved_contexts = await self._retrieve_contexts(
                    collection_name=collection_name,
                    query=test_case.question,
                    brain_id=brain_id or test_case.brain_id,
                    top_k=5,
                )

                questions.append(test_case.question)
                contexts_list.append(retrieved_contexts)
                ground_truths.append(test_case.ground_truth)
                # For now, use ground truth as answer (in production, this would be LLM-generated)
                answers.append(test_case.ground_truth)

            # Create Ragas dataset
            data = {
                "question": questions,
                "contexts": contexts_list,
                "ground_truth": ground_truths,
                "answer": answers,
            }
            dataset = Dataset.from_dict(data)

            # Initialize LLM for Ragas metrics using llm_factory
            client = OpenAIClient(api_key=self.config.openai_api_key)
            evaluator_llm = llm_factory(self.config.evaluator_model, client=client)

            # Initialize embeddings for AnswerRelevancy metric using LangChain wrapper
            langchain_embeddings = LangchainOpenAIEmbeddings(
                model="text-embedding-3-small",
                api_key=self.config.openai_api_key,
            )
            evaluator_embeddings = LangchainEmbeddingsWrapper(langchain_embeddings)

            # Instantiate metrics with LLM (AnswerRelevancy also requires embeddings)
            ragas_metrics = [
                ContextPrecision(llm=evaluator_llm),
                ContextRecall(llm=evaluator_llm),
                Faithfulness(llm=evaluator_llm),
                AnswerRelevancy(llm=evaluator_llm, embeddings=evaluator_embeddings),
            ]

            # Run Ragas evaluation
            results = evaluate(
                dataset=dataset,
                metrics=ragas_metrics,
            )

            # Extract metrics with defensive handling for nan/list values
            def safe_float(value, default: float = 0.0) -> float:
                """Safely convert value to float, handling nan and lists."""
                if isinstance(value, list):
                    value = value[0] if value else default
                try:
                    result = float(value)
                    return default if math.isnan(result) else result
                except (TypeError, ValueError):
                    return default

            metrics = EvaluationMetrics(
                context_precision=safe_float(results["context_precision"]),
                context_recall=safe_float(results["context_recall"]),
                faithfulness=safe_float(results["faithfulness"]),
                answer_relevancy=safe_float(results["answer_relevancy"]),
            )

            # Check thresholds
            passed, failures = metrics.passes_thresholds(collection_config.thresholds)

            duration = time.time() - start_time

            logger.info(
                "Evaluation completed",
                collection=collection_name,
                metrics=metrics.to_dict(),
                passed=passed,
                duration_seconds=duration,
            )

            return EvaluationResult(
                collection_name=collection_name,
                metrics=metrics,
                test_cases_evaluated=len(golden_dataset.test_cases),
                passed=passed,
                failures=failures,
                duration_seconds=duration,
            )

        except Exception as e:
            duration = time.time() - start_time
            logger.error(
                "Evaluation failed",
                collection=collection_name,
                error=str(e),
            )
            return EvaluationResult(
                collection_name=collection_name,
                metrics=EvaluationMetrics(0, 0, 0, 0),
                test_cases_evaluated=0,
                passed=False,
                failures=[str(e)],
                duration_seconds=duration,
                error=str(e),
            )

    async def _retrieve_contexts(
        self,
        collection_name: str,
        query: str,
        brain_id: Optional[str],
        top_k: int = 5,
    ) -> list[str]:
        """
        Retrieve relevant contexts from Qdrant.

        Args:
            collection_name: Collection to search
            query: Search query
            brain_id: Optional brain_id filter
            top_k: Number of results to return

        Returns:
            List of retrieved context strings
        """
        # Get embedding for query
        query_vector = await self._get_embedding(query)

        # Build filter
        filter_conditions = None
        if brain_id:
            filter_conditions = Filter(
                must=[
                    FieldCondition(
                        key="brain_id",
                        match=MatchValue(value=brain_id),
                    )
                ]
            )

        # Search Qdrant (query_points is the new API, .points returns list of ScoredPoint)
        results = self.client.query_points(
            collection_name=collection_name,
            query=query_vector,
            query_filter=filter_conditions,
            limit=top_k,
        ).points

        # Extract text content from results
        contexts = []
        for result in results:
            payload = result.payload or {}
            # Try common text field names
            text = (
                payload.get("text")
                or payload.get("content")
                or payload.get("rule_text")
                or payload.get("template_text")
                or payload.get("response_text")
                or str(payload)
            )
            contexts.append(text)

        return contexts

    async def _get_embedding(self, text: str) -> list[float]:
        """
        Get embedding for text using Voyage AI or mock embeddings in CI.

        Args:
            text: Text to embed

        Returns:
            Embedding vector
        """
        import os

        # Check cache
        if text in self._embedding_cache:
            return self._embedding_cache[text]

        # Use mock embeddings in CI mode
        if os.getenv("CI") or os.getenv("USE_MOCK_EMBEDDINGS"):
            embedding = self._get_mock_embedding(text)
            self._embedding_cache[text] = embedding
            return embedding

        try:
            import voyageai

            client = voyageai.Client(api_key=self.config.voyage_api_key)
            result = client.embed(
                texts=[text],
                model="voyage-3.5-lite",
                input_type="query",
            )
            embedding = result.embeddings[0]

            # Cache the result
            self._embedding_cache[text] = embedding

            return embedding

        except Exception as e:
            logger.error("Failed to get embedding", error=str(e))
            raise

    def _get_mock_embedding(self, text: str) -> list[float]:
        """
        Generate deterministic mock embedding for CI testing.

        Must match the algorithm in seed_test_data.py for consistency.
        """
        import hashlib

        VECTOR_DIM = 1024

        # Create a deterministic seed from the text
        text_hash = hashlib.sha256(text.encode()).hexdigest()

        # Generate pseudo-random but deterministic values
        embedding = []
        for i in range(VECTOR_DIM):
            byte_idx = i % 32
            byte_val = int(text_hash[byte_idx * 2:(byte_idx + 1) * 2], 16)
            value = (byte_val / 127.5) - 1.0
            value = value * 0.5 + (hash(text + str(i)) % 1000) / 2000 - 0.25
            embedding.append(value)

        # Normalize the vector
        magnitude = sum(v ** 2 for v in embedding) ** 0.5
        if magnitude > 0:
            embedding = [v / magnitude for v in embedding]

        return embedding


async def run_evaluation(
    config: EvaluationConfig,
    collection_name: str,
    golden_dataset: GoldenDataset,
    brain_id: Optional[str] = None,
) -> EvaluationResult:
    """
    Convenience function to run evaluation.

    Args:
        config: Evaluation configuration
        collection_name: Collection to evaluate
        golden_dataset: Test cases
        brain_id: Optional brain filter

    Returns:
        EvaluationResult
    """
    evaluator = QdrantRAGEvaluator(config)
    return await evaluator.evaluate_collection(
        collection_name=collection_name,
        golden_dataset=golden_dataset,
        brain_id=brain_id,
    )
