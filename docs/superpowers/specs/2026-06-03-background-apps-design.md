# Background apps (background-stays-alive app usage) — design

**Date:** 2026-06-03
**Status:** IMPLEMENTED 2026-06-03 (all surfaces; cross-surface byte parity green).

## As-built (deviations from the original plan below)

The matcher change is **smaller** than originally planned, because most of the
behavior is expressible as per-event flag remapping that the *unchanged* matcher
already honors. Only the one thing flags cannot express went into Rust.

1. **Rust matcher** (`chronicle_app_usage_matcher`, bumped to 0.2.0): added a
   `background: &[bool]` param used in exactly one place — protecting a
   background app's open-start from being closed by another app's `other_stop`
   (dense `is_compatible_open_start_for_stop`; sparse `OtherApp`/`AnyApp`
   predicates). Threaded through both cores, all four pyo3 fns, and the WASM
   binding (rebuilt). Same_stop/stopped handling for background apps is NOT in
   the matcher — see (2).
2. **Flag remapping** (Python `polars_fast_path._process_usage_rows` + web
   `browserPipeline.buildMatcherInput`, symmetric): for a background app's
   events, `same_stop` fires ONLY on its own **re-resume** (segments the
   session — close prior, open new, exactly as a normal foreground app) and its
   **Activity Stopped**; backgrounding (pause) is suppressed. `stopped` is
   cleared (folded into same_stop). `other_stop` left intact (a background app
   foregrounding still closes other apps).
   - The re-resume → same_stop is **essential**: without it a background app
     resumed more often than it is Stopped (the normal shape of real usage)
     stacks overlapping open sessions that the splitter layers against itself,
     multiplying its counted time. Pinned by
     `tests/test_background_apps.py::test_multi_cycle_...`.
3. **Fast-path-only.** Background apps require the concurrent split (which is
   Polars-fast-path-only, like `model_concurrent_usage`). The split runs when
   `model_concurrent_usage OR background-active`, but `other_stop` emptying stays
   gated on `model_concurrent_usage` alone (normal apps keep clean-switch). The
   legacy path raises (reusing `allow_concurrent_usage_fallback`) rather than
   silently no-op'ing — `main_preprocessor`.
4. **build:wasm** out-dir was fixed (`../../web/src/wasm/...`): wasm-pack 0.14
   resolves `--out-dir` relative to the crate, so the old script wrote to a
   stray `rust/.../src/wasm/` and never updated the app-imported (force-tracked)
   `web/src/wasm/.../pkg`. Commit note: that pkg dir is gitignored (`*`) and
   force-tracked — `git add -f` the rebuilt bytes or the deployed site ships the
   old matcher.

---

## Original plan (superseded by As-built where they differ)
**Status:** design locked, implementation pending

## Problem
Apps like Spotify (audio) and Google Maps (turn-by-turn nav) keep running after
they are backgrounded — their activity emits `Activity Paused` / `Move to
Background` when you switch away, but a foreground service keeps the app active.
In Chronicle events their usage session therefore *ends* at the pause, so their
real usage while another app is foreground is undercounted. They were wrongly
placed in the apps-forcing-screen-open list (a screen-usage concept that does
not affect app-usage attribution).

This is the same shape eyes-toolbox `separate_overlap_screen_time` addresses
(overlap → primary/secondary), but eyes is purely event-driven and cannot infer
"this app keeps running backgrounded" — that must be **declared** via a curated
list. So the list is a new INPUT feeding the EXISTING primary/secondary
`usage_layer` OUTPUT machinery (`model_concurrent_usage`).

## Locked behavior
- A new curated **background-apps** list (bundled default + user-overridable
  file), e.g. `com.spotify.music`, `com.google.android.apps.maps`.
- For an app on the list: its app-usage session does **not** end at
  `Activity Paused`/`Move to Background`, nor when another app foregrounds; it
  stays alive until that app's own **`Activity Stopped`** (user-chosen bound).
