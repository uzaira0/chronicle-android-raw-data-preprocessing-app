# Chronicle Android paper-feasibility audit handoff

**Date:** 2026-08-06

**Status:** Static source audit complete; no Chronicle application, API, server, model, or preprocessing code changed

**Primary question:** Which Android collection and processing methods in the consolidated paper corpus cannot be reproduced end-to-end with the current local Chronicle implementation?

## Executive conclusion

Chronicle can reproduce most package-level app-use, screen-state, pickup, coarse unlock, shared-device attribution, and broad CAFE-family analyses. It cannot currently reproduce the paper families that require any of the following:

1. Periodic screenshots or screen video.
2. Continuous screen text, full Accessibility trees, view identifiers, or graph queries.
3. Exact finger coordinates, touch trajectories, or keyboard streams.
4. Stable notification identity, replacement/grouping history, removal reason, or human annotation.
5. Low-latency session-triggered ESM, app-entry friction, blocking overlays, cooldowns, expiration, or intervention outcomes.
6. Credential-entry starts, failed PIN/pattern attempts, aborts, retries, or other custom-lockscreen internals.
7. Exact behavioral-biometric timing based on the original sensor timestamp since reboot, joined to child-versus-other user labels.
8. End-to-end researcher access to interaction and notification streams through the standard Chronicle export and preprocessing path.

Some missing paper methods need only a new preprocessing strategy over data Chronicle already collects. Others require new Android collection modules, shared models, server tables/endpoints, exports, and analysis support. Detailed credential-attempt telemetry requires a privileged or modified Android build and is outside the capability of a normal third-party Chronicle app.

## Scope and operator constraints

The literature scope was direct or near-direct mobile screen, app, unlock, notification, UI-feature, session, and processing work. Generic web analytics, clickstream, network-traffic inference, and analogy-only work were intentionally excluded. Chronicle/CAFE work was included, but it was not treated as the organizing center; the corpus includes multiple independent groups and software lineages.

The authoritative literature directory is:

- `docs/paper/consolidated-literature/`

The principal reconciliations used in this audit are:

- `chatgpt-pro-fresh-discovery-reconciliation-2026-08-06.md`: 31 independently reconciled direct additions, comprising 28 peer-reviewed records and three labeled iOS technical artifacts.
- `chatgpt-pro-deep-research-2026-08-06.md`: 17 accepted records from the preceding deep-research pass, including GESIS, Cyberoception, feature-level scrolling studies, forensic artifacts, LV-Linker, reactivity work, and synthetic-data work.
- `master-review.md`: cross-slice synthesis and corpus-level claims.
- `../search-briefs/results-slice-A.md`: Android instrumentation and the latest CAFE/shared-device and behavioral-biometric records.

## Repositories and exact revisions reviewed

Canonical paths were resolved through the local repository registry. A similarly named older server checkout at `/Users/u/chronicle/chronicle-server` was not used as authority.

| Component | Canonical path | Branch and revision at audit | Remote relationship |
|---|---|---|---|
| Android application | `/Users/u/chronicle/methodic/chronicle` | `develop` at `0ac181c` | matched `origin/develop` |
| Shared API | `/Users/u/chronicle/methodic/chronicle-api` | `develop` at `02d43e6` | matched `origin/develop` |
| Server | `/Users/u/chronicle/methodic/chronicle-server` | `develop` at `c414d5c1` | matched `origin/develop` |
| Shared models | `/Users/u/chronicle/methodic/chronicle-models` | `main` at `21c6273` | matched `origin/main` |
| Standalone preprocessing app | `/Users/u/chronicle-android-raw-data-preprocessing-app` | `main` at `8ea594b` | two commits ahead of `origin/main` |

The Android app already had user-owned modifications to `DataSharingFragment.kt` and `AppDecisionSurfaceContractTest.kt`. The preprocessing repository already had modified literature ledgers and an untracked consolidated-literature directory. None of those changes were reverted, rewritten, or used as a reason to edit application behavior.

