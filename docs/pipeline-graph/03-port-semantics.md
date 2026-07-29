# Cleaning & Analysis Semantics — the algorithms to port

> **Historical behavior specification.** The port is complete and the old
> Python/TypeScript targets are gone. Preserve the concrete cases below as test
> evidence, but implement and verify them only in the Rust/Salsa authority.

Faithful description of the consuming pipeline's post-engine logic, for the client-side
TypeScript port. Port targets must be parity-tested against golden outputs generated from
the Python originals.

## 1. §14 valid-usage credit (the Layer-2 paradigm)

One sentence: **a counted minute = screen-ON, single-app-foreground exposure on a live
(held-open) device, app-agnostic, bounded by a 6-hour TRUNCATE (not zero-out).**

Layer model:
- **L1** (this engine): session reconstruction with NO duration cap
  (`long_duration_threshold_hours` set so high it never fires — the "nocap" config), so
  long sessions survive to be screen-gated instead of being zeroed.
- **L2** (the credit, to be ported): rewrites each App-Usage session into one row per
  credited interval. Downstream day/hour splitting consumes the rewritten rows with zero
  schema change.

### Constants (decided; re-audit before changing)

| Constant | Value | Meaning |
|---|---|---|
| `ON_WITNESS` | Screen Interactive, User Interaction, Shortcut Invocation, Keyguard Hidden, User Unlocked, Chooser Action | Events impossible with the screen off — each witnesses screen ON |
| `OFF_WITNESS` | Screen Non-Interactive, Device Shutdown | Explicit lock, or power-off (credit stops AT the shutdown; silence BEFORE a shutdown stays held-open) |
| `AUTOLOCK` | 120 s | Blip-bridge scale: an OFF shorter than the hard auto-lock cannot BE the auto-lock → bridged |
| `LIVENESS_TOL` | 120 min | Held-open heartbeat cadence tolerance (fleet-derived; a Clean knob in the new taxonomy) |
| `CAP` | 360 min | The 6-hour truncate — the ONLY length bound |
| `MIN_DAY_APPS` | 2 | No-witness fallback: credit a witness-less window only if the participant-day switched across ≥2 distinct apps (you cannot switch apps on a dark screen) |

### Algorithm per session [s, e_raw]

1. `e = min(e_raw, s + CAP)` — truncate.
2. **Screen-state change points**: fold the participant's typed events; any ON_WITNESS sets
   ON, OFF_WITNESS sets OFF; heartbeat-only events (standby bucket, notifications, activity
   lifecycle, foreground service) do NOT move the state; collapse consecutive same-state points.
3. **Creditable (screen-ON) intervals** over [s,e): ON segments, merging across any OFF
   segment shorter than AUTOLOCK.
4. **Alive intervals** (the cadence chain): chain all event timestamps in [s−tol, e+tol];
   alive across a silence iff the next event arrives within `tol` AND no `Device Startup`
   lands in the gap (a boot positively witnesses the device was OFF before it — breaks the
   chain even under tol; ~10 s epsilon because a boot lands just after the event closing its
   gap). Clip chains to [s,e]. Bracketing events just outside the window count (a post-cap
   heartbeat proves held-open across the cap).
5. **Credit = screen-ON ∩ alive.**
6. **No-witness fallback**: if no screen witness at-or-before s and none inside [s,e]:
   credit = alive if the participant-day has ≥ MIN_DAY_APPS distinct apps, else ∅ (lone held
   app with no witness = phantom).
7. **Screen-incapable devices** (participant never emitted BOTH an ON and an OFF witness):
   full-window credit [s,e].
8. Emit one output row per credited interval, carrying the parent session's columns with
   start/stop/duration overridden, and **recompute the calendar columns**
   (date/hour/day/weekday variants/quarter) from the NEW local start — otherwise the daily
   grain (grouped by `date`) desynchronizes from an hourly split (recomputed from start),
   breaking cross-midnight sessions.
9. Only credit sessions that PASSED the minimum-duration floor (duration > 0). Floored
   sub-minimum glances pass through unchanged; crediting them from start/stop would re-admit
   glance minutes the floor removed.
