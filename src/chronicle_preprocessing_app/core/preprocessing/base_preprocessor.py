"""
Base preprocessor class for Chronicle data processing.

Supports both Pandas and Polars DataFrames through a unified interface.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, TypeVar, Union

import pandas as pd

# Conditional Polars import
try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    pl = None  # type: ignore

from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)

# Environment variable to control Polars usage
USE_POLARS = os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true" and POLARS_AVAILABLE

# Type alias for DataFrame (supports both Pandas and Polars)
if TYPE_CHECKING:
    import polars as pl

    DataFrameType = Union[pd.DataFrame, "pl.DataFrame"]
else:
    DataFrameType = Any


def is_polars_dataframe(df: Any) -> bool:
    """Check if the given object is a Polars DataFrame."""
    if not POLARS_AVAILABLE:
        return False
    return isinstance(df, pl.DataFrame)


def is_pandas_dataframe(df: Any) -> bool:
    """Check if the given object is a Pandas DataFrame."""
    return isinstance(df, pd.DataFrame)


def to_pandas(df: DataFrameType) -> pd.DataFrame:
    """Convert a DataFrame to Pandas if it's Polars."""
    if is_polars_dataframe(df):
        return df.to_pandas()
    return df


def to_polars(df: DataFrameType) -> "pl.DataFrame":
    """Convert a DataFrame to Polars if it's Pandas."""
    if not POLARS_AVAILABLE:
        raise ImportError("Polars is not available")
    if is_pandas_dataframe(df):
        return pl.from_pandas(df)
    return df


class BasePreprocessor(ABC):
    """
    Abstract base class for data processors.

    Each preprocessor is responsible for a specific type of data transformation.
    Supports both Pandas and Polars DataFrames.
    """

    def __init__(self, options: PreprocessingOptions) -> None:
        """
        Initialize the preprocessor.

        Args:
            options: The preprocessing options
        """
        self.options = options
        self._use_polars = USE_POLARS

    @property
    def use_polars(self) -> bool:
        """Check if Polars should be used."""
        return self._use_polars and POLARS_AVAILABLE

    @abstractmethod
    def preprocess(self, df: DataFrameType, *args, **kwargs) -> DataFrameType:
        """
        Process the dataframe.

        Args:
            df: The dataframe to process (Pandas or Polars)

        Returns:
            The processed dataframe (same type as input)
        """

