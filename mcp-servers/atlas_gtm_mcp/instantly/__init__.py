"""Instantly MCP tools for email campaign operations.

Production-quality MCP server implementing:
- v2 API with Bearer token authentication
- 38 tools across 6 categories (Campaigns, Leads, Emails, Accounts, Analytics, Jobs)
- Rate limiting with exponential backoff (max 3 retries)
- Structured JSON logging with correlation IDs
- Pydantic validation for all inputs
"""

from __future__ import annotations

import time
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from .client import (
    InstantlyAPIError,
    InstantlyNonRetriableError,
    InstantlyRetriableError,
    get_instantly_client,
)
from .logging import generate_correlation_id, log_tool_error, log_tool_result
from .models import (
    AccountStatus,
    BulkLeadInput,
    CampaignInput,
    CampaignStatus,
    EmailReplyInput,
    LeadInput,
    LeadStatus,
    validate_campaign_id,
    validate_email,
    validate_non_empty_string,
)


def _handle_api_error(error: InstantlyAPIError, operation: str) -> None:
    """Convert API errors to user-friendly ToolErrors.

    Args:
        error: The API error that occurred
        operation: Description of the operation for context

    Raises:
        ToolError: User-friendly error message
    """
    raise ToolError(f"{operation} failed: {str(error)}")


