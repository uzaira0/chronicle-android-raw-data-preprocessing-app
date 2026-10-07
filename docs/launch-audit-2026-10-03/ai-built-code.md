# AI-built code checklist — chronicle-android-raw-data-preprocessing-app

Branch `wip/literature-components-20260917` @ 55533851, 2026-10-03. Report-only (no repo edits).
Paths: `web/…` relative to repo root; `kernel/` = `rust/chronicle_chrono_kernel_wasm/src/`.
Commands executed (real exit codes captured to logs in this directory): `npm run check:contract` exit 0
(`check-contract.log`), `npm run check:boundary` exit 0 (`check-boundary.log`), `knip` exit 0 (`knip.log`),
`npm run check:axis-completeness` exit 0 (`fork-options/axis.log`), three vitest revert-the-fix runs
(`fork-tests/mut*.log`), AST scan of every `<button>/<input>/<select>` (`w1/buttons.cjs`).
Full Playwright chromium evidence: `../base-full-chromium.clean.log` (51 failed / 889 passed / 6 skipped).

Counts: **PASS 34 · FAIL 29 · N/A 2** (65 items).

## FAIL rows, ranked by severity

| ID | item | status | evidence | proposed fix |
|---|---|---|---|---|
| S2 | No masking defaults | FAIL | Importing any JSON (`[]`, `{}`) resets settings to defaults and replaces every preset with `[]`, persisted at once (settingsPersistence.ts:604-611, SettingsManagementCard.tsx:270-278, :100-102). Rust maps unknown enum values to the default (kernel/pipeline/options.rs:140-145) | Refuse files without a config envelope; refuse unknown enum values |
| S3 | No optimistic success | FAIL | "Preset saved" (SettingsManagementCard.tsx:122), "Deleted the processed results." (App.tsx:3461-3464) and "Reprocessed X." (App.tsx:2880-2886) show whatever the write outcome | Show the toast only after the awaited write succeeds |
| T8 | Suite runs in gate | FAIL | The gate e2e is `--grep @smoke` only: 28 tags in 5 of 34 specs. A full chromium run had 51 failures (base log:3437). `tests/test_android_profile_compound_coverage.py` has no runner. The axis gate checks 5 of 14 axes using `includes(key)` (check_axis_completeness.mts:158-165) | Run the full e2e suite in `make all`; wire up or delete the .py test; gate every implemented axis |
| T10 | E2E selectors match DOM | FAIL | 40 failures waiting on one locator ("Load supported preprocessing settings" `toBeDisabled`); 5 "element(s) not found" (base log) | Re-verify selectors against the rendered DOM; record a green full run |
| S8 | Severity matches impact | FAIL | A failed restore deletes saved results with no log or notice (App.tsx:876-881) | Log at error, keep the record, offer an explicit reset |
| K2 | Enum sets diffed by test | FAIL | The parity test covers 5 of 25 enum axes (kernel/pipeline_v2.rs:3706). The other 20 arrive as `String` (options.rs:1996-2123) | Run a table-driven parity test over all 25 axes against the contract |
| C5 | Version/doc references current | FAIL | CITATION.cff:8-15 and .zenodo.json:3 claim "dual-engine… byte-exact cross-engine parity". CHANGELOG says "contract version 3" and cites pyproject.toml, but the baseline is 4. MANIFEST.in packages a nonexistent `src/*.py`. README says gaps are "(WIP)", yet they are implemented | Rewrite the citation metadata and CHANGELOG; delete MANIFEST.in and `__init__.py` |
| D1 | License attribution shipped | FAIL | `dist/` ships React, comlink (Apache-2.0), xyflow and papaparse JS, plus Apache arrow inside the WASM. grep for license text in dist/assets: 0 hits; no notices file | Generate a third-party notices file into `dist/` |
| D4 | Reproducible pins | FAIL | rust-toolchain.toml has `channel = "stable"` (floating), yet `wasm-fresh` demands byte-identical WASM. web/ has both package-lock.json and bun.lock. `--with pyshacl` is unpinned (web/schema/Makefile:18). Python `yaml`/`docx` imports are undeclared | Pin the Rust version; keep one JS lockfile; pin pyshacl |
| S7 | Invariants in release | FAIL | Checkpoint/digest integrity checks are debug-only (kernel/pipeline/checkpoint.rs:1279-1475; sequential.rs:2289-2304; pipeline_v2_incremental.rs:5842,6361) | Promote the cheap length/protocol checks to `assert!` |
| B2 | Parsers bounded first | FAIL | Raw CSVs are read whole with `file.arrayBuffer()` and no byte cap (App.tsx:2401,2417,2823). The 950k-row ceiling is only a warning after parsing (fileInspection.ts:51-63) | Check `File.size` before reading and refuse above the wasm32 bound |
| W8 | Feature in every layer | FAIL | The codebook documents 2 of 9 delivered CSVs; Credited App Usage and 6 others are missing (researcher-output-codebook.md:14,94 vs rustPipelineAuthority.ts addCsvOutput) | Add those columns to chronicle-output-columns.yaml |
| S1 | No swallow on write path | FAIL | `persistOptions`/`persistPresets` swallow errors (settingsPersistence.ts:536-539, 568-570). saveLastRun/clearLastRun use `.catch(()=>{})` (App.tsx:2880, 3461) | Return the outcome and surface failure |
| T5 | No silent skips | FAIL | 36 unit tests and 10 e2e tests skip when a gitignored private library is absent (methodProfileDeviceSessions.test.ts:34; research-method-profile-import.spec.ts:674+). An `it.runIf` env var is never set (literatureComponentRuntime.integration.test.ts:294). 3 bare `#[ignore]` | Commit a synthetic fixture; add reasons/issues; fail when the skip count rises |
| K5 | Uniform error shape | FAIL | Errors are classified by message text (rustPipelineRuntime.ts:6467-6470; opfsArtifactStore.ts:544-554) | Use typed error codes across the WASM boundary |
| Q2 | Read-modify-write guarded | FAIL | Presets/settings are last-write-wins across tabs with no `storage` listener, and a test accepts this (persona-multi-tab.spec.ts:60-86; SettingsManagementCard.tsx:100-102) | Re-read and merge on the `storage` event |
| K4 | Old clients still work | FAIL | ProjectRecord has no schema version (projectsStore.ts:32-47). The superseded-default migration covers active settings only (settingsPersistence.ts:472) | Version projects and presets; apply the migrations to them |
| M3 | Destructive migrations guarded | FAIL | The last-run record is deleted on schema mismatch or a read error, with no archive (lastRunStore.ts:238-249) | Notify the user and keep a copy before deleting |
| S9 | Fallback paths tested | FAIL | The clearLastRun-failure path of delete is untested. The swallow tests assert only `not.toThrow` (settingsPersistence.test.ts:740,818) | Test that the failure reaches the user |
| S5 | Background failure surfaced | FAIL | OPFS reclaim and spill-sweep failures go to the console only or are swallowed (App.tsx:632; payloadSpill.ts:107,214) | Report them in the storage-pressure banner |
| B6 | Outbound timeouts | FAIL | No fetch has a timeout. The SW navigation is network-first (sw.js:192). AppListsPanel.tsx:24 ignores `response.ok` | `AbortSignal.timeout`; check `ok` |
| K6 | Unambiguous time | FAIL | Naive timestamps are silently treated as UTC (kernel/lib.rs:214-219). `format_chronicle_timestamp_ns` emits strings with no zone (lib.rs:225-235) | Emit `Z`; flag naive inputs |
| K7 | Units named | FAIL | `minimumUsageDuration` and `customAppEngagementDuration` (s), and `longUsageDurationThresholds` and `longDataTimeGapThresholds` (h), carry no unit (generatedContract.ts:820-831; options.rs:22-46) | Add unit suffixes plus a settings migration |
| C3 | Unsafe config refused | FAIL | An unknown enum value computes the default instead of being refused (options.rs:140-145, 210-218) | Make `from_canonical_id` return a `Result` |
| C7 | Rule implemented once | FAIL | Defaults exist twice: generatedContract.ts:971-1063 and options.rs:2198-2297. The test compares against literals (pipeline_v2.rs:5641) | Generate the Rust defaults from LinkML |
| C4 | Documented commands run | FAIL | The documented `playwright test` fails (51). The heavy targets were not executed (out of audit scope), so they are unverified | Fix e2e, then run `make all` |
| C1 | Env vars documented | FAIL | About 70 tooling env vars, e.g. `CHRONICLE_DEKKER_ORACLE_DIR` and `SLEEP_SCORING_WEB_ROOT`, are documented nowhere; there is no example env file | Add an env inventory |
| T1 | Tests assert behavior | FAIL | semanticIndex.test.ts:289 asserts nothing. validation.test.ts:220 asserts inside a loop over a possibly-empty map | Add real assertions plus a non-empty check |
| Q3 | One-per-X enforced | FAIL | Preset-name uniqueness is checked only in savePreset (SettingsManagementCard.tsx:134-140); import does not dedupe (settingsPersistence.ts:573-577) | Dedupe in `sanitizePresets` |