## Feasibility definition

This audit uses four distinct labels:

- **End-to-end feasible now:** the current Android collector captures the needed signal, the current model/API/server persist it, researchers can obtain it through a supported export, and the current preprocessing path can consume it or the final calculation is a small ordinary query.
- **Data-feasible, implementation missing:** current raw data are sufficient, but the exact paper rule is not a selectable preprocessing policy or supported output.
- **Partially feasible:** Chronicle captures a useful proxy or subset, but fields or semantics needed for the paper's exact construct are absent.
- **Not feasible with the current version:** a new collector, privacy tier, schema, runtime trigger, or privileged Android build is required.

This definition prevents "the server has a row somewhere" from being mistaken for a supported research workflow.

## Current end-to-end data path

| Signal family | Android collection | Upload and server storage | Standard researcher export | Current standalone preprocessing |
|---|---:|---:|---:|---:|
| UsageStats app/screen/keyguard events | Yes | Yes | Yes | Yes |
| Android hardware sensors | Yes | Yes | Yes | No general cross-stream join |
| Interaction salience | Yes, opt-in Accessibility service | Yes | No | No |
| Notification activity | Yes, limited and opt-in | Yes | No | No |
| Screenshots or screen video | No | No | No | No |
| Screen text or full UI hierarchy | No | No | No | No |
| Event-triggered ESM or behavioral intervention | No generic runtime | Not applicable | Not applicable | No |

The most important product-level integration gap is that interaction and notification data are collected and stored but are absent from the standard participant export types and absent from the preprocessing app's input model.

## What the Android app currently captures

### Usage events

`UsageEventsChronicleSensor` queries `UsageStatsManager.queryEvents(previous, current)` every 15 minutes. It preserves:

- package name;
- optional Activity class;
- raw numeric event type;
- human-readable interaction label;
- event timestamp;
- time zone;
- application label; and
- target-user label selected through the shared-device identification flow.

Recognized events include Activity resumed/paused/stopped, screen interactive/noninteractive, keyguard shown/hidden, foreground-service start/stop, device startup/shutdown, configuration changes, shortcuts, user interaction, and standby-bucket changes. Unknown numeric event types are labeled as unknown but the numeric value remains in the row.

The 15-minute poll interval delays observation but does not reduce retrospective event-time resolution. It does prevent this source from acting as a reliable low-latency intervention trigger.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/collection-usage/src/main/java/com/openlattice/chronicle/sensors/UsageEventsChronicleSensor.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/android/ChronicleUsageEvent.kt`

### Interaction salience

The opt-in Accessibility service subscribes only to click, long-click, scroll, focus, accessibility-focus, and selection events. For the interacted node it can record:

- node bounds;
- display dimensions, density, rotation, and display identifier;
- element role/class;
- package name;
- interaction type;
- signed scroll deltas;
- monotonic event time;
- a 30-second interaction-episode identifier;
- dwell since the preceding event;
- derived scroll velocity; and
- scroll-direction reversal.

It deliberately does not record:

- element text;
- `contentDescription`;
- view identifier;
- a complete window or node tree;
- exact finger coordinates; or
- raw touchscreen motion events.

New events leave the legacy `rawX`, `rawY`, and normalized-position fields null because the accessible node center is not the user's pointer location. The persistence path uses a bounded queue with capacity 512, so exact completeness under a very high-frequency event burst is not guaranteed.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/app/src/main/res/xml/interaction_accessibility_service_config.xml`
- `/Users/u/chronicle/methodic/chronicle/app/src/main/java/com/openlattice/chronicle/collection/interaction/InteractionCollectionService.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/collection/AndroidInteractionEvent.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/collection/InteractionPolicy.kt`

### Notification activity

The NotificationListener records only:

- a new random event UUID;
- callback wall-clock time;
- time zone;
- POSTED or REMOVED;
- package name;
- Android notification category;
- ongoing flag; and
- importance.

