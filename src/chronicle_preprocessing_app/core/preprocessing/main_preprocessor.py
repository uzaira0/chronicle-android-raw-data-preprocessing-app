"""
Core preprocessing logic for Chronicle Android Raw Data Preprocessor

This module supports both Pandas and Polars backends. Set CHRONICLE_USE_POLARS=true
to use Polars for I/O operations (5-13x faster for CSV reading/writing).
"""

from __future__ import annotations

import contextlib
import json
import logging
import multiprocessing
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, fields
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from openpyxl.styles import Alignment, PatternFill

from chronicle_preprocessing_app.config.defaults import (
    DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS,
)

# Conditional Polars import for high-performance I/O
try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    pl = None  # type: ignore

# Environment variable to control Polars usage (default: enabled)
USE_POLARS = os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true" and POLARS_AVAILABLE

try:
    from chronicle_preprocessing_app.config.constants import (
        ALL_INTERACTION_TYPES_MAP,
        AMAZON_APPS,
        PLOTTED_FOLDER_SUFFIX,
        PREPROCESSED_FILE_SUFFIX,
        PREPROCESSED_FOLDER_SUFFIX,
        TARGET_CHILD_USERNAME,
        AppCodebookColumn,
        ChronicleDeviceType,
        Column,
        InteractionType,
        TimestampFormat,
    )
except ImportError:
    from ...config.constants import (
        ALL_INTERACTION_TYPES_MAP,
        AMAZON_APPS,
        PLOTTED_FOLDER_SUFFIX,
        PREPROCESSED_FILE_SUFFIX,
        PREPROCESSED_FOLDER_SUFFIX,
        TARGET_CHILD_USERNAME,
        AppCodebookColumn,
        ChronicleDeviceType,
        Column,
        InteractionType,
        TimestampFormat,
    )

from chronicle_preprocessing_app.core.config import PreprocessingOptions, ProcessingStats

from .app_filter_preprocessor import AppFilterPreprocessor
from .app_usage_preprocessor import AppUsagePreprocessor
from .column_preprocessor import ColumnPreprocessor
from .screen_usage_preprocessor import ScreenUsagePreprocessor
from .study_date_provider import StudyDateRangeProvider
from .timestamp_preprocessor import TimestampPreprocessor
from .timezone_preprocessor import TimezonePreprocessor

try:
    from chronicle_preprocessing_app.utils.file_utils import (
        get_matching_files_from_folder,
        read_filter_file,
        read_keep_awake_apps_file,
    )
except ImportError:
    from ...utils.file_utils import (
        get_matching_files_from_folder,
        read_filter_file,
        read_keep_awake_apps_file,
    )

LOGGER = logging.getLogger(__name__)


def _generate_plots(*args: Any, **kwargs: Any) -> Any:
    """Import plotting only when plotting is requested."""
    from chronicle_preprocessing_app.core.plotting.plotting_manager import generate_plots

    return generate_plots(*args, **kwargs)


@dataclass
class CellFormatRule:
    """Rule for formatting Excel cells based on a condition."""

    condition: Callable[[int, str, Any], bool]
    fill_color: str | None = None
    horizontal_alignment: str | None = None
    vertical_alignment: str | None = None

    def apply(self, cell: Any) -> None:
        """Apply the formatting rule to a cell if the condition is met."""
        if self.fill_color:
            cell.fill = PatternFill(
                start_color=self.fill_color,
                end_color=self.fill_color,
                fill_type="solid",
            )

        # Create a new Alignment object with existing values plus our changes
        if self.horizontal_alignment or self.vertical_alignment:
            # Get current alignment properties or default values
            current_horizontal = (
                getattr(cell.alignment, "horizontal", "general") if cell.alignment else "general"
            )
            current_vertical = (
                getattr(cell.alignment, "vertical", "bottom") if cell.alignment else "bottom"
            )

            # Create new alignment with updated properties
            new_alignment = Alignment(
                horizontal=self.horizontal_alignment or current_horizontal,
                vertical=self.vertical_alignment or current_vertical,
                # Preserve other alignment properties if they exist
                wrap_text=getattr(cell.alignment, "wrap_text", False) if cell.alignment else False,
                shrink_to_fit=getattr(cell.alignment, "shrink_to_fit", False)
                if cell.alignment
                else False,
                indent=getattr(cell.alignment, "indent", 0) if cell.alignment else 0,
            )

            cell.alignment = new_alignment


def write_df_to_excel_and_format(
    df: pd.DataFrame,
    save_path: Path | str,
    sheet_name: str,
    *,
    irregular_value_strategy: Callable[[int, str, Any], bool] | None = None,
    additional_format_rules: list[CellFormatRule] | None = None,
    if_sheet_exists: str | None = None,
) -> None:
    """Save a DataFrame to an Excel file with advanced formatting.

    This function writes a pandas DataFrame to an Excel file and applies
    formatting including center alignment, custom column widths, and optional
    highlighting for irregular values according to the provided strategy.

    Args:
        df: The pandas DataFrame to save
        save_path: Path where the Excel file should be saved
        sheet_name: Name of the worksheet to create or replace
        irregular_value_strategy: Optional function that takes (row, column, value)
                                 and returns True for cells to highlight yellow
        additional_format_rules: Optional list of additional formatting rules to apply
    """
    # Convert string path to Path object
    save_path = Path(save_path)

    # Determine file mode
    mode = "a" if save_path.exists() else "w"
    if_sheet_exists = "replace" if mode == "a" else None

    # Create default formatting rules
    format_rules = [
        # Center align all cells
        CellFormatRule(
            condition=lambda row, col, val: True,
            horizontal_alignment="center",
            vertical_alignment="center",
        )
    ]

    # Add irregular value highlighting rule if provided
    if irregular_value_strategy:
        format_rules.append(
            CellFormatRule(
                condition=lambda row, col, val: (
                    col is not None and irregular_value_strategy(row, col, val)
                ),
                fill_color="FFFF00",  # Yellow
            )
        )

    # Add any additional rules
    if additional_format_rules:
        format_rules.extend(additional_format_rules)

    try:
        with pd.ExcelWriter(
            save_path,
            engine="openpyxl",
            mode=mode,
            if_sheet_exists=if_sheet_exists,
        ) as writer:
            # Write DataFrame to Excel
            df.to_excel(writer, sheet_name=sheet_name, index=True)

            # Format the sheet
            sheet = writer.sheets[sheet_name]
            dims = _calculate_and_apply_formatting(sheet, df, format_rules)

            # Apply column widths
            for col, width in dims.items():
                sheet.column_dimensions[col].width = width + 1
    except Exception as e:
        msg = f"Failed to write Excel file: {e}"
        raise OSError(msg) from e


def _calculate_and_apply_formatting(
    sheet: Any,
    df: pd.DataFrame,
    format_rules: list[CellFormatRule],
) -> dict[str, int]:
    """Format an Excel sheet and calculate optimal column widths.

    Args:
        sheet: The openpyxl worksheet to format
        df: The DataFrame that was written to the sheet
        format_rules: List of formatting rules to apply

    Returns:
        Dictionary mapping column letters to optimal widths
    """
    dims: dict[str, int] = {}

    for row in sheet.rows:
        for cell in row:
            column_name = ""
            if cell.column >= 2 and cell.column < (len(df.columns) + 2):
                with contextlib.suppress(IndexError):
                    column_name = str(df.columns[cell.column - 2])

            # Apply formatting rules
            for rule in format_rules:
                if rule.condition(cell.row, column_name, cell.value):
                    rule.apply(cell)

            # Calculate column width
            if cell.value:
                col_letter = cell.column_letter
                dims[col_letter] = max((dims.get(col_letter, 0), len(str(cell.value)) + 4))

    return dims


