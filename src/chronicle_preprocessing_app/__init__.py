"""
Chronicle Android Raw Data Preprocessing Package.

This package provides tools for preprocessing Chronicle Android raw data files.
It can be used as a standalone library or with the included GUI application.
"""

from __future__ import annotations

from chronicle_preprocessing_app.config.version import __version__

from .core import (
    CancellationCheck,
    LogCallback,
    MainPreprocessor,
    PlottingManager,
    PreprocessingOptions,
    ProcessingStats,
    ProgressCallback,
)

# DataFrame API for orchestrators (Dagster, etc.)
from .core.preprocessing import (
    DataFramePreprocessingConfig,
    PreprocessingResult,
    preprocess_chronicle_dataframe,
)

__all__ = [
    # Version
    "__version__",
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
    # DataFrame API for orchestrators
    "DataFramePreprocessingConfig",
    "PreprocessingResult",
    "preprocess_chronicle_dataframe",
]
