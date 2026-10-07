# Prior-Art Vocabulary — Parry & Toth, EYES, Culverhouse

Extracted 2026-07-14 from primary sources (paper PDF + code). This is the community
vocabulary the pipeline-graph node/knob names are grounded in.

**Provenance and independence, added 2026-08-08.** The three headings below are
not three independent methods, and listing them side by side implied that they
were. The exact relationships:

- **Culverhouse is a Parry & Toth derivative, not a parallel method.**
  `github.com/joshculverhouse/chronicle-android-preprocessing` is an adaptation
  of the example implementation published with Parry & Toth (2025); its
  `run_preprocessing.R:457` stamps every output row
  `source_dataset = "ParryToth-adapted"`. The cleaner this section describes,
  `github.com/joshculverhouse/chronicle-preprocessed-cleaning`, is a downstream
  pass over that preprocessor's output. Both are read-only clones under
  `.refs/` (gitignored); the cleaner is also vendored in the research-pipeline
  monorepo. Constants below were re-verified against the R sources on
  2026-08-08 and all matched.
- **Culverhouse is a contributor to this repository**, credited in `README.md`
  for the Python plotting conversion, the app codebook, and testing. His code
  is therefore not an independent check on this engine. `docs/paper/thesis.md`
  records what that costs the paper's claims.
- Only **EYES** and this repository's own engine are independent of Parry &
  Toth.

One practical note for anyone implementing from the primer: Steps 6–7 read as an
episode rule with a single closer (the next foreground handover). The other two
closers — screen non-interactive, and the same package moving to the background
— come from Steps 3/8/9, which bracket episodes against the screen stream. Their
reference implementation applies all three. Take the whole procedure, not the
episode steps alone.

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
| **App triplets** | resume/pause/stop reconstruction, proximity-binding, T=∞ (closed only by real signals: stop, app-kill, reboot); every episode carries an inference tag (how its end was determined) | proximity is a **CLI argument**, not a constant; 2 s is our default |
| **FAU ("Final App Usage")** | App usage **split** against the block timeline and every fragment tagged `device_status` — NOT filtered to ACTIVE | block duration floor 5 s |

### EYES source facts the table above does not carry

Verified 2026-08-05 by reading the reference implementation at
`/Users/u/fleet/eyes-toolbox` (`eyeslib/usage/chronicle_app_log_parser4.py`, 641 lines;
`eyeslib/usage/merge_app_status.py`). Read the source, not this summary, before implementing.

- **Episodes are per-package and may overlap.** `ScreenTimeLogs` keys all three queues by package
  name (`queues_resume[app_name]` etc., :271-276). No event of package B ever touches package A's
  queue. The only cross-package closer is the `reboot_states` branch (:475-506), which closes
  everything at once. The comment at :356-368 documents interleaved multi-app sequences
  (`Paused(A1) → Resumed(A2) → Stopped(A1)`) as the expected normal case. **Overlap is by design,
  and it is the sharpest structural split from P&T forward-pairing.**
- **…except under damage, where EYES *becomes* forward-pairing.** In `ActivityBlock.duration()`
  (:151-180), an episode whose `stop_event` is an anomaly (`MAR`/`NPI`/`NSI`/`AKD`/`SSD`) with no
  `time_stop` walks the **global** `next` list until it finds a block with a stop or a different
  package. If that block is a **different package, its `time_resume` becomes this episode's end**,
  tagged `MST` ("MissingStop"). Precedence: observed stop → same-package next stop (`NSI`) →
  foreign next resume (`MST`) → own `time_pause` → 0. **The two methods converge exactly where the
  log is incomplete** — worth stating in the paper.
- **`stop_states` is incomplete by the authors' own admission.** It is
  `['Activity Stopped', 'Unknown importance: 23']` and carries a live
  `# todo: we should also add 'screen non-interactive' here` (:31). Screen-Non-Interactive does not
  currently stop an episode.
