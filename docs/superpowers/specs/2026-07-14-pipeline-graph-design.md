# Pipeline Graph + Feature Wiring — Design Spec

> **Superseded design record.** The TypeScript scheduler proposed below was
> implemented, evaluated, and then deleted. The current design uses 55 real
> Salsa-tracked Rust computations; Rust projects their status into the graph UI.

Date: 2026-07-14. Status: APPROVED design, pending implementation plan.
Knowledge base: `docs/pipeline-graph/` (docs 01-12). This spec is normative; the KB docs
carry the full derivations, audits, and prior-art extractions it references.

## 1. Goals

1. Separate **cleaning** from **preprocessing**; expose a third **analyze** tier.
2. Replace the linear browser pipeline with a **declared typed dependency graph** that is
   both the only execution spine (incremental recompute) and a rendered interactive view.
3. Port the research-pipeline-only features into the app, client-side: screen-gated usage
   credit, person attribution, compliance scoring, study-window filtering, placeholder
   days (docs 01/03).
4. Ground all user-facing vocabulary in the field's published terms (doc 08); absorb the
   prior-art paradigms (EYES, Parry & Toth, Culverhouse) as configurations (docs 09/12).

Non-goals: no backend; no server round-trips; no instance-blurring temporal models; no
port of the prior tools' presentation layers; preset bit-parity beyond the shared Rust
core is NOT claimed until conformance fixtures pass.

## 2. Architecture (Approach A — the graph becomes the spine)

All work in `web/`.

```
web/src/lib/pipelineGraph/  graphDef.ts   nodes, typed edges, knob bindings (declarative)
                            engine.ts     topo sort, dirty-propagation, content-hash memo
                            analysis.ts   derived path queries (visual, NO taxonomy)
web/src/lib/stages/         one file per node, named by node id
web/src/components/GraphPanel/  React Flow 12 + dagre rendered view
```

- The engine runs inside the existing worker (comlink unchanged). Cache key per node =
  hash(ordered upstream output hashes, bound knob values, support-file hashes). Intermediates
  live in worker memory per file; evicted under pressure → full recompute (never wrong,
  only slower). Main thread holds graph definition + dirty/clean state only.
- Knob change → dirty bound nodes → recompute only the downstream cone.
- Existing WASM kernels (episode matcher, overlap splitter) stay; they become the bodies
  of their nodes, not special cases.
- All new knobs/sections flow through the LinkML contract (section + node-binding
  annotations) → regenerated TS/OpenAPI → `check:contract` CI.

## 3. Typed edges and the derived layer

Primitive edges (declared, drive execution): `feeds` (dataflow), `gates` (on/off),
`tunes` (parameterizes). Derived layer: **no named taxonomy** (owner decision). Path
queries — `affectedBy`, `builtFrom`, `sharedUpstream`, `mustPassThrough`, `joinPoint` —
computed at build time, rendered as graph highlights + plain-English sentences (doc 06).

## 4. Node catalog (sections are node metadata; names per doc 08)

- **Preprocess** (locked by default; advanced unlock):
  `parse_events → validate_clock → normalize_timezones → dedup_and_order →
  {device_state_timeline, reconstruct_episodes} → categorize_apps`
- **Clean** (tunable): `app_policy → interval_quality → effective_usage`
- **Device branch**: `device_state_timeline → device_usage` (sessions/glances/pickups)
- **Analyze** (study inputs): `observation_window → attribute_person → score_compliance →
  day_coverage` → named output contracts
- Sink nodes: plots, aggregates, exports (Parquet/SPSS), interactive timeline.

The graph is a genuine DAG: `effective_usage` takes two feeds (episodes + state
timeline); `device_usage` branches off the timeline alone.

Existing knobs are RECATEGORIZED in the UI (e.g. min-duration/long-duration into Clean)
without moving where they execute. The complete setting→element mapping is doc 12 — every
one of the 44 contract slots, all research-pipeline knobs, and all prior-art settings map.

## 5. Device-state contract (normative: doc 11)

