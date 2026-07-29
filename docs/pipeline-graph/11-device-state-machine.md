# Device-State Machine + Second-Audit Verdicts

Source: independent adversarial second audit (external frontier model, max effort,
2026-07-14) covering all four prior pipelines, the P&T paper, the Android `UsageEvents`
platform semantics (AOSP source), and this initiative's docs 01-10. Every cheaply
checkable claim it made was spot-verified against the actual source code before adoption —
all verified TRUE (42 bad-app packages; Culverhouse default >6 h → truncate-to-10-min with
scope=all; EYES pickups export = all block types; this engine's proximity ≠ EYES proximity;
an EYES-inspired `device_states` port exists in the consuming research pipeline and
conflates User-Stopped with shutdown).

## 1. The factored state (authoritative contract of `device_state_timeline`)

A device state is NOT one label. It is a tuple of independent physical/user dimensions,
plus an observability overlay:

| Dimension | Values | What usage events can actually witness |
|---|---|---|
| Power/runtime `P` | ON, OFF, REBOOTING, UNKNOWN | Shutdown (26) is a runtime persistence boundary whose timestamp precedes actual off; post-shutdown observable state is `{OFF or REBOOTING}` — never proven powered-off. Startup (27) can follow a physical boot OR a runtime restart |
| Interactivity `I` | INTERACTIVE, NONINTERACTIVE, UNKNOWN | 15 = full interaction; 16 = either dark display or ambient/AOD |
| Physical display `D` | VISIBLE_INTERACTIVE, AMBIENT, OFF, UNKNOWN | 16 cannot distinguish AMBIENT from OFF; Android also permits interactive with display temporarily off (proximity sensor) |
| Keyguard `K` | HIDDEN, SHOWING, OCCLUDED, UNKNOWN | 17 witnesses only SHOWING_OR_OCCLUDED (no occlusion code); a call/camera activity can be RESUMED over a still-shown keyguard |
| Per-user/profile `U[u]` | RUNNING_LOCKED, RUNNING_UNLOCKED, STOPPED, UNKNOWN | 28 = first credential-encrypted-storage unlock per user/profile (not keyguard); 29 = profile/user stop (device may stay ON and interactive) |
| Observability `O` (overlay) | stream ∈ {OBSERVED, SILENT, UNKNOWN}; clock ∈ {VALID, INVALID, DISCONTINUOUS}; gap_cause ∈ {UNKNOWN, RUNTIME_DOWN_BOUNDED, COLLECTOR, UPLOAD, PERMISSION, …} | No raw code identifies collector restarts or upload outages (25 is a UsageStats DB flush, not a heartbeat) — collector/upload causes need the multi-stream witnesses of doc 10 |

Auxiliary (needed to interpret the remaining codes, not device state): activity
instances/topology `A`, foreground services `F`, per-package standby bucket `B`,
notifications `N`, configuration `C`, timezone history `Z`.

Key reachability facts the flat alphabet could not express (all platform-verifiable):
interactive + keyguard-occluded (call/camera over lockscreen); noninteractive + AMBIENT
(AOD); user CE-unlocked while keyguard showing (relock does not re-lock storage); one
profile STOPPED while the device is interactive; any physical state under `stream=SILENT`;
any apparent state under an invalid/1970 clock.

## 2. The screen-time projection (named 8-state alphabet for downstream nodes)

The factored state is authoritative; downstream nodes that want one label per interval use
this honest projection:

| Projected state | Enter witness | Exit witness |
|---|---|---|
| `RUNTIME_DOWN_OR_RESTARTING_WITNESSED` | 26 | 27 |
| `ON_PRE_FIRST_USER_UNLOCK` | 27 with no 28 yet for the profile | 28 for that profile; shutdown/user-stop |
| `ON_INTERACTIVE_KEYGUARD_HIDDEN` | 15 with latest K=hidden | 16, 17, or 26 |
| `ON_INTERACTIVE_KEYGUARD_SHOWING_OR_OCCLUDED` | 15 with latest K=shown | 16, 18, or 26 |
| `ON_NONINTERACTIVE_KEYGUARD_HIDDEN` | 16 with latest K=hidden | 15, 17, or 26 |
| `ON_NONINTERACTIVE_KEYGUARD_SHOWING_OR_OCCLUDED` | 16 with latest K=shown | 15, 18, or 26 |
| `ON_INTERACTIVITY_OR_KEYGUARD_UNKNOWN` | startup or non-screen event without sufficient 15/16/17/18 history | any sufficient screen/keyguard witness, or 26 |
| `PHYSICAL_UNKNOWN` | start/end of observation, invalid clock, unbounded missing history | a valid state witness |

Every projected interval also carries the overlay fields:

```text
display_evidence = interactive-visible | ambient-or-off | off-inferred | unknown
observation      = observed | silent
clock_quality    = valid | invalid | discontinuous
gap_cause        = unknown | runtime-down-bounded | collector | upload | permission
profile map      = {profile_id -> locked | unlocked | stopped | unknown}
```

Prior-art states are quotients of this projection: P&T session ≈ interactive∧K-hidden
brackets; P&T glance ≈ interactive∧K-shown; EYES IDLE ≈ noninteractive/K-shown; EYES
SHUTDOWN ≈ runtime-down (EYES additionally — incorrectly — folds User-Stopped in); EYES
GAP ≈ `observation=silent` overlay; the doc-10 gap taxonomy = the `gap_cause` overlay.

