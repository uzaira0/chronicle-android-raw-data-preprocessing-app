# Section Taxonomy — Preprocess / Clean / Analyze

Decision: the pipeline is organized into THREE sections (not two). The test for the split:
*"Would every research team agree on this step regardless of population (adult/child),
schedule (shift workers), or device fleet?"*

## PREPROCESS — standardized, locked by default

Mechanical faithfulness: recovering the true event/session structure from a noisy Android
usage-event log. Not a matter of research preference.

| Step | Why universal |
|---|---|
| Interaction-type canonicalization | Decoding the Android UsageEvents API — objective |
| Exact-row dedup + canonical total-order sort | Determinism: same raw content → same output (matcher tie-breaks by input order) |
| Millisecond timestamp preservation | Truncating to 1 s materially restates results; never do it |
| Duplicate-timestamp correction | Sub-second determinism |
| Unknown-event guard | Surfaces Android API drift; never a preference |
| Session matcher (opener/closer mechanics) | The core reconstruction algorithm |
| Proximity teardown grace | Corrects an artifact (teardown-vs-close); borderline — keep in Preprocess, expose the constant |
| Activity-Stopped fallback | Recovers a real end Android failed to emit |
| Codebook category JOIN | Metadata enrichment (the category *scheme* itself is a preference) |

## CLEAN — tunable, definitional; varies by use case

Each encodes a judgment about *what counts as usage*. Variability map
(● somewhat · ●● strongly · ●●● fundamentally):

| Cleaning knob | Adult/child | Shift-worker | Device fleet | The judgment |
|---|:--:|:--:|:--:|---|
| App-filter list (which apps count) | ●● | | ● | Is system UI "screen use"? Child vs adult app sets; OEM system packages differ |
| Kids-shell / launcher treatment | ●● | | ●● | Kids'-mode home shell: launcher or app? Fleet-specific |
| Minimum-usage floor | ● | | | Is a sub-minute glance engagement? |
| Long-session bound (cap vs truncate) | ● | ●● | | Night-shift streaming/gaming has legitimate long sessions |
| Screen-ON gating (whole valid-usage credit layer) | ●● | ● | | Must the screen be on? Does held-open video count? |
| Liveness cadence tolerance | | | ●● | Tuned to a fleet's heartbeat cadence (e.g. Fire-tablet ~100 min) |
| Auto-lock bridge scale | | | ●● | Per-OS/user lock-timeout setting |
| Concurrent/PiP + background audio | ● | | | Does background audio count? |
| Closer vocabulary | | ● | | Definitional session boundary |
| Timezone / day-boundary anchor | | ●●● | ● | Midnight-anchored days are wrong for shift workers |

## ANALYZE — study-structural; needs external inputs

Not stream cleaning: these score participants and impose study structure. They consume
external tables the raw log cannot provide.

| Step | External input needed |
|---|---|
| Study-window filter (N-day window per participant) | study-dates table |
| Person attribution (shared devices) | device-sharing table (+ optional usage-survey answers) |
| Study-day placeholders (No Data vs No Activity) | study-dates table |
| Per-day compliance + threshold validity | device-sharing table + threshold config |

Compliance formulas are STUDY-SPECIFIC and must never be assumed shared between studies
(one known study uses known/(known+unknown) with a % threshold; another uses presence-based
validity with compliance sourced entirely outside the usage data).

## Note on current code

The existing engine config mixes mechanical and definitional knobs in one flat surface;
the web UI's cards group by topic (session/screen/interaction semantics), not by this
taxonomy. The re-organization is presentational + contract metadata (a `section` annotation
per knob), not a behavioral change.
