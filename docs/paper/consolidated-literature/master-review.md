# Master cross-slice literature review

**Search cutoff:** 2026-08-06. **Scope:** how raw mobile/device events become use episodes and derived behavioral measures; measurement consequences of preprocessing; formal representations; vendor aggregates; self-report/log disagreement. This is the authoritative synthesis after the category and network expansion.

## Corpus accounting

| Slice | Authoritative retained count | Role in the review | Direct-core status |
|---|---:|---|---|
| A — Android/direct instrumentation | 123 | Raw OS events, research collectors, executable reconstruction code, child/shared-device attribution | Core |
| B — iOS/native measurement | 95 | Apple forensic artifacts and APIs, Screen Time donation, clinical/intervention uses | Core |
| C — adjacent sessionization | 66 | Transferable event grouping, event-case correlation, stay/trip formalisms | Adjacent only |
| D — measurement/multiverse | 105 | Reliability, validity, missingness, vendor/device effects, preprocessing multiverses | Core when device-derived; otherwise methodological support |
| E — ontology/formal representation | 94 | Event/interval semantics, executable rule languages, provenance, standards | Core design prior art plus strong adjacent formalisms |
| F — discrepancy | 90 | Self-report/log disagreement and explicit processing attribution | Core |
| **Raw slice sum** | **573** | Counts a work in every retained slice role before cross-slice deduplication | — |

Slice A's count was corrected from 149 to 123 on 2026-08-07. The 149 was the highest
record id, not a record count: the ledger holds 104 A-numbered records plus 19
bare-numbered source records, and ids **A41–A85** — 45 contiguous — appear nowhere in the
corpus, which is the signature of a bulk removal during deduplication that left the
headline untouched. B/C/D/E/F each reconcile exactly against their own ledgers, so the
raw sum moves 599 → 573 and no other row changes.

The raw sum is a coverage count, not a unique-paper count. A mechanical scan after normalization found **523 distinct DOI strings mentioned** in the six ledgers and **26 DOI keys mentioned in more than one slice**, plus four DOI-free exact-title clusters. This scan includes cited threshold ancestors and related data/code artifacts, so it is not converted into a paper count by subtraction. Canonical work-level decisions are in [`deduplication-register.md`](./deduplication-register.md). The non-resolving `10.5555/...` alias returned for Harbach et al. is excluded from the DOI count and replaced by its USENIX stable key.

The word *resolvable* was removed from the 523 figure on 2026-08-07. No resolution test was
run over that set, and the extraction is known to capture non-DOI strings — a Frontiers
`…/full` publisher-URL fragment and one prose ellipsis both entered the scan as DOI
strings. 523 is a count of extracted identifier mentions; treat it as an upper bound on
distinct DOIs, not as a set of identifiers known to resolve. The separate sweep in
`../../handoff-2026-08-07.md` §4 is the one that actually attempted resolution.

## What the expanded literature now establishes

1. **The event→episode step is real prior art, not an empty field.** Multiple Android/mobile papers declare screen-on/off boundaries, foreground-app changes, sampled-gap rules, or gap mergers. A few publish executable code. Claims that “nobody defines sessions” or “no work declares preprocessing” are false.
2. **There is still no dominant mobile reconstruction semantics.** Published rules differ on opener/closer types, cross-app grouping, screen-lock behavior, notification handling, launcher/system apps, short-use removal, missing closes, overlaps, tail closure, timezone repair, and data sufficiency. Many papers expose only some of those decisions.
3. **iOS has a qualitatively different observability problem.** Forensic artifacts expose intervals/events and Apple now provides a limited aggregate export on eligible EU iOS/iPadOS 26.4 devices, but Apple does not publish the algorithm behind Screen Time totals, pickups, or `App.InFocus`/related intervals. Most iOS research can reproduce screenshot transcription and downstream analysis, not the event→aggregate layer.
4. **Preprocessing sensitivity is already a mature scientific topic.** Multiverses exist in trace measurement, psychometrics, neuroimaging, EEG, actigraphy, and wearables. Recent direct-device work shows bout construction, missingness timescale, cut points, proxy substitutions, and vendor/device versions can alter absolute values and sometimes conclusions.
5. **Formal/executable languages already solve many component problems.** ACES, OHDSI ATLAS/Circe, FHIR Measure+CQL, VTL, DDI-CDI, QEL/BEST, SHACL rules, OWL-Time/Allen relations, PROV-O, and workflow standards can express intervals, neighbor events, thresholds, exclusions, nulls, rules, versioning, or provenance. The novelty cannot be “first formal language for derived measures.”
6. **Logged data are not a universal ground truth.** Native dashboards, research loggers, operator records, trackers, and data donations differ in coverage, user attribution, platform access, power/background behavior, system-app inclusion, and participant omission. A self-report/log discrepancy is the difference between two constructed measures, not automatically memory error against truth.
7. **The remaining gap is a conjunction, not an isolated feature.** No located work combines mobile-specific typed raw events; explicit opener/closer/pairing and gap policies; malformed, missing, duplicate, overlapping, out-of-order and clock-change branches; versioned executable bindings; per-episode provenance/quality traces; and validation fixtures in one reusable object.

