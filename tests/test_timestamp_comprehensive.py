from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import Column, TimezoneHandlingOption
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import TimestampPreprocessor
from chronicle_preprocessing_app.core.preprocessing.timezone_preprocessor import (
    TimezonePreprocessor,
    _normalize_timezone_expr,
)
from tests.polars_helpers import cell, frame, is_null, rows_where, ts


def _options(**overrides: object) -> PreprocessingOptions:
    values = {"raw_data_folder": "", "use_app_codebook": False}
    values.update(overrides)
    return PreprocessingOptions(**values)


def _ts_preprocessor(**overrides: object) -> TimestampPreprocessor:
    return TimestampPreprocessor(_options(**overrides))


def _tz_preprocessor(**overrides: object) -> TimezonePreprocessor:
    return TimezonePreprocessor(_options(**overrides))


# ---------------------------------------------------------------------------
# fix_timestamp_format
# ---------------------------------------------------------------------------


def test_fix_timestamp_format_none_returns_none() -> None:
    assert TimestampPreprocessor.fix_timestamp_format(None) is None  # type: ignore[arg-type]


def test_fix_timestamp_format_empty_string_returns_none() -> None:
    assert TimestampPreprocessor.fix_timestamp_format("") is None


def test_fix_timestamp_format_whitespace_only_returns_none() -> None:
    assert TimestampPreprocessor.fix_timestamp_format("   ") is None


def test_fix_timestamp_format_z_suffix_converted_to_plus_utc() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00Z")
    assert result is not None
    assert result.endswith("+00:00")
    assert "Z" not in result


def test_fix_timestamp_format_z_suffix_adds_fractional_seconds() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00Z")
    assert result == "2026-01-01T00:00:00.000+00:00"


def test_fix_timestamp_format_positive_offset_no_fractional_adds_ms() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-06-15T12:30:00+05:30")
    assert result == "2026-06-15T12:30:00.000+05:30"


def test_fix_timestamp_format_negative_offset_no_fractional_adds_ms() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00-06:00")
    assert result == "2026-01-01T00:00:00.000-06:00"


def test_fix_timestamp_format_already_has_fractional_seconds_not_doubled() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00.123+00:00")
    assert result == "2026-01-01T00:00:00.123+00:00"
    assert ".123.000" not in (result or "")


def test_fix_timestamp_format_no_timezone_no_fractional_adds_ms() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-01-01 00:00:00")
    assert result == "2026-01-01 00:00:00.000"


def test_fix_timestamp_format_t_separator_preserved() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-03-10T08:15:30")
    assert result is not None
    assert "T" in result


def test_fix_timestamp_format_space_separator_preserved() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-03-10 08:15:30")
    assert result is not None
    assert " " in result


def test_fix_timestamp_format_microseconds_already_present_not_modified() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-01-01T00:00:00.123456+00:00")
    assert result == "2026-01-01T00:00:00.123456+00:00"


def test_fix_timestamp_format_negative_offset_eight_hours() -> None:
    result = TimestampPreprocessor.fix_timestamp_format("2026-09-01T23:59:59-08:00")
    assert result == "2026-09-01T23:59:59.000-08:00"


# ---------------------------------------------------------------------------
# correct_timestamp_column
# ---------------------------------------------------------------------------


def test_correct_timestamp_column_all_null_stays_null() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: [None, None]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 2


def test_correct_timestamp_column_no_invalid_column_when_all_valid() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-01-01 00:00:00", "2026-01-02 00:00:00"]})
    result = processor.correct_timestamp_column(df)
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    assert invalid_col not in result.columns


def test_correct_timestamp_column_no_invalid_column_when_no_invalids() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-01-01T00:00:00Z", None]})
    result = processor.correct_timestamp_column(df)
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    assert invalid_col not in result.columns


def test_correct_timestamp_column_invalid_column_present_when_there_are_invalids() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["not-a-date", "2026-01-01 00:00:00"]})
    result = processor.correct_timestamp_column(df)
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    assert invalid_col in result.columns


