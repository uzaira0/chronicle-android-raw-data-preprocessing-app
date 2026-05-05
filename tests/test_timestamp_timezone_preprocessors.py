from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, TimezoneHandlingOption
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import TimestampPreprocessor
from chronicle_preprocessing_app.core.preprocessing.timezone_preprocessor import TimezonePreprocessor
from tests.polars_helpers import frame, ts


def _options(**overrides: object) -> PreprocessingOptions:
    values = {"raw_data_folder": "", "use_app_codebook": False}
    values.update(overrides)
    return PreprocessingOptions(**values)


def test_fix_timestamp_format_normalizes_offsets_zulu_and_blank_values() -> None:
    assert TimestampPreprocessor.fix_timestamp_format(None) is None
    assert TimestampPreprocessor.fix_timestamp_format("") is None
    assert TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00Z") == "2026-01-01T00:00:00.000+00:00"
    assert TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00-06:00") == "2026-01-01T00:00:00.000-06:00"
    assert TimestampPreprocessor.fix_timestamp_format("2026-01-01 00:00:00") == "2026-01-01 00:00:00.000"


def test_timestamp_preprocessor_parses_multiple_formats_and_marks_invalid_values() -> None:
    processor = TimestampPreprocessor(_options(correct_duplicate_event_timestamps=False))
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [
                "2026-01-01T00:00:00Z",
                "2026-01-01 01:00:00-06:00",
                "2026-01-01 02:00:00",
                "not-a-date",
            ]
        }
    )

    result = processor.correct_timestamp_column(df)

    assert result.schema[Column.EVENT_TIMESTAMP].time_zone == "UTC"
    assert result.get_column(f"{Column.EVENT_TIMESTAMP}_invalid_original").to_list() == [
        None,
        None,
        None,
        "not-a-date",
    ]


def test_timestamp_preprocessor_trims_surrounding_whitespace_and_treats_blanks_as_missing() -> None:
    processor = TimestampPreprocessor(_options(correct_duplicate_event_timestamps=False))
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [
                " 2026-01-01 00:00:00 ",
                " 2026-01-01T01:00:00Z ",
                "   ",
                None,
                " not-a-date ",
            ]
        }
    )

    result = processor.correct_timestamp_column(df)

    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 3
    assert result.get_column(f"{Column.EVENT_TIMESTAMP}_invalid_original").to_list() == [
        None,
        None,
        None,
        None,
        " not-a-date ",
    ]


def test_timestamp_preprocessor_full_pipeline_formats_gaps_and_disorder() -> None:
    processor = TimestampPreprocessor(_options(correct_duplicate_event_timestamps=True))
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [
                "2026-01-01 00:00:00",
                "2026-01-01 00:00:00",
                "2026-01-01 03:30:00",
            ],
            Column.INTERACTION_TYPE: ["Activity Resumed", "Activity Paused", "Activity Resumed"],
            Column.APP_PACKAGE_NAME: ["a", "a", "b"],
        }
    )

    result = processor.preprocess(df)
    formatted = processor.format_timestamps_as_strings(result, [Column.EVENT_TIMESTAMP, "missing"])

    assert result.get_column(Column.DATA_TIME_GAP_HOURS).to_list()[-1] == 3.5
    assert formatted.schema[Column.EVENT_TIMESTAMP] == pl.String
    TimestampPreprocessor.check_for_disordered_timestamps(pl.DataFrame({"x": [1]}))
    with pytest.raises(ValueError, match="Disordered"):
        TimestampPreprocessor.check_for_disordered_timestamps(
            frame(
                [
                    {
                        Column.START_TIMESTAMP: ts("2026-01-01 02:00:00"),
                        Column.STOP_TIMESTAMP: ts("2026-01-01 01:00:00"),
                    }
                ]
            )
        )


def test_timezone_preprocessor_discovers_primary_and_folder_timezones(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "Raw P01.csv").write_text(
        f"{Column.TIMEZONE}\nAmerica/Chicago\nNone\nAmerica/New_York\n",
        encoding="utf-8",
    )
    (raw / "Survey Raw P02.csv").write_text(f"{Column.TIMEZONE}\nUTC\n", encoding="utf-8")
    (raw / "bad.csv").write_text("not_timezone\nx\n", encoding="utf-8")
    processor = TimezonePreprocessor(_options())
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"), Column.TIMEZONE: "America/Chicago"},
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 01:00:00", "UTC"), Column.TIMEZONE: "America/Chicago"},
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 02:00:00", "UTC"), Column.TIMEZONE: "America/New_York"},
        ]
    )

    assert TimezonePreprocessor.get_local_timezone().startswith("UTC")
    assert TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv") == [
        "America/Chicago",
        "America/New_York",
    ]
    assert processor.detect_timezones_in_dataframe(df) == [
        "America/Chicago",
        "America/New_York",
        "UTC",
    ]
    assert processor.determine_primary_timezone(df) == "America/Chicago"
    no_timezone_column = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")}])
    assert processor.detect_timezones_in_dataframe(no_timezone_column) == ["UTC"]
    assert processor.determine_primary_timezone(no_timezone_column) == "UTC"


def test_timezone_preprocessor_trims_timezone_values_before_discovery_and_primary_selection(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "Raw P01.csv").write_text(
        f"{Column.TIMEZONE}\n America/Chicago \nNone\n None \n\nUTC\n",
        encoding="utf-8",
    )
    processor = TimezonePreprocessor(_options())
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 4,
            Column.TIMEZONE: [" America/Chicago ", "America/Chicago", " None ", "UTC"],
        }
    )

    assert TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv") == [
        "America/Chicago",
        "UTC",
    ]
    assert processor.detect_timezones_in_dataframe(df) == [
        "America/Chicago",
        "UTC",
    ]
    assert processor.determine_primary_timezone(df) == "America/Chicago"


def test_timezone_preprocessor_returns_no_primary_timezone_without_timezone_evidence() -> None:
    processor = TimezonePreprocessor(_options())
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00")]})

    assert processor.detect_timezones_in_dataframe(df) == []
    assert processor.determine_primary_timezone(df) is None


def test_timezone_preprocessor_converts_and_filters_timestamp_columns() -> None:
    processor = TimezonePreprocessor(
        _options(
            timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
            selected_timezone="America/Chicago",
        )
    )
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 06:00:00", "UTC"),
                Column.START_TIMESTAMP: ts("2026-01-01 06:00:00", "UTC"),
                Column.STOP_TIMESTAMP: None,
                Column.TIMEZONE: "UTC",
            }
        ]
    )

    converted = processor.convert_timestamp_columns(df)
    assert converted.schema[Column.EVENT_TIMESTAMP].time_zone == "America/Chicago"
    assert converted.get_column(Column.TIMEZONE).to_list() == ["America/Chicago"]
    assert processor.convert_timestamp_column(df).schema[Column.EVENT_TIMESTAMP].time_zone == "America/Chicago"
    assert processor.preprocess(df).schema[Column.EVENT_TIMESTAMP].time_zone == "America/Chicago"
    assert processor.convert_timestamp_columns(df, columns=["missing"]).get_column(Column.TIMEZONE).to_list() == ["America/Chicago"]
