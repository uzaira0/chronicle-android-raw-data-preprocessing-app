#!/usr/bin/env python3
"""Run deterministic desktop-vs-browser parity on the pathological fixture."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import tempfile
from pathlib import Path

from chronicle_preprocessing_app.config.constants import TimezoneHandlingOption, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)
from chronicle_preprocessing_app.utils.file_utils import (
    read_filter_file,
    read_keep_awake_apps_file,
)
from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    FixtureBuildConfig,
    build_pathological_raw_dataframe,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = REPO_ROOT / "web"
FIXED_DATETIME = "2026-04-24 00:32:53"
RAW_FILE_NAME = "Raw P01.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", type=int, default=2)
    parser.add_argument("--datetime", default=FIXED_DATETIME)
    parser.add_argument("--report-json", type=Path)
    return parser.parse_args()


def _run_browser_processing(spec_path: Path) -> None:
    subprocess.run(
        [
            "npm",
            "exec",
            "vite-node",
            "--",
            "scripts/run_browser_processing.mts",
            str(spec_path),
        ],
        cwd=WEB_DIR,
        check=True,
    )


def _write_browser_spec(
    spec_path: Path,
    *,
    raw_csv_path: Path,
    output_dir: Path,
    options: dict,
    datetime_override: str,
    support_file_paths: dict[str, str] | None = None,
) -> None:
    spec = {
        "inputFileName": RAW_FILE_NAME,
        "rawCsvPath": str(raw_csv_path),
        "outputDir": str(output_dir),
        "options": options,
        "runtime": {"datetimeOfPreprocessing": datetime_override},
        "supportFilePaths": support_file_paths or {},
    }
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")


def _compare_csvs(desktop_csv: Path, browser_csv: Path) -> dict:
    with desktop_csv.open(newline="", encoding="utf-8") as desktop_handle:
        desktop_rows = list(csv.DictReader(desktop_handle))
    with browser_csv.open(newline="", encoding="utf-8") as browser_handle:
        browser_rows = list(csv.DictReader(browser_handle))

    if not desktop_rows or not browser_rows:
        return {
            "desktop_rows": len(desktop_rows),
            "browser_rows": len(browser_rows),
            "desktop_only_columns": [],
            "browser_only_columns": [],
            "mismatches": [{"column": "__empty__", "count": 1}],
        }

    desktop_columns = list(desktop_rows[0].keys())
    browser_columns = list(browser_rows[0].keys())
    common_columns = [column for column in desktop_columns if column in browser_columns]
    mismatches: list[dict] = []
    for column in common_columns:
        count = 0
        sample = None
        for index, (desktop_row, browser_row) in enumerate(zip(desktop_rows, browser_rows)):
            if desktop_row[column] != browser_row[column]:
                count += 1
                if sample is None:
                    sample = {
                        "row_index": index,
                        "desktop": desktop_row[column],
                        "browser": browser_row[column],
                        "interaction_type": desktop_row.get("interaction_type"),
                        "app_package_name": desktop_row.get("app_package_name"),
                    }
        if count:
            mismatches.append({"column": column, "count": count, "sample": sample})

    return {
        "desktop_rows": len(desktop_rows),
        "browser_rows": len(browser_rows),
        "desktop_only_columns": [column for column in desktop_columns if column not in browser_columns],
        "browser_only_columns": [column for column in browser_columns if column not in desktop_columns],
        "mismatches": mismatches,
    }


def _build_options(
    *,
    raw_data_folder: Path,
    use_app_codebook: bool,
    use_filter_file: bool,
    use_keep_awake_apps_file: bool,
    usage_session_mode: UsageSessionMode,
    datetime_override: str,
) -> PreprocessingOptions:
    options = PreprocessingOptions(
        study_name="Deterministic Parity",
        raw_data_folder=raw_data_folder,
        use_app_codebook=use_app_codebook,
        app_codebook_path=REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv",
        use_filter_file=use_filter_file,
        filter_file=REPO_ROOT
        / "apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx",
        use_keep_awake_apps_file=use_keep_awake_apps_file,
        keep_awake_apps_file=REPO_ROOT
        / "screen_awake_app_files/Chronicle_Android_raw_data_preprocessor_keep_awake_apps.csv",
        usage_session_mode=usage_session_mode,
        selected_timezone="America/Chicago",
        timezone_handling_option=TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE,
        datetime_of_preprocessing_override=datetime_override,
    )
    if options.use_filter_file:
        options.apps_to_filter_dict = read_filter_file(options.filter_file)
    if options.use_keep_awake_apps_file:
        options.keep_awake_apps_dict = read_keep_awake_apps_file(options.keep_awake_apps_file)
    return options


def _run_desktop(raw_csv_path: Path, options: PreprocessingOptions, output_root: Path) -> tuple[Path, Path | None]:
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    preprocessor.options.study_name = output_root.name
    preprocessor.options.raw_data_folder = raw_csv_path.parent
    preprocessor.options.enable_plotting = False
    preprocessor.options.parallel_processing = False
    preprocessor.options.parallel_max_workers = None
    preprocessor.options.datetime_of_preprocessing_override = options.datetime_of_preprocessing_override
    preprocessor.options.use_filter_file = options.use_filter_file
    preprocessor.options.use_keep_awake_apps_file = options.use_keep_awake_apps_file
    preprocessor.options.use_app_codebook = options.use_app_codebook
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_csv_path)
    if not success:
        raise RuntimeError(f"Desktop preprocessing produced no output for {raw_csv_path}")
    app_csv = output_folder / "P01 Automatically Preprocessed.csv"
    screen_csv = output_folder / "P01 Screen Usage Automatically Preprocessed.csv"
    return app_csv, screen_csv if screen_csv.exists() else None


def main() -> int:
    args = parse_args()
    report: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="chronicle-web-parity-") as temp_dir:
        temp_root = Path(temp_dir)
        raw_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=args.weeks))

        desktop_full_root = temp_root / "desktop_full"
        desktop_full_raw_dir = desktop_full_root / "raw"
        desktop_full_raw_dir.mkdir(parents=True)
        desktop_full_raw_path = desktop_full_raw_dir / RAW_FILE_NAME
        raw_df.write_csv(desktop_full_raw_path)

        full_options = _build_options(
            raw_data_folder=desktop_full_raw_dir,
            use_app_codebook=True,
            use_filter_file=True,
            use_keep_awake_apps_file=True,
            usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
            datetime_override=args.datetime,
        )
        desktop_full_app, desktop_full_screen = _run_desktop(
            desktop_full_raw_path,
            full_options,
            desktop_full_root,
        )

        desktop_core_root = temp_root / "desktop_core"
        desktop_core_raw_dir = desktop_core_root / "raw"
        desktop_core_raw_dir.mkdir(parents=True)
        desktop_core_raw_path = desktop_core_raw_dir / RAW_FILE_NAME
        raw_df.write_csv(desktop_core_raw_path)
        core_options = _build_options(
            raw_data_folder=desktop_core_raw_dir,
            use_app_codebook=False,
            use_filter_file=False,
            use_keep_awake_apps_file=False,
            usage_session_mode=UsageSessionMode.APP_USAGE,
            datetime_override=args.datetime,
        )
        desktop_core_app, _ = _run_desktop(desktop_core_raw_path, core_options, desktop_core_root)

        browser_full_output_dir = temp_root / "browser_full"
        browser_core_output_dir = temp_root / "browser_core"
        browser_full_output_dir.mkdir()
        browser_core_output_dir.mkdir()
        browser_raw_path = temp_root / "browser_raw.csv"
        raw_df.write_csv(browser_raw_path)

        full_spec_path = temp_root / "browser_full_spec.json"
        _write_browser_spec(
            full_spec_path,
            raw_csv_path=browser_raw_path,
            output_dir=browser_full_output_dir,
            options={
                "studyName": "Deterministic Parity",
                "usageSessionMode": "app_and_screen_usage",
                "selectedTimezone": "America/Chicago",
                "timezoneHandling": "selected-filter",
                "useFilterFile": True,
                "useKeepAwakeAppsFile": True,
                "useAppCodebook": True,
            },
            datetime_override=args.datetime,
            support_file_paths={
                "filterFile": str(
                    REPO_ROOT
                    / "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"
                ),
                "keepAwakeAppsFile": str(
                    REPO_ROOT
                    / "screen_awake_app_files/Chronicle_Android_raw_data_preprocessor_keep_awake_apps.csv"
                ),
                "appCodebookFile": str(
                    REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv"
                ),
            },
        )
        _run_browser_processing(full_spec_path)

        core_spec_path = temp_root / "browser_core_spec.json"
        _write_browser_spec(
            core_spec_path,
            raw_csv_path=browser_raw_path,
            output_dir=browser_core_output_dir,
            options={
                "studyName": "Deterministic Parity",
                "usageSessionMode": "app_usage",
                "selectedTimezone": "America/Chicago",
                "timezoneHandling": "selected-filter",
                "useFilterFile": False,
                "useKeepAwakeAppsFile": False,
                "useAppCodebook": False,
            },
            datetime_override=args.datetime,
        )
        _run_browser_processing(core_spec_path)

        report["full_app"] = _compare_csvs(
            desktop_full_app,
            browser_full_output_dir / "Raw P01 Automatically Preprocessed.csv",
        )
        if desktop_full_screen is None:
            raise RuntimeError("Desktop full-feature run did not produce a screen output")
        report["full_screen"] = _compare_csvs(
            desktop_full_screen,
            browser_full_output_dir / "Raw P01 Screen Usage Automatically Preprocessed.csv",
        )
        report["core_app"] = _compare_csvs(
            desktop_core_app,
            browser_core_output_dir / "Raw P01 Automatically Preprocessed.csv",
        )

        if args.report_json:
            args.report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

        print(json.dumps(report, indent=2))

        has_failures = any(
            section["desktop_rows"] != section["browser_rows"]
            or section["desktop_only_columns"]
            or section["browser_only_columns"]
            or section["mismatches"]
            for section in report.values()
        )
        return 1 if has_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
