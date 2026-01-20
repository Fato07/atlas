"""Unit tests for Attio models and validation functions.

Tests:
- Email validation (FR-019)
- Non-empty string validation (FR-020)
- Record ID and List ID validation
- Pipeline stage enum and transitions (FR-014, FR-015)
- Activity type validation (FR-021)
- Pydantic model validation
- Error type classification (FR-017)
"""

import pytest

from atlas_gtm_mcp.attio.models import (
    ActivityInput,
    ActivityType,
    AttioErrorType,
    PersonInput,
    PipelineStage,
    PipelineStageInput,
    TaskInput,
    VALID_STAGE_TRANSITIONS,
    classify_http_error,
    validate_email,
    validate_list_id,
    validate_non_empty_string,
    validate_record_id,
    validate_stage_transition,
)


# =============================================================================
# Email Validation Tests (FR-019)
# =============================================================================


class TestValidateEmail:
    """Tests for validate_email function."""

    @pytest.mark.parametrize(
        "email",
        [
            "test@example.com",
            "user.name@domain.org",
            "user+tag@example.co.uk",
            "simple@test.io",
            "UPPER@CASE.COM",
            "numbers123@test456.com",
            "dots.in.local@domain.com",
            "underscore_test@example.com",
            "hyphen-test@example.com",
        ],
    )
    def test_valid_emails(self, email: str) -> None:
        """Test that valid email formats pass validation."""
        assert validate_email(email) is True

    @pytest.mark.parametrize(
        "email",
        [
            "",  # Empty
            "   ",  # Whitespace only
            "notanemail",  # No @
            "@nodomain.com",  # No local part
            "noat.domain.com",  # No @
            "spaces in@email.com",  # Spaces in local
            "test@",  # No domain
            "test@.com",  # No domain name
            "test@domain",  # No TLD
            "test@domain.",  # Trailing dot
            None,  # None value
            123,  # Non-string
            [],  # List
        ],
    )
    def test_invalid_emails(self, email) -> None:
        """Test that invalid email formats fail validation."""
        assert validate_email(email) is False

    def test_email_with_whitespace_is_trimmed(self) -> None:
        """Test that emails with leading/trailing whitespace are handled."""
        # The validation should work on the trimmed version
        assert validate_email("  test@example.com  ") is True


# =============================================================================
# Non-Empty String Validation Tests (FR-020)
# =============================================================================


class TestValidateNonEmptyString:
    """Tests for validate_non_empty_string function."""

    def test_valid_string(self) -> None:
        """Test that valid non-empty strings pass."""
        result = validate_non_empty_string("Hello World", "test_field")
        assert result == "Hello World"

    def test_string_is_trimmed(self) -> None:
        """Test that strings are trimmed."""
        result = validate_non_empty_string("  trimmed  ", "test_field")
        assert result == "trimmed"

    def test_empty_string_raises(self) -> None:
        """Test that empty strings raise ValueError."""
        with pytest.raises(ValueError, match="test_field cannot be empty"):
            validate_non_empty_string("", "test_field")

    def test_whitespace_only_raises(self) -> None:
        """Test that whitespace-only strings raise ValueError."""
        with pytest.raises(ValueError, match="test_field cannot be empty"):
            validate_non_empty_string("   ", "test_field")

    def test_non_string_raises(self) -> None:
        """Test that non-string values raise ValueError."""
        with pytest.raises(ValueError, match="test_field must be a string"):
            validate_non_empty_string(123, "test_field")  # type: ignore

    def test_none_raises(self) -> None:
        """Test that None raises ValueError."""
        with pytest.raises(ValueError, match="test_field must be a string"):
            validate_non_empty_string(None, "test_field")  # type: ignore


# =============================================================================
# Record ID Validation Tests
# =============================================================================


class TestValidateRecordId:
    """Tests for validate_record_id function."""

    @pytest.mark.parametrize(
        "record_id",
        [
            "rec_12345678901234",
            "0123456789",  # Minimum length
            "uuid-style-record-id-here",
            "a" * 100,  # Maximum length
        ],
    )
    def test_valid_record_ids(self, record_id: str) -> None:
        """Test that valid record IDs pass validation."""
        assert validate_record_id(record_id) is True

    @pytest.mark.parametrize(
        "record_id",
        [
            "",  # Empty
            "   ",  # Whitespace only
            "short",  # Too short (< 10)
            "a" * 101,  # Too long (> 100)
            None,  # None
            123,  # Non-string
        ],
    )
    def test_invalid_record_ids(self, record_id) -> None:
        """Test that invalid record IDs fail validation."""
        assert validate_record_id(record_id) is False

    def test_record_id_with_whitespace(self) -> None:
        """Test that record IDs with whitespace are trimmed during validation."""
        # Whitespace is trimmed, so this should pass
        assert validate_record_id("  rec_12345678901234  ") is True


