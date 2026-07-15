"""Construct-and-mark: a package on BOTH the filter list and the background-apps
list gets BOTH honored (EYES precedent: background activity is its own category
whose analytic treatment is deferred).

The filtered pass receives the background set, so the app's background session is
CONSTRUCTED — extended to its own Filtered App Stopped, real timing — and MARKED
with the distinct type "Filtered App Background Usage". It is excluded from App
Usage totals; valid apps' episodes are identical with the filter on or off (the
new type sits in the default other_interaction_types_to_stop_usage_at so the
constructed row interrupts valid sessions exactly where the raw resume would).

Mirrors web filterLabelInertness.test.ts ("filtered background apps are
constructed and marked, never blanked").
"""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, InteractionType
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

BACKGROUND_APP = "com.spotify.music"
VALID_APP = "com.valid.chat"

FABU = str(InteractionType.FILTERED_APP_BACKGROUND_USAGE)
APP_USAGE = str(InteractionType.APP_USAGE)


def _overlap_raw() -> pl.DataFrame:
    # Spotify backgrounds at 10:01 and stops at 10:10; Chat runs in the
    # foreground inside what would be Spotify's extended session.
    rows = [
        ("Audio", "Activity Resumed", BACKGROUND_APP, "2026-03-07 10:00:00"),
        ("Audio", "Activity Paused", BACKGROUND_APP, "2026-03-07 10:01:00"),
        ("Chat", "Activity Resumed", VALID_APP, "2026-03-07 10:02:00"),
        ("Chat", "Activity Paused", VALID_APP, "2026-03-07 10:06:00"),
        ("Audio", "Activity Stopped", BACKGROUND_APP, "2026-03-07 10:10:00"),
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


def _interrupt_raw() -> pl.DataFrame:
    # The background app foregrounds DURING the valid app's session: its
    # constructed row must interrupt Chat exactly where the raw resume would.
    rows = [
        ("Chat", "Activity Resumed", VALID_APP, "2026-03-07 10:00:00"),
        ("Audio", "Activity Resumed", BACKGROUND_APP, "2026-03-07 10:02:00"),
        ("Audio", "Activity Paused", BACKGROUND_APP, "2026-03-07 10:03:00"),
        ("Chat", "Activity Paused", VALID_APP, "2026-03-07 10:06:00"),
        ("Audio", "Activity Stopped", BACKGROUND_APP, "2026-03-07 10:10:00"),
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
        use_background_apps_file=True,
        background_apps_dict={BACKGROUND_APP: "Audio"},
        use_filter_file=use_filter,
        apps_to_filter_dict={BACKGROUND_APP: "Audio"} if use_filter else {},
    )
    pre = PolarsFastPathPreprocessor(options)
    df = pre._label_filtered_apps(raw)
    return pre._run_app_usage_algorithm(df)


def _valid_episodes(df: pl.DataFrame) -> list[float]:
    return (
        df.filter(
            (pl.col(Column.APP_PACKAGE_NAME) == VALID_APP)
            & (pl.col(Column.INTERACTION_TYPE) == APP_USAGE)
        )
        .get_column(Column.DURATION_SECONDS)
        .to_list()
    )


def test_filtered_background_session_constructed_and_marked():
    on = _process(_overlap_raw(), use_filter=True)
    off = _process(_overlap_raw(), use_filter=False)

    # Unfiltered: background semantics extend the session to Activity Stopped
    # (600s total), which the concurrent split layers into sub-intervals
    # (10:00-10:02 primary, 10:02-10:06 secondary under Chat, 10:06-10:10
    # primary).
    off_bg = off.filter(
        (pl.col(Column.APP_PACKAGE_NAME) == BACKGROUND_APP)
        & (pl.col(Column.INTERACTION_TYPE) == APP_USAGE)
    )
    assert sorted(off_bg.get_column(Column.DURATION_SECONDS).to_list()) == [120.0, 240.0, 240.0]
    assert off_bg.get_column(Column.DURATION_SECONDS).sum() == 600.0

    # Filtered: the SAME session, constructed and marked — real timing kept
    # across the valid pass, never counted as App Usage, never blanked.
    on_bg = on.filter(pl.col(Column.INTERACTION_TYPE) == FABU)
    assert on_bg.get_column(Column.APP_PACKAGE_NAME).to_list() == [BACKGROUND_APP]
    assert on_bg.get_column(Column.DURATION_SECONDS).to_list() == [600.0]
    assert on_bg.get_column(Column.START_TIMESTAMP).null_count() == 0
    assert on_bg.get_column(Column.STOP_TIMESTAMP).null_count() == 0
    assert (
        on.filter(pl.col(Column.APP_PACKAGE_NAME) == BACKGROUND_APP)
        .filter(pl.col(Column.INTERACTION_TYPE) == APP_USAGE)
        .height
        == 0
    )

    # The valid app is untouched by the choice.
    assert _valid_episodes(on) == _valid_episodes(off)
    assert _valid_episodes(on) == [240.0]


def test_constructed_row_still_interrupts_valid_sessions():
    on = _process(_interrupt_raw(), use_filter=True)
    off = _process(_interrupt_raw(), use_filter=False)

    # Filter off: the raw resume (an other_stop) interrupts Chat at 10:02.
    # Filter on: the constructed Filtered App Background Usage row sits in the
    # default other_interaction_types_to_stop_usage_at and interrupts Chat at
    # the identical timestamp — valid-app inertness holds.
    assert _valid_episodes(on) == _valid_episodes(off)
    assert len(_valid_episodes(on)) > 0

    fabu = on.filter(pl.col(Column.INTERACTION_TYPE) == FABU)
    assert fabu.get_column(Column.APP_PACKAGE_NAME).to_list() == [BACKGROUND_APP]


def test_plain_filtered_app_still_blanked():
    # A filtered app NOT on the background list keeps the long-standing
    # contract: marked Filtered App Usage with blanked timing.
    raw = _overlap_raw()
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        minimum_usage_duration=0,
        use_background_apps_file=False,
        background_apps_dict={},
        use_filter_file=True,
        apps_to_filter_dict={BACKGROUND_APP: "Audio"},
    )
    pre = PolarsFastPathPreprocessor(options)
    out = pre._run_app_usage_algorithm(pre._label_filtered_apps(raw))

    assert out.filter(pl.col(Column.INTERACTION_TYPE) == FABU).height == 0
    filtered = out.filter(
        pl.col(Column.INTERACTION_TYPE) == str(InteractionType.FILTERED_APP_USAGE)
    )
    assert filtered.height == 1
    assert filtered.get_column(Column.DURATION_SECONDS).null_count() == 1
