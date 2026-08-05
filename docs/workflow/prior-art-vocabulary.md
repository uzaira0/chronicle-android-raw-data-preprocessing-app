# Prior-Art Vocabulary — Parry & Toth, EYES, Culverhouse

Extracted 2026-07-14 from primary sources (paper PDF + code). This is the community
vocabulary the pipeline-graph node/knob names are grounded in.

## Parry & Toth 2025 (methodological primer; the field's canonical terms)

Bracket-first, start-only forward pairing. Event types kept: {1 Activity Resumed,
15/16 Screen Interactive/Non-Interactive, 17/18 Keyguard Shown/Hidden, 26/27 Shutdown/Startup}.
Activity Paused (2) and Activity Stopped (23) deliberately ignored.

| Term | Definition |
|---|---|
| **Usage session** | Continuous device use between UNLOCKING and LOCKING. Start = Screen-Interactive adjacent to Keyguard-Hidden (or Startup); stop = Screen-Non-Interactive adjacent to Keyguard-Shown (or Shutdown) |
| **Glance** | Screen activation while the device stays LOCKED (screen-on → screen-off, no unlock). May contain app episodes (e.g. answering a call without unlocking) |
| **Application usage episode** | Continuous use of one app, built solely from Activity-Resumed events; episode end = next row's start timestamp (forward-pairing), clipped by the enclosing session/glance bracket |
| **Background activity** | Episodes outside every bracket → discarded (caveat: some is real use, e.g. audio apps) |
| **Total smartphone usage** | Σ(session + glance durations) — a DEVICE-level measure, episode-free |

No caps, no gap logic; idle within a bracket is unbounded (T=∞) — safe only where screen-off
events are reliable. Their package blacklist is deliberately conservative and they argue
LAUNCHERS SHOULD BE KEPT (users really interact with home screens).

Forward-pairing is a DISTINCT reconstruction algorithm, not a knob setting: it changes
episode counts (start-only), dedups consecutive resumes, and takes episode endpoints from
the merged event stream. It is not reproducible via closer-vocabulary/proximity knobs —
it must be a named strategy of `reconstruct_episodes` (required change #2 in the
[device-state model](device-state-machine.md)).

## EYES toolbox (ACOI-UofSC; complement-based device-state segmentation)

Detects the NON-active states explicitly; ACTIVE = ¬(SHUTDOWN ∪ IDLE ∪ GAP ∪ GLANCE).

| Term | Definition | Key thresholds |
|---|---|---|
| **SHUTDOWN block** | [shutdown/user-stopped → startup/user-unlocked] | 60 s same-type proximity-glue |
| **IDLE block** | [screen-off/keyguard-shown → screen-on/keyguard-hidden] | 60 s glue |
| **GAP block** | Missing data — "either shutdown or idle, cannot tell"; reconciled/relabelled when a nearby real signal exists (precedence SHUTDOWN > IDLE > GAP) | ≥3 h silence, or reboot with ≥1 s silent neighbor; 10 s reconcile tolerance |
| **GLANCE block** | Screen-Interactive → Screen-Non-Interactive with NO intervening Keyguard-Hidden; an unlock REVOKES the glance candidate | no time cap |
| **ACTIVE** | Complement of all the above (not a guarantee of real use) | — |
| **Pickup** | An ACTIVE interval in the filled block timeline. NOTE: the pickups EXPORT file contains EVERY block type passing the duration floor (with a `block_type` column) — the ACTIVE rows within it are the pickups | ≥5 s; 5 s fill tolerance |
| **App triplets** | resume/pause/stop reconstruction, 2 s proximity-binding, T=∞ (closed only by real signals: stop, app-kill, reboot); every episode carries an inference tag (how its end was determined) | 2 s |
| **FAU ("Final App Usage")** | App usage ∩ ACTIVE — app time counted only while the device state is ACTIVE | status=ACTIVE, primary layer |

## Culverhouse chronicle-preprocessed-cleaning (downstream trim-and-log)

Never redefines episodes; bounds implausibility, transparently.

