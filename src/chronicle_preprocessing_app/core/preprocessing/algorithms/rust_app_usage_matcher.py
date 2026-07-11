"""Optional Rust app-usage matcher adapter for Polars dataframes."""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np
import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)

RUST_MATCHER_ENV = "CHRONICLE_USE_RUST_APP_MATCHER"
RUST_MATCHER_STRICT_ENV = "CHRONICLE_RUST_APP_MATCHER_STRICT"
MISSING_TIMESTAMP_NS = np.iinfo(np.int64).min


def rust_matcher_enabled() -> bool:
    return os.getenv(RUST_MATCHER_ENV, "true").lower() not in {"0", "false", "no"}


def rust_matcher_strict() -> bool:
    return os.getenv(RUST_MATCHER_STRICT_ENV, "false").lower() in {"1", "true", "yes"}


def _stable_factorize(values: Any) -> np.ndarray:
    codes = np.empty(len(values), dtype=np.int32)
    lookup: dict[Any, int] = {}
    next_code = 0
    for index, value in enumerate(values):
        if value not in lookup:
            lookup[value] = next_code
            next_code += 1
        codes[index] = lookup[value]
    return codes


def process_app_usage_with_rust(
    *,
    df: pl.DataFrame,
    app_packages: Any,
    event_timestamps: Any,
    timestamp_nanoseconds: Any,
    resumed_flags: Any,
    same_app_stop_flags: Any,
    other_stop_flags: Any,
    stopped_flags: Any,
    options: PreprocessingOptions,
) -> pl.DataFrame | None:
    if not rust_matcher_enabled() or timestamp_nanoseconds is None:
        return None

    try:
        from chronicle_preprocessing_app import _rust_app_usage_matcher
    except ImportError:
        if rust_matcher_strict():
            raise
        return None

    try:
        app_code_array = np.ascontiguousarray(_stable_factorize(app_packages), dtype=np.int32)
        timestamp_array = np.ascontiguousarray(timestamp_nanoseconds, dtype=np.int64)
        resumed_array = np.ascontiguousarray(resumed_flags, dtype=bool)
        same_stop_array = np.ascontiguousarray(same_app_stop_flags, dtype=bool)
        other_stop_array = np.ascontiguousarray(other_stop_flags, dtype=bool)
        stopped_array = np.ascontiguousarray(stopped_flags, dtype=bool)
        long_duration_threshold_ns = int(
            options.long_duration_threshold_hours * 3600 * 1_000_000_000
        )

        update_indices_fn = getattr(
            _rust_app_usage_matcher,
            "match_app_usage_update_arrays",
            None,
        ) or getattr(_rust_app_usage_matcher, "match_app_usage_update_indices", None)
        if update_indices_fn is None:
            return None

        start_indices, stop_start_indices, stop_event_indices, missing_indices = update_indices_fn(
            app_code_array,
            timestamp_array,
            resumed_array,
            same_stop_array,
            other_stop_array,
            stopped_array,
            options.allow_stop_event_reuse,
            options.use_activity_stopped_as_fallback,
            options.apply_threshold_to_activity_stopped_fallback,
            long_duration_threshold_ns,
        )
    except Exception:
        if rust_matcher_strict():
            raise
        LOGGER.exception("Rust app usage matcher failed; falling back to Python matcher")
        return None

    _event_ts_dtype = df.schema[Column.EVENT_TIMESTAMP]
    return _apply_rust_update_indices(
        df=df,
        event_timestamps=np.asarray(event_timestamps),
        start_indices=start_indices,
        stop_start_indices=stop_start_indices,
        stop_event_indices=stop_event_indices,
        missing_indices=missing_indices,
        timestamp_tz=_event_ts_dtype.time_zone
        if isinstance(_event_ts_dtype, pl.Datetime)
        else None,
    )


def _as_index_array(indices: Any) -> np.ndarray:
    if isinstance(indices, np.ndarray) and indices.dtype == np.intp and indices.flags.c_contiguous:
        return indices
    return np.asarray(indices, dtype=np.intp)


def _timestamp_series(timestamp_ns: np.ndarray, timezone_name: str | None) -> pl.Series:
    values: list[object] = []
    for value in timestamp_ns:
        if int(value) == MISSING_TIMESTAMP_NS:
            values.append(None)
        else:
            values.append(int(value))
    if timezone_name:
        return (
            pl.Series(values, dtype=pl.Int64)
            .cast(pl.Datetime("ns", "UTC"))
            .dt.convert_time_zone(timezone_name)
        )
    return pl.Series(values, dtype=pl.Int64).cast(pl.Datetime("ns"))


def _apply_rust_update_indices(
    *,
    df: pl.DataFrame,
    event_timestamps: np.ndarray,
    start_indices: Any,
    stop_start_indices: Any,
    stop_event_indices: Any,
    missing_indices: Any,
    timestamp_tz: str | None,
) -> pl.DataFrame:
    row_count = df.height
    start_values = np.full(row_count, MISSING_TIMESTAMP_NS, dtype=np.int64)
    stop_values = np.full(row_count, MISSING_TIMESTAMP_NS, dtype=np.int64)
    interaction_values = df.get_column(Column.INTERACTION_TYPE).to_numpy()

    start_index_array = _as_index_array(start_indices)
    stop_start_index_array = _as_index_array(stop_start_indices)
    stop_event_index_array = _as_index_array(stop_event_indices)
    missing_index_array = _as_index_array(missing_indices)

    if start_index_array.size:
        start_values[start_index_array] = event_timestamps[start_index_array]
    if stop_start_index_array.size:
        stop_values[stop_start_index_array] = event_timestamps[stop_event_index_array]
    if missing_index_array.size:
        interaction_values[missing_index_array] = str(InteractionType.END_OF_USAGE_MISSING)

    return df.with_columns(
        [
            _timestamp_series(start_values, timestamp_tz).alias(Column.START_TIMESTAMP),
            _timestamp_series(stop_values, timestamp_tz).alias(Column.STOP_TIMESTAMP),
            pl.Series(Column.INTERACTION_TYPE, interaction_values),
        ]
    )
