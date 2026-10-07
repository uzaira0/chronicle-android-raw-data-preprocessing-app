# Full-text audit of mobile-use event processing

Audience: Chronicle authors and implementers  
Audit started: 2026-08-29  
Status: living report; **not yet a completed corpus**

## Direct answer and scope

The object of this audit is not the 51 references selected by Winklbauer and Batinic. That set is
one bounded subsection and one citation-chaining seed. The actual corpus is every discoverable
paper, review, thesis, technical report, dataset paper, supplement, and public code artifact that
can tell us how raw smartphone or app-use observations became durations, sessions, episodes, or
screen-time measures.

No paper is credited as “fully read” from an abstract, search snippet, bibliography entry, or a
methods paragraph alone. “Fully read” means that the accessible main text was checked from first
page through references and that named supplements, data, and code were followed when they could
change the processing account. Inaccessible material remains an unresolved evidence item. A blank
field never means “not reported.”

The 51-paper census will eventually appear only as a clearly bounded answer to: how often did the
references chosen by Winklbauer and Batinic disclose upstream construction? It will not define the
size, boundaries, or organization of this broader review.

## Mandatory extraction contract

Every retained work receives every field below. Values must be `reported`, `not reported`,
`not applicable`, `not checked yet`, `inaccessible`, or a concrete description with an evidence
location. `Not reported` is allowed only after a full-text read. `Inaccessible` is about our access,
not about what the paper contains.

### Identity and access

- canonical citation, DOI, stable URL, document type, venue, year, and version;
- author group and institutional lineage;
- duplicate, precursor, extension, correction, and shared-dataset relationships;
- access route and date; exact files/sections/pages read;
- supplement, appendix, repository, data, code, license, and revision status.

### Instrument and raw observations

- platform, OS/API version, device restrictions, collector/logger and its version;
- recruitment, sample, observation period, geography, and unit of analysis;
- raw source and schema, event vocabulary, state variables, polling or trigger cadence;
- timestamp unit/resolution, timezone, clock source, physical/source-row order;
- whether repeated timestamps are retained, reordered, separated, merged, or deleted;
- validation or manual tests of what the collector actually records.

### Construction from observations to intervals

- input sorting and partitioning;
- deduplication identity and disposition;
- deterministic priority for different event types at one instant;
- opener events, closer events, pairing direction, and state machine;
- same-app resume, pause, stop, relaunch, and foreground-switch behavior;
- screen, lock/keyguard, call, notification, launcher, system-app, and background behavior;
- missing closer, orphan closer, duplicate opener, tail censoring, reboot, shutdown, crash,
  logger pause, app install/uninstall, and recording-gap behavior;
- overlaps, concurrent/multidevice use, boundary equality, day splitting, DST/timezone changes;
- inactivity gaps, minimum/maximum duration, truncation, deletion, imputation, and caps;
- app/category filters, package mapping, unavailable/unknown apps, and filter provenance;
- grouping of intervals into bursts, sessions, days, contexts, or categories;
- output measures and denominators.

### Analysis and evidential status

- every fixed value and its unit, comparator, processing stage, justification, and cited ancestor;
- missing-data, participant/day inclusion, attrition, and quality-control rules;
- sensitivity analysis, alternative construction, validation, and known measurement error;
- whether the transformation can be rerun from available inputs;
- verbatim evidence excerpts kept short, with page/section/figure/code-line location;
- contradictions between prose, figures, supplements, and code;
- unresolved questions and the next source needed to answer them.

### Extra fields for reviews

- review question, dates searched, databases, full search strings, language/date restrictions;
- duplicate removal, screening stages, inclusion/exclusion rules and counts;
- extraction fields, reviewer independence, adjudication, quality/risk-of-bias assessment;
- synthesis method and whether preprocessing disclosure was itself assessed;
- every cited candidate that may contain an upstream construction rule.

## Completion states

| State | Meaning |
|---|---|
| `discovered` | Identity exists; no content claim is permitted. |
| `metadata checked` | Bibliographic identity is verified; content remains undetermined. |
| `abstract read` | Only abstract-level claims are allowed. |
| `main text read` | Entire accessible paper read; linked supplements/code still outstanding. |
| `fully audited` | Main text plus every accessible method-relevant linked artifact checked. |
| `blocked` | Named material could not be obtained; exact obstacle recorded. |

## Gap matrix

| Claim or deliverable | Present evidence | Confidence | Gap / next action |
|---|---|---:|---|
| Existing discovery material is much larger than 51 | Six slice ledgers contain hundreds of retained records, but include cross-references and artifacts | High | Canonical paper-level deduplication is unfinished; do not publish a unique-paper total yet |
| Same-timestamp events must not be treated as duplicate observations merely because their timestamps match | Direct methods use different event types at one instant as state-transition evidence; the pipeline already has a 1-microsecond correction contract | High for preservation; source-specific priority still varies | Extract each paper/codebase's actual ordering and compare it with Chronicle's declared priority |
| Most papers leave some upstream construction choices unstated | Established in the bounded 51-reference audit and several direct-paper reads | Medium corpus-wide | Recalculate only after the broader canonical corpus is fully audited |
| A complete method map requires literature reviews as discovery sources, not as substitutes for primary-paper reads | Multiple systematic/scoping reviews have been found | High | Fully audit their searches and chase every relevant primary citation |

## Fully audited records

### Hintze, Hintze, Findling, and Mayrhofer (2017) — *A Large-Scale, Long-Term Analysis of Mobile Device Usage Characteristics*

