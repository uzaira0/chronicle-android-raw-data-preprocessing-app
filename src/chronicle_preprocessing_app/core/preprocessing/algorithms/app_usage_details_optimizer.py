"""
Optimized app usage details processor using fully vectorized operations.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions

LOGGER = logging.getLogger(__name__)


class OptimizedAppUsageDetailsProcessor:
    """Fully vectorized processor for app usage details."""

    def __init__(self, options: PreprocessingOptions):
        """Initialize with preprocessing options."""
        self.options = options

    def add_app_usage_details(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add detailed app usage columns using fully vectorized operations.

        This version avoids row-by-row iteration entirely by using:
        - Vectorized mask operations
        - shift() for comparing with previous rows
        - Bulk column assignments

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The dataframe with added usage details
        """
        LOGGER.debug("Adding app usage detail columns (fully vectorized version)")

        df_copy = df.reset_index(drop=True)
        custom_duration = self.options.custom_app_engagement_duration

        # Column names
        col_valid_engage_30s = "valid_app_new_engage_30s"
        col_valid_engage_custom = f"valid_app_new_engage_custom_{custom_duration}s"
        col_valid_switched = "valid_app_switched_app"
        col_valid_gap = "valid_app_usage_time_gap_hours"
        col_any_engage_30s = "any_app_new_engage_30s"
        col_any_engage_custom = f"any_app_new_engage_custom_{custom_duration}s"
        col_any_switched = "any_app_switched_app"
        col_any_gap = "any_app_usage_time_gap_hours"

        # Create masks for app usage types
        is_app_usage = df_copy[Column.INTERACTION_TYPE] == InteractionType.APP_USAGE
        is_filtered_usage = df_copy[Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_USAGE
        is_any_usage = is_app_usage | is_filtered_usage

        # Initialize all columns with zeros (default values)
        df_copy[col_valid_engage_30s] = 0
        df_copy[col_valid_engage_custom] = 0
        df_copy[col_valid_switched] = 0
        df_copy[col_valid_gap] = 0.0
        df_copy[col_any_engage_30s] = 0
        df_copy[col_any_engage_custom] = 0
        df_copy[col_any_switched] = 0
        df_copy[col_any_gap] = 0.0

        if not is_any_usage.any():
            LOGGER.debug("No app usage rows found, skipping details processing")
            return df_copy

        # Extract arrays for vectorized operations
        start_timestamps = df_copy[Column.START_TIMESTAMP].values
        stop_timestamps = df_copy[Column.STOP_TIMESTAMP].values
        app_packages = df_copy[Column.APP_PACKAGE_NAME].values

        # Get indices of usage rows
        any_usage_indices = np.where(is_any_usage.values)[0]
        valid_usage_indices = np.where(is_app_usage.values)[0]

        # ===== Process "any_app" metrics (APP_USAGE + FILTERED_APP_USAGE) =====
        if len(any_usage_indices) > 0:
            # First usage always gets engagement flags
            first_any_idx = any_usage_indices[0]
            df_copy.loc[first_any_idx, col_any_engage_30s] = 1
            df_copy.loc[first_any_idx, col_any_engage_custom] = 1

            if len(any_usage_indices) > 1:
                # Create arrays of current and previous values for usage rows only
                current_indices = any_usage_indices[1:]  # Skip first
                prev_indices = any_usage_indices[:-1]  # All but last

                # Get timestamps and packages for current and previous
                current_starts = pd.to_datetime(start_timestamps[current_indices])
                prev_stops = pd.to_datetime(stop_timestamps[prev_indices])
                current_apps = app_packages[current_indices]
                prev_apps = app_packages[prev_indices]

                # Calculate time gaps in seconds (vectorized)
                time_gaps_seconds = (current_starts - prev_stops).total_seconds()

                # Calculate switched app (vectorized)
                switched = current_apps != prev_apps

                # Set values using boolean indexing
                df_copy.loc[current_indices[switched], col_any_switched] = 1
                df_copy.loc[current_indices[time_gaps_seconds > 30], col_any_engage_30s] = 1
                df_copy.loc[
                    current_indices[time_gaps_seconds > custom_duration], col_any_engage_custom
                ] = 1
                df_copy.loc[current_indices, col_any_gap] = time_gaps_seconds / 3600

        # ===== Process "valid_app" metrics (APP_USAGE only) =====
        if len(valid_usage_indices) > 0:
            # First valid usage always gets engagement flags
            first_valid_idx = valid_usage_indices[0]
            df_copy.loc[first_valid_idx, col_valid_engage_30s] = 1
            df_copy.loc[first_valid_idx, col_valid_engage_custom] = 1

            if len(valid_usage_indices) > 1:
                # Create arrays of current and previous values for valid usage rows only
                current_indices = valid_usage_indices[1:]  # Skip first
                prev_indices = valid_usage_indices[:-1]  # All but last

                # Get timestamps and packages for current and previous
                current_starts = pd.to_datetime(start_timestamps[current_indices])
                prev_stops = pd.to_datetime(stop_timestamps[prev_indices])
                current_apps = app_packages[current_indices]
                prev_apps = app_packages[prev_indices]

                # Calculate time gaps in seconds (vectorized)
                time_gaps_seconds = (current_starts - prev_stops).total_seconds()

                # Calculate switched app (vectorized)
                switched = current_apps != prev_apps

                # Set values using boolean indexing
                df_copy.loc[current_indices[switched], col_valid_switched] = 1
                df_copy.loc[current_indices[time_gaps_seconds > 30], col_valid_engage_30s] = 1
                df_copy.loc[
                    current_indices[time_gaps_seconds > custom_duration], col_valid_engage_custom
                ] = 1
                df_copy.loc[current_indices, col_valid_gap] = time_gaps_seconds / 3600

        LOGGER.debug("App usage detail columns added successfully (vectorized)")
        return df_copy


def create_optimized_processor(options: PreprocessingOptions):
    """Factory function to create an optimized processor."""
    return OptimizedAppUsageDetailsProcessor(options)