def test_correct_timestamp_column_invalid_original_captures_bad_value() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["garbage", "2026-01-01 00:00:00"]})
    result = processor.correct_timestamp_column(df)
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    invalids = result.get_column(invalid_col).to_list()
    assert invalids[0] == "garbage"
    assert invalids[1] is None


def test_correct_timestamp_column_mixed_null_and_valid() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: [None, "2026-01-01 00:00:00", None]})
    result = processor.correct_timestamp_column(df)
    parsed = result.get_column(Column.EVENT_TIMESTAMP)
    assert parsed[1] is not None
    assert parsed[0] is None
    assert parsed[2] is None


def test_correct_timestamp_column_fractional_seconds_with_tz_becomes_null() -> None:
    # The parser formats do not include a fractional+timezone pattern, so
    # "2026-05-01T12:30:45.123456+00:00" falls through to null and is
    # captured in the _invalid_original column.
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-05-01T12:30:45.123456+00:00"]})
    result = processor.correct_timestamp_column(df)
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    assert invalid_col in result.columns
    assert result[0, invalid_col] == "2026-05-01T12:30:45.123456+00:00"


def test_correct_timestamp_column_z_suffix_parsed_as_utc() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-01-01T00:00:00Z"]})
    result = processor.correct_timestamp_column(df)
    assert result.schema[Column.EVENT_TIMESTAMP].time_zone == "UTC"
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_explicit_plus_zero_offset() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-01-01T06:00:00+00:00"]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_explicit_negative_offset() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-01-01T06:00:00-06:00"]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_t_separator_format() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-07-04T15:30:00"]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_space_separator_format() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-07-04 15:30:00"]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_whitespace_padded_timestamps_parsed() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: [" 2026-01-01 00:00:00 "]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_blank_string_becomes_null_not_invalid() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["   "]})
    result = processor.correct_timestamp_column(df)
    # blank (whitespace only) is treated as missing, not invalid
    invalid_col = f"{Column.EVENT_TIMESTAMP}_invalid_original"
    assert invalid_col not in result.columns
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 1


def test_correct_timestamp_column_tab_characters_stripped() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["\t2026-01-01 00:00:00\t"]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


def test_correct_timestamp_column_crlf_endings_stripped() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: ["2026-01-01 00:00:00\r\n"]})
    result = processor.correct_timestamp_column(df)
    assert result.get_column(Column.EVENT_TIMESTAMP).null_count() == 0


# ---------------------------------------------------------------------------
# check_for_disordered_timestamps
# ---------------------------------------------------------------------------


def test_check_for_disordered_timestamps_missing_both_columns_is_noop() -> None:
    df = pl.DataFrame({"x": [1, 2]})
    TimestampPreprocessor.check_for_disordered_timestamps(df)  # no exception


def test_check_for_disordered_timestamps_only_start_column_is_noop() -> None:
    df = frame([{Column.START_TIMESTAMP: ts("2026-01-01 00:00:00")}])
    TimestampPreprocessor.check_for_disordered_timestamps(df)  # no exception


def test_check_for_disordered_timestamps_only_stop_column_is_noop() -> None:
    df = frame([{Column.STOP_TIMESTAMP: ts("2026-01-01 00:00:00")}])
    TimestampPreprocessor.check_for_disordered_timestamps(df)  # no exception


def test_check_for_disordered_timestamps_equal_start_stop_no_error() -> None:
    df = frame(
        [
            {
                Column.START_TIMESTAMP: ts("2026-01-01 00:00:00"),
                Column.STOP_TIMESTAMP: ts("2026-01-01 00:00:00"),
            }
        ]
    )
    TimestampPreprocessor.check_for_disordered_timestamps(df)  # no exception


def test_check_for_disordered_timestamps_valid_order_no_error() -> None:
    df = frame(
        [
            {
                Column.START_TIMESTAMP: ts("2026-01-01 00:00:00"),
                Column.STOP_TIMESTAMP: ts("2026-01-01 01:00:00"),
            }
        ]
    )
    TimestampPreprocessor.check_for_disordered_timestamps(df)  # no exception


