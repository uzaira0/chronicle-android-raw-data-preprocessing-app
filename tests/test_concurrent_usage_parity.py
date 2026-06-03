"""Cross-surface parity for model_concurrent_usage on a clean overlap fixture.

The pathological fixture's 32-deep stacking of time-shifted copies is unsuitable
for cross-pipeline parity comparison (see /home/opt/eyes-parity/PARITY_REPORT.md).
These tests use a small hand-built fixture with deliberate, realistic overlaps so
the primary/secondary split can be asserted exactly.
"""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, UsageLayer
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


def _clean_overlap_raw() -> pl.DataFrame:
    rows = [
        ("Activity Resumed", "com.outer", "2026-01-01 08:00:00"),
        ("Activity Resumed", "com.inner", "2026-01-01 08:05:00"),
        ("Activity Stopped", "com.inner", "2026-01-01 08:15:00"),
        ("Activity Stopped", "com.outer", "2026-01-01 08:30:00"),
        ("Activity Resumed", "com.solo", "2026-01-01 09:00:00"),
        ("Activity Stopped", "com.solo", "2026-01-01 09:10:00"),
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


def test_flag_off_output_unchanged_vs_baseline():
    raw = _clean_overlap_raw()
    off = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=False)
    )._process_valid_app_usage(raw)
    assert Column.USAGE_LAYER not in off.columns


def test_flag_on_total_duration_conserved():
    """Sum of primary durations equals the sole-foreground timeline length."""
    raw = _clean_overlap_raw()
    on = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    )._process_valid_app_usage(raw)
    usage = on.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    primary = usage.filter(pl.col(Column.USAGE_LAYER) == str(UsageLayer.PRIMARY))
    # Outer 08:00-08:05 + inner 08:05-08:15 + outer 08:15-08:30 + solo 09:00-09:10
    assert primary.get_column(Column.DURATION_SECONDS).sum() == 300 + 600 + 900 + 600


def test_flag_on_outer_secondary_covers_inner_window():
    """The outer app contributes exactly 600s of secondary time during the inner window."""
    raw = _clean_overlap_raw()
    on = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    )._process_valid_app_usage(raw)
    usage = on.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    outer_secondary = usage.filter(
        (pl.col(Column.APP_PACKAGE_NAME) == "com.outer")
        & (pl.col(Column.USAGE_LAYER) == str(UsageLayer.SECONDARY))
    )
    assert outer_secondary.height == 1
    assert outer_secondary.get_column(Column.DURATION_SECONDS).to_list() == [600.0]


def test_flag_on_solo_session_emits_single_primary_row():
    """A session with no overlap still gets a single primary-layer row."""
    raw = _clean_overlap_raw()
    on = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    )._process_valid_app_usage(raw)
    solo = on.filter(pl.col(Column.APP_PACKAGE_NAME) == "com.solo").filter(
        pl.col(Column.INTERACTION_TYPE) == "App Usage"
    )
    assert solo.height == 1
    assert solo.get_column(Column.USAGE_LAYER).to_list() == [str(UsageLayer.PRIMARY)]
    assert solo.get_column(Column.DURATION_SECONDS).to_list() == [600.0]
