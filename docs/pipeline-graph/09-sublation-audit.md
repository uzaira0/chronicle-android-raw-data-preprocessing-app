# Sublation Audit — can the ontology absorb every prior paradigm?

Test (2026-07-14): every aspect of every prior pipeline must be reproducible AS A
CONFIGURATION of the ontology (node/knob/edge/preset/support-file/output-contract), or the
ontology expands. First audit below. The independent adversarial second audit (external
model, full device-state state-machine derivation) is COMPLETE — its verdicts are in
**doc 11** and amend this file; amendments are marked ✎. All spot-checkable second-audit
claims were verified true against the source code before adoption.

## Sublates cleanly with the base ontology

| Prior-art concept | Ontology element |
|---|---|
| P&T forward-pairing episodes | ✎ REVISED: NOT expressible as a closer-vocabulary preset (verified). Start-only forward-pairing changes episode counts, dedups consecutive resumes, and takes endpoints from the merged event stream. Requires `reconstruct_episodes` strategy = `parry_toth_forward_pair_2025` (first-class versioned algorithm, doc 11 change #2) |
| P&T event-type whitelist | `interaction_types_to_remove` knob (native) |
| P&T background-episode removal | `effective_usage` policy: mask = brackets, action = clip |
| EYES 2 s proximity triplet binding | ✎ REVISED: approximate, NOT semantically identical (verified). This engine's proximity knob only suppresses an Activity-Stopped *fallback* close near a re-resumed session; EYES binds resume/pause/stop triplets by proximity. Agreement is outcome-level on shared fixtures. Exact parity requires strategy = `eyes_triplet_v1` |
| EYES primary/secondary multi-window split | concurrent-usage modeling + overlap splitter (native) |
| EYES glue/reconcile/gap thresholds | knobs tuning `device_state_timeline` (60 s glue, ≥3 h gap, 10 s reconcile, 1 s reboot-adjacency) |
| Culverhouse 1 s same-app collapse | episode merge-gap knob |
| Culverhouse long-event actions | ✎ REVISED: interval-quality policy applying to App Usage, Session AND Glance rows (`apply_long_event_action_to = "all"`), default action = truncate to the 10-min bad-app cap, long_3h/long_6h flags mutually exclusive → a general interval-quality-policy node, not a knob on `effective_usage` alone (doc 11 change #5) |
| Culverhouse timezone modal filter | native timezone-handling option |

## The expansions (first audit's five, ✎ AMENDED by the second audit — full detail in doc 11)

1. **Factored device state + overlays** (supersedes "richer six-state alphabet"). The flat
   alphabet `{unlocked-interactive, lit-locked, screen-off, powered-off, data-gap,
   unwitnessed}` was REFUTED: gap/unwitnessed overlap every physical state; shutdown events
   don't prove powered-off; screen-off conflates dark and ambient/AOD. Replacement: factored
   state (power × interactivity × display × keyguard × per-profile user state) with
   observability/clock-quality/gap-cause as OVERLAYS, plus a named screen-time PROJECTION
   (8 states) for downstream use. The `state_inference` paradigm knob (witness-based vs
   complement-based) survives.
2. **Device-level usage branch** — confirmed, with more inputs: `device_usage` consumes
   reconciled state intervals + observation bounds + profile context + a named construction
   strategy (not "the timeline alone").
3. **Table-driven app policy** — confirmed as tables; action list REVISED to an ordered rule
   schema (match fields, stage, interaction-type scope, predicate, disposition, cap, flags,
   priority, terminal behavior). `launcher` becomes metadata/`keep`; `reattribute` moves to
   person attribution where it belongs.
4. **Provenance → immutable lineage ledger** — appended flags (`end_source`, `credit_state`,
   `truncated_secs`, `day_flags`) are kept but are NOT sufficient: splits and collapses need
   an append-only ledger with source-row/parent-interval IDs, node/preset/version/config
   hashes, action/reason, old/new values, one-to-many relations.
5. **Conditional bindings** — broadened beyond device class + screen capability: conditions
   may reference profile, stream, asserted capabilities, witness coverage
   (`screen_witness_coverage = none|on_only|off_only|both` — never silently promoted to
   "hardware incapable"), device role, OS/collector protocol.

Plus three NEW expansion classes the first audit missed (doc 11 changes #2, #3, #7, #8):

6. **Reconstruction strategies as first-class versioned algorithms**:
   `chronicle_lifecycle_matcher`, `eyes_triplet_v1`, `parry_toth_forward_pair_2025`,
   `native_screen_end_reason_v1`.
7. **Interval algebra + censoring contracts**: partial blocks (left/right-censored),
   endpoint glue, precedence, reconciliation, subtraction, clipping, complement.
8. **Additional support-file contracts + clock validation**: survey attribution,
   eligibility/roster, enrolled/expected-device denominator (compliance validity is not
   computable without enrollment); `validate_clock` node before timezone normalization,
   preserving raw timestamps and original timezones.

## The preset claim (✎ WITHDRAWN pending conformance)

Original claim: each prior pipeline is a NAMED PRESET runnable in the app. Second-audit
verdict (accepted): EYES and P&T are NOT currently exact configurations. The claim is
restored per-preset only when that preset's fixture-conformance suite passes (golden
fixtures generated from the prior tool's own code on synthetic inputs). Until then the
presets are TARGETS: "Parry-Toth 2025", "EYES", "Culverhouse-cleaning", each backed by a
named strategy + policy table + conformance tests, comparable via the A/B view.

Sublation remains claimed at the SEMANTIC level; bit-parity only where the shared Rust core
executes.

## Known residue (deliberately not absorbed)

Presentational layers of the prior tools (EYES Tkinter GUI, its plot scripts) — this app
has its own render/review surfaces.
