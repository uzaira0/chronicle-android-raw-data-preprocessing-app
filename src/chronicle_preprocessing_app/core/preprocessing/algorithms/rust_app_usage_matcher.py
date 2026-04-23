"""Optional Rust app-usage matcher adapter."""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np
import pandas as pd

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)

RUST_MATCHER_ENV = "CHRONICLE_USE_RUST_APP_MATCHER"
RUST_MATCHER_STRICT_ENV = "CHRONICLE_RUST_APP_MATCHER_STRICT"
MISSING_TIMESTAMP_NS = -1


def rust_matcher_enabled() -> bool:
    """Return whether the optional Rust matcher should be attempted."""
    return os.getenv(RUST_MATCHER_ENV, "true").lower() not in {"0", "false", "no"}


def rust_matcher_strict() -> bool:
    """Return whether Rust matcher import/execution errors should be raised."""
    return os.getenv(RUST_MATCHER_STRICT_ENV, "false").lower() in {"1", "true", "yes"}


def process_app_usage_with_rust(
    *,
    df: pd.DataFrame,
    app_packages: Any,
    event_timestamps: Any,
    timestamp_nanoseconds: Any,
    resumed_flags: Any,
    same_app_stop_flags: Any,
    other_stop_flags: Any,
    stopped_flags: Any,
    options: PreprocessingOptions,
) -> pd.DataFrame | None:
    """Run the Rust matcher if the extension is available and inputs are supported."""
    if not rust_matcher_enabled() or timestamp_nanoseconds is None:
        return None

    try:
        from chronicle_preprocessing_app import _rust_app_usage_matcher
    except ImportError:
        if rust_matcher_strict():
            raise
        return None

    try:
        app_codes, _ = pd.factorize(app_packages, sort=False)
        app_code_array = np.ascontiguousarray(app_codes, dtype=np.int32)
        timestamp_array = np.ascontiguousarray(timestamp_nanoseconds, dtype=np.int64)
        resumed_array = np.ascontiguousarray(resumed_flags, dtype=bool)
        same_stop_array = np.ascontiguousarray(same_app_stop_flags, dtype=bool)
        other_stop_array = np.ascontiguousarray(other_stop_flags, dtype=bool)
        stopped_array = np.ascontiguousarray(stopped_flags, dtype=bool)
        long_duration_threshold_ns = int(
            options.long_duration_threshold_hours * 3600 * 1_000_000_000
        )

        if hasattr(_rust_app_usage_matcher, "match_app_usage_update_indices"):
            start_indices, stop_start_indices, stop_event_indices, missing_indices = (
                _rust_app_usage_matcher.match_app_usage_update_indices(
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
            )
            return _apply_rust_update_indices(
                df=df,
                event_timestamps=event_timestamps,
                start_indices=start_indices,
                stop_start_indices=stop_start_indices,
                stop_event_indices=stop_event_indices,
                missing_indices=missing_indices,
            )

        if hasattr(_rust_app_usage_matcher, "match_app_usage_arrays"):
            start_ns, stop_ns, missing = _rust_app_usage_matcher.match_app_usage_arrays(
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
        else:
            start_ns, stop_ns, missing = _rust_app_usage_matcher.match_app_usage(
                app_codes.astype("int32", copy=False).tolist(),
                np.asarray(timestamp_nanoseconds, dtype=np.int64).tolist(),
                np.asarray(resumed_flags, dtype=bool).tolist(),
                np.asarray(same_app_stop_flags, dtype=bool).tolist(),
                np.asarray(other_stop_flags, dtype=bool).tolist(),
                np.asarray(stopped_flags, dtype=bool).tolist(),
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

    return _apply_rust_matcher_output(
        df=df,
        event_timestamps=event_timestamps,
        timestamp_nanoseconds=timestamp_nanoseconds,
        start_ns=start_ns,
        stop_ns=stop_ns,
        missing=missing,
    )


def _apply_rust_update_indices(
    *,
    df: pd.DataFrame,
    event_timestamps: Any,
    start_indices: list[int],
    stop_start_indices: list[int],
    stop_event_indices: list[int],
    missing_indices: list[int],
) -> pd.DataFrame:
    """Apply sparse Rust update indices with vectorized timestamp assignment."""
    df_copy = df.copy()
    event_timestamps = np.asarray(event_timestamps, dtype=object)

    if start_indices:
        start_index_array = np.asarray(start_indices, dtype=np.intp)
        start_timestamps = df_copy[Column.START_TIMESTAMP].to_numpy(copy=True)
        start_timestamps[start_index_array] = event_timestamps[start_index_array]
        df_copy[Column.START_TIMESTAMP] = start_timestamps

    if stop_start_indices:
        stop_start_index_array = np.asarray(stop_start_indices, dtype=np.intp)
        stop_event_index_array = np.asarray(stop_event_indices, dtype=np.intp)
        stop_timestamps = df_copy[Column.STOP_TIMESTAMP].to_numpy(copy=True)
        stop_timestamps[stop_start_index_array] = event_timestamps[stop_event_index_array]
        df_copy[Column.STOP_TIMESTAMP] = stop_timestamps

    if missing_indices:
        df_copy.loc[missing_indices, Column.INTERACTION_TYPE] = (
            InteractionType.END_OF_USAGE_MISSING
        )

    return df_copy


def _apply_rust_matcher_output(
    *,
    df: pd.DataFrame,
    event_timestamps: Any,
    timestamp_nanoseconds: Any,
    start_ns: list[int],
    stop_ns: list[int],
    missing: list[bool],
) -> pd.DataFrame:
    """Apply Rust primitive outputs while preserving original timestamp objects."""
    df_copy = df.copy()
    timestamp_by_ns = {
        int(timestamp_ns): event_timestamp
        for timestamp_ns, event_timestamp in zip(
            timestamp_nanoseconds,
            event_timestamps,
            strict=False,
        )
    }

    start_timestamps = df_copy[Column.START_TIMESTAMP].to_numpy(copy=True)
    stop_timestamps = df_copy[Column.STOP_TIMESTAMP].to_numpy(copy=True)

    has_start_updates = False
    has_stop_updates = False
    for index, timestamp_ns in enumerate(start_ns):
        if timestamp_ns != MISSING_TIMESTAMP_NS:
            start_timestamps[index] = timestamp_by_ns[timestamp_ns]
            has_start_updates = True

    for index, timestamp_ns in enumerate(stop_ns):
        if timestamp_ns != MISSING_TIMESTAMP_NS:
            stop_timestamps[index] = timestamp_by_ns[timestamp_ns]
            has_stop_updates = True

    if has_start_updates:
        df_copy[Column.START_TIMESTAMP] = start_timestamps
    if has_stop_updates:
        df_copy[Column.STOP_TIMESTAMP] = stop_timestamps

    missing_indices = [index for index, is_missing in enumerate(missing) if is_missing]
    if missing_indices:
        df_copy.loc[missing_indices, Column.INTERACTION_TYPE] = (
            InteractionType.END_OF_USAGE_MISSING
        )

    return df_copy
