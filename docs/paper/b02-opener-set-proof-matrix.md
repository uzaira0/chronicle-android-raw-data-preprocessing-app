# `delivery:B02` test-obligation matrix

Status: accepted on the private feature branch; PR, merge, deployment, and canary pending

Date: 2026-08-11

Decision authority: [B02 opener-set research](b02-opener-set-research-decision.md)

Target baseline: private-preview commit `312ef636e3bd03d63bc5d8b2fd84b86fa5251cbc`

This matrix defines what must be proved before `delivery:B02` can move from implementation to
accepted. A request-shape assertion alone is insufficient: at least one non-default value must
reach compiled Rust and change scientific output on a branch-activating public/synthetic fixture.

The fresh implementation on `codex/b2-b14-convergence` satisfies every
`must-add-now` and `architecture` obligation below. It is a reconstruction from
the frozen decision, not the absent historical artifact. The accepted runtime
identity is `sha256:521dd7f2182f9da20c8dc0bb9b19a4f5d22178f698efc3c82a76d161cba7a8a1`;
the compiled runtime WASM is
`sha256:a68b45274597b23c53da5203377981ed1d7c52b65584a6f9f52d3c54fec48e17`.
The synthetic binding multiverse closes 210 unique cells as 200 executions and
the exact 10 EYES refusals. Focused, native/WASM, dependency, combinatorial,
privacy, deploy-artifact, and Chromium/Firefox browser gates pass. WebKit cannot
start on the RHEL 9 campaign host because the downloaded browser requires newer
glibc symbols; this is recorded as a host-runtime limitation, not a product pass.
The private PR, merge, preview deployment, and canary remain pending.

Classification vocabulary:

- `must-add-now`: required for B02 acceptance;
- `architecture`: existing generated workflow/contract gates must prove the new dependency;
- `health`: bounded end-to-end confidence after focused correctness;
- `advanced`: broad or expensive evidence run after focused correctness;
- `blocked`: scientifically unavailable until the named external condition is satisfied;
- `N/A`: not part of this preview repository.

## Matrix