# =============================================================================
# List ID Validation Tests
# =============================================================================


class TestValidateListId:
    """Tests for validate_list_id function."""

    @pytest.mark.parametrize(
        "list_id",
        [
            "list_12345",  # Minimum length (5)
            "list_test_pipeline_12345",
            "a" * 100,  # Maximum length
        ],
    )
    def test_valid_list_ids(self, list_id: str) -> None:
        """Test that valid list IDs pass validation."""
        assert validate_list_id(list_id) is True

    @pytest.mark.parametrize(
        "list_id",
        [
            "",  # Empty
            "   ",  # Whitespace only
            "abc",  # Too short (< 5)
            "a" * 101,  # Too long (> 100)
            None,  # None
            123,  # Non-string
        ],
    )
    def test_invalid_list_ids(self, list_id) -> None:
        """Test that invalid list IDs fail validation."""
        assert validate_list_id(list_id) is False


# =============================================================================
# Pipeline Stage Tests (FR-014)
# =============================================================================


class TestPipelineStage:
    """Tests for PipelineStage enum."""

    def test_all_stages_defined(self) -> None:
        """Test that all required stages are defined per FR-014."""
        expected_stages = {
            "new_reply",
            "qualifying",
            "meeting_scheduled",
            "meeting_held",
            "proposal",
            "closed_won",
            "closed_lost",
        }
        actual_stages = set(PipelineStage.values())
        assert actual_stages == expected_stages

    def test_values_returns_list(self) -> None:
        """Test that values() returns a list of strings."""
        values = PipelineStage.values()
        assert isinstance(values, list)
        assert len(values) == 7
        assert all(isinstance(v, str) for v in values)

    @pytest.mark.parametrize("stage", PipelineStage.values())
    def test_validate_all_stages(self, stage: str) -> None:
        """Test that all defined stages pass validation."""
        assert PipelineStage.validate(stage) is True

    @pytest.mark.parametrize(
        "invalid_stage",
        [
            "invalid",
            "NEW_REPLY",  # Wrong case
            "new-reply",  # Wrong separator
            "",
            None,
        ],
    )
    def test_validate_invalid_stages(self, invalid_stage) -> None:
        """Test that invalid stages fail validation."""
        assert PipelineStage.validate(invalid_stage) is False


# =============================================================================
# Stage Transition Validation Tests (FR-015)
# =============================================================================


class TestStageTransitionValidation:
    """Tests for stage transition validation."""

    def test_valid_transitions_from_new_reply(self) -> None:
        """Test valid transitions from new_reply stage."""
        assert validate_stage_transition("new_reply", "qualifying") is True
        assert validate_stage_transition("new_reply", "closed_lost") is True

    def test_invalid_transitions_from_new_reply(self) -> None:
        """Test invalid transitions from new_reply stage."""
        assert validate_stage_transition("new_reply", "meeting_scheduled") is False
        assert validate_stage_transition("new_reply", "closed_won") is False

    def test_valid_transitions_from_qualifying(self) -> None:
        """Test valid transitions from qualifying stage."""
        assert validate_stage_transition("qualifying", "meeting_scheduled") is True
        assert validate_stage_transition("qualifying", "closed_lost") is True

    def test_valid_transitions_from_meeting_scheduled(self) -> None:
        """Test valid transitions from meeting_scheduled stage."""
        assert validate_stage_transition("meeting_scheduled", "meeting_held") is True
        assert validate_stage_transition("meeting_scheduled", "closed_lost") is True

    def test_valid_transitions_from_meeting_held(self) -> None:
        """Test valid transitions from meeting_held stage."""
        assert validate_stage_transition("meeting_held", "proposal") is True
        assert validate_stage_transition("meeting_held", "closed_lost") is True

    def test_valid_transitions_from_proposal(self) -> None:
        """Test valid transitions from proposal stage."""
        assert validate_stage_transition("proposal", "closed_won") is True
        assert validate_stage_transition("proposal", "closed_lost") is True

    def test_terminal_states_have_no_transitions(self) -> None:
        """Test that terminal states (closed_won, closed_lost) have no valid transitions."""
        # closed_won is terminal
        assert validate_stage_transition("closed_won", "new_reply") is False
        assert validate_stage_transition("closed_won", "closed_lost") is False

        # closed_lost is terminal
        assert validate_stage_transition("closed_lost", "new_reply") is False
        assert validate_stage_transition("closed_lost", "closed_won") is False

    def test_invalid_from_stage(self) -> None:
        """Test that invalid from_stage returns False."""
        assert validate_stage_transition("invalid_stage", "qualifying") is False

    def test_all_stages_have_transition_rules(self) -> None:
        """Test that all stages are covered in VALID_STAGE_TRANSITIONS."""
        all_stages = PipelineStage.values()
        for stage in all_stages:
            assert stage in VALID_STAGE_TRANSITIONS


