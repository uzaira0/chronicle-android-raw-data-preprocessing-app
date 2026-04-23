"""
App usage processing algorithm for Chronicle Android data.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd
from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions

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

        # Ensure timestamp columns can hold tz-aware timestamps without dtype warnings
        for column in (Column.START_TIMESTAMP, Column.STOP_TIMESTAMP):
            if column not in df_copy.columns:
                df_copy[column] = pd.Series([pd.NaT] * len(df_copy), dtype="object")
            else:
                df_copy[column] = df_copy[column].astype("object")

        app_packages = df_copy[Column.APP_PACKAGE_NAME].values
        timestamps = df_copy[Column.EVENT_TIMESTAMP].array

        same_app_stop_indices = set(df_copy.index[same_app_stop_mask].tolist())
        other_stop_indices = set(df_copy.index[other_stop_mask].tolist())
        stopped_indices = set(df_copy.index[stopped_mask].tolist())

        # Collect all updates to apply in batch at the end
        start_updates: list[tuple[int, Any]] = []
        stop_updates: list[tuple[int, Any]] = []
        missing_indices: list[int] = []
        open_start_indices: list[int] = []

        for index in df_copy.index:
            current_app = app_packages[index]
            current_timestamp = timestamps[index]

            compatible_open_starts = self._compatible_open_starts_for_stop(
                stop_index=index,
                current_app=current_app,
                app_packages=app_packages,
                timestamps=timestamps,
                open_start_indices=open_start_indices,
                same_app_stop_indices=same_app_stop_indices,
                other_stop_indices=other_stop_indices,
                stopped_indices=stopped_indices,
            )
            if compatible_open_starts:
                starts_to_close = (
                    compatible_open_starts
                    if self.options.allow_stop_event_reuse
                    else [compatible_open_starts[-1]]
                )
                for start_index in starts_to_close:
                    stop_updates.append((start_index, current_timestamp))
                    open_start_indices.remove(start_index)

            if bool(resumed_mask.iloc[index]):
                start_updates.append((index, current_timestamp))
                open_start_indices.append(index)

        if open_start_indices:
            last_index = len(df_copy.index) - 1
            last_timestamp = timestamps[last_index]
            for start_index in list(open_start_indices):
                if last_index > start_index and self._is_valid_duration(
                    timestamps[start_index],
                    last_timestamp,
                    enforce_threshold=True,
                ):
                    stop_updates.append((start_index, last_timestamp))
                    open_start_indices.remove(start_index)

        missing_indices.extend(open_start_indices)

        # Apply all updates in batch
        # Don't specify dtype - let pandas handle conversion like the original code does
        if start_updates:
            start_indices, start_values = zip(*start_updates, strict=False)
            df_copy.loc[list(start_indices), Column.START_TIMESTAMP] = list(start_values)

        if stop_updates:
            stop_indices, stop_values = zip(*stop_updates, strict=False)
            df_copy.loc[list(stop_indices), Column.STOP_TIMESTAMP] = list(stop_values)

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
        open_start_indices: list[int],
        same_app_stop_indices: set[int],
        other_stop_indices: set[int],
        stopped_indices: set[int],
    ) -> list[int]:
        """Return compatible open starts in chronological order for a stop row."""
        normal_stop = stop_index in same_app_stop_indices or stop_index in other_stop_indices
        fallback_stop = (
            stop_index in stopped_indices and self.options.use_activity_stopped_as_fallback
        )

        compatible_starts: list[int] = []
        for start_index in open_start_indices:
            start_app = app_packages[start_index]
            same_app_compatible = (
                stop_index in same_app_stop_indices and start_app == current_app
            )
            other_app_compatible = (
                stop_index in other_stop_indices and start_app != current_app
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
            if self._is_valid_duration(
                timestamps[start_index],
                timestamps[stop_index],
                enforce_threshold=enforce_threshold,
            ):
                compatible_starts.append(start_index)

        return compatible_starts

    def _is_valid_duration(
        self,
        start_timestamp: Any,
        stop_timestamp: Any,
        *,
        enforce_threshold: bool,
    ) -> bool:
        """Return whether a candidate stop produces a valid non-negative duration."""
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
