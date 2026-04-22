"""Centralized defaults for preprocessing configuration."""

from __future__ import annotations

import os

from chronicle_preprocessing_app.config.constants import FileRegexPattern, InteractionType, TimezoneHandlingOption

# Core identification and input defaults
DEFAULT_STUDY_NAME: str = ""
DEFAULT_RAW_DATA_FOLDER: str = ""
DEFAULT_RAW_DATA_FILE_REGEX_PATTERN: str = FileRegexPattern.RAW_DATA

# App codebook defaults
DEFAULT_USE_APP_CODEBOOK: bool = True
DEFAULT_APP_CODEBOOK_FILE_PATH = (
    "./app_codebook_files/Chronicle_Android_raw_data_preprocessor_app_codebook.xlsx"
)

# App filter defaults
DEFAULT_USE_FILTER_FILE: bool = True
DEFAULT_APPS_TO_FILTER_FILE_PATH = (
    "./apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
)
DEFAULT_APPS_TO_FILTER_DICT: dict[str, str] = {"": ""}

# Usage thresholds
DEFAULT_MINIMUM_USAGE_DURATION: int = int(os.getenv("CHRONICLE_MIN_USAGE_DURATION", "0"))
DEFAULT_CUSTOM_APP_ENGAGEMENT_DURATION: int = int(
    os.getenv("CHRONICLE_CUSTOM_APP_ENGAGEMENT_DURATION", "300")
)
DEFAULT_DATA_TIME_GAP_THRESHOLD: int = int(os.getenv("CHRONICLE_DATA_TIME_GAP_THRESHOLD", "3"))
DEFAULT_LONG_DURATION_THRESHOLD_SECONDS: int = int(
    os.getenv("CHRONICLE_LONG_DURATION_THRESHOLD_SECONDS", str(12 * 3600))
)
DEFAULT_NEW_ENGAGEMENT_GAP_SECONDS: int = int(
    os.getenv("CHRONICLE_NEW_ENGAGEMENT_GAP_SECONDS", "30")
)
DEFAULT_LONG_USAGE_DURATION_THRESHOLDS: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)

# Timezone handling
DEFAULT_TIMEZONE_HANDLING_OPTION: TimezoneHandlingOption = (
    TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE
)
DEFAULT_AVAILABLE_TIMEZONES: tuple[str, ...] = ()
DEFAULT_CUSTOM_TIMEZONES: tuple[str, ...] = ()
DEFAULT_SELECTED_TIMEZONE = None

# Timestamp handling
DEFAULT_CORRECT_DUPLICATE_EVENT_TIMESTAMPS: bool = True

# Interaction type defaults
DEFAULT_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT: frozenset[InteractionType] = frozenset(
    {
        InteractionType.ACTIVITY_PAUSED,
        InteractionType.ACTIVITY_RESUMED,
    }
)
DEFAULT_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT: frozenset[InteractionType] = frozenset(
    {
        InteractionType.ACTIVITY_RESUMED,
        InteractionType.FILTERED_APP_RESUMED,
        InteractionType.FILTERED_APP_USAGE,
        InteractionType.DEVICE_SHUTDOWN,
    }
)
DEFAULT_INTERACTION_TYPES_TO_REMOVE: frozenset[InteractionType] = frozenset()

DEFAULT_SAME_APP_INTERACTION_TYPES_CONFIGURED: bool = False
DEFAULT_OTHER_INTERACTION_TYPES_CONFIGURED: bool = False
DEFAULT_INTERACTION_TYPES_TO_REMOVE_CONFIGURED: bool = False

DEFAULT_FILTERED_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT: frozenset[InteractionType] = (
    frozenset(
        {
            InteractionType.FILTERED_APP_PAUSED,
            InteractionType.FILTERED_APP_STOPPED,
        }
    )
)
DEFAULT_FILTERED_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT: frozenset[InteractionType] = frozenset(
    {
        InteractionType.ACTIVITY_RESUMED,
        InteractionType.DEVICE_SHUTDOWN,
    }
)

# Plotting defaults
DEFAULT_INCLUDE_FILTERED_APP_USAGE_IN_PLOTS: bool = False
DEFAULT_PLOT_ONLY_TARGET_CHILD_DATA: bool = True

# Pipeline toggles
DEFAULT_ENABLE_PREPROCESSING: bool = True
DEFAULT_ENABLE_PLOTTING: bool = True

# Algorithm defaults
DEFAULT_ALLOW_STOP_EVENT_REUSE: bool = False
DEFAULT_USE_ACTIVITY_STOPPED_AS_FALLBACK: bool = True
DEFAULT_APPLY_THRESHOLD_TO_ACTIVITY_STOPPED_FALLBACK: bool = True
DEFAULT_LONG_DURATION_THRESHOLD_HOURS: float = 12.0
DEFAULT_FILTER_ZERO_DURATION_SESSIONS: bool = False

# Parallel processing defaults
DEFAULT_PARALLEL_PROCESSING: bool = False
DEFAULT_PARALLEL_MAX_WORKERS = None

# Survey/compliance defaults
DEFAULT_USE_SURVEY_DATA: bool = False
DEFAULT_SURVEY_DATA_FOLDER: str = ""
DEFAULT_SURVEY_DATA_DF = None
DEFAULT_COMPLIANCE_REPORTING: bool = False
DEFAULT_DEVICE_SHARING_STATUS: str = "Non-Shared"
DEFAULT_DEVICE_SHARING_STATUS_MAP = None
DEFAULT_STUDY_DATE_MAP = None
