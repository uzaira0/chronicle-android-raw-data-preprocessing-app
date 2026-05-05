#!/usr/bin/env python3
"""Benchmark the browser PWA path on a generated pathological Chronicle raw fixture."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    FixtureBuildConfig,
    build_pathological_raw_dataframe,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = REPO_ROOT / "web"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", type=int, default=6)
    parser.add_argument("--mode", default="app_and_screen_usage")
    parser.add_argument("--timezone", default="America/Chicago")
    parser.add_argument("--timezone-handling", default="selected-filter")
    parser.add_argument("--datetime", default="2026-04-24 00:32:53")
    parser.add_argument("--use-filter-file", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument(
        "--use-keep-awake-file",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    parser.add_argument("--use-app-codebook", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with tempfile.TemporaryDirectory(prefix="chronicle-browser-benchmark-") as temp_dir:
        temp_root = Path(temp_dir)
        raw_csv_path = temp_root / "Raw P01.csv"
        raw_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=args.weeks))
        raw_df.write_csv(raw_csv_path)

        command = [
            "node",
            "scripts/benchmark_browser_processing.mjs",
            "--raw",
            str(raw_csv_path),
            "--mode",
            args.mode,
            "--timezone",
            args.timezone,
            "--timezone-handling",
            args.timezone_handling,
            "--datetime",
            args.datetime,
            "--output-json",
        ]

        if args.use_filter_file:
            command.extend(
                [
                    "--filter",
                    str(REPO_ROOT / "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"),
                ]
            )
        if args.use_apps_forcing_screen_open_file:
            command.extend(
                [
                    "--keep-awake",
                    str(REPO_ROOT / "apps_forcing_screen_open_files/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"),
                ]
            )
        if args.use_app_codebook:
            command.extend(
                [
                    "--codebook",
                    str(REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv"),
                ]
            )

        completed = subprocess.run(
            command,
            cwd=WEB_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)
        report["weeks"] = args.weeks
        report["raw_rows"] = raw_df.height
        report["raw_bytes"] = raw_csv_path.stat().st_size
        print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
