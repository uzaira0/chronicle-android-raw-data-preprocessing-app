# `delivery:B03`–`delivery:B05` foundational-semantics research and decision record

**Status:** frozen implementation decision; research-before-building and scientific-backend
independent review passed

**Prepared:** 2026-08-11

**Private baseline:** `origin/main` at
`312ef636e3bd03d63bc5d8b2fd84b86fa5251cbc`

**Feature-branch implementation baseline:**
`080801a0232a6a2c97daba0c986094f6cf48fe08`

**Delivery authority:** [`delivery:B03`–`delivery:B05`](delivery-axis-ledger.yaml)

**Preflight:**
[`b03-b05-foundational-semantics-grep-weights.md`](b03-b05-foundational-semantics-grep-weights.md)

**Proof obligations:**
[`b03-b05-foundational-semantics-proof-matrix.md`](b03-b05-foundational-semantics-proof-matrix.md)

**Independent review:** GO on decision SHA-256
`bd182788f378509e128632e3095b281e08f98b1e29357a71f0848efcafc9276d` and proof-matrix SHA-256
`1a316e8b6264e8d6e06587a9629e9ce5ded096edd9eae80e225d84e5b2e2020a`; the status-only freeze in
this paragraph follows that review

This record is the research-before-building gate for explicit micro-use classification,
minimum-duration inclusion/exclusion, screen-session construction, the requested Schoedel 2026
app-reconstruction arm, and the bounded EYES conformance repair that travels with this milestone.
It does not certify any complete published-method binding and is not the current implementation or
deployment authority.

## 1. Scope and local baseline

The frozen requirements are:

1. `delivery:B03`: classify an already reconstructed app episode as micro-use or not micro-use,
   without silently changing whether or how much it contributes.
2. `delivery:B04`: make the minimum-duration comparator, threshold, and disposition explicit,
   auditable, and recoverable from output lineage.
3. `delivery:B05`: make device-level screen-session construction a selectable, versioned method
   with explicit orphan, duplicate, reboot, and query-edge behavior.
4. Add a Schoedel 2026 app-reconstruction arm only at the fidelity the public prose and inputs can
   actually support.
5. Repair EYES trailing-fragment close provenance and disclose its current partial-replay status;
   do not widen this milestone into an uncertified full EYES port.

The current Rust baseline has no B03 enum or row classification. Its
`classify_episode_durations` step compares reconstructed duration with the configured
`minimum_usage_duration` (default 60 seconds). A strict-below-threshold episode retains its start,
stop, row, and lineage but has `duration_seconds` and `duration_minutes` set to null. This is a B04
disposition hidden behind a scalar threshold, not a micro-use label. Exact zero/negative deletion
is a separate `filter_zero_duration_sessions` operation.

The current screen branch opens on Chronicle's Screen Interactive variants, coalesces duplicate
starts, ignores orphan stops, closes on Screen Non-Interactive variants, and materializes an
unmatched final start as a right-edge row with `missing_stop`. It also derives end-reason,
confidence, stop-event type, last meaningful activity, tail gap, app-kept-awake evidence, and
source-row lineage. No `ScreenSessionConstructionStrategyId` or construction receipt exists.

One current implementation defect is explicitly retired rather than canonized: the screen-state
scan can hold one state across interleaved participants. That is cross-participant contamination,
not a scientific method. `chronicle_screen_interactive_v1` preserves detached bytes for every
single-participant stream, while the new participant-partition fixture intentionally changes the
old contaminated multi-participant result and records repair ID `participant_state_isolation`.

The existing EYES core already computes a complete tagged Final App Usage (FAU) table and all-type
pickup export, but the production reconstruction path emits only ACTIVE FAU fragments, discards
the pickup export, and currently assigns every emitted fragment a device-state close reason.

The implementation decision therefore factors the milestone as:

```text
retained event rows
  -> app reconstruction
  -> B03 descriptive micro-use classification
  -> B04 minimum-duration comparator and disposition
  -> optional concurrency splitting and later cleaning

full device event rows
  -> B05 screen-session construction
  -> screen rows and lineage
```

B03 must never delete or blank duration. B04 must never redefine episode boundaries. B05 must not
silently alter an app-reconstruction strategy, although a complete binding may explicitly make an
app strategy depend on a named B05 output.

## 2. Recalled possibilities and grep-weights

The pre-search hypothesis inventory, disambiguation, traps, proper-noun exclusions, generic query
set, category coverage, falsifiers, and change-of-mind rules are frozen in the linked
[grep-weights preflight](b03-b05-foundational-semantics-grep-weights.md). Generic discovery was
performed before named-source verification. Local consolidated literature was used only for
deduplication and source routing, never as the final authority for a method rule.

Research changed three initial assumptions:

- there is no defensible universal fixed micro-use boundary;
- the published Schoedel prose and deposited Schoedel pipeline are materially different methods;
- B05 has at least three behaviorally distinct executable constructions, but Okoshi's simple
  interactive pairing adds no separately specified malformed-stream semantics.

## 3. Discovery scope and exclusions

The exact generic discovery queries were:

1. `raw mobile lifecycle events short foreground interval classification reproducible method`
2. `passive smartphone sensing define micro usage duration operator threshold source code`
3. `mobile application episode minimum duration retain exclude drop provenance`
4. `android event log screen session start stop lock unlock algorithm`
5. `smartphone screen on off interval reconstruction unmatched event failure policy`
6. `mobile sensing device session glance pickup formal definition implementation`
7. `event stream interval classification fitted breakpoint deterministic replay`
8. `usage episode duration threshold sensitivity analysis participant outcomes`
9. `screen interaction session reconstruction open dataset reference implementation`
10. `event sourced interval materialization censoring orphan duplicate collision semantics`
11. `behavioral bout ontology minimum duration qualifying evidence gap provenance`
12. `mobile operating system lifecycle event pairing conformance test corpus`
13. `passive sensing preprocessing screen session package app episode open source`
14. `short digital interaction taxonomy classification reliability validation`
15. `device state complement segmentation active idle gap glance reference implementation`
16. `screen off next foreground event application usage reconstruction method`
17. `deterministic mixture breakpoint short duration mobile interaction`
18. `minimum duration exclusion denominator bias passive sensing study`

The ten discovery categories were handled as follows:

1. **Standards/specifications:** Android event identities and API availability were checked;
   Android supplies a vocabulary, not a scientific session algorithm.
2. **Papers/reference algorithms:** direct B03, B04, B05, Schoedel, and EYES sources were checked.
3. **Maintained open source:** Android collectors and direct method artifacts were checked; no
   maintained generic B05 library survived review.
4. **Datasets/fixtures/registries:** Parry–Toth sample input/output and public project metadata
   were checked; no public Schoedel raw data or EYES conformance corpus exists.
5. **Platforms/APIs/deployment:** API-level signal availability and source-order preservation were
   evaluated; no new deployment platform is selected here.
6. **Adjacent fields:** bout ontologies, process logs, and event sourcing informed provenance only;
   they supplied no domain-valid arm and are `N/A` for adoption.
7. **Registries/security:** DOI, OSF, repository, version, and license metadata were checked;
   package/CVE selection is `N/A` because no dependency is being adopted.
8. **Maintainer/community:** repository history and artifact modification state were inspected;
   no issue or release changed the decisions.
9. **Hardware/runtime:** no special hardware is required; OEM event variation and browser/WASM
   determinism are proof concerns rather than method-selection criteria.
10. **Historical/deprecated:** old Android aliases and superseded screen builders were recorded but
    not promoted.

Excluded from candidate status:

- a threshold used only as a prompt stratum, reporting bin, or descriptive quantile;
- a sample-fitted breakpoint recast as a universal physiological boundary;
- a method whose equality operator, fitting inputs, or stage is silently invented;
- an Android screen event treated as a user-present or unlocked event without source support;
- a source-code license inferred from an article license;
- a method requiring unavailable PhoneStudy, call, category, or surrounding-query inputs that
  silently returns an empty success;
- a generic custom event list or arbitrary Boolean-per-event configuration;
- any implementation copied from an unlicensed reference repository.

Discovery stopped when the primary sources below explained every non-duplicate candidate, the
generic pass produced no new executable method beyond the deduplicated corpus, and the remaining
uncertainties were fidelity/refusal questions rather than missing search categories.

## 4. New discoveries

### B03 has source-specific, non-universal classifiers

Okoshi et al.'s Cyberoception paper defines one app session from Activity Resumed to Activity
Paused and counts a session with duration strictly below five seconds as micro-use. This is a
classification/count, not an exclusion. It is the strongest portable B03 arm because the operator,
threshold, unit, input pair, and effect are all stated directly.

Ferreira et al. derive an approximately fifteen-second boundary with Jenks optimization on their
study sample. The paper alternates between `up to 15 seconds` and a runtime trigger below fifteen
seconds and explicitly warns that fifteen seconds is not a rigid universal boundary. Without raw
data or executable fitting code, a fixed arm would need an invented equality rule. It remains an
investigation/robustness comparator, not a source-equivalent selectable arm.