## 3. Transition-function principles (full δ table archived with the audit report)

- Transitions are universally quantified: an event updates ONLY its own dimensions
  (15 sets P/I/D, leaves K and U untouched; 17/18 set K only, never I; 28/29 set `U[u]`
  only, never global power; 26 closes open activities/services and yields
  `P ∈ {OFF, REBOOTING}`; 27 resets topology and starts a boot epoch with I,K unknown).
- Lifecycle codes (1/2/23/24) update activity topology `A`, not device state: a resume
  does NOT imply screen-interactive, unlocked, or exclusive foreground (split-screen/PiP =
  multiple RESUMED activities).
- Evidence codes (6/7/8/9/10/12/31) record liveness/interaction evidence; treating them as
  "screen ON" (as the current screen-gated crediting does for a subset) is a POLICY,
  recorded as such with its evidence basis — not a platform fact.
- Rollover markers (3/4/21/22) are stats-interval boundaries, not user actions.
- 11 is per-app standby bucket — it cannot witness Doze, display, or interactivity.
- An unmatched state-dependent close produces an anomaly/lineage record; it never invents
  a physical transition.
- Silence: below the liveness threshold ⇒ `observation=silent`, physical belief unchanged
  (bridging it as alive is a crediting POLICY); above threshold ⇒ gap interval with
  `gap_cause=unknown`, relabelable by real endpoint evidence (EYES reconciliation) or by
  multi-stream witnesses (doc 10).
- Clock: 1970/backward-jump timestamps are quarantined into clock epochs by
  `validate_clock` BEFORE ordering and timezone normalization; raw timestamp + original
  timezone are preserved alongside normalized values.

## 4. What each prior pipeline retains/conflates (audit table, abridged)

| Pipeline | Retains | Conflates/ignores |
|---|---|---|
| This engine's native screen usage | interactive bracket + heuristic end reason | ambient vs off, credential unlock, profiles, occlusion, collector state |
| Screen-gated crediting (research pipeline) | ON/OFF/unknown + cadence-alive | treats several evidence codes as ON; ignores keyguard, ambient, profiles |
| Research pipeline `device_states` port | SHUTDOWN/IDLE/GAP/GLANCE/SESSION | folds User-Stopped into SHUTDOWN; no partial blocks, no gap reconciliation, non-EYES pickup semantics |
| EYES | 5 blocks + ACTIVE complement | user-stop=shutdown, keyguard-shown=idle, ambient=off; no occlusion/direct-boot/profiles/clock |
| P&T | sessions/glances/off-between | ambient=off; no liveness, profiles, occlusion, clock, concurrency |
| Culverhouse | long-gap + day-quality evidence only | trusts upstream labels entirely (by design) |

The superset machine reproduces each as a projection + policy choice — that is the
sublation guarantee, now stated at the right level.

## 5. Required changes (all 12 ADOPTED)

1. Factored state + overlays + the 8-state projection replace the flat six-state alphabet.
2. Reconstruction strategies as first-class versioned algorithms:
   `chronicle_lifecycle_matcher`, `eyes_triplet_v1`, `parry_toth_forward_pair_2025`,
   `native_screen_end_reason_v1` (closer-vocabulary knobs cannot express the latter two).
3. Interval algebra + censoring contracts (partial/left/right-censored blocks, glue,
   precedence, reconciliation, subtraction, clipping, complement).
4. App policy = ordered rule schema (match, stage, interaction-type scope, predicate,
   disposition, cap, flags, priority, terminal). `launcher` → metadata; `reattribute` →
   attribution stage.
5. General interval-quality-policy node (Culverhouse rules apply to App Usage, Session,
   Glance, and future interval types).
6. Immutable lineage ledger (source-row/parent-interval IDs, node/preset/version/config/
   support-file hashes, action/reason, old/new values, confidence, one-to-many relations).
7. Support contracts for survey attribution, eligibility/roster, enrolled/expected
   devices (compliance validity is not computable without an enrollment denominator).
8. `validate_clock` + collector-observability validation before timezone normalization
   and ordering; preserve raw timestamps/timezones.
9. Derived-role naming — RESOLVED differently than the audit proposed (see §7).
10. Named-preset sublation claim withdrawn until fixture conformance exists (doc 09).
11. Prior-art catalog corrected (docs 08/09).
12. Named output contracts for P&T IDs/sequences/repertoires/trajectories and EYES
    blocks/pickups/FAU — not a generic `reports` sink.

## 6. Recommended changes (adopted)

Preserve activity-instance/task/display/profile identifiers where available;
`screen_witness_coverage = none|on_only|off_only|both` separate from asserted capability;
confidence + duration bounds on inferred intervals; per-node invariants (duration
conservation, overlap, clipping, coverage); multi-preset sensitivity comparison with
row-level disagreement explanations; policy tables + presets versioned independently of
the app, hashes in every report.

## 7. Derived-layer naming resolution (owner decision, 2026-07-14)

The audit's change #9 proposed structural graph terms (`dominates_path`, `fans_out_to`,
`merges_at`) to replace the causal vocabulary. The owner rejected BOTH vocabularies: the
derived layer carries no taxonomy at all. It is a set of path queries surfaced visually
(highlight cones, shared-upstream pulses, must-pass-through emphasis) with plain-English
sentences. See doc 06 for the query set and rendering rules.