## PASS and N/A rows

| ID | item | status | evidence | proposed fix |
|---|---|---|---|---|
| W1 | UI controls reach a handler | PASS | The AST scan (`w1/buttons.cjs`) over 52 .tsx files and 86 `<button>` tags found no button/input/select without an `on*` handler, spread, `disabled` or a submit/hidden type. The full e2e run passed 889 flows (its failures are under T10) | — |
| W2 | Every endpoint has a caller | PASS | Each exported WASM function in `web/src/wasm/*/pkg/*.d.ts` has a production caller in `src/`. Only `initSync` (tests) and classes returned by value have none. `knip` exit 0 | — |
| W3 | Written settings are read | PASS | All 90 `BROWSER_PROCESSING_OPTION_KEYS` (generatedContract.ts:417-513) have a UI control. 88 are sent by `buildRustV2Options` (rustPipelineRuntime.ts:3670-3790) and all 90 `PipelineV2OptionsJson` fields (`deny_unknown_fields`, options.rs:1901) have a production read. `parallel*` is read at App.tsx:2235-2267. Every localStorage key written is also read. (The gate weakness is recorded under T8) | — |
| W4 | Offered values accepted end to end | PASS | UI selects are built from the generated `*_VALUES`. All 21 Rust `from_canonical_id` matches handle every contract value; B06 is strict (b06_maximum_duration.rs:812-825); timezone handling at stages/source.rs:751-780 | — |
| W5 | No orphan schema | PASS | Two IDB stores (lastRunStore.ts:128, projectsStore.ts:60), each read and written; every localStorage key has a reader; knip is clean. Note: a non-incremental kernel build emits 46 dead-code warnings (`check-contract.log`, e.g. annotations.rs:132); production uses `incremental-v2` | Optional: `cfg`-gate the incremental-only functions |
| W6 | No reachable stubs | PASS | `git grep TODO\|FIXME\|not implemented\|coming soon` over web/src (non-generated) and the kernel src: 0 hits outside vendor/docs comments | — |
| W7 | Generated artifacts regenerate identically | PASS | `npm run check:contract` exit 0 (contractVersion 4, codebook ok); `npm run check:boundary` exit 0; both run in `make web` | — |
| S4 | Partial writes visible | PASS | Batch keeps per-file errors plus `unfinishedFileNames` (App.tsx:2630-2640); OPFS commits through alternating root slots (opfsArtifactStore.ts:556+); durability-fault-injection.spec.ts | — |
| S6 | Retries bounded and classified | PASS | No automatic retry loops; permanent vs indeterminate OPFS refusals are distinguished (opfsArtifactStore.ts:105-152); worker eviction then explicit retry (rustWorkerClient.ts:149-263) | — |
| T2 | Mutation spot-check | PASS | Reverted fixes in a `git archive` copy: 13c94473 (settingsPersistence.ts:472) → settingsPersistence.test.ts exit 1; eee80bef escapeXml (plotScene.ts:170) → plotScene.test.ts exit 1; eee80bef v4 protocol → rustPipelineAuthority.test.ts exit 1 (`fork-tests/mut*.log`) | — |
| T3 | Fixtures omit the result | PASS | settingsPersistence.test.ts:77,277,282 fill defaults from `{}`/`null`/junk; projectsStore.test.ts:141 | — |
| T4 | Mocks stop at boundary | PASS | No `vi.mock` in the opfs/projects/progress/settings tests; rustPipelineRuntime.persistence.test.ts:31 mocks a collaborator via `importOriginal` | — |
| T6 | Error paths tested | PASS | persona-adversary, durability-fault-injection, durability-capability-gate specs; settingsPersistence junk-input tests; preflight-refusal tests in rustWorkerClient | — |
| T7 | Integration on real browser | PASS | Playwright drives the real worker + WASM (no runtime mock; e2e/helpers.ts:18-31 pins only a timestamp and toggles). Caveat: injected toggles set `provenanceEvidence: true`, the opposite of the product default | Add one smoke test without injection |
| T9 | Compile-time guards are values | PASS | No type-only `Expect<>`/`never` guards; 70 value-level `satisfies Record<Enum,string>` (e.g. SessionDetectionCard.tsx:100-208) | — |
| K1 | Client types generated from the contract | PASS | generatedContract.ts from LinkML; generatedRuntimeBoundary.ts from Rust types; both `--check` in `make web` (exit 0 above) | — |
| K3 | Nullability matches | PASS | The browser boundary validator is generated from Rust serde types (`check:boundary` exit 0) | — |
| M1 | DB constraints | N/A | No database server; client storage is two keyPath-only IDB stores and content-addressed OPFS (SHA-256 keys) | — |
| M2 | Migrations tested | PASS | Settings v12/v14/v15 migrations are tested and killed a revert (T2); IDB versions are still 1; OPFS resume formats fail closed on a magic mismatch (CLAUDE.md, persistence.rs) | — |
| M4 | New fields default | PASS | `sanitizeOptions` fills absent keys from `DEFAULT_BROWSER_OPTIONS`; tested with `{}` (settingsPersistence.test.ts:77) | — |
| M5 | Non-guessable IDs | PASS | `safeUuid` = `crypto.randomUUID`/`getRandomValues` (uuid.ts:9-17) | — |
| M6 | Soft delete respected | PASS | The last-run deleted fence is checked before every read (lastRunStore.ts:225-231); projects hard-delete (projectsStore.ts:120) | — |
| M7 | UTC timestamps stored | PASS | `savedAt: new Date().toISOString()` (lastRunStore.ts:206, settingsPersistence.ts:530) | — |
| M8 | No seed/demo data in prod | PASS | dist/assets contains only codebook/filter CSVs plus WASM/JSON packs; no sample raw data; demoDisplay is a masking feature (demoDisplay.ts:1-30) | — |
| Q1 | Idempotent ingest | PASS | OPFS objects are SHA-256 content-addressed with verified writes (opfsArtifactStore.ts:405-415) | — |
| Q4 | Dependent writes recoverable | PASS | Alternating authoritative root slots plus recoverable-slot classification (opfsArtifactStore.ts:539-560); workspace-recovery.spec.ts | — |
| Q5 | Scheduled work runs once | N/A | No scheduled work in the product (client-only PWA); CI canary.yml is a single runner | — |
| C2 | Safe defaults | PASS | `provenanceEvidence` off (App.tsx:282), sequential engine, screen-gated crediting opt-in, preview binds 127.0.0.1 (package.json `preview`), CSP in _headers. Note: the test seam `__CHRONICLE_TEST_RUNTIME__` ships in dist (App.tsx:212) | Optional: strip the seam in production builds |
| C6 | Actionable messages | PASS | e.g. settingsPersistence.ts:600-602, rustPipelineRuntime.ts:5035-5037, fileInspection.ts:58-64, opfsArtifactStore.ts:1123 | — |
| C8 | Config internal consistency | PASS | `validate_pipeline_v2_options_with` refuses an inconsistent disposition/minutes pair and B06 shapes (kernel/pipeline/options.rs:711-740) | — |
| B1 | Lists/aggregates bounded | PASS | Worker payload budget of 1.5 GiB (concurrency.ts:121); workspace history capped (opfsArtifactStore.ts:1121-1131); `MAX_LIVE_PARTICIPANT_INSPECTION_BATCHES = 16` (runtime lib.rs:540). No file-count cap, but concurrency is bounded | — |
| B3 | Client storage bounded | PASS | Storage-pressure banner at 80% (storagePressure.ts:21); `MAX_HISTORY_ROOTS`/`MAX_CLOSURE_OBJECTS` refusals; regenerable last-run cleanup (localDataReset.ts) | — |
| B4 | Logs bounded | PASS | The product persists no logs (console only); the evidence journal sits under the OPFS history caps | — |
| B5 | No unbounded maps | PASS | Module-level Maps are built from static registries (literatureExternalExecutors.ts:67, bundledAssetLoader.ts:1); Rust caches are byte-capped (execution/state.rs:67) | — |
| D2 | No abandoned security deps | PASS | npm prod deps published 2026-08/09, except comlink (2024-11, under 2 years, not a security path); the Rust `paste` unmaintained exception is documented (deny.toml:11) | Track comlink |
| D3 | Vendored provenance | PASS | vendor/arrow-ipc-59.1.0/BACKPORT.md records the crate SHA-256, upstream PR #10989 and the retained LICENSE/NOTICE; .semantic-federation/vendor has SOURCE.json | — |

