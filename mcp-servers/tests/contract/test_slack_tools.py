"""Contract tests for Slack MCP tool signatures and return types.

Tests for T013.5: Slack tool contracts for Reply Handler Agent.

These tests verify that the Slack tool implementations match the contract specifications
without requiring a live Slack workspace. They use mocks to verify:
- Input parameter types and validation
- Return value structures
- Block Kit formatting
- Error handling behavior
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastmcp import FastMCP

# Import the registration function and block builders
from atlas_gtm_mcp.slack import (
    register_slack_tools,
    build_approval_blocks,
    build_escalation_blocks,
    build_status_update_blocks,
    SlackAPIError,
)


@pytest.fixture
def mock_slack_client():
    """Mock Slack HTTP client."""
    with patch("atlas_gtm_mcp.slack.slack") as mock:
        mock.post = AsyncMock()
        yield mock


@pytest.fixture
def mcp_server(mock_slack_client):
    """Create MCP server with registered Slack tools."""
    mcp = FastMCP("test-server")
    register_slack_tools(mcp)
    return mcp


class TestSlackPostMessageContract:
    """Contract tests for slack_post_message tool."""

    @pytest.mark.asyncio
    async def test_returns_message_response(self, mcp_server, mock_slack_client):
        """Test that slack_post_message returns channel, ts, and message."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {"text": "Test message", "user": "U01234567"},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_post_message")
        assert tool is not None, "slack_post_message tool should be registered"

        result = await tool.fn(
            channel="C01234567",
            text="Test message",
        )

        # Verify structure
        assert result["ok"] is True
        assert "channel" in result
        assert "ts" in result
        assert "message" in result

    @pytest.mark.asyncio
    async def test_supports_thread_ts(self, mcp_server, mock_slack_client):
        """Test that thread_ts is passed for replies."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {"text": "Reply message"},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_post_message")

        await tool.fn(
            channel="C01234567",
            text="Reply message",
            thread_ts="1234567890.000000",
        )

        # Verify thread_ts was passed
        call_kwargs = mock_slack_client.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert payload.get("thread_ts") == "1234567890.000000"


class TestSlackPostBlocksContract:
    """Contract tests for slack_post_blocks tool."""

    @pytest.mark.asyncio
    async def test_returns_message_response(self, mcp_server, mock_slack_client):
        """Test that slack_post_blocks returns channel, ts, and message."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {"blocks": [{"type": "section"}]},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_post_blocks")
        assert tool is not None, "slack_post_blocks tool should be registered"

        result = await tool.fn(
            channel="C01234567",
            blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "Test"}}],
            text="Fallback text",
        )

        assert result["ok"] is True
        assert "channel" in result
        assert "ts" in result
        assert "message" in result

    @pytest.mark.asyncio
    async def test_blocks_and_text_sent(self, mcp_server, mock_slack_client):
        """Test both blocks and fallback text are sent."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_post_blocks")

        test_blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": "Test"}}]
        await tool.fn(
            channel="C01234567",
            blocks=test_blocks,
            text="Fallback text",
        )

        call_kwargs = mock_slack_client.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert payload.get("blocks") == test_blocks
        assert payload.get("text") == "Fallback text"


class TestSlackUpdateMessageContract:
    """Contract tests for slack_update_message tool."""

    @pytest.mark.asyncio
    async def test_updates_message(self, mcp_server, mock_slack_client):
        """Test that slack_update_message updates existing message."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {"text": "Updated message"},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_update_message")
        assert tool is not None, "slack_update_message tool should be registered"

        result = await tool.fn(
            channel="C01234567",
            ts="1234567890.123456",
            text="Updated message",
        )

        assert result["ok"] is True
        assert "channel" in result
        assert "ts" in result

    @pytest.mark.asyncio
    async def test_updates_with_blocks(self, mcp_server, mock_slack_client):
        """Test updating message with new blocks."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_update_message")

        new_blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": "New"}}]
        await tool.fn(
            channel="C01234567",
            ts="1234567890.123456",
            blocks=new_blocks,
        )

        call_kwargs = mock_slack_client.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert payload.get("blocks") == new_blocks


class TestSlackPostApprovalRequestContract:
    """Contract tests for slack_post_approval_request tool."""

    @pytest.mark.asyncio
    async def test_posts_formatted_approval(self, mcp_server, mock_slack_client):
        """Test approval request is posted with Block Kit formatting."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_post_approval_request")
        assert tool is not None, "slack_post_approval_request tool should be registered"

        result = await tool.fn(
            channel="C01234567",
            lead_name="John Smith",
            lead_company="Acme Corp",
            lead_email="john@acme.com",
            reply_text="I'm interested in learning more about your product.",
            draft_response="Hi John, thanks for your interest! Let's schedule a call.",
            intent="positive_interest",
            confidence=0.82,
            tier=2,
            draft_id="draft_123",
            expires_at="2024-01-15T18:00:00Z",
        )

        assert result["ok"] is True

        # Verify blocks were sent
        call_kwargs = mock_slack_client.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert "blocks" in payload
        blocks = payload["blocks"]

        # Verify key block types
        block_types = [b.get("type") for b in blocks]
        assert "header" in block_types
        assert "section" in block_types
        assert "actions" in block_types
        assert "divider" in block_types


