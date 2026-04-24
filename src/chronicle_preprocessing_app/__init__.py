"""
Chronicle Android Raw Data Preprocessing Package.

This package provides tools for preprocessing Chronicle Android raw data files.
It can be used as a standalone library or with the included GUI application.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

from chronicle_preprocessing_app.config.version import __version__

__all__ = [
    "__version__",
    "PreprocessingOptions",
    "ProcessingStats",
    "MainPreprocessor",
    "PlottingManager",
    "ProgressCallback",
    "CancellationCheck",
    "LogCallback",
    "DataFramePreprocessingConfig",
    "PreprocessingResult",
    "preprocess_chronicle_dataframe",
]

_EXPORTS: dict[str, tuple[str, str]] = {
    "PreprocessingOptions": (".core", "PreprocessingOptions"),
    "ProcessingStats": (".core", "ProcessingStats"),
    "MainPreprocessor": (".core", "MainPreprocessor"),
    "PlottingManager": (".core", "PlottingManager"),
    "ProgressCallback": (".core", "ProgressCallback"),
    "CancellationCheck": (".core", "CancellationCheck"),
    "LogCallback": (".core", "LogCallback"),
    "DataFramePreprocessingConfig": (".core.preprocessing", "DataFramePreprocessingConfig"),
    "PreprocessingResult": (".core.preprocessing", "PreprocessingResult"),
    "preprocess_chronicle_dataframe": (".core.preprocessing", "preprocess_chronicle_dataframe"),
}


def __getattr__(name: str) -> Any:
    """Load package-level convenience exports lazily."""
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    module_name, attr_name = _EXPORTS[name]
    module = import_module(module_name, __name__)  # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import -- module_name is selected from the private _EXPORTS whitelist above.
    value = getattr(module, attr_name)
    globals()[name] = value
    return value


if TYPE_CHECKING:
    from .core import (
        CancellationCheck,
        LogCallback,
        MainPreprocessor,
        PlottingManager,
        PreprocessingOptions,
        ProcessingStats,
        ProgressCallback,
    )
    from .core.preprocessing import (
        DataFramePreprocessingConfig,
        PreprocessingResult,
        preprocess_chronicle_dataframe,
    )
