"""
Preprocessor for column-related operations in Chronicle data.
"""

from __future__ import annotations

import logging
from datetime import datetime as datetime_class

import pandas as pd

from config.constants import (
    TARGET_CHILD_USERNAME,
    ChronicleDeviceType,
    Column,
    TimestampFormat,
)
from config.version import __version__
from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions
from preprocessors.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class ColumnPreprocessor(BasePreprocessor):
    """
    Preprocessor for handling column-related operations.

    This preprocessor is responsible for creating additional columns,
    correcting original columns, and preparing columns for output.
    """

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
        """
        Initialize the column preprocessor.

        Args:
            options: The preprocessing options
        """
        super().__init__(options)

    def preprocess(
        self, df: pd.DataFrame, device_model: ChronicleDeviceType
    ) -> pd.DataFrame:
        """
        Process columns in the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
        df = self.correct_username_column(df)
        return self.create_additional_columns(df, device_model)

    def correct_username_column(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Correct username column in the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The dataframe with corrected columns
        """
        LOGGER.debug("Correcting username column")

        df_copy = df.copy()

        # Only apply internal research username corrections when internal modules are available
        try:
            from internal.P01_classes import (
                DeviceSharingStatus,
                ParticipantID,
                TrackingSheet,
            )

            # Internal modules available - apply username standardization
            if Column.USERNAME in df_copy.columns:
                df_copy[Column.USERNAME] = df_copy[Column.USERNAME].replace(
                    "Target child", TARGET_CHILD_USERNAME
                )
                LOGGER.debug("Applied internal research username corrections")
        except ImportError:
            LOGGER.debug(
                "Internal modules not available - skipping username corrections"
            )

        LOGGER.debug("Username column corrected successfully")
        return df_copy

    def create_additional_columns(
        self, df: pd.DataFrame, device_model: ChronicleDeviceType
    ) -> pd.DataFrame:
        """
        Create additional columns in the dataframe.

        Args:
            df: The dataframe to process
            device_model: The detected device model

        Returns:
            pd.DataFrame: The dataframe with additional columns
        """
        LOGGER.debug("Creating additional columns")

        df_copy = df.reset_index(drop=True)

        # Administrative columns
        df_copy[Column.PREPROCESSOR_VERSION] = __version__
        df_copy[Column.DATETIME_OF_PREPROCESSING] = datetime_class.now().strftime(
            TimestampFormat.DATETIME
        )
        df_copy[Column.POSSIBLE_DEVICE_MODEL] = device_model.value

        # Date and time derived columns
        if Column.EVENT_TIMESTAMP in df_copy.columns:
            df_copy[Column.DATE] = df_copy[Column.EVENT_TIMESTAMP].dt.date
            df_copy[Column.DAY] = (
                df_copy[Column.EVENT_TIMESTAMP].dt.weekday + 1
            ) % 7 + 1
            df_copy[Column.WEEKDAY_MF] = (
                df_copy[Column.EVENT_TIMESTAMP].dt.weekday < 5
            ).astype(int)
            df_copy[Column.WEEKDAY_MTH] = (
                df_copy[Column.EVENT_TIMESTAMP].dt.weekday < 4
            ).astype(int)
            df_copy[Column.WEEKDAY_SUTH] = (
                (df_copy[Column.EVENT_TIMESTAMP].dt.weekday < 4)
                | (df_copy[Column.EVENT_TIMESTAMP].dt.weekday == 6)
            ).astype(int)
            df_copy[Column.HOUR] = df_copy[Column.EVENT_TIMESTAMP].dt.hour
            df_copy[Column.QUARTER] = df_copy[Column.EVENT_TIMESTAMP].dt.quarter

        LOGGER.debug(
            f"Successfully created {len(df_copy.columns) - len(df.columns)} additional columns"
        )
        return df_copy
