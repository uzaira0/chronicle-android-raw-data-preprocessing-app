"""Tests for MainPreprocessor._validate_required_columns."""

from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    REQUIRED_RAW_COLUMNS,
    ChronicleAndroidRawDataPreprocessor,
)


def _df_with_columns(*columns: str) -> pl.DataFrame:
    """Build a minimal DataFrame that has the given column names (one null row)."""
    return pl.DataFrame({col: [None] for col in columns})


ALL_REQUIRED = sorted(REQUIRED_RAW_COLUMNS)


class TestValidateRequiredColumns:
    def test_valid_dataframe_no_exception(self) -> None:
        df = _df_with_columns(*ALL_REQUIRED)
        # Should not raise
        ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)

    def test_valid_dataframe_with_extra_columns_no_exception(self) -> None:
        df = _df_with_columns(*ALL_REQUIRED, "extra_col", "another_col")
        ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)

    def test_missing_event_timestamp_raises(self) -> None:
        cols = [c for c in ALL_REQUIRED if c != "event_timestamp"]
        df = _df_with_columns(*cols)
        with pytest.raises(ValueError, match="event_timestamp"):
            ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)

    def test_missing_multiple_columns_lists_all(self) -> None:
        cols = [c for c in ALL_REQUIRED if c not in {"event_timestamp", "app_package_name"}]
        df = _df_with_columns(*cols)
        with pytest.raises(ValueError) as exc_info:
            ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)
        message = str(exc_info.value)
        assert "event_timestamp" in message
        assert "app_package_name" in message

    def test_timezone_column_is_optional_for_utc_fallback(self) -> None:
        assert "timezone" not in REQUIRED_RAW_COLUMNS
        cols = [c for c in ALL_REQUIRED if c != "timezone"]
        df = _df_with_columns(*cols)

        ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)

    def test_completely_wrong_columns_lists_all_missing(self) -> None:
        df = _df_with_columns("col_a", "col_b", "col_c")
        with pytest.raises(ValueError) as exc_info:
            ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)
        message = str(exc_info.value)
        # Every required column should appear in the error
        for col in ALL_REQUIRED:
            assert col in message, f"Expected '{col}' in error message: {message}"

    def test_error_message_includes_found_columns(self) -> None:
        df = _df_with_columns("WeirdColumn", "AnotherWeirdCol")
        with pytest.raises(ValueError, match="WeirdColumn"):
            ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)

    def test_empty_dataframe_raises(self) -> None:
        df = pl.DataFrame()
        with pytest.raises(ValueError, match="Missing required columns"):
            ChronicleAndroidRawDataPreprocessor._validate_required_columns(df)