Morrison et al. fit `k=2` k-means to jailbroken-iPhone durations and report a 21.4-second break.
The source does not provide the raw fitting data, initialization, transform, seed, or equality
operator. The fixed value is a reported sample result, not a portable classifier. Its later role
belongs under adaptive/fitted-threshold work (`delivery:B12`), not the B03 source-native arm.

PULSE's 0–5, 5–30, and longer bins are sampling strata rather than a micro-use definition. The
generic discovery pass surfaced it but deduplication found it already in the consolidated corpus.

### B04 needs three fields, not another unexplained scalar

A complete minimum-duration choice consists of:

```text
comparison checkpoint + comparator + threshold + disposition
```

The existing Chronicle behavior is strict `< configured threshold`, evaluated on reconstructed
episode duration, with the row and boundaries retained but output duration blanked. It must remain
the compatibility default, named explicitly rather than represented as an undocumented number.

Direct sources show that other dispositions are real. Yamanaka removes vendor-built app-use logs
strictly below two seconds. Schoedel's deposited summary code retains only durations strictly above
one second, so it drops durations at or below one second, then separately nulls durations above six
hours and merges same-app rows within three seconds. ActivityWatch also demonstrates a minimum in
reconstruction, but its stage differs from B04's post-reconstruction contract. These sources
support explicit comparator/disposition vocabulary; they do not justify making any one number the
default truth.

The project-owned B04 contract will therefore keep the existing numeric threshold and add an
explicit comparator plus disposition. Named scientific presets may set the exact source vector,
but individual controls remain visibly factorable.

### B05 methods differ on user presence, glances, reboot, and failure

The current Chronicle builder is a legitimate versioned native method. Its behavior is richer than
simple screen-on/off pairing and must be frozen as `chronicle_screen_interactive_v1`.

Parry–Toth's pinned R code uses Android types 15–18 and 26–27. Adjacency to keyguard-hidden/shown
distinguishes a session from a locked glance; shutdown/startup are session endpoints. After
classification it removes keyguard rows, keeps only adjacent valid start/stop pairs, and drops
orphans. This differs from Chronicle on glances, reboot, duplicate starts, and unmatched tails.
The article is CC BY 4.0, but the OSF code has no declared license; Chronicle may independently
implement the documented rule but must not copy the code or claim its license.

Zhu et al. require a screen-on row immediately followed in full source order by keyguard removal;
the session starts at unlock and stops on screen-off or shutdown. A locked glance therefore yields
no session. This differs from both Chronicle and Parry–Toth and is executable only when the required
events and their source order are available.

Okoshi states that Screen Interactive and Screen Non-Interactive are paired, but does not specify
orphans, duplicates, ties, reboot, or query edges. On a valid alternating stream it is identical to
the strict core of Chronicle. Adding it as a separate arm would manufacture the very decisions the
paper omits, so it remains a citation alias rather than a selectable B05 strategy.

### Schoedel prose and Schoedel code cannot share one fidelity label

The final Psychometrika article gives a simplified rule: within a screen-defined smartphone
session, a type-1 event begins app A; the episode ends at A's last logged event before a different
app's type-1 event or the end of the screen session. The article explicitly directs readers to its
supplement for anomaly handling.

The deposited revision-1 scripts are materially broader. They use PhoneStudy-specific
`ON_UNLOCKED`, `OFF_LOCKED`, and `OFF_UNLOCKED` states, call spans, category tables, corrected
timestamps, client IDs, names, and surrounding rows. They remove multiple OEM/call anomalies,
merge device blocks at a strict five-second gap, group apps by package and device-usage ID, apply a
strict fifteen-second same-package background anomaly split, repair singletons within ten rows,
drop remaining singletons, drop app durations at or below one second, null durations over six
hours, and merge same-app summaries within three seconds.

The OSF project is not a frozen registration, has no project/code license, and withholds raw SQL
data under GDPR. A full source-native binding is therefore structurally unavailable on ordinary
Chronicle input and must return a typed prerequisite refusal. An executable
`schoedel_2026_app_within_screen_prose_v1` arm may implement only the published prose core and must
identify itself as a controlled derivative, carry the chosen B05 method, and state its singleton
and screen-edge completion rules.

### EYES is a partial adapted replay at the product surface

The pinned EYES oracle is `eyes-toolbox` version 0.1.0 at commit
`89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108`; relevant algorithms are unchanged since `2cea85b`.
The repository has no LICENSE/COPYING or package-license metadata. It is an inspection oracle, not
vendored code.

The Rust core correctly computes every tagged FAU fragment, but the production arm emits only the
ACTIVE credited subset. That can be a valid headline view only if full tagged FAU is separately
available and the arm is labeled partial/adapted. For historical product compatibility, every
credited ACTIVE fragment—including a fragment ending at the app chunk's natural endpoint—carries
`EyesDeviceStateBoundary` and CSV `device_powered_off_or_idle`. The selected contributing endpoint
episode and its observed or repaired `end_inference` remain exclusively in
`EyesTaggedFauEvidence.chunk_endpoints`; they do not alter the headline close reason.

The safe milestone scope is to separate trailing endpoint provenance into tagged evidence while
preserving the historical headline reason, add a conformance receipt, and expose full tagged FAU as
a dedicated evidence surface that does not feed ordinary aggregates. EYES primary/secondary
layering, pickup products, every configurable option, and licensing resolution remain outside this
bounded patch; complete-EYES certification stays withheld.

## 5. Verified candidate matrix

`N/A` means an attribute is genuinely inapplicable, never that a source was unread.

| Candidate | Origin/version | License status | Maintenance | Exact role | Decision | Confidence | Open question |
|---|---|---|---|---|---|---|---|
| `none` (B03) | Chronicle `080801a` | GPL-3.0 | Active private campaign | No micro-use classification; compatibility default | Adopt | High | None after byte oracle |
| `okoshi_lt_5s` (B03) | Cyberoception, arXiv v1 / CHI 2025 | Article distribution/copyright; no code artifact | Fixed publication | Resumed→Paused duration `<5 s` is counted/interpreted as micro-use | Adapt as source-named non-destructive classifier | High | Independent output replay unavailable |
| Ferreira approximately 15 s | MobileHCI 2014, DOI 10.1145/2628363.2628367 | ACM article; no reusable code/data | Historical fixed study | Jenks sample boundary; prose equality conflict | Investigate; do not ship source-equivalent arm | High on conflict | Could archived code resolve the runtime/prose equality mismatch? |
| Morrison 21.4 s | CHI 2018, DOI 10.1145/3173574.3173918 | Article; no data/code | Historical fixed study | Sample-fitted `k=2` break | Reject as fixed universal/source-conformance arm; retain for B12 | High | Can a future data archive reproduce the fit? |
| Andrews device-check `<15 s` | PLOS ONE 2015, DOI 10.1371/journal.pone.0139004 | CC BY 4.0; MATLAB/sample artifact available | Historical fixed artifact | Device-active checks; prose `≤15`, implementation/analysis `<15` | Reject for app B03; retain as operator-drift evidence | High | N/A for app episodes |
| PULSE duration bins | UbiComp Companion 2025, DOI 10.1145/3714394.3754395 | Article; no reusable code/data located | Fixed publication | Sampling strata, not classification or exclusion | Reject | High | N/A |
| `chronicle_blank_keep_row` (B04) | Chronicle `080801a` | GPL-3.0 | Active | Strict `< configured`; null duration; keep row/bounds | Adopt as compatibility default | High | None after detached byte oracle |
| `retain_and_credit` (B04) | Project-owned auditable control | GPL-3.0 | Project-owned | Preserve duration and credit; expose below-threshold status | Build | High | None; not a published preset |
| `retain_but_exclude` (B04) | Project-owned auditable control | GPL-3.0 | Project-owned | Preserve raw duration/row but exclude from headline aggregates | Build | High | Downstream eligibility contract must be explicit |
| `drop_row` (B04) | Yamanaka `<2 s`; Schoedel `<=1 s` demonstrate source use | Source articles; Schoedel OSF code unlicensed | Fixed sources | Remove qualifying final app row; retain exclusion lineage artifact | Build generic disposition; presets supply source vectors | High | Yamanaka lower-level vendor interval remains delegated |
| ActivityWatch `≤1 s` | `aw-android` prerelease v0.14.0b1, `a21b48c` | MPL-2.0 | Active prerelease; stable release lacks parser | Drops during reconstruction/materialization, not post-reconstruction B04 | Compose as comparator/stage evidence; no dependency | High | Parser has no located unit fixture |
| Niemeijer screen `<12 s` | JMIR 2022, DOI 10.2196/25643 | CC BY 4.0; no code/raw data | Fixed publication | Screen-interval exclusion for notification lighting | Reject as app B04 arm; retain as attrition precedent | High | N/A for app episodes |
| Chen screen `<10 s` | Scientific Reports 2026, DOI 10.1038/s41598-026-52696-0 | CC BY-NC-ND 4.0; data on request, no code | Current fixed publication | Selected after 5/10/15/20-s sensitivity; screen-level | Compose as sensitivity precedent; reject as app B04 arm | High | Underlying interval builder remains delegated |
| GESIS prose five-second floor | Methods Hub v1 / tutorial `0561e0c` | Repository MIT versus `CITATION.cff` CC0 metadata conflict | Pinned active tutorial | Says a researcher may choose five seconds but executes no floor | Compose transparency guidance; reject source preset | High | License metadata conflict is immaterial without code adoption |
| Set duration to zero | Project invention | N/A | N/A | Conflates exclusion with observed zero | Reject | High | N/A |
| `chronicle_screen_interactive_v1` | Chronicle `080801a` | GPL-3.0 | Active | Current enriched interactive/noninteractive state machine | Adopt/freeze default | High | Reboot-spanning legacy behavior must be pinned |
| `parry_toth_2025_session_glance_v1` | Paper DOI 10.5117/CCR2025.1.8.PARR; OSF R rev. 2, SHA-256 `99787f1c01499dfe335283eff4bc067a4da0246475cc3238ffe80fc5cfff792f` | Article CC BY 4.0; code license unset | Fixed artifact | Adjacency-classified sessions/glances; reboot endpoints; orphan drop | Adapt independently | High | Combined Chronicle labels require refusal or named expansion |
| `zhu_2018_unlock_lock_v1` | arXiv 1711.09408 v1; DOI 10.1177/2050157917748351 | Article/preprint; no code artifact verified | Historical fixed source | Immediate screen-on→unlock; start at unlock; stop on off/shutdown | Adapt | High | Exact source-order availability must be preflighted |
| Okoshi screen pair | Cyberoception 2025 | Article; no code/data | Fixed publication | Interactive→noninteractive only | Reject as duplicate/underspecified B05 arm | High | N/A |
| `schoedel_2026_app_within_screen_prose_v1` | Psychometrika 91(3), DOI 10.1017/psy.2026.10083 | CC BY-NC 4.0 | Current final article | Type-1 start; last A event before other-app start/screen end | Adapt as explicit derivative app strategy | High on prose; explicit project completions are not attributed to source | None after frozen completion/edge proofs |
| Schoedel full OSF binding | OSF `tmuhe`, scripts revision 1 | No project/code license; raw data withheld | Modified 2025-11-27; not registered | PhoneStudy-specific full device/app/summary pipeline | Refuse on ordinary Chronicle input | High | Reconsider only with licensed code and typed source inputs |
| Current EYES product arm | EYES 0.1.0 `89549a2`; Chronicle `080801a` | EYES license unresolved; Chronicle GPL-3.0 | Fixed oracle/project port | ACTIVE-only credited projection with unported surfaces | Adapted partial replay; repair provenance now | High | Complete status waits on concurrency/pickup/options/license evidence |