class ChronicleAndroidRawDataPreprocessor:
    """
    A class to preprocess Chronicle Android raw data.

    Attributes:
        options (PreprocessingOptions): Options for the data preprocessing.
        current_participant_raw_data_df (pd.DataFrame): DataFrame containing the current participant's raw data.
        current_participant_id (str | None): The current participant's ID.
        participant_raw_data_df_target_child_only (pd.DataFrame): DataFrame containing only the target child's data.
        local_timezone (tzinfo): The local timezone.
        current_data_primary_timezone (tzinfo | None): The primary timezone of the current data.
    """

    def __init__(
        self,
        options: PreprocessingOptions,
        progress_callback: Callable[[str, int, int], None] | None = None,
    ) -> None:
        """
        Initialize the ChronicleAndroidRawDataPreprocessor.

        Args:
            options (PreprocessingOptions): The options for preprocessing.
            progress_callback: Optional callback function to report progress (message, current_file, total_files)
        """
        self.options = options
        self.current_participant_raw_data_df = pd.DataFrame()
        self.current_participant_screen_usage_df = pd.DataFrame()
        self.current_participant_id = ""
        self.current_data_primary_timezone = None
        self.progress_callback = progress_callback
        self.stats = ProcessingStats()
        LOGGER.debug("Initializing ChronicleAndroidRawDataPreprocessor")

        if (
            options.use_filter_file
            and options.filter_file
            and isinstance(options.filter_file, (str, Path))
            and len(str(options.filter_file)) > 0
        ):
            try:
                options.apps_to_filter_dict = read_filter_file(options.filter_file)
                LOGGER.info(
                    f"Loaded {len(options.apps_to_filter_dict)} app filters from {options.filter_file}"
                )
            except Exception:
                LOGGER.exception("Error loading filter file")

        if (
            options.use_keep_awake_apps_file
            and options.keep_awake_apps_file
            and isinstance(options.keep_awake_apps_file, (str, Path))
            and len(str(options.keep_awake_apps_file)) > 0
        ):
            try:
                options.keep_awake_apps_dict = read_keep_awake_apps_file(
                    options.keep_awake_apps_file
                )
                LOGGER.info(
                    f"Loaded {len(options.keep_awake_apps_dict)} keep-awake apps from {options.keep_awake_apps_file}"
                )
            except Exception:
                LOGGER.exception("Error loading keep-awake apps file")

        self.timestamp_processor = TimestampPreprocessor(options)
        self.timezone_processor = TimezonePreprocessor(options)
        self.app_usage_processor = AppUsagePreprocessor(options)
        self.app_filter_processor = AppFilterPreprocessor(options)
        self.screen_usage_processor = ScreenUsagePreprocessor(options)
        self.column_processor = ColumnPreprocessor(options)

        # Load and cache app codebook once during initialization
        self.app_codebook = self._load_app_codebook()

        # Optional survey data preprocessor (internal functionality)
        self.survey_data_processor = self._initialize_survey_processor(options)

        # Study date range provider (independent of survey data)
        # Study date range provider (independent of survey data)
        # Can use injected study_date_map from pipeline or fall back to tracking sheets
        study_date_map = getattr(options, "study_date_map", None)
        self.study_date_provider = StudyDateRangeProvider(study_date_map=study_date_map)

    def _load_app_codebook(self) -> pd.DataFrame | None:
        """
        Load and cache the app codebook during initialization.

        Returns:
            DataFrame: Loaded app codebook with duplicates removed, or None if not configured/available
        """
        if not self.options.use_app_codebook or not self.options.app_codebook_path:
            LOGGER.debug("App codebook not configured, skipping load")
            return None

        try:
            from chronicle_preprocessing_app.utils.file_utils import read_app_codebook

            app_codebook = read_app_codebook(self.options.app_codebook_path)
            if app_codebook is not None:
                LOGGER.info(
                    f"Cached app codebook with {len(app_codebook)} entries for reuse across all files"
                )
            return app_codebook

        except Exception as e:
            LOGGER.warning(f"Failed to load app codebook during initialization: {e}")
            return None

    def _initialize_survey_processor(self, options: PreprocessingOptions) -> Any | None:
        """
        Initialize the survey data preprocessor if available and enabled.

        Args:
            options: Preprocessing options

        Returns:
            SurveyDataPreprocessor instance if available and enabled, None otherwise
        """
        # Only initialize if survey data processing is enabled
        if not getattr(options, "use_survey_data", False):
            LOGGER.debug("Survey data processing disabled")
            return None

        try:
            # Check for critical internal modules first
            from chronicle_preprocessing_internal import (
                DeviceSharingStatus,
                ParticipantID,
                TrackingSheet,
                write_df_to_excel_and_format,
            )

            # Import survey preprocessor (internal modules are available)
            from .survey_data_preprocessor import SurveyDataPreprocessor

            LOGGER.info("Survey data preprocessor initialized")
            return SurveyDataPreprocessor(options)
        except ImportError:
            LOGGER.debug("Survey data preprocessor not available (internal modules not found)")
            return None
        except Exception as e:
            LOGGER.warning(f"Failed to initialize survey data preprocessor: {e}")
            return None

    def fix_timestamp_format(self, timestamp: Any) -> str | None:
        """
        Fixes the format of the timestamp by adding milliseconds if missing.

        Args:
            timestamp: The timestamp to be fixed (could be string, None, or other types).

        Returns:
            str | None: The fixed timestamp string or None if the format is incorrect.
        """
        if timestamp is None or pd.isna(timestamp):
            return None

        # Convert to string to ensure compatibility
        timestamp_str = str(timestamp)
        return self.timestamp_processor.fix_timestamp_format(timestamp_str)

    def get_participant_id_from_data(self) -> str:
        """
        Gets the participant ID from the Chronicle raw data .csv file for a participant.

        Returns:
            str: The participant ID.
        """
        participant_id = str(self.current_participant_raw_data_df.iloc[1][Column.PARTICIPANT_ID])
        LOGGER.debug(f"Participant ID retrieved: {participant_id}")
        return participant_id

    def get_possible_device_model(self) -> ChronicleDeviceType:
        """
        Determines whether the Chronicle Android data is from an Amazon Fire tablet or a regular Android device
        based on the apps/services found within the data.

        Returns:
            ChronicleDeviceType: The type of device (AMAZON or ANDROID).
        """
        LOGGER.debug("Determining possible device model")
        AMAZON_APP_PACKAGE_NAMES = list(AMAZON_APPS.keys())
        if any(
            self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME].str.contains(
                "|".join(AMAZON_APP_PACKAGE_NAMES)
            )
        ):
            LOGGER.debug("Possible device model determined: Amazon Fire")
            return ChronicleDeviceType.AMAZON
        LOGGER.debug("Possible device model determined: Android")
        return ChronicleDeviceType.ANDROID

    def rename_interaction_types(self) -> None:
        """
        Renames interaction types in the dataframe based on the conversion dictionary.
        Also handles unknown interaction types by preserving them as is.
        """
        LOGGER.debug("Renaming interaction types")
        self.current_participant_raw_data_df = self.current_participant_raw_data_df.reset_index(
            drop=True
        )

        original_unique = set(
            self.current_participant_raw_data_df[Column.INTERACTION_TYPE].unique()
        )

        self.current_participant_raw_data_df[Column.INTERACTION_TYPE] = (
            self.current_participant_raw_data_df[Column.INTERACTION_TYPE].replace(
                ALL_INTERACTION_TYPES_MAP
            )
        )

        known_values = set(ALL_INTERACTION_TYPES_MAP.values())
        current_unique = set(self.current_participant_raw_data_df[Column.INTERACTION_TYPE].unique())
        unmapped_values = current_unique.difference(known_values).intersection(original_unique)

        if unmapped_values:
            for value in unmapped_values:
                count = self.current_participant_raw_data_df[
                    self.current_participant_raw_data_df[Column.INTERACTION_TYPE] == value
                ].shape[0]
                LOGGER.warning(
                    f"Encountered unknown interaction type: {value} ({count} occurrences). Preserving as is."
                )

        LOGGER.debug("Interaction types renamed successfully")

    def remove_selected_interaction_types(self) -> None:
        """
        Removes selected interaction types from the dataframe,
        except for rows that meet the configured long-gap threshold.
        """
        LOGGER.debug(
            "Removing selected interaction types while preserving thresholded time gap rows"
        )

        time_gap_threshold_hours = min(
            self.options.long_data_time_gap_thresholds,
            default=min(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS),
        )

        # Keep rows that either:
        # 1. Have an interaction type that's not in the removal list, OR
        # 2. Meet the configured threshold for a long data gap
        self.current_participant_raw_data_df = self.current_participant_raw_data_df[
            (
                ~self.current_participant_raw_data_df[Column.INTERACTION_TYPE].isin(
                    self.options.interaction_types_to_remove
                )
            )
            | (
                self.current_participant_raw_data_df[Column.DATA_TIME_GAP_HOURS]
                >= time_gap_threshold_hours
            )
        ]

        self.current_participant_raw_data_df = self.current_participant_raw_data_df.sort_values(
            Column.EVENT_TIMESTAMP
        ).reset_index(drop=True)
        LOGGER.debug(
            "Selected interaction types removed while preserving thresholded time gap rows"
        )

    def unalign_duplicate_event_timestamps(self) -> None:
        """
        Adjusts duplicate event timestamps by adding nanoseconds to ensure uniqueness.
        """
        LOGGER.debug("Unaligning duplicate event timestamps")
        self.current_participant_raw_data_df = (
            self.timestamp_processor.unalign_duplicate_timestamps(
                self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
            )
        )
        LOGGER.debug("Duplicate event timestamps unaligned successfully")

    def apply_timezone_handling_options(self) -> None:
        """
        Applies the selected timezone handling options to the event timestamps.
        """
        LOGGER.info("Applying timezone handling options...")

        # Use the timezone preprocessor to handle the timezone operations
        self.current_participant_raw_data_df = self.timezone_processor.apply_timezone_handling(
            self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
        )

        LOGGER.debug("Timezone handling options applied successfully")

    def correct_event_timestamp_column(self) -> None:
        """
        Corrects the format of the event timestamp column and adjusts for timezone.
        """
        LOGGER.debug("Correcting event timestamp column")

        # Use the TimestampPreprocessor to process the timestamps
        self.current_participant_raw_data_df = self.timestamp_processor.correct_timestamp_column(
            self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
        )

        # Apply timezone handling using the TimezonePreprocessor
        self.current_participant_raw_data_df = self.timezone_processor.apply_timezone_handling(
            self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
        )

        # Handle duplicate timestamps if needed
        if self.options.correct_duplicate_event_timestamps:
            self.current_participant_raw_data_df = (
                self.timestamp_processor.unalign_duplicate_timestamps(
                    self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
                )
            )

        self.current_participant_raw_data_df = self.current_participant_raw_data_df.sort_values(
            Column.EVENT_TIMESTAMP
        ).reset_index(drop=True)
        LOGGER.debug("Event timestamp column corrected successfully")

    def correct_original_columns(self) -> None:
        """
        Corrects the original columns in the dataframe.
        """
        LOGGER.debug("Correcting original columns")

        # Use the ColumnPreprocessor to correct original columns
        self.current_participant_raw_data_df = self.column_processor.correct_username_column(
            self.current_participant_raw_data_df
        )

        self.rename_interaction_types()

        self.correct_event_timestamp_column()

        self.mark_data_time_gaps()

        LOGGER.debug("Original columns corrected successfully")

    def mark_data_time_gaps(self) -> None:
        """
        Marks gaps in the data by calculating the time difference between consecutive events.
        """
        LOGGER.debug("Marking data time gaps")
        self.current_participant_raw_data_df = self.timestamp_processor.mark_data_time_gaps(
            self.current_participant_raw_data_df,
            Column.EVENT_TIMESTAMP,
            Column.DATA_TIME_GAP_HOURS,
        )
        LOGGER.debug("Data time gaps marked successfully")

    def create_additional_columns(self) -> None:
        """
        Creates additional columns in the dataframe for date, day, weekday, hour, quarter, and possible device model.
        """
        LOGGER.debug("Creating additional columns")

        device_model = self.get_possible_device_model()

        self.current_participant_raw_data_df = self.column_processor.create_additional_columns(
            self.current_participant_raw_data_df, device_model
        )

        LOGGER.debug("Additional columns created successfully")

    def label_filtered_apps(self) -> None:
        """
        Filters out apps that are known to not be correctly accounted for by Chronicle, and apps that we have decided against counting as usage such as Settings.
        Currently filters based on the app package name and verifies the app package label.
        Also logs unique unexpected app label matches to a file.
        """
        LOGGER.debug("Labeling filtered apps")

        # Skip this step if use_filter_file is False
        if not self.options.use_filter_file:
            LOGGER.info("Skipping app filtering as use_filter_file is set to False")
            return

        self.current_participant_raw_data_df = self.app_filter_processor.label_filtered_apps(
            self.current_participant_raw_data_df
        )

        LOGGER.debug("Filtered apps labeled successfully")

    def process_filtered_app_usage_rows(self) -> None:
        """
        Processes raw data to determine start and stop
        timestamps for filtered app usage within a study period.
        """
        LOGGER.debug("Processing filtered app usage rows")

        # Skip this step if use_filter_file is False
        if not self.options.use_filter_file:
            LOGGER.info("Skipping filtered app usage processing as use_filter_file is set to False")
            return

        if (
            not self.current_participant_raw_data_df[Column.INTERACTION_TYPE]
            .isin(
                [
                    InteractionType.FILTERED_APP_RESUMED,
                    InteractionType.FILTERED_APP_PAUSED,
                ]
            )
            .any()
        ):
            msg = f"{self.current_participant_id} had no apparent usage for filtered out apps within the study period"
            LOGGER.warning(msg)
            return

        self.current_participant_raw_data_df = self.app_usage_processor.process_filtered_app_usage(
            self.current_participant_raw_data_df
        )

        LOGGER.debug("Filtered app usage rows processed successfully")

    def process_valid_app_usage_rows(self) -> None:
        """
        This function processes valid app usage data by adding columns for start and stop timestamps, date,
        and duration based on interaction types and event timestamps.

        Raises:
            pd.errors.EmptyDataError: If there is no valid app usage data during the study period.
        """
        LOGGER.debug("Processing valid app usage rows")

        try:
            self.current_participant_raw_data_df = self.app_usage_processor.process_valid_app_usage(
                self.current_participant_raw_data_df
            )
            LOGGER.debug("Valid app usage rows processed successfully")
        except pd.errors.EmptyDataError as e:
            msg = f"{self.current_participant_id} had no apparent valid app usage within the study period"
            LOGGER.exception(msg)
            raise pd.errors.EmptyDataError(msg) from e

    def run_app_usage_algorithm(self) -> None:
        """
        Run the single supported app usage event algorithm for the current file.

        This delegates to the canonical orchestration method in AppUsagePreprocessor
        so the file-processing pipeline does not maintain a parallel app-usage
        algorithm path.

        Raises:
            pd.errors.EmptyDataError: If there is no valid app usage data during
                the study period
        """
        LOGGER.debug("Running canonical app usage event algorithm")

        try:
            self.current_participant_raw_data_df = (
                self.app_usage_processor.run_app_usage_algorithm(
                    self.current_participant_raw_data_df,
                    raise_on_no_valid_usage=True,
                )
            )
            LOGGER.debug("Canonical app usage event algorithm completed successfully")
        except pd.errors.EmptyDataError as e:
            msg = (
                f"{self.current_participant_id} had no apparent valid app usage within "
                "the study period"
            )
            LOGGER.exception(msg)
            raise pd.errors.EmptyDataError(msg) from e

    def derive_screen_usage_sessions(self) -> None:
        """Append derived screen usage sessions when configured."""
        if not self.options.process_screen_usage_sessions:
            return

        LOGGER.debug("Deriving screen usage sessions")
        screen_result_df = self.screen_usage_processor.derive_screen_usage_sessions(
            self.current_participant_raw_data_df.copy()
        )
        self.current_participant_screen_usage_df = (
            screen_result_df[
                screen_result_df[Column.INTERACTION_TYPE] == InteractionType.SCREEN_USAGE
            ]
            .copy()
            .reset_index(drop=True)
        )
        if not self.options.process_app_usage_sessions:
            self.current_participant_raw_data_df = self.current_participant_screen_usage_df.copy()
        LOGGER.debug("Screen usage session derivation completed")

    def run_configured_usage_session_algorithms(self) -> None:
        """
        Run the configured usage-session derivation path.

        App usage and screen usage are independent products: app usage derives
        foreground-app sessions, while screen usage derives screen-on sessions.
        The selected mode decides whether to run app only, screen only, or both.
        """
        self.derive_screen_usage_sessions()

        if self.options.process_app_usage_sessions:
            self.run_app_usage_algorithm()
            return

        if self.options.process_screen_usage_sessions:
            has_screen_usage = self.current_participant_raw_data_df[
                Column.INTERACTION_TYPE
            ].eq(InteractionType.SCREEN_USAGE).any()
            if has_screen_usage:
                return

            msg = (
                f"{self.current_participant_id} had no apparent screen usage within "
                "the study period"
            )
            raise pd.errors.EmptyDataError(msg)

    def check_data_for_disordered_timestamps(self) -> None:
        """
        Checks for disordered timestamps in the data.
        """
        LOGGER.debug("Checking for disordered timestamps")

        TimestampPreprocessor.check_for_disordered_timestamps(
            self.current_participant_raw_data_df,
            Column.START_TIMESTAMP,
            Column.STOP_TIMESTAMP,
        )

        LOGGER.debug("Disordered timestamps check completed")

    def enrich_with_app_codebook_data(self) -> None:
        """
        Enriches the current dataframe with app codebook data (broad_app_category and genreId_scraped).
        Uses the cached app codebook loaded during initialization.
        """
        if self.app_codebook is None:
            LOGGER.debug("App codebook not available, using default values")
            self.current_participant_raw_data_df[Column.BROAD_APP_CATEGORY] = "Unknown"
            self.current_participant_raw_data_df[Column.GENRE_ID_SCRAPED] = "Unknown"
            return

        try:
            LOGGER.debug(
                f"Enriching data with cached app codebook containing {len(self.app_codebook)} entries"
            )

            if AppCodebookColumn.BROAD_APP_CATEGORY in self.app_codebook.columns:
                self.current_participant_raw_data_df[Column.BROAD_APP_CATEGORY] = (
                    self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME]
                    .map(self.app_codebook[AppCodebookColumn.BROAD_APP_CATEGORY])
                    .fillna("Unknown")
                )
            else:
                LOGGER.warning(
                    f"Column '{AppCodebookColumn.BROAD_APP_CATEGORY}' not found in app codebook"
                )
                self.current_participant_raw_data_df[Column.BROAD_APP_CATEGORY] = "Unknown"

            if AppCodebookColumn.GENRE_ID in self.app_codebook.columns:
                self.current_participant_raw_data_df[Column.GENRE_ID_SCRAPED] = (
                    self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME]
                    .map(self.app_codebook[AppCodebookColumn.GENRE_ID])
                    .fillna("Unknown")
                )
            else:
                LOGGER.warning(f"Column '{AppCodebookColumn.GENRE_ID}' not found in app codebook")
                self.current_participant_raw_data_df[Column.GENRE_ID_SCRAPED] = "Unknown"

            LOGGER.debug("App codebook enrichment completed")

        except Exception as e:
            LOGGER.exception(f"Error enriching data with app codebook: {e}")
            self.current_participant_raw_data_df[Column.BROAD_APP_CATEGORY] = "Unknown"
            self.current_participant_raw_data_df[Column.GENRE_ID_SCRAPED] = "Unknown"

    def finalize_and_save_preprocessed_data_df(self, raw_data_filename: str) -> Path:
        """
        This function prepares the preprocessed data for saving by:
        1. Creating a save folder if it doesn't exist.
        2. Selecting specific columns to include in the output.
        3. Checking for disordered timestamps.
        4. Converting timestamp columns to simple strings.
        5. Saving the preprocessed data to a CSV file.

        Args:
            raw_data_filename (str): The original filename of the raw data file.

        Returns:
            Path: The path to the folder where the preprocessed data was saved.
        """
        LOGGER.debug("Finalizing and saving preprocessed data")

        preprocessed_data_save_folder = (
            Path(self.options.output_folder)
            / f"{self.options.study_name + ' ' + PREPROCESSED_FOLDER_SUFFIX}"
        )
        preprocessed_data_save_folder.mkdir(parents=True, exist_ok=True)

        output_file_suffix = (
            "Screen Usage " + PREPROCESSED_FILE_SUFFIX
            if (
                self.options.process_screen_usage_sessions
                and not self.options.process_app_usage_sessions
            )
            else PREPROCESSED_FILE_SUFFIX
        )
        save_name = (
            preprocessed_data_save_folder
            / f"{Path(raw_data_filename).stem.replace('Raw ', '') + ' ' + output_file_suffix}"
        )
        LOGGER.debug(f"Save name: {save_name}")

        if self.current_participant_raw_data_df.empty:
            LOGGER.warning("Dataframe is empty, saving empty dataframe")
            if USE_POLARS:
                pl.from_pandas(self.current_participant_raw_data_df).write_csv(save_name)
            else:
                self.current_participant_raw_data_df.to_csv(save_name, index=False)
            return preprocessed_data_save_folder
        else:
            # Make a copy to avoid modifying the original DataFrame
            output_df = self.current_participant_raw_data_df.copy()

            # Define columns we want to include, filtering out any that don't exist
            def get_available_columns(columns_list: list[str]) -> list[str]:
                return [col for col in columns_list if col in output_df.columns]

            # Participant/Study identification
            identification_columns = [
                Column.STUDY_ID,
                Column.PARTICIPANT_ID,
                Column.POSSIBLE_DEVICE_MODEL,
                Column.USERNAME,
            ]

            # Only add survey-related columns if survey processing is available
            if self.survey_data_processor is not None:
                identification_columns.append(Column.DEVICE_SHARING_STATUS)  # Survey data column

            # Timestamp and time-related columns
            timestamp_columns = [
                Column.EVENT_TIMESTAMP,
                Column.DATE,
                Column.TIMEZONE,
            ]

            # App usage core columns
            app_core_columns = [
                Column.APP_PACKAGE_NAME,
                Column.APPLICATION_LABEL,
                Column.BROAD_APP_CATEGORY,  # App codebook broad category
                Column.GENRE_ID_SCRAPED,  # App codebook genre ID
                Column.INTERACTION_TYPE,
            ]

            # Timestamp continuation
            timestamp_continuation = [
                Column.START_TIMESTAMP,
                Column.STOP_TIMESTAMP,
                Column.DURATION_SECONDS,
                Column.DURATION_MINUTES,
                Column.SCREEN_USAGE_END_REASON,
                Column.SCREEN_USAGE_END_REASON_CONFIDENCE,
                Column.SCREEN_USAGE_STOP_EVENT_TYPE,
                Column.SCREEN_USAGE_LAST_ACTIVITY_TIMESTAMP,
                Column.SCREEN_USAGE_TAIL_GAP_SECONDS,
                Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE,
                Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL,
                Column.SCREEN_USAGE_LOCK_SCREEN_ONLY,
                Column.ANY_APP_USAGE_FLAGS,
                Column.DATA_TIME_GAP_HOURS,
                Column.DAY,
                Column.WEEKDAY_MF,
                Column.WEEKDAY_MTH,
                Column.WEEKDAY_SUTH,
                Column.HOUR,
                Column.QUARTER,
            ]

            # App usage derived/calculated columns
            app_derived_columns = [
                # Valid app usage columns
                Column.VALID_APP_NEW_ENGAGE_30S,
                Column.VALID_APP_NEW_ENGAGE_CUSTOM.format(
                    self.options.custom_app_engagement_duration
                ),
                Column.VALID_APP_SWITCHED_APP,
                Column.VALID_APP_USAGE_TIME_GAP_HOURS,
                # Any app usage columns
                Column.ANY_APP_NEW_ENGAGE_30S,
                Column.ANY_APP_NEW_ENGAGE_CUSTOM.format(
                    self.options.custom_app_engagement_duration
                ),
                Column.ANY_APP_SWITCHED_APP,
                Column.ANY_APP_USAGE_TIME_GAP_HOURS,
            ]

            # Administrative/Metadata columns
            admin_columns = [
                Column.PREPROCESSOR_VERSION,
                Column.DATETIME_OF_PREPROCESSING,
            ]

            # Only add survey-related columns if survey processing is available
            if self.survey_data_processor is not None:
                admin_columns.append(Column.COMPLIANCE)  # Survey data compliance column

            # Combine all columns in the desired order
            columns_to_include = [
                *identification_columns,
                *timestamp_columns,
                *app_core_columns,
                *timestamp_continuation,
                *app_derived_columns,
                *admin_columns,
            ]

            # Filter to only include columns that exist in the dataframe
            available_columns = get_available_columns(columns_to_include)

            # Debug: Check which columns are missing
            missing_columns = [col for col in columns_to_include if col not in output_df.columns]
            if missing_columns:
                LOGGER.warning(f"Missing columns from dataframe: {missing_columns}")
                LOGGER.debug(f"Available columns in dataframe: {list(output_df.columns)}")

            LOGGER.debug(
                f"Including {len(available_columns)} of {len(columns_to_include)} requested columns in output"
            )
            output_df = output_df[available_columns]

        self.check_data_for_disordered_timestamps()

        if not output_df.empty:
            # Only format columns that exist
            timestamp_columns = [
                str(col)
                for col in [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
                if col in output_df.columns
            ]
            if timestamp_columns:
                output_df = self.timestamp_processor.format_timestamps_as_strings(
                    output_df, timestamp_columns, TimestampFormat.DATETIME.value
                )

        self._write_output_csv(output_df, save_name)
        LOGGER.debug(f"Preprocessed data saved to {save_name}")

        if (
            self.options.process_app_usage_sessions
            and self.options.process_screen_usage_sessions
            and not self.current_participant_screen_usage_df.empty
        ):
            screen_output_df = self.current_participant_screen_usage_df.copy()
            screen_available_columns = [
                col for col in columns_to_include if col in screen_output_df.columns
            ]
            screen_output_df = screen_output_df[screen_available_columns]
            if not screen_output_df.empty:
                timestamp_columns = [
                    str(col)
                    for col in [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP]
                    if col in screen_output_df.columns
                ]
                if timestamp_columns:
                    screen_output_df = self.timestamp_processor.format_timestamps_as_strings(
                        screen_output_df,
                        timestamp_columns,
                        TimestampFormat.DATETIME.value,
                    )

            screen_save_name = (
                preprocessed_data_save_folder
                / f"{Path(raw_data_filename).stem.replace('Raw ', '')} Screen Usage {PREPROCESSED_FILE_SUFFIX}"
            )
            self._write_output_csv(screen_output_df, screen_save_name)
            LOGGER.debug(f"Screen usage data saved to {screen_save_name}")

        return preprocessed_data_save_folder

    def _write_output_csv(self, output_df: pd.DataFrame, save_name: Path) -> None:
        """Write an output DataFrame as CSV using Polars when available."""
        if USE_POLARS:
            LOGGER.debug("Using Polars for CSV writing")
            _start_write = time.perf_counter()
            try:
                # Reset index and ensure unique column names for Polars compatibility
                _write_df = output_df.reset_index(drop=True)

                datetime_columns = [
                    col
                    for col in _write_df.columns
                    if pd.api.types.is_datetime64_any_dtype(_write_df[col])
                    and not _write_df[col].isna().all()
                ]
                if datetime_columns:
                    timestamp_formats = []
                    for col in datetime_columns:
                        col_format = (
                            "%Y-%m-%d %H:%M:%S%.f%:z"
                            if getattr(_write_df[col].dtype, "tz", None) is not None
                            else "%Y-%m-%d %H:%M:%S%.f"
                        )
                        timestamp_formats.append(
                            pl.col(col).dt.strftime(col_format).alias(col)
                        )
                    formatted_timestamps = (
                        pl.from_pandas(_write_df[datetime_columns])
                        .with_columns(timestamp_formats)
                        .to_pandas()
                    )
                    for col in datetime_columns:
                        _write_df[col] = formatted_timestamps[col]

                # Convert list columns to strings (Polars doesn't support nested data in CSV)
                for col in _write_df.columns:
                    col_series = _write_df[col]
                    # Guard against duplicate columns returning DataFrame
                    if isinstance(col_series, pd.DataFrame):
                        LOGGER.warning(f"Column '{col}' returned DataFrame - skipping")
                        continue
                    if col_series.dtype == object:
                        # Check if column contains lists
                        non_null = col_series.dropna()
                        if not non_null.empty:
                            first_valid = non_null.iloc[0]
                            if isinstance(first_valid, (list, tuple, np.ndarray)):
                                _write_df[col] = col_series.apply(
                                    lambda x: str(x)
                                    if isinstance(x, (list, tuple, np.ndarray))
                                    else (str(x) if pd.notna(x) else "")
                                )

                # Check for duplicate columns and make unique if needed
                if _write_df.columns.duplicated().any():
                    LOGGER.warning("Duplicate column names detected, making unique for Polars")
                    cols = _write_df.columns.tolist()
                    seen: dict[str, int] = {}
                    new_cols = []
                    for col in cols:
                        if col in seen:
                            seen[col] += 1
                            new_cols.append(f"{col}_{seen[col]}")
                        else:
                            seen[col] = 0
                            new_cols.append(col)
                    _write_df.columns = new_cols
                pl.from_pandas(_write_df).write_csv(save_name)
                LOGGER.debug(
                    f"Polars CSV write completed in {time.perf_counter() - _start_write:.3f}s"
                )
            except Exception as e:
                LOGGER.warning(f"Polars CSV write failed ({e}), falling back to Pandas")
                output_df.to_csv(save_name, index=False)
        else:
            output_df.to_csv(save_name, index=False)

    def add_app_usage_detail_columns(self) -> None:
        """
        Add additional columns to the dataframe for app usage details.
        """
        LOGGER.debug("Adding app usage detail columns")
        self.current_participant_raw_data_df = self.app_usage_processor.add_app_usage_details(
            self.current_participant_raw_data_df
        )
        LOGGER.debug("App usage detail columns added successfully")

    def create_target_child_only_df(self) -> None:
        """
        Creates a separate dataframe with only the target child's data.
        """
        LOGGER.debug("Creating target child only dataframe")
        target_child_mask = (
            self.current_participant_raw_data_df[Column.USERNAME]
            .astype(str)
            .str.contains("Target Child", case=False)
        )
        self.participant_raw_data_df_target_child_only = self.current_participant_raw_data_df[
            target_child_mask
        ].copy()
        LOGGER.debug("Target child only dataframe created successfully")

    def mark_app_usage_flags(self) -> None:
        """
        Adds flags for app usage patterns.
        """
        LOGGER.debug("Marking app usage flags")
        self.app_usage_processor.add_app_usage_flags(self.current_participant_raw_data_df)
        LOGGER.debug("App usage flags marked successfully")

    def add_placeholder_entries_for_missing_dates(self) -> None:
        """
        Add placeholder APP_USAGE entries for dates with no app usage.
        This ensures all study dates appear in Excel filters even if no usage occurred.
        Only runs when study date range provider is available (internal modules).
        """
        if not self.study_date_provider.is_available:
            LOGGER.debug("Study date range provider not available, skipping placeholder entries")
            return

        try:
            study_date_range = self.study_date_provider.get_study_date_range(
                self.current_participant_id
            )

            if study_date_range is None:
                LOGGER.warning(
                    f"No study date range available for {self.current_participant_id}, "
                    f"skipping placeholder entries"
                )
                return

            LOGGER.info(f"Starting placeholder entry process for {self.current_participant_id}")

            start_date, end_date = study_date_range
            study_period_length = (end_date - start_date).days + 1

            LOGGER.debug(
                f"Checking for missing dates in study period for {self.current_participant_id}: "
                f"{start_date.date()} to {end_date.date()} ({study_period_length} days)"
            )

            target_child_app_usage_df = self.current_participant_raw_data_df[
                self.current_participant_raw_data_df[Column.INTERACTION_TYPE]
                == InteractionType.APP_USAGE
            ].copy()

            if self.current_participant_raw_data_df.empty:
                LOGGER.debug(
                    f"No data found for {self.current_participant_id}, skipping placeholder entries"
                )
                return

            timestamp_col = self.current_participant_raw_data_df[Column.START_TIMESTAMP]
            # Handle timezone alignment - check for tz-aware timestamps in multiple ways
            col_tz = None
            if hasattr(timestamp_col.dtype, "tz") and timestamp_col.dtype.tz is not None:
                col_tz = timestamp_col.dtype.tz
            elif len(timestamp_col) > 0:
                # Check first non-null value for timezone info
                first_valid = timestamp_col.dropna().iloc[0] if not timestamp_col.dropna().empty else None
                if first_valid is not None and hasattr(first_valid, "tzinfo") and first_valid.tzinfo is not None:
                    col_tz = first_valid.tzinfo

            if col_tz is not None:
                if start_date.tz is None:
                    start_date = start_date.tz_localize(col_tz)
                    LOGGER.debug(f"Localized start_date to {col_tz}")
                elif str(start_date.tz) != str(col_tz):
                    start_date = start_date.tz_convert(col_tz)
                    LOGGER.debug(f"Converted start_date to {col_tz}")
            elif start_date.tz is not None:
                # Data is tz-naive but start_date is tz-aware - remove timezone
                start_date = start_date.tz_localize(None)
                LOGGER.debug("Removed timezone from start_date to match tz-naive data")

            placeholder_rows = []

            for day in range(study_period_length):
                day_start = start_date + pd.Timedelta(days=day)
                day_end = day_start + pd.Timedelta(hours=23, minutes=59, seconds=59)

                day_mask = (target_child_app_usage_df[Column.START_TIMESTAMP] >= day_start) & (
                    target_child_app_usage_df[Column.START_TIMESTAMP] <= day_end
                )
                day_usage = target_child_app_usage_df[day_mask]

                if day_usage.empty:
                    # Check if device had ANY raw events this day (any interaction type).
                    # If not, data is truly missing — do not create a placeholder.
                    day_all_rows_mask = (
                        self.current_participant_raw_data_df[Column.START_TIMESTAMP]
                        >= day_start
                    ) & (
                        self.current_participant_raw_data_df[Column.START_TIMESTAMP] <= day_end
                    )
                    day_all_data = self.current_participant_raw_data_df[day_all_rows_mask]

                    if day_all_data.empty:
                        LOGGER.debug(
                            f"Day {day_start.date()}: No raw events found, "
                            f"skipping placeholder (data missing)"
                        )
                        continue

                    # Device was on (has raw events) but no app usage — legitimate zero usage.
                    compliance_value = 100.0

                    if Column.COMPLIANCE in self.current_participant_raw_data_df.columns:
                        unidentified_usage_mask = (
                            day_all_data[Column.INTERACTION_TYPE]
                            == InteractionType.NON_TARGET_CHILD_APP_USAGE
                        ) & (
                            day_all_data[Column.USERNAME]
                            .str.lower()
                            .str.contains("none", na=False)
                        )
                        unidentified_usage = day_all_data[unidentified_usage_mask]

                        if not unidentified_usage.empty:
                            existing_compliance = unidentified_usage[Column.COMPLIANCE].iloc[0]
                            if pd.notna(existing_compliance):
                                compliance_value = existing_compliance
                                LOGGER.debug(
                                    f"Day {day_start.date()}: Found unidentified usage, "
                                    f"using compliance = {compliance_value}%"
                                )
                            else:
                                LOGGER.debug(
                                    f"Day {day_start.date()}: Found unidentified usage but no compliance value, "
                                    f"using default compliance = 100.0%"
                                )
                        else:
                            LOGGER.debug(
                                f"Day {day_start.date()}: No app usage, "
                                f"using compliance = 100.0%"
                            )

                    placeholder_row = {
                        Column.EVENT_TIMESTAMP: day_start,
                        Column.START_TIMESTAMP: day_start,
                        Column.STOP_TIMESTAMP: day_start,
                        Column.INTERACTION_TYPE: InteractionType.APP_USAGE,
                        Column.USERNAME: TARGET_CHILD_USERNAME,
                        Column.DURATION_SECONDS: 0,
                        Column.DURATION_MINUTES: 0.0,
                        Column.DATA_TIME_GAP_HOURS: 0.0,
                        Column.DATE: day_start.date(),
                    }

                    if not self.current_participant_raw_data_df.empty:
                        sample_row = self.current_participant_raw_data_df.iloc[0]
                        if Column.PARTICIPANT_ID in self.current_participant_raw_data_df.columns:
                            placeholder_row[Column.PARTICIPANT_ID] = sample_row[
                                Column.PARTICIPANT_ID
                            ]
                        if Column.TIMEZONE in self.current_participant_raw_data_df.columns:
                            placeholder_row[Column.TIMEZONE] = sample_row[Column.TIMEZONE]
                        if (
                            Column.POSSIBLE_DEVICE_MODEL
                            in self.current_participant_raw_data_df.columns
                        ):
                            placeholder_row[Column.POSSIBLE_DEVICE_MODEL] = sample_row[
                                Column.POSSIBLE_DEVICE_MODEL
                            ]
                        if Column.APP_PACKAGE_NAME in self.current_participant_raw_data_df.columns:
                            placeholder_row[Column.APP_PACKAGE_NAME] = "com.placeholder.noactivity"
                        if Column.APPLICATION_LABEL in self.current_participant_raw_data_df.columns:
                            placeholder_row[Column.APPLICATION_LABEL] = "No Activity"
                        if (
                            Column.DEVICE_SHARING_STATUS
                            in self.current_participant_raw_data_df.columns
                        ):
                            placeholder_row[Column.DEVICE_SHARING_STATUS] = sample_row[
                                Column.DEVICE_SHARING_STATUS
                            ]
                        if Column.COMPLIANCE in self.current_participant_raw_data_df.columns:
                            placeholder_row[Column.COMPLIANCE] = compliance_value

                        static_columns_to_copy = [
                            Column.PREPROCESSOR_VERSION,
                            Column.DATETIME_OF_PREPROCESSING,
                            Column.STUDY_ID,
                        ]
                        for col in static_columns_to_copy:
                            if col in self.current_participant_raw_data_df.columns:
                                placeholder_row[col] = sample_row[col]

                    placeholder_rows.append(placeholder_row)

                    LOGGER.debug(
                        f"Will add placeholder APP_USAGE entry for {self.current_participant_id} "
                        f"on {day_start.date()} - no actual usage detected"
                    )

            if placeholder_rows:
                new_rows_df = pd.DataFrame(placeholder_rows)
                rows_before = len(self.current_participant_raw_data_df)
                self.current_participant_raw_data_df = pd.concat(
                    [self.current_participant_raw_data_df, new_rows_df], ignore_index=True
                )
                rows_after = len(self.current_participant_raw_data_df)
                LOGGER.info(
                    f"Added {len(placeholder_rows)} placeholder APP_USAGE entries for "
                    f"{self.current_participant_id} for dates with no usage. "
                    f"DataFrame size: {rows_before} -> {rows_after} rows"
                )

                placeholder_check = self.current_participant_raw_data_df[
                    self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME]
                    == "com.placeholder.noactivity"
                ]
                LOGGER.info(
                    f"Verification: {len(placeholder_check)} placeholder rows found in dataframe "
                    f"(APP_PACKAGE_NAME='com.placeholder.noactivity')"
                )
            else:
                LOGGER.debug(
                    f"No missing dates found for {self.current_participant_id} - "
                    f"all study dates have APP_USAGE entries"
                )

        except Exception as e:
            LOGGER.exception(
                f"Error adding placeholder entries for {self.current_participant_id}: {e}"
            )

    def process_survey_data(self, device_sharing_status: str = "Non-Shared") -> None:
        """
        Process survey data if survey preprocessor is available.

        Args:
            device_sharing_status: Device sharing status for this participant
        """
        if not self.study_date_provider.is_available:
            LOGGER.debug("Survey data preprocessor not available, skipping survey processing")
            return

        try:
            LOGGER.debug(f"Processing survey data for participant {self.current_participant_id}")
            self.current_participant_raw_data_df = (
                self.survey_data_processor.process_data_based_on_device_sharing_status(
                    self.current_participant_raw_data_df,
                    device_sharing_status,
                    self.current_participant_id,
                )
            )
            LOGGER.debug("Survey data processing completed successfully")
        except Exception as e:
            LOGGER.exception(
                f"Error processing survey data for participant {self.current_participant_id}: {e}"
            )

    def process_device_sharing_status(self) -> None:
        """
        Processes data based on device sharing status from the tracking sheet.
        For shared devices, uses survey data to identify users when available.
        """
        if not self.study_date_provider.is_available:
            LOGGER.debug(
                "Survey data preprocessor not available, skipping device sharing status processing"
            )
            return

        LOGGER.debug(
            f"Processing device sharing status for participant {self.current_participant_id}"
        )

        try:
            # Get device sharing status dynamically
            device_sharing_status = self.survey_data_processor.get_device_sharing_status(
                self.current_participant_id, default="Non-Shared"
            )

            # Process data based on device sharing status
            self.current_participant_raw_data_df = (
                self.survey_data_processor.process_data_based_on_device_sharing_status(
                    self.current_participant_raw_data_df,
                    device_sharing_status,
                    self.current_participant_id,
                )
            )

            LOGGER.debug("Device sharing status processed successfully")
        except Exception as e:
            LOGGER.exception(
                f"Error processing device sharing status for participant {self.current_participant_id}: {e}"
            )

    def handle_non_target_child_app_usage(self) -> None:
        """
        For shared devices, modifies app usage entries that are not associated with the target child.
        """
        if not self.study_date_provider.is_available:
            LOGGER.debug(
                "Survey data preprocessor not available, skipping non-target child app usage handling"
            )
            return

        try:
            self.current_participant_raw_data_df = (
                self.survey_data_processor.handle_non_target_child_app_usage(
                    self.current_participant_raw_data_df, self.current_participant_id
                )
            )
        except Exception as e:
            LOGGER.exception(
                f"Error handling non-target child app usage for participant {self.current_participant_id}: {e}"
            )

    def filter_data_to_study_dates_only(self) -> None:
        """
        Filters the data to include only records within the study period.
        """
        if not self.study_date_provider.is_available:
            LOGGER.debug("Study date range provider not available, skipping study date filtering")
            return

        try:
            self.current_participant_raw_data_df = (
                self.study_date_provider.filter_data_to_study_dates(
                    self.current_participant_raw_data_df, self.current_participant_id
                )
            )
        except Exception as e:
            LOGGER.exception(
                f"Error filtering data to study dates for participant {self.current_participant_id}: {e}"
            )

    def preprocess_Chronicle_Android_raw_data_file(
        self, raw_data_file: Path | str
    ) -> tuple[Path, bool, dict | None]:
        """
        Preprocesses a single Chronicle Android raw data file.

        Args:
            raw_data_file: Path to the raw data file

        Returns:
            Tuple containing:
            - Path to the preprocessed data save folder
            - Boolean indicating whether preprocessing was successful
            - Compliance data dictionary entry if available, otherwise None
        """
        LOGGER.info(f"Preprocessing {raw_data_file}")
        preprocessed_data_save_folder = ""

        try:
            # Read the raw data file - use Polars for faster I/O if available
            if USE_POLARS:
                LOGGER.debug("Using Polars for CSV reading")
                _start_read = time.perf_counter()
                _pl_df = pl.read_csv(Path(raw_data_file), infer_schema_length=10000)
                # Strip whitespace from string columns (skipinitialspace equivalent)
                string_cols = [col for col in _pl_df.columns if _pl_df[col].dtype == pl.Utf8]
                if string_cols:
                    _pl_df = _pl_df.with_columns(
                        [pl.col(col).str.strip_chars() for col in string_cols]
                    )
                # Convert to Pandas for downstream processing
                self.current_participant_raw_data_df = _pl_df.to_pandas()
                LOGGER.debug(
                    f"Polars CSV read completed in {time.perf_counter() - _start_read:.3f}s"
                )
            else:
                self.current_participant_raw_data_df = pd.read_csv(
                    Path(raw_data_file), skipinitialspace=True
                )

            if self.current_participant_raw_data_df.empty:
                LOGGER.warning(f"Raw data file is empty: {raw_data_file}")
                self.stats.mark_error(Path(raw_data_file), "Empty file")
                return Path(preprocessed_data_save_folder), False, None

            # Get participant ID
            self.current_participant_id = self.get_participant_id_from_data()
            LOGGER.info(f"Processing participant {self.current_participant_id}")

            # Fix other original columns
            self.correct_original_columns()

            # Create additional columns
            self.create_additional_columns()

            # Label filtered apps
            self.label_filtered_apps()

            # Run the configured usage derivation mode. Screen usage is derived
            # before app usage when both are enabled, so raw Activity Resumed rows
            # are still available to the screen classifier.
            try:
                self.run_configured_usage_session_algorithms()

                # Check for disordered timestamps
                self.check_data_for_disordered_timestamps()

                # Enrich data with app codebook information
                self.enrich_with_app_codebook_data()

                processing_successful = True

            except pd.errors.EmptyDataError:
                LOGGER.warning(
                    f"{self.current_participant_id}: No valid app usage during the study period."
                )
                file_name = Path(raw_data_file).name
                self.stats.mark_empty_file(file_name)
                processing_successful = False

            # Process device sharing status from tracking sheet (survey data integration) - INTERNAL ONLY
            if self.survey_data_processor:
                self.process_device_sharing_status()

            # Handle non-target child app usage for shared devices - INTERNAL ONLY
            if self.survey_data_processor:
                self.handle_non_target_child_app_usage()

            # Calculate compliance data like internal version (even if no app usage for shared devices)
            compliance_dict_entry = None
            if self.survey_data_processor and getattr(self.options, "compliance_reporting", False):
                try:
                    # Get device sharing status to check if we should calculate compliance
                    device_sharing_status = self.survey_data_processor.get_device_sharing_status(
                        self.current_participant_id, default="Non-Shared"
                    )

                    if device_sharing_status == "Shared":
                        # Get study date range from tracking sheet
                        study_date_range = self.study_date_provider.get_study_date_range(
                            self.current_participant_id
                        )

                        if study_date_range is None:
                            LOGGER.error(
                                f"Cannot calculate compliance for {self.current_participant_id}: "
                                f"Study date range is not available from tracking sheets. "
                                f"Compliance calculation requires an explicitly defined study period."
                            )
                        else:
                            start_date, end_date = study_date_range
                            study_period_length = (end_date - start_date).days + 1

                            LOGGER.info(
                                f"Calculating compliance for {self.current_participant_id} "
                                f"from {start_date.date()} to {end_date.date()} ({study_period_length} days)"
                            )

                            compliance_metrics = (
                                self.survey_data_processor.calculate_compliance_for_shared_device(
                                    self.current_participant_raw_data_df,
                                    self.current_participant_id,
                                    study_period_length=study_period_length,
                                    start_date=start_date,
                                    set_compliance_on_dataframe=True,
                                )
                            )

                            if compliance_metrics:
                                device_type = self.get_possible_device_model()
                                compliance_dict_entry = {
                                    "Study": getattr(self.options, "study_name", "Unknown Study"),
                                    "Participant ID": self.current_participant_id,
                                    "Device Type": device_type,
                                    "Device Sharing Status": device_sharing_status,
                                    **{
                                        f"Day {i + 1} Compliance Percentage": data
                                        for i, data in enumerate(
                                            compliance_metrics["compliance_percentages"]
                                        )
                                    },
                                    **{
                                        f"Day {i + 1} Target Child Usage": data
                                        for i, data in enumerate(
                                            compliance_metrics["target_child_usage"]
                                        )
                                    },
                                    **{
                                        f"Day {i + 1} Other Usage": data
                                        for i, data in enumerate(compliance_metrics["other_usage"])
                                    },
                                    **{
                                        f"Day {i + 1} Unknown Usage": data
                                        for i, data in enumerate(
                                            compliance_metrics["unknown_usage"]
                                        )
                                    },
                                }

                            LOGGER.debug(
                                f"Calculated compliance for shared device {self.current_participant_id}"
                            )
                    else:
                        LOGGER.debug(
                            f"Non-shared device {self.current_participant_id}, skipping compliance calculation"
                        )

                except Exception as e:
                    LOGGER.exception(
                        f"Error calculating compliance for {self.current_participant_id}: {e}"
                    )

            # Only do app analysis columns after successful app-usage processing.
            # Screen-only output is a separate product and should not receive
            # app-usage engagement/switch flags.
            if processing_successful and self.options.process_app_usage_sessions:
                # Add app usage detail columns (MUST happen AFTER survey processing)
                self.add_app_usage_detail_columns()

                # Mark app usage flags (MUST happen AFTER survey processing)
                self.mark_app_usage_flags()

            # Remove unwanted interaction types
            self.remove_selected_interaction_types()

            # Add placeholder entries for dates with no usage (INTERNAL ONLY)
            # This ensures all study dates appear in Excel filters
            self.add_placeholder_entries_for_missing_dates()

            # Filter data to study dates only (final filtering step) - INTERNAL ONLY
            if self.survey_data_processor:
                rows_before_date_filter = len(self.current_participant_raw_data_df)
                placeholders_before_filter = (
                    len(
                        self.current_participant_raw_data_df[
                            self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME]
                            == "com.placeholder.noactivity"
                        ]
                    )
                    if Column.APP_PACKAGE_NAME in self.current_participant_raw_data_df.columns
                    else 0
                )

                self.filter_data_to_study_dates_only()

                rows_after_date_filter = len(self.current_participant_raw_data_df)
                placeholders_after_filter = (
                    len(
                        self.current_participant_raw_data_df[
                            self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME]
                            == "com.placeholder.noactivity"
                        ]
                    )
                    if Column.APP_PACKAGE_NAME in self.current_participant_raw_data_df.columns
                    else 0
                )

                LOGGER.info(
                    f"Study date filtering: {rows_before_date_filter} -> {rows_after_date_filter} rows. "
                    f"Placeholders: {placeholders_before_filter} -> {placeholders_after_filter}"
                )

            # Finalize and save
            placeholders_before_save = (
                len(
                    self.current_participant_raw_data_df[
                        self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME]
                        == "com.placeholder.noactivity"
                    ]
                )
                if Column.APP_PACKAGE_NAME in self.current_participant_raw_data_df.columns
                else 0
            )
            LOGGER.info(
                f"Before finalize: {len(self.current_participant_raw_data_df)} total rows, "
                f"{placeholders_before_save} placeholder rows"
            )

            preprocessed_data_save_folder = self.finalize_and_save_preprocessed_data_df(
                raw_data_filename=Path(raw_data_file).name
            )

            LOGGER.debug(
                f"Preprocessed data for {raw_data_file} saved to {preprocessed_data_save_folder}"
            )
            self.stats.mark_processed(Path(raw_data_file))
            return Path(preprocessed_data_save_folder), True, compliance_dict_entry

        except Exception as e:
            LOGGER.exception(f"Error preprocessing {raw_data_file}: {e}")
            self.stats.mark_error(Path(raw_data_file), str(e))
            return Path(preprocessed_data_save_folder), False, None

    def preprocess_Chronicle_Android_raw_data_folder(
        self,
        plotting_started_callback: Callable[[], None] | None = None,
        plotting_completed_callback: Callable[[], None] | None = None,
        plotting_only: bool = False,
    ) -> tuple[Path | None, ProcessingStats]:
        """
        Preprocess all Chronicle Android raw data files in a folder.

        Args:
            plotting_started_callback: Optional callback to run when plotting starts
            plotting_completed_callback: Optional callback to run when plotting completes
            plotting_only: Whether to only plot existing preprocessed data (no preprocessing)

        Returns:
            tuple: (Path to the output folder, ProcessingStats object)
        """
        if not self.options.raw_data_folder:
            LOGGER.error("No raw data folder specified")
            return None, self.stats

        # Start timing the entire processing operation
        start_time = time.time()

        LOGGER.info(
            f"Preprocessing Chronicle Android raw data files from {self.options.raw_data_folder}"
        )

        # Get all raw data files
        Chronicle_Android_raw_data_files = sorted(
            get_matching_files_from_folder(
                self.options.raw_data_folder,
                self.options.raw_data_file_regex_pattern,
                ignore_names=["Survey", "Archive", "Do Not Use"],
            )
        )

        # Check that we found files
        if not Chronicle_Android_raw_data_files:
            msg = f"No raw data files found in {self.options.raw_data_folder}. Please check that the folder contains raw data files ending with .csv"
            LOGGER.error(msg)
            return None, self.stats

        self.stats.total_files = len(Chronicle_Android_raw_data_files)
        LOGGER.info(f"Found {len(Chronicle_Android_raw_data_files)} raw data files")

        # Set common paths
        preprocessed_data_save_folder = str(
            Path(self.options.output_folder)
            / f"{self.options.study_name} {PREPROCESSED_FOLDER_SUFFIX}"
        )
        plot_output_folder = str(
            Path(self.options.output_folder) / f"{self.options.study_name} {PLOTTED_FOLDER_SUFFIX}"
        )

        # If plotting only, skip preprocessing
        if plotting_only:
            LOGGER.info("Plotting only mode - skipping preprocessing")
            if (
                callable(plotting_started_callback)
                and callable(plotting_completed_callback)
                and self.options.enable_plotting
            ):
                # Call plotting started callback
                plotting_started_callback()

                # Generate plots
                _generate_plots(
                    study_name=self.options.study_name,
                    preprocessed_folder=Path(preprocessed_data_save_folder),
                    options=self.options,
                    codebook_path=self.options.app_codebook_path,
                    progress_callback=self.progress_callback,
                )

                # Call plotting completed callback
                plotting_completed_callback()

            results_dict = {
                "raw_data_files": Chronicle_Android_raw_data_files if not plotting_only else [],
                "date_and_time": datetime.now().strftime("%m-%d-%Y %H:%M:%S"),
                "preprocessed_data_save_folder": preprocessed_data_save_folder,
                "plot_output_folder": plot_output_folder,
                "stats": self.stats.get_summary(),
            }

            LOGGER.info(f"Results: {json.dumps(results_dict, indent=4)}")
            return Path(plot_output_folder), self.stats

        if not self.options.enable_preprocessing:
            LOGGER.info("Preprocessing disabled in options")
            return Path(preprocessed_data_save_folder), self.stats

        # Dictionary to collect compliance data for all studies
        compliance_data_all_studies = {}
        preprocessed_file_count = 0
        all_filenames = len(Chronicle_Android_raw_data_files)
        use_parallel_processing = self.options.parallel_processing and all_filenames > 1
        if (
            use_parallel_processing
            and self.options.use_survey_data
            and not self.options.device_sharing_status_map
        ):
            LOGGER.warning(
                "Parallel preprocessing requires a precomputed device_sharing_status_map "
                "when survey data is enabled; falling back to sequential processing."
            )
            use_parallel_processing = False

        # Choose parallel or sequential processing based on options
        if use_parallel_processing:
            # Parallel processing
            LOGGER.info(
                f"Using parallel processing for {all_filenames} files "
                f"(max_workers={self.options.parallel_max_workers or 'auto'})"
            )
            results, parallel_stats = preprocess_files_parallel(
                files=[Path(f) for f in Chronicle_Android_raw_data_files],
                options=self.options,
                max_workers=self.options.parallel_max_workers,
                progress_callback=self.progress_callback,
            )

            # Merge parallel stats into main stats
            self.stats.processed_files = parallel_stats.processed_files
            self.stats.failed_files = parallel_stats.failed_files
            preprocessed_file_count = parallel_stats.processed_files

            # Collect compliance data from results
            for output_folder, success, compliance_dict_entry in results:
                if success and compliance_dict_entry:
                    study_name = compliance_dict_entry.get("Study", "Unknown Study")
                    if study_name not in compliance_data_all_studies:
                        compliance_data_all_studies[study_name] = []
                    compliance_data_all_studies[study_name].append(compliance_dict_entry)

                # Update preprocessed_data_save_folder from successful results
                if success and output_folder and output_folder != Path(""):
                    preprocessed_data_save_folder = output_folder
        else:
            # Sequential processing (original behavior)
            for i, raw_data_file in enumerate(Chronicle_Android_raw_data_files):
                if self.progress_callback:
                    progress_message = (
                        f"Processing file {i + 1}/{all_filenames}: {Path(raw_data_file).name}"
                    )
                    self.progress_callback(progress_message, i + 1, all_filenames)

                try:
                    preprocessed_data_save_folder, success, compliance_dict_entry = (
                        self.preprocess_Chronicle_Android_raw_data_file(Path(raw_data_file))
                    )
                    if success:
                        preprocessed_file_count += 1

                        # Collect compliance data if available
                        if compliance_dict_entry:
                            study_name = compliance_dict_entry.get("Study", "Unknown Study")
                            if study_name not in compliance_data_all_studies:
                                compliance_data_all_studies[study_name] = []
                            compliance_data_all_studies[study_name].append(compliance_dict_entry)
                            LOGGER.debug(f"Collected compliance data for study {study_name}")

                except Exception as e:
                    LOGGER.exception(f"Error preprocessing {raw_data_file}: {e}")
                    self.stats.mark_error(Path(raw_data_file), str(e))

        # Calculate preprocessing time
        preprocessing_end_time = time.time()
        preprocessing_duration = preprocessing_end_time - start_time

        LOGGER.info(
            f"Preprocessed {preprocessed_file_count} of {len(Chronicle_Android_raw_data_files)} raw data files "
            f"in {preprocessing_duration:.2f} seconds ({preprocessing_duration / 60:.2f} minutes)"
        )

        # Save compliance reports if any data was collected
        if compliance_data_all_studies and self.survey_data_processor:
            try:
                self.survey_data_processor.save_compliance_report(
                    compliance_data_all_studies, self.options.output_folder
                )
                LOGGER.info("Saved compliance reports for all studies")
            except Exception as e:
                LOGGER.exception(f"Error saving compliance reports: {e}")

        # Generate plots if enabled
        if (
            callable(plotting_started_callback)
            and callable(plotting_completed_callback)
            and self.options.enable_plotting
        ):
            # Call plotting started callback
            plotting_started_callback()

            try:
                # Generate plots
                plot_output_folder, plot_stats = _generate_plots(
                    study_name=self.options.study_name,
                    preprocessed_folder=Path(preprocessed_data_save_folder),
                    options=self.options,
                    codebook_path=self.options.app_codebook_path,
                    progress_callback=self.progress_callback,
                )

                # Update stats with plotting stats
                self.stats.plotted_files = plot_stats.plotted_files
                self.stats.plot_failed_files = plot_stats.plot_failed_files
                self.stats.empty_plot_files = plot_stats.empty_plot_files
                self.stats.plot_warnings = plot_stats.plot_warnings
                self.stats.plot_error_types = plot_stats.plot_error_types
                self.stats.plot_success_types = plot_stats.plot_success_types

                # Add plot errors to main stats
                for filename, error in plot_stats.errors.items():
                    if "plotting" in filename:
                        self.stats.errors[filename] = error

            except Exception:
                LOGGER.exception("Error during plotting process")
                # Don't crash the whole process, just log the error
                plot_output_folder = None
            finally:
                # Always call plotting completed callback
                plotting_completed_callback()

        # Calculate total time including plotting
        total_duration = time.time() - start_time

        results_dict = {
            "date_and_time": datetime.now().strftime("%m-%d-%Y %H:%M:%S"),
            "preprocessed_data_save_folder": str(preprocessed_data_save_folder),
            "plot_output_folder": str(plot_output_folder)
            if plot_output_folder
            else "Not generated",
            "stats": self.stats.get_summary(),
            "preprocessing_time_seconds": f"{preprocessing_duration:.2f}",
            "total_time_seconds": f"{total_duration:.2f}",
        }

        LOGGER.info(
            f"Total processing time: {total_duration:.2f} seconds ({total_duration / 60:.2f} minutes)"
        )
        LOGGER.info(f"Results: {json.dumps(results_dict, indent=4)}")
        return Path(preprocessed_data_save_folder), self.stats


