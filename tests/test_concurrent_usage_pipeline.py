"""Pipeline-level tests for model_concurrent_usage."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, UsageLayer
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
            Column.EVENT_TIMESTAMP: pl.Series(
                [r[2] for r in rows]
            ).str.to_datetime(time_zone="UTC"),
        }
    )


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