All source identities in the next table were accessed on **2026-08-11**. “Not net-new” means the
candidate was already represented in the frozen consolidated/discovery corpus or the local
preflight before the generic pass; it does not mean the primary source was skipped.

| Candidate | Discovery origin / retained novelty | Supported signal, target, portability | Integration boundary | Benchmark relevance | Exact source identity / access record |
|---|---|---|---|---|---|
| B03 `none` | Local baseline inventory; recalled; not net-new | Any completed app episode; no classification; native Rust/WASM | Post-materialization classifier bypass | Detached-byte and cache oracle only | Chronicle `080801a0232a6a2c97daba0c986094f6cf48fe08` |
| Okoshi `<5 s` | Grep-weight recall then primary verification; not net-new | Android Resumed→Paused app episode; fixed integer comparator is portable | B03 classifier after selected reconstruction | `T−1ns/T/T+1ns` and cross-reconstruction separation | Okoshi et al., arXiv `2504.16378v1`, DOI `10.1145/3706598.3713638` |
| Ferreira ~15 s | Grep-weight recall then primary verification; not net-new | Sample-derived app micro-use class; fixed report portable, derivation not replayable | Investigation register/B12, not runtime enum | N/A until code/data resolve equality and fit | Ferreira et al., DOI `10.1145/2628363.2628367`, author-hosted MobileHCI 2014 PDF |
| Morrison 21.4 s | Grep-weight recall then primary verification; not net-new | Jailbroken-iPhone app-launch durations; not portable as fitted truth | B12 investigation, not B03 runtime | N/A without fit data/seed/transform | Morrison et al., DOI `10.1145/3173574.3173918`, Glasgow accepted manuscript/record |
| Andrews device checks | Generic/adjacent verification against known lineage; not net-new | Device-active checks, not app episodes; MATLAB artifact portable only for its unit | Literature operator-drift evidence | N/A for app B03; artifact replay may audit original check unit | Andrews et al., DOI `10.1371/journal.pone.0139004` and supplement `.s001` |
| PULSE bins | Generic discovery hit, deduplicated to consolidated A01; zero retained novelty | Prompt-sampling strata; no executable classifier target | Rejected candidate register only | N/A | PULSE, DOI `10.1145/3714394.3754395` |
| B04 `chronicle_blank_keep_row` | Local baseline inventory; recalled; not net-new | Any bounded app episode; portable project behavior | Post-materialization qualification/output projection | Detached `59.999/60/60.001 s` oracle | Chronicle `080801a0232a6a2c97daba0c986094f6cf48fe08` |
| B04 `retain_and_credit` | Project-owned alternative from preflight; new contract, not external discovery | Bounded app episode; portable pure Rust/WASM | B04 disposition before aggregation | Disposition fan-out, denominator conservation | Project-owned decision record, this revision |
| B04 `retain_but_exclude` | Project-owned alternative from preflight; new contract | Bounded app episode; portable if eligibility is carried | B04 disposition plus aggregate eligibility | Raw-versus-credited totals/common-support benchmark | Project-owned decision record, this revision |
| B04 `drop_row` | Recalled disposition, source-verified in Yamanaka/Schoedel; no new external method | App interval; portable generic disposition, source vector remains method-specific | B04 destructive output plus excluded-lineage artifact | Attrition/count/duration conservation | Yamanaka DOI `10.14836/ssi.13.3_1`; Schoedel DOI `10.1017/psy.2026.10083` and OSF `tmuhe` rev. 1 |
| ActivityWatch `<=1 s` | Maintained-OSS generic pass; rejected/no retained runtime arm | Android reconstructed session; portable Kotlin rule but wrong checkpoint | Evidence for stage/operator register, no dependency | N/A beyond source regression observation | `aw-android` v0.14.0b1 commit `a21b48cedc40c091c82a48e1396cdd1d9ad8363f` |
| Niemeijer `<12 s` | Adjacent screen-method pass; not net-new | Screen activation interval, not app episode; fixed filter portable only after delegated builder | Literature sensitivity/attrition rationale | N/A for app B04 | Niemeijer et al., DOI `10.2196/25643`, PMC full text |
| Chen `<10 s` | Adjacent screen-method pass; current primary verification; not retained as arm | Screen activation interval; source sensitivity result, builder delegated | Literature sensitivity rationale | N/A for app B04; cited 5/10/15/20 sensitivity only | Chen et al., DOI `10.1038/s41598-026-52696-0` |
| GESIS prose floor | Recalled from existing prior-art corpus, then pinned primary verification; not net-new | Optional Android visit floor in prose; no executed rule | Transparency guidance only | N/A because tutorial deliberately runs no floor | GESIS Methods Hub v1 DOI `10.71627/How-to-work-with-Android-App-Logging-Data.1`, commit `0561e0c4f0e0fbd094d5ec6ef005819affbbe762` |
| Set duration to zero | Pre-search trap inventory; project invention | No valid source signal/target; portable but scientifically invalid | Rejected disposition | Negative regression: no arm may fabricate zero | This decision record; no external source applicable |
| B05 Chronicle v1 | Local baseline inventory; recalled; not net-new | Chronicle screen/lock/power rows; native Rust/WASM | Device-session state machine on full event stream | Detached screen-output oracle | Chronicle `080801a0232a6a2c97daba0c986094f6cf48fe08` |
| B05 Parry–Toth | Recalled, corpus-deduplicated, primary code/paper verified; not net-new | Distinct Android 15–18/26–27 + source order; portable via declared adapter | B05 source-aligned state machine gated by capability sidecar | Exact session/glance/reboot/orphan fixtures | Parry–Toth DOI `10.5117/CCR2025.1.8.PARR`; OSF R rev. 2 SHA-256 `99787f1c01499dfe335283eff4bc067a4da0246475cc3238ffe80fc5cfff792f` |
| B05 Zhu | Recalled, primary pseudocode verified; not net-new | Full-log screen-on→unlock adjacency and off/shutdown; portable only with preserved order | B05 source-aligned state machine gated by capability sidecar | Unlock/locked-glance/order fixtures | Zhu et al., arXiv `1711.09408v1`, DOI `10.1177/2050157917748351` |
| Okoshi screen pair | Recalled alias checked in primary source; rejected/no new arm | Valid alternating screen interactive/noninteractive rows only | Citation alias to baseline strict core | N/A; malformed cases are unspecified | Okoshi et al., arXiv `2504.16378v1`, DOI `10.1145/3706598.3713638` |
| Schoedel prose arm | User-requested/recalled, then final article verified; not net-new corpus method | App rows inside declared B05 interval; portable controlled derivative | App reconstruction dependent on immutable B05 IDs | A/A/B, singleton, edge/order, B05-crossing fixtures | Schoedel et al., DOI `10.1017/psy.2026.10083`, final Psychometrika article |
| Schoedel full OSF | Proper-name verification of user-requested method; structurally unavailable | PhoneStudy device/app/call/category/context inputs; not portable to ordinary Chronicle | Typed prerequisite refusal only | N/A until licensed typed inputs exist | OSF `tmuhe`: rev. 1 `Screen_preprocessing.R` `35a230df821729f8527fe9a694b228e7f3cfbf62637c105cdceec51900ce187d`; `App_preprocessing.R` `eaeffff8cc914f50aa7d1270cb6a2834fe2774787cc539d6757bbe07c27a4705`; `App_summary.R` `a097f62da37765e2b65668d2c4762c7cdce1a20f9955778ee7a9dace879a52c8` |
| Current EYES arm | Recalled local conformance debt, pinned oracle audit; not net-new | EYES device-state/app triplets; Rust/WASM partial surface portable | Existing EYES core, production adapter, dedicated evidence/receipt | Tagged-FAU/reason/tie/no-aggregate-drift fixtures | `eyes-toolbox` 0.1.0 commit `89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108`; license unresolved |

