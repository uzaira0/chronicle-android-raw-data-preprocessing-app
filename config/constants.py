"""
Constants for the Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

from enum import Enum, StrEnum

# ====== Default string values =======

# Log file and directory names
LOG_DIR_NAME = "logs"
LOG_FILE_NAME = "Chronicle_Android_raw_data_preprocessing_app.log"

# Log format
LOG_FORMAT = "%(asctime)s.%(msecs)03d - %(process)d - %(thread)d - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(funcName)s - %(message)s"

# App display name
APP_DISPLAY_NAME = "Chronicle Android Raw Data Preprocessing App"

# User-related constants
TARGET_CHILD_USERNAME = "Target Child"

# File name components
PREPROCESSED_FILE_SUFFIX = "Automatically Preprocessed.csv"
PREPROCESSED_FOLDER_SUFFIX = "Chronicle Android Automatically Preprocessed Data"
PLOTTED_FOLDER_SUFFIX = "Chronicle Android Plotted Data"

# Default file paths
DEFAULT_APPS_TO_FILTER_FILE_PATH = "./apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
DEFAULT_APP_CODEBOOK_FILE_PATH = "./app_codebook_files/Chronicle_Android_raw_data_preprocessor_app_codebook.xlsx"

# Default device sharing status
DEFAULT_DEVICE_SHARING_STATUS = "Non-Shared"  # Default to non-shared devices if not specified


# ====== Default int values =======
DEFAULT_MINIMUM_USAGE_DURATION = 0  # in seconds
DEFAULT_CUSTOM_APP_ENGAGEMENT_DURATION = 300  # in seconds
DEFAULT_DATA_TIME_GAP_THRESHOLD = 3  # default threshold for flagging gaps without data

EXPECTED_TIMESTAMP_LENGTH = 25  # expected length of timestamp string from Chronicle data in characters


# ====== Enum classes =======


class DeviceSharingStatus(StrEnum):
    """
    StrEnum representing different device sharing statuses.
    This replaces the enum from P01_classes to avoid external dependencies.
    This will be removed in a future update.
    """

    SHARED = "Shared"
    NONSHARED = "Non-Shared"


class TimezoneHandlingOption(Enum):
    """
    Enum representing different options for handling timezones in the data.
    Marked as enum specifically to correspond with radio buttons in the UI which use ints.

    Options:
    - REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE: Removes data with timezones different from the selected one
    - CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE: Keeps all data and converts to the selected timezone
    - REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE: For each file, identifies primary timezone and removes data with different timezones
    - CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE: For each file, identifies primary timezone and converts all data to that timezone
    """

    REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE = 0
    CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE = 1
    REMOVE_ALL_DATA_WITHOUT_PRIMARY_TIMEZONE_PER_FILE = 2
    CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE = 3


class ChronicleDeviceType(StrEnum):
    """
    StrEnum representing different types of Chronicle devices.
    """

    AMAZON = "Amazon Fire"
    ANDROID = "Android"


class InteractionType(StrEnum):
    """
    StrEnum representing different types of interactions in the Chronicle data.
    """

    ACTIVITY_RESUMED = "Activity Resumed"
    ACTIVITY_PAUSED = "Activity Paused"
    APP_USAGE = "App Usage"
    APP_LAUNCH = "App Launch"
    END_OF_DAY = "End of Day"
    CONTINUE_PREVIOUS_DAY = "Continue Previous Day"
    CONFIGURATION_CHANGE = "Configuration Change"
    SYSTEM_INTERACTION = "System Interaction"
    USER_INTERACTION = "User Interaction"
    SHORTCUT_INVOCATION = "Shortcut Invocation"
    CHOOSER_ACTION = "Chooser Action"
    NOTIFICATION_SEEN = "Notification Seen"
    NOTIFICATION_RECEIVED = "Notification Received"
    NOTIFICATION_REMOVED = "Notification Removed"
    STANDBY_BUCKET_CHANGED = "Standby Bucket Changed"
    NOTIFICATION_INTERRUPTION = "Notification Interruption"
    SLICE_PINNED_PRIV = "Slice Pinned Priv"
    SLICE_PINNED_APP = "Slice Pinned App"
    SCREEN_INTERACTIVE = "Screen Interactive"
    SCREEN_NON_INTERACTIVE = "Screen Non-Interactive"
    DEVICE_SCREEN_OFF = "Device Screen Off"
    KEYGUARD_SHOWN = "Keyguard Shown"
    KEYGUARD_HIDDEN = "Keyguard Hidden"
    SCREEN_INTERACTIVE_KEYGUARD_SHOWN = "Screen Interactive/Keyguard Shown"
    SCREEN_NON_INTERACTIVE_KEYGUARD_HIDDEN = "Screen Non-Interactive/Keyguard Hidden"
    FOREGROUND_SERVICE_START = "Foreground Service Start"
    FOREGROUND_SERVICE_STOP = "Foreground Service Stop"
    CONTINUING_FOREGROUND_SERVICE = "Continuing Foreground Service"
    ROLLOVER_FOREGROUND_SERVICE = "Rollover Foreground Service"
    ACTIVITY_STOPPED = "Activity Stopped"
    ACTIVITY_DESTROYED = "Activity Destroyed"
    FLUSH_TO_DISK = "Flush to Disk"
    DEVICE_SHUTDOWN = "Device Shutdown"
    DEVICE_STARTUP = "Device Startup"
    USER_UNLOCKED = "User Unlocked"
    USER_STOPPED = "User Stopped"
    LOCUS_ID_SET = "Locus ID Set"
    APP_COMPONENT_USED = "App Component Used"
    FILTERED_APP_RESUMED = "Filtered App Resumed"
    FILTERED_APP_PAUSED = "Filtered App Paused"
    FILTERED_APP_STOPPED = "Filtered App Stopped"
    FILTERED_APP_DESTROYED = "Filtered App Destroyed"
    FILTERED_APP_USAGE = "Filtered App Usage"
    END_OF_USAGE_MISSING = "End of Usage Missing"
    NON_TARGET_CHILD_APP_USAGE = "Non-Target Child App Usage"


class FileRegexPattern(StrEnum):
    """
    StrEnum representing different regex patterns for file names.
    """

    RAW_DATA = r"[\s\S]*.csv"


class TimestampFormat(StrEnum):
    """
    StrEnum representing different timestamp formats.
    """

    TIME_ONLY = "%H:%M:%S"
    DATETIME = "%m-%d-%Y %H:%M:%S"


class AppCodebookColumn(StrEnum):
    """Column names used in the app codebook file."""

    APP_PACKAGE_NAME = "app_package_name"
    BROAD_APP_CATEGORY = "broad_app_category"
    GENRE_ID = "genreId"
    DATASET = "dataset"


class Column(StrEnum):
    """
    StrEnum representing column names used in dataframes.
    """

    EVENT_TIMESTAMP = "event_timestamp"
    START_TIMESTAMP = "start_timestamp"
    STOP_TIMESTAMP = "stop_timestamp"
    PARTICIPANT_ID = "participant_id"
    INTERACTION_TYPE = "interaction_type"
    APP_PACKAGE_NAME = "app_package_name"
    APPLICATION_LABEL = "application_label"
    USERNAME = "username"
    DURATION_SECONDS = "duration_seconds"
    DURATION_MINUTES = "duration_minutes"
    TIMEZONE = "timezone"
    DATA_TIME_GAP_HOURS = "data_time_gap_hours"
    DATE = "date"
    DATETIME_OF_PREPROCESSING = "datetime_of_preprocessing"
    DAY = "day"
    DURATION = "duration"
    POSSIBLE_DEVICE_MODEL = "possible_device_model"
    PREPROCESSOR_VERSION = "preprocessor_version"
    STUDY_ID = "study_id"
    WEEKDAY_MF = "weekdayMF"
    WEEKDAY_MTH = "weekdayMTh"
    WEEKDAY_SUTH = "weekdaySuTh"
    HOUR = "hour"
    QUARTER = "quarter"
    BROAD_APP_CATEGORY = "broad_app_category"
    GENRE_ID_SCRAPED = "genreId_scraped"

    # App usage related columns
    APP_NEW_ENGAGE_30S = "app_new_engage_30s"
    APP_SWITCHED_APP = "app_switched_app"
    APP_USAGE_TIME_GAP = "app_usage_time_gap"
    ANY_APP_NEW_ENGAGE_30S = "any_app_new_engage_30s"
    ANY_APP_SWITCHED_APP = "any_app_switched_app"
    ANY_APP_USAGE_TIME_GAP_HOURS = "any_app_usage_time_gap"
    ANY_APP_USAGE_FLAGS = "any_app_usage_flags"

    # Additional validated columns from preprocessors
    VALID_APP_NEW_ENGAGE_30S = "valid_app_new_engage_30s"
    VALID_APP_SWITCHED_APP = "valid_app_switched_app"
    VALID_APP_USAGE_TIME_GAP_HOURS = "valid_app_usage_time_gap_hours"
    VALID_APP_NEW_ENGAGE_CUSTOM = "valid_app_new_engage_custom_{}s"
    ANY_APP_NEW_ENGAGE_CUSTOM = "any_app_new_engage_custom_{}s"

    # Survey data and compliance columns (internal functionality)
    DEVICE_SHARING_STATUS = "device_sharing_status"
    COMPLIANCE = "compliance"


class UIStatus(StrEnum):
    """
    StrEnum representing status messages used in the UI.
    """

    READY = "Ready to start preprocessing"
    FINDING_TIMEZONES = "Finding all timezones in raw data files..."
    PREPROCESSING_IN_PROGRESS = "Running preprocessing operation..."
    PREPROCESSING_COMPLETE = "Preprocessing complete!"
    PLOTTING_IN_PROGRESS = "Generating daily app usage plots..."
    PLOTTING_COMPLETE = "Plotting complete! Plots generated."
    OPERATION_COMPLETE = "All operations completed successfully!"
    OPERATION_PARTIAL_SUCCESS = "Operation completed with some issues."
    OPERATION_FAILED = "Operation failed with errors."


class DialogMessage(StrEnum):
    """
    StrEnum representing dialog messages used in the UI.
    """

    WARNING_STUDY_NAME = "Please enter a study name."
    WARNING_RAW_DATA_FOLDER = "Please select a raw data folder."
    WARNING_TIMEZONE = "Please select a timezone when using non per-file timezone options."
    WARNING_NO_RAW_DATA_FILES = "No raw data files found in {}. Please check that the folder contains raw data files ending with .csv"


class ErrorMessage(StrEnum):
    """
    StrEnum representing error messages used in the application.
    """

    EMPTY_DATA = "{}: No valid app usage during the study period."
    MISSING_TIMEZONE = "Timezone must be provided when using {} option"
    INVALID_TIMEZONE_OPTION = "Invalid timezone option: {}"
    INVALID_TIMESTAMP_FORMAT = "Timestamp format is incorrect: {}"
    DISORDERED_TIMESTAMPS = "There were {} occurrences of the start timestamp being later than the stop timestamp, which should be impossible."
    NO_RAW_DATA_FILES = "No raw data files found in {}. Please check that the folder contains raw data files ending with .csv"


# ====== Dictionary maps =======

ALL_INTERACTION_TYPES_MAP = {
    "Instance of Usage for an App": InteractionType.APP_USAGE,
    "Activity Resumed for a Filtered App": InteractionType.FILTERED_APP_RESUMED,
    "Activity Paused for a Filtered App": InteractionType.FILTERED_APP_PAUSED,
    "Instance of Usage for a Filtered App": InteractionType.FILTERED_APP_USAGE,
    "Missing End of Usage after an App Starts Being Used": InteractionType.END_OF_USAGE_MISSING,
    "Unknown importance: 1": InteractionType.ACTIVITY_RESUMED,
    "Unknown importance: 2": InteractionType.ACTIVITY_PAUSED,
    "Unknown importance: 3": InteractionType.END_OF_DAY,
    "Unknown importance: 4": InteractionType.CONTINUE_PREVIOUS_DAY,
    "Unknown importance: 5": InteractionType.CONFIGURATION_CHANGE,
    "Unknown importance: 6": InteractionType.SYSTEM_INTERACTION,
    "Unknown importance: 7": InteractionType.USER_INTERACTION,
    "Unknown importance: 8": InteractionType.SHORTCUT_INVOCATION,
    "Unknown importance: 9": InteractionType.CHOOSER_ACTION,
    "Unknown importance: 10": InteractionType.NOTIFICATION_SEEN,
    "Unknown importance: 11": InteractionType.STANDBY_BUCKET_CHANGED,
    "Unknown importance: 12": InteractionType.NOTIFICATION_INTERRUPTION,
    "Unknown importance: 13": InteractionType.SLICE_PINNED_PRIV,
    "Unknown importance: 14": InteractionType.SLICE_PINNED_APP,
    "Unknown importance: 15": InteractionType.SCREEN_INTERACTIVE,
    "Unknown importance: 16": InteractionType.SCREEN_NON_INTERACTIVE,
    "Unknown importance: 17": InteractionType.KEYGUARD_SHOWN,
    "Unknown importance: 18": InteractionType.KEYGUARD_HIDDEN,
    "Unknown importance: 19": InteractionType.FOREGROUND_SERVICE_START,
    "Unknown importance: 20": InteractionType.FOREGROUND_SERVICE_STOP,
    "Unknown importance: 21": InteractionType.CONTINUING_FOREGROUND_SERVICE,
    "Unknown importance: 22": InteractionType.ROLLOVER_FOREGROUND_SERVICE,
    "Unknown importance: 23": InteractionType.ACTIVITY_STOPPED,
    "Unknown importance: 24": InteractionType.ACTIVITY_DESTROYED,
    "Unknown importance: 25": InteractionType.FLUSH_TO_DISK,
    "Unknown importance: 26": InteractionType.DEVICE_SHUTDOWN,
    "Unknown importance: 27": InteractionType.DEVICE_STARTUP,
    "Unknown importance: 28": InteractionType.USER_UNLOCKED,
    "Unknown importance: 29": InteractionType.USER_STOPPED,
    "Unknown importance: 30": InteractionType.LOCUS_ID_SET,
    "Unknown importance: 31": InteractionType.APP_COMPONENT_USED,
    "Move to Foreground": InteractionType.ACTIVITY_RESUMED,
    "Move to Background": InteractionType.ACTIVITY_PAUSED,
}

POSSIBLE_INTERACTION_TYPES_TO_REMOVE = {
    "Instance of Usage for a Filtered App": InteractionType.FILTERED_APP_USAGE,
    "Missing End of Usage after an App Starts Being Used": InteractionType.END_OF_USAGE_MISSING,
    "Unknown importance: 3": InteractionType.END_OF_DAY,
    "Unknown importance: 4": InteractionType.CONTINUE_PREVIOUS_DAY,
    "Unknown importance: 5": InteractionType.CONFIGURATION_CHANGE,
    "Unknown importance: 6": InteractionType.SYSTEM_INTERACTION,
    "Unknown importance: 7": InteractionType.USER_INTERACTION,
    "Unknown importance: 8": InteractionType.SHORTCUT_INVOCATION,
    "Unknown importance: 9": InteractionType.CHOOSER_ACTION,
    "Unknown importance: 10": InteractionType.NOTIFICATION_SEEN,
    "Unknown importance: 11": InteractionType.STANDBY_BUCKET_CHANGED,
    "Unknown importance: 12": InteractionType.NOTIFICATION_INTERRUPTION,
    "Unknown importance: 13": InteractionType.SLICE_PINNED_PRIV,
    "Unknown importance: 14": InteractionType.SLICE_PINNED_APP,
    "Unknown importance: 15": InteractionType.SCREEN_INTERACTIVE,
    "Unknown importance: 16": InteractionType.SCREEN_NON_INTERACTIVE,
    "Unknown importance: 17": InteractionType.KEYGUARD_SHOWN,
    "Unknown importance: 18": InteractionType.KEYGUARD_HIDDEN,
    "Unknown importance: 19": InteractionType.FOREGROUND_SERVICE_START,
    "Unknown importance: 20": InteractionType.FOREGROUND_SERVICE_STOP,
    "Unknown importance: 21": InteractionType.CONTINUING_FOREGROUND_SERVICE,
    "Unknown importance: 22": InteractionType.ROLLOVER_FOREGROUND_SERVICE,
    "Unknown importance: 23": InteractionType.ACTIVITY_STOPPED,
    "Unknown importance: 24": InteractionType.ACTIVITY_DESTROYED,
    "Unknown importance: 25": InteractionType.FLUSH_TO_DISK,
    "Unknown importance: 26": InteractionType.DEVICE_SHUTDOWN,
    "Unknown importance: 27": InteractionType.DEVICE_STARTUP,
    "Unknown importance: 28": InteractionType.USER_UNLOCKED,
    "Unknown importance: 29": InteractionType.USER_STOPPED,
    "Unknown importance: 30": InteractionType.LOCUS_ID_SET,
    "Unknown importance: 31": InteractionType.APP_COMPONENT_USED,
}

POSSIBLE_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT = {
    "Activity Paused for the Same App (Unknown importance: 2)": InteractionType.ACTIVITY_PAUSED,
    "Activity Resumed for the Same App (Unknown importance: 1)": InteractionType.ACTIVITY_RESUMED,
    "Activity Stopped for the Same App (Unknown importance: 23)": InteractionType.ACTIVITY_STOPPED,
    "Activity Destroyed for the Same App (Unknown importance: 24)": InteractionType.ACTIVITY_DESTROYED,
}

POSSIBLE_FILTERED_SAME_APP_INTERACTION_TYPES_TO_STOP_USAGE_AT = {
    InteractionType.ACTIVITY_PAUSED: InteractionType.FILTERED_APP_PAUSED,
    InteractionType.ACTIVITY_RESUMED: InteractionType.FILTERED_APP_RESUMED,
    InteractionType.ACTIVITY_STOPPED: InteractionType.FILTERED_APP_STOPPED,
    InteractionType.ACTIVITY_DESTROYED: InteractionType.FILTERED_APP_DESTROYED,
}

POSSIBLE_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT = {
    "Activity Resumed for a Different App (Unknown importance: 1)": InteractionType.ACTIVITY_RESUMED,
    "Unknown importance: 16": InteractionType.SCREEN_NON_INTERACTIVE,
    "Unknown importance: 17": InteractionType.KEYGUARD_SHOWN,
    "Unknown importance: 24": InteractionType.ACTIVITY_DESTROYED,
    "Unknown importance: 26": InteractionType.DEVICE_SHUTDOWN,
    "Unknown importance: 29": InteractionType.USER_STOPPED,
    "Activity Resumed for a Filtered App": InteractionType.FILTERED_APP_RESUMED,
    "Instance of Usage for a Filtered App": InteractionType.FILTERED_APP_USAGE,
}

AMAZON_APPS = {
    "com.amazon.redstone": "Fire Standard Keyboard",
    "com.amazon.firelauncher": "Amazon Fire Launcher",
    "com.amazon.imp": "Amazon Impulse",
    "com.amazon.alta.h2clientservice": "Amazon H2 Client Service",
    "com.amazon.media.session.monitor": "Amazon Media Session Monitor",
}
