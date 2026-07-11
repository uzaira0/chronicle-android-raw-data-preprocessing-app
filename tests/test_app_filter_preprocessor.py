from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.preprocessing.app_filter_preprocessor import (
    AppFilterPreprocessor,
)
from tests.polars_helpers import options as _options


def _preprocessor(**overrides: object) -> AppFilterPreprocessor:
    return AppFilterPreprocessor(_options(**overrides))


# ===========================================================================
# should_filter_app
# ===========================================================================


def test_should_filter_app_package_not_in_dict_returns_false() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.other": "OtherApp"})
    assert proc.should_filter_app("com.example", "ExampleApp") is False


def test_should_filter_app_package_in_dict_label_matches_returns_true() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "ExampleApp"})
    assert proc.should_filter_app("com.example", "ExampleApp") is True


def test_should_filter_app_package_in_dict_label_no_match_returns_false() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "ExampleApp"})
    assert proc.should_filter_app("com.example", "SomethingElse") is False


def test_should_filter_app_multi_label_matches_first() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "LabelA,LabelB,LabelC"})
    assert proc.should_filter_app("com.example", "LabelA") is True


def test_should_filter_app_multi_label_matches_second() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "LabelA,LabelB,LabelC"})
    assert proc.should_filter_app("com.example", "LabelB") is True


def test_should_filter_app_multi_label_no_match() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "LabelA,LabelB"})
    assert proc.should_filter_app("com.example", "NotInList") is False


def test_should_filter_app_whitespace_around_labels_normalized() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "  LabelA , LabelB  "})
    assert proc.should_filter_app("com.example", "LabelA") is True
    assert proc.should_filter_app("com.example", "LabelB") is True


def test_should_filter_app_empty_label_string_never_matches_non_empty() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": ""})
    # Empty string dict value → falsy → should_filter_app returns False
    assert proc.should_filter_app("com.example", "ExampleApp") is False


def test_should_filter_app_empty_dict_returns_false() -> None:
    proc = _preprocessor(apps_to_filter_dict={})
    assert proc.should_filter_app("com.example", "ExampleApp") is False


def test_should_filter_app_exact_case_match_required() -> None:
    proc = _preprocessor(apps_to_filter_dict={"com.example": "ExampleApp"})
    assert proc.should_filter_app("com.example", "exampleapp") is False


# ===========================================================================
# label_filtered_apps
# ===========================================================================


def _minimal_df(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(rows)


def test_label_filtered_apps_empty_df_returns_empty() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=True,
    )
    empty = pl.DataFrame(
        schema={
            Column.APP_PACKAGE_NAME: pl.Utf8,
            Column.APPLICATION_LABEL: pl.Utf8,
            Column.INTERACTION_TYPE: pl.Utf8,
        }
    )
    result = proc.label_filtered_apps(empty)
    assert result.is_empty()


def test_label_filtered_apps_no_filter_dict_no_rows_labelled() -> None:
    proc = _preprocessor(apps_to_filter_dict={}, use_filter_file=True)
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.APPLICATION_LABEL: ["ExampleApp"],
            Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_RESUMED],
        }
    )
    result = proc.label_filtered_apps(df)
    assert result[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_label_filtered_apps_use_filter_file_false_no_changes() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=False,
    )
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.APPLICATION_LABEL: ["ExampleApp"],
            Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_RESUMED],
        }
    )
    result = proc.label_filtered_apps(df)
    assert result[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_label_filtered_apps_matched_app_gets_filtered_interaction_type() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=True,
    )
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.APPLICATION_LABEL: ["ExampleApp"],
            Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_RESUMED],
        }
    )
    result = proc.label_filtered_apps(df)
    assert result[0, Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_RESUMED


def test_label_filtered_apps_non_filtered_app_unchanged() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=True,
    )
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.other"],
            Column.APPLICATION_LABEL: ["OtherApp"],
            Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_RESUMED],
        }
    )
    result = proc.label_filtered_apps(df)
    assert result[0, Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED


def test_label_filtered_apps_mixed_rows_only_matching_filtered() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=True,
    )
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.example", "com.other"],
            Column.APPLICATION_LABEL: ["ExampleApp", "OtherApp"],
            Column.INTERACTION_TYPE: [
                InteractionType.ACTIVITY_RESUMED,
                InteractionType.ACTIVITY_RESUMED,
            ],
        }
    )
    result = proc.label_filtered_apps(df)
    types = result[Column.INTERACTION_TYPE].to_list()
    assert types[0] == InteractionType.FILTERED_APP_RESUMED
    assert types[1] == InteractionType.ACTIVITY_RESUMED


def test_label_filtered_apps_paused_renamed_to_filtered_paused() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=True,
    )
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.APPLICATION_LABEL: ["ExampleApp"],
            Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_PAUSED],
        }
    )
    result = proc.label_filtered_apps(df)
    assert result[0, Column.INTERACTION_TYPE] == InteractionType.FILTERED_APP_PAUSED


def test_label_filtered_apps_stops_internal_columns_not_in_output() -> None:
    proc = _preprocessor(
        apps_to_filter_dict={"com.example": "ExampleApp"},
        use_filter_file=True,
    )
    df = pl.DataFrame(
        {
            Column.APP_PACKAGE_NAME: ["com.example"],
            Column.APPLICATION_LABEL: ["ExampleApp"],
            Column.INTERACTION_TYPE: [InteractionType.ACTIVITY_RESUMED],
        }
    )
    result = proc.label_filtered_apps(df)
    assert "__filter_candidate" not in result.columns
    assert "__valid_filter_match" not in result.columns
