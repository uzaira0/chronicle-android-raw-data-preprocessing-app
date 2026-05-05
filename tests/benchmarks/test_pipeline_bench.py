"""Pipeline performance benchmarks — run with: pytest tests/benchmarks/ --benchmark-only"""

from __future__ import annotations

import polars as pl
import pytest

from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.dataframe_provider import get_dataframe_provider
from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
    TimestampPreprocessor,
)
from chronicle_preprocessing_app.core.preprocessing.timezone_preprocessor import (
    TimezonePreprocessor,
)


def _make_timestamp_df(n: int) -> pl.DataFrame:
    import datetime

    base = datetime.datetime(2024, 1, 1, 0, 0, 0, tzinfo=datetime.timezone.utc)
    timestamps = [(base + datetime.timedelta(seconds=i * 10)).strftime("%Y-%m-%dT%H:%M:%S+00:00") for i in range(n)]
    return pl.DataFrame({"event_timestamp": timestamps, "App": ["com.example.app"] * n})


@pytest.fixture
def options():
    return PreprocessingOptions()


@pytest.mark.benchmark(group="timestamp_preprocessor")
def test_bench_timestamp_preprocessor_1k(benchmark, options):
    df = _make_timestamp_df(1_000)
    preprocessor = TimestampPreprocessor(options)
    benchmark(preprocessor.correct_timestamp_column, df)


@pytest.mark.benchmark(group="timestamp_preprocessor")
def test_bench_timestamp_preprocessor_10k(benchmark, options):
    df = _make_timestamp_df(10_000)
    preprocessor = TimestampPreprocessor(options)
    benchmark(preprocessor.correct_timestamp_column, df)


@pytest.mark.benchmark(group="timezone_preprocessor")
def test_bench_determine_primary_timezone_1k(benchmark, options):
    df = _make_timestamp_df(1_000).with_columns(pl.lit("America/New_York").alias("timezone"))
    preprocessor = TimezonePreprocessor(options)
    benchmark(preprocessor.determine_primary_timezone, df)


@pytest.mark.benchmark(group="fix_timestamp_format")
def test_bench_fix_timestamp_format(benchmark):
    sample = "2024-01-15T12:34:56+00:00"
    benchmark(TimestampPreprocessor.fix_timestamp_format, sample)


@pytest.mark.benchmark(group="dataframe_provider")
def test_bench_provider_read_and_strip(benchmark, tmp_path):
    import csv

    path = tmp_path / "bench.csv"
    rows = [{"A": f"  value{i}  ", "B": str(i)} for i in range(500)]
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["A", "B"])
        writer.writeheader()
        writer.writerows(rows)
    provider = get_dataframe_provider()
    benchmark(provider.read_csv, path)