## 6. What to adopt

### B03 vocabulary

Adopt exactly two values for this milestone:

1. `none` — compatibility default; no row classification and no scientific CSV column.
2. `okoshi_lt_5s` — classify a completed, duration-bearing episode as `micro_use` iff its raw
   reconstructed duration is strictly less than five seconds; otherwise `not_micro_use`.

Rows without a bounded duration are `not_classifiable`, never non-micro-use. B03 does not alter
duration, inclusion, boundaries, grouping, or aggregates. The non-default app CSV exposes one
`micro_use_classification` column; a dedicated receipt records policy, comparator, threshold,
checkpoint, and counts. Ferreira and Morrison remain recorded alternatives, not selectable claims.

### B04 vocabulary

Keep `minimum_usage_duration` as the numeric threshold and add two closed fields:

```text
MinimumDurationComparatorId = strict_lt | inclusive_le
MinimumDurationDispositionId = chronicle_blank_keep_row
                             | retain_and_credit
                             | retain_but_exclude
                             | drop_row
```

Defaults are `strict_lt` and `chronicle_blank_keep_row`, reproducing the current behavior exactly
under the default cleaning policy and without concurrency modelling (the golden and detached-oracle
scope). A zero threshold disables qualification regardless of disposition. Evaluation occurs once on
the raw reconstructed episode before optional concurrency splitting and interval cleaning. The
existing explicit `apply_minimum_usage_duration_to_concurrent_subintervals` remains a second,
separately receipted operation on generated subintervals.

**Deliberate deviations from the pre-axis engine under two pre-existing opt-in options** (recorded
2026-08-17 after the independent full-diff review; both follow from "evaluate once"):

- `model_concurrent_usage=true`: the pre-axis `segment_concurrent_usage` repopulated every
  sub-interval's duration from its own span, so a below-floor episode's blank was silently undone
  by splitting. Now every sub-interval of a below-floor episode inherits the B04 blank; the
  post-split floor stays a separate option. The `apply_minimum_usage_duration_to_concurrent_subintervals`
  tooltip was corrected accordingly.
- `interval_quality_policy=culverhouse_trim_and_log`: the pre-axis Culverhouse collapse merged
  same-app rows regardless of floor state and re-applied `minimum_usage_duration` to the merged
  span (a hidden second evaluation, retired as
  `chronicle-review-annotation-checkpoint/v4`). Now rows are collapsed only within one B04/B03
  state and the survivor keeps its one pre-concurrency decision (a blanked survivor stays blank;
  an eligible one receives the merged duration).

Every run emits a B04 receipt with requested/effective comparator, threshold, disposition,
checkpoint, qualifying count, credited/excluded/dropped count, and a digest of source-row ranges.
`retain_but_exclude` preserves raw timing in the row but headline aggregates read an explicit
eligibility flag. `drop_row` must preserve the excluded episode in a dedicated lineage artifact.

### B05 vocabulary

Adopt exactly three executable strategies:

1. `chronicle_screen_interactive_v1` — compatibility default, freezing the current state machine.
2. `parry_toth_2025_session_glance_v1` — exact only when separate canonical 15–18/26–27 evidence
   and preserved source order exist; otherwise typed refusal.
3. `zhu_2018_unlock_lock_v1` — exact only when screen-on, keyguard-hidden, screen-off/shutdown, and
   full-stream adjacency/order are observable; otherwise typed refusal.

Each screen row exposes a stable screen interval ID, construction strategy, kind
(`session|glance` where applicable), start/end source ranges, close reason, censor status, and
strategy receipt. The default CSV remains byte-compatible by keeping new columns conditional or in
the dedicated receipt.

The Parry–Toth adapter preserves source row order and implements the pinned artifact's exact
sequence: classify with keyguard neighbors, assign start/stop, remove types 17/18, validate glance
adjacency, recompute neighbors, validate session adjacency, then emit each surviving start with the
immediately following stop timestamp. Its frozen edge cases are:

Its `lag`/`lead` neighborhood is the screen-only projection of types 15–18/26–27, with their
relative physical order preserved; unrelated app rows do not become neighbors. Zhu differs: its
screen-on→keyguard-hidden test is adjacency in the complete unfiltered participant log, so even an
otherwise irrelevant row between those events prevents the session from opening.

| Source rows in physical order | Exact output |
|---|---|
| `Hidden@0, Interactive@1, NonInteractive@9, Shown@10` | one `session [1,9]` |
| `NonInteractive@0, Interactive@1, Interactive@2, NonInteractive@3, Interactive@4` | one `glance [2,3]`; rows 0, 1, and 4 are dropped with exact unmatched reasons |
| `Shutdown@5, Startup@20` | no interval; both are unmatched session endpoints |
| `Interactive@0, Hidden@1, Shutdown@5, Startup@20, NonInteractive@30, Shown@31` | `session [0,5]` closed by shutdown and `session [20,30]` opened by startup |
| Previous row set plus `Interactive@21, Hidden@22` | `[0,5]` and `[21,30]`; startup@20 is dropped because another start follows |

For equal-time rows it uses physical source order, never event-priority sorting. At one timestamp,
`Hidden,Interactive,NonInteractive,Shown` yields `session [0,0]`;
`Interactive,NonInteractive,Hidden,Shown` and `Interactive,NonInteractive` yield `glance [0,0]`;
`NonInteractive,Interactive` yields no interval. Zero-duration intervals survive reconstruction;
the separate zero-duration policy owns later removal.

### Schoedel and EYES

Add `schoedel_2026_app_within_screen_prose_v1` to app reconstruction as a controlled derivative.
It consumes, but never mutates, the selected B05 intervals. The full deposited Schoedel binding is
registered as unavailable and refuses with named missing prerequisites rather than becoming a
second implementation arm.

The prose arm's added completion rules are frozen and receipted rather than attributed to
Schoedel. It consumes the normal post-B01 event stream. When
`correct_duplicate_event_timestamps=true` (the default), distinct same-instant events are first
ordered by the established Chronicle priority — Activity Resumed, neutral events, configured stop
events, then physical order within a priority class — and separated by 1 microsecond. Schoedel
therefore sees those corrected timestamps rather than reintroducing the raw tie. Within one
immutable B05 interval, rows are then ordered by `(corrected_timestamp_ns,
physical_source_row_index)`. A type-1 row for package A opens A. A later type-1 row for a different
package or the B05 end-row key closes A at the timestamp of A's last package-associated row
strictly before that boundary key; the boundary row itself is never borrowed as A evidence. A
same-package type-1 row is another A row, not a boundary. The different-package type-1 row may
open the next episode. If timestamp correction is explicitly disabled, a consequential raw tie
still requires stable source-order evidence and otherwise refuses `ambiguous_equal_timestamp`.

When the opener is A's only row before the boundary, the controlled derivative materializes a
bounded `[start,start]` episode with raw duration zero and
`completion=singleton_zero_length`. It does not extend the episode to the different app or screen
boundary and does not silently drop it. B03 reports this artifact as `not_classifiable` (only a
strictly positive bounded duration can be micro-use). B04 still evaluates the raw zero exactly as
the compatibility pipeline does, so a positive floor qualifies it; the selected B04 disposition
then applies. The separate `filter_zero_duration_sessions` step runs later: when enabled it removes
any retained zero-bound row and records that removal; when disabled the row/lineage survives.
If B04 already dropped the row, the zero filter records no second removal. These rules make the
completion observable without claiming that a zero interval is observed use.