`device_state_timeline` emits the **factored state** — power × interactivity × display ×
keyguard × per-profile user state — with overlays `display_evidence`, `observation`,
`clock_quality`, `gap_cause`, profile map. Downstream nodes consume the named **8-state
screen-time projection**. The flat six-state alphabet is rejected (second audit; verified).
`state_inference` paradigm knob: witness-based vs complement-based. Multi-stream witnesses
(doc 10) plug into the same fusion when present; usage-events-only is the degenerate case.

## 6. Reconstruction strategies (first-class, versioned)

`reconstruct_episodes` and `device_usage` take a named strategy:
`chronicle_lifecycle_matcher` (default; current engine semantics), `eyes_triplet_v1`,
`parry_toth_forward_pair_2025`, `native_screen_end_reason_v1` (state timeline). Strategies
are versioned algorithms with their own tunes — closer-vocabulary knobs cannot emulate
them (doc 11 change #2). Prior-art presets = strategy + policy table + tunes, and may bear
their names only after their conformance suite passes (doc 09).

## 7. Policy tables, interval algebra, lineage

- `app_policy`: ordered rule schema — match fields, stage, interaction-type scope,
  predicate, disposition, cap, flags, priority, terminal. Launcher = metadata;
  reattribution lives in `attribute_person`.
- `interval_quality`: Culverhouse-class rules over ANY interval type (episodes, sessions,
  glances): thresholds, caps, flags; flag-and-retain by default.
- Interval algebra + censoring contracts: paired/left/right-censored intervals, glue,
  precedence, reconciliation, subtraction, clipping, complement.
- **Lineage ledger** (append-only): source-row/parent-interval IDs,
  node/strategy/preset/config/support-file hashes, action/reason, old/new values,
  confidence, one-to-many relations. Appended flags remain for convenience but the ledger
  is the record. Policy tables + presets are versioned independently of the app; hashes in
  every report.

## 8. Support files (Analyze; all optional — absent file ⇒ dependent nodes show
"needs input", never fail silently)

Device-sharing table, study-dates table, survey-attribution file, eligibility/roster,
enrolled/expected-device denominator. Uploaded like the codebook; formats defined in the
LinkML contract.

## 9. UI

Settings regrouped Preprocess/Clean/Analyze; Graph tab (React Flow + dagre) with
dirty/cached/recomputed badges and the path-query interactions (click → affected cone,
two-select → shared upstream, hover → must-pass-through) with plain-English sentences —
no taxonomy labels anywhere; Study Inputs card for the five support files; ResultPanel
gains Analyze outputs (attributed stream, compliance report).

## 10. Testing

- **Parity**: golden fixtures generated from the Python originals for each ported feature
  (synthetic inputs only — no study data); vitest row-level equality.
- **Conformance**: per-preset fixtures generated from the prior tools' own code; a preset
  may carry its name only when green.
- **Engine**: dirty-propagation, cache-hit/eviction, path-query unit tests on fixture
  graphs.
- **Invariants per node contract**: duration conservation, no overlap after splitting,
  clipping bounds, coverage (placeholder invariant = hard error).
- Existing web-parity matrix extended; Playwright e2e for the graph panel.

## 11. Error handling

Node-scoped fail-loud errors surfaced on the graph node; no silent empty outputs.
Clock-quarantine (`validate_clock`) is a visible report, not a silent drop. Memory
pressure: evict caches, downgrade to full recompute, notify.

## 12. Dependencies

`@xyflow/react` ^12 (MIT), `@dagrejs/dagre` ^3 (MIT). No state library; no backend.

## 13. Phasing (implementation plan will elaborate)

1. Graph engine + graphDef over the EXISTING stages (byte-identical outputs; parity gate).
2. Decompose `processRawCsvContent` into node files; UI regrouping; Graph tab.
3. State-timeline factored contract + `validate_clock` + lineage ledger.
4. Port the five research-pipeline features (Clean/Analyze nodes + support files).
5. Strategies + policy tables; prior-art conformance fixtures; presets.