- **`reboot_states` folds User Unlocked (28) and User Stopped (29) in with shutdown/startup**
  (:37-50). Keyguard Hidden and Screen Non-Interactive are commented out of that list.
  `device-state-machine.md` calls this folding a conflation; it is faithful to EYES.
- **`struct_logic` is a second duration semantics, not a debug flag** (:115-129, CLI `Y/N`). When
  false, duration is `time_pause − time_resume`, ignoring stop entirely.
- **FAU splits, it does not filter.** `merge_app_status.py` runs a two-pointer sweep (:45-84)
  cutting each episode at block boundaries and stamping each fragment's `device_status` with the
  overlapping `block_type`, or `ACTIVE` where no block overlaps. Durations are rewritten per
  fragment (:90-100) into `*_fau.csv`. Blocks shorter than the threshold (default **5 s**, :5, :27)
  are dropped from the timeline before the split.
- **Unstopped blocks are still exported.** `blocks2csv` (:545) dumps all three queues — resume,
  pause and stop — so never-stopped episodes reach the output with whatever `duration()` returns.

## Culverhouse chronicle-preprocessed-cleaning (downstream trim-and-log)

Never redefines episodes; bounds implausibility, transparently.

| Term | Definition | Default |
|---|---|---|
| **Block (collapse)** | Adjacent same-app rows with gap ≤ threshold merged ("multiple app instances reflect one usage") | 1 s |
| **bad_apps cap** | Per-package duration cap for launchers/system/clock/implausible apps — truncate + flag + log, never delete (legitimate BRIEF use is kept; the cap amputates the implausible idle tail) | 42 pkgs, 10 min |
| **long_3h / long_6h** | MUTUALLY EXCLUSIVE flags (a >6 h row is long_6h only, not both); >6 h → configurable action. Default action = `truncate_to_bad_app`: truncate to the 10-MIN bad-app cap (not to 6 h), applied to ALL row types (App Usage, Session, Glance) | truncate_to_bad_app (10 min), scope=all |
| **day_flags** | `partial_day` (first/last day; >12 h-gap boundary days — PARENT devices only), `DST_day`. Flag-and-retain, never drop | 12 h |
| **event_flags / truncated_secs** | Every mutation stamped in-row + logged to CSVs | — |

**Binding status: LANDED as the opt-in `interval_quality_policy` option**, canonical id
`culverhouse_trim_and_log` (default `none`). It is a **second, independent axis** from
`episode_reconstruction_strategy` precisely because of the line above the table:
Culverhouse never redefines episodes, so it is not selectable as a reconstruction rule.
The single dispatch point is `interval_quality_step` in
`rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs`, bound to the
`suppress_excluded_timing` query of the `interval_cleaning` group, and the program itself
is `culverhouse_trim_and_log` in `pipeline_v2.rs`. Mapping to the table above:

1. block collapse → same-app rows whose gap is at most 1 s merge, keeping the earlier
   start and the later stop. An overlap is a negative gap, so overlapping same-app rows
   merge too and their overlapping time is counted once. The gap is measured inside each
   app's own sequence, as the tool measures it (`clean_preprocessed.R:313-318` groups by
   participant, interaction type and package before taking the lag), so a brief excursion
   to a different app between two rows of the same app does not break the block;
2. bad_apps cap → the excluded-package set this pipeline already resolves. The default
   policy blanks those rows outright, which discards the brief legitimate use the cap
   exists to keep; under this policy they are capped at 10 min and credited instead;
3. long_3h / long_6h → mutually exclusive bands at 3 h and 6 h, with the 6 h band
   truncating to the same 10-minute cap and scoped to every row carrying an interval.
   Reporting a band and acting on it are separate comparisons, exactly as in the tool:
   a row is flagged once it *reaches* the band (`duration_secs >= long_6h_secs`,
   `clean_preprocessed.R:367`) and truncated only once it is *past* it
   (`duration_for_action_input > config$long_6h_secs`, :444), so a row sitting exactly
   on six hours is reported as long and kept whole.
   The cap and the bands are decided together in `culverhouse_bound_implausible_intervals`
   from one reading of the row's reconstructed length, so an excluded package that ran
   for four hours is both capped and flagged `long_3h`; evaluating them in sequence
   would let whichever ran first hide the other;