It does not retain:

- `StatusBarNotification.key`;
- original `postTime`;
- notification ID, tag, group key, or replacement identity;
- removal reason;
- click versus dismissal cause;
- a stable join between a posted callback and its removed callback;
- notification text or title; or
- human annotation or censoring state.

Android exposes matching fields and a reason-bearing removal callback, so most of these are product omissions rather than a custom-OS requirement. Content remains a separate high-sensitivity decision.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/app/src/main/java/com/openlattice/chronicle/services/notifications/NotificationListener.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/collection/AndroidNotificationActivityEvent.kt`
- Android API: <https://developer.android.com/reference/android/service/notification/NotificationListenerService.html>

### User identification at unlock

The foreground unlock-monitoring service registers for `ACTION_USER_PRESENT`, `ACTION_SCREEN_ON`, and the post-reboot identification action. It posts a high-priority notification. The participant must tap that notification to open the Child/Other identification activity.

This is not an unavoidable lockscreen overlay. If the notification is ignored or notification permission is denied, subsequent usage remains unidentified. The selected user is applied to UsageEvents by timestamp. Sensor samples do not carry the same label.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/app/src/main/java/com/openlattice/chronicle/services/notifications/DeviceUnlockMonitoringService.kt`
- `/Users/u/chronicle/methodic/chronicle/app/src/main/java/com/openlattice/chronicle/receivers/lifecycle/UnlockDeviceReceiver.kt`
- `/Users/u/chronicle/methodic/chronicle/app/src/main/java/com/openlattice/chronicle/UserIdentificationActivity.kt`

### Questionnaires and prompts

The questionnaire module reconciles recurrence clauses into AlarmManager-backed notifications that deep-link to a web questionnaire. It is recurrence-driven, not driven by app entry, screen sessions, interaction inactivity, unlock count, or a behavioral threshold.

It has no generic representation of:

- prompt cooldown;
- maximum prompts per day based on event context;
- expiration or supersession;
- continue/dismiss/bypass state;
- app blocking; or
- intervention re-entry.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/collection-notifications/src/main/java/com/openlattice/chronicle/collection/notifications/QuestionnaireCollectionModule.kt`

### Sensors

Chronicle supports accelerometer, gyroscope, magnetometer, gravity, linear acceleration, rotation vector, step counter, light, proximity, significant motion, tilt, and screen orientation, with configurable sampling and duty cycle. The configured maximum is sufficient for 100 Hz behavioral-biometric collection.

`SensorEvent.timestamp` is converted from the monotonic since-boot domain into wall-clock `OffsetDateTime`; the original monotonic value is not included in the shared sensor DTO. Sensor rows also lack the Child/Other target-user label.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/collection-sensors/src/main/java/com/openlattice/chronicle/collection/sensors/SensorGateway.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/android/AndroidSensorSample.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/android/AndroidSensorSetting.kt`

### Explicitly inactive or absent collection families

`CollectionModuleId` declares the following as reserved and inactive:

- `INTERACTION_CONTENT`;
- `APP_INVENTORY`;
- `GAZE_TRACKING`;
- `LOCATION`; and
- `COMMUNICATION_LOG`.

