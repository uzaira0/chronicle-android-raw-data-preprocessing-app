# Changelog

All notable changes to the Chronicle Android Raw Data Preprocessing App.

Versioning policy: the app version (`web/package.json` → `version`, mirrored in
`CITATION.cff`) tracks releases; the **processing contract version**
(`web/schema/contract-baseline.json` → `contractVersion`) tracks the
research-facing option/output contract. Any BREAKING contract change
(removed/renamed option keys, type or default changes, removed output columns
or enum values — enforced by `scripts/check_contract_compat.mts`) requires a
`contractVersion` bump, an entry here, and a `SETTINGS_SCHEMA_VERSION`
migration in `web/src/lib/settingsPersistence.ts`. Cite the contract version
alongside the app version in methods sections — both are recorded in every
run's processing report and provenance sidecar.

## [Unreleased] — contract version 6

### Changed (BREAKING, workflow contract v6)

- **The defaults are now "Default Preprocessing (No Cleaning)".** Preprocessing
  turns raw events into usage records without judging the data; cleaning (any
  step that removes, blanks or re-credits records on a data-quality judgment) is
  optional and off by default, in its own "Optional cleaning" section of
  Settings. `minimum_usage_duration` therefore defaults to **0** (it was 60):
  sub-minute sessions keep their durations unless a study turns the floor on.
- **Built-in presets:** "Default Preprocessing (No Cleaning)" and "TECH/GNSM
  (personal phones)" — 60 s minimum usage, filter file, no maximum session
  length (1,000,000 h), screen-gated credit truncated at 6 h, America/Chicago.
  The maximum session duration now accepts up to 1,000,000 h (was 48 h).
- **Neutral wording:** usage attributed to someone other than the target
  participant is `Non-Target Participant App Usage` (was `Non-Target Child App
  Usage`; only with person attribution on), and the app-usage plot title says
  "(Excluding Filtered Apps)" (was "(Target Child Only)"). The raw `username`
  value "Target Child" is Chronicle's own and is still recognized.
