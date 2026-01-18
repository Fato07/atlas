"""Attio MCP tools for CRM operations."""

import os
from typing import Optional

import httpx
from fastmcp import FastMCP
from pydantic import BaseModel

ATTIO_API_URL = "https://api.attio.com/v2"
ATTIO_API_KEY = os.getenv("ATTIO_API_KEY")


class AttioClient:
    """Attio API client."""

    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url=ATTIO_API_URL,
            headers={
                "Authorization": f"Bearer {ATTIO_API_KEY}",
                "Content-Type": "application/json",
            },
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

    async def patch(self, path: str, **kwargs) -> dict:
        response = await self.client.patch(path, **kwargs)
        response.raise_for_status()
        return response.json()


attio = AttioClient()


def register_attio_tools(mcp: FastMCP) -> None:
    """Register all Attio CRM tools with the MCP server."""

    @mcp.tool()
    async def find_person(email: str) -> Optional[dict]:
        """
        Find a person in Attio by email.

        Args:
            email: Email address to search for

        Returns:
            Person record or None if not found
        """
        try:
            response = await attio.post(
                "/objects/people/records/query",
                json={
                    "filter": {
                        "email_addresses": {"contains": email}
                    }
                },
            )
            records = response.get("data", [])
            if records:
                return records[0]
            return None
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    @mcp.tool()
    async def create_person(
        email: str,
        name: str,
        company: Optional[str] = None,
        title: Optional[str] = None,
        linkedin_url: Optional[str] = None,
    ) -> dict:
        """
        Create a new person in Attio.

        Args:
            email: Email address (required)
            name: Full name (required)
            company: Company name
            title: Job title
            linkedin_url: LinkedIn profile URL

        Returns:
            Created person record
        """
        data = {
            "data": {
                "values": {
                    "email_addresses": [{"email_address": email}],
                    "name": [{"full_name": name}],
                }
            }
        }

        if title:
            data["data"]["values"]["job_title"] = [{"value": title}]

        response = await attio.post("/objects/people/records", json=data)
        return response.get("data")

    @mcp.tool()
    async def update_person(
        record_id: str,
        fields: dict,
    ) -> dict:
        """
        Update a person record in Attio.

        Args:
            record_id: The Attio record ID
            fields: Dictionary of fields to update

        Returns:
            Updated person record
        """
        data = {"data": {"values": fields}}
        response = await attio.patch(f"/objects/people/records/{record_id}", json=data)
        return response.get("data")

    @mcp.tool()
    async def update_pipeline_stage(
        record_id: str,
        list_id: str,
        stage: str,
    ) -> dict:
        """
        Update a record's pipeline stage in Attio.

        Args:
            record_id: The record ID
            list_id: The pipeline/list ID
            stage: New stage name

        Returns:
            Updated entry
        """
        # First find the entry in the list
        response = await attio.post(
            f"/lists/{list_id}/entries/query",
            json={"filter": {"record_id": record_id}},
        )

        entries = response.get("data", [])
        if not entries:
            raise ValueError(f"Record {record_id} not found in list {list_id}")

        entry_id = entries[0]["id"]["entry_id"]

        # Update the stage
        response = await attio.patch(
            f"/lists/{list_id}/entries/{entry_id}",
            json={"data": {"stage": stage}},
        )
        return response.get("data")

    @mcp.tool()
    async def add_activity(
        record_id: str,
        activity_type: str,
        content: str,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Add an activity/note to a record in Attio.

        Args:
            record_id: The record ID to add activity to
            activity_type: Type of activity (note, email, call, meeting)
            content: Activity content/description
            metadata: Optional additional metadata

        Returns:
            Created activity record
        """
        data = {
            "data": {
                "type": activity_type,
                "content": content,
                "record_id": record_id,
            }
        }

        if metadata:
            data["data"]["metadata"] = metadata

        response = await attio.post("/activities", json=data)
        return response.get("data")

    @mcp.tool()
    async def create_task(
        record_id: str,
        title: str,
        due_date: Optional[str] = None,
        assigned_to: Optional[str] = None,
        description: Optional[str] = None,
    ) -> dict:
        """
        Create a task linked to a record.

        Args:
            record_id: The record ID to link the task to
            title: Task title
            due_date: Due date (ISO format)
            assigned_to: User ID to assign to
            description: Task description

        Returns:
            Created task record
        """
        data = {
            "data": {
                "title": title,
                "linked_records": [{"record_id": record_id}],
            }
        }

        if due_date:
            data["data"]["due_date"] = due_date
        if assigned_to:
            data["data"]["assignees"] = [{"user_id": assigned_to}]
        if description:
            data["data"]["description"] = description

        response = await attio.post("/tasks", json=data)
        return response.get("data")

    @mcp.tool()
    async def get_pipeline_records(
        list_id: str,
        stage: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """
        Get records from a pipeline/list.

        Args:
            list_id: The pipeline/list ID
            stage: Optional stage to filter by
            limit: Maximum records to return

        Returns:
            List of records in the pipeline
        """
        query = {"limit": limit}
        if stage:
            query["filter"] = {"stage": stage}

        response = await attio.post(f"/lists/{list_id}/entries/query", json=query)
        return response.get("data", [])

    @mcp.tool()
    async def get_record_activities(
        record_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """
        Get activities for a record.

        Args:
            record_id: The record ID
            limit: Maximum activities to return

        Returns:
            List of activities
        """
        response = await attio.post(
            "/activities/query",
            json={
                "filter": {"record_id": record_id},
                "limit": limit,
                "sort": [{"field": "created_at", "direction": "desc"}],
            },
        )
        return response.get("data", [])
