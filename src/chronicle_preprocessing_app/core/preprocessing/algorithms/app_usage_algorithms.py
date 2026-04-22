"""
App usage processing algorithm for Chronicle Android data.
"""

from __future__ import annotations

import logging
import warnings

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


class BaselineAlgorithm:
    """Optimized O(n²) algorithm - pre-built indices and batched updates.

    This algorithm pre-builds indices once instead of filtering the DataFrame repeatedly,
    and batches all DataFrame updates at the end instead of individual df.loc calls.
    """

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
        """Optimized naive implementation - same logic, faster execution with batched updates."""
        LOGGER.debug(
            f"Using baseline algorithm (stop reuse: {self.options.allow_stop_event_reuse})"
        )
        df_copy = df.reset_index(drop=True)

        # Ensure timestamp columns can hold tz-aware timestamps without dtype warnings
        for column in (Column.START_TIMESTAMP, Column.STOP_TIMESTAMP):
            if column not in df_copy.columns:
                df_copy[column] = pd.Series([pd.NaT] * len(df_copy), dtype="object")
            else:
                df_copy[column] = df_copy[column].astype("object")

        # Pre-extract arrays for fast access (avoid repeated DataFrame lookups)
        app_packages = df_copy[Column.APP_PACKAGE_NAME].values
        # Use .array instead of .values to preserve timezone info for datetime columns
        timestamps = df_copy[Column.EVENT_TIMESTAMP].array

        # Pre-build index lists for each mask type
        same_app_stop_indices = set(df_copy.index[same_app_stop_mask].tolist())
        other_stop_indices = set(df_copy.index[other_stop_mask].tolist())
        stopped_indices = set(df_copy.index[stopped_mask].tolist())

        # Pre-build same-app stop indices grouped by app package for O(1) lookup
        same_app_stops_by_pkg: dict[str, list[int]] = {}
        for idx in sorted(same_app_stop_indices):
            pkg = app_packages[idx]
            if pkg not in same_app_stops_by_pkg:
                same_app_stops_by_pkg[pkg] = []
            same_app_stops_by_pkg[pkg].append(idx)

        # Pre-build activity stopped indices grouped by app package
        stopped_by_pkg: dict[str, list[int]] = {}
        for idx in sorted(stopped_indices):
            pkg = app_packages[idx]
            if pkg not in stopped_by_pkg:
                stopped_by_pkg[pkg] = []
            stopped_by_pkg[pkg].append(idx)

        # Pre-build sorted list of other-app stop indices
        other_stop_list = sorted(other_stop_indices)

        # Track matched stops if reuse prevention is enabled
        matched_stop_indices = set() if not self.options.allow_stop_event_reuse else None

        # Get resumed indices
        resumed_indices = df_copy.index[resumed_mask].tolist()

        # Collect all updates to apply in batch at the end
        start_updates: list[tuple[int, any]] = []  # (index, start_timestamp)
        stop_updates: list[tuple[int, any]] = []  # (index, stop_timestamp)
        missing_indices: list[int] = []  # indices where stop is missing

        # For each resumed activity, find the corresponding stop
        for i in resumed_indices:
            current_app = app_packages[i]
            current_timestamp = timestamps[i]

            # Find first same-app stop after index i
            same_app_stop_index = None
            if current_app in same_app_stops_by_pkg:
                for idx in same_app_stops_by_pkg[current_app]:
                    if idx > i:
                        if matched_stop_indices is None or idx not in matched_stop_indices:
                            same_app_stop_index = idx
                            break

            # Find first other-app stop after index i (different app)
            other_app_stop_index = None
            for idx in other_stop_list:
                if idx > i:
                    if app_packages[idx] != current_app:
                        if matched_stop_indices is None or idx not in matched_stop_indices:
                            other_app_stop_index = idx
                            break

            # Find first activity stopped for same app after index i
            activity_stopped_index = None
            if current_app in stopped_by_pkg:
                for idx in stopped_by_pkg[current_app]:
                    if idx > i:
                        if matched_stop_indices is None or idx not in matched_stop_indices:
                            activity_stopped_index = idx
                            break

            # Get corresponding timestamps
            same_app_stop_timestamp = (
                timestamps[same_app_stop_index] if same_app_stop_index is not None else None
            )
            other_app_stop_timestamp = (
                timestamps[other_app_stop_index] if other_app_stop_index is not None else None
            )
            activity_stopped_timestamp = (
                timestamps[activity_stopped_index] if activity_stopped_index is not None else None
            )

            # Determine best match using same logic as original
            best_match_index = None
            timestamp_to_use = self._determine_best_match(
                current_timestamp,
                same_app_stop_timestamp,
                other_app_stop_timestamp,
                activity_stopped_timestamp,
            )

            # Track which stop index was matched
            if timestamp_to_use is not None:
                if (
                    same_app_stop_timestamp is not None
                    and timestamp_to_use == same_app_stop_timestamp
                ):
                    best_match_index = same_app_stop_index
                elif (
                    other_app_stop_timestamp is not None
                    and timestamp_to_use == other_app_stop_timestamp
                ):
                    best_match_index = other_app_stop_index
                elif (
                    activity_stopped_timestamp is not None
                    and timestamp_to_use == activity_stopped_timestamp
                ):
                    best_match_index = activity_stopped_index

            # Collect updates instead of applying immediately
            start_updates.append((i, current_timestamp))
            if timestamp_to_use is not None:
                stop_updates.append((i, timestamp_to_use))
            else:
                missing_indices.append(i)

            # Add to matched indices if reuse prevention is enabled
            if matched_stop_indices is not None and best_match_index is not None:
                matched_stop_indices.add(best_match_index)

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

    def _determine_best_match(
        self,
        current_timestamp,
        same_app_stop_timestamp,
        other_app_stop_timestamp,
        activity_stopped_timestamp,
    ):
        """Determine the best matching stop timestamp using priority rules.

        This method matches the OLD algorithm behavior by default:
        - Only checks the case when BOTH same_app AND other_app stops exist
        - Falls back to activity_stopped without threshold check when only it exists

        When apply_threshold_to_activity_stopped_fallback is True, applies the
        12-hour threshold check to activity_stopped as well.

        When use_activity_stopped_as_fallback is False, activity_stopped is never used.
        """
        timestamp_to_use = None

        # Check if Activity Stopped fallback is enabled
        use_fallback = self.options.use_activity_stopped_as_fallback
        apply_threshold = self.options.apply_threshold_to_activity_stopped_fallback

        # If fallback is disabled, treat activity_stopped_timestamp as None
        if not use_fallback:
            activity_stopped_timestamp = None

        # OLD algorithm behavior: Only handle case when BOTH same_app AND other_app exist
        # Otherwise fall through to activity_stopped fallback
        if same_app_stop_timestamp is not None and other_app_stop_timestamp is not None:
            same_app_diff = (
                pd.Timestamp(same_app_stop_timestamp) - pd.Timestamp(current_timestamp)
            ).total_seconds()
            other_app_diff = (
                pd.Timestamp(other_app_stop_timestamp) - pd.Timestamp(current_timestamp)
            ).total_seconds()
            activity_stopped_diff = (
                (
                    pd.Timestamp(activity_stopped_timestamp) - pd.Timestamp(current_timestamp)
                ).total_seconds()
                if activity_stopped_timestamp is not None
                else float("inf")
            )

            if same_app_diff < other_app_diff:
                if same_app_diff < self.long_duration_threshold_seconds:
                    timestamp_to_use = same_app_stop_timestamp
                elif (
                    activity_stopped_timestamp is not None
                    and activity_stopped_diff < self.long_duration_threshold_seconds
                ):
                    timestamp_to_use = activity_stopped_timestamp
            elif same_app_diff > other_app_diff:
                if other_app_diff < self.long_duration_threshold_seconds:
                    timestamp_to_use = other_app_stop_timestamp
                elif (
                    activity_stopped_timestamp is not None
                    and activity_stopped_diff < self.long_duration_threshold_seconds
                ):
                    timestamp_to_use = activity_stopped_timestamp
            elif same_app_diff < self.long_duration_threshold_seconds:
                timestamp_to_use = same_app_stop_timestamp
            elif (
                activity_stopped_timestamp is not None
                and activity_stopped_diff < self.long_duration_threshold_seconds
            ):
                timestamp_to_use = activity_stopped_timestamp
        elif activity_stopped_timestamp is not None:
            # OLD algorithm behavior: When only activity_stopped exists, use it
            # Optionally apply threshold check if configured
            if apply_threshold:
                activity_stopped_diff = (
                    pd.Timestamp(activity_stopped_timestamp) - pd.Timestamp(current_timestamp)
                ).total_seconds()
                if activity_stopped_diff < self.long_duration_threshold_seconds:
                    timestamp_to_use = activity_stopped_timestamp
            else:
                # Match OLD behavior: use activity_stopped without threshold check
                timestamp_to_use = activity_stopped_timestamp

        return timestamp_to_use

    def _apply_match(
        self, df: pd.DataFrame, resumed_idx: int, stop_timestamp: pd.Timestamp | None
    ) -> None:
        """
        Apply a match to the dataframe.

        Args:
            df: DataFrame to modify
            resumed_idx: Index of the resumed event
            stop_timestamp: Timestamp of the stop event (or None if missing)
        """
        with warnings.catch_warnings():
            warnings.simplefilter(action="ignore", category=FutureWarning)
            current_timestamp = df.loc[resumed_idx, Column.EVENT_TIMESTAMP]
            df.loc[resumed_idx, Column.START_TIMESTAMP] = current_timestamp

            if stop_timestamp is not None:
                df.loc[resumed_idx, Column.STOP_TIMESTAMP] = stop_timestamp
            else:
                df.loc[resumed_idx, Column.INTERACTION_TYPE] = InteractionType.END_OF_USAGE_MISSING