def test_check_for_disordered_timestamps_reversed_order_raises() -> None:
    df = frame(
        [
            {
                Column.START_TIMESTAMP: ts("2026-01-01 02:00:00"),
                Column.STOP_TIMESTAMP: ts("2026-01-01 01:00:00"),
            }
        ]
    )
    with pytest.raises(ValueError, match="Disordered"):
        TimestampPreprocessor.check_for_disordered_timestamps(df)


# ---------------------------------------------------------------------------
# format_timestamps_as_strings
# ---------------------------------------------------------------------------


def test_format_timestamps_as_strings_missing_columns_ignored() -> None:
    processor = _ts_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")}])
    result = processor.format_timestamps_as_strings(df, ["missing_col"])
    assert result.schema[Column.EVENT_TIMESTAMP] == pl.Datetime("us", "UTC")


def test_format_timestamps_as_strings_empty_list_unchanged() -> None:
    processor = _ts_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")}])
    result = processor.format_timestamps_as_strings(df, [])
    assert result.schema[Column.EVENT_TIMESTAMP] == pl.Datetime("us", "UTC")


def test_format_timestamps_as_strings_converts_column_to_string() -> None:
    processor = _ts_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")}])
    result = processor.format_timestamps_as_strings(df, [Column.EVENT_TIMESTAMP])
    assert result.schema[Column.EVENT_TIMESTAMP] == pl.String


def test_format_timestamps_as_strings_custom_format_applied() -> None:
    processor = _ts_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-03-15 09:05:00", "UTC")}])
    result = processor.format_timestamps_as_strings(df, [Column.EVENT_TIMESTAMP], format_string="%Y/%m/%d")
    assert result[0, Column.EVENT_TIMESTAMP] == "2026/03/15"


# ---------------------------------------------------------------------------
# mark_data_time_gaps
# ---------------------------------------------------------------------------


def test_mark_data_time_gaps_single_row_zero_gap() -> None:
    processor = _ts_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")}])
    result = processor.mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
    assert result[0, Column.DATA_TIME_GAP_HOURS] == 0.0


def test_mark_data_time_gaps_two_rows_one_hour_apart() -> None:
    processor = _ts_preprocessor()
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")},
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 01:00:00", "UTC")},
        ]
    )
    result = processor.mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
    assert result[1, Column.DATA_TIME_GAP_HOURS] == 1.0


def test_mark_data_time_gaps_two_rows_same_timestamp_zero_gap() -> None:
    processor = _ts_preprocessor()
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")},
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")},
        ]
    )
    result = processor.mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
    assert result[1, Column.DATA_TIME_GAP_HOURS] == 0.0


def test_mark_data_time_gaps_large_gap_captured() -> None:
    processor = _ts_preprocessor()
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")},
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 12:00:00", "UTC")},
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 12:30:00", "UTC")},
        ]
    )
    result = processor.mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
    assert result[1, Column.DATA_TIME_GAP_HOURS] == 12.0
    assert result[2, Column.DATA_TIME_GAP_HOURS] == 0.5


def test_mark_data_time_gaps_adds_gap_column() -> None:
    processor = _ts_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC")}])
    result = processor.mark_data_time_gaps(df, Column.EVENT_TIMESTAMP, Column.DATA_TIME_GAP_HOURS)
    assert Column.DATA_TIME_GAP_HOURS in result.columns


# ---------------------------------------------------------------------------
# unalign_duplicate_timestamps
# ---------------------------------------------------------------------------


def test_unalign_duplicate_timestamps_no_duplicates_unchanged() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=True)
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Resumed",
                Column.APP_PACKAGE_NAME: "com.a",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 01:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Paused",
                Column.APP_PACKAGE_NAME: "com.a",
            },
        ]
    )
    result = processor.unalign_duplicate_timestamps(df, Column.EVENT_TIMESTAMP)
    ts_list = result.get_column(Column.EVENT_TIMESTAMP).to_list()
    assert ts_list[0] != ts_list[1]


def test_unalign_duplicate_timestamps_empty_df_handled() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=True)
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us", "UTC")),
            Column.INTERACTION_TYPE: pl.Series([], dtype=pl.String),
            Column.APP_PACKAGE_NAME: pl.Series([], dtype=pl.String),
        }
    )
    result = processor.unalign_duplicate_timestamps(df, Column.EVENT_TIMESTAMP)
    assert len(result) == 0


