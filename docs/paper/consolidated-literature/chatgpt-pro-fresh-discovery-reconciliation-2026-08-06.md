# Fresh mobile-event discovery: independent reconciliation

**Run marker:** `[codex-pro-run:f093cc3b-123a-43b4-ba30-476adc363f8e]`  
**Search cutoff:** 2026-08-06  
**Scope:** direct or near-direct mobile screen, app, unlock, notification, UI-feature, session, and data-processing work. Generic web/clickstream, network traffic, and generic passive-sensing analogies remain excluded.

## Outcome

The Pro run screened 84 candidates and returned 32 as apparently new relative to the supplied six-slice packet. Independent title/identifier checks and primary-source spot checks support **31 additions to the direct corpus**: 28 peer-reviewed papers and three explicitly labelled iOS forensic/technical artifacts. One item, NAPsack/LongNAP, is preserved below as an adjacent screenome/action-annotation comparator but is not counted as a direct mobile-OS reconstruction record.

This reconciliation leaves the downloaded Pro artifact content unchanged (the CSV copies use repository-standard LF line endings). Corrections and final corpus decisions live here and in the A/B/D/F ledgers.

## Final disposition

| Disposition | Count | Records |
|---|---:|---|
| Accepted, peer-reviewed direct mobile work | 28 | A01–A23, B04–B05, D01–D02, F01 from the raw Pro report |
| Accepted, labelled iOS technical/forensic artifacts | 3 | B01–B03 |
| Adjacent only; excluded from direct-core counts | 1 | A24, NAPsack/LongNAP |
| **Total independently reconciled** | **32** | — |

The raw search audit remains: 84 screened, 32 provisionally retained, 39 rejected, and 13 unresolved. The independent decision changes the direct retained count from 32 to 31, not the search-screening totals.

## Strongest new methods papers

| Work | Exact method contribution | Residual limitation |
|---|---|---|
| PULSE (2025), `10.1145/3714394.3754395` | Session closure after screen-off >30 s, inactivity 30 s, or entry into the labeling interface; explicit duration bins and ESM sampling limits | No general orphan/overlap/reboot/clock/query-tail policy; reported session-flow counts need reconciliation |
| Are You Killing Time? (2023), `10.1145/3544548.3580689` | Merges screen-off intervals ≤45 s; screenshots/sensors every 5 s; 30-s feature window; first hour/day excluded | Lifecycle collision, missing-close, reboot, and clock handling remain unstated |
| Characterization and Prediction of Mobile Tasks (2022/2023), `10.1145/3522711` | Uses a >45-s standby/inactivity boundary while distinguishing sessions from multi-session and interleaved tasks | Inherits UbiqLog’s upstream interval construction |
| Finesse / Reflect, Not Regret (2021), `10.1145/3479600` | Open Accessibility-event and UI-tree feature detectors with executable app-specific state transitions and session-end handling | App/version/language-specific; no general OS-event repair policy |
| ODIM (2025), `10.1145/3743726` | Open package-transition trace segmentation plus inspectable split/delete/repair actions over screenshots, view hierarchies, and gestures | Interaction traces, not complete screen/unlock/app-use reconstruction |
| Notification Log (2018), `10.1145/3267305.3274118` | Open callback-level posted/removed notification schema and collector | Callback records do not automatically equal human-visible notification episodes |
| Call to Action (2024), `10.3390/s24082612` | Declares deduplication, nonpositive/>1-day delay removal, ±10-min battery join, OS-update and incomplete-row exclusions | Notification removal conflates click/consumption and dismissal |
| Anatomy of Smartphone Unlocking (2016), `10.1145/2858036.2858267` | Typed unlock finite-state process; quantifies and excludes out-of-order short sequences | Exclusion rather than repair; no competing policies |
| Crepe (2026), `10.1145/3772318.3791137` | Open Graph Query collection rules, 4-s Accessibility throttling, 10-s cache reset, hourly sync, queued retries, and participant deletion/opt-out controls | Acquisition rules, not a full episode builder |
| Why Did You Stop? (2021), `10.1145/3473856.3473881` | Learning session ends on background, screen-off, or 10-min inactivity; return ≤10 min is a suspending interruption; ESM expires after 3 h | Android collision and missing-event repair are not generalized |
| iOS Unified Logs parser/SQL (2025), DOI-free artifact | Open extraction/QC plus event-label queries for app, lock, notification, gesture, time, timezone, boot, and shutdown evidence | Practitioner artifact; behavioral episode meaning remains version-dependent |
| PowerLogs timing analysis (2022), DOI-free artifact | Distinguishes sleep-pausing `mach_absolute_time` from continuous monotonic time, offset histories, and delayed/batched writes | Timing semantics only; no complete app-session builder |
| one sec longitudinal design-friction study (2024), `10.1145/3613904.3642370` | Configurable 3–60-s delay, explicit continue/dismiss states, 309-day history cutoff, and a >48.2-h break rule | Target-app intervention records, not total phone-use episodes |
| Winbush et al. (2025), `10.1073/pnas.2427311122` | Shows that a quantity named “average session length” can be category minutes divided by unlock count rather than reconstructed sessions | Aggregate formula; event construction delegated |

