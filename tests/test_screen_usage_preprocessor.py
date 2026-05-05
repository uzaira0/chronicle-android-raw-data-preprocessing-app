from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.screen_usage_preprocessor import (
    ScreenUsageEndReason,
    ScreenUsagePreprocessor,
)
from tests.polars_helpers import cell, frame, is_null, rows_where, td, ts


def _screen_row(
    timestamp: object,
    interaction_type: InteractionType,
    package_name: str = "android",
) -> dict[str, object]:
    return {
        Column.EVENT_TIMESTAMP: timestamp,
        Column.INTERACTION_TYPE: str(interaction_type),
        Column.APP_PACKAGE_NAME: package_name,
        Column.START_TIMESTAMP: None,
        Column.STOP_TIMESTAMP: None,
        Column.TIMEZONE: "America/Chicago",
    }


def _screen_options(**overrides: object) -> PreprocessingOptions:
    values = {
        "raw_data_folder": "",
        "use_app_codebook": False,
        "derive_screen_usage_sessions": True,
        "screen_usage_auto_lock_timeout_seconds": 120,
        "screen_usage_auto_lock_tolerance_seconds": 30,
        "screen_usage_manual_lock_max_tail_gap_seconds": 30,
        "screen_usage_keyguard_near_stop_seconds": 2,
        "apps_forcing_screen_open_dict": {
            "com.google.android.youtube": "Video",
            "com.google.android.apps.maps": "Navigation",
        },
    }
    values.update(overrides)
    return PreprocessingOptions(**values)


