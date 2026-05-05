from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.algorithms.archived_app_usage_algorithms import (
    ArchivedBaselineAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.screen_usage_preprocessor import (
    ScreenUsageEndReason,
    ScreenUsagePreprocessor,
)
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
    TimestampPreprocessor,
)
from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    APPS_FORCING_SCREEN_OPEN,
    FILTERED_APPS,
    FixtureBuildConfig,
    build_pathological_algorithm_dataframe,
    build_pathological_raw_dataframe,
)


def _algorithm_options(**overrides: object) -> PreprocessingOptions:
    values = {
        "raw_data_folder": "",
        "use_app_codebook": False,
        "use_filter_file": False,
        "selected_timezone": "America/Chicago",
        "allow_stop_event_reuse": False,
        "same_app_interaction_types_to_stop_usage_at": {
            InteractionType.ACTIVITY_PAUSED,
            InteractionType.ACTIVITY_STOPPED,
            InteractionType.ACTIVITY_DESTROYED,
        },
        "other_interaction_types_to_stop_usage_at": {
            InteractionType.ACTIVITY_RESUMED,
            InteractionType.FILTERED_APP_RESUMED,
            InteractionType.FILTERED_APP_USAGE,
            InteractionType.DEVICE_SHUTDOWN,
            InteractionType.USER_STOPPED,
        },
        "use_activity_stopped_as_fallback": True,
        "apply_threshold_to_activity_stopped_fallback": True,
        "long_duration_threshold_hours": 12,
    }
    values.update(overrides)
    return PreprocessingOptions(**values)


def _run_algorithm(algorithm: object, df: pl.DataFrame, options: PreprocessingOptions) -> pl.DataFrame:
    resumed_mask = df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_RESUMED)
    same_app_stop_mask = df.get_column(Column.INTERACTION_TYPE).is_in([str(value) for value in options.same_app_interaction_types_to_stop_usage_at])
    other_stop_mask = df.get_column(Column.INTERACTION_TYPE).is_in([str(value) for value in options.other_interaction_types_to_stop_usage_at])
    stopped_mask = df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_STOPPED)
    return algorithm.process_app_usage(
        df,
        resumed_mask,
        same_app_stop_mask,
        other_stop_mask,
        stopped_mask,
    )


def _normalize(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns(
        [
            pl.col(Column.EVENT_TIMESTAMP).cast(pl.String),
            pl.col(Column.START_TIMESTAMP).cast(pl.String),
            pl.col(Column.STOP_TIMESTAMP).cast(pl.String),
        ]
    )


def test_pathological_raw_fixture_contains_expected_android_pathologies() -> None:
    raw_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=2))

    duplicate_timestamps = raw_df.group_by(Column.EVENT_TIMESTAMP).len().filter(pl.col("len") > 1)
    exact_duplicates = raw_df.group_by([Column.EVENT_TIMESTAMP, Column.INTERACTION_TYPE, Column.APP_PACKAGE_NAME]).len().filter(pl.col("len") > 1)

    timestamps = raw_df.get_column(Column.EVENT_TIMESTAMP).cast(pl.String).to_list()
    interactions = set(raw_df.get_column(Column.INTERACTION_TYPE).unique().to_list())
    timezones = set(raw_df.get_column(Column.TIMEZONE).unique().to_list())

    assert not duplicate_timestamps.is_empty()
    assert duplicate_timestamps.get_column("len").max() >= 4
    assert not exact_duplicates.is_empty()
    assert len(timezones) >= 4
    assert any(value.startswith("2026-03-08") for value in timestamps)
    assert any(value.startswith("2026-11-01") for value in timestamps)
    assert any("+" in value[10:] or "-" in value[10:] for value in timestamps)
    assert any("+" not in value[10:] and "-" not in value[10:] for value in timestamps)
    assert set(FILTERED_APPS).issubset(set(raw_df.get_column(Column.APP_PACKAGE_NAME).unique().to_list()))
    assert set(APPS_FORCING_SCREEN_OPEN).issubset(set(raw_df.get_column(Column.APP_PACKAGE_NAME).unique().to_list()))
    assert {str(value) for value in InteractionType}.issubset(interactions)


