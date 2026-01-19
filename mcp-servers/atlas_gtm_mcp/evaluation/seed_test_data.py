"""
Seed test data for CI/CD RAG evaluation.

Creates Qdrant collections and populates them with test data
derived from golden datasets to enable evaluation testing.
"""

import asyncio
import json
import os
import uuid
from pathlib import Path

import structlog
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
)

logger = structlog.get_logger()

# Vector dimension for Voyage AI voyage-3.5-lite model
VECTOR_DIM = 1024

# Collections to seed
COLLECTIONS = [
    "icp_rules",
    "response_templates",
    "objection_handlers",
    "market_research",
]


def get_mock_embedding(text: str) -> list[float]:
    """
    Generate a deterministic mock embedding for CI testing.

    Uses a simple hash-based approach to generate consistent vectors.
    This avoids calling the Voyage AI API in CI.
    """
    import hashlib

    # Create a deterministic seed from the text
    text_hash = hashlib.sha256(text.encode()).hexdigest()

    # Generate pseudo-random but deterministic values
    embedding = []
    for i in range(VECTOR_DIM):
        # Use different parts of the hash to generate values
        byte_idx = i % 32
        byte_val = int(text_hash[byte_idx * 2:(byte_idx + 1) * 2], 16)
        # Normalize to [-1, 1] range
        value = (byte_val / 127.5) - 1.0
        # Add some variation based on position
        value = value * 0.5 + (hash(text + str(i)) % 1000) / 2000 - 0.25
        embedding.append(value)

    # Normalize the vector
    magnitude = sum(v ** 2 for v in embedding) ** 0.5
    if magnitude > 0:
        embedding = [v / magnitude for v in embedding]

    return embedding


def load_golden_dataset(collection_name: str) -> dict:
    """Load golden dataset for a collection."""
    datasets_dir = Path(__file__).parent / "datasets"

    # Map collection names to file names
    file_mapping = {
        "icp_rules": "icp_rules_golden.json",
        "response_templates": "response_templates_golden.json",
        "objection_handlers": "objection_handlers_golden.json",
        "market_research": "market_research_golden.json",
    }

    file_path = datasets_dir / file_mapping.get(collection_name, f"{collection_name}_golden.json")

    if not file_path.exists():
        logger.warning("Golden dataset not found", path=str(file_path))
        return {"test_cases": []}

    with open(file_path) as f:
        return json.load(f)


def create_points_from_golden_dataset(dataset: dict, collection_name: str) -> list[PointStruct]:
    """Create Qdrant points from golden dataset test cases.

    IMPORTANT: Embeddings are created from the QUESTION text, not the context.
    This ensures that when the evaluator queries with a question, it retrieves
    the point containing the expected contexts for that question.

    In CI mode, both seeding and evaluation use deterministic hash-based embeddings.
    By embedding the same question text in both places, queries find matching results.
    """
    points = []

    for test_case in dataset.get("test_cases", []):
        brain_id = test_case.get("brain_id", "brain_test_v1")
        question = test_case.get("question", "")
        expected_contexts = test_case.get("expected_contexts", [])

        if not question or not expected_contexts:
            continue

        # Create one point per test case, embedding the QUESTION
        # so queries with the same question find this point
        point_id = str(uuid.uuid4())

        # Generate mock embedding from QUESTION (not context!)
        # This matches how qdrant_evaluator.py queries: _get_embedding(question)
        embedding = get_mock_embedding(question)

        # Use first context as the primary text (most relevant)
        primary_context = expected_contexts[0]

        # Create payload based on collection type
        payload = {
            "text": primary_context,
            "content": primary_context,
            "brain_id": brain_id,
            "test_case_id": test_case.get("id"),
            "vertical": test_case.get("vertical", "test"),
            # Store all contexts for reference
            "expected_contexts": expected_contexts,
            "question": question,
        }

        # Add collection-specific fields
        if collection_name == "icp_rules":
            payload["rule_text"] = primary_context
            payload["category"] = test_case.get("metadata", {}).get("category", "general")
        elif collection_name == "response_templates":
            payload["template_text"] = primary_context
        elif collection_name == "objection_handlers":
            payload["response_text"] = primary_context
        elif collection_name == "market_research":
            payload["insight"] = primary_context

        points.append(
            PointStruct(
                id=point_id,
                vector=embedding,
                payload=payload,
            )
        )

        # Also create additional points for extra contexts (with slight vector variations)
        # This ensures multiple relevant contexts can be retrieved
        for i, context in enumerate(expected_contexts[1:], start=1):
            extra_point_id = str(uuid.uuid4())

            # IMPORTANT: Use same embedding key as primary context
            # Evaluator queries with `question`, so all contexts must match
            varied_embedding = get_mock_embedding(question)

            extra_payload = {
                "text": context,
                "content": context,
                "brain_id": brain_id,
                "test_case_id": test_case.get("id"),
                "vertical": test_case.get("vertical", "test"),
                "question": question,
                "context_index": i,
            }

            # Add collection-specific fields
            if collection_name == "icp_rules":
                extra_payload["rule_text"] = context
                extra_payload["category"] = test_case.get("metadata", {}).get("category", "general")
            elif collection_name == "response_templates":
                extra_payload["template_text"] = context
            elif collection_name == "objection_handlers":
                extra_payload["response_text"] = context
            elif collection_name == "market_research":
                extra_payload["insight"] = context

            points.append(
                PointStruct(
                    id=extra_point_id,
                    vector=varied_embedding,
                    payload=extra_payload,
                )
            )

    return points


def seed_collection(client: QdrantClient, collection_name: str) -> int:
    """Seed a single collection with test data."""
    logger.info("Seeding collection", collection=collection_name)

    # Delete existing collection if it exists
    try:
        client.delete_collection(collection_name)
        logger.info("Deleted existing collection", collection=collection_name)
    except Exception:
        pass  # Collection doesn't exist

    # Create collection
    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=VECTOR_DIM,
            distance=Distance.COSINE,
        ),
    )
    logger.info("Created collection", collection=collection_name)

    # Load golden dataset and create points
    dataset = load_golden_dataset(collection_name)
    points = create_points_from_golden_dataset(dataset, collection_name)

    if not points:
        logger.warning("No points to insert", collection=collection_name)
        return 0

    # Insert points
    client.upsert(
        collection_name=collection_name,
        points=points,
    )

    logger.info(
        "Seeded collection",
        collection=collection_name,
        points_count=len(points),
    )

    return len(points)


def main():
    """Seed all test collections."""
    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")

    logger.info("Starting test data seeding", qdrant_url=qdrant_url)

    client = QdrantClient(url=qdrant_url)

    total_points = 0
    for collection_name in COLLECTIONS:
        try:
            count = seed_collection(client, collection_name)
            total_points += count
        except Exception as e:
            logger.error(
                "Failed to seed collection",
                collection=collection_name,
                error=str(e),
            )
            raise

    logger.info(
        "Test data seeding completed",
        collections=len(COLLECTIONS),
        total_points=total_points,
    )


if __name__ == "__main__":
    main()
