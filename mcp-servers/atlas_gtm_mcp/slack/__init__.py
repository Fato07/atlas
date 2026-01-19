"""
Slack MCP tools for Reply Handler Agent.

Provides message posting, block formatting, and message updates for the
Reply Handler's Tier 2 approval workflow. Modal opening is NOT included here
due to trigger_id's 3-second expiration - that requires direct @slack/web-api.

@module slack
"""

import os
from datetime import datetime
from typing import Optional, Any

import httpx
from fastmcp import FastMCP
from pydantic import BaseModel, Field

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
SLACK_SIGNING_SECRET = os.getenv("SLACK_SIGNING_SECRET")
SLACK_API_URL = "https://slack.com/api"


class SlackClient:
    """Slack Web API client for MCP tools."""

    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url=SLACK_API_URL,
            headers={
                "Authorization": f"Bearer {SLACK_BOT_TOKEN}",
                "Content-Type": "application/json; charset=utf-8",
            },
            timeout=30.0,
        )

    async def post(self, method: str, **kwargs) -> dict:
        """Call a Slack API method."""
        response = await self.client.post(f"/{method}", **kwargs)
        response.raise_for_status()
        data = response.json()
        if not data.get("ok"):
            error = data.get("error", "unknown_error")
            raise SlackAPIError(error, data)
        return data

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()


class SlackAPIError(Exception):
    """Slack API error."""

    def __init__(self, error: str, response: dict):
        self.error = error
        self.response = response
        super().__init__(f"Slack API error: {error}")


slack = SlackClient()


# ===========================================
# Block Kit Builders
# ===========================================


def build_approval_blocks(
    lead_name: str,
    lead_company: str,
    lead_email: str,
    reply_text: str,
    draft_response: str,
    intent: str,
    confidence: float,
    tier: int,
    draft_id: str,
    expires_at: str,
) -> list[dict]:
    """
    Build Block Kit blocks for Tier 2 approval message.

    Creates a formatted approval request with:
    - Header with lead info
    - Reply preview
    - Draft response
    - Classification metadata
    - Action buttons (Approve, Edit, Escalate)
    """
    confidence_pct = f"{confidence * 100:.0f}%"
    intent_display = intent.replace("_", " ").title()

    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "📬 New Reply Requires Approval",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Lead:*\n{lead_name}"},
                {"type": "mrkdwn", "text": f"*Company:*\n{lead_company}"},
                {"type": "mrkdwn", "text": f"*Email:*\n{lead_email}"},
                {"type": "mrkdwn", "text": f"*Intent:*\n{intent_display}"},
            ],
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Their Reply:*\n```{reply_text[:500]}{'...' if len(reply_text) > 500 else ''}```",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Suggested Response:*\n```{draft_response[:800]}{'...' if len(draft_response) > 800 else ''}```",
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Tier {tier} | Confidence: {confidence_pct} | Expires: {expires_at}",
                }
            ],
        },
        {"type": "divider"},
        {
            "type": "actions",
            "block_id": f"approval_actions_{draft_id}",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Approve", "emoji": True},
                    "style": "primary",
                    "action_id": "approve_draft",
                    "value": draft_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✏️ Edit", "emoji": True},
                    "action_id": "edit_draft",
                    "value": draft_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "🚫 Reject", "emoji": True},
                    "action_id": "reject_draft",
                    "value": draft_id,
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "⬆️ Escalate", "emoji": True},
                    "style": "danger",
                    "action_id": "escalate_draft",
                    "value": draft_id,
                },
            ],
        },
    ]


def build_escalation_blocks(
    lead_name: str,
    lead_company: str,
    lead_email: str,
    reply_text: str,
    reason: str,
    intent: str,
    sentiment: float,
    urgency: str,
    escalation_id: str,
) -> list[dict]:
    """
    Build Block Kit blocks for Tier 3 escalation notification.

    Creates a formatted escalation alert with:
    - Header indicating human handling needed
    - Lead context
    - Full reply content
    - Escalation reason
    - Metadata (sentiment, urgency)
    - Claim button
    """
    sentiment_display = "Positive" if sentiment > 0.3 else "Negative" if sentiment < -0.3 else "Neutral"
    intent_display = intent.replace("_", " ").title()
    urgency_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(urgency, "⚪")

    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "🚨 Human Handling Required",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Reason:* {reason}",
            },
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Lead:*\n{lead_name}"},
                {"type": "mrkdwn", "text": f"*Company:*\n{lead_company}"},
                {"type": "mrkdwn", "text": f"*Email:*\n{lead_email}"},
                {"type": "mrkdwn", "text": f"*Intent:*\n{intent_display}"},
            ],
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Full Reply:*\n```{reply_text}```",
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"{urgency_emoji} {urgency.title()} Urgency | Sentiment: {sentiment_display} ({sentiment:.2f})",
                }
            ],
        },
        {"type": "divider"},
        {
            "type": "actions",
            "block_id": f"escalation_actions_{escalation_id}",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "🙋 Claim This", "emoji": True},
                    "style": "primary",
                    "action_id": "claim_escalation",
                    "value": escalation_id,
                },
            ],
        },
    ]