## Detail behind selected FAIL rows

- **S2**: `readConfigFile` does `sanitizeOptions(source.currentSettings)` and `sanitizePresets(source.presets)` on any
  object, or on `{}` for a non-object. The handler then calls `setOptions` and `setPresets(next.presets)`, and the
  `useEffect` at SettingsManagementCard.tsx:100 persists the empty list. There is no undo. Unknown enum
  strings: see the K2 detail (options.rs `_ =>` arms pinned by pipeline_v2.rs:2398,2414,2430,3671).
- **T8**: The 51 chromium failures are 17 research-method-profile-import, 18 rosenthal-method-definition,
  5 preview-feature-matrix, and 11 across 8 other specs. persona-* specs (adversary, crash-recovery,
  data-integrity, multi-tab, offline, storage-pressure, sw-update) are never in any gate. The four golden
  campaign suites are excluded from `test:unit` (package.json) and run only under `make dependency-evidence`.
  The soak test `every_pair_of_option_edits_applied_together_keeps_warm_results_exact`
  (pipeline_v2_incremental.rs:23760) is `#[ignore]` and no target passes `--ignored`.
- **D4**: `make wasm-fresh` runs `git diff --exit-code` on the committed WASM. A new stable rustc changes the
  codegen bytes, so the gate breaks or forces a re-commit with no source change.
- **S7**: `panic = "abort"` plus `--release` removes every `debug_assert!` and `#[cfg(debug_assertions)]`
  block guarding canonical-order permutation validity, checkpoint identity equality and sparse-digest
  equality. Those digests are published as evidence.
- **C5**: CHANGELOG.md:5-6 references `pyproject.toml`; `ls pyproject.toml src` gives no such file.
  The Makefile:1-2 header says the deploy workflow "re-runs the web build checks", but it runs only
  `build:app` (typecheck) plus the artifact check (web-pwa-deploy.yml:47-73). README's "all 46 computational
  options" is not registered in check_published_figures.py, so by the repo's own rule it is an unverified figure.
