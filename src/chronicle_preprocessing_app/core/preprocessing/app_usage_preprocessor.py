"""
Preprocessor for app usage operations in Chronicle data.

Supports Polars for high-performance operations when enabled.
Set CHRONICLE_USE_POLARS=true to enable.
"""

from __future__ import annotations

import logging
import os
import warnings

import numpy as np
import pandas as pd

# Conditional Polars import
try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    pl = None  # type: ignore

# Environment variable to control Polars usage
USE_POLARS = os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true" and POLARS_AVAILABLE

from chronicle_preprocessing_app.config.constants import Column, InteractionType

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_algorithms import BaselineAlgorithm
from chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_details_optimizer import (
    OptimizedAppUsageDetailsProcessor,
)
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor

try:
    from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import TimestampPreprocessor
    from chronicle_preprocessing_app.core.preprocessing.timezone_preprocessor import TimezonePreprocessor
except ImportError:
    from .timestamp_preprocessor import TimestampPreprocessor
    from .timezone_preprocessor import TimezonePreprocessor

LOGGER = logging.getLogger(__name__)


class AppUsagePreprocessor(BasePreprocessor):
    """
    Preprocessor for handling app usage operations.

    This preprocessor is responsible for processing valid app usage rows,
    filtered app usage rows, and adding usage details and flags.
    """

    def __init__(self, options: PreprocessingOptions) -> None:
        """
        Initialize the app usage preprocessor.

        Args:
            options: The preprocessing options
        """
        super().__init__(options)
        self.timezone_preprocessor = TimezonePreprocessor(options)

        # Initialize algorithm
        self.algorithm = BaselineAlgorithm(options)
        LOGGER.debug("Using baseline algorithm")

        # Initialize optimized details processor
        self.details_processor = OptimizedAppUsageDetailsProcessor(options)
        LOGGER.debug("Using O(n) optimized app usage details processor")

    def preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process app usage in the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        df = self.process_filtered_app_usage(df)
        df = self.process_valid_app_usage(df)
        return df

    def process_app_usage(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process all app usage operations.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """

        df = self.process_filtered_app_usage(df)

        try:
            df = self.process_valid_app_usage(df)
        except pd.errors.EmptyDataError as e:
            LOGGER.warning(f"No valid app usage data: {e}")

        return df

    def process_filtered_app_usage(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process filtered app usage rows to determine start and stop timestamps.

        Performance: O(n) to O(n*k) where k = number of unique apps (typically O(n))
        Previous O(n²) implementation scanned entire DataFrame 3 times per resumed event.
        Current implementation:
        1. Pre-indexes stop events by app package - O(n)
        2. Maintains forward-moving pointers for each app's stop events
        3. Processes resumed events in order, advancing pointers as needed
        4. Each pointer moves forward at most n times TOTAL across all iterations
        5. For "other app" stops, uses a modified pointer that skips same-app events
        Result: O(n) typical case with excellent cache locality. Worst case O(n*k) when
        many apps interleave, but still much better than O(n²) original.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        LOGGER.debug("Processing filtered app usage rows (O(n) optimized version)")

        df_copy = df.reset_index(drop=True)

        filtered_interactions = [
            InteractionType.FILTERED_APP_RESUMED,
            InteractionType.FILTERED_APP_PAUSED,
        ]
        if not df_copy[Column.INTERACTION_TYPE].isin(filtered_interactions).any():
            LOGGER.debug("No filtered app usage found")
            return df_copy

        long_duration_threshold_seconds = int(self.options.long_duration_threshold_hours * 3600)

        # Create masks for different interaction types
        resumed_mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_RESUMED
        same_app_stop_mask = df_copy[Column.INTERACTION_TYPE].isin(
            self.options.filtered_same_app_interaction_types_to_stop_usage_at
        )
        other_stop_mask = df_copy[Column.INTERACTION_TYPE].isin(
            self.options.filtered_other_interaction_types_to_stop_usage_at
        )
        stopped_mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_STOPPED

        # Pre-compute stop event indices grouped by app package - O(n)
        same_app_stops_by_package = {}
        for idx in df_copy.index[same_app_stop_mask].tolist():
            app = df_copy.loc[idx, Column.APP_PACKAGE_NAME]
            if app not in same_app_stops_by_package:
                same_app_stops_by_package[app] = []
            same_app_stops_by_package[app].append(idx)

        activity_stopped_by_package = {}
        for idx in df_copy.index[stopped_mask].tolist():
            app = df_copy.loc[idx, Column.APP_PACKAGE_NAME]
            if app not in activity_stopped_by_package:
                activity_stopped_by_package[app] = []
            activity_stopped_by_package[app].append(idx)

        # Pre-compute other app stops (don't need to group by app)
        other_app_stops = df_copy.index[other_stop_mask].tolist()

        # Initialize forward-moving pointers for O(n) traversal
        # These pointers only move forward, never backward, achieving O(n) total complexity
        same_app_pointers = {app: 0 for app in same_app_stops_by_package}
        activity_stopped_pointers = {app: 0 for app in activity_stopped_by_package}
        other_app_pointer = 0

        # For each resumed activity, find the corresponding stop - O(n)
        # Each pointer moves forward at most n times TOTAL across all iterations
        for i in df_copy.index[resumed_mask].tolist():
            current_app = df_copy.loc[i, Column.APP_PACKAGE_NAME]
            current_timestamp = df_copy.loc[i, Column.EVENT_TIMESTAMP]

            # Find next same app stop using forward pointer - O(1) amortized
            same_app_stop_index = None
            if current_app in same_app_stops_by_package:
                same_app_list = same_app_stops_by_package[current_app]
                ptr = same_app_pointers[current_app]
                # Advance pointer past stops at or before current index
                while ptr < len(same_app_list) and same_app_list[ptr] <= i:
                    ptr += 1
                same_app_pointers[current_app] = ptr
                if ptr < len(same_app_list):
                    same_app_stop_index = same_app_list[ptr]

            # Find next other app stop using forward pointer - O(1) amortized per unique app
            other_app_stop_index = None
            temp_ptr = other_app_pointer
            while temp_ptr < len(other_app_stops):
                candidate_idx = other_app_stops[temp_ptr]
                # Advance global pointer past old indices
                if candidate_idx <= i:
                    other_app_pointer = temp_ptr + 1
                    temp_ptr += 1
                    continue
                # Check if it's a different app (matching old behavior)
                candidate_app = df_copy.loc[candidate_idx, Column.APP_PACKAGE_NAME]
                if candidate_app != current_app:
                    other_app_stop_index = candidate_idx
                    break
                temp_ptr += 1

            # Find next activity stopped using forward pointer - O(1) amortized
            activity_stopped_index = None
            if current_app in activity_stopped_by_package:
                activity_stopped_list = activity_stopped_by_package[current_app]
                ptr = activity_stopped_pointers[current_app]
                while ptr < len(activity_stopped_list) and activity_stopped_list[ptr] <= i:
                    ptr += 1
                activity_stopped_pointers[current_app] = ptr
                if ptr < len(activity_stopped_list):
                    activity_stopped_index = activity_stopped_list[ptr]

            # Get corresponding timestamps
            same_app_stop_timestamp = (
                df_copy.loc[same_app_stop_index, Column.EVENT_TIMESTAMP]
                if same_app_stop_index is not None
                else None
            )
            other_app_stop_timestamp = (
                df_copy.loc[other_app_stop_index, Column.EVENT_TIMESTAMP]
                if other_app_stop_index is not None
                else None
            )
            activity_stopped_timestamp = (
                df_copy.loc[activity_stopped_index, Column.EVENT_TIMESTAMP]
                if activity_stopped_index is not None
                else None
            )

            # Check if Activity Stopped fallback is enabled
            use_fallback = self.options.use_activity_stopped_as_fallback

            # If fallback is disabled, treat activity_stopped_timestamp as None
            if not use_fallback:
                activity_stopped_timestamp = None

            timestamp_to_use = None

            # First, check if both same app and other app timestamps are available
            if (
                same_app_stop_index is not None
                and isinstance(same_app_stop_timestamp, pd.Timestamp)
                and other_app_stop_index is not None
                and isinstance(other_app_stop_timestamp, pd.Timestamp)
                and isinstance(current_timestamp, pd.Timestamp)
            ):
                same_app_diff = (same_app_stop_timestamp - current_timestamp).total_seconds()
                other_app_diff = (other_app_stop_timestamp - current_timestamp).total_seconds()
                activity_stopped_diff = (
                    (activity_stopped_timestamp - current_timestamp).total_seconds()
                    if activity_stopped_timestamp is not None
                    and isinstance(activity_stopped_timestamp, pd.Timestamp)
                    else float("inf")
                )

                if same_app_diff < other_app_diff:
                    if same_app_diff < long_duration_threshold_seconds:
                        timestamp_to_use = same_app_stop_timestamp
                    elif (
                        activity_stopped_timestamp is not None
                        and isinstance(activity_stopped_timestamp, pd.Timestamp)
                        and activity_stopped_diff < long_duration_threshold_seconds
                    ):
                        timestamp_to_use = activity_stopped_timestamp
                    else:
                        timestamp_to_use = None
                elif same_app_diff > other_app_diff:
                    if other_app_diff < long_duration_threshold_seconds:
                        timestamp_to_use = other_app_stop_timestamp
                    elif (
                        activity_stopped_timestamp is not None
                        and isinstance(activity_stopped_timestamp, pd.Timestamp)
                        and activity_stopped_diff < long_duration_threshold_seconds
                    ):
                        timestamp_to_use = activity_stopped_timestamp
                    else:
                        timestamp_to_use = None
                elif same_app_diff < long_duration_threshold_seconds:
                    timestamp_to_use = same_app_stop_timestamp
                elif (
                    activity_stopped_timestamp is not None
                    and isinstance(activity_stopped_timestamp, pd.Timestamp)
                    and activity_stopped_diff < long_duration_threshold_seconds
                ):
                    timestamp_to_use = activity_stopped_timestamp
                else:
                    timestamp_to_use = None
            elif activity_stopped_timestamp is not None and isinstance(
                activity_stopped_timestamp, pd.Timestamp
            ):
                # OLD algorithm behavior: When only activity_stopped exists, use it
                # Optionally apply threshold check if configured
                if self.options.apply_threshold_to_activity_stopped_fallback:
                    activity_stopped_diff = (
                        activity_stopped_timestamp - current_timestamp
                    ).total_seconds()
                    if activity_stopped_diff < long_duration_threshold_seconds:
                        timestamp_to_use = activity_stopped_timestamp
                else:
                    # Match OLD behavior: use activity_stopped without threshold check
                    timestamp_to_use = activity_stopped_timestamp

            # Apply the determined timestamp or mark as missing
            if timestamp_to_use is not None:
                with warnings.catch_warnings():
                    warnings.simplefilter(action="ignore", category=FutureWarning)
                    df_copy.loc[i, Column.START_TIMESTAMP] = current_timestamp
                    df_copy.loc[i, Column.STOP_TIMESTAMP] = timestamp_to_use

                if isinstance(timestamp_to_use, pd.Timestamp) and isinstance(
                    current_timestamp, pd.Timestamp
                ):
                    time_diff_seconds = (timestamp_to_use - current_timestamp).total_seconds()
                    LOGGER.debug(
                        f"Using timestamp for filtered app {current_app}, time gap: {time_diff_seconds / 60:.2f} minutes"
                    )
            else:
                LOGGER.warning(
                    "Missing end timestamp for filtered app usage, using timestamp of final entry in data."
                )
                with warnings.catch_warnings():
                    warnings.simplefilter(action="ignore", category=FutureWarning)
                    df_copy.loc[i, Column.START_TIMESTAMP] = current_timestamp
                    df_copy.loc[i, Column.INTERACTION_TYPE] = InteractionType.END_OF_USAGE_MISSING

        # Remove paused events and invalid rows
        df_copy = df_copy[
            ~(df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_PAUSED)
        ]
        df_copy = df_copy[
            ~(
                (df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_RESUMED)
                & (df_copy[Column.START_TIMESTAMP].isna() | df_copy[Column.STOP_TIMESTAMP].isna())
            )
        ]

        # Convert interaction type to usage
        df_copy[Column.INTERACTION_TYPE] = df_copy[Column.INTERACTION_TYPE].replace(
            InteractionType.FILTERED_APP_RESUMED, InteractionType.FILTERED_APP_USAGE
        )

        # Convert timestamps to proper timezone
        df_copy = self.timezone_preprocessor.convert_timestamp_columns(
            df_copy, [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
        )

        # Check for disordered timestamps
        TimestampPreprocessor.check_for_disordered_timestamps(
            df_copy, Column.START_TIMESTAMP, Column.STOP_TIMESTAMP
        )

        df_copy = df_copy.reset_index(drop=True)
        LOGGER.debug("Filtered app usage rows processed successfully")
        return df_copy

    def process_valid_app_usage(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process valid app usage rows to determine start, stop timestamps and duration.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe

        Raises:
            pd.errors.EmptyDataError: If there is no valid app usage data
        """
        LOGGER.debug("Processing valid app usage rows")

        df_copy = df.reset_index(drop=True)

        valid_interactions = [
            InteractionType.ACTIVITY_RESUMED,
            InteractionType.ACTIVITY_PAUSED,
        ]
        if not df_copy[Column.INTERACTION_TYPE].isin(valid_interactions).any():
            LOGGER.warning("No valid app usage found")
            msg = "No valid app usage data during the study period"
            raise pd.errors.EmptyDataError(msg)

        # Create masks for different interaction types
        resumed_mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED
        stopped_mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_STOPPED
        same_app_stop_mask = df_copy[Column.INTERACTION_TYPE].isin(
            self.options.same_app_interaction_types_to_stop_usage_at
        )
        other_stop_mask = df_copy[Column.INTERACTION_TYPE].isin(
            self.options.other_interaction_types_to_stop_usage_at
        )

        # Use strategy pattern to process app usage with selected algorithm
        df_copy = self.algorithm.process_app_usage(
            df_copy, resumed_mask, same_app_stop_mask, other_stop_mask, stopped_mask
        )

        # Remove paused events and invalid rows
        df_copy = df_copy[~(df_copy[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_PAUSED)]

        df_copy = df_copy[
            ~(
                (df_copy[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED)
                & (df_copy[Column.START_TIMESTAMP].isna() | df_copy[Column.STOP_TIMESTAMP].isna())
            )
        ]

        # Convert interaction type to usage
        df_copy[Column.INTERACTION_TYPE] = df_copy[Column.INTERACTION_TYPE].replace(
            InteractionType.ACTIVITY_RESUMED, InteractionType.APP_USAGE
        )

        # Convert timestamps to proper timezone
        df_copy = self.timezone_preprocessor.convert_timestamp_columns(
            df_copy, [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
        )

        # Check for disordered timestamps
        TimestampPreprocessor.check_for_disordered_timestamps(
            df_copy, Column.START_TIMESTAMP, Column.STOP_TIMESTAMP
        )

        # Calculate duration for app usage events - OPTIMIZED: vectorized timestamp calculations
        mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE
        if mask.any():
            # Vectorized duration calculation
            start_ts = pd.to_datetime(df_copy.loc[mask, Column.START_TIMESTAMP])
            stop_ts = pd.to_datetime(df_copy.loc[mask, Column.STOP_TIMESTAMP])
            durations = (stop_ts - start_ts).dt.total_seconds()
            df_copy.loc[mask, Column.DURATION_SECONDS] = durations

            # Apply minimum usage duration filter - vectorized
            df_copy.loc[mask, Column.DURATION_SECONDS] = df_copy.loc[
                mask, Column.DURATION_SECONDS
            ].where(
                df_copy.loc[mask, Column.DURATION_SECONDS] >= self.options.minimum_usage_duration,
                None,
            )

        df_copy[Column.DURATION_MINUTES] = df_copy[Column.DURATION_SECONDS] / 60

        # Filter out zero-duration sessions if configured
        # This handles edge cases where duplicate events at the same millisecond
        # (common on Fire tablets) create spurious 0-duration sessions
        if self.options.filter_zero_duration_sessions:
            zero_duration_mask = (df_copy[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE) & (
                df_copy[Column.DURATION_SECONDS] <= 0
            )
            zero_count = zero_duration_mask.sum()
            if zero_count > 0:
                LOGGER.info(f"Filtering out {zero_count} zero-duration sessions")
                df_copy = df_copy[~zero_duration_mask]

        df_copy = df_copy.reset_index(drop=True)

        LOGGER.debug("Valid app usage rows processed successfully")
        return df_copy

    def add_app_usage_details(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add detailed app usage columns for analysis.

        This method now uses the optimized O(n) algorithm instead of O(n²).

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The dataframe with added usage details
        """
        # Use optimized O(n) version for better performance
        return self.details_processor.add_app_usage_details(df)

    def add_app_usage_details_legacy(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Legacy O(n²) version of add_app_usage_details.
        Kept for reference but should not be used.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The dataframe with added usage details
        """
        LOGGER.debug("Adding app usage detail columns (legacy O(n²) version)")

        df_copy = df.reset_index(drop=True)

        columns_defaults = {
            "valid_app_new_engage_30s": 0,
            f"valid_app_new_engage_custom_{self.options.custom_app_engagement_duration}s": 0,
            "valid_app_switched_app": 0,
            "valid_app_usage_time_gap_hours": 0.0,
            "any_app_new_engage_30s": 0,
            f"any_app_new_engage_custom_{self.options.custom_app_engagement_duration}s": 0,
            "any_app_switched_app": 0,
            "any_app_usage_time_gap_hours": 0.0,
        }

        # Set default values for engagement columns
        for column, default_value in columns_defaults.items():
            if "any_app" in column:
                mask = df_copy[Column.INTERACTION_TYPE].isin(
                    [InteractionType.APP_USAGE, InteractionType.FILTERED_APP_USAGE]
                )
                df_copy.loc[mask, column] = default_value
            else:
                mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE
                df_copy.loc[mask, column] = default_value

        app_usage_row_indices = df_copy[
            df_copy[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE
        ].index

        any_app_usage_row_indices = df_copy[
            df_copy[Column.INTERACTION_TYPE].isin(
                [InteractionType.APP_USAGE, InteractionType.FILTERED_APP_USAGE]
            )
        ].index.to_numpy()

        valid_app_usage_row_indices = df_copy[
            df_copy[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE
        ].index.to_numpy()

        interaction_types = df_copy[Column.INTERACTION_TYPE].to_numpy()

        first_app_set = False
        # Process each row individually to avoid type issues with iterrows
        for i in range(len(df_copy)):
            row = df_copy.iloc[i]
            first_app_set = self._process_row_app_usage_details(
                i,
                row,
                first_app_set,
                df_copy,
                app_usage_row_indices,
                interaction_types,
                any_app_usage_row_indices,
                valid_app_usage_row_indices,
            )

        LOGGER.debug("App usage detail columns added successfully")
        return df_copy

    def _process_row_app_usage_details(
        self,
        idx: int,
        row: pd.Series,
        first_app_set: bool,
        df: pd.DataFrame,
        app_usage_row_indices: pd.Index,
        interaction_types: np.ndarray,
        any_app_usage_row_indices: np.ndarray,
        valid_app_usage_row_indices: np.ndarray,
    ) -> bool:
        """
        Process app usage details for a single row.

        Args:
            idx: The row index
            row: The row data
            first_app_set: Flag indicating if first app has been set
            df: The dataframe being processed
            app_usage_row_indices: Indices of app usage rows
            interaction_types: Array of interaction types
            any_app_usage_row_indices: Numpy array of indices for APP_USAGE and FILTERED_APP_USAGE rows
            valid_app_usage_row_indices: Numpy array of indices for APP_USAGE rows only

        Returns:
            bool: Updated first_app_set flag
        """
        index = idx
        current_interaction_type = row[Column.INTERACTION_TYPE]

        # Only handle ValueError for InteractionType enum conversion
        try:
            # Check if the interaction type string can be converted to enum
            if isinstance(current_interaction_type, str) and current_interaction_type not in [
                InteractionType.APP_USAGE,
                InteractionType.FILTERED_APP_USAGE,
            ]:
                InteractionType(current_interaction_type)
                is_valid_interaction = False
            else:
                is_valid_interaction = current_interaction_type in [
                    InteractionType.APP_USAGE,
                    InteractionType.FILTERED_APP_USAGE,
                ]
        except ValueError:
            # Just log that we found an unknown interaction type
            LOGGER.warning(f"Unknown interaction type: {current_interaction_type}")
            is_valid_interaction = False

        if not first_app_set:
            if is_valid_interaction:
                is_app_usage = current_interaction_type == InteractionType.APP_USAGE
                self._set_first_app_use_engagement_values(
                    df, index, self.options.custom_app_engagement_duration, is_app_usage
                )
                first_app_set = True

        elif index > 0 and is_valid_interaction:
            is_first_valid_app = (
                len(app_usage_row_indices) > 0 and index == app_usage_row_indices[0]
            )
            is_app_usage = current_interaction_type == InteractionType.APP_USAGE

            if is_first_valid_app and is_app_usage:
                self._set_first_app_use_engagement_values(
                    df, index, self.options.custom_app_engagement_duration, True
                )
            else:
                self._traverse_backward_rows(
                    df,
                    index,
                    row,
                    interaction_types,
                    any_app_usage_row_indices,
                    valid_app_usage_row_indices,
                )

        return first_app_set

    def _set_first_app_use_engagement_values(
        self, df: pd.DataFrame, index: int, custom_gap: float, is_app_usage: bool
    ) -> None:
        """
        Set engagement values for the first app usage.

        Args:
            df: The dataframe being processed
            index: The row index
            custom_gap: The custom engagement duration
            is_app_usage: Whether this is a valid app usage
        """
        if not is_app_usage:
            df.loc[index, f"any_app_new_engage_custom_{custom_gap}s"] = 1
            df.loc[index, "any_app_new_engage_30s"] = 1
        if is_app_usage:
            df.loc[index, f"valid_app_new_engage_custom_{custom_gap}s"] = 1
            df.loc[index, "valid_app_new_engage_30s"] = 1

    def _traverse_backward_rows(
        self,
        df: pd.DataFrame,
        index: int,
        row: pd.Series,
        interaction_types: np.ndarray,
        any_app_usage_row_indices: np.ndarray,
        valid_app_usage_row_indices: np.ndarray,
    ) -> None:
        """
        Traverse backward through rows to find previous app usage.
        Optimized to use pre-computed indices instead of scanning all rows.

        Args:
            df: The dataframe being processed
            index: The current row index
            row: The current row data
            interaction_types: Array of interaction types
            any_app_usage_row_indices: Pre-computed indices of APP_USAGE and FILTERED_APP_USAGE rows
            valid_app_usage_row_indices: Pre-computed indices of APP_USAGE rows only
        """
        pos = np.searchsorted(any_app_usage_row_indices, index, side="left")

        if pos == 0:
            return

        for i in range(pos - 1, -1, -1):
            backward_index = any_app_usage_row_indices[i]
            backward_row = df.loc[backward_index]

            # Check if app switched
            if row[Column.APP_PACKAGE_NAME] != backward_row[Column.APP_PACKAGE_NAME]:
                df.loc[index, "any_app_switched_app"] = 1

            # Calculate time since last app use
            start_ts = row[Column.START_TIMESTAMP]
            stop_ts = backward_row[Column.STOP_TIMESTAMP]

            # Skip rows with missing timestamps
            if pd.isna(start_ts) or pd.isna(stop_ts):
                LOGGER.warning(f"Missing timestamp at index {index} or {backward_index}")
                continue

            time_delta = start_ts - stop_ts
            time_since_last_any_app_use = time_delta.total_seconds()

            # Set engagement flags based on time gap
            if time_since_last_any_app_use > 30:
                df.loc[index, "any_app_new_engage_30s"] = 1

            if time_since_last_any_app_use > self.options.custom_app_engagement_duration:
                df.loc[
                    index,
                    f"any_app_new_engage_custom_{self.options.custom_app_engagement_duration}s",
                ] = 1

            # Set time gap in hours
            df.loc[index, "any_app_usage_time_gap_hours"] = time_since_last_any_app_use // 3600

            # If this is a valid app usage, also process valid app metrics
            if row[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE:
                self._traverse_app_usage_backward_rows(
                    df, index, row, interaction_types, valid_app_usage_row_indices
                )

            break

    def _traverse_app_usage_backward_rows(
        self,
        df: pd.DataFrame,
        index: int,
        row: pd.Series,
        interaction_types: np.ndarray,
        valid_app_usage_row_indices: np.ndarray,
    ) -> None:
        """
        Traverse backward to find previous valid app usage.
        Optimized to use pre-computed indices instead of scanning all rows.

        Args:
            df: The dataframe being processed
            index: The current row index
            row: The current row data
            interaction_types: Array of interaction types
            valid_app_usage_row_indices: Pre-computed indices of APP_USAGE rows only
        """
        pos = np.searchsorted(valid_app_usage_row_indices, index, side="left")

        if pos == 0:
            return

        for i in range(pos - 1, -1, -1):
            backward_index = valid_app_usage_row_indices[i]
            backward_row = df.loc[backward_index]

            # Check if app switched
            if row[Column.APP_PACKAGE_NAME] != backward_row[Column.APP_PACKAGE_NAME]:
                df.loc[index, "valid_app_switched_app"] = 1

            # Calculate time since last valid app use
            start_ts = row[Column.START_TIMESTAMP]
            stop_ts = backward_row[Column.STOP_TIMESTAMP]

            # Skip if timestamps are missing
            if pd.isna(start_ts) or pd.isna(stop_ts):
                LOGGER.warning(
                    f"Missing timestamp for valid app usage at index {index} or {backward_index}"
                )
                continue

            time_delta = start_ts - stop_ts
            time_since_last_valid_app_use = time_delta.total_seconds()

            # Set engagement flags based on time gap
            if time_since_last_valid_app_use > 30:
                df.loc[index, "valid_app_new_engage_30s"] = 1

            if time_since_last_valid_app_use > self.options.custom_app_engagement_duration:
                df.loc[
                    index,
                    f"valid_app_new_engage_custom_{self.options.custom_app_engagement_duration}s",
                ] = 1

            # Set time gap in hours
            df.loc[index, "valid_app_usage_time_gap_hours"] = time_since_last_valid_app_use // 3600

            break

    def add_app_usage_flags(self, df: pd.DataFrame) -> None:
        """
        Add app usage flags based on time gaps and duration.

        Args:
            df: The dataframe to modify with app usage flags
        """
        LOGGER.debug(
            f"Marking app usage with duration thresholds: {self.options.long_usage_duration_thresholds} hours"
        )
        LOGGER.debug(
            f"Marking app usage with time gap thresholds: {self.options.long_data_time_gap_thresholds} hours"
        )

        thresholds_to_use = self.options.long_data_time_gap_thresholds
        duration_thresholds_to_use = self.options.long_usage_duration_thresholds

        if not thresholds_to_use:
            thresholds_to_use = [3, 6, 12, 24]

        if not duration_thresholds_to_use:
            duration_thresholds_to_use = [3, 6, 12, 24]

        df[Column.ANY_APP_USAGE_FLAGS] = self._get_app_usage_flags(
            df[Column.DATA_TIME_GAP_HOURS],
            df[Column.DURATION_MINUTES],
            thresholds_to_use,
            duration_thresholds_to_use,
        )

    def _get_app_usage_flags(
        self,
        time_gaps: pd.Series,
        durations_minutes: pd.Series,
        time_gap_thresholds: list[int] | list[float],
        duration_thresholds: list[int] | list[float],
    ) -> pd.Series:
        """
        Generate app usage flags for each row based on time gaps and durations.

        Args:
            time_gaps: Series of time gaps in hours
            durations_minutes: Series of durations in minutes
            time_gap_thresholds: List of thresholds for time gaps (in hours)
            duration_thresholds: List of thresholds for durations (in hours)

        Returns:
            Series of lists containing applicable flags for each row
        """
        # Sort thresholds once (descending order)
        sorted_time_gap_thresholds = sorted(time_gap_thresholds, reverse=True)
        sorted_duration_thresholds = sorted(duration_thresholds, reverse=True)

        # Convert durations from minutes to hours
        durations_hours = durations_minutes / 60

        # Initialize empty lists for all rows
        all_flags = [[] for _ in range(len(time_gaps))]

        # Add time gap flags
        for i, time_gap in enumerate(time_gaps):
            for threshold in sorted_time_gap_thresholds:
                if time_gap >= threshold:
                    all_flags[i].append(f">{threshold}-HR TIME GAP")
                    break

        # Add duration flags
        for i, duration in enumerate(durations_hours):
            for threshold in sorted_duration_thresholds:
                if duration >= threshold:
                    all_flags[i].append(f">{threshold}-HR APP USAGE")
                    break

        return pd.Series(all_flags, index=time_gaps.index)

