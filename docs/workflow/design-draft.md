# Design Draft — Pipeline Graph + Feature Wiring (Approach A)

STATUS: IMPLEMENTED (2026-07-14) for the phases 1, 2 and 4 subset — superseded by the
normative spec at `docs/superpowers/specs/2026-07-14-pipeline-graph-design.md`.

What is live in `web/`:
- Graph spine: `src/lib/pipelineGraph/` (graphTypes / engine / analysis / graphDef) — the
  declared graph IS the execution path of `processRawCsvContent`, with per-node
  content-hash memoization and per-file engine reuse. Headline outputs byte-identical.
- Clean tier: `src/lib/stages/effectiveUsage.ts` (screen-gated usage credit, validated
  row-for-row against the reference implementation via golden fixtures).
- Analyze tier: `src/lib/stages/{studySupportFiles,observationWindow,attributePerson,
  scoreCompliance,dayCoverage}.ts` — all side-by-side outputs (Credited App Usage,
  Compliance Report, Day Coverage); the headline CSVs never change.
- UI: Study inputs card (four study tables, needs-input states), Study analysis card
  (ten new contract options), Process-tab Preprocess/Clean/Analyze strip, and the
  Graph tab (`src/components/GraphPanel/`, React Flow 12 + dagre) with status badges
  from the last run and taxonomy-free path-query highlights + sentences (see the
  [typed-edge ontology](typed-edge-ontology.md)).
- Contract: ten option slots + four support-file slots in the LinkML schema.

Deferred (unchanged from the plan): `validate_clock` node internals, lineage ledger,
`eyes_triplet_v1` / `parry_toth_forward_pair_2025` strategies + conformance fixtures,
ordered app-policy rule schema (+ `interval_quality` knob split), multi-stream witnesses.
The file layout below shows the full target shape; the stage files above live flat under
`src/lib/stages/` until more nodes land.

## Section 1 — Architecture & module boundaries (APPROVED)

All work in this repo's `web/`.

```
web/src/lib/pipelineGraph/     graphDef.ts   one declarative graph: nodes, typed edges, knob bindings
                               engine.ts     topo sort, dirty-propagation, content-hash memoization
                               analysis.ts   derived path queries (see typed-edge ontology — visual, no taxonomy)
web/src/lib/stages/            processRawCsvContent DECOMPOSED, one file per node
                               (file names follow the prior-art vocabulary node ids)
  preprocess/                  parse_events, validate_clock, normalize_timezones, dedup_and_order,
                               device_state_timeline, reconstruct_episodes, categorize_apps
  clean/                       app_policy, interval_quality, effective_usage ← new ports
  analyze/                     observation_window, attribute_person,
                               day_coverage, score_compliance ← new ports
web/src/components/GraphPanel/ React Flow 12 + dagre rendered view
```

- Engine runs INSIDE the existing worker (comlink transport unchanged). Cache key per node =
  hash(upstream output hashes + bound knob values + support-file hashes). Intermediates stay
  in worker memory per file; evicted under memory pressure (fallback = full recompute —
  never wrong, only slower). Main thread holds graph definition + dirty/clean state only.
- Knob change → dirty bound node(s) → recompute only the downstream cone. The "results
  stale" banner becomes a per-node dirty overlay.
- Sections are node metadata (see the [phase taxonomy](phase-taxonomy.md)). Preprocess locked
  by default (advanced unlock
  keeps current cards reachable). The min-duration/long-duration knobs get RECATEGORIZED
  into Clean in the UI without moving where they execute.
- Analyze needs two new support files: device-sharing table, study-dates table (uploaded
  like the codebook; formats specified in the final spec).
- All new knobs/sections flow through the LinkML contract (section + node-binding
  annotations) → regenerated TS/OpenAPI → `check:contract` CI.

## Section 2 — Typed-edge ontology (APPROVED; derived layer REVISED 2026-07-14)

See the [typed-edge ontology](typed-edge-ontology.md). Primitive: feeds / gates / tunes
(declared, drive execution). Derived layer:
NO named taxonomy (owner decision — causal vocabulary and graph-theory replacements both
rejected). Instead: path queries (`affectedBy`, `builtFrom`, `sharedUpstream`,
`mustPassThrough`, `joinPoint`) rendered as graph highlights + plain-English sentences.

## Section 3 — Node catalog (REVISED: community-grounded naming + sublation expansions)

Naming is grounded in the [prior-art vocabulary](prior-art-vocabulary.md): P&T
episodes/sessions/glances,
EYES device states/pickups/FAU, Culverhouse flag-and-truncate. No invented compounds, no
internal decision-record numbers, no engine jargon.

Preprocess: parse_events → validate_clock → normalize_timezones → dedup_and_order →
{device_state_timeline, reconstruct_episodes} → categorize_apps.
Clean: app_policy (ordered rule table) → interval_quality (thresholds/caps/flags on any
interval type) → effective_usage (episodes ∩ device-active states, truncated; the
FAU-analog).
Device branch: device_state_timeline → device_usage (sessions/glances/pickups — episode-free).
Analyze: observation_window → attribute_person → score_compliance → day_coverage → reports.

effective_usage takes TWO feed edges (episodes + device_state_timeline) and device_usage
branches off the timeline alone — the graph is genuinely a DAG, not a chain.

Ontology expansions: the first audit's five in the [sublation audit](sublation-audit.md),
as amended by the [device-state model](device-state-machine.md) — factored device state +
overlays with a named screen-time projection (the flat
six-state alphabet was refuted); reconstruction strategies as first-class versioned
algorithms; interval algebra + censoring contracts; ordered app-policy rule schema
(launcher = metadata, reattribute moved to attribution); a general interval-quality-policy
node; an immutable lineage ledger instead of appended flags; `validate_clock` before
timezone normalization; three additional Analyze support files (survey attribution,
eligibility/roster, enrolled-device denominator); `screen_witness_coverage` replaces
"screen-incapable"; named output contracts for prior-art export shapes.

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
  per-node dirty/cached/recomputed badges; path-query interactions (click → affected cone,
  two-select → shared upstream, hover → must-pass-through) with plain-English sentences —
  no taxonomy labels anywhere in the UI; Study Inputs card for the Analyze support files
  (sharing, study dates, survey attribution, roster, enrolled devices); ResultPanel gains
  Analyze-tier outputs (attributed stream, compliance report).

## Section 6 — Error handling (DRAFT)

- Node-scoped fail-loud errors surfaced on the graph node; no silent empty outputs
  (consuming-pipeline lesson). Coverage invariant on placeholders is a hard error.
- Memory pressure: evict caches, downgrade to full recompute, notify.

## Dependencies to add

`@xyflow/react` ^12 (MIT), `@dagrejs/dagre` ^3 (MIT). No state library; no backend.
