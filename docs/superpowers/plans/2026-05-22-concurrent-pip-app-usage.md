# Concurrent (PiP) App-Usage Modeling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `model_concurrent_usage` option that attributes overlapping app-usage time to `primary` (sole-foreground) and `secondary` (running-underneath / Picture-in-Picture) layers, with identical results across the Python, Rust, and WASM surfaces.

**Architecture:** Two phases. Phase 1: when the flag is on, the preprocessor builds the `other_stop` mask empty so a session runs to its own stop event instead of ending when another app foregrounds. Phase 2: a new pure `split_overlapping_sessions` function sweeps the resulting (possibly overlapping) sessions and splits each into `primary`/`secondary` sub-interval rows. Phase 2 lives in Rust (shared by the pyo3 desktop binding and the WASM crate) with a Python mirror for the matcher's fallback path.

**Tech Stack:** Rust (pyo3 + wasm-bindgen), Python (Polars/NumPy), TypeScript (web worker + WASM), LinkML schema.

**Spec:** `docs/superpowers/specs/2026-05-22-concurrent-pip-app-usage-design.md`

**Parallelization:** Task 1 (schema) and Task 2 (config) are independent and can run first in parallel. Tasks 3–4 (Rust core + Python mirror) depend on nothing but each other's shared semantics — do Task 3 first, then 4 mirrors it. Tasks 5 (Python integration) and 6 (WASM/web) are independent of each other once 3–4 land. Task 7 (parity + fixture) is last.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `web/schema/chronicle-local-contract.linkml.yaml` | SSOT: option + output-column definitions | Modify |
| `src/chronicle_preprocessing_app/config/defaults.py` | `DEFAULT_MODEL_CONCURRENT_USAGE` | Modify |
| `src/chronicle_preprocessing_app/config/constants.py` | `Column.USAGE_LAYER`, `UsageLayer` enum | Modify |
| `src/chronicle_preprocessing_app/core/config.py` | `model_concurrent_usage` field on `PreprocessingOptions` | Modify |
| `rust/chronicle_app_usage_matcher/src/lib.rs` | `split_overlapping_sessions` core + pyo3 binding + tests | Modify |
| `rust/chronicle_app_usage_wasm/src/lib.rs` | WASM export of the split | Modify |
| `src/chronicle_preprocessing_app/core/preprocessing/algorithms/overlap_split.py` | Python mirror of the split | Create |
| `tests/test_overlap_split.py` | Python split unit tests + Rust-parity tests | Create |
| `src/chronicle_preprocessing_app/core/preprocessing/polars_fast_path.py` | Phase-1 mask gating + Phase-2 row expansion | Modify |
| `web/src/lib/types.ts` + worker spec | Thread `model_concurrent_usage` through to WASM | Modify |
| `tests/test_concurrent_usage_parity.py` | flag-on/flag-off parity + clean overlap fixture | Create |

---

## Task 1: Schema — add option slot and output column

**Files:**
- Modify: `web/schema/chronicle-local-contract.linkml.yaml`

- [ ] **Step 1: Read the schema and locate the option slots block and the option-group list**

Read `web/schema/chronicle-local-contract.linkml.yaml`. Find the `slots:` block (around line 109+) and the option-group list that currently ends with `other_interaction_types_to_stop_usage_at` (around line 82).

- [ ] **Step 2: Add `model_concurrent_usage` to the option-group list**

In the option-group list (the block around lines 56–82), add a new entry directly after `other_interaction_types_to_stop_usage_at`:

```yaml
      - model_concurrent_usage
```

- [ ] **Step 3: Add the `model_concurrent_usage` slot definition**

In the `slots:` block, after the `allow_stop_event_reuse` slot, add (match the existing slot indentation and style):

```yaml
  model_concurrent_usage:
    range: boolean
    required: false
    ifabsent: "boolean(false)"
    title: "Model concurrent (Picture-in-Picture) usage"
    description: >
      When enabled, an app session runs to its own stop event instead of ending
      when another app is foregrounded. Overlapping sessions are split into a
      primary (sole-foreground) layer and a secondary (running-underneath / PiP)
      layer, reported via the usage_layer column. Default off; output is
      unchanged when off.
```

- [ ] **Step 4: Add the `usage_layer` output column definition**

Find where output columns are declared in the schema (search for `duration_seconds`). Add a `usage_layer` column declaration alongside it, matching the existing column style:

