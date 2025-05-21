"""
Preprocessor for timezone-related operations in Chronicle data.
"""

from __future__ import annotations

import datetime
import logging
from datetime import datetime as datetime_class
from datetime import tzinfo
from pathlib import Path

import pandas as pd

from config.constants import Column, ErrorMessage, TimezoneHandlingOption
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from preprocessors.base_preprocessor import BasePreprocessor
from preprocessors.timestamp_preprocessor import TimestampPreprocessor

LOGGER = logging.getLogger(__name__)


class TimezonePreprocessor(BasePreprocessor):
    """
    Preprocessor for handling timezone-related operations.

    This preprocessor is responsible for applying timezone handling options,
    discovering available timezones in data files, and converting timestamps
    between timezones.
    """

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
        """
        Initialize the timezone preprocessor.

        Args:
            options: The preprocessing options
        """
        super().__init__(options)
        self.local_timezone = self.get_local_timezone()
        self.current_data_primary_timezone = None

    def preprocess(self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP) -> pd.DataFrame:
        """
        Preprocess timezone information in the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        return self.apply_timezone_handling(df, timestamp_column)

    @staticmethod
    def get_local_timezone() -> str:
        """
        Retrieves the local timezone of the system as a UTC offset.

        Returns:
            str: The local timezone as a UTC offset string (e.g., 'UTC-06:00').
        """
        local_now = datetime_class.now(datetime.timezone.utc).astimezone()

        offset = local_now.strftime("%z")

        return f"UTC{offset[:3]}:{offset[3:]}"

    @staticmethod
    def find_all_timezones_in_folder_files(folder: str | Path, file_pattern: str) -> list[str]:
        """
        Scan all files in a folder to discover available timezones.

        Args:
            folder (str | Path): The folder containing raw data files.
            file_pattern (str): The pattern to match raw data files.

        Returns:
            list[str]: A list of found timezone strings.
        """
        from utils.file_utils import get_matching_files_from_folder

        LOGGER.debug(f"Discovering timezones from folder: {folder}")
        timezones = set()

        matching_files = get_matching_files_from_folder(folder, file_pattern, ignore_names=["Survey", "Archive", "Do Not Use"])
        LOGGER.debug(f"Found {len(matching_files)} files to scan")

        for file in matching_files:
            full_path = Path(folder) / file
            try:
                df = pd.read_csv(full_path)
                if Column.TIMEZONE in df.columns:
                    file_timezones = df[Column.TIMEZONE].dropna().unique()
                    for tz in file_timezones:
                        if tz and tz != "None":
                            timezones.add(str(tz))
                    LOGGER.debug(f"Found timezones in {file}: {file_timezones}")
                else:
                    LOGGER.warning(f"No timezone information found in {file}")
            except Exception as e:
                LOGGER.warning(f"Error finding timezones in {file}: {e}")

        timezones_list = sorted(timezones)
        LOGGER.info(f"Found {len(timezones_list)} unique timezones: {timezones_list}")

        return timezones_list

    def get_timezone_from_string(self, timezone_str: str) -> tzinfo | None:
        """
        Convert a timezone string to a tzinfo object.

        Args:
            timezone_str (str): The timezone string to convert

        Returns:
            tzinfo | None: The tzinfo object for the timezone, or None if not found
        """
        if not timezone_str:
            return None

        try:
            import pytz

            return pytz.timezone(timezone_str)
        except Exception as e:
            LOGGER.warning(f"Error converting timezone string to tzinfo: {e}")
            return None

    def detect_timezones_in_dataframe(self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP) -> list[str]:
        """
        Detect all timezones present in a dataframe's timestamp column.

        Args:
            df (pd.DataFrame): The dataframe to analyze
            timestamp_column (str): The name of the timestamp column

        Returns:
            list[str]: List of timezone strings found in the dataframe
        """
        LOGGER.debug(f"Detecting timezones in dataframe for column: {timestamp_column}")
        timezones = set()

        # First check if we have a dedicated timezone column
        if Column.TIMEZONE in df.columns:
            for tz in df[Column.TIMEZONE].dropna().unique():
                if tz and tz != "None":
                    timezones.add(str(tz))

        # Also check for timezone info in timestamp column
        if timestamp_column in df.columns:
            timestamps = pd.to_datetime(df[timestamp_column], utc=False, errors="coerce")
            tz_series = timestamps.apply(lambda x: str(x.tz) if hasattr(x, "tz") and x.tz else None)
            for tz in tz_series.dropna().unique():
                if tz and tz != "None":
                    timezones.add(tz)

        return sorted(timezones)

    def determine_primary_timezone(self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP) -> tzinfo | None:
        """
        Determines the primary timezone from the data.

        Args:
            df (pd.DataFrame): The dataframe containing the timestamp column.
            timestamp_column (str): The name of the timestamp column.

        Returns:
            tzinfo | None: The primary timezone detected in the data.
        """
        LOGGER.debug("Determining primary timezone...")
        timezones_series = pd.to_datetime(df[timestamp_column], utc=False).apply(lambda x: x.tz)
        if not timezones_series.empty:
            self.current_data_primary_timezone = timezones_series.mode()[0]
            LOGGER.debug(f"Primary timezone determined: {self.current_data_primary_timezone}")
        else:
            LOGGER.warning("No timezone information found in data")
        return self.current_data_primary_timezone

    def apply_timezone_handling(
        self, df: pd.DataFrame, timestamp_column: str = Column.EVENT_TIMESTAMP, timezone_column: str = Column.TIMEZONE
    ) -> pd.DataFrame:
        """
        Apply timezone handling options to the dataframe.

        Args:
            df: The dataframe to process
            timestamp_column: The name of the timestamp column

        Returns:
            pd.DataFrame: The dataframe with applied timezone handling
        """
        LOGGER.info("Starting timezone handling operations...")
        df_copy = df.copy()
        initial_row_count = len(df_copy)
        LOGGER.debug(f"Initial row count: {initial_row_count}")

        self.determine_primary_timezone(df_copy, timestamp_column)

        LOGGER.info(f"Selected timezone handling option: {self.options.timezone_handling_option}")

        if self.options.timezone_handling_option == TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE:
            if self.options.selected_timezone is None:
                LOGGER.error("No timezone selected")
                msg = ErrorMessage.MISSING_TIMEZONE.format("REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE")
                raise ValueError(msg)

            LOGGER.info(f"Removing all data except those in timezone: {self.options.selected_timezone}")
            mask = (df_copy[timezone_column] == self.options.selected_timezone) & df_copy[timezone_column].notna()
            df_copy = df_copy[mask]
            rows_removed = initial_row_count - len(df_copy)

            LOGGER.warning(f"Removed {rows_removed} rows with non-specified timezones")
            LOGGER.info(f"Converting remaining rows to selected timezone: {self.options.selected_timezone}")

        elif self.options.timezone_handling_option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE:
            if self.options.selected_timezone is None:
                LOGGER.error("No timezone selected")
                msg = ErrorMessage.MISSING_TIMEZONE.format("CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE")
                raise ValueError(msg)

            LOGGER.info(f"Converting all data to selected timezone: {self.options.selected_timezone}")

        else:
            LOGGER.error(f"Invalid timezone option: {self.options.timezone_handling_option}")
            msg = ErrorMessage.INVALID_TIMEZONE_OPTION.format(self.options.timezone_handling_option)
            raise ValueError(msg)

        df_copy = self._convert_to_timezone(df_copy, self.options.selected_timezone, timestamp_column)

        LOGGER.debug("Timezone handling applied successfully")
        return df_copy

    def _convert_to_timezone(self, df: pd.DataFrame, timezone: tzinfo | str, timestamp_column: str = Column.EVENT_TIMESTAMP) -> pd.DataFrame:
        """
        Converts the timestamp in the dataframe to the specified timezone.

        Args:
            df (pd.DataFrame): The dataframe to process.
            timezone (tzinfo | str): The timezone to convert to.
            timestamp_column (str): The name of the timestamp column.

        Returns:
            pd.DataFrame: The processed dataframe with converted timestamp.
        """
        LOGGER.info(f"Converting {timestamp_column} to timezone: {timezone}")
        df_copy = df.copy()
        df_copy[timestamp_column] = pd.to_datetime(df_copy[timestamp_column], utc=True).dt.tz_convert(timezone)
        LOGGER.debug("Timezone conversion completed")
        return df_copy

    def convert_timestamp_columns(self, df: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
        """
        Converts specified timestamp columns in the dataframe based on the selected timezone handling option.

        Args:
            df (pd.DataFrame): The dataframe to process.
            columns (list[str]): The columns to convert.

        Returns:
            pd.DataFrame: The processed dataframe with converted timestamp columns.
        """
        if columns is None:
            columns = [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
        df_copy = df.copy()

        for column in columns:
            if column not in df_copy.columns or df_copy[column].isna().all():
                continue

            if (
                self.options.timezone_handling_option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE
                and self.options.selected_timezone
            ):
                df_copy[column] = pd.to_datetime(df_copy[column], utc=True).dt.tz_convert(self.options.selected_timezone)
            elif self.options.timezone_handling_option == TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE:
                LOGGER.error("No timezone selected")
                msg = "Timezone must be provided"
                raise ValueError(msg)

        return df_copy
