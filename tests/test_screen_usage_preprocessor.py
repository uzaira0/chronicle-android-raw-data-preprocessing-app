from __future__ import annotations

import pandas as pd

from chronicle_preprocessing_app.config.constants import Column, InteractionType, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)
from chronicle_preprocessing_app.core.preprocessing.screen_usage_preprocessor import (
    ScreenUsageEndReason,
    ScreenUsagePreprocessor,
)
from tests.test_app_usage_algorithm import _generated_multiweek_dst_stress_data


def _screen_row(
    timestamp: str | pd.Timestamp,
    interaction_type: InteractionType,
    package_name: str = "android",
) -> dict[str, object]:
    return {
        Column.EVENT_TIMESTAMP: pd.Timestamp(timestamp),
        Column.INTERACTION_TYPE: interaction_type,
        Column.APP_PACKAGE_NAME: package_name,
        Column.START_TIMESTAMP: pd.NaT,
        Column.STOP_TIMESTAMP: pd.NaT,
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
        "keep_awake_apps_dict": {
            "com.google.android.youtube": "Video",
            "com.google.android.apps.maps": "Navigation",
        },
    }
    values.update(overrides)
    return PreprocessingOptions(**values)


def _screen_usage_rows(df: pd.DataFrame) -> pd.DataFrame:
    return df[df[Column.INTERACTION_TYPE] == InteractionType.SCREEN_USAGE].reset_index(
        drop=True
    )


def _none_if_missing(value: object) -> object:
    return None if pd.isna(value) else value


def _screen_usage_summary(screen_usage: pd.DataFrame) -> list[dict[Column, object]]:
    columns = [
        Column.START_TIMESTAMP,
        Column.STOP_TIMESTAMP,
        Column.DURATION_SECONDS,
        Column.SCREEN_USAGE_END_REASON,
        Column.SCREEN_USAGE_TAIL_GAP_SECONDS,
        Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE,
        Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL,
        Column.SCREEN_USAGE_LOCK_SCREEN_ONLY,
    ]
    return [
        {column: _none_if_missing(row[column]) for column in columns}
        for _, row in screen_usage[columns].iterrows()
    ]