def test_screen_usage_derivation_truth_table_outputs_expected_end_reasons() -> None:
    options = _screen_options()
    df = frame(
        [
            _screen_row(ts("2026-03-07 10:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 10:00:05"), InteractionType.ACTIVITY_RESUMED, "com.example.chat"),
            _screen_row(ts("2026-03-07 10:00:20"), InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row(ts("2026-03-07 11:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 11:00:01"), InteractionType.KEYGUARD_SHOWN),
            _screen_row(ts("2026-03-07 11:00:10"), InteractionType.KEYGUARD_HIDDEN),
            _screen_row(ts("2026-03-07 11:00:15"), InteractionType.ACTIVITY_RESUMED, "com.example.reader"),
            _screen_row(ts("2026-03-07 11:02:15"), InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row(ts("2026-03-07 12:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 12:00:10"), InteractionType.ACTIVITY_RESUMED, "com.google.android.youtube"),
            _screen_row(ts("2026-03-07 12:30:10"), InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row(ts("2026-03-07 13:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 13:00:01"), InteractionType.KEYGUARD_SHOWN),
            _screen_row(ts("2026-03-07 13:00:20"), InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row(ts("2026-03-07 16:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 16:00:10"), InteractionType.ACTIVITY_RESUMED, "com.example.chat"),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = rows_where(result, Column.INTERACTION_TYPE, str(InteractionType.SCREEN_USAGE))

    assert screen_usage.height == 5
    assert screen_usage.get_column(Column.SCREEN_USAGE_END_REASON).to_list() == [
        ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
        ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
        ScreenUsageEndReason.APP_KEPT_AWAKE_OR_EXTENDED,
        ScreenUsageEndReason.LOCK_SCREEN_ONLY,
        ScreenUsageEndReason.MISSING_STOP,
    ]
    assert is_null(cell(screen_usage, 4, Column.STOP_TIMESTAMP))


def test_screen_usage_handles_dst_shift_without_multi_hour_artifact() -> None:
    options = _screen_options()
    df = frame(
        [
            _screen_row(ts("2026-03-08 07:55:00+00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-08 07:56:00+00:00"), InteractionType.ACTIVITY_RESUMED, "com.screen.dst"),
            _screen_row(ts("2026-03-08 08:05:00+00:00"), InteractionType.SCREEN_NON_INTERACTIVE),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = rows_where(result, Column.INTERACTION_TYPE, str(InteractionType.SCREEN_USAGE))

    assert cell(screen_usage, 0, Column.DURATION_SECONDS) == 600.0
    assert cell(screen_usage, 0, Column.SCREEN_USAGE_TAIL_GAP_SECONDS) == 540.0


def test_app_and_screen_usage_mode_writes_separate_output_files(tmp_path) -> None:
    from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
        ChronicleAndroidRawDataPreprocessor,
    )

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    options = PreprocessingOptions(
        study_name="Study",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
    )
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    preprocessor.current_participant_id = "P01"
    preprocessor.current_participant_raw_data_df = frame(
        [
            {
                **_screen_row(ts("2026-03-07 10:00:00"), InteractionType.APP_USAGE, "com.example.app"),
                Column.START_TIMESTAMP: ts("2026-03-07 10:00:00"),
                Column.STOP_TIMESTAMP: ts("2026-03-07 10:01:00"),
                Column.DURATION_SECONDS: 60.0,
                Column.DURATION_MINUTES: 1.0,
            }
        ]
    )
    preprocessor.current_participant_screen_usage_df = frame(
        [
            {
                **_screen_row(ts("2026-03-07 10:00:00"), InteractionType.SCREEN_USAGE, "com.example.app"),
                Column.START_TIMESTAMP: ts("2026-03-07 10:00:00"),
                Column.STOP_TIMESTAMP: ts("2026-03-07 10:05:00"),
                Column.DURATION_SECONDS: 300.0,
                Column.DURATION_MINUTES: 5.0,
                Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
            }
        ]
    )

    output_folder = preprocessor.finalize_and_save_preprocessed_data_df("Raw P01.csv")

    app_file = output_folder / "P01 Automatically Preprocessed.csv"
    screen_file = output_folder / "P01 Screen Usage Automatically Preprocessed.csv"
    assert app_file.exists()
    assert screen_file.exists()
    assert pl.read_csv(app_file).get_column(Column.INTERACTION_TYPE).to_list() == [str(InteractionType.APP_USAGE)]
    assert pl.read_csv(screen_file).get_column(Column.INTERACTION_TYPE).to_list() == [str(InteractionType.SCREEN_USAGE)]


def test_screen_usage_returns_original_when_disabled_or_no_start_events() -> None:
    disabled = _screen_options(
        usage_session_mode=UsageSessionMode.APP_USAGE,
        derive_screen_usage_sessions=False,
    )
    df = frame([_screen_row(ts("2026-03-07 10:00:00"), InteractionType.ACTIVITY_RESUMED)])

    assert ScreenUsagePreprocessor(disabled).preprocess(df).equals(df)
    assert ScreenUsagePreprocessor(disabled).derive_screen_usage_sessions(df).equals(df)
    assert ScreenUsagePreprocessor(_screen_options()).derive_screen_usage_sessions(df).equals(df)


def test_screen_usage_rejects_missing_required_columns() -> None:
    with pytest.raises(ValueError, match="required columns"):
        ScreenUsagePreprocessor(_screen_options()).derive_screen_usage_sessions(pl.DataFrame({Column.EVENT_TIMESTAMP: [ts("2026-03-07 10:00:00")]}))


def test_screen_usage_ignores_null_timestamp_start_without_creating_session() -> None:
    df = frame(
        [
            _screen_row(None, InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 10:00:10"), InteractionType.SCREEN_NON_INTERACTIVE),
        ]
    )

    result = ScreenUsagePreprocessor(_screen_options()).derive_screen_usage_sessions(df)

    assert result.equals(df)


def test_screen_usage_keeps_blank_foreground_package_as_missing() -> None:
    df = frame(
        [
            _screen_row(ts("2026-03-07 10:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 10:00:05"), InteractionType.USER_INTERACTION, None),
            _screen_row(ts("2026-03-07 10:00:10"), InteractionType.ACTIVITY_RESUMED, "   "),
            _screen_row(ts("2026-03-07 10:00:20"), InteractionType.SCREEN_NON_INTERACTIVE),
        ]
    )

    result = ScreenUsagePreprocessor(_screen_options()).derive_screen_usage_sessions(df)
    screen_usage = rows_where(result, Column.INTERACTION_TYPE, str(InteractionType.SCREEN_USAGE))

    assert is_null(cell(screen_usage, 0, Column.APP_PACKAGE_NAME))
    assert cell(screen_usage, 0, Column.SCREEN_USAGE_END_REASON) == ScreenUsageEndReason.PROBABLE_MANUAL_LOCK


def test_screen_usage_classifies_unknown_extended_idle_and_near_keyguard_stop() -> None:
    options = _screen_options(screen_usage_keyguard_near_stop_seconds=3)
    df = frame(
        [
            _screen_row(ts("2026-03-07 10:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 10:10:00"), InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row(ts("2026-03-07 11:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 11:00:20"), InteractionType.USER_INTERACTION),
            _screen_row(ts("2026-03-07 11:10:00"), InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row(ts("2026-03-07 12:00:00"), InteractionType.SCREEN_INTERACTIVE),
            _screen_row(ts("2026-03-07 12:04:00"), InteractionType.ACTIVITY_RESUMED, "com.example"),
            _screen_row(ts("2026-03-07 12:10:59"), InteractionType.KEYGUARD_SHOWN),
            _screen_row(ts("2026-03-07 12:11:00"), InteractionType.SCREEN_NON_INTERACTIVE),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    reasons = rows_where(result, Column.INTERACTION_TYPE, str(InteractionType.SCREEN_USAGE)).get_column(Column.SCREEN_USAGE_END_REASON).to_list()

    assert reasons == [
        ScreenUsageEndReason.UNKNOWN,
        ScreenUsageEndReason.EXTENDED_IDLE_OR_UNKNOWN,
        ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
    ]
