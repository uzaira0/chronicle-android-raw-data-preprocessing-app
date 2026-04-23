"""Polars-backed app usage detail derivation."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


class OptimizedAppUsageDetailsProcessor:
    """Delegate detail derivation to the canonical Polars implementation."""

    def __init__(self, options: PreprocessingOptions) -> None:
        self._helper = PolarsFastPathPreprocessor(options)

    def add_app_usage_details(self, df: pl.DataFrame) -> pl.DataFrame:
        return self._helper._add_app_usage_detail_columns(df)


def create_optimized_processor(options: PreprocessingOptions) -> OptimizedAppUsageDetailsProcessor:
    """Backward-compatible factory for the optimized detail processor."""
    return OptimizedAppUsageDetailsProcessor(options)
