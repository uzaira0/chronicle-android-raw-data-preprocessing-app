# Fresh mobile-event literature discovery and adversarial research critique

**Run marker:** `[codex-pro-run:f093cc3b-123a-43b4-ba30-476adc363f8e]`  
**Search cutoff:** 2026-08-06  
**Mode:** fresh discovery plus primary-source verification and adversarial novelty audit  
**Scope:** actual mobile screen, lock/unlock, foreground app, feature-level UI, notification, source-artifact, intervention-trigger, and closely comparable on-device traces. Browser/web clickstreams, network proxies, generic sensing, and wearable-only analogies were excluded.

## Decision

The search found substantial net-new prior art, including a new strongest non-mobile-specific executable event-grouping threat (NAPsack), direct Android session builders (PULSE and KTL), open UI-level collectors and repair tools (Crepe, Finesse, ODIM), notification state instrumentation, open screenome acquisition, and executable iOS forensic query libraries. The original residual novelty survives **only in a narrower conjunctive form** centered on mobile-OS-specific typed events, crossed alternative policies, complete failure semantics, per-episode lineage/quality traces, and validation on the same open raw logs.

---

## A. Exact counts searched, retained, rejected, and unresolved

| Audit unit | Exact count | Interpretation |
|---|---:|---|
| Distinct candidate identities screened | 84 | Canonical work/artifact identities that entered the decision audit; not raw search-engine hits |
| Retained as genuinely net-new | 32 | 24 primary A, 5 primary B, 2 primary D, 1 primary F; many have secondary cross-slice roles |
| Rejected | 39 | 14 already-known works/DOI keys plus 25 off-scope or methodologically non-contributory near-misses |
| Unresolved, not imported | 13 | Canonical identity verified, but primary method/code depth was insufficient for a safe rule claim |
| Neutral query families executed | 14 | Listed in Section G |

### Mechanical duplicate-filter correction

The packet states that 547 known numbered work headings were supplied. A mechanical scan of the actual attachment found **428 lines matching the explicit numbered-heading syntax** and **496 DOI strings in the DOI block**. This run used all 428 mechanically identifiable headings, all 496 DOI strings, title normalization, and manual companion/preprint checks. It did not silently assume that the unlocatable difference between 547 and 428 represented additional visible entries.

The late audit correction matters: *Contextual Experience Sampling of Mobile Application Micro-Usage* and *Smartphone Use in Germany in 2023* looked title-new during neutral searching, but their DOI keys were already present, so both are counted as duplicates rather than unresolved or retained.

---

## B. Ranked blocking/major citation threats to the residual novelty statement

### B1. NAPsack / LongNAP

Publishes executable typed-event burst construction with per-type gaps and caps, forced splitting, overlap ordering, monitor-boundary restarts, screenshot context, and duplicate-frame filtering. This defeats any broad claim that no reusable event-grouping artifact exposes failure branches. It remains computer-general and lacks mobile OS screen/lock/app lifecycle semantics.

### B2. PULSE

Direct Android session builder with configurable 30-s closure rules, duration bins, one-second screenshots, and event-triggered ESM. It is a strong direct threat to claims of absent declared smartphone-session policies, although broader malformed/missing/order/clock branches remain hidden.

### B3. Crepe

Open low/no-code Android UI collector with Graph Query rules, deduplication/throttling, queued synchronization, soft deletion, and participant controls. It raises the prior-art floor for executable source bindings and acquisition failure handling.

### B4. Finesse / Reflect, Not Regret

Open app-specific feature detectors make start/during/end feature sessions executable over Accessibility layout trees. Version and language fragility are explicit, which is itself evidence for version-bound semantics.

### B5. ODIM

Open, editable UI traces use package-transition segmentation and human repair actions. It is the strongest new example of inspectable correction rather than silent preprocessing.

### B6. iOS Unified Log parser/SQL + PowerLogs timing

Together they expose executable app/lock/notification predicates, boot identifiers, delayed-write/query-boundary hazards, and monotonic-clock/timezone semantics. They do not establish Apple Screen Time totals, but they narrow the claimed iOS tooling gap.

### B7. Anatomy of Smartphone Unlocking

Uses a typed finite-state machine and explicitly reports out-of-order/context-switched events. This is direct prior art for ordering failure detection, though the remedy is exclusion rather than general repair.

### B8. Are You Killing Time?

Declares a 45-s screen-off merger, 5-s screenshot/sensor schedule, 30-s context windows, first-hour exclusion, and possible reactivity. It is a direct session/selection threat.

### B9. Notification Log + Annotif + Dismissed! + My Phone and Me + Call to Action

The cluster supplies posted/removed/seen/accepted/dismissed state proxies, deduplication, user annotation, and explicit ambiguity. It blocks any claim that notification-mediated episodes lack prior operationalizations, while also demonstrating that the labels are not interchangeable.

### B10. ScreenLife Capture + ScreenTK

Open or inspectable screenome acquisition and a direct cadence-validity result show both the strength and loss modes of screenshot-based observation. A 5-s grid can miss a large fraction of active/passive UI events.

### B11. Why Did You Stop?

Defines session termination, 10-min resumption, interruption classes, prompt scheduling, expiry, and supersession. It is direct task/session-tail prior art.

### B12. Winbush et al.

Shows that a metric named “average session length” may be category minutes divided by unlocks, with no reconstructed session identities. This is a major construct-label threat for cross-study synthesis.

**Bottom line:** NAPsack blocks any unqualified claim that reusable artifacts do not expose typed event-grouping, overlap, forced-split, and duplicate-handling rules. PULSE/KTL block any claim that mobile screen sessions lack explicit configurable thresholds. Finesse/ODIM/Crepe block any claim that feature-level or repairable UI traces are absent. The residual claim must therefore be about the full mobile-specific integration and comparison object, not any one component.

---

## C. Detailed net-new ledger, grouped A/B/D/F

## A — Android/direct instrumentation and on-device UI/notification construction

### A01. PULSE: A Screenshot-Based Labeling Tool for Investigating Smartphone Behavior, Intent, and Perception.

**Canonical citation / stable key:** Hsu, Je-Wei; Lin, Ching-Ting; Chen, Uei-Dar; Kuo, Jui-Ching; Liu, Jui-Chun; Lin, Yong-Han; Chen, Chen-Ya; Pourafshari, Razieh; Lu, Yifei; Bayer, Joseph B.; Chang, Yung-Ju. “PULSE: A Screenshot-Based Labeling Tool for Investigating Smartphone Behavior, Intent, and Perception.” UbiComp/ISWC Companion, 2025. **Key:** `10.1145/3714394.3754395`.

**Slice role and network:** A/D/F. Independent Taiwan–US mobile sensing / session-labeling network.

**Instrument/rung:** Android collector combining one-second screenshots during the declared observation period with screen state, app usage, notification, Accessibility, and contextual sensor streams; R3/R4 because it observes both device/session boundaries and UI/app evidence.

**Exact construction, cleaning, selection, and threshold provenance:** A use session ends when the screen remains off for more than 30 s, when no interaction is observed for 30 s, or when the participant enters the PULSE labeling interface. Session durations are binned 0–5, 5–30, 30–60, 60–180, 180–300, and ≥300 s; the toolkit exposes those bins as configurable study parameters rather than natural constants. Micro-ESM is capped at 15 prompts/day, separated by at least one hour, and can be triggered at session start, session end, or app switch. The paper reports at least 12 h/day of collection between 08:00 and 23:00. A numerical flow inconsistency remains: it reports 23,799 detected sessions, 12,161 sampled sessions, and later 21,645 final sessions without a fully transparent reconciliation.

**Rule status:** Declared for screen/session closure, duration bins, and ESM selection; orphan, overlap, duplicate, reboot, clock-change, and query-tail branches are absent or undetermined.

**Code/data/raw-log availability:** Paper and toolkit description available; no public participant raw log or complete collector repository was verified in this run.