The app manifest contains no screenshot/MediaProjection architecture, `SYSTEM_ALERT_WINDOW`, location, microphone, call-log, or SMS permission path needed by the corresponding paper methods. The current content-free boundary is intentional, not an accidental failure to serialize a field.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/collection/CollectionModuleId.kt`
- `/Users/u/chronicle/methodic/chronicle/app/src/main/AndroidManifest.xml`
- Android MediaProjection API: <https://developer.android.com/reference/android/media/projection/MediaProjectionManager>
- Android 14 capture-session consent behavior: <https://developer.android.com/about/versions/14/behavior-changes-14>

## Server and export findings

The Android app has upload endpoints for interaction and notification activity. The server has dedicated upload services and database persistence for both. Inserts use event identifiers for idempotency.

However, the standard participant-data enum and export switch expose only usage events, preprocessed usage events, app-usage surveys, iOS sensors, and Android sensors. Interaction, notification, battery, and most sensing-expansion tables are not standard export choices.

Primary evidence:

- `/Users/u/chronicle/methodic/chronicle/app/src/main/java/com/openlattice/chronicle/api/ChronicleStudyApi.kt`
- `/Users/u/chronicle/methodic/chronicle-server/src/main/kotlin/com/openlattice/chronicle/services/upload/InteractionEventsUploadService.kt`
- `/Users/u/chronicle/methodic/chronicle-server/src/main/kotlin/com/openlattice/chronicle/services/upload/NotificationActivityUploadService.kt`
- `/Users/u/chronicle/methodic/chronicle-models/src/main/kotlin/com/openlattice/chronicle/study/ParticipantDataType.kt`
- `/Users/u/chronicle/methodic/chronicle-server/src/main/kotlin/com/openlattice/chronicle/services/export/ExportService.kt`

The production server does not execute the current Rust/WASM preprocessing application. It stores raw usage events and preprocessed rows produced through its existing workflow, while the audited preprocessing application remains a standalone browser application.

## Current preprocessing capabilities

The standalone preprocessing app consumes Chronicle raw UsageEvents CSV data. It does not ingest `interaction_events`, `notification_activity`, screenshots, screen text, UI trees, or sensor streams.

The current Rust implementation supports:

- fused matching;
- Parry-Toth forward pairing;
- EYES complement segmentation;
- Culverhouse trim-and-log as a separate interval-quality policy;
- exact-row deduplication;
- duplicate-timestamp correction;
- configurable stop vocabularies and fallback stops;
- long-duration and data-gap flags;
- time-zone handling;
- concurrent-use splitting;
- screen-session classification and close reasons;
- screen-gated usage credit;
- study-window filtering;
- target-user attribution;
- day coverage and compliance scoring;
- app categorization;
- aggregates; and
- output lineage and execution evidence.

It does not currently provide exact selectable implementations of:

- GESIS's nearest-stop, ten-event, 600-second, next-global-event, timeout, close-provenance, and 60-second grouping procedure;
- PULSE's composite screen-off/inactivity/labeling-interface closure;
- the 45-second screen-off merge used by *Are You Killing Time?*;
- the task hierarchy and interleaving model in *Characterization and Prediction of Mobile Tasks*; or
- the interruption, resume, prompt-tail, and expiry procedure in *Why Did You Stop?*.

Primary evidence:

- `/Users/u/chronicle-android-raw-data-preprocessing-app/README.md`
- `/Users/u/chronicle-android-raw-data-preprocessing-app/rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs`
- `/Users/u/chronicle-android-raw-data-preprocessing-app/rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs`
- `/Users/u/chronicle-android-raw-data-preprocessing-app/rust/chronicle_app_usage_matcher/src/lib.rs`

## Paper-family feasibility matrix

| Paper or method family | Verdict | Current support | Missing requirement |
|---|---|---|---|
| Cyberoception; Yang et al.; simple screen-on/off studies | End-to-end feasible | UsageStats activity, screen, and keyguard events | Exact paper-specific reporting may still require a query |
| Chronicle/CAFE app-duration and pickup work | Largely feasible | Package duration, categories, target-user labels, gaps, partial days, pickup events | Paper-specific unpublished cleaning choices are not recoverable from the papers themselves |
| Munzer et al. 2024 | Feasible | Screen-interactive events, numeric notification interruption, 60-second join, gap thresholds | App-duration builder in the paper was not disclosed, but Chronicle can use its current auditable builder |
| O'Connor et al. 2025 | Feasible with compliance caveat | Child/Other unlock notification and target-user UsageEvents | Prompt can be ignored; identification is not attached to sensor rows |
| Woods et al. 2026 | Feasible | Long-duration/gap inspection, first/last partial-day removal, app filtering/categories | Exact unpublished thresholds cannot be reproduced as historical fact |
| Finnegan et al. 2024/2025 behavioral biometrics | Partial | 100 Hz accelerometer/gyroscope collection is possible | Original since-reboot timestamp discarded; no automatic Child/Other sensor label; the 2025 work shows poor temporal/postural transfer |
| Parry-Toth, EYES, Culverhouse policies | Feasible in current local preprocessor | Implemented strategy or interval-quality policy | Must be selected explicitly |
| GESIS/Zerrer | Data-feasible, strategy missing | Required raw package/event/time rows exist | Exact repair and provenance policy is not implemented |
| PULSE | Not exact | Screen events and some sensors exist | Screenshots, composite real-time close, labeling UI, trigger quotas |
| Are You Killing Time? | Not exact | Sensors and raw screen events exist | Five-second screenshots, integrated multimodal windows, 45-second merge policy |
| Characterization and Prediction of Mobile Tasks | Data-feasible, analysis missing | Raw app/screen transitions can support a 45-second boundary | Task classifier, multi-session task model, interleaving model |
| Finesse / Reflect, Not Regret | Not feasible now | Coarse click/scroll/role/package and optional Activity class | Full UI tree, view IDs/text/state transitions, app/version-specific feature detectors |
| ScreenTK; continuous screen-text tool | Not feasible now | None for text | Continuous Accessibility text/tree capture and model pipeline |
| Crepe | Not feasible now | Single-node salience and robust upload concepts overlap | Full graph-query acquisition over screen UI trees |
| ODIM | Partial | Package transitions and coarse interactions | Screenshots, complete hierarchies, gesture traces, human split/delete/repair interface |
| ScreenLife Capture; screenome studies | Not feasible now | None for images | MediaProjection capture, storage, upload, redaction, retention, export |
| LV-Linker | Not feasible now | Processed app logs exist | Screen video acquisition and a synchronized validation UI |
| Scrolling in the Deep; Can't Stop; Before You Scroll Again | Partial proxy only | Scroll bouts, dwell, package/activity events | Reliable feed/Reels/comments/passive-scroll feature identity and real-time intervention gate |
| Beyond the Feature Level | Not feasible over opaque third-party apps | Package/activity metadata only | Instrumented application state or a fragile app-specific UI-state collector |
| Notification Log | Partial | POSTED/REMOVED, package, category, importance | Stable notification identity, original post time, updates/groups, reason-bearing removal |
| Call to Action | Partial | Coarse post/remove times and battery telemetry | Per-notification linkage and trustworthy action/dismissal semantics |
| Annotif | Not feasible exactly | Notification callbacks exist | Annotation UI, stable item identity, grouping/replacement normalization |
| Dismissed!; My Phone and Me | Partial | Notification, unlock, screen and app events exist | Click/dismiss cause, stable linkage, exposure/seen semantics, event-triggered ESM |
| Walls Have Ears | Partial observability | Chronicle uses NotificationListenerService | Chronicle does not expose the full observable/control surface or audit transformations |
| NotiManager | Not feasible now | Notification listener exists | Pin/sort/relocate/cancel manager and its state model |
| Real-World Winds | Retrospective thresholds feasible; intervention not | Usage/unlock events permit later 12-minute and unlock-count analysis | Low-latency trigger and intervention runtime |
| Meaningful or Meaningless? | Not feasible exactly | App-use intervals can be reconstructed later | Launch/during/end prompt selection, cooldown and response linkage |
| Why Did You Stop? | Data-feasible boundaries; runtime missing | App background, screen-off and timing evidence | On-device interruption state machine, 10-minute trigger, 3-hour prompt expiry |
| one sec | Not feasible now | None for target-app interception | App-entry interception, friction delay, continue/dismiss/break states |
| MindPhone | Partial resemblance only | Unlock notification and identification activity | Unavoidable mindful-reflection flow, bypass and re-entry outcomes |
| Hard Lock Life | Coarse state machine feasible | Screen/keyguard events | Exact study sampling/ESM runtime is absent |
| Anatomy of Smartphone Unlocking | Not feasible for exact method | Successful unlock and coarse keyguard transitions | Credential-entry start, failure, abort, retry, lock type; requires modified/privileged OS |
| S-ADL | Partial passive observation only | Generic app, screen, notification and sensor evidence | Controlled task orchestrator, unlock attempts, call/SMS module, exact task action identity |
| Winbush et al. | Feasible | Category minutes, unlocks, coverage rules and aggregates | Named metric may require a small downstream query |

## Findings by implementation cost

### A. Preprocessing-only additions

These require no new Android collection and should be the lowest-risk extensions:

1. GESIS exact reconstruction and close provenance.
2. The 45-second screen-off merger.
3. Mobile-task 45-second grouping and an explicit task-level output.
4. Retrospective Real-World Winds thresholds.
5. Named Winbush aggregate output.
6. Exact paper-policy presets that record thresholds and provenance without changing the default fused path.

### B. Product plumbing over data already collected

1. Add interaction and notification activity to `ParticipantDataType`.
2. Add corresponding server download/export implementations.
3. Add preprocessing input adapters for both streams.
4. Add a cross-stream time and device/participant join with explicit clock-domain provenance.
5. Export interaction-queue loss diagnostics if exact event completeness is claimed.

### C. Moderate Android/model/server changes

1. Preserve notification key, original post time, ID/tag/group identity, update identity, and removal reason.
2. Preserve the original monotonic Android sensor timestamp alongside wall-clock time.
3. Make target-user attribution joinable to sensor samples.
4. Add a generic event-trigger engine for app, screen, unlock, interaction-idle, and notification conditions.
5. Add prompt cooldown, quota, expiry, supersession and outcome models.

### D. High-sensitivity new research tier

These should not be folded silently into the current content-free modules:

1. MediaProjection screenshots or screen video.
2. Full Accessibility trees, view IDs, text, and content descriptions.
3. Notification content.
4. Exact or near-exact touch/motion observation.

Each needs a separate privacy classification, study configuration, participant consent, data-retention policy, model/API schema, server storage, export path, and deletion coverage.

### E. Custom-OS or instrumented-application work

1. Credential-attempt and lockscreen-anatomy studies require custom AOSP/PhoneLab-style instrumentation.
2. Exact feature behavior in an Instagram-like system is most reliable in an instrumented application controlled by the researchers.
3. A normal Chronicle installation should not claim these capabilities based on package/activity or coarse Accessibility proxies.

## Recommended continuation order

If implementation work follows this audit, resume in this order:

1. **Close the export gap first.** Interaction and notification collection already incur participant consent and storage cost; leaving the data outside the standard researcher path is the clearest end-to-end defect.
2. **Add preprocessing adapters and cross-stream joins.** This makes current collection scientifically usable before expanding collection scope.
3. **Add exact reconstruction policies over existing UsageEvents.** Start with GESIS because it is the strongest executable repair precedent and does not require new sensitive data.
4. **Expand the content-free notification schema.** Stable identity, post time and removal reason unlock several notification papers without collecting message text.
5. **Preserve monotonic sensor timing and user-label joins.** This addresses the strongest exact-method gap in the behavioral-biometric papers.
6. **Design a generic trigger/ESM runtime only if intervention studies are a product goal.** It should be based on exact named paper requirements, not a parallel abstraction with no caller.
7. **Make an explicit product/IRB decision before screenshots or screen content.** The current structural content-free guarantee is valuable and should not be weakened accidentally.
8. **Treat custom-lockscreen instrumentation as out of scope for ordinary Chronicle unless a managed research OS becomes a separate product.**

## Important caveats

1. **Feasible does not mean historically identical.** If a paper omitted its event-pairing or cleaning rules, Chronicle can run an auditable current policy but cannot reconstruct the authors' undisclosed historical choices.
2. **Delayed collection is not low-latency detection.** UsageEvents retain original timestamps, but a 15-minute poll cannot support interventions that must fire at app entry or session end.
3. **Activity class is not a general feature identifier.** It is opt-in, and many applications implement multiple features inside one Activity.
4. **Accessibility availability varies.** Secure windows may not expose a source node, applications differ in Accessibility quality, and Chronicle skips events without usable bounds.
5. **Content-free interaction is a proxy.** Node bounds, role, dwell and scroll kinematics do not become exact touch coordinates or exact semantic feature identity.
6. **Notification removal is not automatically human response.** Even after adding removal reason, replacement, grouping, application cancellation, timeout and user action must remain distinct.
7. **Shared-device attribution is compliance-dependent.** Chronicle's unlock prompt can be ignored and is suppressed if notification permission is denied.
8. **The Finnegan 2025 corrective result matters.** High same-session biometric accuracy should not be generalized across time or posture; the later work reports catastrophic transfer failures in some conditions.

## Literature records most important for implementation

1. Zerrer, Wieland and de Alwis, *How to Work With Android App Logging Data* - strongest directly executable app-episode repair policy.
2. PULSE - screenshots plus composite session closure and event-triggered labeling.
3. *Are You Killing Time?* - periodic screenshot/sensor fusion and a 45-second screen-off merger.
4. Finesse / *Reflect, Not Regret* - executable app-specific feature state detection from Accessibility and UI trees.
5. ODIM - package-transition segmentation plus screenshot, hierarchy, gesture and human repair tooling.
6. Crepe - Graph Query acquisition, throttling, cache reset, upload retry and deletion controls.
7. Notification Log, Annotif, *Dismissed!*, *My Phone and Me*, and *Call to Action* - notification identity, callback, annotation and response semantics.
8. *Why Did You Stop?*, one sec, MindPhone, *Real-World Winds*, and *Meaningful or Meaningless?* - real-time trigger and intervention requirements.
9. *The Anatomy of Smartphone Unlocking* - proof that exact credential-attempt anatomy belongs to modified lockscreen instrumentation.
10. Finnegan et al. 2024 and 2025 - behavioral-biometric acquisition and the temporal/postural validity correction.
11. Munzer 2024, O'Connor 2025, and Woods 2026 - current Chronicle/CAFE methods and reporting gaps.

The strongest-new-methods table is in `chatgpt-pro-fresh-discovery-reconciliation-2026-08-06.md`. GESIS and the preceding deep-research additions are reconciled in `chatgpt-pro-deep-research-2026-08-06.md`. The complete direct-field records for the newer CAFE and biometric work are in `../search-briefs/results-slice-A.md` under A91-A95.

## Audit method and verification performed

The audit was read-only until creation of this handoff. It used:

- canonical repository resolution and branch/status inspection;
- full-text search for manifests, permissions, collection modules, models, DTOs, upload workers, server upload services, database/export paths, and preprocessing inputs;
- line-level inspection of collectors and model contracts;
- comparison against the reconciled direct-paper corpus rather than titles alone; and
- current official Android documentation for MediaProjection, Accessibility motion/window behavior, and notification removal reasons.

No Android build, server test, or preprocessing test was needed to establish the negative capability findings because they are defined by absent permissions/modules/fields/export cases and explicit content-free contracts. Any later implementation must run the repository-specific gates described in each repository's instructions.

## Working-tree handoff

At handoff creation, the preprocessing repository was on `main`, two commits ahead of `origin/main`, with pre-existing modifications to all six search-result ledgers, an untracked `.sha256-skip.patch`, and an untracked `docs/paper/consolidated-literature/` directory. This handoff is an additive file in that existing untracked directory. Do not discard or rewrite the surrounding literature work when continuing.

No commit, push, branch change, deployment, server mutation, or external message was performed.
