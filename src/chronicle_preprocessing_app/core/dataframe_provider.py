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

import csv
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, TypeVar, runtime_checkable

try:
    import pandas as pd
except ImportError:  # pragma: no cover - exercised in dedicated optional-dependency tests
    pd = None

# Conditional import for type checking
if TYPE_CHECKING:
    import pandas as pd
    import polars as pl


LOGGER = logging.getLogger(__name__)


def _require_pandas() -> Any:
    if pd is None:
        raise ImportError("Pandas is required for this operation")
    return pd


def _should_use_polars() -> bool:
    return os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true"


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
        pandas = _require_pandas()
        return pandas.read_csv(
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
        pandas = _require_pandas()
        return pandas.concat(dfs, ignore_index=ignore_index)

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
        # Polars handles whitespace differently, so normalize headers and string values when
        # the caller requests pandas-like leading-space stripping.
        schema_overrides = None
        if dtypes:
            schema_overrides = self._build_schema_overrides(
                path,
                dtypes,
                skipinitialspace=skipinitialspace,
            )

        df = self._pl.read_csv(
            path,
            schema_overrides=schema_overrides,
            try_parse_dates=False,  # We handle date parsing separately
        )

        if skipinitialspace:
            renamed_columns = {
                column: column.strip()
                for column in df.columns
                if column != column.strip()
            }
            if renamed_columns:
                df = df.rename(renamed_columns)

            string_cols = [
                column
                for column, dtype in df.schema.items()
                if dtype == self._pl.Utf8
            ]
            if string_cols:
                df = df.with_columns(
                    [
                        self._pl.col(column).cast(self._pl.Utf8).str.strip_chars()
                        for column in string_cols
                    ]
                )

        return df

    def _build_schema_overrides(
        self,
        path: str | Path,
        dtypes: dict[str, Any],
        *,
        skipinitialspace: bool,
    ) -> dict[str, Any]:
        schema_overrides = self._convert_pandas_dtypes(dtypes)
        if not skipinitialspace or not schema_overrides:
            return schema_overrides

        header_map = self._read_csv_header_map(path)
        if not header_map:
            return schema_overrides

        remapped_overrides: dict[str, Any] = {}
        for column, dtype in schema_overrides.items():
            remapped_overrides[header_map.get(column, column)] = dtype
        return remapped_overrides

    def _read_csv_header_map(self, path: str | Path) -> dict[str, str]:
        try:
            with Path(path).open(newline="", encoding="utf-8") as file_handle:
                reader = csv.reader(file_handle)
                header_row = next(reader, [])
        except (FileNotFoundError, StopIteration, UnicodeDecodeError):
            return {}

        return {header.strip(): header for header in header_row if header.strip()}

    def _convert_pandas_dtypes(self, dtypes: dict[str, Any]) -> dict[str, Any]:
        """Convert pandas dtype specifications to Polars dtypes."""
        pl = self._pl
        dtype_map = {
            "str": pl.Utf8,
            "string": pl.Utf8,
            "object": pl.Utf8,
            "utf8": pl.Utf8,
            "int": pl.Int64,
            "int64": pl.Int64,
            "int32": pl.Int32,
            "int16": pl.Int16,
            "int8": pl.Int8,
            "uint": pl.UInt64,
            "uint64": pl.UInt64,
            "uint32": pl.UInt32,
            "float": pl.Float64,
            "float64": pl.Float64,
            "float32": pl.Float32,
            "bool": pl.Boolean,
            "boolean": pl.Boolean,
            "date": pl.Date,
            "datetime": pl.Datetime,
            "datetime64[ns]": pl.Datetime,
            "time": pl.Time,
            "category": pl.Categorical,
        }
        result = {}
        for col, dtype in dtypes.items():
            dtype_str = self._normalize_dtype_name(dtype)
            if dtype_str in dtype_map:
                result[col] = dtype_map[dtype_str]
        return result

    def _normalize_dtype_name(self, dtype: Any) -> str:
        dtype_str = str(dtype).lower().strip()
        if dtype_str.startswith("numpy."):
            dtype_str = dtype_str.removeprefix("numpy.")
        if dtype_str.startswith("pandas."):
            dtype_str = dtype_str.removeprefix("pandas.")
        if dtype_str.startswith("string["):
            return "string"
        if dtype_str.startswith("datetime64"):
            return "datetime"
        if dtype_str.startswith("timedelta"):
            return "time"
        return dtype_str

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
        _require_pandas()
        return df.to_pandas()

    def from_pandas(self, df: pd.DataFrame) -> "pl.DataFrame":
        """Convert a Pandas DataFrame to Polars."""
        pl = self._pl
        _require_pandas()
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
    if _should_use_polars():
        try:
            return get_polars_provider()
        except ImportError:
            LOGGER.warning("Polars not available, falling back to Pandas")
            return get_pandas_provider()
    return get_pandas_provider()


# Type alias for DataFrame-like objects (works with both Pandas and Polars)
if TYPE_CHECKING:
    import polars as pl

    DataFrameLike = TypeVar("DataFrameLike", pd.DataFrame, pl.DataFrame)
else:
    DataFrameLike = Any
