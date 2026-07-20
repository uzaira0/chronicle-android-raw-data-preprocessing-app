"""Shared, parity-pinned PreprocessingOptions builder for desktop-engine CLIs.

Single source of truth for the knob values that
scripts/run_deterministic_web_parity.py and scripts/run_desktop_processing.py
must share: the A/B timing harness advertises "identical knob values (the
parity pins)", and two hand-maintained copies had already begun to drift in
shape. Keep the 0/0 duration/proximity pins and the
REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE handling verbatim — the parity
harness's byte-identical comparison depends on them.
"""

from __future__ import annotations

from pathlib import Path

from chronicle_preprocessing_app.config.constants import TimezoneHandlingOption, UsageSessionMode
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.utils.file_utils import (
    read_apps_forcing_screen_open_file,
    read_background_apps_file,
    read_filter_file,
)

REPO_ROOT = Path(__file__).resolve().parents[1]

BACKGROUND_APPS_FILE = (
    REPO_ROOT
    / "background_apps_files/Chronicle_Android_raw_data_preprocessor_background_apps.csv"
)


def build_pinned_options(
    *,
    study_name: str,
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
    options = PreprocessingOptions(
        study_name=study_name,
        raw_data_folder=raw_data_folder,
        use_app_codebook=use_app_codebook,
        include_category_column=include_category_column,
        app_codebook_path=REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv",
        use_filter_file=use_filter_file,
        filter_file=REPO_ROOT
        / "apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx",
        use_apps_forcing_screen_open_file=use_apps_forcing_screen_open_file,
        apps_forcing_screen_open_file=REPO_ROOT
        / "apps_forcing_screen_open_files/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv",
        use_background_apps_file=use_background_apps_file,
        background_apps_file=BACKGROUND_APPS_FILE,
        usage_session_mode=usage_session_mode,
        selected_timezone="America/Chicago",
        timezone_handling_option=TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE,
        datetime_of_preprocessing_override=datetime_override,
        model_concurrent_usage=model_concurrent_usage,
        # Parity compares the ENGINES under identical knob values. The web app
        # ships preprocessing-locked defaults (minimum_usage_duration 60,
        # proximity 2.0) while the desktop defaults are 0/0 — relying on
        # defaults silently diverged the surfaces, so pin both sides here
        # (browser specs pin the same values) and keep the 0-proximity WASM ↔
        # Rust matcher comparison this harness was built for.
        minimum_usage_duration=0,
        proximity_interval_seconds=0,
    )
    if options.use_filter_file:
        options.apps_to_filter_dict = read_filter_file(options.filter_file)
    if options.use_apps_forcing_screen_open_file:
        options.apps_forcing_screen_open_dict = read_apps_forcing_screen_open_file(
            options.apps_forcing_screen_open_file,
        )
    if options.use_background_apps_file:
        options.background_apps_dict = read_background_apps_file(options.background_apps_file)
    return options