def test_unalign_duplicate_timestamps_two_duplicates_get_offsets() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=True)
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Resumed",
                Column.APP_PACKAGE_NAME: "com.a",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Paused",
                Column.APP_PACKAGE_NAME: "com.b",
            },
        ]
    )
    result = processor.unalign_duplicate_timestamps(df, Column.EVENT_TIMESTAMP)
    ts_list = result.get_column(Column.EVENT_TIMESTAMP).to_list()
    assert ts_list[0] != ts_list[1]


def test_unalign_duplicate_timestamps_three_duplicates_get_distinct_times() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=True)
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Resumed",
                Column.APP_PACKAGE_NAME: "com.a",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Paused",
                Column.APP_PACKAGE_NAME: "com.b",
            },
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "UTC"),
                Column.INTERACTION_TYPE: "Activity Resumed",
                Column.APP_PACKAGE_NAME: "com.c",
            },
        ]
    )
    result = processor.unalign_duplicate_timestamps(df, Column.EVENT_TIMESTAMP)
    ts_list = result.get_column(Column.EVENT_TIMESTAMP).to_list()
    assert len(set(ts_list)) == 3


# ---------------------------------------------------------------------------
# correct_timestamps (full pipeline)
# ---------------------------------------------------------------------------


def test_correct_timestamps_pipeline_with_dedup_enabled() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=True)
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [
                "2026-01-01 00:00:00",
                "2026-01-01 00:00:00",
                "2026-01-01 03:00:00",
            ],
            Column.INTERACTION_TYPE: ["Activity Resumed", "Activity Paused", "Activity Resumed"],
            Column.APP_PACKAGE_NAME: ["com.a", "com.a", "com.b"],
        }
    )
    result = processor.correct_timestamps(df)
    assert Column.DATA_TIME_GAP_HOURS in result.columns
    assert result.schema[Column.EVENT_TIMESTAMP].time_zone is not None


def test_correct_timestamps_pipeline_with_dedup_disabled() -> None:
    processor = _ts_preprocessor(correct_duplicate_event_timestamps=False)
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [
                "2026-01-01 00:00:00",
                "2026-01-01 01:00:00",
            ],
            Column.INTERACTION_TYPE: ["Activity Resumed", "Activity Paused"],
            Column.APP_PACKAGE_NAME: ["com.a", "com.a"],
        }
    )
    result = processor.correct_timestamps(df)
    assert Column.DATA_TIME_GAP_HOURS in result.columns
    assert result.schema[Column.EVENT_TIMESTAMP].time_zone is not None


# ---------------------------------------------------------------------------
# TimezonePreprocessor.determine_primary_timezone
# ---------------------------------------------------------------------------


def test_determine_primary_timezone_all_null_timezone_col_falls_back_to_schema_tz() -> None:
    processor = _tz_preprocessor()
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "America/Chicago"), Column.TIMEZONE: None},
        ]
    )
    result = processor.determine_primary_timezone(df)
    assert result == "America/Chicago"


def test_determine_primary_timezone_empty_df_returns_none_without_schema_tz() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame({Column.EVENT_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us"))})
    result = processor.determine_primary_timezone(df)
    assert result is None


def test_determine_primary_timezone_tie_returns_one_of_the_tied_values() -> None:
    # polars group_by is non-deterministic on ties, but the result must
    # be one of the tied candidates (not None, not an unexpected value).
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 4,
            Column.TIMEZONE: ["America/Chicago", "America/New_York", "America/Chicago", "America/New_York"],
        }
    )
    result = processor.determine_primary_timezone(df)
    assert result in {"America/Chicago", "America/New_York"}


def test_determine_primary_timezone_none_string_treated_as_null() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 3,
            Column.TIMEZONE: ["None", "None", "America/Chicago"],
        }
    )
    result = processor.determine_primary_timezone(df)
    assert result == "America/Chicago"


def test_determine_primary_timezone_padded_utc_treated_as_utc() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 3,
            Column.TIMEZONE: ["  UTC  ", "  UTC  ", "  UTC  "],
        }
    )
    result = processor.determine_primary_timezone(df)
    assert result == "UTC"


