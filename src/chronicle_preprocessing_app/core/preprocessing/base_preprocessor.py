"""Base class for Polars-backed preprocessors."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, TypeAlias

import polars as pl

from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)

DataFrameType: TypeAlias = pl.DataFrame


def is_polars_dataframe(df: Any) -> bool:
    return isinstance(df, pl.DataFrame)


def to_polars(df: DataFrameType) -> pl.DataFrame:
    if not isinstance(df, pl.DataFrame):
        msg = f"Expected Polars DataFrame, got {type(df)}"
        raise TypeError(msg)
    return df


class BasePreprocessor(ABC):
    """Abstract base class for preprocessing stages."""

    def __init__(self, options: PreprocessingOptions) -> None:
        self.options = options

    @property
    def use_polars(self) -> bool:
        return True

    @abstractmethod
    def preprocess(self, df: DataFrameType, *args: Any, **kwargs: Any) -> DataFrameType:
        """Process the dataframe and return the result."""
