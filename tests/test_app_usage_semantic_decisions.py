from __future__ import annotations

import pandas as pd

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
    TimestampPreprocessor,
)


def _row(
    timestamp: str,
    interaction_type: InteractionType,
    package_name: str,
) -> dict[Column, object]:
    return {
        Column.INTERACTION_TYPE: interaction_type,
        Column.APP_PACKAGE_NAME: package_name,
        Column.EVENT_TIMESTAMP: pd.Timestamp(timestamp),
        Column.START_TIMESTAMP: pd.NaT,
        Column.STOP_TIMESTAMP: pd.NaT,
        Column.TIMEZONE: "America/Chicago",
    }


def _frame(rows: list[tuple[str, InteractionType, str]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            _row(timestamp, interaction_type, package_name)
            for timestamp, interaction_type, package_name in rows
        ]
    )


def _options(**overrides: object) -> PreprocessingOptions:
    values = {
        "raw_data_folder": "",
        "use_app_codebook": False,
        "same_app_interaction_types_to_stop_usage_at": {
            InteractionType.ACTIVITY_PAUSED
        },
        "other_interaction_types_to_stop_usage_at": {
            InteractionType.ACTIVITY_RESUMED,
            InteractionType.FILTERED_APP_RESUMED,
            InteractionType.FILTERED_APP_USAGE,
            InteractionType.DEVICE_SHUTDOWN,
        },
        "use_activity_stopped_as_fallback": True,
        "apply_threshold_to_activity_stopped_fallback": True,
        "long_duration_threshold_hours": 12,
    }
    values.update(overrides)
    return PreprocessingOptions(**values)


def _run(df: pd.DataFrame, options: PreprocessingOptions) -> pd.DataFrame:
    resumed_mask = df[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED
    same_app_stop_mask = df[Column.INTERACTION_TYPE].isin(
        options.same_app_interaction_types_to_stop_usage_at
    )
    other_stop_mask = df[Column.INTERACTION_TYPE].isin(
        options.other_interaction_types_to_stop_usage_at
    )
    stopped_mask = df[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_STOPPED

    return OptimizedAppUsageAlgorithm(options).process_app_usage(
        df,
        resumed_mask,
        same_app_stop_mask,
        other_stop_mask,
        stopped_mask,
    )


def test_settled_same_app_stop_closes_session_when_it_is_the_only_stop() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 00:05:00",
                    InteractionType.ACTIVITY_PAUSED,
                    "com.example.app",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:05:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_other_app_resume_closes_previous_app_when_same_app_stop_missing() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.a",
                ),
                (
                    "2026-01-01 00:05:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.b",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:05:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_filtered_app_resume_closes_previous_valid_app() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.valid",
                ),
                (
                    "2026-01-01 00:05:00",
                    InteractionType.FILTERED_APP_RESUMED,
                    "com.example.filtered",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:05:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_device_shutdown_closes_session_as_default_stop() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 00:05:00",
                    InteractionType.DEVICE_SHUTDOWN,
                    "android",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:05:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_earliest_valid_stop_wins_when_same_and_other_stops_exist() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.a",
                ),
                (
                    "2026-01-01 00:02:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.b",
                ),
                (
                    "2026-01-01 00:05:00",
                    InteractionType.ACTIVITY_PAUSED,
                    "com.example.a",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:02:00"
    )


def test_settled_stop_reuse_disabled_assigns_stop_to_nearest_preceding_start() -> None:
    options = _options(allow_stop_event_reuse=False)
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 00:10:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 00:11:00",
                    InteractionType.ACTIVITY_PAUSED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 00:20:00",
                    InteractionType.NOTIFICATION_SEEN,
                    "android",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:20:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED
    assert result.loc[1, Column.START_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:10:00"
    )
    assert result.loc[1, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:11:00"
    )
    assert result.loc[1, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_file_end_closes_open_session_at_last_file_event_timestamp() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 23:50:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-02 00:10:00",
                    InteractionType.NOTIFICATION_RECEIVED,
                    "android",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-02 00:10:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_exact_threshold_duration_is_valid_when_threshold_is_configured() -> None:
    options = _options(long_duration_threshold_hours=12)
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 12:00:00",
                    InteractionType.ACTIVITY_STOPPED,
                    "com.example.app",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.STOP_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 12:00:00"
    )
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_settled_missing_stop_is_diagnostic_and_does_not_fabricate_duration() -> None:
    options = _options()
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                )
            ]
        ),
        options,
    )

    assert result.loc[0, Column.START_TIMESTAMP] == pd.Timestamp(
        "2026-01-01 00:00:00"
    )
    assert pd.isna(result.loc[0, Column.STOP_TIMESTAMP])
    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING


def test_settled_activity_stopped_over_threshold_is_not_used_by_default() -> None:
    options = _options(long_duration_threshold_hours=12)
    result = _run(
        _frame(
            [
                (
                    "2026-01-01 00:00:00",
                    InteractionType.ACTIVITY_RESUMED,
                    "com.example.app",
                ),
                (
                    "2026-01-01 13:00:00",
                    InteractionType.ACTIVITY_STOPPED,
                    "com.example.app",
                ),
            ]
        ),
        options,
    )

    assert result.loc[0, Column.INTERACTION_TYPE] == InteractionType.END_OF_USAGE_MISSING
    assert pd.isna(result.loc[0, Column.STOP_TIMESTAMP])


def test_settled_duplicate_timestamp_priority_is_resume_then_neutral_then_stop() -> None:
    options = _options(
        same_app_interaction_types_to_stop_usage_at={InteractionType.ACTIVITY_PAUSED}
    )
    duplicate_timestamp = "2026-01-01 00:00:00"
    df = _frame(
        [
            (
                duplicate_timestamp,
                InteractionType.ACTIVITY_PAUSED,
                "com.example.app",
            ),
            (
                duplicate_timestamp,
                InteractionType.NOTIFICATION_SEEN,
                "android",
            ),
            (
                duplicate_timestamp,
                InteractionType.ACTIVITY_RESUMED,
                "com.example.app",
            ),
        ]
    )

    result = TimestampPreprocessor(options).unalign_duplicate_timestamps(
        df,
        Column.EVENT_TIMESTAMP,
    )

    assert result[Column.INTERACTION_TYPE].tolist() == [
        InteractionType.ACTIVITY_RESUMED,
        InteractionType.NOTIFICATION_SEEN,
        InteractionType.ACTIVITY_PAUSED,
    ]
    assert result[Column.EVENT_TIMESTAMP].is_monotonic_increasing
