"""Background-apps behavior on the Polars fast path.

A declared background app (e.g. music, navigation) keeps running after it is
backgrounded: its usage session is not closed by its own pause nor by another
app coming to the foreground (an other_stop) — only by its own Activity Stopped.
The resulting overlap with the foreground app is resolved into primary/secondary
layers by the concurrent-usage split, which background apps imply.

Mirrors the web browserPipeline background remapping + the Rust matcher's
`background` other_stop protection; the cross-surface harness asserts byte parity
(scripts/run_deterministic_web_parity.py --background-apps).
"""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, UsageLayer
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)

BACKGROUND_APP = "com.spotify.music"
FOREGROUND_APP = "com.foreground"


def _background_overlap_raw() -> pl.DataFrame:
    # Background app runs 08:00-08:30. A normal foreground app resumes at 08:05
    # (an other_stop that would close a non-background session) and stops at
    # 08:20. The background app then stops at 08:30.
    rows = [
        ("Activity Resumed", BACKGROUND_APP, "2026-01-01 08:00:00"),
        ("Activity Resumed", FOREGROUND_APP, "2026-01-01 08:05:00"),
        ("Activity Stopped", FOREGROUND_APP, "2026-01-01 08:20:00"),
        ("Activity Stopped", BACKGROUND_APP, "2026-01-01 08:30:00"),
    ]
    return pl.DataFrame(
        {
            Column.INTERACTION_TYPE: [r[0] for r in rows],
            Column.APP_PACKAGE_NAME: [r[1] for r in rows],
            Column.EVENT_TIMESTAMP: pl.Series([r[2] for r in rows]).str.to_datetime(
                time_zone="UTC"
            ),
        }
    )


def _process(*, background: bool) -> pl.DataFrame:
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        use_background_apps_file=background,
        background_apps_dict={BACKGROUND_APP: "Audio"} if background else {},
    )
    return PolarsFastPathPreprocessor(options)._process_valid_app_usage(
        _background_overlap_raw()
    )


def test_flag_off_background_app_closed_by_foreground_switch():
    """Without the background list the music app is a normal app: the foreground
    switch (other_stop) closes it at 08:05 and no usage_layer is emitted."""
    off = _process(background=False)
    assert Column.USAGE_LAYER not in off.columns
    usage = off.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    bg = usage.filter(pl.col(Column.APP_PACKAGE_NAME) == BACKGROUND_APP)
    assert bg.height == 1
    # 08:00 -> 08:05 only (closed by the foreground app's resume).
    assert bg.get_column(Column.DURATION_SECONDS).to_list() == [300.0]


def test_flag_on_background_app_survives_foreground_and_layers():
    """With the background list the music app survives the foreground switch and
    runs to its own Activity Stopped (08:30), overlapping the foreground app and
    splitting into primary/secondary layers."""
    on = _process(background=True)
    assert Column.USAGE_LAYER in on.columns
    usage = on.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")

    bg = usage.filter(pl.col(Column.APP_PACKAGE_NAME) == BACKGROUND_APP)
    bg_secondary = bg.filter(pl.col(Column.USAGE_LAYER) == str(UsageLayer.SECONDARY))
    bg_primary = bg.filter(pl.col(Column.USAGE_LAYER) == str(UsageLayer.PRIMARY))
    # During 08:05-08:20 the foreground app starts later, so the background app
    # is secondary there (900s); outside the overlap it is primary (300s + 600s).
    assert bg_secondary.get_column(Column.DURATION_SECONDS).to_list() == [900.0]
    assert sorted(bg_primary.get_column(Column.DURATION_SECONDS).to_list()) == [300.0, 600.0]

    fg = usage.filter(pl.col(Column.APP_PACKAGE_NAME) == FOREGROUND_APP)
    # The foreground app holds the foreground for the whole overlap window (900s).
    assert fg.get_column(Column.USAGE_LAYER).to_list() == [str(UsageLayer.PRIMARY)]
    assert fg.get_column(Column.DURATION_SECONDS).to_list() == [900.0]


def test_flag_on_total_primary_duration_conserved():
    """Sum of primary durations equals the sole-foreground timeline (no double
    counting): bg 300s + fg 900s + bg 600s = 1800s = 08:00 to 08:30."""
    on = _process(background=True)
    usage = on.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    primary = usage.filter(pl.col(Column.USAGE_LAYER) == str(UsageLayer.PRIMARY))
    assert primary.get_column(Column.DURATION_SECONDS).sum() == 1800.0


