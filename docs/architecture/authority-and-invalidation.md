# Authority and invalidation — how this codebase actually works

Read this before touching `pipeline_v2*.rs`, `workflow_contract.rs`, the campaign tests,
or anything that sounds like "dependency", "graph", "provenance", or "evidence". Every
2026-08 failure documented in
[`docs/postmortems/2026-08-convergence-campaign.md`](../postmortems/2026-08-convergence-campaign.md)
came from getting one of the ownership facts below wrong.

## The authority table

One owner per behavior. If you are about to build something that duplicates a row's
owner, stop — you are missing an existing mechanism, not discovering a gap.

| Behavior | Sole owner | What it is NOT |
|---|---|---|
| Incremental recomputation / invalidation | Salsa. Every `#[salsa::tracked]` fn in `pipeline_v2_incremental.rs` records its actual reads per revision. The graph is dynamic and exact by construction. | NOT `WORKFLOW_QUERIES`, not any table, not anything you can edit. No declaration anywhere makes Salsa recompute more or less. |
| Incremental physical cached/recomputed status | Salsa execution events, drained by the engine and published in the runtime manifest (`queryExecutions[].status`). | NOT inferred from digests, timing, or logs. |
| Session matching | `chronicle_app_usage_matcher` (`match_app_usage_core`, `split_overlapping_sessions`). | |
| Option keys, defaults, tooltips | `web/schema/chronicle-local-contract.linkml.yaml` → generated `generatedContract.ts`. | NOT the generated file — edit the schema, regenerate. |
| Query input identity (cache keys) | The runtime's exact request document: every field a query binds (`query_request_fields`) must be present in it, or the runtime fails closed (`binds unknown exact request field`). Failing closed here is correct — an absent bound field would produce a key that cannot invalidate. | NOT something to "fix" by making the field optional. Fix the request producer (the browser always sends every bound field). |
| The published static graph | `WORKFLOW_QUERIES` in `workflow_contract.rs` — a hand-maintained **may-read mirror** of the dynamic graph, serialized into the workflow contract for the plan, `workflow_provenance.rs`, the semantic index, and the Graph panel. | NOT an invalidation input. Salsa never reads it. Its only failure mode is *drift from the code*, and the drift gates below exist for exactly that. |

## The may-read mirror and its two drift gates

`WorkflowQueryDefinition::inputs` means: *the complete set of upstream queries this
query's body may read on any configuration arm.* Nothing more precise. Per-arm edge
prediction was removed in 2026-08 after it required a growing pile of hand-rolled
machinery (five per-file "predictors", then a conditional-edge table) to re-derive what
Salsa already owns.

Because the mirror is hand-maintained, it can rot. Two properties — both computed from
data already in the runtime manifest, needing no new mechanism — keep it honest. They
are asserted per intervention case by the tomography campaigns under
`web/src/lib/pipelineGraph/golden/`:

1. **Justified execution** (the dangerous direction). Every query that executed in a
   warm target must have a reason: it was newly applicable; or a request field it binds
   changed; or a source role it binds changed and that binding's predicates hold; or at
   least one *declared* input's output digest changed. An execution with no
   justification is an **undeclared read** — the missing-invalidation class — and the
   campaign fails.
2. **No self-contradicting badge.** A query badged `cached` while its published
   `output_digest` moved from the warm source is impossible for a real memo.

If you think you need to predict the exact executed set, or to know whether an edge is
live *on this specific arm*: you don't, for any current consumer. The one legitimate
future path is exporting Salsa's observed edges from its event stream — a real kernel
feature, to be proposed to the operator, never re-derived in TypeScript.

## What the sequential path is, and what it is not

`run_pipeline_v2_with_supports()` (`pipeline/sequential.rs`) is an independent
**scheduler** and the default engine (a request without `executionEngine` runs
it): it runs the same product DAG straight through, with no Salsa, no
memoization and no alternation slots. Comparing a tracked run against it proves
the incremental scheduling, the checkpoint chain and the resume paths.

It is **not** an independent implementation, and must not be described as one.
Both schedulers call the same stage functions (`src/pipeline/stages/*`,
`scientific.rs`, `output.rs`, `checkpoint.rs`, reached through the injected
`StageFunctions` where a function is replaceable); only the scheduling around
them differs. A wrong algorithm is wrong identically on both sides. The same caution
applies to a "cold" `TrackedEngine`: it is cold in Salsa and (since the
alternation slots became engine-owned state) in its caches too, but it still
runs the same code. A genuinely independent value oracle has to come from
outside this crate — the frozen detached engine, or recorded evidence.

## The evidence chain — order matters

```
campaign runs (record mode)          make dependency-evidence
        │                            (refresh script sets UPDATE_*=1 itself —
        ▼                             this is the sanctioned re-recorder)
proof ledgers (family-expected/*.json)
        │  implementationReceipt is READ from here…
        ▼
dependency certificate (.semantic-federation/proofs/dependency-certificate.json)
        │  …by scripts/generate_semantic_behavior_inventory.py --certificate-only.
        │  Regenerating the certificate against unchanged ledgers rewrites
        │  identical bytes — it computes nothing itself.
        ▼
embedded at build time (semantic adapter include_str → runtime crate)
        │
        ▼
DependencyCacheMode at runtime: certificate matches this build → certified_narrow;
stale → ConservativeFull (engine wiped per request, every warm-reuse test reads
Recomputed where it expects Cached — ~17 tests red with one cause)
```

Consequences:
- After any `pipeline_v2*.rs` / `workflow_contract.rs` change: run
  `make dependency-evidence` **with no Rust edit in flight** (it builds WASM from the
  live worktree), then re-run `--certificate-only` if the certificate step ran before
  the campaigns wrote fresh ledgers.
