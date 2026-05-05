"""Polars-backed DataFrame provider utilities."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Protocol, TypeAlias, runtime_checkable

import polars as pl

DataFrameLike: TypeAlias = pl.DataFrame


def _strip_string_columns(df: pl.DataFrame) -> pl.DataFrame:
    string_columns = [name for name, dtype in df.schema.items() if dtype == pl.String]
    if not string_columns:
        return df
    return df.with_columns([pl.col(name).str.strip_chars().alias(name) for name in string_columns])


def _normalize_schema(dtypes: dict[str, Any] | None) -> dict[str, pl.DataType] | None:
    if dtypes is None:
        return None

    normalized: dict[str, pl.DataType] = {}
    for name, dtype in dtypes.items():
        if isinstance(dtype, pl.DataType):
            normalized[name] = dtype
            continue

        dtype_name = str(dtype).lower()
        mapping = {
            "str": pl.String,
            "string": pl.String,
            "utf8": pl.String,
            "int": pl.Int64,
            "int64": pl.Int64,
            "integer": pl.Int64,
            "float": pl.Float64,
            "float64": pl.Float64,
            "double": pl.Float64,
            "bool": pl.Boolean,
            "boolean": pl.Boolean,
        }
        if dtype_name not in mapping:
            msg = f"Unsupported schema override for column {name!r}: {dtype!r}"
            raise ValueError(msg)
        normalized[name] = mapping[dtype_name]

    return normalized


@runtime_checkable
class DataFrameProviderProtocol(Protocol):
    """Protocol defining the minimal frame operations used by the codebase."""

    def read_csv(
        self,
        path: str | Path,
        *,
        skipinitialspace: bool = True,
        dtypes: dict[str, Any] | None = None,
    ) -> pl.DataFrame: ...

    def to_csv(
        self,
        df: pl.DataFrame,
        path: str | Path,
        *,
        index: bool = False,
    ) -> None: ...

    def is_empty(self, df: pl.DataFrame) -> bool: ...

    def get_column(self, df: pl.DataFrame, column: str) -> pl.Series: ...

    def set_column(self, df: pl.DataFrame, column: str, values: Any) -> pl.DataFrame: ...

    def filter(self, df: pl.DataFrame, mask: pl.Series) -> pl.DataFrame: ...

    def sort_by(self, df: pl.DataFrame, column: str, *, descending: bool = False) -> pl.DataFrame: ...

    def reset_index(self, df: pl.DataFrame) -> pl.DataFrame: ...

    def concat(self, dfs: list[pl.DataFrame], *, ignore_index: bool = True) -> pl.DataFrame: ...

    @property
    def name(self) -> str: ...


class PolarsProvider:
    """Polars implementation of the DataFrame provider."""

    @property
    def name(self) -> str:
        return "polars"

    def read_csv(
        self,
        path: str | Path,
        *,
        skipinitialspace: bool = True,
        dtypes: dict[str, Any] | None = None,
    ) -> pl.DataFrame:
        schema_overrides = _normalize_schema(dtypes)
        df = pl.read_csv(path, infer_schema_length=10000)
        stripped_names = [name.strip() for name in df.columns]
        if stripped_names != df.columns:
            df.columns = stripped_names
        if skipinitialspace:
            df = _strip_string_columns(df)
        if schema_overrides:
            cast_exprs = [pl.col(name).cast(dtype).alias(name) for name, dtype in schema_overrides.items() if name in df.columns]
            if cast_exprs:
                df = df.with_columns(cast_exprs)
        return df

    def to_csv(
        self,
        df: pl.DataFrame,
        path: str | Path,
        *,
        index: bool = False,
    ) -> None:
        if index:
            row_index = pl.Series("index", range(df.height))
            df = pl.DataFrame([row_index, *[df.get_column(name) for name in df.columns]])
        df.write_csv(path)

    def is_empty(self, df: pl.DataFrame) -> bool:
        return df.is_empty()

    def get_column(self, df: pl.DataFrame, column: str) -> pl.Series:
        return df.get_column(column)

    def set_column(self, df: pl.DataFrame, column: str, values: Any) -> pl.DataFrame:
        return df.with_columns(pl.Series(column, values) if not isinstance(values, pl.Series) else values.alias(column))

    def filter(self, df: pl.DataFrame, mask: pl.Series) -> pl.DataFrame:
        return df.filter(mask)

    def sort_by(self, df: pl.DataFrame, column: str, *, descending: bool = False) -> pl.DataFrame:
        return df.sort(column, descending=descending)

    def reset_index(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.clone()

    def concat(self, dfs: list[pl.DataFrame], *, ignore_index: bool = True) -> pl.DataFrame:
        if not dfs:
            return pl.DataFrame()
        how = "vertical" if ignore_index else "diagonal"
        return pl.concat(dfs, how=how)


_PROVIDER = PolarsProvider()


def get_dataframe_provider() -> PolarsProvider:
    """Return the only supported DataFrame provider."""
    return _PROVIDER


def read_csv_rows(path: str | Path) -> list[dict[str, str]]:
    """Read a small CSV as dictionaries using the standard library."""
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))
