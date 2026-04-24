"""File operations and small tabular readers."""

from __future__ import annotations

import csv
import logging
import re
from pathlib import Path
from typing import Any

import polars as pl

LOGGER = logging.getLogger(__name__)


def get_matching_files_from_folder(
    folder: Path | str,
    file_matching_pattern: str,
    ignore_names: list[str] | None = None,
) -> list[Path]:
    """Return files matching a pattern under a folder tree."""
    folder_path = Path(folder)
    if not folder_path.exists():
        msg = f"Folder does not exist: {folder_path}"
        raise ValueError(msg)
    if not folder_path.is_dir():
        msg = f"Path is not a directory: {folder_path}"
        raise ValueError(msg)

    ignored = ignore_names or ["Preprocessed"]
    return [
        path
        for path in folder_path.rglob("*")
        if path.is_file()
        and re.search(file_matching_pattern, path.name)
        and all(fragment not in str(path) for fragment in ignored)
    ]


class FileOperationError(Exception):
    """Base exception for file operation errors."""


class FilterFileError(FileOperationError):
    """Errors raised while reading app filter files."""


class KeepAwakeAppsFileError(FileOperationError):
    """Errors raised while reading keep-awake app files."""


class CodebookFileError(FileOperationError):
    """Errors raised while reading app codebooks."""


def _read_excel_rows(file_path: Path) -> tuple[list[str], list[list[Any]]]:
    import openpyxl

    workbook = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    try:
        worksheet = workbook.worksheets[0]
        rows = list(worksheet.iter_rows(values_only=True))
    finally:
        workbook.close()

    if not rows:
        return [], []

    header = ["" if value is None else str(value).strip() for value in rows[0]]
    data = [[value for value in row] for row in rows[1:]]
    return header, data


def _read_small_table(file_path: Path) -> tuple[list[str], list[list[Any]]]:
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        with file_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle)
            rows = list(reader)
        if not rows:
            return [], []
        return rows[0], rows[1:]
    if suffix in {".xlsx", ".xls"}:
        return _read_excel_rows(file_path)

    msg = f"Unsupported file type: {suffix}"
    raise ValueError(msg)


def _normalize_cell(value: Any) -> str:
    if value is None:
        return ""
    value_str = str(value).strip()
    return "" if value_str.lower() == "nan" else value_str


def read_filter_file(file_path: Path | str) -> dict[str, str]:
    """Read app filters from a CSV/XLSX file."""
    path = Path(file_path)
    if not path.exists():
        raise FilterFileError(f"Filter file does not exist: {path}")

    try:
        header, rows = _read_small_table(path)
        if len(header) < 2:
            raise FilterFileError(
                "Filter file must have at least two columns (Package Name and App Label)"
            )

        filters: dict[str, str] = {}
        for row in rows:
            if not row:
                continue
            package_name = _normalize_cell(row[0] if len(row) > 0 else None)
            app_label = _normalize_cell(row[1] if len(row) > 1 else None)
            if package_name:
                filters[package_name] = app_label
        return filters
    except FilterFileError:
        raise
    except Exception as exc:
        raise FilterFileError(f"Failed to read filter file: {exc}") from exc


def read_keep_awake_apps_file(file_path: Path | str) -> dict[str, str]:
    """Read screen keep-awake app metadata from a CSV/XLSX file."""
    path = Path(file_path)
    if not path.exists():
        raise KeepAwakeAppsFileError(f"Keep-awake apps file does not exist: {path}")

    try:
        header, rows = _read_small_table(path)
        if len(header) < 1:
            raise KeepAwakeAppsFileError(
                "Keep-awake apps file must have at least one column (Package Name)"
            )

        keep_awake_apps: dict[str, str] = {}
        for row in rows:
            package_name = _normalize_cell(row[0] if len(row) > 0 else None)
            if not package_name or package_name.startswith("#"):
                continue
            label = _normalize_cell(row[1] if len(row) > 1 else None)
            keep_awake_apps[package_name] = label
        return keep_awake_apps
    except KeepAwakeAppsFileError:
        raise
    except Exception as exc:
        raise KeepAwakeAppsFileError(f"Failed to read keep-awake apps file: {exc}") from exc


def read_app_codebook(codebook_path: Path | str) -> pl.DataFrame | None:
    """Read and normalize an app codebook into a Polars dataframe."""
    from chronicle_preprocessing_app.config.constants import AppCodebookColumn

    path = Path(codebook_path)
    if not path.exists():
        LOGGER.warning("App codebook file not found: %s", path)
        return None

    try:
        if path.suffix.lower() == ".csv":
            app_codebook = pl.read_csv(path, infer_schema_length=10000)
        elif path.suffix.lower() in {".xlsx", ".xls"}:
            header, rows = _read_small_table(path)
            app_codebook = pl.DataFrame(rows, schema=header, orient="row")
        else:
            msg = f"Unsupported codebook file type: {path.suffix}. Must be .csv, .xlsx, or .xls"
            raise CodebookFileError(msg)

        if AppCodebookColumn.APP_PACKAGE_NAME not in app_codebook.columns:
            msg = (
                f"App codebook must contain an "
                f"'{AppCodebookColumn.APP_PACKAGE_NAME}' column"
            )
            raise CodebookFileError(msg)

        string_columns = [
            column for column, dtype in app_codebook.schema.items() if dtype == pl.Utf8
        ]
        if string_columns:
            app_codebook = app_codebook.with_columns(
                [pl.col(column).cast(pl.Utf8).str.strip_chars() for column in string_columns]
            )

        app_codebook = app_codebook.unique(
            subset=[AppCodebookColumn.APP_PACKAGE_NAME],
            keep="first",
            maintain_order=True,
        )
        return app_codebook
    except CodebookFileError:
        raise
    except Exception as exc:
        raise CodebookFileError(f"Failed to load app codebook: {exc}") from exc