- **Identity.** Daniel Hintze, Philipp Hintze, Rainhard D. Findling, and René Mayrhofer;
  *Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies* 1(2),
  Article 13, 21 pages. DOI [10.1145/3090078](https://doi.org/10.1145/3090078). The author copy's
  cover contains a placeholder DOI, so the DOI was independently verified through the author
  publication page and bibliographic metadata.
- **Document type and lineage.** Empirical Android log analysis. It explicitly extends preliminary
  UbiComp 2014 and MoMM 2014 reports with a dataset about twice as large, more detailed analysis,
  and explicit locked/unlocked comparisons (cover note). It uses the Cambridge Device Analyzer
  dataset rather than Parry and Toth, UsageStatsManager, or a vendor Screen Time aggregate.
- **Group.** FHDW Paderborn, University of Münster, University of Applied Sciences Upper Austria,
  and Johannes Kepler University Linz (cover page). This is a Device Analyzer reuse/analysis group,
  not the original Cambridge collector team.
- **Access and reading status.** **Fully audited for the paper itself.** Author-hosted 21-page PDF
  read cover-to-references, including the paper's supplementary feature dictionary. The external
  Device Analyzer documentation, Picky system, and underlying dataset have not yet been audited as
  separate artifacts. Source: [author PDF](https://www.ins.jku.at/publications/2017/Hintze_2017_ACM.pdf),
  accessed 2026-08-29.
- **Instrument and raw source.** Device Analyzer stand-alone Android application, collecting 263
  periodically or event-triggered features (section 3.1). Snapshot
  `device_analyzer_full_20160516`, generated 2016-05-16 and accessed through Picky (footnote 3).
  Original pool: more than 225 billion records, 29,279 phones/tablets, at least 1,277 device types,
  468 manufacturers, and 175 countries (sections 3.1 and 5). No demographic variables were
  available because of the collector's privacy design.
- **Raw fields used for session construction.** `screen.power` on/off; `hf.locked` keyguard state;
  `phone.ringing`, `phone.calling`, `phone.offhook`, `phone.idle`, and
  `phone.keyguardremoved`/`ACTION_USER_PRESENT`; `shutdown`; `startup`; collection `pause`; and
  `system.settings.screenoff` (appendix A). The paper also uses anonymized GSM cell identifiers,
  Wi-Fi scans, display properties, device identifiers, locale, OS API/build, and collector version
  for context, form factor, and eligibility.
- **Timestamp representation and timezone.** Records have timestamps (section 3.4), but timestamp
  unit, precision, timezone normalization, clock-change handling, and source-order persistence are
  **not reported**.
- **Repeated timestamps and ordering.** Timestamp-only deduplication is **not reported**. The paper
  does not disclose a deterministic priority for different events sharing one timestamp, whether
  physical input order breaks ties, or whether ties can make the state machine ambiguous. These are
  consequential omissions because construction consumes screen, keyguard, call, startup, shutdown,
  and terminal-record events in one transition system (figure 3).
- **Concept being constructed.** A usage session is a consecutive period of direct interaction
  with the device (section 3.2). Locked and unlocked sessions are distinct; locked interaction can
  include checking time, notifications, incoming calls, or camera use without removing keyguard.
- **Why a state machine is used.** Simple foreground-app intervals cannot represent locked use, and
  naive screen-on/off pairing mistakes call-triggered screens and proximity-sensor screen changes
  for user sessions. The authors estimate 12.7% of smartphone screen-power changes are call-related
  (section 3.2).
- **Partition and sort.** Processing is necessarily device-specific, but the paper does **not
  report** its explicit partition keys, initial sort statement, stable-sort behavior, or behavior on
  records that arrive out of order.
- **Deduplication.** No row-identity definition, exact-duplicate rule, repeated-state collapse, or
  duplicate-event disposition is reported.
- **Initial and terminal states.** Figure 3 supplies a `first event` transition into the state
  machine and a `last event` exit, but the prose does not specify how the first state is inferred or
  whether a still-open session at the final record is emitted, censored, or discarded.
- **Screen/keyguard state machine.** A screen-on event while locked and display-off starts a locked
  session and an authentication stopwatch. `phone.keyguardremoved` ends that locked phase and starts
  an unlocked session while stopping the stopwatch. Screen-off or shutdown ends an active locked
  session and discards the unfinished stopwatch; screen-off or shutdown ends an unlocked session.
  These transitions are shown in figure 3, section 3.2.
- **Call handling.** Incoming ringing from locked/display-off enters a ringing state without opening
  ordinary use. If ringing becomes `offhook`, a locked session starts; if it returns to `idle`, the
  state returns without treating unanswered ringing as interaction. During an active call, screen
  on/off changes are self-transitions, preventing proximity-sensor toggles from fragmenting the
  call. On `idle`, the state returns to locked/display-on and starts the authentication stopwatch.
  In unlocked state, `ringing` or `calling` enters an unlocked-call state whose screen on/off events
  are likewise ignored; `idle` returns to unlocked (figure 3).
- **Same-app and app-switch behavior.** **Not applicable** to the reported session constructor: it
  constructs device-interaction sessions, not application episodes. Although the dataset contains
  obfuscated app-use information, identifiers cannot be compared across people or interpreted by
  purpose, so app-switch analysis is not performed (section 5).
- **Missing closer, orphan closer, repeated opener.** Apart from shutdown being accepted as a
  closer, these cases are **not reported**. Appendix A warns that shutdown messages may be absent
  after power failure and “should not” be relied upon, but the paper does not state what the
  constructor does when both an ordinary closer and shutdown are missing.
- **Startup/reboot.** `startup` is among the used features and initializes all sources (appendix A),
  but its exact transition/disposition is not visible in figure 3 or explained in prose. Reboot
  boundary behavior is therefore **not reported**.
- **Collection pauses, crashes, install/uninstall, and incomplete days.** Entire partially recorded
  days are discarded when incompleteness is attributable to crashes, collector installation or
  removal, or explicit recording pauses. This removes about 1 million of 2.1 million recorded days,
  47.4% (section 3.1). The exact calendar-day timezone is not reported.
- **Powered-off periods.** Days on which a device is powered for only part of the day are retained
  because this may be ordinary behavior (section 3.1). Day-level statistics then retain only days
  containing at least one valid usage session.
- **Device exclusions.** Exclude records from older collector versions missing required features;
  devices without any keyguard; devices configured to keep the screen on while charging; devices
  with fewer than seven valid days; and, for the main contextual analysis, devices without a
  detected home context (section 3.1). The first four restrictions exclude 17,253 of 29,279 devices
  and 1.3 million associated sessions; the home-context rule removes another 1,493 devices and
  2.7 million sessions. The final analyzed set is 10,533 devices (9,861 phones, 672 tablets) and
  52.2 million sessions.
- **Minimum, gap, and maximum duration.** No inactivity-gap threshold is used for session grouping,
  and no general minimum or maximum session duration is reported. Unlock-time analysis is a
  separate derived measure: screen-on to `USER_PRESENT`, restricted to durations at most 10 seconds,
  reducing 20.7 million candidate unlocks to 19.6 million (section 4.6). That bound must not be
  misrepresented as a usage-session cap.
- **Display timeout.** The configured timeout is not subtracted. The authors explicitly recognize
  that screen-on sessions include unattended timeout time and report mean configured timeouts of
  2.8 minutes on phones and 6.6 minutes on tablets (section 4.3). They treat this as measurement
  distortion, especially for short locked sessions, rather than repair it.
- **Overlap and multidevice use.** Sessions are device-based. The dataset cannot identify multiple
  devices owned by one person, so concurrent/multidevice use and user-level overlap cannot be
  resolved (section 5).
- **Day and context aggregation.** Per-device means and medians are calculated over observed days;
  grand mean is the mean of device means and grand median the median of device medians (opening of
  section 4). Weekly/hourly patterns are normalized within person to sum to one and then mapped to
  `[0,1]` across people (section 4.5). Exact interval splitting across hours, days, or contexts is
  **not reported**.
- **Context construction.** GSM cells are clustered using minimum circular subsequences with
  qualified-cell count `Q = 10` and cardinality threshold `S = 2`, inherited from Yang et al.; Wi-Fi
  places are clusters grown from the most frequent remaining access point and its co-occurring scan
  results (sections 3.4.1–3.4.2). Places visited more often than the person's average become
  meaningful. Office requires weekend/total visits `< 0.2` and weekday-work-hour/weekday visits
  `> 0.5`; home requires weekday-night/weekday visits `> 0.25` and weekday-nonwork/weekday visits
  `> 0.7`. Conflicting cell/Wi-Fi labels use the priority home, office, other meaningful, elsewhere
  (section 3.4.3). The assumed clock bands are home 00:00–06:00 and work 10:00–16:00 on weekdays.
- **Context validation.** Evaluated against an independently labeled Crowdsignals pilot. Excludes
  three people without detected home, five with fewer than one-quarter of the mean 757 labels per
  person, and three with implausible repeated labels, leaving 21. Reported balanced accuracy is 66%
  for home and 64% for office (section 3.4.4). The paper acknowledges label error and fuzzy context.
- **Form factor.** Tablet if computed screen diagonal is at least 7 inches; otherwise smartphone.
  The diagonal comes from reported resolution and pixel density (section 3.3).
- **Outputs.** Locked, unlocked, and overall session counts, session durations, daily use duration,
  unlock duration, context distributions, and diurnal patterns, stratified by phone/tablet and
  context (sections 4.2–4.6). Days without sessions are absent from day-based denominators, an
  explicit limitation (section 5).
- **Sensitivity and alternatives.** The paper contrasts foreground-app and screen-power approaches
  conceptually and validates context labels, but reports no alternate session state machine, event
  priority, missing-close policy, or timeout-correction sensitivity analysis.
- **Availability and rerunability.** Device Analyzer was described as publicly available through
  Picky and the exact snapshot is named. The paper does not link session-construction code or a
  machine-readable state-machine specification. Reproducibility is therefore **partial**: input
  identity and the main transition diagram are available, but several edge rules and implementation
  details are missing.
- **Known contradictions or count ambiguity.** Section 3.1 says the revised analyzed set contains
  52.2 million sessions; the conclusion says 56.3 million were extracted. The paper does not explain
  the difference. The safest interpretation is extraction before later filtering versus final
  analytic retention, but that is an inference and must not be reported as fact.
- **Unresolved follow-up.** Audit Device Analyzer documentation and schema versioning, Picky access,
  any released analysis code, the two 2014 precursor papers, and implementation details for event
  ties, startup, terminal censoring, duplicates, interval/context boundary splitting, and timezone.

### Ahmed and Ahmed (2023) — *A Fast and Minimal System to Identify Depression Using Smartphones: Explainable Machine Learning–Based Approach*

- **Identity.** Md Sabbir Ahmed and Nova Ahmed; *JMIR Formative Research* 7, e28848. DOI
  [10.2196/28848](https://doi.org/10.2196/28848); submitted 2022-12-26, revised 2023-03-17,
  accepted 2023-03-19, published 2023-08-10.
- **Document type and lineage.** Empirical Android `UsageStatsManager` study and collection-tool
  evaluation. The session threshold is inherited from van Berkel et al. (2016), after discussing
  30-, 40-, and 60-second alternatives. It does not start from Parry and Toth. Böhmer, Carrascal,
  Soikkeli, Banovic, Ferreira, Wang/Mark, Lyngs, Cheng, and van Berkel are explicit method ancestors
  (App Usage Sessions and references 55–63).
- **Group and setting.** Design Inclusion and Access Lab, North South University, Dhaka,
  Bangladesh. Snowball sample collected July–October 2020: 100 students from 12 institutions,
  seven departments, 36 districts, and seven divisions; age 19–30, 87 men and 13 women
  (Data Collection).
- **Access and reading status.** **Fully audited for the final article and supplied appendix.** The
  complete open-access HTML, all references, the linked 11-page DOCX appendix, and the current
  Google Play listing were read. The appendix was also rendered and visually inspected page by
  page. The 2022 preprint has not yet been diffed against the final version. Sources:
  [final article](https://formative.jmir.org/2023/1/e28848),
  [appendix](https://www.jmir.org/api/download?alt_name=formative_v7i1e28848_app1.docx&filename=96faf5d34a0c02b300c07ffb4b0acc19.docx),
  and [app listing](https://play.google.com/store/apps/details?id=net.mn.u), accessed 2026-08-29.
- **Collector.** Mon Majhi Android app invokes functions of Java `UsageStatsManager` to retrieve
  past-seven-day raw foreground/background app events after consent, then sends study data to
  Firebase (Development of a Data Collection Tool). The exact query call, API minimum/target,
  application version/build, permissions, event constants, output schema, and query bounds are not
  reported.
- **Why seven days.** The authors state that raw usage events persist only for a few days. They
  found `queryUsageStats` aggregates beyond seven days inaccurate under weekly/monthly interval
  tests and manual comparisons; aggregates also lack launches and raw events. They therefore use
  the raw seven-day window (Development, lines 139–144 of the web article). Exact test traces,
  errors, devices, and ground-truth protocol for this conclusion are not supplied.
- **Retrieval validation.** Three checks: manual duration/launch calculation; comparison with two
  background-running Play Store apps; and testing on nine different smartphones. Performance was
  separately tested by 500 retrievals on each of 20 phones (19 models, eight Android versions,
  seven manufacturers), 10,000 runs total. Mean retrieval was 7,447.61 events in 307.94 ms; 97
  runs exceeded one second, itemized by phone in appendix table A.1. The paper reports success but
  no event-level confusion matrix, tolerance, mismatch count, or reproducible fixture.
- **Study input.** 817,404 foreground/background events involving 1,129 package names; mean
  8,174.2 events per person, median 7,849, range 70–29,113 (Feature Extraction). Package name,
  event time, and foreground/background status are implied, but complete row fields and timestamp
  representation are not disclosed.
- **Partition, sort, and clock.** Participant/phone partition is implied. Sorting, stable input
  order, timezone conversion, timestamp precision, clock changes, DST, query-bound inclusivity,
  and out-of-order repair are **not reported**. The current post-study app listing says it collects
  phone timezone, but that cannot be assumed for the 2020 study build.
- **Deduplication and equal-time events.** No row identity, duplicate-event removal, repeated-state
  collapse, type priority, source-order tiebreak, or same-timestamp behavior is reported. No
  microsecond separation is described. Thus, the study cannot answer which foreground/background
  event wins when several apps change state at one recorded instant.
- **App-episode construction.** The article claims to calculate duration and launch frequency from
  foreground/background events but never says which event constants open/close an app, how events
  are paired, or how it handles resumed/paused/stopped variants. Missing closer, orphan closer,
  repeated opener, same-app reopen, app switch, overlapping foreground claims, shutdown/reboot,
  logger gaps, system restarts, and final-tail censoring are all **not reported**. The appendix adds
  feature lists, not this missing transformation.
- **Device-session grouping.** Because lock/unlock data are unavailable, consecutive app use is
  placed in one session when the gap from the last used app to the newly opened app is no more than
  45 seconds (App Usage Sessions). This is an inactivity gap applied after an undisclosed app-
  interval constructor. Whether the comparison is `<=45 s` at exact precision, and whether the gap
  uses prior background time to next foreground time, is not specified beyond the prose.
- **Threshold provenance.** Wang and Mark provide a median 40-second Facebook break; Lyngs and
  Cheng use 60 seconds; Böhmer, Carrascal, and Soikkeli use 30 seconds. The authors reject 30 seconds
  as less accurate and select van Berkel et al.'s proposed 45 seconds. This is a declared citation-
  inherited threshold, not a parameter estimated on the study data.
- **Session-length labels.** `microsession`: at most 15 seconds; `review`: described as 15–60
  seconds after accounting for microuse; `engage`: more than 60 seconds (App Usage Sessions).
  Provenance is Ferreira for 15 seconds and Banovic for 60 seconds. Exact equality at 15 seconds is
  ambiguous because “maximum 15” overlaps “between 15 and 60”; 60 belongs to review under the
  stated `>60` engage rule. Wording alternates between time “on an app” and session time, leaving
  unclear whether classification uses total multi-app session duration or an individual app
  episode.
- **Minimum/maximum/disposition.** No minimum retained duration, maximum duration, cap,
  truncation, deletion, or impossible-duration rule is reported. No sensitivity is run across the
  30/40/45/60-second grouping choices or the 15/60-second labels.
- **Diurnal splitting.** Each app interval crossing a period boundary is split in duration; its
  launch count remains in the period where it opened. Four nominal six-hour periods are night
  00:01–06:00, morning 06:01–12:00, afternoon 12:01–18:00, and evening 18:01–24:00
  (Diurnal Usage Data). The example splits 11:30–12:20 at 12:00. If the printed minute labels are
  literal they leave uncovered seconds at every `HH:00`; boundary inclusivity and subminute
  behavior are not specified. Midnight-crossing and timezone-change behavior are not reported.
- **Weekday/weekend aggregation.** Weekdays and weekends are kept as separate features; whole-day
  totals and mean/SD across the four periods are computed. The paper does not define locale-specific
  weekend days, partial first/last days, missing days, or denominator treatment.
- **Package identity and categories.** Unique apps are counted by package, because 127 of 1,129
  applications share display names. Categories are scraped from Google Play; absent apps are
  researched in other stores and developer sites. Two computer-science graduates categorize;
  disagreements add two more students and use majority vote. Game subcategories collapse to
  Games; Zoom/Meet are assigned Education because participants were students during pandemic
  remote teaching (Usage Data of App Categories).
- **Launcher/system/unknown treatment.** They are not filtered from the raw usage account.
  Appendix table C.1 explicitly lists 13 “Launcher Like App” packages and 11 Unknown packages as
  categories; table C.2 contains Launcher duration, launch, entropy, and app-count features. No
  operating-system package list, foreground-service filter, browser-internal attribution, or
  outside-app denominator is defined.
- **Feature sparsity filter.** Theoretical extraction is 864 features: 28 app/category levels
  (27 categories plus smartphone overall) × weekday/weekend × five core measures × whole-day/
  period mean/period SD, plus overall session features. Any feature whose percentage of users is
  below 50% is removed, leaving 219 for feature selection (Calculation of Extracted Features and
  appendix table C.2). The precise numerator/denominator for percentage of users is the 100-person
  sample; zero-versus-missing distinction is not described.
- **Outputs relevant here.** Per-app/category duration, launch frequency, number of unique apps,
  entropy, Hamming-distance ratio, total session count, and micro/review/engage session counts,
  crossed with weekday/weekend and whole-day/diurnal summaries. The appendix lists all 219 retained
  feature names and all app-category counts.
- **Analysis preprocessing.** Standard scaling; four feature-selection families; stable selection
  over 1,000 bootstrap samples with threshold swept from 0.50 by 0.01 until no features remain;
  nested leave-one-participant-out outer validation and stratified 20-fold inner validation;
  Bayesian hyperparameter optimization; random state 1234 in appendix table D.1. These are recorded
  here so that upstream and analysis preprocessing are not conflated.
- **Availability and rerunability.** The final paper and appendix are CC BY 4.0. The app remains
  listed in Google Play, but source code, exact study APK/build, raw/processed study data,
  preprocessing scripts, package-category mapping, and trained models are not linked. Exact event-
  to-duration or duration-to-session replay is therefore impossible from the publication.
- **Version drift in live app.** The current Play listing, updated 2023-02-25, says the app collects
  past-one-year app usage, phone/API/timezone/device identifiers, and more subjective data. The
  paper describes a seven-day 2020 study build and says no data other than app usage were collected
  in that study. These are different time/version claims; the live listing must not be used to
  silently fill study-method fields.
- **Reported limitations.** Small `N=100`, male-skewed sample, pandemic recruitment, and need for
  larger real-world evaluation. The paper does not acknowledge its missing event-pairing rule,
  tie handling, interval error rules, ambiguous 15-second boundary, or nominal diurnal gaps.
- **Unresolved follow-up.** Diff the preprint; locate the exact 2020 APK or source revision; request
  the foreground/background pairing code and category map; identify event constants/API versions;
  reproduce the 45-second boundary and diurnal split; verify whether the current one-year retrieval
  uses aggregates or a different storage strategy.

### Hsu et al. (2025) — *PULSE: A Screenshot-Based Labeling Tool for Investigating Smartphone Behavior, Intent, and Perception*

- **Identity.** Je-Wei Hsu, Ching-Ting Lin, Uei-Dar Chen, Jui-Ching Kuo, Jui-Chun Liu, Yong-Han
  Lin, Chen-Ya Chen, Razieh Pourafshari, Yifei Lu, Joseph Bayer, and Yung-Ju Chang; *UbiComp
  Companion 2025*, 201–205. DOI [10.1145/3714394.3754395](https://doi.org/10.1145/3714394.3754395).
- **Document type and lineage.** Five-page Android research-tool paper plus a 14-day field case
  study. The session definition and 30-second threshold are inherited from Böhmer et al. (2011)
  and Morrison et al. (2018). Duration-bin design additionally cites Banovic et al. (2014), Beierle
  et al. (2020), and Yan et al. (2012). It does not start from Parry and Toth.
- **Group.** National Yang Ming Chiao Tung University, National Tsing Hua University, and Ohio
  State University. This is a screenshot/accessibility-event research line, distinct from Device
  Analyzer and retrospective `UsageStatsManager` studies.
- **Access and reading status.** **Fully audited for the published paper.** Author-hosted five-page
  PDF read cover-to-references. No supplement, data, app binary, protocol, or code repository is
  linked, and targeted title/author/GitHub searches found none. Source:
  [author PDF](https://people.cs.nycu.edu.tw/~armuro/pubs/hsu-et-al-2025-ubicomp.pdf), accessed
  2026-08-29.
- **Collector.** PULSE (Phone Use Labeling via ScrEenshot), an Android research app combining
  screenshots, passive sensors, Accessibility Service interaction events, micro-ESM, on-device
  retrospective labeling, and researcher-configurable settings (sections 2–2.3).
- **Sampling frame.** Screenshots and sensor observations are captured every one second, by default
  between 08:00 and 23:00, with a user-adjustable collection window that must span at least 12
  hours. No screenshots are taken while the screen is off or PULSE itself is foregrounded
  (section 2.1). Timezone, exact interval-boundary inclusion, missed-tick behavior, scheduling drift,
  and clock changes are not reported.
- **Raw observations.** Screenshots; app usage; transportation mode; network state; screen on/off;
  notification interactions; and Accessibility Service click, scroll, hover, select, and text-input
  events (section 2.1). Android API versions for the collector, raw schema, event constants, event
  timestamps, timestamp precision, source order, and event-delivery-loss behavior are not reported.
- **Partition, sort, duplicates, and equal time.** Participant/device partition and chronological
  display are stated. Explicit input sort, stable tie ordering, event priority, row identity,
  screenshot/event deduplication, and treatment of different events at the same instant are **not
  reported**. There is no microsecond tie separation.
- **Session definition.** A session is a continuous segment of phone use. It terminates when
  (1) the screen remains off for more than 30 seconds, (2) no interaction is detected for 30
  seconds, or (3) the user enters PULSE (section 2.2). The paper does not state whether a screen-off
  or inactivity closer is placed at the start of the gap, at 30 seconds, or at the next observation.
- **Threshold equality.** Screen-off explicitly uses `>30 s`; the inactivity prose says no
  interaction “within 30 seconds,” leaving exact-30-second behavior less clear. It is not reported
  which termination wins when conditions coincide, or whether a short screen-off interval can
  survive the separate no-interaction condition and remain within one session.
- **Opener and state transitions.** The paper defines only termination conditions. It does not say
  exactly which screen-on or interaction event opens a session, whether opening is at screen-on or
  first post-on interaction, how a session resumes after an off interval no longer than 30 seconds,
  or how entry/exit from PULSE affects the following opener.
- **Missing/repeated boundaries.** Missing screen-off, missing interactions, repeated on/off,
  startup, reboot, shutdown, Accessibility Service restart, collector pause, final tail, and orphan
  boundaries are not specified. Calls, lock/keyguard, always-on display, picture-in-picture,
  split-screen, overlapping apps, and notifications without interaction are not mapped to state
  transitions.
- **Session-parameter mutability.** Researcher mode can change period/session segmentation and
  other study parameters (section 2.3.3). The paper does not enumerate allowed values, persist a
  configuration receipt, or state whether every case-study participant used one identical frozen
  configuration.
- **Daily period segmentation.** The customized collection window is automatically divided into
  five periods for labeling prompts (section 2.2). Exact boundaries, rounding, partial periods,
  midnight behavior, and response-window overlap are not reported. Participants have up to six
  hours after a prompt to label.
- **Duration strata and sampling.** Sessions are binned as `0–5`, `5–30`, `30–60`, `60–180`,
  `180–300`, and `300+` seconds. In the case study at most two sessions are sampled per bin per
  period: 12 per period and 60 per participant/day (section 2.2). Mathematical inclusivity at 5,
  30, 60, 180, and 300 seconds is not specified; the selection procedure within an over-quota bin
  and random seed are not reported.
- **Screenshot similarity processing.** Consecutive near-identical screenshots are stacked for the
  labeling interface using perceptual similarity (Zauner 2010) to reduce scrolling. The perceptual
  hash, distance, threshold, comparator, whether stacking changes analytic rows or only display,
  and treatment of a stack spanning a session boundary are not reported. Researcher mode makes the
  threshold configurable (sections 2.2–2.3.3).
- **Human labeling.** Within a displayed session, participants tap first and last screenshots, then
  assign usage intent, perceived urgency, time evaluation, and goal/habit orientation. Labels can
  be applied in any order. The UI pauses scrolling near session boundaries after pilot users were
  observed overlooking breaks (section 2.2). Inter-rater reliability is not applicable, but no
  relabeling reliability, recall-validation, or disagreement protocol is reported.
- **Micro-ESM transitions.** Up to 15 prompts/day, at least one hour apart, triggered at session
  start, immediately after session end, or app switch (section 2.3.2). Trigger collision priority,
  sampling across the three trigger types, app-switch construction, and dismissed/missed-prompt
  handling are not reported.
- **Privacy and missingness.** Screenshots remain on-device until explicit upload approval.
  Participants may withhold individual screenshots, pause/disable capture or upload, and delete
  collected data (section 2.3.1). The paper does not encode these different absence causes in the
  analytic missingness account.
- **Eligibility and attrition.** Adults using Android 10–14; excluded incompatible brands; required
  10 GB storage and daily network access. Of 32 enrolled, one withdrew before collection, two could
  not finish because of phone issues, and four were removed for low procedural compliance, leaving
  25 (11 men, 14 women, ages 24–57). The incompatible brands and low-compliance threshold are not
  named (section 3.1).
- **Study procedure.** Fourteen days. Participants were oriented, trained with a test prompt,
  expected to label every visible screenshot daily, remotely monitored, contacted on data issues,
  and compensated after successful completion (section 3.2). “Successful” completion beyond the
  later low-compliance exclusion is not quantified.
- **Cleaning and denominators.** 23,799 sessions detected; 12,161 (51.5%) sampled; after unspecified
  “data cleaning and noise removing,” 21,645 sessions are said to enter final analysis. Separately,
  3,129,445 screenshots were collected; 1,762,028 (56.3%) sampled; screenshots missing any of four
  labels, marked inactive use, or intent `other` were excluded, leaving 1,649,936 (93.6% of sampled)
  (section 3.3). The paper does not reconcile why final session count exceeds sampled session count
  or define session-level versus screenshot-level denominators.
- **Noise definition.** Beyond screenshot exclusion conditions, “noise” is not operationalized.
  No rule is given for blank/system/permission screens, notification shade, keyboards, sensitive-
  screenshot deletion, failed image capture, duplicate images, or partially labeled sessions.
- **Outputs.** Counts and screenshot-time shares by intent and perceived time value. Because capture
  is nominally one screenshot/second, screenshot counts are interpreted as duration, but missing
  ticks, stacked screenshots, user deletions, and irregular sampling are not reconciled with that
  duration interpretation.
- **Sensitivity and validation.** No alternate 30-second threshold, end-placement policy, duration-
  bin edge, similarity threshold, missingness rule, or session sampler is evaluated. Pilot
  observation motivated a UI boundary cue, but event-derived sessions are not validated against
  continuous observation or user-marked true boundaries.
- **Availability and rerunability.** Paper is accessible; collector, configuration, screenshots,
  event stream, labels, code, and preprocessing scripts are not linked. The upstream construction
  is only partly rerunnable from prose and is not source-exact.
- **Forward lineage.** Author metadata identifies a 2026 follow-up, *Does Longer Phone Use Always
  Feel Worse? Examining How Intention and Duration Shape Evaluations of Time Use* (DOI
  `10.1145/3772318.3790925`), which must be audited as a distinct analysis/version of the PULSE
  dataset rather than counted as an independent collector until its methods are read.
- **Unresolved follow-up.** Obtain collector/configuration code or study APK; read the 2026
  follow-up; recover exact opener/end-placement/tie rules; reconcile session denominators; obtain
  compatibility, compliance, noise, missingness, and within-bin sampling rules.

## Main-text-complete records with version or artifact blockers

### Zhu, Chen, Peng, Liu, and Dai (2018) — *How to Measure Sessions of Mobile Phone Use? Quantification, Evaluation, and Applications*

- **Identity.** Jonathan J. H. Zhu, Hexin Chen, Tai-Quan Peng, Xiao Fan Liu, and Haixing Dai;
  *Mobile Media & Communication* 6(2), 215–232. DOI
  [10.1177/2050157917748351](https://doi.org/10.1177/2050157917748351). The accessible author
  preprint says “mobile device” in the title; the version of record says “mobile phone.”
- **Document type and lineage.** Empirical secondary analysis and methodological proposal using the
  Cambridge Device Analyzer data. It does not start from Parry and Toth. It contrasts inherited
  inactivity-gap approaches (Böhmer: 30 seconds; Van Canneyt: 10 seconds) with screen-based
  approaches, then supplies its own unlock-to-screen-off constructor (Previous Studies and Method).
- **Group.** City University of Hong Kong Web Mining Lab, Michigan State University, and Southeast
  University (preprint cover). This is independent of the Hintze group but reuses the same broad
  Cambridge data source.
- **Access and reading status.** **Main text read, final-version comparison blocked.** The complete
  17-page author preprint, including references and both appendices, was read. The Sage version of
  record is paywalled; its metadata and references were checked, but its full body could not be
  compared. No supplement or code repository is named in the preprint. Sources:
  [author preprint](https://arxiv.org/abs/1711.09408) and
  [version-of-record metadata](https://journals.sagepub.com/doi/10.1177/2050157917748351), accessed
  2026-08-29.
- **Instrument and sample.** Device Analyzer Android logs from volunteer installations between
  December 2010 and February 2016. More than 31,000 users were in the source; analysis retains
  4,017 “active” users with valid records on at least 10 days, median 130 days (Method/Data). The
  paper does not define a valid record/day, list the collector version, identify a Device Analyzer
  snapshot, or report the device/OS distribution, geography, or exact attrition sequence.
- **Raw observations.** The paper says the data contain millisecond start/end times for calls,
  messages, and apps, plus screen and keyguard events. Construction uses textual event matches for
  `screen_on`, `keyguard_removed`, `screen_off`, and `shutdown` (Method/Session Construction and
  appendix 1). Raw schema, event field names beyond these strings, logging cadence, and versioned
  semantics are not reported.
- **Timestamp, timezone, and order.** Millisecond timestamps are reported. Timezone, clock source,
  DST/clock-change treatment, row-order guarantee, explicit sorting, and out-of-order repair are
  **not reported**. Appendix 2 discards calendar date only for downstream clustering, retaining the
  time-of-day hour/minute/second; it does not say whether fractional seconds enter clustering.
- **Repeated timestamps and duplicates.** No deduplication identity or disposition is reported.
  Different event types at the same millisecond, stable tie order, and equal-boundary behavior are
  not discussed. The line-by-line constructor makes row order consequential, so this omission is
  not harmless.
- **Session concept.** A session is a continuous uninterrupted sequence of user-initiated tasks on
  the phone. The selected operationalization is deliberately multi-app: begin when the screen is
  unlocked and end when it is locked/off or the device shuts down (Research Questions and
  Session Construction). Machine-activated tasks are excluded indirectly by requiring a user
  unlock; individual foreground intervals are not reconstructed.
- **Declared algorithm.** For each user, iterate through log lines. Seek `screen_on`; then seek
  `keyguard_removed`; after successful unlock, seek `screen_off` or `shutdown`; write the unlock row
  as session start and the closer row as session end; reset all three flags (appendix 1). Output is
  one row per session with user ID, session ID, start, and end.
- **Critical pseudocode behavior.** As printed, the loop resets `screenon = False` whenever the
  first line inspected after `screen_on` is not `keyguard_removed`. It therefore accepts an unlock
  only if `keyguard_removed` immediately follows the chosen screen-on row in the iterated input.
  The prose does not say that inputs were prefiltered to make those events adjacent. This is either
  a material algorithm rule or underspecified pseudocode; it cannot safely be simplified to “pair
  every screen-on with the next unlock.”
- **Opener and closer semantics.** The output begins at `keyguard_removed`, not at `screen_on`;
  screen-on is a prerequisite/wake marker. The closer is `screen_off` or `shutdown`. Although the
  prose sometimes says screen “locking,” the pseudocode does not match a keyguard-engaged event.
  Automatic timeout and manual screen-off are therefore observationally combined.
- **Initial state and partition.** Iteration is stated to occur separately “for each user.” No
  device-within-user partition is defined, and the data apparently cannot identify cross-device
  ownership. Initial state is all flags false. A log beginning while already unlocked produces no
  session until a later screen-on/unlock sequence.
- **Missing and repeated boundaries.** Pre-unlock screen-off, shutdown, calls, arbitrary events, and
  end-of-file behavior are not explicitly handled. From the printed pseudocode, any non-adjacent
  unlock abandons the candidate screen-on; after unlock, all noncloser rows are skipped until a
  `screen_off`/`shutdown`; an open final session is not written. Orphan closers are ignored while no
  unlocked session is active. Repeated screen-on, repeated unlock, reboot/startup, and logger-pause
  behavior are **not reported**.
- **Calls and parallel foreground apps.** Unlike Hintze et al., the constructor has no call-state
  handling. The authors report that multiple apps can appear simultaneously foregrounded and say
  this makes single-app sessions impossible; all calls, messages, and apps between unlock and
  closer are treated as one multi-app device session. App overlap is therefore absorbed rather
  than repaired.
- **Foreground/background and app filters.** No application reconstruction, launcher/system-app
  filter, package categorization, or background-process rule is applied. The unlock requirement is
  intended to exclude machine-operated tasks, but the paper does not validate that assumption.
- **Gap, minimum, and maximum rules.** The chosen constructor has no inactivity-gap threshold and
  reports no minimum or maximum session duration, deletion, cap, truncation, or imputation. The
  article criticizes the 30-second and 10-second thresholds in prior work as arbitrary; those are
  comparator methods, not its parameters.
- **Day boundary and interval splitting.** Results are summarized per user per day, but the paper
  does not state how a session crossing midnight is assigned or split. A maximum daily total of
  2,680 minutes—greater than 24 hours—is reported in table 1 without explanation. That value could
  reflect overlapping sessions, assignment, duplication, or another issue; the cause is unresolved.
- **Session output.** The constructor identifies 18.2 million sessions. Reported per-user/day means
  and medians are 24/18 sessions, 17/4 minutes per session, and 175/97 minutes total use (table 1).
  The paper says 4,533 mean and 3,008 median sessions per user were supplied to clustering and
  reports 51,636 session clusters (Results).
- **Clustering construction.** Sessions become nodes within a user; inverse Euclidean distance in
  start and end time-of-day becomes the edge weight. Calendar date is discarded so behavior is
  treated as 24-hour cyclic (appendix 2). Louvain detection yields within-user session clusters;
  cluster centroids then feed a second Louvain procedure producing user communities. The equation
  and midnight example are not fully consistent: ordinary Euclidean distance on clock values makes
  00:01 and 23:59 far apart unless a circular-distance transform is added, but no such transform is
  written. This contradiction remains unresolved.
- **Cluster exclusions.** More than 22,000 sessions (0.12%) cannot be assigned to a cluster because
  they deviate strongly from the user's daily rhythm; the exact numerical rejection criterion is
  not reported. Two user communities containing two users each are removed from later analysis
  because of small size (Quality of Clusters and Communities).
- **Fragmentation-analysis inclusion.** For a separate three-month trend analysis, retain users with
  records on at least 10 days per month for three consecutive months, producing more than 3,100
  people. Regress daily session count on calendar day separately by person (Applications).
- **Validation.** External validity is an informal comparison with five heterogeneous studies; no
  significance test is possible. Discriminant validity uses a multilevel regression of daily total
  time on daily session count, controlling/weighting by active days, on raw and log-transformed
  values. Cluster/community modularity is also reported. None validates event-level boundaries
  against observed human interaction.
- **Sensitivity.** No alternate opener/closer, adjacency, missing-close, tie-order, boundary, or
  day-splitting analysis is run. Raw versus log-transformed regression is an analysis sensitivity,
  not a preprocessing sensitivity.
- **Availability and rerunability.** The broad Device Analyzer source is described as open, but no
  exact snapshot, extraction query, raw input subset, executable code, environment, or license is
  supplied. Appendix 1 is useful but insufficient for exact replay because input filtering/order
  and multiple edge cases are unstated. Rerunability is **partial to low**.
- **Reported limitations.** Convenience volunteer sample; multi-app rather than single-app
  sessions because app information is insufficient; unsupervised clustering requires cautious
  interpretation (Conclusion). The paper does not list the pseudocode adjacency, >24-hour daily
  total, time-of-day distance, event-tie, or censoring issues identified above.
- **Unresolved follow-up.** Obtain and compare the final Sage body; inspect Device Analyzer query
  and schema artifacts if preserved; ask whether the constructor input was event-filtered before
  appendix 1; resolve circular-time distance; determine how >24-hour user-days arose; locate any
  unlinked code/data deposit.

## Fully audited records — continued

### Harbach et al. (2014) — screen/keyguard state logging in the wild

- **Identity.** Harbach, M., von Zezschwitz, E., Fichtner, A., De Luca, A., and Smith, M. (2014),
  “It’s a Hard Lock Life: A Field Study of Smartphone (Un)Locking Behavior and Risk Perception,”
  *10th Symposium on Usable Privacy and Security (SOUPS 2014)*, pp. 213–230. Canonical DOI-free key
  `usenix-soups2014-harbach`; the sometimes-associated `10.5555/3235838.3235857` does not resolve and
  is not treated as a DOI.
- **Lineage and group.** Independent German usable-security collaboration across Leibniz University
  Hannover, LMU Munich, and University of Bonn. It predates Parry and Toth and does not inherit their
  method. A separate online survey precedes the Android field study; only the field logger constructs
  device-use intervals.
- **Access and reading status.** **Fully audited.** All 18 pages of the USENIX paper were read,
  including the complete references; online-survey questionnaire and codeplans; both field-study
  mini-questionnaires; and sampling overview. Searches of the official page, author/title, and GitHub
  surfaced no code or dataset. Sources: [USENIX paper page](https://www.usenix.org/biblio/it%E2%80%99s-hard-lock-life-field-study-smartphone-unlocking-behavior-and-risk-perception)
  and [official PDF](https://www.usenix.org/system/files/conference/soups2014/soups14-paper-harbach.pdf),
  accessed 2026-08-29.
- **Study components.** An MTurk survey retained 260 of 320 responses after smartphone, timing, and
  attention checks. A focus group (`n=7`) informed the field protocol. The four-week field study
  recruited 57 Android users in Hannover and Munich in January 2014; 52 entered analysis.
- **Field attrition and devices.** One person was removed for missing debriefing, three for repeatedly
  changing phone time, and one because the logger failed for several days after not restarting on
  reboot. Eligibility required Android 2.3 or later and at least three months’ smartphone use.
  Participants were 19–32 (median 23), 23 women/29 men, mostly students. Device models, exact OS
  versions, app version/build, and lock-delay settings are not reported.
- **Instrument.** A custom permission-free Android app monitored `SCREEN_ON` and `SCREEN_OFF`
  intents plus `KeyguardManager` state. It timestamped entry into each modeled state and uploaded
  logs to the study server when connected to Wi-Fi. No source, binary, raw schema, example record,
  polling/callback details, persistence mechanism, upload retry policy, or validation trace is given.
- **Declared state machine.** Four states are printed: `OFF LOCKED`, `OFF UNLOCKED`, `ON LOCKED`, and
  `ON UNLOCKED`. Hardware-button/automatic-off transitions switch `ON *` and `OFF *`; screen-on may
  enter the locked or unlocked on-state; dismissing keyguard moves `ON LOCKED` to `ON UNLOCKED`;
  lock activation moves an unlocked state to its locked counterpart immediately or after the user’s
  configured delay; “screen off and lock” is another transition to the locked state. Timestamps are
  logged on state entry.
- **Device session and unlock.** A session is explicitly `SCREEN_ON` through `SCREEN_OFF`. An
  activation is a switch to screen on. An unlock is dismissal of the lock screen after activation,
  operationalized by transition from `ON LOCKED` to `ON UNLOCKED`; sessions that reached the home
  screen are contrasted with screen-on episodes that never unlocked. Unlock time is the interval
  between those on-locked and on-unlocked transitions.
- **Initial state and event processing.** The initial state at app installation/start, how broadcast
  and keyguard observations are combined, whether state is restored after process death, and what
  happens when an expected transition is absent are not reported. The observed reboot failure shows
  that logger lifecycle materially affected coverage, but only the participant-level exclusion is
  described.
- **Timestamp, timezone, and order.** Timestamp unit/precision, clock API, timezone, explicit sorting,
  and equal-time priority are not stated. Repeated manual device-time changes triggered removal of
  three participants, but no magnitude criterion or clock-anomaly detector is documented. DST,
  backward/forward jumps short of that exclusion, out-of-order upload, and server/device clock
  reconciliation are not addressed.
- **Duplicates and anomalous transitions.** No duplicate identity/disposition, repeated event rule,
  distinct same-instant event ordering, debounce, orphan transition, missing screen-off, reboot
  close, end-of-file close, or duration plausibility rule is reported. There is no minimum, maximum,
  gap merge, cap, truncation, or imputation.
- **Calendar and completeness.** Participants contributed 29.5 days on average. Every person was
  normalized to 27 complete midnight-to-midnight days by removing initial hours and all remaining
  days. The time zone defining midnight, handling of travel or clock changes, exact choice of which
  27-day span, intermediate incomplete-day detection, and sessions crossing midnight are not stated.
  Per-user aggregation precedes averaging across users to avoid overweighting heavy users.
- **Logged output.** Across each retained 27-day window, mean activations per person were 2,242.3
  (83.3/day), and mean unlocks were 1,286.0 (47.8/day). A screen-on/off session averaged 70.3 s;
  sessions reaching the home screen averaged 104.1 s (median 45.6), while non-unlocked sessions
  averaged 12.4 s (median 5.2). Mean total screen-on time was 43.0 h, including 2.9 h on a locked
  device. No count of raw state rows, malformed sequences, repaired events, or discarded sessions
  is given.
- **Unlock-time interpretation.** Mean raw unlock time was 2.67 s without a code, 3.0 s for patterns,
  and 4.7 s for PINs. The authors explicitly call it a worst-case/upper-limit estimate because users
  can inspect the clock or notifications before dismissing the keyguard. Thus it is not a clean
  authentication-motor-time measure.
- **ESM sampling.** One of two questionnaires was offered after a sampled unlock, initially with 20%
  probability and at most hourly. After week one, people with at least nine unlocks/hour were reduced
  to 10%, and those with four–eight to 15%, targeting five–six prompts/day. “Not Now” permitted
  immediate dismissal. The study obtained 3,410 completed unlock-risk and 3,172 data-risk forms.
  The exact random generator, denominator of eligible unlocks, nonresponse count, and linkage
  tolerance between an unlock and response are not reported.
- **Validation.** The four-state diagram makes the conceptual model inspectable, and debriefing asked
  whether logs and samples represented participants’ behavior/perception. It is not event-level
  ground-truth validation: no external video, instrumented reference phone, second logger, or labeled
  trace tests the inferred transitions or durations.
- **Sensitivity.** No alternate session boundary, keyguard interpretation, clock-repair policy,
  missing-transition policy, midnight rule, logger-coverage rule, or duration filter is tested.
  Lock-type and heavy/regular-user comparisons concern analysis, not preprocessing.
- **Author-reported limitations.** Survey self-report; different and nonrepresentative field sample;
  rare/brief/extreme situations under-sampled or dismissed; prompts may heighten risk awareness;
  Android exposed only certain events; unlock duration includes notification/clock viewing; and
  subjective environment/sensitivity/attack judgments vary. The paper does not name event ties,
  duplicates, state initialization, missing boundaries, or midnight splitting as limitations.
- **Availability and rerunability.** The paper and questionnaires are open; event data, survey data,
  codeplans are printed but the final coded data are not released. Logger code/binary, raw schema,
  analysis code, environment, and licensing are absent. The four-state figure narrows the possible
  implementation substantially but does not make it exactly replayable. Rerunability is **partial-low**.
- **Unresolved follow-up.** Contact authors for logger and raw schema; determine broadcast and
  keyguard callback logic, state initialization/persistence, same-time ordering, clock-change and
  reboot handling, midnight/session partitioning, incomplete-day rules, and whether later “Anatomy
  of Smartphone Unlocking” work reused or documented this collector more fully.

### Aharony et al. (2011) and the recovered Funf/Funf-in-a-Box implementation

- **Why this lineage item is here.** Nadav Aharony, Wei Pan, Cory Ip, Inas Khayal, and Alex
  Pentland, “Social fMRI: Investigating and Shaping Social Mechanisms in the Real World,”
  *Pervasive and Mobile Computing* 7(6), 643–659, DOI
  [10.1016/j.pmcj.2011.09.004](https://doi.org/10.1016/j.pmcj.2011.09.004), is the paper Andrews
  et al. cite for Funf-in-a-Box. It is not a phone-session paper and does not define the later
  Andrews interval constructor; it documents the sensing framework from which their event stream
  came. **Fully audited:** all 18 pages, tables, figures, conclusions, and 46 references of the
  [author copy](https://dam-prod.media.mit.edu/x/files/tech-reports/TR-677.pdf), plus the complete
  relevant histories and source paths in the public `funf-core-android`, `funf-inabox`, and
  `funf-scripts` repositories, the shipped Funf 0.4.2 JAR bytecode, and the packaged raw processing
  scripts. Accessed 2026-08-29. The paper PDF SHA-256 is
  `0092f120aac10a8c925b9b34afc07ee8571c6178cf99471a0bfb212be52fe3d3`.
- **What the framework paper says.** The Friends and Family deployment began with 55 participants
  in March 2010 and expanded to 130 in September 2010. Its phone platform collected more than 25
  signals. Screen state was opportunistic and “triggered on state change (on/off)”; the text explains
  that opportunistic probes listened for Android broadcasts. Phone data were held in SQLite files
  rotated every three hours, uploaded when connectivity returned, backed up encrypted on-device,
  and inserted by a server back end into MySQL. The phone periodically recorded its Funf version,
  probe configuration, OS version, and timezone. None of those deployment records, the MySQL
  importer, or the Friends and Family screen events are released with the paper. The paper does not
  discuss turning screen-state changes into sessions, same-time ordering, duplicates, missing
  boundaries, or calendar allocation.
- **Official ScreenProbe behavior.** The public core history traces `ScreenProbe.java` to the initial
  2011-06-17 library commit. Across the tagged 0.4.0, 0.4.1, and 0.4.2 versions, it dynamically
  registers one receiver for `Intent.ACTION_SCREEN_ON` and `Intent.ACTION_SCREEN_OFF`; it emits
  `screenOn=true` for the former and `false` for the latter. Android documents these historically
  named broadcasts as changes in the device's overall **interactive/non-interactive state**, not
  necessarily the physical display state ([Intent documentation](https://developer.android.com/reference/android/content/Intent#ACTION_SCREEN_OFF)).
  This supports Andrews's warning about the construct, but “processor intensive” is their gloss:
  the actual API construct is device interactivity.
- **No state initialization in the official release.** Funf 0.4.2's `onEnable()` registers the
  receiver and does not query or emit the current state. The exact `funf-0.4.2.jar` shipped in the
  recovered Funf-in-a-Box generator has SHA-256
  `96595461716395f59a797b79266da58c73c05cb5085b9052bc97a44e30441c98`; bytecode inspection confirms
  the same receiver-only behavior. Thus a service start/restart begins with no state row until the
  next Android transition. This directly explains why a later adjacency constructor can have an
  orphan first boundary and why shutdown/restart can create very long apparent intervals. A web-
  indexed `newFunf` copy additionally sends `PowerManager.isScreenOn()` on enable, but it is not the
  official tagged code and cannot be silently substituted for the Andrews collector.
- **Timestamp semantics.** `ScreenProbe` supplies no event time. The common `Probe.Base.sendData()`
  adds `TimeUtil.getTimestamp()` when its probe-thread handler processes the row. That method divides
  `System.currentTimeMillis()` into Unix seconds, so screen events have millisecond clock resolution,
  not microsecond resolution and not an Android-supplied occurrence timestamp. The JSON value is also
  converted to a Java `double` and stored in a SQLite `FLOAT` column. There is no uniqueness constraint,
  sequence number used as a tie-break, event priority, monotonic-clock companion, or collision repair.
  Multiple processed rows can therefore share a timestamp; the collector does not split them.
- **Recovered generic conversion pipeline.** The Funf-in-a-Box repository pins the generator template
  to Funf 0.4.2 (added 2013-04-28) and packages the generic `funf-scripts` decrypt, salvage, merge, and
  CSV tools. `dbmerge.py` scans input database files in the argument order—or unsorted `os.listdir`
  order by default—and reads each `data` table with `select *`, without `ORDER BY`. It preserves the
  source database UUID and row ID as a composite ID. `db2csv.py` again uses unordered `select *` and
  performs no chronological sort, deduplication, state validation, or timestamp rounding. Its
  `excluded_keys` are uppercase `TIMESTAMP` and `PROBE`, while Funf's JSON keys are lowercase; this
  mismatch causes it to export both the outer SQLite timestamp and the inner JSON `timestamp` under
  duplicate CSV headers. That exact duplicate-header shape occurs in the Andrews example, strongly
  identifying this generic conversion family, although Andrews did not preserve an app hash or script
  revision that proves the exact build.
- **Ordering consequence for Andrews.** The generic converter preserves an implementation-dependent
  file/row order, and the released MATLAB then sorts only by participant number and timestamp. No
  component supplies an explicit secondary key for equal timestamps or an on/off priority. The five
  observed ties in the example therefore cannot be assigned a defensible causal order from this
  lineage. If a downstream analysis needs strict time, it must preserve the original row identity and
  choose and report a deterministic priority/synthetic-microsecond policy; that policy is an analysis
  decision, not a recovered Funf rule.
- **Availability and scope verdict.** The framework paper is unusually informative about collection
  architecture, and the later open repositories permit source-level recovery of event capture and
  generic conversion. They still do not identify the precise Andrews-generated APK/configuration or
  turn interactive-state transitions into validated use sessions. This is a collector provenance
  record, not another empirical screen-use estimate and not evidence that later Funf papers all used
  the same version.

### Andrews et al. (2015) — Funf ScreenProbe construction and released MATLAB code

- **Identity, lineage, and access.** Sally Andrews, David A. Ellis, Heather Shaw, and Lukasz Piwek,
  “Beyond Self-Report: Tools to Compare Estimated and Real-World Smartphone Use,” *PLOS ONE*
  10(10), e0139004, DOI [10.1371/journal.pone.0139004](https://doi.org/10.1371/journal.pone.0139004).
  This Nottingham Trent/Lancaster/Lincoln/UWE collaboration predates and is independent of Parry and
  Toth. It is the source study and construction lineage for Wilcockson et al. (2018). **Fully audited:**
  the complete nine-page open article, figures, table, 29 references, README, every line of all three
  MATLAB files (790 source lines), and every field in the 91,243-row supplied `ScreenProbe.csv`.
  Sources: [PLOS full text](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0139004)
  and [CC BY source/data release](https://doi.org/10.1371/journal.pone.0139004.s001), accessed
  2026-08-29. The downloaded ZIP's SHA-256 is
  `cca1d30105ca24531744a63edd2d26a774e35af1cf4aaecc5774c3e37f1ee84d`.
- **Study and sample flow.** Twenty-nine Android-owning University of Lincoln staff/students were
  recruited (17 women; mean age 22.52, range 18–33) for 14 days. Two were excluded for mid-study
  technical problems and four more for incomplete self-report estimates, leaving 23 in comparisons
  requiring those reports. The paper does not provide a raw-event or derived-measure flow by person,
  handset model, Android version, missing day, or failure type.
- **What the collector actually measures.** The authors configured the open Funf-in-a-Box framework's
  screen on/off option. During testing they learned that the probe represented the phone's broader
  **interactive/non-interactive state**, including calls and music with the screen off, rather than
  literal visible-screen state. It stored timestamps locally, encrypted data, and uploaded over Wi-Fi.
  The generated app, exact Funf revision/configuration, Android manifest, upload overlap behavior,
  and study-specific processing invocation are not released. The separately recovered official
  implementation and generic scripts are audited immediately above. “Screen time” from this branch
  is therefore interactive-device time, not foreground-app time or a pure display-on measure.
- **Released example schema.** `ScreenProbe.csv` has event UUID-with-counter, device UUID, Unix
  timestamp in seconds, boolean `screenOn`, and a second identically named timestamp column. The two
  timestamp values agree on all 91,243 rows. Precision is mostly two decimal places (82,388 rows),
  sometimes one (8,768), and sometimes whole seconds (87). The file contains 34 device UUIDs, although
  the paper recruited 29; because README and article call it an “example,” it cannot safely be treated
  as the exact analyzed cohort. No mapping, provenance note, collection dates, timezone offset, or
  explanation for the five extra devices is supplied.
- **Implemented interval constructor.** `csv2data.m` converts `True/False` to 1/0, assigns device
  numbers, sorts by device number and timestamp, and gives **every row** a duration equal to the next
  sorted row's timestamp minus its own when positive; nonpositive gaps become missing. It never tests
  that an on row is followed by off, or that an off row is followed by on. Consequently the operational
  object is a state-labelled gap between adjacent logged rows, not a validated on→off pair. The final
  row receives the zero introduced when MATLAB expands the duration column, not missing/censored.
- **Repeated states and exact duplicates.** The example has five exactly duplicated records, forming
  five equal-device/equal-time tie groups; all ties repeat the same state (three on/on, two off/off).
  More broadly, after the script's sort, 1,104 adjacent within-device pairs repeat state: 410 on/on and
  694 off/off. The script neither deduplicates nor coalesces them. It therefore turns repeated on events
  into additional counted on intervals and repeated off events into additional non-use intervals. In
  the supplied example, 19,299 positive within-device on-labelled gaps are under 15 seconds, including
  intervals produced by this unvalidated adjacency rule.
- **Participant-boundary bug.** Duration assignment runs over the entire sorted matrix without checking
  whether the next row belongs to the same device. All 33 transitions between device blocks are
  processed. Twenty-four yield negative values and become missing, but nine yield positive gaps and
  are retained as false cross-device intervals: eight are attached to an on row and one to an off row.
  Their gaps range from 14,642.96 seconds to 2,498,392.74 seconds. The bug is material because summary
  code sums on-labelled durations and has no maximum-duration exclusion.
- **Equal timestamps and time basis.** Equal timestamps become missing because the script accepts only
  strictly positive differences; no stable secondary order or event priority is defined. The recovered
  official collector stamps handler-processing time from a millisecond wall clock, and the generic
  conversion scripts do not sort or repair ties. There is no microsecond splitting. Unix seconds are
  converted to an Excel serial day by division by 86,400 plus
  25,569; no timezone or DST conversion is performed. Thus calendar day and morning/afternoon/evening
  labels depend on what timezone Funf encoded or the analyst environment assumed, neither of which is
  documented.
- **Day/window allocation.** `descriptivestats.m` selects rows by their **starting timestamp** and sums
  the full attached duration, so an interval crossing midnight or a six-hour time-period boundary is
  assigned wholly to its origin window. The article states this origin-window rule for time-of-day
  analysis. `barcode.m`, by contrast, visually splits intervals at midnight, so its pictures and its
  numeric summaries implement different allocation semantics. Daily selection uses both `>=` and
  `<=`, making an event exactly at midnight eligible for both adjacent daily bins. No partial-day,
  logger-gap, or boundary-crossing flag is generated.
- **Checks and long intervals.** The interactive summary dialog defaults to bins 0:1:15 and `histc`
  output is truncated to bins whose comparisons are `[lower, upper)`, so the actual “check” branch is
  strictly under 15 seconds. The article also says “up to 15 seconds,” which would include exactly 15;
  the example has five within-device on gaps exactly 15 seconds, making the wording/code difference
  observable. Apparent uses longer than five hours are deliberately retained because shutdown/startup
  events were not captured and the authors could not distinguish a powered-off gap from genuine music,
  calls, or video. The example contains 105 on-labelled gaps over five hours, including a maximum of
  roughly 15.97 days caused by an unhandled gap.
- **Additional release defects.** README instructs users to expect `SCREENSTATE_IDS.txt`, while code
  writes `SCREENSTATE_DEVICES.txt`. More seriously, it passes the cell-string `unique_devices` object
  to numeric `dlmwrite`; under documented MATLAB behavior this call is not a valid way to write cell
  strings, while the two downstream scripts require that file. The UUID-normalization loop strips each
  event counter to 36 characters but then compares full counter-suffixed IDs with stripped UUIDs, so its
  participant-number assignment cannot match; the same column is immediately overwritten by screen
  state, masking the defect. There are no tests, environment lock, output fixtures, commit, or release
  history to resolve these issues.
- **Validation and verdict.** The paper compares aggregates with self-report and times one standardized
  SMS check in the lab (mean 8.42 seconds); it does not validate event capture or interval boundaries
  against video, a second logger, or labeled device traces. It reports 84.68 uses/day and 5.05 active
  hours/day, with 55% under 30 seconds, but these results inherit retained long gaps and an adjacency
  constructor that does not enforce state transition. This is a valuable public construction artifact
  precisely because its behavior can be audited. It is not safe as a reference algorithm without
  participant-boundary protection, state-machine repair, explicit tie/deduplication rules, timezone
  handling, censoring, and tests.

### Wilcockson, Ellis, and Shaw (2018) — 13-day reanalysis of the Funf lineage

- **Identity and lineage.** Thomas D. W. Wilcockson, David A. Ellis, and Heather Shaw,
  “Determining Typical Smartphone Usage: What Data Do We Need?” *Cyberpsychology, Behavior, and
  Social Networking* 21(6), 395–398, DOI [10.1089/cyber.2017.0652](https://doi.org/10.1089/cyber.2017.0652).
  This Lancaster/Lincoln paper is a secondary analysis of the Andrews et al. (2015) dataset and cites
  that original paper for the detailed method; it does not start from Parry and Toth.
- **Access and reading status.** **Article fully audited:** the complete 12-page accepted manuscript,
  including figures and all references, was read from the [Lancaster repository](https://eprints.lancs.ac.uk/id/eprint/124444/1/CBSN_TW.pdf)
  and checked against the [version-of-record page](https://doi.org/10.1089/cyber.2017.0652).
  The linked CC BY `typical_smartphone_usage.csv` is a 7.97-KB downstream summary advertised by the
  [repository dataset record](https://doi.org/10.17635/lancaster/researchdata/228); its current download
  endpoint returned a Cloudflare challenge in command-line and browser retrieval on 2026-08-29, so
  that file—not the paper—is explicitly unresolved rather than silently counted as read.
- **Sample and days.** The reanalysis uses the 27 original participants remaining after the two
  technology failures (17 women; mean age 22.52, range 18–33). It removes data from installation
  through the following midnight and analyzes 13 purportedly complete calendar days. Fourteen people
  installed Thursday, 12 Friday, and one Wednesday; week 1 is the first six retained days and week 2
  the next seven. The paper supplies no sensor-uptime criterion establishing that those days were
  actually complete.
- **Measures.** Daily hours equal summed active-state duration. A check is an active interval strictly
  under 15 seconds. The first six days predict week-2 hours (`r=.81`) and checks (`r=.96`); cumulative
  first-week averages cross the authors' target around five days for hours and two days for checks.
  These are stability correlations at the participant level, not event-construction validation and not
  evidence that five days suffices for other populations, irregular weeks, or rare behaviors.
- **Upstream disclosure.** The paper only says the Funf app timestamped when the phone became active
  and inactive, including calls and music, encrypted/uploaded via Wi-Fi, and generated the two daily
  measures. It does not restate sorting, pairing, duplicate, equal-time, gap, shutdown, timezone, or
  calendar allocation rules. Those details can only be investigated in the Andrews release above,
  which contains repeated-state and participant-boundary defects. The 2018 paper neither pins a code
  revision nor states that its 13-day summary was regenerated with exactly the released 2015 scripts,
  so inheritance of those defects is a strong lineage risk, not proof of which erroneous rows entered
  its final CSV.
- **Availability and verdict.** No secondary-analysis code, environment, exact daily input, event data
  for the 27-person subset, or construction sensitivity is linked. The openly described dataset is
  aggregate participant-by-day hours/check counts rather than raw events. Consequently this paper can
  support a multiverse decision about observation-window length and a named `<15 s` checking branch,
  but it adds essentially no upstream construction specification beyond Andrews et al. and does not
  validate that inherited constructor.

### Lin et al. (2017) — Know Addiction use/non-use construction

- **Identity and lineage.** Lin, Y.-H., Lin, Y.-C., Lin, S.-H., Lee, Y.-H., Lin, P.-H., Chiang,
  C.-L., Chang, L.-R., Yang, C. C. H., and Kuo, T. B. J., “To Use or Not to Use? Compulsive
  Behavior and Its Role in Smartphone Addiction,” *Translational Psychiatry* 7, e1030, DOI
  [10.1038/tp.2017.1](https://doi.org/10.1038/tp.2017.1). This Taiwan-based Know Addiction
  group is independent of Parry and Toth and supplies the direct methodological lineage inherited
  by Pan et al. (2019). It reuses the same 79-person sample as Lin et al. (2015) and explicitly
  extends that earlier paper's use-epoch measures to non-use and reciprocity measures.
- **Access and reading status.** **Fully audited:** all six article pages, including both algorithm
  figures, all tables, limitations, and 24 references, plus the complete one-table DOCX supplement.
  Sources: [open full text](https://www.nature.com/articles/tp20171) and [publisher PDF](https://www.nature.com/articles/tp20171.pdf),
  accessed 2026-08-29. The supplement contains AUC results only; it adds no construction method,
  data, or code.
- **Sample and collector.** Seventy-nine Android-using electrical/computer-engineering students
  from two northern-Taiwan universities were recruited between December 2013 and May 2014 (57 men,
  22 women; mean age 22.4). A team-built, unnamed app recorded at least three weeks and the paper
  reports parameters averaged across one month. App name/version, Android versions, broadcast/API
  mechanism, permission model, raw schema, storage/upload path, uptime checks, and cohort exclusions
  are not reported. The paper points backward to the 2015 time-distortion and app-assisted-diagnosis
  studies for development lineage rather than publishing the collector.
- **Declared event construction.** A use epoch starts at screen-on and ends at the **successive**
  screen-off; a non-use epoch starts at screen-off and ends at the next screen-on. Daily use and
  non-use frequency, total duration, and median epoch duration are computed, then averaged over the
  observation month. The article's worked figure gives clock times to one second and illustrates a
  663-second use followed by a 1,322-second non-use. It does not identify Android event constants,
  actual timestamp precision, or whether “successive” means the next row of any type, the next
  opposite-type row after projection, or the first valid closer after repairing repeated events.
- **Sleep rule.** “Sleep” is operationalized as the **longest** non-use epoch whose interval falls
  between 21:00 and the following 12:00, and that whole non-use epoch is excluded. Participants were
  confirmed not to be shift workers. The discussion candidly says actual sleep was not measured:
  the method merely removes the relatively long non-use interval surrounding midnight. The paper
  claims use duration + retained non-use duration + this sleep interval equals exactly 24 hours, but
  does not explain day-edge censoring, sessions crossing midnight, partial first/last days, clock
  changes, days with no qualifying interval, ties between longest intervals, or how an interval with
  an endpoint outside the 21:00–12:00 window is treated.
- **Order, ties, duplicates, and broken sequences.** No sort, input-order guarantee, source-row ID,
  duplicate definition, equal-timestamp event priority, microsecond splitting, repeated screen-on/
  off rule, orphan rule, boot/shutdown handling, logger restart behavior, maximum use duration, or
  missing-day/completeness threshold is disclosed. Alternation is assumed (“use and non-use epochs
  occur in turn”) rather than validated or repaired. Different events at the same instant are not
  discussed. The figures show derived intervals, not the unedited operating-system event table.
- **Reciprocity measures.** Daily RMSSD uses successive differences across the alternating use and
  non-use durations. The Similarity Index averages absolute differences between each non-use epoch
  and each of its next three use epochs. The paper does not say how it handles the final one to three
  non-use epochs lacking three subsequent uses, whether sequences continue across a date boundary,
  or what happens on sparse days. Pan et al. later inherits these constructs without filling those
  gaps.
- **Outcomes and validation scope.** Three psychiatrists classified participants using interview-
  only and app-assisted diagnoses; the latter substitutes app thresholds for two criteria. The paper
  reports 31 interview-defined and 27 app-assisted cases and AUCs/cutoffs for eight app-derived
  parameters. This tests association with a partly app-informed clinical classification, not whether
  screen events were correctly captured or paired. No manual/video trace, second logger, synthetic
  sequence, device/OS comparison, or upstream sensitivity analysis validates the constructor.
- **Availability and verdict.** The paper and statistical supplement are open under CC BY-NC-ND,
  but raw/derived data, app source/binary/version, construction and analysis code, preprocessing
  counts, package environment, and protocol are absent. The study is more explicit than papers that
  report only “screen time”: it gives opener, closer, and a precise sleep-proxy window. It remains
  impossible to reproduce its upstream construction at malformed boundaries, ties, day edges, and
  collection gaps. Rerunability is **low**. Lin et al. (2015) must be audited separately because this
  paper both reuses its sample and treats it as the source of the original app-generated measures.

### Pan et al. (2019) — temporal stability of Know Addiction measures

- **Identity.** Pan, Y.-C., Lin, H.-H., Chiu, Y.-C., Lin, S.-H., and Lin, Y.-H. (2019), “Temporal
  Stability of Smartphone Use Data: Determining Fundamental Time Unit and Independent Cycle,”
  *JMIR mHealth and uHealth* 7(3), e12171, DOI `10.2196/12171`.
- **Lineage and group.** This National Health Research Institutes/National Taiwan University group
  uses its own Know Addiction database and does not start from Parry and Toth. The paper explicitly
  inherits the use/nonuse concepts and Similarity Index from Lin et al. (2017), and cites an earlier
  Know Addiction “time distortion” paper by Lin et al. (2015). Those lineage papers require their
  own full-text and artifact audits.
- **Access and reading status.** **Fully audited for the published article.** The complete open-access
  HTML—including figures, tables, declarations, and all 15 references—was read on PMC and checked
  against the JMIR version-of-record page. No supplement, code repository, data deposit, protocol,
  or application documentation is linked. Sources: [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC6454342/)
  and [JMIR article](https://mhealth.jmir.org/2019/3/e12171), accessed 2026-08-29.
- **Instrument and sample.** Know Addiction collected data from March 2017 through March 2018. The
  authors selected 33 healthy adults with at least eight weeks of data: 28 men; mean age 29.48,
  SD 10.44, range 18–62. The first and last day were dropped as incomplete. Recruitment source,
  initial cohort size, exclusions before 33, missing-day requirement, country in the Methods, phone
  and Android versions, app version, permissions, and logger uptime are **not reported**.
- **Raw observations.** The constructor requires screen-on, screen-off, and notification timing.
  The paper does not provide raw field names, Android event/API constants, example rows, notification
  semantics, whether dismissed/updated/grouped notifications differ, timestamp precision, or the
  set of other logged events.
- **Timestamp, timezone, and ordering.** Clock source, precision, timezone, DST and manual clock
  changes, ingestion order, explicit sorting, out-of-order repair, and user/device partition keys
  are **not reported**. It is therefore unknown how “successive” is operationalized in raw records.
- **Repeated timestamps and duplicate rows.** No duplicate identity or disposition is reported.
  Different events at the same instant, stable equal-time priority, and notification exactly one
  minute before a screen-on are not defined. These cases must not be collapsed under ordinary
  timestamp deduplication because distinct event types can be structurally necessary.
- **Session concept and declared constructor.** One smartphone-use episode runs from a screen-on to
  the successive screen-off. Daily episode count is total frequency `F`; summing daily episode
  lengths gives total duration `D`. The opener/closer inclusion convention is immaterial for a
  continuous duration but material for event attribution and is not stated. Unlock/keyguard state,
  foreground applications, touch/input, calls, charging, and interaction activity are not used in
  the published definition.
- **Proactive/reactive classification.** An episode is “proactive” when there is no notification in
  the one minute before its screen-on; proactive counts and durations are `PF` and `PD`. All other
  episodes are implicitly reactive. The paper does not define the interval endpoints, whether a
  notification at the exact screen-on time or exact 60-second boundary counts, notification source
  filters, or how reordered, duplicate, and missing notification events are handled.
- **Missing, repeated, and anomalous boundaries.** Initial screen state, orphan screen-offs,
  consecutive screen-ons, consecutive screen-offs, a missing closer, end-of-file, reboot/shutdown,
  app/logger restart, multi-day open screens, screen-on while locked, always-on display, and
  screen-off during calls are not specified. No minimum/maximum duration, implausibility filter,
  truncation, cap, imputation, or censoring rule is reported.
- **Calendar construction.** Measures are calculated daily, and the first/last calendar days are
  excluded, but timezone and the assignment or splitting of episodes crossing midnight are not
  stated. A “complete record comprising weekdays and weekends” is recommended, yet missing
  intermediate days and partial-day detection are not defined.
- **Use/nonuse intervals.** Nonuse is necessarily the interval between constructed use episodes.
  Sleeping time is excluded from nonuse before downstream calculations, but the method used to
  detect sleep, its inputs, thresholds, cross-midnight treatment, and whether removed sleep joins
  neighboring intervals are **not reported**.
- **Derived parameters.** Daily RMSSD is the square root of the mean squared successive differences
  between alternating use/nonuse durations, divided by `n-1`. Similarity Index averages absolute
  differences between each nonuse interval and each of its following three use intervals; Control
  Index compares a nonuse interval with the sum of the next three use intervals. The figure gives
  the equations, but days with too few episodes, missing successors at day end, and intervals that
  cross the day boundary are not handled in text.
- **Analysis windows.** Average daily `F`, `D`, `PF`, `PD`, RMSSD, SI, and CI are formed over eight
  weeks. One-, two-, and four-week subwindows are correlated with the two-month aggregate; `.75` is
  selected as “high correlation.” Separate window pairs with gaps from zero through six weeks are
  used to infer an independent cycle. The same observations are contained in each subwindow and
  the full two-month target, so these are part-whole correlations rather than independent
  prediction tests; no correction, uncertainty analysis, or preprocessing sensitivity is supplied.
- **Reported outputs.** Mean daily total frequency is 57.29 and duration 20,666.96 seconds (5.74 h);
  proactive means are 22.97 episodes and 4,806.66 seconds. Proactive duration correlates with
  SPAI-5 (`r=.403`, `P=.02`). The authors infer that two weeks adequately represents two months and
  that periods more than four weeks apart are likely different cycles.
- **Validation.** The study tests temporal correlations and association with a five-item self-report
  inventory. It does not validate inferred episode boundaries against observed interaction,
  Android ground truth, another logger, or labeled traces. Only proactive duration, not total
  duration or frequency, has the reported significant addiction correlation.
- **Sensitivity and edge-case testing.** No alternative opener, closer, notification window,
  same-time priority, missing-close rule, sleep detector, midnight policy, duration cap, or logger
  completeness definition is tested. Comparing one-, two-, and four-week analytical windows is not
  a sensitivity analysis of upstream construction.
- **Author-reported limitations.** Screen-on/off cannot completely represent use; the sample has
  unusually high use, is small, convenient, and 85% male; cross-cultural replication is needed;
  distinct behavior patterns can produce identical use/nonuse indices; and the indices remain
  objective descriptions whose meaning needs further work. The upstream omissions above are not
  listed as limitations.
- **Availability and rerunability.** CC BY article; no raw or derived data, collector source/version,
  executable construction code, analysis code, environment, or parameter file. The verbal
  screen-on/screen-off and one-minute definitions permit a family of plausible implementations,
  not exact replay. Rerunability is **low**.
- **Unresolved follow-up.** Audit Lin et al. (2015), Lin et al. (2017), and the digital-chronotype
  paper for inherited code or sleep logic; locate archived Know Addiction binaries/source and API
  documentation; request the event schema, ordering and tie policy, boundary-repair logic, sleep
  detector, daily splitting rule, cohort attrition, and exact analysis scripts.

### Okoshi et al. (2025) — Cyberoception screen/app event construction

- **Identity.** Okoshi, T., Gao, Z., Tan, Y. Z., Karasawa, T., Miki, T., Sasaki, W., and Balan,
  R. K. (2025), “Cyberoception: Finding a Painlessly-Measurable New Sense in the Cyberworld
  Towards Emotion-Awareness in Computing,” *CHI ’25*, Article 719, 17 pages, DOI
  `10.1145/3706598.3713638`.
- **Lineage and group.** Keio, University of Tokyo, Singapore Management University, Cambridge,
  and Nara Institute group. Independent of Parry and Toth. It builds on AWARE and a first-author
  team member’s public AWARE app-usage plugin, while inheriting the five-second micro-usage idea
  from Böhmer and discussing Ferreira, Shepard/LiveLab, Andrews, and Wilcockson thresholds.
- **Access and reading status.** **Fully audited for the paper and linked collector plugin.** The
  complete CHI/arXiv 17-page paper, all 62 references, Appendix A, public plugin README/history,
  source, schema model, manifest, build configuration, and tag/current revision differences were
  read. No study dataset, full experiment-app repository, or analysis code was found. Sources:
  [arXiv full text](https://arxiv.org/abs/2504.16378) and
  [linked AWARE plugin](https://github.com/KarasawaTakumi0621/awareappusageplugin), accessed
  2026-08-29.
- **Study design and sample.** Ten days of continuous Android sensing plus five randomized ESM
  prompts/day and lab sessions on days 3 and 10. Twenty-five information-science students aged
  19–34 (19 men, 6 women), Android 9+; devices span Samsung, OPPO, Google, OnePlus, Xiaomi, Sony,
  Poco, and Huawei and OS versions 10–13/EMUI 12. One network-corrupted survey and two people
  reporting over 30 minutes within a 30-minute window were excluded, leaving 22.
- **System.** A foreground-service Android application uses AWARE, `UsageEvents.Event`, and
  Accessibility APIs; local database; periodic AWS/RDS upload; Firebase Cloud Messaging and Google
  Forms for surveys. The paper names no application version, repository/commit, deployment dates,
  database schema, server code, or package-filter configuration.
- **Raw event vocabulary.** `SCREEN_INTERACTIVE` for Turning On; `KEYGUARD_HIDDEN` for Unlocking;
  `SCREEN_INTERACTIVE`/`SCREEN_NON_INTERACTIVE` for screen duration;
  `ACTIVITY_RESUMED`/`ACTIVITY_PAUSED` for app duration and most-used-app launches; and
  `TYPE_VIEW_TEXT_CHANGED` for inferred delete presses. Paper timestamps are used for intervals,
  but their unit, timezone, source clock, sorting, and persistence order are not stated.
- **Turning On and unlocking.** Turning On counts `SCREEN_INTERACTIVE` and is intended to exclude
  automatic ambient/sleep display activation, but the paper does not state an implemented predicate
  that can distinguish intentional from automatic events. Unlocking counts `KEYGUARD_HIDDEN` and
  is conceptually PIN/face/fingerprint entry, though `KEYGUARD_HIDDEN` can also reflect other
  keyguard transitions; validation against observed unlocks is absent.
- **Screen-use constructor.** `SCREEN_INTERACTIVE` and `SCREEN_NON_INTERACTIVE` are “paired into
  screen usage sessions”; each duration is their timestamp difference; durations are summed within
  each preceding 30-minute ESM window. The pairing direction is implied opener→closer, but sorting,
  partition key, equal-time order, duplicate boundaries, repeated opener/closer, missing closer,
  window-boundary clipping, cross-midnight behavior, reboot/shutdown, logger pause, and whether a
  session beginning before a window contributes are **not reported**.
- **App/micro-usage constructor.** An app use is the timestamp difference from
  `ACTIVITY_RESUMED` to `ACTIVITY_PAUSED`; durations strictly **less than five seconds** are counted
  as micro-use. The paper says the events are obtained “as a pair” but does not require matching
  package/activity, say whether a new app’s resume implicitly closes the previous app, handle
  multiple activities or split-screen, define same-time priority, or specify missing/repeated events.
  Exactly five seconds is not micro-use. No maximum duration is reported.
- **Most-used app.** Each participant names one most-used app at baseline; its launches/resumes are
  counted, and the paper also says all app sessions are tracked from pause/resume. Package-to-label
  resolution, alternate packages, web/PWA use, work profiles, reinstalls, and foreground-service or
  launcher filtering are not described. Only 11 participants had at least three valid responses for
  this metric.
- **Typo constructor.** Accessibility text-change events are compared pairwise. A deletion is counted
  when text length decreases and Levenshtein distance divided by length difference is below one.
  This threshold is dimensionally unusual and its behavior for multi-character deletion, selection
  replacement, emoji/graphemes, password fields, inaccessible apps, autocorrection, paste, and
  simultaneous edits is not validated. Daily habits are left unchanged, while the lab disables
  capitalization, autocorrect, and prediction.
- **ESM windows and missingness.** One prompt is randomly delayed within each of five windows
  (07–10, 10–13, 13–16, 16–19, 19–22); the window assessed is the immediate prior 30 minutes;
  three of six metrics are sampled per form using Fisher–Yates. Metrics with fewer than three
  responses for a participant are excluded, producing metric-specific `N=11–21`. Prompt expiry,
  delayed-response alignment, overlap, timezone, DST, missed-prompt denominator, and sensor-window
  completeness are not reported.
- **Data volume.** The retained 22 participants produced 1,425 valid self-report/sensor pairs:
  Turning On 259, Unlocking 286, screen duration 258, micro-use 305, typo 219, most-used app 98.
  No raw-event total, duplicate count, unmatched-boundary count, upload loss, per-day completeness,
  or interval rejection total is reported.
- **Linked plugin version and schema.** The cited repository’s `ver1.0` tag and current main share
  identical sensor core; main commit audited: `cfe18dbe5fb3896810d471872b23f85b28772579` (2023-02-13).
  It records event and AWARE timestamps in Unix milliseconds, package, integer event type, device
  UUID, label, timezone offset, and OS. It requires Android 11 in README/build, while the study admits
  Android 9+, so the experiment app cannot be reproduced by simply using the documented plugin.
- **Plugin collection algorithm.** Default polling interval is 60,000 ms. Each poll calls
  `queryEvents(lowerBound, System.currentTimeMillis())`, iterates platform-returned order, filters by
  configured package names/event types, and uses list subtraction against the previous poll’s whole
  result to emit “new” exact `AppusageData` rows. This is event deduplication by full object equality,
  not timestamp deduplication; distinct events sharing a timestamp survive if another field differs.
- **Plugin lower-bound defect/risk.** The lower bound is a new local `Calendar` with only
  `HOUR_OF_DAY=0`; minutes, seconds, and milliseconds are not reset. Thus a poll at 14:37:25 queries
  from approximately 00:37:25, not midnight, and the bound changes with poll timing. Events before
  that retained minute-of-day can be unavailable after service restart, and the first daily query can
  omit early events. The paper does not acknowledge or quantify this. This applies to the linked
  plugin; the unreleased experiment app might contain additional logic, so impact on study data is
  unresolved rather than asserted.
- **Plugin limitations.** It stores raw events only and does **not** implement screen/app pairing,
  five-second classification, window clipping, typo inference, or analysis. It has placeholder unit/
  instrumented tests only, no license file, no release linked to the paper, no explicit event ordering
  or reboot/day-rollover test, and filters packages using a configured allowlist. Exact experiment
  configuration is absent.
- **Validation and sensitivity.** Sensed phone operations are called objective/ground truth, but no
  video/manual trace, second logger, platform-version comparison, or synthetic edge-case suite
  validates them. No alternative event pairs, tie rules, missing-close policy, app-switch behavior,
  ESM window, micro-use threshold, typo rule, or plugin interval is tested.
- **Statistical contradiction.** The paper/abstract repeatedly calls Turning-On cyberoception and
  valence “significantly” related, while its table reports Pearson `r=.452`, **`p=.052`**, and regression
  `p=.052`; both exceed the conventional preregistered-looking `.05` threshold, and no alternate
  alpha is declared. The two-split subgroup result is `p=.005`, but the split is made at the sample
  mean and cannot repair the nonsignificant full-sample claim. No multiplicity correction is reported
  across the many metric/outcome correlations.
- **Author-reported limitations.** Small homogeneous young university sample; restricted/low-arousal
  images; cardiac-only interoception; emotional experience only partly captured; and possible
  negative effects of encouraging heightened feeling awareness. Construction and statistical issues
  above are not acknowledged.
- **Availability and rerunability.** Paper is open; raw collector plugin is public but unlicensed.
  Study app, configuration, processed/raw data, survey responses, pairing/analysis code, environment,
  and registered protocol are absent. Upstream raw collection is partially inspectable; reported
  measures are not exactly rerunnable. Overall rerunability is **low**.
- **Unresolved follow-up.** Obtain the experiment-app revision/config and datasets; determine whether
  the plugin lower-bound behavior affected collection; extract actual downstream pairing code and
  tests; ask about package matching, sorting/ties, missing boundaries, window clipping, and automatic
  displays; reconcile Android 9+ with plugin Android 11; and correct or justify the `p=.052`
  “significant” claim.

### Karas et al. (2024) — Beiwe screen-bout construction with explicit sensitivity branches

- **Identity and independent group.** Marta Karas, Debbie Huang, Zachary Clement, Alexander J.
  Millner, Evan M. Kleiman, Kate H. Bentley, Kelly L. Zuromski, Rebecca G. Fortgang, Dylan DeMarco,
  Adam Haim, Abigail Donovan, Ralph J. Buonopane, Suzanne A. Bird, Jordan W. Smoller, Matthew K.
  Nock, and Jukka-Pekka Onnela (2024), “Smartphone Screen Time Characteristics in People With
  Suicidal Thoughts: Retrospective Observational Data Analysis Study,” *JMIR mHealth and uHealth*
  12, e57439, DOI [`10.2196/57439`](https://doi.org/10.2196/57439). This Harvard/MGH/Franciscan
  Children's/NIMH group uses Beiwe and does not start from Parry and Toth. Its construction explicitly
  follows and modifies Kristensen et al. (2022).
- **Access and reading status.** **Fully audited.** The complete open article, 626-KB methods/results
  supplement, all references, public R repository, pipeline manifests, and every preprocessing and
  analysis script were read. Repository head is
  `179125fa6b8e638a6727bc6f3c7fb9238c1e7c31` (2023-01-12), predating the submitted manuscript.
  Sources: [article and supplement](https://mhealth.jmir.org/2024/1/e57439/) and
  [analysis repository](https://github.com/onnela-lab/stb-beiwe-screen-time), accessed 2026-08-29.
- **Study and sample.** Adults presenting to Massachusetts General Hospital's emergency service and
  adolescents discharged from Franciscan Children's inpatient psychiatry were monitored for up to
  six months after suicidal thoughts. Of 297 people with Beiwe installed, 247 had at least one valid
  day and 126 met the final analysis rule. The final group included 50 adolescents and 76 adults,
  75 iOS and 51 Android users; median monitoring was 169 days and median valid data was 94 days.
- **Raw event vocabulary and timestamp.** Beiwe phone-state logs use millisecond timestamps. Android
  contributes `ACTION_SCREEN_ON`, `ACTION_SCREEN_OFF`, power connected/disconnected, power-save
  state, idle state, reboot, and shutdown messages, but the constructor retains only screen on/off.
  iOS contributes locked, unlocked, charging, unplugged, and full, with battery level available; the
  constructor retains lock/unlock. Android screen-on/off represent interactive/noninteractive state,
  whereas iOS lock/unlock is a different operating-system construct. The paper analyzes them as
  comparable screen-use boundaries while acknowledging platform differences.
- **File ingestion.** The public script enumerates every per-participant `power_state/*.csv`, reads all
  columns as character, row-binds files, adds the participant ID, parses `utc_time`, limits records to
  participant-specific study dates, normalizes event strings, and infers OS from the event label. It
  does not sort filenames, use the raw `timestamp` column as a stable key, remove exact duplicates,
  report ingestion row counts, or test overlapping exports before saving the combined data.
- **Sort and tie behavior.** Events are sorted only by participant and parsed `utc_time`; no secondary
  sequence or event-priority key is supplied. If different events share an instant, their order is
  inherited from file enumeration/binding and the sort implementation. The code neither detects nor
  resolves equal-time collisions. It also does not microsecond-split distinct same-instant events.
  Therefore its on/off pairing is fully specified for strictly ordered timestamps but
  underdetermined for timestamp ties.
- **Pair repair.** Within each participant, the next event is obtained with `lead()`. For two
  consecutive off/locked events, a synthetic on/unlocked event is inserted 60 seconds before the
  second event if the gap exceeds 60 seconds, otherwise at the midpoint. For two consecutive
  on/unlocked events, a synthetic off/locked event is inserted 60 seconds after the first event if
  the gap exceeds 60 seconds, otherwise at the midpoint. The reported anomalous-pair frequencies are
  0.17% off-off and 0.76% on-on on Android, and 1.10% locked-locked and 1.01% unlocked-unlocked on
  iOS. These insertions manufacture a one-minute use/nonuse interval (or split a shorter gap) rather
  than identifying which boundary was actually missing.
- **Bout creation and truncation.** After re-sorting the originals plus inserted events, every
  on/unlocked row is paired with the immediately following row; its duration is the timestamp
  difference. The code does not explicitly require that following row to be off/locked at this stage,
  relying on repair to restore alternation. Screen-on bouts longer than 30 minutes are truncated by
  reducing their constructed duration to 30 minutes; 3.41% of Android and 3.37% of iOS bouts were
  affected. This does not move or delete the subsequent raw boundary, so the time after the cap is
  treated as screen-off/nonuse in downstream minute grids.
- **Notification removal.** Android-only bouts of at most 40 seconds are treated as notification
  artifacts when the same duration—rounded to 0.1 seconds—occurs at least three times and exceeds 1%
  of that participant's bouts within a study-relative week. Every bout matching that duration/week
  cell is removed. The step removed 15.79% of Android bouts. It is a behavioral heuristic; notification
  cause is not observed or manually validated. Kristensen applied a related rule by participant-day;
  Karas applies it by participant-week.
- **Day/minute construction.** Each bout is expanded across UTC minute bins. First and last minutes
  receive their fractional seconds and intermediate minutes receive 60 seconds. Contributions are
  then summed by participant/OS/minute, and a complete minute grid is built from first through last
  observed UTC date. Missing cells become zero screen time. Days are midnight-to-midnight UTC; a
  parallel America/New_York label is added for DST analyses. The paper assumes UTC day choice does
  not affect its statistical analyses, but does not test local-calendar day summaries. The code does
  not cap an aggregated minute at 60 seconds, so duplicated or overlapping constructed bouts could
  exceed physical minute capacity without a guard.
- **Missingness/valid-day rules.** For iOS, battery changes define valid minutes: battery must change
  at least 1% per hour or remain at 100% for no more than 12 hours after charging; a valid day needs
  at least 1,080 valid minutes (18 hours). Android lacks battery-level changes, so a valid Android day
  requires screen-on activity in at least eight distinct UTC hours. Only valid days enter analyses.
  Participants must have at least 28 valid days, and the paper additionally describes those days as
  belonging to a 28-day period containing at least 14 valid days. These OS-specific denominators are
  not equivalent: Android's rule conditions validity on observed use and can reject a genuinely
  low-use day, while iOS estimates collection coverage independently from use.
- **Outcome measures.** Daily outputs include total screen-on seconds, screen-on bout count, mean
  screen-on duration, mean screen-off duration, additional fragmentation metrics, activity-hour
  count, and first-to-last active-hour span. The reported primary measures were total screen time,
  mean on-bout duration, mean off-bout duration, and log bout count. Minute-level binary functions
  supported the DST analysis.
- **Declared multiverse/sensitivity branches.** The primary branch imputes missing boundaries and
  caps use bouts at 30 minutes. Three comparators use (1) imputation plus a six-hour cap, (2) neither
  imputation nor cap and only directly matching adjacent pairs, and (3) no imputation plus a
  30-minute cap. The 30-minute cap materially changes participant means; authors state there is no
  definitive basis for choosing it. The paper also varies pre/post-DST windows across ±7, ±14, and
  ±28 days. It does **not** vary same-time ordering, synthetic one-minute length, notification
  thresholds, weekly versus daily notification grouping, UTC versus local days, iOS 18-hour
  coverage, or Android eight-active-hour validity.
- **Analysis.** Linear mixed models estimate population means and age/OS/monitoring-stage contrasts;
  day-level plots use seven-day moving averages. Function-on-scalar generalized linear mixed models
  estimate minute-specific post-DST effects with pointwise and joint confidence bands. Mean daily
  screen time was about 255 minutes for adolescents and 271 for adults. Most age, OS, and early/late
  contrasts were nonsignificant; adult mean on-bout duration differed between weeks 1–4 and week 5+
  (`p=.018`). No multiplicity correction is described for the many contrasts.
- **Validation and interpretation.** No video/manual ground truth or second logger validates whether
  screen events equal attended use, whether synthetic boundaries are correct, or whether short
  repetitive bouts are notifications. The strongest methodological result is sensitivity: the cap
  substantially changes outcomes. Absence of a significant OS contrast does not establish platform
  equivalence, which the authors appropriately note. “Objective” here means passively logged OS
  state, not ground-truth human attention.
- **Rerunability.** Code is MIT-licensed and unusually complete, but raw/derived data are unavailable.
  Multiple scripts source an intentionally absent `R/config.R`; a code comment exposes four major
  thresholds, but participant-path settings, selected IDs, and other constants are missing. There is
  no package lockfile/session information, no frozen Beiwe app/server version, and no automated edge-
  case tests. The transformation is substantially inspectable but cannot be rerun end to end from the
  public repository alone.
- **Unresolved follow-up.** Obtain or reconstruct `config.R`, environment/package versions, raw-schema
  dictionary, and Beiwe client/server commits; count exact duplicates and same-instant event patterns;
  implement an explicit `(timestamp, event-priority, source-sequence)` ordering with microsecond
  separation for distinct ties; add physical-cap assertions per minute; and expand the multiverse to
  notification, imputation, day-boundary, and OS-specific validity choices.

### Lind et al. (2018) — EARS platform paper and paper-time source reconstruction

- **Identity and scope.** Monika N. Lind, Michelle L. Byrne, Geordie Wicks, Alec M. Smidt, and
  Nicholas B. Allen (2018), “The Effortless Assessment of Risk States (EARS) Tool: An Interpersonal
  Approach to Mobile Sensing,” *JMIR Mental Health* 5(3), e10334, DOI
  [`10.2196/10334`](https://doi.org/10.2196/10334). This University of Oregon Center for Digital
  Mental Health paper is a platform viewpoint with a small feasibility pilot, not a validation paper
  for screen/app interval construction and not a Parry-and-Toth descendant.
- **Access and reading status.** **Fully audited.** The complete article, the 12-platform comparison
  supplement, all 55 references, the linked C4DMH organization, the surviving `EarsTool` Git history,
  and the last repository commit before manuscript acceptance were read. Sources:
  [article and supplement](https://mental.jmir.org/2018/3/e10334) and
  [C4DMH/EarsTool](https://github.com/C4DMH/EarsTool), accessed 2026-08-29.
- **Version history the prose collapses.** The paper distinguishes a “first version” piloted in the
  EASE study from a “current version” with later enhancements. The first version collected a sampled
  subset of typed words, Google Fit activity, a daily two-minute video diary, and geolocation attached
  to those streams. App-use time and screen-on time appear only among four phone-use indices added to
  the later current version. Consequently, the 24-person EASE feasibility pilot did **not** validate
  the app-use/screen-on mechanisms described later in the same paper.
- **Pilot.** Twenty-four University of Oregon undergraduates were recruited in fall/winter 2016–2017
  for two one-week sensing periods: a baseline three to seven weeks before the first final exam and a
  second week before the last final exam. The reported results concern tolerance and burden: two of
  28 screened people declined or dropped out for privacy reasons, one dropped out without explanation,
  and completers did not report needing the supplied battery pack. The paper reports approximately
  15% battery use across 16 hours from unspecified testing on a range of phones. It reports no sample
  device/Android distribution, raw completeness, or accuracy comparison for any phone-use measure.
- **Paper-time source pin.** The paper links the C4DMH GitHub organization. The surviving `EarsTool`
  repository begins in September 2016. Commit
  `4a4aee13bec44d2f2ed757a67bb2774248dafb46` (2018-05-22, “everything up until flavors”) is the last
  commit before the paper's 30 July 2018 acceptance and is therefore the closest public paper-time
  source state; the deployed pilot APK remains unidentified. Later repositories and commits are not
  silently substituted for it.
- **Paper-time app-use observation.** `UStats.java` queries
  `UsageStatsManager.queryUsageStats(INTERVAL_DAILY, now - 24 hours, now)`, filters to positive
  `getTotalTimeInForeground()`, sorts packages by decreasing foreground total, and writes package,
  foreground seconds, and a human-readable `getLastTimeUsed()` value. A block that would call
  `queryEvents()` exists only as commented-out exploratory code. Thus this version records Android's
  already-aggregated package statistics, not foreground-enter/exit events and not reconstructed app
  sessions.
- **Actual cadence differs by signal.** `FinishInstallScreen` starts a daily inexact app-usage alarm
  nominally at 23:55. It also schedules a 15-minute `StatsJobService`, but the active job-service body
  logs GPS coordinates; its old app-usage job implementation is commented out. Reading only the
  scheduler name would therefore produce the false claim that app use was collected every 15
  minutes. Signal-specific control flow establishes one requested app-usage snapshot per day for this
  commit.
- **Daily-boundary behavior.** The requested interval is a rolling 24 hours ending whenever the
  inexact alarm runs, while `INTERVAL_DAILY` returns system-defined daily aggregate buckets. The
  source does not clip buckets to the requested 24-hour window, merge multiple returned buckets by
  package, state which time zone governs Android's day boundary, or handle DST. The filename embeds
  `Date.toString()`, but no stable observation ID or source sequence is written.
- **Encryption and transport.** The article says sensor output is immediately encrypted with 128-bit
  AES, unencrypted data deleted, transmitted via SSL to AWS, encrypted server-side with 256-bit AES,
  then deleted from the phone after transmission. The paper-time `StatsAlarmReceiver` invokes the
  collector, encryption, and an asynchronous S3 upload. The visible call path does not attach an
  upload completion listener and does not itself delete either file after confirmed upload; exact
  deletion/retry behavior therefore cannot be verified from this path and should not be inferred
  solely from the prose.
- **Screen-on construction is absent.** The paper lists screen-on time as an automatic index in the
  current version, but the paper-time source contains no `ACTION_SCREEN_ON`, `ACTION_SCREEN_OFF`,
  interactive-state receiver, or screen event constructor. No raw schema, boundary pairing, reboot
  handling, ordering priority, timestamp precision, or missing-close rule is described in the paper.
  This source cannot establish how screen-on time was constructed.
- **No deduplication or equal-time ordering.** App-use input is an Android aggregate, so no raw event
  collisions survive for microsecond splitting. The client writes one daily snapshot without a
  deduplication stage. Any later transformation into daily features, sessions, or cross-signal
  variables is off-device and undisclosed. Equal-time priority becomes relevant only for a later
  event-based EARS version, which requires its own code and data audit.
- **Modularity and reproducibility.** The paper emphasizes Android build flavors that let each study
  select only needed modules. That is good minimization practice but makes the exact flavor and
  configuration part of the instrument identity. Neither the EASE APK/flavor nor its build hash is
  preserved in the paper. The article calls EARS Apache-2.0 licensed; the inspected paper-time tree
  does not expose a root Apache license file, and the repository contains study infrastructure rather
  than a frozen release tied to the paper.
- **Backend and analysis disclosure.** The paper says preliminary analyses were underway and that the
  team would optimize the backend later. It gives no phone-use feature algorithm, data dictionary,
  package exclusions, preprocessing code, expected-count completeness measure, missingness rule,
  validation ground truth, sensitivity analysis, or statistical results connecting sensed behavior
  to stress. It is evidence about platform aims, modules, privacy architecture, and feasibility—not
  evidence that app/screen time was accurately constructed.
- **Unresolved follow-up.** Recover the exact EASE APK/flavor and app/screen source if archived;
  determine which participants received which revision; locate the backend and decrypted schema;
  verify file-deletion and retry semantics; and treat ABCD, later public EARS, and `appusage2` as
  separate instrument generations rather than one timeless “EARS” implementation.

### Wade et al. (2021) — ABCD EARS pilot, released data lineage, and source contradiction

- **Identity and independent group.** Natasha E. Wade, Joseph M. Ortigara, Ryan M. Sullivan,
  Rachel L. Tomko, Florence J. Breslin, Fiona C. Baker, Bernard F. Fuemmeler, Katia Delrahim
  Howlett, Krista M. Lisdahl, Andrew T. Marshall, Michael J. Mason, Michael C. Neale, Lindsay M.
  Squeglia, Dana L. Wolff-Hughes, Susan F. Tapert, Kara S. Bagot, and the ABCD Novel Technologies
  Workgroup (2021), “Passive Sensing of Preteens’ Smartphone Use: An Adolescent Brain Cognitive
  Development (ABCD) Cohort Substudy,” *JMIR Mental Health* 8(10), e29426, DOI
  [`10.2196/29426`](https://doi.org/10.2196/29426). This is a multi-institutional ABCD/Ksana Health
  branch, not a paper derived from Parry and Toth. It cites Andrews et al. (2015), Parry et al.
  (2021), Ryding and Kuss (2020), and Lind et al. (2018), among others.
- **Access and reading state.** **Fully read at article level.** The complete open article—abstract,
  introduction, methods, results, discussion, limitations, conclusion, acknowledgments, and all 55
  references—was read. Multimedia Appendix 1 is explicitly a 13-KB demographic comparison, not a
  sensing or preprocessing supplement. The linked ABCD Release 3.0 study record and current ABCD
  Novel Technologies documentation were inspected. The time-matched public Android source and its
  commit history were read file by file for collection, scheduling, encryption, and upload behavior.
  Sources: [article](https://mental.jmir.org/2021/10/e29426),
  [ABCD Release 3.0](https://nda.nih.gov/study.html?id=901),
  [current ABCD EARS documentation](https://docs.abcdstudy.org/v/7_0_0/documentation/non_imaging/nt.html),
  and [C4DMH/ABCDStudy](https://github.com/C4DMH/ABCDStudy), accessed 2026-08-29.
- **Sample and deployment.** Four geographically dispersed ABCD sites invited Year-2 participants
  with compatible Android phones between August 2019 and January 2020. Seventy-one child-parent
  dyads enrolled; four did not complete the protocol; the analytic sample was 67 children aged
  approximately 11–12. The customized EARS app required Android 6.0 or newer, was installed from
  Google Play by a research assistant, and linked the ABCD participant ID by scanning a code.
  Collection was intended to last at least four weeks; obtaining four weeks took a mean 33.91 days
  (SD 22.20). The study excluded iOS because the required passive app-use access was unavailable.
- **What the paper says was observed.** The paper says the background app “scrap[ed] the operating
  system every few minutes” for screen-on/off state and the foreground app and logged the date and
  time of each app-use instance. If EARS stopped, it says the app later requeried the OS for overall
  use, preserving total screen use but potentially losing finer time-of-day detail. It does not name
  the Android API, provide the exact query frequency, raw field schema, event vocabulary, APK hash,
  deployed source revision, or client/server transformation.
- **What the time-matched public client actually does.** The public `C4DMH/ABCDStudy` repository
  describes itself as the ABCD EARS version “with only appusage.” Its 2019-09-03 head commit
  (`d95b4addf1fdb2c1566af9cabfa7fff822ec2621`) falls inside the pilot and identifies app version
  1.08 (`versionCode 8`). `UStats.java` calls
  `UsageStatsManager.queryUsageStats(INTERVAL_DAILY, now - 7 days, now)`. It does **not** call
  `queryEvents`, reconstruct foreground sessions, or register screen-on/off receivers. No screen
  event collector exists anywhere in this repository. Each returned `UsageStats` object is already
  an Android-generated aggregate for one package and time range. The app keeps records with
  positive `getTotalTimeInForeground()`, sorts them from greatest to least foreground time, and
  writes package name, foreground milliseconds, bucket first timestamp, bucket last timestamp, and
  last-use timestamp. It prepends device/model/Android/EARS-version/default-time-zone metadata and
  names the file with the query-end epoch milliseconds.
- **Why that distinction matters.** Android documents `UsageStats` as package statistics “for a
  specific time range”; its first/last timestamps delimit the represented aggregate range, while
  `getLastTimeUsed()` is the last activity-use time. They are not start/stop timestamps for every app
  instance. Android exposes the separate `queryEvents()` method for timestamped usage events.
  Therefore the public client cannot, by itself, support the article's statement that a date and time
  were logged for each app-use instance. The later ABCD documentation now explicitly distinguishes
  the older `appusage` sensor—overlapping seven-day queries—from `appusage2`, introduced in August
  2024 to provide an exact event time series.
- **Three simultaneous schedule paths.** The source does not implement one unambiguous “every few
  minutes” cadence. `FinishInstallScreen` schedules a persisted, network-required `JobScheduler`
  job at 15 minutes; starts an inexact repeating hourly alarm nominally anchored at 08:15; and
  enqueues unique `WorkManager` work every 30 minutes with replacement. Firebase reset handling also
  enqueues the 30-minute work. The 15-minute job and hourly alarm predate the August 2019 pilot; the
  WorkManager path was added on 20 August 2019. Android may defer periodic background work, so these
  are requested schedules, not proof of realized collection times. Without the deployed APK or
  telemetry, it is unknown which combination ran on each participant device.
- **Raw-output overlap and required reconciliation.** Every trigger rereads the preceding seven days,
  so neighboring files contain repeated and potentially updated versions of the same daily package
  buckets. The client neither deduplicates them nor chooses a winning snapshot. It encrypts each raw
  file, deletes the unencrypted copy after creating the encrypted copy, uploads the encrypted file,
  and deletes that encrypted file only on a completed transfer. Thus failed uploads are retained for
  retry, but the server receives a collection-window series whose overlaps require downstream
  reconciliation. The article never specifies the identity key, snapshot-selection rule, overwrite
  policy, partial-day handling, or arithmetic used to produce daily/person-level results.
- **Later documentation confirms, but does not reconstruct, the hidden step.** Current ABCD
  documentation warns that `ears_appusage_raw` contains duplicate information because every query
  collected the last seven days. It describes `ears_appusage_logs` as short-window features and
  `ears_appusage_dt` as app duration per calendar date, and says Ksana removed known errors,
  including continuously running apps and duplicative events, before delivery. Release 6.0
  reprocessed features with “improved algorithms.” The published documentation does not version or
  disclose those algorithms sufficiently to reproduce the Release 3.0 pilot values, and later
  reprocessing means a current feature table must not be assumed identical to the values analyzed in
  the 2021 paper.
- **No raw-event timestamp tie problem can be solved from this lineage.** Because this old client
  consumes Android daily aggregates rather than a raw event stream, there are no retained equal-time
  foreground/screen events to order, and microsecond splitting cannot recover them. The relevant
  uncertainty is instead which overlapping snapshot of each OS bucket survived downstream. A later
  event-producing sensor needs its own audit of timestamp precision, ties, event priority, and
  session construction; it cannot be projected backward onto this pilot.
- **Completeness and missingness.** Investigators reviewed raw participant files for any full-day gap
  and reported none. That establishes only the presence of at least one record/file in each day—not
  continuous coverage, successful scheduled-query density, complete foreground capture, or absence
  of partial-day loss. The study itself acknowledges that stopping EARS could remove time-of-day
  detail. No coverage denominator, expected-versus-observed query count, minimum usable-day rule,
  device-off distinction, clock-change rule, or DST rule is reported.
- **App classification and denominator.** Ksana manually reviewed applications and created
  communication, gaming, music, news, reading, social-media, and streaming composites plus separate
  SMS and YouTube categories. Categories deliberately overlap: Facebook can enter communication and
  social media, and YouTube is both its own outcome and part of streaming. These category durations
  therefore cannot be summed as a device-use denominator. The paper reports category means and an
  overall daily EARS mean but does not disclose the exact package allow/exclude lists, category-map
  version, system-app filter, treatment of launchers/lock screen, or formula used to compute overall
  phone use from overlapping package buckets.
- **Analysis and reported findings.** R 3.6.1/RStudio produced descriptives, ANOVAs, Pearson
  correlations, paired tests, and chi-square tests. Mean sensed daily use was approximately 3 h 45
  min; child postsensing report correlated with EARS at `r=.49`; parent report did not significantly
  correlate. Streaming, communication, gaming, and social media had the largest reported category
  means. Analysis code, package versions, exclusions, transformed analytic file, and category map
  are not released with the paper, so the statistical results are not exactly rerunnable from the
  public article and client.
- **Validation.** The paper treats EARS as objective and compares it with retrospective child and
  parent report; that is convergent comparison, not validation of the logger against video, a second
  logger, or a manually annotated ground truth. The source/API mismatch, overlapping-window merge,
  category mapping, recovery behavior, and cross-device/Android-version behavior receive no direct
  accuracy test or sensitivity analysis.
- **Availability and evidential status.** The article is open and Release 3.0 is DOI-addressed, but
  ABCD individual-level data require NDA access. A highly time-matched public client makes the old
  seven-day collection mechanism inspectable, while the deployed APK/hash and Ksana server pipeline
  remain unpinned. Treat the repository as strong attributable lineage evidence, not proof that every
  analytic participant ran that exact commit. Construction disclosure is **partial and internally
  inconsistent**; exact reproduction of the paper's daily/app-category measures is not possible from
  the public record.
- **Unresolved follow-up.** Obtain the deployed APK/version distribution and Release-3 pilot raw-file
  dictionary; identify the server code or formal specification that turned overlapping snapshots
  into daily/app-instance rows; recover the Release-3 category/exclusion maps and analysis script;
  compare archived Release-3 outputs with later reprocessed values; and audit Lind et al. (2018),
  Alexander et al. (2023), and the post-August-2024 `appusage2` event pipeline as separate versions.

### Pérez et al. (2023) — systematic review of validated screen-media tools

- **Identity.** Pérez, O., Garza, T., Hindera, O., Beltran, A., Musaad, S. M., Dibbs, T., et al.
  (2023), “Validated assessment tools for screen media use: A systematic review,” *PLOS ONE*
  18(4), e0283714, DOI `10.1371/journal.pone.0283714`.
- **Lineage and group.** Baylor College of Medicine/USDA Children’s Nutrition Research Center,
  Rice University, and Texas Medical Center Library. It does not start from Parry and Toth, although
  it cites Parry et al.’s 2021 logged-versus-self-report meta-analysis as an adjacent review.
- **Access and reading status.** **Fully audited.** All 21 article pages, all 63 references, the
  two-page PRISMA checklist, and the complete 22-line Medline Ovid strategy with March 2021 and
  June 2022 hit counts were read. PLOS labels these “S1 File” and “S1 Table” in the article, while
  the files themselves call the strategy “S2 Table”; this is a labeling inconsistency, not a missing
  third supplement. Source: [PLOS article and supporting information](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0283714),
  accessed 2026-08-29.
- **Review question and registration.** Which screen-media-use measurement tools, for any age and
  screen type, have been validated against an objective gold standard or comparable objective
  measure? PRISMA is followed and the protocol was prospectively registered as PROSPERO
  `CRD42021240268`.
- **Information sources and dates.** A medical librarian created Medline Ovid searches in March
  2021 and updated them in June 2022. The strategy was translated to Embase, Web of Science,
  PsycINFO, and Cochrane; modified natural-language searches were run in Google Scholar and IEEE
  Xplore; included-reference lists added six papers. Database-specific translated strategies,
  Google Scholar/IEEE strings and stopping depths, and exact day-level dates are not supplied.
- **Published Medline strategy.** The supplement provides all 22 executable lines: controlled terms
  and title/abstract/keyword adjacency queries covering screen time, television/motion pictures,
  games, computers/handhelds, phones/smartphones, internet/social media, distance learning; time/
  use/usage; measurement/observation/questionnaires; and validation/reliability/accuracy. The final
  English-limited line returns 10,732 in March 2021 and 12,326 in June 2022. It is substantially more
  reproducible than the search reporting in the other reviews audited so far.
- **Eligibility.** English-language studies validating a screen-use tool against a gold standard,
  any age/geography, no publication-date limit. Phone-call/text-only measurement was excluded.
  Grey literature—government reports, proceedings, dissertations, theses—was not specifically
  searched, although one IEEE conference paper ultimately appears among included studies.
- **Screening and adjudication.** Seven named authors screened titles; each title had at least two
  independent reviewers. Two independent authors then assessed abstract and/or full text. The full
  team resolved discrepancies by consensus. The phrase “abstract and/or full text” does not reveal
  a uniform full-text eligibility rule.
- **Extraction.** Authors worked independently in pairs; a third author checked results; the team
  resolved differences. A custom Microsoft Access database held forms/data. Extracted fields were
  sample/year/country/characteristics, media and tool type, comparison measure, setting, statistical
  metric, question, age group, and race/ethnicity. For multi-objective papers, only the validated
  screen-use subsample was extracted. The Access database itself is not released.
- **Flow and numerical contradiction.** The initial search is reported as 24,058 and update as 4,183,
  which sum to **28,241**. Results and the PRISMA flow instead say **28,257** titles screened—a
  16-record excess that is not explained. Of 28,257, title screening removed 26,452, leaving 1,805;
  only 23 passed abstract/full-text eligibility, and reference searching added six, yielding 29.
  Reasons are not broken down for the 1,782 eligibility exclusions. Duplicate counts and software/
  matching fields are not reported; the manuscript merely says duplicates were removed after each
  search.
- **All 29 included validation studies.** Anderson et al. (1985); Mendoza et al. (2013); Barr et al.
  (2020); Radesky et al. (2020); Robinson et al. (2006); Vadathya et al. (2022); Wade et al. (2021);
  Lee et al. (2021); Verbeij et al. (2021); Bechtel et al. (1972); Junco (2013); Berolo et al.
  (2015); Geyer et al. (2021); Faucett and Rempel (1996); Homan and Armstrong (2003); Blangsted
  et al. (2004); Douwes et al. (2007); Mikkelsen et al. (2007); Chang et al. (2008); IJmker et al.
  (2008); Yeh et al. (2009); Otten et al. (2010); Araujo et al. (2017); Zhang and Rehg (2018);
  Henderson et al. (2021); Ohme et al. (2021); Trabulsi et al. (2021); Kristensen et al. (2022);
  and Fletcher et al. (2016).
- **Instrument mix.** Eighteen evaluate self/proxy report, seven technology-only tools, and four
  both. The screens cover TV, computers, phones/tablets, social-media sites, and multiscreen
  exposure. Objective comparators include direct/video observation, electronic TV monitors,
  WorkPace/KBlog and custom computer monitors, Chronicle/EARS/Ethica/custom mobile trackers,
  iOS Screen Time screenshots, ActionDash, eye-tracking glasses, wearable light/motion sensors,
  cameras, and machine-learning gaze detectors.
- **Mobile-specific seed set.** Nine studies concern phones/tablets: Radesky, Berolo, Geyer, Lee,
  Ohme, Wade, Verbeij, Kristensen, and Barr. The review describes Chronicle as reading Android
  usage logs and returning app names/durations; iOS work uses Screen Time screenshots; EARS and
  Ethica are named commercial/research routes. These high-level descriptions must be checked in
  the primary texts and code rather than treated as construction specifications.
- **Important validation boundary.** The authors explicitly find that **no included study compared
  a mobile-device tracking app with direct or video observation**. Mobile “objective” apps were
  generally treated as comparison standards for self-report, or compared with built-in aggregates.
  Kristensen reports tracker correlations of `.99` with Android ActionDash and `.88` with Apple
  Screen Time, but agreement between derived tools does not validate the event-to-duration rule.
- **Quality appraisal.** Four authors independently scored seven COSMIN criterion-validity items;
  combined weighted kappa `.66` (95% CI `.57–.75`); consensus followed; the lowest item determines
  the global score. Four studies were excellent, four good, 12 fair, and nine poor. COSMIN evaluates
  missing items, handling, sample size, reasonableness of gold standard, design flaws, correlation/
  AUC, and sensitivity/specificity—not source-event construction reproducibility.
- **What it does not extract.** It does not systematically record app/API versions, raw schema,
  event vocabulary, timestamps/timezone/order, same-instant priority, duplicate identity, event
  pairing, foreground switches, missing closes, reboot/logger gaps, thresholds, day splitting,
  duration caps, code availability, or rerun instructions. Even the “objective gold standard” label
  can therefore hide a nonvalidated preprocessing pipeline.
- **Findings.** Technology-based tools compared with direct/video observation show higher reported
  correspondence (`.73–.99`) than self-report (`.00–.84`), but modalities and statistics are highly
  heterogeneous. Most studies measure one screen, many tools detect device-on or input rather than
  human visual attention, shared devices undermine person attribution, and multitasking across
  screens remains unresolved.
- **Review seeds.** The paper identifies Byrne et al. (2021), Bryant et al. (2007), Browne et al.
  (2021), Parry et al. (2021), Clark et al. (2009), and Kaye et al. (2020) as adjacent systematic,
  scoping, validity, or conceptual reviews. These enter the independent review queue.
- **Author-reported limitations.** Possible missed fields/keywords, inadequate communications
  coverage, English and peer-reviewed restriction, no purposeful grey-literature search, mostly
  White US/European samples, and many small or methodologically weak primary studies.
- **Availability and rerunability.** CC BY; main extraction tables, quality ratings, PRISMA checklist,
  and one exact database search are open. Translated searches, raw exports, duplicate decisions,
  item-level screening/exclusion data, Access extraction database, and analysis code are absent.
  The review is more reproducible than Ryding or Lee but not exactly rerunnable.
- **Unresolved follow-up.** Reconcile the 16-record flow discrepancy with the authors; obtain the
  Access database and translated searches; fully audit all nine mobile studies plus Chronicle,
  EARS, Ethica, SDU DeviceTracker, ActionDash, and Screen Time artifacts; read every adjacent
  review and harvest additional validation papers published after June 2022.

### Lee, Park, and Lee (2022/2023) — systematic survey of Android AS/US API research

- **Identity.** Lee, H., Park, J., and Lee, U., “A Systematic Survey on Android API Usage for
  Data-driven Analytics with Smartphones,” *ACM Computing Surveys* 55(5), Article 104, 38 pages,
  DOI `10.1145/3530814`. The final PDF says December 2022; bibliographic services also label the
  issue/publication 2023. These are one work, not two papers.
- **Lineage and group.** KAIST research group; independent of Parry and Toth. The scope is much
  broader than smartphone sessions: any English journal/conference paper using Android
  Accessibility Service (AS) or Usage Statistics (US) APIs for data collection, accessibility,
  security, interface research, or programming/testing.
- **Access and reading status.** **Fully audited.** All 38 final-version pages were read, including
  five large data tables, API-event appendices, the 2021–March 2022 update, privacy/data-quality
  guidance, all 172 references, and the rasterized PRISMA flow (visually inspected because text
  extraction omitted its counts). No external review dataset, extraction sheet, or code was found.
  Sources: [author-hosted final PDF](https://ic.kaist.ac.kr/publications/papers/lee2022systematic.pdf)
  and [arXiv record](https://arxiv.org/abs/2104.11271), accessed 2026-08-29.
- **Search scope.** Google Scholar, Scopus, ScienceDirect, Web of Science, and ACM Digital Library;
  all fields; English; publication years 2010–2020. The printed terms cover `android`, variants of
  accessibility/service/event/API/framework, `usagestats`, `usagestatsmanager`, `usageevent`, and
  Android-plus-API combinations. The paper does not state the execution date(s), result-page depth
  or stopping rule for Google Scholar, exact database syntax, export format, or a registered protocol.
- **PRISMA counts.** Initial records `n=1,877`: Google Scholar 1,513; Scopus 141; ScienceDirect 54;
  Web of Science 16; ACM DL 153. Removing duplicates and non-English papers together leaves 879,
  so the two causes cannot be separated. Restricting to journal/conference papers leaves 404
  (EP1=475); requiring AS/US terms leaves 257 (EP2=147). Of these, 181 are outside disability-interface
  improvement; 92 do not actually use AS/US (EP4), leaving IP1=89. Of 76 disability-interface papers,
  56 do not use AS (EP3), leaving IP2=20. Total included=109. The arithmetic reconciles.
- **Deduplication and screening process.** Deduplication software, matching fields, title/author
  normalization, reviewer count, independent/duplicate screening, calibration, conflict resolution,
  and item-level exclusion log are **not reported**. Duplicate removal is inseparably pooled with
  language removal in the flow diagram.
- **Eligibility and population.** English academic journal and conference papers mentioning and
  actually using AS or US APIs. Work using app-usage logs without naming those Android APIs is
  excluded; the authors explicitly name Abdullah, Asselbergs, Banovic, Chan, Stütz, Shin, and
  StudentLife among such omissions. iOS and other Android sensing routes are outside scope.
- **Extraction and classification.** The team extracted research-purpose words in the order title,
  abstract, keywords, main text, and venue; removed duplicate/unrelated words; and used affinity
  diagramming to merge, split, and label themes. It does not report how many coders performed this,
  whether coding was independent, an agreement statistic, a piloted form, author queries, or a
  released extraction sheet.
- **Included-paper structure.** IP1 contains 89 generic-purpose papers: 59 user studies and 30
  non-user studies. IP2 contains 20 disability-interface papers: 17 user studies and 3 non-user
  studies. Two papers using both AS and US are double-listed within the API subtotals but correctly
  subtracted from the 111 table entries to reach 109 unique included studies.
- **Taxonomy.** Five generic themes—usage pattern, notification, UI/UX enhancement, privacy and
  security, and programming/testing support—plus disability subthemes yield 21 subthemes. A
  four-layer data taxonomy separates interaction, system, and context sensing and then names
  concrete data such as app state, touch/scroll/text changes, notification, screen state, GPS,
  motion, network, and battery. Tables map every included paper to API class, event/data type,
  research purpose, and user-study status.
- **Directly useful primary-paper seeds.** Usage-pattern/framework rows include Menthal (Andone et
  al.), Church et al., Ferreira et al., Welke et al., Radesky et al., Yuan et al., Kraken.me,
  TinyBlackBox, and several notification systems. The full reference list also exposes Banovic et
  al.’s *ProactiveTasks*, Shin et al.’s app-usage prediction, StudentLife, and other app-usage papers
  deliberately missed by the API-name search. All are discovery records requiring primary reads.
- **What it records about upstream construction.** It usually identifies the Android API/class and
  collected data vocabulary, sometimes down to documented events such as activity resumed/paused/
  stopped, device startup/shutdown, screen interactive/keyguard, or AccessibilityEvent types. It
  explains platform capabilities, not each paper’s ordered reconstruction algorithm.
- **What it does not extract.** For the 109 primary studies it does not systematically record raw
  schema, timestamp precision/timezone, input sorting, equal-time event priority, deduplication,
  opener/closer pairing, missing/repeated boundaries, reboot/logger gaps, session gap thresholds,
  midnight splitting, caps, imputation, code/data availability, or whether a reported duration came
  from `queryUsageStats()` versus locally paired `UsageEvents`. Its tables therefore cannot answer
  how often event-to-episode construction was reproducibly disclosed.
- **Its reproducibility diagnosis.** The review explicitly separates papers with concrete third-layer
  terms (for example click, scroll, notification time, accelerometer, battery level) from papers using
  vague labels such as “UI interaction collection,” “all UI events,” “sensors,” or “context logs.” It
  lists 29 detailed-description references and eight vague-description references and argues that
  matching Android documentation terminology makes reproduction easier. This is a vocabulary
  audit, not an algorithm-disclosure audit.
- **Data-quality evidence.** The review identifies human causes (Wi-Fi/GPS/device turned off,
  changed phone, failure to follow protocol) and system causes (unsupported models/APIs, sensor
  noise/outliers, battery drain, server/logger failures). It reports that Radesky et al. removed 13%
  because of server/logger issues and notes proposed mitigations: device/OS eligibility, participant
  instructions, always-on settings, and periodic collection checks. It does not standardize how
  completeness or missingness should be computed.
- **API/version analysis.** It traces AS availability to Android 1.6/API 4 and US to Android 5/API
  21, plus notification and event additions through API 32. It notes ActivityManager tracking was
  deprecated at API 21, US research rose after 2016, AS remains necessary for interaction type/
  target, and Play policy constrains non-accessibility AS use. These version changes are material to
  cross-paper comparability.
- **Update search.** A preliminary January 2021–March 2022 search in ACM DL, Scopus, Web of
  Science, and ScienceDirect found 85 records; applying the same criteria retained 30 (12 UI/UX,
  9 privacy/security, 4 programming/testing, 3 usage-pattern, 2 notification). Google Scholar was
  omitted from this update. Exact query dates, deduplication, and the 55 exclusion breakdown are
  not supplied; the 30 are categorized in Appendix D rather than merged into the core 109.
- **Quality appraisal and synthesis.** No formal risk-of-bias or reporting-quality instrument is
  applied. The synthesis is descriptive counts, cross-tabulation, taxonomy, and narrative trend
  analysis; no meta-analysis. The paper does not grade individual construction reproducibility even
  though it frames standardized terminology as reducing reproducibility risk.
- **Author-reported limitations.** Android-only; no experimental-design or analysis-technique audit;
  API-name keywords miss custom-name collectors; broader sensing keywords would expand coverage;
  and the core search misses 2021–March 2022. Those admissions are why this review is a large seed
  source rather than a stopping boundary.
- **Availability and rerunability.** Author PDF and arXiv preprint are open. The full included
  bibliography and categorical tables are visible, but search exports, deduplication decisions,
  screening log, coding/extraction sheet, and analysis code are absent. Broad reconstruction of the
  included set is possible; exact rerun is not.
- **Unresolved follow-up.** Canonicalize all 109 core and 30 update papers against our existing
  register; pull the usage-pattern/framework and notification subsets first; separately add the
  authors’ known API-name-missed examples; then audit primary text/code for actual event pairing
  rather than inheriting this review’s data-category labels.

### Ryding and Kuss (2020) — systematic review of objective smartphone-use studies

- **Identity.** Ryding, F. C., and Kuss, D. J. (2020), “Passive objective measures in the
  assessment of problematic smartphone use: A systematic review,” *Addictive Behaviors Reports*
  11, 100257, DOI `10.1016/j.abrep.2020.100257`.
- **Access and reading status.** **Main article fully audited.** The complete article, including
  both study tables, PRISMA diagram, declarations, and reference list, was read from the Nottingham
  Trent repository. The paper points readers to its DOI for supplementary material, but neither
  the repository record nor the accessible article page exposed a separate supplement; that
  artifact remains unresolved. Sources: [repository full text](https://irep.ntu.ac.uk/id/eprint/39236/1/1294294_Kuss.pdf)
  and [version-of-record page](https://www.sciencedirect.com/science/article/pii/S2352853219301865),
  accessed 2026-08-29.
- **Review question and scope.** The review asks which passive/objective smartphone measures have
  been used to assess problematic smartphone use and what they found. It excludes active
  EMA/ESM, intervention studies, psychometric-only studies, studies without problematic-use
  outcomes, and studies of another addiction. It includes English-language peer-reviewed journal
  articles only; conference papers, theses, grey literature, and non-English work are excluded.
  Those choices make it a useful seed review, not a census of preprocessing practice.
- **Protocol and reporting framework.** The paper states that it follows PRISMA 2009. No registered
  protocol or preregistration is reported. No search start date, final search date, publication-year
  restriction, or update search is reported, which prevents an exact historical rerun.
- **Information sources.** Web of Science, Scopus, PsycInfo, and PubMed were searched, followed by
  reference-list searching. Four Boolean concept families are printed, but database-specific field
  restrictions, controlled vocabulary, syntax translations, and complete executable search strings
  are not supplied. The displayed strings also contain inconsistent spacing and wildcard use.
- **Screening.** Records were screened by title/abstract and then full text. The number of reviewers,
  whether screening was independent or duplicated, conflict resolution, calibration, and reasons
  recorded per excluded paper are not reported.
- **Flow counts and arithmetic.** Database hits were Web of Science 863, Scopus 979, PsycInfo 3,185,
  and PubMed 363, totaling 5,390. Removing 3,026 duplicates left 2,364; title/abstract screening
  removed 1,862, leaving 502 full texts. Full-text exclusions were: no problematic-use measure 104,
  review 15, no objective measure 48, psychometric focus 310, and active assessment 9, totaling
  486. Sixteen database-derived studies plus two from reference lists produced 18 included papers.
  The arithmetic reconciles. The software, matching fields, normalization, and precedence used to
  identify the 3,026 duplicates are **not reported**.
- **Data extraction.** The authors extracted sample/demographic information, methods, monitoring
  application, what the application monitored, results, and strengths/limitations. They do not
  report a piloted form, duplicate extraction, verification by a second reviewer, author contact,
  or handling of ambiguous and missing information.
- **Quality appraisal.** No formal risk-of-bias, reporting-quality, or reproducibility assessment is
  reported. Consequently, a study that names only a commercial tracker and one that publishes an
  event algorithm can both enter the narrative without their construction disclosure being graded.
- **Synthesis.** Results are tabulated and narratively synthesized. There is no meta-analysis,
  weighting by sample size or quality, quantitative heterogeneity assessment, or sensitivity
  analysis. Monitoring duration ranges from seven days to one year, and problematic-use thresholds
  vary substantially, including daily-use cutoffs from roughly four to eight hours.
- **Included primary studies (all 18).** Choi et al. (2017); Felisoni and Godoi (2018); Lee, Ahn,
  Nguyen, Choi, and Kim (2017); Lee, Han, and Pak (2018); Lin, Lin, Lin, et al. (2017); Lin, Chang,
  et al. (2015); Montag et al. (2015); Pan et al. (2019); Prasad et al. (2018); Rozgonjuk et al.
  (2018); Shin and Lee (2017); Tossell et al. (2015); Wilcockson, Ellis, and Shaw (2018); Ellis et
  al. (2019); Elhai et al. (2018); Giunchiglia et al. (2018); Lee, Lee, Ko, Lee, Kim, Yang, et al.
  (2014); and Shin and Dey (2013). Each now belongs in the primary-paper audit; the review’s summary
  is not substituted for reading the primary source.
- **Collector inventory.** Eleven studies used bespoke research systems, including Smartphone
  Overdependence Management System, SAMS, Menthal, two “Know Addiction” variants, LiveLab,
  SmartLogger, iLog, the Funf logger, and unnamed custom applications. Seven used store/OS tools:
  Moment, App Usage Tracker, Callistics, Instant, Smartphone Usage Tracker, “How Often Do You Use,”
  and Apple Screen Time. Naming a collector does not reveal its event model, version, permissions,
  sampling loss, or transformation rules.
- **Construction clues preserved by the review.** Its tables say that Lin, Chang, et al. (2015),
  Lin, Lin, Lin, et al. (2017), and Pan et al. (2019) measured use from screen-on to the successive
  screen-off; Pan classified a use as proactive when no notification appeared in the minute before
  screen-on. Shin and Dey (2013) also used screen-on/off sessions and classified the initiating
  event. Wilcockson et al. retained active/inactive timestamps and examined checks shorter than 15
  seconds. Tossell et al. retained launch timestamps and durations and derived time per interaction.
  Moment-based work delegates construction to a commercial implementation. These are discovery
  leads only: the review does not reproduce the complete algorithms or edge-case policies.
- **What the review does not extract.** It does not assess input sorting, event constants, opener and
  closer inclusion, repeated timestamps, different events sharing a timestamp, deduplication,
  missing or repeated boundaries, reboot/logger gaps, overlapping foreground apps, day splitting,
  minimum/maximum caps, timezone and clock changes, code version, or executable artifact
  availability. Its broad fields such as “screen time,” “frequency,” and “application use” cannot
  establish how upstream records became those measures.
- **Direct answer for our synthesis.** This review is strong evidence that objective-use studies
  used heterogeneous collectors and outcomes; it is **not** evidence that those studies disclosed
  reproducible upstream construction. Disclosure must be assessed in every primary paper and its
  supplements/code. Any construction phrase appearing only in this review is marked as a reviewer
  summary until verified against the primary source.
- **Conclusions and recommendations.** Total time is the most common measure but is insufficient on
  its own. The authors recommend that future applications capture hours/minutes, screen-on/off,
  most-used apps, number of launches, duration of app use, and notifications. These proposed output
  functions still do not specify event-level construction semantics.
- **Review-level limitations.** The authors acknowledge that excluding active assessment and work
  focused on broader psychological constructs narrows coverage. Additional reproducibility limits
  are the missing search dates, English/journal-only eligibility, unreported reviewer procedures,
  absent formal quality appraisal, and unreleased search, deduplication, screening, and extraction
  artifacts.
- **Further review seeds.** The reference list identifies Cornet and Holden (2018), Ellis et al.
  (2019), Bentley et al. (2019), and Elhai et al. (2017) as adjacent review or measurement-overview
  works. They enter the review-discovery queue and must be assessed independently.
- **Availability and rerunability.** The article is CC BY-NC-ND in the repository. No review dataset,
  search export, deduplication script, screening decisions, extraction sheet, or analysis code is
  linked. The numerical flow is checkable, but the search and selection are not exactly rerunnable.

### Kristensen et al. (2022) — SDU DeviceTracker criterion validation

- **Identity.** Kristensen, P. L., Olesen, L. G., Egebæk, H. K., Pedersen, J., Rasmussen, M. G.,
  and Grøntved, A., “Criterion validity of a research-based application for tracking screen time on
  android and iOS smartphones and tablets,” *Computers in Human Behavior Reports* 5, 100164,
  DOI `10.1016/j.chbr.2021.100164`.
- **Lineage and access.** University of Southern Denmark/Centic; independent of Parry, Toth,
  Winklbauer, and Batinic. **Fully audited:** all nine repository-PDF pages, figures, tables,
  declarations, and 41 references were read. The paper identifies no supplement. Sources:
  [final open repository PDF](https://findresearcher.sdu.dk/ws/portalfiles/portal/200073147/1_s2.0_S2451958821001123_main.pdf),
  [SDU publication record](https://portal.findresearcher.sdu.dk/da/publications/criterion-validity-of-a-research-based-application-for-tracking-s/),
  and the current [SDU installation page](https://www.sdu.dk/da/forskning/exercise-epidemiology/forskningsapp),
  accessed 2026-08-29.
- **Study design and sample.** Forty of 177 invited University department employees volunteered.
  Data were collected November 2019–February 2020. Participants ran SDU DeviceTracker and a
  platform-specific comparator for at least approximately one week: ActionDash on Android and
  Apple Screen Time on iOS. Installation failed on one Android; one ActionDash instance failed;
  four phones had no DeviceTracker data at follow-up; 34 people (13 Android, 21 iOS) and 277
  person-days entered analysis. Four retained participants had fewer than six days.
- **Activation and transfer.** A personal QR code supplied participant ID and measurement-period
  length. Both apps wrote events and exact timestamps to an on-device database while offline and
  sent encrypted data to an SDU server. Android uploaded every 30 minutes; iOS used GPS location
  changes to stay alive and restart after force-quit. The paper does not state server schema,
  timezone/UTC conversion, clock-change policy, database format, transmission retry semantics, or
  whether the Python processor sorts before pairing.
- **iOS raw event model.** A private, unpublished iOS API generated `1=unlock`, `0=lock`,
  `2=force quit`, and `3=power loss`. Manual and automatic locking both close use. Notification
  previews without unlocking generate no event. Streaming audio is counted until automatic lock.
  Timestamps have millisecond precision. Force-quit creates an event; GPS activity can restart the
  logger. This is unusually concrete disclosure, although the private API prevents independent
  inspection and App Store distribution.
- **Android raw event model.** Android broadcast actions `SCREEN_ON` and `SCREEN_OFF` are stored
  with exact timestamps. Notifications that illuminate a locked screen therefore appear as bouts;
  calls or music count only while the screen remains on. The app is described as continuously
  backgrounded and not manually closable, stopping only on uninstall. Timestamp precision is not
  explicitly stated for Android, despite the adjacent iOS millisecond statement.
- **Pairing and broken-sequence repair.** Expected iOS alternation is unlock then lock, except for
  force-quit or power loss. The authors observed repeated same-side events (for example unlock then
  unlock), manually logged a calibration stream to one-second precision, identified recognizable
  error patterns, and implemented repair in Python. Fifty-six percent of inconsistent events
  matched a recognized pattern and were handled without imputation. Remaining incomplete pairs
  received **60 seconds of imputed screen time**. The paper does not print the pattern table,
  branch priority, handling of equal timestamps, opener/closer endpoint convention, or pseudocode,
  so the repair cannot be exactly reimplemented from the article.
- **Maximum-bout rule.** The Python program accepts a user-set maximum to prevent a missing middle
  lock/unlock pair from creating a many-hour interval. This study used **six hours**. It counted and
  reported removed bouts; none exceeded the rule in the 201 iOS days. It is not stated whether an
  overlong bout is discarded, truncated, split, or otherwise replaced—the word “filter” does not
  settle that construction choice.
- **Notification filter.** For comparator alignment only, Android bouts under 40 seconds, equal to
  one decimal place, recurring at least three times, and comprising at least 1% of all event
  recordings were classified as notifications and filtered post hoc. This deliberately conservative
  heuristic can leave non-repeating or variable-duration notifications. The paper does not specify
  whether percentages use bouts or raw events as denominator, how floating durations are rounded,
  whether identical lengths must occur within a day or participant-wide stream, or what happens to
  the two boundary records after filtering. This is a construction rule, **not timestamp
  deduplication**.
- **Daily/hourly outputs and boundaries.** Python summarized screen time and unlocks by day and
  hour and reported registration time lost to force-quit. The paper never says how intervals crossing
  an hour or midnight are allocated, which timezone defines a day, whether partial first/last days
  are retained, or how daylight-saving/clock changes are handled. It also does not describe sorting,
  duplicate-record removal, or a priority for distinct events at the same millisecond.
- **Quality-control output.** The processor counts logical-order deviations, maximum-length bouts,
  and force-quit registration loss. Across 201 iOS days, 15 days had force-quits and 114 had at least
  one inconsistency; among affected days, median inconsistent-event proportion was 6.8%. The paper
  does not report the total number of imputed bouts or imputed minutes, only that 56% of inconsistent
  events used recognized non-imputation repairs.
- **Reference methods are not ground truth.** The authors explicitly say Apple and ActionDash do
  not disclose their detailed algorithms. ActionDash settings were standardized to resemble the
  study definition, but its notifications differ; Apple offered little configuration. The criterion
  analysis therefore measures agreement with two opaque, platform-specific products rather than
  direct observation. No manual/video ground truth was used for the 277 study days.
- **Validation results.** Android daily screen time showed mean DeviceTracker-minus-ActionDash bias
  of −0.8 minutes/day, repeated-measures correlation `r=.99`, and estimated 95% differences within
  roughly ±15 minutes/day. Android unlocks had 23.3% median positive bias, attributed to incomplete
  notification removal. iOS correlation was `.88`; DeviceTracker underestimated screen time by
  19.3 minutes/day and had wider agreement limits. The proposed iOS correction is
  `0.94 * DeviceTracker minutes + 0.07 * force-quit minutes + 25.28`; it was fitted and evaluated on
  the same sample and was not cross-validated.
- **Reproducibility of behavior.** A single day had ICC `.58`; the model estimated 2.9 days for
  ICC `.80` and 6.5 for `.90`, adjusted for day type and sex. The authors nevertheless recommend
  seven monitoring days. This concerns day-to-day behavioral stability, not software reproducibility.
- **Device failures and version risk.** Two of 23 iPhones had no data and two had less than six days.
  One of 17 Android/Huawei devices failed installation, two Huawei phones had no data, and one
  Huawei plus one Samsung had fewer than six days. The authors warn that OS updates can change app
  stability and that Huawei’s Android variant may be problematic. iOS was originally designed for
  versions 9–11; tested Android versions are not enumerated.
- **Artifact and drift audit.** The paper says source code is available **on request**, not publicly
  linked, and it is coupled to SDU servers. Web/GitHub searches found no attributable source
  repository. A later public installer page exists, while a current child-study page says the iOS
  build is out of service. A later Android installation guide asks users to enable an Accessibility
  service, whereas the 2022 paper describes broadcast `SCREEN_ON/OFF`; this may be a newer build or
  study configuration and cannot be silently treated as the validated implementation. A third-party
  listing identifies Android package `dk.sdu.devicetracker`, version 1.1.4, updated October 2018,
  but is not sufficient provenance for executable auditing.
- **Reproducibility verdict.** This is among the strongest construction disclosures found so far:
  it names raw events, pairing expectations, missing-boundary imputation, a maximum-bout parameter,
  a notification heuristic, quality-control counts, and timestamp precision on iOS. It still does
  not disclose the complete repair algorithm, chronological/tie policy, duplicate policy,
  day-boundary allocation, timezone behavior, exact schema, executed code version, or public code.
  An independent analyst can reproduce the broad estimator but **not the authors’ exact event-to-day
  transformation** from public materials.

### Geyer et al. (2021/2022) — Usage Logger paper, code, and analysis audit

- **Identity.** Geyer, K., Ellis, D. A., Shaw, H., and Davidson, B. I., “Open-source
  smartphone app and tools for measuring, quantifying, and visualizing technology use,”
  *Behavior Research Methods* 54, 1–12, DOI `10.3758/s13428-021-01585-7`. It was accepted
  2021-03-22, published online 2021-06-03, and assigned to the February 2022 issue; these dates
  refer to one paper.
- **Lineage and reading status.** Lancaster/Bath/Bristol group; independent of Parry, Toth,
  Winklbauer, and Batinic, although Ellis and Davidson later coauthored the Parry meta-analysis.
  **Fully audited:** all 12 paper pages, figures, tables, footnote, references, linked app source,
  R scripts, Python notebooks, sample exports, customization/decryption/walkthrough sites, commit
  history, and the separate Psych Validator source were read. Sources:
  [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC8863755/),
  [version-of-record page](https://link.springer.com/article/10.3758/s13428-021-01585-7),
  [Usage Logger repository](https://github.com/kris-geyer/UsageLoggerPublished), and
  [Psych Validator repository](https://github.com/kris-geyer/psychvalidaitor), accessed
  2026-08-29.
- **Version reconstruction.** The repository has changed substantially since publication and now
  calls itself Usage Logger 2. Current `master` is commit
  `150e765a387eaf5ce97e52c856501f4be8740624` (2024-06-17). The last commit before acceptance is
  `6d1f4d44560ccd9a158c04adb37c6fc988bbbd35` (2021-02-09); the audit below uses that snapshot for
  paper-era behavior. Tag `v.1.0.0` was not created until 2022-07-04 and therefore is not a precise
  execution tag for the published validation. The paper itself supplies no commit hash, release,
  build checksum, or analysis-session record.
- **System components.** The paper exposes a QR-code customization website, the Android Usage
  Logger app, a browser-based PDF decrypt/CSV converter, and R/Python analysis examples. Researchers
  can request contextual data (installed apps and permission state), retrospective Android
  `UsageEvents`, and prospective continuous events. Data remain on device until a participant
  exports AES-encrypted PDFs and separately provides the generated password.
- **Retrospective raw schema and window.** The app calls `UsageStatsManager.queryEvents(start, now)`,
  where `start` is the current wall-clock instant minus an integer number of calendar days; it does
  not snap to midnight. It iterates the returned stream without an additional sort and exports three
  fields: event timestamp in Unix milliseconds, resolved application label (falling back to package
  name), and numeric Android event type. The UI limits the QR-supplied lookback to one digit and the
  documentation says at most five days. Timezone, locale-dependent app-label drift, clock changes,
  query truncation, and partial-window treatment are not addressed.
- **Prospective raw schema and events.** Broadcast receivers record `screen off`, `screen on`, and
  `user present`; package broadcasts record install/uninstall; a notification-listener variant
  records posted/removed notifications. Every row contains `System.currentTimeMillis()` and a text
  event in encrypted SQLite. A foreground service records reboot twice—immediately and ten seconds
  later in the paper-era code. The paper-era app polls foreground identity every second only while
  the screen is on and logs a new app label when it differs from the last recorded label.
- **Foreground-app estimator.** On Android 5+, each one-second poll calls `queryUsageStats()` for the
  preceding second, keys results in a `TreeMap` by `lastTimeUsed`, and chooses the greatest key.
  Equal `lastTimeUsed` values overwrite one another in that map, with resolution depending on the
  API; there is no deterministic secondary priority. Pre-Lollipop code uses the first running process.
  The paper says the app timestamps “every interaction,” but this foreground stream is sampled state,
  not a complete event stream, and transitions between polls can be missed.
- **Prospective screen-session construction.** The published R and Python examples scan rows in file
  order, open on the first `screen on` seen while not already on, close on the next `screen off`, and
  ignore repeated opens or unmatched closes. An unmatched final open contributes nothing. There is
  no explicit input sort, timestamp-tie priority, duplicate removal, reboot-gap repair, imputation,
  or maximum session cap. Because day summaries subset rows by the opener/closer row’s local date
  before pairing, a session crossing midnight loses its cross-day duration rather than being split.
- **Prospective app-duration construction.** The scripts attach to every row the time difference to
  the next raw row, then sum those next-event gaps for rows whose label starts with `App`. Therefore
  notifications, screen events, reboots, installs, and other intervening records cut app duration;
  it is not foreground/resumed-to-background/paused pairing. The last record receives duration zero.
  The scripts assume file order is chronological and do not handle equal-time priority or overlaps.
- **Retrospective preprocessing starts by destroying precision.** Both example implementations divide
  Unix milliseconds by 1,000 and coerce to integer seconds **before** cleaning. Distinct events within
  the same second consequently acquire equal timestamps. This directly contradicts treating every
  same-time row as a true duplicate and can change rapid app-switch sequences.
- **Retrospective retained events.** The scripts keep event types `1` (move to foreground), `2`
  (move to background), `7` (user interaction), `26` (device shutdown), and `27` (device startup),
  discarding Android’s explicit screen-interactive/noninteractive and keyguard events (`15–18`).
  Durations are simply the difference to the next retained row, not matched opener/closer intervals.
- **Actual “deduplication” rules.** If a background event and following record share the now-truncated
  second and app label, the background row is dropped; depending on the preceding event type the next
  row may also be dropped. A separate rule detects **three** consecutive foreground/user-interaction
  records for the same app and drops the second and third. It does not remove a two-row repeat, does
  not compare complete rows, and is not timestamp deduplication. The notebook’s prose (“remove all
  events which are a duplicate of the one that comes before”) does not describe what its code does.
- **Duration filter and language/runtime divergence.** The examples set `tooLong=2 hours`. Python
  drops zero-duration background rows and non-background rows over two hours; the R script drops
  zero-duration background rows **and every row** over two hours. Thus the two officially supplied
  implementations produce different retained data. Their prose also says one-second background
  events are removed, while both codes test exactly zero after second truncation.
- **Retrospective “screen time” is not screen-on/off pairing.** After the above cleaning, the examples
  define screen use by excluding only event type `2` and summing all remaining next-event gaps.
  Foreground and user-interaction rows therefore count, but so do retained device shutdown/startup
  rows. The method can attribute the gap after a shutdown or startup as active use, subject to the
  two-hour filter. The paper’s simpler statement—compare a `Screen On` timestamp with `Screen Off`—
  does not describe this released retrospective calculation.
- **Day construction.** Python uses `datetime.fromtimestamp()` and R uses `as.POSIXct()`/`as.Date()`
  without an explicit timezone, so results depend on the analyst machine’s local timezone. Python
  groups by day-of-month alone; R extracts characters 9–10 from a printed date. Multiple months in
  one file would collide, although the app’s five-day limit normally avoids that. Intervals are
  assigned wholly to the row’s day rather than clipped at midnight.
- **Validation design.** Development used handwritten logs, a 46-participant field deployment of an
  earlier Activity Logger build, and automated tests on one Nokia, one Huawei, and one Google phone
  running Android 8 or later. The automated sequence requested/drove 20 screen actions, 20 app opens,
  10 notification posts/removals, and two installs/uninstalls. Reported discrepancies were generally
  milliseconds to a few seconds, and all assessed actions appeared in the expected order.
- **What the validation does not establish.** It validates event detection, not the released cleaning,
  pairing, daily allocation, app-duration, or deduplication outputs. No manually timed ground-truth
  total screen duration is compared with the final derived measure. Three phones cannot identify
  model/OS heterogeneity. The field test reports participant acceptability and recognizable plots,
  not sensitivity/specificity or duration agreement.
- **Validator artifact mismatch.** The linked Psych Validator repository has only two commits, both
  dated 2019-01-23. Its source stores one generic `screen` timestamp when a researcher marks a prompt
  complete; it does not expose separate programmatic `screen on` and `screen off` records matching
  Table 2’s ten observations of each. Its counters also request ten screen prompts, while source
  comments say 20 on/off actions. The exact code/data transformation that produced the published
  validation tables is therefore not recoverable from the linked repository.
- **Tests and build evidence.** The paper-era Usage Logger repository contains only generated example
  tests (`2+2=4` and a package-name assertion that expects a different package), not tests of event
  reconstruction. The paper-era build targets Android 29, version `1.102`, package
  `geyerk.sensorlab.suselogger`. The repository did not gain its Apache-2.0 license file until
  2022-08-13, after publication, despite the paper calling all software open source.
- **Availability today.** Source, historical commits, sample raw/processed exports, and analysis
  examples remain public. The original Play package/link in the paper differs from the current
  Usage Logger 2 package and current code. This is valuable provenance, but researchers must pin a
  commit and must not assume current `master` is the validated 2021 implementation.
- **Reproducibility verdict.** This is the most inspectable upstream pipeline in the corpus so far,
  and that inspection reveals consequential choices absent from the narrative: precision truncation,
  sequence-dependent deletions, next-row duration assignment, timezone-dependent day grouping,
  cross-midnight loss, disagreement between R and Python, and an unreconciled validator artifact.
  The broad workflow is reproducible from public artifacts; the published validation and a single
  canonical event-to-duration result are **not** reproducible without choosing among conflicting
  implementations and supplying missing tie/day policies.

### Parry et al. (2021) — logged versus self-reported media-use systematic review

- **Identity.** Parry, D. A., Davidson, B. I., Sewall, C. J. R., Fisher, J. T., Mieczkowski, H., and
  Quintana, D. S., “A systematic review and meta-analysis of discrepancies between logged and
  self-reported digital media use,” *Nature Human Behaviour* 5, 1535–1547, DOI
  `10.1038/s41562-021-01117-5`.
- **Lineage and reading status.** The review is an independent Stellenbosch/Bath/Pittsburgh/Stanford/
  Oslo collaboration. It does not start from Parry and Toth; Parry is an author, not a named
  preprocessing lineage. **Fully audited:** all 19 article pages and references; the 32-page
  preregistered protocol; the 12-page supplementary analyses; the six-page reporting summary; the
  complete 64-page transparent peer-review file; the one-sheet extraction workbook; every released
  search-export and clean-data file; all 1,850 lines of the R Markdown analysis; and the complete
  Git history were read. Sources: [publisher article and supplements](https://www.nature.com/articles/s41562-021-01117-5),
  [OSF project](https://osf.io/dhx48/), and
  [GitHub repository](https://github.com/dougaparry/Media_use_meta), accessed 2026-08-29.
- **Search universe.** The search was run 2020-05-31 in PubMed, Scopus, PsycINFO, ACM Digital
  Library, Communication & Mass Media Complete, and ProQuest Dissertations & Theses, with manual
  searches of five journals, forward/backward citation searches, and public calls. The six database
  exports contain 11,620 records, the five journal exports 502, and public calls contributed 10,
  matching the reported 12,132 starting records. The review reports removing 1,326 duplicates,
  screening 10,806 titles/abstracts and 224 full texts, and including 47 papers after citation
  expansion. The released `after_removal_of_duplicates.csv`, however, has **10,799**, seven fewer
  than the PRISMA count. No deduplication code, matching keys, priority rules, adjudication log, or
  explanation for the seven-record discrepancy is released. The CSV is an output, not a reproducible
  duplicate-removal procedure.
- **Included evidence.** Forty-five included items were published papers or preprints and two were
  unpublished author-supplied datasets. The extraction workbook has 106 nonblank comparison rows,
  47 paper IDs, and 54 study IDs. Sixty-six usage-correlation effects from 44 studies represented
  52,007 participants; 40 problematic-use effects from 19 studies represented 5,552; 49 accuracy
  comparisons from 30 studies represented 17,523. The reported pooled usage correlation was `.38`,
  problematic-use correlation `.25`, and ratio of self-reported to logged means `1.21`; only three of
  49 accuracy comparisons fell within the review's ±5% criterion.
- **What the preregistered extraction actually captured.** Required fields covered bibliographic
  identity, sample/population, self-report source, **label of the log source**, medium, reported
  measurement, and logging duration, plus correlations and descriptive statistics. The released
  workbook later adds broad categories such as built-in, custom research tool, operator, third party,
  data donation, direct tracking, and supplied data. It does **not** ask for raw event types, schema,
  timestamp unit or resolution, sorting, simultaneous-event priority, duplicate semantics, session
  pairing, missing-boundary repair, maximum-gap rules, background/idle handling, midnight splitting,
  timezone, partial-day rules, exclusions, software version, commit, or executable construction code.
  The review was therefore designed to compare reported final measures, not to establish whether
  those measures could be reconstructed from raw traces.
- **Collector evidence preserved by the workbook.** Across 106 effect rows the largest labels are
  iOS Screen Time (31), custom app (18), telco logs (6), and Facebook logs (6), followed by numerous
  named third-party or research tools. The category counts are 34 built-in, 27 custom-built for
  research, 24 third-party, 20 operator, and one “other.” These are effect-row counts, not counts of
  unique papers or validated implementations. A label such as “Custom App” does not disclose how
  usage was constructed.
- **Workbook integrity problems.** Three paper IDs contain multiple incremented DOI strings even
  though they identify one work: Boase and Ling has `.12021` and `.12022`; Ellis et al. has nine
  values from `.004` through `.014`; Ernala et al. has six values from `.3376435` through `.3376440`.
  These appear consistent with spreadsheet autofill rather than real per-comparison identifiers and
  make the workbook unsafe as an unchecked citation authority. The source literature and DOI
  registries must be consulted paper by paper.
- **Data added by author contact and analyst construction.** The workbook records missing
  correlations, descriptive statistics, or raw data obtained directly from authors; plot digitization;
  selection among reported periods; exclusion of notification comparisons; and, for one unpublished
  dataset, analyst-created sums across four platforms before computing a correlation. Those choices
  are usefully disclosed in free-text comments but are not accompanied by correspondence, raw
  supplied datasets, transformation scripts, or a decision log sufficient to recreate every effect.
- **Analysis implementation.** The script uses R 4.0.2, reads the workbook, converts 19 Spearman
  correlations through `r = 2*sin(r_s*pi/6)`, computes Fisher-z correlations and correlated ratio-of-
  means effects, and fits random-effects and robust-variance models with an assumed within-study
  correlation of `.80`. It creates three clean datasets and extensive sensitivity, subgroup, moderator,
  forest-plot, and funnel-plot outputs. The repository has an MIT license but no dependency lockfile,
  package-version manifest, rendered notebook output, continuous test, or cited execution commit.
  The paper and OSF link to a moving repository rather than a hash or release.
- **Protocol deviations and additions.** The final work uses R 4.0.2 rather than the protocol's 3.6.3;
  replaces the preregistered `metafor` synthesis with `robumeta` robust variance estimation for main
  estimates; changes the Spearman-to-Pearson conversion after review; adds a Q-SSP quality appraisal;
  adds distribution inspection, correlation-type sensitivity analyses, three families of post hoc
  moderators, and multi-moderator models; and adds a late effect with a sensitivity analysis. The
  article labels major deviations and post hoc work, while the peer-review file supplies the fullest
  rationale and shows that many additions were reviewer-requested.
- **Quality appraisal does not test upstream validity.** Three authors applied an adapted Q-SSP to 45
  papers; 55.56% were rated acceptable, mean score 66.60. But item 12, measure validity, was coded
  not applicable for every paper. The adapted assessment emphasized survey reporting, sample size,
  collection context, and discussion scope; it did not require validation of the tracking tool or audit
  event-to-duration construction. Consequently “acceptable quality” cannot be read as “reproducible
  logged-use pipeline.”
- **The peer-review record identifies the core blind spot.** Reviewer 3 explicitly warned that logs
  can contain device/software failures, background activity, and open-but-unattended apps, and that
  duration is often inferred between successive timestamps. The revision expanded its narrative
  caveats and coded the broad logging-method categories, but it did not re-extract construction
  algorithms from the 47 sources. The authors state that a complete treatment of logging details was
  beyond scope. That is a legitimate scope choice, but it means this review cannot answer which
  upstream constructions generated its supposedly objective measures.
- **Released-code errors.** The final R Markdown contains at least two material copy/paste defects in
  post hoc accuracy analyses. The data-donation subgroup's point estimate is read from the previously
  fitted **student-population** model while its confidence interval and p-value come from the donation
  model. The final “accuracy” multi-moderator dataset is mistakenly created from `use_corr_data`
  instead of `acc_data`, then exponentiates correlation-model coefficients as ratios. Git blame dates
  the first defect to the 2020-12-10 reviewer-requested moderator commit and the second to the
  2021-01-07 update. A further late-effect block prints the wrong already-existing model object before
  correctly transforming the new model. The published primary pooled results are not shown to depend
  on these post hoc blocks, but the affected subgroup/omnibus claims require correction and rerun.
- **Version history and reproducibility.** The public history runs from 2020-06-03 through current
  head `ad41a473b0273bcedd0e8d7e48a3c6c3c934db8a` dated 2021-01-20. The post-review code additions
  precede the 2021-03 first-revision decision, but the repository ends before final acceptance and has
  no release tag. The original search exports, deduplicated export, extraction workbook, clean data,
  scripts, and figures are unusually transparent. They permit close auditing of the meta-analysis but
  not exact recreation of screening/deduplication, author-supplied transformations, or upstream
  logged-use construction.
- **Reproducibility verdict.** Parry et al. is an important discovery map and a comparatively open
  quantitative synthesis, not a census of reproducible raw-event pipelines. It gives us 47 concrete
  studies to audit and useful collector categories, yet its own extraction design omits the choices
  that define phone-use duration. Its released search count disagrees with its PRISMA count, its
  workbook contains citation-field corruption, and its post hoc code contains two substantive model/
  dataset mix-ups. Every included paper still needs an independent full-text, supplement, artifact,
  and code audit before its upstream construction can be classified.

### Schoedel et al. (2026) — integrative mobile-sensing preprocessing case study

- **Identity and what “Schoedel” means here.** Ramona Schoedel, Larissa Sust, Philipp Sterner, and
  David Goretzko, “From Digital Data to Psychological Insights: Making Sense of Mobile-Sensing Data
  through Integrative Preprocessing Pipelines,” *Psychometrika* 91, 761–788, DOI
  [10.1017/psy.2026.10083](https://doi.org/10.1017/psy.2026.10083). Schoedel is the surname of the
  joint first author and principal code author, not a method, standard, event-order authority, or
  named pipeline inherited by Chronicle. The paper is an exploratory methods/case-study article. It
  is neither a systematic review nor a field-wide specification.
- **Lineage and relation to Parry and Toth.** The work uses one Android PhoneStudy/Smartphone
  Sensing Panel Study dataset and adapts functions credited in code to Schoedel et al. (2023), Stachl
  et al. (2020), Quay Au, and Fiona Kunz. It cites Parry and Toth (2025) for Android accessibility-event
  documentation, ambiguous event patterns, “standard practices,” and further procedural guidance.
  It does **not** say that its released implementation starts from, forks, or reproduces Parry and
  Toth's code. The preprocessing scripts use a 2023 package date and contain older adapted-function
  lineage, while the analysis scripts use a 2025 package date. The defensible relationship is
  conceptual citation, not executable descent.
- **Material read.** **Fully audited:** all 28 pages of the final Cambridge article from first page
  through references; the complete five-page codebook; OSF README; all 28 released R files (3,042
  lines); all three released RDS files; OSF file metadata and version history; and bundled RStudio
  state/history files. Sources: [publisher PDF](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/00A9F0AC082318C4EDC1CE1099E33E96/S0033312326100830a.pdf/from-digital-data-to-psychological-insights-making-sense-of-mobile-sensing-data-through-integrative-preprocessing-pipelines.pdf)
  and [OSF project](https://osf.io/tmuhe/), accessed 2026-08-29. Each top-level OSF artifact has only
  one version, uploaded 2025-11-27; the project supplies no license, Git history, release tag, commit,
  checksums in the paper, issue record, or preregistration for the preprocessing choices.
- **Dataset and collector.** PhoneStudy logged 13 sensing modalities during the German Smartphone
  Sensing Panel Study from May through November 2020. Participation lasted three or six months;
  Android 5 or later was required. The examples use a common subset of 538 participants who had at
  least ten wave-1 EMAs and data in all three case datasets. The article says app usage was captured
  as event-triggered Android accessibility events with package name and millisecond-resolved
  timestamps. It names event 1 (`activity resumed`), event 2 (`activity paused`), and event 23
  (`activity stopped`). The table that makes these records look orderly is explicitly described as
  artificially generated, simplified, and value-adjusted; it is not a sample of the audited raw data.
- **Raw access and schema limits.** The code queries private MariaDB tables including `ps_activity`,
  `ps_location`, `ps_esquestionnaire`, `ps_esanswer`, `ps_user`, `ps_participant`, and
  `ps_communication`. The raw sensing/GPS/EMA database is withheld under the GDPR. The codebook
  documents only the three aggregate outputs, not the raw database schema, device-side logger
  version, Android-version-specific event behavior, clock source, insertion-order guarantee, or the
  semantics of `id` versus `client_db_id`. Database credentials and host details are appropriately
  absent, but so are the survey-preprocessing script, smartphone-change file, per-user intermediate
  CSVs, GPS-home files, extraction error log, and `app_categorisation_2020_v2.csv`. The category file
  is methodologically indispensable because it defines both system-app deletion and the 25 output
  categories.
- **Timestamp correction.** The raw `timestamp` is parsed and sorted, zero timezone offsets are
  changed to missing, and each missing offset is imputed by the mode of a nominal ten-neighbor row
  window. The code adds `timezoneOffset/(60*1000)` minutes and leaves the resulting local wall time
  labelled as UTC, expressly instructing users to ignore the UTC designation. It deletes records not
  in 2020 and then retains the first row per `client_db_id`. Thus its explicit duplicate identity is
  the device-side row ID—not timestamp equality. The imputer is sequence-dependent, has asymmetric
  edge behavior, can form an out-of-range window near the tail, and treats a genuine UTC offset of
  zero as missing. DST changes and travel are not separately validated.
- **Same-time events and ordering.** No microsecond splitting or event-type priority exists anywhere
  in the released pipeline. General preprocessing sorts only by corrected timestamp. App
  preprocessing then sorts app rows by `timestamp.corrected, name`, so different app events at an
  identical instant are broken alphabetically by the human-readable app name. Screen preprocessing
  inherits timestamp order without a secondary key. Neither the paper nor code says that database
  row order is stable after equal-key sorting. Consequently the output can depend on app labels and
  unspecified sort stability. Parry and Toth is cited narratively but no priority table is imported
  from it.
- **Screen-event cleaning and phone-session construction.** The function keeps `activityName ==
  "SCREEN"` and scans adjacent screen rows in their inherited order. If two adjacent screen event
  names match, it deletes the second—even when client IDs and millisecond timestamps differ—and
  imposes no maximum time gap. It removes screen events during calls from call start through reported
  call length plus one second, deletes an `OFF_UNLOCKED` immediately preceding `ONHOLD`, deletes an
  `OFF_UNLOCKED` followed by `ON_UNLOCKED` within ten seconds, and removes the second of adjacent
  `ON_UNLOCKED` events. Usage sessions are recognized only from adjacent screen-subsequence patterns
  `ON_UNLOCKED -> OFF_LOCKED` (commented as Huawei) or `ON_UNLOCKED -> OFF_UNLOCKED` (Samsung);
  sessions separated by under five seconds are merged. `ON_LOCKED -> OFF_LOCKED` becomes a separate
  checking session, and the complement becomes non-usage. These rules are code-only and are not
  accompanied by validation counts or handset/OS tests.
- **App-event filtering and interval construction.** System-app package names are drawn from rows
  whose category rating is `System`; package filtering then compares `packageName` with the category
  file's `App_name`. The missing lookup prevents checking whether those fields really contain matching
  package identifiers. The function removes `STANDBY_BUCKET_CHANGED`, notification-seen,
  notification-interruption, `USER_INTERACTION`, and unknown events 19, 20, and 23. Within a labeled
  phone-use session, rows with the same package as the prior app row inherit its app-session label;
  otherwise a new app-session label begins. Despite the prose defining event 1 as the opener, this
  principal labeling step does not require event 1 to open a session and does not end a session at a
  pause or stop; transitions are primarily inferred from adjacent package changes and screen labels.
- **Anomaly repair.** Consecutive event-2 records for one package more than 15 seconds apart cause the
  later block to be relabelled. For app sessions with only one event, the function searches fixed
  windows of ten database-ID positions before and after the event, may attach the row to a nearby
  session when neighboring package/screen conditions match, and otherwise deletes its label. These
  are row/ID windows, not elapsed-time windows. Remaining one-event sessions are set missing. No
  report gives the number affected by each repair, its false-match rate, or sensitivity to the 10-row
  and 15-second constants.
- **Session summarization and additional cutoffs.** Sessions are grouped by shifted day, app label,
  and package; their first and last retained timestamps define duration. Sessions of at most one
  second are deleted and durations over six hours are set missing. A correction for sessions longer
  than 60 minutes attempts to replace the end with the next start when overlap is detected, but it
  uses an app-label value plus one as a dataframe row index. Later, same-package sessions no more
  than three seconds apart are intended to merge. That loop derives its ranges from transitions in a
  lagged equality flag and is not a general, transparently tested adjacent-session merge. None of the
  one-second, three-second, 15-second, ten-row, 60-minute, or six-hour choices has a cited empirical
  validation in the paper or code.
- **Day, zeros, and person-level measures.** A behavioral day is computed by subtracting six hours,
  corresponding to 06:00 through 05:59 local-labelled time. Sessions are grouped by that shifted date
  rather than explicitly split at the boundary, so a session crossing 06:00 remains assigned by its
  retained event rows/grouping behavior rather than a documented interval-splitting contract. Daily
  counts and minutes are calculated for apps/categories. Missing app-day values become zero if that
  participant has at least one session for that app/category anywhere in the available data; they
  remain missing otherwise. The paper says this follows plausibility checks excluding logger error,
  but the released code contains no daily completeness calculation. Person-level “average” measures
  are actually medians, and the analysis deliberately permits a median based on one valid day.
- **Case 1, GPS enrichment.** GPS was logged at model-dependent 10–60-minute intervals, on location
  changes through Google Fence, and when EMAs opened through Google Snapshot. Only participants with
  over 1,000 GPS rows receive home estimation. Up to 5,000 distinct coordinate/timestamp rows are
  sampled without a published random seed; home is the most frequent DBSCAN cluster during 01:00–
  05:00 (`eps=30` metres, `minPts=3`), with the first cluster chosen on a tie and the mean coordinate
  used as home. All GPS records within 30 metres are labelled home. Labels are then forward-filled
  across every intervening sensing row until the next GPS label, and an app session's location is the
  modal row label, first on ties. The prose instead describes assigning location at initial opening;
  this is a paper/code discrepancy. Sparse sampling, mobility between GPS fixes, random subsampling,
  and the 30-metre threshold receive no reported sensitivity analysis.
- **Case 2, EMA windows.** Each EMA receives a 60-minute window, 30 minutes before and after its
  corrected start; the paper expressly calls this choice somewhat arbitrary and says clear guidance
  is lacking. Synthetic boundary rows are inserted into the session summary and overlapping sessions
  are clipped at those boundaries. The master script tries to remove EMAs less than 60 minutes apart,
  but calls `difftime()` without fixing its output units and compares the resulting numeric values to
  60. Because `difftime` chooses display units from the data, this test is unit-dependent. The analysis
  then replaces **every** missing value in the seven-column Case-2 dataset with zero, not just missing
  app predictors, before retaining users with at least ten observations and fitting the GLMM. In the
  released aggregate file the outcome has no missing values, but three duration/count columns do;
  the blanket operation is broader than its comment.
- **Case 3, sleep windows and prediction.** App counts and minutes in all 25 non-system categories are
  aggregated for the three hours before self-reported sleep. Complete outcome rows are retained;
  sleep times are manually recoded and restricted to after 19:00 or before 03:00. A random forest is
  evaluated with ten-fold participant-grouped cross-validation and no tuning. From the released data,
  the public analysis code reproduces the paper's 534 participants, 8,429 days, mean 16 days, and
  range 1–24 before model fitting. The paper reports worse-than-mean prediction for both outcomes and
  appropriately declines to present the proxy as successful.
- **Material script/data provenance contradiction.** The master script correctly constructs
  `data_c3_user_w2`, corrects its timestamps, and preprocesses wave-2 sensing. But at feature
  extraction it calls `app.features.c3(sensing_w2, data_c3_user_w1, ...)` and tests whether the
  wave-1 rather than wave-2 EMA table is nonempty. Literal execution would attach wave-1 questionnaire
  rows to wave-2 sensing. The released `data_c3.rds`, however, contains 5,227 wave-1 and 3,754 wave-2
  rows with 8,981 unique questionnaire IDs and no repeated user/questionnaire key, which is
  inconsistent with that erroneous call. The aggregate file therefore appears to have been produced
  by corrected or different code that was not released. The integration script is also not runnable
  as published: it references absent survey and smartphone-change files and undefined objects
  `data_123`, `data_4`, and `data_5`; it assigns `data_3$wave` using `data_5$notificationTimestamp`.
- **Reproducibility and evidential verdict.** All 28 R files parse, and the supplied aggregates support
  several published descriptive counts. The upstream event-to-session pipeline cannot be rerun or
  validated because the raw data, category map, intermediates, handset/version diagnostics, and
  extraction log are missing. More importantly for Chronicle, this paper supplies no principled
  same-timestamp event priority and no microsecond separation. Its real code uses alphabetical app
  names for equal timestamps, deletes some nonidentical screen records as “duplicates,” and contains
  multiple undocumented thresholds and a demonstrably nonmatching wave-2 extraction script. It is a
  useful concrete example of why full artifact reading matters, not an implementation authority to
  copy wholesale.

### Parry and Toth (2025) — Android event-log methodological primer

- **Identity and access.** Douglas A. Parry and Roland Toth, “Extracting Meaningful Measures of
  Smartphone Usage from Android Event Log Data: A Methodological Primer,” *Computational
  Communication Research* 7(1), 1–32, DOI
  [10.5117/CCR2025.1.8.PARR](https://doi.org/10.5117/CCR2025.1.8.PARR). The DOI printed by
  Winklbauer and Batinic omits `.8` and does not resolve; the form above is the DOI on the article.
  The article is CC BY 4.0. **Fully audited:** all 32 pages and references; all nine public OSF files;
  both available versions of the R code and pseudocode; all 5,000 sample input rows; all 353 sample
  result rows; all 193 excluded packages; all 5,742 package/name mappings; and the Android-version
  and manufacturer/model tables. Sources: [open article PDF](https://www.aup-online.com/deliver/fulltext/26659085/7/1/CCR2025.1.8.PARR.pdf)
  and [OSF project](https://osf.io/5bekx/), accessed 2026-08-29.
- **What kind of source it is.** This is a design-science primer proposing a nine-step construction,
  not an empirical effects paper or systematic review. It assumes that a research app, commercial
  tool, or framework has already delivered the complete raw Android `UsageEvents` log. Its sample
  derives from Toth's 2023 MART study of 1,226 German Android users observed for seven days, but the
  released worked input is a random 5,000-event subset from ten devices. The random-extraction code,
  seed, original full event data, collection completeness checks, and MART version/commit used are
  not supplied here.
- **Raw schema and clock.** The expected table has one row per event and at least user/device ID,
  millisecond Unix timestamp, event type, package name, and class name. The paper correctly notes
  that Android event rows do not contain timezone and says offsets must be acquired separately and
  frequently if local time matters. It supplies no timezone-joining algorithm. The sample has only
  user ID, package, event type, and timestamp—no class, timezone, source-row ID, OS version, or device
  ID separate from user ID. The code never uses class name despite the paper calling it required.
- **Retained observations.** Step 1 keeps types 1 (`ACTIVITY_RESUMED`), 15 (screen interactive), 16
  (screen non-interactive), 17 (keyguard shown), 18 (keyguard hidden), 26 (shutdown), and 27
  (startup). It discards pause (2), stop (23), foreground-service and every other event. It also
  removes package `android` from episode openers and filters a public list of 193 background-system
  packages. Launchers are intentionally retained. The authors explicitly warn that the list should
  be adapted rather than blindly applied; it was constructed from an event-log dataset of 1,103
  people collected in late 2023. No adjudication protocol, per-package evidence, versioning rule,
  sensitivity analysis, or observed impact of this filter is supplied.
- **No deduplication stage.** Neither the nine-step procedure nor R code removes duplicate raw rows,
  defines duplicate identity, reconciles overlapping polling batches, or chooses among repeated
  records. The sample has no exactly duplicate full rows, so this omission is not exercised. It also
  has no startup/shutdown events after filtering, so the reboot branches are not exercised by the
  advertised end-to-end example.
- **Sorting and same-timestamp events.** The raw screen/keyguard stream is grouped by user and scanned
  for adjacent events **before any sort is performed**. Therefore, the procedure silently requires
  each participant's source rows to arrive chronologically. The paper never declares that precondition
  or a physical-row identifier. App events and constructed boundaries are later row-bound and sorted
  only by user and millisecond timestamp. There is no microsecond separation, source-row secondary
  key, event-type priority, or stated equal-time rule. Because episode rows are placed in the combined
  table before boundary rows, a stable equal-key sort would implicitly put app opens before screen
  boundaries, but that is an implementation side effect, not a declared scientific policy. The raw
  sample contains 278 rows in 104 user/timestamp tie groups (maximum 11); the current filter happens
  to leave at most one retained event from each of those groups, so the example does not test a
  collision among two retained event types.
- **Device-use sessions and glances.** On a stream projected to types 15–18 and 26–27, screen
  interactive (15) is labelled a session start if directly adjacent to keyguard hidden (18), otherwise
  a glance start. Screen non-interactive (16) is labelled a session stop if directly adjacent to
  keyguard shown (17), otherwise a glance stop. Startup (27) is a session start and shutdown (26) a
  session stop. Keyguard rows are then removed. A start survives only when the next projected row is
  the same-kind stop, and a stop only when the preceding row is the same-kind start; reversed
  noninteractive/interactive artifacts, orphan boundaries, duplicate starts/stops, and incomplete
  heads/tails are deleted rather than repaired. Duration is stop timestamp minus start timestamp.
  This is an adjacency classifier, not a general lock-state machine, and arbitrary non-boundary raw
  events are invisible because classification runs on the projected stream.
- **App-episode construction.** Type-1 rows other than package `android` become app starts. After
  combining them with retained session/glance boundaries, a type-1 row is deleted if the immediately
  preceding combined row is also an episode of the same package. Every surviving episode ends at the
  timestamp of the next combined row—another app opener or a session/glance stop. IDs are filled down
  from session/glance starts; a zero at a stop prevents following episodes from inheriting the closed
  container. Episodes outside both a session and glance are deleted. Episodes whose next row is not
  a different-package episode or a container stop are also deleted. There is no use of pause/stop,
  maximum duration, inactivity threshold, midnight splitting, tail censoring flag, or explicit
  multiwindow/concurrent-app model.
- **Same-app and launcher consequences.** Consecutive type-1 events from the same package collapse
  only when they remain adjacent after screen boundaries and other-package openers are introduced.
  Repeated activity/class resumes within an app are thereby coalesced without using class, while a
  launcher type-1 row closes the current app and begins a counted launcher episode. The procedure's
  operational definition is thus “time until the next retained app opener or container boundary,”
  not observed launch-to-pause/stop time and not necessarily foreground attention.
- **Published pseudocode errors.** Code 3 in both the article and current OSF pseudocode says
  `event_type IN [16, 27]` for the startup/shutdown session condition; this makes every type-16 row a
  session and omits shutdown (26). The surrounding prose and R code use 26/27, demonstrating that
  the pseudocode is wrong. The next pseudocode instruction says `FILTER WHERE use_type NOT IN
  [17, 18]`; because `use_type` contains strings such as `session` and `glance`, it cannot remove
  keyguard events. The R code correctly filters `event_type`. The final code block also calls its
  boundary type `smartphone`, whereas every earlier block and the R implementation use `session`.
  A reader implementing the published pseudocode literally will not obtain the R procedure.
- **Artifact revision mismatch.** `rcode.R` and `pseudo_code.txt` each have two OSF versions. Revision
  2, dated 2025-02-25, changes the final R output by removing `use_state`; the posted
  `sample_results.csv`, uploaded 2024-08-01 and never revised, still has `use_state` and therefore
  corresponds to revision 1. The article's Table 5 omits `use_state`, matching revision 2's schema.
  The current public script consequently cannot reproduce the still-public result file byte-for-byte.
  Revision 2 changes only that output selection and a logically equivalent final NA expression in
  pseudocode; it does not fix the pseudocode's event-16/26 or wrong-variable errors.
- **Sample and claimed testing.** Filtering the sample with the current package list retains 1,222 of
  5,000 rows (898 type-1 rows plus 324 screen/keyguard rows) and removes 108 otherwise-retained rows
  by package. The posted result contains 267 episodes, 57 sessions, and 29 glances, all with positive
  nonmissing duration. This is a worked example, not a validation against observed human behavior.
  The paper says the method ran “without issue” across Android 10–14, 314 models, and 31
  manufacturers, but provides only count tables—no ground truth, error criteria, event-pattern
  frequencies, output comparisons, failure log, or handset-specific tests. The OSF table includes
  55 Android-9 users and ten unknown versions; its model table contains 32 nonmissing manufacturer
  labels (33 including missing), so the published 31 requires an undocumented normalization or
  exclusion.
- **App-name artifact.** The mapping file provides 5,742 unique package/name pairs without blanks.
  The scraper is time-sensitive and Play-Store-only, as the paper acknowledges. The released script
  attaches `tidyverse` but calls `read_html`, `html_element`, and `html_text2` without attaching or
  qualifying `rvest`, which is not one of the core packages attached by `library(tidyverse)`; in a
  clean R session the script is therefore incomplete. It defines lookup functions but supplies no
  driver, input, output write, captured retrieval date per package, HTTP-error log, or category
  normalization.
- **Availability and reproducibility verdict.** This is the clearest fully public paper-level
  construction in the corpus so far, and the sample plus code make most of its intended logic
  inspectable. It does **not**, however, justify treating the method as a complete upstream standard.
  It omits deduplication, input-order validation, same-time priority, timezone joining, collection-gap
  handling, and empirical ground-truth validation; its sample misses the reboot paths and retained
  collisions; its pseudocode contradicts its R code; and its current code/result versions disagree.
  Chronicle may implement it as one named, source-pinned multiverse branch, but must state its own
  collision/source-order completion rules and must not attribute those additions to Parry and Toth.

### Toth and Trifonova (2021) — ATT reactivity study and the empirical ancestor of the primer

- **Identity, lineage, and access.** Roland Toth and Tsvetelina Trifonova, “Somebody’s Watching Me:
  Exploring the Effect of Passive Tracking on User Behavior,” *Computers in Human Behavior Reports*
  4, 100142, DOI [10.1016/j.chbr.2021.100142](https://doi.org/10.1016/j.chbr.2021.100142).
  This Freie Universität Berlin study predates Parry and Toth (2025). It is a direct empirical ancestor
  of that primer's event-log approach, not an implementation of the later primer. **Fully audited:**
  all 11 pages of the final article and all 42 pages of its author preprint; the complete 754-line R
  Markdown analysis; every one of the 59,477 released session rows and all 25 columns; and all 14
  pages of the per-participant visualization appendix. Sources: [repository copy of the final
  article](https://refubium.fu-berlin.de/bitstream/fub188/33964/1/Somebody_is_watching_me.pdf),
  [preprint record](https://osf.io/preprints/socarxiv/7aqdx), and [publisher supplementary ZIP](https://ars.els-cdn.com/content/image/1-s2.0-S2451958821000907-mmc1.zip), accessed
  2026-08-29. The downloaded ZIP's SHA-256 is
  `25b80bc2d6cf962cf284b8246758f6168009a2a0e55cf0ac3f0ad5e8e4e8d827`.
- **Collector and study design.** The authors built the Android app A Tricky Tracker (ATT). It read
  the device's retrospective usage-event log, which commonly held up to about two prior weeks, and
  then synchronized prospective events in JSON batches to a server. Twenty-five people were recruited
  by convenience sampling for data collection from 2019-12-12 through 2020-01-11 and could participate
  for up to 14 days. ATT could actively add lock, unlock, boot, and shutdown signals after installation
  on Android 8 or earlier, but equivalent retrospective screen boundaries did not exist there. The
  authors therefore restricted the analyzed release to Android 9, whose OS log supplied comparable
  boundaries before and after installation. The paper names neither an ATT release nor a source-code
  repository, APK checksum, parser commit, server schema, synchronization overlap rule, or ingestion
  ordering guarantee.
- **Raw schema and session definitions.** A private Python parser first turned JSON into one row per
  raw event with Android version, event type, millisecond timestamp, package, and foreground state.
  Phone sessions begin at keyguard hidden (18) or boot (27) and end at keyguard shown (17) or shutdown
  (26). App sessions begin at activity resumed (1) and end at activity paused (2), keyguard shown (17),
  or shutdown (26); a “consistent sequence” of activities belonging to the same app is merged. Duration
  is closing timestamp minus opening timestamp and frequency is the number of constructed sessions.
  These statements establish the intended boundary vocabulary, but neither article supplies the
  pairing algorithm for orphan/repeated/interleaved events, the definition of “consistent,” the
  treatment of app switches without pause, or a state machine.
- **The released data are downstream, not raw.** Despite the final article's statement that “all data”
  and code are in the supplement, `data_all.csv` is an already-cleaned, already-sessionized analysis
  table. Its 14,330 phone rows retain only opener types 18 (14,327 rows) and 27 (three); its 45,147 app
  rows retain only opener type 1. The matching closing event type, closing row, class/activity sequence,
  original row identifier, batch identifier, and intervening raw events are absent. Duration is already
  attached to each opener. The R Markdown starts by reading this table and performs statistical
  filtering and modelling only; it contains none of the advertised Python extraction, aggregation,
  package exclusion, first/last-day removal, five-hour cutoff, or Google Play scraping. Thus the public
  package can audit the downstream analysis but cannot reproduce or test raw-event-to-session construction.
- **Ordering, duplicates, and equal instants.** The paper and supplement disclose no raw sort command,
  chronological-input assertion, duplicate definition, polling-batch reconciliation, equal-timestamp
  priority, or stable source-row key. Android timestamps are in milliseconds; no microsecond data or
  microsecond tie splitting exists. The already-built release is monotonically ordered within person
  and stream and contains no duplicate complete rows. It has one equal start instant across streams: a
  phone session and WhatsApp session start together for one participant. Reconstructing endpoints as
  `start + duration` yields one further exact millisecond collision where an app ends as another app
  starts. Those downstream coincidences do not reveal which raw event won a tie or whether upstream
  same-time rows were reordered, combined, or discarded.
- **Cleaning and exclusions described only in prose.** Four participants were removed from the phone
  dataset: one lacked pre-installation observations, one produced most extremely long apparent phone
  sessions (up to 12 hours), and two supplied only part of their first post-installation day. First and
  last observed days per participant were removed. App construction was restricted to Android 9,
  apparent app sessions longer than five hours were removed, and unspecified system apps/functions
  were excluded following Jones et al. (2015). Google Play categories were obtained with
  `google-play-scraper`, with lookup failures assigned “Other.” None of the excluded participant IDs,
  system-package list, scraper inputs/results, cutoff impact counts, or pre/post-cleaning flow is
  released. The downstream app maximum is 15,755.666 seconds (about 4.38 hours), consistent with the
  app cutoff; the phone table still contains one 19,425.782-second session (about 5.40 hours), because
  that cutoff was described for apps rather than phone sessions.
- **Holiday and anomaly handling.** Sessions from 2019-12-23 through 2020-01-01 are marked as holidays.
  Duration regressions retain them with a holiday covariate. Frequency analyses remove holiday rows
  and also remove each participant-relative day that straddles holiday and non-holiday time; the same
  mixed-day exclusions are used for duration visualizations but not duration regressions. Frequency
  rows after relative day 10 are deleted because days 11–13 have only one nonholiday participant.
  The notebook duplicates the full table into duration and frequency branches, then deletes one
  participant's Day-5 app rows from both branches. The source table contains exactly 2,094 such rows;
  removing them changes 45,147 app sessions to the paper's 43,053, and their actual median duration is
  0.025 seconds (rounded to 0.03 in the article). This exclusion is transparent and reproducible once
  the downstream table is accepted.
- **Sample-count contradiction.** The released table has 13 distinct participant/device IDs. Twelve
  have phone sessions; all 13 have app sessions. The visualization appendix explicitly presents 13
  participants and says phone sessions were not extractable for Participant 3. Nevertheless, the
  article's post-cleaning paragraph says “data from 12 devices were left” immediately before giving
  the combined phone and app totals. The only charitable reconciliation is that 12 refers to the phone
  subset, but the sentence describes the merged data and does not say so.
- **Analysis implementation.** The notebook uses R 4.0.2 and, among many loaded dependencies,
  `ggplot2`, `papaja`, and `tidyverse`. It duplicates rows so duration and frequency can receive
  different exclusions. Duration uses fixed-effects linear models of log minutes with participant and
  holiday controls and app type where applicable. Frequency is reduced to average sessions per day
  within person/time frame and compared using paired Wilcoxon tests. Type-specific and two-day
  persistence analyses apply FDR adjustments. The package has no lockfile, session information,
  rendered notebook, random seeds for bootstrap confidence intervals, or preserved R workspaces that
  the notebook tries to write. Its relative paths (`Data/data_all.csv`) also do not match the ZIP's
  actual flat `CHBR/data_all.csv` layout without manual rearrangement.
- **Reproducibility verdict.** This study is unusually helpful for understanding why the later primer
  uses events 1, 17, 18, 26, and 27, and its downstream table exactly explains the published 14,330/
  43,053 totals after the disclosed Day-5 deletion. It still does not publish the construction layer
  required by Chronicle: raw JSON, ATT source/version, Python parser, boundary-pairing code, raw sort
  and deduplication behavior, equal-time priority, system-package exclusions, and construction-stage
  counts are all absent. It is therefore evidence for a named conceptual branch and for substantial
  upstream underdetermination, not code that can be faithfully reimplemented from the public record.

## Papers currently being read

This section is deliberately a status list, not evidence about paper contents.

| Work | Current state | Outstanding before content claims are complete |
|---|---|---|
| Radesky et al. (2020), young children/Chronicle | main article read in full; supplement and Chronicle implementation unresolved | retrieve the publisher supplement and an attributable app/code version, then audit both |
| Aharony et al. (2011) and Funf/Funf-in-a-Box | framework paper and public collector/converter lineage fully audited above | seek the unreleased Friends and Family back end only if a retained empirical paper depends on it; do not substitute the `newFunf` fork for the official tagged probe |
| Andrews et al. (2015), Funf ScreenProbe study | **fully audited above**, including recovered official Funf 0.4.2 and generic converters | establish whether the released 34-device example is the study corpus or a broader example; locate the exact generated APK/configuration or author-preserved invocation if it survives |
| Wilcockson et al. (2018), typical-usage reanalysis | article fully audited above; linked 7.97-KB summary CSV retrieval blocked | retrieve the current summary CSV and reproduce all stability correlations; seek the exact upstream event subset and analysis code |
| Karas et al. (2024), Beiwe screen-time construction | **fully audited above**, including supplement and all public code | recover `config.R`/environment and Beiwe versions; quantify duplicate/tied events and add explicit priority plus broader construction sensitivities |
| Lind et al. (2018), EARS platform | **fully audited above**, including the closest surviving pre-acceptance source commit | recover the EASE deployed APK/flavor and absent screen-on implementation/backend; do not treat later EARS generations as equivalent |
| Wade et al. (2021), ABCD EARS pilot | **fully audited above** at article, current-data-documentation, and time-matched public-client levels | obtain deployed APK/hash and Release-3 raw dictionary; recover/version the hidden overlapping-window reconciliation, category maps, and analysis code; audit later EARS versions separately |
| Kristensen et al. (2022), SDU DeviceTracker validation | **fully audited below** | source is available only by author request; later app/version drift remains a separate follow-up |
| Geyer et al. (2021/2022), open-source tracker | **fully audited above** | retain commit-pinned findings; later Usage Logger 2 is a separate software-version audit |
| Lin et al. (2017), Know Addiction use/non-use study | **fully audited above** | audit the reused-sample Lin et al. (2015) origin paper and seek the unpublished collector/source; resolve day-edge and sleep-window semantics |
| Parry et al. (2021), logged versus self-report meta-analysis | **fully audited above** | audit all 47 included papers independently; reconcile the seven-record search-count discrepancy and affected post hoc models |
| Schoedel et al. (2026), integrative preprocessing pipelines | **fully audited above** | audit Parry and Toth (2025), PhoneStudy collector/version, Schoedel et al. (2022/2023), Stachl et al. (2020), and the missing category map as independent lineage items |
| Parry and Toth (2025), Android event-log primer | **fully audited above** | audit the Toth (2023) collector; independently validate every untested event collision and reboot/orphan branch |
| Toth and Trifonova (2021), ATT reactivity study | **fully audited above** | locate ATT and Python-parser source/version if ever archived; audit Jones et al. (2015), Andrews et al. (2015), Harari et al. (2019), and the category scraper as separate lineage items |
| Browne et al. (2021), digital-media measure scoping review | discovered review seed | obtain paper and supplements; citation harvest |
| Byrne et al. (2021), young-child screen-time measurement review | discovered review seed | obtain paper and supplements; citation harvest |
| Shaleha et al. (2026), screen-use measurement-tools rapid review | discovered review seed | obtain full text and supplement; extract all 36 mapped tools and chase primary validation/construction papers |
| Digital phenotyping for problematic technology use (2026), systematic review/taxonomy | discovered review seed | fully audit review methods and citation-harvest every empirical logger/tool paper |
| Cornet and Holden (2018), smartphone passive sensing for health/wellbeing systematic review | full text located; 35-study citation seed with explicit data-processing extraction question | audit all 31 pages/tables/appendices, then chase the 11 device-activity studies and every named platform artifact |
| Finnegan et al. (2024), behavioral biometrics/user-authentication scoping review | full text and two supplements located; adjacent review directly motivated by Chronicle's inability to identify a shared-device user | audit search/quality framework and screen the 90 primary biometric studies for continuous-use attribution methods applicable to screen-time logs |
| *A scoping review of methods of measuring smartphone usage* (2026) | open review discovered; 89 under-18 surveillance studies | verify citation/authors and full search/supplements, separate objective-log studies, and chase their construction artifacts |
| *Possibilities, Problems, and Perspectives of Data Collection by Mobile Apps in Longitudinal Epidemiological Studies* (2021) | open scoping-review seed | fully audit review and identify every screen/device-use logger with at least one month of collection |

## Search and stopping record

Research is ongoing. No diminishing-return stop has been reached because the canonical deduplicated
corpus, full-text audit, review citation harvest, and artifact/code chase are incomplete. Search
queries and dead ends will be appended only after their results are reconciled, so failed and
duplicate searches are not silently repeated.