| Term | Definition | Default |
|---|---|---|
| **Block (collapse)** | Adjacent same-app rows with gap ≤ threshold merged ("multiple app instances reflect one usage") | 1 s |
| **bad_apps cap** | Per-package duration cap for launchers/system/clock/implausible apps — truncate + flag + log, never delete (legitimate BRIEF use is kept; the cap amputates the implausible idle tail) | 42 pkgs, 10 min |
| **long_3h / long_6h** | MUTUALLY EXCLUSIVE flags (a >6 h row is long_6h only, not both); >6 h → configurable action. Default action = `truncate_to_bad_app`: truncate to the 10-MIN bad-app cap (not to 6 h), applied to ALL row types (App Usage, Session, Glance) | truncate_to_bad_app (10 min), scope=all |
| **day_flags** | `partial_day` (first/last day; >12 h-gap boundary days — PARENT devices only), `DST_day`. Flag-and-retain, never drop | 12 h |
| **event_flags / truncated_secs** | Every mutation stamped in-row + logged to CSVs | — |

## The convergence

| This app + research pipeline | EYES | Culverhouse | Parry & Toth |
|---|---|---|---|
| screen-ON ∩ device-alive crediting | app usage ∩ ACTIVE (FAU) | — | session/glance brackets (hard clip) |
| liveness chain (gap ⇒ break) | GAP blocks (3 h) | >12 h ⇒ partial_day flag | none (T=∞ in bracket) |
| boot-in-gap ⇒ dead void | reboot-adjacency gap (1 s) | — | — |
| screen-off blip bridge | 60 s proximity-glue | 1 s same-app collapse | — |
| long-session truncate | — | 6 h action | none |
| system-app relabel (kept, excluded) | — | 10-min cap, flag+log | blacklist; KEEP launchers |
| no-witness ≥2-apps rule | — | — | — (novel here) |
| person attribution | — | — | — (novel here) |

The credit operation here and EYES's FAU are the SAME structural operation (episodes ∩
device-active state) with different state-inference paradigms: witness-based (state changes
only at witnessed events) vs complement-based (detect non-active, call the rest active).

## Final node naming (grounded in the above)

| Node id | UI label | Anchor |
|---|---|---|
| `parse_events` | Event parsing | — |
| `validate_clock` | Clock & observability validation (quarantine invalid/discontinuous timestamps; preserve raw timestamp + original timezone) | second audit and [device-state model](device-state-machine.md) |
| `normalize_timezones` | Timezone normalization | — |
| `dedup_and_order` | Event dedup & ordering | EYES uniq + reorder |
| `device_state_timeline` | Device-state timeline | EYES blocks; P&T brackets |
| `reconstruct_episodes` | Usage-episode reconstruction | P&T "usage episode" |
| `categorize_apps` | App categorization | codebook |
| `app_policy` | App policy — mark filtered packages (MARK only; the lossy blanking lives in `interval_cleaning`. Pinned before episode building — both episode passes read the marks) | Culverhouse bad_apps; P&T launcher doctrine; EYES mark-treatment-deferred |
| `episode_annotations` | Episode annotation (engagement & flags — lossless columns: engagement walk + long-usage/data-gap flag-and-retain; split 2026-07-15 from `interval_quality`) | Culverhouse event_flags/long_3h/long_6h (flag-and-retain) |
| `interval_cleaning` | Interval cleaning (blank & drop — the lossy half: filtered-timing blanking, selected-type removal, zero-duration drop; split 2026-07-15 from `interval_quality`) | Culverhouse trim-and-log |
| `effective_usage` | Effective usage (episodes ∩ device-active, truncated) | EYES FAU + Culverhouse truncate |
| `device_usage` | Device-level usage (sessions/glances/pickups) | P&T totals; EYES pickups |
| `observation_window` | Observation-window filtering | measurement convention |
| `attribute_person` | Person attribution (shared devices) | novel |
| `score_compliance` | Compliance scoring | — |
| `day_coverage` | Day coverage & flags | Culverhouse day_flags |

---

## External prior art & positioning (added 2026-07-18)

