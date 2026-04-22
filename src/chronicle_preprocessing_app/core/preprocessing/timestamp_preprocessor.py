"""
Preprocessor for timestamp-related operations in Chronicle data.

Supports Polars for high-performance timestamp parsing (11.8x faster).
Set CHRONICLE_USE_POLARS=true to enable.
"""

from __future__ import annotations

import logging
import os
import time

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

try:
    from chronicle_preprocessing_app.config.constants import (
        EXPECTED_TIMESTAMP_LENGTH,
        Column,
        ErrorMessage,
        InteractionType,
        TimestampFormat,
    )
except ImportError:
    from ...config.constants import (
        EXPECTED_TIMESTAMP_LENGTH,
        Column,
        ErrorMessage,
        InteractionType,
        TimestampFormat,
    )

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class TimestampPreprocessor(BasePreprocessor):
    """
    Preprocessor for handling timestamp-related operations.

    This preprocessor is responsible for correcting timestamp formats,
    handling duplicate timestamps, and formatting timestamps for output.
    """

    def __init__(self, options: PreprocessingOptions) -> None:
        """
        Initialize the timestamp preprocessor.

        Args:
            options: The preprocessing options
        """
        super().__init__(options)

    def preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process timestamps in the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        return self.correct_timestamps(df)

    @staticmethod
    def fix_timestamp_format(timestamp: str) -> str | None:
        """
        Fixes the format of the timestamp by adding milliseconds if missing.

        Args:
            timestamp (str): The timestamp to be fixed.

        Returns:
            str | None: The fixed timestamp string or None if the format is incorrect.

        Raises:
            ValueError: If the timestamp format is incorrect and cannot be fixed.
        """
        if timestamp is None or pd.isna(timestamp):
            return None

        # Handle ISO format timestamps with Z
        if "Z" in timestamp:
            timestamp = timestamp.replace("Z", "+00:00")

        # Add milliseconds if missing
        if "." not in timestamp:
            timezone_part = (
                timestamp[-6:]
                if len(timestamp) >= 6 and (timestamp[-6] == "+" or timestamp[-6] == "-")
                else ""
            )
            timestamp = (
                timestamp[:-6] + ".000" + timezone_part if timezone_part else timestamp + ".000"
            )

        # Finally do the length check after making basic fixes
        if len(timestamp) < EXPECTED_TIMESTAMP_LENGTH:  # Minimum valid length
            LOGGER.error(ErrorMessage.INVALID_TIMESTAMP_FORMAT.format(timestamp))
            msg = ErrorMessage.INVALID_TIMESTAMP_FORMAT.format(timestamp)
            raise ValueError(msg)

        return timestamp

    def correct_timestamps(
        self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP
    ) -> pd.DataFrame:
        """
        Correct the format of timestamps and handle duplicates if needed.

        Args:
            df: The dataframe to process
            timestamp_column: The name of the timestamp column

        Returns:
            pd.DataFrame: The dataframe with corrected timestamps
        """
        LOGGER.debug(f"Correcting timestamps in {timestamp_column}")

        df = self.correct_timestamp_column(df, timestamp_column)

        if self.options.correct_duplicate_event_timestamps:
            df = self.unalign_duplicate_timestamps(df, timestamp_column)

        df = self.mark_data_time_gaps(df, timestamp_column, Column.DATA_TIME_GAP_HOURS)

        LOGGER.debug("Timestamps corrected successfully")
        return df

    def correct_timestamp_column(
        self, df: pd.DataFrame, column_name: str = Column.EVENT_TIMESTAMP
    ) -> pd.DataFrame:
        """
        Corrects the format of a timestamp column.

        Args:
            df (pd.DataFrame): The dataframe containing the timestamp column.
            column_name (str): The name of the timestamp column to correct.

        Returns:
            pd.DataFrame: The dataframe with the corrected timestamp column.
        """
        LOGGER.debug(f"Correcting timestamp column: {column_name}")

        # Use Polars for high-performance timestamp parsing (11.8x faster)
        if USE_POLARS:
            return self._correct_timestamp_column_polars(df, column_name)

        return self._correct_timestamp_column_pandas(df, column_name)

    def _correct_timestamp_column_polars(self, df: pd.DataFrame, column_name: str) -> pd.DataFrame:
        """
        Polars-accelerated timestamp parsing (11.8x faster than Pandas).

        Args:
            df: The pandas DataFrame
            column_name: The timestamp column name

        Returns:
            pd.DataFrame with parsed timestamps
        """
        _start = time.perf_counter()
        LOGGER.debug("Using Polars for timestamp parsing")

        # Convert to Polars
        pl_df = pl.from_pandas(df)
        original_col = f"{column_name}_original"

        # Store original values
        pl_df = pl_df.with_columns(pl.col(column_name).alias(original_col))

        # Parse timestamps with Polars (much faster than Pandas)
        pl_df = pl_df.with_columns(
            pl.col(column_name)
            .str.to_datetime(
                format=None,  # Auto-detect format
                time_zone="UTC",
                strict=False,  # Allow nulls for invalid timestamps
            )
            .alias(column_name)
        )

        # Check for null values (unparseable timestamps)
        null_count = pl_df.filter(pl.col(column_name).is_null()).height
        if null_count > 0:
            invalid_originals = (
                pl_df.filter(pl.col(column_name).is_null())
                .select(original_col)
                .unique()
                .head(10)
                .to_series()
                .to_list()
            )
            LOGGER.warning(
                f"Found {null_count} unparseable timestamps in column {column_name}. "
                f"Original values: {invalid_originals}"
            )

            # Create invalid column
            invalid_column_name = f"{column_name}_invalid_original"
            pl_df = pl_df.with_columns(
                pl.when(pl.col(column_name).is_null())
                .then(pl.col(original_col))
                .otherwise(pl.lit(None))
                .alias(invalid_column_name)
            )
            LOGGER.info(f"Original invalid timestamps preserved in column: {invalid_column_name}")

        # Drop the temporary original column
        pl_df = pl_df.drop(original_col)

        # Convert back to Pandas
        result = pl_df.to_pandas()

        LOGGER.debug(f"Polars timestamp parsing completed in {time.perf_counter() - _start:.3f}s")
        return result

    def _correct_timestamp_column_pandas(self, df: pd.DataFrame, column_name: str) -> pd.DataFrame:
        """
        Original Pandas timestamp parsing (fallback).

        Args:
            df: The pandas DataFrame
            column_name: The timestamp column name

        Returns:
            pd.DataFrame with parsed timestamps
        """
        # Use utc=True to handle mixed timezone offsets (e.g., -06:00 and -05:00 in same file)
        # This converts all timestamps to UTC immediately as proper datetime64 objects
        # They will be converted to the selected timezone in timezone_preprocessor

        # Save original values for debugging/reporting invalid timestamps
        original_timestamps = df[column_name].copy()

        # Try mixed format first (handles various formats)
        try:
            df[column_name] = pd.to_datetime(
                df[column_name], errors="coerce", utc=True, format="mixed"
            )
            LOGGER.debug("Successfully parsed timestamps using mixed format")
        except (ValueError, TypeError):
            # Fall back to ISO8601 if mixed fails
            LOGGER.debug("Mixed format failed, falling back to ISO8601")
            df[column_name] = pd.to_datetime(
                df[column_name], errors="coerce", utc=True, format="ISO8601"
            )

        # Check for NaT values and preserve original values in a separate column
        nat_mask = df[column_name].isna()
        if nat_mask.any():
            nat_count = nat_mask.sum()
            invalid_original = original_timestamps[nat_mask].unique()
            LOGGER.warning(
                f"Found {nat_count} unparseable timestamps in column {column_name}. "
                f"Original values: {invalid_original[:10].tolist()}"
            )
            # Create a column to store the original invalid timestamp values
            invalid_column_name = f"{column_name}_invalid_original"
            df[invalid_column_name] = None  # Initialize as None
            df.loc[nat_mask, invalid_column_name] = original_timestamps[nat_mask]
            LOGGER.info(f"Original invalid timestamps preserved in column: {invalid_column_name}")

        return df

    def unalign_duplicate_timestamps(
        self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP
    ) -> pd.DataFrame:
        """
        Adjusts duplicate timestamps by adding nanoseconds to ensure uniqueness.

        First removes exact duplicates (same timestamp, interaction_type, and app_package_name),
        then separates remaining duplicates by nanoseconds.

        Events are sorted in this order:
        1. Activity Resumed
        2. Other
        3. All interaction types to stop usage that were selected in options
        4. Unknown interaction types (not in the InteractionType enum)

        Args:
            df (pd.DataFrame): The dataframe containing the timestamp column.
            timestamp_column (str): The name of the timestamp column with potential duplicates.

        Returns:
            pd.DataFrame: The dataframe with unaligned timestamp values.
        """
        LOGGER.debug(f"Unaligning duplicate timestamps in column: {timestamp_column}")
        df_copy = df.reset_index(drop=True)

        # First, remove exact duplicates (same timestamp, interaction_type, and app_package_name)
        # These are truly redundant events that don't add information
        dedup_columns = [timestamp_column, Column.INTERACTION_TYPE, Column.APP_PACKAGE_NAME]
        rows_before = len(df_copy)
        df_copy = df_copy.drop_duplicates(subset=dedup_columns, keep="first").reset_index(drop=True)
        rows_after = len(df_copy)
        if rows_before != rows_after:
            LOGGER.info(
                f"Removed {rows_before - rows_after} exact duplicate events (same timestamp, interaction_type, app)"
            )

        stop_usage_types = (
            self.options.same_app_interaction_types_to_stop_usage_at
            | self.options.other_interaction_types_to_stop_usage_at
        )

        # Pre-compute priority mapping for faster lookups
        priority_map = {InteractionType.ACTIVITY_RESUMED: 0}
        for t in stop_usage_types:
            priority_map[t] = 2

        # Pre-extract arrays for fast access
        interaction_types = df_copy[Column.INTERACTION_TYPE].values
        timestamps = df_copy[timestamp_column].values.copy()  # Copy to modify

        # Find duplicate groups
        duplicate_mask = df_copy.duplicated(subset=[timestamp_column], keep=False)
        if not duplicate_mask.any():
            LOGGER.debug("No duplicate timestamps found")
            return df_copy

        duplicate_indices_groups_list = (
            df_copy[duplicate_mask]
            .groupby(timestamp_column)
            .apply(lambda x: list(x.index), include_groups=False)
            .reset_index(drop=True)
            .to_numpy()
            .tolist()
        )

        # Collect all updates to apply in batch
        indices_to_update = []
        offsets_to_apply = []

        for group in duplicate_indices_groups_list:
            # Get priorities using pre-computed map and array access
            def get_priority_for_index(idx: int) -> int:
                interaction_type_str = str(interaction_types[idx])
                if interaction_type_str == "Screen Non-interactive":
                    interaction_type_str = "Screen Non-Interactive"
                try:
                    it = InteractionType(interaction_type_str)
                    return priority_map.get(it, 1)
                except ValueError:
                    return 3

            try:
                sorted_indices = sorted(group, key=get_priority_for_index)

                # Apply offsets in REVERSE order so that:
                # - First in priority order (Resumed, priority 0) gets largest offset → smallest timestamp → appears first after sort
                # - Last in priority order (Stop types, priority 2) gets smallest offset → largest timestamp → appears last after sort
                num_items = len(sorted_indices)
                for i, idx in enumerate(sorted_indices):
                    indices_to_update.append(idx)
                    offsets_to_apply.append(
                        num_items - i
                    )  # Reversed: first item gets largest offset
            except Exception as e:
                LOGGER.error(f"Error during timestamp sorting: {e}")
                raise

        # Apply all updates in batch using numpy operations
        if indices_to_update:
            indices_arr = np.array(indices_to_update)
            offsets_arr = np.array(offsets_to_apply)

            # Preserve timezone info from original column
            original_tz = df_copy[timestamp_column].dt.tz

            # Get timestamps and subtract microseconds in batch
            # NOTE: We use microseconds (us) instead of nanoseconds (ns) because
            # Polars parses timestamps with microsecond precision (datetime64[us]).
            # Nanosecond offsets would be lost when stored back in the array.
            original_timestamps = pd.to_datetime(timestamps[indices_arr])
            adjusted_timestamps = original_timestamps - pd.to_timedelta(offsets_arr, unit="us")

            # Update the array
            timestamps[indices_arr] = adjusted_timestamps.values

            # Write back to dataframe in one operation
            df_copy[timestamp_column] = timestamps

            # Restore timezone if it was present
            # The numpy array loses timezone info but values are still in UTC
            # So we need to localize to UTC first, then convert to original tz
            if original_tz is not None:
                df_copy[timestamp_column] = (
                    df_copy[timestamp_column].dt.tz_localize("UTC").dt.tz_convert(original_tz)
                )

        df_copy = df_copy.sort_values(timestamp_column).reset_index(drop=True)
        LOGGER.debug("Duplicate timestamps unaligned successfully")
        return df_copy

    @staticmethod
    def check_for_disordered_timestamps(
        df: pd.DataFrame,
        start_column: str = Column.START_TIMESTAMP,
        stop_column: str = Column.STOP_TIMESTAMP,
    ) -> None:
        """
        Checks the dataframe for occurrences where the start timestamp is later than the stop timestamp.

        Args:
            df (pd.DataFrame): The dataframe to check.
            start_column (str): The name of the start timestamp column.
            stop_column (str): The name of the stop timestamp column.

        Raises:
            ValueError: If disordered timestamps are detected.
        """
        LOGGER.debug("Checking data for disordered timestamps")
        disordered_timestamps = df[df[start_column] > df[stop_column]]

        if len(disordered_timestamps.index) > 0:
            LOGGER.error(f"Found {len(disordered_timestamps.index)} disordered timestamps")
            print(disordered_timestamps[[start_column, stop_column]])
            msg = ErrorMessage.DISORDERED_TIMESTAMPS.format(len(disordered_timestamps.index))
            raise ValueError(msg)
        LOGGER.debug("No disordered timestamps found")

    @staticmethod
    def format_timestamps_as_strings(
        df: pd.DataFrame,
        timestamp_columns: list[str] | None = None,
        format_string: str | TimestampFormat = TimestampFormat.DATETIME,
    ) -> pd.DataFrame:
        """
        Converts timestamp columns to formatted strings.

        Args:
            df (pd.DataFrame): The dataframe containing the timestamp columns.
            timestamp_columns (list[str]): The list of timestamp columns to format.
            format_string (str): The format string to use.

        Returns:
            pd.DataFrame: The dataframe with formatted timestamp columns.
        """
        if timestamp_columns is None:
            timestamp_columns = [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
        LOGGER.debug(f"Converting timestamp columns to strings: {timestamp_columns}")
        # OPTIMIZED: combined reset_index operation
        df_copy = df.reset_index(drop=True)

        # Convert TimestampFormat enum to string if needed
        if isinstance(format_string, TimestampFormat):
            format_string = format_string.value

        for column in timestamp_columns:
            if column in df_copy.columns and not df_copy[column].isna().all():
                col_data = df_copy[column]
                # Check if column is datetime type
                if pd.api.types.is_datetime64_any_dtype(col_data):
                    df_copy[column] = col_data.dt.strftime(format_string)
                elif hasattr(col_data.iloc[0], "strftime"):
                    # Handle datetime objects stored as object dtype
                    df_copy[column] = col_data.apply(
                        lambda x: x.strftime(format_string) if pd.notna(x) and hasattr(x, "strftime") else x
                    )
                else:
                    LOGGER.warning(f"Column {column} is not datetime type, skipping strftime conversion")

        LOGGER.debug("Timestamp columns converted to strings successfully")
        return df_copy

    @staticmethod
    def calculate_duration_in_seconds(
        start_timestamp: pd.Timestamp, stop_timestamp: pd.Timestamp
    ) -> float:
        """
        Calculate the duration in seconds between two timestamps.

        Args:
            start_timestamp (pd.Timestamp): The start timestamp
            stop_timestamp (pd.Timestamp): The stop timestamp

        Returns:
            float: The duration in seconds
        """
        return (stop_timestamp - start_timestamp).total_seconds()

    def mark_data_time_gaps(
        self,
        df: pd.DataFrame,
        timestamp_column: str = Column.EVENT_TIMESTAMP,
        gap_column: str = Column.DATA_TIME_GAP_HOURS,
    ) -> pd.DataFrame:
        """
        Marks gaps in the data by calculating the time difference between consecutive events.

        Args:
            df (pd.DataFrame): The dataframe to process.
            timestamp_column (str): The name of the timestamp column.
            gap_column (str): The name of the column to store the time gap values.

        Returns:
            pd.DataFrame: The dataframe with added time gap column.
        """
        LOGGER.debug(f"Marking data time gaps using column: {timestamp_column}")
        # OPTIMIZED: reuse input DataFrame when safe
        df_copy = df
        df_copy[gap_column] = 0.0  # Explicitly make this a float

        # Use vectorized operations for better performance
        if len(df_copy) > 1:
            # Calculate time differences
            time_diffs = df_copy[timestamp_column].diff().dt.total_seconds() / 3600.0
            # Apply the rounding rule: round to 1 decimal place - OPTIMIZED: vectorized
            time_diffs_rounded = time_diffs.round(2)
            # Shift the result to align with the row it applies to
            df_copy[gap_column] = time_diffs_rounded
            # Set the first row to 0
            df_copy.loc[df_copy.index[0], gap_column] = 0.0

        LOGGER.debug("Data time gaps marked successfully")
        return df_copy

    def format_timestamps_for_output(
        self,
        df: pd.DataFrame,
        timestamp_columns: list[str] | None = None,
        format_string: str = TimestampFormat.DATETIME,
    ) -> pd.DataFrame:
        """
        Format timestamp columns as strings for output.

        Args:
            df: The dataframe to process
            timestamp_columns: The timestamp columns to format
            format_string: The format string to use

        Returns:
            pd.DataFrame: The dataframe with formatted timestamps
        """
        if timestamp_columns is None:
            timestamp_columns = [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]

        return self.format_timestamps_as_strings(df, timestamp_columns, format_string)