| Surface | Class | Concrete obligation | Failure prevented |
|---|---|---|---|
| LinkML and generated vocabulary | `must-add-now` | Declare `OpenerSetId`, `opener_set`, default, and research-axis annotation only in source schemas; regenerate artifacts; prove exact ontology/generated/Rust closure, unique IDs, and default membership. | Hand-edited drift or an invalid default |
| UI selector | `must-add-now` | Render every generated value in Session Detection; prove reset, modified state, labels, keyboard reachability, and exact generated-domain parity. | Hidden or unreachable arm |
| Settings search | `must-add-now` | Route `opener_set` to the owning control and prove every generated option key is searchable. | Selectable but undiscoverable axis |
| Persisted enum validation | `must-add-now` | Test every valid arm, unknown string, wrong type, null, and missing older-envelope key; invalid/missing values resolve to `strategy_defined`. | Arbitrary persisted strings reaching Rust |
| Presets/config/import/share | `must-add-now` | Round-trip a non-default through local settings, named snapshots, current config, preset import/export, and shared URL; run malformed values through each deserialization entry point. | One safe sanitizer bypassed by another loader |
| Projects and last-run state | `health` | Save/reopen a project with a non-default and structurally round-trip last-run state; old state defaults safely. | Restore silently changing B02 |
| Browser-to-Rust projection | `must-add-now` | Assert a generated non-default becomes the exact snake-case Rust request field. | UI-only field |
| Rust enum/parser | `must-add-now` | Exhaust every arm's ID round-trip, uniqueness, default, unknown fallback, ontology parity, and app/device event-scope closure; prove package policy remains inherited rather than smuggled into B02. | Cross-language vocabulary split or axis conflation |
| Alias normalization | `must-add-now` | `Move to Foreground`, raw type 1, and `Activity Resumed` normalize and behave identically. | Degenerate alias arm or spelling-dependent behavior |
| Filtered-resume transport | `must-add-now` | With an app-filter fixture, prove the raw filtered spelling becomes `Filtered App Resumed`, remains visible to excluded-package resolution, is unmasked to canonical type 1 before B01/B02, opens the same bounds under `activity_resumed_only` as an unfiltered control, and still receives the selected package-policy treatment after reconstruction/materialization. | Wrong-stage filtering silently removes an opener or B02 bypasses package policy |
| Device-row attribution | `must-add-now` | Types 15/18/27 between app resumes never open or inherit app credit under any arm, both with package `android` and with a deliberately malformed non-system package. | Fabricated app attribution |
| Non-degenerate semantics | `must-add-now` | Under `gesis_start_stop_repair`, a package-attributed type 19/type 20 pair plus a type 1/type 2 control produces the extra scientific episode only for `gesis_app_scoped_starts`. | Selector reaches Rust but has no effect |
| Strategy applicability and consumption | `must-add-now` | Exhaust 7 strategies × 3 opener values; every cell returns the declared relation. For each executable wider controlled derivative, use a strategy-appropriate closer fixture and prove the selected vector changes effective opener counts and either output or the declared unmatched disposition; no cell may merely classify then ignore the vector. | Silent ignore or false method fidelity |
| EYES refusal | `must-add-now` | EYES × GESIS-derived refuses before reconstruction with a stable machine-readable reason carried to browser/multiverse evidence. | Silent fallback or multi-axis EYES mutation |
| Generic materialization | `must-add-now` | A matched type-19 start becomes App Usage with correct bounds/duration while its original event type remains recoverable in lineage; unmatched selected non-resume starts follow the selected strategy's existing disposition. | Matcher finds wider starts but output silently drops or mislabels them |
| Default scientific compatibility | `must-add-now` | Omitted and `strategy_defined` runs reproduce pre-B02 scientific CSV/JSON outputs byte-for-byte for every strategy fixture. | Additive option changing existing science |
| Warm/cold incremental parity | `must-add-now` | For every executable cell, compare sequential cold and tracked warm results; repeat request is free; A→B→A reverts exactly on a branch-activating fixture. | Stale cached opener behavior |
| Persisted reconstruction base | `must-add-now` | A base saved under opener A is rejected under B; B warm output equals cold; update protocol/version when serialized identity changes. | Cross-arm cache poisoning |
| Workflow dependency contract | `architecture` | Declare the field only on the actual reader query; existing exact query-edge, field-writer, request-binding, and byte-contract gates pass after regeneration. | Undeclared influence or excess invalidation |
| Runtime exact options identity | `must-add-now` | B02 appears in exact options JCS, changes options digest/cache identity, and reverts deterministically. | Same digest for different measures |
| Provenance/export | `must-add-now` | Exactly one parameter binding carries the canonical value; runtime receipt, JSON-LD, manifest, exported config, applicability, and options digest agree; requested/effective ID, relation, suppressed-device count, and materialized opener-type counts are present. | Results detached from selected method vector |
| Compiled WASM | `must-add-now` | Rebuild WASM; use the branch fixture to prove compiled Rust output changes, warm equals cold, receipt is exact, and edit/revert is exact. | Stale WASM masking source correctness |
| Browser E2E | `health` | Add an `@smoke` selector → processing → export/provenance scenario plus project restore and config import/share on one non-default arm, then run both the smoke grep and full matrix. | Integrated workflow breakage or an unexecuted smoke scenario |
| Configuration campaign | `advanced` | Give each opener its own class until equivalence is proved; regenerate t=3 model; run isolated-axis, transition, warm/cold, and influence checks with a non-vacuous witness. | Combinatorial blind spot |
| Binding multiverse | `must-add-now` | Enumerate the full generated B01 × B02 × reconstruction × quality domains; assert 210 unique cells, exactly 200 executions, and exactly the 10 EYES × GESIS-derived refusals. Validate the 7 × 3 relation matrix, exact requested/effective IDs and refusal reason, manifest/standalone receipt agreement, and options/runtime/contract/WASM/output digests. Freeze participant-days from the binding-independent selected-timezone raw frame so all-zero days remain explicit. | Hard-coded partial multiverse, arbitrary refusals, or binding-dependent denominators |
| Real-data scientific multiverse | `blocked` | Requires frozen admissibility, preregistration, and authorized data; synthetic evidence proves dispatch only, not empirical magnitude. | Synthetic result presented as a scientific finding |
| Historical byte equivalence | `blocked` | Reopen only if the original B02 artifact is recovered. | Reconstruction misrepresented as recovered bytes |
| Python parity | `N/A` | None; this preview baseline removed the Python engine and cross-engine target. Rust sequential/incremental/WASM parity is authoritative. | Stale repository-generic requirement |