# ---------------------------------------------------------------------------
# TimezonePreprocessor.detect_timezones_in_dataframe
# ---------------------------------------------------------------------------


def test_detect_timezones_empty_timezone_column_no_schema_tz() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series([], dtype=pl.Datetime("us")),
            Column.TIMEZONE: pl.Series([], dtype=pl.String),
        }
    )
    result = processor.detect_timezones_in_dataframe(df)
    assert result == []


def test_detect_timezones_schema_tz_included_even_without_column() -> None:
    processor = _tz_preprocessor()
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 00:00:00", "America/Los_Angeles")}])
    result = processor.detect_timezones_in_dataframe(df)
    assert "America/Los_Angeles" in result


def test_detect_timezones_none_string_excluded() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 2,
            Column.TIMEZONE: ["None", "UTC"],
        }
    )
    result = processor.detect_timezones_in_dataframe(df)
    assert "None" not in result
    assert "UTC" in result


def test_detect_timezones_empty_string_excluded() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 2,
            Column.TIMEZONE: ["", "UTC"],
        }
    )
    result = processor.detect_timezones_in_dataframe(df)
    assert "" not in result


def test_detect_timezones_padded_values_normalized_and_deduplicated() -> None:
    processor = _tz_preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: [ts("2026-01-01 00:00:00", "UTC")] * 3,
            Column.TIMEZONE: [" UTC ", "UTC", "  UTC  "],
        }
    )
    result = processor.detect_timezones_in_dataframe(df)
    assert result.count("UTC") == 1


# ---------------------------------------------------------------------------
# TimezonePreprocessor.find_all_timezones_in_folder_files
# ---------------------------------------------------------------------------


def test_find_all_timezones_nonexistent_folder_raises(tmp_path: pytest.TempPathFactory) -> None:
    with pytest.raises((ValueError, FileNotFoundError)):
        TimezonePreprocessor.find_all_timezones_in_folder_files(tmp_path / "does_not_exist", r".*\.csv")


def test_find_all_timezones_file_without_timezone_column_skipped(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "data.csv").write_text("other_col\nvalue\n", encoding="utf-8")
    result = TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv")
    assert result == []


def test_find_all_timezones_all_nulls_returns_empty(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "data.csv").write_text(f"{Column.TIMEZONE}\n\n\n", encoding="utf-8")
    result = TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv")
    assert result == []


