"""Polars-backed app usage preprocessing."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import polars as pl

from chronicle_preprocessing_app.config.constants import Column
from chronicle_preprocessing_app.config.defaults import (
    DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS,
    DEFAULT_LONG_USAGE_DURATION_THRESHOLDS,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_algorithms import (
    OptimizedAppUsageAlgorithm,
)
from chronicle_preprocessing_app.core.preprocessing.algorithms.app_usage_details_optimizer import (
    OptimizedAppUsageDetailsProcessor,
)
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

LOGGER = logging.getLogger(__name__)


class NoAppUsageDataError(ValueError):
    """Raised when a file contains no valid app usage rows."""


@dataclass(frozen=True)
class _ThresholdSpec:
    label_template: str
    thresholds: list[float]


class AppUsagePreprocessor(BasePreprocessor):
    """Run the canonical Polars app-usage workflow."""

    def __init__(self, options: PreprocessingOptions) -> None:
        super().__init__(options)
        self.algorithm = OptimizedAppUsageAlgorithm(options)
        self.details_processor = OptimizedAppUsageDetailsProcessor(options)
        self._helper = PolarsFastPathPreprocessor(options)

    def preprocess(self, df: pl.DataFrame) -> pl.DataFrame:
        rows_in = len(df)
        LOGGER.debug("Starting %s", self.__class__.__name__, extra={"row_count": rows_in, "file": getattr(self, "_current_file", None)})
        result = self.run_app_usage_algorithm(df, raise_on_no_valid_usage=True)
        LOGGER.debug("Completed %s", self.__class__.__name__, extra={"rows_in": rows_in, "rows_out": len(result)})
        return result

    def process_app_usage(self, df: pl.DataFrame) -> pl.DataFrame:
        return self.run_app_usage_algorithm(df, raise_on_no_valid_usage=False)

    def run_app_usage_algorithm(
        self,
        df: pl.DataFrame,
        *,
        raise_on_no_valid_usage: bool = True,
    ) -> pl.DataFrame:
        if self.options.use_filter_file:
            df = self.process_filtered_app_usage(df)

        try:
            return self.process_valid_app_usage(df)
        except NoAppUsageDataError:
            if raise_on_no_valid_usage:
                raise
            LOGGER.warning("No valid app usage data during the study period")
            return df

    def process_filtered_app_usage(self, df: pl.DataFrame) -> pl.DataFrame:
        return self._helper._process_filtered_app_usage(df)

    def process_valid_app_usage(self, df: pl.DataFrame) -> pl.DataFrame:
        try:
            return self._helper._process_valid_app_usage(df)
        except ValueError as exc:
            raise NoAppUsageDataError(str(exc)) from exc

    def add_app_usage_details(self, df: pl.DataFrame) -> pl.DataFrame:
        return self.details_processor.add_app_usage_details(df)

    def add_app_usage_details_legacy(self, df: pl.DataFrame) -> pl.DataFrame:
        return self.details_processor.add_app_usage_details(df)

    def add_app_usage_flags(self, df: pl.DataFrame) -> pl.DataFrame:
        return self._helper._mark_app_usage_flags(df)

    def _get_app_usage_flags(
        self,
        time_gaps: pl.Series,
        durations_minutes: pl.Series,
        *,
        time_gap_thresholds: list[float] | None = None,
        duration_thresholds: list[float] | None = None,
    ) -> pl.Series:
        time_gap_spec = _ThresholdSpec(
            label_template=">{threshold}-HR TIME GAP",
            thresholds=list(time_gap_thresholds or self.options.long_data_time_gap_thresholds),
        )
        duration_spec = _ThresholdSpec(
            label_template=">{threshold}-HR APP USAGE",
            thresholds=list(duration_thresholds or self.options.long_usage_duration_thresholds),
        )

        if not time_gap_spec.thresholds:
            time_gap_spec = _ThresholdSpec(
                time_gap_spec.label_template,
                list(DEFAULT_LONG_DATA_TIME_GAP_THRESHOLDS),
            )
        if not duration_spec.thresholds:
            duration_spec = _ThresholdSpec(
                duration_spec.label_template,
                list(DEFAULT_LONG_USAGE_DURATION_THRESHOLDS),
            )

        gap_values = time_gaps.cast(pl.Float64).fill_null(np.nan).to_numpy()
        duration_values = (durations_minutes.cast(pl.Float64).fill_null(np.nan) / 60.0).to_numpy()

        flags: list[list[str]] = []
        for gap_value, duration_value in zip(gap_values, duration_values, strict=True):
            row_flags: list[str] = []
            if np.isfinite(gap_value):
                for threshold in sorted(time_gap_spec.thresholds, reverse=True):
                    if gap_value >= threshold:
                        row_flags.append(time_gap_spec.label_template.format(threshold=threshold))
                        break
            if np.isfinite(duration_value):
                for threshold in sorted(duration_spec.thresholds, reverse=True):
                    if duration_value >= threshold:
                        row_flags.append(duration_spec.label_template.format(threshold=threshold))
                        break
            flags.append(row_flags)
        return pl.Series(Column.ANY_APP_USAGE_FLAGS, flags, dtype=pl.List(pl.String))
