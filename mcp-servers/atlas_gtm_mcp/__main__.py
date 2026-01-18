"""Entry point for running the MCP server as a module."""

from .server import create_server

if __name__ == "__main__":
    server = create_server()
    # Run with HTTP transport for Docker/daemon mode
    server.run(transport="http", host="0.0.0.0", port=8000)
