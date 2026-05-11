"""Atheris fuzz harness for Chronicle CSV parsing and timestamp normalisation.

Requires atheris>=2.3.0 — Python <=3.12 and Linux only.
On Python 3.13+ or non-Linux the import is skipped by pytest.importorskip,
so the test is silently omitted rather than erroring.

Run directly as a libFuzzer binary (preferred):
    python tests/fuzz/fuzz_csv_parsing.py -max_total_time=60

Run as a single pytest sanity check (no fuzzing — one fixed seed):
    pytest tests/fuzz/fuzz_csv_parsing.py -q
"""

from __future__ import annotations

import sys

import pytest

# Guard: atheris only works on Python <=3.12 and Linux.
pytest.importorskip("atheris")

import atheris
import atheris.instrument_imports


def _run_one(data: bytes) -> None:
    """Core fuzz target — one byte-string input from libFuzzer."""
    fdp = atheris.FuzzedDataProvider(data)
    fuzz_text = fdp.ConsumeUnicodeNoSurrogates(min(len(data), 1024))

    # --- Target 1: timestamp normalisation ---
    # fix_timestamp_format is a pure string -> string function; any input
    # should either return a string or None, never raise.
    try:
        from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
            TimestampPreprocessor,
        )

        TimestampPreprocessor.fix_timestamp_format(fuzz_text[:50])
    except (ValueError, TypeError, AttributeError):
        pass  # These are the documented "bad input" outcomes — not crashes.

    # --- Target 2: CSV header-style column validation ---
    # Feed the fuzz text as a one-line CSV header into the column validator
    # used by the Polars fast-path preprocessor.
    try:
        from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
            PolarsFastPathPreprocessor,
        )
        from tests.polars_helpers import options as _options

        opts = _options()
        preprocessor = PolarsFastPathPreprocessor(opts)
        # is_fast_path_eligible accepts a list of column names — simulate a
        # CSV header split by comma (cheap, no actual CSV parser needed).
        columns = [c.strip() for c in fuzz_text.split(",") if c.strip()]
        if columns:
            preprocessor.is_fast_path_eligible(columns)
    except (ValueError, TypeError, AttributeError, KeyError):
        pass

    # --- Target 3: timestamp column correction on a tiny fuzzer-built frame ---
    # Build a single-row Polars dataframe whose EVENT_TIMESTAMP cell is the
    # fuzz text and run correct_timestamp_column.  Any crash here is a bug.
    try:
        import polars as pl

        from chronicle_preprocessing_app.config.constants import Column, InteractionType
        from chronicle_preprocessing_app.core.config import PreprocessingOptions
        from chronicle_preprocessing_app.core.preprocessing.timestamp_preprocessor import (
            TimestampPreprocessor,
        )

        ts_text = fuzz_text[:64].replace("\x00", "")
        raw = pl.DataFrame(
            [
                {
                    Column.EVENT_TIMESTAMP: ts_text,
                    Column.INTERACTION_TYPE: str(InteractionType.ACTIVITY_RESUMED),
                    Column.APP_PACKAGE_NAME: "com.example.fuzz",
                    Column.TIMEZONE: "America/Chicago",
                }
            ]
        )
        opts = PreprocessingOptions(raw_data_folder="", use_app_codebook=False)
        TimestampPreprocessor(opts).correct_timestamp_column(raw)
    except (ValueError, TypeError, AttributeError, pl.exceptions.PolarsError):  # type: ignore[attr-defined]
        pass


# ---------------------------------------------------------------------------
# Pytest entry point — single deterministic seed, no fuzzing loop.
# This lets  `pytest tests/fuzz/`  collect the file and run a sanity check.
# ---------------------------------------------------------------------------


def test_fuzz_csv_parsing_sanity() -> None:
    """Pytest-compatible sanity check: run the fuzz target on a fixed set of seeds."""
    seeds: list[bytes] = [
        b"",
        b"2026-03-07T10:00:00-06:00",
        b"not-a-timestamp",
        b"\x00\xff\xfe",
        b"col1,col2,col3",
        b"2026-11-01 01:30:00",  # DST ambiguous
        b"2026-03-08 02:15:00",  # DST spring-forward gap
        b"9999-99-99T99:99:99Z",
        b"a" * 512,
        b",,,,,",
    ]
    for seed in seeds:
        _run_one(seed)  # Must not raise or crash.


# ---------------------------------------------------------------------------
# libFuzzer entry point — used when executed directly as a standalone binary.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    atheris.Setup(sys.argv, _run_one)
    atheris.Fuzz()
