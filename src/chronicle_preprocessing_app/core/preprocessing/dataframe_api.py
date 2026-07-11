"""Polars-based dataframe preprocessing API."""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import polars as pl

from chronicle_preprocessing_app.config.constants import (
    TimezoneHandlingOption,
    UsageSessionMode,
)
from chronicle_preprocessing_app.config.defaults import DEFAULT_APP_CODEBOOK_FILE_PATH
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)

LOGGER = logging.getLogger(__name__)


@dataclass
class DataFramePreprocessingConfig:
    study_name: str = ""
    selected_timezone: str | None = None
    use_app_codebook: bool = True
    app_codebook_path: str = DEFAULT_APP_CODEBOOK_FILE_PATH
    use_filter_file: bool = False
    filter_file_path: str = ""
    use_apps_forcing_screen_open_file: bool = False
    apps_forcing_screen_open_file_path: str = ""
    apps_forcing_screen_open_dict: dict[str, str] | None = None
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
    study_period_length: int = 10
    use_activity_stopped_as_fallback: bool = True
    apply_threshold_to_activity_stopped_fallback: bool = True
    filter_zero_duration_sessions: bool = False
    long_duration_threshold_hours: float = 12.0
    redcap_api_url: str | None = None
    redcap_api_token: str | None = None
    study_date_map: dict[str, tuple[Any, Any]] | None = None


@dataclass
class PreprocessingResult:
    data: pl.DataFrame
    statistics: dict[str, Any] = field(default_factory=dict)
    compliance_data: dict[str, dict[str, Any]] = field(default_factory=dict)


def _log_message(log_func: Callable[[str], None] | None, message: str) -> None:
    if log_func:
        log_func(message)
    else:
        LOGGER.info(message)


def _build_preprocessing_options(config: DataFramePreprocessingConfig) -> PreprocessingOptions:
    return PreprocessingOptions(
        study_name=config.study_name,
        raw_data_folder="",
        raw_data_file_regex_pattern=r".*\.csv$",
        use_app_codebook=config.use_app_codebook,
        app_codebook_path=config.app_codebook_path,
        use_filter_file=config.use_filter_file,
        filter_file=config.filter_file_path,
        use_apps_forcing_screen_open_file=config.use_apps_forcing_screen_open_file,
        apps_forcing_screen_open_file=config.apps_forcing_screen_open_file_path,
        apps_forcing_screen_open_dict=config.apps_forcing_screen_open_dict or {},
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
        timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_PRIMARY_TIMEZONE_PER_FILE,
        enable_preprocessing=True,
        enable_plotting=False,
        allow_stop_event_reuse=config.allow_stop_event_reuse,
        correct_duplicate_event_timestamps=config.correct_duplicate_event_timestamps,
        use_activity_stopped_as_fallback=config.use_activity_stopped_as_fallback,
        apply_threshold_to_activity_stopped_fallback=config.apply_threshold_to_activity_stopped_fallback,
        long_duration_threshold_hours=config.long_duration_threshold_hours,
        filter_zero_duration_sessions=config.filter_zero_duration_sessions,
        use_survey_data=False,
        survey_data_folder="",
        compliance_reporting=config.compliance_reporting,
        study_date_map=config.study_date_map,
    )


def preprocess_chronicle_dataframe(
    raw_df: pl.DataFrame | Any,
    config: DataFramePreprocessingConfig,
    survey_df: pl.DataFrame | Any | None = None,
    device_sharing_status: pl.DataFrame | Any | None = None,
    log_func: Callable[[str], None] | None = None,
) -> PreprocessingResult:
    del survey_df
    del device_sharing_status

    if not isinstance(raw_df, pl.DataFrame):
        raise TypeError(f"Expected Polars DataFrame, got {type(raw_df)}")

    if raw_df.is_empty():
        return PreprocessingResult(
            data=pl.DataFrame(),
            statistics={"participants_processed": 0, "total_records": 0},
            compliance_data={},
        )

    options = _build_preprocessing_options(config)
    _log_message(log_func, "Starting DataFrame-based Chronicle preprocessing")

    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / "raw.csv"
        raw_df.write_csv(input_path)
        preprocessor = ChronicleAndroidRawDataPreprocessor(options)
        _, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(input_path)
        if not success:
            return PreprocessingResult(
                data=pl.DataFrame(),
                statistics={"participants_processed": 0, "total_records": 0},
                compliance_data={},
            )

    data = preprocessor.current_participant_raw_data_df
    return PreprocessingResult(
        data=data,
        statistics={
            "participants_processed": 1,
            "participants_failed": 0,
            "total_records": data.height,
            "validation_pass_count": 1,
            "validation_fail_count": 0,
        },
        compliance_data={},
    )
