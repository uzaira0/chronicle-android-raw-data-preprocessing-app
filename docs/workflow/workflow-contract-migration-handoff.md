# Workflow Contract Migration Handoff

**Status:** Complete — merged, deployed, and production-canary verified
**Branch:** `main`
**Date:** 2026-08-05

## Purpose

This handoff records the completed count-neutral workflow contract migration. The
implementation no longer treats a registry length, phase total, or ordinal position
as product identity. Continue working only inside this repository and do not open or
inspect image or video files.

## Current Architecture

The workflow has distinct interpretation layers:

| Layer | Contract meaning |
|---|---|
| Phase | Plain-language navigation and graph grouping |
| Operation | Scientific action, decision, or transformation |
| Artifact | Typed value consumed or produced by operations |
| Query | Physical Salsa computation and memoization boundary |
| Checkpoint | Optional durable reuse boundary |
| Evidence | Run-specific execution, reuse, timing, and digest record |

These layers are mappings, not aliases. A phase can be relabeled without changing
cache identity. One query may realize several operations, and one operation may
eventually span several queries. Query execution does not by itself prove every
mapped semantic operation was applicable.

Rust is the only preprocessing authority. TypeScript owns browser I/O, interaction,
visualization, and download presentation; it must not acquire scientific scheduling
or transformation logic.

## Semantic Rules

Preprocessing is the umbrella process. Cleaning is a narrower semantic role reserved
for explicit removal or repair. Timeline standardization, activity inference,
measurement policy, classification, enrichment, aggregation, and encoding remain
separate roles. Operations also declare whether they preserve, drop, rewrite, split,
synthesize, classify, aggregate, or encode data.

Only direct option, support-role, and source-field reads are authored. Transitive
impact is derived from query dependencies. The explorer must continue distinguishing:

- a direct reader of a changed input;
- a query physically reconsidered by Salsa;
- an artifact whose semantic value changed;
- downstream operations that may consequently change;
- a reused, bypassed, failed, or recomputed execution.

The implemented carve between attribution completeness and compliance classification
is the reference pattern: changing the compliance threshold reuses the completeness
aggregate and reruns only threshold-dependent classification.

Presentation, semantic, execution, checkpoint-policy, and evidence identities have
separate digests. Never place labels, descriptions, graph layout, or run evidence in
scientific cache keys.

## Important Files

- [`workflow_contract.rs`](../../rust/chronicle_chrono_kernel_wasm/src/workflow_contract.rs)
  is the canonical registry, applicability grammar, typed-port model, and digest
  authority.
- [`pipeline_v2_incremental.rs`](../../rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs)
  contains the Salsa query implementation and invalidation tests.
- [`lib.rs`](../../rust/chronicle_preprocessing_runtime_wasm/src/lib.rs) in the runtime
  crate owns workspace execution, query evidence, compatibility, and fail-closed
  cache behavior.
- [`generate_workflow_artifacts.mts`](../../web/scripts/generate_workflow_artifacts.mts)
  generates the LinkML and TypeScript projections.
- [`GraphPanel.tsx`](../../web/src/components/GraphPanel/GraphPanel.tsx) implements the
  Pipeline Explorer projections: Overview, Decisions, Data lineage, Execution, and
  Audit.
- [`opfsArtifactStore.ts`](../../web/src/lib/opfsArtifactStore.ts) owns the new runtime
  and workspace namespaces.
- [`check_workflow_count_neutrality.py`](../../scripts/check_workflow_count_neutrality.py)
  rejects topology branding and retired workflow vocabulary.
- [`contract-and-dag-migration-plan.md`](contract-and-dag-migration-plan.md) is the
  complete design and acceptance plan.

## Storage and Compatibility

Current OPFS namespaces are `chronicle-workflow-runtime-v1` and
`chronicle-workflow-workspaces-v1`. Older preprocessing namespaces are detected by
existence only. Do not open, parse, migrate, reinterpret, rewrite, or delete their
contents. The UI directs users to export with the old version or clear storage
manually.

The settings and contract baseline use schema version 2. Compatibility checks accept
the previous baseline shape only long enough to normalize it for comparison; there
is no runtime fallback workflow API.

## Generation and Evidence Workflow

After changing the Rust registry:

```bash
cd web
npm run generate:workflow
npm run check:contract
npm run build:wasm
```

After changing Rust computation, dependency declarations, the semantic plan, or
proof-bearing contracts, refresh the complete evidence set with the pinned
`semprof` binary:

```bash
cd web
SEM_PROF_BIN=/absolute/repository-local/path/to/semprof \
  npm run refresh:dependency-evidence
```

The refresh script builds an isolated bootstrap WASM module, runs the dependency
campaigns, seals their receipts into the certificate, rebuilds normal fail-closed
WASM, and refreshes final-runtime provenance. It snapshots generated paths and rolls
them back on failure. Keep all temporary tools and campaign directories inside this
repository and remove them after use.

Useful drift checks:

```bash
cd web
npm run typecheck
npm run lint
npm run check:contract
npm run check:boundary

cd ..
python3 .semantic-federation/scripts/check-chronicle.py
python3 .semantic-federation/scripts/check-execution-claims.py
python3 scripts/generate_semantic_behavior_inventory.py --check
python3 scripts/check_workflow_count_neutrality.py
git diff --check
```

## Verification Completed

The Rust kernel, runtime, semantic adapter, and semantic-index tests passed. Focused
runtime, persistence, OPFS, semantic-index, settings, and Pipeline Explorer tests
passed, as did TypeScript checking, ESLint, contract compatibility, boundary checks,
schema validation, and semantic-federation checks.

The dedicated sharded configuration, interaction, artifact, raw-boundary, mixed,
semantic-mutation, field-provenance, and per-field tomography campaigns passed
against the final implementation receipt. Production WASM and the checked dependency
certificate now carry the same implementation digest. The normal runtime fails closed
to full recomputation when that receipt is stale.

The aggregate `npm test` command was not used as the final campaign gate because it
repeats exhaustive campaign files without their sharded runners. Use the dedicated
commands in `web/package.json` for those campaigns.

## Release Verification

The semantic inventory reports `runtime-cutover-release-verified`. The final
repository-wide release gate and preview verification against the deploy artifact
passed on 2026-08-05:

```bash
make all
cd web && npm run build && npm run test:e2e:smoke
```

Verification was performed without image or video inspection. Any later source or
contract edit must refresh dependency evidence and rerun these release gates before
retaining the verified status.

The migration and release follow-ups landed through pull requests
[#96](https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app/pull/96),
[#97](https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app/pull/97),
and [#98](https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app/pull/98).
The corrected [Pages deployment](https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app/actions/runs/30988805867)
and final [production canary](https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app/actions/runs/30989583412)
are green. The deployed application is available at
<https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/>.

## Guardrails for Follow-up Work

- Do not introduce numeric workflow branding, registry-length assertions, ordinal IDs,
  or positional registry access.
- Do not make presentation groups schedule work or influence scientific cache keys.
- Do not infer semantic applicability from query-group badges.
- Do not duplicate the Rust registry in TypeScript, documentation, or test fixtures.
- Do not broaden a query key to the entire request when exact effective inputs are
  available.
- Do not promote a durable checkpoint without the benchmark and parity requirements in
  the migration plan.
- Do not edit generated workflow projections as if they were authorities.
- Keep `AGENTS.md` unchanged unless a user explicitly requests contributor-guide work.

Obsolete count-branded documentation, performance artifacts, and the retired workflow
contract were removed during the migration. They remain recoverable from Git history.