- The study-window filter step is labelled a cleaning step ("Study-window
  filter") in the workflow graph.
- `SETTINGS_SCHEMA_VERSION` 16 retires 60 s as a default: active settings,
  saved presets, projects and exported configurations written by an earlier
  build that hold a 60 s minimum usage duration load with 0. Any other value is
  kept, and a 60 s saved by this version or later is kept. A study that wants
  the 60 s floor sets it in Optional cleaning or loads the TECH/GNSM preset.

### Removed (BREAKING, workflow contract v5)

- **One session-grouping policy is no longer offered.** The 30-second
  `session_grouping_policy` arm was ported from a published analysis notebook
  that carries no licence, so it is not distributed with this repository. The
  remaining policies are unchanged.
- No `SETTINGS_SCHEMA_VERSION` migration: `session_grouping_policy` is a closed
  research-axis vocabulary, and loading any settings, preset, project or
  imported configuration already returns a value outside it to the default
  `none`. A saved selection of the removed arm therefore loads as no session
  grouping, and the kernel refuses the value in a request.

### Changed (BREAKING, workflow contract v4)

- **`timezone_handling` now defaults to `selected-convert`** (was
  `selected-filter`). Rows whose timezone differs from the selected one are
  converted to it instead of dropped, so no row is lost for carrying a
  different timezone and all day attribution is on one clock. This is what
  the studies' locked configuration runs and matches the kernel's absent-key
  default. Set `selected-filter` to restore the old behavior.
- Requires `SETTINGS_SCHEMA_VERSION` 13. No migration entry: since v12 a save
  holds an option key only when the researcher chose it, so an untouched save
  adopts the new default and a saved explicit `selected-filter` is kept.

### Fixed (settings and export metadata 2026-08-24)

- Saved settings pinned the defaults that were current when they were first
  written, so a browser that had opened the app before 2026-07-15 kept showing
  **Use filter file** switched on (plus `minimum_usage_duration = 0` and
  `proximity_interval_seconds = 0`) even though the shipped defaults had
  changed. `persistOptions` now stores only the diff from the shipped
  defaults, so untouched options always follow the current contract, and
  `SETTINGS_SCHEMA_VERSION` 11 → 12 migrates existing stores by dropping
  values that are identical to the superseded default. Values the user
  actually chose are preserved. This generalizes the standing migration rule:
  an absent key already took the current default, and a key the app itself
  wrote when that value *was* the default now behaves the same way.
- ZIP downloads wrote zeroed MS-DOS last-modified fields, so every extracted
  file claimed **1979-11-30**. `createZipBlob` now writes a real DOS
  date/time (clamped to the 1980 epoch) into both the local and central
  headers. The `preprocessor_version` / `datetime_of_preprocessing` columns
  inside the files were always correct.

### Changed (BREAKING, workflow contract v3)

- **`include_app_usage_end_reason` now defaults to on.** The app-usage output
  carries an `app_usage_end_reason` column recording why each episode ended.
  Distinguishing an observed end from a repaired or inferred one is the point
  of running the reconstruction rules at all, and the two are indistinguishable
  in the duration column, so this is reported by default rather than on
  request. Turn the option off to restore the narrower column set.
- Cell values name what happened to the device — `Same-App Stop Event`,
  `Another App Opened`, `Screen Turned Off`, `Inactivity Timeout`,
  `Device State Change`, `End of Data`, `No Observed End` — never the rule that
  inferred it. The selected reconstruction rule is already recorded separately
  and determines which values can appear.
- Requires `SETTINGS_SCHEMA_VERSION` 3. A stored envelope below that version is
  rewritten through the live sanitizer on read: an option key absent from the
  save takes the current default, so an existing save adopts the column, while
  a saved explicit choice is kept.

### Changed (workflow contract v2)

- Replaced the numbered pipeline-step surface with a generated workflow
  contract that separates semantic operations, execution queries,
  presentation, checkpoints, and evidence. Query-group and query identifiers
  now replace the former node/step identifiers in manifests and provenance.
- Added a Pipeline Explorer with decision impact, data-lineage, execution, and
  audit views. Configuration changes expose their transitive affected-query
  closure instead of relying on positional pipeline descriptions.
- Carved attribution completeness from compliance classification so changing
  the classification threshold reuses the expensive upstream aggregation.
- Moved browser workspace storage to the workflow namespace. Legacy workspace
  directories are detected but never opened, migrated, or deleted; the UI
  gives explicit export/cleanup guidance.
- Persisted settings schema v2 re-sanitizes v1 option envelopes. Option meaning
  is unchanged; the migration records the workflow-contract transition.

### Removed (desktop engine fully deprecated)

- The Python desktop engine (`src/chronicle_preprocessing_app/` — PyQt6 GUI +
  Polars pipeline), its pytest suite (`tests/`), the PyO3 chrono kernel crate
  (`rust/chronicle_chrono_kernel_py`), Python packaging (`pyproject.toml`,
  `requirements.txt`, `bandit.yaml`), and the desktop-dependent harnesses
  (`run_deterministic_web_parity.py`, `run_web_parity_matrix.py`,
  `run_metamorphic_suite.py`, `run_corpus_soak.py`, `run_desktop_processing.py`,
  `_desktop_options.py`, `run_mutmut_forksafe.py`, `run_profile_baseline.py`,
  `bench_python_kernels.py`, fixture builders, `run_security_checks.sh`).
  The web engine is the single engine; the web golden scenarios are the sole
  behavioral reference. Final dual-engine evidence is frozen in
  `docs/validation/CORPUS_SOAK.md` (124-file byte-parity, zero mismatches) and
  `docs/perf/BASELINE.md`. The parent of this commit is the last ref carrying
  the desktop tree.
- The `research-pipeline` monorepo, which imported `chronicle_preprocessing_app`
  as an editable path dependency, was repointed on 2026-08-25 to a frozen
  worktree at tag `july16-production-engine` (`431f326bc`; `b003bae6c` after the 2026-10-03 history rewrite, same tree).
- The leftover Python packaging stubs `MANIFEST.in` (which still packaged
  `src/*.py` and `pyproject.toml`) and the root `__init__.py` were removed.
- `rust/chronicle_app_usage_matcher` is retained: the web WASM crates depend
  on it as a library (`default-features = false`).

### Fixed (cross-engine parity, real-corpus soak 2026-07-20)

A full-corpus soak (every TECH + GNSM personal-Android participant, 124 raw
files, identical inputs through both engines — `scripts/run_corpus_soak.py`)
surfaced five web-engine divergences from the desktop reference that fixture
parity could not see, all fixed byte-exactly:

- Screen-surface `start_timestamp` / `stop_timestamp` /
  `screen_usage_last_activity_timestamp` hard-coded a `.000000` fraction; real
  millisecond timestamps are now rendered (`…45.801000-06:00`), matching the
  desktop.
- Small floats in `*_time_gap_hours` / `*_tail_gap_seconds` used exponential
  notation below 1e-4; the polars/ryu boundary is 1e-5, so the [1e-5, 1e-4)
  band now prints in decimal expansion (`0.000041666666666666665`).
- `duration_seconds` used true ns/1e9 division; the desktop engine's app-usage
  durations are a reciprocal multiply over whole microseconds
  (`µs × (1/1e6)`), which differs in the last ulp on fractional-millisecond
  durations (`0.6609999999999999` vs `0.661`). The web engine now reproduces
  the desktop doubles bit-for-bit (`RECIP_1E6`).
- Codebook columns that polars types as Float64 (e.g. `bcm_play_store_rating`)
  printed integral values as `4` instead of the desktop's `4.0`; the browser
  now mirrors the desktop's schema inference (first 10 000 rows) and float
  rendering.
- `data_time_gap_hours` rounded with JS `toFixed` (half away from zero on a
  ns-division operand); the desktop is polars `.round(2)` — half to EVEN on
  the f64 `×100` product of a µs-reciprocal operand. Replicated exactly
  (0/22,145 mismatches on a randomized tie-dense differential battery). One
  golden value was deliberately re-recorded (`22.73` → `22.72`, the DST-gap
  row in `Aggregates Automatically Preprocessed.csv`): the old golden pinned
  the web's divergent rounding, not the desktop reference.

### Fixed (input robustness, fuzzing 2026-07-20)

- `discoverTimezonesFromRawCsv` leaked a raw `RangeError` from
  `Intl.DateTimeFormat` when a file carried an invalid IANA timezone with a
  parseable timestamp; it now throws the pipeline's structured error, matching
  the graph-engine path.

### Added

- `scripts/run_corpus_soak.py` — full-corpus dual-engine byte-comparison
  harness; report in `docs/validation/CORPUS_SOAK.md`.
- Desktop execution-lineage symmetry: per-stage execution records and a
  `chronicle-provenance.jsonld` sidecar from the Python engine, SHACL-validated
  against the shared ontology.
- `docs/METHODS.md` — researcher-facing methods document generated from the
  LinkML ontology/contract (byte-reproducible, gated in `make -C web/schema
  check`).
- Raw-CSV boundary fuzzing (`web/src/lib/browserPipelineFuzz.test.ts`).
- `CITATION.cff` / `.zenodo.json` for citable releases.
- Web mutation-score burn-down (2026-07-20): 83.54% → **96.22%** on the full
  widened Stryker scope (+160 targeted mutation-killing tests across stages,
  steps, engine, executionRecords, processingReport; suite 747 → 907 tests).
  All remaining survivors are documented-equivalent mutants; `ignoreStatic`
  enabled with an in-config justification (module-load wiring literals are
  vitest-runner false-survivors — exact-value assertions demonstrably do not
  kill them). Thresholds ratcheted to high 95 / low 90 / **break 93**.
- `scripts/run_mutmut_forksafe.py` (used by `make mutation-python`): mutmut 3
  forks a child per mutant after warming polars' rayon thread pool in-process;
  the pool threads don't survive the fork, so every polars-covered mutant
  deadlocks and is misfiled as a timeout (observed 3,727/5,038). The wrapper
  execs mutant test runs as fresh pytest subprocesses. First honest desktop
  baseline: 2,293/4,067 covered mutants killed (56.4%), 971 uncovered (mostly
  optional-Rust-matcher glue). Also fixed a thread-count-sensitive exact float
  `==` on a parallel polars sum in `test_filtered_interrupt_leak.py` (now an
  order-independent per-row multiset comparison).

## [1.0.0] — contract version 1

Initial contracted release: dual-engine (browser + desktop) preprocessing with
byte-exact parity harness, golden scenarios, query-registry executable pipeline
graph, LinkML/OWL/SHACL research ontology, per-run PROV provenance sidecar,
mutation-tested validation suite, and CI gates (typecheck, tests, contract
compatibility, gate-truth, schema reproducibility).
