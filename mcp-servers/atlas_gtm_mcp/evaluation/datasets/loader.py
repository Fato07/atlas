"""
Golden Dataset Loader for RAG Evaluation

Loads and validates golden test cases from JSON files.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class GoldenTestCase:
    """A single golden test case for RAG evaluation."""

    id: str
    question: str  # Query to search for
    expected_contexts: list[str]  # Expected relevant documents/contexts
    ground_truth: str  # Ground truth answer
    vertical: Optional[str] = None  # Optional vertical filter
    brain_id: Optional[str] = None  # Optional brain filter
    metadata: Optional[dict] = None  # Additional metadata


@dataclass
class GoldenDataset:
    """Collection of golden test cases."""

    collection_name: str
    description: str
    test_cases: list[GoldenTestCase]
    created_at: str
    version: str = "1.0.0"


def load_golden_dataset(
    file_path: str | Path,
    max_samples: Optional[int] = None,
) -> GoldenDataset:
    """
    Load a golden dataset from a JSON file.

    Args:
        file_path: Path to the JSON file
        max_samples: Maximum number of test cases to load

    Returns:
        GoldenDataset with test cases

    Raises:
        FileNotFoundError: If the file doesn't exist
        ValueError: If the file format is invalid
    """
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"Golden dataset not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Validate required fields
    required_fields = ["collection_name", "test_cases"]
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field: {field}")

    # Parse test cases
    test_cases = []
    raw_cases = data["test_cases"]

    if max_samples:
        raw_cases = raw_cases[:max_samples]

    for i, case in enumerate(raw_cases):
        if "question" not in case:
            raise ValueError(f"Test case {i} missing 'question' field")
        if "ground_truth" not in case:
            raise ValueError(f"Test case {i} missing 'ground_truth' field")

        test_cases.append(
            GoldenTestCase(
                id=case.get("id", f"case_{i}"),
                question=case["question"],
                expected_contexts=case.get("expected_contexts", []),
                ground_truth=case["ground_truth"],
                vertical=case.get("vertical"),
                brain_id=case.get("brain_id"),
                metadata=case.get("metadata"),
            )
        )

    return GoldenDataset(
        collection_name=data["collection_name"],
        description=data.get("description", ""),
        test_cases=test_cases,
        created_at=data.get("created_at", ""),
        version=data.get("version", "1.0.0"),
    )


def create_sample_golden_dataset(
    collection_name: str,
    output_path: str | Path,
) -> None:
    """
    Create a sample golden dataset file for a collection.

    Use this to bootstrap golden datasets for new collections.
    """
    sample_data = {
        "collection_name": collection_name,
        "description": f"Golden test cases for {collection_name} collection",
        "version": "1.0.0",
        "created_at": "",
        "test_cases": [
            {
                "id": "sample_1",
                "question": "Example query for this collection?",
                "expected_contexts": [
                    "Expected context document 1",
                    "Expected context document 2",
                ],
                "ground_truth": "The expected answer based on the contexts.",
                "vertical": "example_vertical",
                "brain_id": "brain_example_v1",
                "metadata": {
                    "difficulty": "easy",
                    "category": "sample",
                },
            }
        ],
    }

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(sample_data, f, indent=2)

    print(f"Created sample golden dataset at: {path}")
