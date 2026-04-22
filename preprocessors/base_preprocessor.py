"""
Base preprocessor class for Chronicle data processing.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

import pandas as pd

from models.preprocessing_options import ChronicleAndroidRawDataPreprocessingOptions

LOGGER = logging.getLogger(__name__)


class BasePreprocessor(ABC):
    """
    Abstract base class for data processors.

    Each preprocessor is responsible for a specific type of data transformation.
    """

    def __init__(self, options: ChronicleAndroidRawDataPreprocessingOptions) -> None:
        """
        Initialize the preprocessor.

        Args:
            options: The preprocessing options
        """
        self.options = options

    @abstractmethod
    def preprocess(self, df: pd.DataFrame, *args, **kwargs) -> pd.DataFrame:
        """
        Process the dataframe.

        Args:
            df: The dataframe to process

        Returns:
            pd.DataFrame: The processed dataframe
        """
