#!/usr/bin/env python3
"""
Script to remove duplicate entries from app codebook files.

This script identifies and removes duplicate app package names from codebook files,
keeping the first occurrence of each duplicate. It supports both CSV and Excel formats
and creates a backup of the original file before making changes.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

# Add parent directory to path to import constants
sys.path.append(str(Path(__file__).parent.parent))

from config.constants import AppCodebookColumn


def setup_logging(verbose: bool = False) -> None:
    """Setup logging configuration."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def load_codebook(file_path: Path) -> pd.DataFrame:
    """Load codebook from CSV or Excel file."""
    logging.info(f"Loading codebook from: {file_path}")

    if not file_path.exists():
        raise FileNotFoundError(f"Codebook file not found: {file_path}")

    if file_path.suffix.lower() == ".csv":
        df = pd.read_csv(file_path)
    elif file_path.suffix.lower() in [".xlsx", ".xls"]:
        df = pd.read_excel(file_path, sheet_name=0)
    else:
        raise ValueError(
            f"Unsupported file format: {file_path.suffix}. Use .csv, .xlsx, or .xls"
        )

    logging.info(f"Loaded {len(df)} rows from codebook")
    return df


def validate_codebook(df: pd.DataFrame) -> None:
    """Validate that the codebook has required columns."""
    if AppCodebookColumn.APP_PACKAGE_NAME not in df.columns:
        raise ValueError(
            f"Codebook must contain '{AppCodebookColumn.APP_PACKAGE_NAME}' column"
        )

    logging.debug(f"Codebook columns: {df.columns.tolist()}")


def remove_duplicates(
    df: pd.DataFrame, keep: str = "first"
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Remove duplicate package names from the codebook.

    Args:
        df: Input DataFrame
        keep: Which duplicate to keep ('first', 'last', or False for all duplicates)

    Returns:
        Tuple of (cleaned_df, duplicates_df)
    """
    # Identify duplicates
    duplicate_mask = df.duplicated(
        subset=[AppCodebookColumn.APP_PACKAGE_NAME], keep=False
    )
    duplicates_df = df[duplicate_mask].copy()

    if len(duplicates_df) > 0:
        logging.warning(
            f"Found {len(duplicates_df)} duplicate package names in app codebook. Keeping {keep} occurrence of each."
        )

        # Show duplicate package names
        duplicate_packages = duplicates_df[AppCodebookColumn.APP_PACKAGE_NAME].unique()
        logging.info(
            f"Duplicate package names: {len(duplicate_packages)} unique packages"
        )

        for package in duplicate_packages[:10]:  # Show first 10
            count = duplicates_df[
                duplicates_df[AppCodebookColumn.APP_PACKAGE_NAME] == package
            ].shape[0]
            logging.debug(f"  - {package}: {count} occurrences")

        if len(duplicate_packages) > 10:
            logging.debug(f"  ... and {len(duplicate_packages) - 10} more")
    else:
        logging.info("No duplicate entries found")

    # Remove duplicates
    cleaned_df = df.drop_duplicates(
        subset=[AppCodebookColumn.APP_PACKAGE_NAME], keep=keep
    )

    removed_count = len(df) - len(cleaned_df)
    logging.info(
        f"Removed {removed_count} duplicate entries, keeping {len(cleaned_df)} unique entries"
    )

    return cleaned_df, duplicates_df


def save_codebook(df: pd.DataFrame, file_path: Path) -> None:
    """Save codebook to file in the same format as input."""
    logging.info(f"Saving cleaned codebook to: {file_path}")

    if file_path.suffix.lower() == ".csv":
        df.to_csv(file_path, index=False)
    elif file_path.suffix.lower() in [".xlsx", ".xls"]:
        df.to_excel(file_path, sheet_name="codebook", index=False, engine="openpyxl")
    else:
        raise ValueError(f"Unsupported output format: {file_path.suffix}")

    logging.info(f"Saved {len(df)} rows to {file_path}")


def create_backup(file_path: Path) -> Path:
    """Create a backup of the original file."""
    backup_path = file_path.with_stem(f"{file_path.stem}_backup")
    backup_path.write_bytes(file_path.read_bytes())
    logging.info(f"Created backup: {backup_path}")
    return backup_path


def main() -> None:
    """Main script execution."""
    parser = argparse.ArgumentParser(
        description="Remove duplicate entries from app codebook files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python remove_app_codebook_duplicates.py codebook.csv
  python remove_app_codebook_duplicates.py codebook.xlsx --keep last --no-backup
  python remove_app_codebook_duplicates.py codebook.csv --output cleaned_codebook.csv
        """,
    )

    parser.add_argument(
        "input_file", type=Path, help="Path to the input codebook file (CSV or Excel)"
    )

    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Output file path (default: overwrite input file)",
    )

    parser.add_argument(
        "--keep",
        choices=["first", "last"],
        default="first",
        help="Which duplicate to keep when removing duplicates (default: first)",
    )

    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip creating a backup of the original file",
    )

    parser.add_argument(
        "--duplicates-report",
        type=Path,
        help="Save duplicate entries to a separate file for review",
    )

    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Enable verbose logging"
    )

    args = parser.parse_args()

    setup_logging(args.verbose)

    try:
        # Load and validate codebook
        df = load_codebook(args.input_file)
        validate_codebook(df)

        # Remove duplicates
        cleaned_df, duplicates_df = remove_duplicates(df, keep=args.keep)

        # Save duplicates report if requested
        if args.duplicates_report and len(duplicates_df) > 0:
            save_codebook(duplicates_df, args.duplicates_report)
            logging.info(f"Saved duplicates report to: {args.duplicates_report}")

        # Only proceed if duplicates were found
        if len(duplicates_df) == 0:
            logging.info("No changes needed - no duplicates found")
            return

        # Determine output path
        output_path = args.output or args.input_file

        # Create backup if requested and we're overwriting the original
        if not args.no_backup and output_path == args.input_file:
            create_backup(args.input_file)

        # Save cleaned codebook
        save_codebook(cleaned_df, output_path)

        logging.info("Duplicate removal completed successfully")

    except Exception as e:
        logging.error(f"Error processing codebook: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
