"""DataFrame-based preprocessing API for orchestrators.

This module provides a clean, DataFrame-centric API for preprocessing Chronicle Android
data. It supports dependency injection for device sharing status, allowing orchestrators
(like Dagster) to inject pre-fetched data while also supporting standalone operation
where data is fetched from REDCap internally.

Design Pattern - Dependency Injection:
    - Orchestrated (Dagster): Pass device_sharing_status DataFrame from Delta Lake
    - Standalone (GUI/CLI): Pass None, and the API fetches from REDCap internally

Example Usage (Orchestrated):
    result = preprocess_chronicle_dataframe(
        raw_df=raw_data,
        survey_df=survey_data,
        device_sharing_status=device_sharing_df,  # Injected from Delta Lake
        config=config,
    )

Example Usage (Standalone):
    result = preprocess_chronicle_dataframe(
        raw_df=raw_data,
        survey_df=survey_data,
        device_sharing_status=None,  # Will fetch from REDCap
        config=config,
    )
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

import pandas as pd

try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    pl = None

try:
    from chronicle_preprocessing_app.config.constants import (
        Column,
        InteractionType,
        TimezoneHandlingOption,
        UsageSessionMode,
    )
except ImportError:
    from ...config.constants import Column, InteractionType, TimezoneHandlingOption, UsageSessionMode

from ..config import PreprocessingOptions
from .main_preprocessor import ChronicleAndroidRawDataPreprocessor
from .study_date_provider import StudyDateRangeProvider

if TYPE_CHECKING:
    from ..config import ProcessingStats

LOGGER = logging.getLogger(__name__)


def _extract_numerical_id(participant_id: str) -> str | None:
    """Extract numerical ID from various participant ID formats.

    Handles formats like:
    - P1-1234-A (redcap format) -> "1234"
    - P1-1234-A-D1 (device format) -> "1234"
    - P1-1234 (partial device format) -> "1234"
    - 1234 (raw number) -> "1234"

    This enables matching between device_id (raw data) and redcap_id (device sharing lookup).
    """
    import re
    if not participant_id:
        return None
    # Pattern: P followed by digit, dash, then numbers (the numerical ID)
    match = re.search(r"P\d+-(\d+)", str(participant_id))
    if match:
        return match.group(1)
    # Maybe it's just a number
    if str(participant_id).isdigit():
        return str(participant_id)
    return None


# Internal pipeline feature
def _lookup_device_sharing_by_numerical_id(
    participant_id: str,
    device_sharing_lookup: dict[str, str],
) -> str:
    """Look up device sharing status using numerical ID matching.

    First tries exact match, then falls back to numerical ID matching.
    """
    # Try exact match first
    if participant_id in device_sharing_lookup:
        return device_sharing_lookup[participant_id]

    # Extract numerical ID for fuzzy matching
    numerical_id = _extract_numerical_id(participant_id)
    if numerical_id:
        for lookup_key, status in device_sharing_lookup.items():
            lookup_numerical = _extract_numerical_id(lookup_key)
            if lookup_numerical == numerical_id:
                LOGGER.debug(
                    f"Matched {participant_id} -> {lookup_key} via numerical ID {numerical_id}"
                )
                return status

    # Default to Non-Shared if no match found
    LOGGER.debug(f"No device sharing match for {participant_id}, defaulting to Non-Shared")
    return "Non-Shared"


@dataclass
class DataFramePreprocessingConfig:
    """Configuration for DataFrame-based preprocessing.

    This is a simplified configuration for the DataFrame API, abstracting away
    file-based options that are not relevant when working with DataFrames directly.
    """

    study_name: str = ""
    selected_timezone: str | None = None
    use_app_codebook: bool = False
    app_codebook_path: str = ""
    use_filter_file: bool = False
    filter_file_path: str = ""
    use_keep_awake_apps_file: bool = False
    keep_awake_apps_file_path: str = ""
    keep_awake_apps_dict: dict[str, str] | None = None
    usage_session_mode: UsageSessionMode | str = UsageSessionMode.APP_USAGE
    derive_screen_usage_sessions: bool = False
    screen_usage_auto_lock_timeout_seconds: int = 120
    screen_usage_auto_lock_tolerance_seconds: int = 30
    screen_usage_manual_lock_max_tail_gap_seconds: int = 30
    screen_usage_keyguard_near_stop_seconds: int = 2
    minimum_usage_duration: int = 0
    custom_app_engagement_duration: int = 30
    allow_stop_event_reuse: bool = False
    correct_duplicate_event_timestamps: bool = True
    compliance_reporting: bool = True
    # Study period length for compliance calculation (days)
    study_period_length: int = 10

    # Algorithm options
    use_activity_stopped_as_fallback: bool = True
    apply_threshold_to_activity_stopped_fallback: bool = True
    filter_zero_duration_sessions: bool = False
    long_duration_threshold_hours: float = 12.0

    # REDCap configuration for internal fetching (when device_sharing_status not provided)
    redcap_api_url: str | None = None
    redcap_api_token: str | None = None

    # Study date map from orchestrator (participant_id -> (start_date, end_date))
    # When provided, skips TrackingSheet/Selenium for study date lookups
    study_date_map: dict[str, tuple] | None = None


@dataclass
class PreprocessingResult:
    """Result of preprocessing operation.

    Attributes:
        data: Preprocessed DataFrame (pandas or polars depending on input)
        statistics: Processing statistics
        compliance_data: Per-participant compliance metrics
    """

    data: pd.DataFrame
    statistics: dict[str, Any] = field(default_factory=dict)
    compliance_data: dict[str, dict[str, Any]] = field(default_factory=dict)


def preprocess_chronicle_dataframe(
    raw_df: pd.DataFrame | Any,  # Any for pl.DataFrame
    config: DataFramePreprocessingConfig,
    survey_df: pd.DataFrame | Any | None = None,  # Internal/pipeline-only: shared-device survey data
    device_sharing_status: pd.DataFrame | Any | None = None,  # Internal/pipeline-only: injected from Delta Lake
    log_func: Callable[[str], None] | None = None,
) -> PreprocessingResult:
    """Preprocess Chronicle Android data from DataFrames.

    This is the main entry point for DataFrame-based preprocessing. It handles:
    1. Device sharing status (injected or fetched from REDCap)
    2. Per-participant preprocessing using the existing MainPreprocessor
    3. Survey data integration for shared device user identification
    4. Compliance calculation

    Args:
        raw_df: Raw Chronicle data as DataFrame (pandas or polars)
        config: Preprocessing configuration
        survey_df: Optional survey data for shared device user identification
        device_sharing_status: Optional pre-fetched device sharing status.
                               If None, fetches from REDCap internally.
                               Expected columns: participant_id, device_sharing_status
        log_func: Optional logging function

    Returns:
        PreprocessingResult with preprocessed data, statistics, and compliance metrics
    """

    def _log(msg: str) -> None:
        if log_func:
            log_func(msg)
        else:
            LOGGER.info(msg)

    _log("Starting DataFrame-based Chronicle preprocessing")

    # Convert polars to pandas if needed
    if POLARS_AVAILABLE and pl is not None:
        if isinstance(raw_df, pl.DataFrame):
            raw_df = raw_df.to_pandas()
        if survey_df is not None and isinstance(survey_df, pl.DataFrame):
            survey_df = survey_df.to_pandas()
        if device_sharing_status is not None and isinstance(device_sharing_status, pl.DataFrame):
            device_sharing_status = device_sharing_status.to_pandas()

    if raw_df.empty:
        _log("No raw data provided")
        return PreprocessingResult(
            data=pd.DataFrame(),
            statistics={"participants_processed": 0, "total_records": 0},
            compliance_data={},
        )

    # Build device sharing lookup
    device_sharing_lookup = _build_device_sharing_lookup(device_sharing_status, config, _log)

    # Get unique participants
    participant_col = Column.PARTICIPANT_ID
    if participant_col not in raw_df.columns:
        raise ValueError(f"Required column '{participant_col}' not found in raw data")

    participants = raw_df[participant_col].unique().tolist()
    _log(f"Processing {len(participants)} participants")

    # Build preprocessing options
    preprocessing_options = _build_preprocessing_options(config, device_sharing_lookup)

    # Process each participant
    all_results: list[pd.DataFrame] = []
    compliance_data: dict[str, dict[str, Any]] = {}
    validation_pass = 0
    validation_fail = 0
    total_records = 0

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        for idx, participant_id in enumerate(participants, 1):
            _log(f"Processing participant {idx}/{len(participants)}: {participant_id}")

            try:
                # Filter to this participant's data
                participant_raw = raw_df[raw_df[participant_col] == participant_id].copy()

                # Get survey data for this participant if available
                participant_survey = None
                if survey_df is not None and not survey_df.empty:
                    participant_survey = survey_df[
                        survey_df[participant_col] == participant_id
                    ].copy()

                # Get device sharing status
                sharing_status = _lookup_device_sharing_by_numerical_id(
                    str(participant_id), device_sharing_lookup
                )

                # Process this participant
                result_df, participant_compliance = _process_single_participant(
                    participant_raw=participant_raw,
                    participant_id=str(participant_id),
                    participant_survey=participant_survey,
                    device_sharing_status=sharing_status,
                    options=preprocessing_options,
                    config=config,
                    temp_path=temp_path,
                    log_func=_log,
                )

                if result_df is not None and not result_df.empty:
                    all_results.append(result_df)
                    validation_pass += 1
                    total_records += len(result_df)

                    if participant_compliance:
                        compliance_data[str(participant_id)] = participant_compliance

                    _log(
                        f"Successfully preprocessed {participant_id}: "
                        f"{len(result_df)} records, sharing={sharing_status}"
                    )
                else:
                    validation_fail += 1
                    _log(f"No data returned for {participant_id}")

            except Exception as e:
                validation_fail += 1
                _log(f"Failed to preprocess {participant_id}: {e}")
                LOGGER.exception(f"Error preprocessing {participant_id}")

    # Combine all results
    if all_results:
        combined_df = pd.concat(all_results, ignore_index=True)
        _log(f"Combined {len(all_results)} participant results: {len(combined_df)} total records")
    else:
        combined_df = pd.DataFrame()

    statistics = {
        "participants_processed": validation_pass,
        "participants_failed": validation_fail,
        "total_records": total_records,
        "validation_pass_count": validation_pass,
        "validation_fail_count": validation_fail,
    }

    _log(f"Preprocessing complete: {validation_pass} success, {validation_fail} failed")

    return PreprocessingResult(
        data=combined_df,
        statistics=statistics,
        compliance_data=compliance_data,
    )


# Internal pipeline feature
def _build_device_sharing_lookup(
    device_sharing_status: pd.DataFrame | None,
    config: DataFramePreprocessingConfig,
    log_func: Callable[[str], None],
) -> dict[str, str]:
    """Build device sharing status lookup dictionary.

    If device_sharing_status DataFrame is provided, uses it directly.
    Otherwise, fetches from REDCap using internal infrastructure.

    Args:
        device_sharing_status: Optional pre-fetched device sharing status
        config: Configuration with REDCap settings
        log_func: Logging function

    Returns:
        Dictionary mapping participant_id -> device sharing status ("Shared"/"Non-Shared")
    """
    if device_sharing_status is not None and not device_sharing_status.empty:
        # Use injected device sharing status
        log_func("Using injected device sharing status")
        lookup = {}

        # Expected columns: participant_id, device_sharing_status
        pid_col = None
        status_col = None

        # Find the columns (handle various naming conventions)
        for col in device_sharing_status.columns:
            col_lower = col.lower()
            if "participant" in col_lower and "id" in col_lower:
                pid_col = col
            elif "sharing" in col_lower or "status" in col_lower:
                status_col = col

        if pid_col is None:
            pid_col = device_sharing_status.columns[0]
        if status_col is None:
            status_col = device_sharing_status.columns[-1]

        for _, row in device_sharing_status.iterrows():
            pid = str(row[pid_col])
            status = str(row[status_col])
            lookup[pid] = status

        shared_count = sum(1 for s in lookup.values() if s == "Shared")
        log_func(
            f"Device sharing lookup: {len(lookup)} participants "
            f"({shared_count} shared devices, {len(lookup) - shared_count} non-shared devices)"
        )
        return lookup

    # Fetch from REDCap using internal infrastructure
    log_func("Device sharing status not provided, fetching from REDCap")
    return _fetch_device_sharing_from_redcap(config, log_func)


def _fetch_device_sharing_from_redcap(
    config: DataFramePreprocessingConfig,
    log_func: Callable[[str], None],
) -> dict[str, str]:
    """Fetch device sharing status from REDCap.

    Uses the internal TrackingSheet infrastructure with REDCap API
    and Selenium fallback.

    Args:
        config: Configuration with REDCap settings
        log_func: Logging function

    Returns:
        Dictionary mapping participant_id -> device sharing status
    """
    try:
        # Import internal modules for REDCap access
        from chronicle_preprocessing_internal import (
            DeviceSharingStatus as InternalDeviceSharingStatus,
            TECHREDCapTrackingSheet,
        )

        log_func("Fetching device sharing status from REDCap tracking sheet")

        # Get the tracking sheet (handles REDCap API + Selenium fallback internally)
        tracking_sheet = TECHREDCapTrackingSheet(force_redownload=False)

        # Build lookup from tracking sheet data
        lookup = {}
        if tracking_sheet.dataframe is not None:
            for _, row in tracking_sheet.dataframe.iterrows():
                pid = str(row.get("Participant ID", row.get("participant_id", "")))
                if not pid:
                    continue

                # Get device sharing status from row
                status = "Non-Shared"  # Default
                device_type = str(row.get("type1", "") or row.get("device_type", "")).lower()

                if "shared" in device_type:
                    status = "Shared"
                elif "non-shared" in device_type or "nonshared" in device_type:
                    status = "Non-Shared"

                lookup[pid] = status

        shared_count = sum(1 for s in lookup.values() if s == "Shared")
        log_func(
            f"Fetched device sharing from REDCap: {len(lookup)} participants "
            f"({shared_count} shared devices, {len(lookup) - shared_count} non-shared devices)"
        )
        return lookup

    except ImportError:
        log_func("Internal REDCap modules not available, using default Non-Shared for all")
        return {}
    except Exception as e:
        log_func(f"Error fetching device sharing from REDCap: {e}, using defaults")
        LOGGER.exception("Failed to fetch device sharing from REDCap")
        return {}


def _build_preprocessing_options(
    config: DataFramePreprocessingConfig,
    device_sharing_lookup: dict[str, str],
) -> PreprocessingOptions:
    """Build PreprocessingOptions from DataFramePreprocessingConfig.

    Args:
        config: DataFrame preprocessing config
        device_sharing_lookup: Device sharing status lookup

    Returns:
        PreprocessingOptions for MainPreprocessor
    """
    # Determine if we should enable survey data processing
    # When device_sharing_lookup is provided (from orchestrator), we inject it via
    # device_sharing_status_map so SurveyDataPreprocessor uses it instead of
    # fetching from TrackingSheet/Selenium
    has_injected_device_sharing = bool(device_sharing_lookup)

    return PreprocessingOptions(
        study_name=config.study_name,
        raw_data_folder="",  # Not used for DataFrame API
        raw_data_file_regex_pattern=r".*\.csv$",
        use_app_codebook=config.use_app_codebook,
        app_codebook_path=config.app_codebook_path,
        use_filter_file=config.use_filter_file,
        filter_file=config.filter_file_path,
        use_keep_awake_apps_file=config.use_keep_awake_apps_file,
        keep_awake_apps_file=config.keep_awake_apps_file_path,
        keep_awake_apps_dict=config.keep_awake_apps_dict or {},
        usage_session_mode=config.usage_session_mode,
        derive_screen_usage_sessions=config.derive_screen_usage_sessions,
        screen_usage_auto_lock_timeout_seconds=config.screen_usage_auto_lock_timeout_seconds,
        screen_usage_auto_lock_tolerance_seconds=config.screen_usage_auto_lock_tolerance_seconds,
        screen_usage_manual_lock_max_tail_gap_seconds=(
            config.screen_usage_manual_lock_max_tail_gap_seconds
        ),
        screen_usage_keyguard_near_stop_seconds=config.screen_usage_keyguard_near_stop_seconds,
        minimum_usage_duration=config.minimum_usage_duration,
        custom_app_engagement_duration=config.custom_app_engagement_duration,
        selected_timezone=config.selected_timezone,
        # CRITICAL: Use CONVERT, not REMOVE - we want to convert all data to primary timezone,
        # not filter out rows with different timezones
        timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE,
        enable_preprocessing=True,
        enable_plotting=False,
        allow_stop_event_reuse=config.allow_stop_event_reuse,
        correct_duplicate_event_timestamps=config.correct_duplicate_event_timestamps,
        # Algorithm options - pass through from config
        use_activity_stopped_as_fallback=config.use_activity_stopped_as_fallback,
        apply_threshold_to_activity_stopped_fallback=config.apply_threshold_to_activity_stopped_fallback,
        long_duration_threshold_hours=config.long_duration_threshold_hours,
        filter_zero_duration_sessions=config.filter_zero_duration_sessions,
        # We handle device sharing and survey data manually in _apply_device_sharing_processing
        # using the injected device_sharing_status lookup.
        # Set use_survey_data=False since we handle this logic ourselves in the dataframe API
        use_survey_data=False,
        survey_data_folder="",
        compliance_reporting=config.compliance_reporting,
        # DEPENDENCY INJECTION: Pass the device sharing lookup to PreprocessingOptions.
        # When SurveyDataPreprocessor.get_device_sharing_status() is called,
        # it will check this map FIRST before falling back to TrackingSheet/Selenium.
        # This prevents unnecessary REDCap/Selenium calls when data is already provided.
        device_sharing_status_map=device_sharing_lookup if has_injected_device_sharing else None,
        # DEPENDENCY INJECTION: Pass study date map to PreprocessingOptions.
        # When StudyDateRangeProvider.get_study_date_range() is called,
        # it will check this map FIRST before falling back to TrackingSheet/Selenium.
        study_date_map=config.study_date_map,
    )


def _process_single_participant(
    participant_raw: pd.DataFrame,
    participant_id: str,
    participant_survey: pd.DataFrame | None,
    device_sharing_status: str,
    options: PreprocessingOptions,
    config: DataFramePreprocessingConfig,
    temp_path: Path,
    log_func: Callable[[str], None],
) -> tuple[pd.DataFrame | None, dict[str, Any] | None]:
    """Process a single participant's data.

    Args:
        participant_raw: Raw data for this participant
        participant_id: Participant ID
        participant_survey: Optional survey data for this participant
        device_sharing_status: Device sharing status ("Shared" or "Non-Shared")
        options: Preprocessing options
        config: DataFrame preprocessing config
        temp_path: Temporary directory for intermediate files
        log_func: Logging function

    Returns:
        Tuple of (preprocessed DataFrame, compliance data dict) or (None, None) on failure
    """
    try:
        # Write participant data to temp CSV for MainPreprocessor
        temp_csv = temp_path / f"{participant_id}_raw.csv"
        participant_raw.to_csv(temp_csv, index=False)

        # Create preprocessor instance
        preprocessor = ChronicleAndroidRawDataPreprocessor(
            options=options,
            progress_callback=None,
        )

        # Run preprocessing
        _, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(temp_csv)

        if not success or preprocessor.current_participant_raw_data_df.empty:
            log_func(f"Preprocessing returned no data for {participant_id}")
            return None, None

        result_df = preprocessor.current_participant_raw_data_df.copy()

        # Apply device sharing status and survey data processing
        result_df = _apply_device_sharing_processing(
            df=result_df,
            participant_id=participant_id,
            device_sharing_status=device_sharing_status,
            survey_df=participant_survey,
            selected_timezone=config.selected_timezone,
            log_func=log_func,
        )

        # Filter to study dates BEFORE compliance calculation
        study_date_range = None
        if config.study_date_map:
            study_date_range = config.study_date_map.get(participant_id)
            study_date_provider = StudyDateRangeProvider(study_date_map=config.study_date_map)
            result_df = study_date_provider.filter_data_to_study_dates(
                df=result_df,
                participant_id=participant_id,
                timestamp_column=Column.EVENT_TIMESTAMP,
            )

        # Calculate compliance
        compliance_data = _calculate_compliance(
            df=result_df,
            participant_id=participant_id,
            device_sharing_status=device_sharing_status,
            study_period_length=config.study_period_length,
            log_func=log_func,
        )
        if study_date_range:
            result_df = _add_placeholder_rows_for_missing_days(
                df=result_df,
                participant_id=participant_id,
                device_sharing_status=device_sharing_status,
                study_date_range=study_date_range,
                log_func=log_func,
            )

        # Clean up temp file
        temp_csv.unlink(missing_ok=True)

        return result_df, compliance_data

    except Exception as e:
        log_func(f"Error processing {participant_id}: {e}")
        LOGGER.exception(f"Failed to process participant {participant_id}")
        return None, None


def _apply_device_sharing_processing(
    df: pd.DataFrame,
    participant_id: str,
    device_sharing_status: str,
    survey_df: pd.DataFrame | None,
    selected_timezone: str | None,
    log_func: Callable[[str], None],
) -> pd.DataFrame:
    """Apply device sharing status and survey data processing.

    Args:
        df: Preprocessed DataFrame
        participant_id: Participant ID
        device_sharing_status: Device sharing status
        survey_df: Optional survey data
        selected_timezone: Timezone for timestamp conversion
        log_func: Logging function

    Returns:
        DataFrame with device sharing processing applied
    """
    if df.empty:
        return df

    # Add device_sharing_status column
    df[Column.DEVICE_SHARING_STATUS] = device_sharing_status

    username_col = Column.USERNAME

    if device_sharing_status == "Non-Shared":
        # For non-shared devices, all unidentified usage is from the target child
        if username_col in df.columns:
            nan_mask = (
                df[username_col].isna()
                | (df[username_col].astype(str) == "nan")
                | (df[username_col].astype(str) == "")
            )
            nan_count = nan_mask.sum()
            if nan_count > 0:
                df.loc[nan_mask, username_col] = "Target Child"
                log_func(
                    f"[{participant_id}] Non-shared: Set {nan_count} NaN usernames to 'Target Child'"
                )

    elif device_sharing_status == "Shared":
        # For shared devices, set unidentified to "None" first
        if username_col in df.columns:
            nan_mask = (
                df[username_col].isna()
                | (df[username_col].astype(str) == "nan")
                | (df[username_col].astype(str) == "")
            )
            nan_count = nan_mask.sum()
            if nan_count > 0:
                df.loc[nan_mask, username_col] = "None"
                log_func(f"[{participant_id}] Shared: Set {nan_count} NaN usernames to 'None'")

        # Apply survey data if available
        if survey_df is not None and not survey_df.empty:
            df = _apply_survey_usernames(df, survey_df, selected_timezone, log_func)

        # Mark non-target child app usage
        df = _mark_non_target_child_app_usage(df, participant_id, log_func)

    return df


def _apply_survey_usernames(
    df: pd.DataFrame,
    survey_df: pd.DataFrame,
    selected_timezone: str | None,
    log_func: Callable[[str], None],
) -> pd.DataFrame:
    """Apply usernames from survey data to matching timestamps."""
    try:
        if survey_df.empty:
            return df

        event_ts_col = Column.EVENT_TIMESTAMP
        if event_ts_col in survey_df.columns:
            survey_df = survey_df.copy()
            survey_df[event_ts_col] = pd.to_datetime(survey_df[event_ts_col], utc=True)
            if selected_timezone:
                survey_df[event_ts_col] = survey_df[event_ts_col].dt.tz_convert(selected_timezone)

        matches_found = 0
        for _, row in survey_df.iterrows():
            if event_ts_col not in row or pd.isna(row[event_ts_col]):
                continue

            idxs = df.index[df[event_ts_col] == row[event_ts_col]].tolist()
            if idxs and "users" in row:
                user_from_survey = str(row["users"]).strip("{}").strip('"') + " (From Survey)"
                for idx in idxs:
                    df.loc[idx, Column.USERNAME] = user_from_survey
                matches_found += len(idxs)

        if matches_found > 0:
            log_func(f"Applied survey usernames to {matches_found} rows")

    except Exception as e:
        log_func(f"Error applying survey usernames: {e}")

    return df


def _mark_non_target_child_app_usage(
    df: pd.DataFrame,
    participant_id: str,
    log_func: Callable[[str], None],
) -> pd.DataFrame:
    """Mark app usage rows that are not from Target Child."""
    if Column.DEVICE_SHARING_STATUS not in df.columns:
        return df

    if "Shared" not in df[Column.DEVICE_SHARING_STATUS].unique():
        return df

    interaction_col = Column.INTERACTION_TYPE
    if interaction_col not in df.columns:
        return df

    app_usage_mask = df[interaction_col] == InteractionType.APP_USAGE

    username_col = Column.USERNAME
    if username_col not in df.columns:
        return df

    target_child_pattern = r"Target Child|Target Child \(from Survey\)|Target Child \(From Survey\)"
    non_target_child_mask = ~df[username_col].str.contains(
        target_child_pattern, case=False, na=False, regex=True
    )

    non_target_child_app_usage_mask = app_usage_mask & non_target_child_mask
    rows_to_modify = non_target_child_app_usage_mask.sum()

    if rows_to_modify > 0:
        df.loc[non_target_child_app_usage_mask, interaction_col] = (
            InteractionType.NON_TARGET_CHILD_APP_USAGE
        )
        log_func(f"[{participant_id}] Marked {rows_to_modify} rows as 'Non-Target Child App Usage'")

    return df


def _calculate_compliance(
    df: pd.DataFrame,
    participant_id: str,
    device_sharing_status: str,
    study_period_length: int,
    log_func: Callable[[str], None],
) -> dict[str, Any]:
    """Calculate compliance for a participant.

    For non-shared devices: compliance = 100% (all usage attributed to Target Child)
    For shared devices: compliance = known_use / (known_use + unknown_use)

    Args:
        df: Preprocessed DataFrame
        participant_id: Participant ID
        device_sharing_status: Device sharing status
        study_period_length: Number of days in study period
        log_func: Logging function

    Returns:
        Dictionary with compliance metrics
    """
    compliance_col = Column.COMPLIANCE
    duration_col = Column.DURATION_MINUTES
    username_col = Column.USERNAME
    interaction_col = Column.INTERACTION_TYPE
    date_col = Column.DATE

    if device_sharing_status == "Non-Shared":
        # Non-shared devices: all usage is Target Child, compliance = 100%
        df[compliance_col] = 100.0
        log_func(f"[{participant_id}] Non-shared device: compliance = 100%")
        return {
            "device_sharing_status": device_sharing_status,
            "avg_compliance": 100.0,
            "compliance_by_day": {},
        }

    # Shared device: calculate actual compliance
    if duration_col not in df.columns or username_col not in df.columns:
        df[compliance_col] = None
        return {"device_sharing_status": device_sharing_status, "avg_compliance": None}

    # Filter to app usage rows
    if interaction_col in df.columns:
        usage_mask = df[interaction_col].str.contains("App Usage", case=False, na=False)
        usage_df = df[usage_mask].copy()
    else:
        usage_df = df.copy()

    if usage_df.empty:
        # No App Usage at all = no unknown usage = 100% compliant
        df[compliance_col] = 100.0
        return {"device_sharing_status": device_sharing_status, "avg_compliance": 100.0}

    # Calculate per-day compliance if date column exists
    compliance_by_day = {}
    if date_col in df.columns:
        dates = df[date_col].dropna().unique()
        for day in dates:
            day_mask = usage_df[date_col] == day
            day_usage = usage_df[day_mask]

            if day_usage.empty:
                continue

            compliance_pct = _calculate_compliance_from_usage(day_usage, username_col, duration_col)
            if compliance_pct is not None:
                compliance_by_day[str(day)] = compliance_pct

                # Set compliance on all rows for this day
                all_day_mask = df[date_col] == day
                df.loc[all_day_mask, compliance_col] = compliance_pct
    else:
        # Calculate overall compliance
        compliance_pct = _calculate_compliance_from_usage(usage_df, username_col, duration_col)
        df[compliance_col] = compliance_pct

    # Calculate average compliance
    compliance_values = [v for v in compliance_by_day.values() if v is not None]
    avg_compliance = sum(compliance_values) / len(compliance_values) if compliance_values else 100.0

    if avg_compliance is not None:
        log_func(f"[{participant_id}] Shared device: avg compliance = {avg_compliance:.1f}%")

    return {
        "device_sharing_status": device_sharing_status,
        "avg_compliance": avg_compliance,
        "compliance_by_day": compliance_by_day,
    }


def _calculate_compliance_from_usage(
    usage_df: pd.DataFrame,
    username_col: str,
    duration_col: str,
) -> float | None:
    """Calculate compliance percentage from usage data.

    Compliance = known_use / (known_use + unknown_use) * 100

    Where:
    - known_use = target_child_minutes + other_user_minutes
    - unknown_use = unidentified_user_minutes (username = "None")
    """
    if usage_df.empty:
        # No usage at all = no unknown usage = 100% compliant
        return 100.0

    username_lower = usage_df[username_col].fillna("").str.lower()

    # Target Child includes "target child" and "target child (from survey)"
    target_child_mask = username_lower.str.contains("target child", na=False)

    # Other user includes "other" in username
    other_mask = username_lower.str.contains("other", na=False) & ~target_child_mask

    # Unknown/unidentified includes "none" or empty
    unknown_mask = (
        (
            username_lower.str.contains("none", na=False)
            | (username_lower == "")
            | username_lower.isna()
        )
        & ~target_child_mask
        & ~other_mask
    )

    target_minutes = usage_df.loc[target_child_mask, duration_col].sum()
    other_minutes = usage_df.loc[other_mask, duration_col].sum()
    unknown_minutes = usage_df.loc[unknown_mask, duration_col].sum()

    known_usage = target_minutes + other_minutes
    total_usage = known_usage + unknown_minutes

    if total_usage <= 0:
        # No usage at all = no unknown usage = 100% compliant
        return 100.0

    compliance_pct = (known_usage / total_usage) * 100.0
    return round(compliance_pct, 2)


def _add_placeholder_rows_for_missing_days(
    df: pd.DataFrame,
    participant_id: str,
    device_sharing_status: str,
    study_date_range: tuple | None,
    log_func: Callable[[str], None],
) -> pd.DataFrame:
    """Add placeholder App Usage rows for days with no app usage.

    For days where the device has data (system events) but no App Usage rows,
    this adds a placeholder row with:
    - interaction_type = 'App Usage'
    - application_label = 'No Activity'
    - compliance = 100% (no usage = no unknown usage)

    Args:
        df: Preprocessed DataFrame
        participant_id: Participant ID
        device_sharing_status: Device sharing status
        study_date_range: Tuple of (start_date, end_date) or None
        log_func: Logging function

    Returns:
        DataFrame with placeholder rows added
    """
    if df.empty or study_date_range is None:
        return df

    start_date, end_date = study_date_range
    date_col = Column.DATE
    interaction_col = Column.INTERACTION_TYPE

    if date_col not in df.columns:
        return df

    # Get all dates in the study period
    study_days = pd.date_range(start=start_date, end=end_date, freq="D").date

    # Get dates that have App Usage rows
    app_usage_mask = df[interaction_col].str.contains("App Usage", case=False, na=False)
    app_usage_dates = set(df.loc[app_usage_mask, date_col].dropna().unique())

    # Get all dates that have ANY data
    all_data_dates = set(df[date_col].dropna().unique())

    placeholder_rows = []
    for day in study_days:
        # Only add placeholder if:
        # 1. There's data for this day (system events, etc.)
        # 2. But no App Usage rows
        if day in all_data_dates and day not in app_usage_dates:
            # Get a sample row from this day to copy metadata
            day_mask = df[date_col] == day
            sample_row = df[day_mask].iloc[0]

            # Create placeholder row
            placeholder = {
                Column.PARTICIPANT_ID: participant_id,
                Column.DATE: day,
                Column.INTERACTION_TYPE: InteractionType.APP_USAGE,
                Column.APP_PACKAGE_NAME: "com.placeholder.noactivity",
                Column.APPLICATION_LABEL: "No Activity",
                Column.USERNAME: "Target Child",
                Column.DURATION_SECONDS: 0,
                Column.DURATION_MINUTES: 0.0,
                Column.COMPLIANCE: 100.0,
                Column.DEVICE_SHARING_STATUS: device_sharing_status,
            }

            # Copy timezone if present
            if Column.TIMEZONE in df.columns:
                placeholder[Column.TIMEZONE] = sample_row.get(Column.TIMEZONE)

            # Copy timestamp columns - use start of day
            if Column.EVENT_TIMESTAMP in df.columns:
                day_start = pd.Timestamp(day)
                if hasattr(sample_row.get(Column.EVENT_TIMESTAMP), "tzinfo"):
                    tz = sample_row[Column.EVENT_TIMESTAMP].tzinfo
                    if tz:
                        day_start = day_start.tz_localize(tz)
                placeholder[Column.EVENT_TIMESTAMP] = day_start
                placeholder[Column.START_TIMESTAMP] = day_start
                placeholder[Column.STOP_TIMESTAMP] = day_start

            placeholder_rows.append(placeholder)

    if placeholder_rows:
        placeholder_df = pd.DataFrame(placeholder_rows)
        df = pd.concat([df, placeholder_df], ignore_index=True)
        log_func(
            f"[{participant_id}] Added {len(placeholder_rows)} placeholder rows "
            f"for days with no App Usage"
        )

    return df
