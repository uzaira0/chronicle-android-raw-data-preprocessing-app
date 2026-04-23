from __future__ import annotations

import os
import subprocess
import sys
from importlib.util import find_spec
from pathlib import Path

import pandas as pd
import pytest

from chronicle_preprocessing_app.config.constants import Column, InteractionType


pytestmark = pytest.mark.skipif(
    find_spec("polars") is None,
    reason="Polars is required for fast-path parity tests",
)


def test_polars_fast_path_matches_legacy_pandas_output(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    raw_file = raw_dir / "Raw_fixture.csv"

    df = pd.DataFrame(
        [
            {
                Column.STUDY_ID: "Study",
                Column.PARTICIPANT_ID: "P1-1234-A",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
                Column.APP_PACKAGE_NAME: "com.example.one",
                Column.APPLICATION_LABEL: "Example One",
                Column.INTERACTION_TYPE: InteractionType.ACTIVITY_RESUMED,
                Column.EVENT_TIMESTAMP: "2026-03-08T01:59:58-06:00",
            },
            {
                Column.STUDY_ID: "Study",
                Column.PARTICIPANT_ID: "P1-1234-A",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
                Column.APP_PACKAGE_NAME: "com.example.one",
                Column.APPLICATION_LABEL: "Example One",
                Column.INTERACTION_TYPE: InteractionType.ACTIVITY_PAUSED,
                Column.EVENT_TIMESTAMP: "2026-03-08T02:00:01-06:00",
            },
            {
                Column.STUDY_ID: "Study",
                Column.PARTICIPANT_ID: "P1-1234-A",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
                Column.APP_PACKAGE_NAME: "com.example.two",
                Column.APPLICATION_LABEL: "Example Two",
                Column.INTERACTION_TYPE: InteractionType.ACTIVITY_RESUMED,
                Column.EVENT_TIMESTAMP: "2026-03-08T03:00:00-05:00",
            },
            {
                Column.STUDY_ID: "Study",
                Column.PARTICIPANT_ID: "P1-1234-A",
                Column.USERNAME: "Target Child",
                Column.TIMEZONE: "America/Chicago",
                Column.APP_PACKAGE_NAME: "com.example.two",
                Column.APPLICATION_LABEL: "Example Two",
                Column.INTERACTION_TYPE: InteractionType.ACTIVITY_PAUSED,
                Column.EVENT_TIMESTAMP: "2026-03-08T03:00:05-05:00",
            },
        ]
    )
    df.to_csv(raw_file, index=False)

    script = Path(__file__).resolve().parents[1] / ".tmp_benchmarks" / "bench_folder_preprocessing.py"

    def run_case(study_name: str, *, use_polars: bool, fast_path: bool) -> Path:
        env = os.environ.copy()
        env["PYTHONPATH"] = "src"
        env["CHRONICLE_USE_POLARS"] = "true" if use_polars else "false"
        env["CHRONICLE_USE_POLARS_FAST_PATH"] = "true" if fast_path else "false"
        env["CHRONICLE_USE_RUST_APP_MATCHER"] = "false"
        subprocess.run(
            [
                sys.executable,
                str(script),
                str(raw_dir),
                "--workers",
                "1",
                "--study-name",
                study_name,
                "--clean-output",
            ],
            cwd=Path(__file__).resolve().parents[1],
            env=env,
            check=True,
        )
        return tmp_path / f"{study_name} Chronicle Android Automatically Preprocessed Data"

    pandas_out = run_case("PandasParity", use_polars=False, fast_path=False)
    fast_out = run_case("PolarsFastParity", use_polars=True, fast_path=True)

    pandas_csv = next(pandas_out.glob("*.csv"))
    fast_csv = next(fast_out.glob("*.csv"))
    pandas_df = pd.read_csv(pandas_csv, dtype=str).drop(
        columns=["datetime_of_preprocessing"], errors="ignore"
    )
    fast_df = pd.read_csv(fast_csv, dtype=str).drop(
        columns=["datetime_of_preprocessing"], errors="ignore"
    )

    pd.testing.assert_frame_equal(pandas_df, fast_df)
