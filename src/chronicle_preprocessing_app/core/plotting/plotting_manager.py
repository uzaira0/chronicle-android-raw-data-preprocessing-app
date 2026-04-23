"""Minimal Polars-first plotting entrypoints."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import polars as pl

from chronicle_preprocessing_app.core.config import ProcessingStats

LOGGER = logging.getLogger(__name__)


class PlottingManager:
    """Lightweight plotting manager placeholder."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        del args
        del kwargs

    def generate_plots(self, *args: Any, **kwargs: Any) -> tuple[Path | None, ProcessingStats]:
        return generate_plots(*args, **kwargs)


def generate_plots(
    *,
    study_name: str,
    preprocessed_folder: Path,
    options: Any,
    codebook_path: str | Path | None = None,
    progress_callback: Any = None,
) -> tuple[Path | None, ProcessingStats]:
    del study_name
    del options
    del codebook_path
    del progress_callback

    stats = ProcessingStats()
    csv_files = sorted(preprocessed_folder.glob("*.csv"))
    stats.total_files = len(csv_files)
    for csv_file in csv_files:
        try:
            pl.read_csv(csv_file, n_rows=1)
            stats.mark_plotted(csv_file.name, "csv_loaded")
        except Exception as exc:
            stats.mark_plot_failed(csv_file.name, str(exc), "csv_load_failed")

    LOGGER.info("Plot generation placeholder scanned %d CSV files", len(csv_files))
    return preprocessed_folder, stats