# =============================================================================
# Activity Type Tests (FR-021)
# =============================================================================


class TestActivityType:
    """Tests for ActivityType enum."""

    def test_all_activity_types_defined(self) -> None:
        """Test that all required activity types are defined per FR-021."""
        expected_types = {"note", "email", "call", "meeting"}
        actual_types = set(ActivityType.values())
        assert actual_types == expected_types

    @pytest.mark.parametrize("activity_type", ActivityType.values())
    def test_validate_all_activity_types(self, activity_type: str) -> None:
        """Test that all defined activity types pass validation."""
        assert ActivityType.validate(activity_type) is True

    @pytest.mark.parametrize(
        "invalid_type",
        [
            "invalid",
            "NOTE",  # Wrong case
            "sms",  # Not a valid type
            "",
            None,
        ],
    )
    def test_validate_invalid_activity_types(self, invalid_type) -> None:
        """Test that invalid activity types fail validation."""
        assert ActivityType.validate(invalid_type) is False


# =============================================================================
# Error Type Classification Tests (FR-017)
# =============================================================================


class TestAttioErrorType:
    """Tests for AttioErrorType enum and classification."""

    def test_retriable_errors(self) -> None:
        """Test that retriable error types are correctly identified."""
        retriable = {
            AttioErrorType.RATE_LIMITED,
            AttioErrorType.NETWORK_ERROR,
            AttioErrorType.TIMEOUT,
            AttioErrorType.SERVICE_UNAVAILABLE,
        }
        for error_type in retriable:
            assert AttioErrorType.is_retriable(error_type) is True

    def test_non_retriable_errors(self) -> None:
        """Test that non-retriable error types are correctly identified."""
        non_retriable = {
            AttioErrorType.AUTHENTICATION,
            AttioErrorType.VALIDATION,
            AttioErrorType.NOT_FOUND,
            AttioErrorType.PERMISSION_DENIED,
            AttioErrorType.CONFLICT,
            AttioErrorType.BAD_REQUEST,
            AttioErrorType.UNKNOWN,
        }
        for error_type in non_retriable:
            assert AttioErrorType.is_retriable(error_type) is False


class TestClassifyHttpError:
    """Tests for classify_http_error function."""

    @pytest.mark.parametrize(
        "status_code,expected_type",
        [
            (401, AttioErrorType.AUTHENTICATION),
            (403, AttioErrorType.PERMISSION_DENIED),
            (404, AttioErrorType.NOT_FOUND),
            (409, AttioErrorType.CONFLICT),
            (422, AttioErrorType.VALIDATION),
            (429, AttioErrorType.RATE_LIMITED),
            (400, AttioErrorType.BAD_REQUEST),
            (418, AttioErrorType.BAD_REQUEST),  # Any 4xx not specifically mapped
            (500, AttioErrorType.SERVICE_UNAVAILABLE),
            (502, AttioErrorType.SERVICE_UNAVAILABLE),
            (503, AttioErrorType.SERVICE_UNAVAILABLE),
            (599, AttioErrorType.SERVICE_UNAVAILABLE),
            (200, AttioErrorType.UNKNOWN),  # Non-error code
            (301, AttioErrorType.UNKNOWN),  # Redirect
        ],
    )
    def test_status_code_classification(
        self, status_code: int, expected_type: AttioErrorType
    ) -> None:
        """Test that HTTP status codes are correctly classified."""
        assert classify_http_error(status_code) == expected_type


# =============================================================================
# Pydantic Model Tests
# =============================================================================