def build_status_update_blocks(
    draft_id: str,
    status: str,
    resolved_by: Optional[str] = None,
    original_blocks: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Build updated blocks showing resolution status.

    Removes action buttons and adds resolution context.
    """
    status_emoji = {
        "approved": "✅",
        "approved_edited": "✏️",
        "rejected": "🚫",
        "escalated": "⬆️",
        "expired": "⏰",
    }.get(status, "❓")

    status_text = status.replace("_", " ").title()
    resolver_text = f" by <@{resolved_by}>" if resolved_by else ""

    # Start with original blocks, remove actions
    blocks = []
    if original_blocks:
        for block in original_blocks:
            if block.get("type") != "actions":
                blocks.append(block)

    # Add resolution status
    blocks.append({"type": "divider"})
    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"{status_emoji} *{status_text}*{resolver_text} at {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
                }
            ],
        }
    )

    return blocks


# ===========================================
# Tool Registration
# ===========================================


def register_slack_tools(mcp: FastMCP) -> None:
    """Register all Slack messaging tools with the MCP server."""

    @mcp.tool()
    async def slack_post_message(
        channel: str,
        text: str,
        thread_ts: Optional[str] = None,
    ) -> dict:
        """
        Post a simple text message to a Slack channel.

        Args:
            channel: Channel ID or name (e.g., 'C01234567' or '#approvals')
            text: Message text (markdown supported)
            thread_ts: Optional thread timestamp to reply in thread

        Returns:
            Slack API response with channel, ts (timestamp), and message
        """
        payload = {
            "channel": channel,
            "text": text,
        }
        if thread_ts:
            payload["thread_ts"] = thread_ts

        response = await slack.post("chat.postMessage", json=payload)
        return {
            "ok": True,
            "channel": response.get("channel"),
            "ts": response.get("ts"),
            "message": response.get("message"),
        }

    @mcp.tool()
    async def slack_post_blocks(
        channel: str,
        blocks: list[dict],
        text: str,
        thread_ts: Optional[str] = None,
    ) -> dict:
        """
        Post a Block Kit message to a Slack channel.

        Args:
            channel: Channel ID or name
            blocks: Block Kit blocks array
            text: Fallback text for notifications
            thread_ts: Optional thread timestamp to reply in thread

        Returns:
            Slack API response with channel, ts (timestamp), and message
        """
        payload = {
            "channel": channel,
            "blocks": blocks,
            "text": text,
        }
        if thread_ts:
            payload["thread_ts"] = thread_ts

        response = await slack.post("chat.postMessage", json=payload)
        return {
            "ok": True,
            "channel": response.get("channel"),
            "ts": response.get("ts"),
            "message": response.get("message"),
        }

    @mcp.tool()
    async def slack_update_message(
        channel: str,
        ts: str,
        text: Optional[str] = None,
        blocks: Optional[list[dict]] = None,
    ) -> dict:
        """
        Update an existing Slack message.

        Args:
            channel: Channel ID where the message is
            ts: Timestamp of the message to update
            text: New text (optional if blocks provided)
            blocks: New Block Kit blocks (optional)

        Returns:
            Slack API response with updated message
        """
        payload = {
            "channel": channel,
            "ts": ts,
        }
        if text:
            payload["text"] = text
        if blocks:
            payload["blocks"] = blocks

        response = await slack.post("chat.update", json=payload)
        return {
            "ok": True,
            "channel": response.get("channel"),
            "ts": response.get("ts"),
            "message": response.get("message"),
        }

    @mcp.tool()
    async def slack_post_approval_request(
        channel: str,
        lead_name: str,
        lead_company: str,
        lead_email: str,
        reply_text: str,
        draft_response: str,
        intent: str,
        confidence: float,
        tier: int,
        draft_id: str,
        expires_at: str,
    ) -> dict:
        """
        Post a Tier 2 approval request with formatted blocks.

        This is a convenience wrapper that builds the approval blocks
        and posts them to the specified channel.

        Args:
            channel: Channel ID for approvals
            lead_name: Name of the lead
            lead_company: Company name
            lead_email: Email address
            reply_text: The lead's reply text
            draft_response: Suggested response text
            intent: Classified intent
            confidence: Classification confidence (0-1)
            tier: Routing tier (should be 2)
            draft_id: Unique draft identifier
            expires_at: Expiration timestamp

        Returns:
            Slack API response with channel, ts, and message
        """
        blocks = build_approval_blocks(
            lead_name=lead_name,
            lead_company=lead_company,
            lead_email=lead_email,
            reply_text=reply_text,
            draft_response=draft_response,
            intent=intent,
            confidence=confidence,
            tier=tier,
            draft_id=draft_id,
            expires_at=expires_at,
        )

        fallback_text = f"New reply from {lead_name} at {lead_company} requires approval"

        return await slack_post_blocks(channel, blocks, fallback_text)

    @mcp.tool()
    async def slack_post_escalation(
        channel: str,
        lead_name: str,
        lead_company: str,
        lead_email: str,
        reply_text: str,
        reason: str,
        intent: str,
        sentiment: float,
        urgency: str,
        escalation_id: str,
    ) -> dict:
        """
        Post a Tier 3 escalation notification with formatted blocks.

        This is a convenience wrapper that builds the escalation blocks
        and posts them to the specified channel.

        Args:
            channel: Channel ID for escalations
            lead_name: Name of the lead
            lead_company: Company name
            lead_email: Email address
            reply_text: The lead's reply text
            reason: Escalation reason
            intent: Classified intent
            sentiment: Sentiment score (-1 to 1)
            urgency: Urgency level (high, medium, low)
            escalation_id: Unique escalation identifier

        Returns:
            Slack API response with channel, ts, and message
        """
        blocks = build_escalation_blocks(
            lead_name=lead_name,
            lead_company=lead_company,
            lead_email=lead_email,
            reply_text=reply_text,
            reason=reason,
            intent=intent,
            sentiment=sentiment,
            urgency=urgency,
            escalation_id=escalation_id,
        )

        fallback_text = f"🚨 Escalation: Reply from {lead_name} requires human handling - {reason}"

        return await slack_post_blocks(channel, blocks, fallback_text)

    @mcp.tool()
    async def slack_resolve_approval(
        channel: str,
        ts: str,
        draft_id: str,
        status: str,
        resolved_by: Optional[str] = None,
    ) -> dict:
        """
        Update an approval message to show resolution status.

        Removes action buttons and adds resolution context.

        Args:
            channel: Channel ID where the message is
            ts: Timestamp of the message to update
            draft_id: Draft identifier
            status: Resolution status (approved, approved_edited, rejected, escalated, expired)
            resolved_by: Slack user ID who resolved it

        Returns:
            Slack API response with updated message
        """
        # Get the original message to preserve blocks
        get_response = await slack.post(
            "conversations.history",
            json={
                "channel": channel,
                "latest": ts,
                "limit": 1,
                "inclusive": True,
            },
        )

        original_blocks = None
        messages = get_response.get("messages", [])
        if messages:
            original_blocks = messages[0].get("blocks")

        updated_blocks = build_status_update_blocks(
            draft_id=draft_id,
            status=status,
            resolved_by=resolved_by,
            original_blocks=original_blocks,
        )

        status_text = status.replace("_", " ").title()
        fallback_text = f"Draft {status_text}"

        return await slack_update_message(channel, ts, text=fallback_text, blocks=updated_blocks)

    @mcp.tool()
    async def slack_add_reaction(
        channel: str,
        ts: str,
        emoji: str,
    ) -> dict:
        """
        Add a reaction emoji to a message.

        Args:
            channel: Channel ID
            ts: Message timestamp
            emoji: Emoji name without colons (e.g., 'thumbsup', 'white_check_mark')

        Returns:
            Slack API response
        """
        response = await slack.post(
            "reactions.add",
            json={
                "channel": channel,
                "timestamp": ts,
                "name": emoji,
            },
        )
        return {"ok": True}

    @mcp.tool()
    async def slack_get_user_info(
        user_id: str,
    ) -> dict:
        """
        Get information about a Slack user.

        Args:
            user_id: Slack user ID

        Returns:
            User information including name, email, timezone
        """
        response = await slack.post("users.info", json={"user": user_id})
        user = response.get("user", {})
        return {
            "id": user.get("id"),
            "name": user.get("name"),
            "real_name": user.get("real_name"),
            "email": user.get("profile", {}).get("email"),
            "tz": user.get("tz"),
        }
