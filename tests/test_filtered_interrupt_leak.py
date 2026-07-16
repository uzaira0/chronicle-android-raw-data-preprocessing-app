"""Regression: an UNMATCHED filtered foreground must still interrupt valid
sessions.

The app-usage matcher runs as two passes (filtered pass, then valid pass). A
filtered app foregrounding still ends a valid app's session — the filtered
usage types sit in the default other_interaction_types_to_stop_usage_at so the
interrupt lands at the same timestamp a raw Activity Resumed would. But if the
filtered foreground never MATCHES (no close), it must NOT be dropped to
"End of Usage Missing" (which is not an other-stop): doing so silently removes
the interrupt only when the filter is on, so filtering a junk app changes a
VALID app's duration. Keeping the unmatched filtered foreground as an
interrupt-carrying "Filtered App Usage" marker (timing blanked) holds valid-app
inertness.

Mirrors web filterLabelInertness.test.ts ("an UNMATCHED junk foreground still
interrupts a valid session identically").
"""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

JUNK_APP = "com.junk.app"
VALID_APP = "com.valid.chat"
APP_USAGE = str(InteractionType.APP_USAGE)
FILTERED_APP_USAGE = str(InteractionType.FILTERED_APP_USAGE)


def _raw() -> pl.DataFrame:
    # The junk app foregrounds during Chat's session and is the ONLY event that
    # can end it (Chat never gets its own pause/stop, the junk app never closes).
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


def _process(raw: pl.DataFrame, *, use_filter: bool) -> pl.DataFrame:
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        minimum_usage_duration=0,
        use_background_apps_file=False,
        background_apps_dict={},
        use_filter_file=use_filter,
        apps_to_filter_dict={JUNK_APP: "Junk"} if use_filter else {},
    )
    pre = PolarsFastPathPreprocessor(options)
    return pre._run_app_usage_algorithm(pre._label_filtered_apps(raw))


def _valid_episodes(df: pl.DataFrame) -> list[float]:
    return (
        df.filter(
            (pl.col(Column.APP_PACKAGE_NAME) == VALID_APP)
            & (pl.col(Column.INTERACTION_TYPE) == APP_USAGE)
        )
        .get_column(Column.DURATION_SECONDS)
        .to_list()
    )


def test_unmatched_filtered_foreground_still_interrupts_valid_session():
    on = _process(_raw(), use_filter=True)
    off = _process(_raw(), use_filter=False)

    # Chat closes at the junk foreground (10:00 -> 10:02 = 120s) in BOTH worlds.
    assert _valid_episodes(off) == [120.0]
    assert _valid_episodes(on) == _valid_episodes(off)

    # The junk foreground itself is the interrupt marker: Filtered App Usage,
    # blanked timing, never counted as App Usage.
    junk_on = on.filter(pl.col(Column.APP_PACKAGE_NAME) == JUNK_APP)
    assert (junk_on.get_column(Column.INTERACTION_TYPE) == FILTERED_APP_USAGE).any()
    assert (junk_on.get_column(Column.INTERACTION_TYPE) == APP_USAGE).sum() == 0
    assert junk_on.get_column(Column.DURATION_SECONDS).null_count() == junk_on.height
