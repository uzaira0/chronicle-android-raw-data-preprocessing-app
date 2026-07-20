#!/usr/bin/env python3
"""Real-corpus soak: run every real participant raw file through BOTH engines
and byte-compare the outputs.

The deterministic parity harness proves engine equivalence on the pathological
fixture; this soak proves it on the entire real study corpus (every TECH +
GNSM personal-Android participant), where rare real-world inputs live
(vocabulary variants like "Screen Non-interactive", real DST crossings,
device-clock artifacts, real duplicate patterns).

Inputs are per-participant raw CSVs reconstructed from the research-pipeline
warehouse (see the corpus root's export_corpus_raw.py). Both engines read the
IDENTICAL file with the parity-pinned knobs (_desktop_options.py), so any
output difference is an engine divergence, not an input artifact.

Usage:
  PYTHONPATH=src .venv/bin/python scripts/run_corpus_soak.py \
      --corpus-root /home/opt/rp_work/corpus_soak/raw \
      --out /home/opt/rp_work/corpus_soak/results [--limit N] [--study tech]

Writes per-participant JSON verdicts + a summary; the tracked report lives at
docs/validation/CORPUS_SOAK.md (regenerate with --write-report).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from _desktop_options import build_pinned_options  # noqa: E402
from run_deterministic_web_parity import _compare_csvs  # noqa: E402

from chronicle_preprocessing_app.config.constants import UsageSessionMode  # noqa: E402
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (  # noqa: E402
    ChronicleAndroidRawDataPreprocessor,
)

REPO_ROOT = SCRIPTS_DIR.parent
WEB_DIR = REPO_ROOT / "web"
FIXED_DATETIME = "2026-04-24 00:32:53"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-root", type=Path, default=Path("/home/opt/rp_work/corpus_soak/raw"))
    parser.add_argument("--out", type=Path, default=Path("/home/opt/rp_work/corpus_soak/results"))
    parser.add_argument("--study", action="append", help="tech/gnsm; default both")
    parser.add_argument("--limit", type=int, help="only the first N participants per study")
    parser.add_argument("--write-report", type=Path, help="write markdown report to this path")
    return parser.parse_args()


def run_desktop(raw_path: Path, work_root: Path) -> tuple[Path, Path | None]:
    raw_dir = work_root / "desktop" / "raw"
    raw_dir.mkdir(parents=True)
    staged = raw_dir / raw_path.name
    shutil.copyfile(raw_path, staged)
    options = build_pinned_options(
        study_name="Corpus Soak",
        raw_data_folder=raw_dir,
        use_app_codebook=True,
        use_filter_file=True,
        use_apps_forcing_screen_open_file=True,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
        datetime_override=FIXED_DATETIME,
    )
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    preprocessor.options.enable_plotting = False
    preprocessor.options.parallel_processing = False
    preprocessor.options.parallel_max_workers = None
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(staged)
    if not success:
        raise RuntimeError(f"desktop produced no output for {raw_path.name}")
    stem = raw_path.stem
    label = stem[4:] if stem.startswith("Raw ") else stem
    app_csv = output_folder / f"{label} Automatically Preprocessed.csv"
    screen_csv = output_folder / f"{label} Screen Usage Automatically Preprocessed.csv"
    return app_csv, screen_csv if screen_csv.exists() else None


def run_browser(raw_path: Path, work_root: Path) -> tuple[Path, Path]:
    out_dir = work_root / "browser"
    out_dir.mkdir(parents=True)
    spec = {
        "inputFileName": raw_path.name,
        "rawCsvPath": str(raw_path),
        "outputDir": str(out_dir),
        "options": {
            "studyName": "Corpus Soak",
            "minimumUsageDuration": 0,
            "proximityIntervalSeconds": 0,
            "processAppUsage": True,
            "processScreenUsage": True,
            "enablePlotting": False,
            "parallelProcessing": False,
            "selectedTimezone": "America/Chicago",
            "timezoneHandling": "selected-filter",
            "useFilterFile": True,
            "useAppsForcingScreenOpenFile": True,
            "useAppCodebook": True,
        },
        "runtime": {"datetimeOfPreprocessing": FIXED_DATETIME},
        "supportFilePaths": {
            "filterFile": str(
                REPO_ROOT
                / "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"
            ),
            "appsForcingScreenOpenFile": str(
                REPO_ROOT
                / "apps_forcing_screen_open_files/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"
            ),
            "appCodebookFile": str(
                REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv"
            ),
        },
    }
    spec_path = work_root / "browser_spec.json"
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    subprocess.run(
        ["npm", "exec", "vite-node", "--", "scripts/run_browser_processing.mts", str(spec_path)],
        cwd=WEB_DIR,
        check=True,
        capture_output=True,
    )
    stem = raw_path.stem
    return (
        out_dir / f"{stem} Automatically Preprocessed.csv",
        out_dir / f"{stem} Screen Usage Automatically Preprocessed.csv",
    )


def section_clean(section: dict) -> bool:
    return (
        section["desktop_rows"] == section["browser_rows"]
        and not section["desktop_only_columns"]
        and not section["browser_only_columns"]
        and not section["mismatches"]
    )


def soak_one(raw_path: Path, out_dir: Path) -> dict:
    verdict: dict = {"file": raw_path.name, "status": "clean"}
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="corpus-soak-") as temp_dir:
        work_root = Path(temp_dir)
        try:
            desktop_app, desktop_screen = run_desktop(raw_path, work_root)
            browser_app, browser_screen = run_browser(raw_path, work_root)
        except Exception as error:  # noqa: BLE001 — soak must record, not abort
            verdict["status"] = "engine_error"
            verdict["error"] = f"{type(error).__name__}: {error}"
            verdict["seconds"] = round(time.monotonic() - started, 1)
            return verdict

        verdict["app"] = _compare_csvs(desktop_app, browser_app)
        if desktop_screen is not None and browser_screen.exists():
            verdict["screen"] = _compare_csvs(desktop_screen, browser_screen)
        elif desktop_screen is None and not browser_screen.exists():
            verdict["screen"] = None  # both surfaces agree: no screen output
        else:
            verdict["status"] = "mismatch"
            verdict["screen"] = {
                "error": "screen output present on one surface only",
                "desktop": desktop_screen is not None,
                "browser": browser_screen.exists(),
            }
    if verdict["status"] == "clean":
        sections = [verdict["app"]] + ([verdict["screen"]] if verdict.get("screen") else [])
        if not all(section_clean(section) for section in sections):
            verdict["status"] = "mismatch"
    verdict["seconds"] = round(time.monotonic() - started, 1)
    return verdict


def main() -> int:
    args = parse_args()
    studies = args.study or ["tech", "gnsm"]
    args.out.mkdir(parents=True, exist_ok=True)
    summary: dict[str, dict] = {}
    dirty = 0
    for study in studies:
        study_dir = args.corpus_root / study
        raw_files = sorted(study_dir.glob("Raw *.csv"))
        if args.limit:
            raw_files = raw_files[: args.limit]
        results = []
        for index, raw_path in enumerate(raw_files, 1):
            verdict = soak_one(raw_path, args.out)
            results.append(verdict)
            (args.out / f"{study}__{raw_path.stem}.json").write_text(
                json.dumps(verdict, indent=2), encoding="utf-8"
            )
            marker = "OK " if verdict["status"] == "clean" else "!! "
            print(f"[{study} {index}/{len(raw_files)}] {marker}{raw_path.name} "
                  f"({verdict['seconds']}s, {verdict['status']})", flush=True)
            if verdict["status"] != "clean":
                dirty += 1
        summary[study] = {
            "total": len(results),
            "clean": sum(1 for r in results if r["status"] == "clean"),
            "mismatch": sum(1 for r in results if r["status"] == "mismatch"),
            "engine_error": sum(1 for r in results if r["status"] == "engine_error"),
        }
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 1 if dirty else 0


if __name__ == "__main__":
    sys.exit(main())