```yaml
  usage_layer:
    range: string
    required: false
    description: >
      For concurrent-usage output only: 'primary' when the app was the sole
      foreground app for the row's sub-interval, 'secondary' when it was running
      underneath another app. Absent when model_concurrent_usage is off.
```

- [ ] **Step 5: Regenerate TypeScript types and commit**

Run: `cd web && <the project's type-generation command — see the generate-api-types skill or web/package.json scripts>`
Expected: `web/src/lib/types.ts` (or the generated types file) gains `model_concurrent_usage` and `usage_layer`.

```bash
git add web/schema/chronicle-local-contract.linkml.yaml web/src/lib/
git commit -m "schema: add model_concurrent_usage option and usage_layer column"
```

---

## Task 2: Config — option field, default, column constant

**Files:**
- Modify: `src/chronicle_preprocessing_app/config/defaults.py`
- Modify: `src/chronicle_preprocessing_app/config/constants.py`
- Modify: `src/chronicle_preprocessing_app/core/config.py`

- [ ] **Step 1: Add the default**

In `src/chronicle_preprocessing_app/config/defaults.py`, near `DEFAULT_ALLOW_STOP_EVENT_REUSE`, add:

```python
DEFAULT_MODEL_CONCURRENT_USAGE = False
```

- [ ] **Step 2: Add the `usage_layer` column and a `UsageLayer` enum**

In `src/chronicle_preprocessing_app/config/constants.py`, add to the `Column` `StrEnum`:

```python
    USAGE_LAYER = "usage_layer"
```

And add a new `StrEnum` near the other enums:

```python
class UsageLayer(StrEnum):
    """Concurrent-usage layer for a split app-usage row."""

    PRIMARY = "primary"
    SECONDARY = "secondary"
```

- [ ] **Step 3: Add the `PreprocessingOptions` field**

In `src/chronicle_preprocessing_app/core/config.py`, import the default:

```python
from chronicle_preprocessing_app.config.defaults import (
    ...,
    DEFAULT_MODEL_CONCURRENT_USAGE,
)
```

Add the field on `PreprocessingOptions` after `correct_duplicate_event_timestamps` (line 193):

```python
    model_concurrent_usage: bool = DEFAULT_MODEL_CONCURRENT_USAGE
```

Add a line to the class docstring `Args:` section describing it: "model_concurrent_usage: When True, model overlapping (PiP) usage as primary/secondary layers."

- [ ] **Step 4: Verify import works**

Run: `python -c "from chronicle_preprocessing_app.core.config import PreprocessingOptions; print(PreprocessingOptions(raw_data_folder='').model_concurrent_usage)"`
Expected: `False`

- [ ] **Step 5: Commit**

```bash
git add src/chronicle_preprocessing_app/config/ src/chronicle_preprocessing_app/core/config.py
git commit -m "config: add model_concurrent_usage option, usage_layer column, UsageLayer enum"
```

---

## Task 3: Rust — `split_overlapping_sessions` core + pyo3 binding

**Files:**
- Modify: `rust/chronicle_app_usage_matcher/src/lib.rs`

- [ ] **Step 1: Write failing unit tests**

In the `#[cfg(test)] mod tests` block of `rust/chronicle_app_usage_matcher/src/lib.rs`, add:

