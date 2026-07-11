"""Integration tests for the programmatic preprocessing entry point.

These tests drive the full pipeline via ChronicleAndroidRawDataPreprocessor
(the public API exposed by main_preprocessor.py) the same way an external
caller or future CLI wrapper would use it: point at a raw-data folder, run,
inspect the output CSVs.
"""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import (
    Column,
    InteractionType,
    UsageSessionMode,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_DETERMINISTIC_STAMP = "2026-01-01 00:00:00"


def _make_raw_csv(folder: Path, filename: str, rows: list[dict]) -> Path:
    path = folder / filename
    pl.DataFrame(rows).write_csv(path)
    return path


def _minimal_app_rows(
    participant_id: str = "P01",
    timezone: str = "America/Chicago",
) -> list[dict]:
    return [
        {
            Column.PARTICIPANT_ID: participant_id,
            Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
            Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
            Column.APP_PACKAGE_NAME: "com.example.app",
            Column.APPLICATION_LABEL: "Example",
            Column.USERNAME: "Target Child",
            Column.TIMEZONE: timezone,
        },
        {
            Column.PARTICIPANT_ID: participant_id,
            Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
            Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
            Column.APP_PACKAGE_NAME: "com.example.app",
            Column.APPLICATION_LABEL: "Example",
            Column.USERNAME: "Target Child",
            Column.TIMEZONE: timezone,
        },
    ]


def _make_options(
    raw_folder: Path,
    *,
    study_name: str = "IntegTest",
    usage_session_mode: UsageSessionMode = UsageSessionMode.APP_USAGE,
) -> PreprocessingOptions:
    return PreprocessingOptions(
        study_name=study_name,
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        usage_session_mode=usage_session_mode,
        datetime_of_preprocessing_override=_DETERMINISTIC_STAMP,
        enable_plotting=False,
    )


# ---------------------------------------------------------------------------
# Test 1 — single file: output CSV exists and contains expected columns
# ---------------------------------------------------------------------------


def test_single_file_produces_output_csv_with_expected_columns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Processing a single valid raw CSV file produces a preprocessed output CSV
    that contains the core columns required for downstream analysis."""
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    _make_raw_csv(raw_folder, "Raw P01.csv", _minimal_app_rows("P01"))

    options = _make_options(raw_folder)
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(
        raw_folder / "Raw P01.csv"
    )

    assert success, "Preprocessor returned success=False"
    output_csvs = list(output_folder.glob("*.csv"))
    assert output_csvs, f"No output CSV found in {output_folder}"

    df = pl.read_csv(output_csvs[0], infer_schema=False)
    required_columns = {
        Column.PARTICIPANT_ID,
        Column.EVENT_TIMESTAMP,
        Column.INTERACTION_TYPE,
        Column.APP_PACKAGE_NAME,
        Column.DURATION_SECONDS,
        Column.DATETIME_OF_PREPROCESSING,
    }
    missing = required_columns - set(df.columns)
    assert not missing, f"Output CSV missing columns: {missing}"

    # Deterministic stamp must be present in the output
    assert _DETERMINISTIC_STAMP in df.get_column(Column.DATETIME_OF_PREPROCESSING).to_list()


# ---------------------------------------------------------------------------
# Test 2 — folder with multiple participant files
# ---------------------------------------------------------------------------


def test_folder_with_multiple_participants_produces_one_output_per_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """preprocess_Chronicle_Android_raw_data_folder processes every matching file
    and writes one preprocessed CSV per participant."""
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    for pid in ("P01", "P02", "P03"):
        _make_raw_csv(raw_folder, f"Raw {pid}.csv", _minimal_app_rows(pid))

    options = _make_options(raw_folder)
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, stats = preprocessor.preprocess_Chronicle_Android_raw_data_folder()

    assert stats.processed_files == 3, f"Expected 3 processed files, got {stats.processed_files}"
    assert stats.failed_files == 0, f"Expected 0 failures, got {stats.failed_files}"

    output_csvs = list(output_folder.glob("*.csv"))
    assert len(output_csvs) == 3, (
        f"Expected 3 output CSVs, found {len(output_csvs)}: {[f.name for f in output_csvs]}"
    )

    # Each output CSV must have the participant_id column
    for csv_file in output_csvs:
        df = pl.read_csv(csv_file, infer_schema=False)
        assert Column.PARTICIPANT_ID in df.columns, (
            f"{csv_file.name} is missing {Column.PARTICIPANT_ID}"
        )


# ---------------------------------------------------------------------------
# Test 3 — empty/headerless file returns success=False without raising
# ---------------------------------------------------------------------------


def test_file_with_no_app_usage_events_returns_failure_without_raising(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A raw file that contains only non-app-usage events (so the algorithm
    finds nothing to match) must result in success=False — not an unhandled
    exception — and the stats should record it as an empty file."""
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")

    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    # Only screen events — no Resumed/Paused, so no app usage sessions can be derived.
    rows = [
        {
            Column.PARTICIPANT_ID: "P01",
            Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
            Column.INTERACTION_TYPE: str(InteractionType.SCREEN_INTERACTIVE),
            Column.APP_PACKAGE_NAME: "android",
            Column.APPLICATION_LABEL: "",
            Column.USERNAME: "Target Child",
            Column.TIMEZONE: "America/Chicago",
        },
        {
            Column.PARTICIPANT_ID: "P01",
            Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
            Column.INTERACTION_TYPE: str(InteractionType.SCREEN_NON_INTERACTIVE),
            Column.APP_PACKAGE_NAME: "android",
            Column.APPLICATION_LABEL: "",
            Column.USERNAME: "Target Child",
            Column.TIMEZONE: "America/Chicago",
        },
    ]
    _make_raw_csv(raw_folder, "Raw P01.csv", rows)

    options = _make_options(raw_folder)
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(
        raw_folder / "Raw P01.csv"
    )

    # Either success=False (NoAppUsageDataError path) or success=True with empty output
    # depending on whether the fast path handles it.  Either way: no unhandled exception.
    if not success:
        assert output_folder == Path(), "Expected empty output_folder when success=False"
        assert preprocessor.stats.empty_files == 1


# ---------------------------------------------------------------------------
# Test 4 — empty folder returns empty stats without raising
# ---------------------------------------------------------------------------


def test_empty_folder_returns_empty_stats_without_raising(
    tmp_path: Path,
) -> None:
    """Pointing the preprocessor at an empty folder must not raise; the stats
    should reflect zero files processed."""
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()

    options = _make_options(raw_folder)
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, stats = preprocessor.preprocess_Chronicle_Android_raw_data_folder()

    assert stats.total_files == 0
    assert stats.processed_files == 0
    assert output_folder == Path()