When the selected B05 interval is right-censored and has no observed end-row key, Schoedel does not
borrow the query boundary. It emits an unbounded evidence row with the opener, no stop/duration,
`completion=right_censored_screen_interval`, and no headline credit. B03 reports
`not_classifiable`, B04 does not qualify an unbounded duration, and the censor receipt remains
visible. A screen interval with no type-1 app launch emits no app episode and increments
`screen_interval_without_app_launch`.

Repair EYES trailing-fragment close reasons, expose full tagged FAU as evidence, and add a receipt
that pins source commit/version/license status, effective option vector, the exact reference-defect
repair IDs `stale_predecessor_after_forward_reboot_gap`, `non_monotonic_gap_emission`, and
`nested_block_cursor_reset`, ACTIVE-only headline projection, unavailable concurrency/pickup
surfaces, and `partial_replay` status.

## 7. What to compose

Compose rather than duplicate these existing mechanisms:

- B01 retention and B02 opener eligibility remain upstream of app reconstruction.
- B03 reads the raw bounded episode duration produced by reconstruction and writes only a label.
- B04 reads the same raw duration, then applies its independently selected disposition.
- B05 reads the full device stream and is never narrowed by B01.
- The Schoedel prose arm reads a stable B05 interval identity and app rows inside it.
- B04 aggregate eligibility composes with existing daily/weekly/category aggregation rather than
  rewriting the reconstructed row.
- Existing row/source lineage, workflow checkpoints, tracked-query identities, reconstruction-base
  persistence, options digests, JSON-LD parameter bindings, and runtime artifact machinery carry
  the new fields.
- Existing generated LinkML domains supply TypeScript option types and UI values.
- Existing settings, preset, project, last-run, import/export, and share paths carry and sanitize
  the new fields.
- EYES full FAU evidence is derived from the existing Rust segmentation result; it does not create
  a second TypeScript preprocessing implementation.

Named scientific presets later compose source vectors. For example, a Schoedel-derived vector
would include its app reconstruction, a declared B05 adapter, inclusive one-second B04 comparator
and `drop_row`, same-app merge/quality choices, package filtering, and day boundary. Selecting only
the app arm must never be labeled the full Schoedel method.

## 8. What to adapt

The shared source/compatibility vocabulary is additive over the accepted B02 contract. B02's
existing `baseline_equivalent` and `source_equivalent` values remain valid; the common generated
domain is exactly:

- `baseline_native`: exact compatibility behavior of the pre-axis product;
- `baseline_equivalent`: an explicit selection is behaviorally equal to the baseline component;
- `source_native`: the source implementation itself runs on its required native signal/order;
- `source_equivalent`: an explicit selection is behaviorally equal to the source-native component;
- `source_aligned_adapter`: source rule mapped through an explicit canonical event adapter;
- `controlled_derivative`: executable component perturbation whose complete-method claim is
  withdrawn;
- `partial_replay`: meaningful subset with named missing surfaces or conformance evidence;
- `refused`: required signal, order, input, or compatibility condition is unavailable.

Specific adaptations:

- `okoshi_lt_5s` is source-aligned at B03 only; crossing it with another reconstruction is a
  controlled derivative.
- Generic B04 comparator/disposition controls are project-owned components. A source-named preset
  becomes source-aligned only when threshold, comparator, checkpoint, disposition, and upstream
  interval source all match.
- Parry–Toth combined/fused Chronicle labels require a declared expansion adapter or refusal; they
  are not silently equivalent to two separate events.
- Zhu requires preserved full-log adjacency. A filtered slice cannot self-certify adjacency.
- The Schoedel prose arm is always a controlled derivative because the paper says its description
  is simplified and the full prerequisites are unavailable.
- EYES remains `partial_replay` until full tagged output, concurrency semantics, pickup products,
  parameter reachability, independent replay, and license status are resolved.

Relations are recorded per component; they are not collapsed into a scalar “worst relation” for a
complete binding. The frozen crossing table for this milestone is:

| Selected component/crossing | Relation when executable | Scientific admissibility |
|---|---|---|
| Omitted B03 `none` | `baseline_native` | Yes; compatibility baseline |
| Explicit B03 `none` | `baseline_equivalent` | Yes; same rows with explicit identity |
| `okoshi_lt_5s` × `foreground_background_pairing` | `source_aligned_adapter` at B03 | Yes as an Okoshi-aligned B03 component; not a certified whole Okoshi method |
| `okoshi_lt_5s` × any other app reconstruction | `controlled_derivative` | Yes for independently controlled component contrasts |
| Omitted B04 strict `<60 s` + `chronicle_blank_keep_row` | `baseline_native` | Yes; compatibility baseline |
| Explicit identical B04 vector | `baseline_equivalent` | Yes; same scientific bytes with explicit identity |
| Any other B04 comparator/threshold/disposition | `controlled_derivative` | Yes as a project-owned factor; a later named preset must prove its complete source vector |
| Omitted B05 `chronicle_screen_interactive_v1` | `baseline_native` | Yes; compatibility baseline |
| Explicit B05 `chronicle_screen_interactive_v1` | `baseline_equivalent` | Yes |
| Parry–Toth B05 with valid capability sidecar and distinct vocabulary | `source_aligned_adapter` | Yes as a device-session component; complete-method certification remains separate |
| Zhu B05 with valid capability sidecar and full-stream adjacency | `source_aligned_adapter` | Yes as a device-session component; complete-method certification remains separate |
| Either source B05 with missing/unknown/negative capability evidence | `refused` | No execution; exact reason retained |
| Schoedel prose × any of the three executable B05 arms | `controlled_derivative` | All three are admissible factor crossings; none is the full Schoedel/PhoneStudy method |
| Full Schoedel OSF binding on ordinary Chronicle input | `refused` | Structurally unavailable until every named prerequisite lands |
| Current EYES product arm for every otherwise executable vector | `partial_replay` | Admissible only in the declared partial-replay stratum |
| EYES × B02 `gesis_app_scoped_starts` | `refused` | Existing exact B02 refusal remains authoritative |

The complete-binding receipt carries this per-component relation vector plus one independent
execution disposition. An executable controlled derivative must not inherit a source method's
name; a refusal cannot be averaged into or compared as a zero-output arm.

## 9. What genuinely must be built

The smallest complete implementation surface is:

1. `MicroUseClassificationPolicyId`, `MinimumDurationComparatorId`,
   `MinimumDurationDispositionId`, and `ScreenSessionConstructionStrategyId` in the research
   ontology;
2. corresponding required browser options and safe defaults in the local LinkML contract;
3. generated contract/OpenAPI/METHODS/schema/semantic projections;
4. UI selectors, search routing, reset/modified state, tooltips, and applicability messaging;
5. strict persistence/import/project/last-run validation with old-envelope defaults;
6. browser-to-Rust request projection;
7. Rust enums, parsers, defaults, applicability/refusal decisions, and receipts;
8. a non-destructive B03 row classifier after raw episode duration materialization;
9. one B04 qualification result feeding all four dispositions and downstream aggregate
   eligibility without applying the floor twice;
10. B04 dropped-row lineage evidence and conditional output fields;
11. three B05 state machines with participant isolation, source order, typed refusals, censor
    behavior, and stable interval IDs;
12. the Schoedel prose reconstruction strategy, explicitly dependent on B05 interval IDs;
13. EYES chunk-end inference propagation, full tagged-FAU evidence, and partial-replay receipt;
14. tracked/cold query inputs, cache keys, persisted-base identities, protocol bumps where serialized
    state changes, and exact warm/cold receipt equality;
15. workflow dependencies, output schema, provenance, semantic index, runtime boundary, ZIP
    artifacts, and options identity;
16. configuration equivalence classes, combinatorial/tomography evidence, scientific synthetic
    proof matrices, generated WASM, and browser E2E.
17. a typed `input_capability_evidence_file` support role for source-sensitive B05 arms, including
    browser upload/state, Rust/WASM parsing, support-artifact identity, workflow reads, cache keys,
    provenance, semantic projection, and fail-closed preflight.

No Python or TypeScript preprocessing path is permitted. Rust/WASM remains the scientific
authority.

### Input capability evidence contract

Raw-row absence is not capability evidence. A standalone canonical row can prove that one event
was observable in that bound input; no row can prove full-stream scope, ordering, chunk
completeness, or single-device identity. Source-sensitive B05 arms therefore consume an optional,
immutable CSV support artifact under role `input_capability_evidence_file` (TypeScript
`inputCapabilityEvidenceFile`). It is never a `BrowserProcessingOption` and is never required by
the generic runtime or Chronicle baseline. This role accepts `.csv` only; XLS/XLSX/JSON and an
empty artifact fail before scientific preflight. Its root-role cardinality is `0..1`,
`required=false`, `required_when=None`, and `qualification=optional-evidence`: absence must reach
the scientific applicability resolver rather than become a generic workflow-binding error.