class TestSlackPostEscalationContract:
    """Contract tests for slack_post_escalation tool."""

    @pytest.mark.asyncio
    async def test_posts_formatted_escalation(self, mcp_server, mock_slack_client):
        """Test escalation is posted with Block Kit formatting."""
        mock_slack_client.post.return_value = {
            "ok": True,
            "channel": "C01234567",
            "ts": "1234567890.123456",
            "message": {},
        }

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_post_escalation")
        assert tool is not None, "slack_post_escalation tool should be registered"

        result = await tool.fn(
            channel="C01234567",
            lead_name="Jane Doe",
            lead_company="Beta Inc",
            lead_email="jane@beta.com",
            reply_text="I'm very frustrated with your support team!",
            reason="Negative sentiment (-0.8) below threshold",
            intent="objection",
            sentiment=-0.8,
            urgency="high",
            escalation_id="esc_456",
        )

        assert result["ok"] is True

        # Verify blocks were sent
        call_kwargs = mock_slack_client.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert "blocks" in payload

        # Verify fallback text contains escalation marker
        assert "🚨" in payload.get("text", "")


class TestSlackResolveApprovalContract:
    """Contract tests for slack_resolve_approval tool."""

    @pytest.mark.asyncio
    async def test_updates_message_with_resolution(self, mcp_server, mock_slack_client):
        """Test approval message is updated with resolution status."""
        # Mock getting original message
        mock_slack_client.post.side_effect = [
            {  # conversations.history response
                "ok": True,
                "messages": [
                    {
                        "blocks": [
                            {"type": "header", "text": {"type": "plain_text", "text": "Test"}},
                            {"type": "actions", "elements": []},
                        ]
                    }
                ],
            },
            {  # chat.update response
                "ok": True,
                "channel": "C01234567",
                "ts": "1234567890.123456",
                "message": {},
            },
        ]

        tools = mcp_server._tool_manager._tools
        tool = tools.get("slack_resolve_approval")
        assert tool is not None, "slack_resolve_approval tool should be registered"

        result = await tool.fn(
            channel="C01234567",
            ts="1234567890.123456",
            draft_id="draft_123",
            status="approved",
            resolved_by="U01234567",
        )

        assert result["ok"] is True