def test_screen_usage_derivation_is_disabled_by_default() -> None:
    options = PreprocessingOptions(raw_data_folder="", use_app_codebook=False)
    df = pd.DataFrame(
        [
            _screen_row("2026-03-07 10:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row("2026-03-07 10:05:00", InteractionType.SCREEN_NON_INTERACTIVE),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)

    assert len(result) == len(df)
    assert InteractionType.SCREEN_USAGE not in set(result[Column.INTERACTION_TYPE])


def test_legacy_screen_usage_flag_enables_app_and_screen_mode() -> None:
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        derive_screen_usage_sessions=True,
    )

    assert options.usage_session_mode == UsageSessionMode.APP_AND_SCREEN_USAGE
    assert options.process_app_usage_sessions
    assert options.process_screen_usage_sessions


def test_screen_usage_truth_table_outputs_on_realistic_sessions() -> None:
    options = _screen_options()
    df = pd.DataFrame(
        [
            # No-password/manual-looking end: short tail gap to screen off.
            _screen_row("2026-03-07 10:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row(
                "2026-03-07 10:00:05",
                InteractionType.ACTIVITY_RESUMED,
                "com.example.chat",
            ),
            _screen_row("2026-03-07 10:00:20", InteractionType.SCREEN_NON_INTERACTIVE),
            # Password device, normal auto-lock after the configured 2 minutes.
            _screen_row("2026-03-07 11:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row("2026-03-07 11:00:01", InteractionType.KEYGUARD_SHOWN),
            _screen_row("2026-03-07 11:00:10", InteractionType.KEYGUARD_HIDDEN),
            _screen_row(
                "2026-03-07 11:00:15",
                InteractionType.ACTIVITY_RESUMED,
                "com.example.reader",
            ),
            _screen_row("2026-03-07 11:02:15", InteractionType.SCREEN_NON_INTERACTIVE),
            # Keep-awake video app extends past the 2-minute auto-lock timeout.
            _screen_row("2026-03-07 12:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row(
                "2026-03-07 12:00:10",
                InteractionType.ACTIVITY_RESUMED,
                "com.google.android.youtube",
            ),
            _screen_row("2026-03-07 12:30:10", InteractionType.SCREEN_NON_INTERACTIVE),
            # Lock-screen-only wake: screen was on, but never unlocked and no app foregrounded.
            _screen_row("2026-03-07 13:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row("2026-03-07 13:00:01", InteractionType.KEYGUARD_SHOWN),
            _screen_row("2026-03-07 13:00:20", InteractionType.SCREEN_NON_INTERACTIVE),
            # OEM shift: keyguard shown before screen interactive, then normal unlock/autolock.
            _screen_row("2026-03-07 14:00:00", InteractionType.KEYGUARD_SHOWN),
            _screen_row("2026-03-07 14:00:01", InteractionType.SCREEN_INTERACTIVE),
            _screen_row("2026-03-07 14:00:10", InteractionType.KEYGUARD_HIDDEN),
            _screen_row(
                "2026-03-07 14:00:15",
                InteractionType.ACTIVITY_RESUMED,
                "com.example.game",
            ),
            _screen_row("2026-03-07 14:02:15", InteractionType.DEVICE_SCREEN_OFF),
            # Duplicate starts/stops: one session, first stop wins.
            _screen_row("2026-03-07 15:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row("2026-03-07 15:00:01", InteractionType.SCREEN_INTERACTIVE),
            _screen_row(
                "2026-03-07 15:00:05",
                InteractionType.ACTIVITY_RESUMED,
                "com.example.chat",
            ),
            _screen_row("2026-03-07 15:00:15", InteractionType.SCREEN_NON_INTERACTIVE),
            _screen_row("2026-03-07 15:00:16", InteractionType.DEVICE_SCREEN_OFF),
            # Missing stop: retained explicitly rather than manufacturing a multi-day duration.
            _screen_row("2026-03-07 16:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row(
                "2026-03-07 16:00:10",
                InteractionType.ACTIVITY_RESUMED,
                "com.example.chat",
            ),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = _screen_usage_rows(result)

    summary = _screen_usage_summary(screen_usage)

    assert summary == [
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 10:00:00"),
            Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 10:00:20"),
            Column.DURATION_SECONDS: 20.0,
            Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: 15.0,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: "com.example.chat",
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: False,
        },
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 11:00:00"),
            Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 11:02:15"),
            Column.DURATION_SECONDS: 135.0,
            Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: 120.0,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: "com.example.reader",
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: False,
        },
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 12:00:00"),
            Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 12:30:10"),
            Column.DURATION_SECONDS: 1810.0,
            Column.SCREEN_USAGE_END_REASON: (
                ScreenUsageEndReason.APP_KEPT_AWAKE_OR_EXTENDED
            ),
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: 1800.0,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: "com.google.android.youtube",
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "Video",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: False,
        },
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 13:00:00"),
            Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 13:00:20"),
            Column.DURATION_SECONDS: 20.0,
            Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.LOCK_SCREEN_ONLY,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: None,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: None,
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: True,
        },
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 14:00:01"),
            Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 14:02:15"),
            Column.DURATION_SECONDS: 134.0,
            Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: 120.0,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: "com.example.game",
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: False,
        },
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 15:00:00"),
            Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 15:00:15"),
            Column.DURATION_SECONDS: 15.0,
            Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.PROBABLE_MANUAL_LOCK,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: 10.0,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: "com.example.chat",
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: False,
        },
        {
            Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 16:00:00"),
            Column.STOP_TIMESTAMP: None,
            Column.DURATION_SECONDS: None,
            Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.MISSING_STOP,
            Column.SCREEN_USAGE_TAIL_GAP_SECONDS: None,
            Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE: "com.example.chat",
            Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL: "",
            Column.SCREEN_USAGE_LOCK_SCREEN_ONLY: False,
        },
    ]


def test_screen_usage_duration_handles_dst_spring_forward_elapsed_time() -> None:
    options = _screen_options()
    df = pd.DataFrame(
        [
            _screen_row(
                pd.Timestamp("2026-03-08 01:55:00", tz="America/Chicago"),
                InteractionType.SCREEN_INTERACTIVE,
            ),
            _screen_row(
                pd.Timestamp("2026-03-08 01:56:00", tz="America/Chicago"),
                InteractionType.ACTIVITY_RESUMED,
                "com.example.chat",
            ),
            _screen_row(
                pd.Timestamp("2026-03-08 03:05:00", tz="America/Chicago"),
                InteractionType.SCREEN_NON_INTERACTIVE,
            ),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = _screen_usage_rows(result).iloc[0]

    assert screen_usage[Column.DURATION_SECONDS] == 600.0
    assert screen_usage[Column.SCREEN_USAGE_END_REASON] == (
        ScreenUsageEndReason.EXTENDED_IDLE_OR_UNKNOWN
    )


def test_screen_usage_keyguard_near_stop_strengthens_manual_lock_confidence() -> None:
    options = _screen_options()
    df = pd.DataFrame(
        [
            _screen_row("2026-03-07 10:00:00", InteractionType.SCREEN_INTERACTIVE),
            _screen_row(
                "2026-03-07 10:00:05",
                InteractionType.ACTIVITY_RESUMED,
                "com.example.chat",
            ),
            _screen_row("2026-03-07 10:00:18", InteractionType.KEYGUARD_SHOWN),
            _screen_row("2026-03-07 10:00:20", InteractionType.SCREEN_NON_INTERACTIVE),
        ]
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = _screen_usage_rows(result).iloc[0]

    assert screen_usage[Column.SCREEN_USAGE_END_REASON] == (
        ScreenUsageEndReason.PROBABLE_MANUAL_LOCK
    )
    assert screen_usage[Column.SCREEN_USAGE_END_REASON_CONFIDENCE] == 0.9


def test_screen_usage_on_multiweek_dst_stress_data_has_expected_controlled_outputs() -> None:
    options = _screen_options(
        keep_awake_apps_dict={
            "com.screen.keepawake": "Video",
            "com.google.android.youtube": "Video",
            "com.google.android.apps.maps": "Navigation",
        }
    )
    df = _generated_multiweek_dst_stress_data(include_screen_usage_stress=True)

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = _screen_usage_rows(result)

    base = pd.Timestamp("2026-02-23 06:30:00", tz="America/Chicago")
    controlled_lock_screen_starts: list[pd.Timestamp] = []
    for day in range(28):
        day_start = base + pd.Timedelta(days=day)
        controlled_lock_screen_starts.append(day_start + pd.Timedelta(minutes=60))

    complete_screen_usage = screen_usage[screen_usage[Column.STOP_TIMESTAMP].notna()]
    assert (complete_screen_usage[Column.DURATION_SECONDS] >= 0).all()
    assert complete_screen_usage[Column.DURATION_SECONDS].max() < 24 * 60 * 60

    manual = screen_usage[
        screen_usage[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE].isin(
            {"com.screen.manual", "com.screen.duplicate"}
        )
    ]
    assert len(manual) == 56
    assert set(manual[Column.SCREEN_USAGE_END_REASON]) == {
        ScreenUsageEndReason.PROBABLE_MANUAL_LOCK
    }

    auto_lock = screen_usage[
        screen_usage[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE].isin(
            {"com.screen.auto", "com.screen.oem"}
        )
    ]
    assert len(auto_lock) == 56
    assert set(auto_lock[Column.SCREEN_USAGE_END_REASON]) == {
        ScreenUsageEndReason.PROBABLE_AUTO_LOCK
    }

    controlled_lock_screen_only = screen_usage[
        screen_usage[Column.START_TIMESTAMP].isin(controlled_lock_screen_starts)
    ]
    assert len(controlled_lock_screen_only) == 28
    assert set(controlled_lock_screen_only[Column.SCREEN_USAGE_END_REASON]) == {
        ScreenUsageEndReason.LOCK_SCREEN_ONLY
    }
    assert controlled_lock_screen_only[Column.SCREEN_USAGE_LOCK_SCREEN_ONLY].all()

    missing = screen_usage[
        screen_usage[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE] == "com.screen.missing"
    ].iloc[0]
    assert missing[Column.SCREEN_USAGE_END_REASON] == ScreenUsageEndReason.MISSING_STOP
    assert pd.isna(missing[Column.STOP_TIMESTAMP])
    assert pd.isna(missing[Column.DURATION_SECONDS])

    dst = screen_usage[
        screen_usage[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE] == "com.screen.dst"
    ].iloc[0]
    assert dst[Column.DURATION_SECONDS] == 600.0
    assert dst[Column.SCREEN_USAGE_TAIL_GAP_SECONDS] == 540.0

    keep_awake = screen_usage[
        screen_usage[Column.SCREEN_USAGE_FOREGROUND_APP_PACKAGE] == "com.screen.keepawake"
    ]
    assert len(keep_awake) == 28
    assert set(keep_awake[Column.SCREEN_USAGE_KEEP_AWAKE_APP_LABEL]) == {"Video"}
    assert set(keep_awake[Column.SCREEN_USAGE_END_REASON]) == {
        ScreenUsageEndReason.APP_KEPT_AWAKE_OR_EXTENDED
    }


def test_app_and_screen_usage_mode_writes_separate_output_files(tmp_path) -> None:
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
    preprocessor.current_participant_raw_data_df = pd.DataFrame(
        [
            _screen_row(
                "2026-03-07 10:00:00",
                InteractionType.APP_USAGE,
                "com.example.app",
            )
        ]
    )
    preprocessor.current_participant_raw_data_df[Column.START_TIMESTAMP] = pd.Timestamp(
        "2026-03-07 10:00:00"
    )
    preprocessor.current_participant_raw_data_df[Column.STOP_TIMESTAMP] = pd.Timestamp(
        "2026-03-07 10:01:00"
    )
    preprocessor.current_participant_screen_usage_df = pd.DataFrame(
        [
            {
                **_screen_row(
                    "2026-03-07 10:00:00",
                    InteractionType.SCREEN_USAGE,
                    "com.example.app",
                ),
                Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 10:00:00"),
                Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 10:05:00"),
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
    assert pd.read_csv(app_file)[Column.INTERACTION_TYPE].tolist() == [
        InteractionType.APP_USAGE
    ]
    assert pd.read_csv(screen_file)[Column.INTERACTION_TYPE].tolist() == [
        InteractionType.SCREEN_USAGE
    ]


def test_screen_usage_only_mode_writes_screen_usage_output_file(tmp_path) -> None:
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    options = PreprocessingOptions(
        study_name="Study",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        usage_session_mode=UsageSessionMode.SCREEN_USAGE,
    )
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    preprocessor.current_participant_id = "P01"
    preprocessor.current_participant_raw_data_df = pd.DataFrame(
        [
            {
                **_screen_row(
                    "2026-03-07 10:00:00",
                    InteractionType.SCREEN_USAGE,
                    "com.example.app",
                ),
                Column.START_TIMESTAMP: pd.Timestamp("2026-03-07 10:00:00"),
                Column.STOP_TIMESTAMP: pd.Timestamp("2026-03-07 10:05:00"),
                Column.DURATION_SECONDS: 300.0,
                Column.DURATION_MINUTES: 5.0,
                Column.SCREEN_USAGE_END_REASON: ScreenUsageEndReason.PROBABLE_AUTO_LOCK,
            }
        ]
    )

    output_folder = preprocessor.finalize_and_save_preprocessed_data_df("Raw P01.csv")

    app_file = output_folder / "P01 Automatically Preprocessed.csv"
    screen_file = output_folder / "P01 Screen Usage Automatically Preprocessed.csv"
    assert not app_file.exists()
    assert screen_file.exists()
    assert pd.read_csv(screen_file)[Column.INTERACTION_TYPE].tolist() == [
        InteractionType.SCREEN_USAGE
    ]