10. A fully-dead session emits NO rows (0 credited minutes); the placeholder pass still
    covers the day.

### Interaction-type canonicalization prerequisite

The credit reads the RAW event stream (pre-engine), canonicalized with the engine's
`ALL_INTERACTION_TYPES_MAP` plus casing fixups (e.g. "Screen Non-interactive" →
"Screen Non-Interactive"). Any residual unmapped "Unknown importance:" label is a hard error.

### Scope

Applied to screen-capable personal-device streams. NOT applied to screen-incapable shared
study tablets — those keep the L1 duration cap as a backstop and skip the credit entirely.

## 2. App-filter relabel (post-engine)

Relabel a filtered package's output `App Usage` rows to `Filtered App Usage`, matched as
(package, label) pairs validated against the filter file (same match rule as the engine's
`should_filter_app`). Relabeling OUTPUT sessions is equivalent to the engine's event-level
filtering for whole-package filters: session boundaries are unchanged because the filtered
app already sat on the foreground timeline (it still closes other apps' sessions).
Downstream screen-time models exclude `Filtered App Usage` (and `Non-Target Child App Usage`).

Filter-file governance: the production list is GENERATED from an app registry — never
hand-edited.

## 3. Kids-shell launcher relabel (conditional)

Treat the kids'-mode home shell (e.g. `com.amazon.tahoe`) as a launcher — but ONLY on
(participant, date) device-days that ALSO have ≥1 non-shell `App Usage` row. Rationale: on a
device where the logging app is not installed inside the child profile, the shell can be the
ONLY signal the device was used at all; unconditional filtering would fake "no data" days.
Under the §14 paradigm on personal devices this relabel is OFF (the shell counts as a
regular, screen-gated app); it applies to the shared-tablet stream.

## 4. Person attribution (shared devices)

- **Device-sharing lookup**: exact participant match first, then numerical+device-number
  match. NO fallback to "first participant with the same numerical id" (a known
  wrong-attribution bug class). A device configured as shared but unmatched in the sharing
  table is a hard error, not a silent default.
- **Survey-username relabel**: exact-timestamp matches from usage-survey answers relabel the
  session's username.
- **Null-username fill + Non-Target marking**: remaining unlabeled usage on a shared device
  is attributed by the sharing configuration; usage attributed to someone other than the
  target participant becomes `Non-Target Child App Usage` (excluded from screen time, kept
  for compliance accounting).
- **Kids-shell on shared devices** → attributed to the target child (consistent with the
  §14 view that the shell is the child's surface).

## 5. Per-day compliance (attribution-based studies)

Per (device, day): `compliance = known / (known + unknown)` where known = target + other
attributed minutes and unknown = unattributed. Non-shared devices = 100 by definition.
A day is valid iff ALL of the participant's enrolled devices meet the threshold (e.g. 70%)
that day. Device-level validity allows a bounded number of invalid days. These
thresholds/formulas are per-study configuration, never hardcoded cross-study. A
"compliant day with zero real usage" is kept at 100 but FLAGGED (glance-only day), not
silently counted.

## 6. Study-window filter + placeholders

- Window filter: keep sessions whose LOCAL calendar date (per-row timezone) falls inside
  the participant's [start, end] study window (N days by study). Local midnight-to-midnight.
- Placeholders: for every (participant, device, study-day) with no surviving usage, emit a
  placeholder row — "No Activity" when the device was logging that day but had no usage,
  "No Data" when the device wasn't heard from at all. Placeholder days carry compliance 100.
- Coverage invariant: after placeholders, every windowed device × study-day must have ≥1 row;
  a gap is a hard error (fail loud, never silently drop a day).

## 7. Timezone decision (upstream of everything)

Convert ALL data to the study's single primary timezone (the study clock), NOT each file's
own primary timezone — cross-timezone participants attribute to the study-clock calendar
day. The convert-all option never drops rows; it only drives day attribution. Timestamps
keep millisecond precision end-to-end (1-second truncation materially restates results).
