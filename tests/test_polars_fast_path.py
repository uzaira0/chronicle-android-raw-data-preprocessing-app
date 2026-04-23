from __future__ import annotations

import os

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)
from tests.polars_helpers import ts


def _raw_fixture() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:05:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.app",
                Column.APPLICATION_LABEL: "Example",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )


def test_main_preprocessor_fast_path_matches_non_fast_path_output(tmp_path, monkeypatch) -> None:
    raw_folder = tmp_path / "raw"
    raw_folder.mkdir()
    raw_file = raw_folder / "Raw P01.csv"
    _raw_fixture().write_csv(raw_file)

    options = PreprocessingOptions(
        study_name="Smoke",
        raw_data_folder=raw_folder,
        use_app_codebook=False,
        use_filter_file=False,
    )

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "false")
    legacy = ChronicleAndroidRawDataPreprocessor(options)
    legacy_folder, legacy_success, _ = legacy.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert legacy_success

    monkeypatch.setenv("CHRONICLE_USE_POLARS_FAST_PATH", "true")
    fast = ChronicleAndroidRawDataPreprocessor(options)
    fast_folder, fast_success, _ = fast.preprocess_Chronicle_Android_raw_data_file(raw_file)
    assert fast_success

    legacy_csv = next(legacy_folder.glob("*.csv"))
    fast_csv = next(fast_folder.glob("*.csv"))
    legacy_df = pl.read_csv(legacy_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )
    fast_df = pl.read_csv(fast_csv, infer_schema=False).drop(
        Column.DATETIME_OF_PREPROCESSING, strict=False
    )

    assert legacy_df.equals(fast_df)
