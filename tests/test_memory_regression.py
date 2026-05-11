"""Memory regression tests for the Chronicle preprocessing pipeline.

Uses tracemalloc (stdlib, no extra deps) to assert that peak heap allocations
stay below documented ceilings.  The ceilings are generous — the purpose is
catching severe regressions, not policing tight budgets.

Mark: @pytest.mark.slow — skip with  pytest -m "not slow"
"""

from __future__ import annotations

import tracemalloc

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.preprocessing.dataframe_api import (
    DataFramePreprocessingConfig,
    preprocess_chronicle_dataframe,
)
from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    FixtureBuildConfig,
    build_pathological_raw_dataframe,
)


def _config(**overrides: object) -> DataFramePreprocessingConfig:
    return DataFramePreprocessingConfig(
        study_name="MemoryRegression",
        use_app_codebook=False,
        use_filter_file=False,
        compliance_reporting=False,
        **overrides,
    )


def _make_simple_rows(n: int) -> list[dict[str, str]]:
    """Generate *n* alternating RESUMED/PAUSED rows spaced 5 min apart."""
    rows: list[dict[str, str]] = []
    # Base timestamp: 2026-03-07T08:00:00-06:00
    # Each pair of (RESUMED, PAUSED) covers one 5-minute app session.
    minutes = 0
    for i in range(n // 2):
        app = f"com.example.app{i % 20}"
        label = f"App{i % 20}"
        start_minutes = minutes
        end_minutes = minutes + 5
        rows.append(
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: f"2026-03-07T{8 + start_minutes // 60:02d}:{start_minutes % 60:02d}:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: app,
                Column.APPLICATION_LABEL: label,
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            }
        )
        rows.append(
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: f"2026-03-07T{8 + end_minutes // 60:02d}:{end_minutes % 60:02d}:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: app,
                Column.APPLICATION_LABEL: label,
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            }
        )
        minutes += 6  # leave 1-minute gap so sessions are never adjacent
    return rows


@pytest.mark.slow
def test_memory_peak_2000_rows_below_150mb(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Full pipeline on ~2000-row fixture must stay under 150 MB peak."""
    monkeypatch.chdir(tmp_path)
    raw_df = pl.DataFrame(_make_simple_rows(2000))

    tracemalloc.start()
    preprocess_chronicle_dataframe(raw_df, _config())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    peak_mb = peak / 1024 / 1024
    assert peak_mb < 150, f"Peak memory {peak_mb:.1f} MB exceeded 150 MB ceiling"


@pytest.mark.slow
def test_memory_peak_500_rows_below_50mb(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Full pipeline on ~500-row fixture must stay under 50 MB peak."""
    monkeypatch.chdir(tmp_path)
    raw_df = pl.DataFrame(_make_simple_rows(500))

    tracemalloc.start()
    preprocess_chronicle_dataframe(raw_df, _config())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    peak_mb = peak / 1024 / 1024
    assert peak_mb < 50, f"Peak memory {peak_mb:.1f} MB exceeded 50 MB ceiling"


@pytest.mark.slow
def test_memory_peak_pathological_fixture_below_200mb(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Pathological fixture (2 weeks ≈ 800+ rows) must stay under 200 MB peak.

    This fixture exercises DST transitions, duplicate timestamps, mixed
    timezone offsets, filtered apps, and screen-forcing apps — the
    worst-case paths for the preprocessor.
    """
    monkeypatch.chdir(tmp_path)
    raw_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=2))

    tracemalloc.start()
    preprocess_chronicle_dataframe(raw_df, _config())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    peak_mb = peak / 1024 / 1024
    assert peak_mb < 200, f"Peak memory {peak_mb:.1f} MB exceeded 200 MB ceiling"
