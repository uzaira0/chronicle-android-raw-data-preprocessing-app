"""
Preprocessor for app filtering operations in Chronicle data.
"""

from __future__ import annotations

import logging

import pandas as pd

from config.constants import Column, InteractionType
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from preprocessors.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class AppFilterPreprocessor(BasePreprocessor):
    """
    Preprocessor for handling app filtering operations.

    This preprocessor is responsible for filtering and labeling apps
    based on predefined criteria.
    """

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
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

        df_copy = df.copy()

        # Find apps to filter
        mask = df_copy[Column.APP_PACKAGE_NAME].isin(
            self.options.apps_to_filter_dict.keys()
        )

        # Set to track unique unexpected app label matches
        unexpected_labels = set()

        # Process each row that matches filter criteria
        for index, row in df_copy[mask].iterrows():
            app_package_name = row[Column.APP_PACKAGE_NAME]
            app_label = row[Column.APPLICATION_LABEL]
            expected_labels = [
                label.strip()
                for label in self.options.apps_to_filter_dict[app_package_name].split(
                    ","
                )
            ]

            # Check if app label matches expected labels
            if app_label not in expected_labels:
                # Use safe encoding for Unicode characters in logging
                try:
                    LOGGER.warning(
                        f"App label mismatch for package {app_package_name}: expected any of '{expected_labels}', found '{app_label}'"
                    )
                except UnicodeEncodeError:
                    # Fallback to ASCII-safe logging if Unicode fails
                    safe_expected = [
                        label.encode("ascii", "replace").decode("ascii")
                        for label in expected_labels
                    ]
                    safe_app_label = app_label.encode("ascii", "replace").decode(
                        "ascii"
                    )
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
                        label.encode("ascii", "replace").decode("ascii")
                        for label in expected_labels
                    ]
                    safe_app_label = app_label.encode("ascii", "replace").decode(
                        "ascii"
                    )
                    unexpected_labels.add(
                        f"{app_package_name}: expected any of '{safe_expected}', found '{safe_app_label}' (Unicode characters replaced)"
                    )
                continue

            # Update interaction type for filtered apps
            if row[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_RESUMED:
                df_copy.at[index, Column.INTERACTION_TYPE] = (
                    InteractionType.FILTERED_APP_RESUMED
                )
            elif row[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_PAUSED:
                df_copy.at[index, Column.INTERACTION_TYPE] = (
                    InteractionType.FILTERED_APP_PAUSED
                )
            elif row[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_STOPPED:
                df_copy.at[index, Column.INTERACTION_TYPE] = (
                    InteractionType.FILTERED_APP_STOPPED
                )
            elif row[Column.INTERACTION_TYPE] == InteractionType.ACTIVITY_DESTROYED:
                df_copy.at[index, Column.INTERACTION_TYPE] = (
                    InteractionType.FILTERED_APP_DESTROYED
                )

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
            label.strip()
            for label in self.options.apps_to_filter_dict[app_package_name].split(",")
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
