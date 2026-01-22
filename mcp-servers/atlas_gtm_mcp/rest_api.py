"""REST API wrapper for MCP tools.

This module provides a REST API layer that wraps the FastMCP server,
exposing tools as REST endpoints for direct HTTP access.

The Meeting Prep Agent and other TypeScript agents use this REST API
to call MCP tools without going through the MCP protocol.

Endpoints:
    POST /tools/{tool_name} - Call an MCP tool with JSON body as arguments
    GET /health - Health check endpoint
    GET /tools - List all available tools
"""

from __future__ import annotations

import asyncio
import json
import traceback
from typing import Any

import structlog
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .server import create_server

logger = structlog.get_logger(__name__)

# Create the MCP server instance
_mcp_server = None


def get_mcp_server():
    """Get or create the MCP server singleton."""
    global _mcp_server
    if _mcp_server is None:
        _mcp_server = create_server()
    return _mcp_server


def create_rest_app() -> FastAPI:
    """Create the FastAPI REST wrapper application."""
    app = FastAPI(
        title="Atlas GTM MCP REST API",
        description="REST API wrapper for Atlas GTM MCP tools",
        version="0.1.0",
    )

    # Add CORS middleware for cross-origin requests
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {
            "status": "healthy",
            "service": "atlas-gtm-mcp-rest",
            "version": "0.1.0",
        }

    @app.get("/tools")
    async def list_tools():
        """List all available MCP tools."""
        from fastmcp import Client

        mcp = get_mcp_server()

        try:
            async with Client(mcp) as client:
                tools = await client.list_tools()
                return {
                    "tools": [
                        {
                            "name": t.name,
                            "description": t.description,
                            "input_schema": t.inputSchema if hasattr(t, "inputSchema") else None,
                        }
                        for t in tools
                    ],
                    "count": len(tools),
                }
        except Exception as e:
            logger.error("Failed to list tools", error=str(e))
            raise HTTPException(status_code=500, detail=f"Failed to list tools: {e}")

    @app.post("/tools/{tool_name}")
    async def call_tool(tool_name: str, request: Request):
        """Call an MCP tool by name with JSON arguments.

        Args:
            tool_name: Name of the MCP tool to call
            request: FastAPI request with JSON body containing tool arguments

        Returns:
            Tool result as JSON

        Raises:
            HTTPException: If tool call fails
        """
        from fastmcp import Client

        mcp = get_mcp_server()

        # Parse request body
        try:
            body = await request.body()
            if body:
                arguments = json.loads(body)
            else:
                arguments = {}
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

        logger.info(
            "Calling MCP tool via REST",
            tool=tool_name,
            arguments_keys=list(arguments.keys()) if arguments else [],
        )

        try:
            async with Client(mcp) as client:
                # Call the tool
                result = await client.call_tool(tool_name, arguments)

                # Handle result - check for structured data first
                if hasattr(result, "data") and result.data is not None:
                    response_data = result.data
                elif hasattr(result, "content") and result.content:
                    # Parse content blocks
                    content_data = []
                    for block in result.content:
                        if hasattr(block, "text"):
                            # Try to parse as JSON, otherwise return as string
                            try:
                                content_data.append(json.loads(block.text))
                            except json.JSONDecodeError:
                                content_data.append(block.text)
                        elif hasattr(block, "data"):
                            content_data.append(block.data)

                    # If single item, unwrap
                    if len(content_data) == 1:
                        response_data = content_data[0]
                    else:
                        response_data = content_data
                else:
                    response_data = None

                logger.info(
                    "MCP tool call succeeded",
                    tool=tool_name,
                    result_type=type(response_data).__name__,
                )

                # Wrap response in {success, result} format expected by mcp-bridge.ts
                return JSONResponse(content={"success": True, "result": response_data})

        except Exception as e:
            error_msg = str(e)
            logger.error(
                "MCP tool call failed",
                tool=tool_name,
                error=error_msg,
                traceback=traceback.format_exc(),
            )

            # Return error in {success, error} format expected by mcp-bridge.ts
            # Use 200 OK status so the client can parse the JSON error properly
            # Check for specific error types for logging purposes
            if "not found" in error_msg.lower() or "unknown tool" in error_msg.lower():
                return JSONResponse(
                    content={"success": False, "error": f"Tool not found: {tool_name}"},
                    status_code=404,
                )

            if "invalid" in error_msg.lower() or "validation" in error_msg.lower():
                return JSONResponse(
                    content={"success": False, "error": f"Invalid arguments: {error_msg}"},
                    status_code=400,
                )

            return JSONResponse(
                content={"success": False, "error": f"Tool call failed: {error_msg}"},
                status_code=500,
            )

    return app


# Create the app instance for uvicorn
rest_app = create_rest_app()


async def run_rest_server(host: str = "0.0.0.0", port: int = 8000):
    """Run the REST API server."""
    import uvicorn

    config = uvicorn.Config(rest_app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(run_rest_server())
