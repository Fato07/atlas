# Use a Python image with uv pre-installed
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

# Set working directory
WORKDIR /app

# Enable bytecode compilation
ENV UV_COMPILE_BYTECODE=1

# Copy dependencies first to leverage cache
COPY pyproject.toml uv.lock* ./

# Install dependencies into virtual environment
# --no-dev: valid for production images
# --frozen: ensures lock file is respected
RUN uv sync --frozen --no-dev --no-install-project

# Copy the rest of the application
COPY . .

# Install the project itself
RUN uv sync --frozen --no-dev

# Final stage
FROM python:3.11-slim-bookworm

WORKDIR /app

# Create a non-root user
RUN useradd -m -u 1000 atlas

# Copy the environment from the builder
COPY --from=builder --chown=atlas:atlas /app /app

# Ensure we use the virtual environment
ENV PATH="/app/.venv/bin:$PATH"

# Switch to non-root user
USER atlas

# Expose port
EXPOSE 8000

# Run the server
CMD ["python", "-m", "atlas_gtm_mcp"]