The header and column order are exactly:

```text
schema_version,raw_input_sha256,participant_id,capability_id,state,evidence_basis,evidence_reference,evidence_sha256
```

Every row has `schema_version=chronicle-input-capability-evidence/v1`; a
`raw_input_sha256` of `sha256:` plus 64 lowercase hex characters; an exact participant ID or `*`;
and one capability ID from this closed domain:

```text
android_usage_event_15_screen_interactive
android_usage_event_16_screen_non_interactive
android_usage_event_17_keyguard_shown
android_usage_event_18_keyguard_hidden
android_usage_event_26_device_shutdown
android_usage_event_27_device_startup
separate_screen_keyguard_event_rows
full_unfiltered_source_event_stream
source_record_order_preserved
equal_timestamp_source_order_preserved
single_device_stream_per_participant
complete_observation_window_chunk
```

`state` is exactly `capable|absent|unknown`. `evidence_basis` is exactly
`producer_manifest|exporter_receipt|transformation_receipt|study_protocol|operator_attestation|unspecified`.
For `capable` or `absent`, the basis cannot be `unspecified` and `evidence_reference` is required;
`evidence_sha256` is optional but, when present, is strict lowercase SHA-256. `unknown` requires
`unspecified` with empty reference/digest. There is at most one row per
`(raw_input_sha256,participant_id,capability_id)`. An exact participant row overrides `*`.
Within a bound digest, an omitted capability or missing participant/wildcard claim resolves to
`unknown`, never `absent`.

Runtime computes SHA-256 over the exact raw event bytes, structurally validates every sidecar row,
then selects only claims with that exact digest. A syntactically valid batch sidecar may contain
foreign-digest rows; they are ignored for resolution but remain committed by the whole support
assignment digest. Zero rows for the current digest returns
`capability_evidence_not_bound_to_input`, not ordinary unknown and not a malformed-file error.
Wrong schema/header/order, unknown enums, malformed digest syntax, invalid conditional fields,
duplicates within a digest, or a claim contradicted by an observed standalone event produce
`invalid_input_capability_evidence` with a typed detail and physical data-row number; raw cell
values never enter errors. Original support bytes/file metadata and their assignment digest remain
in the artifact manifest. The resolved scientific receipt separately records evidence origin
`observed_in_bound_input|manifest_assertion|none` and observation disposition
`observed|capable_no_row|absent|unknown`. A manifest assertion enables conditional execution but is
not independent verification. Only after at least one sidecar row is bound to the raw digest may a
standalone event recognized by the versioned built-in Android label map upgrade that event's
omitted/explicit-unknown signal claim to `observed`; an arbitrary user
`interaction_type_remap` cannot synthesize capability. Observation never bypasses a
missing/unbound sidecar and never infers a structural capability. An observed event paired with an
`absent` claim is a contradiction and refuses validation. Fused 15/17 or 16/18 labels do not prove
separate rows.

The adapter identity is frozen as `chronicle_android_usage_event_labels_v1` and is included in the
applicability receipt. Changing its recognized raw spellings or standalone/fused classification is
a protocol change, not a silent normalizer edit.

The sidecar follows the existing support-file lifecycle: browser upload, project/run input
presence, optional durable file retention, worker transfer, and support-bundle cache identity. A
project may retain the upload while it is inactive, but `buildSupportFiles` transports it only for
Parry–Toth, Zhu, or a Schoedel arm whose internal B05 dependency selects one of those strategies.
The Chronicle/default path omits it, preserving byte, provenance, and cache identity. It is not
copied into presets/shared URLs or the options digest. Its assignment digest enters B05 and
Schoedel query keys, persisted reconstruction identity, runtime provenance, JSON-LD derivation,
and semantic index. Changing only this evidence invalidates capability preflight and consumers,
not B03/B04 or unrelated support readers.

Applicability is fail-closed. The Chronicle baseline records `not_required`. For source-sensitive
arms, participant issues are sorted and retained; one ineligible participant refuses the whole
binding rather than disappearing. The deterministic top-level refusal priority is:

```text
input_capability_evidence_absent
capability_evidence_not_bound_to_input
participant_scope_undetermined
multiple_device_streams_aliased
device_stream_scope_unknown
combined_event_representation
source_stream_incomplete
source_stream_completeness_unknown
source_order_not_preserved
source_order_unknown
unsupported_input_chunk
input_chunk_status_unknown
missing_required_signal
required_signal_capability_unknown
unorderable_full_stream_row
non_monotonic_source_timestamps
ambiguous_equal_timestamp
```

Malformed CSV remains the separate `invalid_input_capability_evidence` class before reconstruction.
A `capable` claim with zero matching rows executes and records `capable_no_row`; it does not fall
back. Parry–Toth requires capabilities 15, 16, 17, 18, 26, 27 plus separate event rows, full
unfiltered source, preserved source order, one device stream per participant, and a complete
observation-window chunk. Zhu requires 15, 16, 18, and 26 plus the same structural capabilities.
Equal-timestamp order is required only when a decisive equal-time group exists; otherwise its
absence does not create a counterfactual refusal.

## 10. Rejected and historical options

- Do not ship a universal Ferreira 15-second or Morrison 21.4-second source-equivalent arm.
- Do not treat Andrews device checks, Niemeijer/Chen screen intervals, or PULSE strata as app
  micro-use or app minimum-duration methods.
- Do not promote the unexecuted GESIS five-second example into a source preset.
- Do not adopt ActivityWatch as a dependency or cite its prerelease one-second implementation as a
  validated scientific threshold.
- Do not turn sample-derived breakpoints into fixed truths; adaptive fitting belongs in B12.
- Do not call PULSE sampling strata micro-use categories.
- Do not zero duration to represent exclusion.
- Do not delete a row without recoverable excluded-row lineage.
- Do not add Okoshi as a duplicate B05 strategy with invented malformed-stream behavior.
- Do not infer unlock from screen-on or infer source adjacency after filtering.
- Do not run the full Schoedel OSF label on standard Chronicle events.
- Do not copy unlicensed OSF or EYES code.
- Do not treat EYES ACTIVE-only credited rows as the full tagged FAU table.
- Do not force EYES concurrency/pickup/options expansion into this bounded milestone.
- Toth–Trifonova 2021 remains a superseded historical predecessor rather than another B05 arm.

## 11. Decision ledger

