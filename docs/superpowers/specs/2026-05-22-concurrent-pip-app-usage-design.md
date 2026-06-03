# Concurrent (Picture-in-Picture) app-usage modeling — design

- **Date:** 2026-05-22
- **Status:** Approved (design); pending implementation plan
- **Branch:** `feature/concurrent-pip-app-usage`

## Motivation

A differential parity run against the ACOI-UofSC `eyes-toolbox` pipeline showed
that our preprocessor uses a strict single-foreground model: when app B is
foregrounded, app A's usage session ends. Genuine concurrent usage is real —
Picture-in-Picture, split-screen, and multi-window all put two apps in front of
the user at once. eyes-toolbox models this with its `separate_overlap_screen_time`
("nest") stage, which splits overlapping app sessions into a primary and a
`secondary_duration`. Our pipeline has no equivalent: on real PiP data it
**undercounts the backgrounded-but-visible app**. This feature adds an opt-in
concurrent-usage model so that overlap is captured rather than discarded.

## Decisions (settled during brainstorming)

1. **Detection:** interval-overlap inference. No new event type — concurrency is
   inferred post-hoc from app sessions whose `resume → stop` intervals overlap.
2. **Output shape:** split into separate `primary` / `secondary` rows carrying a
   `usage_layer` field — the same shape as eyes-toolbox's nested CSV.
3. **Rollout:** opt-in `PreprocessingOptions` flag, default **off**. With the
   flag off, output is byte-identical to today; existing studies stay comparable.
4. **Scope:** all three surfaces at once — Python matcher, Rust matcher
   (`chronicle_app_usage_matcher`), and web/WASM — with the parity matrix green.

## Goals

- An opt-in `model_concurrent_usage` option that, when enabled, attributes
  overlapping app-usage time to a `primary` (sole-foreground) layer and a
  `secondary` (running-underneath / PiP) layer.
- Identical results across Python, Rust, and WASM surfaces.
- Zero behavior change when the flag is off.

## Non-goals (v1)

- Plotting treatment of secondary rows (app-usage plots).
- Concurrency modeling in screen-usage mode.
- A distinct detection path for an explicit PiP event (none exists in Chronicle
  data).

## Architecture — two phases (Approach A)

### Phase 1 — mask construction (no matcher-core change)

The app-usage matcher already accepts four boolean masks per event:
`resumed`, `same_stop`, `other_stop`, `stopped`. The `other_stop` mask is what
makes another app's foregrounding end the current session.

When `model_concurrent_usage` is enabled, the preprocessor builds the
`other_stop` mask **empty**. Sessions then run `resume → own same-app stop`,
falling back through the existing long-duration-threshold / Activity-Stopped /
`END_OF_USAGE_MISSING` logic exactly as today. The Rust, Python, and WASM
matcher cores are **unchanged** — only mask construction differs.

This phase produces possibly-overlapping per-app sessions: `(app, start, stop)`.

### Phase 2 — overlap-split (new shared unit)

A pure function:

```
split_overlapping_sessions(sorted [(app, start_ns, stop_ns)])
    -> [(app, start_ns, stop_ns, usage_layer)]
```

Sweep-line over all interval boundaries. In each sub-interval between two
consecutive boundaries, the set of currently-open apps is known; the open app
with the **most recent resume** is `primary` (the app the user is actively in),
and every other still-open app is `secondary` (running underneath). Emit one row
per `(app, sub-interval, layer)`. Coalesce adjacent same-app same-layer
sub-intervals. Drop zero-length sub-intervals.

This matches eyes-toolbox `separate_overlap_screen_time` semantics. It is
implemented once in Rust, exposed through the existing pyo3 binding and the
WASM crate; a Python mirror backs the matcher's Python fallback path.

## Components and files

| Surface | File | Change |
|---|---|---|
| Rust | `rust/chronicle_app_usage_matcher/src/lib.rs` | add `split_overlapping_sessions` + pyo3 binding |
| Rust/WASM | `rust/chronicle_app_usage_wasm/src/lib.rs` (or shared crate) | expose the same function |
| Python | `core/preprocessing/algorithms/app_usage_algorithms.py` | Python mirror of the split (fallback parity) |
| Python | `core/preprocessing/app_usage_preprocessor.py` | flag-gated empty `other_stop` mask; invoke split; emit layered rows |
| Python | `core/config.py`, `config/constants.py`, `config/defaults.py` | new `model_concurrent_usage: bool = False` + `DEFAULT_` |
| Web | `web/src/lib/chronicleMatcher.ts` | flag-gated mask construction; call the WASM split |
| Schema (SSOT) | `web/schema/chronicle-local-contract.linkml.yaml` | new `model_concurrent_usage` option slot; new `usage_layer` output column |
| Web types | regenerated TypeScript types | via `generate-api-types` from the LinkML schema |

## Data flow

```
raw CSV
  -> existing preprocessing (timestamp, timezone, columns)
  -> app-usage matcher
       Phase 1: other_stop mask empty when model_concurrent_usage on
  -> Phase 2: split_overlapping_sessions   (only when flag on)
  -> column preprocessor
  -> preprocessed CSV
```

Flag **off:** Phase 2 skipped, no `usage_layer` column, output unchanged.

## Output format

When `model_concurrent_usage` is on:

- Each App-Usage interval becomes one or more rows.
- New column `usage_layer` ∈ {`primary`, `secondary`}.
- `start_timestamp` / `stop_timestamp` on a split row reflect the sub-interval
  bounds, not the original session bounds.
- `duration_seconds` / `duration_minutes` are per-row (per sub-interval).
- `minimum_usage_duration` and `filter_zero_duration_sessions` apply per row,
  as today.

When off: no `usage_layer` column; rows and durations unchanged.

## Edge cases

- **Identical-timestamp resumes:** resolved deterministically by input order, so
  zero-second slivers do not swallow each other (the failure mode seen in the
  pathological-fixture parity run).
- **Enclosed / partial / chained overlaps:** handled by the sweep-line.
- **Sessions with no own-stop:** Phase-1 fallback path (long-duration threshold,
  Activity-Stopped fallback, `END_OF_USAGE_MISSING`) is unchanged.
- **Zero-length sub-intervals:** dropped before emission.

## Testing and parity

- Unit tests for `split_overlapping_sessions`: enclosed, partial, chained,
  identical-timestamp, and no-overlap inputs — in Rust and Python, asserting
  identical output.
- The Python ↔ Rust ↔ WASM parity matrix must stay green with the flag both
  **off** and **on**.
- A dedicated clean (non-stacked) overlap fixture for tests — distinct from the
  pathological fixture, whose 32-deep stacking is unsuitable.
- Cross-check: the eyes-toolbox harness at `/home/opt/eyes-parity` serves as an
  external oracle for the split semantics on the clean overlap fixture.

## Rollout

Flag defaults off. Existing outputs and studies are unaffected until a study
explicitly opts in. No migration required.
