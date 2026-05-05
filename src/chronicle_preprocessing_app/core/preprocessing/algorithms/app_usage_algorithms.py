"""Polars-backed app usage pairing algorithms."""

from __future__ import annotations

import logging

import numpy as np
import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.rust_app_usage_matcher import (
    MISSING_TIMESTAMP_NS,
    process_app_usage_with_rust,
)

LOGGER = logging.getLogger(__name__)


def safe_timestamp_compare(ts1: object, ts2: object, op: str) -> bool:
    left = None if ts1 is None else int(pl.Series([ts1]).dt.epoch("ns").item())
    right = None if ts2 is None else int(pl.Series([ts2]).dt.epoch("ns").item())
    if left is None or right is None:
        return False
    return {
        "<": left < right,
        ">": left > right,
        "<=": left <= right,
        ">=": left >= right,
        "==": left == right,
        "!=": left != right,
    }[op]


def safe_duration_seconds(stop_time: object, start_time: object) -> float:
    stop_ns = int(pl.Series([stop_time]).dt.epoch("ns").item())
    start_ns = int(pl.Series([start_time]).dt.epoch("ns").item())
    return (stop_ns - start_ns) / 1_000_000_000.0


class OptimizedAppUsageAlgorithm:
    """Single supported app-usage pairing algorithm."""

    def __init__(self, options: PreprocessingOptions):
        self.options = options
        self.long_duration_threshold_nanoseconds = int(options.long_duration_threshold_hours * 3600 * 1_000_000_000)

    def process_app_usage(
        self,
        df: pl.DataFrame,
        resumed_mask: pl.Series,
        same_app_stop_mask: pl.Series,
        other_stop_mask: pl.Series,
        stopped_mask: pl.Series,
    ) -> pl.DataFrame:
        df_copy = df.clone()
        timestamp_ns = df_copy.get_column(Column.EVENT_TIMESTAMP).dt.epoch("ns").to_numpy()
        app_packages = df_copy.get_column(Column.APP_PACKAGE_NAME).fill_null("").to_numpy()
        resumed_flags = resumed_mask.to_numpy().astype(bool, copy=False)
        same_stop_flags = same_app_stop_mask.to_numpy().astype(bool, copy=False)
        other_stop_flags = other_stop_mask.to_numpy().astype(bool, copy=False)
        stopped_flags = stopped_mask.to_numpy().astype(bool, copy=False)

        rust_result = process_app_usage_with_rust(
            df=df_copy,
            app_packages=app_packages,
            event_timestamps=timestamp_ns,
            timestamp_nanoseconds=timestamp_ns,
            resumed_flags=resumed_flags,
            same_app_stop_flags=same_stop_flags,
            other_stop_flags=other_stop_flags,
            stopped_flags=stopped_flags,
            options=self.options,
        )
        if rust_result is not None:
            return rust_result

        return self._apply_python_matcher(
            df_copy,
            app_packages=app_packages,
            timestamp_ns=timestamp_ns,
            resumed_flags=resumed_flags,
            same_stop_flags=same_stop_flags,
            other_stop_flags=other_stop_flags,
            stopped_flags=stopped_flags,
        )

    def _apply_python_matcher(
        self,
        df: pl.DataFrame,
        *,
        app_packages: np.ndarray,
        timestamp_ns: np.ndarray,
        resumed_flags: np.ndarray,
        same_stop_flags: np.ndarray,
        other_stop_flags: np.ndarray,
        stopped_flags: np.ndarray,
    ) -> pl.DataFrame:
        start_indices, stop_start_indices, stop_event_indices, missing_indices = self._match_usage_updates_python(
            app_packages=app_packages,
            timestamp_ns=timestamp_ns,
            resumed_flags=resumed_flags,
            same_stop_flags=same_stop_flags,
            other_stop_flags=other_stop_flags,
            stopped_flags=stopped_flags,
        )

        row_count = df.height
        start_ns = np.full(row_count, MISSING_TIMESTAMP_NS, dtype=np.int64)
        stop_ns = np.full(row_count, MISSING_TIMESTAMP_NS, dtype=np.int64)
        interaction_values = df.get_column(Column.INTERACTION_TYPE).to_numpy()

        if start_indices.size:
            start_ns[start_indices] = timestamp_ns[start_indices]
        if stop_start_indices.size:
            stop_ns[stop_start_indices] = timestamp_ns[stop_event_indices]
        if missing_indices.size:
            interaction_values[missing_indices] = str(InteractionType.END_OF_USAGE_MISSING)

        event_dtype = df.schema[Column.EVENT_TIMESTAMP]
        timezone_name = event_dtype.time_zone if isinstance(event_dtype, pl.Datetime) else None
        return df.with_columns(
            [
                _ns_to_datetime_series(Column.START_TIMESTAMP, start_ns, timezone_name),
                _ns_to_datetime_series(Column.STOP_TIMESTAMP, stop_ns, timezone_name),
                pl.Series(Column.INTERACTION_TYPE, interaction_values),
            ]
        )

    def _match_usage_updates_python(
        self,
        *,
        app_packages: np.ndarray,
        timestamp_ns: np.ndarray,
        resumed_flags: np.ndarray,
        same_stop_flags: np.ndarray,
        other_stop_flags: np.ndarray,
        stopped_flags: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        open_start_indices: list[int] = []
        start_indices: list[int] = []
        stop_start_indices: list[int] = []
        stop_event_indices: list[int] = []
        missing_indices: list[int] = []

        def is_valid_duration(start_index: int, stop_index: int, *, enforce_threshold: bool) -> bool:
            duration_ns = int(timestamp_ns[stop_index]) - int(timestamp_ns[start_index])
            if duration_ns < 0:
                return False
            return not enforce_threshold or duration_ns <= self.long_duration_threshold_nanoseconds

        for index in range(len(app_packages)):
            current_app = app_packages[index]
            is_normal_stop = bool(same_stop_flags[index] or other_stop_flags[index])
            is_fallback_stop = bool(stopped_flags[index] and self.options.use_activity_stopped_as_fallback)

            if self.options.allow_stop_event_reuse and (is_normal_stop or is_fallback_stop):
                still_open: list[int] = []
                for start_index in open_start_indices:
                    start_app = app_packages[start_index]
                    same_app_compatible = bool(same_stop_flags[index] and start_app == current_app)
                    other_app_compatible = bool(other_stop_flags[index] and start_app != current_app)
                    fallback_compatible = bool(not is_normal_stop and is_fallback_stop and start_app == current_app)
                    if not (same_app_compatible or other_app_compatible or fallback_compatible):
                        still_open.append(start_index)
                        continue
                    enforce_threshold = not fallback_compatible or self.options.apply_threshold_to_activity_stopped_fallback
                    if is_valid_duration(start_index, index, enforce_threshold=enforce_threshold):
                        stop_start_indices.append(start_index)
                        stop_event_indices.append(index)
                    else:
                        still_open.append(start_index)
                open_start_indices = still_open
            elif is_normal_stop or is_fallback_stop:
                matched_position: int | None = None
                for position in range(len(open_start_indices) - 1, -1, -1):
                    start_index = open_start_indices[position]
                    start_app = app_packages[start_index]
                    same_app_compatible = bool(same_stop_flags[index] and start_app == current_app)
                    other_app_compatible = bool(other_stop_flags[index] and start_app != current_app)
                    fallback_compatible = bool(not is_normal_stop and is_fallback_stop and start_app == current_app)
                    if not (same_app_compatible or other_app_compatible or fallback_compatible):
                        continue
                    enforce_threshold = not fallback_compatible or self.options.apply_threshold_to_activity_stopped_fallback
                    if is_valid_duration(start_index, index, enforce_threshold=enforce_threshold):
                        matched_position = position
                        break
                if matched_position is not None:
                    start_index = open_start_indices.pop(matched_position)
                    stop_start_indices.append(start_index)
                    stop_event_indices.append(index)

            if resumed_flags[index]:
                start_indices.append(index)
                open_start_indices.append(index)

        if open_start_indices:
            last_index = len(app_packages) - 1
            for start_index in open_start_indices:
                if last_index > start_index and is_valid_duration(
                    start_index,
                    last_index,
                    enforce_threshold=True,
                ):
                    stop_start_indices.append(start_index)
                    stop_event_indices.append(last_index)
                else:
                    missing_indices.append(start_index)

        return (
            np.asarray(start_indices, dtype=np.intp),
            np.asarray(stop_start_indices, dtype=np.intp),
            np.asarray(stop_event_indices, dtype=np.intp),
            np.asarray(missing_indices, dtype=np.intp),
        )


def _ns_to_datetime_series(name: str, values: np.ndarray, timezone_name: str | None) -> pl.Series:
    converted: list[object] = [None if int(value) == MISSING_TIMESTAMP_NS else int(value) for value in values]
    if timezone_name:
        return pl.Series(name, converted, dtype=pl.Int64).cast(pl.Datetime("ns", "UTC")).dt.convert_time_zone(timezone_name)
    return pl.Series(name, converted, dtype=pl.Int64).cast(pl.Datetime("ns"))
