"""Regression: app filtering must not alter a VALID app's usage — the two-pass
interrupt leak.

The app-usage matcher runs as two passes (filtered pass, then valid pass). An
unmatched filtered foreground is retyped to "End of Usage Missing" by the
filtered pass. "End of Usage Missing" is an unmatched RESUME event — the app
came to the foreground; only its close was never seen — so it displaces whatever
was foreground and MUST interrupt other app usage. It therefore sits in the
default other_interaction_types_to_stop_usage_at.

Before it was in the stop set, an unmatched filtered foreground silently stopped
interrupting valid sessions in the following valid pass ONLY when the filter was
on. On the pathological fixture that destroyed a real valid App-Usage session
(com.google.android.youtube, ~10,190 s) whenever the filter was enabled — a
junk-package choice changing a valid app's numbers. This suite pins that
filtering is inert on valid apps.

The first test is a minimal shape check; the second is the real guard — it
reproduces the leak on the pathological fixture and is revert-verified (drop
End of Usage Missing from the stop set and the valid totals diverge).
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import polars as pl

from chronicle_preprocessing_app.config.constants import (
    Column,
    InteractionType,
    TimezoneHandlingOption,
    UsageSessionMode,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)
from chronicle_preprocessing_app.utils.file_utils import read_filter_file
from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    FixtureBuildConfig,
    build_pathological_raw_dataframe,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
FILTER_XLSX = (
    REPO_ROOT / "apps_to_filter_files/Chronicle_Android_raw_data_preprocessor_apps_to_filter.xlsx"
)

JUNK_APP = "com.junk.app"
VALID_APP = "com.valid.chat"
APP_USAGE = str(InteractionType.APP_USAGE)
END_OF_USAGE_MISSING = str(InteractionType.END_OF_USAGE_MISSING)


# --------------------------------------------------------------------------- #
# Minimal shape check
# --------------------------------------------------------------------------- #
def _raw() -> pl.DataFrame:
    rows = [
        ("Chat", "Activity Resumed", VALID_APP, "2026-03-07 10:00:00"),
        ("Junk", "Activity Resumed", JUNK_APP, "2026-03-07 10:02:00"),
    ]
    return pl.DataFrame(
        {
            Column.APPLICATION_LABEL: [r[0] for r in rows],
            Column.INTERACTION_TYPE: [r[1] for r in rows],
            Column.APP_PACKAGE_NAME: [r[2] for r in rows],
            Column.EVENT_TIMESTAMP: pl.Series([r[3] for r in rows]).str.to_datetime(
                time_zone="UTC"
            ),
        }
    )


def test_unmatched_filtered_foreground_is_labeled_end_of_usage_missing():
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        minimum_usage_duration=0,
        use_background_apps_file=False,
        background_apps_dict={},
        use_filter_file=True,
        apps_to_filter_dict={JUNK_APP: "Junk"},
    )
    pre = PolarsFastPathPreprocessor(options)
    out = pre._run_app_usage_algorithm(pre._label_filtered_apps(_raw()))

    junk = out.filter(pl.col(Column.APP_PACKAGE_NAME) == JUNK_APP)
    # Unmatched junk foreground -> End of Usage Missing (an unmatched resume),
    # blanked timing, never counted as App Usage.
    assert (junk.get_column(Column.INTERACTION_TYPE) == END_OF_USAGE_MISSING).any()
    assert (junk.get_column(Column.INTERACTION_TYPE) == APP_USAGE).sum() == 0
    assert junk.get_column(Column.DURATION_SECONDS).null_count() == junk.height


# --------------------------------------------------------------------------- #
# Real leak guard: filter on vs off on the pathological fixture
# --------------------------------------------------------------------------- #
def _run_desktop(raw_df: pl.DataFrame, raw_dir: Path, *, use_filter: bool) -> pl.DataFrame:
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / "Raw P01.csv"
    raw_df.write_csv(raw_path)
    options = PreprocessingOptions(
        study_name="leak-regression",
        raw_data_folder=raw_dir,
        use_app_codebook=False,
        use_filter_file=use_filter,
        filter_file=FILTER_XLSX,
        use_apps_forcing_screen_open_file=False,
        usage_session_mode=UsageSessionMode.APP_USAGE,
        selected_timezone="America/Chicago",
        timezone_handling_option=TimezoneHandlingOption.REMOVE_ALL_DATA_WITHOUT_SELECTED_TIMEZONE,
        datetime_of_preprocessing_override="2026-04-24 00:32:53",
        minimum_usage_duration=0,
        proximity_interval_seconds=0,
    )
    if use_filter:
        options.apps_to_filter_dict = read_filter_file(options.filter_file)
    pre = ChronicleAndroidRawDataPreprocessor(options)
    pre.options.enable_plotting = False
    pre.options.parallel_processing = False
    pre.options.parallel_max_workers = None
    out_folder, ok, _ = pre.preprocess_Chronicle_Android_raw_data_file(raw_path)
    assert ok, "desktop preprocessing produced no output"
    return pl.read_csv(out_folder / "P01 Automatically Preprocessed.csv")


def _valid_app_usage_durations(df: pl.DataFrame, filtered_pkgs: set[str]) -> list[float]:
    # Sorted per-row durations, NOT a float sum: polars' parallel sum reduces in a
    # thread-count-dependent order, so `.sum()` differs in the last ulp between
    # POLARS_MAX_THREADS settings. The multiset comparison is exact and stronger.
    valid = df.filter(
        (pl.col(Column.INTERACTION_TYPE) == APP_USAGE)
        & (~pl.col(Column.APP_PACKAGE_NAME).is_in(list(filtered_pkgs)))
    )
    if Column.DURATION_SECONDS not in valid.columns or valid.height == 0:
        return []
    return sorted(valid.get_column(Column.DURATION_SECONDS).cast(pl.Float64).to_list())


def test_filter_preserves_valid_app_usage_on_pathological_fixture():
    """A junk-package choice must not change any valid app's usage.

    Revert-verified: remove End of Usage Missing from
    DEFAULT_OTHER_INTERACTION_TYPES_TO_STOP_USAGE_AT and this fails — the filter
    destroys com.google.android.youtube's ~10,190 s session.
    """
    raw_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=2))
    filtered_pkgs = set(read_filter_file(FILTER_XLSX).keys())

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        off = _run_desktop(raw_df, root / "off", use_filter=False)
        on = _run_desktop(raw_df, root / "on", use_filter=True)

    off_durations = _valid_app_usage_durations(off, filtered_pkgs)
    on_durations = _valid_app_usage_durations(on, filtered_pkgs)

    assert sum(off_durations) > 0.0
    # Filtering junk apps leaves every valid app's usage untouched, row for row.
    assert on_durations == off_durations