## Required fixture identities

The tests must name and preserve six public/synthetic fixtures:

1. `opener_alias_equivalence`: one lifecycle sequence represented by each accepted type-1 spelling;
2. `filtered_resumed_transport`: matched filtered and unfiltered packages with otherwise identical
   type-1/type-2 lifecycles, plus the app-filter input needed to verify mask/unmask and final policy;
3. `device_rows_never_open_apps`: real app rows separated by package-`android` types 15, 18, and 27;
4. `gesis_app_scoped_wider_witness`: under GESIS repair, one package-attributed type 19/20 pair
   and one type 1/2 pair;
5. `opener_strategy_applicability_matrix`: per-strategy subfixtures — type19 → another app's type1
   for fused/Parry–Toth/Morrison, type19 → same-package type2 for foreground/background and
   Draxler, type19 → type20 for GESIS, plus the typed EYES refusal cell.
6. `binding_independent_zero_day`: a selected-timezone participant-day containing device rows but
   no app episode; it stays in the multiverse denominator as zero under every executable arm.

Each behavioral assertion must identify why the fixture activates the branch. Pairwise inequality
is required only where semantics guarantee it; declared source-equivalent cells should instead
prove equality and retain distinct receipt values.

## Repository-native run order

Generate source-derived artifacts first, then refresh dependency evidence before any gate that
checks it:

```bash
cd web
npm run generate:contract
npm run generate:workflow
cd ..
make dependency-evidence
```

Focused schema/browser tests:

```bash
cd web
npm run check:contract
npm run lint
npm run typecheck
node scripts/run-clean-env.mjs ./node_modules/.bin/vitest run \
  src/lib/generatedContract.test.ts \
  src/components/SessionDetectionCard.test.ts \
  src/components/SettingsSearchResults.test.ts \
  src/lib/settingsPersistence.test.ts \
  src/lib/sharedConfig.test.ts \
  src/lib/rustPipelineAuthority.test.ts
```

Focused native Rust tests:

```bash
cargo test --locked \
  --manifest-path rust/chronicle_app_usage_matcher/Cargo.toml \
  --lib
cargo test --locked \
  --manifest-path rust/chronicle_chrono_kernel_wasm/Cargo.toml \
  --features incremental-v2 --lib
cargo test --locked \
  --manifest-path rust/chronicle_preprocessing_runtime_wasm/Cargo.toml \
  --lib
```

Compiled boundary after native correctness:

```bash
cd web
npm run build:wasm
node scripts/run-clean-env.mjs ./node_modules/.bin/vitest run \
  src/lib/rustPipelineRuntimeContract.test.ts
```

Cross-surface generated and campaign gates:

```bash
make rust
make web
make combinatorial
cd web && npm run test:configuration-influence-parallel
node scripts/run-clean-env.mjs ./node_modules/.bin/vite-node \
  scripts/measure_binding_multiverse.mts -- \
  --raw src/testSupport/fixtures/b02-opener-set.csv \
  --assert-b02-fixture \
  --json .tmp/b02-binding-multiverse.json
cd ..
make dependency-evidence
cd web && npm run build:wasm && npm run check:wasm-exports
```

Health and release gates after the B02 group is stable:

```bash
cd web
npm run test:e2e:smoke
npm run test:e2e
cd ..
make all
```

Expensive evidence runs last and under the campaign compute cap:

```bash
make coverage
make coverage-rust
make bench-regression
make mutation
make gate-truth
```

Ordinary Vitest and coverage runs exclude heavy configuration campaigns. `make web` alone is not
evidence of multiverse or influence coverage.

## Acceptance rule

B02 is accepted only when every `must-add-now` and `architecture` row passes, bounded health tests
pass, generated artifacts are synchronized, default scientific outputs are unchanged, one
non-default changes compiled Rust output on the wider witness, and every strategy crossing consumes
or refuses explicitly. Blocked scientific and historical claims remain blocked; they do not become
passing implementation evidence.
