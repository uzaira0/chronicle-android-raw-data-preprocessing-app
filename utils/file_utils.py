"""
File operations and utilities for Chronicle Android Raw Data Preprocessing Application
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import NoReturn

import pandas as pd
from pandas.errors import EmptyDataError, ParserError

LOGGER = logging.getLogger(__name__)


def get_matching_files_from_folder(
    folder: Path | str,
    file_matching_pattern: str,
    ignore_names: list[str] | None = None,
) -> list[Path]:
    """
    Get a list of files matching a pattern in a folder and its subfolders.

    Args:
        folder: Path to search in
        file_matching_pattern: Regex pattern to match file names
        ignore_names: List of strings to exclude from results (files containing these strings will be ignored)

    Returns:
        A list of Path objects matching the pattern and not containing ignore strings

    Raises:
        ValueError: If the folder doesn't exist or isn't accessible
    """
    folder_path = Path(folder)
    if not folder_path.exists():
        msg = f"Folder does not exist: {folder_path}"
        LOGGER.error(msg)
        raise ValueError(msg)

    if not folder_path.is_dir():
        msg = f"Path is not a directory: {folder_path}"
        LOGGER.error(msg)
        raise ValueError(msg)

    LOGGER.debug(f"Getting matching files from folder: {folder} with pattern: {file_matching_pattern}")

    if not ignore_names:
        ignore_names = ["Preprocessed"]

    try:
        matching_files = [
            f
            for f in folder_path.rglob("*")
            if f.is_file() and re.search(file_matching_pattern, f.name) and all(ignored not in str(f) for ignored in ignore_names)
        ]
        LOGGER.debug(f"Found {len(matching_files)} matching files")
        return matching_files
    except PermissionError as e:
        msg = f"Permission denied when accessing directory: {folder_path}. Error: {e}"
        LOGGER.error(msg)
        raise ValueError(msg) from e
    except Exception as e:
        msg = f"Error searching for files in {folder_path}: {e}"
        LOGGER.exception(msg)
        raise ValueError(msg) from e


class FileOperationError(Exception):
    """Base exception for file operation errors"""

    pass


class FilterFileError(FileOperationError):
    """Exception raised for errors related to filter files"""

    pass


class CodebookFileError(FileOperationError):
    """Exception raised for errors related to codebook files"""

    pass


def read_filter_file(file_path: Path | str) -> dict[str, str]:
    """
    Read a filter file and return a dictionary of app package names to app labels.

    Args:
        file_path: Path to the filter file (.csv or .xlsx)

    Returns:
        Dictionary mapping app package names to app labels

    Raises:
        FilterFileError: If the file cannot be read or is in an invalid format
    """
    file_path = Path(file_path)

    if not file_path.exists():
        msg = f"Filter file does not exist: {file_path}"
        LOGGER.error(msg)
        raise FilterFileError(msg)

    file_extension = file_path.suffix.lower()
    app_filters: dict[str, str] = {}

    try:
        if file_extension == ".csv":
            # Read CSV file
            df = pd.read_csv(file_path)
        elif file_extension == ".xlsx":
            # Read Excel file (first sheet)
            df = pd.read_excel(file_path, sheet_name=0)
        else:
            msg = f"Unsupported file type: {file_extension}. Must be .csv or .xlsx"
            LOGGER.error(msg)
            raise FilterFileError(msg)

        # Check if the DataFrame has at least 2 columns
        if df.shape[1] < 2:
            msg = "Filter file must have at least two columns (Package Name and App Label)"
            LOGGER.error(msg)
            raise FilterFileError(msg)

        # Use the first two columns regardless of their names
        package_col = df.columns[0]
        label_col = df.columns[1]

        # Build the dictionary
        for _, row in df.iterrows():
            package_name = str(row[package_col]).strip()
            app_label = str(row[label_col]).strip()

            if package_name and package_name.lower() != "nan":
                app_filters[package_name] = app_label

        LOGGER.info(f"Successfully loaded {len(app_filters)} app filters from {file_path}")
        return app_filters

    except EmptyDataError:
        msg = f"Filter file is empty: {file_path}"
        LOGGER.error(msg)
        raise FilterFileError(msg)
    except ParserError:
        msg = f"Filter file has invalid format: {file_path}"
        LOGGER.error(msg)
        raise FilterFileError(msg)
    except Exception as e:
        msg = f"Failed to read filter file: {e}"
        LOGGER.exception(msg)
        raise FilterFileError(msg) from e


def read_app_codebook(codebook_path: Path | str) -> pd.DataFrame | None:
    """
    Read and prepare an app codebook file for efficient lookups.

    Args:
        codebook_path: Path to the app codebook file (.csv, .xlsx, or .xls)

    Returns:
        DataFrame: Optimized app codebook with app_package_name as index, or None if file doesn't exist

    Raises:
        CodebookFileError: If the codebook cannot be read or processed
    """
    codebook_path = Path(codebook_path)

    if not codebook_path.exists():
        LOGGER.warning(f"App codebook file not found: {codebook_path}")
        return None

    try:
        LOGGER.debug(f"Loading app codebook from {codebook_path}")

        if codebook_path.suffix.lower() == ".csv":
            app_codebook = pd.read_csv(codebook_path)
        elif codebook_path.suffix.lower() in (".xlsx", ".xls"):
            app_codebook = pd.read_excel(codebook_path, sheet_name=0)
        else:
            msg = f"Unsupported codebook file type: {codebook_path.suffix}. Must be .csv, .xlsx, or .xls"
            LOGGER.error(msg)
            raise CodebookFileError(msg)

        LOGGER.info(f"Successfully loaded app codebook with {len(app_codebook)} entries")
        LOGGER.debug(f"App codebook columns: {app_codebook.columns.tolist()}")

        if "app_package_name" not in app_codebook.columns:
            msg = "App codebook must contain an 'app_package_name' column"
            LOGGER.error(msg)
            raise CodebookFileError(msg)

        # Optimize codebook for lookups
        app_codebook = app_codebook.set_index("app_package_name")
        LOGGER.debug("Optimized app codebook for lookups using index")

    except EmptyDataError:
        msg = f"App codebook file is empty: {codebook_path}"
        LOGGER.error(msg)
        raise CodebookFileError(msg)
    except ParserError:
        msg = f"App codebook file has invalid format: {codebook_path}"
        LOGGER.error(msg)
        raise CodebookFileError(msg)
    except Exception as e:
        msg = f"Failed to load app codebook: {e}"
        LOGGER.exception(msg)
        raise CodebookFileError(msg) from e
    else:
        return app_codebook
