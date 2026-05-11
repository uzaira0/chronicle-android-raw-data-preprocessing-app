from __future__ import annotations

import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import polars as pl

from chronicle_preprocessing_app.core.config import PreprocessingOptions


def ts(value: str, tz: str | None = None) -> datetime:
    parsed = datetime.fromisoformat(value)
    if tz is None:
        return parsed
    return parsed.replace(tzinfo=ZoneInfo(tz))


def td(*, days: int = 0, hours: int = 0, minutes: int = 0, seconds: int = 0) -> timedelta:
    return timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)


def frame(rows: list[dict[str, object]]) -> pl.DataFrame:
    schema_overrides: dict[str, pl.DataType] = {}
    if rows:
        for column in rows[0]:
            first_non_null = next((row.get(column) for row in rows if row.get(column) is not None), None)
            if isinstance(first_non_null, datetime):
                if first_non_null.tzinfo is not None:
                    timezone_name = getattr(first_non_null.tzinfo, "key", str(first_non_null.tzinfo))
                    schema_overrides[column] = pl.Datetime("us", timezone_name)
                else:
                    schema_overrides[column] = pl.Datetime("us")
    return pl.DataFrame(rows, schema_overrides=schema_overrides)


def cell(df: pl.DataFrame, row_index: int, column: str) -> object:
    return df[row_index, column]


def first_row(df: pl.DataFrame) -> dict[str, object]:
    return df.row(0, named=True)


def options(**overrides: object) -> PreprocessingOptions:
    values: dict[str, object] = {"raw_data_folder": "", "use_app_codebook": False}
    values.update(overrides)
    return PreprocessingOptions(**values)


def rows_where(df: pl.DataFrame, column: str, value: object) -> pl.DataFrame:
    return df.filter(pl.col(column) == value)


def is_null(value: object) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def csv_as_strings(path: str) -> pl.DataFrame:
    df = pl.read_csv(path, infer_schema=False)
    return df.sort(df.columns)
