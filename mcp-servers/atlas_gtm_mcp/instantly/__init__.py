"""Instantly MCP tools for email campaign operations."""

import os
from typing import Optional
from datetime import datetime, timedelta

import httpx
from fastmcp import FastMCP

INSTANTLY_API_URL = "https://api.instantly.ai/api/v1"
INSTANTLY_API_KEY = os.getenv("INSTANTLY_API_KEY")


class InstantlyClient:
    """Instantly API client."""

    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url=INSTANTLY_API_URL,
            params={"api_key": INSTANTLY_API_KEY},
            timeout=30.0,
        )

    async def get(self, path: str, **kwargs) -> dict:
        response = await self.client.get(path, **kwargs)
        response.raise_for_status()
        return response.json()

    async def post(self, path: str, **kwargs) -> dict:
        response = await self.client.post(path, **kwargs)
        response.raise_for_status()
        return response.json()


instantly = InstantlyClient()


def register_instantly_tools(mcp: FastMCP) -> None:
    """Register all Instantly email tools with the MCP server."""

    @mcp.tool()
    async def get_email_thread(
        email: str,
        campaign_id: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Get the email thread/conversation for a lead.

        Args:
            email: Lead's email address
            campaign_id: Optional campaign ID to filter by

        Returns:
            Thread with all messages or None
        """
        params = {"email": email}
        if campaign_id:
            params["campaign_id"] = campaign_id

        try:
            response = await instantly.get("/lead/get", params=params)
            lead_data = response

            if not lead_data:
                return None

            # Get email history
            emails = await instantly.get(
                "/unibox/emails",
                params={"email": email, "limit": 50},
            )

            return {
                "lead": lead_data,
                "messages": emails.get("data", []),
                "message_count": len(emails.get("data", [])),
            }
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @mcp.tool()
    async def send_reply(
        email: str,
        campaign_id: str,
        message: str,
        subject: Optional[str] = None,
    ) -> dict:
        """
        Send a reply to a lead in a campaign.

        Args:
            email: Lead's email address
            campaign_id: Campaign ID
            message: Reply message content (HTML supported)
            subject: Optional subject line (uses Re: original if not provided)

        Returns:
            Send result with message ID
        """
        data = {
            "email": email,
            "campaign_id": campaign_id,
            "body": message,
        }

        if subject:
            data["subject"] = subject

        response = await instantly.post("/unibox/send", json=data)
        return response

    @mcp.tool()
    async def get_recent_replies(
        since_hours: int = 24,
        campaign_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict]:
        """
        Get recent replies from leads.

        Args:
            since_hours: How many hours back to look
            campaign_id: Optional campaign ID to filter by
            limit: Maximum replies to return

        Returns:
            List of recent replies with lead context
        """
        since = datetime.utcnow() - timedelta(hours=since_hours)

        params = {
            "limit": limit,
            "reply_type": "received",
            "since": since.isoformat(),
        }

        if campaign_id:
            params["campaign_id"] = campaign_id

        response = await instantly.get("/unibox/emails", params=params)
        return response.get("data", [])

    @mcp.tool()
    async def get_lead_status(email: str) -> Optional[dict]:
        """
        Get the current status of a lead.

        Args:
            email: Lead's email address

        Returns:
            Lead status including campaign, sequence step, etc.
        """
        try:
            response = await instantly.get("/lead/get", params={"email": email})
            return response
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @mcp.tool()
    async def update_lead_status(
        email: str,
        campaign_id: str,
        status: str,
    ) -> dict:
        """
        Update a lead's status in a campaign.

        Args:
            email: Lead's email address
            campaign_id: Campaign ID
            status: New status (interested, not_interested, meeting_booked, etc.)

        Returns:
            Updated lead data
        """
        response = await instantly.post(
            "/lead/update",
            json={
                "email": email,
                "campaign_id": campaign_id,
                "status": status,
            },
        )
        return response

    @mcp.tool()
    async def pause_lead(
        email: str,
        campaign_id: str,
    ) -> dict:
        """
        Pause a lead's sequence (stop sending emails).

        Args:
            email: Lead's email address
            campaign_id: Campaign ID

        Returns:
            Result of pause operation
        """
        response = await instantly.post(
            "/lead/update",
            json={
                "email": email,
                "campaign_id": campaign_id,
                "status": "paused",
            },
        )
        return response

    @mcp.tool()
    async def get_campaign_stats(campaign_id: str) -> dict:
        """
        Get statistics for a campaign.

        Args:
            campaign_id: Campaign ID

        Returns:
            Campaign statistics (sent, opened, replied, etc.)
        """
        response = await instantly.get(
            "/campaign/get",
            params={"campaign_id": campaign_id},
        )
        return response
