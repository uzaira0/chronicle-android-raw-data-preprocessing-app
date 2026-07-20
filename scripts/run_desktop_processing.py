#!/usr/bin/env python3
"""Run the DESKTOP engine once on a single raw Chronicle CSV.

Standalone command wrapper around ChronicleAndroidRawDataPreprocessor so the
desktop hot path can be timed by hyperfine and profiled by cProfile (see
scripts/run_profile_baseline.py / `make profile`). Options come from the same
`scripts/_desktop_options.py` builder the parity harness uses — the exact knob
values the browser spec pins — so A/B timings compare the engines, not the
configs.

Usage:
    PYTHONPATH=src python scripts/run_desktop_processing.py \
        --raw /path/to/"Raw P01.csv" [--workdir /tmp/dir] [--datetime "..."]

The raw file is copied into <workdir>/raw/ (the preprocessor derives its
output folder from the raw folder's parent), outputs land in <workdir>.
"""

from __future__ import annotations

import argparse
import contextlib
import shutil
import sys
import tempfile
from pathlib import Path

from chronicle_preprocessing_app.config.constants import UsageSessionMode
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)

from _desktop_options import build_pinned_options

FIXED_DATETIME = "2026-04-24 00:32:53"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True, help="Raw Chronicle CSV to process")
    parser.add_argument(
        "--workdir",
        type=Path,
        default=None,
        help="Working directory for the raw copy + outputs (default: fresh temp dir)",
    )
    parser.add_argument("--datetime", default=FIXED_DATETIME)
    args = parser.parse_args()

    # ExitStack owns the fallback temp dir so failure paths (bad raw file,
    # engine error, exceptions) clean it up too — not just the success path.
    with contextlib.ExitStack() as stack:
        workdir = args.workdir
        if workdir is None:
            workdir = Path(
                stack.enter_context(tempfile.TemporaryDirectory(prefix="chronicle-desktop-run-")),
            )
        raw_dir = workdir / "raw"
        if raw_dir.exists():
            shutil.rmtree(raw_dir)
        raw_dir.mkdir(parents=True)
        raw_copy = raw_dir / args.raw.name
        shutil.copyfile(args.raw, raw_copy)

        options = build_pinned_options(
            study_name="Profile Baseline",
            raw_data_folder=raw_dir,
            use_app_codebook=True,
            use_filter_file=True,
            use_apps_forcing_screen_open_file=True,
            usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
            datetime_override=args.datetime,
        )

        preprocessor = ChronicleAndroidRawDataPreprocessor(options)
        preprocessor.options.enable_plotting = False
        preprocessor.options.parallel_processing = False
        preprocessor.options.parallel_max_workers = None
        output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_copy)
        if not success:
            print(f"desktop run FAILED for {raw_copy}", file=sys.stderr)
            return 1
        print(f"desktop run ok: {output_folder}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