class TestPersonInput:
    """Tests for PersonInput Pydantic model."""

    def test_valid_person_minimal(self) -> None:
        """Test creating PersonInput with minimal required fields."""
        person = PersonInput(email="test@example.com", name="John Doe")
        assert person.email == "test@example.com"
        assert person.name == "John Doe"
        assert person.company is None
        assert person.title is None
        assert person.linkedin_url is None

    def test_valid_person_full(self) -> None:
        """Test creating PersonInput with all fields."""
        person = PersonInput(
            email="test@example.com",
            name="John Doe",
            company="Acme Inc",
            title="Engineer",
            linkedin_url="https://linkedin.com/in/johndoe",
        )
        assert person.company == "Acme Inc"
        assert person.title == "Engineer"
        assert "linkedin.com" in person.linkedin_url

    def test_email_is_lowercased(self) -> None:
        """Test that email is normalized to lowercase."""
        person = PersonInput(email="TEST@EXAMPLE.COM", name="John")
        assert person.email == "test@example.com"

    def test_invalid_email_raises(self) -> None:
        """Test that invalid email raises validation error."""
        with pytest.raises(ValueError, match="Invalid email format"):
            PersonInput(email="not-an-email", name="John")

    def test_linkedin_url_must_be_linkedin(self) -> None:
        """Test that LinkedIn URL must contain linkedin.com."""
        with pytest.raises(ValueError, match="must be a LinkedIn profile"):
            PersonInput(
                email="test@example.com",
                name="John",
                linkedin_url="https://twitter.com/johndoe",
            )

    def test_linkedin_url_https_prepended(self) -> None:
        """Test that https:// is prepended if missing."""
        person = PersonInput(
            email="test@example.com",
            name="John",
            linkedin_url="linkedin.com/in/johndoe",
        )
        assert person.linkedin_url.startswith("https://")

    def test_empty_name_raises(self) -> None:
        """Test that empty name raises validation error."""
        with pytest.raises(ValueError):
            PersonInput(email="test@example.com", name="")


class TestActivityInput:
    """Tests for ActivityInput Pydantic model."""

    def test_valid_activity(self) -> None:
        """Test creating ActivityInput with valid data."""
        activity = ActivityInput(
            record_id="rec_12345678901234",
            activity_type="note",
            content="Test activity content",
        )
        assert activity.activity_type == "note"
        assert activity.parent_object == "people"  # Default

    def test_invalid_activity_type_raises(self) -> None:
        """Test that invalid activity type raises validation error."""
        with pytest.raises(ValueError, match="Invalid activity_type"):
            ActivityInput(
                record_id="rec_12345678901234",
                activity_type="invalid",
                content="Test content",
            )

    def test_invalid_record_id_raises(self) -> None:
        """Test that invalid record_id raises validation error."""
        with pytest.raises(ValueError, match="Invalid record_id format"):
            ActivityInput(
                record_id="short",
                activity_type="note",
                content="Test content",
            )


class TestTaskInput:
    """Tests for TaskInput Pydantic model."""

    def test_valid_task_minimal(self) -> None:
        """Test creating TaskInput with minimal fields."""
        task = TaskInput(
            record_id="rec_12345678901234",
            content="Follow up with lead",
        )
        assert task.deadline_at is None
        assert task.assignee_id is None
        assert task.target_object == "people"

    def test_valid_task_with_deadline(self) -> None:
        """Test creating TaskInput with deadline."""
        task = TaskInput(
            record_id="rec_12345678901234",
            content="Follow up with lead",
            deadline_at="2024-12-31T15:00:00.000Z",
        )
        assert task.deadline_at == "2024-12-31T15:00:00.000Z"

    def test_valid_task_with_date_only_deadline(self) -> None:
        """Test creating TaskInput with date-only deadline."""
        task = TaskInput(
            record_id="rec_12345678901234",
            content="Follow up",
            deadline_at="2024-12-31",
        )
        assert task.deadline_at == "2024-12-31"

    def test_invalid_deadline_format_raises(self) -> None:
        """Test that invalid deadline format raises validation error."""
        with pytest.raises(ValueError, match="deadline_at must be in ISO format"):
            TaskInput(
                record_id="rec_12345678901234",
                content="Follow up",
                deadline_at="12/31/2024",  # Wrong format
            )


class TestPipelineStageInput:
    """Tests for PipelineStageInput Pydantic model."""

    def test_valid_stage_input(self) -> None:
        """Test creating PipelineStageInput with valid data."""
        stage_input = PipelineStageInput(
            record_id="rec_12345678901234",
            stage="qualifying",
        )
        assert stage_input.stage == "qualifying"

    def test_invalid_stage_raises(self) -> None:
        """Test that invalid stage raises validation error."""
        with pytest.raises(ValueError, match="Invalid stage"):
            PipelineStageInput(
                record_id="rec_12345678901234",
                stage="invalid_stage",
            )
