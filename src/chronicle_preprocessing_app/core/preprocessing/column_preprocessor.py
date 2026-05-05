"""Polars-backed column preprocessing helpers."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import ChronicleDeviceType, Column
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


class ColumnPreprocessor(BasePreprocessor):
    """Create derived columns using the canonical Polars path."""

    def __init__(self, options: PreprocessingOptions) -> None:
        super().__init__(options)
        self._helper = PolarsFastPathPreprocessor(options)

    def preprocess(self, df: pl.DataFrame, device_model: ChronicleDeviceType) -> pl.DataFrame:
        df = self.correct_username_column(df)
        return self.create_additional_columns(df, device_model)

    def correct_username_column(self, df: pl.DataFrame) -> pl.DataFrame:
        return self._helper._correct_username_column(df)

    def create_additional_columns(
        self,
        df: pl.DataFrame,
        device_model: ChronicleDeviceType,
    ) -> pl.DataFrame:
        return self._helper._create_additional_columns(df).with_columns(pl.lit(device_model.value).alias(Column.POSSIBLE_DEVICE_MODEL))
