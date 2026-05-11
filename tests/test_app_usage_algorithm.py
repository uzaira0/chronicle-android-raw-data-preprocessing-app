from __future__ import annotations

from random import Random

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.algorithms.archived_app_usage_algorithms import (
    ArchivedBaselineAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.algorithms.rust_app_usage_matcher import (
    rust_matcher_enabled,
)
from chronicle_preprocessing_app.core.preprocessing.app_usage_preprocessor import (
    AppUsagePreprocessor,
)
from tests.polars_helpers import cell, frame, is_null, td, ts
from tests.polars_helpers import options as _base_options

SYSTEM_APPS = [
    "android",
    "com.android.systemui",
    "com.android.settings",
    "com.google.android.gms",
]

STORE_APPS = [
    "com.spotify.music",
    "com.netflix.mediaclient",
    "com.google.android.youtube",
    "com.roblox.client",
    "com.duolingo",
    "com.discord",
]


def _row(timestamp: object, interaction_type: InteractionType, package_name: str) -> dict[str, object]:
    return {
        Column.INTERACTION_TYPE: str(interaction_type),
        Column.APP_PACKAGE_NAME: package_name,
        Column.EVENT_TIMESTAMP: timestamp,
        Column.START_TIMESTAMP: None,
        Column.STOP_TIMESTAMP: None,
        Column.TIMEZONE: "America/Chicago",
    }


def _frame(rows: list[tuple[str, InteractionType, str]]) -> pl.DataFrame:
    return frame([_row(ts(timestamp), interaction_type, package_name) for timestamp, interaction_type, package_name in rows])


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
            pl.col(Column.START_TIMESTAMP).cast(pl.String),
            pl.col(Column.STOP_TIMESTAMP).cast(pl.String),
            pl.col(Column.EVENT_TIMESTAMP).cast(pl.String),
        ]
    )


def _generated_multiweek_dst_stress_data() -> pl.DataFrame:
    rng = Random(20260308)
    rows: list[dict[str, object]] = []
    base = ts("2026-02-23 06:30:00")
    all_packages = SYSTEM_APPS + STORE_APPS

    for index, interaction_type in enumerate(InteractionType):
        rows.append(_row(base + td(minutes=index * 17), interaction_type, all_packages[index % len(all_packages)]))

    for day in range(28):
        day_start = base + td(days=day)
        for session_index in range(8):
            app = STORE_APPS[(day + session_index) % len(STORE_APPS)]
            start = day_start + td(hours=session_index + 1, minutes=rng.randrange(0, 30))
            stop = start + td(minutes=rng.randrange(1, 90))
            rows.append(_row(start, InteractionType.ACTIVITY_RESUMED, app))
            if session_index % 5 == 0:
                rows.append(_row(stop, InteractionType.ACTIVITY_STOPPED, app))
            else:
                rows.append(_row(stop, InteractionType.ACTIVITY_PAUSED, app))
            if session_index % 3 == 0:
                rows.append(_row(stop + td(minutes=1), InteractionType.ACTIVITY_RESUMED, STORE_APPS[(session_index + 1) % len(STORE_APPS)]))

        filtered_start = day_start + td(hours=20)
        rows.extend(
            [
                _row(filtered_start, InteractionType.FILTERED_APP_RESUMED, "com.filtered.app"),
                _row(filtered_start + td(minutes=10), InteractionType.FILTERED_APP_PAUSED, "com.filtered.app"),
            ]
        )

    rows.extend(
        [
            _row(ts("2026-03-08 01:55:00"), InteractionType.ACTIVITY_RESUMED, "com.dst.app"),
            _row(ts("2026-03-08 03:05:00"), InteractionType.ACTIVITY_PAUSED, "com.dst.app"),
            _row(base + td(days=29), InteractionType.ACTIVITY_RESUMED, "com.missing.stop"),
        ]
    )
    return frame(rows).sort(Column.EVENT_TIMESTAMP)


def test_multiweek_stress_data_preserves_parity_between_archived_and_optimized_algorithms() -> None:
    options = _options()
    df = _generated_multiweek_dst_stress_data()

    archived = _run_algorithm(ArchivedBaselineAppUsageAlgorithm(options), df, options)
    optimized = _run_algorithm(OptimizedAppUsageAlgorithm(options), df, options)

    assert _normalize(archived).equals(_normalize(optimized))


def test_process_valid_app_usage_converts_resumed_rows_to_usage_rows() -> None:
    options = _options()
    result = AppUsagePreprocessor(options).process_valid_app_usage(
        _frame(
            [
                ("2026-01-01 00:00:00", InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                ("2026-01-01 00:05:00", InteractionType.ACTIVITY_PAUSED, "com.example.app"),
            ]
        )
    )

    assert cell(result, 0, Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE)
    assert cell(result, 0, Column.DURATION_SECONDS) == 300.0


def test_spring_forward_session_duration_uses_elapsed_time_not_wall_clock_gap() -> None:
    options = _options()
    result = AppUsagePreprocessor(options).process_valid_app_usage(
        frame(
            [
                _row(ts("2026-03-08 01:55:00", "America/Chicago"), InteractionType.ACTIVITY_RESUMED, "com.dst.app"),
                _row(ts("2026-03-08 03:05:00", "America/Chicago"), InteractionType.ACTIVITY_PAUSED, "com.dst.app"),
            ]
        )
    )

    assert cell(result, 0, Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE)
    assert cell(result, 0, Column.DURATION_SECONDS) == 600.0


def test_missing_stop_remains_explicitly_missing_instead_of_extending_multiple_days() -> None:
    options = _options()
    result = AppUsagePreprocessor(options).process_valid_app_usage(
        frame(
            [
                _row(ts("2026-01-01 00:00:00"), InteractionType.ACTIVITY_RESUMED, "com.example.app"),
                _row(ts("2026-01-03 00:00:00"), InteractionType.NOTIFICATION_SEEN, "android"),
            ]
        )
    )
    assert is_null(cell(result, 0, Column.STOP_TIMESTAMP))


def test_rust_and_python_matchers_produce_identical_sparse_updates() -> None:
    options = _options()
    df = _generated_multiweek_dst_stress_data()

    rust_result = _run_algorithm(OptimizedAppUsageAlgorithm(options), df, options)
    assert rust_result.height == df.height

    if rust_matcher_enabled():
        python_only_options = _options()
        optimized = OptimizedAppUsageAlgorithm(python_only_options)
        optimized.options = python_only_options
        optimized_result = optimized._apply_python_matcher(
            df.clone(),
            app_packages=df.get_column(Column.APP_PACKAGE_NAME).fill_null("").to_numpy(),
            timestamp_ns=df.get_column(Column.EVENT_TIMESTAMP).dt.epoch("ns").to_numpy(),
            resumed_flags=(df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_RESUMED)).to_numpy(),
            same_stop_flags=df.get_column(Column.INTERACTION_TYPE)
            .is_in([str(value) for value in options.same_app_interaction_types_to_stop_usage_at])
            .to_numpy(),
            other_stop_flags=df.get_column(Column.INTERACTION_TYPE)
            .is_in([str(value) for value in options.other_interaction_types_to_stop_usage_at])
            .to_numpy(),
            stopped_flags=(df.get_column(Column.INTERACTION_TYPE) == str(InteractionType.ACTIVITY_STOPPED)).to_numpy(),
        )
        assert _normalize(rust_result).equals(_normalize(optimized_result))
