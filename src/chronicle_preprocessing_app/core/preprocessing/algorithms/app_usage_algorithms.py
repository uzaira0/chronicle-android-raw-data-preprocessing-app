"""
App usage processing algorithm for Chronicle Android data.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd
from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.rust_app_usage_matcher import (
    process_app_usage_with_rust,
)

LOGGER = logging.getLogger(__name__)


def safe_timestamp_compare(ts1: pd.Timestamp, ts2: pd.Timestamp, op: str) -> bool:
    """
    Safely compare two timestamps, handling timezone-aware vs naive comparisons.

    Args:
        ts1: First timestamp
        ts2: Second timestamp
        op: Operation ('<', '>', '<=', '>=', '==', '!=')

    Returns:
        bool: Result of comparison
    """
    try:
        # Try direct comparison first
        if op == "<":
            return ts1 < ts2
        elif op == ">":
            return ts1 > ts2
        elif op == "<=":
            return ts1 <= ts2
        elif op == ">=":
            return ts1 >= ts2
        elif op == "==":
            return ts1 == ts2
        elif op == "!=":
            return ts1 != ts2
    except TypeError:
        # Handle timezone mismatch by converting both to naive
        ts1_naive = ts1.replace(tzinfo=None) if hasattr(ts1, "tzinfo") and ts1.tzinfo else ts1
        ts2_naive = ts2.replace(tzinfo=None) if hasattr(ts2, "tzinfo") and ts2.tzinfo else ts2

        if op == "<":
            return ts1_naive < ts2_naive
        elif op == ">":
            return ts1_naive > ts2_naive
        elif op == "<=":
            return ts1_naive <= ts2_naive
        elif op == ">=":
            return ts1_naive >= ts2_naive
        elif op == "==":
            return ts1_naive == ts2_naive
        elif op == "!=":
            return ts1_naive != ts2_naive

    return False


def safe_duration_seconds(stop_time: pd.Timestamp, start_time: pd.Timestamp) -> float:
    """
    Safely calculate duration between two timestamps, handling timezone issues.

    Args:
        stop_time: End timestamp
        start_time: Start timestamp

    Returns:
        float: Duration in seconds
    """
    try:
        return (stop_time - start_time).total_seconds()
    except TypeError:
        # Convert to naive if needed for duration calculation
        stop_naive = (
            stop_time.replace(tzinfo=None)
            if hasattr(stop_time, "tzinfo") and stop_time.tzinfo
            else stop_time
        )
        start_naive = (
            start_time.replace(tzinfo=None)
            if hasattr(start_time, "tzinfo") and start_time.tzinfo
            else start_time
        )
        return (stop_naive - start_naive).total_seconds()


class OptimizedAppUsageAlgorithm:
    """Single supported app-usage pairing algorithm."""

    def __init__(self, options: PreprocessingOptions):
        """
        Initialize the algorithm with preprocessing options.

        Args:
            options: The preprocessing options
        """
        self.options = options
        # Use threshold from options if set, otherwise fall back to constant
        self.long_duration_threshold_seconds = int(options.long_duration_threshold_hours * 3600)
        self.long_duration_threshold_nanoseconds = (
            self.long_duration_threshold_seconds * 1_000_000_000
        )

    def process_app_usage(
        self,
        df: pd.DataFrame,
        resumed_mask: pd.Series,
        same_app_stop_mask: pd.Series,
        other_stop_mask: pd.Series,
        stopped_mask: pd.Series,
    ) -> pd.DataFrame:
        """Pair start events with semantically compatible stop events."""
        LOGGER.debug(
            "Using optimized app usage algorithm "
            f"(stop reuse: {self.options.allow_stop_event_reuse})"
        )
        df_copy = df.reset_index(drop=True)
        row_count = len(df_copy.index)

        # Ensure timestamp columns can hold tz-aware timestamps without dtype warnings
        for column in (Column.START_TIMESTAMP, Column.STOP_TIMESTAMP):
            if column not in df_copy.columns:
                df_copy[column] = pd.Series([pd.NaT] * row_count, dtype="object")
            else:
                df_copy[column] = df_copy[column].astype("object")

        app_packages = df_copy[Column.APP_PACKAGE_NAME].values
        event_timestamp_series = df_copy[Column.EVENT_TIMESTAMP]
        timestamps = event_timestamp_series.astype("object").values
        timestamp_nanoseconds = getattr(event_timestamp_series.array, "asi8", None)
        start_timestamps = df_copy[Column.START_TIMESTAMP].to_numpy(copy=True)
        stop_timestamps = df_copy[Column.STOP_TIMESTAMP].to_numpy(copy=True)

        resumed_flags = resumed_mask.to_numpy(dtype=bool)
        same_app_stop_flags = same_app_stop_mask.to_numpy(dtype=bool)
        other_stop_flags = other_stop_mask.to_numpy(dtype=bool)
        stopped_flags = stopped_mask.to_numpy(dtype=bool)

        rust_result = process_app_usage_with_rust(
            df=df_copy,
            app_packages=app_packages,
            event_timestamps=timestamps,
            timestamp_nanoseconds=timestamp_nanoseconds,
            resumed_flags=resumed_flags,
            same_app_stop_flags=same_app_stop_flags,
            other_stop_flags=other_stop_flags,
            stopped_flags=stopped_flags,
            options=self.options,
        )
        if rust_result is not None:
            return rust_result

        has_start_updates = False
        has_stop_updates = False
        missing_indices: list[int] = []
        open_start_indices: list[int] = []
        allow_stop_event_reuse = self.options.allow_stop_event_reuse
        use_activity_stopped_as_fallback = self.options.use_activity_stopped_as_fallback
        apply_threshold_to_fallback = self.options.apply_threshold_to_activity_stopped_fallback
        is_valid_duration_at = self._is_valid_duration_at

        for index in range(row_count):
            current_app = app_packages[index]
            current_timestamp = timestamps[index]
            is_normal_stop = same_app_stop_flags[index] or other_stop_flags[index]
            is_fallback_stop = stopped_flags[index] and use_activity_stopped_as_fallback

            if allow_stop_event_reuse and (is_normal_stop or is_fallback_stop):
                compatible_open_starts = self._compatible_open_starts_for_stop(
                    stop_index=index,
                    current_app=current_app,
                    app_packages=app_packages,
                    timestamps=timestamps,
                    timestamp_nanoseconds=timestamp_nanoseconds,
                    open_start_indices=open_start_indices,
                    same_app_stop_flags=same_app_stop_flags,
                    other_stop_flags=other_stop_flags,
                    stopped_flags=stopped_flags,
                )
                for start_index in compatible_open_starts:
                    stop_timestamps[start_index] = current_timestamp
                    has_stop_updates = True
                    open_start_indices.remove(start_index)
            elif is_normal_stop or is_fallback_stop:
                start_index = None
                for candidate_start_index in reversed(open_start_indices):
                    start_app = app_packages[candidate_start_index]
                    same_app_compatible = (
                        same_app_stop_flags[index] and start_app == current_app
                    )
                    other_app_compatible = (
                        other_stop_flags[index] and start_app != current_app
                    )
                    fallback_compatible = (
                        not is_normal_stop
                        and is_fallback_stop
                        and start_app == current_app
                    )
                    if not (
                        same_app_compatible
                        or other_app_compatible
                        or fallback_compatible
                    ):
                        continue

                    enforce_threshold = (
                        not fallback_compatible or apply_threshold_to_fallback
                    )
                    if is_valid_duration_at(
                        candidate_start_index,
                        index,
                        timestamps=timestamps,
                        timestamp_nanoseconds=timestamp_nanoseconds,
                        enforce_threshold=enforce_threshold,
                    ):
                        start_index = candidate_start_index
                        break

                if start_index is not None:
                    stop_timestamps[start_index] = current_timestamp
                    has_stop_updates = True
                    open_start_indices.remove(start_index)

            if resumed_flags[index]:
                start_timestamps[index] = current_timestamp
                has_start_updates = True
                open_start_indices.append(index)

        if open_start_indices:
            last_index = row_count - 1
            last_timestamp = timestamps[last_index]
            for start_index in list(open_start_indices):
                if last_index > start_index and is_valid_duration_at(
                    start_index,
                    last_index,
                    timestamps=timestamps,
                    timestamp_nanoseconds=timestamp_nanoseconds,
                    enforce_threshold=True,
                ):
                    stop_timestamps[start_index] = last_timestamp
                    has_stop_updates = True
                    open_start_indices.remove(start_index)

        missing_indices.extend(open_start_indices)

        if has_start_updates:
            df_copy[Column.START_TIMESTAMP] = start_timestamps

        if has_stop_updates:
            df_copy[Column.STOP_TIMESTAMP] = stop_timestamps

        if missing_indices:
            df_copy.loc[missing_indices, Column.INTERACTION_TYPE] = (
                InteractionType.END_OF_USAGE_MISSING
            )

        return df_copy

    def _compatible_open_starts_for_stop(
        self,
        *,
        stop_index: int,
        current_app: Any,
        app_packages: Any,
        timestamps: Any,
        timestamp_nanoseconds: Any,
        open_start_indices: list[int],
        same_app_stop_flags: Any,
        other_stop_flags: Any,
        stopped_flags: Any,
    ) -> list[int]:
        """Return compatible open starts in chronological order for a stop row."""
        normal_stop = same_app_stop_flags[stop_index] or other_stop_flags[stop_index]
        fallback_stop = (
            stopped_flags[stop_index] and self.options.use_activity_stopped_as_fallback
        )

        compatible_starts: list[int] = []
        for start_index in open_start_indices:
            start_app = app_packages[start_index]
            same_app_compatible = (
                same_app_stop_flags[stop_index] and start_app == current_app
            )
            other_app_compatible = (
                other_stop_flags[stop_index] and start_app != current_app
            )
            fallback_compatible = (
                not normal_stop
                and fallback_stop
                and start_app == current_app
            )

            if not (same_app_compatible or other_app_compatible or fallback_compatible):
                continue

            enforce_threshold = (
                not fallback_compatible
                or self.options.apply_threshold_to_activity_stopped_fallback
            )
            if self._is_valid_duration_at(
                start_index,
                stop_index,
                timestamps=timestamps,
                timestamp_nanoseconds=timestamp_nanoseconds,
                enforce_threshold=enforce_threshold,
            ):
                compatible_starts.append(start_index)

        return compatible_starts

    def _is_valid_duration_at(
        self,
        start_index: int,
        stop_index: int,
        *,
        timestamps: Any,
        timestamp_nanoseconds: Any,
        enforce_threshold: bool,
    ) -> bool:
        """Return whether indexed timestamps form a valid duration."""
        if timestamp_nanoseconds is not None:
            duration_nanoseconds = int(timestamp_nanoseconds[stop_index]) - int(
                timestamp_nanoseconds[start_index]
            )
            if duration_nanoseconds < 0:
                return False
            return (
                True
                if not enforce_threshold
                else duration_nanoseconds <= self.long_duration_threshold_nanoseconds
            )

        return self._is_valid_duration(
            timestamps[start_index],
            timestamps[stop_index],
            enforce_threshold=enforce_threshold,
        )

    def _is_valid_duration(
        self,
        start_timestamp: Any,
        stop_timestamp: Any,
        *,
        enforce_threshold: bool,
    ) -> bool:
        """Return whether a candidate stop produces a valid non-negative duration."""
        try:
            duration_seconds = (stop_timestamp - start_timestamp).total_seconds()
        except (AttributeError, TypeError):
            duration_seconds = safe_duration_seconds(
                pd.Timestamp(stop_timestamp),
                pd.Timestamp(start_timestamp),
            )
        if duration_seconds < 0:
            return False
        return (
            True
            if not enforce_threshold
            else duration_seconds <= self.long_duration_threshold_seconds
        )
