from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from chronicle_preprocessing_app.config.constants import AppCodebookColumn
from chronicle_preprocessing_app.utils.file_utils import (
    AppsForcingScreenOpenFileError,
    CodebookFileError,
    FilterFileError,
    get_matching_files_from_folder,
    read_app_codebook,
    read_apps_forcing_screen_open_file,
    read_filter_file,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_csv(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_xlsx(path: Path, header: list[str], rows: list[list[object]]) -> None:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(header)
    for row in rows:
        ws.append(row)
    wb.save(path)
    wb.close()


# ===========================================================================
# get_matching_files_from_folder
# ===========================================================================


def test_get_matching_files_nonexistent_folder_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="does not exist"):
        get_matching_files_from_folder(tmp_path / "no_such_dir", r".*\.csv")


def test_get_matching_files_file_path_raises(tmp_path: Path) -> None:
    f = tmp_path / "file.csv"
    f.write_text("a")
    with pytest.raises(ValueError, match="not a directory"):
        get_matching_files_from_folder(f, r".*\.csv")


def test_get_matching_files_empty_folder_returns_empty(tmp_path: Path) -> None:
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    assert result == []


def test_get_matching_files_simple_pattern_match(tmp_path: Path) -> None:
    (tmp_path / "data.csv").write_text("x")
    (tmp_path / "other.txt").write_text("y")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    assert len(result) == 1
    assert result[0].name == "data.csv"


def test_get_matching_files_recursive_finds_nested(tmp_path: Path) -> None:
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "nested.csv").write_text("x")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    assert len(result) == 1
    assert result[0].name == "nested.csv"


def test_get_matching_files_default_ignore_preprocessed(tmp_path: Path) -> None:
    (tmp_path / "raw.csv").write_text("x")
    (tmp_path / "Preprocessed_data.csv").write_text("x")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    names = [p.name for p in result]
    assert "raw.csv" in names
    assert "Preprocessed_data.csv" not in names


def test_get_matching_files_default_ignore_case_sensitive(tmp_path: Path) -> None:
    # Default fragment is "Preprocessed" (capital P) — lowercase should not be filtered
    (tmp_path / "preprocessed_lower.csv").write_text("x")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    assert len(result) == 1


def test_get_matching_files_custom_ignore_names(tmp_path: Path) -> None:
    (tmp_path / "keep.csv").write_text("x")
    (tmp_path / "Archive_data.csv").write_text("x")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv", ignore_names=["Archive"])
    names = [p.name for p in result]
    assert "keep.csv" in names
    assert "Archive_data.csv" not in names


def test_get_matching_files_multiple_ignore_names(tmp_path: Path) -> None:
    (tmp_path / "keep.csv").write_text("x")
    (tmp_path / "Backup_data.csv").write_text("x")
    (tmp_path / "Archive_data.csv").write_text("x")
    result = get_matching_files_from_folder(
        tmp_path, r".*\.csv", ignore_names=["Backup", "Archive"]
    )
    names = [p.name for p in result]
    assert names == ["keep.csv"]


def test_get_matching_files_no_match_returns_empty(tmp_path: Path) -> None:
    (tmp_path / "data.xlsx").write_text("x")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    assert result == []


def test_get_matching_files_regex_special_chars(tmp_path: Path) -> None:
    (tmp_path / "P01 Raw Data.csv").write_text("x")
    (tmp_path / "notes.txt").write_text("y")
    result = get_matching_files_from_folder(tmp_path, r".*Raw.*\.csv")
    assert len(result) == 1


def test_get_matching_files_no_extension(tmp_path: Path) -> None:
    (tmp_path / "noext").write_text("x")
    result = get_matching_files_from_folder(tmp_path, r"noext")
    assert len(result) == 1


def test_get_matching_files_multiple_matches(tmp_path: Path) -> None:
    for name in ["a.csv", "b.csv", "c.csv"]:
        (tmp_path / name).write_text("x")
    result = get_matching_files_from_folder(tmp_path, r".*\.csv")
    assert len(result) == 3


# ===========================================================================
# read_filter_file
# ===========================================================================


def test_read_filter_file_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(FilterFileError):
        read_filter_file(tmp_path / "missing.csv")


