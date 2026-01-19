"""
Golden Datasets for RAG Evaluation

Contains curated test cases with expected contexts and ground truth
for evaluating retrieval quality across different collections.
"""

from .loader import (
    load_golden_dataset,
    create_sample_golden_dataset,
    GoldenTestCase,
    GoldenDataset,
)

__all__ = [
    "load_golden_dataset",
    "create_sample_golden_dataset",
    "GoldenTestCase",
    "GoldenDataset",
]
