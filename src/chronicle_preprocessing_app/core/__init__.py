"""Core business logic for Chronicle Android raw data preprocessing."""

from __future__ import annotations

from .callbacks import CancellationCheck, LogCallback, ProgressCallback
from .config import PreprocessingOptions, ProcessingStats
from .exceptions import (
    CancellationError,
    ConfigurationError,
    FileProcessingError,
    PreprocessingError,
    ValidationError,
)
from .models import (
    AppUsageEvent,
    AppUsageSummary,
    BatchProcessingResult,
    DailyCompliance,
    HealthCheckResponse,
    ParticipantCompliance,
    PreprocessingRequest,
    PreprocessingResponse,
    ProcessingResult,
    ValidationResult,
)
from .models import (
    ValidationError as PydanticValidationError,
)
from .plotting import PlottingManager
from .preprocessing import MainPreprocessor
from .schemas import (
    AppUsageRowSchema,
    ComplianceDataSchema,
    PreprocessedChronicleDataSchema,
    RawChronicleDataSchema,
    validate_app_usage_rows,
    validate_preprocessed_data,
    validate_raw_data,
)

__all__ = [
    # Configuration
    "PreprocessingOptions",
    "ProcessingStats",
    # Main classes
    "MainPreprocessor",
    "PlottingManager",
    # Callbacks
    "ProgressCallback",
    "CancellationCheck",
    "LogCallback",
    # Exceptions
    "PreprocessingError",
    "ConfigurationError",
    "ValidationError",
    "FileProcessingError",
    "CancellationError",
    # Pydantic Models
    "ProcessingResult",
    "BatchProcessingResult",
    "DailyCompliance",
    "ParticipantCompliance",
    "AppUsageEvent",
    "AppUsageSummary",
    "PreprocessingRequest",
    "PreprocessingResponse",
    "HealthCheckResponse",
    "PydanticValidationError",
    "ValidationResult",
    # Pandera Schemas
    "RawChronicleDataSchema",
    "PreprocessedChronicleDataSchema",
    "AppUsageRowSchema",
    "ComplianceDataSchema",
    # Validation Functions
    "validate_raw_data",
    "validate_preprocessed_data",
    "validate_app_usage_rows",
]