4. day_flags → each participant's first and last day, the days on either side of a gap
   that exceeds 12 h (`gap_hours > config$long_gap_hours`, :590 — a gap that merely
   reaches 12 h is not a boundary), and days carrying a UTC-offset change;
5. event_flags / truncated_secs → appended to the existing `any_app_usage_flags` column
   rather than to new columns, so a run with the policy off is schema-identical.

Three deliberate differences from the tool are recorded rather than absorbed. The bands and
the cap are fixed constants, not contract options, because a retunable band would make the
citation false. Culverhouse restricts the 12 h partial-day rule to PARENT devices, which
this contract cannot express because it carries no device-class column. And the collapse
does not merge the absorbed row's `source_data_rows` into the survivor: `source_data_rows`
is part of the row identity checkpoint, and everything downstream of `reconstruct_episodes`
— including the persisted reconstruction base, whose row dispositions are reuse /
replacement / drop — requires the annotation rows to remain an identity-preserving
subsequence of the reconstruction rows. A collapse is therefore a drop of the absorbed row
plus a temporal extension of the survivor, exactly like the pipeline's other row-removing
steps; the credited interval is unchanged either way, only the survivor's raw-row lineage
is narrower.

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
| `interval_cleaning` | Interval cleaning (blank & drop — the lossy half: filtered-timing blanking, selected-type removal, zero-duration drop; split 2026-07-15 from `interval_quality`). Hosts the `interval_quality_policy` seam | Culverhouse trim-and-log |
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

*Resolved 2026-08-05 against primary records; supersedes an earlier unverified note that
attributed this work to Valkenburg/Beyens (Amsterdam) under the title "Traces as Data". That
paper does not exist — searched by exact phrase, by author, and by institution, with both
Valkenburg's own publications page and the Project AWeSome publications page checked. Neither
lists it, nor any specification-curve or multiverse work by Valkenburg, Beyens, Siebers,
Verbeij, Pouwels, or van Driel. The likely source of the "Amsterdam" error is `specr`, a
specification-curve R package authored at VU Amsterdam. Full record:
`docs/paper/literature-dossier.md` §1.1.*

- **Winklbauer, A., & Batinic, B. (2026)**, *From Logs to Metrics: The Impact of Researcher
  Degrees of Freedom on Smartphone Usage Metrics*, SSRN preprint, Johannes Kepler University
  **Linz**. doi:10.2139/ssrn.7008242. Multiverse of **16,128 specifications** over **10
  methodological dimensions**, applied to duration / frequency / fragmented use / sticky use on
  Android event logs. Absolute estimates vary up to ~3×; **session threshold alone explains
  51–78% of the variance** in absolute values; participant rankings stay stable (mean Spearman
  r = .87–.93); the dimension driving absolute values differs from the one driving rank
  stability (window length). Figures verified from the Crossref-deposited abstract.
- **Klingelhoefer, J., Gilbert, A., Adrian, C., & Meier, A. (2026)**, *Possible futures all at
  once: time frame and time lag in short-term longitudinal media effects research on
  well-being*, **Journal of Communication** 76(1):78–91. doi:10.1093/joc/jqaf037. Multiverse
  over temporal operationalization (time frame / time lag) on ESM + smartphone log data. FAU
  Erlangen-Nürnberg / Mainz.
- Amsterdam supplied the **metrics**, not the multiverse: **Siebers, T., Beyens, I., &
  Valkenburg, P. M.** (2023/2024), *The effects of fragmented and sticky smartphone use on
  distraction and task delay*, Mobile Media & Communication **12(1):45–70**.
  doi:10.1177/20501579231193941.
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
