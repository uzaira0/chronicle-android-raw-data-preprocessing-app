"""Polars-backed timezone preprocessing."""

from __future__ import annotations

import datetime
import logging
from datetime import datetime as datetime_class
from pathlib import Path

import polars as pl

from chronicle_preprocessing_app.config.constants import Column
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor
from chronicle_preprocessing_app.utils.file_utils import get_matching_files_from_folder

LOGGER = logging.getLogger(__name__)


def _normalize_timezone_value(value: object) -> str | None:
    if value is None:
        return None
    timezone = str(value).strip()
    if not timezone or timezone == "None":
        return None
    return timezone


def _normalize_timezone_expr(col_expr: pl.Expr) -> pl.Expr:
    return col_expr.cast(pl.String).str.strip_chars().replace("", None).replace("None", None)


class TimezonePreprocessor(BasePreprocessor):
    """Apply timezone handling and timestamp-column conversions."""

    def __init__(self, options: PreprocessingOptions) -> None:
        super().__init__(options)
        from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
            PolarsFastPathPreprocessor,
        )

        self.local_timezone = self.get_local_timezone()
        self.current_data_primary_timezone: str | None = None
        self._helper = PolarsFastPathPreprocessor(options)

    def preprocess(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> pl.DataFrame:
        return self.apply_timezone_handling(df, timestamp_column)

    @staticmethod
    def get_local_timezone() -> str:
        local_now = datetime_class.now(datetime.timezone.utc).astimezone()
        offset = local_now.strftime("%z")
        return f"UTC{offset[:3]}:{offset[3:]}"

    @staticmethod
    def find_all_timezones_in_folder_files(folder: str | Path, file_pattern: str) -> list[str]:
        timezones: set[str] = set()
        for file_path in get_matching_files_from_folder(
            folder,
            file_pattern,
            ignore_names=["Survey", "Archive", "Do Not Use"],
        ):
            try:
                df = pl.read_csv(file_path, columns=[Column.TIMEZONE])
            except Exception:
                continue
            if Column.TIMEZONE not in df.columns:
                continue
            timezones.update(
                timezone
                for value in df.get_column(Column.TIMEZONE).drop_nulls().cast(pl.String).unique().to_list()
                if (timezone := _normalize_timezone_value(value)) is not None
            )
        return sorted(timezones)

    def detect_timezones_in_dataframe(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> list[str]:
        timezones: set[str] = set()
        if Column.TIMEZONE in df.columns:
            timezones.update(
                timezone
                for value in df.get_column(Column.TIMEZONE).drop_nulls().cast(pl.String).unique().to_list()
                if (timezone := _normalize_timezone_value(value)) is not None
            )
        if timestamp_column in df.columns:
            tz_name = df.schema[timestamp_column].time_zone
            if tz_name:
                timezones.add(tz_name)
        return sorted(timezones)

    def determine_primary_timezone(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> str | None:
        if Column.TIMEZONE in df.columns:
            normalized_timezone_column = "__chronicle_timezone_normalized"
            timezone_values = (
                df.with_columns(_normalize_timezone_expr(pl.col(Column.TIMEZONE)).alias(normalized_timezone_column))
                .filter(pl.col(normalized_timezone_column).is_not_null())
                .group_by(normalized_timezone_column)
                .len()
                .sort("len", descending=True)
            )
            if not timezone_values.is_empty():
                self.current_data_primary_timezone = str(timezone_values[0, normalized_timezone_column])
                return self.current_data_primary_timezone

        tz_name = df.schema.get(timestamp_column)
        if isinstance(tz_name, pl.Datetime) and tz_name.time_zone:
            self.current_data_primary_timezone = tz_name.time_zone
            return self.current_data_primary_timezone
        return None

    def apply_timezone_handling(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> pl.DataFrame:
        return self._helper._apply_timezone_handling(df, timestamp_column)

    def convert_timestamp_column(
        self,
        df: pl.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
    ) -> pl.DataFrame:
        return self.apply_timezone_handling(df, timestamp_column)

    def convert_timestamp_columns(
        self,
        df: pl.DataFrame,
        columns: list[str] | None = None,
    ) -> pl.DataFrame:
        target_columns = columns or [Column.EVENT_TIMESTAMP, Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
        result = df
        target_timezone = str(self.options.selected_timezone or self.current_data_primary_timezone or "UTC")
        for column in target_columns:
            if column not in result.columns:
                continue
            source_dtype = result.schema[column]
            if not isinstance(source_dtype, pl.Datetime):
                continue
            target_dtype = pl.Datetime(source_dtype.time_unit, target_timezone)
            result = result.with_columns(
                pl.when(pl.col(column).is_not_null())
                .then(pl.col(column).dt.convert_time_zone(target_timezone))
                .otherwise(pl.lit(None, dtype=target_dtype))
                .alias(column)
            )
        if Column.TIMEZONE in result.columns:
            result = result.with_columns(pl.lit(target_timezone).alias(Column.TIMEZONE))
        return result
