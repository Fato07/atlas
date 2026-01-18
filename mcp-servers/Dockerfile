FROM python:3.11-slim

WORKDIR /app

# Install uv for faster dependency management
RUN pip install uv

# Copy project files
COPY pyproject.toml ./
COPY atlas_gtm_mcp ./atlas_gtm_mcp

# Install dependencies
RUN uv pip install --system -e .

# Expose MCP server port
EXPOSE 8000

# Run MCP server
CMD ["python", "-m", "atlas_gtm_mcp"]
