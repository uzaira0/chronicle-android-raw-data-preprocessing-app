from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
    TimestampPreprocessor,
)
from tests.polars_helpers import cell, frame, is_null, ts
from tests.polars_helpers import options as _base_options


def _row(
    timestamp: str,
    interaction_type: InteractionType,
    package_name: str,
) -> dict[str, object]:
    return {
        Column.INTERACTION_TYPE: str(interaction_type),
        Column.APP_PACKAGE_NAME: package_name,
        Column.EVENT_TIMESTAMP: ts(timestamp),
        Column.START_TIMESTAMP: None,
        Column.STOP_TIMESTAMP: None,
        Column.TIMEZONE: "America/Chicago",
    }


def _frame(rows: list[tuple[str, InteractionType, str]]) -> pl.DataFrame:
    return frame(
        [
            _row(timestamp, interaction_type, package_name)
            for timestamp, interaction_type, package_name in rows
        ]
    )


def _options(**overrides: object) -> PreprocessingOptions:
    return _base_options(
        **{
            "same_app_interaction_types_to_stop_usage_at": {InteractionType.ACTIVITY_PAUSED},
            "other_interaction_types_to_stop_usage_at": {
                InteractionType.ACTIVITY_RESUMED,
                InteractionType.FILTERED_APP_RESUMED,
                InteractionType.FILTERED_APP_USAGE,
                InteractionType.DEVICE_SHUTDOWN,
            },
            "use_activity_stopped_as_fallback": True,
            "apply_threshold_to_activity_stopped_fallback": True,
            "long_duration_threshold_hours": 12,
            **overrides,
        }
    )


def _run(df: pl.DataFrame, options: PreprocessingOptions) -> pl.DataFrame:
    resumed_mask = df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_RESUMED)
    same_app_stop_mask = df.get_column(Column.INTERACTION_TYPE).is_in(
        [str(value) for value in options.same_app_interaction_types_to_stop_usage_at]
    )
    other_stop_mask = df.get_column(Column.INTERACTION_TYPE).is_in(
        [str(value) for value in options.other_interaction_types_to_stop_usage_at]
    )
    stopped_mask = df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_STOPPED)

    return OptimizedAppUsageAlgorithm(options).process_app_usage(
        df,
        resumed_mask,
        same_app_stop_mask,
        other_stop_mask,
        stopped_mask,
    )


def test_same_app_stop_closes_session_when_it_is_the_only_stop() -> None:
    result = _run(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ]
        ),
        _options(),
    )
    assert cell(result, 0, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")


def test_other_app_resume_closes_previous_session_when_same_app_stop_missing() -> None:
    result = _run(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.a"),
                ("2026-01-01 00:05:00", InteractionType.ACTIVITY_RESUMED, "com.example.b"),
            ]
        ),
        _options(),
    )
    assert cell(result, 0, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")


def test_device_shutdown_is_default_other_app_stop() -> None:
    result = _run(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:05:00", InteractionType.DEVICE_SHUTDOWN, "android"),
            ]
        ),
        _options(),
    )
    assert cell(result, 0, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")


def test_stop_reuse_disabled_assigns_stop_to_nearest_preceding_start() -> None:
    result = _run(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:01:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ]
        ),
        _options(allow_stop_event_reuse=False),
    )
    assert cell(result, 0, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")
    assert cell(result, 1, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")


def test_stop_reuse_enabled_closes_all_compatible_starts() -> None:
    result = _run(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:01:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ]
        ),
        _options(allow_stop_event_reuse=True),
    )
    assert cell(result, 0, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")
    assert cell(result, 1, Column.STOP_TIMESTAMP) == ts("2026-01-01 00:05:00")


def test_long_fallback_is_rejected_when_threshold_applies() -> None:
    result = _run(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-02 00:30:00", InteractionType.ACTIVITY_STOPPED, "com.example.app"),
            ]
        ),
        _options(long_duration_threshold_hours=12),
    )
    assert is_null(cell(result, 0, Column.STOP_TIMESTAMP))


def test_duplicate_timestamp_priority_keeps_resume_before_stop() -> None:
    options = _options()
    df = frame(
        [
            _row("2026-01-01 00:00:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            _row("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
        ]
    )
    result = TimestampPreprocessor(options).unalign_duplicate_timestamps(df)
    timestamps = result.get_column(Column.EVENT_TIMESTAMP).to_list()
    assert timestamps[0] < timestamps[1]
