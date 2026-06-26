"""Polars-backed timestamp preprocessing."""

from __future__ import annotations

import logging

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, TimestampFormat
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

LOGGER = logging.getLogger(__name__)


class TimestampPreprocessor(BasePreprocessor):
    """Handle timestamp parsing, duplicate ordering, and CSV formatting."""

    def __init__(self, options: PreprocessingOptions) -> None:
        super().__init__(options)
        self._helper = PolarsFastPathPreprocessor(options)

    def preprocess(self, df: pl.DataFrame) -> pl.DataFrame:
        return self.correct_timestamps(df)

    @staticmethod
    def fix_timestamp_format(timestamp: str) -> str | None:
        if timestamp is None:
            return None
        value = str(timestamp)
        if not value:
            return None
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        if "." not in value and len(value) >= 6 and value[-6] in {"+", "-"}:
            value = f"{value[:-6]}.000{value[-6:]}"
        elif "." not in value:
            value = f"{value}.000"
        return value

    def correct_timestamps(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> pl.DataFrame:
        df = self.correct_timestamp_column(df, timestamp_column)
        if self.options.correct_duplicate_event_timestamps:
            df = self.unalign_duplicate_timestamps(df, timestamp_column)
        return self.mark_data_time_gaps(df, timestamp_column, Column.DATA_TIME_GAP_HOURS)

    def correct_timestamp_column(
        self,
        df: pl.DataFrame,
        column_name: str = Column.EVENT_TIMESTAMP,
    ) -> pl.DataFrame:
        original_col = f"{column_name}_original"
        timestamp_text = pl.col(column_name).cast(pl.Utf8)
        df = df.with_columns(pl.col(column_name).alias(original_col))
        has_explicit_timezone = df.select(
            timestamp_text
            .str.contains(r"(Z|[+-]\d{2}:\d{2})$")
            .fill_null(False)
            .any()
        ).item()
        # Fractional-second (%.f) variants come FIRST: Chronicle timestamps carry
        # millisecond precision, and silently nulling them (strict=False with a
        # whole-second-only format) destroys sub-second event ordering. Whole-second
        # strings fail the %.f formats and fall through unchanged.
        timestamp_expr = (
            pl.coalesce(
                [
                    timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S%.f%#z",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S%.f%#z",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S%#z",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S%#z",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S",
                        time_zone="UTC",
                        strict=False,
                    ),
                ]
            )
            if has_explicit_timezone
            else pl.coalesce(
                [
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S%.f",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S%.f",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%d %H:%M:%S",
                        time_zone="UTC",
                        strict=False,
                    ),
                    timestamp_text.str.to_datetime(
                        format="%Y-%m-%dT%H:%M:%S",
                        time_zone="UTC",
                        strict=False,
                    ),
                ]
            )
        )
        df = df.with_columns(
            timestamp_expr.alias(column_name)
        )
        invalid_column_name = f"{column_name}_invalid_original"
        invalid_mask = pl.col(column_name).is_null() & pl.col(original_col).is_not_null()
        if df.select(invalid_mask.any()).item():
            df = df.with_columns(
                pl.when(invalid_mask)
                .then(pl.col(original_col))
                .otherwise(pl.lit(None))
                .alias(invalid_column_name)
            )
        return df.drop(original_col)

    def unalign_duplicate_timestamps(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> pl.DataFrame:
        return self._helper._unalign_duplicate_timestamps(df, timestamp_column)

    @staticmethod
    def check_for_disordered_timestamps(
        df: pl.DataFrame,
        start_column: str = Column.START_TIMESTAMP,
        stop_column: str = Column.STOP_TIMESTAMP,
    ) -> None:
        if start_column not in df.columns or stop_column not in df.columns:
            return
        disordered = df.filter(
            pl.col(start_column).is_not_null()
            & pl.col(stop_column).is_not_null()
            & (pl.col(start_column) > pl.col(stop_column))
        )
        if not disordered.is_empty():
            raise ValueError("Disordered timestamps detected")

    def format_timestamps_as_strings(
        self,
        df: pl.DataFrame,
        columns: list[str],
        format_string: str = TimestampFormat.DATETIME.value,
    ) -> pl.DataFrame:
        expressions = []
        for column in columns:
            if column in df.columns:
                expressions.append(pl.col(column).dt.strftime(format_string).alias(column))
        return df.with_columns(expressions) if expressions else df

    def mark_data_time_gaps(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
        gap_column: str = Column.DATA_TIME_GAP_HOURS,
    ) -> pl.DataFrame:
        return self._helper._mark_data_time_gaps(df, timestamp_column, gap_column)
