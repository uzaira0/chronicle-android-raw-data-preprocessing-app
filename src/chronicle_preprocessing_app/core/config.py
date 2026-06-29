"""Configuration dataclasses for Chronicle Android raw data preprocessing.

This module contains configuration and statistics dataclasses that were
previously in models/. These are framework-agnostic and can be used by any
interface (GUI, CLI, web, or automated pipeline).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import tzinfo
from pathlib import Path
from typing import Any

from chronicle_preprocessing_app.config.constants import (
    InteractionType,
    TimezoneHandlingOption,
    UsageSessionMode,
)
from chronicle_preprocessing_app.config.defaults import (
    DEFAULT_ALLOW_CONCURRENT_USAGE_FALLBACK,
    DEFAULT_ALLOW_STOP_EVENT_REUSE,
    DEFAULT_APP_CODEBOOK_FILE_PATH,
    DEFAULT_APPLY_MINIMUM_USAGE_DURATION_TO_CONCURRENT_SUBINTERVALS,
    DEFAULT_APPLY_THRESHOLD_TO_ACTIVITY_STOPPED_FALLBACK,
    DEFAULT_APPS_FORCING_SCREEN_OPEN_DICT,
    DEFAULT_APPS_FORCING_SCREEN_OPEN_FILE_PATH,
    DEFAULT_APPS_TO_FILTER_DICT,
    DEFAULT_APPS_TO_FILTER_FILE_PATH,
    DEFAULT_AVAILABLE_TIMEZONES,
    DEFAULT_BACKGROUND_APPS_DICT,
    DEFAULT_BACKGROUND_APPS_FILE_PATH,
    DEFAULT_COMPLIANCE_REPORTING,
    DEFAULT_CORRECT_DUPLICATE_EVENT_TIMESTAMPS,
    DEFAULT_CUSTOM_APP_ENGAGEMENT_DURATION,
    DEFAULT_CUSTOM_TIMEZONES,
    DEFAULT_DERIVE_SCREEN_USAGE_SESSIONS,
    DEFAULT_ENABLE_PLOTTING,
    DEFAULT_ENABLE_PREPROCESSING,
    DEFAULT_FILTER_ZERO_DURATION_SESSIONS,
    DEFAULT_FILTERED_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    DEFAULT_FILTERED_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    DEFAULT_INCLUDE_CATEGORY_COLUMN,
    DEFAULT_INCLUDE_FILTERED_APP_USAGE_IN_PLOTS,
    DEFAULT_INTERACTION_TYPES_TO_REMOVE,
    DEFAULT_INTERACTION_TYPES_TO_REMOVE_CONFIGURED,
    DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS,
    DEFAULT_LONG_DURATION_THRESHOLD_HOURS,
    DEFAULT_LONG_USAGE_DURATION_THRESHOLDS,
    DEFAULT_MINIMUM_USAGE_DURATION,
    DEFAULT_MODEL_CONCURRENT_USAGE,
    DEFAULT_OTHER_INTERACTION_TYPES_CONFIGURED,
    DEFAULT_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    DEFAULT_PARALLEL_MAX_WORKERS,
    DEFAULT_PARALLEL_PROCESSING,
    DEFAULT_PLOT_ONLY_TARGET_CHILD_DATA,
    DEFAULT_RAW_DATA_FILE_REGEX_PATTERN,
    DEFAULT_RAW_DATA_FOLDER,
    DEFAULT_SAME_APP_INTERACTION_TYPES_CONFIGURED,
    DEFAULT_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT,
    DEFAULT_SCREEN_USAGE_AUTO_LOCK_TIMEOUT_SECONDS,
    DEFAULT_SCREEN_USAGE_AUTO_LOCK_TOLERANCE_SECONDS,
    DEFAULT_SCREEN_USAGE_KEYGUARD_NEAR_STOP_SECONDS,
    DEFAULT_SCREEN_USAGE_MANUAL_LOCK_MAX_TAIL_GAP_SECONDS,
    DEFAULT_SELECTED_TIMEZONE,
    DEFAULT_STUDY_DATE_MAP,
    DEFAULT_STUDY_NAME,
    DEFAULT_TIMEZONE_HANDLING_OPTION,
    DEFAULT_USAGE_SESSION_MODE,
    DEFAULT_USE_ACTIVITY_STOPPED_AS_FALLBACK,
    DEFAULT_USE_APP_CODEBOOK,
    DEFAULT_USE_APPS_FORCING_SCREEN_OPEN_FILE,
    DEFAULT_USE_BACKGROUND_APPS_FILE,
    DEFAULT_USE_FILTER_FILE,
)

LOGGER = logging.getLogger(__name__)


@dataclass
class PreprocessingOptions:
    """Options for preprocessing Chronicle Android raw data.

    This dataclass contains all configuration needed for preprocessing,
    including file paths, filtering options, timezone handling, and
    algorithm selection.

    Attributes:
        study_name: The name of the study
        raw_data_folder: Path to the folder containing raw data files
        raw_data_file_regex_pattern: Regex pattern to match raw data files
        use_app_codebook: Whether to use app codebook for categorization
        app_codebook_path: Path to the app codebook file
        use_filter_file: Whether to use filter file for app filtering
        filter_file: Path to the file containing filter information
        apps_to_filter_dict: Dictionary of apps to filter
        use_apps_forcing_screen_open_file: Whether to load the apps-forcing-screen-open file
        apps_forcing_screen_open_file: Path to the file containing apps-forcing-screen-open package names
        apps_forcing_screen_open_dict: Dictionary of apps-forcing-screen-open package names to labels or notes
        use_background_apps_file: Whether to load the background-apps file
        background_apps_file: Path to the file containing background-app package names
        background_apps_dict: Dictionary of background-app package names to labels or notes
        usage_session_mode: Which session derivation path to run
        derive_screen_usage_sessions: Whether to append derived screen usage rows
        screen_usage_auto_lock_timeout_seconds: Expected auto-lock timeout, defaulting to 2 minutes
        screen_usage_auto_lock_tolerance_seconds: Window around auto-lock timeout classified as probable auto-lock
        screen_usage_manual_lock_max_tail_gap_seconds: Maximum tail gap classified as probable manual lock
        screen_usage_keyguard_near_stop_seconds: Window for keyguard/screen-off clustering
        minimum_usage_duration: Minimum usage duration in seconds
        custom_app_engagement_duration: Custom app engagement duration in seconds
        long_usage_duration_thresholds: List of long usage duration thresholds in hours
        long_data_time_gap_thresholds: List of long data time gap thresholds in hours
        timezone_handling_option: Option for handling timezones
        available_timezones: List of available timezones from input files
        custom_timezones: List of custom timezones added by user
        selected_timezone: Selected timezone to use
        correct_duplicate_event_timestamps: Whether to correct duplicate event timestamps
        model_concurrent_usage: When True, model overlapping (PiP) usage as primary/secondary layers.
        same_app_interaction_types_to_stop_usage_at: Set of interaction types to stop usage at for the same app
        other_interaction_types_to_stop_usage_at: Set of other interaction types to stop usage at
        interaction_types_to_remove: Set of interaction types to remove from final output
        same_app_interaction_types_configured: Flag indicating if same app interaction types were configured
        other_interaction_types_configured: Flag indicating if other interaction types were configured
        interaction_types_to_remove_configured: Flag indicating if interaction types to remove were configured
        filtered_same_app_interaction_types_to_stop_usage_at: Set of interaction types to stop usage at for filtered apps
        filtered_other_interaction_types_to_stop_usage_at: Set of other interaction types to stop usage at for filtered apps
        include_filtered_app_usage_in_plots: Whether to include filtered app usage in plots
        plot_only_target_child_data: Whether to plot only target child data
        enable_preprocessing: Whether to perform preprocessing
        enable_plotting: Whether to generate plots
        allow_stop_event_reuse: Whether to allow a single stop event to close multiple sessions.
            When False (recommended), each stop event can only close one session. This prevents
            artificially short sessions on Fire tablets where quick Background→Foreground
            transitions generate spurious Activity Stopped events that would otherwise be
            shared between multiple sessions.
        use_activity_stopped_as_fallback: Whether to use Activity Stopped as a fallback stop event
            when configured stop events exceed the long duration threshold (12 hours). When True,
            Activity Stopped will be used if it occurs within the threshold. When False, only
            explicitly configured stop events are used.
        apply_threshold_to_activity_stopped_fallback: Whether to apply the long duration threshold
            check to Activity Stopped when used as fallback. When True (recommended), prevents
            unrealistic long sessions. When False (legacy), Activity Stopped is used without
            threshold check, which can create inflated sessions.
        long_duration_threshold_hours: Maximum session duration in hours. Sessions exceeding this
            threshold are considered unrealistic and are capped or closed using fallback stop
            events. Default is 12 hours.
        filter_zero_duration_sessions: Whether to remove sessions with duration <= 0 from output.
            When True, removes edge cases where duplicate events at the same millisecond create
            spurious 0-duration sessions.
        parallel_processing: Whether to process files in parallel using multiprocessing.
            When True, files are processed concurrently for ~2.5x speedup on multi-core systems.
        parallel_max_workers: Maximum number of parallel worker processes.
            None (default) uses half of CPU cores, which benchmarks show is optimal.
        use_survey_data: Whether to enable survey data processing (internal functionality)
        survey_data_folder: Path to folder containing survey data files
        survey_data_df: Injected survey DataFrame from pipeline (takes priority over folder)
        compliance_reporting: Whether to generate compliance reports
        device_sharing_status_map: Pre-computed device sharing status map from orchestrator
        study_date_map: Pre-computed study date ranges from orchestrator
    """

    study_name: str = DEFAULT_STUDY_NAME
    raw_data_folder: Path | str = DEFAULT_RAW_DATA_FOLDER
    raw_data_file_regex_pattern: str = DEFAULT_RAW_DATA_FILE_REGEX_PATTERN
    use_app_codebook: bool = DEFAULT_USE_APP_CODEBOOK
    app_codebook_path: Path | str = DEFAULT_APP_CODEBOOK_FILE_PATH
    include_category_column: bool = DEFAULT_INCLUDE_CATEGORY_COLUMN
    use_filter_file: bool = DEFAULT_USE_FILTER_FILE
    filter_file: Path | str = DEFAULT_APPS_TO_FILTER_FILE_PATH
    apps_to_filter_dict: dict[str, str] = field(
        default_factory=lambda: dict(DEFAULT_APPS_TO_FILTER_DICT)
    )
    use_apps_forcing_screen_open_file: bool = DEFAULT_USE_APPS_FORCING_SCREEN_OPEN_FILE
    apps_forcing_screen_open_file: Path | str = DEFAULT_APPS_FORCING_SCREEN_OPEN_FILE_PATH
    apps_forcing_screen_open_dict: dict[str, str] = field(
        default_factory=lambda: dict(DEFAULT_APPS_FORCING_SCREEN_OPEN_DICT)
    )
    use_background_apps_file: bool = DEFAULT_USE_BACKGROUND_APPS_FILE
    background_apps_file: Path | str = DEFAULT_BACKGROUND_APPS_FILE_PATH
    background_apps_dict: dict[str, str] = field(
        default_factory=lambda: dict(DEFAULT_BACKGROUND_APPS_DICT)
    )
    usage_session_mode: UsageSessionMode | str = DEFAULT_USAGE_SESSION_MODE
    derive_screen_usage_sessions: bool = DEFAULT_DERIVE_SCREEN_USAGE_SESSIONS
    screen_usage_auto_lock_timeout_seconds: int = DEFAULT_SCREEN_USAGE_AUTO_LOCK_TIMEOUT_SECONDS
    screen_usage_auto_lock_tolerance_seconds: int = DEFAULT_SCREEN_USAGE_AUTO_LOCK_TOLERANCE_SECONDS
    screen_usage_manual_lock_max_tail_gap_seconds: int = (
        DEFAULT_SCREEN_USAGE_MANUAL_LOCK_MAX_TAIL_GAP_SECONDS
    )
    screen_usage_keyguard_near_stop_seconds: int = DEFAULT_SCREEN_USAGE_KEYGUARD_NEAR_STOP_SECONDS
    minimum_usage_duration: int = DEFAULT_MINIMUM_USAGE_DURATION
    custom_app_engagement_duration: int = DEFAULT_CUSTOM_APP_ENGAGEMENT_DURATION
    long_usage_duration_thresholds: list[int] = field(
        default_factory=lambda: list(DEFAULT_LONG_USAGE_DURATION_THRESHOLDS)
    )
    long_data_time_gap_thresholds: list[int] = field(
        default_factory=lambda: list(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS)
    )
    timezone_handling_option: TimezoneHandlingOption = DEFAULT_TIMEZONE_HANDLING_OPTION
    available_timezones: list[str] = field(
        default_factory=lambda: list(DEFAULT_AVAILABLE_TIMEZONES)
    )
    custom_timezones: list[str] = field(default_factory=lambda: list(DEFAULT_CUSTOM_TIMEZONES))
    selected_timezone: str | tzinfo | None = DEFAULT_SELECTED_TIMEZONE
    correct_duplicate_event_timestamps: bool = DEFAULT_CORRECT_DUPLICATE_EVENT_TIMESTAMPS
    model_concurrent_usage: bool = DEFAULT_MODEL_CONCURRENT_USAGE
    apply_minimum_usage_duration_to_concurrent_subintervals: bool = (
        DEFAULT_APPLY_MINIMUM_USAGE_DURATION_TO_CONCURRENT_SUBINTERVALS
    )
    allow_concurrent_usage_fallback: bool = DEFAULT_ALLOW_CONCURRENT_USAGE_FALLBACK

    same_app_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: set(DEFAULT_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT)
    )

    other_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: set(DEFAULT_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT)
    )

    interaction_types_to_remove: set[InteractionType] = field(
        default_factory=lambda: set(DEFAULT_INTERACTION_TYPES_TO_REMOVE)
    )

    same_app_interaction_types_configured: bool = DEFAULT_SAME_APP_INTERACTION_TYPES_CONFIGURED
    other_interaction_types_configured: bool = DEFAULT_OTHER_INTERACTION_TYPES_CONFIGURED
    interaction_types_to_remove_configured: bool = DEFAULT_INTERACTION_TYPES_TO_REMOVE_CONFIGURED

    filtered_same_app_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: set(DEFAULT_FILTERED_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT)
    )

    filtered_other_interaction_types_to_stop_usage_at: set[InteractionType] = field(
        default_factory=lambda: set(DEFAULT_FILTERED_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT)
    )

    include_filtered_app_usage_in_plots: bool = DEFAULT_INCLUDE_FILTERED_APP_USAGE_IN_PLOTS
    plot_only_target_child_data: bool = DEFAULT_PLOT_ONLY_TARGET_CHILD_DATA
    enable_preprocessing: bool = DEFAULT_ENABLE_PREPROCESSING
    enable_plotting: bool = DEFAULT_ENABLE_PLOTTING
    # Kept for serialization compatibility only: algorithm selection has been removed.
    # OptimizedAppUsageAlgorithm is always used. Any value set here is silently ignored.
    app_usage_algorithm: str = "optimized"
    allow_stop_event_reuse: bool = DEFAULT_ALLOW_STOP_EVENT_REUSE
    # This prevents artificially short sessions on Fire tablets where quick
    # Background→Foreground transitions generate spurious Activity Stopped events.
    use_activity_stopped_as_fallback: bool = DEFAULT_USE_ACTIVITY_STOPPED_AS_FALLBACK
    apply_threshold_to_activity_stopped_fallback: bool = (
        DEFAULT_APPLY_THRESHOLD_TO_ACTIVITY_STOPPED_FALLBACK
    )
    long_duration_threshold_hours: float = DEFAULT_LONG_DURATION_THRESHOLD_HOURS
    # Sessions exceeding this threshold are considered unrealistic and are capped or
    # closed using fallback stop events. Default is 12 hours.
    # Intra-app teardown grace (seconds). When > 0, an Activity-Stopped *fallback* close
    # that lands within this window of a RE-RESUMED session's start is an intra-app
    # teardown artifact (app torn down then immediately re-resumed), NOT a real close —
    # the session stays open for the next proper closer. 0 = off. Implemented in the
    # Python matcher (the Rust matcher has no proximity parameter, so proximity > 0
    # forces the Python matcher).
    proximity_interval_seconds: float = 0.0
    filter_zero_duration_sessions: bool = DEFAULT_FILTER_ZERO_DURATION_SESSIONS
    parallel_processing: bool = DEFAULT_PARALLEL_PROCESSING
    parallel_max_workers: int | None = DEFAULT_PARALLEL_MAX_WORKERS
    compliance_reporting: bool = DEFAULT_COMPLIANCE_REPORTING
    study_date_map: dict[str, tuple[Any, Any]] | None = DEFAULT_STUDY_DATE_MAP
    # Internal/test-only override for deterministic output stamping.
    datetime_of_preprocessing_override: str | None = None

    # --- Internal/pipeline-only fields (requires chronicle-preprocessing-internal) ---
    use_survey_data: Any = False
    survey_data_folder: Any = ""
    survey_data_df: Any = None
    # Dependency injection: Pre-computed device sharing status map from orchestrator
    # When provided, skips TrackingSheet/Selenium initialization entirely
    # Keys are participant IDs, values are "Shared" or "Non-Shared"
    # If None, falls back to fetching from REDCap via TrackingSheet (standalone mode)
    device_sharing_status_map: Any = None

    def __post_init__(self) -> None:
        """Post-initialization processing to map interaction types."""
        LOGGER.debug("Initialized PreprocessingOptions")

        if not isinstance(self.usage_session_mode, UsageSessionMode):
            self.usage_session_mode = UsageSessionMode(self.usage_session_mode)

        # Backward compatibility for configs saved before usage_session_mode existed.
        if (
            self.derive_screen_usage_sessions
            and self.usage_session_mode == UsageSessionMode.APP_USAGE
        ):
            self.usage_session_mode = UsageSessionMode.APP_AND_SCREEN_USAGE

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
        self.filtered_other_interaction_types_to_stop_usage_at = (
            self.other_interaction_types_to_stop_usage_at.copy()
        )

    @property
    def process_app_usage_sessions(self) -> bool:
        """Whether configured preprocessing should derive app usage sessions."""
        return self.usage_session_mode in {
            UsageSessionMode.APP_USAGE,
            UsageSessionMode.APP_AND_SCREEN_USAGE,
        }

    @property
    def process_screen_usage_sessions(self) -> bool:
        """Whether configured preprocessing should derive screen usage sessions."""
        return self.usage_session_mode in {
            UsageSessionMode.SCREEN_USAGE,
            UsageSessionMode.APP_AND_SCREEN_USAGE,
        }

    @property
    def output_folder(self) -> Path:
        """Get the output folder path based on the raw data folder.

        Returns:
            Path: The output folder path
        """
        output_folder = Path(self.raw_data_folder).parent
        LOGGER.debug(f"Output folder determined: {output_folder}")
        return output_folder


@dataclass
class ProcessingStats:
    """Statistics tracking for file processing operations.

    This dataclass tracks success, failure, and warning statistics during
    preprocessing and plotting operations.

    Attributes:
        total_files: Total number of files found for processing
        processed_files: Number of files successfully processed
        failed_files: Number of files that failed processing
        empty_files: Number of files with no valid app usage data
        plotted_files: Number of files successfully plotted
        plot_failed_files: Number of files that failed plotting
        empty_plot_files: Number of files with no plottable data
        plot_warnings: Number of files with plotting warnings
        errors: Dictionary mapping filenames to their error messages
        file_errors: Dictionary of specific error types per file
        warnings: Dictionary mapping filenames to their warning messages
        processed_file_paths: Set of successfully processed file paths
        plot_error_types: Dictionary mapping error types to count during plotting
        plot_success_types: Dictionary mapping success types to count during plotting
    """

    total_files: int = 0
    processed_files: int = 0
    failed_files: int = 0
    empty_files: int = 0
    plotted_files: int = 0
    plot_failed_files: int = 0
    empty_plot_files: int = 0
    plot_warnings: int = 0
    errors: dict[str, str] = field(default_factory=dict)
    file_errors: dict[str, list[str]] = field(default_factory=dict)
    warnings: dict[str, list[str]] = field(default_factory=dict)
    processed_file_paths: set[Path] = field(default_factory=set)
    plot_error_types: dict[str, int] = field(default_factory=dict)
    plot_success_types: dict[str, int] = field(default_factory=dict)

    def add_error(self, filename: str, error_message: str) -> None:
        """Add an error for a specific file.

        Args:
            filename: Name of the file with the error
            error_message: The error message
        """
        self.errors[filename] = error_message
        self.failed_files += 1
        LOGGER.error(f"Error processing {filename}: {error_message}")

    def add_file_error(self, filename: str, error_type: str) -> None:
        """Add a specific error type for a file.

        Args:
            filename: Name of the file
            error_type: Type of error encountered
        """
        if filename not in self.file_errors:
            self.file_errors[filename] = []
        self.file_errors[filename].append(error_type)
        LOGGER.error(f"{error_type} error in {filename}")

    def add_warning(self, filename: str, warning_message: str) -> None:
        """Add a warning for a specific file.

        Args:
            filename: Name of the file with the warning
            warning_message: The warning message
        """
        if filename not in self.warnings:
            self.warnings[filename] = []
        self.warnings[filename].append(warning_message)
        LOGGER.warning(f"Warning for {filename}: {warning_message}")

    def mark_empty_file(self, filename: str) -> None:
        """Mark a file as empty (no valid app usage data).

        Args:
            filename: Name of the empty file
        """
        self.empty_files += 1
        self.add_warning(filename, "No valid app usage data found")

    def mark_processed(self, file_path: Path) -> None:
        """Mark a file as successfully processed.

        Args:
            file_path: Path of the processed file
        """
        self.processed_files += 1
        self.processed_file_paths.add(file_path)

    def mark_error(self, file_path: Path, error_message: str) -> None:
        """Mark a file as having an error during processing.

        Args:
            file_path: Path of the file with an error
            error_message: The error message
        """
        self.add_error(str(file_path), error_message)

    def mark_plotted(self, filename: str, success_type: str = "general") -> None:
        """Mark a file as successfully plotted.

        Args:
            filename: Name of the plotted file
            success_type: Type of success during plotting
        """
        self.plotted_files += 1

        if success_type not in self.plot_success_types:
            self.plot_success_types[success_type] = 0
        self.plot_success_types[success_type] += 1

    def mark_plot_failed(
        self, filename: str, error_message: str, error_type: str = "general"
    ) -> None:
        """Mark a file as failed during plotting.

        Args:
            filename: Name of the file that failed plotting
            error_message: The error message
            error_type: Type of error encountered during plotting
        """
        self.plot_failed_files += 1
        self.add_error(f"{filename} (plotting)", error_message)

        if error_type not in self.plot_error_types:
            self.plot_error_types[error_type] = 0
        self.plot_error_types[error_type] += 1

    def mark_empty_plot_file(self, filename: str) -> None:
        """Mark a file as empty for plotting purposes.

        Args:
            filename: Name of the empty file
        """
        self.empty_plot_files += 1
        self.add_warning(filename, "No plottable data found")

    def add_plot_warning(self, filename: str, warning_message: str) -> None:
        """Add a warning specific to plotting.

        Args:
            filename: Name of the file with the warning
            warning_message: The warning message
        """
        self.plot_warnings += 1
        self.add_warning(f"{filename} (plotting)", warning_message)

    def get_summary(self) -> str:
        """Get a summary of the processing statistics.

        Returns:
            str: A formatted summary message
        """
        summary: list[str] = [
            f"Total files found: {self.total_files}",
            f"Successfully processed: {self.processed_files}/{self.total_files}",
            f"Files with no valid app usage: {self.empty_files}",
            f"Failed to process: {self.failed_files}",
        ]

        if self.plotted_files > 0 or self.plot_failed_files > 0 or self.empty_plot_files > 0:
            summary.append(f"Successfully plotted: {self.plotted_files}/{self.processed_files}")
            if self.empty_plot_files > 0:
                summary.append(f"Files with no plottable data: {self.empty_plot_files}")
            if self.plot_warnings > 0:
                summary.append(f"Files with plotting warnings: {self.plot_warnings}")
            if self.plot_failed_files > 0:
                summary.append(f"Failed to plot: {self.plot_failed_files}")

            if self.plot_error_types:
                summary.append("\nPlotting error types:")
                for error_type, count in self.plot_error_types.items():
                    summary.append(f"  - {error_type}: {count}")

            if self.plot_success_types:
                summary.append("\nPlotting success types:")
                for success_type, count in self.plot_success_types.items():
                    summary.append(f"  - {success_type}: {count}")

        return "\n".join(summary)

    def add_plot_error(
        self, filename: str, error_message: str, error_type: str = "general"
    ) -> None:
        """Add a specific error related to plot generation.

        Args:
            filename: Name of the file with the error
            error_message: The error message
            error_type: Type of error encountered during plotting
        """
        self.mark_plot_failed(filename, error_message, error_type)

    def success_rate(self) -> float:
        """Calculate the success rate of file processing.

        Returns:
            float: The success rate as a percentage (0-100)
        """
        if self.total_files == 0:
            return 0.0

        return (self.processed_files / self.total_files) * 100.0

    def summary(self) -> str:
        """Get a short summary of the processing statistics.

        Returns:
            str: A short summary message
        """
        success_pct = self.success_rate()
        plot_success_pct = (
            (self.plotted_files / self.processed_files) * 100.0 if self.processed_files > 0 else 0.0
        )

        summary_text = (
            f"Processed {self.processed_files}/{self.total_files} files ({success_pct:.1f}%)"
        )

        if self.plotted_files > 0:
            summary_text += f", Plotted {self.plotted_files}/{self.processed_files} files ({plot_success_pct:.1f}%)"

        if self.failed_files > 0:
            summary_text += f", Failed: {self.failed_files}"

        if self.empty_files > 0:
            summary_text += f", Empty: {self.empty_files}"

        return summary_text

    def get_detailed_summary(self) -> str:
        """Get a detailed summary including errors and warnings.

        Returns:
            str: A detailed summary message
        """
        summary: str = self.get_summary() + "\n\n"

        if self.errors:
            summary += "Errors:\n"
            for filename, error in self.errors.items():
                summary += f"- {filename}: {error}\n"
            summary += "\n"

        if self.warnings:
            summary += "Warnings:\n"
            for filename, warning_list in self.warnings.items():
                for warning in warning_list:
                    summary += f"- {filename}: {warning}\n"

        return summary


# Create type alias for backwards compatibility
ChronicleAndroidRawDataPreprocessingOptions = PreprocessingOptions