def test_read_filter_file_single_column_raises(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name", "com.example"])
    with pytest.raises(FilterFileError):
        read_filter_file(f)


def test_read_filter_file_valid_csv_two_cols_returns_dict(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name,app_label", "com.example,ExampleApp"])
    result = read_filter_file(f)
    assert result == {"com.example": "ExampleApp"}


def test_read_filter_file_blank_rows_skipped(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name,app_label", "com.example,ExampleApp", ",", ""])
    result = read_filter_file(f)
    assert result == {"com.example": "ExampleApp"}


def test_read_filter_file_missing_label_gets_empty_string(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name,app_label", "com.example,"])
    result = read_filter_file(f)
    assert result["com.example"] == ""


def test_read_filter_file_extra_columns_ignored(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name,app_label,extra", "com.example,ExampleApp,ignored"])
    result = read_filter_file(f)
    assert result == {"com.example": "ExampleApp"}


def test_read_filter_file_nan_values_treated_as_empty(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name,app_label", "com.example,nan"])
    result = read_filter_file(f)
    assert result["com.example"] == ""


def test_read_filter_file_whitespace_stripped_from_values(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["package_name,app_label", "  com.example  ,  ExampleApp  "])
    result = read_filter_file(f)
    assert "com.example" in result
    assert result["com.example"] == "ExampleApp"


def test_read_filter_file_multiple_entries(tmp_path: Path) -> None:
    f = tmp_path / "filter.csv"
    _write_csv(f, ["pkg,label", "com.a,AppA", "com.b,AppB"])
    result = read_filter_file(f)
    assert result == {"com.a": "AppA", "com.b": "AppB"}


def test_read_filter_file_xlsx_valid(tmp_path: Path) -> None:
    f = tmp_path / "filter.xlsx"
    _write_xlsx(f, ["package_name", "app_label"], [["com.example", "ExampleApp"]])
    result = read_filter_file(f)
    assert result == {"com.example": "ExampleApp"}


def test_read_filter_file_xlsx_single_column_raises(tmp_path: Path) -> None:
    f = tmp_path / "filter.xlsx"
    _write_xlsx(f, ["package_name"], [["com.example"]])
    with pytest.raises(FilterFileError):
        read_filter_file(f)


# ===========================================================================
# read_apps_forcing_screen_open_file
# ===========================================================================


def test_read_apps_forcing_screen_open_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(AppsForcingScreenOpenFileError):
        read_apps_forcing_screen_open_file(tmp_path / "missing.csv")


def test_read_apps_forcing_screen_open_empty_file_raises(tmp_path: Path) -> None:
    f = tmp_path / "apps.csv"
    f.write_text("", encoding="utf-8")
    with pytest.raises(AppsForcingScreenOpenFileError):
        read_apps_forcing_screen_open_file(f)


def test_read_apps_forcing_screen_open_one_col_returns_empty_labels(tmp_path: Path) -> None:
    f = tmp_path / "apps.csv"
    _write_csv(f, ["package_name", "com.example"])
    result = read_apps_forcing_screen_open_file(f)
    assert result == {"com.example": ""}


def test_read_apps_forcing_screen_open_comment_rows_skipped(tmp_path: Path) -> None:
    f = tmp_path / "apps.csv"
    _write_csv(f, ["package_name", "#this is a comment", "com.example"])
    result = read_apps_forcing_screen_open_file(f)
    assert "#this is a comment" not in result
    assert "com.example" in result


def test_read_apps_forcing_screen_open_blank_rows_skipped(tmp_path: Path) -> None:
    f = tmp_path / "apps.csv"
    _write_csv(f, ["package_name", "com.example", ""])
    result = read_apps_forcing_screen_open_file(f)
    assert "" not in result
    assert "com.example" in result


def test_read_apps_forcing_screen_open_two_col_includes_labels(tmp_path: Path) -> None:
    f = tmp_path / "apps.csv"
    _write_csv(f, ["package_name,label", "com.example,MyApp"])
    result = read_apps_forcing_screen_open_file(f)
    assert result == {"com.example": "MyApp"}


def test_read_apps_forcing_screen_open_xlsx_one_col(tmp_path: Path) -> None:
    f = tmp_path / "apps.xlsx"
    _write_xlsx(f, ["package_name"], [["com.example"]])
    result = read_apps_forcing_screen_open_file(f)
    assert "com.example" in result


# ===========================================================================
# read_app_codebook
# ===========================================================================


def test_read_app_codebook_missing_returns_none(tmp_path: Path) -> None:
    result = read_app_codebook(tmp_path / "no_codebook.csv")
    assert result is None


def test_read_app_codebook_unsupported_extension_raises(tmp_path: Path) -> None:
    f = tmp_path / "codebook.json"
    f.write_text("{}")
    with pytest.raises(CodebookFileError):
        read_app_codebook(f)


def test_read_app_codebook_missing_package_column_raises(tmp_path: Path) -> None:
    f = tmp_path / "codebook.csv"
    _write_csv(f, ["other_column", "value1"])
    with pytest.raises(CodebookFileError):
        read_app_codebook(f)


def test_read_app_codebook_valid_csv_returns_dataframe(tmp_path: Path) -> None:
    f = tmp_path / "codebook.csv"
    _write_csv(
        f,
        [
            f"{AppCodebookColumn.APP_PACKAGE_NAME},application_label",
            "com.example,ExampleApp",
        ],
    )
    result = read_app_codebook(f)
    assert isinstance(result, pl.DataFrame)
    assert AppCodebookColumn.APP_PACKAGE_NAME in result.columns


def test_read_app_codebook_deduplicates_on_package_name(tmp_path: Path) -> None:
    f = tmp_path / "codebook.csv"
    _write_csv(
        f,
        [
            f"{AppCodebookColumn.APP_PACKAGE_NAME},application_label",
            "com.example,ExampleApp",
            "com.example,DuplicateApp",
            "com.other,OtherApp",
        ],
    )
    result = read_app_codebook(f)
    assert result is not None
    assert result.height == 2
    pkgs = result[AppCodebookColumn.APP_PACKAGE_NAME].to_list()
    assert pkgs.count("com.example") == 1


def test_read_app_codebook_string_columns_stripped(tmp_path: Path) -> None:
    f = tmp_path / "codebook.csv"
    _write_csv(
        f,
        [
            f"{AppCodebookColumn.APP_PACKAGE_NAME},application_label",
            "  com.example  ,  ExampleApp  ",
        ],
    )
    result = read_app_codebook(f)
    assert result is not None
    pkg = result[AppCodebookColumn.APP_PACKAGE_NAME][0]
    assert pkg == "com.example"


def test_read_app_codebook_xlsx_valid(tmp_path: Path) -> None:
    f = tmp_path / "codebook.xlsx"
    _write_xlsx(
        f,
        [AppCodebookColumn.APP_PACKAGE_NAME, "application_label"],
        [["com.example", "ExampleApp"]],
    )
    result = read_app_codebook(f)
    assert isinstance(result, pl.DataFrame)
    assert result.height == 1


def test_read_app_codebook_xlsx_missing_package_column_raises(tmp_path: Path) -> None:
    f = tmp_path / "codebook.xlsx"
    _write_xlsx(f, ["other_col"], [["value"]])
    with pytest.raises(CodebookFileError):
        read_app_codebook(f)
