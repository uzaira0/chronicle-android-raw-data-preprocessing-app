"""Polars-backed app filter preprocessing."""

from __future__ import annotations

import logging
from pathlib import Path

import polars as pl

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.base_preprocessor import BasePreprocessor
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

LOGGER = logging.getLogger(__name__)


class AppFilterPreprocessor(BasePreprocessor):
    """Label filtered apps using the canonical Polars fast-path logic."""

    def __init__(self, options: PreprocessingOptions) -> None:
        super().__init__(options)
        self._helper = PolarsFastPathPreprocessor(options)

    def preprocess(self, df: pl.DataFrame) -> pl.DataFrame:
        return self.label_filtered_apps(df)

    def label_filtered_apps(self, df: pl.DataFrame) -> pl.DataFrame:
        return self._helper._label_filtered_apps(df)

    def should_filter_app(self, app_package_name: str, app_label: str) -> bool:
        labels = self.options.apps_to_filter_dict.get(app_package_name)
        if not labels:
            return False
        return app_label in {value.strip() for value in labels.split(",")}

    def _save_unexpected_app_labels(self, unexpected_labels: set[str]) -> None:
        filename = Path("unexpected_app_labels.txt")
        existing = set()
        if filename.exists():
            existing = set(filename.read_text(encoding="utf-8").splitlines())
        merged = sorted(existing | unexpected_labels)
        filename.write_text("\n".join(merged) + ("\n" if merged else ""), encoding="utf-8")
        LOGGER.info("Saved %d unexpected app labels to %s", len(merged), filename)
