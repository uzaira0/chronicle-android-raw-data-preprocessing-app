"""
Pydantic models for Chronicle Android preprocessing.

This module defines validated models for API requests/responses,
configuration, and processing results. These models provide runtime
validation and serialization for data exchange.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from chronicle_preprocessing_app.config.constants import (
    ChronicleDeviceType,
    DeviceSharingStatus,
    InteractionType,
    TimezoneHandlingOption,
    UsageSessionMode,
)
from chronicle_preprocessing_app.config.defaults import DEFAULT_APP_CODEBOOK_FILE_PATH

# =============================================================================
# Processing Result Models
# =============================================================================


class ProcessingResult(BaseModel):
    """Result of processing a single Chronicle data file."""

    participant_id: str = Field(..., description="Participant identifier")
    input_file: Path = Field(..., description="Path to input file")
    output_folder: Path | None = Field(None, description="Path to output folder")
    success: bool = Field(..., description="Whether processing succeeded")
    error_message: str | None = Field(None, description="Error message if failed")
    rows_in: int = Field(0, ge=0, description="Number of input rows")
    rows_out: int = Field(0, ge=0, description="Number of output rows")
    device_type: ChronicleDeviceType | None = Field(None, description="Detected device type")
    processing_duration_seconds: float = Field(0.0, ge=0, description="Processing time")
    timestamp: datetime = Field(default_factory=datetime.now, description="When processed")

    model_config = {"use_enum_values": True}


class BatchProcessingResult(BaseModel):
    """Result of processing multiple Chronicle data files."""

    study_name: str = Field(..., description="Study name")
    total_files: int = Field(0, ge=0, description="Total files found")
    successful: int = Field(0, ge=0, description="Successfully processed")
    failed: int = Field(0, ge=0, description="Failed to process")
    empty_files: int = Field(0, ge=0, description="Files with no valid data")
    total_rows_in: int = Field(0, ge=0, description="Total input rows")
    total_rows_out: int = Field(0, ge=0, description="Total output rows")
    duration_seconds: float = Field(0.0, ge=0, description="Total processing time")
    results: list[ProcessingResult] = Field(default_factory=list, description="Per-file results")
    errors: dict[str, str] = Field(default_factory=dict, description="File -> error message")
    timestamp: datetime = Field(default_factory=datetime.now, description="When processed")

    @property
    def success_rate(self) -> float:
        """Calculate success rate as percentage."""
        if self.total_files == 0:
            return 0.0
        return (self.successful / self.total_files) * 100.0

    @property
    def throughput_rows_per_second(self) -> float:
        """Calculate processing throughput."""
        if self.duration_seconds == 0:
            return 0.0
        return self.total_rows_in / self.duration_seconds


# =============================================================================
# Compliance Models
# =============================================================================


class DailyCompliance(BaseModel):
    """Compliance data for a single day."""

    day_number: int = Field(..., ge=1, description="Day number in study (1-indexed)")
    date: datetime | None = Field(None, description="Calendar date")
    compliance_percentage: float | None = Field(
        None,
        ge=0,
        le=100,
        description="Compliance percentage (0-100)",
    )
    target_child_usage_minutes: float = Field(0.0, ge=0, description="Target child usage")
    other_usage_minutes: float = Field(0.0, ge=0, description="Other user usage")
    unknown_usage_minutes: float = Field(0.0, ge=0, description="Unknown user usage")
    has_data: bool = Field(True, description="Whether day has usage data")


class ParticipantCompliance(BaseModel):
    """Compliance data for a single participant."""

    participant_id: str = Field(..., description="Participant identifier")
    device_sharing_status: DeviceSharingStatus = Field(
        DeviceSharingStatus.NONSHARED,
        description="Device sharing status",
    )
    study_start_date: datetime | None = Field(None, description="Study start date")
    study_end_date: datetime | None = Field(None, description="Study end date")
    daily_compliance: list[DailyCompliance] = Field(
        default_factory=list,
        description="Daily compliance data",
    )
    overall_compliance: float | None = Field(
        None,
        ge=0,
        le=100,
        description="Overall compliance percentage",
    )
    valid_days: int = Field(0, ge=0, description="Number of valid days")
    total_days: int = Field(0, ge=0, description="Total study days")

    model_config = {"use_enum_values": True}


# =============================================================================
# App Usage Models
# =============================================================================


class AppUsageEvent(BaseModel):
    """A single app usage event."""

    participant_id: str = Field(..., description="Participant identifier")
    app_package_name: str = Field(..., description="Android package name")
    application_label: str | None = Field(None, description="Human-readable app name")
    start_timestamp: datetime = Field(..., description="Usage start time")
    stop_timestamp: datetime | None = Field(None, description="Usage end time")
    duration_seconds: float | None = Field(None, ge=0, description="Duration in seconds")
    interaction_type: InteractionType = Field(..., description="Type of interaction")
    username: str | None = Field(None, description="Associated username")
    broad_app_category: str | None = Field(None, description="App category")
    timezone: str | None = Field(None, description="Timezone of event")

    model_config = {"use_enum_values": True}

    @model_validator(mode="after")
    def calculate_duration(self) -> AppUsageEvent:
        """Calculate duration if not provided but timestamps available."""
        if self.duration_seconds is None and self.stop_timestamp is not None:
            delta = self.stop_timestamp - self.start_timestamp
            object.__setattr__(self, "duration_seconds", delta.total_seconds())
        return self


class AppUsageSummary(BaseModel):
    """Summary of app usage for a participant."""

    participant_id: str = Field(..., description="Participant identifier")
    date: datetime = Field(..., description="Date of summary")
    total_usage_minutes: float = Field(0.0, ge=0, description="Total usage time")
    unique_apps: int = Field(0, ge=0, description="Number of unique apps used")
    app_switches: int = Field(0, ge=0, description="Number of app switches")
    new_engagements_30s: int = Field(0, ge=0, description="New engagements (30s gap)")
    top_apps: list[tuple[str, float]] = Field(
        default_factory=list,
        description="Top apps by usage (app_name, minutes)",
    )


# =============================================================================
# API Request/Response Models (for web service)
# =============================================================================


class PreprocessingRequest(BaseModel):
    """Request to preprocess Chronicle data files."""

    study_name: str = Field(..., min_length=1, description="Study name")
    raw_data_folder: Path = Field(..., description="Path to raw data folder")
    timezone: str | None = Field(None, description="Target timezone")
    timezone_handling: TimezoneHandlingOption = Field(
        TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
        description="How to handle timezone differences",
    )
    use_app_codebook: bool = Field(True, description="Use app codebook for categorization")
    app_codebook_path: Path | None = Field(
        Path(DEFAULT_APP_CODEBOOK_FILE_PATH),
        description="Path to app codebook",
    )
    use_filter_file: bool = Field(False, description="Use app filter file")
    filter_file_path: Path | None = Field(None, description="Path to filter file")
    use_apps_forcing_screen_open_file: bool = Field(False, description="Use screen keep-awake app file")
    apps_forcing_screen_open_file_path: Path | None = Field(None, description="Path to screen keep-awake app file")
    usage_session_mode: UsageSessionMode = Field(
        UsageSessionMode.APP_USAGE,
        description="Which usage-session derivation path to run",
    )
    derive_screen_usage_sessions: bool = Field(False, description="Append derived screen usage sessions")
    screen_usage_auto_lock_timeout_seconds: int = Field(120, description="Expected screen auto-lock timeout in seconds")
    screen_usage_auto_lock_tolerance_seconds: int = Field(30, description="Tolerance around auto-lock timeout in seconds")
    screen_usage_manual_lock_max_tail_gap_seconds: int = Field(30, description="Maximum tail gap treated as probable manual lock")
    enable_plotting: bool = Field(False, description="Generate plots after preprocessing")
    algorithm: str = Field("optimized", description="App usage matching algorithm")

    @field_validator("raw_data_folder")
    @classmethod
    def validate_folder_exists(cls, v: Path) -> Path:
        """Validate that the folder exists."""
        if not v.exists():
            raise ValueError(f"Folder does not exist: {v}")
        if not v.is_dir():
            raise ValueError(f"Path is not a directory: {v}")
        return v


class PreprocessingResponse(BaseModel):
    """Response from preprocessing request."""

    success: bool = Field(..., description="Whether request succeeded")
    message: str = Field(..., description="Status message")
    result: BatchProcessingResult | None = Field(None, description="Processing results")
    output_folder: Path | None = Field(None, description="Output folder path")


class HealthCheckResponse(BaseModel):
    """Health check response."""

    status: str = Field("ok", description="Service status")
    version: str = Field(..., description="Service version")
    timestamp: datetime = Field(default_factory=datetime.now, description="Response time")


# =============================================================================
# Validation Error Models
# =============================================================================


class ValidationError(BaseModel):
    """A single validation error."""

    field: str = Field(..., description="Field with error")
    message: str = Field(..., description="Error message")
    value: Any = Field(None, description="Invalid value")
    row_index: int | None = Field(None, description="Row index if applicable")


class ValidationResult(BaseModel):
    """Result of data validation."""

    valid: bool = Field(..., description="Whether validation passed")
    errors: list[ValidationError] = Field(default_factory=list, description="Validation errors")
    warnings: list[str] = Field(default_factory=list, description="Validation warnings")
    rows_checked: int = Field(0, ge=0, description="Number of rows validated")
    timestamp: datetime = Field(default_factory=datetime.now, description="When validated")
