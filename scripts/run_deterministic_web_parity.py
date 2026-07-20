#!/usr/bin/env python3
"""Run deterministic desktop-vs-browser parity on the pathological fixture."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import tempfile
from pathlib import Path

from chronicle_preprocessing_app.config.constants import UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
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
    parser.add_argument(
        "--model-concurrent-usage",
        action="store_true",
        default=False,
        help="Enable concurrent (PiP) usage modeling for the flag-on parity entry.",
    )
    parser.add_argument(
        "--background-apps",
        action="store_true",
        default=False,
        help="Enable the background-apps file for a cross-surface parity entry.",
    )
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


# Shared with scripts/run_desktop_processing.py — the parity pins live in
# scripts/_desktop_options.py (single source of truth for knob values).
from _desktop_options import BACKGROUND_APPS_FILE, build_pinned_options


def _build_options(
    *,
    raw_data_folder: Path,
    use_app_codebook: bool,
    use_filter_file: bool,
    use_apps_forcing_screen_open_file: bool,
    usage_session_mode: UsageSessionMode,
    datetime_override: str,
    model_concurrent_usage: bool = False,
    use_background_apps_file: bool = False,
    include_category_column: bool = False,
) -> PreprocessingOptions:
    return build_pinned_options(
        study_name="Deterministic Parity",
        raw_data_folder=raw_data_folder,
        use_app_codebook=use_app_codebook,
        use_filter_file=use_filter_file,
        use_apps_forcing_screen_open_file=use_apps_forcing_screen_open_file,
        usage_session_mode=usage_session_mode,
        datetime_override=datetime_override,
        model_concurrent_usage=model_concurrent_usage,
        use_background_apps_file=use_background_apps_file,
        include_category_column=include_category_column,
    )


def _run_desktop(raw_csv_path: Path, options: PreprocessingOptions, output_root: Path) -> tuple[Path, Path | None]:
    del output_root  # output_folder is derived from raw_data_folder.parent
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    preprocessor.options.raw_data_folder = raw_csv_path.parent
    preprocessor.options.enable_plotting = False
    preprocessor.options.parallel_processing = False
    preprocessor.options.parallel_max_workers = None
    preprocessor.options.datetime_of_preprocessing_override = options.datetime_of_preprocessing_override
    preprocessor.options.use_filter_file = options.use_filter_file
    preprocessor.options.use_apps_forcing_screen_open_file = options.use_apps_forcing_screen_open_file
    preprocessor.options.use_app_codebook = options.use_app_codebook
    preprocessor.options.include_category_column = options.include_category_column
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
            use_apps_forcing_screen_open_file=True,
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
            use_apps_forcing_screen_open_file=False,
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
                "minimumUsageDuration": 0,
                "proximityIntervalSeconds": 0,
                "processAppUsage": True,
                "processScreenUsage": True,
                # Parity compares CSV outputs only; plotting renders a canvas
                # (no DOM under vite-node) and the desktop side also disables it.
                "enablePlotting": False,
                "parallelProcessing": False,
                "selectedTimezone": "America/Chicago",
                "timezoneHandling": "selected-filter",
                "useFilterFile": True,
                "useAppsForcingScreenOpenFile": True,
                "useAppCodebook": True,
            },
            datetime_override=args.datetime,
            support_file_paths={
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
        )
        _run_browser_processing(full_spec_path)

        core_spec_path = temp_root / "browser_core_spec.json"
        _write_browser_spec(
            core_spec_path,
            raw_csv_path=browser_raw_path,
            output_dir=browser_core_output_dir,
            options={
                "studyName": "Deterministic Parity",
                "minimumUsageDuration": 0,
                "proximityIntervalSeconds": 0,
                "processAppUsage": True,
                "processScreenUsage": False,
                "enablePlotting": False,
                "parallelProcessing": False,
                "selectedTimezone": "America/Chicago",
                "timezoneHandling": "selected-filter",
                "useFilterFile": False,
                "useAppsForcingScreenOpenFile": False,
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

        # Category-column scenario (#10): codebook on + include_category_column on,
        # so the normalized broad_app_category column is emitted on both surfaces.
        # The fixture's codebook carries babyemu UPPERCASE values (GAMING, …), so
        # this exercises the normalization that must match byte-for-byte.
        desktop_category_root = temp_root / "desktop_category"
        desktop_category_raw_dir = desktop_category_root / "raw"
        desktop_category_raw_dir.mkdir(parents=True)
        desktop_category_raw_path = desktop_category_raw_dir / RAW_FILE_NAME
        raw_df.write_csv(desktop_category_raw_path)
        category_options = _build_options(
            raw_data_folder=desktop_category_raw_dir,
            use_app_codebook=True,
            use_filter_file=False,
            use_apps_forcing_screen_open_file=False,
            usage_session_mode=UsageSessionMode.APP_USAGE,
            datetime_override=args.datetime,
            include_category_column=True,
        )
        desktop_category_app, _ = _run_desktop(
            desktop_category_raw_path, category_options, desktop_category_root
        )

        browser_category_output_dir = temp_root / "browser_category"
        browser_category_output_dir.mkdir()
        category_spec_path = temp_root / "browser_category_spec.json"
        _write_browser_spec(
            category_spec_path,
            raw_csv_path=browser_raw_path,
            output_dir=browser_category_output_dir,
            options={
                "studyName": "Deterministic Parity",
                "minimumUsageDuration": 0,
                "proximityIntervalSeconds": 0,
                "processAppUsage": True,
                "processScreenUsage": False,
                "enablePlotting": False,
                "parallelProcessing": False,
                "selectedTimezone": "America/Chicago",
                "timezoneHandling": "selected-filter",
                "useFilterFile": False,
                "useAppsForcingScreenOpenFile": False,
                "useAppCodebook": True,
                "includeCategoryColumn": True,
            },
            datetime_override=args.datetime,
            support_file_paths={
                "appCodebookFile": str(
                    REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv"
                ),
            },
        )
        _run_browser_processing(category_spec_path)
        report["category_app"] = _compare_csvs(
            desktop_category_app,
            browser_category_output_dir / "Raw P01 Automatically Preprocessed.csv",
        )

        if args.model_concurrent_usage:
            desktop_pip_root = temp_root / "desktop_pip"
            desktop_pip_raw_dir = desktop_pip_root / "raw"
            desktop_pip_raw_dir.mkdir(parents=True)
            desktop_pip_raw_path = desktop_pip_raw_dir / RAW_FILE_NAME
            raw_df.write_csv(desktop_pip_raw_path)
            pip_options = _build_options(
                raw_data_folder=desktop_pip_raw_dir,
                use_app_codebook=False,
                use_filter_file=False,
                use_apps_forcing_screen_open_file=False,
                usage_session_mode=UsageSessionMode.APP_USAGE,
                datetime_override=args.datetime,
                model_concurrent_usage=True,
            )
            desktop_pip_app, _ = _run_desktop(desktop_pip_raw_path, pip_options, desktop_pip_root)

            browser_pip_output_dir = temp_root / "browser_pip"
            browser_pip_output_dir.mkdir()
            pip_spec_path = temp_root / "browser_pip_spec.json"
            _write_browser_spec(
                pip_spec_path,
                raw_csv_path=browser_raw_path,
                output_dir=browser_pip_output_dir,
                options={
                    "studyName": "Deterministic Parity",
                    "minimumUsageDuration": 0,
                    "proximityIntervalSeconds": 0,
                    "processAppUsage": True,
                    "processScreenUsage": False,
                    "enablePlotting": False,
                    "selectedTimezone": "America/Chicago",
                    "timezoneHandling": "selected-filter",
                    "useFilterFile": False,
                    "useAppsForcingScreenOpenFile": False,
                    "useAppCodebook": False,
                    "modelConcurrentUsage": True,
                },
                datetime_override=args.datetime,
            )
            _run_browser_processing(pip_spec_path)
            report["pip_app"] = _compare_csvs(
                desktop_pip_app,
                browser_pip_output_dir / "Raw P01 Automatically Preprocessed.csv",
            )

        if args.background_apps:
            desktop_bg_root = temp_root / "desktop_background"
            desktop_bg_raw_dir = desktop_bg_root / "raw"
            desktop_bg_raw_dir.mkdir(parents=True)
            desktop_bg_raw_path = desktop_bg_raw_dir / RAW_FILE_NAME
            raw_df.write_csv(desktop_bg_raw_path)
            bg_options = _build_options(
                raw_data_folder=desktop_bg_raw_dir,
                use_app_codebook=False,
                use_filter_file=False,
                use_apps_forcing_screen_open_file=False,
                usage_session_mode=UsageSessionMode.APP_USAGE,
                datetime_override=args.datetime,
                use_background_apps_file=True,
            )
            desktop_bg_app, _ = _run_desktop(desktop_bg_raw_path, bg_options, desktop_bg_root)

            browser_bg_output_dir = temp_root / "browser_background"
            browser_bg_output_dir.mkdir()
            bg_spec_path = temp_root / "browser_background_spec.json"
            _write_browser_spec(
                bg_spec_path,
                raw_csv_path=browser_raw_path,
                output_dir=browser_bg_output_dir,
                options={
                    "studyName": "Deterministic Parity",
                    "minimumUsageDuration": 0,
                    "proximityIntervalSeconds": 0,
                    "processAppUsage": True,
                    "processScreenUsage": False,
                    "enablePlotting": False,
                    "parallelProcessing": False,
                    "selectedTimezone": "America/Chicago",
                    "timezoneHandling": "selected-filter",
                    "useFilterFile": False,
                    "useAppsForcingScreenOpenFile": False,
                    "useAppCodebook": False,
                    "useBackgroundAppsFile": True,
                },
                datetime_override=args.datetime,
                support_file_paths={"backgroundAppsFile": str(BACKGROUND_APPS_FILE)},
            )
            _run_browser_processing(bg_spec_path)
            report["background_app"] = _compare_csvs(
                desktop_bg_app,
                browser_bg_output_dir / "Raw P01 Automatically Preprocessed.csv",
            )

            # Construct-and-mark cross-surface entry: filter AND background
            # lists active together. The fixture carries com.spotify.music on
            # both lists (label match -> Filtered App Background Usage with
            # real timing) and com.google.android.apps.maps on the background
            # list with a fixture label the filter list does not know
            # ("Google Maps" vs "Maps" -> stays a normal background App Usage).
            desktop_fbg_root = temp_root / "desktop_filter_background"
            desktop_fbg_raw_dir = desktop_fbg_root / "raw"
            desktop_fbg_raw_dir.mkdir(parents=True)
            desktop_fbg_raw_path = desktop_fbg_raw_dir / RAW_FILE_NAME
            raw_df.write_csv(desktop_fbg_raw_path)
            fbg_options = _build_options(
                raw_data_folder=desktop_fbg_raw_dir,
                use_app_codebook=False,
                use_filter_file=True,
                use_apps_forcing_screen_open_file=False,
                usage_session_mode=UsageSessionMode.APP_USAGE,
                datetime_override=args.datetime,
                use_background_apps_file=True,
            )
            desktop_fbg_app, _ = _run_desktop(
                desktop_fbg_raw_path,
                fbg_options,
                desktop_fbg_root,
            )

            browser_fbg_output_dir = temp_root / "browser_filter_background"
            browser_fbg_output_dir.mkdir()
            fbg_spec_path = temp_root / "browser_filter_background_spec.json"
            _write_browser_spec(
                fbg_spec_path,
                raw_csv_path=browser_raw_path,
                output_dir=browser_fbg_output_dir,
                options={
                    "studyName": "Deterministic Parity",
                    "minimumUsageDuration": 0,
                    "proximityIntervalSeconds": 0,
                    "processAppUsage": True,
                    "processScreenUsage": False,
                    "enablePlotting": False,
                    "parallelProcessing": False,
                    "selectedTimezone": "America/Chicago",
                    "timezoneHandling": "selected-filter",
                    "useFilterFile": True,
                    "useAppsForcingScreenOpenFile": False,
                    "useAppCodebook": False,
                    "useBackgroundAppsFile": True,
                },
                datetime_override=args.datetime,
                support_file_paths={
                    "backgroundAppsFile": str(BACKGROUND_APPS_FILE),
                    "filterFile": str(
                        REPO_ROOT
                        / "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"
                    ),
                },
            )
            _run_browser_processing(fbg_spec_path)
            report["filter_background_construct_and_mark"] = _compare_csvs(
                desktop_fbg_app,
                browser_fbg_output_dir / "Raw P01 Automatically Preprocessed.csv",
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
