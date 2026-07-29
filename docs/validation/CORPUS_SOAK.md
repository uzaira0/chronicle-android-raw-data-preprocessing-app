# Real-Corpus Soak — Dual-Engine Byte Parity on the Full Study Corpus

> **Frozen migration evidence.** The compared legacy engines were deleted after
> this result. This document records the cutover evidence; it is not a current
> instruction to restore or maintain either engine.

**Verdict (2026-07-20): 120/120 processable participants byte-identical
across the browser and desktop engines. Zero mismatched cells.**

The deterministic parity harness proves engine equivalence on the pathological
fixture; this soak proves it on the **entire real corpus** — every TECH and
GNSM personal-Android participant (95 + 29 = 124 raw files, ~1.35 M events) —
where the inputs fixture generation cannot anticipate actually live: real
millisecond timestamps, DST-crossing gaps, tie-landing rounding values,
vocabulary variants ("Screen Non-interactive", "Unknown importance: 23"),
Spanish app labels, and integral Play-Store ratings.

## How to reproduce

```bash
# 1. Reconstruct per-participant raw CSVs from the research-pipeline warehouse
#    (see the export script's docstring; runs in the pipeline repo's venv):
#    /home/opt/rp_work/corpus_soak/export_corpus_raw.py
# 2. Run every file through BOTH engines with the parity-pinned knobs and
#    byte-compare app + screen outputs:
PYTHONPATH=src .venv/bin/python scripts/run_corpus_soak.py \
    --corpus-root <raw-root> --out <results-dir>
```

Both engines read the IDENTICAL reconstructed file (11 fixture-shape columns,
event_timestamp rendered in the row's own timezone, ISO-8601 with colon
offset, millisecond precision), so any output difference is an engine
divergence, not an input artifact. Knobs are the `_desktop_options.py` parity
pins (codebook + filter + forcing-screen-open on, app+screen mode,
`selected-filter` America/Chicago, fixed preprocessing datetime).

## Final tally

| study | files | clean | mismatch | engine refusal |
|-------|-------|-------|----------|----------------|
| TECH  | 95    | 93    | 0        | 2              |
| GNSM  | 29    | 27    | 0        | 2              |

The 4 "engine refusal" participants (P1-1773-A-D1, P1-1790-A-D1 = all
America/New_York / America/Los_Angeles; P3-3029, P3-3082 = all
America/Los_Angeles / America/Belize) contain **zero** America/Chicago rows,
so the pinned `selected-filter` timezone handling drops every event.
Both engines refuse symmetrically: the desktop returns no output
(success=False, "No valid app usage data found") and the browser throws the
structured pipeline error "No valid app usage data during the study period".
Symmetric refusal, not a divergence.

## What the soak found (and what was fixed)

The first full run (pre-fix) had **0/120 clean** — every participant diverged
through at least one of five web-engine defect classes, none of which fixture
parity could see (fixture timestamps are whole-second; fixture values avoid
rounding ties and the small-float band):

| # | class | scale (pre-fix) | mechanism | fix (web, `browserPipeline.ts`) |
|---|-------|-----------------|-----------|--------------------------------|
| 1 | Screen `start/stop_timestamp` + `screen_usage_last_activity_timestamp` lose milliseconds | 120 files | fraction was hard-coded `".000000"`; desktop keeps real µs | splice `(ns/1000) % 1e6` into the formatted string |
| 2 | Small floats in exponential form | 117–120 files | web exponentialized below 1e-4; polars/ryu boundary is **1e-5** (`0.000095` decimal, `9.9e-6` exponential) | threshold corrected to 1e-5 |
| 3 | `duration_seconds`/`duration_minutes` last-ulp drift | 123 files | desktop = `whole_µs × (1/1e6)` reciprocal multiply (verified 115/115 sampled rows + a controlled 661 ms micro-fixture: desktop emits `0.6609999999999999`); web used true `ns/1e9` division (`0.661`) | `RECIP_1E6` reciprocal multiply, bit-identical; whole-second durations unaffected |
| 4 | `bcm_play_store_rating` `4` vs `4.0` | 5 files | desktop reads the codebook with `pl.read_csv(infer_schema_length=10000)` → Float64 column → `4.0`; web passed the raw string through | mirror the 10 000-row schema inference and float rendering in `buildCodebookMap` |
| 5 | `data_time_gap_hours` rounding | 5 files | desktop = polars `.round(2)`: f64 `×100` product, round **half to even**, `/100`, over a µs-reciprocal operand; web used `toFixed(2)` (half away from zero) over an ns-division operand | exact replica, differential-verified **0/22,145 mismatches** against polars on a randomized tie-dense battery |

Class 5 also exposed a wrong golden: the DST-crossing gap row in
`Aggregates Automatically Preprocessed.csv` had locked the web's divergent
`22.73`; the desktop (and polars, verified on both candidate operand doubles)
produces `22.72`. That single value was deliberately re-recorded via the
documented `UPDATE_GOLDEN=1` flow — the only golden byte changed by this
entire effort.

## Notes for re-runners

- The warehouse Delta tables are the ingested form of the original Chronicle
  downloads; reconstruction is semantically faithful (UTC micro-timestamps
  rendered back into each row's own timezone) but not byte-original. Both
  engines see the identical file, so parity conclusions are unaffected.
- GNSM study-tablet Chronicle data is intentionally excluded — the v1 engine
  does not process the shared-tablet stream.
- The soak is re-runnable after any engine change; a clean run prints a
  summary with `"mismatch": 0` everywhere and exits 0.
