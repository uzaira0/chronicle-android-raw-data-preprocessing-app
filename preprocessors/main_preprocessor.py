"""
Core preprocessing logic for Chronicle Android Raw Data Preprocessor
"""

from __future__ import annotations

import contextlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import pandas as pd
from openpyxl.styles import Alignment, PatternFill

from config.constants import (
    ALL_INTERACTION_TYPES_MAP,
    AMAZON_APPS,
    PLOTTED_FOLDER_SUFFIX,
    PREPROCESSED_FILE_SUFFIX,
    PREPROCESSED_FOLDER_SUFFIX,
    ChronicleDeviceType,
    Column,
    InteractionType,
    TimestampFormat,
)
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from models.processing_stats import ProcessingStats
from plotting.plotting_manager import generate_plots
from preprocessors.app_filter_preprocessor import AppFilterPreprocessor
from preprocessors.app_usage_preprocessor import AppUsagePreprocessor
from preprocessors.column_preprocessor import ColumnPreprocessor
from preprocessors.timestamp_preprocessor import TimestampPreprocessor
from preprocessors.timezone_preprocessor import TimezonePreprocessor
from utils.file_utils import get_matching_files_from_folder, read_filter_file

LOGGER = logging.getLogger(__name__)


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
            current_horizontal = getattr(cell.alignment, "horizontal", "general") if cell.alignment else "general"
            current_vertical = getattr(cell.alignment, "vertical", "bottom") if cell.alignment else "bottom"

            # Create new alignment with updated properties
            new_alignment = Alignment(
                horizontal=self.horizontal_alignment or current_horizontal,
                vertical=self.vertical_alignment or current_vertical,
                # Preserve other alignment properties if they exist
                wrap_text=getattr(cell.alignment, "wrap_text", False) if cell.alignment else False,
                shrink_to_fit=getattr(cell.alignment, "shrink_to_fit", False) if cell.alignment else False,
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
                condition=lambda row, col, val: (col is not None and irregular_value_strategy(row, col, val)),
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
        options (ChronicleAndroidRawDataPreprocessingOptions): Options for the data preprocessing.
        current_participant_raw_data_df (pd.DataFrame): DataFrame containing the current participant's raw data.
        current_participant_id (str | None): The current participant's ID.
        participant_raw_data_df_target_child_only (pd.DataFrame): DataFrame containing only the target child's data.
        local_timezone (tzinfo): The local timezone.
        current_data_primary_timezone (tzinfo | None): The primary timezone of the current data.
    """

    def __init__(
        self,
        options: ChronicleAndroidRawDataPreprocessingOptions,
        progress_callback: Callable[[str, int, int], None] | None = None,
    ) -> None:
        """
        Initialize the ChronicleAndroidRawDataPreprocessor.

        Args:
            options (ChronicleAndroidRawDataPreprocessingOptions): The options for preprocessing.
            progress_callback: Optional callback function to report progress (message, current_file, total_files)
        """
        self.options = options
        self.current_participant_raw_data_df = pd.DataFrame()
        self.current_participant_id = ""
        self.current_data_primary_timezone = None
        self.progress_callback = progress_callback
        self.stats = ProcessingStats()
        LOGGER.debug("Initializing ChronicleAndroidRawDataPreprocessor")

        if options.use_filter_file and options.filter_file and isinstance(options.filter_file, (str, Path)) and len(str(options.filter_file)) > 0:
            try:
                options.apps_to_filter_dict = read_filter_file(options.filter_file)
                LOGGER.info(f"Loaded {len(options.apps_to_filter_dict)} app filters from {options.filter_file}")
            except Exception:
                LOGGER.exception("Error loading filter file")

        self.timestamp_processor = TimestampPreprocessor(options)
        self.timezone_processor = TimezonePreprocessor(options)
        self.app_usage_processor = AppUsagePreprocessor(options)
        self.app_filter_processor = AppFilterPreprocessor(options)
        self.column_processor = ColumnPreprocessor(options)

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
        if any(self.current_participant_raw_data_df[Column.APP_PACKAGE_NAME].str.contains("|".join(AMAZON_APP_PACKAGE_NAMES))):
            LOGGER.debug("Possible device model determined: Amazon Fire")
            return ChronicleDeviceType.AMAZON
        LOGGER.debug("Possible device model determined: Android")
        return ChronicleDeviceType.ANDROID

    def rename_interaction_types(self) -> None:
        """
        Renames interaction types in the dataframe based on the conversion dictionary.
        """
        LOGGER.debug("Renaming interaction types")
        self.current_participant_raw_data_df = self.current_participant_raw_data_df.reset_index(drop=True)
        self.current_participant_raw_data_df[Column.INTERACTION_TYPE] = self.current_participant_raw_data_df[Column.INTERACTION_TYPE].replace(
            ALL_INTERACTION_TYPES_MAP
        )
        LOGGER.debug("Interaction types renamed successfully")

    def remove_selected_interaction_types(self) -> None:
        """
        Removes selected interaction types from the dataframe,
        except for rows that have time gap flags.
        """
        LOGGER.debug("Removing selected interaction types while preserving time gap rows")

        # Keep rows that either:
        # 1. Have an interaction type that's not in the removal list, OR
        # 2. Have a non-zero time gap flag
        self.current_participant_raw_data_df = self.current_participant_raw_data_df[
            (~self.current_participant_raw_data_df[Column.INTERACTION_TYPE].isin(self.options.interaction_types_to_remove))
            | (self.current_participant_raw_data_df[Column.DATA_TIME_GAP_HOURS] > 0)
        ]

        self.current_participant_raw_data_df = self.current_participant_raw_data_df.sort_values(Column.EVENT_TIMESTAMP).reset_index(drop=True)
        LOGGER.debug("Selected interaction types removed while preserving time gap rows")

    def unalign_duplicate_event_timestamps(self) -> None:
        """
        Adjusts duplicate event timestamps by adding nanoseconds to ensure uniqueness.
        """
        LOGGER.debug("Unaligning duplicate event timestamps")
        self.current_participant_raw_data_df = self.timestamp_processor.unalign_duplicate_timestamps(
            self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
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
            self.current_participant_raw_data_df = self.timestamp_processor.unalign_duplicate_timestamps(
                self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP
            )

        self.current_participant_raw_data_df = self.current_participant_raw_data_df.sort_values(Column.EVENT_TIMESTAMP).reset_index(drop=True)
        LOGGER.debug("Event timestamp column corrected successfully")

    def correct_original_columns(self) -> None:
        """
        Corrects the original columns in the dataframe.
        """
        LOGGER.debug("Correcting original columns")

        # Use the ColumnPreprocessor to correct original columns
        self.current_participant_raw_data_df = self.column_processor.correct_username_column(self.current_participant_raw_data_df)

        self.rename_interaction_types()

        self.correct_event_timestamp_column()

        self.mark_data_time_gaps()

        # Now remove selected interaction types after time gaps have been marked
        self.remove_selected_interaction_types()

        LOGGER.debug("Original columns corrected successfully")

    def mark_data_time_gaps(self) -> None:
        """
        Marks gaps in the data by calculating the time difference between consecutive events.
        """
        LOGGER.debug("Marking data time gaps")
        self.current_participant_raw_data_df = self.timestamp_processor.mark_data_time_gaps(
            self.current_participant_raw_data_df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS
        )
        LOGGER.debug("Data time gaps marked successfully")

    def create_additional_columns(self) -> None:
        """
        Creates additional columns in the dataframe for date, day, weekday, hour, quarter, and possible device model.
        """
        LOGGER.debug("Creating additional columns")

        device_model = self.get_possible_device_model()

        self.current_participant_raw_data_df = self.column_processor.create_additional_columns(self.current_participant_raw_data_df, device_model)

        LOGGER.debug("Additional columns created successfully")

    def label_filtered_apps(self) -> None:
        """
        Filters out apps that are known to not be correctly accounted for by Chronicle, and apps that we have decided against counting as usage such as Settings.
        Currently filters based on the app package name and verifies the app package label.
        Also logs unique unexpected app label matches to a file.
        """
        LOGGER.debug("Labeling filtered apps")

        self.current_participant_raw_data_df = self.app_filter_processor.label_filtered_apps(self.current_participant_raw_data_df)

        LOGGER.debug("Filtered apps labeled successfully")

    def process_filtered_app_usage_rows(self) -> None:
        """
        Processes raw data to determine start and stop
        timestamps for filtered app usage within a study period.
        """
        LOGGER.debug("Processing filtered app usage rows")

        if (
            not self.current_participant_raw_data_df[Column.INTERACTION_TYPE]
            .isin([InteractionType.FILTERED_APP_RESUMED, InteractionType.FILTERED_APP_PAUSED])
            .any()
        ):
            msg = f"{self.current_participant_id} had no apparent usage for filtered out apps within the study period"
            LOGGER.warning(msg)
            return

        self.current_participant_raw_data_df = self.app_usage_processor.process_filtered_app_usage(self.current_participant_raw_data_df)

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
            self.current_participant_raw_data_df = self.app_usage_processor.process_valid_app_usage(self.current_participant_raw_data_df)
            LOGGER.debug("Valid app usage rows processed successfully")
        except pd.errors.EmptyDataError as e:
            msg = f"{self.current_participant_id} had no apparent valid app usage within the study period"
            LOGGER.exception(msg)
            raise pd.errors.EmptyDataError(msg) from e

    def check_data_for_disordered_timestamps(self) -> None:
        """
        Checks for disordered timestamps in the data.
        """
        LOGGER.debug("Checking for disordered timestamps")

        TimestampPreprocessor.check_for_disordered_timestamps(self.current_participant_raw_data_df, Column.START_TIMESTAMP, Column.STOP_TIMESTAMP)

        LOGGER.debug("Disordered timestamps check completed")

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

        preprocessed_data_save_folder = Path(self.options.output_folder) / f"{self.options.study_name + ' ' + PREPROCESSED_FOLDER_SUFFIX}"
        preprocessed_data_save_folder.mkdir(parents=True, exist_ok=True)

        save_name = preprocessed_data_save_folder / f"{Path(raw_data_filename).stem.replace('Raw ', '') + ' ' + PREPROCESSED_FILE_SUFFIX}"
        LOGGER.debug(f"Save name: {save_name}")

        if self.current_participant_raw_data_df.empty:
            LOGGER.warning("Dataframe is empty, saving empty dataframe")
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
                Column.INTERACTION_TYPE,
            ]

            # Timestamp continuation
            timestamp_continuation = [
                Column.START_TIMESTAMP,
                Column.STOP_TIMESTAMP,
                Column.DURATION_SECONDS,
                Column.DURATION_MINUTES,
                Column.ANY_APP_USAGE_FLAGS,
                Column.DATA_TIME_GAP_HOURS,
                Column.ANY_APP_USAGE_TIME_GAP_HOURS,
                Column.DAY,
                Column.WEEKDAY_MF,
                Column.WEEKDAY_MTH,
                Column.WEEKDAY_SUTH,
                Column.HOUR,
                Column.QUARTER,
            ]

            # App usage derived/calculated columns
            app_derived_columns = [
                Column.VALID_APP_NEW_ENGAGE_30S,
                Column.VALID_APP_NEW_ENGAGE_CUSTOM.format(self.options.custom_app_engagement_duration),
                Column.VALID_APP_SWITCHED_APP,
                Column.VALID_APP_USAGE_TIME_GAP_HOURS,
                Column.ANY_APP_NEW_ENGAGE_30S,
                Column.ANY_APP_NEW_ENGAGE_CUSTOM.format(self.options.custom_app_engagement_duration),
                Column.ANY_APP_SWITCHED_APP,
            ]

            # Administrative/Metadata columns
            admin_columns = [
                Column.PREPROCESSOR_VERSION,
                Column.DATETIME_OF_PREPROCESSING,
            ]

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

            LOGGER.debug(f"Including {len(available_columns)} columns in output")
            output_df = output_df[available_columns]

        self.check_data_for_disordered_timestamps()

        if not output_df.empty:
            # Only format columns that exist
            timestamp_columns = [str(col) for col in [Column.START_TIMESTAMP, Column.STOP_TIMESTAMP] if col in output_df.columns]
            if timestamp_columns:
                output_df = self.timestamp_processor.format_timestamps_as_strings(output_df, timestamp_columns, TimestampFormat.DATETIME.value)

        self.remove_selected_interaction_types()

        output_df.to_csv(save_name, index=False)
        LOGGER.debug(f"Preprocessed data saved to {save_name}")

        return preprocessed_data_save_folder

    def add_app_usage_detail_columns(self) -> None:
        """
        Add additional columns to the dataframe for app usage details.
        """
        LOGGER.debug("Adding app usage detail columns")
        self.app_usage_processor.add_app_usage_details(self.current_participant_raw_data_df)
        LOGGER.debug("App usage detail columns added successfully")

    def create_target_child_only_df(self) -> None:
        """
        Creates a separate dataframe with only the target child's data.
        """
        LOGGER.debug("Creating target child only dataframe")
        target_child_mask = self.current_participant_raw_data_df[Column.USERNAME].astype(str).str.contains("Target Child", case=False)
        self.participant_raw_data_df_target_child_only = self.current_participant_raw_data_df[target_child_mask].copy()
        LOGGER.debug("Target child only dataframe created successfully")

    def mark_app_usage_flags(self) -> None:
        """
        Adds flags for app usage patterns.
        """
        LOGGER.debug("Marking app usage flags")
        self.app_usage_processor.add_app_usage_flags(self.current_participant_raw_data_df)
        LOGGER.debug("App usage flags marked successfully")

    def preprocess_Chronicle_Android_raw_data_file(self, raw_data_file: Path | str) -> tuple[Path, bool, dict | None]:
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
            # Read the raw data file
            self.current_participant_raw_data_df = pd.read_csv(Path(raw_data_file), skipinitialspace=True)

            if self.current_participant_raw_data_df.empty:
                LOGGER.warning(f"Raw data file is empty: {raw_data_file}")
                self.stats.mark_error(Path(raw_data_file), "Empty file")
                return Path(preprocessed_data_save_folder), False, None

            # Get participant ID
            self.current_participant_id = self.get_participant_id_from_data()
            LOGGER.info(f"Processing participant {self.current_participant_id}")

            # Fix other original columns
            self.correct_original_columns()

            # Mark data time gaps
            self.mark_data_time_gaps()

            # Create additional columns
            self.create_additional_columns()

            # Label filtered apps
            self.label_filtered_apps()

            # Handle filtered app usage
            self.process_filtered_app_usage_rows()

            # Process valid app usage rows
            self.process_valid_app_usage_rows()

            # Check for disordered timestamps
            self.check_data_for_disordered_timestamps()

            # Add app usage detail columns
            self.add_app_usage_detail_columns()

            # Mark app usage flags
            self.mark_app_usage_flags()

            # Remove unwanted interaction types
            self.remove_selected_interaction_types()

            # Finalize and save
            preprocessed_data_save_folder = self.finalize_and_save_preprocessed_data_df(raw_data_filename=Path(raw_data_file).name)

            LOGGER.debug(f"Preprocessed data for {raw_data_file} saved to {preprocessed_data_save_folder}")
            self.stats.mark_processed(Path(raw_data_file))
            return Path(preprocessed_data_save_folder), True, None

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

        LOGGER.info(f"Preprocessing Chronicle Android raw data files from {self.options.raw_data_folder}")

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
        preprocessed_data_save_folder = str(Path(self.options.output_folder) / f"{self.options.study_name} {PREPROCESSED_FOLDER_SUFFIX}")
        plot_output_folder = str(Path(self.options.output_folder) / f"{self.options.study_name} {PLOTTED_FOLDER_SUFFIX}")

        # If plotting only, skip preprocessing
        if plotting_only:
            LOGGER.info("Plotting only mode - skipping preprocessing")
            if callable(plotting_started_callback) and callable(plotting_completed_callback) and self.options.enable_plotting:
                # Call plotting started callback
                plotting_started_callback()

                # Generate plots
                generate_plots(
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
        preprocessed_file_count = 0
        all_filenames = len(Chronicle_Android_raw_data_files)

        # Process each file
        for i, raw_data_file in enumerate(Chronicle_Android_raw_data_files):
            if self.progress_callback:
                progress_message = f"Processing file {i + 1}/{all_filenames}: {Path(raw_data_file).name}"
                self.progress_callback(progress_message, i + 1, all_filenames)

            try:
                preprocessed_data_save_folder, _, _ = self.preprocess_Chronicle_Android_raw_data_file(Path(raw_data_file))
                preprocessed_file_count += 1
            except Exception as e:
                LOGGER.exception(f"Error preprocessing {raw_data_file}: {e}")
                self.stats.mark_error(Path(raw_data_file), str(e))

        LOGGER.info(f"Preprocessed {preprocessed_file_count} of {len(Chronicle_Android_raw_data_files)} raw data files")

        # Generate plots if enabled
        if callable(plotting_started_callback) and callable(plotting_completed_callback) and self.options.enable_plotting:
            # Call plotting started callback
            plotting_started_callback()

            try:
                # Generate plots
                plot_output_folder, plot_stats = generate_plots(
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

        results_dict = {
            "num_raw_data_files": len(Chronicle_Android_raw_data_files),
            "date_and_time": datetime.now().strftime("%m-%d-%Y %H:%M:%S"),
            "preprocessed_data_save_folder": str(preprocessed_data_save_folder),
            "plot_output_folder": str(plot_output_folder) if plot_output_folder else "Not generated",
            "stats": self.stats.get_summary(),
        }

        LOGGER.info(f"Results: {json.dumps(results_dict, indent=4)}")
        return Path(preprocessed_data_save_folder), self.stats
