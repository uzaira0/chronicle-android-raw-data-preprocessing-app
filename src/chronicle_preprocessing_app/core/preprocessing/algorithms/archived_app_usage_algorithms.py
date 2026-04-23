"""
Archived app-usage algorithms retained for parity tests.

These implementations are not used by the production preprocessing pipeline.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions


class ArchivedBaselineAppUsageAlgorithm:
    """Legacy app-usage pairing algorithm retained for parity tests only."""

    def __init__(self, options: PreprocessingOptions):
        self.options = options
        self.long_duration_threshold_seconds = int(options.long_duration_threshold_hours * 3600)

    def process_app_usage(
        self,
        df: pd.DataFrame,
        resumed_mask: pd.Series,
        same_app_stop_mask: pd.Series,
        other_stop_mask: pd.Series,
        stopped_mask: pd.Series,
    ) -> pd.DataFrame:
        """Pair resumed events using the pre-bisect legacy scan strategy."""
        df_copy = df.reset_index(drop=True)

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

        same_app_stops_by_pkg: dict[str, list[int]] = {}
        for idx in sorted(same_app_stop_indices):
            pkg = app_packages[idx]
            if pkg not in same_app_stops_by_pkg:
                same_app_stops_by_pkg[pkg] = []
            same_app_stops_by_pkg[pkg].append(idx)

        stopped_by_pkg: dict[str, list[int]] = {}
        for idx in sorted(stopped_indices):
            pkg = app_packages[idx]
            if pkg not in stopped_by_pkg:
                stopped_by_pkg[pkg] = []
            stopped_by_pkg[pkg].append(idx)

        other_stop_list = sorted(other_stop_indices)
        matched_stop_indices = set() if not self.options.allow_stop_event_reuse else None
        resumed_indices = df_copy.index[resumed_mask].tolist()

        start_updates: list[tuple[int, Any]] = []
        stop_updates: list[tuple[int, Any]] = []
        missing_indices: list[int] = []

        for i in resumed_indices:
            current_app = app_packages[i]
            current_timestamp = timestamps[i]

            same_app_stop_index = None
            if current_app in same_app_stops_by_pkg:
                for idx in same_app_stops_by_pkg[current_app]:
                    if idx > i and (matched_stop_indices is None or idx not in matched_stop_indices):
                        same_app_stop_index = idx
                        break

            other_app_stop_index = None
            for idx in other_stop_list:
                if idx > i and app_packages[idx] != current_app:
                    if matched_stop_indices is None or idx not in matched_stop_indices:
                        other_app_stop_index = idx
                        break

            activity_stopped_index = None
            if current_app in stopped_by_pkg:
                for idx in stopped_by_pkg[current_app]:
                    if idx > i and (matched_stop_indices is None or idx not in matched_stop_indices):
                        activity_stopped_index = idx
                        break

            same_app_stop_timestamp = (
                timestamps[same_app_stop_index] if same_app_stop_index is not None else None
            )
            other_app_stop_timestamp = (
                timestamps[other_app_stop_index] if other_app_stop_index is not None else None
            )
            activity_stopped_timestamp = (
                timestamps[activity_stopped_index] if activity_stopped_index is not None else None
            )

            best_match_index = None
            timestamp_to_use = self._determine_best_match(
                current_timestamp,
                same_app_stop_timestamp,
                other_app_stop_timestamp,
                activity_stopped_timestamp,
            )

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

            start_updates.append((i, current_timestamp))
            if timestamp_to_use is not None:
                stop_updates.append((i, timestamp_to_use))
            else:
                missing_indices.append(i)

            if matched_stop_indices is not None and best_match_index is not None:
                matched_stop_indices.add(best_match_index)

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
        current_timestamp: Any,
        same_app_stop_timestamp: Any,
        other_app_stop_timestamp: Any,
        activity_stopped_timestamp: Any,
    ) -> Any:
        """Determine the best matching stop timestamp using legacy priority rules."""
        timestamp_to_use = None

        if not self.options.use_activity_stopped_as_fallback:
            activity_stopped_timestamp = None

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
            if self.options.apply_threshold_to_activity_stopped_fallback:
                activity_stopped_diff = (
                    pd.Timestamp(activity_stopped_timestamp) - pd.Timestamp(current_timestamp)
                ).total_seconds()
                if activity_stopped_diff < self.long_duration_threshold_seconds:
                    timestamp_to_use = activity_stopped_timestamp
            else:
                timestamp_to_use = activity_stopped_timestamp

        return timestamp_to_use
