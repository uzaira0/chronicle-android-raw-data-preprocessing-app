"""
DataFrame provider abstraction for swappable Pandas/Polars implementations.

This module provides a protocol-based abstraction that allows the preprocessing
pipeline to work with either Pandas or Polars DataFrames. The active implementation
is controlled by the CHRONICLE_USE_POLARS environment variable.

Usage:
    from chronicle_preprocessing_app.core.dataframe_provider import get_dataframe_provider, DataFrameLike

    provider = get_dataframe_provider()
    df = provider.read_csv(path)
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, TypeVar, runtime_checkable

import pandas as pd

# Conditional import for type checking
if TYPE_CHECKING:
    import polars as pl

# Type aliases for DataFrame types
PandasDataFrame = pd.DataFrame
PandasSeries = pd.Series

# Environment variable to control which implementation to use
USE_POLARS = os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true"


@runtime_checkable
class DataFrameProviderProtocol(Protocol):
    """Protocol defining the interface for DataFrame operations."""

    def read_csv(
        self,
        path: str | Path,
        *,
        skipinitialspace: bool = True,
        dtypes: dict[str, Any] | None = None,
    ) -> Any:
        """Read a CSV file into a DataFrame."""
        ...

    def to_csv(
        self,
        df: Any,
        path: str | Path,
        *,
        index: bool = False,
    ) -> None:
        """Write a DataFrame to a CSV file."""
        ...

    def is_empty(self, df: Any) -> bool:
        """Check if a DataFrame is empty."""
        ...

    def get_column(self, df: Any, column: str) -> Any:
        """Get a column from a DataFrame."""
        ...

    def set_column(self, df: Any, column: str, values: Any) -> Any:
        """Set a column in a DataFrame, returning a new DataFrame."""
        ...

    def filter(self, df: Any, mask: Any) -> Any:
        """Filter a DataFrame by a boolean mask."""
        ...

    def sort_by(self, df: Any, column: str, *, descending: bool = False) -> Any:
        """Sort a DataFrame by a column."""
        ...

    def reset_index(self, df: Any) -> Any:
        """Reset the index of a DataFrame."""
        ...

    def concat(self, dfs: list[Any], *, ignore_index: bool = True) -> Any:
        """Concatenate multiple DataFrames."""
        ...

    def to_pandas(self, df: Any) -> pd.DataFrame:
        """Convert to a Pandas DataFrame (for compatibility)."""
        ...

    def from_pandas(self, df: pd.DataFrame) -> Any:
        """Convert from a Pandas DataFrame."""
        ...

    @property
    def name(self) -> str:
        """Return the name of the provider (e.g., 'pandas' or 'polars')."""
        ...


class PandasProvider:
    """Pandas implementation of the DataFrame provider."""

    @property
    def name(self) -> str:
        return "pandas"

    def read_csv(
        self,
        path: str | Path,
        *,
        skipinitialspace: bool = True,
        dtypes: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        """Read a CSV file into a Pandas DataFrame."""
        return pd.read_csv(
            path,
            skipinitialspace=skipinitialspace,
            dtype=dtypes,
        )

    def to_csv(
        self,
        df: pd.DataFrame,
        path: str | Path,
        *,
        index: bool = False,
    ) -> None:
        """Write a Pandas DataFrame to a CSV file."""
        df.to_csv(path, index=index)

    def is_empty(self, df: pd.DataFrame) -> bool:
        """Check if a Pandas DataFrame is empty."""
        return df.empty

    def get_column(self, df: pd.DataFrame, column: str) -> pd.Series:
        """Get a column from a Pandas DataFrame."""
        return df[column]

    def set_column(self, df: pd.DataFrame, column: str, values: Any) -> pd.DataFrame:
        """Set a column in a Pandas DataFrame."""
        df = df.copy()
        df[column] = values
        return df

    def filter(self, df: pd.DataFrame, mask: pd.Series) -> pd.DataFrame:
        """Filter a Pandas DataFrame by a boolean mask."""
        return df[mask]

    def sort_by(self, df: pd.DataFrame, column: str, *, descending: bool = False) -> pd.DataFrame:
        """Sort a Pandas DataFrame by a column."""
        return df.sort_values(column, ascending=not descending)

    def reset_index(self, df: pd.DataFrame) -> pd.DataFrame:
        """Reset the index of a Pandas DataFrame."""
        return df.reset_index(drop=True)

    def concat(self, dfs: list[pd.DataFrame], *, ignore_index: bool = True) -> pd.DataFrame:
        """Concatenate multiple Pandas DataFrames."""
        return pd.concat(dfs, ignore_index=ignore_index)

    def to_pandas(self, df: pd.DataFrame) -> pd.DataFrame:
        """Return the Pandas DataFrame as-is."""
        return df

    def from_pandas(self, df: pd.DataFrame) -> pd.DataFrame:
        """Return the Pandas DataFrame as-is."""
        return df


class PolarsProvider:
    """Polars implementation of the DataFrame provider."""

    def __init__(self) -> None:
        """Initialize the Polars provider, importing polars."""
        import polars as pl

        self._pl = pl

    @property
    def name(self) -> str:
        return "polars"

    def read_csv(
        self,
        path: str | Path,
        *,
        skipinitialspace: bool = True,
        dtypes: dict[str, Any] | None = None,
    ) -> "pl.DataFrame":
        """Read a CSV file into a Polars DataFrame."""
        # Polars handles whitespace differently - use try_parse_dates for automatic parsing
        schema_overrides = None
        if dtypes:
            # Convert pandas dtypes to polars dtypes
            schema_overrides = self._convert_pandas_dtypes(dtypes)

        df = self._pl.read_csv(
            path,
            schema_overrides=schema_overrides,
            try_parse_dates=False,  # We handle date parsing separately
        )

        # Handle skipinitialspace by stripping string columns
        if skipinitialspace:
            string_cols = [col for col in df.columns if df[col].dtype == self._pl.Utf8]
            if string_cols:
                df = df.with_columns([self._pl.col(col).str.strip_chars() for col in string_cols])

        return df

    def _convert_pandas_dtypes(self, dtypes: dict[str, Any]) -> dict[str, Any]:
        """Convert pandas dtype specifications to Polars dtypes."""
        pl = self._pl
        dtype_map = {
            "str": pl.Utf8,
            "string": pl.Utf8,
            "int": pl.Int64,
            "int64": pl.Int64,
            "int32": pl.Int32,
            "float": pl.Float64,
            "float64": pl.Float64,
            "bool": pl.Boolean,
        }
        result = {}
        for col, dtype in dtypes.items():
            dtype_str = str(dtype).lower()
            if dtype_str in dtype_map:
                result[col] = dtype_map[dtype_str]
        return result

    def to_csv(
        self,
        df: "pl.DataFrame",
        path: str | Path,
        *,
        index: bool = False,
    ) -> None:
        """Write a Polars DataFrame to a CSV file."""
        # Polars doesn't have index concept, so index parameter is ignored
        df.write_csv(path)

    def is_empty(self, df: "pl.DataFrame") -> bool:
        """Check if a Polars DataFrame is empty."""
        return df.is_empty()

    def get_column(self, df: "pl.DataFrame", column: str) -> "pl.Series":
        """Get a column from a Polars DataFrame."""
        return df[column]

    def set_column(self, df: "pl.DataFrame", column: str, values: Any) -> "pl.DataFrame":
        """Set a column in a Polars DataFrame."""
        pl = self._pl
        if isinstance(values, pl.Series):
            return df.with_columns(values.alias(column))
        elif isinstance(values, (list, tuple)):
            return df.with_columns(pl.Series(column, values))
        else:
            # Scalar value - broadcast to all rows
            return df.with_columns(pl.lit(values).alias(column))

    def filter(self, df: "pl.DataFrame", mask: "pl.Series") -> "pl.DataFrame":
        """Filter a Polars DataFrame by a boolean mask."""
        return df.filter(mask)

    def sort_by(
        self, df: "pl.DataFrame", column: str, *, descending: bool = False
    ) -> "pl.DataFrame":
        """Sort a Polars DataFrame by a column."""
        return df.sort(column, descending=descending)

    def reset_index(self, df: "pl.DataFrame") -> "pl.DataFrame":
        """Reset index - Polars doesn't have index, so return as-is."""
        return df

    def concat(self, dfs: list["pl.DataFrame"], *, ignore_index: bool = True) -> "pl.DataFrame":
        """Concatenate multiple Polars DataFrames."""
        pl = self._pl
        return pl.concat(dfs)

    def to_pandas(self, df: "pl.DataFrame") -> pd.DataFrame:
        """Convert a Polars DataFrame to Pandas."""
        return df.to_pandas()

    def from_pandas(self, df: pd.DataFrame) -> "pl.DataFrame":
        """Convert a Pandas DataFrame to Polars."""
        pl = self._pl
        return pl.from_pandas(df)


# Singleton instances
_pandas_provider: PandasProvider | None = None
_polars_provider: PolarsProvider | None = None


def get_pandas_provider() -> PandasProvider:
    """Get the Pandas provider singleton."""
    global _pandas_provider
    if _pandas_provider is None:
        _pandas_provider = PandasProvider()
    return _pandas_provider


def get_polars_provider() -> PolarsProvider:
    """Get the Polars provider singleton."""
    global _polars_provider
    if _polars_provider is None:
        _polars_provider = PolarsProvider()
    return _polars_provider


def get_dataframe_provider() -> PandasProvider | PolarsProvider:
    """
    Get the active DataFrame provider based on environment configuration.

    Returns:
        The active DataFrame provider (Pandas or Polars)
    """
    if USE_POLARS:
        try:
            return get_polars_provider()
        except ImportError:
            import logging

            logging.getLogger(__name__).warning("Polars not available, falling back to Pandas")
            return get_pandas_provider()
    return get_pandas_provider()


# Type alias for DataFrame-like objects (works with both Pandas and Polars)
DataFrameLike = TypeVar("DataFrameLike", pd.DataFrame, "pl.DataFrame")

