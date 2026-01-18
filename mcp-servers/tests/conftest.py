"""Shared test fixtures for MCP server tests."""

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from qdrant_client import QdrantClient

# Load environment variables from .env file (in project root, parent of mcp-servers/)
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# Test constants
TEST_BRAIN_ID = "brain_test_v1"
TEST_VERTICAL = "test"
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")


def _create_qdrant_client() -> QdrantClient:
    """Create a Qdrant client with proper configuration."""
    # Use url parameter to explicitly specify HTTP (not HTTPS)
    return QdrantClient(
        url=f"http://{QDRANT_HOST}:{QDRANT_PORT}",
        api_key=QDRANT_API_KEY,
    )


def is_qdrant_available() -> bool:
    """Check if Qdrant is running and accessible."""
    try:
        client = _create_qdrant_client()
        client.get_collections()
        return True
    except Exception:
        return False


requires_qdrant = pytest.mark.skipif(
    not is_qdrant_available(),
    reason=f"Qdrant not available at {QDRANT_HOST}:{QDRANT_PORT}",
)


@pytest.fixture(scope="session")
def qdrant_client():
    """Session-scoped Qdrant client."""
    if not is_qdrant_available():
        pytest.skip("Qdrant not available")
    return _create_qdrant_client()