**Primary sources:** [DOI](https://doi.org/10.1145/3714394.3754395).

**Explicit duplicate check:** Exact normalized DOI absent from all 496 supplied DOI strings; canonical title absent from the 428 mechanically detected heading lines.

**Confidence:** High.

### A02. Are You Killing Time? Predicting Smartphone Users’ Time-Killing Moments via Fusion of Smartphone Sensor Data and Screenshots.

**Canonical citation / stable key:** Chen, Yu-Chun; Lee, Yu-Jen; Kao, Kuei-Chun; Tsai, Jie; Liang, En-Chi; Chiu, Wei-Chen; Shih, Faye; Chang, Yung-Ju. “Are You Killing Time? Predicting Smartphone Users’ Time-Killing Moments via Fusion of Smartphone Sensor Data and Screenshots.” CHI 2023. **Key:** `10.1145/3544548.3580689`.

**Slice role and network:** A/D/F. Taiwan mobile sensing / intention-context modeling network, independent of Chronicle/CAFE and GESIS.

**Instrument/rung:** KTL Android application using Accessibility, screen status, app usage, notifications, network/volume/context streams, and screen-on screenshots sampled every 5 s; R3/R4.

**Exact construction, cleaning, selection, and threshold provenance:** A phone-use session remains continuous across a screen-off interval of 45 s or less; screen-off longer than 45 s starts a new session. The study expected at least 12 h/day of operation, took screenshots and sensor snapshots every 5 s while the screen was on, and used 30-s context windows for prediction. The first hour of each participant-day was excluded because look-back features could not be computed. Thirty-six participants remained after exclusions, yielding 5,266 sessions. The authors explicitly discuss possible logging/ESM reactivity.

**Rule status:** Declared screen-off merger, acquisition cadence, look-back exclusion, and analysis window; lifecycle collision, missing-close, reboot, clock/timezone, and query-boundary policies are absent.

**Code/data/raw-log availability:** MIT-licensed model code, weights, and examples are public; original privacy-sensitive participant screenshots/logs are not public.

**Primary sources:** [DOI](https://doi.org/10.1145/3544548.3580689); [Code](https://github.com/johnsonkao0213/kill_time_detection).

**Explicit duplicate check:** DOI and title absent from supplied indexes; companion/session descendants already in the packet were treated separately and not re-imported.

**Confidence:** High.

### A03. Characterization and Prediction of Mobile Tasks.

**Canonical citation / stable key:** Tian, Yuan; Zhou, Ke; Pelleg, Dan. “Characterization and Prediction of Mobile Tasks.” ACM Transactions on Information Systems 41(1), 2023 (online 2022). **Key:** `10.1145/3522711`.

**Slice role and network:** A/D. Mobile information retrieval / task-sequence modeling rather than screen-time psychology.

**Instrument/rung:** App-use logs from the UbiqLog corpus; R2/R3 because the paper starts from app-use records and constructs sessions/tasks.

**Exact construction, cleaning, selection, and threshold provenance:** A session is a run of consecutive app uses with no standby/inactivity break longer than 45 s. A task may span more than one such session, so session and task are explicitly non-equivalent units. In the manually labeled sample of 20 US users across five days, 1,414 tasks were identified; 49.3% contained multiple log records, 19.7% involved multiple apps, and 22.6% were interleaved with another task. The paper therefore directly warns against equating app sequence, session, and user goal.

**Rule status:** Declared 45-s session boundary and separate task formalization; upstream Android event pairing, missing records, and clock handling are delegated to UbiqLog.

**Code/data/raw-log availability:** Primary article available; the analyzed sample is derived from an existing corpus, but no independent raw-event reconstruction implementation was verified.

**Primary sources:** [DOI](https://doi.org/10.1145/3522711).

**Explicit duplicate check:** Exact DOI/title absent from supplied indexes.

**Confidence:** High.

### A04. Reflect, Not Regret: Understanding Regretful Smartphone Use with App Feature-Level Analysis.

**Canonical citation / stable key:** Cho, Hyunsung; Choi, DaEun; Kim, Donghwi; Kang, Wan Ju; Choe, Eun Kyoung; Lee, Sung-Ju. “Reflect, Not Regret: Understanding Regretful Smartphone Use with App Feature-Level Analysis.” PACM HCI/CSCW 5(CSCW2), 2021. **Key:** `10.1145/3479600`.

**Slice role and network:** A/D/F. Korean feature-level digital-wellbeing instrumentation.

**Instrument/rung:** Finesse Android Accessibility service; captures Accessibility events and UI layout trees for Instagram, Facebook, YouTube, and KakaoTalk, plus screen-off state and ESM; R4 feature-level telemetry.

**Exact construction, cleaning, selection, and threshold provenance:** The open source routes every Accessibility event and current package/class into a layout logger. App-specific feature detectors infer the current feature and a manager tracks session progress as start, during, or end; `checkSessionEnd` saves the final feature and opens a summary ESM. The code therefore exposes executable feature-state transitions rather than only reporting aggregate durations. It was deployed in September 2020 and requires period-specific app versions and Korean device language, making version drift a first-order semantic dependency. Twenty-nine Android users contributed one week of logs.

**Rule status:** Executable and declared for app-specific feature states and feature-session end; system-app filters, malformed layout handling, overlap, missing end, reboot, and clock policies are incomplete or app-specific.

**Code/data/raw-log availability:** Android source, study APK, and version guidance are public; participant raw logs are not public.

**Primary sources:** [DOI](https://doi.org/10.1145/3479600); [Code](https://github.com/choch-o/Finesse).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes.

**Confidence:** High.

### A05. On-Device Interaction Mining.

**Canonical citation / stable key:** Arsan, Deniz; Guo, Carl; Wellyanto, Muhammad Rizky; Ji, Erik R.; Talton, Jerry O.; Kumar, Ranjitha. “On-Device Interaction Mining.” PACM HCI 9(5), 2025. **Key:** `10.1145/3743726`.

**Slice role and network:** A/D. Open UI-interaction trace and human repair tooling, separate from conventional digital phenotyping.

**Instrument/rung:** Android collector records the first-touch screenshot, UI view-hierarchy JSON, package identity, and touch/gesture events; R4 UI trace.

**Exact construction, cleaning, selection, and threshold provenance:** Events for a target application are grouped into an interaction trace. Package transitions delimit traces; system UI and launcher transitions are excluded from target-app traces. The system represents click, long-click, selection, focus, and scroll behavior. A participant/researcher repair interface can complete an incomplete gesture, split a trace, delete it, or upload it. This is important prior art for making boundary correction inspectable rather than silently preprocessing traces.

**Rule status:** Executable package-transition segmentation and explicit human repair are declared; no general screen/unlock session layer and no crossed alternative pairing/gap policies.

**Code/data/raw-log availability:** Paper and Android source are public; no large open naturalistic raw corpus was verified.

**Primary sources:** [DOI](https://doi.org/10.1145/3743726); [Android source](https://github.com/datadrivendesign/odim-android).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### A06. ScreenTK: Seamless Detection of Time-Killing Moments Using Continuous Mobile Screen Text and On-Device LLMs.

**Canonical citation / stable key:** Fang, Le; Zhang, Shiquan; Jia, Hong; Goncalves, Jorge; Kostakos, Vassilis. “ScreenTK: Seamless Detection of Time-Killing Moments Using Continuous Mobile Screen Text and On-Device LLMs.” UbiComp/ISWC Companion 2024. **Key:** `10.1145/3675094.3677547`.

**Slice role and network:** A/D. Accessibility-derived screen-text instrumentation and sampling-validity evaluation.

**Instrument/rung:** AWARE-Light Accessibility service records screen on/off, lock/unlock, text, click and scroll events on Android; an on-device language model converts events into timestamped text intervals; R3/R4.

**Exact construction, cleaning, selection, and threshold provenance:** The study compared event-derived screen text against screenshots sampled every 5 s on a Pixel 8. Across six participants and 1,034 reference records, the 5-s screenshot method missed 38% of active and 57% of passive events, while ScreenTK missed one event attributed to a sensor failure. This is not a general episode builder, but it is a direct validation result showing that fixed screenshot cadence alters observed UI behavior.

**Rule status:** Declared acquisition and interval derivation; app/session opener/closer, orphan/missing event repair, and clock/timezone handling are delegated or absent.

**Code/data/raw-log availability:** Paper and method description available; complete collector source and participant raw stream were not verified as public.

**Primary sources:** [DOI](https://doi.org/10.1145/3675094.3677547); [arXiv](https://arxiv.org/abs/2407.03063).

**Explicit duplicate check:** Exact DOI/title absent from supplied indexes.

**Confidence:** High.

### A07. Notification Log: An Open-Source Framework for Notification Research on Mobile Devices.

**Canonical citation / stable key:** Weber, Dominik; Voit, Alexandra; Henze, Niels. “Notification Log: An Open-Source Framework for Notification Research on Mobile Devices.” UbiComp/ISWC Adjunct 2018. **Key:** `10.1145/3267305.3274118`.

**Slice role and network:** A/D. Independent notification-instrumentation framework lineage.

**Instrument/rung:** Android `NotificationListenerService` callbacks for notification addition/removal with package, text, priority, vibration, sound, screen/ringer/battery/connectivity context; R4 notification event stream.

**Exact construction, cleaning, selection, and threshold provenance:** The framework records notification-posted and notification-removed callbacks into a unified JSON schema, stores them in private SQLite, and supports immediate or batched synchronization. On Android versions exposing removal reasons, it can distinguish some user and application removals; on other versions the semantic cause remains hidden. The source and its downstream studies explicitly show that callback counts are not identical to human-visible notification episodes because grouping, replacement, and application updates can generate multiple events.

**Rule status:** Executable source semantics and storage path declared; user-visible episode construction and cross-version removal semantics remain partial.

**Code/data/raw-log availability:** MIT-licensed Android source and paper are public; no single open participant corpus accompanies the framework.

**Primary sources:** [DOI](https://doi.org/10.1145/3267305.3274118); [Code](https://github.com/interactionlab/android-notification-log).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes; later Annotif and Clear All were checked as distinct publications.

**Confidence:** High.

### A08. Call to Action: Investigating Interaction Delay in Smartphone Notifications.

**Canonical citation / stable key:** Stach, Michael; Mulansky, Lena; Reichert, Manfred; Pryss, Rüdiger; Beierle, Felix. “Call to Action: Investigating Interaction Delay in Smartphone Notifications.” Sensors 24(8), 2024. **Key:** `10.3390/s24082612`.

**Slice role and network:** A/D. TYDR large-scale Android notification telemetry.

**Instrument/rung:** Android service logs notification appearance/disappearance, application identity, timestamps, and hashed private fields; joins battery and category data; R3/R4.

**Exact construction, cleaning, selection, and threshold provenance:** The authors deduplicate bursts caused by notification and battery status updates, exclude users affected by an operating-system update, and compute “interaction delay” from display to removal. Records with non-positive delay or delay over one day are removed; battery state is joined within ±10 min; incomplete rows and selected categories are excluded. The final source contains 9,894,656 notification records from 922 users. Crucially, removal includes both click/consumption and dismissal, so the published label is not a pure human-response latency.

**Rule status:** Declared cleaning windows and exclusions; semantic action attribution is conflated and no replacement/grouping state machine is published.

**Code/data/raw-log availability:** Open article; original user-level raw data and complete collector source were not verified as public.

**Primary sources:** [DOI](https://doi.org/10.3390/s24082612).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes.

**Confidence:** High.

### A09. Beyond the Feature Level: A Cluster Analysis of Feature-Level Social Media Behaviour Patterns, Maladaptive Use, and Psychological Well-Being.

**Canonical citation / stable key:** Sramek, Zefan; Lokuge, Sachinthya; Sternat, Tia; Katzman, Martin A.; Yatani, Koji. “Beyond the Feature Level: A Cluster Analysis of Feature-Level Social Media Behaviour Patterns, Maladaptive Use, and Psychological Well-Being.” PACM IMWUT 9(4), 2025. **Key:** `10.1145/3770713`.

**Slice role and network:** A/D. Feature-level social-media instrumentation outside the Meinhardt/Finesse lineages.

**Instrument/rung:** InstaReader, an Android full-screen WebView reproducing Instagram-like navigation; unique feature URLs expose feature-state transitions; R4 controlled UI telemetry.

**Exact construction, cleaning, selection, and threshold provenance:** Feature use is registered through instrumented URL/state transitions rather than inferred from opaque native-app package events. This makes the feature identity inspectable, but it is a controlled clone/interface rather than an observation of the publisher’s native Instagram lifecycle. The primary metadata and system description were verified; the full episode-boundary implementation was not accessible in this run, so gap, close, orphan, and tail rules remain undetermined.

**Rule status:** Declared at the feature-state/URL level; general episode construction undetermined. Retained because the instrument materially changes the observability boundary, not because it closes the residual novelty claim.

**Code/data/raw-log availability:** Publisher record and system description verified; no public code or raw participant trace located.

**Primary sources:** [DOI](https://doi.org/10.1145/3770713).

**Explicit duplicate check:** Exact DOI/title absent from indexes.

**Confidence:** Medium.

### A10. Understanding, Discovering, and Mitigating Habitual Smartphone Use in Young Adults.

**Canonical citation / stable key:** Monge Roffarello, Alberto; De Russis, Luigi. “Understanding, Discovering, and Mitigating Habitual Smartphone Use in Young Adults.” ACM Transactions on Interactive Intelligent Systems, 2021. **Key:** `10.1145/3447991`.

**Slice role and network:** A/D. Italian digital-wellbeing / Socialize intervention lineage.

**Instrument/rung:** Android app logs screen state and app use and delivers just-in-time reminders; R3.

**Exact construction, cleaning, selection, and threshold provenance:** A phone-use session starts at screen-on and ends at screen-off. The study analyzed more than 130,000 such sessions and evaluated the Socialize intervention with 20 participants over 21–113 days. The intervention logic is tied to inferred habitual use, but the key direct prior art here is the explicit screen-on/off session unit and the release of the intervention software.

**Rule status:** Declared simple screen-on→screen-off construction; missing screen-off, rapid off/on, reboot, system apps, and overlap semantics are absent.

**Code/data/raw-log availability:** Primary article and Socialize software materials are available; raw participant logs are not public.

**Primary sources:** [DOI](https://doi.org/10.1145/3447991).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes; related app-switching work was capped as same-lineage unresolved/near-miss.

**Confidence:** High.

### A11. It’s a Hard Lock Life: A Field Study of Smartphone (Un)Locking Behavior and Risk Perception.

**Canonical citation / stable key:** Harbach, Marian; von Zezschwitz, Emanuel; Fichtner, Andreas; De Luca, Alexander; Smith, Matthew. “It’s a Hard Lock Life: A Field Study of Smartphone (Un)Locking Behavior and Risk Perception.” SOUPS 2014. **Key:** `10.5555/3235838.3235857`.

**Slice role and network:** A/D. Mobile security / unlock-state instrumentation.

**Instrument/rung:** Android `SCREEN_ON`/`SCREEN_OFF` intents plus `KeyguardManager`; R4 device-state finite-state machine.

**Exact construction, cleaning, selection, and threshold provenance:** The logger implements four states—OFF_UNLOCKED, OFF_LOCKED, ON_UNLOCKED, and ON_LOCKED—and timestamps entry into each state. Unlock duration is a worst-case measure because it includes time looking at the lock screen. ESM sampling stratifies by observed unlock rate: heavy users (≥9 unlocks/h) sampled at 10%, medium users (4–8/h) at 15%, with at most one prompt/hour. Records affected by manual time changes and logger failure after reboot were excluded rather than repaired.

**Rule status:** Explicit state machine and selection policy; failures are detected/excluded, not reconstructed. No versioned alternative policies.

**Code/data/raw-log availability:** USENIX paper is public; logger source/raw data not located.

**Primary sources:** [USENIX record](https://www.usenix.org/conference/soups2014/proceedings/presentation/harbach).

**Explicit duplicate check:** Title and stable accession absent from packet indexes.

**Confidence:** High.

### A12. Annotif: A System for Annotating Mobile Notifications in User Studies.

**Canonical citation / stable key:** Weber, Dominik; Voit, Alexandra; Kollotzek, Gisela; Henze, Niels. “Annotif: A System for Annotating Mobile Notifications in User Studies.” MUM 2019. **Key:** `10.1145/3365610.3365611`.

**Slice role and network:** A/D/F. Notification Log downstream annotation and participant-validation network.

**Instrument/rung:** Android NotificationListenerService records new/removed notifications, package, time, priority, and group key; participants review and annotate/censor; R4.

**Exact construction, cleaning, selection, and threshold provenance:** The system logs callback-level notification records in the background and exposes them to participants for annotation. It explicitly cautions that Android notification events are not equivalent to visible notification counts because grouping and re-creation can generate callback artifacts. Thirteen users annotated 6,188 unique notifications with 93.02% annotation coverage. Participant review provides a validation layer, but does not reconstruct a complete state history when callbacks are missing.

**Rule status:** Declared event fields and human validation; grouping/replacement semantics acknowledged but not fully normalized into episodes.

**Code/data/raw-log availability:** Paper available; built on the open Notification Log framework. The participant dataset was not located as an open raw corpus.

**Primary sources:** [DOI](https://doi.org/10.1145/3365610.3365611); [Framework](https://github.com/interactionlab/android-notification-log).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes.

**Confidence:** High.

### A13. Dismissed! A Detailed Exploration of How Mobile Phone Users Handle Push Notifications.

**Canonical citation / stable key:** Pielot, Martin; Vradi, Amalia; Park, Souneil. “Dismissed! A Detailed Exploration of How Mobile Phone Users Handle Push Notifications.” MobileHCI 2018. **Key:** `10.1145/3229434.3229445`.

**Slice role and network:** A/D/F. Large-scale mobile notification behavior.

**Instrument/rung:** Android notification posted/removed events plus screen off/on/unlock, app launches, and notification-drawer Accessibility events; R4.

**Exact construction, cleaning, selection, and threshold provenance:** Same-second posted-event bursts are collapsed by retaining the last event. Across 278 participants the study analyzed 794,525 notifications. A notification is treated as consumed when the corresponding application opens before notification removal; arrivals while that app is already foreground are excluded. Removal itself can represent manual dismissal, application timeout/replacement, or consumption on another device, so “dismissed” remains a proxy rather than a definitive human action.

**Rule status:** Declared deduplication and app-open attribution; cross-device, timeout, replacement, and missing callback branches remain conflated.

**Code/data/raw-log availability:** Primary full text available; collector and raw participant data not verified as open.

**Primary sources:** [DOI](https://doi.org/10.1145/3229434.3229445).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### A14. My Phone and Me: Understanding People’s Receptivity to Mobile Notifications.

**Canonical citation / stable key:** Mehrotra, Abhinav; Pejovic, Veljko; Vermeulen, Jo; Hendley, Robert; Musolesi, Mirco. “My Phone and Me: Understanding People’s Receptivity to Mobile Notifications.” CHI 2016. **Key:** `10.1145/2858036.2858566`.

**Slice role and network:** A/D/F. Mobile notification receptivity and ESM.

**Instrument/rung:** Android notification logger with screen state, unlock, application launch, and contextual sensing; R4.

**Exact construction, cleaning, selection, and threshold provenance:** The paper distinguishes arrival, seen, accepted, and dismissed. “Seen” is operationalized as the next unlock after arrival; when the phone is already unlocked, seen time is forced to zero. Acceptance is inferred from notification click or opening the corresponding application; swipe/removal represents dismissal. Context is sampled at arrival and removal. The retained study included 10,372 notifications and 474 ESM responses from 20 users who completed at least 14 questionnaires. Up to four ESM prompts/day were delivered, and the paper notes that study prompts themselves increase notification exposure.

**Rule status:** Declared state proxies and inclusion rule; exact visual exposure and ambiguous removals are not observable.

**Code/data/raw-log availability:** Primary full text available; no open raw log/collector verified.

**Primary sources:** [DOI](https://doi.org/10.1145/2858036.2858566).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes.

**Confidence:** High.

### A15. The Anatomy of Smartphone Unlocking: A Field Study of Android Lock Screens.

**Canonical citation / stable key:** Harbach, Marian; De Luca, Alexander; Egelman, Serge. “The Anatomy of Smartphone Unlocking: A Field Study of Android Lock Screens.” CHI 2016. **Key:** `10.1145/2858036.2858267`.

**Slice role and network:** A/D. PhoneLab/mobile-security finite-state instrumentation.

**Instrument/rung:** Custom AOSP/PhoneLab instrumentation records screen on/off, key-entry start, success/failure/too-short/abort/retry, dismissal, lock type, and attempts; R4.

**Exact construction, cleaning, selection, and threshold provenance:** A use session is screen-on→screen-off. Unlock attempts are represented as an explicit finite-state process rather than a single timestamp. The authors postprocess state transitions and report that 9.8% of relevant events were context-switched, with a mean delay of 494 ms. Very short sequences can arrive out of order and were excluded, exposing an ordering failure mode that ordinary UsageStats studies often hide.

**Rule status:** Explicit typed state machine and ordering exclusion; out-of-order sequences are discarded rather than repaired, and no alternative policy set is supplied.

**Code/data/raw-log availability:** Primary article available; PhoneLab instrumentation/raw logs not released as a reusable builder.

**Primary sources:** [DOI](https://doi.org/10.1145/2858036.2858267).

**Explicit duplicate check:** DOI/title absent from packet indexes.

**Confidence:** High.

### A16. Real-World Winds: Micro Challenges to Promote Balance Post Smartphone Overload.

**Canonical citation / stable key:** Terzimehić, Nađa; Huber, Julia; Aragon-Hahner, Sarah; Mayer, Sven. “Real-World Winds: Micro Challenges to Promote Balance Post Smartphone Overload.” CHI 2024. **Key:** `10.1145/3613904.3642583`.

**Slice role and network:** A/D. German mobile intervention / overload detection.

**Instrument/rung:** Kotlin Android foreground service logs screen lock/unlock, session duration, and applications per session; R3.

**Exact construction, cleaning, selection, and threshold provenance:** The intervention defines overload as either 12 min of uninterrupted screen use or more than five unlocks within 30 min. A sticky-notification action lets participants respond. The paper treats these as design triggers rather than universal session thresholds; context dependence and false positives are acknowledged. The underlying session evidence is lock/unlock based.

**Rule status:** Declared intervention gates and lock/unlock session evidence; no comprehensive event-repair semantics.

**Code/data/raw-log availability:** Paper and app repository are public; original participant logs are not.

**Primary sources:** [DOI](https://doi.org/10.1145/3613904.3642583); [Code](https://github.com/mimuc/chi24-rww).

**Explicit duplicate check:** Exact DOI/title absent from indexes.

**Confidence:** High.

### A17. What Makes Smartphone Use Meaningful or Meaningless?

**Canonical citation / stable key:** Lukoff, Kai; Yu, Cissy; Kientz, Julie; Hiniker, Alexis. “What Makes Smartphone Use Meaningful or Meaningless?” PACM IMWUT 2018. **Key:** `10.1145/3191754`.

**Slice role and network:** A/D/F. Digital-wellbeing meaning/regret ESM.

**Instrument/rung:** Android `android.app.usage` plus start/during/end ESM; R3.

**Exact construction, cleaning, selection, and threshold provenance:** The logger records app name/category/date/time/duration. An ESM can occur at app launch, during use after 15–120 s, or when the app window closes after at least 15 s. A 30-min prompt cooldown applies, and each app use can receive at most one prompt to reduce reactivity. The study recorded 86,402 app uses and sampled 9,318. These values are selection rules, not a general event-to-episode reconstruction algorithm.

**Rule status:** Declared ESM selection around app-use intervals; upstream UsageStats interval semantics and malformed/missing boundaries are delegated.

**Code/data/raw-log availability:** Primary article and collection code are public; raw participant logs are not.

**Primary sources:** [DOI](https://doi.org/10.1145/3191754).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### A18. Crepe: A Mobile Screen Data Collector Using Graph Query.

**Canonical citation / stable key:** Lu, Yuwen; Chen, Meng; Zhao, Qi; Cox IV, Victor; Yang, Yang; Jiang, Meng; Brockman, Jay; Kay, Tamara; Li, Toby Jia-Jun. “Crepe: A Mobile Screen Data Collector Using Graph Query.” CHI 2026; earlier version arXiv:2406.16173. **Key:** `10.1145/3772318.3791137`.

**Slice role and network:** A/D. Low/no-code UI sensing and participant-governed data collection.

**Instrument/rung:** Android 9+ Accessibility collector with researcher-authored Graph Query rules, local SQLite, Firebase synchronization, and participant monitoring/deletion/opt-out; R4.

**Exact construction, cleaning, selection, and threshold provenance:** Accessibility events are deduplicated with a HashSet and throttled for 4 s; the cache is cleared every 10 s so recurring interactions can be observed again. Data synchronize hourly; failed uploads remain queued, and soft-deleting a collector prevents new collection while preserving already captured data. These are executable acquisition and failure-handling semantics, although they concern event collection rather than a general phone-use episode builder.

**Rule status:** Executable event dedup/throttle, synchronization, and deletion semantics; no crossed opener/closer/gap policy family.

**Code/data/raw-log availability:** Paper/preprint and Android source are public; participant raw traces are not.

**Primary sources:** [DOI](https://doi.org/10.1145/3772318.3791137); [Code](https://github.com/ND-SaNDwichLAB/crepe); [Preprint](https://arxiv.org/abs/2406.16173).

**Explicit duplicate check:** DOI/title absent from packet indexes; preprint/final treated as one work.

**Confidence:** High.

### A19. A Tool for Capturing Smartphone Screen Text.

**Canonical citation / stable key:** Teng, Songyan; D’Alfonso, Simon; Kostakos, Vassilis. “A Tool for Capturing Smartphone Screen Text.” CHI 2024. **Key:** `10.1145/3613904.3642347`.

**Slice role and network:** A/D. Screen-text sensing / digital phenotyping.

**Instrument/rung:** Continuous Android Accessibility screen-text sensor evaluated in a two-week field study with 21 participants; R4.

**Exact construction, cleaning, selection, and threshold provenance:** The system captures screen text continuously rather than sampling pixels at fixed intervals, enabling downstream app/content and affect analyses. It is retained as a source-semantics contribution because subsequent ScreenTK work directly compared event-derived text with screenshots. The primary paper did not expose a general screen/app episode builder, and the complete source repository was not verified.

**Rule status:** Acquisition semantics declared; sessionization and failure repair delegated/absent.

**Code/data/raw-log availability:** Primary article available; no verified open collector/raw corpus.

**Primary sources:** [DOI](https://doi.org/10.1145/3613904.3642347).

**Explicit duplicate check:** Exact DOI/title absent from indexes.

**Confidence:** Medium-High.

### A20. Walls Have Ears: Demystifying Notification Listener Usage in Android Apps.

**Canonical citation / stable key:** Deng, Jiapeng; Liu, Tianming; Zhao, Yanjie; Wang, Chao; Zhang, Lin; Wang, Haoyu. “Walls Have Ears: Demystifying Notification Listener Usage in Android Apps.” PACM Software Engineering/ISSTA 2025. **Key:** `10.1145/3728898`.

**Slice role and network:** A/D. Android static analysis and privacy/security audit.

**Instrument/rung:** NLRadar traces use of `NotificationListenerService` through static analysis plus language-model-assisted labeling; R1/R2 source semantics rather than behavioral episodes.

**Exact construction, cleaning, selection, and threshold provenance:** The tool maps notification origin/content/attributes to storage, network transmission, dismissal, interaction, and automatic reply behaviors in Android applications. This is useful for validating what a collector or third-party app can observe and transform; it does not produce human phone-use episodes.

**Rule status:** Executable source/audit rules; behavioral opener/closer semantics absent.

**Code/data/raw-log availability:** Paper, analyzer/JAR, and supporting datasets are public.

**Primary sources:** [DOI](https://doi.org/10.1145/3728898); [Code](https://github.com/security-pride/NLRadar).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### A21. Why Did You Stop? - Investigating Origins and Effects of Interruptions during Mobile Language Learning.

**Canonical citation / stable key:** Draxler, Fiona; Schneegass, Christina; Safranek, Jonas; Hussmann, Heinrich. “Why Did You Stop? - Investigating Origins and Effects of Interruptions during Mobile Language Learning.” Mensch und Computer 2021. **Key:** `10.1145/3473856.3473881`.

**Slice role and network:** A/D/F. Mobile learning interruption/session resumption.

**Instrument/rung:** LAIRA Android/AWARE collector uses Accessibility, BroadcastReceivers, and JobServices to log apps including launcher/widgets, screen locks, calls, messages, and notifications; R3/R4.

**Exact construction, cleaning, selection, and threshold provenance:** A learning session ends when the learning app goes to background, the screen turns off, or no interaction occurs for 10 min. Returning within 10 min is classified as a suspending interruption; returning later starts a new session. An experience-sampling question is scheduled 10 min after the last interaction, expires after 3 h, and is deleted if another session finishes first. The study recorded 327 sessions and 276 suspending interruptions; 39% of sessions were interrupted.

**Rule status:** Declared session/interruption/resumption and prompt-tail policy; Android event collision and missing-event repair are not generalized.

**Code/data/raw-log availability:** Primary article available; app and participant raw logs not verified as public.

**Primary sources:** [DOI](https://doi.org/10.1145/3473856.3473881).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### A22. S-ADL: Exploring Smartphone-Based Activities of Daily Living to Detect Blood Alcohol Concentration in a Controlled Environment.

**Canonical citation / stable key:** Lee, Hansoo; Kim, Auk; Bae, Sang Won; Lee, Uichin. “S-ADL: Exploring Smartphone-Based Activities of Daily Living to Detect Blood Alcohol Concentration in a Controlled Environment.” CHI 2024. **Key:** `10.1145/3613904.3642832`.

**Slice role and network:** A/D. Controlled human-function assessment using instrumented smartphone tasks.

**Instrument/rung:** Study-owned Samsung phone and Android APIs record scripted screen-off/on, notification, pattern unlock, home UI, app start/end, SMS/contact/call, and interaction metrics; R4 controlled trace.

**Exact construction, cleaning, selection, and threshold provenance:** The study defines controlled action sequences and derives 57 measures including completion time, notification response, app transitions, and unlock attempts from 40 participants. Its value is as a validation-fixture analogue: action order and expected transitions are known. It is not naturalistic usage and does not disclose a reusable raw-event repair engine.

**Rule status:** Declared controlled sequence and expected actions; naturalistic missingness/query-boundary rules absent.

**Code/data/raw-log availability:** Primary article plus supplementary dataset and analysis code are public.

**Primary sources:** [DOI](https://doi.org/10.1145/3613904.3642832); [Dataset/code](https://github.com/Kaist-ICLab/S-ADL_BAC_Detection).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### A23. ScreenLife Capture: An Open-Source and User-Friendly Framework for Collecting Screenomes from Android Smartphones.

**Canonical citation / stable key:** Yee, Andrew Z. H.; Yu, Ryan; Lim, Sun Sun; Lim, Kwan Hui; Dinh, Thi Thu Anh; Loh, Ling; Hadianto, Adeline; Quizon, Miguel. “ScreenLife Capture: An Open-Source and User-Friendly Framework for Collecting Screenomes from Android Smartphones.” Behavior Research Methods 55(8), 2023 (online 2022). **Key:** `10.3758/s13428-022-02006-z`.

**Slice role and network:** A/D/F. Independent screenome/screenshot collection outside Stanford Screenomics.

**Instrument/rung:** Android MediaProjection screen capture plus app/content/interaction timestamps; researcher-configurable screenshot intervals, default 5 s; R3/R4 sampled screenome.

**Exact construction, cleaning, selection, and threshold provenance:** The pilot collected more than 740,000 screenshots from 20 college students over two weeks. Screenshots are stored locally and transferred under the study’s security design; participants can pause collection for private activity. The paper reports some discomfort and behavior change. Because acquisition is a sample grid rather than typed lifecycle events, static duplicate frames, sub-interval interactions, screen-state boundaries, and missing frames require downstream policy.

**Rule status:** Acquisition cadence and privacy pause declared; event-to-episode semantics absent.

**Code/data/raw-log availability:** Primary article and Android collection source are public; pilot raw screenshots are not.

**Primary sources:** [DOI](https://doi.org/10.3758/s13428-022-02006-z); [Code](https://github.com/ScreenLife-Capture-Team/screenlife-capture-collection).

**Explicit duplicate check:** Exact DOI/title absent from supplied indexes; Stanford Screenomics is a separate known DOI and was rejected as duplicate.

**Confidence:** High.

### A24. Learning Next Action Predictors from Human–Computer Interaction.

**Canonical citation / stable key:** Shaikh, Omar; Teutschbein, Valentin; Gandhi, Kanishk; Chi, Yikun; Haber, Nick; Robinson, Thomas; Ram, Nilam; Reeves, Byron; Yang, Sherry; Bernstein, Michael S.; Yang, Diyi. “Learning Next Action Predictors from Human–Computer Interaction.” arXiv preprint, 2026 (NAPsack/LongNAP). **Key:** `10.48550/arXiv.2603.05923`.

**Slice role and network:** A/D. Human–computer interaction foundation models and open action-trace preprocessing; phone corpus but computer-general event logic.

**Instrument/rung:** Continuous screenshots and typed mouse/keyboard/touch-style input events; 30 FPS at 1920×1080 in the documented preprocessing; open NAPsack pipeline; R4 event-burst builder.

**Exact construction, cleaning, selection, and threshold provenance:** Bursts of the same event type are grouped with type-specific maximum gaps and durations: click 0.2/0.3 s, move 0.5/4 s, scroll 0.5/3 s, and key 0.5/6 s. Each action retains 75 ms before the first and after the last event. When a maximum duration is exceeded, the first half is finalized while the second half remains active; monitor changes force restart; overlapping event types are merged in time order. Output is chunked into 60-frame segments. Near-duplicate Screenomics frames are removed at perceptual-hash Hamming distance ≤5/256. The paper says the thresholds are qualitative and should be retuned. Its month-long phone corpus reports 20 users, about 360,000 actions, 1.9 million screenshots, and 1,800 screen-on hours.

**Rule status:** Executable typed-event gap, cap, forced-split, overlap, monitor-boundary, and duplicate-frame policies. It is the strongest new threat to a broad “no executable event repair” claim, but it lacks mobile OS screen/lock/foreground-app lifecycle semantics and does not cross competing policy families.

**Code/data/raw-log availability:** Preprint, project page, and source are public; the naturalistic phone corpus has privacy constraints.

**Primary sources:** [DOI](https://doi.org/10.48550/arXiv.2603.05923); [Project](https://generalusermodels.github.io/nap/).

**Explicit duplicate check:** Exact arXiv DOI/title absent from supplied indexes.

**Confidence:** High.

## B — iOS/native and forensic observability

### B01. iOS Unified Logs — Introduction, Screen Unlock and App Opening.

**Canonical citation / stable key:** Notari, Lionel. “iOS Unified Logs — Introduction, Screen Unlock and App Opening.” Technical artifact analysis, first published 2023 and updated through 2025. **Key:** `ios-unifiedlogs-unlock-2023`.

**Slice role and network:** B/D. Independent iOS forensic artifact analysis, outside Apple dashboard/data-donation studies.

**Instrument/rung:** Apple Unified Log predicates over `apsd`, SpringBoard, application state/focus, and related process messages; R1/R2 forensic raw log semantics.

**Exact construction, cleaning, selection, and threshold provenance:** The analysis documents duplicated log events and activity identifiers, lock/unlock traces including prior-lock duration, and multiple alternative indicators for application launch, foreground/focus, home return, and app exit. It stresses short and version-dependent retention and the need to interpret process/message combinations rather than one event name as ground truth. These are source-level candidate rules, not Apple Screen Time reconstruction.

**Rule status:** Multiple declared forensic predicates and ambiguity warnings; no canonical cross-version episode builder or validation fixtures.

**Code/data/raw-log availability:** Open technical article with query examples; no DOI and no open population raw-log corpus.

**Primary sources:** [Technical article](https://www.ios-unifiedlogs.com/post/ios-unified-logs-unlock).

**Explicit duplicate check:** Exact title/URL manually checked against the DOI-free headings and not found.

**Confidence:** Medium-High.

### B02. iOS Unified Logs Parser

**Canonical citation / stable key:** Notari, Lionel. “iOS Unified Logs Parser” and companion “Parsing: All My SQL Queries.” Open parser/rule library, 2025. **Key:** `ios-unifiedlogs-parser-sql-2025`.

**Slice role and network:** B/D. iOS DFIR parser/tooling.

**Instrument/rung:** Python conversion of `.logarchive` data to JSON/SQLite with timestamp, mach timestamp, boot UUID, process, log number, and activity identifier; SQL labels for app state, lock/unlock, notifications, gestures, scrolling, time/timezone, boot/shutdown; R1/R2.

**Exact construction, cleaning, selection, and threshold provenance:** The tool emits row counts, hashes, event checks, and quality-control information. The author warns that date-filtered extraction can disagree with full extraction and recommends full-log processing before filtering; `log stats` itself can be inconsistent. The SQL library exposes competing predicates for app/lock/notification events and makes version changes inspectable. It does not map those rules into one validated behavioral-episode ontology.

**Rule status:** Executable extraction, QC, and event-label rules; episode pairing and crossed sensitivity policies incomplete.

**Code/data/raw-log availability:** Open parser, SQL rules, and technical documentation; no open longitudinal user corpus.

**Primary sources:** [Parser](https://www.ios-unifiedlogs.com/post/ios-unified-logs-my-parsing-tool-is-out); [SQL rules](https://www.ios-unifiedlogs.com/post/ios-unified-logs-parsing-all-my-sql-queries).

**Explicit duplicate check:** Manual DOI-free title/URL check found no supplied record.

**Confidence:** High for tool behavior; Medium for behavioral meaning.

### B03. Time Well Spent: Precision Timing, Monotonic Clocks, and the PowerLogs Database for iOS.

**Canonical citation / stable key:** Williamson, Mike; Strong, Sab. “Time Well Spent: Precision Timing, Monotonic Clocks, and the PowerLogs Database for iOS.” Forensic Focus technical presentation/article, 2022. **Key:** `powerlogs-monotonic-clocks-2022`.

**Slice role and network:** B/D. Apple PowerLog/iOS timing forensics.

**Instrument/rung:** PowerLog application usage, screen, timezone, and timing records with wall-clock and monotonic clock fields; R1/R2.

**Exact construction, cleaning, selection, and threshold provenance:** The analysis distinguishes `mach_absolute_time`, which pauses during device sleep, from `mach_continuous_time`, which does not, and explains conversion from boot-relative ticks. Monotonic clocks do not jump with daylight-saving or manual wall-clock changes. PowerLog records are batched roughly every 15 min or when queues fill, so write time and occurrence time must not be conflated. This directly informs clock-repair and delayed-write branches.

**Rule status:** Declared timing semantics and batching caveats; no complete app-session builder.

**Code/data/raw-log availability:** Open forensic article/presentation; no code or raw corpus verified.

**Primary sources:** [Technical article](https://www.forensicfocus.com/webinars/time-well-spent-precision-timing-monotonic-clocks-and-the-powerlogs-database-for-ios/).

**Explicit duplicate check:** Manual title/URL check found no supplied DOI-free record.

**Confidence:** Medium-High.

### B04. Directing Smartphone Use Through the Self-Nudge App one sec.

**Canonical citation / stable key:** Grüning, David J.; Riedel, Frederik; Lorenz-Spreen, Philipp. “Directing Smartphone Use Through the Self-Nudge App one sec.” Proceedings of the National Academy of Sciences, 2023. **Key:** `10.1073/pnas.2213114120`.

**Slice role and network:** B/D/F. Cross-platform target-app friction/intervention rather than passive screen-time logging.

**Instrument/rung:** The one sec app intercepts target-app opening and records intervention encounters/resolution; iOS-focused deployment with app-open automation; R3.

**Exact construction, cleaning, selection, and threshold provenance:** On target-app opening, one sec inserts a 10-s friction/deliberation step and offers continuation or dismissal. The main completer sample was 280 from an initial 719 over six weeks. Participants dismissed 36% of interventions, and weekly target-app attempts fell from 166 to 105; actual openings fell by 57%. These are intervention-trigger and response episodes, not total phone sessions.

**Rule status:** Declared target-app opener, 10-s gate, and response state; non-target use, OS-level Screen Time construction, and missing-trigger handling are absent.

**Code/data/raw-log availability:** Open article and OSF analysis data; application source not public.

**Primary sources:** [DOI](https://doi.org/10.1073/pnas.2213114120); [OSF](https://osf.io/p4wy6/).

**Explicit duplicate check:** DOI/title absent from supplied indexes.

**Confidence:** High.

### B05. A Longitudinal In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse.

**Canonical citation / stable key:** Haliburton, Luke; Grüning, David J.; Riedel, Frederik; Schmidt, Albrecht; Terzimehić, Nađa. “A Longitudinal In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse.” CHI 2024. **Key:** `10.1145/3613904.3642370`.

**Slice role and network:** B/D/F. Longitudinal one sec intervention logs.

**Instrument/rung:** Target-app-open intervention records with UUID, app, timestamp, resolution, intervention type and duration; R3.

**Exact construction, cleaning, selection, and threshold provenance:** The intervention delay is configurable from 3–60 s, default 6 s. Dismiss returns home; continue opens the target app. Historical records beyond 43.8 weeks/309 days (mean + 2 SD) were excluded. A “break” is an interaction gap exceeding 2 SD above the mean, operationalized as 2,890 min/48.2 h. The final analysis used 280 users and 970 breaks; 67% of interventions continued and 33% dismissed. The authors explicitly cannot observe pre-install behavior, non-target apps, or silent attrition.

**Rule status:** Declared trigger, response, history cutoff, and break threshold; broader phone-use episode construction absent.

**Code/data/raw-log availability:** Primary article, dataset, and analysis scripts are public.

**Primary sources:** [DOI](https://doi.org/10.1145/3613904.3642370).

**Explicit duplicate check:** DOI/title absent from packet indexes; treated as a follow-up to one sec but a distinct longitudinal dataset/method paper.

**Confidence:** High.

## D — measurement, selection, and construct sensitivity

### D01. Smartphone Use in a Large US Adult Population: Temporal Associations Between Objective Measures of Usage and Mental Well-Being.

**Canonical citation / stable key:** Winbush, Ari; McDuff, Daniel; Hernandez, John; Barakat, Andrew; Jiang, Allen; Heneghan, Conor; Nelson, Benjamin W.; Allen, Nicholas B. “Smartphone Use in a Large US Adult Population: Temporal Associations Between Objective Measures of Usage and Mental Well-Being.” PNAS, 2025. **Key:** `10.1073/pnas.2427311122`.

**Slice role and network:** D/A. Large population digital phenotyping / construct audit.

**Instrument/rung:** Hourly app-category minutes and screen unlock counts; R2/R3 aggregates.

**Exact construction, cleaning, selection, and threshold provenance:** “Total session length” is app-category minutes per hour when that category was used. “Average session length” is those minutes divided by the number of screen unlocks; it is not the duration of reconstructed app or screen sessions. Participant-weeks require at least 48 complete hours, and analyses use weekly means. The terminology is therefore a direct construct-label threat: a quantity called session length can be an algebraic ratio with no underlying episode identity.

**Rule status:** Declared aggregate formula and completeness gate; event construction delegated.

**Code/data/raw-log availability:** Open article; raw participant-level telemetry not public.

**Primary sources:** [DOI](https://doi.org/10.1073/pnas.2427311122).

**Explicit duplicate check:** Exact DOI/title absent from supplied indexes.

**Confidence:** High.

### D02. Pinning, Sorting, and Categorizing Notifications: A Mixed-Methods Usage and Experience Study of Mobile Notification-Management Features.

**Canonical citation / stable key:** Lin, Yong-Han; Su, Li-Ting; Chen, Uei-Dar; Lee, Yi-Chi; Wang, Peng-Jui; Chang, Yung-Ju. “Pinning, Sorting, and Categorizing Notifications: A Mixed-Methods Usage and Experience Study of Mobile Notification-Management Features.” PACM IMWUT 8(3), 2024. **Key:** `10.1145/3678579`.

**Slice role and network:** D/A/F. Notification-center intervention and longitudinal logging.

**Instrument/rung:** NotiManager leaves notifications in the native drawer for 5 s, then moves non-ongoing notifications into a study center while retaining ongoing notifications; logs arrivals, features, ESM, and sensors; R4.

**Exact construction, cleaning, selection, and threshold provenance:** Thirty Android participants used the system for 21 days. Of 109,253 notifications, 36,756 from the default week were excluded, leaving 72,497 intervention-period records. Default-mode ESM/diary records were removed, as were 38 diaries marked “do not remember.” The five-second native-display period is a design/acquisition rule, not a behavioral response threshold.

**Rule status:** Declared notification relocation state, study-period selection, and diary cleaning; underlying Android replacement/removal semantics remain partial.

**Code/data/raw-log availability:** Primary article available; no public raw corpus or complete app source verified.

**Primary sources:** [DOI](https://doi.org/10.1145/3678579).

**Explicit duplicate check:** Exact DOI/title absent from packet indexes.

**Confidence:** High.

## F — discrepancy/reactivity and delegated objective measures

### F01. MindPhone: Mindful Reflection at Unlock Can Reduce Absentminded Smartphone Use.

**Canonical citation / stable key:** Terzimehić, Nađa; Haliburton, Luke; Greiner, Philipp; Schmidt, Albrecht; Hussmann, Heinrich; Mäkelä, Ville. “MindPhone: Mindful Reflection at Unlock Can Reduce Absentminded Smartphone Use.” DIS 2022. **Key:** `10.1145/3532106.3533575`.

**Slice role and network:** F/B/D. Unlock-triggered mindfulness intervention.

**Instrument/rung:** Android unlock-triggered overlay and sticky notification; outcomes include user-reported/native-dashboard screen time and unlocks; R3 trigger, but aggregate outcomes are delegated.

**Exact construction, cleaning, selection, and threshold provenance:** A prompt appears at unlock. In passive mode it can be swiped away or bypassed with home/back; active mode uses a persistent notification and supports re-entry. The intervention therefore has explicit unlock-trigger and bypass paths. However, overall screen time and unlock counts come from survey/native dashboards rather than a disclosed custom event builder.

**Rule status:** Declared intervention trigger/bypass/re-entry; outcome-construction delegated to platform dashboards.

**Code/data/raw-log availability:** Primary article available; no open source/raw log verified.

**Primary sources:** [DOI](https://doi.org/10.1145/3532106.3533575).

**Explicit duplicate check:** Exact DOI/title absent from indexes.

**Confidence:** High.

---

## D. Cross-slice implications and precise novelty amendment

### What changes in Slice A

1. The direct Android prior-art floor is higher than the prior master synthesis captured. PULSE and KTL add explicit screen-session closure/merger rules; Finesse adds executable feature-state sessions; ODIM adds editable trace boundaries; Crepe adds declarative UI collectors with acquisition failure handling; NAPsack adds typed event-burst failure branches; notification systems add multi-state proxies and known ambiguity.
2. A claim that Android work merely consumes opaque aggregates is untenable. Several new records read Accessibility, lock state, notification callbacks, or low-level input events and publish code or exact state transitions.
3. The remaining distinction is that these artifacts each solve a subset: one app/version, one feature family, one notification model, one task, one acquisition scheme, or one chosen policy—not a crossed family over the same raw mobile traces.

### What changes in Slice B

The iOS gap is no longer accurately described as “no executable low-level source rules.” Unified Log tooling publishes parser/QC code and SQL predicates for app state, lock/unlock, notification, gesture, boot, time, and timezone evidence; PowerLog work explains monotonic and delayed-write semantics. What remains unavailable is an authoritative, validated reconstruction of Apple Screen Time/pickup totals and a reusable behavioral episode engine spanning versions.

### What changes in Slice D

Selection/acquisition rules are inseparable from construct validity: screenshot cadence misses events; ESM rules select starts/ends/app switches; target-app friction observes only intervention encounters; notification “interaction” may mean removal; and “average session length” may be a ratio without episode identities. The multiverse must include source/rung and selection semantics, not only gap thresholds.

### What changes in Slice F

Several “objective” outcomes are reactive or delegated. Unlock prompts, notification ESM, privacy pauses, target-app friction, and native dashboard donation alter or selectively observe behavior. Discrepancy analyses must name the actual constructed comparator and its observation effects.

### Claims that should be retired

- “No work publishes executable event grouping or repair.”
- “No mobile study defines sessions or declares thresholds.”
- “Feature-level mobile use is not directly instrumented.”
- “Notification interaction is a single observable state.”
- “iOS has no inspectable low-level app/lock/time evidence.”
- “Session length always denotes an average over reconstructed sessions.”

### Defensible amended novelty statement

> Existing work now includes open mobile screenshot and UI-trace collectors; feature-specific Accessibility detectors; configurable screen-session and interruption rules; typed input-event burst builders with per-type gap, maximum-duration, forced-split, overlap, and duplicate policies; Android notification-state proxies; iOS forensic parser/SQL libraries and monotonic-clock guidance; and task-specific unlock/intervention state machines. We still found no reusable **mobile-OS-specific** artifact that binds versioned typed screen, lock, foreground-app, UI-feature, and notification events to a **crossed family** of opener/closer, pairing, gap, malformed, missing, duplicate, overlap, out-of-order, clock/timezone, system-package, and query-boundary policies; executes competing semantics on the **same open raw mobile logs**; and emits per-episode source lineage, repair/quality traces, and validation fixtures.

The emphasized terms are now load-bearing. Removing “mobile-OS-specific,” “crossed family,” “same open raw mobile logs,” or the lineage/validation conjunction would overclaim against NAPsack, PULSE, Crepe, Finesse, ODIM, and the iOS rule libraries.

---

## E. Corrections, follow-ups, replications, and nulls

| Work/issue | Correction or implication |
|---|---|
| PULSE flow accounting | The reported 23,799 detected, 12,161 sampled, and 21,645 final sessions are not transparently reconciled. Do not reproduce the final count as a clean attrition chain. |
| NAPsack scope | The event-burst rules are computer-general; the naturalistic phone corpus and the documented 30-FPS interaction preprocessing must not be collapsed into a claim that Android lifecycle events were reconstructed. Thresholds are qualitative and explicitly retunable. |
| Call to Action label | Display→removal delay combines clicking/consumption and dismissal; it is not a pure interaction latency. |
| Dismissed! label | Removal can mean manual discard, timeout/replacement, or action on another device. |
| My Phone and Me exposure | “Seen” means next unlock, or zero delay when already unlocked; it is not direct visual-attention evidence. |
| Hard Lock Life duration | Unlock duration includes possible lock-screen viewing. Manual time changes and post-reboot logger failures were excluded rather than repaired. |
| Finesse portability | The open detectors are tied to September-2020 app versions and Korean UI; this is versioned prior art, not a stable universal feature ontology. |
| ScreenTK cadence result | Five-second screenshots missed 38% of active and 57% of passive events in the reported comparison; screenshot cadence is an acquisition policy with measurable consequences. |
| ScreenLife reactivity/coverage | Participants could pause capture for privacy and reported some discomfort/behavior change; missing screenomes can be participant selection, not random sensor loss. |
| iOS Unified Log query boundaries | Date-filtered extraction can disagree with full extraction; full-log extraction before filtering is the safer rule. Occurrence, write, wall-clock, and monotonic times must remain distinct. |
| one sec coverage | The longitudinal study lacks pre-install behavior, non-target applications, and silent attrition; intervention records cannot stand in for total phone use. |
| Winbush metric name | Average session length is a ratio of category minutes to unlocks, not an average over reconstructed sessions. |
| Android notification callbacks | Posted/removed callback counts are not necessarily visible notification objects because grouping, updates, and replacement create extra state transitions. |
| Real-World Winds thresholds | 12 min and >5 unlocks/30 min are intervention gates, not validated universal definitions of overload or sessions. |
| Known companion correction | “Does Longer Phone Use Always Feel Worse?” is already in the corpus and uses the PULSE lineage; it is a follow-up/companion, not a net-new import. |

### Follow-up and replication map

- **PULSE lineage:** *Does Longer Phone Use Always Feel Worse?* is a known companion/successor and therefore not imported. It reinforces intention–duration non-equivalence rather than providing an independent reconstruction replication.
- **one sec lineage:** the 2024 longitudinal CHI paper is a genuine distinct follow-up with open data/scripts and explicit history/break rules, but it observes only target-app intervention encounters.
- **Notification Log lineage:** Annotif and the retained notification studies show reuse of a common callback framework. This is replication of instrumentation feasibility, not a validation that callback states equal visible/user-perceived notification episodes.
- **Screen-text lineage:** ScreenTK provides a direct empirical comparison against 5-s screenshot sampling and is the clearest measurement null/correction: fixed cadence does not capture all active or passive events.
- **No located independent replication invalidated the amended residual novelty.** The closest threats add component rules or source semantics; none verified the entire integrated mobile-specific conjunction.

---

## F. Duplicate, rejected-near-miss, and unresolved audit

### F1. Known-work duplicates (14)

| Stable key | Candidate | Why duplicate |
|---|---|---|
| `10.1145/3772318.3790925` | Does Longer Phone Use Always Feel Worse? Examining How Intention and Duration Shape Evaluations of Time Use | Known A33 / supplied DOI key. |
| `10.1145/3604241` | A Mixed-Method Exploration into the Mobile Phone Rabbit Hole | Known A32 / supplied DOI key. |
| `10.1145/3706598.3713638` | Cyberoception: Finding a Painlessly Measurable New Digital Phenotype | Known A116/F85. |
| `arXiv:2606.08965` | Before You Scroll Again: Predicting Regretful Social Media Sessions From In-the-Wild Contextual and Wearable Sensing | Known A117/D97/F86. |
| `10.1145/3706598.3713187` | Scrolling in the Deep: Analysing Contextual Influences on Intervention Effectiveness During Infinite Scrolling on Social Media | Known A118/D98. |
| `10.1145/3831979` | Can't Stop: How Context and Individual Traits Influence Effectiveness of Different Gradual Interventions for Infinite Scrolling on Short-Form Video Platforms | Known A119/D99. |
| `10.71627/How-to-work-with-Android-App-Logging-Data.1` | How to Work With Android App Logging Data | Known A114; strongest prior-run direct threat. |
| `10.5117/CCR2025.1.8.PARR` | Extracting Meaningful Measures of Smartphone Usage from Android Event Log Data: A Methodological Primer | Known A01. |
| `10.1145/3604240` | A Minimalistic Approach to Predict and Understand the Relation of App Usage with Students’ Academic Performance | Known A86. |
| `10.1145/3770644` | Leveraging Smartphone Human Interaction Routine Behavior Task Mining and Modeling for Daily Stress Monitoring | Known A89. |
| `10.1145/2638728.2641697` | Diversity in Locked and Unlocked Mobile Device Usage | Supplied DOI key; title variant not needed for retention. |
| `10.1038/s44360-026-00072-7` | An Open-Source Platform for Multimodal Digital Trace Data Collection From Smartphones | Known DOI and A99-equivalent Stanford Screenomics platform record. |
| `10.1145/2628363.2628367` | Contextual Experience Sampling of Mobile Application Micro-Usage | Supplied DOI key, despite title not being prominent in the numbered headings. |
| `10.31235/osf.io/k249t` | Smartphone Use in Germany in 2023: A Mixed-Method Investigation | Supplied DOI key; therefore not net-new. |

### F2. Rejected near-misses/off-scope (25)

| Stable key | Candidate | Decision reason |
|---|---|---|
| `10.1145/3772318.3790822` | Stop Fiddling With Your Phone and Go Offline | Dominated by browser/cross-device online traces; explicit scope exclusion. |
| `10.2196/84618` | Digital Phenotyping via Passive Network Traffic Monitoring | Network proxy cannot establish foreground human-use episodes. |
| `arXiv:2605.01616` | Learning Behavioral Signals From Encrypted Smartphone Network Traffic | Encrypted traffic proxy; foreground/background and user action remain indeterminate. |
| `arXiv:2607.17185` | PocketPPD | Direct sensing is present, but the screen builder is delegated and adds no distinctive construction rule. |
| `Android Health Connect docs` | Synthetic Package Name / provenance documentation | Step/health aggregation analogy; explicitly excluded modality. |
| `title-only` | Understanding the Paths and Patterns of App-Switching Experiences in Mobile Searches | Search-task-specific interaction rather than general phone/app episode construction. |
| `title-only` | Understanding Users’ App-Switching Behavior During the Mobile Search: PPM Framework | Survey/intention model without raw device-event reconstruction. |
| `arXiv:1805.02211` | Target Apps Selection: Towards a Unified Search Framework for Mobile Devices | Mobile search/retrieval, not behavioral episode measurement. |
| `10.1145/3701716.3717526` | Agent-Initiated Interaction in Phone UI Automation | Automation-agent episodes, not naturalistic human-use measurement. |
| `title-only` | MobileA3gent: Training Mobile GUI Agents Using Decentralized Self-Sourced Data | GUI-agent training; upstream human session semantics are not the contribution. |
| `arXiv:2605.26546` | MobileExplorer: Accelerating On-Device Inference for Mobile GUI Agents | Automation/inference system, not human phone-use reconstruction. |
| `arXiv:2605.18758` | OmniGUI: Benchmarking GUI Agents in Omni-Modal Smartphone Environments | GUI-agent benchmark; excluded from behavioral ledger. |
| `arXiv:2604.11259` | Mobile GUI Agent Privacy Personalization with Trajectory-Induced Preference Optimization | Agent trajectories and preference learning, not observed user episodes. |
| `arXiv:2508.01337` | Screencast-Based Analysis of User-Perceived GUI Responsiveness | Automated performance/testing trace rather than naturalistic use. |
| `Android documentation` | Notification History user-help and platform documentation | Useful platform context but no validated event-to-notification-episode builder. |
| `title-only` | Evidence to Support Common Application Switching Behaviour on Smartphones | Transition counts without a materially new or inspectable boundary builder. |
| `10.3389/fcomp.2025.1422244` | When the Phone’s Away, People Use Their Computer to Play | Mixed phone/computer distraction; no distinctive mobile event construction. |
| `10.1145/3675094.3678489` | Predicting Affective States from Screen Text Sentiment | Downstream use of the same screen-text lineage; no new acquisition/session policy. |
| `title-only` | AutoJournaling: A Context-Aware Journaling System Leveraging MLLMs on Smartphone Screenshots | Downstream application of screenshots without distinctive event reconstruction. |
| `10.1145/3675094.3677545` | Enabling On-Device LLMs Personalization with Smartphone Sensing | Demo/downstream personalization; builder not the contribution. |
| `GitHub:SimonBaars/AutoScreenshot` | Android AutoScreenshot | Open utility, but not a validated research instrument or episode builder. |
| `GitHub:Genymobile/scrcpy` | scrcpy | General remote-control/screen-mirroring utility; no behavioral measurement semantics. |
| `arXiv:2511.01336` | Beyond Permissions: Investigating Mobile Personalization with Simulated Personas | Synthetic app-response audit rather than naturalistic use episodes. |
| `arXiv:2603.21653` | MISApp: Multi-Hop Intent-Aware Session Graph Learning for Next App Prediction | Model consumes already-sessionized app data; upstream builder hidden. |
| `10.1145/3706599.3720055` | Media Content Atlas: A Pipeline to Explore and Investigate Multidimensional Media Space Using Multimodal LLMs | Content-analysis pipeline; no distinct phone-use episode policy. |

### F3. Unresolved; deliberately excluded from import (13)

| Stable key | Candidate | Missing verification |
|---|---|---|
| `10.1145/3478868` | Alert Now or Never: Understanding and Predicting Notification Preferences of Smartphone Users | Canonical identity verified, but removal-reason and notification-state construction could not be checked deeply enough for import. |
| `10.1016/j.ijhcs.2021.102735` | Understanding and Streamlining App Switching Experiences in the Wild | Potentially relevant app-transition construction; exact upstream boundary and missing-event policy not recovered. |
| `10.1145/3411764.3445384` | “Put it on the Top, I’ll Read it Later”: Investigating Users’ Desired Display Order for Smartphone Notifications | Notification ordering is relevant, but the trace construction was not read deeply enough to distinguish callback events from visible notification objects. |
| `10.1145/3130948` | MyTraces: Investigating Correlation and Causation Between Users’ Emotional States and Mobile Phone Interaction | Notification/app interaction logger verified, but the episode builder and cleaning branches remain insufficiently resolved. |
| `10.1145/2971648.2971747` | PrefMiner: Mining User’s Preferences for Intelligent Mobile Notification Management | Likely notification-state evidence; full rule semantics not verified. |
| `10.1145/3365610.3365618` | Can I Record Your Screen? Mobile Screen Recordings as a Long-Term Data Source for User Studies | On-device privacy-preserving recording is relevant, but exact capture loss, segmentation, and output construction were not accessible enough for import. |
| `10.1145/3544548.3581146` | Not Merely Deemed as Distraction: Investigating Smartphone Users’ Motivations for Notification Interaction | Potentially useful notification-response labels; full event-state definitions not verified. |
| `10.1145/3743703` | From Overwhelmed to Overview: Understanding Smartphone Users’ Preferences and Expectations in Relieving Notification Overload via Text Summarization | 2025 notification-system work; exact trace/cleanup rules not fully accessible. |
| `10.1145/3340764.3340765` | Clear All: A Large-Scale Observational Study on Mobile Notification Drawers | Built on Notification Log and likely important, but full drawer-state reconstruction and filtering were not independently re-read in this run. |
| `10.1080/19312458.2026.2697199` | Beyond Apps: A Method to Model Full Distributions of Screen Content Over Time to Study Media Effects | Canonical 2026 identity and sample scale verified; full acquisition/session methods were inaccessible, so it remains outside import. |
| `10.1016/j.ijhcs.2026.103878` | From Prediction to Explanation: Using Screen Text to Understand Smartphone Use and User Behaviour | Canonical 2026 identity verified; source/event construction appears inherited and could not be fully inspected. |
| `10.1145/3594739.3610699` | Automatic, Manual, or Hybrid? A Preliminary Investigation of Notification Management Modes | Potential downstream state-machine evidence; not enough full-method inspection for import. |
| `10.1145/3130956` | Beyond Interruptibility: Predicting Opportune Moments to Engage Mobile Phone Users | Important notification-receptivity lineage, but exact session/event cleaning was not independently reconstructed in this run. |

A candidate was not promoted merely because its title or abstract sounded relevant. Unresolved records remain outside the import table, consistent with the packet’s rule against importing unverified thresholds, repositories, and statuses.

---

## G. Productive query/network trail and dead ends

### Productive neutral query families (14)

1. foreground/background matching and package-transition traces.
2. screen on/off plus lock/unlock finite-state machines.
3. Accessibility window-state and feature-level UI telemetry.
4. screenshot/screen-text cadence, duplicate frames, and missed events.
5. notification posted/removed/action/reason/grouping state.
6. iOS Unified Log app/lock/clock/boot predicates.
7. UI-trace repair, editable traces, and graph-query collectors.
8. target-app friction/intervention trigger logs.
9. task-session interruption, resumption, and tail expiry.
10. app-switch sequencing and task/session non-equivalence.
11. aggregate “session length” formula audits.
12. open-source collector/repository chasing from primary papers.
13. forensic clock/timezone/write-time/boot semantics.
14. event-conditioned ESM selection and measurement reactivity.

### Productive independent networks

- HCI/CHI/IMWUT mobile session-labeling and context modeling (PULSE, KTL).
- UI-level data collection and repair (ODIM, Crepe).
- App-specific feature telemetry (Finesse, InstaReader).
- Notification instrumentation and annotation (Notification Log, Annotif, Dismissed!, My Phone and Me, TYDR, NotiManager).
- Mobile security and lock-state finite-state machines (Hard Lock Life, Anatomy of Smartphone Unlocking).
- Screenome/screen-text acquisition (ScreenLife Capture, ScreenTK, screen-text tool).
- Mobile task/interruption sequences (mobile tasks, Why Did You Stop?, S-ADL).
- iOS DFIR Unified Log and PowerLog timing communities.
- Digital-wellbeing intervention logs (one sec, Socialize, Real-World Winds, MindPhone).
- Human–computer action foundation-model preprocessing (NAPsack), reached from neutral event-burst terminology rather than smartphone-screen-time citations.

### Dead ends

- generic web analytics and mobile browser/search clickstreams.
- network/DNS/TLS traffic proxies.
- mobile GUI automation-agent benchmarks and training corpora.
- wearables/steps/activity/sleep used only by analogy.
- generic mental-health passive sensing with no disclosed screen/app builder.
- process-mining papers connected only by the words event or session.
- commercial marketing pages where primary methods or source code existed.

The most productive tactic was source-code and method-section chasing from neutral instrumentation terms. Generic “screen time session” searches disproportionately returned already-known psychology papers, vendor dashboards, and web/network proxies.

---

## H. Compact import table

The companion CSV contains the full machine-importable table. This compact rendering preserves the required decision fields.

| Stable key | Role | Title | Year/status | Rule status | Thresholds | Source depth | Availability | Confidence |
|---|---|---|---|---|---|---|---|---|
| `10.1145/3714394.3754395` | A/D/F | PULSE: A Screenshot-Based Labeling Tool for Investigating Smartphone Behavior, Intent, and Perception. | 2025 peer-reviewed | Declared for screen/session closure, duration bins, and ESM selection; orphan, overlap, duplicate, reboot, clock-change, and query-tail branches are absent or undetermined. | screen off >30 s; inactivity 30 s; bins 0–5/5–30/30–60/60–180/180–300/≥300 s; ≤15 prompts/day; ≥1 h prompt spacing; ≥12 h/day; 08:00–23:00 | primary full text + methods tables | Paper and toolkit description available; no public participant raw log or complete collector repository was verified in this run. | High |
| `10.1145/3544548.3580689` | A/D/F | Are You Killing Time? Predicting Smartphone Users’ Time-Killing Moments via Fusion of Smartphone Sensor Data and Screenshots. | 2023 peer-reviewed | Declared screen-off merger, acquisition cadence, look-back exclusion, and analysis window; lifecycle collision, missing-close, reboot, clock/timezone, and query-boundary policies are absent. | screen-off merge ≤45 s; screenshots/sensors every 5 s; 30-s feature window; first hour/day excluded; ≥12 h/day | primary full text + public code | MIT-licensed model code, weights, and examples are public; original privacy-sensitive participant screenshots/logs are not public. | High |
| `10.1145/3522711` | A/D | Characterization and Prediction of Mobile Tasks. | 2022 peer-reviewed | Declared 45-s session boundary and separate task formalization; upstream Android event pairing, missing records, and clock handling are delegated to UbiqLog. | standby/inactivity >45 s starts a new session | primary full text | Primary article available; the analyzed sample is derived from an existing corpus, but no independent raw-event reconstruction implementation was verified. | High |
| `10.1145/3479600` | A/D/F | Reflect, Not Regret: Understanding Regretful Smartphone Use with App Feature-Level Analysis. | 2021 peer-reviewed | Executable and declared for app-specific feature states and feature-session end; system-app filters, malformed layout handling, overlap, missing end, reboot, and clock policies are incomplete or app-specific. | ESM reset logic every 3 h in source; no general inactivity gap; semantics tied to September-2020 app versions and Korean UI | primary full text + executable source | Android source, study APK, and version guidance are public; participant raw logs are not public. | High |
| `10.1145/3743726` | A/D | On-Device Interaction Mining. | 2025 peer-reviewed | Executable package-transition segmentation and explicit human repair are declared; no general screen/unlock session layer and no crossed alternative pairing/gap policies. | package transition is the main boundary; no fixed inactivity gap reported | primary full text + executable source | Paper and Android source are public; no large open naturalistic raw corpus was verified. | High |
| `10.1145/3675094.3677547` | A/D | ScreenTK: Seamless Detection of Time-Killing Moments Using Continuous Mobile Screen Text and On-Device LLMs. | 2024 peer-reviewed | Declared acquisition and interval derivation; app/session opener/closer, orphan/missing event repair, and clock/timezone handling are delegated or absent. | comparison screenshot cadence 5 s; no session gap | primary full text | Paper and method description available; complete collector source and participant raw stream were not verified as public. | High |
| `10.1145/3267305.3274118` | A/D | Notification Log: An Open-Source Framework for Notification Research on Mobile Devices. | 2018 peer-reviewed | Executable source semantics and storage path declared; user-visible episode construction and cross-version removal semantics remain partial. | callback-driven; no behavioral time gap | primary full text + executable source | MIT-licensed Android source and paper are public; no single open participant corpus accompanies the framework. | High |
| `10.3390/s24082612` | A/D | Call to Action: Investigating Interaction Delay in Smartphone Notifications. | 2024 peer-reviewed | Declared cleaning windows and exclusions; semantic action attribution is conflated and no replacement/grouping state machine is published. | remove delay ≤0 or >1 day excluded; battery join ±10 min | primary full text | Open article; original user-level raw data and complete collector source were not verified as public. | High |
| `10.1145/3770713` | A/D | Beyond the Feature Level: A Cluster Analysis of Feature-Level Social Media Behaviour Patterns, Maladaptive Use, and Psychological Well-Being. | 2025 peer-reviewed | Declared at the feature-state/URL level; general episode construction undetermined. Retained because the instrument materially changes the observability boundary, not because it closes the residual novelty claim. | No verified general behavioral gap; controlled state changes | publisher record + primary system description; full method partially inaccessible | Publisher record and system description verified; no public code or raw participant trace located. | Medium |
| `10.1145/3447991` | A/D | Understanding, Discovering, and Mitigating Habitual Smartphone Use in Young Adults. | 2021 peer-reviewed | Declared simple screen-on→screen-off construction; missing screen-off, rapid off/on, reboot, system apps, and overlap semantics are absent. | screen on→screen off; no gap merger | primary full text + software materials | Primary article and Socialize software materials are available; raw participant logs are not public. | High |
| `10.5555/3235838.3235857` | A/D | It’s a Hard Lock Life: A Field Study of Smartphone (Un)Locking Behavior and Risk Perception. | 2014 peer-reviewed | Explicit state machine and selection policy; failures are detected/excluded, not reconstructed. No versioned alternative policies. | heavy ≥9 unlocks/h at 10% sampling; medium 4–8/h at 15%; max 1 ESM/h | primary full text | USENIX paper is public; logger source/raw data not located. | High |
| `10.1145/3365610.3365611` | A/D/F | Annotif: A System for Annotating Mobile Notifications in User Studies. | 2019 peer-reviewed | Declared event fields and human validation; grouping/replacement semantics acknowledged but not fully normalized into episodes. | 93.02% annotation coverage is an observed completeness result, not a behavioral threshold | primary full text + open base framework | Paper available; built on the open Notification Log framework. The participant dataset was not located as an open raw corpus. | High |
| `10.1145/3229434.3229445` | A/D/F | Dismissed! A Detailed Exploration of How Mobile Phone Users Handle Push Notifications. | 2018 peer-reviewed | Declared deduplication and app-open attribution; cross-device, timeout, replacement, and missing callback branches remain conflated. | same-second posted burst collapsed; no fixed response cap reported | primary full text | Primary full text available; collector and raw participant data not verified as open. | High |
| `10.1145/2858036.2858566` | A/D/F | My Phone and Me: Understanding People’s Receptivity to Mobile Notifications. | 2016 peer-reviewed | Declared state proxies and inclusion rule; exact visual exposure and ambiguous removals are not observable. | ≥14 questionnaires for inclusion; ≤4 ESM/day; seen=next unlock or 0 when already unlocked | primary full text | Primary full text available; no open raw log/collector verified. | High |
| `10.1145/2858036.2858267` | A/D | The Anatomy of Smartphone Unlocking: A Field Study of Android Lock Screens. | 2016 peer-reviewed | Explicit typed state machine and ordering exclusion; out-of-order sequences are discarded rather than repaired, and no alternative policy set is supplied. | session screen on→off; 9.8% context-switched; 494-ms mean delay is observed, not a cleaning threshold | primary full text | Primary article available; PhoneLab instrumentation/raw logs not released as a reusable builder. | High |
| `10.1145/3613904.3642583` | A/D | Real-World Winds: Micro Challenges to Promote Balance Post Smartphone Overload. | 2024 peer-reviewed | Declared intervention gates and lock/unlock session evidence; no comprehensive event-repair semantics. | 12 min uninterrupted use; >5 unlocks/30 min | primary full text + app repository | Paper and app repository are public; original participant logs are not. | High |
| `10.1145/3191754` | A/D/F | What Makes Smartphone Use Meaningful or Meaningless? | 2018 peer-reviewed | Declared ESM selection around app-use intervals; upstream UsageStats interval semantics and malformed/missing boundaries are delegated. | during prompt 15–120 s; end prompt only after ≥15 s; 30-min cooldown; max 1 prompt/app use | primary full text + public code | Primary article and collection code are public; raw participant logs are not. | High |
| `10.1145/3772318.3791137` | A/D | Crepe: A Mobile Screen Data Collector Using Graph Query. | 2026 peer-reviewed | Executable event dedup/throttle, synchronization, and deletion semantics; no crossed opener/closer/gap policy family. | 4-s throttle; cache clear 10 s; hourly sync | primary full text + executable source | Paper/preprint and Android source are public; participant raw traces are not. | High |
| `10.1145/3613904.3642347` | A/D | A Tool for Capturing Smartphone Screen Text. | 2024 peer-reviewed | Acquisition semantics declared; sessionization and failure repair delegated/absent. | continuous Accessibility capture; two-week study; no general gap | primary full text | Primary article available; no verified open collector/raw corpus. | Medium-High |
| `10.1145/3728898` | A/D | Walls Have Ears: Demystifying Notification Listener Usage in Android Apps. | 2025 peer-reviewed | Executable source/audit rules; behavioral opener/closer semantics absent. | No behavioral threshold | primary full text + executable source/data | Paper, analyzer/JAR, and supporting datasets are public. | High |
| `10.1145/3473856.3473881` | A/D/F | Why Did You Stop? - Investigating Origins and Effects of Interruptions during Mobile Language Learning. | 2021 peer-reviewed | Declared session/interruption/resumption and prompt-tail policy; Android event collision and missing-event repair are not generalized. | 10-min inactivity/resumption boundary; ESM scheduled after 10 min and expires after 3 h | primary full text | Primary article available; app and participant raw logs not verified as public. | High |
| `10.1145/3613904.3642832` | A/D | S-ADL: Exploring Smartphone-Based Activities of Daily Living to Detect Blood Alcohol Concentration in a Controlled Environment. | 2024 peer-reviewed | Declared controlled sequence and expected actions; naturalistic missingness/query-boundary rules absent. | Script-defined task boundaries, no general gap | primary full text | Primary article plus supplementary dataset and analysis code are public. | High |
| `10.3758/s13428-022-02006-z` | A/D/F | ScreenLife Capture: An Open-Source and User-Friendly Framework for Collecting Screenomes from Android Smartphones. | 2022 peer-reviewed | Acquisition cadence and privacy pause declared; event-to-episode semantics absent. | default screenshot interval 5 s; two-week pilot | primary full text + executable source | Primary article and Android collection source are public; pilot raw screenshots are not. | High |
| `10.48550/arXiv.2603.05923` | A/D | Learning Next Action Predictors from Human–Computer Interaction. | 2026 preprint | Executable typed-event gap, cap, forced-split, overlap, monitor-boundary, and duplicate-frame policies. It is the strongest new threat to a broad “no executable event repair” claim, but it lacks mobile OS screen/lock/foreground-app lifecycle semantics and does not cross competing policy families. | click gap/max 0.2/0.3 s; move 0.5/4 s; scroll 0.5/3 s; key 0.5/6 s; ±75 ms context; 60-frame chunks; pHash distance ≤5/256 | primary full text + executable source/project | Preprint, project page, and source are public; the naturalistic phone corpus has privacy constraints. | High |
| `ios-unifiedlogs-unlock-2023` | B/D | iOS Unified Logs — Introduction, Screen Unlock and App Opening. | 2023–2025 open technical analysis | Multiple declared forensic predicates and ambiguity warnings; no canonical cross-version episode builder or validation fixtures. | Retention is device/version dependent; no universal gap | author technical analysis + query examples | Open technical article with query examples; no DOI and no open population raw-log corpus. | Medium-High |
| `ios-unifiedlogs-parser-sql-2025` | B/D | iOS Unified Logs Parser | 2025 open tool/grey literature | Executable extraction, QC, and event-label rules; episode pairing and crossed sensitivity policies incomplete. | Full extraction recommended before time filtering; no behavioral gap | executable tool + source-oriented technical documentation | Open parser, SQL rules, and technical documentation; no open longitudinal user corpus. | High for tool behavior; Medium for behavioral meaning |
| `powerlogs-monotonic-clocks-2022` | B/D | Time Well Spent: Precision Timing, Monotonic Clocks, and the PowerLogs Database for iOS. | 2022 forensic technical article | Declared timing semantics and batching caveats; no complete app-session builder. | approximately 15-min batch/queue flush behavior; boot-relative monotonic conversion | author forensic technical presentation/article | Open forensic article/presentation; no code or raw corpus verified. | Medium-High |
| `10.1073/pnas.2213114120` | B/D/F | Directing Smartphone Use Through the Self-Nudge App one sec. | 2023 peer-reviewed | Declared target-app opener, 10-s gate, and response state; non-target use, OS-level Screen Time construction, and missing-trigger handling are absent. | 10-s friction; six-week observation | primary full text + open analysis data | Open article and OSF analysis data; application source not public. | High |
| `10.1145/3613904.3642370` | B/D/F | A Longitudinal In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse. | 2024 peer-reviewed | Declared trigger, response, history cutoff, and break threshold; broader phone-use episode construction absent. | delay 3–60 s, default 6 s; history cap 43.8 weeks/309 d; break >2,890 min/48.2 h | primary full text + open dataset/scripts | Primary article, dataset, and analysis scripts are public. | High |
| `10.1073/pnas.2427311122` | D/A | Smartphone Use in a Large US Adult Population: Temporal Associations Between Objective Measures of Usage and Mental Well-Being. | 2025 peer-reviewed | Declared aggregate formula and completeness gate; event construction delegated. | ≥48 complete h/week; average session length = category minutes / unlocks | primary full text | Open article; raw participant-level telemetry not public. | High |
| `10.1145/3678579` | D/A/F | Pinning, Sorting, and Categorizing Notifications: A Mixed-Methods Usage and Experience Study of Mobile Notification-Management Features. | 2024 peer-reviewed | Declared notification relocation state, study-period selection, and diary cleaning; underlying Android replacement/removal semantics remain partial. | native display 5 s; 21-day study; 36,756 default-week records excluded; 38 “do not remember” diaries excluded | primary full text | Primary article available; no public raw corpus or complete app source verified. | High |
| `10.1145/3532106.3533575` | F/B/D | MindPhone: Mindful Reflection at Unlock Can Reduce Absentminded Smartphone Use. | 2022 peer-reviewed | Declared intervention trigger/bypass/re-entry; outcome-construction delegated to platform dashboards. | trigger at unlock; no general session gap | primary full text | Primary article available; no open source/raw log verified. | High |

---

## Final research judgment

The fresh search materially changes the citation map and narrows the novelty claim, but it does not eliminate the core contribution. The most dangerous overclaim is now any formulation centered on the mere existence of typed events, thresholds, executable grouping, UI-level telemetry, repair actions, provenance-like QC, or validation fixtures in isolation. All of those components have stronger prior art than the earlier corpus showed. The defensible contribution is the **integrated, versioned, mobile-specific, policy-crossed, lineage-emitting comparison object** and its empirical use on the same open raw logs.

No unresolved candidate was used to support that final claim. The conclusion is therefore conservative with respect to inaccessible 2026 full texts and notification papers whose event-state methods could not be independently reconstructed.