| Capability | Candidate | Origin/evidence | Status | Why | Risks | Required verification | Open question |
|---|---|---|---|---|---|---|---|
| B03 default | `none` | Feature baseline `080801a` | Adopt | Exact compatibility | New receipt could still perturb caches | Detached scientific-byte oracle and warm/cold identity | None after proof |
| B03 classifier | `okoshi_lt_5s` | Cyberoception primary paper | Adapt | Exact `<5 s`, pair, and classification effect stated | No public end-to-end replay | Boundary fixture, output/receipt, cross-reconstruction reachability | None for component execution |
| B03 ambiguous comparator | Ferreira reported 15 s | Primary paper | Investigate | Jenks derivation is valuable | `<=` prose conflicts with `<` trigger | Archived code/data or explicit author clarification | Can equality be resolved? |
| B03 fitted comparator | Morrison 21.4 s | Primary paper | Reject now / defer B12 | Sample-fit is not portable | Fixed label would imply false conformance | Reproducible fit inputs/seed/transform | Does a data archive exist? |
| Device-check comparator | Andrews `<15 s`/`<=15 s` lineage | Primary paper + MATLAB/sample artifact | Reject for B03 | Device-active checks are not app episodes | Importing it would change the target unit and preserve an operator conflict | Keep only as operator-drift evidence | N/A for app episodes |
| Sampling bins | PULSE 0–5/5–30 strata | Primary paper; generic discovery deduplicated to A01 | Reject | These are prompt-sampling strata, not a classifier | A selectable arm would fabricate construct and boundary semantics | N/A | N/A |
| B04 abstraction | comparator + threshold + disposition | Project-owned | Build | Makes the full decision auditable | Adds aggregate eligibility semantics | 2×2 orthogonality and all-disposition lineage | None after frozen contract |
| B04 default | strict `<` + `chronicle_blank_keep_row` | Current Rust | Adopt | Exact legacy behavior | Null duration is easy to misread | Detached 59.999/60/60.001 byte oracle | None after proof |
| B04 retained control | `retain_and_credit` | Project-owned | Build | Separates threshold diagnosis from exclusion | Not a published method | Raw/credited totals and explicit status | None |
| B04 auditable exclusion | `retain_but_exclude` | Project-owned | Build | Preserves raw row while changing denominator | Consumers could ignore eligibility | Aggregate and export contract tests | None |
| B04 destructive disposition | `drop_row` | Yamanaka/Schoedel examples | Build generic | Needed for source presets | Loss if lineage artifact fails | Exact attrition + source-range receipt | None |
| Reconstruction-stage floor | ActivityWatch `<=1 s` | Pinned prerelease source `a21b48c` | Compose evidence; no dependency | Exact implementation demonstrates another checkpoint | Prerelease, no parser fixture, and wrong stage for canonical B04 | Preserve stage/operator in source register | N/A for current post-materialization arm |
| Screen attrition floor | Niemeijer `<12 s` | Primary CC BY article | Reject as app B04 / compose precedent | Demonstrates screen-level loss and admitted false exclusions | Wrong target unit and delegated builder | Cite only in sensitivity/attrition rationale | N/A for app episodes |
| Screen sensitivity floor | Chen `<10 s` | Primary CC BY-NC-ND article | Reject as app B04 / compose precedent | Explicit multi-threshold sensitivity selection | Wrong target unit; no executable builder | Cite sensitivity rationale without reusing code | N/A for app episodes |
| Tutorial floor | GESIS prose five-second example | Pinned tutorial `0561e0c` | Compose guidance; reject preset | Source explicitly leaves the choice to the research question and executes no floor | Promoting it would falsely imply an executed source arm | No benchmark; preserve quotation/source identity | N/A |
| Zero-as-exclusion | Set duration to zero | Project invention from preflight trap audit | Reject | It confuses observed duration with analytical disposition | Biases totals and destroys recoverable raw meaning | Prove no disposition fabricates zero | N/A |
| B05 default | `chronicle_screen_interactive_v1` | Current Rust | Adopt/freeze | Rich, versioned baseline | Reboot behavior may be undesirable but must remain | Detached screen CSV/JSON oracle | Reboot change belongs in later derivative, not default |
| B05 source arm | `parry_toth_2025_session_glance_v1` | Paper + pinned OSF artifacts | Adapt | Distinct session/glance and reboot behavior | Code unlicensed; fused labels/order | Independent implementation and sample fixture replay | Combined-label policy stays refusal initially |
| B05 source arm | `zhu_2018_unlock_lock_v1` | Paper pseudocode | Adapt | Distinct user-present start | Brittle adjacency and sparse signals | Full-stream order and missing-signal refusals | None after fixtures |
| B05 duplicate | Okoshi screen pairing | Cyberoception | Reject | No new well-formed behavior | Would invent failures | N/A | N/A |
| B05 capability evidence | `chronicle-input-capability-evidence/v1` CSV | Project-owned contract composed with support artifacts | Build | Absence cannot distinguish incapable instrumentation from zero occurrences | Assertions are conditional evidence, not truth; participant/digest/order aliasing | Exact parser, trust/origin, observed contradiction, native/WASM/cache/provenance matrix | Project owns schema and ongoing browser/generated/Rust/WASM maintenance |
| B05 raw-order seam | post-decode full-stream participant view | Project-owned composition over existing decoder/source lineage | Build/Compose | P&T/Zhu cannot use filtered or handover-ranked rows | New DAG branch and protocol identity cost | Blank/backward/tied/remapped/filter adversaries and default-chain isolation | Project owns query/protocol maintenance |
| App strategy | `schoedel_2026_app_within_screen_prose_v1` | Final article | Adapt | Requested and behaviorally distinct | Simplified source; project completions must stay visible | Source-vector receipt; A/A/B, singleton, censor, and all-three-B05 crossing fixtures | All three executable B05 arms are admissible controlled perturbations; none is full Schoedel |
| Full Schoedel | revision-1 OSF pipeline | OSF files/README | Refuse | Inputs/license/raw context unavailable | Silent approximation would be false | Named prerequisite preflight | Reconsider only if authority and licensed inputs land |
| EYES provenance | trailing endpoint reason | Pinned oracle + current core | Adapt/fix | Current reason is concretely wrong | Chunk merges can obscure endpoint episode | Observed-stop and repaired-end fixtures | None after proof |
| EYES evidence | tagged FAU + conformance receipt | Existing core data | Build | Makes ACTIVE-only projection auditable | Artifact growth | Digest, row count, and no-aggregate-influence proof | Pickup product remains deferred |
| Cross-surface integration | schema/UI/Rust/WASM/workflow/provenance | Project-owned | Compose | Required for a real axis | Generated drift and cache aliasing | Contract, boundary, warm/cold, semantic closure | None |

Chronicle owns every `Build`/`Compose` row. Ongoing cost includes LinkML and generated-contract
maintenance, browser upload/persistence/UI, Rust/native/WASM state and protocol versions, workflow
and cache identity, semantic/provenance projections, fixture/golden resealing, and supported-browser
tests. No external maintainer is expected to preserve these seams for the project.

## 12. Smoke and proof plan

The companion [proof matrix](b03-b05-foundational-semantics-proof-matrix.md) is normative. Its
smallest decisive fixtures include:

1. B03 threshold minus one nanosecond, exact threshold, and plus one nanosecond.
2. A 2×2 B03/B04 orthogonality grid using four- and six-second episodes with a five-second B04
   floor.
3. B04 legacy 59.999/60/60.001-second default compatibility.
4. One 12-second episode split into four- and eight-second concurrency segments to prove the
   declared checkpoint and no accidental second floor.
5. A locked glance, unlocked use, OEM-reversed keyguard sequence, duplicate/orphan/tail sequence,
   reboot sequence, and equal-time permutations across all B05 arms.
6. A Schoedel A-resume/pause/resume then B-resume/pause inside one screen interval, proving that
   A ends at its own last log rather than at B's start.
7. EYES ACTIVE–IDLE–ACTIVE FAU with an observed trailing stop and with a repaired trailing end.
8. Omitted/default detached scientific-output oracles for every affected output and tracked/cold
   A→B→A cache sequences for every executable arm.

Proof must cover native Rust, tracked incremental execution, runtime/WASM receipts, browser
persistence and selector reachability, semantic/provenance artifacts, generated contracts,
configuration campaigns, and Chromium/Firefox E2E. A typed refusal counts as a tested outcome; an
arbitrary error or silent fallback does not.

## 13. Recommended architecture

Use one project-owned classification/disposition seam after episode materialization:

```text
ReconstructedEpisodeEvidence {
  raw_start_ns
  raw_stop_ns
  raw_duration_ns
  source_row_ranges
  close_reason
}

MicroUseReceipt {
  requested_policy
  effective_policy
  comparator
  threshold_ns
  checkpoint
  class_counts
}

MinimumDurationReceipt {
  requested_comparator
  effective_comparator
  threshold_ns
  requested_disposition
  effective_disposition
  checkpoint
  qualified_count
  retained_credited_count
  retained_excluded_count
  dropped_count
  excluded_lineage_digest
}
```

Compute B03 and B04 qualification from immutable raw episode evidence. Apply B03 first only for
presentation; both read the same raw duration, so order cannot change qualification. Carry an
internal aggregate-eligibility Boolean instead of inferring exclusion from a null duration. Keep
legacy blanking as a final output projection under the default disposition.

Use a separate B05 result:

```text
ScreenIntervalEvidence {
  screen_interval_id
  strategy_id
  kind
  start_ns
  stop_ns
  start_source_ranges
  stop_source_ranges
  close_reason
  left_censored
  right_censored
}
```

Every B05 strategy returns either intervals plus a receipt or a typed applicability refusal. The
Schoedel prose app strategy accepts immutable screen interval IDs as an input dependency and writes
that ID on each app episode. The workflow computes this declared B05 dependency even when the
separate screen CSV is not requested; the publication toggle controls only the product, not the
scientific input. The app strategy may not call or duplicate a screen builder internally.

For EYES, extend the existing segmentation-to-matcher adapter with fragment-end evidence:

- every credited ACTIVE FAU fragment, whether cut at an interior device-state boundary or at the
  natural chunk endpoint: product close reason `EyesDeviceStateBoundary`;
- fragment ending at a natural chunk endpoint: record the selected contributing endpoint episode
  and `end_inference` only in `EyesTaggedFauEvidence.chunk_endpoints`;
- dedicated tagged-FAU artifact: every ACTIVE/IDLE/GAP/GLANCE/SHUTDOWN fragment;
- ordinary app CSV: ACTIVE credited view only, every credited fragment serializes
  `device_powered_off_or_idle`, explicitly identified in the receipt.

The enum/lineage name for every credited FAU fragment is `EyesDeviceStateBoundary` /
`eyes-device-state-boundary`; the existing scientific CSV wire value remains exactly
`device_powered_off_or_idle`. The implementation must not introduce a second CSV spelling such as
`device_state_boundary`.

For a merged same-package chunk, endpoint provenance comes only from episodes whose resolved
`time_stop_ns` equals the chunk's maximum `end_ns`. Choose the candidate with the greatest
`time_resume_ns`; if candidates also tie on resume time, choose the greatest original episode
index, which is the later preserved source-order episode. The tagged-FAU evidence records the full
candidate episode-index/inference set and the selected index, so the scalar CSV label does not hide
the tie. Selection affects evidence only and never rewrites the credited fragment's product close
reason. Reordering an input without preserved source identity is not allowed to change this
selection silently.

