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
it must be a named strategy of `reconstruct_episodes` (doc 11, required change #2).

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
| `validate_clock` | Clock & observability validation (quarantine invalid/discontinuous timestamps; preserve raw timestamp + original timezone) | second audit, doc 11 |
| `normalize_timezones` | Timezone normalization | — |
| `dedup_and_order` | Event dedup & ordering | EYES uniq + reorder |
| `device_state_timeline` | Device-state timeline | EYES blocks; P&T brackets |
| `reconstruct_episodes` | Usage-episode reconstruction | P&T "usage episode" |
| `categorize_apps` | App categorization | codebook |
| `app_policy` | App policy (per-package actions) | Culverhouse bad_apps; P&T launcher doctrine |
| `interval_quality` | Interval quality (thresholds/caps/flags on any interval type) | Culverhouse long-event actions, scope=all |
| `effective_usage` | Effective usage (episodes ∩ device-active, truncated) | EYES FAU + Culverhouse truncate |
| `device_usage` | Device-level usage (sessions/glances/pickups) | P&T totals; EYES pickups |
| `observation_window` | Observation-window filtering | measurement convention |
| `attribute_person` | Person attribution (shared devices) | novel |
| `score_compliance` | Compliance scoring | — |
| `day_coverage` | Day coverage & flags | Culverhouse day_flags |
