"""
Preprocessor for column-related operations in Chronicle data.

Supports Polars for high-performance operations when enabled.
Set CHRONICLE_USE_POLARS=true to enable.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime as datetime_class

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
    from chronicle_preprocessing_app.config.constants import (
        TARGET_CHILD_USERNAME,
        ChronicleDeviceType,
        Column,
        TimestampFormat,
    )
    from chronicle_preprocessing_app.config.version import __version__
except ImportError:
    from ...config.constants import (
        TARGET_CHILD_USERNAME,
        ChronicleDeviceType,
        Column,
        TimestampFormat,
    )
    from ...config.version import __version__

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor

LOGGER = logging.getLogger(__name__)


class ColumnPreprocessor(BasePreprocessor):
    """
    Preprocessor for handling column-related operations.

    This preprocessor is responsible for creating additional columns,
    correcting original columns, and preparing columns for output.
    """

    def __init__(self, options: PreprocessingOptions) -> None:
        """
        Initialize the column preprocessor.

        Args:
            options: The preprocessing options
        """
        super().__init__(options)

    def preprocess(self, df: pd.DataFrame, device_model: ChronicleDeviceType) -> pd.DataFrame:
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
            from chronicle_preprocessing_internal import (
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
            LOGGER.debug("Internal modules not available - skipping username corrections")

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
            event_timestamps = df_copy[Column.EVENT_TIMESTAMP]
            if getattr(event_timestamps.dtype, "tz", None) is not None:
                # Pandas recomputes localized timestamps for every .dt property on
                # tz-aware columns; localize once and derive all calendar fields.
                event_timestamps = event_timestamps.dt.tz_localize(None)

            event_datetime = event_timestamps.dt
            weekday = event_datetime.weekday

            df_copy[Column.DATE] = event_datetime.date
            df_copy[Column.DAY] = (weekday + 1) % 7 + 1
            df_copy[Column.WEEKDAY_MF] = (weekday < 5).astype(int)
            df_copy[Column.WEEKDAY_MTH] = (weekday < 4).astype(int)
            df_copy[Column.WEEKDAY_SUTH] = ((weekday < 4) | (weekday == 6)).astype(int)
            df_copy[Column.HOUR] = event_datetime.hour
            df_copy[Column.QUARTER] = event_datetime.quarter

        LOGGER.debug(
            f"Successfully created {len(df_copy.columns) - len(df.columns)} additional columns"
        )
        return df_copy