Thread every new request field through the actual computational query, tracked config, cache and
persisted-base identities, workflow contract, result assembly, options digest, JSON-LD parameter
binding, runtime manifest, semantic source/index, and dedicated receipt artifact. Protocol versions
must change wherever serialized shape or identity changes.

The capability evidence travels through `BrowserSupportFiles` and `RuntimeSupportFiles` under the
single CSV role `input_capability_evidence_file`. Runtime validates it once and supplies a typed,
participant-resolved claim set plus the support assignment digest through `PipelineV2SupportFiles`.
B05 applicability is the sole computational reader; result assembly may read the already-resolved
receipt for publication. The raw support bytes never enter error messages.

The receipt shape is frozen as:

```text
B05InputApplicabilityReceiptV1 {
  protocolVersion
  inputDigest
  evidenceArtifactDigest
  evidenceAssignmentDigest
  requestedStrategyId
  effectiveStrategyId
  relation
  executable
  refusalReason
  refusalDetail
  sourceCheckpoint: post_decode_pre_filter_pre_dedupe_pre_timestamp_correction
  sourceOrderIndexSpace: raw_csv_data_row
  sourceAdapterId: chronicle_android_usage_event_labels_v1
  requiredSignalIds[]
  requiredCapabilityIds[]
  participantDecisions[]
  capabilityResolutionDigest
  optionsDigest
}
```

Each participant decision carries participant ID, evidence scope `exact|wildcard|none`, sorted
capability decisions, decisive-equal-time-group count, and every issue. Each capability decision
carries asserted/effective state, derived evidence origin, evidence basis/reference/digest,
observed standalone-row count, and observation disposition. Participants and capabilities are
sorted before the resolution digest. Complete binding identity is raw input + exact options +
evidence assignment + resolved capability state; the options digest alone is insufficient.

### Ordering, partitioning, and chunk eligibility

B05, Schoedel, and EYES are serial state machines within one participant stream. Legal parallelism
is limited to whole participant partitions. This milestone accepts one materialized raw event
artifact per execution. A multi-participant artifact is partitioned by canonical participant ID,
and each partition retains physical source-row order as its stable secondary order. Concatenating
or chunking multiple raw files for the same participant is not an eligible implicit operation; it
requires a future ordered-file/carry-state protocol and otherwise refuses
`unsupported_input_chunk` with detail `participant_stream_fragmented`. The capability sidecar is
bound to the one raw artifact digest
and must declare each participant stream complete within the stated observation window.
Participant IDs, screen state, open apps, reboot state, and endpoint inference must never cross
partitions.

The two source-sensitive B05 arms branch directly from `decode_source_records`, not the existing
`canonicalize_source_rows` chain: that chain has already removed missing timestamps and may apply
the arbitrary user `interaction_type_remap`. The B05-only view validates every physical row's
participant and timestamp before any removal, recognizes only raw spellings and the versioned
built-in Android normalization map, and preserves `source_data_row`. Missing/blank timestamps in a
required full stream refuse `unorderable_full_stream_row`; user remaps cannot synthesize an event
capability. This branch runs before B01 retention, package filtering, deduplication, timestamp
correction, app handover ranking, or timestamp resorting. Inside a participant, physical source
rows must already have nondecreasing timestamps; otherwise preflight refuses
`non_monotonic_source_timestamps` instead of sorting. The state machine scans physical source order
exactly, so equal timestamps use source ordinal. It must not consume `order_source_records`, whose
app-resume/app-pause handover rank is appropriate for app matching but is not Parry–Toth or Zhu
source order. The Chronicle baseline retains its established canonical/default chain but receives
the same participant partition boundary.

This milestone does not implement resumable within-participant streaming. Splitting one
participant across chunks without an explicit serialized carry state returns top-level
`unsupported_input_chunk` with detail `participant_stream_fragmented`; it may not restart the
state machine, close at a chunk boundary, or fall back to the Chronicle strategy. Query-window
edges remain observation-window boundaries and use each strategy's explicit censor/orphan rules.
Equal timestamps are ordered by preserved physical source index; an arm requiring that ordering
refuses when the capability evidence is unknown or negative. Only stable, complete whole-
participant partitions are parallel; no file/date/window chunking or EYES final-fragment
parallelization is claimed in this milestone. B03 and B04 may parallelize only after bounded app
episodes and their lineage have been materialized.

## 14. Risks, unknowns, and change triggers

Known risks:

- Conditional output columns can drift across CSV, SAV, visualization, review, and semantic
  projections.
- A B04 row retained but aggregate-excluded can be misused by consumers that ignore eligibility.
- Dropped rows require a bounded but complete lineage artifact to avoid silent attrition.
- Source-order-sensitive B05 methods can be invalidated by sorting or filtering before preflight.
- API-28/29 signal availability and combined OEM labels create structural refusals.
- A Schoedel prose adapter can be over-promoted into a full-method claim unless its receipt always
  carries `controlled_derivative`.
- EYES full tagged FAU may materially enlarge artifacts; it must remain an opt-in/dedicated evidence
  surface if size becomes unsafe.
- The EYES reference license is unresolved; only independent behavior reimplementation is allowed.
- Configuration-space growth can exceed the milestone compute budget if every factor is naively
  enumerated. Use exact focused products plus the existing t-wise campaign.

Open questions that do not block this milestone:

- whether archived Ferreira code resolves the 15-second equality conflict;
- whether Morrison fitting data/code can support a later B12 replay;
- whether licensed/full PhoneStudy inputs will ever make the Schoedel OSF binding executable;
- whether EYES native concurrency can be independently replayed against a clean public fixture;
- whether an EYES pickup product is scientifically required in the main paper or only a supplement.

Change this decision only if one of the following lands:

1. a primary, versioned implementation resolves a currently ambiguous comparator or failure rule;
2. licensed source inputs make the full Schoedel pipeline directly executable;
3. an independently validated EYES oracle proves a different production surface or endpoint rule;
4. a source-order or Android-vocabulary audit shows one accepted B05 arm cannot be represented
   without changing its construct;
5. the detached default oracle proves the proposed seam cannot preserve current scientific bytes;
6. a proof-matrix row exposes aliasing between B03, B04, B05, reconstruction, concurrency, or
   cleaning that the factored contract cannot identify.

## Sources

- [Android `UsageEvents.Event`](https://developer.android.com/reference/android/app/usage/UsageEvents.Event)
- [Okoshi et al., Cyberoception](https://arxiv.org/html/2504.16378v1)
- [Ferreira et al. 2014 author PDF](https://www.jorgegoncalves.com/docs/mobilehci14a.pdf)
- [Morrison et al. 2018 author PDF](https://eprints.gla.ac.uk/161233/1/161233.pdf)
- [Yamanaka 2025 PDF](https://www.jstage.jst.go.jp/article/ssi/13/3/13_1/_pdf)
- [Andrews et al. 2015](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0139004)
- [ActivityWatch `SessionParser.kt` at `a21b48c`](https://github.com/ActivityWatch/aw-android/blob/a21b48cedc40c091c82a48e1396cdd1d9ad8363f/mobile/src/main/java/net/activitywatch/android/parser/SessionParser.kt)
- [Niemeijer et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8976254/)
- [Chen et al. 2026](https://www.nature.com/articles/s41598-026-52696-0)
- [GESIS tutorial at `0561e0c`](https://github.com/patrickzerrer/How-to-work-with-Android-App-Logging-Data/blob/0561e0c4f0e0fbd094d5ec6ef005819affbbe762/readme.qmd)
- [Parry–Toth final paper](https://www.aup-online.com/deliver/fulltext/26659085/7/1/CCR2025.1.8.PARR.pdf)
- [Parry–Toth OSF project](https://osf.io/5bekx/)
- [Zhu et al. arXiv record](https://arxiv.org/abs/1711.09408)
- [Schoedel et al. 2026 final article](https://www.cambridge.org/core/journals/psychometrika/article/from-digital-data-to-psychological-insights-making-sense-of-mobilesensing-data-through-integrative-preprocessing-pipelines/00A9F0AC082318C4EDC1CE1099E33E96)
- [Schoedel OSF project](https://osf.io/tmuhe/)
- [Schoedel `Screen_preprocessing.R`, revision 1](https://osf.io/download/6928d7a29e9d1817df77023b/?revision=1)
- [Schoedel `App_preprocessing.R`, revision 1](https://osf.io/download/6928d750b0e3a86ba0957a52/?revision=1)
- [Schoedel `App_summary.R`, revision 1](https://osf.io/download/6928d7500778a58bcc7703de/?revision=1)
- Pinned local EYES oracle: `/home/opt/eyes-toolbox` at
  `89549a2d5d9732d8aaaa2f1fed25c1dbffd9a108` (license unresolved; local path is an audit source,
  not a manuscript link or shipped artifact)