class TestBlockKitBuilders:
    """Tests for Block Kit builder functions."""

    def test_build_approval_blocks_structure(self):
        """Test approval blocks have required structure."""
        blocks = build_approval_blocks(
            lead_name="John",
            lead_company="Acme",
            lead_email="john@acme.com",
            reply_text="Test reply",
            draft_response="Test response",
            intent="positive_interest",
            confidence=0.82,
            tier=2,
            draft_id="draft_123",
            expires_at="2024-01-15T18:00:00Z",
        )

        assert isinstance(blocks, list)
        assert len(blocks) > 0

        # Find action block
        action_blocks = [b for b in blocks if b.get("type") == "actions"]
        assert len(action_blocks) == 1

        # Verify action buttons
        actions = action_blocks[0].get("elements", [])
        action_ids = [a.get("action_id") for a in actions]
        assert "approve_draft" in action_ids
        assert "edit_draft" in action_ids
        assert "reject_draft" in action_ids
        assert "escalate_draft" in action_ids

    def test_build_approval_blocks_truncates_long_content(self):
        """Test that long content is truncated."""
        long_reply = "x" * 1000
        long_response = "y" * 1000

        blocks = build_approval_blocks(
            lead_name="John",
            lead_company="Acme",
            lead_email="john@acme.com",
            reply_text=long_reply,
            draft_response=long_response,
            intent="positive_interest",
            confidence=0.82,
            tier=2,
            draft_id="draft_123",
            expires_at="2024-01-15T18:00:00Z",
        )

        # Verify blocks contain truncated content
        block_str = str(blocks)
        assert "..." in block_str  # Should have truncation markers

    def test_build_escalation_blocks_structure(self):
        """Test escalation blocks have required structure."""
        blocks = build_escalation_blocks(
            lead_name="Jane",
            lead_company="Beta",
            lead_email="jane@beta.com",
            reply_text="Escalation test",
            reason="Negative sentiment",
            intent="objection",
            sentiment=-0.8,
            urgency="high",
            escalation_id="esc_456",
        )

        assert isinstance(blocks, list)
        assert len(blocks) > 0

        # Find action block
        action_blocks = [b for b in blocks if b.get("type") == "actions"]
        assert len(action_blocks) == 1

        # Verify claim button
        actions = action_blocks[0].get("elements", [])
        assert any(a.get("action_id") == "claim_escalation" for a in actions)

    def test_build_escalation_blocks_urgency_emoji(self):
        """Test urgency level shows correct emoji."""
        for urgency, expected_emoji in [("high", "🔴"), ("medium", "🟡"), ("low", "🟢")]:
            blocks = build_escalation_blocks(
                lead_name="Test",
                lead_company="Test",
                lead_email="test@test.com",
                reply_text="Test",
                reason="Test reason",
                intent="objection",
                sentiment=-0.5,
                urgency=urgency,
                escalation_id="esc_test",
            )

            context_blocks = [b for b in blocks if b.get("type") == "context"]
            assert len(context_blocks) > 0
            context_text = str(context_blocks[0])
            assert expected_emoji in context_text

    def test_build_status_update_blocks_removes_actions(self):
        """Test status update removes action buttons."""
        original_blocks = [
            {"type": "header", "text": {"type": "plain_text", "text": "Test"}},
            {"type": "section", "text": {"type": "mrkdwn", "text": "Content"}},
            {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Click"}}]},
        ]

        updated_blocks = build_status_update_blocks(
            draft_id="draft_123",
            status="approved",
            resolved_by="U01234567",
            original_blocks=original_blocks,
        )

        # Verify actions block is removed
        action_blocks = [b for b in updated_blocks if b.get("type") == "actions"]
        assert len(action_blocks) == 0

        # Verify original non-action blocks preserved
        header_blocks = [b for b in updated_blocks if b.get("type") == "header"]
        assert len(header_blocks) == 1

    def test_build_status_update_blocks_adds_resolution_context(self):
        """Test status update adds resolution context."""
        updated_blocks = build_status_update_blocks(
            draft_id="draft_123",
            status="approved_edited",
            resolved_by="U01234567",
            original_blocks=[],
        )

        context_blocks = [b for b in updated_blocks if b.get("type") == "context"]
        assert len(context_blocks) > 0

        context_text = str(context_blocks[0])
        assert "Approved Edited" in context_text
        assert "U01234567" in context_text

    def test_build_status_update_blocks_status_emojis(self):
        """Test each status has appropriate emoji."""
        statuses = {
            "approved": "✅",
            "approved_edited": "✏️",
            "rejected": "🚫",
            "escalated": "⬆️",
            "expired": "⏰",
        }

        for status, expected_emoji in statuses.items():
            updated_blocks = build_status_update_blocks(
                draft_id="draft_test",
                status=status,
                original_blocks=[],
            )

            block_str = str(updated_blocks)
            assert expected_emoji in block_str, f"Status {status} should have emoji {expected_emoji}"


class TestSlackAPIError:
    """Tests for SlackAPIError exception."""

    def test_error_message(self):
        """Test error contains Slack error code."""
        error = SlackAPIError("channel_not_found", {"ok": False, "error": "channel_not_found"})

        assert error.error == "channel_not_found"
        assert "channel_not_found" in str(error)
        assert error.response == {"ok": False, "error": "channel_not_found"}
