"""
Preprocessor for timestamp-related operations in Chronicle data.
"""

from __future__ import annotations

import logging

import pandas as pd

from config.constants import (
    EXPECTED_TIMESTAMP_LENGTH,
    Column,
    ErrorMessage,
    InteractionType,
    TimestampFormat,
)
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from preprocessors.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class TimestampPreprocessor(BasePreprocessor):
    """
    Preprocessor for handling timestamp-related operations.

    This preprocessor is responsible for correcting timestamp formats,
    handling duplicate timestamps, and formatting timestamps for output.
    """

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
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
                if len(timestamp) >= 6
                and (timestamp[-6] == "+" or timestamp[-6] == "-")
                else ""
            )
            timestamp = (
                timestamp[:-6] + ".000" + timezone_part
                if timezone_part
                else timestamp + ".000"
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
        df_copy = df.copy()
        df_copy[column_name] = df_copy[column_name].apply(
            TimestampPreprocessor.fix_timestamp_format
        )
        return df_copy

    def unalign_duplicate_timestamps(
        self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP
    ) -> pd.DataFrame:
        """
        Adjusts duplicate timestamps by adding nanoseconds to ensure uniqueness.
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
        df_copy = df.copy().reset_index(drop=True)

        stop_usage_types = (
            self.options.same_app_interaction_types_to_stop_usage_at
            | self.options.other_interaction_types_to_stop_usage_at
        )

        def get_event_priority(event_type: InteractionType) -> int:
            if event_type == InteractionType.ACTIVITY_RESUMED:
                return 0
            elif event_type in stop_usage_types:
                return 2
            else:
                return 1

        duplicate_indices_groups_list = (
            df_copy[df_copy.duplicated(subset=[timestamp_column], keep=False)]
            .groupby(timestamp_column)
            .apply(lambda x: list(x.index), include_groups=False)
            .reset_index(drop=True)
            .to_numpy()
            .tolist()
        )

        for group in duplicate_indices_groups_list:
            participant_id = (
                df_copy[Column.PARTICIPANT_ID].iloc[0]
                if Column.PARTICIPANT_ID in df_copy.columns
                else "Unknown"
            )
            LOGGER.debug(
                f"{participant_id}: duplicates found for {timestamp_column} {df_copy.loc[group[0], timestamp_column]}."
            )

            def get_priority_for_index(idx: int) -> int:
                interaction_type_str = str(df_copy.loc[idx, Column.INTERACTION_TYPE])
                if interaction_type_str == "Screen Non-interactive":
                    interaction_type_str = "Screen Non-Interactive"

                try:
                    return get_event_priority(InteractionType(interaction_type_str))
                except ValueError:
                    LOGGER.warning(
                        f"Unknown interaction type in timestamp sorting: {interaction_type_str} - assigning lowest priority"
                    )
                    return 3

            try:
                sorted_indices = sorted(group, key=get_priority_for_index)

                for i, idx in enumerate(sorted_indices):
                    timestamp_str = str(df_copy.loc[idx, timestamp_column])
                    current_timestamp = pd.to_datetime(timestamp_str)
                    df_copy.loc[idx, timestamp_column] = (
                        current_timestamp - pd.Timedelta(i + 1, unit="nanoseconds")
                    )
            except Exception as e:
                # Log error but let it propagate up the call stack
                LOGGER.error(f"Error during timestamp sorting: {e}")
                raise

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
            LOGGER.error(
                f"Found {len(disordered_timestamps.index)} disordered timestamps"
            )
            print(disordered_timestamps[[start_column, stop_column]])
            msg = ErrorMessage.DISORDERED_TIMESTAMPS.format(
                len(disordered_timestamps.index)
            )
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
        df_copy = df.copy().reset_index(drop=True)

        # Convert TimestampFormat enum to string if needed
        if isinstance(format_string, TimestampFormat):
            format_string = format_string.value

        for column in timestamp_columns:
            if column in df_copy.columns and not df_copy[column].isna().all():
                df_copy[column] = df_copy[column].dt.strftime(format_string)

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
        df_copy = df.copy()
        df_copy[gap_column] = 0.0  # Explicitly make this a float

        # Use vectorized operations for better performance
        if len(df_copy) > 1:
            # Calculate time differences
            time_diffs = df_copy[timestamp_column].diff().dt.total_seconds() / 3600.0
            # Apply the rounding rule: round to 1 decimal place
            time_diffs_rounded = time_diffs.apply(lambda x: round(x, 2))
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
