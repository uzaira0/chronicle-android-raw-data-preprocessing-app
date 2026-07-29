# Changelog

All notable changes to the Chronicle Android Raw Data Preprocessing App.

Versioning policy: the app version (`pyproject.toml` / `web/package.json`)
tracks releases; the **processing contract version**
(`web/schema/contract-baseline.json` → `contractVersion`) tracks the
research-facing option/output contract. Any BREAKING contract change
(removed/renamed option keys, type or default changes, removed output columns
or enum values — enforced by `scripts/check_contract_compat.mts`) requires a
`contractVersion` bump, an entry here, and a `SETTINGS_SCHEMA_VERSION`
migration in `web/src/lib/settingsPersistence.ts`. Cite the contract version
alongside the app version in methods sections — both are recorded in every
run's processing report and provenance sidecar.

## [Unreleased] — contract version 1

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
- ⚠ The `research-pipeline` monorepo installs this repo as an editable path
  dependency and imports `chronicle_preprocessing_app` from the working tree;
  it must be repointed (vendored copy or pinned pre-removal ref) before this
  removal is checked out or merged on the production machine.
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
byte-exact parity harness, golden scenarios, 55-step executable pipeline
graph, LinkML/OWL/SHACL research ontology, per-run PROV provenance sidecar,
mutation-tested validation suite, and CI gates (typecheck, tests, contract
compatibility, gate-truth, schema reproducibility).
