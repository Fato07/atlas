"""Entry point for running MCP server."""

from .server import create_server


def main():
    server = create_server()
    server.run()


if __name__ == "__main__":
    main()
