# Design Draft — Pipeline Graph + Feature Wiring (Approach A)

STATUS: in-progress design. Sections 1-2 APPROVED by the owner (2026-07-14).
Sections 3-6 pending presentation/approval. The final spec supersedes this draft.

## Section 1 — Architecture & module boundaries (APPROVED)

All work in this repo's `web/`.

```
web/src/lib/pipelineGraph/     graphDef.ts   one declarative graph: nodes, typed edges, knob bindings
                               engine.ts     topo sort, dirty-propagation, content-hash memoization
                               analysis.ts   derived causal-role queries (see doc 06)
web/src/lib/stages/            processRawCsvContent DECOMPOSED, one file per node
  preprocess/                  rawEventParsing, timezoneNormalization, eventDedupAndOrdering,
                               screenSessionDerivation, usageSessionReconstruction, appCategoryEnrichment
  clean/                       systemAppMarking, kidsShellLauncherRule, screenGatedUsageCredit ← new ports
  analyze/                     studyWindowFiltering, sharedDeviceAttribution,
                               missingDayAccounting, dailyComplianceScoring ← new ports
web/src/components/GraphPanel/ React Flow 12 + dagre rendered view
```

- Engine runs INSIDE the existing worker (comlink transport unchanged). Cache key per node =
  hash(upstream output hashes + bound knob values + support-file hashes). Intermediates stay
  in worker memory per file; evicted under memory pressure (fallback = full recompute —
  never wrong, only slower). Main thread holds graph definition + dirty/clean state only.
- Knob change → dirty bound node(s) → recompute only the downstream cone. The "results
  stale" banner becomes a per-node dirty overlay.
- Sections are node metadata (see doc 02). Preprocess locked by default (advanced unlock
  keeps current cards reachable). The min-duration/long-duration knobs get RECATEGORIZED
  into Clean in the UI without moving where they execute.
- Analyze needs two new support files: device-sharing table, study-dates table (uploaded
  like the codebook; formats specified in the final spec).
- All new knobs/sections flow through the LinkML contract (section + node-binding
  annotations) → regenerated TS/OpenAPI → `check:contract` CI.

## Section 2 — Typed-edge ontology (APPROVED)

See doc 06. Primitive: feeds / gates / moderates (declared, drive execution). Derived:
mediates / confounds / collides (computed path properties, drive the analysis sidebar).

## Section 3 — Node catalog (DRAFT, pending approval)

Preprocess: rawEventParsing → timezoneNormalization → eventDedupAndOrdering →
screenSessionDerivation → usageSessionReconstruction → appCategoryEnrichment.
Clean: systemAppMarking → kidsShellLauncherRule → screenGatedUsageCredit (gated; default per
stream preset). screenGatedUsageCredit takes a SECOND feed edge from eventDedupAndOrdering
(the raw event stream — screen/liveness witnesses), which is why this is a DAG, not a chain.
Analyze: studyWindowFiltering → sharedDeviceAttribution → dailyComplianceScoring →
missingDayAccounting → reports.
Naming convention: verb-noun, self-describing ids; no internal decision-record numbers, no
engine jargon. Exact inputs/knobs/outputs per node + the stream presets
(personal-device vs shared-tablet vs custom) to be enumerated in the final spec.

## Section 4 — Parity & testing (DRAFT)

- Golden fixtures generated from the Python originals (screen-gated credit, attribution,
  compliance, window, placeholders) on synthetic inputs; committed under web test fixtures; vitest
  parity suites assert row-level equality.
- Engine unit tests: dirty-prop over fixture graphs, cache-hit/eviction assertions,
  derived-role computation.
- Existing web-parity matrix extended to cover the new stages.
- Playwright e2e: graph panel renders, knob→cone highlight, incremental re-run.

## Section 5 — UI integration (DRAFT)

- Settings regrouped into Preprocess/Clean/Analyze; new Graph tab (React Flow + dagre);
  per-node dirty/cached/recomputed badges; analysis sidebar with plain-language derived
  roles; new Study Inputs card for the two Analyze support files; ResultPanel gains
  Analyze-tier outputs (attributed stream, compliance report).

## Section 6 — Error handling (DRAFT)

- Node-scoped fail-loud errors surfaced on the graph node; no silent empty outputs
  (consuming-pipeline lesson). Coverage invariant on placeholders is a hard error.
- Memory pressure: evict caches, downgrade to full recompute, notify.

## Dependencies to add

`@xyflow/react` ^12 (MIT), `@dagrejs/dagre` ^3 (MIT). No state library; no backend.
