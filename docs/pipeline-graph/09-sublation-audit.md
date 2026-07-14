# Sublation Audit — can the ontology absorb every prior paradigm?

Test (2026-07-14): every aspect of every prior pipeline must be reproducible AS A
CONFIGURATION of the ontology (node/knob/edge/preset/support-file/output-contract), or the
ontology expands. First audit below; an independent adversarial second audit (external
model, includes a full device-state state-machine derivation) is running — its verdicts
amend this file.

## Sublates cleanly with the base ontology

| Prior-art concept | Ontology element |
|---|---|
| P&T forward-pairing episodes | closer-vocabulary preset (already exists in the research pipeline as a named preset — proof by existence) |
| P&T event-type whitelist | `interaction_types_to_remove` knob (native) |
| P&T background-episode removal | `effective_usage` policy: mask = brackets, action = clip |
| EYES 2 s proximity triplet binding | `proximityIntervalSeconds` (native; validated equivalent) |
| EYES primary/secondary multi-window split | concurrent-usage modeling + overlap splitter (native) |
| EYES glue/reconcile/gap thresholds | knobs moderating `device_state_timeline` |
| Culverhouse 1 s same-app collapse | episode merge-gap knob |
| Culverhouse long-event actions | truncation-policy knob on `effective_usage` |
| Culverhouse timezone modal filter | native timezone-handling option |

## The five REQUIRED expansions (concepts the base ontology could NOT express)

1. **Richer device-state alphabet.** Binary screen-ON/OFF × alive cannot express P&T's
   session-vs-glance distinction or EYES's four block types. `device_state_timeline` emits
   `{unlocked-interactive, lit-locked, screen-off, powered-off, data-gap, unwitnessed}`
   (alphabet PENDING second-audit verdict), plus a `state_inference` paradigm knob:
   `witness-based` vs `complement-based`. `effective_usage` takes a creditable-state SET
   knob instead of a hardwired screen-ON mask.
2. **Device-level usage branch.** P&T totals and EYES pickups are episode-free device-level
   measures. New `device_usage` node fed only by `device_state_timeline` → session/glance/
   pickup counts & durations. (Also makes the DAG genuinely non-chain.)
3. **Table-driven app policy.** Boolean include/exclude cannot express Culverhouse's
   per-package 10-min cap or P&T's keep-launchers doctrine. One `app_policy` node driven by
   a policy table with action vocabulary `keep | exclude | cap(minutes) | launcher |
   reattribute` — subsumes system-filter + kids-shell + bad-apps as rows.
4. **Row-level provenance contract.** EYES tags every episode's end-inference; Culverhouse
   stamps event_flags/truncated_secs + logs. Standard output contract: every mutating node
   appends flags (`end_source`, `credit_state`, `truncated_secs`, `day_flags`) + a
   mutation-log report. (The fail-loud doctrine made per-row.)
5. **Device-class conditional bindings.** Culverhouse's parent-only gap rule, the
   screen-incapable-tablet full-credit rule, and per-stream presets all condition on device
   class. Optional device-profile input (class, screen-capability) that knobs/presets can
   condition on.

## The preset claim

With the five expansions, each prior pipeline is a NAMED PRESET (+ policy table):
"Parry-Toth 2025", "EYES", "Culverhouse-cleaning" — runnable in the app and comparable
against the house configuration via the existing A/B comparison view.

CAVEAT: sublation is at the SEMANTIC level. Bit-parity is claimed only where the shared
Rust core executes (the episode matcher); EYES's internal triplet-inference tags are
approximated by the closer-vocabulary + proximity knobs, not reproduced byte-for-byte.

## Known residue (deliberately not absorbed)

Presentational layers of the prior tools (EYES Tkinter GUI, its plot scripts) — this app
has its own render/review surfaces.
