"""Vertical management MCP tools for Atlas GTM.

This module provides MCP tools for managing verticals and detection:
- CRUD operations for verticals stored in Qdrant
- Waterfall detection strategy (explicit → industry → campaign → title → AI → default)
- Brain linking for multi-vertical brain swapping
"""

from .tools import register_vertical_tools

__all__ = ["register_vertical_tools"]
