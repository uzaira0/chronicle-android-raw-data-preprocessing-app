"""
Preprocessor for app usage operations in Chronicle data.

Supports Polars for high-performance operations when enabled.
Set CHRONICLE_USE_POLARS=true to enable.
"""

from __future__ import annotations

import logging
import os

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
from chronicle_preprocessing_app.config.defaults import (
    DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS,
    DEFAULT_LONG_USAGE_DURATION_THRESHOLDS,
)

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_algorithms import (
    OptimizedAppUsageAlgorithm,
)
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

        # Initialize the single supported app usage pairing algorithm.
        self.algorithm = OptimizedAppUsageAlgorithm(options)
        LOGGER.debug("Using optimized app usage algorithm")

        # Initialize optimized details processor
        self.details_processor = OptimizedAppUsageDetailsProcessor(options)
        LOGGER.debug("Using O(n) optimized app usage details processor")

    def preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Run the canonical app usage event algorithm.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        return self.run_app_usage_algorithm(df, raise_on_no_valid_usage=True)

    def process_app_usage(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Backward-compatible wrapper for the canonical app usage event algorithm.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        return self.run_app_usage_algorithm(df, raise_on_no_valid_usage=False)

    def run_app_usage_algorithm(
        self, df: pd.DataFrame, *, raise_on_no_valid_usage: bool = True
    ) -> pd.DataFrame:
        """
        Run the single supported app usage event algorithm.

        This method is the canonical integration point for converting raw
        interaction rows into filtered-app and valid-app usage events. Other
        public entry points delegate here so the preprocessing pipeline uses one
        orchestration path over the optimized app usage algorithm implementation.

        Args:
            df: The dataframe to process
            raise_on_no_valid_usage: Whether to propagate EmptyDataError when
                no valid app usage rows are present

        Returns:
            pd.DataFrame: The processed dataframe
        """
        if self.options.use_filter_file:
            df = self.process_filtered_app_usage(df)

        try:
            df = self.process_valid_app_usage(df)
        except pd.errors.EmptyDataError as e:
            if raise_on_no_valid_usage:
                raise
            LOGGER.warning(f"No valid app usage data: {e}")

        return df

    def process_filtered_app_usage(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process filtered app usage rows to determine start and stop timestamps.

        Filtered rows build filtered-specific masks, then delegate pairing to
        OptimizedAppUsageAlgorithm so valid and filtered usage share one
        stop-event matching implementation.

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

        resumed_mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_RESUMED
        same_app_stop_mask = df_copy[Column.INTERACTION_TYPE].isin(
            self.options.filtered_same_app_interaction_types_to_stop_usage_at
        )
        other_stop_mask = df_copy[Column.INTERACTION_TYPE].isin(
            self.options.filtered_other_interaction_types_to_stop_usage_at
        )
        stopped_mask = df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_STOPPED

        df_copy = self.algorithm.process_app_usage(
            df_copy, resumed_mask, same_app_stop_mask, other_stop_mask, stopped_mask
        )

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
        if Column.DURATION_SECONDS not in df_copy.columns:
            df_copy[Column.DURATION_SECONDS] = np.nan
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
            thresholds_to_use = list(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS)

        if not duration_thresholds_to_use:
            duration_thresholds_to_use = list(DEFAULT_LONG_USAGE_DURATION_THRESHOLDS)

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
        sorted_time_gap_thresholds = sorted(time_gap_thresholds, reverse=True)
        sorted_duration_thresholds = sorted(duration_thresholds, reverse=True)
        time_gap_values = time_gaps.to_numpy(dtype=float, copy=False, na_value=np.nan)
        duration_values = (
            durations_minutes.to_numpy(dtype=float, copy=False, na_value=np.nan) / 60
        )
        time_gap_flags = np.full(len(time_gap_values), None, dtype=object)
        duration_flags = np.full(len(duration_values), None, dtype=object)

        for threshold in sorted_time_gap_thresholds:
            unflagged = time_gap_flags == None  # noqa: E711
            time_gap_flags[
                unflagged & np.isfinite(time_gap_values) & (time_gap_values >= threshold)
            ] = f">{threshold}-HR TIME GAP"

        for threshold in sorted_duration_thresholds:
            unflagged = duration_flags == None  # noqa: E711
            duration_flags[
                unflagged & np.isfinite(duration_values) & (duration_values >= threshold)
            ] = f">{threshold}-HR APP USAGE"

        all_flags = [
            [flag for flag in (time_gap_flag, duration_flag) if flag is not None]
            for time_gap_flag, duration_flag in zip(time_gap_flags, duration_flags, strict=True)
        ]

        return pd.Series(all_flags, index=time_gaps.index)