- The resulting interval (background app alive while another app is foreground)
  overlaps the foreground session and is split by the existing concurrent-usage
  machinery: foreground app = `primary`, background app = `secondary`
  (`usage_layer`). To avoid double-counting, the background overlap is always
  routed through that split.

## Architecture (key insight)
There is ONE shared matcher: Rust `rust/chronicle_app_usage_matcher`. It is
called by:
- Python `polars_fast_path.py::_match_usage_updates` via the pyo3 binding
  `_rust_app_usage_matcher.match_app_usage_update_arrays` (with a pure-Python
  mirror `_match_usage_updates_python` for the fallback path), and
- the web via `rust/chronicle_app_usage_wasm` → `web/src/wasm/.../pkg`
  (worker `web/src/workers/chronicle-worker.ts`).

The matcher consumes per-event flag arrays: `app_codes`, `timestamp_ns`,
`resumed_flags`, `same_stop_flags`, `other_stop_flags`, `stopped_flags`. Each
surface builds these flags before the call.

## Implementation plan (file-level)

### 1. Matcher core — Rust `chronicle_app_usage_matcher/src/lib.rs`
Add a `background_flags: &[bool]` (per event, true when the event's app is on the
background list) param to `match_app_usage_update_arrays` (and the index
variant). In the matching loop: when the app for an open session is a background
app, ignore `same_stop` and `other_stop` for that session; close it only on a
`stopped` (Activity Stopped) event for the same app (respect the existing
`use_activity_stopped_as_fallback` / long-duration threshold rules). Non-list
apps unchanged. Bump the matcher version.

### 2. Rust bindings
- pyo3 `_rust_app_usage_matcher` (built from the matcher; find the pyo3 crate /
  `chronicle_chrono_kernel_py`) — add the new param; rebuild the wheel/module.
- `chronicle_app_usage_wasm/src/lib.rs` — thread the new param to JS; rebuild via
  `web/package.json` `build:wasm`.

### 3. Python `polars_fast_path.py`
- Build `background_flags` (numpy bool) from a background-apps dict on options,
  keyed by `app_package_name`.
- Pass to `_match_usage_updates` and mirror the ignore-stop logic in
  `_match_usage_updates_python`.
- Ensure the extended overlap reaches `_apply_concurrent_usage_split` (line 721).

### 4. Web `browserPipeline.ts` + worker
- Load the background-apps file (mirror `buildAppsForcingScreenOpenMap` /
  `resolveDefaultSupportFiles`); build a background-flag set; pass through the
  worker to the WASM matcher.

### 5. Options / contract / support file
- LinkML `web/schema/chronicle-local-contract.linkml.yaml`: new slot
  `use_background_apps_file` (mirror `use_apps_forcing_screen_open_file`).
  `npm run generate:contract`.
- Python `core/config.py`, `config/constants.py`, `config/defaults.py`: option +
  default + reader (mirror apps_forcing_screen_open). New
  `read_background_apps_file` util.
- New bundled file
  `web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv`
  with Spotify + Maps; remove them from the apps-forcing-screen-open file.
- UI: a support-file input (mirror apps-forcing-screen-open) in
  `FilesAndInputsCard.tsx` + `App.tsx` wiring.

### 6. Tests + parity
- `tests/test_concurrent_usage_parity.py`: fixture with a background app paused
  then another app foregrounded then Activity Stopped → assert primary/secondary
  split.
- `scripts/run_deterministic_web_parity.py`: a spec exercising the background list
  → cross-surface parity.
- Web unit test in `browserPipeline.test.ts`.

## Open coupling
Background-apps requires the concurrent split to avoid double-counting. Decision:
when the background feature produces an overlap, always route it through the
primary/secondary split (treat as concurrent) regardless of the
`model_concurrent_usage` toggle, OR have `use_background_apps_file` imply it.
Lean: imply concurrent split for background overlaps.

See memory: [[background-apps-vs-screen-open]], [[web-defaults-and-plot-ui]].
