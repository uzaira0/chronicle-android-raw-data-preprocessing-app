"""Pipeline-level tests for model_concurrent_usage."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType, UsageLayer
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


def _two_overlapping_apps_raw() -> pl.DataFrame:
    """App A resumed, B resumed inside A, B stopped, A stopped."""
    rows = [
        ("Activity Resumed", "com.a", "2026-01-01 08:00:00"),
        ("Activity Resumed", "com.b", "2026-01-01 08:10:00"),
        ("Activity Stopped", "com.b", "2026-01-01 08:20:00"),
        ("Activity Stopped", "com.a", "2026-01-01 08:30:00"),
    ]
    return pl.DataFrame(
        {
            Column.INTERACTION_TYPE: [r[0] for r in rows],
            Column.APP_PACKAGE_NAME: [r[1] for r in rows],
            Column.EVENT_TIMESTAMP: pl.Series([r[2] for r in rows]).str.to_datetime(
                time_zone="UTC"
            ),
        }
    )


def _two_overlapping_apps_raw_file(tmp_path):
    """Write the two-overlapping-apps fixture to a CSV file and return the path."""
    rows = [
        (
            "P01",
            "Activity Resumed",
            "com.a",
            "App A",
            "Target Child",
            "America/Chicago",
            "2026-01-01T08:00:00+00:00",
        ),
        (
            "P01",
            "Activity Resumed",
            "com.b",
            "App B",
            "Target Child",
            "America/Chicago",
            "2026-01-01T08:10:00+00:00",
        ),
        (
            "P01",
            "Activity Stopped",
            "com.b",
            "App B",
            "Target Child",
            "America/Chicago",
            "2026-01-01T08:20:00+00:00",
        ),
        (
            "P01",
            "Activity Stopped",
            "com.a",
            "App A",
            "Target Child",
            "America/Chicago",
            "2026-01-01T08:30:00+00:00",
        ),
    ]
    df = pl.DataFrame(
        {
            Column.PARTICIPANT_ID: [r[0] for r in rows],
            Column.INTERACTION_TYPE: [r[1] for r in rows],
            Column.APP_PACKAGE_NAME: [r[2] for r in rows],
            Column.APPLICATION_LABEL: [r[3] for r in rows],
            Column.USERNAME: [r[4] for r in rows],
            Column.TIMEZONE: [r[5] for r in rows],
            Column.EVENT_TIMESTAMP: [r[6] for r in rows],
        }
    )
    raw_file = tmp_path / "Raw P01.csv"
    df.write_csv(raw_file)
    return raw_file


def test_flag_off_csv_does_not_contain_usage_layer_column(tmp_path):
    """save_preprocessed_output must NOT emit usage_layer when flag is off."""
    raw_file = _two_overlapping_apps_raw_file(tmp_path)
    preprocessor = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=False)
    )
    result = preprocessor.preprocess_raw_data_file(raw_file)
    out_folder = preprocessor.save_preprocessed_output(
        result.data,
        raw_data_filename=raw_file.name,
        output_folder=tmp_path,
        study_name="test",
        pre_algo_event_timestamps=result.pre_algo_event_timestamps,
    )
    csv_files = list(out_folder.glob("*.csv"))
    assert len(csv_files) == 1
    written = pl.read_csv(csv_files[0])
    assert Column.USAGE_LAYER not in written.columns


def test_flag_on_csv_contains_usage_layer_column_with_primary_and_secondary(tmp_path):
    """save_preprocessed_output must emit usage_layer with primary/secondary when flag is on."""
    raw_file = _two_overlapping_apps_raw_file(tmp_path)
    preprocessor = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    )
    result = preprocessor.preprocess_raw_data_file(raw_file)
    out_folder = preprocessor.save_preprocessed_output(
        result.data,
        raw_data_filename=raw_file.name,
        output_folder=tmp_path,
        study_name="test",
        pre_algo_event_timestamps=result.pre_algo_event_timestamps,
    )
    csv_files = list(out_folder.glob("*.csv"))
    assert len(csv_files) == 1
    written = pl.read_csv(csv_files[0])
    assert Column.USAGE_LAYER in written.columns
    app_usage = written.filter(pl.col(Column.INTERACTION_TYPE) == str(InteractionType.APP_USAGE))
    layers = set(app_usage.get_column(Column.USAGE_LAYER).drop_nulls().to_list())
    assert str(UsageLayer.PRIMARY) in layers
    assert str(UsageLayer.SECONDARY) in layers


def test_flag_off_keeps_single_foreground_behavior():
    options = PreprocessingOptions(raw_data_folder="", model_concurrent_usage=False)
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_two_overlapping_apps_raw())
    # No usage_layer column when the flag is off.
    assert Column.USAGE_LAYER not in out.columns


def test_flag_on_emits_primary_and_secondary_rows():
    options = PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_two_overlapping_apps_raw())
    assert Column.USAGE_LAYER in out.columns
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    layers = set(usage.get_column(Column.USAGE_LAYER).to_list())
    assert layers == {str(UsageLayer.PRIMARY), str(UsageLayer.SECONDARY)}
    # com.a contributes a secondary row during B's 08:10-08:20 window.
    a_secondary = usage.filter(
        (pl.col(Column.APP_PACKAGE_NAME) == "com.a")
        & (pl.col(Column.USAGE_LAYER) == str(UsageLayer.SECONDARY))
    )
    assert a_secondary.height == 1
    assert a_secondary.get_column(Column.DURATION_SECONDS).to_list() == [600.0]


def test_apply_min_duration_to_concurrent_subintervals_nulls_short_durations():
    # All sub-intervals here are 600s; with the option on and a 601s threshold,
    # every sub-interval is below threshold so durations are nulled but rows kept.
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=True,
        apply_minimum_usage_duration_to_concurrent_subintervals=True,
        minimum_usage_duration=601,
    )
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_two_overlapping_apps_raw())
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    assert usage.height >= 2  # rows kept
    assert usage.get_column(Column.DURATION_SECONDS).null_count() == usage.height
    assert usage.get_column(Column.DURATION_MINUTES).null_count() == usage.height
    # Layer labels are preserved even though durations were suppressed.
    assert Column.USAGE_LAYER in out.columns
    assert set(usage.get_column(Column.USAGE_LAYER).to_list()) == {
        str(UsageLayer.PRIMARY),
        str(UsageLayer.SECONDARY),
    }


def test_min_duration_gate_default_off_keeps_durations():
    # Option defaults off: minimum_usage_duration alone must NOT null fast-path
    # split durations (proves the new flag is what gates the behavior).
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=True,
        minimum_usage_duration=601,
    )
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_two_overlapping_apps_raw())
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    assert usage.get_column(Column.DURATION_SECONDS).null_count() == 0


def _single_short_session_raw(stop: str) -> pl.DataFrame:
    """One app resumed at 08:00:00 then stopped at ``stop`` (same day)."""
    rows = [
        ("Activity Resumed", "com.a", "2026-01-01 08:00:00"),
        ("Activity Stopped", "com.a", f"2026-01-01 {stop}"),
    ]
    return pl.DataFrame(
        {
            Column.INTERACTION_TYPE: [r[0] for r in rows],
            Column.APP_PACKAGE_NAME: [r[1] for r in rows],
            Column.EVENT_TIMESTAMP: pl.Series([r[2] for r in rows]).str.to_datetime(
                time_zone="UTC"
            ),
        }
    )


def test_minimum_usage_duration_nulls_short_nonconcurrent_session():
    # Non-concurrent (default) path must now mirror web browserPipeline.ts: a
    # session shorter than minimum_usage_duration has its duration nulled but the
    # row is kept. 3s session, threshold 5 -> nulled.
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        minimum_usage_duration=5,
    )
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_single_short_session_raw("08:00:03"))
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    assert usage.height == 1  # row kept
    assert usage.get_column(Column.DURATION_SECONDS).null_count() == 1
    assert usage.get_column(Column.DURATION_MINUTES).null_count() == 1
    # No usage_layer column when concurrent usage is off.
    assert Column.USAGE_LAYER not in out.columns


def test_minimum_usage_duration_keeps_session_at_or_above_threshold():
    # 3s session, threshold 2 -> at/above threshold, duration retained.
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        minimum_usage_duration=2,
    )
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_single_short_session_raw("08:00:03"))
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    assert usage.height == 1
    assert usage.get_column(Column.DURATION_SECONDS).to_list() == [3.0]


def test_minimum_usage_duration_zero_keeps_all_nonconcurrent_durations():
    # Default threshold 0 disables nulling entirely (Set to 0 to disable).
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        minimum_usage_duration=0,
    )
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_single_short_session_raw("08:00:03"))
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    assert usage.get_column(Column.DURATION_SECONDS).to_list() == [3.0]