The three engines above (P&T, EYES, Culverhouse) are the *processing* prior art and are
already ported. The items below situate this work in the wider literature — where the
measurement-science and reproducibility framing has already been done by others, so the
paper claims the *intersection*, not ground that is taken. Sources verified via web
search 2026-07-18; grep-weights + research-before-building run recorded in the session.

### The collaborator context — Chronicle is the CAFE instrument
- **CAFE = Comprehensive Assessment of Family Media Exposure Consortium** (Georgetown
  Early Learning Project; Barr, Kirkorian, Coyne, Radesky). Its toolkit is **MAQ
  (questionnaire) + TUD (time-use diary) + EMA + a passive-sensing app**, and that app
  is **Chronicle (Android) / Screen Time (Apple)** — i.e. the collector this pipeline
  processes. Conceptual frame = the **DREAMER** model. Toolkit paper: *Beyond Screen
  Time* (Barr et al., Frontiers in Psychology 2020, PMC7365934). Latest: Barr, 2026
  Presidential Address, *"Examining Family Media Ecology"*, Infancy (Wiley).
  → **Positioning:** frame the paper as the reproducible, ontologized *processing +
  validation layer under the CAFE Chronicle stream*. The CAFE toolkit papers specify
  *what is collected*, not *how the event log becomes minutes* or *how that transform is
  proven correct* — that is the uncontested niche.

### P&T — formal citation for the bibliography
- Parry, D. & Toth, R. (2025), *Extracting Meaningful Measures of Smartphone Usage from
  Android Event Log Data: A Methodological Primer*, **Computational Communication
  Research** (CCR2025.1.8.PARR). OSF preprint doi:10.31234/osf.io/mfnu9. Ships
  pseudo-code + an R implementation + a sample raw log. This is the source the
  `reconstruct_episodes` forward-pairing strategy and the bracket vocabulary are grounded
  in the [prior-art vocabulary](prior-art-vocabulary.md#parry--toth-2025).

### The multiverse angle is ALREADY occupied for screen time — do not claim "first"
- Valkenburg/Beyens (Amsterdam/ASCoR), *"Traces as Data"* — specification-curve analysis
  over temporal operationalization (time-frame / time-lag) of logged smartphone use.
- Published multiverse / specification-curve analyses of how logged smartphone use is
  operationalized (usage metrics such as duration / frequency / fragmentation) already exist
  from the same Amsterdam group and adjacent authors. ⚠ *Not yet verified against primaries:*
  the exact specification count and the precise author/venue attribution for the
  "duration/frequency/fragmented/sticky" multiverse are recalled from web snippets and were
  conflated — confirm the citation before it goes in a paper. The load-bearing point (a
  screen-time multiverse has been done) does not depend on the number.
- General method precedent: *"A sensitivity analysis of preprocessing pipelines: toward
  a solution for multiverse analyses"* (PMC12319823); crowdsourcing-multiverse tutorial
  (2025).
  → **Positioning:** the novelty is NOT "multiverse for screen time." It is a multiverse
  **wired into a typed, PROV-O/LinkML-provenanced, incrementally-recomputed engine whose
  every transform is proven correct** (metamorphic + covering-array + property tests).
  None of the multiverse papers or the three ported engines do the verification half —
  they report that estimates vary; we guarantee each specification is computed correctly
  and regenerate the whole surface deterministically.

### Adjacent tooling (related-work citations; none combine verification + ontology)
- **RAPIDS** — Snakemake reproducible sensing-feature pipeline (closest architecture).
- **ActivityWatch** — OSS automated usage tracker incl. Android sessionization.
- **SplitLight** — toolkit to make preprocessing/split decisions "measurable,
  comparable, reportable" (recsys domain; closest philosophy).
- **Stanford Screenomics** open collection platform (Nature Health 2026 / medRxiv 2025)
  — collection, not processing; the screenshot rival to event-log operationalization.

See `docs/chronicle-ontology-ecosystem.md` (research-pipeline) for how this pipeline's
LinkML contract fits the wider /home/opt ontology stack (sleep-scoring-ontology,
chronicle-server collection ontology, actours computation-provenance, iOS tag ontology).