# Alias for backwards compatibility and cleaner imports
MainPreprocessor = ChronicleAndroidRawDataPreprocessor


def _process_single_file_worker(
    args: tuple,
) -> tuple[int, Path, bool, dict | None, str, ProcessingStats]:
    """
    Worker function for parallel file processing.

    This is a module-level function required for multiprocessing.
    Each worker creates its own preprocessor instance to avoid shared state issues.

    Args:
        args: Tuple of (input_index, file_path, options_dict)

    Returns:
        Tuple of (input_index, output_folder, success, compliance_dict, file_name, stats)
    """
    input_index, file_path, options_dict = args

    # Recreate options from dict (can't pickle PreprocessingOptions directly with some fields)
    options = PreprocessingOptions(**options_dict)

    # Create a fresh preprocessor instance for this file
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)

    try:
        output_folder, success, compliance_dict = (
            preprocessor.preprocess_Chronicle_Android_raw_data_file(Path(file_path))
        )
        return (
            input_index,
            output_folder,
            success,
            compliance_dict,
            Path(file_path).name,
            preprocessor.stats,
        )
    except Exception as e:
        LOGGER.exception(f"Error in parallel worker for {file_path}: {e}")
        preprocessor.stats.mark_error(Path(file_path), str(e))
        return input_index, Path(""), False, None, Path(file_path).name, preprocessor.stats