```rust
    fn split(starts: &[i64], stops: &[i64]) -> Vec<LayeredSession> {
        split_overlapping_sessions(starts, stops).expect("split should succeed")
    }

    #[test]
    fn no_overlap_yields_one_primary_row_each() {
        let out = split(&[0, 100], &[50, 150]);
        assert_eq!(
            out,
            vec![
                LayeredSession { session_index: 0, start_ns: 0, stop_ns: 50, layer: UsageLayer::Primary },
                LayeredSession { session_index: 1, start_ns: 100, stop_ns: 150, layer: UsageLayer::Primary },
            ]
        );
    }

    #[test]
    fn enclosed_session_makes_outer_secondary_during_overlap() {
        // A: [0,100]  B: [40,60]  -> A primary [0,40), B primary [40,60), A secondary [40,60), A primary [60,100)
        let out = split(&[0, 40], &[100, 60]);
        assert_eq!(
            out,
            vec![
                LayeredSession { session_index: 0, start_ns: 0, stop_ns: 40, layer: UsageLayer::Primary },
                LayeredSession { session_index: 0, start_ns: 40, stop_ns: 60, layer: UsageLayer::Secondary },
                LayeredSession { session_index: 0, start_ns: 60, stop_ns: 100, layer: UsageLayer::Primary },
                LayeredSession { session_index: 1, start_ns: 40, stop_ns: 60, layer: UsageLayer::Primary },
            ]
        );
    }

    #[test]
    fn partial_overlap_splits_both() {
        // A: [0,60]  B: [40,100]
        let out = split(&[0, 40], &[60, 100]);
        assert_eq!(
            out,
            vec![
                LayeredSession { session_index: 0, start_ns: 0, stop_ns: 40, layer: UsageLayer::Primary },
                LayeredSession { session_index: 0, start_ns: 40, stop_ns: 60, layer: UsageLayer::Secondary },
                LayeredSession { session_index: 1, start_ns: 40, stop_ns: 100, layer: UsageLayer::Primary },
            ]
        );
    }

    #[test]
    fn identical_start_resolves_by_input_order() {
        // A and B both [0,100]; later input index wins primary.
        let out = split(&[0, 0], &[100, 100]);
        assert_eq!(
            out,
            vec![
                LayeredSession { session_index: 0, start_ns: 0, stop_ns: 100, layer: UsageLayer::Secondary },
                LayeredSession { session_index: 1, start_ns: 0, stop_ns: 100, layer: UsageLayer::Primary },
            ]
        );
    }

    #[test]
    fn rejects_mismatched_lengths() {
        assert!(split_overlapping_sessions(&[0], &[1, 2]).is_err());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd rust/chronicle_app_usage_matcher && cargo test split`
Expected: FAIL — `cannot find function split_overlapping_sessions` / `cannot find type LayeredSession`.

- [ ] **Step 3: Implement the types and core function**

