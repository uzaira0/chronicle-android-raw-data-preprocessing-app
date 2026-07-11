"""Tests for the concurrent-usage overlap split (Python mirror + Rust parity)."""

from __future__ import annotations

import numpy as np
import pytest

from chronicle_preprocessing_app.core.preprocessing.algorithms.overlap_split import (
    LayeredRow,
    split_overlapping_sessions,
)


def test_no_overlap_yields_one_primary_each():
    assert split_overlapping_sessions([0, 100], [50, 150]) == [
        LayeredRow(0, 0, 50, "primary"),
        LayeredRow(1, 100, 150, "primary"),
    ]


def test_enclosed_session_makes_outer_secondary():
    assert split_overlapping_sessions([0, 40], [100, 60]) == [
        LayeredRow(0, 0, 40, "primary"),
        LayeredRow(0, 40, 60, "secondary"),
        LayeredRow(0, 60, 100, "primary"),
        LayeredRow(1, 40, 60, "primary"),
    ]


def test_partial_overlap_splits_both():
    assert split_overlapping_sessions([0, 40], [60, 100]) == [
        LayeredRow(0, 0, 40, "primary"),
        LayeredRow(0, 40, 60, "secondary"),
        LayeredRow(1, 40, 100, "primary"),
    ]


def test_identical_start_resolves_by_input_order():
    assert split_overlapping_sessions([0, 0], [100, 100]) == [
        LayeredRow(0, 0, 100, "secondary"),
        LayeredRow(1, 0, 100, "primary"),
    ]


def test_mismatched_lengths_raise():
    with pytest.raises(ValueError):
        split_overlapping_sessions([0], [1, 2])


def test_inverted_bounds_raise():
    with pytest.raises(ValueError):
        split_overlapping_sessions([10], [5])


def test_python_matches_rust_on_random_inputs():
    """Python mirror must equal the Rust core on randomized sessions."""
    import random

    rust = pytest.importorskip("_rust_app_usage_matcher._rust_app_usage_matcher")
    rng = random.Random(20260522)
    for _ in range(200):
        n = rng.randint(1, 12)
        starts = [rng.randint(0, 50) for _ in range(n)]
        stops = [s + rng.randint(0, 50) for s in starts]
        py = split_overlapping_sessions(starts, stops)
        starts_arr = np.array(starts, dtype=np.int64)
        stops_arr = np.array(stops, dtype=np.int64)
        idx, r_start, r_stop, is_primary = rust.split_overlapping_sessions_py(starts_arr, stops_arr)
        rust_rows = [
            LayeredRow(i, a, b, "primary" if p else "secondary")
            for i, a, b, p in zip(idx, r_start, r_stop, is_primary, strict=True)
        ]
        assert py == rust_rows, f"mismatch for starts={starts} stops={stops}"


def test_zero_width_session_emits_single_primary_row():
    # start == stop: previously produced no row (silently dropped); now preserved
    # as a single 0-duration primary row, matching the non-concurrent path.
    assert split_overlapping_sessions([5], [5]) == [LayeredRow(0, 5, 5, "primary")]


def test_zero_width_session_nested_in_another_is_preserved():
    # Session 1 ([5, 5]) is zero-width inside session 0 ([0, 10]); it must survive.
    rows = split_overlapping_sessions([0, 5], [10, 5])
    assert LayeredRow(1, 5, 5, "primary") in rows
    assert any(r.session_index == 0 for r in rows)