- On macOS, the coverage build needs LLVM's archiver for minicov's WASM objects.
  `wasm_build_flags.mjs` selects an installed Homebrew `llvm-ar` unless a caller
  supplied an archiver. For another installation, set `AR_wasm32_unknown_unknown`
  to its `llvm-ar`. Apple's `ar`/`ranlib` can produce an empty archive even when
  the individual objects contain the required profiling symbols; changing Rust
  instrumentation or disabling certificate checks does not fix that cause.
- The implementation digest excludes `#[cfg(test)]` items (`build.rs` parses with
  `syn`), so test-only edits do not move it. The strip covers free items,
  impl-block members, and trait members, and understands `cfg(test)` plus
  `cfg(all(test, ...))`; `cfg(any(test, ...))` items are deliberately kept
  (they can compile into production).

## Footprint-based campaign selection — never an invalidation authority

`make dependency-evidence` decides per instrumented campaign whether to re-run it
or inherit its committed ledger. The decision engine is
`web/scripts/footprint_selection.mjs`, wired into
`web/scripts/refresh_dependency_evidence.mjs`; `FULL=1 make dependency-evidence`
bypasses it and re-measures everything.

What a footprint is: after a campaign re-runs against the coverage-instrumented
bootstrap WASM (nightly, per-crate `-Cinstrument-coverage`, minicov as the
in-WASM profiling runtime), its merged LLVM coverage names exactly the
production source files it executed. Each file is pinned by the digest of the
same test-stripped normalized bytes the implementation digest folds (one shared
definition: `rust/chronicle_preprocessing_runtime_wasm/src/footprint_digest_core.rs`,
included by both `build.rs` and the `footprint_digests` example). The proof is
written to `.semantic-federation/proofs/footprints/<campaign>.json` and committed.

A campaign is CLEAN — its ledger payload still testifies — only when every file
it executed is unchanged under that normalization AND its harness closure,
workflow contract golden, crate manifest closure (Cargo.toml/Cargo.lock, which
coverage can never witness), and toolchain are unchanged. Anything else,
including a missing or unreadable footprint or a file coverage touched outside
the digest map, is DIRTY and re-runs. Inherited ledgers keep their measured
payload byte-for-byte; only `implementationReceipt` is re-stamped from the
freshly built bootstrap runtime's `runtime_identity_json()` — the same embedded
constants every campaign manifest reports — and the swap is recorded in an
explicit `footprintInheritance` block. Whenever any campaign did re-run, its
freshly measured receipt is compared field-by-field against that identity
before any re-stamp happens.

Boundary (this is the line the 2026-08 postmortem draws): footprints choose
**which record-mode campaigns re-execute**, nothing more. They are never
consulted for Salsa invalidation, never predict query reachability, and never
substitute for the campaigns' own evidence — `check_deploy_artifact.mts` still
independently verifies every ledger receipt against the actual built runtime
and the actual contract/plan/profile bytes.

## Derived artifacts: every one must move with its source

The single most repeated 2026-08 failure was work done in a source of truth and never
propagated, leaving gates validating stale inputs. The complete map:

| Source of truth | Derived artifact | Regenerate with | Gate that catches drift |
|---|---|---|---|
| Rust crates | `web/src/wasm/*/pkg/*` (force-tracked deploy inputs) | `npm run build:wasm` | `make wasm-fresh` (run by `make check` for Rust changes and by `make all`) rebuilds packages and fails on drift in `web/src/wasm`. A fresh rebuild remains part of every Rust change's definition of done. |
| LinkML schema | `generatedContract.ts`, openapi, json-schema/owl/pydantic/shacl/sql | `npm run generate:contract` / `check:contract` | `make web` |
| `workflow_contract.rs` | `chronicle.plan.json`, `chronicle-workflow.yaml`, semantic profile, capability bindings | `make dependency-evidence` | contract/plan agreement tests (`rustPipelineRuntimeContract.test.ts`, `semanticIndex.test.ts`) |
| campaign ledgers | dependency certificate | `--certificate-only` **after** fresh ledgers | `a_stale_dependency_certificate_names_itself_and_the_command_that_fixes_it` |
| contract | kernel golden `tests/golden/workflow_contract.json` | deliberate `UPDATE_GOLDEN=1` run | `exported_workflow_contract_is_byte_exact` |
| METHODS DAG table | flows through generated `chronicle-workflow.yaml` | regeneration, not hand-editing | published-figure/docs checks |

## Where a fix belongs

- **A fail-closed rejection is usually correct.** Before weakening a check that
  refused something, find what it protects. Two 2026-08 examples: the unknown-bound-
  field rejection (protects cache-key completeness — the fix was the fixture, not the
  check); the raw-digest binding on `construct_screen_intervals`
  (`applicability.input_digest` is the resume-time tamper check pairing a persisted
  construction with its exact input file — `validate_screen_construction_output`).
- **A red test is a claim about the runtime.** Change the expectation only after
  proving from source that the runtime is right, citing the line that documents the
  intended behavior. Both directions of that proof happened in 2026-08: expectations
  corrected against a documented design (`input_capability_evidence_file` is
  conditionally active, and its own ledger said so), and expectations kept while the
  product was fixed (the `review_only` double-flip).
- **A test's strength must match its name.** `raw_artifact_is_exposed_only_to_the_
  parse_node` evaluated an empty options map for months — every predicated binding
  false, so it asserted far less than its name claimed. When a test names an
  invariant, enumerate the option space that can vary it, and prefer named allow-lists
  with exact set equality over counts (a count silently absorbs an addition and a
  removal at once).
