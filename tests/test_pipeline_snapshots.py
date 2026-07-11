"""Snapshot tests for the full Chronicle Android preprocessing pipeline output.

Uses pytest-syrupy for snapshot assertions. Run with --snapshot-update once to
generate/refresh the stored snapshots, then without the flag to verify stability.
"""

from __future__ import annotations

import polars as pl
from syrupy.assertion import SnapshotAssertion

from chronicle_preprocessing_app.config.constants import Column, InteractionType, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DETERMINISTIC_STAMP = "2026-01-01 00:00:00"


def _app_only_raw_fixture() -> pl.DataFrame:
    """Minimal two-event raw CSV content: one Resumed + one Paused."""
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


def _multi_app_raw_fixture() -> pl.DataFrame:
    """Two distinct apps with resumed/paused pairs — 4 raw events total."""
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T09:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.social.media",
                Column.APPLICATION_LABEL: "Social App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T09:10:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.social.media",
                Column.APPLICATION_LABEL: "Social App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.game",
                Column.APPLICATION_LABEL: "Game App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:15:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.game",
                Column.APPLICATION_LABEL: "Game App",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _screen_and_app_raw_fixture() -> pl.DataFrame:
    """Raw data that includes screen-related events alongside app events."""
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P02",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.SCREEN_INTERACTIVE),
                Column.APP_PACKAGE_NAME: "android",
                Column.APPLICATION_LABEL: "",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P02",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:00:05-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.reader",
                Column.APPLICATION_LABEL: "Reader",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P02",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.reader",
                Column.APPLICATION_LABEL: "Reader",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P02",
                Column.EVENT_TIMESTAMP: "2026-03-07T08:07:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.SCREEN_NON_INTERACTIVE),
                Column.APP_PACKAGE_NAME: "android",
                Column.APPLICATION_LABEL: "",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def _preprocess_to_csv(
    raw_fixture: pl.DataFrame,
    tmp_path,
    *,
    study_name: str = "Snapshot",
    usage_session_mode: UsageSessionMode = UsageSessionMode.APP_USAGE,
    monkeypatch=None,
) -> pl.DataFrame:
    """Write fixture to tmp_path, run the preprocessor, return the output CSV as a DataFrame."""
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir(parents=True, exist_ok=True)
    raw_file = raw_folder / "Raw P01.csv"
    raw_fixture.write_csv(raw_file)

    options = PreprocessingOptions(
        study_name=study_name,
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        usage_session_mode=usage_session_mode,
        datetime_of_preprocessing_override=_DETERMINISTIC_STAMP,
        enable_plotting=False,
    )
    if monkeypatch is not None:
        monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")

    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert success, "Preprocessor reported failure"

    output_csvs = list(output_folder.glob("*.csv"))
    assert output_csvs, f"No output CSVs found in {output_folder}"
    return pl.read_csv(output_csvs[0], infer_schema=False)


# ---------------------------------------------------------------------------
# Snapshot tests
# ---------------------------------------------------------------------------


def test_snapshot_app_only_column_names(snapshot: SnapshotAssertion, tmp_path, monkeypatch) -> None:
    """Column names in the app-usage output must not silently change."""
    df = _preprocess_to_csv(_app_only_raw_fixture(), tmp_path, monkeypatch=monkeypatch)
    assert sorted(df.columns) == snapshot


def test_snapshot_app_only_row_count_and_interaction_types(
    snapshot: SnapshotAssertion, tmp_path, monkeypatch
) -> None:
    """App-only pipeline: row count and interaction types present are stable."""
    df = _preprocess_to_csv(_app_only_raw_fixture(), tmp_path, monkeypatch=monkeypatch)
    interaction_types = sorted(
        df.get_column(Column.INTERACTION_TYPE).drop_nulls().unique().to_list()
    )
    result = {
        "row_count": df.height,
        "interaction_types": interaction_types,
    }
    assert result == snapshot


def test_snapshot_multi_app_output_shape(
    snapshot: SnapshotAssertion, tmp_path, monkeypatch
) -> None:
    """Multi-app session: row count and package names present are stable."""
    df = _preprocess_to_csv(
        _multi_app_raw_fixture(), tmp_path, study_name="MultiApp", monkeypatch=monkeypatch
    )
    package_names = sorted(df.get_column(Column.APP_PACKAGE_NAME).drop_nulls().unique().to_list())
    result = {
        "row_count": df.height,
        "package_names": package_names,
    }
    assert result == snapshot


def test_snapshot_preprocessed_timestamp_format(
    snapshot: SnapshotAssertion, tmp_path, monkeypatch
) -> None:
    """The datetime_of_preprocessing column value must match the override exactly."""
    df = _preprocess_to_csv(_app_only_raw_fixture(), tmp_path, monkeypatch=monkeypatch)
    timestamps = df.get_column(Column.DATETIME_OF_PREPROCESSING).drop_nulls().unique().to_list()
    # All rows must carry the same override value — snapshot ensures format stability.
    assert sorted(timestamps) == snapshot


def test_snapshot_app_and_screen_output_has_screen_usage_type(
    snapshot: SnapshotAssertion, tmp_path, monkeypatch
) -> None:
    """APP_AND_SCREEN_USAGE mode must produce SCREEN_USAGE interaction_type rows."""
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir(parents=True, exist_ok=True)
    raw_file = raw_folder / "Raw P02.csv"
    _screen_and_app_raw_fixture().write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="ScreenApp",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
        datetime_of_preprocessing_override=_DETERMINISTIC_STAMP,
        enable_plotting=False,
    )
    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert success

    # The screen usage output is written to a separate CSV with "Screen Usage" in name.
    screen_csvs = list(output_folder.glob("*Screen Usage*.csv"))
    app_csvs = [f for f in output_folder.glob("*.csv") if "Screen Usage" not in f.name]

    interaction_types_present = set()
    for csv_file in screen_csvs + app_csvs:
        df = pl.read_csv(csv_file, infer_schema=False)
        if Column.INTERACTION_TYPE in df.columns:
            interaction_types_present.update(
                df.get_column(Column.INTERACTION_TYPE).drop_nulls().unique().to_list()
            )

    result = {
        "has_screen_usage_rows": str(InteractionType.SCREEN_USAGE) in interaction_types_present,
        "has_app_usage_rows": str(InteractionType.APP_USAGE) in interaction_types_present,
    }
    assert result == snapshot