def _merge_processing_stats(destination: ProcessingStats, source: ProcessingStats) -> None:
    """Merge per-worker processing stats into the parent aggregate."""
    destination.processed_files += source.processed_files
    destination.failed_files += source.failed_files
    destination.empty_files += source.empty_files
    destination.warnings.update(source.warnings)
    destination.errors.update(source.errors)
    destination.file_errors.update(source.file_errors)
    destination.processed_file_paths.update(source.processed_file_paths)


def _resolve_parallel_max_workers(max_workers: int | None, file_count: int) -> int:
    """Resolve the user worker limit to a safe process count."""
    if max_workers is None or max_workers <= 0:
        max_workers = max(1, multiprocessing.cpu_count() // 2)
    if file_count > 0:
        max_workers = min(max_workers, file_count)
    return max(1, max_workers)


def _parallel_option_value(value: Any) -> Any:
    """Copy option values into a multiprocessing-friendly shape."""
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        return list(value)
    if isinstance(value, set):
        return set(value)
    if isinstance(value, tuple):
        return tuple(value)
    return value


def _build_parallel_options_dict(options: PreprocessingOptions) -> dict[str, Any]:
    """Build options for workers without dropping behavior-changing settings."""
    worker_options = {
        field.name: _parallel_option_value(getattr(options, field.name))
        for field in fields(PreprocessingOptions)
        if field.name != "survey_data_df"
    }

    # Each worker handles one file and the parent process handles optional plotting.
    worker_options["enable_plotting"] = False
    worker_options["parallel_processing"] = False
    worker_options["parallel_max_workers"] = None
    return worker_options


def preprocess_files_parallel(
    files: list[Path],
    options: PreprocessingOptions,
    max_workers: int | None = None,
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> tuple[list[tuple[Path, bool, dict | None]], ProcessingStats]:
    """
    Process multiple files in parallel using multiprocessing.

    Args:
        files: List of file paths to process
        options: Preprocessing options (will be serialized for each worker)
        max_workers: Maximum number of parallel workers (default: half of CPU cores)
        progress_callback: Optional callback for progress updates

    Returns:
        Tuple of (list of results, ProcessingStats)
    """
    max_workers = _resolve_parallel_max_workers(max_workers, len(files))

    LOGGER.info(f"Starting parallel processing with {max_workers} workers for {len(files)} files")

    options_dict = _build_parallel_options_dict(options)

    # Survey data handling for parallel processing
    # Pre-compute device sharing status map to avoid each worker accessing TrackingSheet
    if options.use_survey_data:
        device_sharing_map = options.device_sharing_status_map
        study_date_map = options.study_date_map

        # If maps not provided, pre-compute them now (before spawning workers)
        if device_sharing_map is None:
            LOGGER.info("Pre-computing device sharing status map for parallel processing...")
            device_sharing_map = {}
            study_date_map = {}

            try:
                # Create a temporary preprocessor to access survey data processor
                temp_preprocessor = ChronicleAndroidRawDataPreprocessor(options)
                if temp_preprocessor.survey_data_processor:
                    # Extract participant IDs from file names
                    for file_path in files:
                        try:
                            # Try to extract participant ID from filename first (faster)
                            pid = file_path.stem.split(" ")[0]

                            # If that doesn't look like a valid ID, try reading the file
                            if not pid or len(pid) < 3:
                                if POLARS_AVAILABLE and USE_POLARS:
                                    df = pl.read_csv(file_path, n_rows=1)
                                    if "participant_id" in df.columns:
                                        pid = df["participant_id"][0]
                                else:
                                    df = pd.read_csv(file_path, nrows=1)
                                    if "participant_id" in df.columns:
                                        pid = df["participant_id"].iloc[0]

                            if pid and pid not in device_sharing_map:
                                status = temp_preprocessor.survey_data_processor.get_device_sharing_status(
                                    pid, default="Non-Shared"
                                )
                                device_sharing_map[pid] = status

                                # Get study dates if available
                                if temp_preprocessor.study_date_provider:
                                    try:
                                        dates = temp_preprocessor.study_date_provider.get_study_date_range(
                                            pid
                                        )
                                        if dates is not None:
                                            study_date_map[pid] = (dates[0], dates[-1])
                                    except Exception:
                                        pass
                        except Exception as e:
                            LOGGER.debug(f"Could not pre-compute status for {file_path}: {e}")

                    LOGGER.info(
                        f"Pre-computed device sharing status for {len(device_sharing_map)} participants"
                    )
            except Exception as e:
                LOGGER.warning(f"Failed to pre-compute device sharing map: {e}")

        if device_sharing_map:
            options_dict["use_survey_data"] = True
            options_dict["device_sharing_status_map"] = device_sharing_map
            options_dict["study_date_map"] = study_date_map
            options_dict["compliance_reporting"] = getattr(options, "compliance_reporting", False)
            LOGGER.info("Survey data enabled in parallel mode")
        else:
            options_dict["use_survey_data"] = False
            LOGGER.warning("Survey data disabled - could not build device sharing status map")
    else:
        options_dict["use_survey_data"] = False

    # Prepare arguments for workers
    worker_args = [(index, str(file_path), options_dict) for index, file_path in enumerate(files)]

    stats = ProcessingStats()
    stats.total_files = len(files)
    results_by_index: dict[int, tuple[Path, bool, dict | None]] = {}

    start_time = time.time()

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_file = {
            executor.submit(_process_single_file_worker, args): args[1] for args in worker_args
        }

        # Collect results as they complete
        completed = 0
        for future in as_completed(future_to_file):
            file_path = future_to_file[future]
            completed += 1

            try:
                (
                    input_index,
                    output_folder,
                    success,
                    compliance_dict,
                    file_name,
                    worker_stats,
                ) = future.result()
                results_by_index[input_index] = (output_folder, success, compliance_dict)
                _merge_processing_stats(stats, worker_stats)

                if progress_callback:
                    progress_callback(
                        f"Completed {file_name} ({completed}/{len(files)})",
                        completed,
                        len(files),
                    )

            except Exception as e:
                LOGGER.exception(f"Worker failed for {file_path}: {e}")
                stats.failed_files += 1

    elapsed = time.time() - start_time
    LOGGER.info(
        f"Parallel processing completed: {stats.processed_files}/{len(files)} files "
        f"in {elapsed:.2f}s ({elapsed / len(files):.2f}s per file avg)"
    )

    results = [results_by_index[index] for index in sorted(results_by_index)]
    return results, stats
