"""Golden file tests for the Chronicle Android preprocessing pipeline.

These tests run the full Python preprocessor on fixed inputs and compare the
entire output CSV against checked-in golden files in tests/golden/.

To regenerate golden files after an intentional output change:
    pytest tests/test_pipeline_golden.py --update-golden

Golden files are normal CSVs — algorithm changes show up as readable diffs.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType, TimezoneHandlingOption, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)

GOLDEN_DIR = Path(__file__).parent / "golden"
_STAMP = "2026-01-01 00:00:00"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_preprocessor(raw_df: pl.DataFrame, tmp_path: Path, **option_overrides) -> dict[str, str]:
    """Run the preprocessor and return {stem_keyword: csv_text} for every output CSV."""
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir(parents=True, exist_ok=True)
    raw_file = raw_folder / "Raw P01.csv"
    raw_df.write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="Golden",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        datetime_of_preprocessing_override=_STAMP,
        enable_plotting=False,
        **option_overrides,
    )
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert success, f"Preprocessor failed; output_folder={output_folder}"

    return {f.name: f.read_text(encoding="utf-8") for f in output_folder.glob("*.csv")}


def _assert_golden(actual_csv: str, golden_name: str, request) -> None:
    """Compare actual CSV text against tests/golden/<golden_name>.csv.

    Writes the golden file when --update-golden is set. Otherwise fails with a
    row-level diff to make the regression obvious.
    """
    golden_path = GOLDEN_DIR / golden_name
    if request.config.getoption("--update-golden"):
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(actual_csv, encoding="utf-8")
        return

    assert golden_path.exists(), f"Golden file {golden_path} missing. Run: pytest --update-golden"
    expected = golden_path.read_text(encoding="utf-8")
    if actual_csv == expected:
        return

    actual_rows = list(csv.reader(io.StringIO(actual_csv)))
    expected_rows = list(csv.reader(io.StringIO(expected)))
    diffs: list[str] = []
    for i, (exp, act) in enumerate(zip(expected_rows, actual_rows, strict=False)):
        if exp != act:
            diffs.append(f"  row {i}: expected {exp}")
            diffs.append(f"          actual   {act}")
    if len(actual_rows) != len(expected_rows):
        diffs.append(f"  row count: expected {len(expected_rows)}, got {len(actual_rows)}")
    diff_str = "\n".join(diffs[:40]) + ("\n  ...(truncated)" if len(diffs) > 40 else "")
    pytest.fail(f"Golden {golden_name} mismatch:\n{diff_str}")


# ---------------------------------------------------------------------------
# Input fixtures
# ---------------------------------------------------------------------------


def _app_only_raw() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _app_and_screen_raw() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.SCREEN_INTERACTIVE),
                Column.APP_PACKAGE_NAME: "android",
                Column.APPLICATION_LABEL: "",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:00:05-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.reader",
                Column.APPLICATION_LABEL: "Reader",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.reader",
                Column.APPLICATION_LABEL: "Reader",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:07:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.SCREEN_NON_INTERACTIVE),
                Column.APP_PACKAGE_NAME: "android",
                Column.APPLICATION_LABEL: "",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _tz_convert_raw() -> pl.DataFrame:
    """Two rows in different timezones — for timezone conversion test."""
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.app.a",
                Column.APPLICATION_LABEL: "App A",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T11:05:00-05:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.app.a",
                Column.APPLICATION_LABEL: "App A",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/New_York",
            },
        ]
    )


def _dup_timestamp_raw() -> pl.DataFrame:
    """Identical timestamps on two rows — for duplicate correction test."""
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.chat",
                Column.APPLICATION_LABEL: "Chat",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.chat",
                Column.APPLICATION_LABEL: "Chat",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.chat",
                Column.APPLICATION_LABEL: "Chat",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _filtered_raw() -> pl.DataFrame:
    """Same as app-only but with a filter file applied."""
    return _app_only_raw()


# ---------------------------------------------------------------------------
# Golden tests
# ---------------------------------------------------------------------------


def test_golden_app_only_output(tmp_path, request) -> None:
    """Full app-only preprocessed CSV matches the golden file byte-for-byte (text comparison)."""
    outputs = _run_preprocessor(_app_only_raw(), tmp_path)
    app_csv = next(v for k, v in outputs.items() if "Screen" not in k)
    _assert_golden(app_csv, "text_app_only_app_usage.csv", request)


def test_golden_app_and_screen_app_output(tmp_path, request) -> None:
    """App-usage CSV from app+screen mode matches golden (text comparison)."""
    outputs = _run_preprocessor(
        _app_and_screen_raw(),
        tmp_path,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
    )
    app_csv = next(v for k, v in outputs.items() if "Screen" not in k)
    _assert_golden(app_csv, "text_app_and_screen_app_usage.csv", request)


def test_golden_app_and_screen_screen_output(tmp_path, request) -> None:
    """Screen-usage CSV from app+screen mode matches golden (text comparison)."""
    outputs = _run_preprocessor(
        _app_and_screen_raw(),
        tmp_path,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
    )
    screen_csv = next(v for k, v in outputs.items() if "Screen" in k)
    _assert_golden(screen_csv, "text_app_and_screen_screen_usage.csv", request)


def test_golden_filtered_app_output(tmp_path, request) -> None:
    """App filtered via a filter CSV appears as Filtered App Usage in the output."""
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir(parents=True, exist_ok=True)
    raw_file = raw_folder / "Raw P01.csv"
    _filtered_raw().write_csv(raw_file)

    filter_path = tmp_path / "filter.csv"
    pl.DataFrame({"app_package_name": ["com.example.app"], "application_label": ["Example App"]}).write_csv(filter_path)

    options = PreprocessingOptions(
        study_name="Golden",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=True,
        filter_file=filter_path,
        datetime_of_preprocessing_override=_STAMP,
        enable_plotting=False,
    )
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert success
    outputs = {f.name: f.read_text(encoding="utf-8") for f in output_folder.glob("*.csv")}
    app_csv = next(v for k, v in outputs.items() if "Screen" not in k)
    _assert_golden(app_csv, "filtered_app_usage.csv", request)


def test_golden_tz_convert_output(tmp_path, request) -> None:
    """Mixed-timezone input converted to America/Chicago matches golden."""
    outputs = _run_preprocessor(
        _tz_convert_raw(),
        tmp_path,
        timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
        selected_timezone="America/Chicago",
    )
    app_csv = next(v for k, v in outputs.items() if "Screen" not in k)
    _assert_golden(app_csv, "tz_convert_app_usage.csv", request)


def test_golden_dup_timestamp_corrected_output(tmp_path, request) -> None:
    """Duplicate timestamps are corrected and the output matches golden."""
    outputs = _run_preprocessor(
        _dup_timestamp_raw(),
        tmp_path,
        correct_duplicate_event_timestamps=True,
    )
    app_csv = next(v for k, v in outputs.items() if "Screen" not in k)
    _assert_golden(app_csv, "dup_timestamp_corrected_app_usage.csv", request)