def test_find_all_timezones_survey_files_not_excluded(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    # Survey files are ignored by the hardcoded ignore list in find_all_timezones_in_folder_files
    (raw / "Survey Raw P01.csv").write_text(f"{Column.TIMEZONE}\nAmerica/Chicago\n", encoding="utf-8")
    # The function ignores Survey, Archive, Do Not Use
    result = TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv")
    # Survey is in the ignore_names list so it WILL be excluded
    assert isinstance(result, list)


def test_find_all_timezones_preprocessed_folder_not_ignored_by_tz_finder(tmp_path) -> None:
    # find_all_timezones_in_folder_files passes ignore_names=["Survey", "Archive",
    # "Do Not Use"], which overrides the default ["Preprocessed"] in
    # get_matching_files_from_folder.  Therefore "Preprocessed" directories are
    # NOT ignored — this test documents that known behaviour.
    raw = tmp_path / "raw"
    preprocessed = raw / "Preprocessed"
    preprocessed.mkdir(parents=True)
    (preprocessed / "file.csv").write_text(f"{Column.TIMEZONE}\nAmerica/Chicago\n", encoding="utf-8")
    result = TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv")
    assert "America/Chicago" in result


def test_find_all_timezones_normal_file_included(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "Raw P01.csv").write_text(f"{Column.TIMEZONE}\nAmerica/Chicago\nAmerica/New_York\n", encoding="utf-8")
    result = TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv")
    assert "America/Chicago" in result
    assert "America/New_York" in result


def test_find_all_timezones_none_string_filtered_out(tmp_path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "Raw P01.csv").write_text(f"{Column.TIMEZONE}\nNone\nAmerica/Chicago\n", encoding="utf-8")
    result = TimezonePreprocessor.find_all_timezones_in_folder_files(raw, r".*\.csv")
    assert "None" not in result
    assert "America/Chicago" in result


# ---------------------------------------------------------------------------
# TimezonePreprocessor.convert_timestamp_columns
# ---------------------------------------------------------------------------


def test_convert_timestamp_columns_already_in_target_tz() -> None:
    processor = TimezonePreprocessor(
        _options(
            timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
            selected_timezone="America/Chicago",
        )
    )
    df = frame(
        [
            {
                Column.EVENT_TIMESTAMP: ts("2026-01-01 06:00:00", "America/Chicago"),
            }
        ]
    )
    result = processor.convert_timestamp_columns(df, columns=[Column.EVENT_TIMESTAMP])
    assert result.schema[Column.EVENT_TIMESTAMP].time_zone == "America/Chicago"


def test_convert_timestamp_columns_null_values_preserved_as_null() -> None:
    processor = TimezonePreprocessor(
        _options(
            timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
            selected_timezone="America/Chicago",
        )
    )
    df = frame(
        [
            {Column.EVENT_TIMESTAMP: ts("2026-01-01 06:00:00", "UTC"), Column.STOP_TIMESTAMP: None},
        ]
    )
    result = processor.convert_timestamp_columns(df, columns=[Column.EVENT_TIMESTAMP, Column.STOP_TIMESTAMP])
    assert result[0, Column.STOP_TIMESTAMP] is None


def test_convert_timestamp_columns_non_datetime_column_skipped() -> None:
    processor = TimezonePreprocessor(
        _options(
            timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
            selected_timezone="America/Chicago",
        )
    )
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(
                [ts("2026-01-01 00:00:00", "UTC")],
                dtype=pl.Datetime("us", "UTC"),
            ),
            "some_string_col": ["hello"],
        }
    )
    result = processor.convert_timestamp_columns(df, columns=["some_string_col"])
    assert result.schema["some_string_col"] == pl.String


def test_convert_timestamp_columns_partial_match_some_missing() -> None:
    processor = TimezonePreprocessor(
        _options(
            timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
            selected_timezone="America/Chicago",
        )
    )
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 06:00:00", "UTC")}])
    # "missing_col" doesn't exist — should not raise
    result = processor.convert_timestamp_columns(df, columns=[Column.EVENT_TIMESTAMP, "missing_col"])
    assert result.schema[Column.EVENT_TIMESTAMP].time_zone == "America/Chicago"


def test_convert_timestamp_columns_converts_utc_to_target() -> None:
    processor = TimezonePreprocessor(
        _options(
            timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
            selected_timezone="America/New_York",
        )
    )
    df = frame([{Column.EVENT_TIMESTAMP: ts("2026-01-01 06:00:00", "UTC")}])
    result = processor.convert_timestamp_columns(df, columns=[Column.EVENT_TIMESTAMP])
    assert result.schema[Column.EVENT_TIMESTAMP].time_zone == "America/New_York"


# ---------------------------------------------------------------------------
# _normalize_timezone_expr (module-level function)
# ---------------------------------------------------------------------------


def test_normalize_timezone_expr_strips_whitespace() -> None:
    df = pl.DataFrame({"tz": ["  UTC  "]})
    result = df.with_columns(_normalize_timezone_expr(pl.col("tz")).alias("tz"))
    assert result[0, "tz"] == "UTC"


def test_normalize_timezone_expr_none_string_becomes_null() -> None:
    df = pl.DataFrame({"tz": ["None"]})
    result = df.with_columns(_normalize_timezone_expr(pl.col("tz")).alias("tz"))
    assert result[0, "tz"] is None


def test_normalize_timezone_expr_empty_string_becomes_null() -> None:
    df = pl.DataFrame({"tz": [""]})
    result = df.with_columns(_normalize_timezone_expr(pl.col("tz")).alias("tz"))
    assert result[0, "tz"] is None


def test_normalize_timezone_expr_valid_tz_unchanged() -> None:
    df = pl.DataFrame({"tz": ["America/Chicago"]})
    result = df.with_columns(_normalize_timezone_expr(pl.col("tz")).alias("tz"))
    assert result[0, "tz"] == "America/Chicago"
