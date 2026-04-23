"""Archived app-usage algorithms retained for parity tests."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_algorithms import (
    OptimizedAppUsageAlgorithm,
)


class ArchivedBaselineAppUsageAlgorithm(OptimizedAppUsageAlgorithm):
    """Legacy pure-Python matcher retained for parity tests."""

    def __init__(self, options: PreprocessingOptions):
        super().__init__(options)

    def process_app_usage(
        self,
        df: pl.DataFrame,
        resumed_mask: pl.Series,
        same_app_stop_mask: pl.Series,
        other_stop_mask: pl.Series,
        stopped_mask: pl.Series,
    ) -> pl.DataFrame:
        df_copy = df.clone()
        timestamp_ns = df_copy.get_column(Column.EVENT_TIMESTAMP).dt.epoch("ns").to_numpy()
        app_packages = df_copy.get_column(Column.APP_PACKAGE_NAME).fill_null("").to_numpy()
        return self._apply_python_matcher(
            df_copy,
            app_packages=app_packages,
            timestamp_ns=timestamp_ns,
            resumed_flags=resumed_mask.to_numpy().astype(bool, copy=False),
            same_stop_flags=same_app_stop_mask.to_numpy().astype(bool, copy=False),
            other_stop_flags=other_stop_mask.to_numpy().astype(bool, copy=False),
            stopped_flags=stopped_mask.to_numpy().astype(bool, copy=False),
        )
