"""Core business logic for Chronicle Android raw data preprocessing."""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

__all__ = [
    "PreprocessingOptions",
    "ProcessingStats",
    "MainPreprocessor",
    "PlottingManager",
    "ProgressCallback",
    "CancellationCheck",
    "LogCallback",
    "PreprocessingError",
    "ConfigurationError",
    "ValidationError",
    "FileProcessingError",
    "CancellationError",
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
    "RawChronicleDataSchema",
    "PreprocessedChronicleDataSchema",
    "AppUsageRowSchema",
    "ComplianceDataSchema",
    "validate_raw_data",
    "validate_preprocessed_data",
    "validate_app_usage_rows",
]

_EXPORTS: dict[str, tuple[str, str]] = {
    "PreprocessingOptions": (".config", "PreprocessingOptions"),
    "ProcessingStats": (".config", "ProcessingStats"),
    "MainPreprocessor": (".preprocessing", "MainPreprocessor"),
    "PlottingManager": (".plotting", "PlottingManager"),
    "ProgressCallback": (".callbacks", "ProgressCallback"),
    "CancellationCheck": (".callbacks", "CancellationCheck"),
    "LogCallback": (".callbacks", "LogCallback"),
    "PreprocessingError": (".exceptions", "PreprocessingError"),
    "ConfigurationError": (".exceptions", "ConfigurationError"),
    "ValidationError": (".exceptions", "ValidationError"),
    "FileProcessingError": (".exceptions", "FileProcessingError"),
    "CancellationError": (".exceptions", "CancellationError"),
    "ProcessingResult": (".models", "ProcessingResult"),
    "BatchProcessingResult": (".models", "BatchProcessingResult"),
    "DailyCompliance": (".models", "DailyCompliance"),
    "ParticipantCompliance": (".models", "ParticipantCompliance"),
    "AppUsageEvent": (".models", "AppUsageEvent"),
    "AppUsageSummary": (".models", "AppUsageSummary"),
    "PreprocessingRequest": (".models", "PreprocessingRequest"),
    "PreprocessingResponse": (".models", "PreprocessingResponse"),
    "HealthCheckResponse": (".models", "HealthCheckResponse"),
    "PydanticValidationError": (".models", "ValidationError"),
    "ValidationResult": (".models", "ValidationResult"),
    "RawChronicleDataSchema": (".schemas", "RawChronicleDataSchema"),
    "PreprocessedChronicleDataSchema": (".schemas", "PreprocessedChronicleDataSchema"),
    "AppUsageRowSchema": (".schemas", "AppUsageRowSchema"),
    "ComplianceDataSchema": (".schemas", "ComplianceDataSchema"),
    "validate_raw_data": (".schemas", "validate_raw_data"),
    "validate_preprocessed_data": (".schemas", "validate_preprocessed_data"),
    "validate_app_usage_rows": (".schemas", "validate_app_usage_rows"),
}


def __getattr__(name: str) -> Any:
    """Load public exports lazily so optional API dependencies do not block core imports."""
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    module_name, attr_name = _EXPORTS[name]
    module = import_module(module_name, __name__)  # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import -- module_name is selected from the private _EXPORTS whitelist above.
    value = getattr(module, attr_name)
    globals()[name] = value
    return value


if TYPE_CHECKING:
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
        ValidationError as PydanticValidationError,
        ValidationResult,
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
