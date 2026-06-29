from __future__ import annotations

from datetime import date

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.preprocessing.dataframe_api import (
    DataFramePreprocessingConfig,
    preprocess_chronicle_dataframe,
)


def _raw_rows() -> list[dict[str, str]]:
    return [
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


def _config(**overrides: object) -> DataFramePreprocessingConfig:
    return DataFramePreprocessingConfig(
        study_name="DataFrameApi",
        use_app_codebook=False,
        use_filter_file=False,
        compliance_reporting=False,
        **overrides,
    )


def test_preprocess_chronicle_dataframe_processes_polars_input_and_reports_stats(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    messages: list[str] = []

    result = preprocess_chronicle_dataframe(
        pl.DataFrame(_raw_rows()),
        _config(),
        log_func=messages.append,
    )

    assert messages == ["Starting DataFrame-based Chronicle preprocessing"]
    assert result.statistics == {
        "participants_processed": 1,
        "participants_failed": 0,
        "total_records": 1,
        "validation_pass_count": 1,
        "validation_fail_count": 0,
    }
    assert result.compliance_data == {}
    assert result.data.get_column(Column.INTERACTION_TYPE).to_list() == [
        str(InteractionType.APP_USAGE)
    ]
    assert result.data.get_column(Column.APP_PACKAGE_NAME).to_list() == ["com.example.chat"]
    assert result.data.get_column(Column.DURATION_SECONDS).to_list() == [300.0]


def test_preprocess_chronicle_dataframe_uses_utc_when_timezone_column_is_missing(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    raw_df = pl.DataFrame(_raw_rows()).drop(Column.TIMEZONE)

    result = preprocess_chronicle_dataframe(raw_df, _config())

    assert result.statistics["participants_failed"] == 0
    assert result.data.get_column(Column.INTERACTION_TYPE).to_list() == [
        str(InteractionType.APP_USAGE)
    ]
    assert result.data.get_column(Column.TIMEZONE).to_list() == ["UTC"]
    assert result.data.get_column(Column.DURATION_SECONDS).to_list() == [300.0]


def test_preprocess_chronicle_dataframe_applies_study_date_map_from_config(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    raw_df = pl.DataFrame(
        [
            *_raw_rows(),
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-08T09:00:00-05:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                Column.APP_PACKAGE_NAME: "com.example.maps",
                Column.APPLICATION_LABEL: "Maps",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-08T09:05:00-05:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.maps",
                Column.APPLICATION_LABEL: "Maps",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            },
        ]
    )

    result = preprocess_chronicle_dataframe(
        raw_df,
        _config(study_date_map={"P01": (date(2026, 3, 7), date(2026, 3, 7))}),
    )

    assert result.statistics["total_records"] == 2
    assert result.data.get_column(Column.APP_PACKAGE_NAME).to_list() == [
        "com.example.chat",
        "com.example.maps",
    ]


def test_preprocess_chronicle_dataframe_returns_empty_result_for_empty_input() -> None:
    result = preprocess_chronicle_dataframe(
        pl.DataFrame(),
        _config(),
    )

    assert result.data.is_empty()
    assert result.statistics == {"participants_processed": 0, "total_records": 0}
    assert result.compliance_data == {}


def test_preprocess_chronicle_dataframe_returns_empty_result_for_no_valid_app_usage(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    raw_df = pl.DataFrame(
        [
            {
                Column.PARTICIPANT_ID: "P01",
                Column.EVENT_TIMESTAMP: "2026-03-07T10:00:00-06:00",
                Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_PAUSED),
                Column.APP_PACKAGE_NAME: "com.example.chat",
                Column.APPLICATION_LABEL: "Chat",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
            }
        ]
    )

    result = preprocess_chronicle_dataframe(raw_df, _config())

    assert result.data.is_empty()
    assert result.statistics == {
        "participants_processed": 1,
        "participants_failed": 0,
        "total_records": 0,
        "validation_pass_count": 1,
        "validation_fail_count": 0,
    }
    assert result.compliance_data == {}


def test_preprocess_chronicle_dataframe_rejects_non_polars_input() -> None:
    with pytest.raises(TypeError, match="Expected Polars DataFrame"):
        preprocess_chronicle_dataframe(
            [{"participant_id": "P01"}],
            _config(),
        )
