"""P2: filter_zero_duration_sessions must drop only zero-duration *App Usage*, not
Filtered App Usage — matching the web pipeline, which filters only "App Usage".

Before the fix the Python fast path applied the filter per usage_type, so the
Filtered App Usage pass dropped zero-duration filtered rows that web keeps.
"""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

_HEADER_ROWS = [
    # com.norm → a zero-duration App Usage (resume == stop).
    (
        "P01",
        "Activity Resumed",
        "com.norm",
        "Norm",
        "Target Child",
        "America/Chicago",
        "2026-01-01T08:00:00+00:00",
    ),
    (
        "P01",
        "Activity Stopped",
        "com.norm",
        "Norm",
        "Target Child",
        "America/Chicago",
        "2026-01-01T08:00:00+00:00",
    ),
    # com.filtered → a zero-duration Filtered App Usage (in the filter dict).
    (
        "P01",
        "Activity Resumed",
        "com.filtered",
        "Filt",
        "Target Child",
        "America/Chicago",
        "2026-01-01T08:10:00+00:00",
    ),
    (
        "P01",
        "Activity Stopped",
        "com.filtered",
        "Filt",
        "Target Child",
        "America/Chicago",
        "2026-01-01T08:10:00+00:00",
    ),
]


def _raw_file(tmp_path):
    df = pl.DataFrame(
        {
            Column.PARTICIPANT_ID: [r[0] for r in _HEADER_ROWS],
            Column.INTERACTION_TYPE: [r[1] for r in _HEADER_ROWS],
            Column.APP_PACKAGE_NAME: [r[2] for r in _HEADER_ROWS],
            Column.APPLICATION_LABEL: [r[3] for r in _HEADER_ROWS],
            Column.USERNAME: [r[4] for r in _HEADER_ROWS],
            Column.TIMEZONE: [r[5] for r in _HEADER_ROWS],
            Column.EVENT_TIMESTAMP: [r[6] for r in _HEADER_ROWS],
        }
    )
    raw_file = tmp_path / "Raw P01.csv"
    df.write_csv(raw_file)
    return raw_file


def _process(tmp_path, *, filter_zero: bool) -> pl.DataFrame:
    pre = PolarsFastPathPreprocessor(
        PreprocessingOptions(
            raw_data_folder="",
            use_filter_file=True,
            apps_to_filter_dict={"com.filtered": "Filt"},
            minimum_usage_duration=0,  # keep the zero-duration rows non-null
            # Off so equal resume/stop timestamps stay equal → a genuine zero
            # duration (otherwise duplicate-correction nudges them 1µs apart).
            correct_duplicate_event_timestamps=False,
            filter_zero_duration_sessions=filter_zero,
        )
    )
    return pre.preprocess_raw_data_file(_raw_file(tmp_path)).data


def test_filter_drops_zero_app_usage_but_keeps_filtered(tmp_path):
    interactions = (
        _process(tmp_path, filter_zero=True).get_column(Column.INTERACTION_TYPE).to_list()
    )
    # Zero-duration App Usage is dropped…
    assert str(InteractionType.APP_USAGE) not in interactions
    # …but a zero-duration Filtered App Usage row is kept (web parity).
    assert str(InteractionType.FILTERED_APP_USAGE) in interactions


def test_filter_off_keeps_both_zero_duration_rows(tmp_path):
    interactions = (
        _process(tmp_path, filter_zero=False).get_column(Column.INTERACTION_TYPE).to_list()
    )
    assert str(InteractionType.APP_USAGE) in interactions
    assert str(InteractionType.FILTERED_APP_USAGE) in interactions