In `rust/chronicle_app_usage_matcher/src/lib.rs`, after the `MatchUpdateIndices` struct, add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageLayer {
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayeredSession {
    pub session_index: usize,
    pub start_ns: i64,
    pub stop_ns: i64,
    pub layer: UsageLayer,
}

/// Split possibly-overlapping app sessions into primary/secondary sub-interval
/// rows. `starts[i]`/`stops[i]` are the bounds of paired session `i`
/// (`stops[i] >= starts[i]`). In any sub-interval the open session with the
/// greatest `start_ns` is `primary` (tie broken by greatest input index);
/// every other open session is `secondary`. Adjacent same-session same-layer
/// sub-intervals are coalesced. Output is ordered by `session_index`, then by
/// `start_ns`.
pub fn split_overlapping_sessions(
    starts: &[i64],
    stops: &[i64],
) -> MatcherResult<Vec<LayeredSession>> {
    if starts.len() != stops.len() {
        return Err(MatcherError::new(
            "starts and stops must have the same length",
        ));
    }
    for i in 0..starts.len() {
        if stops[i] < starts[i] {
            return Err(MatcherError::new("stop must be >= start for every session"));
        }
    }

    // Boundary timestamps: every distinct start and stop, sorted.
    let mut boundaries: Vec<i64> = Vec::with_capacity(starts.len() * 2);
    boundaries.extend_from_slice(starts);
    boundaries.extend_from_slice(stops);
    boundaries.sort_unstable();
    boundaries.dedup();

    // For each sub-interval [boundaries[k], boundaries[k+1]) emit a row per
    // open session. Coalesce per session afterwards.
    let mut raw: Vec<LayeredSession> = Vec::new();
    for window in boundaries.windows(2) {
        let (t0, t1) = (window[0], window[1]);
        if t1 <= t0 {
            continue;
        }
        // Open sessions in [t0, t1): start <= t0 and stop >= t1.
        let mut open: Vec<usize> = Vec::new();
        for i in 0..starts.len() {
            if starts[i] <= t0 && stops[i] >= t1 {
                open.push(i);
            }
        }
        if open.is_empty() {
            continue;
        }
        // Primary = greatest start_ns, tie broken by greatest index.
        let primary = *open
            .iter()
            .max_by(|&&a, &&b| starts[a].cmp(&starts[b]).then(a.cmp(&b)))
            .expect("open is non-empty");
        for &i in &open {
            raw.push(LayeredSession {
                session_index: i,
                start_ns: t0,
                stop_ns: t1,
                layer: if i == primary {
                    UsageLayer::Primary
                } else {
                    UsageLayer::Secondary
                },
            });
        }
    }

    // Stable order by (session_index, start_ns), then coalesce adjacency.
    raw.sort_by(|a, b| {
        a.session_index
            .cmp(&b.session_index)
            .then(a.start_ns.cmp(&b.start_ns))
    });
    let mut out: Vec<LayeredSession> = Vec::with_capacity(raw.len());
    for row in raw {
        if let Some(last) = out.last_mut() {
            if last.session_index == row.session_index
                && last.layer == row.layer
                && last.stop_ns == row.start_ns
            {
                last.stop_ns = row.stop_ns;
                continue;
            }
        }
        out.push(row);
    }
    Ok(out)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd rust/chronicle_app_usage_matcher && cargo test split`
Expected: PASS — all 5 split tests green.

- [ ] **Step 5: Add the pyo3 binding**

In `lib.rs`, add (inside the `#[cfg(feature = "python")]` region, near `match_app_usage`):

```rust
#[cfg(feature = "python")]
#[pyfunction]
fn split_overlapping_sessions_py(
    starts: Vec<i64>,
    stops: Vec<i64>,
) -> PyResult<(Vec<usize>, Vec<i64>, Vec<i64>, Vec<bool>)> {
    let rows = split_overlapping_sessions(&starts, &stops).map_err(to_py_error)?;
    let mut session_index = Vec::with_capacity(rows.len());
    let mut start_ns = Vec::with_capacity(rows.len());
    let mut stop_ns = Vec::with_capacity(rows.len());
    let mut is_primary = Vec::with_capacity(rows.len());
    for row in rows {
        session_index.push(row.session_index);
        start_ns.push(row.start_ns);
        stop_ns.push(row.stop_ns);
        is_primary.push(row.layer == UsageLayer::Primary);
    }
    Ok((session_index, start_ns, stop_ns, is_primary))
}
```

Register it in the `_rust_app_usage_matcher` `#[pymodule]` block:

```rust
    m.add_function(wrap_pyfunction!(split_overlapping_sessions_py, m)?)?;
```

- [ ] **Step 6: Build the Python extension and verify the binding**

Run: `<the project's Rust-extension build command — e.g. maturin develop or the build script in scripts/>`
Then: `python -c "from chronicle_app_usage_matcher import _rust_app_usage_matcher as m; print(m.split_overlapping_sessions_py([0,40],[100,60]))"`
Expected: a 4-tuple matching the `enclosed_session` test (session indices, starts, stops, is_primary).

- [ ] **Step 7: Commit**

```bash
git add rust/chronicle_app_usage_matcher/src/lib.rs
git commit -m "feat(rust): split_overlapping_sessions core + pyo3 binding"
```

---

## Task 4: Python mirror of the split + Rust-parity tests

**Files:**
- Create: `src/chronicle_preprocessing_app/core/preprocessing/algorithms/overlap_split.py`
- Create: `tests/test_overlap_split.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_overlap_split.py`:

```python
"""Tests for the concurrent-usage overlap split (Python mirror + Rust parity)."""

from __future__ import annotations

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_overlap_split.py -v`
Expected: FAIL — `ModuleNotFoundError` for `overlap_split`.

- [ ] **Step 3: Implement the Python mirror**

Create `src/chronicle_preprocessing_app/core/preprocessing/algorithms/overlap_split.py`:

```python
"""Pure-Python mirror of the Rust split_overlapping_sessions function.

Mirrors rust/chronicle_app_usage_matcher/src/lib.rs::split_overlapping_sessions
exactly so the matcher's Python fallback path produces identical layered rows.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LayeredRow:
    """One primary/secondary sub-interval row for an input session."""

    session_index: int
    start_ns: int
    stop_ns: int
    layer: str  # "primary" or "secondary"


def split_overlapping_sessions(
    starts: list[int],
    stops: list[int],
) -> list[LayeredRow]:
    """Split possibly-overlapping sessions into primary/secondary sub-intervals.

    In any sub-interval the open session with the greatest start_ns is primary
    (tie broken by greatest input index); every other open session is secondary.
    Adjacent same-session same-layer sub-intervals are coalesced. Output is
    ordered by (session_index, start_ns).
    """
    if len(starts) != len(stops):
        raise ValueError("starts and stops must have the same length")
    for start, stop in zip(starts, stops, strict=True):
        if stop < start:
            raise ValueError("stop must be >= start for every session")

    boundaries = sorted(set(starts) | set(stops))

    raw: list[LayeredRow] = []
    for t0, t1 in zip(boundaries, boundaries[1:], strict=False):
        if t1 <= t0:
            continue
        open_sessions = [
            i for i in range(len(starts)) if starts[i] <= t0 and stops[i] >= t1
        ]
        if not open_sessions:
            continue
        primary = max(open_sessions, key=lambda i: (starts[i], i))
        for i in open_sessions:
            raw.append(
                LayeredRow(
                    session_index=i,
                    start_ns=t0,
                    stop_ns=t1,
                    layer="primary" if i == primary else "secondary",
                )
            )

    raw.sort(key=lambda r: (r.session_index, r.start_ns))
    out: list[LayeredRow] = []
    for row in raw:
        if (
            out
            and out[-1].session_index == row.session_index
            and out[-1].layer == row.layer
            and out[-1].stop_ns == row.start_ns
        ):
            out[-1] = LayeredRow(
                out[-1].session_index, out[-1].start_ns, row.stop_ns, out[-1].layer
            )
        else:
            out.append(row)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_overlap_split.py -v`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Add a Rust-parity test**

Append to `tests/test_overlap_split.py`:

```python
def test_python_matches_rust_on_random_inputs():
    """Python mirror must equal the Rust core on randomized sessions."""
    import random

    rust = pytest.importorskip(
        "chronicle_app_usage_matcher._rust_app_usage_matcher"
    )
    rng = random.Random(20260522)
    for _ in range(200):
        n = rng.randint(1, 12)
        starts = [rng.randint(0, 50) for _ in range(n)]
        stops = [s + rng.randint(0, 50) for s in starts]
        py = split_overlapping_sessions(starts, stops)
        idx, r_start, r_stop, is_primary = rust.split_overlapping_sessions_py(
            starts, stops
        )
        rust_rows = [
            LayeredRow(i, a, b, "primary" if p else "secondary")
            for i, a, b, p in zip(idx, r_start, r_stop, is_primary, strict=True)
        ]
        assert py == rust_rows, f"mismatch for starts={starts} stops={stops}"
```

- [ ] **Step 6: Run the parity test**

Run: `pytest tests/test_overlap_split.py::test_python_matches_rust_on_random_inputs -v`
Expected: PASS (or SKIP if the Rust extension is not built — build it first via Task 3 Step 6).

- [ ] **Step 7: Commit**

```bash
git add src/chronicle_preprocessing_app/core/preprocessing/algorithms/overlap_split.py tests/test_overlap_split.py
git commit -m "feat: Python mirror of overlap split + Rust-parity test"
```

---

## Task 5: Python pipeline integration (Phase 1 mask gating + Phase 2 row expansion)

**Files:**
- Modify: `src/chronicle_preprocessing_app/core/preprocessing/polars_fast_path.py`
- Create test: `tests/test_concurrent_usage_pipeline.py`

- [ ] **Step 1: Write a failing integration test**

Create `tests/test_concurrent_usage_pipeline.py`:

```python
"""Pipeline-level tests for model_concurrent_usage."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column, UsageLayer
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


def _two_overlapping_apps_raw() -> pl.DataFrame:
    """App A resumed, B resumed inside A, B stopped, A stopped."""
    rows = [
        ("Activity Resumed", "com.a", "2026-01-01 08:00:00"),
        ("Activity Resumed", "com.b", "2026-01-01 08:10:00"),
        ("Activity Stopped", "com.b", "2026-01-01 08:20:00"),
        ("Activity Stopped", "com.a", "2026-01-01 08:30:00"),
    ]
    return pl.DataFrame(
        {
            Column.INTERACTION_TYPE: [r[0] for r in rows],
            Column.APP_PACKAGE_NAME: [r[1] for r in rows],
            Column.EVENT_TIMESTAMP: pl.Series(
                [r[2] for r in rows]
            ).str.to_datetime(time_zone="UTC"),
        }
    )


def test_flag_off_keeps_single_foreground_behavior():
    options = PreprocessingOptions(raw_data_folder="", model_concurrent_usage=False)
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_two_overlapping_apps_raw())
    # No usage_layer column when the flag is off.
    assert Column.USAGE_LAYER not in out.columns


def test_flag_on_emits_primary_and_secondary_rows():
    options = PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    helper = PolarsFastPathPreprocessor(options)
    out = helper._process_valid_app_usage(_two_overlapping_apps_raw())
    assert Column.USAGE_LAYER in out.columns
    usage = out.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    layers = set(usage.get_column(Column.USAGE_LAYER).to_list())
    assert layers == {str(UsageLayer.PRIMARY), str(UsageLayer.SECONDARY)}
    # com.a contributes a secondary row during B's 08:10-08:20 window.
    a_secondary = usage.filter(
        (pl.col(Column.APP_PACKAGE_NAME) == "com.a")
        & (pl.col(Column.USAGE_LAYER) == str(UsageLayer.SECONDARY))
    )
    assert a_secondary.height == 1
    assert a_secondary.get_column(Column.DURATION_SECONDS).to_list() == [600.0]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_concurrent_usage_pipeline.py -v`
Expected: FAIL — flag-on test fails (`usage_layer` column missing).

- [ ] **Step 3: Phase 1 — gate the `other_stop` mask**

In `polars_fast_path.py`, modify `_process_valid_app_usage` (lines 528–548). Replace the `other_stop_types={...}` argument so it is empty when the flag is on:

```python
        other_stop_types: set[str]
        if self.options.model_concurrent_usage:
            other_stop_types = set()
        else:
            other_stop_types = {
                str(value) for value in self.options.other_interaction_types_to_stop_usage_at
            }

        return self._process_usage_rows(
            df,
            resumed_type=str(InteractionType.ACTIVITY_RESUMED),
            paused_type=str(InteractionType.ACTIVITY_PAUSED),
            usage_type=str(InteractionType.APP_USAGE),
            stopped_type=str(InteractionType.ACTIVITY_STOPPED),
            same_stop_types={
                str(value) for value in self.options.same_app_interaction_types_to_stop_usage_at
            },
            other_stop_types=other_stop_types,
        )
```

(Leave `_process_filtered_app_usage` unchanged — concurrency modeling is valid-app-usage only per the spec.)

- [ ] **Step 4: Phase 2 — add the row-expansion helper**

In `polars_fast_path.py`, add an import at the top:

```python
from chronicle_preprocessing_app.core.preprocessing.algorithms.overlap_split import (
    split_overlapping_sessions,
)
from chronicle_preprocessing_app.config.constants import UsageLayer
```

Add a new method to `PolarsFastPathPreprocessor`:

```python
    def _apply_concurrent_usage_split(self, df: pl.DataFrame, usage_type: str) -> pl.DataFrame:
        """Expand overlapping App-Usage rows into primary/secondary layer rows.

        Non-usage rows pass through unchanged with usage_layer = null. Each
        usage row whose [start, stop] interval overlaps another usage row is
        replaced by one row per primary/secondary sub-interval.
        """
        usage_mask = df.get_column(Column.INTERACTION_TYPE) == usage_type
        usage = df.filter(usage_mask).with_row_index("_session_index")
        non_usage = df.filter(~usage_mask).with_columns(
            pl.lit(None, dtype=pl.String).alias(Column.USAGE_LAYER)
        )
        if usage.height == 0:
            return non_usage.drop("_session_index", strict=False)

        starts = usage.get_column(Column.START_TIMESTAMP).dt.epoch("ns").to_list()
        stops = usage.get_column(Column.STOP_TIMESTAMP).dt.epoch("ns").to_list()
        layered = split_overlapping_sessions(starts, stops)

        tz = df.schema[Column.EVENT_TIMESTAMP].time_zone or "UTC"
        index_col = pl.Series(
            "_session_index", [r.session_index for r in layered], dtype=pl.UInt32
        )
        expanded = (
            usage.drop([Column.START_TIMESTAMP, Column.STOP_TIMESTAMP])
            .join(pl.DataFrame(index_col), on="_session_index", how="right")
            .with_columns(
                [
                    pl.Series(Column.START_TIMESTAMP, [r.start_ns for r in layered])
                    .cast(pl.Datetime("ns", "UTC"))
                    .dt.convert_time_zone(tz),
                    pl.Series(Column.STOP_TIMESTAMP, [r.stop_ns for r in layered])
                    .cast(pl.Datetime("ns", "UTC"))
                    .dt.convert_time_zone(tz),
                    pl.Series(Column.USAGE_LAYER, [r.layer for r in layered]),
                ]
            )
        )
        combined = pl.concat([expanded, non_usage], how="diagonal_relaxed")
        return combined.drop("_session_index", strict=False)
```

- [ ] **Step 5: Phase 2 — invoke the split and recompute durations**

In `_process_usage_rows`, after the line `df = df.with_columns(pl.col(Column.INTERACTION_TYPE).replace(resumed_type, usage_type)...)` (line ~608–612) and BEFORE the `duration_expr` block, insert:

```python
        if self.options.model_concurrent_usage and usage_type == str(InteractionType.APP_USAGE):
            df = self._apply_concurrent_usage_split(df, usage_type)
```

The existing `duration_expr` block then recomputes `duration_seconds` / `duration_minutes` from the (now sub-interval) START/STOP timestamps — no change needed there. Confirm the final `return df.sort(Column.EVENT_TIMESTAMP)` still holds; `EVENT_TIMESTAMP` is preserved on expanded rows.

- [ ] **Step 6: Run the integration tests**

Run: `pytest tests/test_concurrent_usage_pipeline.py -v`
Expected: PASS — both flag-off and flag-on tests green.

- [ ] **Step 7: Run the full app-usage test suite to confirm flag-off is unaffected**

Run: `pytest tests/ -k "app_usage or fast_path or preproc" -q`
Expected: PASS — no regressions (flag defaults off → existing behavior unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/chronicle_preprocessing_app/core/preprocessing/polars_fast_path.py tests/test_concurrent_usage_pipeline.py
git commit -m "feat: model_concurrent_usage Python pipeline integration"
```

---

## Task 6: WASM + web integration

**Files:**
- Modify: `rust/chronicle_app_usage_wasm/src/lib.rs` (and/or the WASM kernel crate that performs app-usage matching)
- Modify: `web/src/lib/chronicleMatcher.ts` and the worker spec/types that pass options through

- [ ] **Step 1: Read the WASM crate and identify where app-usage matching runs**

Read `rust/chronicle_app_usage_wasm/src/lib.rs` and the chrono-kernel WASM crate (`rust/chronicle_chrono_kernel_wasm/src/`). Locate where the `other_stop` mask is built and where matched sessions become output rows — this is the WASM analogue of `polars_fast_path._process_usage_rows`.

- [ ] **Step 2: Share the split function with the WASM crate**

In the WASM crate's `Cargo.toml`, add a path dependency on the matcher crate so `split_overlapping_sessions` is reused (no duplicated algorithm):

```toml
chronicle_app_usage_matcher = { path = "../chronicle_app_usage_matcher", default-features = false }
```

Confirm `split_overlapping_sessions`, `LayeredSession`, and `UsageLayer` are `pub` (they are, from Task 3) and compile without the `python` feature.

- [ ] **Step 3: Add the flag to the WASM matching path**

In the WASM matching code, thread a `model_concurrent_usage: bool` through the options struct that crosses the JS boundary. When true: build the `other_stop` mask empty, and after matching, call `chronicle_app_usage_matcher::split_overlapping_sessions` on the paired sessions, emitting one output row per `LayeredSession` with a `usage_layer` string field (`"primary"`/`"secondary"`). When false: behavior and output schema unchanged (no `usage_layer` field).

- [ ] **Step 4: Thread the option through the worker and TS types**

In `web/src/lib/types.ts` confirm `model_concurrent_usage` is present (generated in Task 1). In the worker spec / options object passed to `processRawCsv*` in `web/src/lib/chronicleMatcher.ts`, ensure the option is forwarded to the WASM call. No matching logic lives in TS — it only passes the option through.

- [ ] **Step 5: Add a WASM unit test**

In the WASM crate tests, add a test that feeds two overlapping sessions and asserts the output rows carry the expected `usage_layer` values (mirror of `enclosed_session_makes_outer_secondary_during_overlap`).

Run: `cd rust/chronicle_app_usage_wasm && cargo test`
Expected: PASS.

- [ ] **Step 6: Build the WASM bundle and run web tests**

Run: `<the project's WASM build command — see web/package.json / scripts/>`
Run: `cd web && npm test -- chronicleMatcher`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add rust/chronicle_app_usage_wasm/ rust/chronicle_chrono_kernel_wasm/ web/src/lib/
git commit -m "feat(web): model_concurrent_usage WASM + worker integration"
```

---

## Task 7: Cross-surface parity + clean overlap fixture

**Files:**
- Create: `tests/test_concurrent_usage_parity.py`
- Modify: `scripts/run_web_parity_matrix.py` (extend to cover the flag)

- [ ] **Step 1: Write a clean overlap fixture builder**

Create `tests/test_concurrent_usage_parity.py` with a fixture builder that produces a single non-stacked block with deliberate overlaps (an enclosed pair, a partial-overlap pair, and a non-overlapping pair). Do NOT use the pathological fixture — its 32-deep stacking is unsuitable (see `/home/opt/eyes-parity/PARITY_REPORT.md`).

```python
"""Cross-surface parity for model_concurrent_usage on a clean overlap fixture."""

from __future__ import annotations

import polars as pl

from chronicle_preprocessing_app.config.constants import Column
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.preprocessing.polars_fast_path import (
    PolarsFastPathPreprocessor,
)


def _clean_overlap_raw() -> pl.DataFrame:
    rows = [
        ("Activity Resumed", "com.outer", "2026-01-01 08:00:00"),
        ("Activity Resumed", "com.inner", "2026-01-01 08:05:00"),
        ("Activity Stopped", "com.inner", "2026-01-01 08:15:00"),
        ("Activity Stopped", "com.outer", "2026-01-01 08:30:00"),
        ("Activity Resumed", "com.solo", "2026-01-01 09:00:00"),
        ("Activity Stopped", "com.solo", "2026-01-01 09:10:00"),
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


def test_flag_off_output_unchanged_vs_baseline():
    raw = _clean_overlap_raw()
    off = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=False)
    )._process_valid_app_usage(raw)
    assert Column.USAGE_LAYER not in off.columns


def test_flag_on_total_duration_conserved():
    """Sum of primary durations equals the sole-foreground timeline length."""
    raw = _clean_overlap_raw()
    on = PolarsFastPathPreprocessor(
        PreprocessingOptions(raw_data_folder="", model_concurrent_usage=True)
    )._process_valid_app_usage(raw)
    usage = on.filter(pl.col(Column.INTERACTION_TYPE) == "App Usage")
    primary = usage.filter(pl.col(Column.USAGE_LAYER) == "primary")
    # Outer 08:00-08:05 + inner 08:05-08:15 + outer 08:15-08:30 + solo 09:00-09:10
    assert primary.get_column(Column.DURATION_SECONDS).sum() == 300 + 600 + 900 + 600
```

- [ ] **Step 2: Run the parity tests**

Run: `pytest tests/test_concurrent_usage_parity.py -v`
Expected: PASS.

- [ ] **Step 3: Extend the web parity matrix to exercise the flag**

In `scripts/run_web_parity_matrix.py`, add a matrix entry that runs the deterministic desktop-vs-browser parity with `model_concurrent_usage=True` on the clean overlap fixture, asserting the desktop and browser layered outputs match row-for-row.

Run: `python scripts/run_web_parity_matrix.py`
Expected: all matrix entries (flag off and on) report parity.

- [ ] **Step 4: eyes-toolbox cross-check (optional oracle)**

Using the harness at `/home/opt/eyes-parity`, run the clean overlap fixture through eyes-toolbox's `separate_overlap_screen_time` and confirm our `primary`/`secondary` split matches its primary/`secondary_duration` semantics. Record the result in the spec's testing section if it diverges.

- [ ] **Step 5: Commit**

```bash
git add tests/test_concurrent_usage_parity.py scripts/run_web_parity_matrix.py
git commit -m "test: cross-surface parity for model_concurrent_usage on clean overlap fixture"
```

---

## Self-Review

**Spec coverage:**
- Opt-in flag, default off → Task 2; flag-off no-op verified → Task 5 Step 7, Task 7 Step 1.
- Interval-overlap inference → Task 3/4 `split_overlapping_sessions`.
- Split primary/secondary rows + `usage_layer` → Task 3/4 output, Task 5 row expansion.
- All three surfaces → Python (Task 5), Rust (Task 3), WASM/web (Task 6); parity (Task 7).
- LinkML SSOT → Task 1.
- Edge cases (identical-timestamp, enclosed, partial, no-overlap, mismatched length) → Task 3/4 tests.
- Non-goals (plotting, screen-usage) → not in plan; `_process_filtered_app_usage` left unchanged (Task 5 Step 3).

**Placeholder scan:** Build/codegen commands in Task 1 Step 5, Task 3 Step 6, Task 6 Step 6 are intentionally deferred to the executing agent because they depend on project scripts the agent must read from `web/package.json` / `scripts/`; every code change is fully specified.

**Type consistency:** `LayeredSession` (Rust) / `LayeredRow` (Python) fields — `session_index`, `start_ns`, `stop_ns`, `layer` — consistent across Tasks 3–5. `UsageLayer.PRIMARY/SECONDARY` = `"primary"`/`"secondary"` consistent. `Column.USAGE_LAYER = "usage_layer"` consistent across Tasks 2, 5, 7.