def _multi_cycle_raw() -> pl.DataFrame:
    # The realistic shape: a background app is foregrounded multiple times,
    # interleaved with different foreground apps, and emits Activity Stopped only
    # once at the end. Each re-resume must SEGMENT the background session, not
    # stack a second overlapping open session (which would layer the app against
    # itself and multiply its counted time).
    rows = [
        ("Activity Resumed", BACKGROUND_APP, "2026-01-01 08:00:00"),
        ("Activity Resumed", "com.appA", "2026-01-01 08:05:00"),
        ("Activity Stopped", "com.appA", "2026-01-01 08:08:00"),
        ("Activity Resumed", BACKGROUND_APP, "2026-01-01 08:10:00"),
        ("Activity Resumed", "com.appB", "2026-01-01 08:15:00"),
        ("Activity Stopped", "com.appB", "2026-01-01 08:18:00"),
        ("Activity Stopped", BACKGROUND_APP, "2026-01-01 08:30:00"),
    ]
    return pl.DataFrame(
        {
            Column.INTERACTION_TYPE: [r[0] for r in rows],
            Column.APP_PACKAGE_NAME: [r[1] for r in rows],
            Column.EVENT_TIMESTAMP: pl.Series([r[2] for r in rows]).str.to_datetime(
                time_zone="UTC"
            ),
        }
    )


def test_multi_cycle_background_does_not_self_overlap_or_vanish():
    """Regression: a background app resumed more often than it is Stopped must
    not stack overlapping sessions (self-double-count) nor go missing. Each
    re-resume segments the session; total counted time is conserved."""
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        use_background_apps_file=True,
        background_apps_dict={BACKGROUND_APP: "Audio"},
    )
    out = PolarsFastPathPreprocessor(options)._process_valid_app_usage(_multi_cycle_raw())

    # No session is dropped to "End of Usage Missing".
    assert out.filter(pl.col(Column.INTERACTION_TYPE) == "End of Usage Missing").height == 0

    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    # Primary durations tile the timeline exactly once: 08:00 to 08:30 = 1800s.
    primary = usage.filter(pl.col(Column.USAGE_LAYER) == str(UsageLayer.PRIMARY))
    assert primary.get_column(Column.DURATION_SECONDS).sum() == 1800.0

    # The background app is alive the whole window (08:00-08:30): its primary +
    # secondary time sums to 1800s, NOT a multiple of it (no self-overlap).
    bg = usage.filter(pl.col(Column.APP_PACKAGE_NAME) == BACKGROUND_APP)
    assert bg.get_column(Column.DURATION_SECONDS).sum() == 1800.0


def _selected_output(*, background: bool) -> pl.DataFrame:
    """Reproduce the save path's column selection (PolarsFastPathPreprocessor
    output: _build_output_columns -> df.select). Asserting on this frame — not
    the in-memory frame the other tests inspect — is what pins the output-column
    gate, which previously keyed on model_concurrent_usage alone and silently
    dropped usage_layer from the written file in the background-only config."""
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        use_background_apps_file=background,
        background_apps_dict={BACKGROUND_APP: "Audio"} if background else {},
    )
    pre = PolarsFastPathPreprocessor(options)
    df = pre._process_valid_app_usage(_background_overlap_raw())
    columns = pre._build_output_columns(df)
    return df.select([col for col in columns if col in df.columns])


def test_output_columns_include_labeled_usage_layer_for_background_only():
    """Absolute (not parity-relative) regression: with background apps on and
    model_concurrent_usage OFF, the SELECTED output schema must carry usage_layer
    and both layers must be labeled — otherwise the split's secondary rows ship
    unlabeled and a downstream sum(duration_seconds) double-counts the overlap.
    Parity could not catch this: both surfaces agreed on the column-less output."""
    out = _selected_output(background=True)
    assert Column.USAGE_LAYER in out.columns
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    layers = set(usage.get_column(Column.USAGE_LAYER).to_list())
    assert str(UsageLayer.PRIMARY) in layers
    assert str(UsageLayer.SECONDARY) in layers


def test_output_columns_omit_usage_layer_without_any_concurrent_feature():
    """The negative pin for the gate: with neither model_concurrent_usage nor
    background apps, usage_layer is not part of the output schema."""
    out = _selected_output(background=False)
    assert Column.USAGE_LAYER not in out.columns


def test_output_columns_omit_usage_layer_for_enabled_but_empty_background_file():
    """Empty-file edge (toggle ON, zero packages, model_concurrent_usage OFF):
    no split runs, so usage_layer must NOT be emitted — matching the web side,
    which gates the column on the background SET being non-empty, not merely on
    the toggle. This locks the invariant the cross-surface harness cannot cover
    (it only ever runs non-empty lists): the toggle alone does not add the
    column, so reverting either surface to a toggle gate fails here."""
    options = PreprocessingOptions(
        raw_data_folder="",
        model_concurrent_usage=False,
        use_background_apps_file=True,
        background_apps_dict={},
    )
    pre = PolarsFastPathPreprocessor(options)
    df = pre._process_valid_app_usage(_background_overlap_raw())
    columns = pre._build_output_columns(df)
    selected = df.select([col for col in columns if col in df.columns])
    assert Column.USAGE_LAYER not in selected.columns
