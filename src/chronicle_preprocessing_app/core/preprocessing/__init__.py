"""
Preprocessing module for Chronicle Android raw data.

This module contains all preprocessing logic for transforming raw Chronicle Android
data files. It is framework-agnostic and can be used independently of the GUI.

The module supports both Pandas and Polars backends. Set CHRONICLE_USE_POLARS=true
to use the Polars-accelerated I/O operations which provide significant performance
improvements (4-12x faster for CSV reading and timestamp parsing).

Usage:
    from chronicle_preprocessing_app.core.preprocessing import MainPreprocessor
    preprocessor = MainPreprocessor(options)

To enable/disable Polars acceleration:
    export CHRONICLE_USE_POLARS=true   # Enable (default)
    export CHRONICLE_USE_POLARS=false  # Disable
"""

from __future__ import annotations

from .app_filter_preprocessor import AppFilterPreprocessor
from .app_usage_preprocessor import AppUsagePreprocessor
from .base_preprocessor import BasePreprocessor
from .column_preprocessor import ColumnPreprocessor
from .dataframe_api import (
    DataFramePreprocessingConfig,
    PreprocessingResult,
    preprocess_chronicle_dataframe,
)
from .main_preprocessor import ChronicleAndroidRawDataPreprocessor, MainPreprocessor
from .study_date_provider import StudyDateRangeProvider
from .timestamp_preprocessor import TimestampPreprocessor

# SurveyDataPreprocessor is an internal module that may not be available
try:
    from .survey_data_preprocessor import SurveyDataPreprocessor
except ImportError:
    SurveyDataPreprocessor = None  # type: ignore[assignment, misc]
from .timezone_preprocessor import TimezonePreprocessor

# Check if Polars is available
try:
    import polars  # noqa: F401

    _POLARS_AVAILABLE = True
except ImportError:
    _POLARS_AVAILABLE = False

__all__ = [
    "AppFilterPreprocessor",
    "AppUsagePreprocessor",
    "BasePreprocessor",
    "ChronicleAndroidRawDataPreprocessor",
    "ColumnPreprocessor",
    "DataFramePreprocessingConfig",
    "MainPreprocessor",
    "PreprocessingResult",
    "StudyDateRangeProvider",
    "SurveyDataPreprocessor",
    "TimestampPreprocessor",
    "TimezonePreprocessor",
    "preprocess_chronicle_dataframe",
]


def is_polars_available() -> bool:
    """Check if Polars-based preprocessing is available."""
    return _POLARS_AVAILABLE