def register_instantly_tools(mcp: FastMCP) -> None:
    """Register all Instantly email tools with the MCP server.

    Registers 38 tools across 6 categories:
    - Campaigns (8 tools): list, get, create, update, launch, pause, analytics, sequence
    - Leads (10 tools): list, get, add, bulk add, update, move, status, update status, pause, resume
    - Emails (8 tools): thread, reply, recent replies, inbox, mark read, mark replied, analytics, schedule
    - Accounts (5 tools): list, get, status, update, pause/resume
    - Analytics (4 tools): account, campaign, daily, inbox
    - Jobs (3 tools): status, list, cancel

    Args:
        mcp: FastMCP server instance to register tools with
    """

    # =========================================================================
    # Campaign Tools (8 tools)
    # =========================================================================

    @mcp.tool()
    async def list_campaigns(
        status: str | None = None,
        limit: int = 100,
        skip: int = 0,
    ) -> dict[str, Any]:
        """
        List all email campaigns with optional filtering.

        Args:
            status: Filter by status (DRAFT, ACTIVE, PAUSED, COMPLETED)
            limit: Maximum campaigns to return (1-1000, default 100)
            skip: Number of campaigns to skip for pagination

        Returns:
            List of campaigns with id, name, status, and lead count
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params: dict[str, Any] = {"limit": limit, "skip": skip}

        if status:
            if not CampaignStatus.validate(status):
                raise ToolError(
                    f"Invalid status '{status}'. Valid values: {CampaignStatus.values()}"
                )
            params["status"] = status.upper()

        try:
            client = get_instantly_client()
            result = await client.get("/campaigns", correlation_id=correlation_id, params=params)
            log_tool_result("list_campaigns", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("list_campaigns", params, e, start_time, correlation_id)
            _handle_api_error(e, "List campaigns")

    @mcp.tool()
    async def get_campaign(campaign_id: str) -> dict[str, Any]:
        """
        Get detailed information about a specific campaign.

        Args:
            campaign_id: The campaign's unique identifier

        Returns:
            Full campaign details including sequence, accounts, and settings
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params = {"campaign_id": campaign_id}

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        try:
            client = get_instantly_client()
            result = await client.get(
                f"/campaigns/{campaign_id}", correlation_id=correlation_id
            )
            log_tool_result("get_campaign", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_campaign", params, e, start_time, correlation_id)
            _handle_api_error(e, "Get campaign")

    @mcp.tool()
    async def create_campaign(
        name: str,
        account_ids: list[str] | None = None,
        schedule: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Create a new email campaign.

        Args:
            name: Campaign name (required)
            account_ids: List of sending account IDs to assign
            schedule: Optional scheduling settings (timezone, days, hours)

        Returns:
            Created campaign with ID and initial settings
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        try:
            campaign_name = validate_non_empty_string(name, "name")
        except ValueError as e:
            raise ToolError(str(e))

        payload: dict[str, Any] = {"name": campaign_name}
        if account_ids:
            payload["account_ids"] = account_ids
        if schedule:
            payload["schedule"] = schedule

        try:
            client = get_instantly_client()
            result = await client.post(
                "/campaigns", correlation_id=correlation_id, json=payload
            )
            log_tool_result("create_campaign", {"name": name}, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("create_campaign", {"name": name}, e, start_time, correlation_id)
            _handle_api_error(e, "Create campaign")

    @mcp.tool()
    async def update_campaign(
        campaign_id: str,
        name: str | None = None,
        account_ids: list[str] | None = None,
        schedule: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Update an existing campaign's settings.

        Args:
            campaign_id: The campaign's unique identifier
            name: New campaign name
            account_ids: New list of sending account IDs
            schedule: New scheduling settings

        Returns:
            Updated campaign data
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params = {"campaign_id": campaign_id}

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        payload: dict[str, Any] = {}
        if name:
            payload["name"] = name
        if account_ids:
            payload["account_ids"] = account_ids
        if schedule:
            payload["schedule"] = schedule

        if not payload:
            raise ToolError("At least one field must be provided for update")

        try:
            client = get_instantly_client()
            result = await client.patch(
                f"/campaigns/{campaign_id}", correlation_id=correlation_id, json=payload
            )
            log_tool_result("update_campaign", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("update_campaign", params, e, start_time, correlation_id)
            _handle_api_error(e, "Update campaign")

    @mcp.tool()
    async def launch_campaign(campaign_id: str) -> dict[str, Any]:
        """
        Launch/activate a draft campaign to start sending emails.

        Args:
            campaign_id: The campaign's unique identifier

        Returns:
            Updated campaign with ACTIVE status
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params = {"campaign_id": campaign_id}

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/campaigns/{campaign_id}/launch", correlation_id=correlation_id
            )
            log_tool_result("launch_campaign", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("launch_campaign", params, e, start_time, correlation_id)
            _handle_api_error(e, "Launch campaign")

    @mcp.tool()
    async def pause_campaign(campaign_id: str) -> dict[str, Any]:
        """
        Pause an active campaign to stop sending emails.

        Args:
            campaign_id: The campaign's unique identifier

        Returns:
            Updated campaign with PAUSED status
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params = {"campaign_id": campaign_id}

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/campaigns/{campaign_id}/pause", correlation_id=correlation_id
            )
            log_tool_result("pause_campaign", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("pause_campaign", params, e, start_time, correlation_id)
            _handle_api_error(e, "Pause campaign")

    @mcp.tool()
    async def get_campaign_analytics(campaign_id: str) -> dict[str, Any]:
        """
        Get performance analytics for a campaign.

        Args:
            campaign_id: The campaign's unique identifier

        Returns:
            Analytics including sent, opened, replied, bounced counts and rates
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params = {"campaign_id": campaign_id}

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        try:
            client = get_instantly_client()
            result = await client.get(
                f"/campaigns/{campaign_id}/analytics", correlation_id=correlation_id
            )
            log_tool_result("get_campaign_analytics", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_campaign_analytics", params, e, start_time, correlation_id)
            _handle_api_error(e, "Get campaign analytics")

    @mcp.tool()
    async def get_campaign_sequence(campaign_id: str) -> dict[str, Any]:
        """
        Get the email sequence steps for a campaign.

        Args:
            campaign_id: The campaign's unique identifier

        Returns:
            Sequence steps with subject, body, and delay settings
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params = {"campaign_id": campaign_id}

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        try:
            client = get_instantly_client()
            result = await client.get(
                f"/campaigns/{campaign_id}/sequence", correlation_id=correlation_id
            )
            log_tool_result("get_campaign_sequence", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_campaign_sequence", params, e, start_time, correlation_id)
            _handle_api_error(e, "Get campaign sequence")

    # =========================================================================
    # Lead Tools (10 tools)
    # =========================================================================

    @mcp.tool()
    async def list_leads(
        campaign_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
        skip: int = 0,
    ) -> dict[str, Any]:
        """
        List leads with optional filtering by campaign and status.

        Args:
            campaign_id: Filter by specific campaign
            status: Filter by status (NEW, CONTACTED, REPLIED, INTERESTED, etc.)
            limit: Maximum leads to return (1-1000, default 100)
            skip: Number of leads to skip for pagination

        Returns:
            List of leads with email, name, status, and campaign info
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params: dict[str, Any] = {"limit": limit, "skip": skip}

        if campaign_id:
            params["campaign_id"] = campaign_id
        if status:
            if not LeadStatus.validate(status):
                raise ToolError(
                    f"Invalid status '{status}'. Valid values: {LeadStatus.values()}"
                )
            params["status"] = status.upper()

        try:
            client = get_instantly_client()
            result = await client.get("/leads", correlation_id=correlation_id, params=params)
            log_tool_result("list_leads", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("list_leads", params, e, start_time, correlation_id)
            _handle_api_error(e, "List leads")

    @mcp.tool()
    async def get_lead(email: str, campaign_id: str | None = None) -> dict[str, Any]:
        """
        Get detailed information about a specific lead.

        Args:
            email: Lead's email address
            campaign_id: Optional campaign ID to get campaign-specific data

        Returns:
            Lead details including status, activity history, and custom fields
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()
        params: dict[str, Any] = {"email": email}

        if not validate_email(email):
            raise ToolError("Invalid email format")

        if campaign_id:
            params["campaign_id"] = campaign_id

        try:
            client = get_instantly_client()
            result = await client.get("/leads/get", correlation_id=correlation_id, params=params)
            log_tool_result("get_lead", {"email": "[REDACTED]"}, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_lead", {"email": "[REDACTED]"}, e, start_time, correlation_id)
            _handle_api_error(e, "Get lead")

    @mcp.tool()
    async def add_lead(
        campaign_id: str,
        email: str,
        first_name: str | None = None,
        last_name: str | None = None,
        company_name: str | None = None,
        custom_variables: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """
        Add a single lead to a campaign.

        Args:
            campaign_id: Target campaign ID
            email: Lead's email address (required)
            first_name: Lead's first name
            last_name: Lead's last name
            company_name: Lead's company
            custom_variables: Custom fields (e.g., {"title": "CEO"})

        Returns:
            Created lead data with campaign membership
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")
        if not validate_email(email):
            raise ToolError("Invalid email format")

        payload: dict[str, Any] = {
            "campaign_id": campaign_id,
            "email": email,
        }
        if first_name:
            payload["first_name"] = first_name
        if last_name:
            payload["last_name"] = last_name
        if company_name:
            payload["company_name"] = company_name
        if custom_variables:
            payload["custom_variables"] = custom_variables

        try:
            client = get_instantly_client()
            result = await client.post(
                "/leads/add", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "add_lead",
                {"campaign_id": campaign_id, "email": "[REDACTED]"},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "add_lead",
                {"campaign_id": campaign_id, "email": "[REDACTED]"},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Add lead")

    @mcp.tool()
    async def add_leads_bulk(
        campaign_id: str,
        leads: list[dict[str, Any]],
        skip_if_in_workspace: bool = True,
    ) -> dict[str, Any]:
        """
        Add multiple leads to a campaign in bulk (max 100 per request).

        Args:
            campaign_id: Target campaign ID
            leads: List of lead objects with email, first_name, last_name, etc.
            skip_if_in_workspace: Skip leads already in any campaign (default True)

        Returns:
            Bulk operation result with success/failure counts
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")
        if not leads:
            raise ToolError("At least one lead must be provided")
        if len(leads) > 100:
            raise ToolError("Maximum 100 leads per bulk operation. Split into multiple requests.")

        # Validate each lead has an email
        for i, lead in enumerate(leads):
            if "email" not in lead:
                raise ToolError(f"Lead at index {i} missing required 'email' field")
            if not validate_email(lead["email"]):
                raise ToolError(f"Lead at index {i} has invalid email format")

        payload = {
            "campaign_id": campaign_id,
            "leads": leads,
            "skip_if_in_workspace": skip_if_in_workspace,
        }

        try:
            client = get_instantly_client()
            result = await client.post(
                "/leads/add/bulk", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "add_leads_bulk",
                {"campaign_id": campaign_id, "lead_count": len(leads)},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "add_leads_bulk",
                {"campaign_id": campaign_id, "lead_count": len(leads)},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Bulk add leads")

    @mcp.tool()
    async def update_lead(
        email: str,
        campaign_id: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        company_name: str | None = None,
        custom_variables: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """
        Update a lead's data.

        Args:
            email: Lead's email address
            campaign_id: Campaign context for the update
            first_name: New first name
            last_name: New last name
            company_name: New company name
            custom_variables: Custom fields to update

        Returns:
            Updated lead data
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")

        payload: dict[str, Any] = {"email": email}
        if campaign_id:
            payload["campaign_id"] = campaign_id
        if first_name:
            payload["first_name"] = first_name
        if last_name:
            payload["last_name"] = last_name
        if company_name:
            payload["company_name"] = company_name
        if custom_variables:
            payload["custom_variables"] = custom_variables

        if len(payload) == 1:  # Only email provided
            raise ToolError("At least one field must be provided for update")

        try:
            client = get_instantly_client()
            result = await client.patch(
                "/leads/update", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "update_lead", {"email": "[REDACTED]"}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "update_lead", {"email": "[REDACTED]"}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Update lead")

    @mcp.tool()
    async def move_lead(
        email: str,
        from_campaign_id: str,
        to_campaign_id: str,
    ) -> dict[str, Any]:
        """
        Move a lead from one campaign to another.

        Args:
            email: Lead's email address
            from_campaign_id: Source campaign ID
            to_campaign_id: Destination campaign ID

        Returns:
            Move operation result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(from_campaign_id):
            raise ToolError("Invalid from_campaign_id format")
        if not validate_campaign_id(to_campaign_id):
            raise ToolError("Invalid to_campaign_id format")

        payload = {
            "email": email,
            "from_campaign_id": from_campaign_id,
            "to_campaign_id": to_campaign_id,
        }

        try:
            client = get_instantly_client()
            result = await client.post(
                "/leads/move", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "move_lead",
                {
                    "email": "[REDACTED]",
                    "from_campaign_id": from_campaign_id,
                    "to_campaign_id": to_campaign_id,
                },
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "move_lead",
                {"email": "[REDACTED]"},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Move lead")

    @mcp.tool()
    async def get_lead_status(email: str, campaign_id: str) -> dict[str, Any]:
        """
        Get a lead's status within a specific campaign.

        Args:
            email: Lead's email address
            campaign_id: Campaign ID

        Returns:
            Lead's campaign-specific status, sequence step, and activity
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        params = {"email": email, "campaign_id": campaign_id}

        try:
            client = get_instantly_client()
            result = await client.get(
                "/leads/status", correlation_id=correlation_id, params=params
            )
            log_tool_result(
                "get_lead_status",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_lead_status",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Get lead status")

    @mcp.tool()
    async def update_lead_status(
        email: str,
        campaign_id: str,
        status: str,
    ) -> dict[str, Any]:
        """
        Update a lead's status in a campaign.

        Args:
            email: Lead's email address
            campaign_id: Campaign ID
            status: New status (NEW, CONTACTED, REPLIED, INTERESTED, NOT_INTERESTED, etc.)

        Returns:
            Updated lead status
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")
        if not LeadStatus.validate(status):
            raise ToolError(
                f"Invalid status '{status}'. Valid values: {LeadStatus.values()}"
            )

        payload = {
            "email": email,
            "campaign_id": campaign_id,
            "status": status.upper(),
        }

        try:
            client = get_instantly_client()
            result = await client.post(
                "/leads/status", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "update_lead_status",
                {"email": "[REDACTED]", "campaign_id": campaign_id, "status": status},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "update_lead_status",
                {"email": "[REDACTED]", "campaign_id": campaign_id, "status": status},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Update lead status")

    @mcp.tool()
    async def pause_lead(email: str, campaign_id: str) -> dict[str, Any]:
        """
        Pause a lead's sequence (stop sending emails to this lead).

        Args:
            email: Lead's email address
            campaign_id: Campaign ID

        Returns:
            Pause operation result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        payload = {"email": email, "campaign_id": campaign_id}

        try:
            client = get_instantly_client()
            result = await client.post(
                "/leads/pause", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "pause_lead",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "pause_lead",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Pause lead")

    @mcp.tool()
    async def resume_lead(email: str, campaign_id: str) -> dict[str, Any]:
        """
        Resume a paused lead's sequence.

        Args:
            email: Lead's email address
            campaign_id: Campaign ID

        Returns:
            Resume operation result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")

        payload = {"email": email, "campaign_id": campaign_id}

        try:
            client = get_instantly_client()
            result = await client.post(
                "/leads/resume", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "resume_lead",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "resume_lead",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Resume lead")

    # =========================================================================
    # Email Tools (8 tools)
    # =========================================================================

    @mcp.tool()
    async def get_email_thread(
        email: str,
        campaign_id: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """
        Get the email conversation thread with a lead.

        Args:
            email: Lead's email address
            campaign_id: Optional campaign ID to filter by
            limit: Maximum messages to return (default 50)

        Returns:
            Thread with all messages in chronological order
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")

        params: dict[str, Any] = {"email": email, "limit": limit}
        if campaign_id:
            params["campaign_id"] = campaign_id

        try:
            client = get_instantly_client()
            result = await client.get(
                "/emails/thread", correlation_id=correlation_id, params=params
            )
            log_tool_result(
                "get_email_thread",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_email_thread",
                {"email": "[REDACTED]"},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Get email thread")

    @mcp.tool()
    async def send_reply(
        email: str,
        campaign_id: str,
        body: str,
        subject: str | None = None,
    ) -> dict[str, Any]:
        """
        Send a reply to a lead in a campaign.

        Args:
            email: Lead's email address
            campaign_id: Campaign ID
            body: Reply message content (HTML supported)
            subject: Optional subject line (uses Re: original if not provided)

        Returns:
            Send result with message ID
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")
        if not body or not body.strip():
            raise ToolError("Reply body cannot be empty")

        payload: dict[str, Any] = {
            "email": email,
            "campaign_id": campaign_id,
            "body": body,
        }
        if subject:
            payload["subject"] = subject

        try:
            client = get_instantly_client()
            result = await client.post(
                "/emails/reply", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "send_reply",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "send_reply",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Send reply")

    @mcp.tool()
    async def get_recent_replies(
        campaign_id: str | None = None,
        since_hours: int = 24,
        limit: int = 100,
        unread_only: bool = False,
    ) -> dict[str, Any]:
        """
        Get recent replies from leads.

        Args:
            campaign_id: Optional campaign ID to filter by
            since_hours: How many hours back to look (default 24)
            limit: Maximum replies to return (default 100)
            unread_only: Only return unread replies

        Returns:
            List of recent replies with lead context
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {
            "since_hours": since_hours,
            "limit": limit,
            "unread_only": unread_only,
        }
        if campaign_id:
            params["campaign_id"] = campaign_id

        try:
            client = get_instantly_client()
            result = await client.get(
                "/emails/replies", correlation_id=correlation_id, params=params
            )
            log_tool_result(
                "get_recent_replies",
                {"campaign_id": campaign_id, "since_hours": since_hours},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_recent_replies",
                {"campaign_id": campaign_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Get recent replies")

    @mcp.tool()
    async def list_inbox(
        campaign_id: str | None = None,
        account_id: str | None = None,
        limit: int = 100,
        skip: int = 0,
    ) -> dict[str, Any]:
        """
        List inbox messages.

        Args:
            campaign_id: Optional campaign ID to filter by
            account_id: Optional account ID to filter by
            limit: Maximum messages to return (default 100)
            skip: Number of messages to skip for pagination

        Returns:
            List of inbox messages
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {"limit": limit, "skip": skip}
        if campaign_id:
            params["campaign_id"] = campaign_id
        if account_id:
            params["account_id"] = account_id

        try:
            client = get_instantly_client()
            result = await client.get(
                "/inbox", correlation_id=correlation_id, params=params
            )
            log_tool_result("list_inbox", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("list_inbox", params, e, start_time, correlation_id)
            _handle_api_error(e, "List inbox")

    @mcp.tool()
    async def mark_as_read(message_id: str) -> dict[str, Any]:
        """
        Mark an inbox message as read.

        Args:
            message_id: Message ID to mark as read

        Returns:
            Update result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not message_id or not message_id.strip():
            raise ToolError("message_id is required")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/inbox/{message_id}/read", correlation_id=correlation_id
            )
            log_tool_result(
                "mark_as_read", {"message_id": message_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "mark_as_read", {"message_id": message_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Mark as read")

    @mcp.tool()
    async def mark_as_replied(message_id: str) -> dict[str, Any]:
        """
        Mark an inbox message as replied.

        Args:
            message_id: Message ID to mark as replied

        Returns:
            Update result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not message_id or not message_id.strip():
            raise ToolError("message_id is required")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/inbox/{message_id}/replied", correlation_id=correlation_id
            )
            log_tool_result(
                "mark_as_replied", {"message_id": message_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "mark_as_replied", {"message_id": message_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Mark as replied")

    @mcp.tool()
    async def get_email_analytics(
        campaign_id: str | None = None,
        account_id: str | None = None,
        days: int = 30,
    ) -> dict[str, Any]:
        """
        Get email performance analytics.

        Args:
            campaign_id: Optional campaign ID to filter by
            account_id: Optional account ID to filter by
            days: Number of days to analyze (default 30)

        Returns:
            Email analytics including open rates, reply rates, bounce rates
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {"days": days}
        if campaign_id:
            params["campaign_id"] = campaign_id
        if account_id:
            params["account_id"] = account_id

        try:
            client = get_instantly_client()
            result = await client.get(
                "/analytics/emails", correlation_id=correlation_id, params=params
            )
            log_tool_result("get_email_analytics", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_email_analytics", params, e, start_time, correlation_id)
            _handle_api_error(e, "Get email analytics")

    @mcp.tool()
    async def schedule_email(
        email: str,
        campaign_id: str,
        body: str,
        subject: str,
        send_at: str,
    ) -> dict[str, Any]:
        """
        Schedule an email to be sent at a specific time.

        Args:
            email: Recipient's email address
            campaign_id: Campaign ID
            body: Email body content (HTML supported)
            subject: Email subject line
            send_at: ISO 8601 datetime for scheduled send (e.g., "2024-01-15T10:00:00Z")

        Returns:
            Scheduled email details with ID
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not validate_email(email):
            raise ToolError("Invalid email format")
        if not validate_campaign_id(campaign_id):
            raise ToolError("Invalid campaign_id format")
        if not body or not body.strip():
            raise ToolError("Email body cannot be empty")
        if not subject or not subject.strip():
            raise ToolError("Email subject cannot be empty")

        payload = {
            "email": email,
            "campaign_id": campaign_id,
            "body": body,
            "subject": subject,
            "send_at": send_at,
        }

        try:
            client = get_instantly_client()
            result = await client.post(
                "/emails/schedule", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "schedule_email",
                {"email": "[REDACTED]", "campaign_id": campaign_id, "send_at": send_at},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "schedule_email",
                {"email": "[REDACTED]", "campaign_id": campaign_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Schedule email")

    # =========================================================================
    # Account Tools (5 tools)
    # =========================================================================

    @mcp.tool()
    async def list_accounts(
        status: str | None = None,
        limit: int = 100,
        skip: int = 0,
    ) -> dict[str, Any]:
        """
        List all sending accounts.

        Args:
            status: Filter by status (ACTIVE, PAUSED, WARMUP, ERROR)
            limit: Maximum accounts to return (default 100)
            skip: Number of accounts to skip for pagination

        Returns:
            List of accounts with email, status, and warmup progress
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {"limit": limit, "skip": skip}
        if status:
            if not AccountStatus.validate(status):
                raise ToolError(
                    f"Invalid status '{status}'. Valid values: {AccountStatus.values()}"
                )
            params["status"] = status.upper()

        try:
            client = get_instantly_client()
            result = await client.get(
                "/accounts", correlation_id=correlation_id, params=params
            )
            log_tool_result("list_accounts", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("list_accounts", params, e, start_time, correlation_id)
            _handle_api_error(e, "List accounts")

    @mcp.tool()
    async def get_account(account_id: str) -> dict[str, Any]:
        """
        Get detailed information about a sending account.

        Args:
            account_id: Account's unique identifier

        Returns:
            Account details including warmup status, daily limits, and health
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not account_id or not account_id.strip():
            raise ToolError("account_id is required")

        try:
            client = get_instantly_client()
            result = await client.get(
                f"/accounts/{account_id}", correlation_id=correlation_id
            )
            log_tool_result(
                "get_account", {"account_id": account_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_account", {"account_id": account_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Get account")

    @mcp.tool()
    async def get_account_status(account_id: str) -> dict[str, Any]:
        """
        Get the warmup and sending status of an account.

        Args:
            account_id: Account's unique identifier

        Returns:
            Status including daily limit, sent today, warmup progress, health score
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not account_id or not account_id.strip():
            raise ToolError("account_id is required")

        try:
            client = get_instantly_client()
            result = await client.get(
                f"/accounts/{account_id}/status", correlation_id=correlation_id
            )
            log_tool_result(
                "get_account_status",
                {"account_id": account_id},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_account_status", {"account_id": account_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Get account status")

    @mcp.tool()
    async def update_account(
        account_id: str,
        daily_limit: int | None = None,
        warmup_enabled: bool | None = None,
        warmup_limit: int | None = None,
    ) -> dict[str, Any]:
        """
        Update account settings.

        Args:
            account_id: Account's unique identifier
            daily_limit: Maximum emails per day
            warmup_enabled: Enable/disable warmup
            warmup_limit: Maximum warmup emails per day

        Returns:
            Updated account data
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not account_id or not account_id.strip():
            raise ToolError("account_id is required")

        payload: dict[str, Any] = {}
        if daily_limit is not None:
            payload["daily_limit"] = daily_limit
        if warmup_enabled is not None:
            payload["warmup_enabled"] = warmup_enabled
        if warmup_limit is not None:
            payload["warmup_limit"] = warmup_limit

        if not payload:
            raise ToolError("At least one setting must be provided for update")

        try:
            client = get_instantly_client()
            result = await client.patch(
                f"/accounts/{account_id}", correlation_id=correlation_id, json=payload
            )
            log_tool_result(
                "update_account",
                {"account_id": account_id, **payload},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "update_account", {"account_id": account_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Update account")

    @mcp.tool()
    async def pause_account(account_id: str) -> dict[str, Any]:
        """
        Pause a sending account (stops all sending).

        Args:
            account_id: Account's unique identifier

        Returns:
            Updated account with PAUSED status
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not account_id or not account_id.strip():
            raise ToolError("account_id is required")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/accounts/{account_id}/pause", correlation_id=correlation_id
            )
            log_tool_result(
                "pause_account", {"account_id": account_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "pause_account", {"account_id": account_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Pause account")

    @mcp.tool()
    async def resume_account(account_id: str) -> dict[str, Any]:
        """
        Resume a paused sending account.

        Args:
            account_id: Account's unique identifier

        Returns:
            Updated account with ACTIVE status
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not account_id or not account_id.strip():
            raise ToolError("account_id is required")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/accounts/{account_id}/resume", correlation_id=correlation_id
            )
            log_tool_result(
                "resume_account", {"account_id": account_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "resume_account", {"account_id": account_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Resume account")

    # =========================================================================
    # Analytics Tools (4 tools)
    # =========================================================================

    @mcp.tool()
    async def get_account_analytics(
        account_id: str,
        days: int = 30,
    ) -> dict[str, Any]:
        """
        Get analytics for a specific sending account.

        Args:
            account_id: Account's unique identifier
            days: Number of days to analyze (default 30)

        Returns:
            Account analytics including send volume, deliverability, reputation
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not account_id or not account_id.strip():
            raise ToolError("account_id is required")

        params = {"days": days}

        try:
            client = get_instantly_client()
            result = await client.get(
                f"/analytics/accounts/{account_id}",
                correlation_id=correlation_id,
                params=params,
            )
            log_tool_result(
                "get_account_analytics",
                {"account_id": account_id, "days": days},
                result,
                start_time,
                correlation_id,
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_account_analytics",
                {"account_id": account_id},
                e,
                start_time,
                correlation_id,
            )
            _handle_api_error(e, "Get account analytics")

    @mcp.tool()
    async def get_daily_stats(
        start_date: str,
        end_date: str,
        campaign_id: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Get daily statistics for a date range.

        Args:
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            campaign_id: Optional campaign ID to filter by
            account_id: Optional account ID to filter by

        Returns:
            Daily breakdown of sends, opens, replies, bounces
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {
            "start_date": start_date,
            "end_date": end_date,
        }
        if campaign_id:
            params["campaign_id"] = campaign_id
        if account_id:
            params["account_id"] = account_id

        try:
            client = get_instantly_client()
            result = await client.get(
                "/analytics/daily", correlation_id=correlation_id, params=params
            )
            log_tool_result("get_daily_stats", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_daily_stats", params, e, start_time, correlation_id)
            _handle_api_error(e, "Get daily stats")

    @mcp.tool()
    async def get_inbox_stats(
        campaign_id: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Get inbox statistics.

        Args:
            campaign_id: Optional campaign ID to filter by
            account_id: Optional account ID to filter by

        Returns:
            Inbox stats including unread count, reply count, bounce count
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {}
        if campaign_id:
            params["campaign_id"] = campaign_id
        if account_id:
            params["account_id"] = account_id

        try:
            client = get_instantly_client()
            result = await client.get(
                "/analytics/inbox", correlation_id=correlation_id, params=params
            )
            log_tool_result("get_inbox_stats", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("get_inbox_stats", params, e, start_time, correlation_id)
            _handle_api_error(e, "Get inbox stats")

    # =========================================================================
    # Background Job Tools (3 tools)
    # =========================================================================

    @mcp.tool()
    async def get_job_status(job_id: str) -> dict[str, Any]:
        """
        Get the status of an async background job.

        Args:
            job_id: Job's unique identifier

        Returns:
            Job status including progress, state, and result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not job_id or not job_id.strip():
            raise ToolError("job_id is required")

        try:
            client = get_instantly_client()
            result = await client.get(f"/jobs/{job_id}", correlation_id=correlation_id)
            log_tool_result(
                "get_job_status", {"job_id": job_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "get_job_status", {"job_id": job_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Get job status")

    @mcp.tool()
    async def list_jobs(
        status: str | None = None,
        limit: int = 50,
        skip: int = 0,
    ) -> dict[str, Any]:
        """
        List recent background jobs.

        Args:
            status: Filter by status (PENDING, RUNNING, COMPLETED, FAILED)
            limit: Maximum jobs to return (default 50)
            skip: Number of jobs to skip for pagination

        Returns:
            List of jobs with ID, type, status, and progress
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        params: dict[str, Any] = {"limit": limit, "skip": skip}
        if status:
            params["status"] = status.upper()

        try:
            client = get_instantly_client()
            result = await client.get("/jobs", correlation_id=correlation_id, params=params)
            log_tool_result("list_jobs", params, result, start_time, correlation_id)
            return result
        except InstantlyAPIError as e:
            log_tool_error("list_jobs", params, e, start_time, correlation_id)
            _handle_api_error(e, "List jobs")

    @mcp.tool()
    async def cancel_job(job_id: str) -> dict[str, Any]:
        """
        Cancel a pending background job.

        Args:
            job_id: Job's unique identifier

        Returns:
            Cancellation result
        """
        start_time = time.perf_counter()
        correlation_id = generate_correlation_id()

        if not job_id or not job_id.strip():
            raise ToolError("job_id is required")

        try:
            client = get_instantly_client()
            result = await client.post(
                f"/jobs/{job_id}/cancel", correlation_id=correlation_id
            )
            log_tool_result(
                "cancel_job", {"job_id": job_id}, result, start_time, correlation_id
            )
            return result
        except InstantlyAPIError as e:
            log_tool_error(
                "cancel_job", {"job_id": job_id}, e, start_time, correlation_id
            )
            _handle_api_error(e, "Cancel job")