def test_pathological_fixture_preserves_archived_and_optimized_parity_across_configs() -> None:
    df = build_pathological_algorithm_dataframe(config=FixtureBuildConfig(weeks=2))
    option_sets = [
        _algorithm_options(),
        _algorithm_options(allow_stop_event_reuse=True),
        _algorithm_options(apply_threshold_to_activity_stopped_fallback=False),
        _algorithm_options(
            other_interaction_types_to_stop_usage_at={
                InteractionType.ACTIVITY_RESUMED,
                InteractionType.FILTERED_APP_RESUMED,
                InteractionType.FILTERED_APP_USAGE,
                InteractionType.DEVICE_SHUTDOWN,
                InteractionType.USER_STOPPED,
                InteractionType.SCREEN_NON_INTERACTIVE,
                InteractionType.KEYGUARD_SHOWN,
            }
        ),
    ]

    for options in option_sets:
        archived = _run_algorithm(ArchivedBaselineAppUsageAlgorithm(options), df, options)
        optimized = _run_algorithm(OptimizedAppUsageAlgorithm(options), df, options)
        assert _normalize(archived).equals(_normalize(optimized))


def test_pathological_fixture_screen_usage_smoke_covers_expected_end_reasons() -> None:
    df = build_pathological_algorithm_dataframe(config=FixtureBuildConfig(weeks=2))
    options = PreprocessingOptions(
        raw_data_folder="",
        use_app_codebook=False,
        derive_screen_usage_sessions=True,
        apps_forcing_screen_open_dict=dict(APPS_FORCING_SCREEN_OPEN),
        screen_usage_auto_lock_timeout_seconds=120,
        screen_usage_auto_lock_tolerance_seconds=30,
        screen_usage_manual_lock_max_tail_gap_seconds=30,
        screen_usage_keyguard_near_stop_seconds=2,
        selected_timezone="America/Chicago",
    )

    result = ScreenUsagePreprocessor(options).derive_screen_usage_sessions(df)
    screen_usage = result.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.SCREEN_USAGE))
    end_reasons = set(screen_usage.get_column(Column.SCREEN_USAGE_END_REASON).drop_nulls().to_list())

    assert ScreenUsageEndReason.PROBABLE_MANUAL_LOCK in end_reasons
    assert ScreenUsageEndReason.PROBABLE_AUTO_LOCK in end_reasons
    assert ScreenUsageEndReason.APP_KEPT_AWAKE_OR_EXTENDED in end_reasons
    assert ScreenUsageEndReason.LOCK_SCREEN_ONLY in end_reasons
    assert ScreenUsageEndReason.MISSING_STOP in end_reasons


def test_timestamp_preprocessor_handles_mixed_naive_and_offset_raw_strings() -> None:
    df = pl.DataFrame(
        [
            {
                Column.EVENT_TIMESTAMP: "2026-02-16 06:15:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.naive",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.EVENT_TIMESTAMP: "2026-02-23T07:00:01-07:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.offset",
                Column.TIMEZONE: "America/Denver",
            },
            {
                Column.EVENT_TIMESTAMP: "2026-02-23T14:00:03+00:00",
                Column.INTERACTION_TYPE: str(InteractionType.DEVICE_SHUTDOWN),
                Column.APP_PACKAGE_NAME: "android",
                Column.TIMEZONE: "UTC",
            },
        ]
    )

    result = TimestampPreprocessor(PreprocessingOptions(raw_data_folder="", use_app_codebook=False)).correct_timestamp_column(df)
    assert result.filter(pl.col(Column.EVENT_TIMESTAMP).is_null()).is_empty()
