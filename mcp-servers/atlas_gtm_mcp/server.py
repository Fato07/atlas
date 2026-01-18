"""Main MCP server combining all Atlas GTM tools."""

import os

from dotenv import load_dotenv
from fastmcp import FastMCP

from .qdrant import register_qdrant_tools
from .attio import register_attio_tools
from .instantly import register_instantly_tools

load_dotenv()


def create_server() -> FastMCP:
    """Create and configure the Atlas GTM MCP server."""
    mcp = FastMCP(
        name="atlas-gtm-mcp",
        description="MCP server for Atlas GTM - Knowledge Base, CRM, and Email tools",
    )

    # Register all tool groups
    register_qdrant_tools(mcp)
    register_attio_tools(mcp)
    register_instantly_tools(mcp)

    return mcp


# For direct execution
server = create_server()
