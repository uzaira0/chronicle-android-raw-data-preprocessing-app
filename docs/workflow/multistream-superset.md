# Multi-Stream Superset — streams → witnesses → fused state timeline

The collector now gathers many streams beyond the classic usage-event log. The ontology
absorbs them as a SUPERSET via a three-tier split; the single-stream pipeline (and all
prior-art paradigms) remain the special case where only usage events feed the fusion.

## The three tiers

1. **Stream tier** — each collector stream is an ingest node (parse/normalize only; no
   semantics). Streams are pluggable: absent streams simply contribute no witnesses.
2. **Witness tier** — each stream declares a mapping into a common witness vocabulary:
   *(time-or-interval, dimension, value, polarity, strength)*. Mappings are declared data
   (visible in the graph), not code branches.
3. **Fusion tier** — `device_state_timeline` fuses the merged witness set under a declared
   precedence table (EYES's SHUTDOWN > IDLE > GAP reconciliation, generalized).

## Witness dimensions × streams (from the collector inventory, 2026-07-14)

| Dimension | Witnessing streams | Notes |
|---|---|---|
| power | device-lifecycle (startup/shutdown, power connect/disconnect, battery-low), battery telemetry (level/charging/plug) | Shutdown→Startup = explicit off bracket |
| screen | usage-events (screen interactive/non-interactive) AND device-lifecycle (screen on/off) | **double-witnessed** — fusion can cross-check |
| user-presence / unlock | lifecycle USER_PRESENT, keyguard events | the session-vs-glance boundary |
| app-foreground | usage-events | the episode substrate |
| interaction | accessibility interaction stream (tap/scroll/focus, content-free) | strongest "human actively touching" evidence |
| media-playback | audio-activity stream (audioActive, output route, playback state, call active; MIC-FREE — device playback state, NOT ambient audio) | direct evidence for held-open video/audio sessions |
| human-motion | activity recognition (still/walking/in-vehicle), sleep classifier, motion sensors (significant-motion, steps) | presence/mobility; classifier-derived |
| environment | light, proximity sensors (opt-in duty-cycled) | pocket/dark/face-down handling |
| connectivity | connectivity-state, per-app network usage | online/app-activity proxies |
| observability | upload telemetry (when uploads ran), battery heartbeat cadence (~15 min), boot markers, per-module consent/permission state | see gap taxonomy |

## Refined gap taxonomy (replaces the single `data-gap` state)

The lifecycle + upload semantics make "no data" decidable into distinct classes:

| Gap class | Fingerprint |
|---|---|
| **device-off** | explicit Shutdown → Startup bracket |
| **boot-to-first-unlock blind window** | collector is credential-encrypted, not direct-boot-aware → a gap between Startup and first USER_PRESENT is EXPECTED, not a fault |
| **collector-down** | no shutdown/startup pair; heartbeat cadence break; upload-stats gap; process-recovery markers |
| **upload backlog** | server-side silence only — rows carry on-device timestamps and arrive late; NEVER read arrival gaps as device gaps |
| **doze deferral** | periodic heartbeats arrive late (WorkManager deferral) → "possibly dozing", weak evidence only |
| **permission-absent** | stream enabled by consent but OS grant missing → the stream is silent BY GRANT; its absence witnesses nothing |

**Stream-availability gating (critical rule):** a witness ABSENCE is evidence only when the
stream was consented + granted + active at that time. The fusion consumes per-module
availability state as part of the observability dimension.

## Consequences for existing nodes

- `effective_usage`: creditable-state set can now include media-playback and interaction
  witnesses (e.g. "credit held-open video only while audio is active") — as OPTIONAL,
  side-by-side policies, never silently replacing the headline definition.
- `device_usage`: pickups/sessions/glances get event-fidelity boundaries from the lifecycle
  stream even where usage events are sparse.
- `attribute_person`: the collector's user-identification stream (per-time-window user label
  on shared devices) becomes a direct attribution witness alongside the sharing table.
- Liveness knobs: the usage-event cadence tolerance remains for single-stream data; when the
  battery heartbeat is present, liveness upgrades from inference to evidence.
- Provenance contract: every fused state interval records its supporting witnesses
  (`state_evidence`), so multi-stream fusion stays auditable row-by-row.

## Platform note

iOS collects a much narrower set (usage + SensorKit device/phone/messages usage; none of the
device-state/presence streams). The witness model handles this by construction: fewer
streams → fewer witnesses → wider `unwitnessed` intervals, same machinery.

## Contract alignment

The collector repo maintains its own LinkML module registry (module ids, privacy classes,
default-enabled flags). This app's options contract is also LinkML — the stream tier should
REFERENCE the collector's module-id enum rather than redeclare it, keeping the two schemas
in lock-step.