## Strongest direct reconstruction disclosures

| Work | Input/rung | Declared construction | What remains hidden |
|---|---|---|---|
| Hsu et al. 2025, PULSE (A127), [10.1145/3714394.3754395](https://doi.org/10.1145/3714394.3754395) | Screenshots plus Android screen/app/notification/Accessibility/context streams, R3/R4 | Ends sessions on screen-off >**30 s**, inactivity **30 s**, or labeling-UI entry; declares duration bins and ESM limits | Orphan/overlap/duplicate/reboot/clock/query-tail branches; reported session-flow counts need reconciliation |
| Chen et al. 2023, *Are You Killing Time?* (A128), [10.1145/3544548.3580689](https://doi.org/10.1145/3544548.3580689) | Five-second screenshots plus Android screen/app/context streams, R3/R4 | Merges screen-off ≤**45 s**; 30-s feature windows; excludes first hour/day | Missing-close, collision, reboot, clock, and query-boundary handling |
| Cho et al. 2021, Finesse (A130), [10.1145/3479600](https://doi.org/10.1145/3479600) | Accessibility events and UI trees, R4 | Open app-specific feature detectors with executable start/during/end transitions | Version/language-specific; no general OS-event failure policy |
| Arsan et al. 2025, ODIM (A131), [10.1145/3743726](https://doi.org/10.1145/3743726) | Screenshots, view hierarchy, package, gesture events, R4 | Package-transition trace segmentation plus explicit split/delete/gesture-repair UI | Interaction traces, not complete screen/unlock/app reconstruction |
| Lu et al. 2026, Crepe (A144), [10.1145/3772318.3791137](https://doi.org/10.1145/3772318.3791137) | Accessibility events under researcher-authored Graph Query, R4 | Open **4-s** throttle, **10-s** dedup-cache reset, hourly sync, queued retries, soft deletion | Acquisition/failure handling, not crossed episode policies |
| Draxler et al. 2021, *Why Did You Stop?* (A147), [10.1145/3473856.3473881](https://doi.org/10.1145/3473856.3473881) | Android app/screen/notification/interruption streams, R3/R4 | Ends on background, screen-off, or **10-min** inactivity; return ≤10 min is an interruption; ESM expires after **3 h** | Mobile collision and missing-event repair not generalized |
| Zerrer, Wieland & de Alwis 2026 (A114), [10.71627/How-to-work-with-Android-App-Logging-Data.1](https://doi.org/10.71627/How-to-work-with-Android-App-Logging-Data.1) | Android Start/Stop/Meta app logs, R3/R4 | Public R code searches nearest same-app Stop; checks ten intervening events and a **600-s cap**; falls back to next global event or timeout; records close provenance; later groups visits at a **60-s gap** | One chosen pipeline, not a crossed policy multiverse; participant/generalized raw corpora limited |
| Ahmed et al. 2023 (A86), [10.1145/3604240](https://doi.org/10.1145/3604240) | Android `queryEvents`, R4 | Foreground→background subtraction; cross-app sessions require gap ≤**45 s**; public retrieval/processing code | Original participant logs |
| Zhu et al. 2018 (A; canonical), [10.1177/2050157917748351](https://doi.org/10.1177/2050157917748351) | Mobile usage events | Explicit mobile-session algorithm and evaluation; critiques arbitrary gaps | Not every OS lifecycle/failure case |
| Kim et al. 2019 (B69), [arXiv 1912.12526](https://doi.org/10.48550/arXiv.1912.12526) | Jailbroken iOS foreground transitions, R4 | App-icon start; home/other-app end; retains central 99.7% (~0.196–33,190 s) | Raw data and full builder unavailable |
| Morrison et al. 2018 (B70), [10.1145/3173574.3173918](https://doi.org/10.1145/3173574.3173918) | Jailbroken iOS app/lock events, R4 | Home/other app/lock closes use; unlock starts new use; inherited **30-s locked-session timeout**; separate 21.4-s micro-use classifier | No public raw data/builder |
| Lee et al. 2025 (A89), [10.1145/3770644](https://doi.org/10.1145/3770644) | Screen state + Accessibility events, R3 | Screen-on→screen-off device-use sequence | Collector/participant data unavailable |
| Chen et al. 2026 (A90), [10.1038/s41598-026-52696-0](https://doi.org/10.1038/s41598-026-52696-0) | Avicenna screen state/app metadata, R2/R3 | Tests 5/10/15/20-s brief-activation exclusions; selects **10 s** | Complete ON→OFF matcher delegated to Avicenna |
| Zhang et al. 2025 (A97), [10.2196/57512](https://doi.org/10.2196/57512) | AWARE-Light, R3 | Screen-use episode = unlock→screen off | App-use episode builder delegated |
| Van Gaeveren et al. 2025/2026 (A104), [10.1177/20501579251377010](https://doi.org/10.1177/20501579251377010) | mobileDNA intervals, R3 | Public function groups intervals when next-start−current-stop ≤**30 s** | mobileDNA raw Android event→interval builder; category-fragmentation ordering is questionable |
| große Deters et al. 2026 (A110), [10.1016/j.chbr.2026.101114](https://doi.org/10.1016/j.chbr.2026.101114) | PhoneStudy screen/media events, R2/R3 | Pair ON→OFF; merge within **10 s**; filter automatic activations; repair timezone; extend through continuing media | Original raw sensing withheld |
| Ross et al. 2025 (A111), [10.1038/s41598-025-25174-2](https://doi.org/10.1038/s41598-025-25174-2) | Polled screen/app/GPS, R3 | Public code closes/counts at package change or next-sample gap ≥**15 s**; forces terminal row closed | Original raw records withheld |
| Cerit et al. 2025 (A112), [10.2196/59875](https://doi.org/10.2196/59875) | Five-second screenshots/package, R3 | Screen session ON→OFF; time=screenshot count×5 s; switches=package changes | Historical collector snapshot not public |
| Guo et al. 2025 (A113), [10.1145/3706598.3713724](https://doi.org/10.1145/3706598.3713724) | Screen/app state + five-second screenshots, R3 | Screen session ON→OFF; app session=continuous foreground app; >**5 s** before ESM; declared sampling schedule | Privacy-sensitive raw data/collector unavailable |
| Okoshi et al. 2025 (A116), [10.1145/3706598.3713638](https://doi.org/10.1145/3706598.3713638) | Android UsageEvents + Accessibility, R3/R4 | SCREEN_INTERACTIVE→NON_INTERACTIVE; ACTIVITY_RESUMED→PAUSED; <**5 s** labeled micro-use | Participant data/code unavailable; broader collision/orphan policy unstated |
| Meinhardt et al. 2026 (A119), [10.1145/3831979](https://doi.org/10.1145/3831979) | Accessibility-derived infinite-scroll state, R3 | Uninterrupted passive feed consumption until non-scrolling activity or app close; active engagement excluded; **15-min** trigger gate | Feature-specific rather than general OS-event construction |
| Katapally & Chu 2019 (F01) | Screen-state/mobile log | Varies five notification filters × seven long-session caps plus 10-h/day rule and compares discrepancy | Does not span typed app lifecycle repair rules |
| Muise et al. 2023 (D boundary) | Digital trace records | Names bundling and arrival-without-exit pathology; declares a session rule | Not Android lifecycle semantics |
| Niemeijer et al. 2022 (D boundary) | Smartphone screen-state data | Fixes a <**12-s** preprocessing rule within a large downstream multiverse | Reconstruction is held fixed, not crossed |

These counterexamples require precise wording: the field contains disclosed rules, but they are heterogeneous, incomplete, and often begin from vendor/research intervals whose upstream construction is hidden.

## Latest and highest-impact additions (2025–2026)

| Work | Why it changes the review | Status/access |
|---|---|---|
| Crepe 2026, [10.1145/3772318.3791137](https://doi.org/10.1145/3772318.3791137) | Open researcher-authored mobile screen-data queries plus explicit deduplication, throttling, sync retry, and participant deletion controls | CHI 2026 + open Android source/preprint; participant traces private |
| PULSE 2025, [10.1145/3714394.3754395](https://doi.org/10.1145/3714394.3754395) | Directly declares three session-ending conditions, duration bins, and ESM sampling rules over screenshots and multimodal Android telemetry | Peer-reviewed short paper/tool description; no open participant logs/complete collector verified |
| ODIM 2025, [10.1145/3743726](https://doi.org/10.1145/3743726) | Makes UI-trace boundaries and human repair actions inspectable in open Android source | PACM HCI article + open collector; no large open naturalistic corpus verified |
| ScreenTK 2024, [10.1145/3675094.3677547](https://doi.org/10.1145/3675094.3677547) | Direct validation that five-second screenshot sampling misses substantial active/passive UI events versus Accessibility-derived text intervals | UbiComp companion paper/arXiv; complete collector/raw stream not verified open |
| Zerrer, Wieland & de Alwis 2026, [10.71627/How-to-work-with-Android-App-Logging-Data.1](https://doi.org/10.71627/How-to-work-with-Android-App-Logging-Data.1) | Executable missing/remote-close repair, timeout closure, close provenance, 60-s grouping, timezone/background/OEM handling | Public GESIS tutorial, repository, and examples; strongest new direct threat |
| Winklbauer & Batinic 2026, [10.2139/ssrn.7008242](https://doi.org/10.2139/ssrn.7008242) | 16,128 specifications; session threshold explains 51–78% of absolute-metric variance, but inputs are already reconstructed episodes | Full SSRN preprint; deepest direct competitor |
| Langford et al. 2026, GENEAcore, [10.64898/2026.03.21.713324](https://doi.org/10.64898/2026.03.21.713324) | Variable bouts yield **31% more daily activity duration** than one-second epochs; open modular preprocessing analogue | Preprint + open repository/sample data |
| Gonsalves et al. 2026, [10.1088/1361-6579/ae3b96](https://doi.org/10.1088/1361-6579/ae3b96) | Quantifies actigraphy preprocessing underreporting and provides a decision tree/checklist | Full open review |
| Dumas et al. 2026, [10.2196/84146](https://doi.org/10.2196/84146) | In 65 smartphone-phenotyping studies, only six quantify stream missingness and four report sampling/duty cycle | Full open review |
| Shen et al. 2026, [10.1093/geroni/igag007](https://doi.org/10.1093/geroni/igag007) | Explicit timezone, daytime/overnight sufficiency, imputation, and 30-day eligibility rules for multimodal smartphone sensing | Full open guide |
| Barron et al. 2026, [10.2196/preprints.95468](https://doi.org/10.2196/preprints.95468) | Missingness changes dramatically by day/hour/minute and imputation attenuates a clinical association | Current preprint |
| ACES (ICLR 2025), [arXiv 2406.19653](https://doi.org/10.48550/arXiv.2406.19653) | Executable YAML for typed events, nested temporal windows, neighbor predicates, thresholds, invalid branches, and exclusion logs | Peer-reviewed ICLR + MIT code |
| DiMe walking-bout ontology 2024/2026 | Direct measure-ontology analogue with start/end, minimum duration, gap, qualifying evidence, device/algorithm/wear-location context | Official conceptual artifact; not executable |
| Huang et al. 2026 QEL/BEST, [arXiv 2607.21377](https://doi.org/10.48550/arXiv.2607.21377) | Formal dense-time event/interval engine with duration thresholds, bounded delay, and washout windows | Preprint; no public code located |
| DDI-CDI 1.0 (2025) | Integrated event/spell/process/control/rule/lineage model; destroys “no suitable metadata model” claims | Open standard/artifacts |
| Clifford et al. 2026, [10.1037/tmb0000203](https://doi.org/10.1037/tmb0000203) | Seven-day scraped iOS/Android Screen Time plus actigraphy and person-level heterogeneity | Full open article; OS builder delegated |
| Reichenberger et al. 2026, [10.1093/sleep/zsag091.0389](https://doi.org/10.1093/sleep/zsag091.0389) | Custom OCR extracts hourly iOS Screen Time into calendar/wake/evening/night windows | Conference abstract; OCR code unavailable |
| Mertens et al. 2026, [10.2196/56824](https://doi.org/10.2196/56824) | Separates a user-defined in-session intervention trigger from Apple-derived outcome minutes; publishes R code | Full open RCT; data private |
| Ahmed et al. 2026, [arXiv 2606.08965](https://arxiv.org/html/2606.08965) | Intention–actual-use gap predicts regret more strongly than duration; Android package filtering/exit detection only partly disclosed | Current full preprint; promised code URL still a placeholder |
| Meinhardt et al. 2026, [10.1145/3831979](https://doi.org/10.1145/3831979) | Explicit Accessibility-derived scrolling session and 15-min selection gate; feature-level reconstruction artifacts are open | PACM IMWUT article + public app/data/R repository |
| Toth, Parry & Klingelhoefer 2025, [10.31235/osf.io/xt24p_v3](https://doi.org/10.31235/osf.io/xt24p_v3) | Directly estimates reactivity to logging and ESM; prompts alter subsequent logged use for roughly 2–3 hours | Current open preprint/artifacts; inherited event builder |

## iOS findings that must not be overclaimed

- `knowledgeC.db`, `_DKEvent.App.InFocus`, `App.InFocus`, Biome/SEGB, and `ScreenTime.AppUsage` supply valuable forensic fields. They do not establish that those intervals equal Apple Screen Time totals or disclose Apple’s complete construction policy.
- On iOS 17+, `_DKEvent.App.InFocus` exposes start/end/write time, bundle, transition, and GUID, while `App.InFocus` is punctual with start, bundle, and foreground/background action. Write time can be zero or differ from occurrence time; retention is roughly 28 days.
- Apple’s `DeviceActivityData.activityData(filteredBy:using:)`, introduced in iOS/iPadOS 26.4 for eligible EU contexts, exports hourly/daily/weekly aggregates. It does not export the raw event history or the builder that generated totals.
- Screenshot/data-donation papers can be highly reproducible downstream—manual coding, OCR, app categorization, aggregation, preregistration, analysis code—while remaining non-reproducible upstream.
- Platform mixture is not automatically harmonization. Native iOS Screen Time, Android Digital Wellbeing, Huawei Digital Balance, commercial trackers, and research apps may share labels while differing in coverage and semantics.

## Formal prior art and the residual ontology claim

| Component needed | Existing prior art | What remains for this paper |
|---|---|---|
| Typed events and intervals | OWL-Time, Allen, UFO-B/gUFO, MEDS-OWL, DDI-CDI | Bind actual Android/iOS event types and version semantics |
| Neighbor-event/window logic | ACES, VTL `lead`/`lag`, CQL intervals, QEL/BEST | Declare opener/closer choice, pairing search, inclusivity, caps, gaps |
| Event→episode execution | OHDSI Circe eras, ACES, SHACL rules, phenotype/workflow engines | Mobile-specific reference execution over raw device traces |
| Threshold/device context | DiMe bout ontology, WEAR-BOT, SAREF4WEAR, wearable validations | Link every value to type, justification, version, and sensitivity branch |
| Failure semantics | ACES validation, SHACL constraints, VTL errors, CQL nulls, cohort validators | Missing close, orphan close, duplicate, overlap, out-of-order, clock/timezone, shutdown/reboot policies |
| Provenance | PROV-O, DDI-CDI, WearPGHDProvO, Workflow Run RO-Crate, BioCompute Object | Per-output episode lineage to source events, binding version, repair path, and quality flags |
| Validation | Standards test suites and open wearable algorithms | Golden fixtures plus cross-binding property/oracle tests for mobile reconstruction |

Defensible novelty statement:

> Existing work separately provides mobile session heuristics, temporal/event ontologies, executable cohort and transformation languages, provenance models, and preprocessing multiverses. We found no reusable artifact that integrates those components for typed mobile device events and makes competing event-to-episode reconstruction semantics—including failure repair and per-episode provenance—executable and empirically comparable on the same raw logs.

## Cross-network coverage—not one lab or citation neighborhood

The final core spans multiple independent technical and substantive networks:

- Android platform/AOSP, research-app, open-tool, DFIR, and package-registry lineages.
- GESIS Digital Behavioral Data/tutorial work, Ulm/Aalto feature-level scrolling interventions, MIT/HPI regret prediction, Mindstrong clinical sensing, and Parry–Toth logging-reactivity/habit work.
- Android DFIR sources outside the usual social-science citation graph: ALEAPP UsageStats XML/protobuf, `dumpsys`, Device Health Services, Device Personalization Services, Digital Wellbeing/OEM stores, and app/video validation interfaces.
- Apple DFIR practitioners, Screen Time API/framework work, native-dashboard donation, intervention, sleep, clinical, adolescent, parent/child, and workplace cohorts.
- Chronicle/CAFE and collaborators around Radesky, Barr, Armstrong, Coyne, Kirkorian, Munzer, Woods, and related child/shared-device measurement—but not as the organizing center.
- Telzer/Nesi/Burnell/Prinstein adolescent intensive-longitudinal work; Amsterdam/Leuven mobileDNA and data-donation groups; PhoneStudy; Screenomics; AWARE/RAPIDS; Beiwe; StudentLife; RealityMine, MFour, Aura, MetricWire, Avicenna, SensorKit, and HealthKit ecosystems.
- Digital medicine, actigraphy/wearable, digital phenotyping, psychometrics, neurophysiology, process-event, clinical informatics, standards, semantic-web, and provenance communities.

This diversity matters because the strongest discoveries came from different assumptions: child-user attribution, screen-state reconstruction, app lifecycle logs, screenshot donation, missingness, wearable bout construction, computable phenotypes, and semantic event processing.

## Contradictions and limits to carry into the paper

- Absolute estimates can change strongly while participant ranks remain stable. Report absolute, rank, agreement, and downstream-effect sensitivity separately.
- Some shared transformations successfully harmonize raw cross-device streams. Opacity/conditional validity is the problem; “all vendor or device measures are invalid” is unsupported.
- Missingness can encode clinical state, technology failure, or ordinary life—and sometimes adds no predictive value after baseline control. Do not treat it uniformly as noise or signal.
- High correlation does not establish agreement or interchangeable units.
- A fixed open pipeline improves reproducibility but can reproducibly operationalize the wrong construct. Reproducibility and validity are distinct.
- A multiverse does not make every branch conceptually admissible. Bindings need semantic labels, constraints, provenance, and reasons; averaging incompatible constructs would erase the scientific question.
- Self-report discrepancies vary in direction by population, app/category, interval, and objective instrument. Processing error supplements recall/mental-model explanations rather than replacing them.
- Observation is sometimes intervention: screen-conditioned ESM delivery, logging awareness, and prompts can select or alter the very phone behavior later treated as an objective comparator.

## What should be cited in the paper versus kept as transfer evidence

**Must engage directly:** Zerrer/GESIS; Winklbauer & Batinic; declared mobile reconstruction papers/code; feature-level Accessibility/session work; Apple observability/export limits; objective-measure validation/discrepancy and reactivity studies; Chronicle/shared-device methods; preprocessing/missingness reporting audits; ACES/DiMe/OHDSI/DDI-CDI as formal boundary threats.

**Use selectively as methodological support:** actigraphy/wearable cut-point and bout papers; psychometric/neurophysiology multiverses; generic provenance/workflow standards; formal temporal logics.

**Do not inflate the direct corpus with:** generic web sessions, search-task segmentation, unrelated clickstreams, or process-mining papers that only share the word “event.” Slice C remains a transfer library, not evidence that those systems measure screen use.

## Source-of-record rule

For citations, quotations, access depth, threshold provenance, data/code availability, and dead ends, use the linked A–F ledgers from [`README.md`](./README.md). This master review consolidates conclusions and canonical work identities; it intentionally does not duplicate hundreds of six-field source records.