## Method-disclosure tiers for all accepted records

### Tier 1 — executable or unusually exact construction/cleaning

Finesse, ODIM, Notification Log, Crepe, the iOS Unified Logs parser/SQL library, PULSE, Are You Killing Time?, Characterization and Prediction of Mobile Tasks, Call to Action, Hard Lock Life, Dismissed!, My Phone and Me, Anatomy of Smartphone Unlocking, Why Did You Stop?, the one sec longitudinal study, Winbush et al., and NotiManager’s pin/sort/categorize study.

### Tier 2 — direct collection with partial construction semantics

ScreenTK, habitual smartphone-use intervention work, Annotif, Real-World Winds, What Makes Smartphone Use Meaningful or Meaningless?, the continuous screen-text tool, S-ADL, ScreenLife Capture, the introductory iOS Unified Logs article, the original one sec study, and MindPhone. These papers disclose an acquisition path, trigger, selection rule, or some boundaries, but delegate or omit the complete event-repair state machine.

### Tier 3 — direct source-semantics or observability evidence

Beyond the Feature Level uses an instrumented Instagram-like interface rather than opaque native-app lifecycle events. Walls Have Ears audits what Android notification listeners can observe and transform but does not construct behavioral episodes. These remain directly relevant to feature/notification observability, with their narrower role stated explicitly.

## Corrections to the raw Pro return

1. **NAPsack/LongNAP is not a direct mobile-OS event-reconstruction paper.** Its open preprocessing groups computer I/O bursts and annotates screenshot sequences. The evaluation uses personal-computer mouse/keyboard traces; application to Screenomics uses mobile screenshots without mobile I/O. It is useful adjacent evidence for image deduplication, temporal chunking, and action annotation, but not evidence about Android/iOS screen, lock, foreground-app, notification, reboot, or query-boundary semantics.
2. **`10.5555/3235838.3235857` is not a resolvable DOI for Hard Lock Life.** DOI and Crossref resolution return 404. The canonical source is the USENIX SOUPS 2014 record; the ledger uses `usenix-soups2014-harbach` as its stable key and records the `10.5555/...` string only as a non-resolving bibliographic alias from the Pro return.
3. **The three iOS additions are grey technical evidence, not peer-reviewed papers.** They are retained because they expose predicates, parser rules, timing/offset behavior, and batching facts unavailable in much of the academic Screen Time literature.
4. **“Net-new” means absent from the supplied packet by normalized DOI/stable key and title.** It does not imply that every accepted item has equal methodological depth or equal novelty pressure.

## Novelty effect

The additions retire any broad statement that direct mobile studies rarely expose feature/session/notification processing. Several do, sometimes in executable source. The defensible gap is narrower:

> The located literature supplies mobile-specific collectors, individual session heuristics, notification/unlock state proxies, feature-level detectors, intervention triggers, forensic event predicates, and adjacent transformation languages. It still does not supply one reusable system that crosses competing typed mobile event-to-episode policies—including malformed, missing, duplicate, overlapping, out-of-order, reboot, clock/timezone, and query-tail branches—over the same open raw logs while emitting per-episode lineage, quality flags, and validation fixtures.

## Artifact trail

- [`fresh_mobile_event_literature_run_f093cc3b.md`](./fresh_mobile_event_literature_run_f093cc3b.md) — raw narrative return.
- [`fresh_mobile_event_import_table_f093cc3b.csv`](./fresh_mobile_event_import_table_f093cc3b.csv) — raw 32-row provisional import table.
- [`fresh_mobile_event_audit_f093cc3b.csv`](./fresh_mobile_event_audit_f093cc3b.csv) — all 84 screened candidates and dispositions.
- [`fresh_mobile_event_run_summary_f093cc3b.txt`](./fresh_mobile_event_run_summary_f093cc3b.txt) — compact run totals.
