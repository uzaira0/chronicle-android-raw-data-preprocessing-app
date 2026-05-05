from __future__ import annotations

from datetime import datetime, timezone

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import ChronicleDeviceType, Column
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.column_preprocessor import ColumnPreprocessor
from tests.polars_helpers import frame, ts


def _options(**overrides: object) -> PreprocessingOptions:
    values: dict[str, object] = {"raw_data_folder": "", "use_app_codebook": False}
    values.update(overrides)
    return PreprocessingOptions(**values)


def _preprocessor(**overrides: object) -> ColumnPreprocessor:
    return ColumnPreprocessor(_options(**overrides))


def _minimal_df(*, pkg: str = "com.example") -> pl.DataFrame:
    """A minimal df with the columns required by _create_additional_columns."""
    return pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(
                [datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)],
                dtype=pl.Datetime("us", "UTC"),
            ),
            Column.APP_PACKAGE_NAME: [pkg],
        }
    )


# ===========================================================================
# create_additional_columns
# ===========================================================================


def test_create_additional_columns_adds_possible_device_model() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.create_additional_columns(df, ChronicleDeviceType.ANDROID)
    assert Column.POSSIBLE_DEVICE_MODEL in result.columns


def test_create_additional_columns_value_matches_android() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.create_additional_columns(df, ChronicleDeviceType.ANDROID)
    assert result[0, Column.POSSIBLE_DEVICE_MODEL] == ChronicleDeviceType.ANDROID.value


def test_create_additional_columns_value_matches_amazon() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.create_additional_columns(df, ChronicleDeviceType.AMAZON)
    assert result[0, Column.POSSIBLE_DEVICE_MODEL] == ChronicleDeviceType.AMAZON.value


def test_create_additional_columns_different_types_produce_different_values() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    android_result = proc.create_additional_columns(df, ChronicleDeviceType.ANDROID)
    amazon_result = proc.create_additional_columns(df, ChronicleDeviceType.AMAZON)
    assert android_result[0, Column.POSSIBLE_DEVICE_MODEL] != amazon_result[0, Column.POSSIBLE_DEVICE_MODEL]


def test_create_additional_columns_amazon_value_is_amazon_fire() -> None:
    assert ChronicleDeviceType.AMAZON.value == "Amazon Fire"


def test_create_additional_columns_android_value_is_android() -> None:
    assert ChronicleDeviceType.ANDROID.value == "Android"


def test_create_additional_columns_multiple_rows() -> None:
    proc = _preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(
                [
                    datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc),
                    datetime(2024, 1, 15, 11, 0, 0, tzinfo=timezone.utc),
                    datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc),
                ],
                dtype=pl.Datetime("us", "UTC"),
            ),
            Column.APP_PACKAGE_NAME: ["com.a", "com.b", "com.c"],
        }
    )
    result = proc.create_additional_columns(df, ChronicleDeviceType.ANDROID)
    assert result.height == 3
    assert all(v == ChronicleDeviceType.ANDROID.value for v in result[Column.POSSIBLE_DEVICE_MODEL].to_list())


# ===========================================================================
# preprocess
# ===========================================================================


def test_preprocess_returns_df_with_possible_device_model() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.preprocess(df, ChronicleDeviceType.ANDROID)
    assert Column.POSSIBLE_DEVICE_MODEL in result.columns
    assert result[0, Column.POSSIBLE_DEVICE_MODEL] == ChronicleDeviceType.ANDROID.value


def test_preprocess_amazon_type_propagated() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.preprocess(df, ChronicleDeviceType.AMAZON)
    assert result[0, Column.POSSIBLE_DEVICE_MODEL] == ChronicleDeviceType.AMAZON.value


def test_preprocess_does_not_crash_without_username_column() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    # No USERNAME column — correct_username_column should be a no-op
    result = proc.preprocess(df, ChronicleDeviceType.ANDROID)
    assert Column.POSSIBLE_DEVICE_MODEL in result.columns


# ===========================================================================
# correct_username_column
# ===========================================================================


def test_correct_username_column_no_username_column_is_noop() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.correct_username_column(df)
    assert Column.USERNAME not in result.columns
    assert result.shape == df.shape


def test_correct_username_column_normalizes_target_child() -> None:
    proc = _preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(
                [datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)],
                dtype=pl.Datetime("us", "UTC"),
            ),
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.USERNAME: ["Target child"],
        }
    )
    result = proc.correct_username_column(df)
    assert result[0, Column.USERNAME] == "Target Child"


def test_correct_username_column_leaves_other_usernames_unchanged() -> None:
    proc = _preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(
                [datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)],
                dtype=pl.Datetime("us", "UTC"),
            ),
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.USERNAME: ["OtherUser"],
        }
    )
    result = proc.correct_username_column(df)
    assert result[0, Column.USERNAME] == "OtherUser"


# ===========================================================================
# Edge cases
# ===========================================================================


def test_create_additional_columns_preserves_existing_columns() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    result = proc.create_additional_columns(df, ChronicleDeviceType.ANDROID)
    assert Column.EVENT_TIMESTAMP in result.columns
    assert Column.APP_PACKAGE_NAME in result.columns


def test_preprocess_with_multiple_columns_does_not_crash() -> None:
    proc = _preprocessor()
    df = pl.DataFrame(
        {
            Column.EVENT_TIMESTAMP: pl.Series(
                [datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)],
                dtype=pl.Datetime("us", "UTC"),
            ),
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.INTERACTION_TYPE: ["Activity Resumed"],
            Column.APPLICATION_LABEL: ["ExampleApp"],
            Column.PARTICIPANT_ID: ["P01"],
        }
    )
    result = proc.preprocess(df, ChronicleDeviceType.ANDROID)
    assert Column.POSSIBLE_DEVICE_MODEL in result.columns


def test_create_additional_columns_all_device_types_covered() -> None:
    proc = _preprocessor()
    df = _minimal_df()
    for device_type in ChronicleDeviceType:
        result = proc.create_additional_columns(df, device_type)
        assert result[0, Column.POSSIBLE_DEVICE_MODEL] == device_type.value
