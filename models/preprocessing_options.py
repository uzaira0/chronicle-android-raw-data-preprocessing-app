"""
Options data model for Chronicle Android Raw Data Preprocessing
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import tzinfo
from pathlib import Path

from config.constants import (
    DEFAULT_APP_CODEBOOK_FILE_PATH,
    DEFAULT_APPS_TO_FILTER_FILE_PATH,
    DEFAULT_CUSTOM_APP_ENGAGEMENT_DURATION,
    DEFAULT_MINIMUM_USAGE_DURATION,
    POSSIBLE_INTERACTION_TYPES_TO_REMOVE,
    POSSIBLE_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    POSSIBLE_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    FileRegexPattern,
    InteractionType,
    TimezoneHandlingOption,
)


@dataclass
class ChronicleAndroidRawDataPreprocessingOptions:
    """
    Options class for preprocessing Chronicle Android raw data.

    Attributes:
        study_name: The name of the study.
        raw_data_folder: Path to the folder containing raw data files.
        raw_data_file_regex_pattern: Regex pattern to match raw data files.
        filter_file: Path to the file containing filter information.
        apps_to_filter_dict: Dictionary of apps to filter.
        minimum_usage_duration: Minimum usage duration required for an instance of app usage to be counted, in seconds.
        custom_app_engagement_duration: Custom app engagement duration, in seconds.
        long_usage_duration_thresholds: List of long usage duration thresholds, in hours.
        long_data_time_gap_thresholds: List of long data time gap thresholds, in hours.
        timezone_handling_option: Option for handling timezones.
        available_timezones: List of available timezones from input files.
        selected_timezone: Selected timezone to use.
        correct_duplicate_event_timestamps: Flag indicating whether to correct duplicate event timestamps.
        same_app_interaction_types_to_stop_usage_at: Set of interaction types to stop usage at for the same app.
        other_interaction_types_to_stop_usage_at: Set of other interaction types to stop usage at.
        interaction_types_to_remove: Set of interaction types to remove from final output.
        same_app_interaction_types_configured: Flag indicating if same app interaction types were configured.
        other_interaction_types_configured: Flag indicating if other interaction types were configured.
        interaction_types_to_remove_configured: Flag indicating if interaction types to remove were configured.
        filtered_same_app_interaction_types_to_stop_usage_at: Set of interaction types to stop usage at for filtered apps.
        filtered_other_interaction_types_to_stop_usage_at: Set of other interaction types to stop usage at for filtered apps.
    """

    study_name: str = ""
    raw_data_folder: Path | str = ""
    raw_data_file_regex_pattern: str = FileRegexPattern.RAW_DATA
    use_app_codebook: bool = True
    app_codebook_path: Path | str = DEFAULT_APP_CODEBOOK_FILE_PATH
    use_filter_file: bool = True
    filter_file: Path | str = DEFAULT_APPS_TO_FILTER_FILE_PATH
    apps_to_filter_dict: dict[str, str] = field(default_factory=lambda: {"": ""})
    minimum_usage_duration: int = DEFAULT_MINIMUM_USAGE_DURATION  # in seconds
    custom_app_engagement_duration: int = DEFAULT_CUSTOM_APP_ENGAGEMENT_DURATION  # in seconds
    long_usage_duration_thresholds: list[int] = field(default_factory=lambda: [1, 6, 12, 24])  # in hours
    long_data_time_gap_thresholds: list[int] = field(default_factory=lambda: [1, 6, 12, 24])  # in hours
    timezone_handling_option: TimezoneHandlingOption = TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE
    available_timezones: list[str] = field(default_factory=list)  # Available timezones from input files
    custom_timezones: list[str] = field(default_factory=list)  # Custom timezones added by user
    selected_timezone: str | tzinfo | None = None
    correct_duplicate_event_timestamps: bool = True

    same_app_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: set(POSSIBLE_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT.values())
    )

    other_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: set(POSSIBLE_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT.values())
    )

    interaction_types_to_remove: set[InteractionType] = field(default_factory=lambda: set(POSSIBLE_INTERACTION_TYPES_TO_REMOVE.values()))

    same_app_interaction_types_configured: bool = False
    other_interaction_types_configured: bool = False
    interaction_types_to_remove_configured: bool = False

    filtered_same_app_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: {InteractionType.FILTERED_APP_PAUSED, InteractionType.FILTERED_APP_STOPPED}
    )

    filtered_other_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: {InteractionType.ACTIVITY_RESUMED, InteractionType.DEVICE_SHUTDOWN}
    )

    # Plotting options
    include_filtered_app_usage_in_plots: bool = False  # Whether to include filtered app usage in plots
    plot_only_target_child_data: bool = False  # Whether to plot only target child data

    # Process control options
    enable_preprocessing: bool = True  # Whether to perform preprocessing
    enable_plotting: bool = True  # Whether to generate plots

    def __post_init__(self) -> None:
        """
        Post-initialization processing.
        """
        import logging

        LOGGER = logging.getLogger(__name__)
        LOGGER.debug("Initialized ChronicleAndroidRawDataPreprocessingOptions")

        # Map valid app interaction types to their filtered counterparts
        filtered_same_app_types = set()
        for interaction_type in self.same_app_interaction_types_to_stop_usage_at:
            if interaction_type == InteractionType.ACTIVITY_PAUSED:
                filtered_same_app_types.add(InteractionType.FILTERED_APP_PAUSED)
            elif interaction_type == InteractionType.ACTIVITY_STOPPED:
                filtered_same_app_types.add(InteractionType.FILTERED_APP_STOPPED)
            elif interaction_type == InteractionType.ACTIVITY_DESTROYED:
                filtered_same_app_types.add(InteractionType.FILTERED_APP_DESTROYED)
            elif interaction_type == InteractionType.ACTIVITY_RESUMED:
                filtered_same_app_types.add(InteractionType.FILTERED_APP_RESUMED)

        self.filtered_same_app_interaction_types_to_stop_usage_at = filtered_same_app_types

        # For other interaction types, we use the same types since they're not app-specific
        self.filtered_other_interaction_types_to_stop_usage_at = self.other_interaction_types_to_stop_usage_at.copy()

    @property
    def output_folder(self) -> Path:
        """
        Get the output folder path based on the raw data folder.

        Returns:
            Path: The output folder path.
        """
        import logging

        LOGGER = logging.getLogger(__name__)
        output_folder = Path(self.raw_data_folder).parent
        LOGGER.debug(f"Output folder determined: {output_folder}")
        return output_folder
