"""
Preprocessor for app filtering operations in Chronicle data.

Supports Polars for high-performance operations when enabled.
Set CHRONICLE_USE_POLARS=true to enable.
"""

from __future__ import annotations

import logging
import os

import pandas as pd

# Conditional Polars import
try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    POLARS_AVAILABLE = False
    pl = None  # type: ignore

# Environment variable to control Polars usage
USE_POLARS = os.getenv("CHRONICLE_USE_POLARS", "true").lower() == "true" and POLARS_AVAILABLE

try:
    from chronicle_preprocessing_app.config.constants import Column, InteractionType
except ImportError:
    from ...config.constants import Column, InteractionType

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class AppFilterPreprocessor(BasePreprocessor):
    """
    Preprocessor for handling app filtering operations.

    This preprocessor is responsible for filtering and labeling apps
    based on predefined criteria.
    """

    def __init__(self, options: PreprocessingOptions) -> None:
        """
        Initialize the app filter preprocessor.

        Args:
            options: The preprocessing options
        """
        super().__init__(options)

    def preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process app filtering in the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        return self.label_filtered_apps(df)

    def label_filtered_apps(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Label apps that should be filtered based on package name and app label.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The dataframe with filtered app labels
        """
        LOGGER.debug("Labeling filtered apps")

        # OPTIMIZED: avoid unnecessary copy
        df_copy = df

        # Find apps to filter
        mask = df_copy[Column.APP_PACKAGE_NAME].isin(self.options.apps_to_filter_dict.keys())

        if not mask.any():
            return df_copy

        # OPTIMIZED: Pre-process expected labels dictionary to avoid repeated string operations
        expected_labels_map = {}
        for package_name, labels_str in self.options.apps_to_filter_dict.items():
            expected_labels_map[package_name] = [label.strip() for label in labels_str.split(",")]

        # Set to track unique unexpected app label matches
        unexpected_labels = set()

        # OPTIMIZED: Vectorized operations on filtered subset
        filtered_df = df_copy[mask].copy()

        # Create vectorized label validation
        def validate_app_label(row):
            app_package_name = row[Column.APP_PACKAGE_NAME]
            app_label = row[Column.APPLICATION_LABEL]
            expected_labels = expected_labels_map[app_package_name]
            return app_label in expected_labels

        # Apply validation vectorized
        valid_labels = filtered_df.apply(validate_app_label, axis=1)
        invalid_mask = mask & ~valid_labels

        # Handle invalid labels for logging
        for _, row in df_copy[invalid_mask].iterrows():
            app_package_name = row[Column.APP_PACKAGE_NAME]
            app_label = row[Column.APPLICATION_LABEL]
            expected_labels = expected_labels_map[app_package_name]

            # Use safe encoding for Unicode characters in logging
            try:
                LOGGER.warning(
                    f"App label mismatch for package {app_package_name}: expected any of '{expected_labels}', found '{app_label}'"
                )
            except UnicodeEncodeError:
                # Fallback to ASCII-safe logging if Unicode fails
                safe_expected = [
                    label.encode("ascii", "replace").decode("ascii") for label in expected_labels
                ]
                safe_app_label = app_label.encode("ascii", "replace").decode("ascii")
                LOGGER.warning(
                    f"App label mismatch for package {app_package_name}: expected any of '{safe_expected}', found '{safe_app_label}' (Unicode characters replaced)"
                )

            try:
                unexpected_labels.add(
                    f"{app_package_name}: expected any of '{expected_labels}', found '{app_label}'"
                )
            except UnicodeEncodeError:
                # Fallback for the unexpected_labels set as well
                safe_expected = [
                    label.encode("ascii", "replace").decode("ascii") for label in expected_labels
                ]
                safe_app_label = app_label.encode("ascii", "replace").decode("ascii")
                unexpected_labels.add(
                    f"{app_package_name}: expected any of '{safe_expected}', found '{safe_app_label}' (Unicode characters replaced)"
                )

        # OPTIMIZED: Vectorized interaction type mapping for valid labels only
        valid_filter_mask = mask & valid_labels

        # Create interaction type mapping dictionary
        interaction_mapping = {
            InteractionType.ACTIVITY_RESUMED: InteractionType.FILTERED_APP_RESUMED,
            InteractionType.ACTIVITY_PAUSED: InteractionType.FILTERED_APP_PAUSED,
            InteractionType.ACTIVITY_STOPPED: InteractionType.FILTERED_APP_STOPPED,
            InteractionType.ACTIVITY_DESTROYED: InteractionType.FILTERED_APP_DESTROYED,
        }

        # Apply mapping vectorized using .loc for better performance
        for original_type, filtered_type in interaction_mapping.items():
            type_mask = valid_filter_mask & (df_copy[Column.INTERACTION_TYPE] == original_type)
            df_copy.loc[type_mask, Column.INTERACTION_TYPE] = filtered_type

        # Record unexpected app labels to file if any found
        if unexpected_labels:
            self._save_unexpected_app_labels(unexpected_labels)

        LOGGER.debug("Filtered apps labeled successfully")
        return df_copy

    def should_filter_app(self, app_package_name: str, app_label: str) -> bool:
        """
        Determine if an app should be filtered based on its package name and label.

        Args:
            app_package_name: The package name of the app
            app_label: The display label of the app

        Returns:
            bool: True if the app should be filtered, False otherwise
        """
        if app_package_name not in self.options.apps_to_filter_dict:
            return False

        expected_labels = [
            label.strip() for label in self.options.apps_to_filter_dict[app_package_name].split(",")
        ]
        return app_label in expected_labels

    def _save_unexpected_app_labels(self, unexpected_labels: set) -> None:
        """
        Save unexpected app labels to a file.

        Args:
            unexpected_labels: Set of unexpected app label entries
        """
        # First read existing entries to avoid duplicates
        existing_labels = set()
        filename = "unexpected_app_labels.txt"

        try:
            with open(filename, encoding="utf-8") as file:
                for line in file:
                    existing_labels.add(line.strip())
        except FileNotFoundError:
            # File doesn't exist yet, that's okay
            pass

        # Combine with new entries, avoiding duplicates
        all_labels = existing_labels.union(unexpected_labels)

        # Write only if there are new entries to add
        if len(all_labels) > len(existing_labels):
            with open(filename, "w", encoding="utf-8") as file:
                for item in sorted(all_labels):
                    file.write(f"{item}\n")

            LOGGER.info(f"Saved {len(all_labels)} unexpected app labels to {filename}")

