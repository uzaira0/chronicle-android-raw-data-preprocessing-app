"""
Preprocessing module for Chronicle Android raw data.

This module contains all preprocessing logic for transforming raw Chronicle Android
data files. It is framework-agnostic and can be used independently of the GUI.

The module is Polars-first and uses the accelerated I/O/runtime path throughout
the supported preprocessing flow.

Usage:
    from chronicle_preprocessing_app.core.preprocessing import MainPreprocessor
    preprocessor = MainPreprocessor(options)

"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

__all__ = [
    "AppFilterPreprocessor",
    "AppUsagePreprocessor",
    "BasePreprocessor",
    "ChronicleAndroidRawDataPreprocessor",
    "ColumnPreprocessor",
    "DataFramePreprocessingConfig",
    "MainPreprocessor",
    "PreprocessingResult",
    "ScreenUsagePreprocessor",
    "StudyDateRangeProvider",
    "SurveyDataPreprocessor",
    "TimestampPreprocessor",
    "TimezonePreprocessor",
    "preprocess_chronicle_dataframe",
]


_EXPORTS: dict[str, tuple[str, str]] = {
    "AppFilterPreprocessor": (".app_filter_preprocessor", "AppFilterPreprocessor"),
    "AppUsagePreprocessor": (".app_usage_preprocessor", "AppUsagePreprocessor"),
    "BasePreprocessor": (".base_preprocessor", "BasePreprocessor"),
    "ChronicleAndroidRawDataPreprocessor": (
        ".main_preprocessor",
        "ChronicleAndroidRawDataPreprocessor",
    ),
    "ColumnPreprocessor": (".column_preprocessor", "ColumnPreprocessor"),
    "DataFramePreprocessingConfig": (".dataframe_api", "DataFramePreprocessingConfig"),
    "MainPreprocessor": (".main_preprocessor", "MainPreprocessor"),
    "PreprocessingResult": (".dataframe_api", "PreprocessingResult"),
    "ScreenUsagePreprocessor": (".screen_usage_preprocessor", "ScreenUsagePreprocessor"),
    "StudyDateRangeProvider": (".study_date_provider", "StudyDateRangeProvider"),
    "SurveyDataPreprocessor": (".survey_data_preprocessor", "SurveyDataPreprocessor"),
    "TimestampPreprocessor": (".timestamp_preprocessor", "TimestampPreprocessor"),
    "TimezonePreprocessor": (".timezone_preprocessor", "TimezonePreprocessor"),
    "preprocess_chronicle_dataframe": (".dataframe_api", "preprocess_chronicle_dataframe"),
}


def __getattr__(name: str) -> Any:
    """Load preprocessing exports lazily to keep submodule imports lightweight."""
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    module_name, attr_name = _EXPORTS[name]
    module = import_module(module_name, __name__)
    value = getattr(module, attr_name)
    globals()[name] = value
    return value


def is_polars_available() -> bool:
    """Check if Polars-based preprocessing is available."""
    try:
        import polars  # noqa: F401
    except ImportError:
        return False
    return True


if TYPE_CHECKING:
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
    from .screen_usage_preprocessor import ScreenUsagePreprocessor
    from .study_date_provider import StudyDateRangeProvider
    from .survey_data_preprocessor import SurveyDataPreprocessor
    from .timestamp_preprocessor import TimestampPreprocessor
    from .timezone_preprocessor import TimezonePreprocessor
