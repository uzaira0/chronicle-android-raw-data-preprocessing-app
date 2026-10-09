-- # Class: PlatformEventOccurrence Description: The real-world Android lifecycle/system occurrence (an app resuming, the screen turning off, a shutdown). This is the thing that happened in the world — NOT the logged record and NOT an observation. Deliberately untyped as sosa:Observation.
--     * Slot: id
--     * Slot: occurrence_instant Description: When the occurrence happened.
--     * Slot: event_code Description: Canonical event type.
-- # Class: UsageEventRecord Description: The logged information artifact for one Android usage event. A prov:Entity, not an observation.
--     * Slot: id
--     * Slot: event_timestamp_ns Description: Event timestamp in nanoseconds since epoch.
--     * Slot: event_code Description: Canonical event type.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: app_class_name Description: Android activity class name.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: timezone Description: Original recording timezone (preserved).
--     * Slot: records_occurrence_id Description: The real-world occurrence this record logs.
-- # Class: LoggingObservation Description: OPTIONAL. The OS logger's act of observing a device property, modeled only if that abstraction is genuinely needed. Do NOT type UsageEventRecord as this.
--     * Slot: id
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: result_record_id Description: The event record produced by the logging observation.
-- # Class: InteractionTraceRecord Description: A supplied normalized current interaction trace, not a device-use session, prospective method plan or claimed ODIM serialization. Events belong to this trace in explicit sequence positions; absent events are not current members. ODIM PDF pp. 6-7 sections 4.2-4.3 supports sequential events and manual removal. No timestamp-sort predicate, edit journal or payload-byte verification is implied.
--     * Slot: id
--     * Slot: interaction_trace_id Description: Normalized identity of one current interaction trace.
--     * Slot: trace_description Description: Supplied semantic description of this whole trace/task (ODIM PDF p. 9 section 4.5), separate from event/screen descriptions and redaction justifications. Preserve text verbatim, including empty versus null/omission. No author, original serializer or manual/LLM generation route is inferred; the source's manual annotation implementation remains distinct from its illustrative LLM augmentation.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Optional supplied trace participant identity. Known identities constrain linked tasks; unknown identity is not inferred from payloads or accounts.
--     * Slot: trace_record_origin Description: Distinguishes constructed examples from supplied normalized data without claiming source authentication.
-- # Class: InteractionEventRecord Description: One normalized trace member with paired visual/structural payload identities and optional gesture. Positions express current trace order, not timestamps. Capture incompleteness and human-detected incorrectness are independent nullable assertions; gesture presence implies neither correctness nor a human assessment. ODIM PDF pp. 6-7 sections 4.2-4.3. IDs and field names are normalized, not recovered.
--     * Slot: id
--     * Slot: interaction_event_id Description: Normalized event identity, unique within its owning trace.
--     * Slot: screen_description Description: Supplied description of this labelled screen interaction (ODIM PDF p. 9 section 4.5), owned by the event within its trace, not by a reusable screenshot payload. Independent of the whole trace description and redaction justification; preserve verbatim empty/null/omission without inferring an annotator or generation route.
--     * Slot: event_sequence_position Description: Nonnegative position in the current trace; unique within the trace. Does not assert a source timestamp-sort algorithm.
--     * Slot: screenshot_artifact_id Description: Identity of this event's screenshot in the supplied existing ArtifactRef catalog.
--     * Slot: hierarchy_artifact_id Description: Identity of this event's paired view hierarchy in the supplied ArtifactRef catalog.
--     * Slot: gesture_artifact_id Description: Optional gesture payload identity; absent or null is not silently completed.
--     * Slot: capture_incomplete Description: Supplied capture-completeness assertion, not inferred here from gesture presence; independent of human correctness review.
--     * Slot: human_detected_incorrect Description: Supplied human finding of incorrect interaction metadata; false, null and omission remain distinct.
--     * Slot: InteractionTraceRecord_id Description: Autocreated FK slot
-- # Class: InteractionRedactionRecord Description: A supplied record of paired effects on its owning event's screenshot and hierarchy. ODIM device selection deletes selected-element pixels and tags corresponding text/content; web selection blackens a drawn region and removes metadata for supplied sufficiently-high-IoU elements (PDF pp. 8-9 section 4.4). The actual cutoff, tag spelling, pixel fill and node/pixel correspondence are not inferred. Records do not establish effective sanitization of payload bytes.
--     * Slot: id
--     * Slot: redaction_record_id Description: Normalized identity of one paired redaction record.
--     * Slot: redaction_selection_basis Description: Element selection versus drawn-region/IoU selection; no undisclosed cutoff is supplied.
--     * Slot: target_region_id Description: Supplied identity of the drawn web pixel region, without invented geometry.
--     * Slot: redacted_screenshot_artifact_id Description: Identity of the paired screenshot output, not an executed sanitization claim.
--     * Slot: redacted_hierarchy_artifact_id Description: Identity of the corresponding hierarchy output, not an executed sanitization claim.
--     * Slot: screenshot_redaction_effect Description: Supplied pixel-side effect of this paired redaction.
--     * Slot: hierarchy_redaction_effect Description: Supplied hierarchy-side effect of this paired redaction.
--     * Slot: redaction_justification Description: Supplied per-redaction textual justification (ODIM device route, PDF p. 8 section 4.4); no web prompt or mandatory response is inferred.
--     * Slot: InteractionEventRecord_id Description: Autocreated FK slot
-- # Class: NotificationDrawerSnapshotRecord Description: One supplied normalized observation of pending Android drawer state, not a posted/removed callback, image, usage session or prospective method. Clear All PDF pp.4-5. Required empty membership means observed empty; an absent snapshot does not. A normalized ID is not the source ascending transmission ID. No inter-snapshot arrival, removal, dismissal, continuous residence or fixed realized sampling interval is inferred (PDF p.10).
--     * Slot: id
--     * Slot: snapshot_record_id Description: Normalized snapshot identity scoped by profile and device; not a generated transmission counter.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: device_id Description: Device identifier.
--     * Slot: snapshot_record_origin Description: Explicit example versus supplied normalized record status; neither authenticates source serialization.
--     * Slot: snapshot_instant Description: Supplied normalized observation-time representation; original encoding and epoch are not inferred or converted here.
--     * Slot: timezone Description: Original recording timezone (preserved).
--     * Slot: android_version Description: Supplied textual Android version at this observation (Clear All PDF p.4); not an inferred numeric version or immutable device attribute. Empty, null and omission remain distinct.
--     * Slot: device_model Description: Supplied textual model at this observation (Clear All PDF p.4), without an inferred model codebook or immutable device attribute.
--     * Slot: device_product Description: Supplied textual product name at this observation (Clear All PDF p.4), not an assumed model alias.
--     * Slot: device_manufacturer Description: Supplied textual manufacturer at this observation (Clear All PDF p.4), without case normalization or eligibility filtering.
--     * Slot: snapshot_transmission_id_token Description: Supplied opaque textual representation of the source transmission ID, separate from normalized snapshot identity (Clear All PDF p.4 filtering rule4). No numeric coercion, monotonicity, missing-counter inference or original serialization is asserted.
-- # Class: NotificationItemAppearanceRecord Description: One pending-item appearance in its owning observed snapshot. Repeated item references preserve recurrence without creating callback events. Supplied item identity is scoped by profile, device and identity basis; identical tokens on another device or basis do not imply the same item. Paper identity components and release key/postTime tokens are alternative normalized representations, not recovered raw types or automatically equated identities. Drawer position is observation-specific and has no assumed ordinal base.
--     * Slot: id
--     * Slot: appearance_record_id Description: Normalized appearance identity unique within its owning snapshot.
--     * Slot: notification_item_id Description: Supplied recurring-item reference scoped by profile/device/identity basis; conflicting or split identities are rejected rather than automatically merged across scopes.
--     * Slot: item_identity_basis Description: Source-backed identity definition for this appearance, not an asserted equivalence between source versions.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: notification_id_json Description: Losslessly preserved JSON token for the supplied paper-basis ID; lexical consistency is checked without numeric coercion or claiming equivalence of alternative JSON encodings.
--     * Slot: notification_tag_json Description: Losslessly preserved paper-basis JSON tag token; JSON null and string null remain distinct without inventing a missing-tag convention or alternative-encoding equivalence.
--     * Slot: creation_instant Description: Supplied normalized creation-time representation for the paper identity; neither an observed arrival nor an inferred residence start.
--     * Slot: notification_key_token Description: Supplied linked-code key string without an invented package/ID/tag expansion.
--     * Slot: post_time_identity_token Description: Supplied literal str(postTime) identity token from the linked-code basis; not a parsed epoch or verified conversion.
--     * Slot: drawer_position Description: Supplied normalized observation-specific drawer ordinal; no source zero/one base or creation-time ordering is asserted.
--     * Slot: priority_value_json Description: Supplied appearance-local priority as a lexical JSON value token (Clear All linked release 08_notification_priorities.ipynb cell7). No import-time clamp, vocabulary inference or original raw-type equivalence; changes do not alter recurring-item identity.
--     * Slot: clearability_value_json Description: Supplied appearance-local clearability as a lexical JSON value token (Clear All linked release 09_non_clearable_notifications.ipynb cells6/21/27). False, zero, string false and null remain distinct; no truthiness, cast, user action or permanence is inferred.
--     * Slot: group_key_compat_value_json Description: Supplied appearance-local groupKeyCompat lexical JSON value token (Clear All linked shared.py lines17/33). Present null and empty string are not absence, and import applies no default, key expansion or grouping.
--     * Slot: group_summary_compat_value_json Description: Supplied appearance-local isGroupSummaryCompat lexical JSON value token (Clear All linked shared.py lines24/35/37); no truthiness conversion or summary-member selection is performed by import.
--     * Slot: group_key_compat_absent Description: Explicit normalized assertion about original linked-release group-key absence; true must not coexist with a supplied group_key_compat_value_json token, false asserts not absent, and null or omission is unknown. Never inferred from normalized omission or used to apply a default during import.
--     * Slot: NotificationDrawerSnapshotRecord_id Description: Autocreated FK slot
-- # Class: NotificationHistoryRecord Description: One supplied normalized item history with independently retained evidence, linked subjective responses and supplied acceptance outcomes. My Phone and Me (2016), accepted manuscript pp.3-4 and p.8. Identity is local to the profile, participant and supplied device (when known), not a recovered raw key, Clear All identity definition or a package/title/time match. Inlining scopes references to this item; it does not imply exclusive ownership of a world occurrence such as an unlock shared by multiple pending items. No action matching, timestamp arithmetic, acceptance recode or missing-data completion runs during import. Tokens, omissions and supplied order remain. Optional original-history references distinguish a temporary snooze prompt or retriggered copy from the original item (Snooze DOI 10.1145/3229434.3229436 pp.3–4 Figure2). Supplied references resolve within profile/source/participant/device, including forward references; no package/title matching, chronology or five-second realized interval is inferred.
--     * Slot: id
--     * Slot: notification_history_id Description: Normalized item-history record identity scoped by profile/participant/known device.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: history_record_origin Description: Example versus supplied normalized history; not authenticated original rows.
--     * Slot: notification_item_id Description: Supplied normalized item reference scoped by profile/participant/known device; no Clear All basis or source-key recovery is asserted.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: notification_title Description: Supplied normalized title text (My Phone and Me p.4 Table1); empty, null and omission remain distinct. Not notification content or an identity key.
--     * Slot: title_annotation_reference Description: Supplied annotation ID resolved in the owning profile/participant; omission/null is unknown association. No app/title equality, device identity, sender parser or location join is inferred.
--     * Slot: original_notification_history_reference Description: Optional supplied original item-history ID for a temporary snooze prompt or retriggered copy. Positive references resolve to another history within profile/source/participant/device at ingress; forward references are allowed and null/omission is unknown. No identity matching or chronology is inferred.
-- # Class: NotificationCallbackGroupRecord Description: Supplied normalized group of independently recorded notification-posted callbacks, with an optional supplied member designated as an analytic alert proxy. Dismissed! (DOI 10.1145/3229434.3229445), printed pp.3:3–3:4, distinguishes posted-event bursts from usually perceived alerts and retains the last posted event after title filtering. The retained callback itself is the proxy; no third proxy identity or logical notification-item identity is required. Group membership and designation are supplied, not computed. Positive proxy references resolve only within this group at ingress; omission/null is unknown, not observed perception or a negative alert. Ingress admits only recorded posted_callback members, retaining opaque times, lexical payloads, local supporting references and supplied order. Group IDs are scoped by profile/participant/supplied device, not recovered raw keys. No timestamp sorting, LAST selection, title filtering, second bucket, grouping partition, tie rule or notification matching is inferred. Equal times or payloads do not merge independently identified callbacks.
--     * Slot: id
--     * Slot: callback_group_id Description: Supplied normalized posted-callback group identity scoped by profile/participant/supplied device; not a notification item or an automatically computed second bucket.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: history_record_origin Description: Example versus supplied normalized history; not authenticated original rows.
--     * Slot: analytic_alert_proxy_reference Description: Optional supplied evidence_record_id of the posted member retained as an analytic alert proxy in this callback group. Null/omission stays unknown. No perception observation, LAST computation, sorting or third proxy identity is asserted.
-- # Class: NotificationTitleAnnotationRecord Description: Supplied participant-relative multi-label annotation of a communication title, shared by referenced notification items; not a permanent category, globally identified sender or deduplicated notification. Content-driven notifications (DOI 10.1145/2750858.2807544), p.4 Dataset and footnote2. Normalized identity is scoped by profile and participant, not app/device. Labels remain independent of each item's location-resolved category. Optional title allows withheld/discarded raw content (p.4 privacy passage); omission/null is not an invented title hash. No matching, deduplication, normalization, GPS join or category resolution runs during import.
--     * Slot: id
--     * Slot: title_annotation_id Description: Supplied normalized shared annotation identity scoped by profile/participant, not a recovered raw title/sender key.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: annotation_record_origin Description: Example versus supplied normalized annotation; not authenticated original labels or title matching.
--     * Slot: notification_title Description: Supplied normalized title text (My Phone and Me p.4 Table1); empty, null and omission remain distinct. Not notification content or an identity key.
-- # Class: ParticipantDayObservationRecord Description: Supplied populated objective aggregate, subjective response or collection-run modality availability owned by a profile/work/participant, an optional explicitly supplied device, and exactly one supplied day, specific-hour, night or collection-run identity. Energy Drain2015 §3.4 distinguishes daily energy per device; device identity is never inferred from participant identity. Same- and cross-period supports stay within the supplied device owner (or the unknown-device owner when omitted/null). The class and day_* transport names are retained for compatibility; an hour or night is never stored in referenced_day_token. CHI2020 Paper36 p5 CCM separately aggregates each retained emotion, application launches and use duration per participant per one-hour period. Hour tokens identify particular periods, not recurring hour-of-day buckets, and do not establish their endpoints. In-Situ notifications pp.3-4 asks about the prior day; p.6 associates daily objective notification logs with subjective responses about that same day. No notification-item identity is required. Each period token is opaque, not an inferred calendar date, cutoff, timezone or raw study join key. Values, units, categories and optional question wording are supplied independently; absence/null is not zero. Subjective supports point only to objective records in the same owner/period kind/token unless an explicit cross-period reference identifies a different target period and the supplied relationship. Murnane2016 pp3,7–8 distinguishes prior-night sleep, following-day use and event counts during that night. No night/day identity or adjacency is inferred. Moodable primary508–517,603–611,685–689 separately permits any subset of contributed modalities. Run-owned modality availability uses its local method definition, not a day or classifier campaign; run tokens do not assert repeated original participation. Unavailable does not infer why data were not contributed. Import neither aggregates, joins timestamps, schedules prompts nor computes correlations. Normalized origin does not authenticate original participant rows or recover the full instrument.
--     * Slot: id
--     * Slot: day_observation_id Description: Supplied observation identity scoped by profile/participant/period kind/token, not a raw join key; legacy day-named transport supports explicit hour ownership.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: referenced_day_token Description: Explicitly supplied opaque identity of the day described, mutually exclusive with hour/night tokens; not substituted from prompt/submission time, parsed, calendar-normalized or timezone-converted.
--     * Slot: referenced_hour_token Description: Explicitly supplied opaque identity of a particular one-hour period, not an hour-of-day bucket, day or night. Mutually exclusive with day/night tokens; no endpoints, timezone or timestamp join inferred (CHI2020 Paper36 p5 CCM).
--     * Slot: referenced_night_token Description: Explicitly supplied opaque identity of the night described, not a calendar day, prompt time, source serializer or inferred sleep interval. Mutually exclusive with day/hour tokens; no endpoints or preceding/following day recovered (Murnane2016 pp3,7–8).
--     * Slot: referenced_run_token Description: Explicitly supplied opaque collection/assessment-run identity for participant modality availability (Moodable primary508–517,603–611,685–689). Not a day/hour/night, model campaign, clock or original repeated-participation claim; mutually exclusive with period tokens.
--     * Slot: method_setting_reference Description: Local quality-control definition required only for collection-run modality availability; absent on period aggregates/responses.
--     * Slot: day_record_origin Description: Constructed example versus supplied normalized participant-period record; legacy key, not original-source authentication.
--     * Slot: day_observation_kind Description: Objective period aggregate, subjective response or run-owned modality availability; none substitutes for another. Legacy day-named transport key retains explicitly supplied owner kinds.
--     * Slot: observed_property Description: Supplied measured quantity or subjective-property label; not necessarily verbatim question wording or a raw field name.
--     * Slot: observation_category Description: Optional supplied category scope, independent of property/value; not a reconstructed app classifier. Null/omission remain distinct.
--     * Slot: app_package_name Description: Optional supplied package identity for per-app period observations (Screenomics2024 primary236–257; Energy Drain2015 §4). Independent of observation_category and supplied device; omitted/null identity never implies a category-wide total or a UID/package join, and overlapping categories are not collapsed.
--     * Slot: day_observation_value_json Description: Optional supplied lexical JSON value retained without recoding or numeric coercion; zero, JSON null, supplied null and omission stay distinct.
--     * Slot: evidence_unit Description: Supplied unit for this quantity alone; no numeric conversion or inferred unit.
--     * Slot: questionnaire_item_label Description: Optional supplied wording on a subjective response only; omission/null does not recover undisclosed wording.
-- # Class: CrossPeriodAggregateReference Description: Explicit support/comparison from a subjective participant-period observation to an objective aggregate in a different supplied period, within the same profile/work/participant. The target observation identity and exact period kind/token both resolve; the relationship label and provenance preserve why the records are compared, not a computed calendar adjacency or causal claim. Murnane2016 p7 compares prior-night reported sleep with following-day use; p8 same-night counts use the separate existing same-period reference.
--     * Slot: id
--     * Slot: day_observation_id Description: Supplied observation identity scoped by profile/participant/period kind/token, not a raw join key; legacy day-named transport supports explicit hour ownership.
--     * Slot: referenced_day_token Description: Explicitly supplied opaque identity of the day described, mutually exclusive with hour/night tokens; not substituted from prompt/submission time, parsed, calendar-normalized or timezone-converted.
--     * Slot: referenced_hour_token Description: Explicitly supplied opaque identity of a particular one-hour period, not an hour-of-day bucket, day or night. Mutually exclusive with day/night tokens; no endpoints, timezone or timestamp join inferred (CHI2020 Paper36 p5 CCM).
--     * Slot: referenced_night_token Description: Explicitly supplied opaque identity of the night described, not a calendar day, prompt time, source serializer or inferred sleep interval. Mutually exclusive with day/hour tokens; no endpoints or preceding/following day recovered (Murnane2016 pp3,7–8).
--     * Slot: relationship_label Description: Supplied nonblank relationship designation, not inferred causality, chronology or a source storage code.
--     * Slot: ParticipantDayObservationRecord_id Description: Autocreated FK slot
-- # Class: NotificationOpeningOccurrenceRecord Description: One supplied normalized opening occurrence shared by item-specific inferred views. In-Situ notifications (DOI 10.1145/2628363.2628364), p.4 Notification Viewed. Identity is scoped by profile/participant/supplied device, never inferred from equal app/time tokens. Optional membership retains supplied pending app items or shown drawer items; omission/null is unknown and an empty list is explicitly empty. Positive links require a known common device at ingress. No pending queue, matching, time conversion or inference runs. Normalized IDs and relationships do not claim recovered source keys or original rows. Opening is not observed reading, dismissal or response.
--     * Slot: id
--     * Slot: opening_occurrence_id Description: Normalized shared opening identity scoped by profile/participant/device; distinct occurrences remain distinct even at equal supplied app/time.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: opening_record_origin Description: Constructed example versus supplied normalized opening, not original-source authentication.
--     * Slot: opening_kind Description: Application-opening versus drawer-opening proxy, not an OS process launch or actual reading.
--     * Slot: occurrence_instant Description: Supplied textual opening time; omission/null is unknown. No verified epoch, precision, timezone, or equality with inferred view time.
--     * Slot: app_package_name Description: Optional supplied app identity for an application opening; null/omission stays unknown. Drawer membership does not require app equality.
-- # Class: NotificationEvidenceRecord Description: One owner-local event, classification or inferred quantity with independent provenance and optional local supporting evidence. Arrival, removal, unlock-derived assumed-seen, already-unlocked zero seen latency and clicked status are not interchangeable (My Phone and Me pp.3-4). Removal alone is not swipe, rejected content or accepted outcome; clicked may include app launch. Missing time/basis/value means not supplied, not a negative event. An instant is a supplied representation, not a verified epoch/precision. Context evidence requires a property label and independent collection boundary at normalized ingress. My Phone and Me p.4 Table1 records arrival/removal context; Content-driven notifications p.3 Table1 has unknown sampling alignment and separately described last-minute features. Null/omitted value and optional lookback/unit/time remain unknown; no context reducer, alert/ringer equivalence or sensor/location join runs. Optional shared-opening reference supports an inferred seen/latency only with positively supplied owner-local pending membership; it does not replace item-local supporting references or compute the view. Response stages carry independent observability and open stage identifiers: Reachable pp.3-4 allows variable/merged decisions, not a fixed D1-D3 enum. Unobservable is neither a negative response nor a prohibition on supplied inferred annotations. Endpoint and named objective labels are independent; string-valued null endpoint is not an unknown JSON null or omitted value. Import does not infer stages, labels, chronological order or truth tables. Item-owned action occurrences retain open source-qualified labels and an optional supplied ordinal, distinct from array position, event time and supporting references. Interrupted by a Phone Call pp.3,7–8 distinguishes repeated postpones, widget moves and accepted/declined/unanswered endings. Non-null ordinals are unique among actions in one history at ingress; neither zero-based indexing, contiguity nor complete capture is asserted. No action sorting, time conversion, raw-key recovery or outcome recode runs. The callback-group carrier reuses only the recorded posted_callback variant and its lexical time/value/basis/supports; it does not assign item ownership or action, context, response, opening or attention semantics to a callback. Named quantities retain independent lexical values, units and local supporting events. In Call to Action pp.7–8, IDL is an appearance-to-removal difference, not seen latency or observed attention; neither endpoint arithmetic nor positive/one-day analysis filtering runs during import.
--     * Slot: id
--     * Slot: evidence_record_id Description: Normalized evidence identity local to its owning item history or supplied callback group; duplicated world-occurrence evidence across histories does not assert distinct unlocks. Equal callback times/payloads do not imply equal identities.
--     * Slot: evidence_kind Description: Supplied evidence quantity or classification kind.
--     * Slot: evidence_role Description: Recorded record/classification versus explicitly inferred assertion; not an observed-action guarantee.
--     * Slot: evidence_instant Description: Supplied textual time token for this evidence alone; no endpoint equality or conversion is inferred.
--     * Slot: evidence_value_json Description: Lexical JSON token for a supplied evidence value; literal false/zero/null/string-false tokens and a supplied-unknown null field remain distinct without casts.
--     * Slot: evidence_unit Description: Supplied unit for this quantity alone; no numeric conversion or inferred unit.
--     * Slot: evidence_basis Description: Supplied inference or recording basis; omission/null leaves the basis unknown rather than reconstructed.
--     * Slot: opening_occurrence_reference Description: Optional shared opening ID supporting inferred seen/latency in the owning history. A positive reference requires that history in supplied opening membership and a known common device; null/omission does not assert a relationship.
--     * Slot: observed_property Description: Supplied context property, item-owned quantity name or independent response-objective name; required for those evidence kinds at ingress, not a computed value or recovered raw key.
--     * Slot: context_sampling_boundary Description: Collection boundary for context evidence or explicit source-unreported status; required by normalized context ingress, never inferred from lookback, timestamp or reference. My Phone and Me p.4 Table1 versus Content-driven notifications p.3 Table1.
--     * Slot: lookback Description: Supplied retrospective context-feature scope independent of collection boundary; last one minute in Content-driven notifications p.3 Table1 does not disclose a reducer or timestamp anchor.
--     * Slot: response_stage_id Description: Supplied nonblank stage label required for normalized response_stage evidence. Variable/merged stages are permitted; not a recovered source field, ordinal or inferred chronology (Reachable pp.3-4).
--     * Slot: response_observability Description: Supplied observation availability required for normalized response_stage evidence, independent of response value, device-use context and recorded/inferred provenance (Reachable p.4 Section3.2.1).
--     * Slot: action_kind Description: Supplied nonblank action label required only for action_occurrence evidence. Repeated labels identify separate occurrences, not a recovered raw enum, response stage or call-ending classification (Interrupted by a Phone Call pp.3,7–8).
--     * Slot: occurrence_ordinal Description: Optional supplied nonnegative integer ordering token on action_occurrence evidence only; unique among actions in the owning history at ingress. Null/omission is unknown, not array position or time. No assumed ordinal base, contiguous sequence, complete capture or sorting.
--     * Slot: NotificationHistoryRecord_id Description: Autocreated FK slot
--     * Slot: NotificationCallbackGroupRecord_id Description: Autocreated FK slot
-- # Class: NotificationQuestionnaireResponseRecord Description: A supplied subjective answer associated with the owning item, not the prospective DiaryItem instrument, an action timestamp or a population-wide observation. My Phone and Me p.4 Table2/Data Collection and p.8. The item label and lexical JSON answer do not claim recovered raw questionnaire keys. A handling self-report need not agree with a recorded final status.
--     * Slot: id
--     * Slot: questionnaire_response_id Description: Normalized answer record identity local to the owning item history.
--     * Slot: questionnaire_item_label Description: Supplied questionnaire item label; not an invented raw schema key.
--     * Slot: response_value_json Description: Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.
--     * Slot: NotificationHistoryRecord_id Description: Autocreated FK slot
-- # Class: NotificationAcceptanceRecord Description: Independently supplied binary acceptance outcome, separate from clicked or dismissed evidence. My Phone and Me p.8 recodes a dismissal as accepted when its handling answer says no further action was required; the clicked branch need not have that answer. Import preserves supplied references and code without applying this formula, enrolling an item in the questionnaire analysis, or filling an absent response/outcome with zero.
--     * Slot: id
--     * Slot: acceptance_record_id Description: Normalized acceptance-outcome record identity local to the owning history.
--     * Slot: acceptance_code Description: Supplied normalized My Phone and Me p.8 binary acceptance code: 0 dismissed, 1 accepted; independently retained, not computed.
--     * Slot: NotificationHistoryRecord_id Description: Autocreated FK slot
-- # Class: UsageInterval Description: A phenomenon-time interval a usage assertion denotes. A time:ProperInterval.
--     * Slot: id
--     * Slot: start_instant Description: Interval start instant.
--     * Slot: end_instant Description: Interval end instant.
--     * Slot: duration_seconds Description: Interval duration in seconds.
--     * Slot: start_status Description: Endpoint status of the start.
--     * Slot: end_status Description: Endpoint status of the end.
-- # Class: DeviceUseSessionRecord Description: Supplied normalized device-use session with independently identified questionnaire answers and definition-specific labels. Rabbit Hole (2023) physical p7 Section3.1.1 starts at ON_USERPRESENT and ends at OFF_LOCKED, OFF_UNLOCKED or SHUTDOWN; this is not necessarily unlock-to-lock, one app episode or a screen/keyguard observation. Physical pp8-11 associate ESM answers and original classifications with sessions; pp21-22 separately revise the definition. Source definition references and membership are supplied, not recovered raw joins. No constructor, scheduling, eligibility, scoring, relabeling or inference of missing responses runs during import. Oulasvirta et al. DOI10.1007/s00779-011-0412-2 printed p106 instead preserves separate opener, closer and action-membership definitions in the existing SessionConstructionPolicy. Its supplied record references the opener in one unambiguous profile-local policy; activation and next idle/lock phrases remain intact, not translated into Rabbit state codes. Approximate sampled inputs (p108) do not establish exact idle predicates, sample-to-boundary timestamp assignment or repaired action membership. Supplied session actions retain all-user-action membership and app-launch order independently of equal times (pp106–107). Hush Section3.2/6.1 also distinguishes alternating screen-on/off intervals with app activity and foreground membership in an explicitly supplied immediately following interval. Neither the successor nor app membership is inferred from times; missing membership cannot be classified as no activity. BFC is not computed. Jones DOI10.1145/2750858.2807542 physicalp6 preserves its scalar unlock/lock constructor and session-local repeated application launches with supplied F/B roles. Session-owned supplied quantities and labels remain distinct from actions and intervals; import computes neither ratios nor strategies. APNOMS2011 SectionIII-C independently supplies voice/3G/Wi-Fi sessions, AC/USB charging intervals and battery-change intervals. These are distinct source-defined intervals, not unlock-to-lock use; no raw boundary codes, charging/change equivalence or snapshot membership is inferred. Mathur2016 separately owns the four-member SessionLogger policy (screen-on, screen-off bounds, unlock inclusion gate, inclusive five-second merge and its provenance) versus QuantApp supplied sessions at screen-on/context start with unknown end. Hiniker2016 owns ordered app windows with lock/dark or state-conditioned system/launcher inactivity delimiters; it does not impose universal inactivity. Tapping2024 separately retains phone unlock-to-lock ownership, ordered foreground-change app periods and timestamped taps. Regret2025 instead uses screen-on/off parents and app-local intention, daily regret and screenshot context. Anatomy2016 keeps local key-entry attempts and separate code versus dismissal outcomes; supplied parent/action links are not a constructor, timestamp repair or raw join. AngryBirds2011 owns higher-order application chains separated by standby longer than thirty seconds, distinct from independent sampled app-or-epsilon states and individual foreground episodes. No sample/event construction runs.
--     * Slot: id
--     * Slot: device_use_session_id Description: Supplied session identity scoped by profile/participant/device; not inferred from equal times or recovered raw keys.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Compatible combined constructor, flat alternating-screen definition or opener of one complete separate-definition policy; references do not execute session construction.
--     * Slot: start_condition Description: Optional supplied start-condition token validated against the local constructor definition; not an inferred event occurrence.
--     * Slot: end_condition Description: Optional supplied terminal-condition token validated against the local constructor definition; not an inferred event occurrence or reconstructed closing time.
--     * Slot: following_device_use_session_reference Description: Explicitly supplied immediately following interval within the same disclosed family: alternating screen intervals (Hush Section6.1) or uninterrupted T0 sessions (Van Berkel Analysis). Scoped by profile/source/participant/known device; distinct and acyclic. Known on/off consistency applies only to alternating intervals. Never inferred from equal timestamps, gaps or continuation labels. Null/omission is unknown, not no successor.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: DeviceSessionQuestionnaireResponseRecord Description: Supplied answer identity local to the containing device-use session, referencing a compatible instrument in its profile. Rabbit Hole physical pp8-9 Figure3 distinguishes intention, completion, deviation, regret and perception questions without establishing complete numeric slider codes. Repeated equal answers remain separate. Optional wording and lexical value do not imply a prompt, completion, observed negative or raw key.
--     * Slot: id
--     * Slot: questionnaire_response_id Description: Supplied answer identity unique within its owning device-use session.
--     * Slot: questionnaire_setting_reference Description: Compatible local instrument definition, not a schedule, suppression rule or invented numeric recode.
--     * Slot: observed_property Description: Supplied measure designation, distinct from optional exact item wording.
--     * Slot: questionnaire_item_label Description: Supplied questionnaire item label; not an invented raw schema key.
--     * Slot: response_value_json Description: Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.
--     * Slot: DeviceUseSessionRecord_id Description: Autocreated FK slot
-- # Class: DeviceSessionLabelRecord Description: Independently supplied classification local to a device-use session or tracked-app interruption, referencing its applicable profile-owned label definition. Rabbit Hole physical p11 original intention-deviation and regret classifications are not the revised RH/negative-RH definitions at pp21-22 Figure14/Section6. Supplied lexical labels and local answer supports remain separate; missing is not negative. Import does not apply formulas, recover thresholds or fabricate an absent-answer truth table or original-to-revised mapping. Jones physicalp8/Table3 separately supplies whole-session strategy classes bound to the profile's analysis/derived-feature pattern definitions. Those labels are not action-local F/B roles; no regex execution is implied. APNOMS2011 also supplies network-modality and charging-power-source labels; those interval descriptors are not questionnaire-derived classifications.
--     * Slot: id
--     * Slot: label_record_id Description: Supplied label identity unique within its owning session, independent of equal property or value tokens.
--     * Slot: label_setting_reference Description: Compatible classification-defining local method setting, not a constructor, result statistic or execution receipt.
--     * Slot: observed_property Description: Supplied designation of the independent session classification or source-defined app-period classification; whole-session and app-period scopes are not interchangeable.
--     * Slot: label_value_json Description: Optional supplied lexical JSON classification value; no scoring, coercion or missing-to-negative conversion. Omission, supplied null and lexical JSON null remain distinct.
--     * Slot: DeviceUseSessionRecord_id Description: Autocreated FK slot
--     * Slot: AppInterruptionSessionRecord_id Description: Autocreated FK slot
--     * Slot: SessionInterruptionRecord_id Description: Autocreated FK slot
-- # Class: SessionQuantityRecord Description: Independently identified supplied quantity local to one device-use or tracked-app session, linked to its source feature or record-field definition. Jones physicalpp6,8 distinguishes session-string length and B/length from physical duration and strategy. Rabbit Hole physicalp11 Section4.1 distinguishes per-app and per-category counts/time/interactions from session-wide features. Explicit scope survives unknown app/category identity; missing identity is not a session total. Qualifiers preserve absolute counts, time-relative frequencies, supplied state and normalization variants. Figure7 seconds/session/minute and Figure11 normalized-by-session-length do not establish a universal fraction, percentage, formula or missing-unit conversion. No aggregation, app join, timestamp inference, normalization or repair runs during import. APNOMS2011 Figure7 supplies separate start/end battery levels in percent for charging or battery-change intervals, not computed energy consumption. Meaningful (3191754) released Event.java103-117 separately preserves four millisecond duration fields, including lexical NA; sample duration is not silently added to duration_total. WhyStop net length excludes suspending interruption time but supplies no overlap/union algorithm. Values remain independent rather than being derived from containing intervals. Chang printedpp9,12 additionally preserves each ringer-occupancy-local attending-action gap with independently supplied ordered endpoints, its ordinal attendance category and its separate supplied mean. No arithmetic, within-boundary selection, chronology or completeness is asserted.
--     * Slot: id
--     * Slot: quantity_record_id Description: Supplied quantity identity unique within its owning session; repeated equal properties/values remain independent.
--     * Slot: quantity_setting_reference Description: Profile-local feature or record-field definition with compatible role, target, property, unit and scope; not a request to compute the value.
--     * Slot: quantity_scope Description: Explicit session/app/app-category subject scope, independent of whether the app/category identity is known.
--     * Slot: app_identifier Description: Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.
--     * Slot: observation_category Description: Optional supplied category scope, independent of property/value; not a reconstructed app classifier. Null/omission remain distinct.
--     * Slot: start_action_reference Description: Optional supplied start action ID for a Chang attending-action gap, resolving only inside its containing ringer occupancy. Null/omission is unknown; array order and timestamps never infer the reference.
--     * Slot: end_action_reference Description: Optional supplied end action ID for the same gap, resolving locally and distinct from a known start. Not an aggregation support or mean endpoint; no duration calculation or cross-boundary matching.
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: evidence_value_json Description: Lexical JSON token for a supplied evidence value; literal false/zero/null/string-false tokens and a supplied-unknown null field remain distinct without casts.
--     * Slot: evidence_unit Description: Supplied unit for this quantity alone; no numeric conversion or inferred unit.
--     * Slot: quantity_qualifier Description: Supplied source-defined quantity variant: a core-residency frequency designation (Hush Section3.1), a session feature's absolute/frequency/normalization/state designation (Rabbit Hole Section4.1), or an explicitly named activity/component/connectivity/radio stratum for an Energy Drain2015 summary. No frequency, unit, weighting, group boundary or formula is inferred. Omission/null is unknown and does not merge members.
--     * Slot: DeviceUseSessionRecord_id Description: Autocreated FK slot
--     * Slot: AppInterruptionSessionRecord_id Description: Autocreated FK slot
--     * Slot: RingerStateIntervalRecord_id Description: Autocreated FK slot
-- # Class: ScreenshotSessionRecord Description: Supplied normalized screenshot container with local image identities and annotations. PULSE phone-use sessions are not app episodes or an unlock-to-lock interval. Regret2025 pp5–8 instead supplies foreground-app screenshot ownership, its definition and optional explicit screen-parent/ app-period action links. App and parent identities are not inferred from images, times or equal values. PULSE (2025), printed p.202 Section2.2 and p.203 Figure1b/c, groups screenshots into continuous phone-use sessions and applies labels to selected first/last screenshot ranges. Capture or upload membership may be incomplete (p.203 Section2.3.1); no session construction, timestamp conversion or label propagation runs during import. IDs are normalized, not recovered raw keys.
--     * Slot: id
--     * Slot: screenshot_session_id Description: Supplied screenshot-container identity scoped by profile/participant/device, source-defined phone-use or foreground-app ownership; not inferred from app or unlock timing.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: session_record_origin Description: Constructed example versus supplied normalized session; neither authenticates source rows.
--     * Slot: method_setting_reference Description: Source-compatible local foreground-app screenshot-container definition for Regret2025, not a PULSE constructor or inferred screenshot grouping.
--     * Slot: app_identifier Description: Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.
--     * Slot: device_use_session_reference Description: Optional explicitly supplied parent device-session ID. Exact source-compatible children resolve one unique same-profile/work/participant parent with compatible known device; unknown device never selects among multiple parents. Null/omission remains unknown. No clock or raw join is inferred.
--     * Slot: session_action_reference Description: Optional explicitly supplied action/foreground-period or unlock-attempt ID local to the explicitly referenced parent device session. A nonnull action requires its parent; known app/role contradictions reject without inferring unknown membership or timing.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: SessionScreenshotRecord Description: One supplied screenshot identity local to its owning source-defined screenshot container (PULSE phone use or Regret foreground-app use). Optional supplied sequence position, capture-time token and existing ArtifactRef identity remain independent; equal times or shared payloads do not collapse captures. PULSE printed pp.202-203 Section2.2 describes chronological display and visual stacking, not underlying row deletion. Missing payload metadata does not require fabricated size/digest/hierarchy. No image bytes, raw serialization or complete capture stream is verified.
--     * Slot: id
--     * Slot: screenshot_record_id Description: Supplied screenshot identity local to its owning session, independent of capture time or image equality.
--     * Slot: screenshot_sequence_position Description: Optional supplied nonnegative sequence position, unique within session; sparse positions do not reveal index base or equal-time sorting.
--     * Slot: screenshot_instant Description: Optional supplied screenshot capture-time token; no encoding, timezone or duration is inferred.
--     * Slot: screenshot_artifact_id Description: Identity of this event's screenshot in the supplied existing ArtifactRef catalog.
--     * Slot: ScreenshotSessionRecord_id Description: Autocreated FK slot
-- # Class: ScreenshotRangeAnnotationRecord Description: Supplied annotation of a first/last screenshot range within the owning phone-use session, not whole-session intent or a populated app-feature selection. PULSE printed p.202 Section2.2 and p.203 Figure1b/c allows labels in any order and study-specific dimensions. Positive endpoint references resolve only within that session; null/omission retains unknown endpoints. The open lexical label object preserves partial/unknown dimensions rather than enforcing the later analysis completeness filter (p.204 Section3.3). Endpoint inclusion, overlap/relabel handling and stack expansion remain unknown. No range membership, duration or missing labels are inferred. Regret2025 pp6–8 additionally uses source-bound single-image descriptions, classifier category/justification, independent human categories and consensus. Optional supplied assessor identity is not the participant. Description context has at most one known prior image; classification and human context at most four within the same app-owned container. Partial supports do not fill missing images or execute models/consensus.
--     * Slot: id
--     * Slot: range_annotation_id Description: Supplied annotation identity local to the owning screenshot session, not inferred from equal endpoints or labels.
--     * Slot: method_setting_reference Description: Optional source-qualified local screenshot-analysis definition; distinct descriptions, model judgments, human judgments and consensus are not collapsed.
--     * Slot: assessor_id Description: Optional opaque supplied human/model/consensus assessor, distinct from the assessed participant and independent of other judgments; no rater identity or agreement is inferred.
--     * Slot: first_screenshot_reference Description: Optional supplied first endpoint resolving within the owning session; unknown is not the session's first screenshot.
--     * Slot: last_screenshot_reference Description: Optional supplied last endpoint resolving within the owning session; unknown is not the session's last screenshot.
--     * Slot: range_label_values_json Description: Supplied lexical JSON object of open dimension labels to values, or JSON null. Partial, empty, omitted and supplied-null objects stay distinct; no codebook, completeness or relabel rule is imposed.
--     * Slot: ScreenshotSessionRecord_id Description: Autocreated FK slot
-- # Class: AppInterruptionSessionRecord Description: Supplied tracked-app session containing separately identified interruption intervals, not continuous app use or unlock-to-lock device use. Why Did you Stop (2021), author-copy physical p.3 Section3.2 and p.7 Section4.4.2, records each interruption individually within a learning session. Figure1 p.4 illustrates independent session/interruption times and app labels. Meaningful (3191754) primary279-284 uses one before/during/after sampling timing per app instance, not three waves within every instance. Supplied session answers, optional interruption references and independent quantities retain their own definitions. Package identity is independent of an optional printed app label. IDs and pairing are normalized, not recovered raw serialization. Unknown membership is not observed zero. No timer, constructor, return-to-learning, interruption cause, scoring, last-interruption selection, ESQ eligibility or duration is inferred.
--     * Slot: id
--     * Slot: app_interruption_session_id Description: Supplied tracked-app session identity scoped by profile/participant/device, not reconstructed from app/time equality.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: app_name Description: Supplied application label qualifying feature names, distinct from an optional package name; no package inference or taxonomy restriction.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: session_record_origin Description: Constructed example versus supplied normalized session; neither authenticates source rows.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: AppSessionQuestionnaireResponseRecord Description: Supplied answer identity local to one tracked-app session, using the existing subjective-answer slots and compatible local source definition. Optional response-role labels retain before/during/after or another supplied designation without reconstructing sampling chronology. Meaningful released Sample.java527-554 cancels only the current prompt: earlier answers survive, current NO_RESPONSE differs from later NA. WhyStop ESQ answers may be partial; no answer is mandatory. An optional supplied interruption reference resolves only within the containing session and does not infer the last interruption, cause or outcome.
--     * Slot: id
--     * Slot: response_role_label Description: Optional supplied answer-role designation such as before/during/after; not a computed sampling phase or a claim that all phases occur in one app instance.
--     * Slot: interruption_record_reference Description: Optional supplied interruption ID resolving only within the containing tracked-app session; null/omission is unknown relationship, not a last-interruption or cause inference.
--     * Slot: questionnaire_response_id Description: Supplied answer identity unique within its owning tracked-app session.
--     * Slot: questionnaire_setting_reference Description: Reference to a compatible disclosed response-scale definition within the owning profile/source, not an invitation or reported result; unknown instrument details remain on that source definition.
--     * Slot: observed_property Description: Supplied subjective measure designation, not necessarily exact question wording.
--     * Slot: questionnaire_item_label Description: Supplied questionnaire item label; not an invented raw schema key.
--     * Slot: response_value_json Description: Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.
--     * Slot: assessment_case_token Description: Optional supplied case identity scoped to profile/source, independent of rater, text label, description or response. Meaningful primary339–354 has authored app-use cases followed by independent ratings of shared cases. DynamicSecurity layout874–896 supplies shared question/options identities across legitimate/adversarial responders, without requiring literal role-varying wording equality. This token preserves a supplied relationship across completions without recovering original IDs or declaring a case catalog. Null/omission is unknown identity; equal labels do not imply equal cases.
--     * Slot: AppInterruptionSessionRecord_id Description: Autocreated FK slot
-- # Class: SessionInterruptionRecord Description: One supplied interruption identity local to its containing app session, independent of label or equal time tokens. Why Did you Stop physical p.4 Figure1 prints APP_SWITCH and a visited-app label list containing repeated Google. These labels are not package IDs, classified causes, complete app histories or independently timed visits. Preserve supplied order and optional/null/empty descriptors; no sorting, deduplication, containment arithmetic, resumption or terminating/suspending outcome is inferred.
--     * Slot: id
--     * Slot: interruption_record_id Description: Supplied interruption identity unique within its containing session, independent of label or equal bounds.
--     * Slot: interruption_type Description: Optional open supplied event-type descriptor, such as the illustrated APP_SWITCH; not automatically an internal/device/external cause or suspending/terminating outcome.
--     * Slot: AppInterruptionSessionRecord_id Description: Autocreated FK slot
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: SessionAssociationDatabaseRecord Description: Supplied session-transaction database and its mined rules scoped to a profile, participant and analysis run. Habitual Smartphone Use (3447991), physical pp10-12 sections3.2.2-3.2.3, mines each participant's cluster separately; pp20-21 section5 pools Android Socialize sessions without clustering. Group labels are not globally unique or recovered raw keys. Supplied memberships/results do not execute mining or establish exact collector, clock, platform, context join or original-row provenance.
--     * Slot: id
--     * Slot: association_database_id Description: Supplied database identity scoped by profile/participant/device/analysis run, independent of its potentially repeated group label.
--     * Slot: analysis_run_id Description: Supplied analysis-run identity, not an invented date, reconstructed rolling window or proof that an algorithm ran.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: association_group_label Description: Optional printed or supplied cluster/group label. Null/omission does not assign a cluster or pooled group.
--     * Slot: grouping_setting_reference Description: Optional compatible local source-definition reference, distinguishing per-user clustering from pooled sessions without executing either.
--     * Slot: transaction_definition_setting_reference Description: Optional compatible local binary session-transaction definition, not a reference to duration-weighted features.
-- # Class: SessionTransactionRecord Description: A supplied transaction for a separately identified phone-use session in its containing database. Habitual physical p12 section3.2.3 and p14 Figure5 distinguish binary app/context presence, explicit absence and undisclosed columns. This is not the preceding duration-weighted TF-IDF Bag-of-Apps representation. Unknown bounds/membership stay unknown; no missing item becomes zero. The illustrated Session i is not linked to U34 or Table5's clusters by the source.
--     * Slot: id
--     * Slot: session_transaction_id Description: Supplied transaction identity unique within its database, not inferred from equal times or app sets.
--     * Slot: source_session_id Description: Supplied normalized identity of the session represented by this transaction, unique within the database; not authentication of an original raw key or recovered session constructor.
--     * Slot: SessionAssociationDatabaseRecord_id Description: Autocreated FK slot
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: AssociationRuleRecord Description: Supplied rule within its containing mining database, with independently supplied antecedent/consequent app and contextual itemsets. Habitual physical p17 Table5 R6 is WhatsApp=>Instagram for U34's cluster3; reversing the sides changes the rule without changing combined app membership. Printed quality values and category/type annotations remain lexical JSON, not calculated values, temporal order, causes or execution receipts.
--     * Slot: id
--     * Slot: association_rule_id Description: Supplied database-local rule identity, potentially a printed label rather than an original key.
--     * Slot: rule_quality_values_json Description: Supplied lexical JSON quality values with their source labels/units/qualifications. Not computed from supplied sessions or silently treated as a normalized proportion.
--     * Slot: rule_annotation_json Description: Supplied lexical JSON rule annotations such as printed category/type, separate from quality values, inferred action or classification execution.
--     * Slot: SessionAssociationDatabaseRecord_id Description: Autocreated FK slot
-- # Class: AssociationContextItemRecord Description: Context item value with an optional supplied dimension. Habitual physical p14 Figure5 distinguishes notification, period, time, location and activity from app labels. Missing dimension is not inferred from a label; equal labels in different dimensions remain distinct. Array order is preserved as supplied, never interpreted as chronology.
--     * Slot: id
--     * Slot: context_item_label Description: Supplied context value label, preserved without coercion, case folding or inferred sensor encoding.
--     * Slot: context_dimension Description: Optional supplied context dimension, such as time, location or activity; no dimension or mutually-exclusive value policy is inferred.
--     * Slot: SessionTransactionRecord_id Description: Autocreated FK slot
--     * Slot: AssociationRuleRecord_id Description: Autocreated FK slot
-- # Class: TaskOccurrenceRecord Description: Supplied normalized occurrence of a task, potentially spanning several apps and screen/notification/unlock actions, not one app session or paired visual trace. S-ADL (2024), physical pp8 Figure2 and25 Table11, supplies expected scripts and subtask roles; p21 AppendixA.1 and p23 Table6 supply independent content-based criteria. Existing source-setting definitions are referenced, not copied. IDs, role assignments, assessments and links are supplied normalization, not recovered source rows or an executed script matcher. Supplied answers may concern the owning task/session, as in ACII2019 text-entry-session emotion reports. A separately identified questionnaire completion can represent condition-level administration (Alt2012 SUS; Böhmer2014 post-condition TLX). It does not create a browser, call or navigation-trial join or imply task-correctness assessment. Anatomy2016 additionally admits explicitly supplied authentication-task links to one parent screen session and one local attempt action. Code success, retry, screen-off abort and keyguard dismissal remain independent supplied evidence; no finite-state execution or timestamp scheduling repair runs. DynamicSecurity layout874–896 separates the answering participant from an optional supplied history subject. Shared question cases span responders; equal wording does not establish identity and role-varying wording does not contradict an explicitly supplied shared case.
--     * Slot: id
--     * Slot: task_occurrence_id Description: Supplied task identity scoped by profile/participant/device, not reconstructed from equal app/time tokens.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: assessor_id Description: Optional supplied assessor identity, distinct from the assessed participant_id. JCP2017 pp867–868 has one live interviewer and two video-review psychiatrists, each independently producing standard and app-incorporated judgments. The assessor belongs to the owning task and its assessments; null/omission leaves identity unknown. No clinician catalog, interview/video join or consensus is inferred.
--     * Slot: history_subject_participant_id Description: Optional supplied person whose autobiographical history generated a DynamicSecurity challenge, distinct from the owning Task participant_id answering it. Primary layout874–896 presents the same question/options to the legitimate person, paired strong adversary and hidden-stranger naive adversary. Null/omission leaves history identity unknown; no participant assignment, original challenge key or history join is recovered.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: task_label Description: Supplied task designation, including which script is meant when a source-setting definition contains multiple scripts.
--     * Slot: referenced_day_token Description: Optional supplied response/aggregation day, distinct from the response instant (Digital Nightlife released timeframe R:22 and combination R:89–94). Does not assert calendar containment of every owned window, derive a date from an action time, or merge independently identified tasks.
--     * Slot: device_use_session_reference Description: Optional explicitly supplied parent device-session ID. Exact source-compatible children resolve one unique same-profile/work/participant parent with compatible known device; unknown device never selects among multiple parents. Null/omission remains unknown. No clock or raw join is inferred.
--     * Slot: session_action_reference Description: Optional explicitly supplied action/foreground-period or unlock-attempt ID local to the explicitly referenced parent device session. A nonnull action requires its parent; known app/role contradictions reject without inferring unknown membership or timing.
--     * Slot: interaction_trace_reference Description: Optional supplied link to the trace assessed by this task/questionnaire completion (ODIM pp12–13 §§5.2–5.3). Resolves within the same profile/source and must match participant identity when known on the trace. Multiple independent questionnaire tasks may assess one trace; null/omission leaves the target unknown. No join, temporal order or participant identity is inferred.
--     * Slot: expected_script_setting_reference Description: Optional reference to a compatible task-sequence setting within the owning profile/source; null/omission does not assert an expected script. No script matcher runs.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: TaskActionRecord Description: Individually supplied member of its containing task or device-use session with optional action label, app identity, time, role labels and lexical content. S-ADL physical p25 Table11 distinguishes observed app/screen actions from extracted subtask roles. Missing/extra/tied-event handling and the automatic constructor are not inferred. Same labels or times do not merge members or create order. Supplied array order remains intact. Oulasvirta pp106–107 distinguishes all-user-action session membership from app-launch order; app identity is independently supplied, never extracted from labels. Hush Section6.1 distinguishes active-in-off from foreground-in-following-on membership.
--     * Slot: id
--     * Slot: task_action_id Description: Supplied action identity unique within the containing task or session; labels or equal times are not identity.
--     * Slot: app_identifier Description: Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.
--     * Slot: action_label Description: Optional open supplied action descriptor, not a required recovered event code.
--     * Slot: action_content_json Description: Optional lexical JSON content evidence attached to a task/session action. Null, JSON null and omission stay distinct; no comparison or scoring runs.
--     * Slot: DeviceUseSessionRecord_id Description: Autocreated FK slot
--     * Slot: AppInterruptionSessionRecord_id Description: Autocreated FK slot
--     * Slot: TaskOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: RingerStateIntervalRecord_id Description: Autocreated FK slot
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: TaskCriterionAssessmentRecord Description: Independently supplied assessment of a designated criterion for the owning task. S-ADL physical p23 Table6 has separate registration-number and spoken information criteria. Supplied content evidence, result and supporting task actions remain distinct. A definition reference does not recover the actual stimulus or demonstrate automated correctness. No scoring runs at import. Password Entry Usability (2012) pp4–6 also supplies performance criteria: first-to-last-character entry time in milliseconds, guess-to-target Levenshtein distance and participant/password-local best-attempt selection. A supplied value and supporting action identities do not execute those calculations or make the later Send action an entry-time endpoint. Murnane2016 p4 supplies participant-baseline-relative PVT performance; its record does not recover trial granularity or a percentage convention. Source-defined questionnaire summaries, including affect means and PHQ-9 scores/classifications, are assessments rather than individual answers. Supplied summaries remain independent of item values; no scoring, classification or missing-item policy is inferred during import.
--     * Slot: id
--     * Slot: criterion_assessment_id Description: Supplied assessment identity unique within the task, independent of repeated criterion labels.
--     * Slot: criterion_setting_reference Description: Reference to a compatible task-correctness, task-performance or questionnaire-summary definition within the owning profile/source; criterion designation remains separate from this potentially composite definition. Referencing a metric does not execute it.
--     * Slot: criterion_label Description: Supplied designation of the criterion/subtask being assessed, not an inferred selection or result.
--     * Slot: assessment_value_json Description: Optional supplied lexical JSON assessment result. Does not compute correctness; zero, JSON null, supplied null and omission remain distinct.
--     * Slot: assessment_content_json Description: Optional supplied lexical JSON content supporting the assessment, distinct from its result or action/time evidence; omitted content may be withheld or unreported.
--     * Slot: TaskOccurrenceRecord_id Description: Autocreated FK slot
-- # Class: TaskQuestionnaireResponseRecord Description: Supplied subjective response concerning its owning task/session or a separately identified questionnaire completion, independently referencing the owning profile's disclosed categorical answers, response scale or instrument definition. Oh App (2013) physical p2 Procedure and p3 Self-Assessment distinguish completing the post-study instrument from logged navigation and from issuing its invitation. This is not task correctness, a navigation-trial link or a reconstructed questionnaire row. Property designation is not exact question wording; endpoints do not supply the complete offered labels, numeric codes or missing-response policy. ACII2019 explicit No Response is a supplied skip, not absent membership or a fifth modeled emotion. Alt2012 physical p3 specifies SUS per condition without administered items/endpoints; Böhmer2014 p5 specifies post-condition dimensions and a 20-point scale without anchors. These omissions do not justify invented instrument details. Import preserves lexical answers without scoring or recoding.
--     * Slot: id
--     * Slot: questionnaire_response_id Description: Supplied answer identity unique within the owning task; repeated labels or values do not merge answers.
--     * Slot: questionnaire_setting_reference Description: Reference to a compatible disclosed response-scale definition within the owning profile/source, not an invitation or reported result; unknown instrument details remain on that source definition.
--     * Slot: observed_property Description: Supplied subjective measure designation, not necessarily exact question wording.
--     * Slot: questionnaire_item_label Description: Supplied questionnaire item label; not an invented raw schema key.
--     * Slot: response_value_json Description: Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.
--     * Slot: assessment_case_token Description: Optional supplied case identity scoped to profile/source, independent of rater, text label, description or response. Meaningful primary339–354 has authored app-use cases followed by independent ratings of shared cases. DynamicSecurity layout874–896 supplies shared question/options identities across legitimate/adversarial responders, without requiring literal role-varying wording equality. This token preserves a supplied relationship across completions without recovering original IDs or declaring a case catalog. Null/omission is unknown identity; equal labels do not imply equal cases.
--     * Slot: TaskOccurrenceRecord_id Description: Autocreated FK slot
-- # Class: TaskObservationWindowRecord Description: Supplied observation/summary window anchored to an explicitly identified action in its containing task or questionnaire completion. Personality states (2020) printed697 ends its preceding30-minute window at the first photographic-affect-meter response, not later personality submission. Sarsenbayeva (2020) p5 compares ESM valence against1/5/60-minute Affectiva windows; only the1-minute case explicitly says preceding. Local source definitions preserve that distinction; unspecified sidedness and endpoints are never inferred. Supplied answer links designate comparisons, not the anchor event or equality of their timestamps. Quantities are supplied, not computed; valence does not inherit raw emotion-confidence scale bounds. Local references preserve normalization but do not authenticate firstness, reconstruct time, match raw rows or establish observation completeness. Murnane2016 p7 preserves a one-hour window surrounding a PVT assessment and independent mean-session-seconds, distinct-app and switch summaries; surrounding does not specify centered offsets or a phone-session closer.
--     * Slot: id
--     * Slot: observation_window_id Description: Supplied window identity unique within its containing task, not inferred from duration or equal endpoints.
--     * Slot: anchor_task_action_reference Description: Supplied local action anchor. STDD's preceding-EMA alignment does not disclose receipt/open/submission semantics and alone permits an omitted/null anchor. Established action-anchored policies retain their required local action in source validation; no action is fabricated to satisfy the structure.
--     * Slot: TaskOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: AppFeatureSessionRecord Description: Supplied normalized app session containing individually identified timed feature-use instances and optional instance-selection responses. Finesse (2021), published-layout p.8 Section3.3 and p.3 Figure1, stores session start/duration and each instance's feature name/start/end. Same-label instances are not one occurrence. IDs are supplied normalized identities, not recovered raw keys; no classification, session construction, sampling, timing conversion or regret computation runs during import.
--     * Slot: id
--     * Slot: feature_session_id Description: Supplied app-session identity scoped by profile/participant/device; not an inferred app/time join key.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: session_record_origin Description: Constructed example versus supplied normalized session; neither authenticates source rows.
--     * Slot: app_name Description: Supplied application label qualifying feature names, distinct from an optional package name; no package inference or taxonomy restriction.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: AppFeatureOccurrenceRecord Description: One supplied feature-use instance local to its owning app session, not merely a feature label, app episode or Accessibility callback. Finesse p.8 Section3.3 preserves each instance's name/start/end. Supplied order, opaque time tokens and unknown endpoints survive without inferring an overlap, adjacency, containment, carry-forward or duration policy.
--     * Slot: id
--     * Slot: feature_occurrence_id Description: Supplied instance identity unique within its owning session even at identical feature labels/times.
--     * Slot: feature_name Description: Supplied feature label scoped by the owning application; not a global closed vocabulary or an occurrence identity.
--     * Slot: AppFeatureSessionRecord_id Description: Autocreated FK slot
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: SessionFeatureSelectionRecord Description: Supplied response state and optional membership of selected feature-use occurrences in the owning app session. Finesse p.8 Section3.3 asks users to select individual instances; p.3 Figure1 illustrates SUBMIT and SKIP. Submitted empty membership differs from an unanswered or expired prompt. Status labels are supplied normalized descriptions, not recovered stored codes; SKIP's deployed storage mapping remains unknown. Unknown wording, answers and membership are never manufactured from a status.
--     * Slot: id
--     * Slot: questionnaire_response_id Description: Supplied normalized response identity local to the owning app session, not a notification history.
--     * Slot: questionnaire_item_label Description: Supplied questionnaire item label; not an invented raw schema key.
--     * Slot: response_value_json Description: Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.
--     * Slot: selection_response_status Description: Supplied nonblank open response-state label, not a source-code enum, timer execution or inferred negative response.
--     * Slot: AppFeatureSessionRecord_id Description: Autocreated FK slot
-- # Class: ScreenTextCaptureRecord Description: Supplied normalized text snapshot, with its raw or derived meaning declared by the referenced local source definition. ScreenTextSensor (10.1145/3613904.3642347) physical pp3–4 Sections3.1–3.2 describes a saved flat string, application package and individually delimited text-node phrases with pixel rectangles from Android Accessibility. JMIR55999 (10.2196/55999) physical p4 describes EasyOCR-derived screenshot text and its confidence filter and normalization; these are not raw Accessibility observations. ScreenTK (10.1145/3675094.3677547) Figures2–3 separately describe capture time and Unix event time; source_event_time_token preserves the latter independently, without assuming units or conversion between them. This record is not screenshot pixels or a UsageStats event, and importing it does not execute OCR or normalization. Equal text/time tokens do not merge captures or phrases. Flat text and phrase membership are independently supplied; no delimiter parsing, concatenation, filtering, tree/visibility inference or time conversion runs at import. Null, empty and omitted membership remain distinct. Normalized IDs do not recover raw keys, serializer or the study build.
--     * Slot: id
--     * Slot: text_capture_id Description: Supplied normalized saved-text record identity local to profile/participant/device, not a timestamp or text hash.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.
--     * Slot: capture_instant Description: Supplied opaque text-capture time token; no clock units, ordering or timezone inferred.
--     * Slot: source_event_time_token Description: Supplied opaque source-designated event-time token, independent of capture_instant. ScreenTK Figure3 calls its timestamp Unix event time; numeric unit, precision and conversion to the Figure2 capture-time representation are unreported. No parsing, clock conversion, timezone assignment or equality between the two time fields is inferred.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: screen_text Description: Supplied flat screen-text string, preserved without splitting, joining, trimming or verifying original delimiter grammar.
-- # Class: TypingTrialRecord Description: Supplied normalized trial membership or explicitly selected derived-only cells. Akpinar et al. DOI 10.1145/3577013 physical pp12-13 Figure4/Section4.2 distinguishes raw actions from later trial construction by participant, timestamp order, app switch, text reset and transition-specific pauses. This class retains supplied ordered references, not an executed trial constructor, timestamp tie rule, computed correction verdict or recovered ESM join. IDs and membership are normalized, not recovered source keys. Rodrigues et al. DOI10.1145/3491102.3501908 p5§3.1.2 stores metrics without raw text, touchpoints or app identity. Its released CSV's repeated Index tuples must not be deduplicated or treated as trial identity. Derived-only rows reference their own lifecycle and column definitions, not CABAS boundaries. Optional action-trial-owned token evaluations and text-change cases, independent system verdicts, participant follow-up answers and separately supplied questionnaire answers preserve the pp18–20 follow-up and pp7–8/32–33 ESM relationships without executing a classifier or recovering raw case keys and joins.
--     * Slot: id
--     * Slot: typing_trial_id Description: Supplied normalized typing-trial identity local to profile/participant/device; not a recovered trial constructor or timestamp key.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: trial_representation Description: Explicit derived_metrics branch versus retained action_membership. Omission is legacy action membership; null is invalid at ingress.
--     * Slot: trial_partition_setting_reference Description: Local source-located participant-partition and timestamp-order rule for trial construction; not by itself the complete boundary method.
--     * Slot: trial_app_switch_setting_reference Description: Local source-located app-package switch trial boundary; no app-switch inference runs at import.
--     * Slot: trial_reset_setting_reference Description: Local source-located nonempty-current then empty-before trial boundary; not a submitted-versus-cleared decision.
--     * Slot: trial_pause_setting_reference Description: Local source-located three transition-specific pause thresholds; comparator equality remains unreported and no pause split runs at import.
--     * Slot: trial_lifecycle_setting_reference Description: Required only for derived_metrics: local reconstruction/text_entry_trial start/end or explicit trial-unit definition (such as each prompted answer). It does not supply clocks, action membership or execution.
--     * Slot: trial_schema_setting_reference Description: Required only for derived_metrics: local event_schema/analysis_record_set declaration of every supplied column label.
--     * Slot: released_values_json Description: Required only for derived_metrics: supplied lexical JSON object with exactly the locally declared column labels and string-valued cells. Preserve codes, blanks and numeric text without coercion, deduplication or time inference; columns are not all metrics.
-- # Class: TokenEvaluationCaseRecord Description: Supplied word-evaluation case local to an action-membership typing trial, distinct from removed/reentered text. Akpinar et al. DOI10.1145/3577013 pp18–19 Section4.4.1–4.4.2 presents selected words with overall text and independently retained system judgments and participant F/T feedback. F means participant-reported typo, not correction or system disagreement. Withheld text remains unknown. Equal words do not merge case identities; supplied ownership does not recover original word/action/trial joins.
--     * Slot: id
--     * Slot: token_evaluation_case_id Description: Supplied word-evaluation identity unique within its containing trial, independent of equal token text.
--     * Slot: token_text Description: Supplied selected word text, optionally withheld; not reconstructed from keyboard actions or removed/reentered segments.
--     * Slot: overall_text Description: Supplied case-context text, optionally withheld; not reconstructed from keyboard actions.
--     * Slot: TypingTrialRecord_id Description: Autocreated FK slot
-- # Class: TokenEvaluationVerdictRecord Description: Independently supplied word-correctness judgment referencing a profile-local token classification definition, not an edit/correction definition. Akpinar et al. pp18–19 Section4.4 keeps judgments separate from first-task F/T answers. Optional supporting answers resolve only within this token case. No classifier, version assignment, chronology or agreement recoding.
--     * Slot: id
--     * Slot: label_record_id Description: Supplied verdict identity unique within its containing token-evaluation case.
--     * Slot: label_setting_reference Description: Compatible classification-defining local method setting, not a constructor, result statistic or execution receipt.
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: label_value_json Description: Optional supplied lexical JSON classification value; no scoring, coercion or missing-to-negative conversion. Omission, supplied null and lexical JSON null remain distinct.
--     * Slot: TokenEvaluationCaseRecord_id Description: Autocreated FK slot
-- # Class: TextChangeCaseRecord Description: Supplied text-change case local to an action-membership typing trial. Akpinar et al. DOI10.1145/3577013 pp18–19 §4.4.1–4.4.2 provides overall, removed and reentered text for independent system-verdict and participant follow-up comparison. Withheld text remains null/omitted. Equal content does not merge case IDs. Optional action supports resolve within the trial, not an inferred segmentation, exhaustive membership or disjoint partition. Array order is preserved but does not establish case or revision chronology.
--     * Slot: id
--     * Slot: text_change_case_id Description: Supplied case identity unique within its typing trial, independent of equal text.
--     * Slot: overall_text Description: Supplied case-context text, optionally withheld; not reconstructed from keyboard actions.
--     * Slot: removed_text Description: Supplied removed text segment, not inferred by comparing action states; empty/null/omission preserved.
--     * Slot: reentered_text Description: Supplied reentered text segment, independently preserved without normalization or correction classification.
--     * Slot: TypingTrialRecord_id Description: Autocreated FK slot
-- # Class: TextChangeVerdictRecord Description: Independently supplied text-change verdict, referencing a profile-local classification definition. Akpinar et al. pp18–20 §4.4 distinguishes initial and revised verdicts; printed Algorithm2's version placement remains unresolved. No verdict is computed from supplied feedback or assigned to a version by array position. Supporting answer IDs, when supplied, resolve only within this case's follow-up answers, not ESM or another case.
--     * Slot: id
--     * Slot: label_record_id Description: Supplied verdict identity unique within the containing text-change case, not a device session.
--     * Slot: label_setting_reference Description: Compatible classification-defining local method setting, not a constructor, result statistic or execution receipt.
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: label_value_json Description: Optional supplied lexical JSON classification value; no scoring, coercion or missing-to-negative conversion. Omission, supplied null and lexical JSON null remain distinct.
--     * Slot: TextChangeCaseRecord_id Description: Autocreated FK slot
-- # Class: TypingQuestionnaireResponseRecord Description: Individually identified supplied answer owned either by a token or text-change case's follow-up or separately by its typing trial's questionnaire association. Akpinar et al. pp18–19 §4.4.1 uses F for participant-reported error correction and T otherwise in the change task; the distinct word task uses F for a participant-reported typo and T otherwise. Neither means system agreement. ESM context and subjective-error instruments on pp7–8/32–33 are separate. Each answer references its own local definition. Null/omission/lexical JSON null and repeated values remain distinct; no raw join, scoring or recoding.
--     * Slot: id
--     * Slot: questionnaire_response_id Description: Supplied answer identity unique within its containing case or trial; equal IDs in separate owners do not merge.
--     * Slot: questionnaire_setting_reference Description: Local compatible task-specific word/change follow-up or questionnaire instrument definition, not a prompt cadence or reported statistic.
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: questionnaire_item_label Description: Supplied questionnaire item label; not an invented raw schema key.
--     * Slot: response_value_json Description: Supplied lexical JSON answer, including structured/multiple selections or explicit null; not recoded or coerced.
--     * Slot: TypingTrialRecord_id Description: Autocreated FK slot
--     * Slot: TokenEvaluationCaseRecord_id Description: Autocreated FK slot
--     * Slot: TextChangeCaseRecord_id Description: Autocreated FK slot
-- # Class: KeyboardTransactionRecord Description: One supplied keyboard action independent of any reconstructed trial. Preserve both text states, the opaque timestamp, application package and supplied normalized boolean flags independently. Figure4 prints 0/1 flags but does not disclose its deployed raw serializer or timestamp unit. Trial membership may remain unknown; no source row key, correction verdict or sequence position is inferred from equal time/text values.
--     * Slot: id
--     * Slot: keyboard_transaction_id Description: Supplied action identity local to profile/participant/device, not inferred from equal time, text or package.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: keyboard_schema_setting_reference Description: Local source-located keyboard before/after transaction schema, distinct from an Accessibility text snapshot.
--     * Slot: keyboard_timestamp Description: Opaque supplied keyboard-event timestamp token; Figure4 prints 13-digit examples but formal source storage unit is unreported.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: before_text Description: Whole field text before this keyboard action, independently preserved from current_text; null, empty and omission remain distinct.
--     * Slot: current_text Description: Whole field text after this keyboard action; not a screen-text snapshot or inferred token/correction.
--     * Slot: is_deleted Description: Supplied normalized boolean deletion flag, not a recovered 0/1 source serialization or an edit classifier.
--     * Slot: is_password Description: Supplied normalized boolean password-field flag; password phrases are not reconstructed from masked source data.
-- # Class: ScreenTextPhraseRecord Description: One supplied normalized text-node member of its owning capture, with its own capture-local identity. ScreenTextSensor physical p4 Section3.2 and Figure2 distinguishes individual phrases and their top-left/bottom-right pixel coordinates. Equal phrase strings do not merge children. Bounds denote node rectangles, not glyph coordinates, visibility or a tree relation (physical p17 Section6.6). Optional partial values remain unknown; importer preserves supplied child order without asserting source chronology.
--     * Slot: id
--     * Slot: phrase_id Description: Supplied normalized child identity local to its owning capture, not text equality or a recovered raw node key.
--     * Slot: phrase_text Description: Supplied literal phrase text; empty, null and omission are distinct, with no normalization or inferred relationship.
--     * Slot: phrase_left_px Description: Supplied top-left node-rectangle x coordinate in pixels, not glyph position or visibility; partial values remain unknown.
--     * Slot: phrase_top_px Description: Supplied top-left node-rectangle y coordinate in pixels; offscreen/overlapping/zero-size rectangles are not filtered.
--     * Slot: phrase_right_px Description: Supplied bottom-right node-rectangle x coordinate in pixels, independent of the supplied top-left coordinate.
--     * Slot: phrase_bottom_px Description: Supplied bottom-right node-rectangle y coordinate in pixels; no screen extent or text location is inferred.
--     * Slot: ScreenTextCaptureRecord_id Description: Autocreated FK slot
-- # Class: SensorControlOccurrenceRecord Description: A separately identified supplied normalized logged sensor enable/disable instance, independent of text captures. ScreenTextSensor physical p17 Section6.6 describes AWARE-Light logging these instances. This is neither screen/keyguard state nor an active-collection interval; do not infer success, actor, disabled duration, missing capture or a neighboring join. The profile-owned definition reference identifies the logged-control acquisition claim, not an execution receipt or recovered raw event code.
--     * Slot: id
--     * Slot: sensor_control_id Description: Supplied logged-control record identity local to profile/participant/device; equal times do not merge instances.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.
--     * Slot: sensor_label Description: Supplied sensor identifier/label, not normalized into an Android package or an inferred deployed build.
--     * Slot: sensor_control_action Description: Supplied enable/disable occurrence label; not observed service status or a reconstructed disabled interval.
--     * Slot: occurrence_instant Description: When the occurrence happened.
-- # Class: SampledQuantityObservationRecord Description: TimeKilling CHI2023 additionally retains supplied capture-pair and feature identities distinct from source phone-use screenshot sessions and nonoverlapping seven-pair prediction sequences. Optional parent/child screenshot references retain supplied membership without clock equality, padding inference or tensor/model execution. Explicit padding, unknown membership and captured black images are distinct. Source-qualified quantities retain current/session/past-window scopes and named axes; independently supplied user/group and model summaries do not manufacture participants or calculate outputs. Supplied normalized observation with independently retained quantities and an explicitly typed subject. Falaki et al. IMC2010 Section2 Dataset2 records these every two minutes; Section4's later per-application interval analysis does not disclose cumulative-versus-delta storage or process/app joins. Tokens and IDs are supplied, not inferred packages, PIDs or clocks. Equal subjects, times and values do not merge observation identities. Missing quantities remain unknown; no arithmetic or interval construction. Hush Section3.1 additionally distinguishes process/core CPU readings, core frequency-residency durations, UID network bytes and device battery and signal readings; PID/UID-to-app aggregation is not inferred. CHI2020 Sarsenbayeva p3 supplies participant facial-expression confidence values from 0 to 100, not probabilities, percentages or questionnaire answers. Energy Drain2015 §§3–5 additionally supplies device summaries and distinct application-owned foreground/background/component quantities, independent application-category averages/totals/shares and version-scoped foreground drain rates plus total foreground energy/time/EDR. A category aggregate is not an individual app or evidence of app membership. An app token is not a process or Android UID; its identity and any period token are supplied, never joined. Participant context may be omitted/null only for exact source-compatible across-device Energy app/category summaries, Meaningful pooled U&G shares, Falaki across-user application-category popularity and Next App Table2 application classifications, and exact Mercati DATE2014 per-core reporting records from the hardware-only governor experiment with supplied device/core ownership. The wireless-signal controlled handset, system-call-model and validation observations (doi:10.1145/2465529.2466586) additionally permit unknown human context only with a supplied device; volunteer trace and selected-user what-if observations still require participant ownership. Screen Text and Angry Birds additionally distinguish exact source-scoped participant-group summaries from individual participant observations; unknown original group IDs are not manufactured. Screen Text application and application-category summaries retain their distinct subject kinds. A cohort or hardware device is never manufactured as a participant. Observation time may be omitted for study-wide summaries. Import performs no division, mean, weighting, membership propagation or classifier execution. Energy Drain2015 Section2.5 additionally retains independent dynamic event occurrences, not resulting state snapshots; source event time remains distinct from collection time. Appendix A logged per-core CPU frequency is not a residency duration, and raw screen brightness has an unreported unit, not the later duration-weighted percentage. Its UID-owned Nsnd/Nrcv byte values and T interval in seconds remain independent supplied quantities, without a UID-to-app join, cadence inference or network-call or energy reconstruction. Supplied student-course subjects keep the participant as the student and require a separate opaque course token. Distinct class/attendance evidence observations do not merge on course equality; explicitly supplied same-owner supports retain Wi-Fi-primary, GPS-building fallback and unavailable-evidence distinctions without inferring attendance. Scheduled, attended and effective class time, screen exposure and the class-time denominator remain independent. Source-compatible local definitions constrain entity, property and units. Next App §§3–5 additionally retains separately identified raw action occurrences, independently supplied basic/last-family vector features, app-opening analysis anchors and role-specific sampled supports. A following Gaussian context member is not a preceding last-action feature. Static inventories, cold-app class/prior values and explicit cold-user inventory/history relationships retain their independent owners. Vectors do not establish a dimension, training recipe or computed representation. No callback equivalence, latest selection, time ordering, Gaussian draw, aggregation, class cutoff or cross-user history alignment is inferred. Supplied predictor rows may name a same-owner task explicitly, without asserting an action anchor, original row join, window bounds or calculation. A supplied scan can own ordered AP appearances; a supplied inferred place can own AP/cell members. List position is not a rank or clustering proof. Root membership is an optional local reference, never inferred from order. Device summaries over observed days are not particular-day observations. A current-running-app snapshot owns simultaneous application appearances; a supplied per-user binary feature row owns vocabulary members with independent app-use values. Neither implies launch, foreground attribution or a reconstructed episode. A static installed-app inventory owns installed applications and optionally supplied native versus user-installed origin. Static membership is not a particular-day, monthly-use or running claim. No source cadence, timestamp, binary conversion, inventory count, native proportion or raw-to-derived join is inferred from members. A ranked recent-task snapshot can instead own application members with independently supplied source keys, zero-based ranks, boot-elapsed logging-time tokens, component strings and source values (Gouin-Vallerand2014 p3 Sample1). Per-member times may differ within a list; they are not a parent collection instant or a known launch time. No scalar time unit, boot-to-wall-clock join, unchanged-list filtering, rank reversal or transition is inferred. Mercati DATE2014 Figure2 per-core H/L allocation is distinct from scheduler PID observations, dynamic H-PID lists, foreground episodes and idle frequency context. Experimental seconds and reliability virtual-years quantities remain independent of scheduler/temperature cadences and the accelerated aging definition. H never constructs a maximum-frequency value; the reported budget-exhaustion qualification and unknown raw-to-plot constructor persist. Tapping2024 app/tap observations additionally admit explicitly supplied phone-session and local foreground-period action references. A→B→A visits retain independent identities. Source event time is not collection time; these supports never select a nearest episode or construct app periods. Independent authentication durations need not belong to the usage cohort; configuration booleans are normalized truth values, not recovered codes. PlacesActivities activity reports and CoronaHealth released active-use or inferred-inactivity records may additionally retain a supplied UsageInterval. That optional interval is not a fabricated task, place visit, day, inferred boundary pair or computed duration. Its endpoints and duration remain independent, with omission, null and populated values distinct. Corona submission observations keep ordered optional app blocks and separately permissioned coarse GPS; release windows are not necessarily one day. PlacesActivities context summaries distinguish participant means by activity, place type or characteristic from pooled participant-group summaries. Sleep Prediction daily graphs likewise retain an explicit participant-group owner, directed peer-day edges and independently supplied own previous-day quality. No callback, submission/GPS equality, calendar offset, membership, category, threshold, mean, questionnaire score or prediction is inferred.
--     * Slot: id
--     * Slot: sampled_observation_id Description: Supplied observation identity local to profile/participant/device; equal time or entity tokens do not merge records.
--     * Slot: screenshot_session_reference Description: Optional supplied cross-carrier screenshot-session parent. TimeKilling CHI2023 pp6–7 supplies a real phone-use parent distinct from prediction sequences; importer resolves source/profile/participant/compatible known device without constructing sessions or joins.
--     * Slot: screenshot_record_reference Description: Optional supplied screenshot child within its explicitly referenced screenshot-session parent. A known child requires that parent; missing/null child remains unknown. No timestamp equality, inferred nearest image, padding inference or recovered serializer.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Exact TimeKilling supplied group summaries additionally permit omitted/null individual context only on their source-authorized pooled route; no individual participant or device is inferred. Optional supplied context only for source-compatible application/application-category Energy Drain2015 aggregates, Meaningful pooled application U&G shares, Falaki across-user application-category popularity, Next App Table2 application classifications, exact Screen Text pooled application/category, participant-group or explicitly scoped place summaries, exact Angry Birds pooled application/category/participant-group and Kim2019 pooled application/participant-group summaries, and exact Mercati DATE2014 hardware-only per-core reporting records with supplied device/core ownership. Exact doi:10.1145/2465529.2466586 controlled handset, system-call-model and validation device/process observations also permit omitted/null human context only with a nonblank device; volunteer trace and selected-user what-if rows still require participant context. Exact PlacesActivities pooled context summaries and Sleep Prediction supplied daily graphs also permit omitted/null human context only as participant-group subjects without an individual participant/device. Exact KeyboardStress pooled participant-group windows/features and HMOG controlled-device energy observations also permit omitted/null human context; the former cannot name an individual participant/device and the latter require the supplied device. The importer retains a required nonblank participant for all other subject/source routes, including named-person Screen Text summaries, ordinary HMOG authentication and Hush CPU cores; it never invents a cohort or hardware participant.
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.
--     * Slot: device_use_session_reference Description: Optional explicitly supplied parent device-session ID. Exact source-compatible children resolve one unique same-profile/work/participant parent with compatible known device; unknown device never selects among multiple parents. Null/omission remains unknown. No clock or raw join is inferred.
--     * Slot: session_action_reference Description: Optional explicitly supplied action/foreground-period or unlock-attempt ID local to the explicitly referenced parent device session. A nonnull action requires its parent; known app/role contradictions reject without inferring unknown membership or timing.
--     * Slot: task_occurrence_reference Description: Optional supplied task identity within the same profile/source/participant/device; omission/null is unknown. Not a timing anchor, inferred original join, classifier input construction or questionnaire-answer reference.
--     * Slot: observed_entity_kind Description: Explicit subject kind constrained by the local source definition; an application, application category and participant group are distinct subjects, not an individual participant, process, core, Android UID, device, supplied course or inferred place. Participant groups are admitted only for exact source-scoped aggregate definitions. No PID/UID/package identity join, app/category/cohort membership or calendar window is implied.
--     * Slot: observed_entity_token Description: Opaque supplied identity of the typed subject, including independently identified applications, categories and student courses. A course token is not a class/attendance occurrence ID; distinct observation IDs preserve those instances. Null/omission remains unknown, not an inferred app package, PID, UID equality, app/category membership or cross-observation join.
--     * Slot: observation_instant Description: Opaque supplied collection-time token; no units, timezone or observed interval bounds inferred.
--     * Slot: source_event_time_token Description: Optional opaque source-designated event time, distinct from observation_instant collection time. Boredom Table1 has screen on/off/unlock occurrences and timed incoming/outgoing call and receiving/reading/sending SMS occurrences; WhyStop p3 also records timestamped RINGING/SMS_RECEIVED occurrences. Each is independently owned by its source definition, not a state snapshot or an invented task/session group. No point-time conversion, cadence, boundary pairing, temporal order, collector execution or ESM join is inferred.
--     * Slot: root_entity_member_reference Description: Optional supplied root member ID resolved within the same inferred group; omission/null is unknown, never the first member by convention.
--     * Slot: app_interruption_session_reference Description: Optional supplied tracked-app-session membership for this independently identified observation. Resolve within profile/source/participant and compatible known device; unknown device must not produce an ambiguous join. No session membership, observation timestamp, movement episode or interval is inferred.
--     * Slot: denotes_interval_id Description: Optional supplied UsageInterval only for source-compatible PlacesActivities activity reports and CoronaHealth active-use/inferred-inactivity release records. Start/end tokens, duration and endpoint statuses remain independent; no inclusivity, calendar, one-day boundary, clock arithmetic, place visit or session constructor is inferred.
-- # Class: SampledObservationReferenceRecord Description: Supplied role-qualified relationship to another normalized observation, not a matcher or temporal selection. Next App pp4–5 distinguishes one AppOpen anchor, six independently named last-action supports and a separate before/after Gaussian-context membership. Same-owner links resolve within profile/work/participant and compatible known device. Sections5.2.1–5.2.2 separately permit explicit cross-participant input inventories and surrogate-history members; target identities retain their source participant, never an inferred identity merge. Omitted/null target leaves this role's support unknown. Equal timestamps or values do not establish linkage, latest/nearest selection or order.
--     * Slot: id
--     * Slot: relationship_label Description: Supplied nonblank relationship designation, not inferred causality, chronology or a source storage code.
--     * Slot: sampled_observation_reference Description: Optional supplied target observation identity. Nonblank positive IDs resolve unambiguously within the relation's source-authorized owner scope; null/omission is unknown.
--     * Slot: SampledQuantityObservationRecord_id Description: Autocreated FK slot
-- # Class: SampledEntityMemberRecord Description: One supplied AP appearance, cell/AP member, or application member owned by one observation. Application meaning comes from the local source definition: simultaneous running appearance, supplied app-vocabulary feature member, static installed membership, or ranked recent-task member are distinct. Its local record identity is distinct from an optional recurring entity token and independently retained CID/LAC or anonymized MAC/SSID readings. Equal tokens/values do not merge members. RSSI/frequency belong to the scan appearance, not a stable AP property or an inferred place fingerprint. Omitted/null quantities remain unknown; an empty list is explicitly empty. Membership does not recover a scan-to-place join, ranking, geographic coordinate, hash algorithm, clustering execution, visit or session context. An application token is a supplied opaque identifier, not an inferred package/name mapping. Installation origin is an optional member-owned categorical quantity, not a device/cohort mean or inferred app use. Ranked recent-task source rank/key, boot-elapsed token, component and source value remain independent member quantities. Same-package/different- activity appearances retain distinct member IDs and ordered source keys; list position does not synthesize rank.
--     * Slot: id
--     * Slot: entity_member_id Description: Supplied member record ID unique within its owning observation; distinct from an optional recurring AP/cell identity token.
--     * Slot: member_entity_kind Description: Explicit member kind constrained by the local source definition; not inferred from token/value formatting.
--     * Slot: observed_entity_token Description: Opaque supplied identity of the typed subject, including independently identified applications, categories and student courses. A course token is not a class/attendance occurrence ID; distinct observation IDs preserve those instances. Null/omission remains unknown, not an inferred app package, PID, UID equality, app/category membership or cross-observation join.
--     * Slot: SampledQuantityObservationRecord_id Description: Autocreated FK slot
-- # Class: SampledQuantityRecord Description: One independently supplied quantity owned by its observation or window. Window summary values do not inherit raw-emotion confidence bounds. Traffic byte directions occur at most once per observation and require bytes. Hush frequency-residency members may have distinct opaque frequency qualifiers; unknown qualifiers never merge members or require inference. CPU/residency/signal units are undisclosed and remain omitted/null; UID network bytes and battery percent remain distinct. Emotion confidence has no inferred physical unit and its components need not sum to 100. Lexical JSON retains zero, quoted numeric text and JSON null separately from an omitted or null field. The source's raw serializer and counter reset/interval interpretation remain unknown; values are not converted.
--     * Slot: id
--     * Slot: observed_property Description: The device property the logger observed.
--     * Slot: evidence_value_json Description: Lexical JSON token for a supplied evidence value; literal false/zero/null/string-false tokens and a supplied-unknown null field remain distinct without casts.
--     * Slot: evidence_unit Description: Supplied unit for this quantity alone; no numeric conversion or inferred unit.
--     * Slot: quantity_qualifier Description: Supplied source-defined quantity variant: a core-residency frequency designation (Hush Section3.1), a session feature's absolute/frequency/normalization/state designation (Rabbit Hole Section4.1), or an explicitly named activity/component/connectivity/radio stratum for an Energy Drain2015 summary. No frequency, unit, weighting, group boundary or formula is inferred. Omission/null is unknown and does not merge members.
--     * Slot: TaskObservationWindowRecord_id Description: Autocreated FK slot
--     * Slot: SampledQuantityObservationRecord_id Description: Autocreated FK slot
--     * Slot: SampledEntityMemberRecord_id Description: Autocreated FK slot
-- # Class: MonthlyAppUseCellRecord Description: Supplied partial user/app/month binary cell, as distinguished in Sekara et al. Scientific Reports2021 Figure1 and Methods. One means used in that month and zero otherwise, not installed/uninstalled. Omitted/null values are normalized unknowns, never filled with zero. App and user tokens are opaque pseudonymous identifiers, not inferred packages or hash algorithms. No day/session, calendar boundary, complete fingerprint, eligibility or annual maximum/OR computation is inferred from these supplied cells.
--     * Slot: id
--     * Slot: cell_id Description: Supplied normalized app-use cell record identity local to profile/participant/device; not derived by concatenating tensor coordinates.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.
--     * Slot: month_label Description: Supplied nonblank month token, preserving wording without inferred days, timezone, bounds or calendar conversion.
--     * Slot: app_identifier Description: Opaque supplied app identity, including pseudonymous labels; not necessarily an Android package name.
--     * Slot: used_in_month Description: Supplied binary cell: 1 used during month, 0 otherwise. Missing/null is unknown and never converted to zero; no installed-app inference.
-- # Class: DeviceStateObservationRecord Description: Supplied normalized logged state-entry record, not a real-world occurrence, ringer occupancy or unlock-to-lock session. Hard Lock Life printed p218 Figure1/Section4.1.1 combines screen and keyguard states and timestamps state entry. Preserve independent state components and separately identified records at equal opaque times, including OFF/UNLOCKED. Optional/null values remain unknown, not inferred from the other component or an adjacent row. IDs and tokens are supplied, not recovered raw serialization.
--     * Slot: id
--     * Slot: state_observation_id Description: Supplied normalized state-record ID local to profile/participant/device; never derived from a timestamp.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.
--     * Slot: observation_instant Description: Supplied opaque state-entry time token. Null/omission/empty stay distinct; no clock conversion or chronology inferred.
--     * Slot: screen_state Description: Supplied screen component only, independent of keyguard state; omission/null remains unknown.
--     * Slot: keyguard_state Description: Supplied keyguard component only, independent of screen state; omission/null remains unknown.
-- # Class: DeviceStateIntervalRecord Description: Supplied kind-qualified interval with independently supplied endpoint state-record references. Hard Lock Life printed pp218/220 distinguishes screen bouts from upper-bound unlock cost. Equal time tokens do not equate endpoints or erase kind. Positive references resolve in the same profile, participant and known device; unknown endpoints remain null/omitted. Reuse UsageInterval without sorting, pairing, duration calculation, missing-event repair, or authentication inference. This is not an executed constructor.
--     * Slot: id
--     * Slot: state_interval_id Description: Supplied normalized interval-record ID local to profile/participant/device; equal bounds do not merge records.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: record_origin Description: Constructed example versus supplied normalized evidence; neither authenticates raw source rows.
--     * Slot: method_setting_reference Description: Local profile-owned source definition reference checked for the record's role/target at ingress; not a record identifier, execution receipt or raw-row authentication.
--     * Slot: interval_kind Description: Supplied interval meaning; upper-bound unlock cost is not authentication-input duration.
--     * Slot: start_observation_ref Description: Supplied start state-record ID, resolved within profile/participant/known device; null/omission is unknown, not reconstructed.
--     * Slot: end_observation_ref Description: Supplied end state-record ID, independent of start and bounds; resolved within profile/participant/known device.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: RingerStateIntervalRecord Description: Supplied normalized ringer-setting occupancy over an interval, not a continuous device-use session, mode-change callback or executed constructor. Chang and Tang (2015), printed p.12 / PDF p.7, defines occupancy until a different mode and calculates attendance gaps within that scope. The local source policy preserves the unknown powered-off duration (printed pp.14-15 / PDF pp.9-10); no bridge, deletion, duration or endpoint is inferred here. IDs and tokens are normalized, not recovered source serialization.
--     * Slot: id
--     * Slot: ringer_state_interval_id Description: Normalized interval record identity scoped by profile and participant.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: interval_record_origin Description: Supplied normalized records versus constructed example; neither authenticates source rows or reconstruction.
--     * Slot: session_construction_policy_reference Description: Local profile-owned policy ID whose output is device_setting_state_interval; not an execution receipt.
--     * Slot: ringer_mode Description: Supplied normalized setting occupied over denotes_interval; no numeric-code conversion or phone-use inference.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
-- # Class: UsageEpisodeAssertion Description: A claim that one app was in continuous use over an interval. A derived prov:Entity (what the pipeline asserts, not a ground truth).
--     * Slot: id
--     * Slot: app_package_name Description: Android package name.
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: measurement_layer Description: Measurement-model layer.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: reconstructed_by_id Description: The execution that produced this assertion.
--     * Slot: attribution_id Description: Person attribution for this episode.
-- # Class: UsageSessionAssertion Description: A claim of continuous device use between unlock and lock. Derived prov:Entity.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: measurement_layer Description: Measurement-model layer.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: reconstructed_by_id Description: The execution that produced this assertion.
-- # Class: GlanceAssertion Description: A claim that the screen activated then deactivated without an unlock. Derived prov:Entity.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: measurement_layer Description: Measurement-model layer.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: reconstructed_by_id Description: The execution that produced this assertion.
-- # Class: EffectiveUsageMeasure Description: One screen-gated credited app EPISODE — the unit the engine actually emits when `enable_screen_gated_crediting` is on.An earlier version of this class described a per-participant-day `effective_minutes` figure governed by a free-text `coverage_policy`. No such daily measure exists. `apply_screen_gated_credit_incremental` (pipeline_v2.rs) emits `credited_app_csv`, a side-by-side CSV written by the same `write_app_csv_from_iter` as the headline app output, so a credited measure is an episode row with the app schema's own start, stop, duration and date — not a daily total. Its workflow checkpoint is named `effective_usage`, which is where this class's name comes from.The rule that decides which parts of a session earn credit is typed: ScreenGatingRuleId, not prose. Its three values select witnessed screen-ON intervals, demonstrably-alive spans, or (the default) their intersection. The numeric bounds around it — `auto_lock_bridge_seconds`, `credited_session_cap_minutes`, `device_liveness_gap_tolerance_minutes`, `no_witness_min_day_apps` — are ordinary ParameterBindings of the cited ParameterSet.NOT asserted as physical truth, and never a replacement for the headline app-usage output, which no value of the gating rule changes. A daily credited total is an aggregation a consumer performs over these rows under a stated DayBoundaryAttributionId and TimezoneNormalizationPolicyId; it is not something this pipeline emits.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: date Description: Local calendar date the row is attributed to, in the run's output timezone (see TimezoneNormalizationPolicyId) and under the selected DayBoundaryAttributionId.
--     * Slot: app_package_name Description: Android package name.
--     * Slot: produced_by Description: The operation execution that produced this measure.
--     * Slot: screen_gating_rule Description: The typed rule that decided which parts of the app session earned credit. Replaces the former free-text coverage_policy, which named a policy vocabulary that never existed.
--     * Slot: denotes_interval_id Description: The phenomenon-time interval this assertion denotes.
--     * Slot: cites_parameter_set_id Description: The ParameterSet under which this measure was produced.
-- # Class: ComplianceDayAssessment Description: One participant-day row of the `compliance_csv` — the compliance measure this engine actually computes. Its slots mirror the CSV columns: the eight-field `ComplianceDayCheckpoint` (pipeline_v2.rs) plus `expected_device_count`, which the writer joins from the enrolled-devices support file at write time; `compliance_threshold_percent` is the scalar input the engine compares against (not a CSV column), and `compliance_value_basis` is this ontology's own name for the imputation distinction, present in no engine output. This term exists because AttributionStatus formerly claimed to BE the compliance denominator contract while nothing described the quantity, its denominator, or its defaults.WHAT THE DENOMINATOR ADMITS. `accumulate_minutes` (pipeline_v2_incremental.rs) walks the output rows and adds `duration_minutes` to the day's bucket only when the row's interaction type is App Usage or Non-Target Participant App Usage AND `minimum_duration_aggregate_eligible` is set. Numerator = minutes whose username is neither blank, "nan", nor "None"; denominator = numerator plus the rest.WHAT IT SILENTLY EXCLUDES, in every case without a receipt in this output: (1) Filtered App Usage — excluded packages are RELABELLED rather than deleted, keep their raw evidence, and are then absent from both numerator and denominator, so package-exclusion policy moves this measure; (2) episodes ruled ineligible by the minimum-duration disposition, so a sub-floor episode's minutes are attributed to nobody; (3) any episode whose duration is blank, which contributes 0.0; (4) every non-app row type, including End of Usage Missing — so an episode zeroed by the long-duration cap leaves the denominator entirely. The compliance percent is therefore a share of ADMITTED minutes, never a share of the participant's day.THE 100.0 DEFAULT IS AN IMPUTATION. When the participant is not in the device-sharing file, or when the admitted total for the day is zero, the engine writes compliance_percent = 100.0 without measuring anything, and `is_valid` then compares that literal against the threshold like any other value — so an unshared participant and a participant with no qualifying usage both count as valid days. The distinction survives only in `sharing_status` and `zero_real_usage`; compliance_value_basis is this ontology's name for it, so a summary of the percent column can state which rows it measured and which it inherited.The participant-day spine is every (participant, date) pair seen on any APP-output row — the screen output is not consulted — including rows contributing no minutes, so a day can appear here with a zero total and a 100.0 percent.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: date Description: Local calendar date the row is attributed to, in the run's output timezone (see TimezoneNormalizationPolicyId) and under the selected DayBoundaryAttributionId.
--     * Slot: sharing_status Description: Whether the participant's device is declared shared, as read from the device-sharing support file.
--     * Slot: known_minutes Description: Admitted minutes on this participant-day whose username is a real person (neither blank, "nan", nor "None"). The compliance numerator.
--     * Slot: unknown_minutes Description: Admitted minutes on this participant-day with no resolved person. In the denominator, never in the numerator, and never dropped.
--     * Slot: compliance_percent Description: known_minutes / (known_minutes + unknown_minutes) as a percentage rounded to two decimals — OR the literal 100.0 imputed for a non-shared participant or a day with no admitted minutes. Always read with compliance_value_basis.
--     * Slot: compliance_value_basis Description: Whether compliance_percent was measured or imputed, and which imputation applied.
--     * Slot: zero_eligible_usage Description: True when no App Usage or Non-Target Participant App Usage row on this participant-day was aggregate-eligible with nonzero minutes, so the share was 0/0. The engine's zero_real_usage column.
--     * Slot: compliance_threshold_percent Description: The percent a day must reach to count as valid. Study-specific; the product default is 70.
--     * Slot: meets_compliance_threshold Description: compliance_percent >= compliance_threshold_percent. The engine's is_valid column, computed over imputed 100.0 values exactly as over measured ones.
--     * Slot: expected_device_count Description: Enrolled device count for the participant, joined from the enrolled-devices support file; blank when the participant is absent from it. Reported alongside the measure, not used in it.
-- # Class: DayCoverageAssessment Description: One participant-day row of the `day_coverage_csv`: the observability status the engine actually computes, over a spine that is the participant's study window when one is configured and otherwise their first-to-last observed date. Distinct from CoverageAssessment, which models a cause attribution this pipeline does not make (see CoverageCause).
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: date Description: Local calendar date the row is attributed to, in the run's output timezone (see TimezoneNormalizationPolicyId) and under the selected DayBoundaryAttributionId.
--     * Slot: day_coverage_status Description: Observability status for this participant-day.
-- # Class: CoverageAssessment Description: A coverage/observability judgement over a stream window: expected vs actual data availability, its threshold, bounding events, and best-supported cause. A gap MAY CONCEAL usage — this asserts only how the measurement policy treats the interval, never that the device was inactive.DESIGN-TIME ONLY, like the CoverageCause it carries: no kernel path emits an expectation, an availability threshold, a policy treatment, or a cause. The coverage judgement this engine ships is the per-day DayCoverageAssessment. Keep the two apart when reading an instance graph — this class describes a window-level cause attribution that is available to an author, not a reading of pipeline output.
--     * Slot: id
--     * Slot: participant_id Description: Participant/device identifier (string, always).
--     * Slot: device_id Description: Device identifier.
--     * Slot: expected_available Description: Whether data was expected to be available (needs a heartbeat/expectation to assert NoData).
--     * Slot: actually_available Description: Whether any data was actually present.
--     * Slot: availability_threshold Description: Coverage threshold applied.
--     * Slot: coverage_cause Description: Best-supported cause.
--     * Slot: policy_treatment Description: How the measurement policy treats this interval (e.g. pass / na / exclude).
--     * Slot: assesses_interval_id Description: The stream window assessed.
-- # Class: AttributionAssertion Description: Attribution of usage to a person. Exactly one status is required; an actual person is attached only when known. The participant-device-day denominator must satisfy duration conservation: target + known_non_target + unresolved = eligible.
--     * Slot: id
--     * Slot: attribution_status Description: Required attribution status.
--     * Slot: attributed_person Description: The actual person, attached only when known.
--     * Slot: on_shared_device Description: Whether the device is shared.
-- # Class: WorkflowPlan Description: The prospective processing workflow. A p-plan:Plan / prov:Plan.
--     * Slot: plan_id Description: Plan identifier.
-- # Class: OperationDefinition Description: One semantic operation in the workflow at any useful scale. Operations compose recursively via part_of_operation so a coarse responsibility and its independently invalidatable transformations share one model without forcing presentation and execution boundaries to coincide.
--     * Slot: operation_id Description: Stable semantic operation identifier.
--     * Slot: verb Description: Action the operation performs.
--     * Slot: engine Description: Named algorithm or engine the operation realizes.
--     * Slot: operation_role Description: Semantic responsibility of the operation.
--     * Slot: epistemic_role Description: Whether the operation observes, infers, applies policy, or presents.
--     * Slot: is_fatal Description: Whether a failure fails the whole workflow.
--     * Slot: part_of_operation Description: The coarser semantic operation this operation is a proper part of. Referenced by operation_id, not inlined.
--     * Slot: grouping_basis Description: Whether groups are declared or constructed by field equality or ordered raw string concatenation.
--     * Slot: selection_rule Description: Source-declared group member disposition, independent of the unrecovered ordering or marker implementation.
--     * Slot: event_payload_association Description: Direction and source-declared association of payloads within one interaction event; no undisclosed temporal predicate is implied.
--     * Slot: missing_gesture_marks_incomplete Description: Whether absence of gesture metadata marks the event incomplete, independently of the captured screenshot and hierarchy.
--     * Slot: gesture_presence_implies_correctness Description: Whether gesture presence alone establishes correctness. False means presence is insufficient evidence, not that every gesture is wrong. Completeness and correctness remain independent; no particular instance is assessed here.
--     * Slot: sequence_encoding_rule Description: Closed encoding rule applied to every ordered occurrence within each declared partition.
--     * Slot: sequence_first_symbol_setting_id Description: Profile-local source assertion of the literal symbol emitted for a first occurrence in the partition.
--     * Slot: sequence_repeat_symbol_setting_id Description: Profile-local source assertion of the literal symbol emitted for an identity previously encountered in the partition.
--     * Slot: WorkflowPlan_plan_id Description: Autocreated FK slot
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: OperationExecution Description: A retrospective execution of an OperationDefinition. A prov:Activity.
--     * Slot: execution_id Description: Stable workflow-execution identifier.
--     * Slot: executes_operation Description: The OperationDefinition this execution realizes.
--     * Slot: started_at Description: Execution start.
--     * Slot: ended_at Description: Execution end.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: QueryDefinition Description: One physical computation and memoization boundary. Its realizes_operations links are prospective mappings and do not imply that those semantic operations were applied in a particular run.
--     * Slot: query_id Description: Stable physical-query identifier.
--     * Slot: query_group_id Description: Presentation-only query-group identity.
--     * Slot: WorkflowPlan_plan_id Description: Autocreated FK slot
-- # Class: QueryExecution Description: Retrospective evidence for one physical query. Kept distinct from OperationExecution because a fused query can realize several semantic operations with different applicability.
--     * Slot: id
--     * Slot: executes_query Description: The QueryDefinition this execution realizes.
--     * Slot: query_execution_status Description: Observed physical execution state.
--     * Slot: query_input_key Description: Content identity of the query's exact effective inputs.
--     * Slot: query_output_digest Description: Content identity of the query output.
--     * Slot: query_reason_id Description: Stable identity of the evidence supporting the state.
--     * Slot: part_of_execution Description: Root workflow execution containing this query execution.
--     * Slot: execution_started_at Description: Evidence timestamp for the query execution.
--     * Slot: execution_ended_at Description: Evidence timestamp for the query execution.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: ReconstructionExecution Description: The execution that produced a usage assertion. A prov:Activity.
--     * Slot: id
--     * Slot: follows_strategy Description: The reconstruction strategy followed.
--     * Slot: used_parameter_set_id Description: The ParameterSet the execution used.
-- # Class: ReconstructionStrategy Description: A named, versioned episode-reconstruction algorithm (semantic category + canonical IRI). Subclass only where formal restrictions genuinely differ.
--     * Slot: strategy_id Description: Strategy identifier (unique key).
--     * Slot: strategy_kind Description: Canonical strategy category (IRI-bearing enum value).
--     * Slot: strategy_version Description: Strategy version.
--     * Slot: canonical_iri Description: Canonical IRI carried by the runtime enum.
-- # Class: ParameterSet Description: A content-addressed configuration entity — a set of ParameterBindings over the plan's variables. NOT a Plan: the plan is the workflow; this binds its variables.
--     * Slot: id
--     * Slot: parameter_set_sha256 Description: Content-addressed hash of the canonical parameter set.
-- # Class: ParameterBinding Description: One knob = value binding within a ParameterSet: a key and its canonical JSON value, and nothing else.THIS IS FLAT AND UNTYPED, DELIBERATELY AND COMPLETELY. The runtime provenance builder (`workflow_provenance.rs`) emits one of these nodes per entry of the request's parameter object with only `chron:knob_key` and `chron:knob_value`. No binding declares what kind of consequence its knob has, and that is true of the named research axes as well: selecting `zerrer_60s` reaches the sidecar as the string pair ("session_grouping_policy", "zerrer_60s"), carrying no link to SessionGroupingPolicyId. A reader recovers axis identity by matching knob_key against the option slots that carry a `research_axis_enum` annotation in `chronicle-local-contract.linkml.yaml`, and recovers nothing for the rest.THE SHAPE OF WHAT IS LEFT OVER. Some keys the contract classifies as computational (`COMPUTATIONAL_BROWSER_OPTION_KEYS`) carry a `research_axis_enum`; `timezone_handling`, via `research_ontology_enum`, also binds an ontology enum. The remaining computational keys have no term here at all. That set is not a residue of presentation knobs — it includes keys that change measured quantities: `use_app_codebook` (DEFAULT ON) RESTATES WHAT EACH ROW'S APP IS — `join_codebook` attaches a second, codebook-sourced identity (`application_label` arrives as `codebook_application_label` beside the row's own label) and the whole category/genre block, then `derive_broad_category` and `collapse_app_genre` write the row's reported broad category and `genre_id_scraped`, each defaulting to "Unknown" when the codebook offers nothing. The package key is untouched, but every category-level analysis of the output is a reading of the codebook rather than of the device; `proximity_interval_seconds` MOVES EPISODE BOUNDARIES by treating an Activity Stopped within its grace as an intra-app teardown rather than a close; `timezone_handling` can delete rows outright (see TimezoneNormalizationPolicyId, the one such key this ontology now names); `interaction_type_remap` rewrites the event vocabulary at ingest, BEFORE reconstruction sees it, while `interaction_types_to_remove` deletes output rows AFTER it — two knobs that read alike and sit on opposite sides of the reconstruction; `long_duration_threshold_hours` decides which episodes surface as End of Usage Missing; `minimum_usage_duration` blanks durations; `model_concurrent_usage` splits overlapping episodes.WHY THEY STAY UNTYPED, rather than each becoming an axis. Every named axis in this ontology is an enumerated PUBLISHED-METHOD vocabulary whose values are alternatives a study could have chosen and a paper can be cited for. A continuous grace in seconds, a float threshold, or a boolean has no such value set; minting one would mean inventing permissible values no source declares, which is the failure mode the EventRetentionSetId provenance warning already guards against. `proximity_interval_seconds` is the clearest case: the kernel implements exactly one proximity rule with a numeric grace, so there is no vocabulary to name, and calling it an axis would assert a choice between methods that does not exist. These keys are declared and described in the local contract instead, which is where a non-vocabulary parameter belongs.Two consequences a consumer must not overlook. A ParameterSet digest is identical whether a knob was set deliberately or left at its default, so the sidecar answers "what ran" and never "what was chosen". And two knob keys with equal consequence — one an axis, one not — are indistinguishable here, so a provenance graph must not be read as ranking them.
--     * Slot: id
--     * Slot: knob_key Description: Option/knob key.
--     * Slot: knob_value Description: Bound value (canonical JSON string).
--     * Slot: ParameterSet_id Description: Autocreated FK slot
-- # Class: StudyMethodProfile Description: A versioned, source-located account of one retained method from acquisition through release. A profile is not runnable while any applicable setting is unresolved; semantic coverage never implies executable support.
--     * Slot: method_profile_id Description: Stable identifier for the versioned method profile.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: source_method_variant_id Description: Stable identity of the exact cohort, platform, protocol version, branch, or multiverse configuration represented by this profile.
--     * Slot: source_method_variant_label Description: Source-facing label for this exact method variant.
--     * Slot: source_method_cohort Description: Cohort or population slice to which this exact method variant applies.
--     * Slot: source_method_platform Description: Platform or device slice to which this exact method variant applies.
--     * Slot: source_method_branch Description: Source-declared analysis, sensitivity, ablation, or protocol branch represented by this profile.
--     * Slot: method_configuration_structure Description: Relationship among this source's method specifications; never infer unreported cross-products.
--     * Slot: method_profile_version Description: Version of this source-to-method interpretation.
--     * Slot: method_setting_count Description: Number of embedded method settings; must equal the inventory and object count.
--     * Slot: profile_implementation_status Description: Whole-profile execution status; executable requires every replication gate to pass.
--     * Slot: method_configuration_space_method_configuration_space_id Description: Complete source-declared configuration space for this method.
--     * Slot: method_configuration_selection_method_configuration_selection_id Description: Exact selected source levels for one executable method variant.
-- # Class: MethodSettingAssertion Description: One source-supported decision in a StudyMethodProfile. This is richer than runtime ParameterBinding: it preserves semantic role, target, value shape, evidence, and implementation binding before a runnable subset compiles to flat knob/value pairs.
--     * Slot: method_setting_id Description: Stable identity of one source-supported setting assertion.
--     * Slot: source_extraction_id Description: Evidence-row identity from which this atomic setting was derived.
--     * Slot: rubric_component_id Description: Stable C01-C21 measurement-component identifier when applicable.
--     * Slot: method_setting_role Description: Functional role of the setting.
--     * Slot: method_target_layer Description: Layer affected by the setting.
--     * Slot: method_parameter_key Description: Source or canonical parameter name.
--     * Slot: method_value_kind Description: Serialization shape of method_value_json.
--     * Slot: method_value_json Description: Canonical JSON serialization of the complete source-declared value.
--     * Slot: method_unit Description: Unit attached to the value.
--     * Slot: method_comparator Description: Boundary comparator such as less-than, at-most, or inclusive-between.
--     * Slot: method_boundary_convention Description: Inclusivity, clipping, ordering, or calendar convention required to interpret the value.
--     * Slot: method_applicability_status Description: Whether this setting is required for this profile, separately from disclosure quality.
--     * Slot: method_disclosure_status Description: What the reviewed source disclosed for this setting.
--     * Slot: chronicle_output_kind Description: Exact Chronicle output artifact kind containing the source-declared output field.
--     * Slot: chronicle_output_column Description: Exact Chronicle output column corresponding to the source-declared output field.
--     * Slot: source_output_position Description: Zero-based position of this field in the source-declared output tuple.
--     * Slot: method_implementation_status Description: Execution support for this exact setting, never inferred from semantic mapping alone.
--     * Slot: method_execution_route Description: Exact replication destination assigned to this setting.
--     * Slot: method_execution_destination_id Description: Registered operation, protocol adapter, external executor, or receipt destination identity.
--     * Slot: method_execution_parameter_path Description: Exact parameter or input path within the destination contract.
--     * Slot: method_execution_blocker_code Description: Current fail-closed reason preventing this route from executing.
--     * Slot: executor_id Description: Stable native or external executor identity when one exists.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: source_evidence_work_id Description: Canonical identity of the exact source supplying the evidence when it differs from the reviewed work.
--     * Slot: source_component_id Description: Source extraction component or auxiliary axis identity.
--     * Slot: source_observed_setting Description: Source-located statement from which this atomic setting was extracted.
--     * Slot: source_value_json Description: Canonical JSON serialization of the complete pre-atomization source value for reversible audit.
--     * Slot: source_coverage_status Description: Source-ledger coverage status preserved independently from applicability and implementation.
--     * Slot: source_clause_label Description: Human-readable label for the accounted source clause.
--     * Slot: source_clause_text Description: Exact extracted clause text represented by this atomic setting.
--     * Slot: source_clause_path Description: Stable structural path of the clause within the source extraction.
--     * Slot: source_clause_start Description: Start offset of the clause within the preserved source value.
--     * Slot: source_clause_end Description: End offset of the clause within the preserved source value.
--     * Slot: source_value_sha256 Description: SHA-256 identity of the complete preserved source value.
--     * Slot: method_variant_group_id Description: Stable identity of a source-declared alternative, joint specification, conditional branch set, or multiverse group.
--     * Slot: method_variant_relation Description: Source-declared relationship among members of the method variant group; kept verbatim until profile partitioning adjudicates it.
--     * Slot: method_variant_branch_id Description: Stable branch identity within the method variant group.
--     * Slot: method_variant_branch_label Description: Source-facing label for this branch or member.
--     * Slot: method_configuration_json Description: Canonical JSON preserving the complete source-declared atomic, joint, variant, or multiverse configuration structure.
--     * Slot: structured_protocol_candidate_json Description: Canonical JSON preserving an evidence-derived candidate for a first-class acquisition, diary, session, duration, timestamp, release, or notification protocol object.
--     * Slot: evidence_layer Description: Source evidence layer used for this assertion.
--     * Slot: ontology_mapping_note Description: Preserved source-to-ontology mapping note.
--     * Slot: gap_assessment Description: Preserved assessment of any semantic or execution gap.
--     * Slot: integration_source Description: Corpus wave or integration source that supplied the evidence.
--     * Slot: adjudication_confidence Description: Bounded confidence in the structured adjudication.
--     * Slot: adjudication_rationale Description: Evidence-bound rationale for implementation and binding status.
--     * Slot: conformance_fixture_id Description: Stable identity of the source or source-derived fixture proving this exact executor binding.
--     * Slot: conformance_result_digest Description: Content digest of the passing conformance result for this exact setting and executor value.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
--     * Slot: AcquisitionProtocol_acquisition_protocol_id Description: Autocreated FK slot
--     * Slot: SessionConstructionPolicy_session_construction_policy_id Description: Autocreated FK slot
--     * Slot: DiaryProtocol_diary_protocol_id Description: Autocreated FK slot
-- # Class: MethodContractBinding Description: One exact compilation target for a method setting. It binds one generated runtime slot to one canonical JSON value. Candidate semantic mappings stay in mapped_contract_slot; only this class authorizes compilation.
--     * Slot: id
--     * Slot: contract_slot Description: Exact generated runtime-contract slot.
--     * Slot: contract_value_json Description: Canonical JSON value supplied to the runtime slot.
--     * Slot: MethodSettingAssertion_method_setting_id Description: Autocreated FK slot
-- # Class: LiteratureInputAdapterContract Description: A closed, versioned registration that promotes source-backed method settings only when an existing Chronicle upload role can carry the observations and a named Rust adapter validates or transforms them. The setting inventory is exact: unregistered settings remain blocked and no missing values are synthesized.
--     * Slot: id
--     * Slot: literature_input_semantic_type Description: Audited semantic input artifact group.
--     * Slot: literature_input_adapter_id Description: Registered Rust input adapter identity.
--     * Slot: literature_input_adapter_version Description: Exact adapter version committed to execution receipts.
--     * Slot: literature_input_route_kind Description: Protocol-input or native-operator route used by the adapter.
--     * Slot: literature_input_role Description: Existing raw or support-file role consumed by the adapter.
--     * Slot: literature_input_schema_id Description: Closed schema identity validated at ingestion.
--     * Slot: literature_input_gui_surface Description: Existing schema-driven upload surface that supplies this role.
-- # Class: ProtocolMaterializationBlocker Description: One source-grounded reason a typed protocol fragment is partial or withheld. The canonical setting remains authoritative; this object prevents the missing protocol field from disappearing at profile assembly.
--     * Slot: protocol_materialization_blocker_id Description: Stable identity of one protocol materialization blocker.
--     * Slot: protocol_materialization_id Description: Stable identity of the protocol fragment this blocker concerns.
--     * Slot: protocol_ontology_class Description: Intended typed ontology class for the protocol fragment.
--     * Slot: protocol_profile_slot Description: StudyMethodProfile slot to which the fragment belongs.
--     * Slot: protocol_object_attached Description: Whether the partial but shape-conformant protocol object is attached to its typed slot.
--     * Slot: protocol_blocker_code Description: Stable missing-field or materialization blocker code.
--     * Slot: protocol_blocker_field Description: Protocol field affected by the blocker.
--     * Slot: protocol_blocker_reason Description: Source-grounded reason the field could not be populated.
--     * Slot: partial_protocol_object_json Description: Canonical JSON of a withheld shape-invalid protocol fragment.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: MethodConfigurationSpace Description: The complete source-declared choice space for one retained method. Levels and combinations are explicit; absence of an allowed combination forbids inventing a Cartesian product.
--     * Slot: method_configuration_space_id Description: Stable identity of a source method's configuration space.
--     * Slot: method_configuration_structure Description: Relationship among this source's method specifications; never infer unreported cross-products.
-- # Class: MethodConfigurationGroup Description: One source-declared fixed, alternative, conditional, sensitivity, ablation, or multiverse group.
--     * Slot: method_configuration_group_id Description: Stable identity of one source configuration group.
--     * Slot: method_configuration_group_kind Description: Source-grounded group kind such as fixed set, sensitivity axis, ablation, or conditional state machine.
--     * Slot: method_selection_semantics Description: Whether levels are jointly applied, independently selectable, conditional, documentary, or evidence-blocked.
--     * Slot: method_cross_product_policy Description: Explicit rule prohibiting or enumerating combinations with other groups.
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
-- # Class: MethodConfigurationLevel Description: One exact source-declared level or branch and its setting membership.
--     * Slot: method_configuration_level_id Description: Stable identity of one source-declared configuration level.
--     * Slot: method_configuration_level_label Description: Source-facing label for the level.
--     * Slot: MethodConfigurationGroup_method_configuration_group_id Description: Autocreated FK slot
-- # Class: MethodConfigurationCombination Description: One combination explicitly enumerated by the source; never inferred from independent levels.
--     * Slot: method_configuration_combination_id Description: Stable identity of one source-enumerated combination.
--     * Slot: method_configuration_combination_label Description: Source-facing label for the combination.
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
-- # Class: MethodConfigurationSelection Description: One exact selection from a source-declared configuration space.
--     * Slot: method_configuration_selection_id Description: Stable identity of one exact source configuration selection.
--     * Slot: method_configuration_space_reference Description: Configuration-space identity from which this selection was made.
--     * Slot: method_configuration_selection_status Description: Exactness and source authorization state of the selection.
-- # Class: AcquisitionProtocol Description: Actual observation semantics, distinct from selecting events after collection. Cadence, lookback, cursoring, overlap, persistence, and failure behavior can each change which occurrences are observable.
--     * Slot: acquisition_protocol_id Description: Stable acquisition-protocol identifier.
--     * Slot: collector Description: Collector, framework, application, or instrument.
--     * Slot: api_and_version Description: Acquisition API and applicable version.
--     * Slot: observation_mode Description: Callback, broadcast, fixed-cadence poll, retrospective query, snapshot, or aggregate mode.
--     * Slot: requested_cadence Description: Requested observation or prompt cadence.
--     * Slot: realized_cadence_and_jitter Description: Observed cadence and jitter, kept distinct from the request.
--     * Slot: query_bounds Description: Query interval and bound inclusivity.
--     * Slot: lookback Description: Retrospective lookback rule.
--     * Slot: backfill Description: Historical backfill rule.
--     * Slot: cursor_policy Description: Cursor advancement and resume rule.
--     * Slot: overlap_policy Description: Overlap between acquisition windows.
--     * Slot: acquisition_deduplication Description: Identity and disposition for repeated acquired observations.
--     * Slot: occurrence_timestamp_semantics Description: Meaning and source of occurrence time.
--     * Slot: processing_timestamp_semantics Description: Meaning and source of collection or processing time.
--     * Slot: initial_sample_policy Description: Treatment of the first observation in a run or window.
--     * Slot: terminal_sample_policy Description: Treatment of the last or incomplete observation in a run or window.
--     * Slot: persistence_policy Description: On-device or intermediate persistence behavior.
--     * Slot: upload_policy Description: Upload trigger, batching, retry, and transport behavior.
--     * Slot: restart_behavior Description: Behavior across collector or device restart.
--     * Slot: doze_behavior Description: Behavior under Android doze or battery restrictions.
--     * Slot: permission_loss_behavior Description: Behavior and provenance when required permission is absent or revoked.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: SessionConstructionPolicy Description: A target-typed session constructor. App sessions, screen bouts, device sessions, pickup activations, and runs of polled samples are not aliases.
--     * Slot: session_construction_policy_id Description: Stable target-typed session-construction identifier.
--     * Slot: session_input_layer Description: Layer consumed by the constructor.
--     * Slot: session_output_layer Description: Layer asserted by the constructor.
--     * Slot: reconstruction_strategy Description: Named reconstruction strategy used by the constructor.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: NotificationAttributionPolicy Description: A policy relating notification evidence to behavior or artifact disposition, distinct from generic foreground/background attribution.
--     * Slot: notification_attribution_policy_id Description: Stable notification-attribution policy identifier.
--     * Slot: notification_target_behavior Description: Behavior attributed to notification evidence.
--     * Slot: notification_evidence_mode Description: Observed or inferred notification evidence.
--     * Slot: notification_temporal_direction Description: Whether evidence precedes, follows, or brackets behavior.
--     * Slot: notification_window Description: Attribution window.
--     * Slot: method_comparator Description: Boundary comparator such as less-than, at-most, or inclusive-between.
--     * Slot: notification_package_scope Description: Package identity or matching scope.
--     * Slot: notification_attribution_confidence Description: Confidence or evidence strength.
--     * Slot: notification_disposition Description: Retain, relabel, remove, flag, or other resulting action.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: DurationPolicy Description: A duration rule with an explicit target layer. Equal thresholds applied to an app episode, screen bout, device session, pickup, polled run, or daily aggregate are different methods.
--     * Slot: duration_policy_id Description: Stable target-typed duration-policy identifier.
--     * Slot: method_target_layer Description: Layer affected by the setting.
--     * Slot: method_comparator Description: Boundary comparator such as less-than, at-most, or inclusive-between.
--     * Slot: method_value_json Description: Canonical JSON serialization of the complete source-declared value.
--     * Slot: method_unit Description: Unit attached to the value.
--     * Slot: duration_action Description: Action on values meeting the duration condition.
--     * Slot: method_boundary_convention Description: Inclusivity, clipping, ordering, or calendar convention required to interpret the value.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: TimestampPolicy Description: Timestamp fidelity, ordering, multiplicity, and synthetic-order provenance. Original and effective time remain separate.
--     * Slot: timestamp_policy_id Description: Stable timestamp-policy identifier.
--     * Slot: original_timestamp_semantics Description: Preserved source timestamp meaning and representation.
--     * Slot: effective_timestamp_semantics Description: Timestamp used by later operations after correction or normalization.
--     * Slot: timestamp_resolution Description: Source or effective timestamp resolution.
--     * Slot: source_sequence_semantics Description: Preserved acquisition or source-row order.
--     * Slot: tie_group_semantics Description: Identity of observations sharing an effective timestamp.
--     * Slot: acquisition_deduplication Description: Identity and disposition for repeated acquired observations.
--     * Slot: tie_break_policy Description: Ordering or multiplicity policy within a tie group.
--     * Slot: synthetic_order_provenance Description: Provenance for a timestamp or order introduced by processing.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: ParameterProvenanceAssertion Description: Documentary and derivation provenance for one method parameter. A citation, a default, an author-set value, and a data-derived value are not aliases.
--     * Slot: parameter_provenance_id Description: Stable parameter-provenance assertion identifier.
--     * Slot: method_parameter_key Description: Source or canonical parameter name.
--     * Slot: method_value_json Description: Canonical JSON serialization of the complete source-declared value.
--     * Slot: derivation_type Description: Author-set, data-derived, conventional, engineering, repository-default, or unresolved origin.
--     * Slot: documentary_support Description: Primary, secondary, cited-unverified, unstated, or unresolved documentary basis.
--     * Slot: inheritance Description: Direct, inherited, or unresolved parameter transfer.
--     * Slot: method_boundary_convention Description: Inclusivity, clipping, ordering, or calendar convention required to interpret the value.
--     * Slot: method_target_layer Description: Layer affected by the setting.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: SourceArtifactProvenanceAssertion Description: Exact, content-bound documentary provenance registered for a source artifact. Registration verifies identity and bytes. `documentary_only` maps to `executionEligible=false` at the browser and Rust receipt boundaries.
--     * Slot: source_artifact_provenance_id Description: Stable identity of a source-artifact provenance assertion.
--     * Slot: method_setting_id Description: Stable identity of one source-supported setting assertion.
--     * Slot: source_work_id Description: Canonical citation identity of the source work.
--     * Slot: source_extraction_id Description: Evidence-row identity from which this atomic setting was derived.
--     * Slot: source_value_sha256 Description: SHA-256 identity of the complete preserved source value.
--     * Slot: source_artifact_provenance_object_json Description: Canonical JSON serialization of the exact registered provenance object.
--     * Slot: source_artifact_provenance_object_digest Description: JCS SHA-256 digest of the exact registered provenance object.
--     * Slot: candidate_status Description: Closed-registry adjudication status.
--     * Slot: conformance_fixture_id Description: Stable identity of the source or source-derived fixture proving this exact executor binding.
--     * Slot: conformance_result_digest Description: Content digest of the passing conformance result for this exact setting and executor value.
--     * Slot: execution_eligibility Description: Closed documentary-only eligibility; the referenced artifact is never executed.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: MeasurementReleaseProfile Description: Provenance from collected signal to the measure and granularity released for analysis.
--     * Slot: release_profile_id Description: Stable measurement-release profile identifier.
--     * Slot: measurement_source Description: Collected source signal or upstream measure.
--     * Slot: measurement_target Description: Construct the method intends to measure.
--     * Slot: objective_metric_type Description: Count, duration, latency, ratio, sequence, classification, or another metric type.
--     * Slot: aggregation_window Description: Window over which released values are aggregated.
--     * Slot: released_data_granularity Description: Event, interval, bin, day, participant, or other released granularity.
--     * Slot: raw_event_availability Description: Whether and where underlying raw events are available.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: DiaryProtocol Description: A versioned diary setup: item and response schemas, schedule and trigger rules, recall window, timezone behavior, and missing-response policy.
--     * Slot: diary_protocol_id Description: Stable diary-protocol identifier.
--     * Slot: diary_title Description: Source title or label of the diary instrument.
--     * Slot: diary_recall_window Description: Time interval respondents are asked to recall.
--     * Slot: diary_response_timezone Description: Timezone and day-boundary convention for prompts and responses.
--     * Slot: diary_missing_response_policy Description: Missing, late, partial, duplicate, and corrected response policy.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
-- # Class: DiaryItem Description: One source-defined diary field or question and its response contract.
--     * Slot: diary_item_id Description: Stable item identifier within the diary protocol.
--     * Slot: diary_item_name Description: Machine-readable field name.
--     * Slot: diary_prompt Description: Source wording or stable prompt reference.
--     * Slot: diary_response_kind Description: Response serialization shape.
--     * Slot: method_unit Description: Unit attached to the value.
--     * Slot: diary_required Description: Whether the instrument requires a response.
--     * Slot: diary_repeatable Description: Whether the item may occur more than once per entry.
--     * Slot: diary_anchor_event Description: Event or interval the response refers to.
--     * Slot: DiaryProtocol_diary_protocol_id Description: Autocreated FK slot
-- # Class: DiaryScheduleRule Description: One schedule, randomization, or event-contingent diary trigger.
--     * Slot: diary_schedule_rule_id Description: Stable diary-schedule rule identifier.
--     * Slot: diary_trigger_kind Description: Trigger category for this rule.
--     * Slot: requested_cadence Description: Requested observation or prompt cadence.
--     * Slot: diary_window_start Description: Earliest local or relative time at which the rule applies.
--     * Slot: diary_window_end Description: Latest local or relative time at which the rule applies.
--     * Slot: diary_max_prompts_per_day Description: Daily prompt cap when applicable.
--     * Slot: diary_randomization_policy Description: Randomization, stratification, or without-replacement rule.
--     * Slot: diary_response_timezone Description: Timezone and day-boundary convention for prompts and responses.
--     * Slot: DiaryProtocol_diary_protocol_id Description: Autocreated FK slot
-- # Class: DiarySourceAdapterReceipt Description: Exact receipt from one versioned diary source-layout adapter execution. This proves source-layout conformance only; it never upgrades a blocked diary protocol to executable.
--     * Slot: id
--     * Slot: mapping_profile_id Description: Exact released source-layout mapping profile.
--     * Slot: mapping_profile_version Description: Version of the released source-layout mapping profile.
--     * Slot: adapter_id Description: Versioned source-layout adapter identity.
--     * Slot: adapter_version Description: Exact source-layout adapter version.
--     * Slot: source_sha256 Description: SHA-256 of the source bytes accepted by the diary source adapter.
--     * Slot: normalized_sha256 Description: SHA-256 of the bytes emitted by the diary source adapter.
-- # Class: DiaryReplicationBinding Description: Content-bound selection of one Sleep Scoring diary version and released source layout. Chronicle validates this binding and its embedded shared fixture independently while preserving the full profile's blocked state.
--     * Slot: method_setting_id Description: Stable identity of one source-supported setting assertion.
--     * Slot: bridge_payload_sha256 Description: SHA-256 of the canonical generated Chronicle bridge payload.
--     * Slot: catalog_source_sha256 Description: SHA-256 identity declared by the authoritative Sleep Scoring generated diary catalog.
--     * Slot: version_definition_id Description: Exact authoritative diary version definition selected for replication.
--     * Slot: source_method_variant_id Description: Stable identity of the exact cohort, platform, protocol version, branch, or multiverse configuration represented by this profile.
--     * Slot: mapping_profile_id Description: Exact released source-layout mapping profile.
--     * Slot: mapping_profile_version Description: Version of the released source-layout mapping profile.
--     * Slot: adapter_id Description: Versioned source-layout adapter identity.
--     * Slot: adapter_version Description: Exact source-layout adapter version.
--     * Slot: fixture_id Description: Shared conformance fixture executed for this binding.
--     * Slot: fixture_input_sha256 Description: Expected and observed SHA-256 of the shared fixture input.
--     * Slot: fixture_normalized_sha256 Description: Expected and observed SHA-256 of the adapter-normalized shared fixture.
--     * Slot: profile_implementation_status Description: Whole-profile execution status; executable requires every replication gate to pass.
--     * Slot: diary_item_count Description: Number of composed diary item definitions transported for the selected version.
--     * Slot: form_element_count Description: Number of composed form elements transported for the selected version.
--     * Slot: schedule_rule_count Description: Number of composed diary schedule rules transported for the selected version.
--     * Slot: administration_schedule_count Description: Number of composed administration schedules transported for the selected version.
--     * Slot: rule_definition_count Description: Number of composed conditional or validation rules transported for the selected version.
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
--     * Slot: diary_source_adapter_receipt_id Description: Exact source-layout adapter execution receipt nested in this binding.
-- # Class: InteractionTraceRecord_source_locators
--     * Slot: InteractionTraceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: InteractionRedactionRecord_selected_element_ids
--     * Slot: InteractionRedactionRecord_id Description: Autocreated FK slot
--     * Slot: selected_element_ids Description: Supplied corresponding hierarchy elements; web elements are supplied as qualifying, not selected by an invented IoU rule.
-- # Class: InteractionRedactionRecord_source_locators
--     * Slot: InteractionRedactionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationDrawerSnapshotRecord_source_locators
--     * Slot: NotificationDrawerSnapshotRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationItemAppearanceRecord_source_locators
--     * Slot: NotificationItemAppearanceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationHistoryRecord_source_locators
--     * Slot: NotificationHistoryRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationCallbackGroupRecord_source_locators
--     * Slot: NotificationCallbackGroupRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationTitleAnnotationRecord_sender_relationship_labels
--     * Slot: NotificationTitleAnnotationRecord_id Description: Autocreated FK slot
--     * Slot: sender_relationship_labels Description: Supplied participant-relative relationship labels (Content-driven notifications p.4: work, social, family, other); multiple labels retained in supplied order, not a priority list or inferred category.
-- # Class: NotificationTitleAnnotationRecord_source_locators
--     * Slot: NotificationTitleAnnotationRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: ParticipantDayObservationRecord_aggregate_observation_references
--     * Slot: ParticipantDayObservationRecord_id Description: Autocreated FK slot
--     * Slot: aggregate_observation_references Description: Supplied support IDs on a subjective response, resolving to objective records in the same profile/participant/period kind/token. Equal day/hour token strings do not establish the same period. Null/omission is unknown support, [] explicitly empty; no category-equality or correlation is inferred.
-- # Class: ParticipantDayObservationRecord_source_locators
--     * Slot: ParticipantDayObservationRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: CrossPeriodAggregateReference_source_locators
--     * Slot: CrossPeriodAggregateReference_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationOpeningOccurrenceRecord_pending_history_references
--     * Slot: NotificationOpeningOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: pending_history_references Description: Supplied history IDs for pending items associated with the opened app or shown in the opened drawer. Positive members resolve within profile/participant/known device; omission/null is unknown, [] explicitly empty. No pending reconciliation runs.
-- # Class: NotificationOpeningOccurrenceRecord_source_locators
--     * Slot: NotificationOpeningOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationEvidenceRecord_evidence_references
--     * Slot: NotificationEvidenceRecord_id Description: Autocreated FK slot
--     * Slot: evidence_references Description: Supplied supporting evidence IDs resolved only within the owning history or callback group; optional null means unknown support and no cross-owner matching or constructor execution occurs.
-- # Class: NotificationEvidenceRecord_source_locators
--     * Slot: NotificationEvidenceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationQuestionnaireResponseRecord_source_locators
--     * Slot: NotificationQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationAcceptanceRecord_evidence_references
--     * Slot: NotificationAcceptanceRecord_id Description: Autocreated FK slot
--     * Slot: evidence_references Description: Supplied supporting evidence IDs resolved only within the owning history or callback group; optional null means unknown support and no cross-owner matching or constructor execution occurs.
-- # Class: NotificationAcceptanceRecord_questionnaire_response_references
--     * Slot: NotificationAcceptanceRecord_id Description: Autocreated FK slot
--     * Slot: questionnaire_response_references Description: Supplied supporting answer IDs resolved only within the owning history; optional null means unknown support and the clicked branch does not require an answer.
-- # Class: NotificationAcceptanceRecord_source_locators
--     * Slot: NotificationAcceptanceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DeviceUseSessionRecord_source_locators
--     * Slot: DeviceUseSessionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DeviceSessionQuestionnaireResponseRecord_support_task_action_references
--     * Slot: DeviceSessionQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: support_task_action_references Description: Optional explicitly supplied local foreground-period support for Regret2025 intention/daily-regret answers. At most one known visit; null/omission is unknown and [] explicitly empty. Repeated same-app visits remain distinct. No survey eligibility, timing or last-visit selection is inferred.
-- # Class: DeviceSessionQuestionnaireResponseRecord_source_locators
--     * Slot: DeviceSessionQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DeviceSessionLabelRecord_support_task_action_references
--     * Slot: DeviceSessionLabelRecord_id Description: Autocreated FK slot
--     * Slot: support_task_action_references Description: Optional supplied action/foreground-period IDs resolving only within the containing session. Repeated visits to the same app remain distinct by local action ID; null/omission is unknown support, [] explicitly empty. No EEG join, app matching, classifier or weighted vote runs.
-- # Class: DeviceSessionLabelRecord_questionnaire_response_references
--     * Slot: DeviceSessionLabelRecord_id Description: Autocreated FK slot
--     * Slot: questionnaire_response_references Description: Supplied supporting answer IDs resolving only within the containing device-use session; null/omission is unknown support, [] explicitly empty.
-- # Class: DeviceSessionLabelRecord_source_locators
--     * Slot: DeviceSessionLabelRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionQuantityRecord_support_task_action_references
--     * Slot: SessionQuantityRecord_id Description: Autocreated FK slot
--     * Slot: support_task_action_references Description: Optional supplied action/foreground-period IDs resolving only within the containing session, not app identity or a derived join. A→B→A retains separate visits; supports do not execute raw-to-period construction, clipping or feature calculation.
-- # Class: SessionQuantityRecord_questionnaire_response_references
--     * Slot: SessionQuantityRecord_id Description: Autocreated FK slot
--     * Slot: questionnaire_response_references Description: Optional supplied answer IDs resolving only within the containing session. Hiniker2016 Table4 retains each response-specific context row independently of unresolved displayed/collected/submitted timing; this relation is not a clock anchor. Null/omission is unknown support, [] explicitly empty.
-- # Class: SessionQuantityRecord_source_locators
--     * Slot: SessionQuantityRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: ScreenshotSessionRecord_source_locators
--     * Slot: ScreenshotSessionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionScreenshotRecord_source_locators
--     * Slot: SessionScreenshotRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: ScreenshotRangeAnnotationRecord_support_screenshot_references
--     * Slot: ScreenshotRangeAnnotationRecord_id Description: Autocreated FK slot
--     * Slot: support_screenshot_references Description: Optional ordered supplied prior-context image IDs local to the same screenshot container. Null/omission is unknown and [] explicitly empty; no missing image, timestamp, model execution or inferred previousness is reconstructed.
-- # Class: ScreenshotRangeAnnotationRecord_source_locators
--     * Slot: ScreenshotRangeAnnotationRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: AppInterruptionSessionRecord_source_locators
--     * Slot: AppInterruptionSessionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: AppSessionQuestionnaireResponseRecord_support_task_action_references
--     * Slot: AppSessionQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: support_task_action_references Description: Optional explicitly supplied owner-local actions: Chang retrospective event supports or DynamicSecurity answer-local evidence/confidence supports, resolving only within the containing TaskOccurrence. The preceding24h end-of-day event selection horizon remains a method definition; these links do not turn an event into a24h window or infer prompt time/selection. Shared answer supports do not compute confidence or recover missing case identities. Null/omission is unknown, [] explicitly empty; unrelated response carriers reject this field unless their own ingress validates it.
-- # Class: AppSessionQuestionnaireResponseRecord_source_locators
--     * Slot: AppSessionQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionInterruptionRecord_notification_history_references
--     * Slot: SessionInterruptionRecord_id Description: Autocreated FK slot
--     * Slot: notification_history_references Description: Optional explicitly supplied notification-item associations supporting this interruption, scoped to the same profile/source/participant and compatible known device. Unknown devices must not create ambiguous joins. No nearest-time selection, prior-notification matching or causal attribution is inferred.
-- # Class: SessionInterruptionRecord_visited_app_labels
--     * Slot: SessionInterruptionRecord_id Description: Autocreated FK slot
--     * Slot: visited_app_labels Description: Optional supplied ordered visited-app label list; duplicates, empty strings and unknown/empty membership retained without converting labels to packages or inferring complete timed transitions.
-- # Class: SessionInterruptionRecord_source_locators
--     * Slot: SessionInterruptionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionAssociationDatabaseRecord_source_locators
--     * Slot: SessionAssociationDatabaseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionTransactionRecord_present_app_items
--     * Slot: SessionTransactionRecord_id Description: Autocreated FK slot
--     * Slot: present_app_items Description: Explicitly supplied present app item labels/identities, not necessarily package IDs. Unlisted items are not inferred absent; supplied order is not usage order.
-- # Class: SessionTransactionRecord_absent_app_items
--     * Slot: SessionTransactionRecord_id Description: Autocreated FK slot
--     * Slot: absent_app_items Description: Explicitly supplied absent app items, distinct from omitted, unknown or unobserved items.
-- # Class: SessionTransactionRecord_source_locators
--     * Slot: SessionTransactionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: AssociationRuleRecord_antecedent_app_items
--     * Slot: AssociationRuleRecord_id Description: Autocreated FK slot
--     * Slot: antecedent_app_items Description: Supplied app items on the antecedent side; not chronological previous apps or causal triggers.
-- # Class: AssociationRuleRecord_consequent_app_items
--     * Slot: AssociationRuleRecord_id Description: Autocreated FK slot
--     * Slot: consequent_app_items Description: Supplied app items on the consequent side, independently retained from antecedent membership.
-- # Class: AssociationRuleRecord_source_locators
--     * Slot: AssociationRuleRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TaskOccurrenceRecord_source_locators
--     * Slot: TaskOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TaskActionRecord_assigned_role_labels
--     * Slot: TaskActionRecord_id Description: Autocreated FK slot
--     * Slot: assigned_role_labels Description: Optional supplied role labels relative to the containing task/session, retained in order without automatic assignment, matching, deduplication or expected-script completion.
-- # Class: TaskActionRecord_source_locators
--     * Slot: TaskActionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TaskCriterionAssessmentRecord_support_task_action_references
--     * Slot: TaskCriterionAssessmentRecord_id Description: Autocreated FK slot
--     * Slot: support_task_action_references Description: Optional supplied TaskActionRecord IDs resolving only within the containing task or session, as selected by the owning class. Null/omission is unknown support, [] explicitly empty. No matching, score calculation, temporal anchoring or cross-owner join runs.
-- # Class: TaskCriterionAssessmentRecord_support_criterion_assessment_references
--     * Slot: TaskCriterionAssessmentRecord_id Description: Autocreated FK slot
--     * Slot: support_criterion_assessment_references Description: Optional supplied supporting assessment IDs within the containing task, distinct from action IDs. Brain Disorders medRxiv2020 beginning/end PHQ-9 change names its two score assessments without inferring subtraction direction. Null/omission is unknown support, [] explicitly empty; duplicate, self and foreign references reject. These are supplied relationships, not an executed derivation DAG or array-order calculation.
-- # Class: TaskCriterionAssessmentRecord_source_locators
--     * Slot: TaskCriterionAssessmentRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TaskQuestionnaireResponseRecord_support_task_action_references
--     * Slot: TaskQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: support_task_action_references Description: Optional explicitly supplied owner-local actions: Chang retrospective event supports or DynamicSecurity answer-local evidence/confidence supports, resolving only within the containing TaskOccurrence. The preceding24h end-of-day event selection horizon remains a method definition; these links do not turn an event into a24h window or infer prompt time/selection. Shared answer supports do not compute confidence or recover missing case identities. Null/omission is unknown, [] explicitly empty; unrelated response carriers reject this field unless their own ingress validates it.
-- # Class: TaskQuestionnaireResponseRecord_source_locators
--     * Slot: TaskQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TaskObservationWindowRecord_window_setting_references
--     * Slot: TaskObservationWindowRecord_id Description: Autocreated FK slot
--     * Slot: window_setting_references Description: Nonempty unique references to compatible window/span/anchor definitions within the owning profile and source. Ambiguous sidedness remains on its source definition, not inherited from another window.
-- # Class: TaskObservationWindowRecord_questionnaire_response_references
--     * Slot: TaskObservationWindowRecord_id Description: Autocreated FK slot
--     * Slot: questionnaire_response_references Description: Supplied compared/supporting answer IDs resolving only within the containing task completion. Null/omission is unknown support, [] explicitly empty; the anchor event remains separately identified.
-- # Class: TaskObservationWindowRecord_screen_text_capture_references
--     * Slot: TaskObservationWindowRecord_id Description: Autocreated FK slot
--     * Slot: screen_text_capture_references Description: Supplied ordered Screen Text Sensor capture IDs, resolved within the same profile/source/participant and compatible known device. Null/omission is unknown membership, [] explicitly empty. The five-minute policy is anchored to questionnaire receipt, not response; no timestamp matching, sorting or text-equality deduplication is performed.
-- # Class: TaskObservationWindowRecord_source_locators
--     * Slot: TaskObservationWindowRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: AppFeatureSessionRecord_source_locators
--     * Slot: AppFeatureSessionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: AppFeatureOccurrenceRecord_source_locators
--     * Slot: AppFeatureOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionFeatureSelectionRecord_selected_feature_occurrence_references
--     * Slot: SessionFeatureSelectionRecord_id Description: Autocreated FK slot
--     * Slot: selected_feature_occurrence_references Description: Supplied submitted-answer membership, not provisional clicks: distinct occurrence IDs resolving only within the owning session. [] is explicit empty selection; null/omission is unknown. Unanswered/expired states do not assert submitted membership; SKIP's stored mapping is unknown. Selection of one same-label occurrence does not label every such occurrence.
-- # Class: SessionFeatureSelectionRecord_source_locators
--     * Slot: SessionFeatureSelectionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: ScreenTextCaptureRecord_source_locators
--     * Slot: ScreenTextCaptureRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TypingTrialRecord_keyboard_transaction_references
--     * Slot: TypingTrialRecord_id Description: Autocreated FK slot
--     * Slot: keyboard_transaction_references Description: Supplied ordered normalized action IDs in one trial, resolving to standalone same-owner keyboard transactions. [] is not a valid observed trial; no membership is inferred for unreferenced actions.
-- # Class: TypingTrialRecord_source_locators
--     * Slot: TypingTrialRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TokenEvaluationCaseRecord_source_locators
--     * Slot: TokenEvaluationCaseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TokenEvaluationVerdictRecord_questionnaire_response_references
--     * Slot: TokenEvaluationVerdictRecord_id Description: Autocreated FK slot
--     * Slot: questionnaire_response_references Description: Optional supplied answer IDs local to this token case, not a text-change case or trial questionnaire.
-- # Class: TokenEvaluationVerdictRecord_source_locators
--     * Slot: TokenEvaluationVerdictRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TextChangeCaseRecord_support_keyboard_transaction_references
--     * Slot: TextChangeCaseRecord_id Description: Autocreated FK slot
--     * Slot: support_keyboard_transaction_references Description: Optional supplied action supports resolving uniquely within the owning trial's membership; [] means explicit empty support, null/omission unknown. No boundary extraction or disjointness inferred.
-- # Class: TextChangeCaseRecord_source_locators
--     * Slot: TextChangeCaseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TextChangeVerdictRecord_questionnaire_response_references
--     * Slot: TextChangeVerdictRecord_id Description: Autocreated FK slot
--     * Slot: questionnaire_response_references Description: Optional supplied supporting answer IDs local to the case's follow-up responses; no causal or temporal inference.
-- # Class: TextChangeVerdictRecord_source_locators
--     * Slot: TextChangeVerdictRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TypingQuestionnaireResponseRecord_source_locators
--     * Slot: TypingQuestionnaireResponseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: KeyboardTransactionRecord_source_locators
--     * Slot: KeyboardTransactionRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: ScreenTextPhraseRecord_source_locators
--     * Slot: ScreenTextPhraseRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SensorControlOccurrenceRecord_source_locators
--     * Slot: SensorControlOccurrenceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SampledQuantityObservationRecord_screen_text_capture_references
--     * Slot: SampledQuantityObservationRecord_id Description: Autocreated FK slot
--     * Slot: screen_text_capture_references Description: Supplied ordered Screen Text capture membership, source-qualified and local to profile/source/participant/compatible known device. Per-screen density/sentiment admits at most one known capture, sequential phrase difference at most two, and selected-set screen counts admit independently supplied members. Null/omission/empty membership remains distinct; no timestamp selection, chronology, completeness, set arithmetic or aggregate is inferred.
-- # Class: SampledQuantityObservationRecord_source_locators
--     * Slot: SampledQuantityObservationRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SampledObservationReferenceRecord_source_locators
--     * Slot: SampledObservationReferenceRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SampledEntityMemberRecord_source_locators
--     * Slot: SampledEntityMemberRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MonthlyAppUseCellRecord_source_locators
--     * Slot: MonthlyAppUseCellRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DeviceStateObservationRecord_source_locators
--     * Slot: DeviceStateObservationRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DeviceStateIntervalRecord_source_locators
--     * Slot: DeviceStateIntervalRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: RingerStateIntervalRecord_source_locators
--     * Slot: RingerStateIntervalRecord_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: OperationDefinition_consumes
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: consumes Description: Channels or inputs the operation reads.
-- # Class: OperationDefinition_produces
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: produces Description: Channels or outputs the operation produces.
-- # Class: OperationDefinition_depends_on
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: depends_on Description: Operations that must precede this one.
-- # Class: OperationDefinition_configuration_dependencies
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: configuration_dependencies Description: Direct configuration fields read by this operation.
-- # Class: OperationDefinition_data_effects
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: data_effects Description: Declared effects such as preserve, drop, split, classify, or encode.
-- # Class: OperationDefinition_group_scope_operation_ids
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: group_scope_operation_ids_operation_id Description: Upstream operations defining enclosing partitions for a group-to-subset rule; may be transitive rather than direct dependencies. Does not establish exact group construction, ordering, ties, row lineage or execution. Source assertions remain linked through configuration_dependencies.
-- # Class: OperationDefinition_equality_key_setting_ids
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: equality_key_setting_ids_method_setting_id Description: Profile-local source field assertions compared for equality inside the enclosing partition.
-- # Class: OperationDefinition_concatenated_key_setting_ids
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: concatenated_key_setting_ids_method_setting_id Description: Ordered profile-local source field assertions concatenated without separator when grouping_basis is raw_string_concatenation. This is a sequence, not a conjunctive equality-field set; repeated operands remain meaningful.
-- # Class: OperationDefinition_empty_if_absent_key_setting_ids
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: empty_if_absent_key_setting_ids_method_setting_id Description: Subset of concatenated key operands whose absent fields contribute an empty string. Does not replace explicit null or coerce a non-string value.
-- # Class: OperationDefinition_required_event_payload_roles
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: required_event_payload_roles Description: Payloads required together within each interaction-event record produced by this operation. These are event composition, not unrelated output channels or literal serialized field names. Does not establish instance identities.
-- # Class: OperationDefinition_optional_event_payload_roles
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: optional_event_payload_roles Description: Payloads that may be absent from the produced interaction-event record, disjoint from its required payloads.
-- # Class: OperationDefinition_sequence_scope_operation_ids
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: sequence_scope_operation_ids_operation_id Description: Upstream operations defining the partitions at which sequence history resets; not a global history or an invented raw pairing algorithm.
-- # Class: OperationDefinition_sequence_identity_setting_ids
--     * Slot: OperationDefinition_operation_id Description: Autocreated FK slot
--     * Slot: sequence_identity_setting_ids_method_setting_id Description: Profile-local source assertions identifying what is compared with earlier occurrences within a partition; undisclosed raw comparison fields remain unknown.
-- # Class: QueryDefinition_query_dependencies
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: query_dependencies_query_id Description: Direct upstream physical queries.
-- # Class: QueryDefinition_realizes_operations
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: realizes_operations_operation_id Description: Semantic operations this query may realize.
-- # Class: QueryDefinition_query_outputs
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: query_outputs Description: Independently identified output artifacts or ports.
-- # Class: QueryDefinition_query_request_fields
--     * Slot: QueryDefinition_query_id Description: Autocreated FK slot
--     * Slot: query_request_fields Description: Exact request fields read by the query.
-- # Class: StudyMethodProfile_method_setting_ids
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
--     * Slot: method_setting_ids Description: Ordered inventory of embedded method-setting identities for round-trip validation.
-- # Class: StudyMethodProfile_source_locators
--     * Slot: StudyMethodProfile_method_profile_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MethodSettingAssertion_mapped_ontology_term
--     * Slot: MethodSettingAssertion_method_setting_id Description: Autocreated FK slot
--     * Slot: mapped_ontology_term Description: Existing ontology term used by the setting.
-- # Class: MethodSettingAssertion_mapped_contract_slot
--     * Slot: MethodSettingAssertion_method_setting_id Description: Autocreated FK slot
--     * Slot: mapped_contract_slot Description: Generated runtime-contract slot used when natively executable.
-- # Class: MethodSettingAssertion_required_inputs
--     * Slot: MethodSettingAssertion_method_setting_id Description: Autocreated FK slot
--     * Slot: required_inputs Description: Inputs whose exact identities or schemas are required by this setting.
-- # Class: MethodSettingAssertion_source_clause_ids
--     * Slot: MethodSettingAssertion_method_setting_id Description: Autocreated FK slot
--     * Slot: source_clause_ids Description: Stable clause identities within the source extraction that this atomic setting accounts for.
-- # Class: MethodSettingAssertion_source_locators
--     * Slot: MethodSettingAssertion_method_setting_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: LiteratureInputAdapterContract_literature_input_required_fields
--     * Slot: LiteratureInputAdapterContract_id Description: Autocreated FK slot
--     * Slot: literature_input_required_fields Description: Exact raw or support fields required for conformance.
-- # Class: LiteratureInputAdapterContract_literature_input_method_setting_ids
--     * Slot: LiteratureInputAdapterContract_id Description: Autocreated FK slot
--     * Slot: literature_input_method_setting_ids Description: Exact promoted method-setting inventory for this adapter registration.
-- # Class: ProtocolMaterializationBlocker_blocked_method_setting_ids
--     * Slot: ProtocolMaterializationBlocker_protocol_materialization_blocker_id Description: Autocreated FK slot
--     * Slot: blocked_method_setting_ids Description: Canonical method settings supporting or affected by this blocker.
-- # Class: ProtocolMaterializationBlocker_source_locators
--     * Slot: ProtocolMaterializationBlocker_protocol_materialization_blocker_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MethodConfigurationSpace_invariant_method_setting_ids
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
--     * Slot: invariant_method_setting_ids Description: Settings that apply to every selectable configuration in this space.
-- # Class: MethodConfigurationSpace_documentary_method_setting_ids
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
--     * Slot: documentary_method_setting_ids Description: Source statements retained for audit but not treated as selectable method values.
-- # Class: MethodConfigurationSpace_not_applicable_method_setting_ids
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
--     * Slot: not_applicable_method_setting_ids Description: Settings explicitly reported as not applicable to this source method.
-- # Class: MethodConfigurationSpace_unresolved_method_setting_ids
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
--     * Slot: unresolved_method_setting_ids Description: Evidence-blocked settings preventing complete configuration selection.
-- # Class: MethodConfigurationSpace_source_locators
--     * Slot: MethodConfigurationSpace_method_configuration_space_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MethodConfigurationGroup_method_configuration_axis
--     * Slot: MethodConfigurationGroup_method_configuration_group_id Description: Autocreated FK slot
--     * Slot: method_configuration_axis Description: Source-declared axes varied by this group.
-- # Class: MethodConfigurationGroup_documentary_method_setting_ids
--     * Slot: MethodConfigurationGroup_method_configuration_group_id Description: Autocreated FK slot
--     * Slot: documentary_method_setting_ids Description: Source statements retained for audit but not treated as selectable method values.
-- # Class: MethodConfigurationGroup_unresolved_method_setting_ids
--     * Slot: MethodConfigurationGroup_method_configuration_group_id Description: Autocreated FK slot
--     * Slot: unresolved_method_setting_ids Description: Evidence-blocked settings preventing complete configuration selection.
-- # Class: MethodConfigurationGroup_source_locators
--     * Slot: MethodConfigurationGroup_method_configuration_group_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MethodConfigurationLevel_included_method_setting_ids
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: included_method_setting_ids Description: Settings selected by this level or explicit combination.
-- # Class: MethodConfigurationLevel_excluded_method_setting_ids
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: excluded_method_setting_ids Description: Alternative settings explicitly excluded by this level.
-- # Class: MethodConfigurationLevel_common_method_setting_ids
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: common_method_setting_ids Description: Settings shared by every level in this group.
-- # Class: MethodConfigurationLevel_branch_method_setting_ids
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: branch_method_setting_ids Description: Settings specific to this level or branch.
-- # Class: MethodConfigurationLevel_documentary_method_setting_ids
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: documentary_method_setting_ids Description: Source statements retained for audit but not treated as selectable method values.
-- # Class: MethodConfigurationLevel_unresolved_method_setting_ids
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: unresolved_method_setting_ids Description: Evidence-blocked settings preventing complete configuration selection.
-- # Class: MethodConfigurationLevel_source_locators
--     * Slot: MethodConfigurationLevel_method_configuration_level_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MethodConfigurationCombination_selected_method_configuration_level_ids
--     * Slot: MethodConfigurationCombination_method_configuration_combination_id Description: Autocreated FK slot
--     * Slot: selected_method_configuration_level_ids Description: Exact levels included in this source-enumerated combination.
-- # Class: MethodConfigurationCombination_included_method_setting_ids
--     * Slot: MethodConfigurationCombination_method_configuration_combination_id Description: Autocreated FK slot
--     * Slot: included_method_setting_ids Description: Settings selected by this level or explicit combination.
-- # Class: MethodConfigurationCombination_source_locators
--     * Slot: MethodConfigurationCombination_method_configuration_combination_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: MethodConfigurationSelection_selected_method_configuration_level_ids
--     * Slot: MethodConfigurationSelection_method_configuration_selection_id Description: Autocreated FK slot
--     * Slot: selected_method_configuration_level_ids Description: Exact levels included in this source-enumerated combination.
-- # Class: MethodConfigurationSelection_effective_method_setting_ids
--     * Slot: MethodConfigurationSelection_method_configuration_selection_id Description: Autocreated FK slot
--     * Slot: effective_method_setting_ids Description: Exact setting inventory active under this selection.
-- # Class: MethodConfigurationSelection_method_configuration_selection_blockers
--     * Slot: MethodConfigurationSelection_method_configuration_selection_id Description: Autocreated FK slot
--     * Slot: method_configuration_selection_blockers Description: Fail-closed reasons preventing an exact selection.
-- # Class: AcquisitionProtocol_source_locators
--     * Slot: AcquisitionProtocol_acquisition_protocol_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SessionConstructionPolicy_source_locators
--     * Slot: SessionConstructionPolicy_session_construction_policy_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: NotificationAttributionPolicy_source_locators
--     * Slot: NotificationAttributionPolicy_notification_attribution_policy_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DurationPolicy_source_locators
--     * Slot: DurationPolicy_duration_policy_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: TimestampPolicy_source_locators
--     * Slot: TimestampPolicy_timestamp_policy_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: ParameterProvenanceAssertion_source_locators
--     * Slot: ParameterProvenanceAssertion_parameter_provenance_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: SourceArtifactProvenanceAssertion_provenance_keys
--     * Slot: SourceArtifactProvenanceAssertion_method_setting_id Description: Autocreated FK slot
--     * Slot: provenance_keys Description: Exact key set of the registered provenance object.
-- # Class: MeasurementReleaseProfile_collector_to_release_transformations
--     * Slot: MeasurementReleaseProfile_release_profile_id Description: Autocreated FK slot
--     * Slot: collector_to_release_transformations Description: Ordered transformations from acquisition to release.
-- # Class: MeasurementReleaseProfile_source_locators
--     * Slot: MeasurementReleaseProfile_release_profile_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DiaryProtocol_source_locators
--     * Slot: DiaryProtocol_diary_protocol_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DiaryItem_diary_allowed_values
--     * Slot: DiaryItem_diary_item_id Description: Autocreated FK slot
--     * Slot: diary_allowed_values Description: Closed response choices when applicable.
-- # Class: DiaryItem_source_locators
--     * Slot: DiaryItem_diary_item_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DiaryScheduleRule_source_locators
--     * Slot: DiaryScheduleRule_diary_schedule_rule_id Description: Autocreated FK slot
--     * Slot: source_locators Description: Source locations supporting this assertion.
-- # Class: DiarySourceAdapterReceipt_conformance_fixture_ids
--     * Slot: DiarySourceAdapterReceipt_id Description: Autocreated FK slot
--     * Slot: conformance_fixture_ids Description: Shared fixture identities registered to the exact adapter and mapping profile.
-- # Class: DiaryReplicationBinding_blocker_codes
--     * Slot: DiaryReplicationBinding_method_setting_id Description: Autocreated FK slot
--     * Slot: blocker_codes Description: Complete authoritative fail-closed reasons that keep the full diary profile non-executable.

CREATE TABLE "PlatformEventOccurrence" (
	id INTEGER NOT NULL,
	occurrence_instant TEXT,
	event_code VARCHAR(27),
	PRIMARY KEY (id)
);
CREATE INDEX "ix_PlatformEventOccurrence_id" ON "PlatformEventOccurrence" (id);

CREATE TABLE "InteractionTraceRecord" (
	id INTEGER NOT NULL,
	interaction_trace_id TEXT NOT NULL,
	trace_description TEXT,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT,
	trace_record_origin VARCHAR(27) NOT NULL,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_InteractionTraceRecord_id" ON "InteractionTraceRecord" (id);

CREATE TABLE "NotificationDrawerSnapshotRecord" (
	id INTEGER NOT NULL,
	snapshot_record_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	device_id TEXT NOT NULL,
	snapshot_record_origin VARCHAR(27) NOT NULL,
	snapshot_instant TEXT NOT NULL,
	timezone TEXT,
	android_version TEXT,
	device_model TEXT,
	device_product TEXT,
	device_manufacturer TEXT,
	snapshot_transmission_id_token TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_NotificationDrawerSnapshotRecord_id" ON "NotificationDrawerSnapshotRecord" (id);

CREATE TABLE "NotificationHistoryRecord" (
	id INTEGER NOT NULL,
	notification_history_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	history_record_origin VARCHAR(27) NOT NULL,
	notification_item_id TEXT NOT NULL,
	app_package_name TEXT,
	notification_title TEXT,
	title_annotation_reference TEXT,
	original_notification_history_reference TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_NotificationHistoryRecord_id" ON "NotificationHistoryRecord" (id);

CREATE TABLE "NotificationCallbackGroupRecord" (
	id INTEGER NOT NULL,
	callback_group_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	history_record_origin VARCHAR(27) NOT NULL,
	analytic_alert_proxy_reference TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_NotificationCallbackGroupRecord_id" ON "NotificationCallbackGroupRecord" (id);

CREATE TABLE "NotificationTitleAnnotationRecord" (
	id INTEGER NOT NULL,
	title_annotation_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	annotation_record_origin VARCHAR(27) NOT NULL,
	notification_title TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_NotificationTitleAnnotationRecord_id" ON "NotificationTitleAnnotationRecord" (id);

CREATE TABLE "ParticipantDayObservationRecord" (
	id INTEGER NOT NULL,
	day_observation_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	referenced_day_token TEXT,
	referenced_hour_token TEXT,
	referenced_night_token TEXT,
	referenced_run_token TEXT,
	method_setting_reference TEXT,
	day_record_origin VARCHAR(27) NOT NULL,
	day_observation_kind VARCHAR(21) NOT NULL,
	observed_property TEXT NOT NULL,
	observation_category TEXT,
	app_package_name TEXT,
	day_observation_value_json TEXT,
	evidence_unit TEXT,
	questionnaire_item_label TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_ParticipantDayObservationRecord_id" ON "ParticipantDayObservationRecord" (id);

CREATE TABLE "NotificationOpeningOccurrenceRecord" (
	id INTEGER NOT NULL,
	opening_occurrence_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	opening_record_origin VARCHAR(27) NOT NULL,
	opening_kind VARCHAR(14) NOT NULL,
	occurrence_instant TEXT,
	app_package_name TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_NotificationOpeningOccurrenceRecord_id" ON "NotificationOpeningOccurrenceRecord" (id);

CREATE TABLE "UsageInterval" (
	id INTEGER NOT NULL,
	start_instant TEXT,
	end_instant TEXT,
	duration_seconds FLOAT,
	start_status VARCHAR(17),
	end_status VARCHAR(17),
	PRIMARY KEY (id)
);
CREATE INDEX "ix_UsageInterval_id" ON "UsageInterval" (id);

CREATE TABLE "SessionAssociationDatabaseRecord" (
	id INTEGER NOT NULL,
	association_database_id TEXT NOT NULL,
	analysis_run_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	association_group_label TEXT,
	grouping_setting_reference TEXT,
	transaction_definition_setting_reference TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_SessionAssociationDatabaseRecord_id" ON "SessionAssociationDatabaseRecord" (id);

CREATE TABLE "ScreenTextCaptureRecord" (
	id INTEGER NOT NULL,
	text_capture_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	capture_instant TEXT,
	source_event_time_token TEXT,
	app_package_name TEXT,
	screen_text TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_ScreenTextCaptureRecord_id" ON "ScreenTextCaptureRecord" (id);

CREATE TABLE "TypingTrialRecord" (
	id INTEGER NOT NULL,
	typing_trial_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	trial_representation VARCHAR(17),
	trial_partition_setting_reference TEXT,
	trial_app_switch_setting_reference TEXT,
	trial_reset_setting_reference TEXT,
	trial_pause_setting_reference TEXT,
	trial_lifecycle_setting_reference TEXT,
	trial_schema_setting_reference TEXT,
	released_values_json TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_TypingTrialRecord_id" ON "TypingTrialRecord" (id);

CREATE TABLE "KeyboardTransactionRecord" (
	id INTEGER NOT NULL,
	keyboard_transaction_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	keyboard_schema_setting_reference TEXT NOT NULL,
	keyboard_timestamp TEXT,
	app_package_name TEXT,
	before_text TEXT,
	current_text TEXT,
	is_deleted BOOLEAN,
	is_password BOOLEAN,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_KeyboardTransactionRecord_id" ON "KeyboardTransactionRecord" (id);

CREATE TABLE "SensorControlOccurrenceRecord" (
	id INTEGER NOT NULL,
	sensor_control_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	sensor_label TEXT NOT NULL,
	sensor_control_action VARCHAR(7) NOT NULL,
	occurrence_instant TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_SensorControlOccurrenceRecord_id" ON "SensorControlOccurrenceRecord" (id);

CREATE TABLE "MonthlyAppUseCellRecord" (
	id INTEGER NOT NULL,
	cell_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	month_label TEXT NOT NULL,
	app_identifier TEXT NOT NULL,
	used_in_month INTEGER,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_MonthlyAppUseCellRecord_id" ON "MonthlyAppUseCellRecord" (id);

CREATE TABLE "DeviceStateObservationRecord" (
	id INTEGER NOT NULL,
	state_observation_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	observation_instant TEXT,
	screen_state VARCHAR(3),
	keyguard_state VARCHAR(8),
	PRIMARY KEY (id)
);
CREATE INDEX "ix_DeviceStateObservationRecord_id" ON "DeviceStateObservationRecord" (id);

CREATE TABLE "ComplianceDayAssessment" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	date DATE,
	sharing_status VARCHAR(10),
	known_minutes FLOAT,
	unknown_minutes FLOAT,
	compliance_percent FLOAT,
	compliance_value_basis VARCHAR(25),
	zero_eligible_usage BOOLEAN,
	compliance_threshold_percent FLOAT,
	meets_compliance_threshold BOOLEAN,
	expected_device_count INTEGER,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_ComplianceDayAssessment_id" ON "ComplianceDayAssessment" (id);

CREATE TABLE "DayCoverageAssessment" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	date DATE,
	day_coverage_status VARCHAR(11),
	PRIMARY KEY (id)
);
CREATE INDEX "ix_DayCoverageAssessment_id" ON "DayCoverageAssessment" (id);

CREATE TABLE "AttributionAssertion" (
	id INTEGER NOT NULL,
	attribution_status VARCHAR(16) NOT NULL,
	attributed_person TEXT,
	on_shared_device BOOLEAN,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_AttributionAssertion_id" ON "AttributionAssertion" (id);

CREATE TABLE "WorkflowPlan" (
	plan_id TEXT NOT NULL,
	PRIMARY KEY (plan_id)
);
CREATE INDEX "ix_WorkflowPlan_plan_id" ON "WorkflowPlan" (plan_id);

CREATE TABLE "ReconstructionStrategy" (
	strategy_id TEXT NOT NULL,
	strategy_kind VARCHAR(40),
	strategy_version TEXT,
	canonical_iri TEXT,
	PRIMARY KEY (strategy_id)
);
CREATE INDEX "ix_ReconstructionStrategy_strategy_id" ON "ReconstructionStrategy" (strategy_id);

CREATE TABLE "ParameterSet" (
	id INTEGER NOT NULL,
	parameter_set_sha256 TEXT,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_ParameterSet_id" ON "ParameterSet" (id);

CREATE TABLE "LiteratureInputAdapterContract" (
	id INTEGER NOT NULL,
	literature_input_semantic_type TEXT NOT NULL,
	literature_input_adapter_id TEXT NOT NULL,
	literature_input_adapter_version TEXT NOT NULL,
	literature_input_route_kind VARCHAR(25) NOT NULL,
	literature_input_role TEXT NOT NULL,
	literature_input_schema_id TEXT NOT NULL,
	literature_input_gui_surface TEXT NOT NULL,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_LiteratureInputAdapterContract_id" ON "LiteratureInputAdapterContract" (id);

CREATE TABLE "MethodConfigurationSpace" (
	method_configuration_space_id TEXT NOT NULL,
	method_configuration_structure VARCHAR(29) NOT NULL,
	PRIMARY KEY (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationSpace_method_configuration_space_id" ON "MethodConfigurationSpace" (method_configuration_space_id);

CREATE TABLE "MethodConfigurationSelection" (
	method_configuration_selection_id TEXT NOT NULL,
	method_configuration_space_reference TEXT NOT NULL,
	method_configuration_selection_status VARCHAR(10) NOT NULL,
	PRIMARY KEY (method_configuration_selection_id)
);
CREATE INDEX "ix_MethodConfigurationSelection_method_configuration_selection_id" ON "MethodConfigurationSelection" (method_configuration_selection_id);

CREATE TABLE "DiarySourceAdapterReceipt" (
	id INTEGER NOT NULL,
	mapping_profile_id TEXT NOT NULL,
	mapping_profile_version TEXT NOT NULL,
	adapter_id TEXT NOT NULL,
	adapter_version TEXT NOT NULL,
	source_sha256 TEXT NOT NULL,
	normalized_sha256 TEXT NOT NULL,
	PRIMARY KEY (id)
);
CREATE INDEX "ix_DiarySourceAdapterReceipt_id" ON "DiarySourceAdapterReceipt" (id);

CREATE TABLE "UsageEventRecord" (
	id INTEGER NOT NULL,
	event_timestamp_ns INTEGER,
	event_code VARCHAR(27),
	app_package_name TEXT,
	app_class_name TEXT,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	timezone TEXT,
	records_occurrence_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(records_occurrence_id) REFERENCES "PlatformEventOccurrence" (id)
);
CREATE INDEX "ix_UsageEventRecord_id" ON "UsageEventRecord" (id);

CREATE TABLE "InteractionEventRecord" (
	id INTEGER NOT NULL,
	interaction_event_id TEXT NOT NULL,
	screen_description TEXT,
	event_sequence_position INTEGER NOT NULL,
	screenshot_artifact_id TEXT NOT NULL,
	hierarchy_artifact_id TEXT NOT NULL,
	gesture_artifact_id TEXT,
	capture_incomplete BOOLEAN,
	human_detected_incorrect BOOLEAN,
	"InteractionTraceRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("InteractionTraceRecord_id") REFERENCES "InteractionTraceRecord" (id)
);
CREATE INDEX "ix_InteractionEventRecord_id" ON "InteractionEventRecord" (id);

CREATE TABLE "NotificationItemAppearanceRecord" (
	id INTEGER NOT NULL,
	appearance_record_id TEXT NOT NULL,
	notification_item_id TEXT NOT NULL,
	item_identity_basis VARCHAR(28) NOT NULL,
	app_package_name TEXT NOT NULL,
	notification_id_json TEXT,
	notification_tag_json TEXT,
	creation_instant TEXT,
	notification_key_token TEXT,
	post_time_identity_token TEXT,
	drawer_position INTEGER,
	priority_value_json TEXT,
	clearability_value_json TEXT,
	group_key_compat_value_json TEXT,
	group_summary_compat_value_json TEXT,
	group_key_compat_absent BOOLEAN,
	"NotificationDrawerSnapshotRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("NotificationDrawerSnapshotRecord_id") REFERENCES "NotificationDrawerSnapshotRecord" (id)
);
CREATE INDEX "ix_NotificationItemAppearanceRecord_id" ON "NotificationItemAppearanceRecord" (id);

CREATE TABLE "CrossPeriodAggregateReference" (
	id INTEGER NOT NULL,
	day_observation_id TEXT NOT NULL,
	referenced_day_token TEXT,
	referenced_hour_token TEXT,
	referenced_night_token TEXT,
	relationship_label TEXT NOT NULL,
	"ParticipantDayObservationRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("ParticipantDayObservationRecord_id") REFERENCES "ParticipantDayObservationRecord" (id)
);
CREATE INDEX "ix_CrossPeriodAggregateReference_id" ON "CrossPeriodAggregateReference" (id);

CREATE TABLE "NotificationEvidenceRecord" (
	id INTEGER NOT NULL,
	evidence_record_id TEXT NOT NULL,
	evidence_kind VARCHAR(24) NOT NULL,
	evidence_role VARCHAR(8) NOT NULL,
	evidence_instant TEXT,
	evidence_value_json TEXT,
	evidence_unit TEXT,
	evidence_basis TEXT,
	opening_occurrence_reference TEXT,
	observed_property TEXT,
	context_sampling_boundary VARCHAR(17),
	lookback TEXT,
	response_stage_id TEXT,
	response_observability VARCHAR(12),
	action_kind TEXT,
	occurrence_ordinal INTEGER,
	"NotificationHistoryRecord_id" INTEGER,
	"NotificationCallbackGroupRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("NotificationHistoryRecord_id") REFERENCES "NotificationHistoryRecord" (id),
	FOREIGN KEY("NotificationCallbackGroupRecord_id") REFERENCES "NotificationCallbackGroupRecord" (id)
);
CREATE INDEX "ix_NotificationEvidenceRecord_id" ON "NotificationEvidenceRecord" (id);

CREATE TABLE "NotificationQuestionnaireResponseRecord" (
	id INTEGER NOT NULL,
	questionnaire_response_id TEXT NOT NULL,
	questionnaire_item_label TEXT NOT NULL,
	response_value_json TEXT NOT NULL,
	"NotificationHistoryRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("NotificationHistoryRecord_id") REFERENCES "NotificationHistoryRecord" (id)
);
CREATE INDEX "ix_NotificationQuestionnaireResponseRecord_id" ON "NotificationQuestionnaireResponseRecord" (id);

CREATE TABLE "NotificationAcceptanceRecord" (
	id INTEGER NOT NULL,
	acceptance_record_id TEXT NOT NULL,
	acceptance_code INTEGER NOT NULL,
	"NotificationHistoryRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("NotificationHistoryRecord_id") REFERENCES "NotificationHistoryRecord" (id)
);
CREATE INDEX "ix_NotificationAcceptanceRecord_id" ON "NotificationAcceptanceRecord" (id);

CREATE TABLE "DeviceUseSessionRecord" (
	id INTEGER NOT NULL,
	device_use_session_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	start_condition TEXT,
	end_condition TEXT,
	following_device_use_session_reference TEXT,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_DeviceUseSessionRecord_id" ON "DeviceUseSessionRecord" (id);

CREATE TABLE "ScreenshotSessionRecord" (
	id INTEGER NOT NULL,
	screenshot_session_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	session_record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT,
	app_identifier TEXT,
	device_use_session_reference TEXT,
	session_action_reference TEXT,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_ScreenshotSessionRecord_id" ON "ScreenshotSessionRecord" (id);

CREATE TABLE "AppInterruptionSessionRecord" (
	id INTEGER NOT NULL,
	app_interruption_session_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	app_name TEXT,
	app_package_name TEXT,
	session_record_origin VARCHAR(27) NOT NULL,
	denotes_interval_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_AppInterruptionSessionRecord_id" ON "AppInterruptionSessionRecord" (id);

CREATE TABLE "SessionTransactionRecord" (
	id INTEGER NOT NULL,
	session_transaction_id TEXT NOT NULL,
	source_session_id TEXT NOT NULL,
	"SessionAssociationDatabaseRecord_id" INTEGER,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("SessionAssociationDatabaseRecord_id") REFERENCES "SessionAssociationDatabaseRecord" (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_SessionTransactionRecord_id" ON "SessionTransactionRecord" (id);

CREATE TABLE "AssociationRuleRecord" (
	id INTEGER NOT NULL,
	association_rule_id TEXT NOT NULL,
	rule_quality_values_json TEXT,
	rule_annotation_json TEXT,
	"SessionAssociationDatabaseRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("SessionAssociationDatabaseRecord_id") REFERENCES "SessionAssociationDatabaseRecord" (id)
);
CREATE INDEX "ix_AssociationRuleRecord_id" ON "AssociationRuleRecord" (id);

CREATE TABLE "TaskOccurrenceRecord" (
	id INTEGER NOT NULL,
	task_occurrence_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	assessor_id TEXT,
	history_subject_participant_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	task_label TEXT NOT NULL,
	referenced_day_token TEXT,
	device_use_session_reference TEXT,
	session_action_reference TEXT,
	interaction_trace_reference TEXT,
	expected_script_setting_reference TEXT,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_TaskOccurrenceRecord_id" ON "TaskOccurrenceRecord" (id);

CREATE TABLE "AppFeatureSessionRecord" (
	id INTEGER NOT NULL,
	feature_session_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	session_record_origin VARCHAR(27) NOT NULL,
	app_name TEXT NOT NULL,
	app_package_name TEXT,
	denotes_interval_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_AppFeatureSessionRecord_id" ON "AppFeatureSessionRecord" (id);

CREATE TABLE "TokenEvaluationCaseRecord" (
	id INTEGER NOT NULL,
	token_evaluation_case_id TEXT NOT NULL,
	token_text TEXT,
	overall_text TEXT,
	"TypingTrialRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TypingTrialRecord_id") REFERENCES "TypingTrialRecord" (id)
);
CREATE INDEX "ix_TokenEvaluationCaseRecord_id" ON "TokenEvaluationCaseRecord" (id);

CREATE TABLE "TextChangeCaseRecord" (
	id INTEGER NOT NULL,
	text_change_case_id TEXT NOT NULL,
	overall_text TEXT,
	removed_text TEXT,
	reentered_text TEXT,
	"TypingTrialRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TypingTrialRecord_id") REFERENCES "TypingTrialRecord" (id)
);
CREATE INDEX "ix_TextChangeCaseRecord_id" ON "TextChangeCaseRecord" (id);

CREATE TABLE "ScreenTextPhraseRecord" (
	id INTEGER NOT NULL,
	phrase_id TEXT NOT NULL,
	phrase_text TEXT,
	phrase_left_px FLOAT,
	phrase_top_px FLOAT,
	phrase_right_px FLOAT,
	phrase_bottom_px FLOAT,
	"ScreenTextCaptureRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("ScreenTextCaptureRecord_id") REFERENCES "ScreenTextCaptureRecord" (id)
);
CREATE INDEX "ix_ScreenTextPhraseRecord_id" ON "ScreenTextPhraseRecord" (id);

CREATE TABLE "SampledQuantityObservationRecord" (
	id INTEGER NOT NULL,
	sampled_observation_id TEXT NOT NULL,
	screenshot_session_reference TEXT,
	screenshot_record_reference TEXT,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	device_use_session_reference TEXT,
	session_action_reference TEXT,
	task_occurrence_reference TEXT,
	observed_entity_kind TEXT NOT NULL,
	observed_entity_token TEXT,
	observation_instant TEXT,
	source_event_time_token TEXT,
	root_entity_member_reference TEXT,
	app_interruption_session_reference TEXT,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_SampledQuantityObservationRecord_id" ON "SampledQuantityObservationRecord" (id);

CREATE TABLE "DeviceStateIntervalRecord" (
	id INTEGER NOT NULL,
	state_interval_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	record_origin VARCHAR(27) NOT NULL,
	method_setting_reference TEXT NOT NULL,
	interval_kind VARCHAR(23) NOT NULL,
	start_observation_ref TEXT,
	end_observation_ref TEXT,
	denotes_interval_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_DeviceStateIntervalRecord_id" ON "DeviceStateIntervalRecord" (id);

CREATE TABLE "RingerStateIntervalRecord" (
	id INTEGER NOT NULL,
	ringer_state_interval_id TEXT NOT NULL,
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	participant_id TEXT NOT NULL,
	interval_record_origin VARCHAR(27) NOT NULL,
	session_construction_policy_reference TEXT NOT NULL,
	ringer_mode VARCHAR(7) NOT NULL,
	denotes_interval_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_RingerStateIntervalRecord_id" ON "RingerStateIntervalRecord" (id);

CREATE TABLE "CoverageAssessment" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	device_id TEXT,
	expected_available BOOLEAN,
	actually_available BOOLEAN,
	availability_threshold FLOAT,
	coverage_cause VARCHAR(23),
	policy_treatment TEXT,
	assesses_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(assesses_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_CoverageAssessment_id" ON "CoverageAssessment" (id);

CREATE TABLE "QueryDefinition" (
	query_id TEXT NOT NULL,
	query_group_id TEXT NOT NULL,
	"WorkflowPlan_plan_id" TEXT,
	PRIMARY KEY (query_id),
	FOREIGN KEY("WorkflowPlan_plan_id") REFERENCES "WorkflowPlan" (plan_id)
);
CREATE INDEX "ix_QueryDefinition_query_id" ON "QueryDefinition" (query_id);

CREATE TABLE "ReconstructionExecution" (
	id INTEGER NOT NULL,
	follows_strategy TEXT,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(follows_strategy) REFERENCES "ReconstructionStrategy" (strategy_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_ReconstructionExecution_id" ON "ReconstructionExecution" (id);

CREATE TABLE "ParameterBinding" (
	id INTEGER NOT NULL,
	knob_key TEXT,
	knob_value TEXT,
	"ParameterSet_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("ParameterSet_id") REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_ParameterBinding_id" ON "ParameterBinding" (id);

CREATE TABLE "StudyMethodProfile" (
	method_profile_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	source_method_variant_id TEXT NOT NULL,
	source_method_variant_label TEXT,
	source_method_cohort TEXT,
	source_method_platform TEXT,
	source_method_branch TEXT,
	method_configuration_structure VARCHAR(29) NOT NULL,
	method_profile_version TEXT NOT NULL,
	method_setting_count INTEGER,
	profile_implementation_status VARCHAR(18) NOT NULL,
	method_configuration_space_method_configuration_space_id TEXT,
	method_configuration_selection_method_configuration_selection_id TEXT,
	PRIMARY KEY (method_profile_id),
	FOREIGN KEY(method_configuration_space_method_configuration_space_id) REFERENCES "MethodConfigurationSpace" (method_configuration_space_id),
	FOREIGN KEY(method_configuration_selection_method_configuration_selection_id) REFERENCES "MethodConfigurationSelection" (method_configuration_selection_id)
);
CREATE INDEX "ix_StudyMethodProfile_method_profile_id" ON "StudyMethodProfile" (method_profile_id);

CREATE TABLE "MethodConfigurationGroup" (
	method_configuration_group_id TEXT NOT NULL,
	method_configuration_group_kind TEXT NOT NULL,
	method_selection_semantics TEXT NOT NULL,
	method_cross_product_policy TEXT NOT NULL,
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	PRIMARY KEY (method_configuration_group_id),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationGroup_method_configuration_group_id" ON "MethodConfigurationGroup" (method_configuration_group_id);

CREATE TABLE "MethodConfigurationCombination" (
	method_configuration_combination_id TEXT NOT NULL,
	method_configuration_combination_label TEXT NOT NULL,
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	PRIMARY KEY (method_configuration_combination_id),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationCombination_method_configuration_combination_id" ON "MethodConfigurationCombination" (method_configuration_combination_id);

CREATE TABLE "InteractionTraceRecord_source_locators" (
	"InteractionTraceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("InteractionTraceRecord_id", source_locators),
	FOREIGN KEY("InteractionTraceRecord_id") REFERENCES "InteractionTraceRecord" (id)
);
CREATE INDEX "ix_InteractionTraceRecord_source_locators_source_locators" ON "InteractionTraceRecord_source_locators" (source_locators);
CREATE INDEX "ix_InteractionTraceRecord_source_locators_InteractionTraceRecord_id" ON "InteractionTraceRecord_source_locators" ("InteractionTraceRecord_id");

CREATE TABLE "NotificationDrawerSnapshotRecord_source_locators" (
	"NotificationDrawerSnapshotRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationDrawerSnapshotRecord_id", source_locators),
	FOREIGN KEY("NotificationDrawerSnapshotRecord_id") REFERENCES "NotificationDrawerSnapshotRecord" (id)
);
CREATE INDEX "ix_NotificationDrawerSnapshotRecord_source_locators_source_locators" ON "NotificationDrawerSnapshotRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationDrawerSnapshotRecord_source_locators_NotificationDrawerSnapshotRecord_id" ON "NotificationDrawerSnapshotRecord_source_locators" ("NotificationDrawerSnapshotRecord_id");

CREATE TABLE "NotificationHistoryRecord_source_locators" (
	"NotificationHistoryRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationHistoryRecord_id", source_locators),
	FOREIGN KEY("NotificationHistoryRecord_id") REFERENCES "NotificationHistoryRecord" (id)
);
CREATE INDEX "ix_NotificationHistoryRecord_source_locators_NotificationHistoryRecord_id" ON "NotificationHistoryRecord_source_locators" ("NotificationHistoryRecord_id");
CREATE INDEX "ix_NotificationHistoryRecord_source_locators_source_locators" ON "NotificationHistoryRecord_source_locators" (source_locators);

CREATE TABLE "NotificationCallbackGroupRecord_source_locators" (
	"NotificationCallbackGroupRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationCallbackGroupRecord_id", source_locators),
	FOREIGN KEY("NotificationCallbackGroupRecord_id") REFERENCES "NotificationCallbackGroupRecord" (id)
);
CREATE INDEX "ix_NotificationCallbackGroupRecord_source_locators_source_locators" ON "NotificationCallbackGroupRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationCallbackGroupRecord_source_locators_NotificationCallbackGroupRecord_id" ON "NotificationCallbackGroupRecord_source_locators" ("NotificationCallbackGroupRecord_id");

CREATE TABLE "NotificationTitleAnnotationRecord_sender_relationship_labels" (
	"NotificationTitleAnnotationRecord_id" INTEGER,
	sender_relationship_labels TEXT NOT NULL,
	PRIMARY KEY ("NotificationTitleAnnotationRecord_id", sender_relationship_labels),
	FOREIGN KEY("NotificationTitleAnnotationRecord_id") REFERENCES "NotificationTitleAnnotationRecord" (id)
);
CREATE INDEX "ix_NotificationTitleAnnotationRecord_sender_relationship_labels_sender_relationship_labels" ON "NotificationTitleAnnotationRecord_sender_relationship_labels" (sender_relationship_labels);
CREATE INDEX "ix_NotificationTitleAnnotationRecord_sender_relationship_labels_NotificationTitleAnnotationRecord_id" ON "NotificationTitleAnnotationRecord_sender_relationship_labels" ("NotificationTitleAnnotationRecord_id");

CREATE TABLE "NotificationTitleAnnotationRecord_source_locators" (
	"NotificationTitleAnnotationRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationTitleAnnotationRecord_id", source_locators),
	FOREIGN KEY("NotificationTitleAnnotationRecord_id") REFERENCES "NotificationTitleAnnotationRecord" (id)
);
CREATE INDEX "ix_NotificationTitleAnnotationRecord_source_locators_source_locators" ON "NotificationTitleAnnotationRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationTitleAnnotationRecord_source_locators_NotificationTitleAnnotationRecord_id" ON "NotificationTitleAnnotationRecord_source_locators" ("NotificationTitleAnnotationRecord_id");

CREATE TABLE "ParticipantDayObservationRecord_aggregate_observation_references" (
	"ParticipantDayObservationRecord_id" INTEGER,
	aggregate_observation_references TEXT,
	PRIMARY KEY ("ParticipantDayObservationRecord_id", aggregate_observation_references),
	FOREIGN KEY("ParticipantDayObservationRecord_id") REFERENCES "ParticipantDayObservationRecord" (id)
);
CREATE INDEX "ix_ParticipantDayObservationRecord_aggregate_observation_references_aggregate_observation_references" ON "ParticipantDayObservationRecord_aggregate_observation_references" (aggregate_observation_references);
CREATE INDEX "ix_ParticipantDayObservationRecord_aggregate_observation_references_ParticipantDayObservationRecord_id" ON "ParticipantDayObservationRecord_aggregate_observation_references" ("ParticipantDayObservationRecord_id");

CREATE TABLE "ParticipantDayObservationRecord_source_locators" (
	"ParticipantDayObservationRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("ParticipantDayObservationRecord_id", source_locators),
	FOREIGN KEY("ParticipantDayObservationRecord_id") REFERENCES "ParticipantDayObservationRecord" (id)
);
CREATE INDEX "ix_ParticipantDayObservationRecord_source_locators_source_locators" ON "ParticipantDayObservationRecord_source_locators" (source_locators);
CREATE INDEX "ix_ParticipantDayObservationRecord_source_locators_ParticipantDayObservationRecord_id" ON "ParticipantDayObservationRecord_source_locators" ("ParticipantDayObservationRecord_id");

CREATE TABLE "NotificationOpeningOccurrenceRecord_pending_history_references" (
	"NotificationOpeningOccurrenceRecord_id" INTEGER,
	pending_history_references TEXT,
	PRIMARY KEY ("NotificationOpeningOccurrenceRecord_id", pending_history_references),
	FOREIGN KEY("NotificationOpeningOccurrenceRecord_id") REFERENCES "NotificationOpeningOccurrenceRecord" (id)
);
CREATE INDEX "ix_NotificationOpeningOccurrenceRecord_pending_history_references_NotificationOpeningOccurrenceRecord_id" ON "NotificationOpeningOccurrenceRecord_pending_history_references" ("NotificationOpeningOccurrenceRecord_id");
CREATE INDEX "ix_NotificationOpeningOccurrenceRecord_pending_history_references_pending_history_references" ON "NotificationOpeningOccurrenceRecord_pending_history_references" (pending_history_references);

CREATE TABLE "NotificationOpeningOccurrenceRecord_source_locators" (
	"NotificationOpeningOccurrenceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationOpeningOccurrenceRecord_id", source_locators),
	FOREIGN KEY("NotificationOpeningOccurrenceRecord_id") REFERENCES "NotificationOpeningOccurrenceRecord" (id)
);
CREATE INDEX "ix_NotificationOpeningOccurrenceRecord_source_locators_NotificationOpeningOccurrenceRecord_id" ON "NotificationOpeningOccurrenceRecord_source_locators" ("NotificationOpeningOccurrenceRecord_id");
CREATE INDEX "ix_NotificationOpeningOccurrenceRecord_source_locators_source_locators" ON "NotificationOpeningOccurrenceRecord_source_locators" (source_locators);

CREATE TABLE "SessionAssociationDatabaseRecord_source_locators" (
	"SessionAssociationDatabaseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SessionAssociationDatabaseRecord_id", source_locators),
	FOREIGN KEY("SessionAssociationDatabaseRecord_id") REFERENCES "SessionAssociationDatabaseRecord" (id)
);
CREATE INDEX "ix_SessionAssociationDatabaseRecord_source_locators_source_locators" ON "SessionAssociationDatabaseRecord_source_locators" (source_locators);
CREATE INDEX "ix_SessionAssociationDatabaseRecord_source_locators_SessionAssociationDatabaseRecord_id" ON "SessionAssociationDatabaseRecord_source_locators" ("SessionAssociationDatabaseRecord_id");

CREATE TABLE "ScreenTextCaptureRecord_source_locators" (
	"ScreenTextCaptureRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("ScreenTextCaptureRecord_id", source_locators),
	FOREIGN KEY("ScreenTextCaptureRecord_id") REFERENCES "ScreenTextCaptureRecord" (id)
);
CREATE INDEX "ix_ScreenTextCaptureRecord_source_locators_source_locators" ON "ScreenTextCaptureRecord_source_locators" (source_locators);
CREATE INDEX "ix_ScreenTextCaptureRecord_source_locators_ScreenTextCaptureRecord_id" ON "ScreenTextCaptureRecord_source_locators" ("ScreenTextCaptureRecord_id");

CREATE TABLE "TypingTrialRecord_keyboard_transaction_references" (
	"TypingTrialRecord_id" INTEGER,
	keyboard_transaction_references TEXT,
	PRIMARY KEY ("TypingTrialRecord_id", keyboard_transaction_references),
	FOREIGN KEY("TypingTrialRecord_id") REFERENCES "TypingTrialRecord" (id)
);
CREATE INDEX "ix_TypingTrialRecord_keyboard_transaction_references_keyboard_transaction_references" ON "TypingTrialRecord_keyboard_transaction_references" (keyboard_transaction_references);
CREATE INDEX "ix_TypingTrialRecord_keyboard_transaction_references_TypingTrialRecord_id" ON "TypingTrialRecord_keyboard_transaction_references" ("TypingTrialRecord_id");

CREATE TABLE "TypingTrialRecord_source_locators" (
	"TypingTrialRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TypingTrialRecord_id", source_locators),
	FOREIGN KEY("TypingTrialRecord_id") REFERENCES "TypingTrialRecord" (id)
);
CREATE INDEX "ix_TypingTrialRecord_source_locators_source_locators" ON "TypingTrialRecord_source_locators" (source_locators);
CREATE INDEX "ix_TypingTrialRecord_source_locators_TypingTrialRecord_id" ON "TypingTrialRecord_source_locators" ("TypingTrialRecord_id");

CREATE TABLE "KeyboardTransactionRecord_source_locators" (
	"KeyboardTransactionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("KeyboardTransactionRecord_id", source_locators),
	FOREIGN KEY("KeyboardTransactionRecord_id") REFERENCES "KeyboardTransactionRecord" (id)
);
CREATE INDEX "ix_KeyboardTransactionRecord_source_locators_source_locators" ON "KeyboardTransactionRecord_source_locators" (source_locators);
CREATE INDEX "ix_KeyboardTransactionRecord_source_locators_KeyboardTransactionRecord_id" ON "KeyboardTransactionRecord_source_locators" ("KeyboardTransactionRecord_id");

CREATE TABLE "SensorControlOccurrenceRecord_source_locators" (
	"SensorControlOccurrenceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SensorControlOccurrenceRecord_id", source_locators),
	FOREIGN KEY("SensorControlOccurrenceRecord_id") REFERENCES "SensorControlOccurrenceRecord" (id)
);
CREATE INDEX "ix_SensorControlOccurrenceRecord_source_locators_source_locators" ON "SensorControlOccurrenceRecord_source_locators" (source_locators);
CREATE INDEX "ix_SensorControlOccurrenceRecord_source_locators_SensorControlOccurrenceRecord_id" ON "SensorControlOccurrenceRecord_source_locators" ("SensorControlOccurrenceRecord_id");

CREATE TABLE "MonthlyAppUseCellRecord_source_locators" (
	"MonthlyAppUseCellRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("MonthlyAppUseCellRecord_id", source_locators),
	FOREIGN KEY("MonthlyAppUseCellRecord_id") REFERENCES "MonthlyAppUseCellRecord" (id)
);
CREATE INDEX "ix_MonthlyAppUseCellRecord_source_locators_source_locators" ON "MonthlyAppUseCellRecord_source_locators" (source_locators);
CREATE INDEX "ix_MonthlyAppUseCellRecord_source_locators_MonthlyAppUseCellRecord_id" ON "MonthlyAppUseCellRecord_source_locators" ("MonthlyAppUseCellRecord_id");

CREATE TABLE "DeviceStateObservationRecord_source_locators" (
	"DeviceStateObservationRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("DeviceStateObservationRecord_id", source_locators),
	FOREIGN KEY("DeviceStateObservationRecord_id") REFERENCES "DeviceStateObservationRecord" (id)
);
CREATE INDEX "ix_DeviceStateObservationRecord_source_locators_source_locators" ON "DeviceStateObservationRecord_source_locators" (source_locators);
CREATE INDEX "ix_DeviceStateObservationRecord_source_locators_DeviceStateObservationRecord_id" ON "DeviceStateObservationRecord_source_locators" ("DeviceStateObservationRecord_id");

CREATE TABLE "LiteratureInputAdapterContract_literature_input_required_fields" (
	"LiteratureInputAdapterContract_id" INTEGER,
	literature_input_required_fields TEXT NOT NULL,
	PRIMARY KEY ("LiteratureInputAdapterContract_id", literature_input_required_fields),
	FOREIGN KEY("LiteratureInputAdapterContract_id") REFERENCES "LiteratureInputAdapterContract" (id)
);
CREATE INDEX "ix_LiteratureInputAdapterContract_literature_input_required_fields_literature_input_required_fields" ON "LiteratureInputAdapterContract_literature_input_required_fields" (literature_input_required_fields);
CREATE INDEX "ix_LiteratureInputAdapterContract_literature_input_required_fields_LiteratureInputAdapterContract_id" ON "LiteratureInputAdapterContract_literature_input_required_fields" ("LiteratureInputAdapterContract_id");

CREATE TABLE "LiteratureInputAdapterContract_literature_input_method_setting_ids" (
	"LiteratureInputAdapterContract_id" INTEGER,
	literature_input_method_setting_ids TEXT NOT NULL,
	PRIMARY KEY ("LiteratureInputAdapterContract_id", literature_input_method_setting_ids),
	FOREIGN KEY("LiteratureInputAdapterContract_id") REFERENCES "LiteratureInputAdapterContract" (id)
);
CREATE INDEX "ix_LiteratureInputAdapterContract_literature_input_method_setting_ids_literature_input_method_setting_ids" ON "LiteratureInputAdapterContract_literature_input_method_setting_ids" (literature_input_method_setting_ids);
CREATE INDEX "ix_LiteratureInputAdapterContract_literature_input_method_setting_ids_LiteratureInputAdapterContract_id" ON "LiteratureInputAdapterContract_literature_input_method_setting_ids" ("LiteratureInputAdapterContract_id");

CREATE TABLE "MethodConfigurationSpace_invariant_method_setting_ids" (
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	invariant_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationSpace_method_configuration_space_id", invariant_method_setting_ids),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationSpace_invariant_method_setting_ids_invariant_method_setting_ids" ON "MethodConfigurationSpace_invariant_method_setting_ids" (invariant_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationSpace_invariant_method_setting_ids_MethodConfigurationSpace_method_configuration_space_id" ON "MethodConfigurationSpace_invariant_method_setting_ids" ("MethodConfigurationSpace_method_configuration_space_id");

CREATE TABLE "MethodConfigurationSpace_documentary_method_setting_ids" (
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	documentary_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationSpace_method_configuration_space_id", documentary_method_setting_ids),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationSpace_documentary_method_setting_ids_documentary_method_setting_ids" ON "MethodConfigurationSpace_documentary_method_setting_ids" (documentary_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationSpace_documentary_method_setting_ids_MethodConfigurationSpace_method_configuration_space_id" ON "MethodConfigurationSpace_documentary_method_setting_ids" ("MethodConfigurationSpace_method_configuration_space_id");

CREATE TABLE "MethodConfigurationSpace_not_applicable_method_setting_ids" (
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	not_applicable_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationSpace_method_configuration_space_id", not_applicable_method_setting_ids),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationSpace_not_applicable_method_setting_ids_not_applicable_method_setting_ids" ON "MethodConfigurationSpace_not_applicable_method_setting_ids" (not_applicable_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationSpace_not_applicable_method_setting_ids_MethodConfigurationSpace_method_configuration_space_id" ON "MethodConfigurationSpace_not_applicable_method_setting_ids" ("MethodConfigurationSpace_method_configuration_space_id");

CREATE TABLE "MethodConfigurationSpace_unresolved_method_setting_ids" (
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	unresolved_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationSpace_method_configuration_space_id", unresolved_method_setting_ids),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationSpace_unresolved_method_setting_ids_MethodConfigurationSpace_method_configuration_space_id" ON "MethodConfigurationSpace_unresolved_method_setting_ids" ("MethodConfigurationSpace_method_configuration_space_id");
CREATE INDEX "ix_MethodConfigurationSpace_unresolved_method_setting_ids_unresolved_method_setting_ids" ON "MethodConfigurationSpace_unresolved_method_setting_ids" (unresolved_method_setting_ids);

CREATE TABLE "MethodConfigurationSpace_source_locators" (
	"MethodConfigurationSpace_method_configuration_space_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("MethodConfigurationSpace_method_configuration_space_id", source_locators),
	FOREIGN KEY("MethodConfigurationSpace_method_configuration_space_id") REFERENCES "MethodConfigurationSpace" (method_configuration_space_id)
);
CREATE INDEX "ix_MethodConfigurationSpace_source_locators_MethodConfigurationSpace_method_configuration_space_id" ON "MethodConfigurationSpace_source_locators" ("MethodConfigurationSpace_method_configuration_space_id");
CREATE INDEX "ix_MethodConfigurationSpace_source_locators_source_locators" ON "MethodConfigurationSpace_source_locators" (source_locators);

CREATE TABLE "MethodConfigurationSelection_selected_method_configuration_level_ids" (
	"MethodConfigurationSelection_method_configuration_selection_id" TEXT,
	selected_method_configuration_level_ids TEXT NOT NULL,
	PRIMARY KEY ("MethodConfigurationSelection_method_configuration_selection_id", selected_method_configuration_level_ids),
	FOREIGN KEY("MethodConfigurationSelection_method_configuration_selection_id") REFERENCES "MethodConfigurationSelection" (method_configuration_selection_id)
);
CREATE INDEX "ix_MethodConfigurationSelection_selected_method_configuration_level_ids_MethodConfigurationSelection_method_configuration_selection_id" ON "MethodConfigurationSelection_selected_method_configuration_level_ids" ("MethodConfigurationSelection_method_configuration_selection_id");
CREATE INDEX "ix_MethodConfigurationSelection_selected_method_configuration_level_ids_selected_method_configuration_level_ids" ON "MethodConfigurationSelection_selected_method_configuration_level_ids" (selected_method_configuration_level_ids);

CREATE TABLE "MethodConfigurationSelection_effective_method_setting_ids" (
	"MethodConfigurationSelection_method_configuration_selection_id" TEXT,
	effective_method_setting_ids TEXT NOT NULL,
	PRIMARY KEY ("MethodConfigurationSelection_method_configuration_selection_id", effective_method_setting_ids),
	FOREIGN KEY("MethodConfigurationSelection_method_configuration_selection_id") REFERENCES "MethodConfigurationSelection" (method_configuration_selection_id)
);
CREATE INDEX "ix_MethodConfigurationSelection_effective_method_setting_ids_effective_method_setting_ids" ON "MethodConfigurationSelection_effective_method_setting_ids" (effective_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationSelection_effective_method_setting_ids_MethodConfigurationSelection_method_configuration_selection_id" ON "MethodConfigurationSelection_effective_method_setting_ids" ("MethodConfigurationSelection_method_configuration_selection_id");

CREATE TABLE "MethodConfigurationSelection_method_configuration_selection_blockers" (
	"MethodConfigurationSelection_method_configuration_selection_id" TEXT,
	method_configuration_selection_blockers TEXT,
	PRIMARY KEY ("MethodConfigurationSelection_method_configuration_selection_id", method_configuration_selection_blockers),
	FOREIGN KEY("MethodConfigurationSelection_method_configuration_selection_id") REFERENCES "MethodConfigurationSelection" (method_configuration_selection_id)
);
CREATE INDEX "ix_MethodConfigurationSelection_method_configuration_selection_blockers_method_configuration_selection_blockers" ON "MethodConfigurationSelection_method_configuration_selection_blockers" (method_configuration_selection_blockers);
CREATE INDEX "ix_MethodConfigurationSelection_method_configuration_selection_blockers_MethodConfigurationSelection_method_configuration_selection_id" ON "MethodConfigurationSelection_method_configuration_selection_blockers" ("MethodConfigurationSelection_method_configuration_selection_id");

CREATE TABLE "DiarySourceAdapterReceipt_conformance_fixture_ids" (
	"DiarySourceAdapterReceipt_id" INTEGER,
	conformance_fixture_ids TEXT NOT NULL,
	PRIMARY KEY ("DiarySourceAdapterReceipt_id", conformance_fixture_ids),
	FOREIGN KEY("DiarySourceAdapterReceipt_id") REFERENCES "DiarySourceAdapterReceipt" (id)
);
CREATE INDEX "ix_DiarySourceAdapterReceipt_conformance_fixture_ids_DiarySourceAdapterReceipt_id" ON "DiarySourceAdapterReceipt_conformance_fixture_ids" ("DiarySourceAdapterReceipt_id");
CREATE INDEX "ix_DiarySourceAdapterReceipt_conformance_fixture_ids_conformance_fixture_ids" ON "DiarySourceAdapterReceipt_conformance_fixture_ids" (conformance_fixture_ids);

CREATE TABLE "LoggingObservation" (
	id INTEGER NOT NULL,
	observed_property TEXT,
	result_record_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(result_record_id) REFERENCES "UsageEventRecord" (id)
);
CREATE INDEX "ix_LoggingObservation_id" ON "LoggingObservation" (id);

CREATE TABLE "InteractionRedactionRecord" (
	id INTEGER NOT NULL,
	redaction_record_id TEXT NOT NULL,
	redaction_selection_basis VARCHAR(27) NOT NULL,
	target_region_id TEXT,
	redacted_screenshot_artifact_id TEXT NOT NULL,
	redacted_hierarchy_artifact_id TEXT NOT NULL,
	screenshot_redaction_effect VARCHAR(31) NOT NULL,
	hierarchy_redaction_effect VARCHAR(35) NOT NULL,
	redaction_justification TEXT,
	"InteractionEventRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("InteractionEventRecord_id") REFERENCES "InteractionEventRecord" (id)
);
CREATE INDEX "ix_InteractionRedactionRecord_id" ON "InteractionRedactionRecord" (id);

CREATE TABLE "DeviceSessionQuestionnaireResponseRecord" (
	id INTEGER NOT NULL,
	questionnaire_response_id TEXT NOT NULL,
	questionnaire_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	questionnaire_item_label TEXT,
	response_value_json TEXT,
	"DeviceUseSessionRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("DeviceUseSessionRecord_id") REFERENCES "DeviceUseSessionRecord" (id)
);
CREATE INDEX "ix_DeviceSessionQuestionnaireResponseRecord_id" ON "DeviceSessionQuestionnaireResponseRecord" (id);

CREATE TABLE "SessionQuantityRecord" (
	id INTEGER NOT NULL,
	quantity_record_id TEXT NOT NULL,
	quantity_setting_reference TEXT NOT NULL,
	quantity_scope TEXT NOT NULL,
	app_identifier TEXT,
	observation_category TEXT,
	start_action_reference TEXT,
	end_action_reference TEXT,
	observed_property TEXT NOT NULL,
	evidence_value_json TEXT,
	evidence_unit TEXT,
	quantity_qualifier TEXT,
	"DeviceUseSessionRecord_id" INTEGER,
	"AppInterruptionSessionRecord_id" INTEGER,
	"RingerStateIntervalRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("DeviceUseSessionRecord_id") REFERENCES "DeviceUseSessionRecord" (id),
	FOREIGN KEY("AppInterruptionSessionRecord_id") REFERENCES "AppInterruptionSessionRecord" (id),
	FOREIGN KEY("RingerStateIntervalRecord_id") REFERENCES "RingerStateIntervalRecord" (id)
);
CREATE INDEX "ix_SessionQuantityRecord_id" ON "SessionQuantityRecord" (id);

CREATE TABLE "SessionScreenshotRecord" (
	id INTEGER NOT NULL,
	screenshot_record_id TEXT NOT NULL,
	screenshot_sequence_position INTEGER,
	screenshot_instant TEXT,
	screenshot_artifact_id TEXT,
	"ScreenshotSessionRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("ScreenshotSessionRecord_id") REFERENCES "ScreenshotSessionRecord" (id)
);
CREATE INDEX "ix_SessionScreenshotRecord_id" ON "SessionScreenshotRecord" (id);

CREATE TABLE "ScreenshotRangeAnnotationRecord" (
	id INTEGER NOT NULL,
	range_annotation_id TEXT NOT NULL,
	method_setting_reference TEXT,
	assessor_id TEXT,
	first_screenshot_reference TEXT,
	last_screenshot_reference TEXT,
	range_label_values_json TEXT,
	"ScreenshotSessionRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("ScreenshotSessionRecord_id") REFERENCES "ScreenshotSessionRecord" (id)
);
CREATE INDEX "ix_ScreenshotRangeAnnotationRecord_id" ON "ScreenshotRangeAnnotationRecord" (id);

CREATE TABLE "AppSessionQuestionnaireResponseRecord" (
	id INTEGER NOT NULL,
	response_role_label TEXT,
	interruption_record_reference TEXT,
	questionnaire_response_id TEXT NOT NULL,
	questionnaire_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	questionnaire_item_label TEXT,
	response_value_json TEXT,
	assessment_case_token TEXT,
	"AppInterruptionSessionRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("AppInterruptionSessionRecord_id") REFERENCES "AppInterruptionSessionRecord" (id)
);
CREATE INDEX "ix_AppSessionQuestionnaireResponseRecord_id" ON "AppSessionQuestionnaireResponseRecord" (id);

CREATE TABLE "SessionInterruptionRecord" (
	id INTEGER NOT NULL,
	interruption_record_id TEXT NOT NULL,
	interruption_type TEXT,
	"AppInterruptionSessionRecord_id" INTEGER,
	denotes_interval_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY("AppInterruptionSessionRecord_id") REFERENCES "AppInterruptionSessionRecord" (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_SessionInterruptionRecord_id" ON "SessionInterruptionRecord" (id);

CREATE TABLE "AssociationContextItemRecord" (
	id INTEGER NOT NULL,
	context_item_label TEXT NOT NULL,
	context_dimension TEXT,
	"SessionTransactionRecord_id" INTEGER,
	"AssociationRuleRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("SessionTransactionRecord_id") REFERENCES "SessionTransactionRecord" (id),
	FOREIGN KEY("AssociationRuleRecord_id") REFERENCES "AssociationRuleRecord" (id)
);
CREATE INDEX "ix_AssociationContextItemRecord_id" ON "AssociationContextItemRecord" (id);

CREATE TABLE "TaskActionRecord" (
	id INTEGER NOT NULL,
	task_action_id TEXT NOT NULL,
	app_identifier TEXT,
	action_label TEXT,
	action_content_json TEXT,
	"DeviceUseSessionRecord_id" INTEGER,
	"AppInterruptionSessionRecord_id" INTEGER,
	"TaskOccurrenceRecord_id" INTEGER,
	"RingerStateIntervalRecord_id" INTEGER,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("DeviceUseSessionRecord_id") REFERENCES "DeviceUseSessionRecord" (id),
	FOREIGN KEY("AppInterruptionSessionRecord_id") REFERENCES "AppInterruptionSessionRecord" (id),
	FOREIGN KEY("TaskOccurrenceRecord_id") REFERENCES "TaskOccurrenceRecord" (id),
	FOREIGN KEY("RingerStateIntervalRecord_id") REFERENCES "RingerStateIntervalRecord" (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_TaskActionRecord_id" ON "TaskActionRecord" (id);

CREATE TABLE "TaskCriterionAssessmentRecord" (
	id INTEGER NOT NULL,
	criterion_assessment_id TEXT NOT NULL,
	criterion_setting_reference TEXT NOT NULL,
	criterion_label TEXT NOT NULL,
	assessment_value_json TEXT,
	assessment_content_json TEXT,
	"TaskOccurrenceRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TaskOccurrenceRecord_id") REFERENCES "TaskOccurrenceRecord" (id)
);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_id" ON "TaskCriterionAssessmentRecord" (id);

CREATE TABLE "TaskQuestionnaireResponseRecord" (
	id INTEGER NOT NULL,
	questionnaire_response_id TEXT NOT NULL,
	questionnaire_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	questionnaire_item_label TEXT,
	response_value_json TEXT,
	assessment_case_token TEXT,
	"TaskOccurrenceRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TaskOccurrenceRecord_id") REFERENCES "TaskOccurrenceRecord" (id)
);
CREATE INDEX "ix_TaskQuestionnaireResponseRecord_id" ON "TaskQuestionnaireResponseRecord" (id);

CREATE TABLE "TaskObservationWindowRecord" (
	id INTEGER NOT NULL,
	observation_window_id TEXT NOT NULL,
	anchor_task_action_reference TEXT,
	"TaskOccurrenceRecord_id" INTEGER,
	denotes_interval_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TaskOccurrenceRecord_id") REFERENCES "TaskOccurrenceRecord" (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_TaskObservationWindowRecord_id" ON "TaskObservationWindowRecord" (id);

CREATE TABLE "AppFeatureOccurrenceRecord" (
	id INTEGER NOT NULL,
	feature_occurrence_id TEXT NOT NULL,
	feature_name TEXT NOT NULL,
	"AppFeatureSessionRecord_id" INTEGER,
	denotes_interval_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY("AppFeatureSessionRecord_id") REFERENCES "AppFeatureSessionRecord" (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id)
);
CREATE INDEX "ix_AppFeatureOccurrenceRecord_id" ON "AppFeatureOccurrenceRecord" (id);

CREATE TABLE "SessionFeatureSelectionRecord" (
	id INTEGER NOT NULL,
	questionnaire_response_id TEXT NOT NULL,
	questionnaire_item_label TEXT,
	response_value_json TEXT,
	selection_response_status TEXT NOT NULL,
	"AppFeatureSessionRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("AppFeatureSessionRecord_id") REFERENCES "AppFeatureSessionRecord" (id)
);
CREATE INDEX "ix_SessionFeatureSelectionRecord_id" ON "SessionFeatureSelectionRecord" (id);

CREATE TABLE "TokenEvaluationVerdictRecord" (
	id INTEGER NOT NULL,
	label_record_id TEXT NOT NULL,
	label_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	label_value_json TEXT,
	"TokenEvaluationCaseRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TokenEvaluationCaseRecord_id") REFERENCES "TokenEvaluationCaseRecord" (id)
);
CREATE INDEX "ix_TokenEvaluationVerdictRecord_id" ON "TokenEvaluationVerdictRecord" (id);

CREATE TABLE "TextChangeVerdictRecord" (
	id INTEGER NOT NULL,
	label_record_id TEXT NOT NULL,
	label_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	label_value_json TEXT,
	"TextChangeCaseRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TextChangeCaseRecord_id") REFERENCES "TextChangeCaseRecord" (id)
);
CREATE INDEX "ix_TextChangeVerdictRecord_id" ON "TextChangeVerdictRecord" (id);

CREATE TABLE "TypingQuestionnaireResponseRecord" (
	id INTEGER NOT NULL,
	questionnaire_response_id TEXT NOT NULL,
	questionnaire_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	questionnaire_item_label TEXT,
	response_value_json TEXT,
	"TypingTrialRecord_id" INTEGER,
	"TokenEvaluationCaseRecord_id" INTEGER,
	"TextChangeCaseRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TypingTrialRecord_id") REFERENCES "TypingTrialRecord" (id),
	FOREIGN KEY("TokenEvaluationCaseRecord_id") REFERENCES "TokenEvaluationCaseRecord" (id),
	FOREIGN KEY("TextChangeCaseRecord_id") REFERENCES "TextChangeCaseRecord" (id)
);
CREATE INDEX "ix_TypingQuestionnaireResponseRecord_id" ON "TypingQuestionnaireResponseRecord" (id);

CREATE TABLE "SampledObservationReferenceRecord" (
	id INTEGER NOT NULL,
	relationship_label TEXT NOT NULL,
	sampled_observation_reference TEXT,
	"SampledQuantityObservationRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("SampledQuantityObservationRecord_id") REFERENCES "SampledQuantityObservationRecord" (id)
);
CREATE INDEX "ix_SampledObservationReferenceRecord_id" ON "SampledObservationReferenceRecord" (id);

CREATE TABLE "SampledEntityMemberRecord" (
	id INTEGER NOT NULL,
	entity_member_id TEXT NOT NULL,
	member_entity_kind TEXT NOT NULL,
	observed_entity_token TEXT,
	"SampledQuantityObservationRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("SampledQuantityObservationRecord_id") REFERENCES "SampledQuantityObservationRecord" (id)
);
CREATE INDEX "ix_SampledEntityMemberRecord_id" ON "SampledEntityMemberRecord" (id);

CREATE TABLE "UsageEpisodeAssertion" (
	id INTEGER NOT NULL,
	app_package_name TEXT,
	participant_id TEXT NOT NULL,
	measurement_layer VARCHAR(11),
	denotes_interval_id INTEGER,
	reconstructed_by_id INTEGER,
	attribution_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(reconstructed_by_id) REFERENCES "ReconstructionExecution" (id),
	FOREIGN KEY(attribution_id) REFERENCES "AttributionAssertion" (id)
);
CREATE INDEX "ix_UsageEpisodeAssertion_id" ON "UsageEpisodeAssertion" (id);

CREATE TABLE "UsageSessionAssertion" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	measurement_layer VARCHAR(11),
	denotes_interval_id INTEGER,
	reconstructed_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(reconstructed_by_id) REFERENCES "ReconstructionExecution" (id)
);
CREATE INDEX "ix_UsageSessionAssertion_id" ON "UsageSessionAssertion" (id);

CREATE TABLE "GlanceAssertion" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	measurement_layer VARCHAR(11),
	denotes_interval_id INTEGER,
	reconstructed_by_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(reconstructed_by_id) REFERENCES "ReconstructionExecution" (id)
);
CREATE INDEX "ix_GlanceAssertion_id" ON "GlanceAssertion" (id);

CREATE TABLE "ProtocolMaterializationBlocker" (
	protocol_materialization_blocker_id TEXT NOT NULL,
	protocol_materialization_id TEXT NOT NULL,
	protocol_ontology_class TEXT NOT NULL,
	protocol_profile_slot TEXT NOT NULL,
	protocol_object_attached BOOLEAN NOT NULL,
	protocol_blocker_code TEXT NOT NULL,
	protocol_blocker_field TEXT,
	protocol_blocker_reason TEXT NOT NULL,
	partial_protocol_object_json TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (protocol_materialization_blocker_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_ProtocolMaterializationBlocker_protocol_materialization_blocker_id" ON "ProtocolMaterializationBlocker" (protocol_materialization_blocker_id);

CREATE TABLE "MethodConfigurationLevel" (
	method_configuration_level_id TEXT NOT NULL,
	method_configuration_level_label TEXT NOT NULL,
	"MethodConfigurationGroup_method_configuration_group_id" TEXT,
	PRIMARY KEY (method_configuration_level_id),
	FOREIGN KEY("MethodConfigurationGroup_method_configuration_group_id") REFERENCES "MethodConfigurationGroup" (method_configuration_group_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel" (method_configuration_level_id);

CREATE TABLE "AcquisitionProtocol" (
	acquisition_protocol_id TEXT NOT NULL,
	collector TEXT,
	api_and_version TEXT,
	observation_mode TEXT,
	requested_cadence TEXT,
	realized_cadence_and_jitter TEXT,
	query_bounds TEXT,
	lookback TEXT,
	backfill TEXT,
	cursor_policy TEXT,
	overlap_policy TEXT,
	acquisition_deduplication TEXT,
	occurrence_timestamp_semantics TEXT,
	processing_timestamp_semantics TEXT,
	initial_sample_policy TEXT,
	terminal_sample_policy TEXT,
	persistence_policy TEXT,
	upload_policy TEXT,
	restart_behavior TEXT,
	doze_behavior TEXT,
	permission_loss_behavior TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (acquisition_protocol_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_AcquisitionProtocol_acquisition_protocol_id" ON "AcquisitionProtocol" (acquisition_protocol_id);

CREATE TABLE "SessionConstructionPolicy" (
	session_construction_policy_id TEXT NOT NULL,
	session_input_layer VARCHAR(29) NOT NULL,
	session_output_layer VARCHAR(29) NOT NULL,
	reconstruction_strategy TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (session_construction_policy_id),
	FOREIGN KEY(reconstruction_strategy) REFERENCES "ReconstructionStrategy" (strategy_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_SessionConstructionPolicy_session_construction_policy_id" ON "SessionConstructionPolicy" (session_construction_policy_id);

CREATE TABLE "NotificationAttributionPolicy" (
	notification_attribution_policy_id TEXT NOT NULL,
	notification_target_behavior TEXT,
	notification_evidence_mode TEXT,
	notification_temporal_direction TEXT,
	notification_window TEXT,
	method_comparator TEXT,
	notification_package_scope TEXT,
	notification_attribution_confidence TEXT,
	notification_disposition TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (notification_attribution_policy_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_NotificationAttributionPolicy_notification_attribution_policy_id" ON "NotificationAttributionPolicy" (notification_attribution_policy_id);

CREATE TABLE "DurationPolicy" (
	duration_policy_id TEXT NOT NULL,
	method_target_layer VARCHAR(29),
	method_comparator TEXT,
	method_value_json TEXT,
	method_unit TEXT,
	duration_action TEXT,
	method_boundary_convention TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (duration_policy_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_DurationPolicy_duration_policy_id" ON "DurationPolicy" (duration_policy_id);

CREATE TABLE "TimestampPolicy" (
	timestamp_policy_id TEXT NOT NULL,
	original_timestamp_semantics TEXT,
	effective_timestamp_semantics TEXT,
	timestamp_resolution TEXT,
	source_sequence_semantics TEXT,
	tie_group_semantics TEXT,
	acquisition_deduplication TEXT,
	tie_break_policy TEXT,
	synthetic_order_provenance TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (timestamp_policy_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_TimestampPolicy_timestamp_policy_id" ON "TimestampPolicy" (timestamp_policy_id);

CREATE TABLE "ParameterProvenanceAssertion" (
	parameter_provenance_id TEXT NOT NULL,
	method_parameter_key TEXT,
	method_value_json TEXT,
	derivation_type TEXT,
	documentary_support TEXT,
	inheritance TEXT,
	method_boundary_convention TEXT,
	method_target_layer VARCHAR(29),
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (parameter_provenance_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_ParameterProvenanceAssertion_parameter_provenance_id" ON "ParameterProvenanceAssertion" (parameter_provenance_id);

CREATE TABLE "SourceArtifactProvenanceAssertion" (
	source_artifact_provenance_id TEXT NOT NULL,
	method_setting_id TEXT NOT NULL,
	source_work_id TEXT NOT NULL,
	source_extraction_id TEXT NOT NULL,
	source_value_sha256 TEXT NOT NULL,
	source_artifact_provenance_object_json TEXT NOT NULL,
	source_artifact_provenance_object_digest TEXT NOT NULL,
	candidate_status TEXT NOT NULL,
	conformance_fixture_id TEXT NOT NULL,
	conformance_result_digest TEXT NOT NULL,
	execution_eligibility VARCHAR(16) NOT NULL,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (method_setting_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_SourceArtifactProvenanceAssertion_method_setting_id" ON "SourceArtifactProvenanceAssertion" (method_setting_id);

CREATE TABLE "MeasurementReleaseProfile" (
	release_profile_id TEXT NOT NULL,
	measurement_source TEXT,
	measurement_target TEXT,
	objective_metric_type TEXT,
	aggregation_window TEXT,
	released_data_granularity TEXT,
	raw_event_availability TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (release_profile_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_MeasurementReleaseProfile_release_profile_id" ON "MeasurementReleaseProfile" (release_profile_id);

CREATE TABLE "DiaryProtocol" (
	diary_protocol_id TEXT NOT NULL,
	diary_title TEXT,
	diary_recall_window TEXT,
	diary_response_timezone TEXT,
	diary_missing_response_policy TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (diary_protocol_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_DiaryProtocol_diary_protocol_id" ON "DiaryProtocol" (diary_protocol_id);

CREATE TABLE "DiaryReplicationBinding" (
	method_setting_id TEXT NOT NULL,
	bridge_payload_sha256 TEXT NOT NULL,
	catalog_source_sha256 TEXT NOT NULL,
	version_definition_id TEXT NOT NULL,
	source_method_variant_id TEXT NOT NULL,
	mapping_profile_id TEXT NOT NULL,
	mapping_profile_version TEXT NOT NULL,
	adapter_id TEXT NOT NULL,
	adapter_version TEXT NOT NULL,
	fixture_id TEXT NOT NULL,
	fixture_input_sha256 TEXT NOT NULL,
	fixture_normalized_sha256 TEXT NOT NULL,
	profile_implementation_status VARCHAR(18) NOT NULL,
	diary_item_count INTEGER NOT NULL,
	form_element_count INTEGER NOT NULL,
	schedule_rule_count INTEGER NOT NULL,
	administration_schedule_count INTEGER NOT NULL,
	rule_definition_count INTEGER NOT NULL,
	"StudyMethodProfile_method_profile_id" TEXT,
	diary_source_adapter_receipt_id INTEGER NOT NULL,
	PRIMARY KEY (method_setting_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id),
	FOREIGN KEY(diary_source_adapter_receipt_id) REFERENCES "DiarySourceAdapterReceipt" (id)
);
CREATE INDEX "ix_DiaryReplicationBinding_method_setting_id" ON "DiaryReplicationBinding" (method_setting_id);

CREATE TABLE "NotificationItemAppearanceRecord_source_locators" (
	"NotificationItemAppearanceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationItemAppearanceRecord_id", source_locators),
	FOREIGN KEY("NotificationItemAppearanceRecord_id") REFERENCES "NotificationItemAppearanceRecord" (id)
);
CREATE INDEX "ix_NotificationItemAppearanceRecord_source_locators_source_locators" ON "NotificationItemAppearanceRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationItemAppearanceRecord_source_locators_NotificationItemAppearanceRecord_id" ON "NotificationItemAppearanceRecord_source_locators" ("NotificationItemAppearanceRecord_id");

CREATE TABLE "CrossPeriodAggregateReference_source_locators" (
	"CrossPeriodAggregateReference_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("CrossPeriodAggregateReference_id", source_locators),
	FOREIGN KEY("CrossPeriodAggregateReference_id") REFERENCES "CrossPeriodAggregateReference" (id)
);
CREATE INDEX "ix_CrossPeriodAggregateReference_source_locators_source_locators" ON "CrossPeriodAggregateReference_source_locators" (source_locators);
CREATE INDEX "ix_CrossPeriodAggregateReference_source_locators_CrossPeriodAggregateReference_id" ON "CrossPeriodAggregateReference_source_locators" ("CrossPeriodAggregateReference_id");

CREATE TABLE "NotificationEvidenceRecord_evidence_references" (
	"NotificationEvidenceRecord_id" INTEGER,
	evidence_references TEXT,
	PRIMARY KEY ("NotificationEvidenceRecord_id", evidence_references),
	FOREIGN KEY("NotificationEvidenceRecord_id") REFERENCES "NotificationEvidenceRecord" (id)
);
CREATE INDEX "ix_NotificationEvidenceRecord_evidence_references_evidence_references" ON "NotificationEvidenceRecord_evidence_references" (evidence_references);
CREATE INDEX "ix_NotificationEvidenceRecord_evidence_references_NotificationEvidenceRecord_id" ON "NotificationEvidenceRecord_evidence_references" ("NotificationEvidenceRecord_id");

CREATE TABLE "NotificationEvidenceRecord_source_locators" (
	"NotificationEvidenceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationEvidenceRecord_id", source_locators),
	FOREIGN KEY("NotificationEvidenceRecord_id") REFERENCES "NotificationEvidenceRecord" (id)
);
CREATE INDEX "ix_NotificationEvidenceRecord_source_locators_source_locators" ON "NotificationEvidenceRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationEvidenceRecord_source_locators_NotificationEvidenceRecord_id" ON "NotificationEvidenceRecord_source_locators" ("NotificationEvidenceRecord_id");

CREATE TABLE "NotificationQuestionnaireResponseRecord_source_locators" (
	"NotificationQuestionnaireResponseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationQuestionnaireResponseRecord_id", source_locators),
	FOREIGN KEY("NotificationQuestionnaireResponseRecord_id") REFERENCES "NotificationQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_NotificationQuestionnaireResponseRecord_source_locators_source_locators" ON "NotificationQuestionnaireResponseRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationQuestionnaireResponseRecord_source_locators_NotificationQuestionnaireResponseRecord_id" ON "NotificationQuestionnaireResponseRecord_source_locators" ("NotificationQuestionnaireResponseRecord_id");

CREATE TABLE "NotificationAcceptanceRecord_evidence_references" (
	"NotificationAcceptanceRecord_id" INTEGER,
	evidence_references TEXT NOT NULL,
	PRIMARY KEY ("NotificationAcceptanceRecord_id", evidence_references),
	FOREIGN KEY("NotificationAcceptanceRecord_id") REFERENCES "NotificationAcceptanceRecord" (id)
);
CREATE INDEX "ix_NotificationAcceptanceRecord_evidence_references_evidence_references" ON "NotificationAcceptanceRecord_evidence_references" (evidence_references);
CREATE INDEX "ix_NotificationAcceptanceRecord_evidence_references_NotificationAcceptanceRecord_id" ON "NotificationAcceptanceRecord_evidence_references" ("NotificationAcceptanceRecord_id");

CREATE TABLE "NotificationAcceptanceRecord_questionnaire_response_references" (
	"NotificationAcceptanceRecord_id" INTEGER,
	questionnaire_response_references TEXT,
	PRIMARY KEY ("NotificationAcceptanceRecord_id", questionnaire_response_references),
	FOREIGN KEY("NotificationAcceptanceRecord_id") REFERENCES "NotificationAcceptanceRecord" (id)
);
CREATE INDEX "ix_NotificationAcceptanceRecord_questionnaire_response_references_questionnaire_response_references" ON "NotificationAcceptanceRecord_questionnaire_response_references" (questionnaire_response_references);
CREATE INDEX "ix_NotificationAcceptanceRecord_questionnaire_response_references_NotificationAcceptanceRecord_id" ON "NotificationAcceptanceRecord_questionnaire_response_references" ("NotificationAcceptanceRecord_id");

CREATE TABLE "NotificationAcceptanceRecord_source_locators" (
	"NotificationAcceptanceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("NotificationAcceptanceRecord_id", source_locators),
	FOREIGN KEY("NotificationAcceptanceRecord_id") REFERENCES "NotificationAcceptanceRecord" (id)
);
CREATE INDEX "ix_NotificationAcceptanceRecord_source_locators_source_locators" ON "NotificationAcceptanceRecord_source_locators" (source_locators);
CREATE INDEX "ix_NotificationAcceptanceRecord_source_locators_NotificationAcceptanceRecord_id" ON "NotificationAcceptanceRecord_source_locators" ("NotificationAcceptanceRecord_id");

CREATE TABLE "DeviceUseSessionRecord_source_locators" (
	"DeviceUseSessionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("DeviceUseSessionRecord_id", source_locators),
	FOREIGN KEY("DeviceUseSessionRecord_id") REFERENCES "DeviceUseSessionRecord" (id)
);
CREATE INDEX "ix_DeviceUseSessionRecord_source_locators_source_locators" ON "DeviceUseSessionRecord_source_locators" (source_locators);
CREATE INDEX "ix_DeviceUseSessionRecord_source_locators_DeviceUseSessionRecord_id" ON "DeviceUseSessionRecord_source_locators" ("DeviceUseSessionRecord_id");

CREATE TABLE "ScreenshotSessionRecord_source_locators" (
	"ScreenshotSessionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("ScreenshotSessionRecord_id", source_locators),
	FOREIGN KEY("ScreenshotSessionRecord_id") REFERENCES "ScreenshotSessionRecord" (id)
);
CREATE INDEX "ix_ScreenshotSessionRecord_source_locators_source_locators" ON "ScreenshotSessionRecord_source_locators" (source_locators);
CREATE INDEX "ix_ScreenshotSessionRecord_source_locators_ScreenshotSessionRecord_id" ON "ScreenshotSessionRecord_source_locators" ("ScreenshotSessionRecord_id");

CREATE TABLE "AppInterruptionSessionRecord_source_locators" (
	"AppInterruptionSessionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("AppInterruptionSessionRecord_id", source_locators),
	FOREIGN KEY("AppInterruptionSessionRecord_id") REFERENCES "AppInterruptionSessionRecord" (id)
);
CREATE INDEX "ix_AppInterruptionSessionRecord_source_locators_AppInterruptionSessionRecord_id" ON "AppInterruptionSessionRecord_source_locators" ("AppInterruptionSessionRecord_id");
CREATE INDEX "ix_AppInterruptionSessionRecord_source_locators_source_locators" ON "AppInterruptionSessionRecord_source_locators" (source_locators);

CREATE TABLE "SessionTransactionRecord_present_app_items" (
	"SessionTransactionRecord_id" INTEGER,
	present_app_items TEXT,
	PRIMARY KEY ("SessionTransactionRecord_id", present_app_items),
	FOREIGN KEY("SessionTransactionRecord_id") REFERENCES "SessionTransactionRecord" (id)
);
CREATE INDEX "ix_SessionTransactionRecord_present_app_items_present_app_items" ON "SessionTransactionRecord_present_app_items" (present_app_items);
CREATE INDEX "ix_SessionTransactionRecord_present_app_items_SessionTransactionRecord_id" ON "SessionTransactionRecord_present_app_items" ("SessionTransactionRecord_id");

CREATE TABLE "SessionTransactionRecord_absent_app_items" (
	"SessionTransactionRecord_id" INTEGER,
	absent_app_items TEXT,
	PRIMARY KEY ("SessionTransactionRecord_id", absent_app_items),
	FOREIGN KEY("SessionTransactionRecord_id") REFERENCES "SessionTransactionRecord" (id)
);
CREATE INDEX "ix_SessionTransactionRecord_absent_app_items_absent_app_items" ON "SessionTransactionRecord_absent_app_items" (absent_app_items);
CREATE INDEX "ix_SessionTransactionRecord_absent_app_items_SessionTransactionRecord_id" ON "SessionTransactionRecord_absent_app_items" ("SessionTransactionRecord_id");

CREATE TABLE "SessionTransactionRecord_source_locators" (
	"SessionTransactionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SessionTransactionRecord_id", source_locators),
	FOREIGN KEY("SessionTransactionRecord_id") REFERENCES "SessionTransactionRecord" (id)
);
CREATE INDEX "ix_SessionTransactionRecord_source_locators_source_locators" ON "SessionTransactionRecord_source_locators" (source_locators);
CREATE INDEX "ix_SessionTransactionRecord_source_locators_SessionTransactionRecord_id" ON "SessionTransactionRecord_source_locators" ("SessionTransactionRecord_id");

CREATE TABLE "AssociationRuleRecord_antecedent_app_items" (
	"AssociationRuleRecord_id" INTEGER,
	antecedent_app_items TEXT,
	PRIMARY KEY ("AssociationRuleRecord_id", antecedent_app_items),
	FOREIGN KEY("AssociationRuleRecord_id") REFERENCES "AssociationRuleRecord" (id)
);
CREATE INDEX "ix_AssociationRuleRecord_antecedent_app_items_antecedent_app_items" ON "AssociationRuleRecord_antecedent_app_items" (antecedent_app_items);
CREATE INDEX "ix_AssociationRuleRecord_antecedent_app_items_AssociationRuleRecord_id" ON "AssociationRuleRecord_antecedent_app_items" ("AssociationRuleRecord_id");

CREATE TABLE "AssociationRuleRecord_consequent_app_items" (
	"AssociationRuleRecord_id" INTEGER,
	consequent_app_items TEXT,
	PRIMARY KEY ("AssociationRuleRecord_id", consequent_app_items),
	FOREIGN KEY("AssociationRuleRecord_id") REFERENCES "AssociationRuleRecord" (id)
);
CREATE INDEX "ix_AssociationRuleRecord_consequent_app_items_consequent_app_items" ON "AssociationRuleRecord_consequent_app_items" (consequent_app_items);
CREATE INDEX "ix_AssociationRuleRecord_consequent_app_items_AssociationRuleRecord_id" ON "AssociationRuleRecord_consequent_app_items" ("AssociationRuleRecord_id");

CREATE TABLE "AssociationRuleRecord_source_locators" (
	"AssociationRuleRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("AssociationRuleRecord_id", source_locators),
	FOREIGN KEY("AssociationRuleRecord_id") REFERENCES "AssociationRuleRecord" (id)
);
CREATE INDEX "ix_AssociationRuleRecord_source_locators_source_locators" ON "AssociationRuleRecord_source_locators" (source_locators);
CREATE INDEX "ix_AssociationRuleRecord_source_locators_AssociationRuleRecord_id" ON "AssociationRuleRecord_source_locators" ("AssociationRuleRecord_id");

CREATE TABLE "TaskOccurrenceRecord_source_locators" (
	"TaskOccurrenceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TaskOccurrenceRecord_id", source_locators),
	FOREIGN KEY("TaskOccurrenceRecord_id") REFERENCES "TaskOccurrenceRecord" (id)
);
CREATE INDEX "ix_TaskOccurrenceRecord_source_locators_source_locators" ON "TaskOccurrenceRecord_source_locators" (source_locators);
CREATE INDEX "ix_TaskOccurrenceRecord_source_locators_TaskOccurrenceRecord_id" ON "TaskOccurrenceRecord_source_locators" ("TaskOccurrenceRecord_id");

CREATE TABLE "AppFeatureSessionRecord_source_locators" (
	"AppFeatureSessionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("AppFeatureSessionRecord_id", source_locators),
	FOREIGN KEY("AppFeatureSessionRecord_id") REFERENCES "AppFeatureSessionRecord" (id)
);
CREATE INDEX "ix_AppFeatureSessionRecord_source_locators_source_locators" ON "AppFeatureSessionRecord_source_locators" (source_locators);
CREATE INDEX "ix_AppFeatureSessionRecord_source_locators_AppFeatureSessionRecord_id" ON "AppFeatureSessionRecord_source_locators" ("AppFeatureSessionRecord_id");

CREATE TABLE "TokenEvaluationCaseRecord_source_locators" (
	"TokenEvaluationCaseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TokenEvaluationCaseRecord_id", source_locators),
	FOREIGN KEY("TokenEvaluationCaseRecord_id") REFERENCES "TokenEvaluationCaseRecord" (id)
);
CREATE INDEX "ix_TokenEvaluationCaseRecord_source_locators_source_locators" ON "TokenEvaluationCaseRecord_source_locators" (source_locators);
CREATE INDEX "ix_TokenEvaluationCaseRecord_source_locators_TokenEvaluationCaseRecord_id" ON "TokenEvaluationCaseRecord_source_locators" ("TokenEvaluationCaseRecord_id");

CREATE TABLE "TextChangeCaseRecord_support_keyboard_transaction_references" (
	"TextChangeCaseRecord_id" INTEGER,
	support_keyboard_transaction_references TEXT,
	PRIMARY KEY ("TextChangeCaseRecord_id", support_keyboard_transaction_references),
	FOREIGN KEY("TextChangeCaseRecord_id") REFERENCES "TextChangeCaseRecord" (id)
);
CREATE INDEX "ix_TextChangeCaseRecord_support_keyboard_transaction_references_support_keyboard_transaction_references" ON "TextChangeCaseRecord_support_keyboard_transaction_references" (support_keyboard_transaction_references);
CREATE INDEX "ix_TextChangeCaseRecord_support_keyboard_transaction_references_TextChangeCaseRecord_id" ON "TextChangeCaseRecord_support_keyboard_transaction_references" ("TextChangeCaseRecord_id");

CREATE TABLE "TextChangeCaseRecord_source_locators" (
	"TextChangeCaseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TextChangeCaseRecord_id", source_locators),
	FOREIGN KEY("TextChangeCaseRecord_id") REFERENCES "TextChangeCaseRecord" (id)
);
CREATE INDEX "ix_TextChangeCaseRecord_source_locators_source_locators" ON "TextChangeCaseRecord_source_locators" (source_locators);
CREATE INDEX "ix_TextChangeCaseRecord_source_locators_TextChangeCaseRecord_id" ON "TextChangeCaseRecord_source_locators" ("TextChangeCaseRecord_id");

CREATE TABLE "ScreenTextPhraseRecord_source_locators" (
	"ScreenTextPhraseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("ScreenTextPhraseRecord_id", source_locators),
	FOREIGN KEY("ScreenTextPhraseRecord_id") REFERENCES "ScreenTextPhraseRecord" (id)
);
CREATE INDEX "ix_ScreenTextPhraseRecord_source_locators_source_locators" ON "ScreenTextPhraseRecord_source_locators" (source_locators);
CREATE INDEX "ix_ScreenTextPhraseRecord_source_locators_ScreenTextPhraseRecord_id" ON "ScreenTextPhraseRecord_source_locators" ("ScreenTextPhraseRecord_id");

CREATE TABLE "SampledQuantityObservationRecord_screen_text_capture_references" (
	"SampledQuantityObservationRecord_id" INTEGER,
	screen_text_capture_references TEXT,
	PRIMARY KEY ("SampledQuantityObservationRecord_id", screen_text_capture_references),
	FOREIGN KEY("SampledQuantityObservationRecord_id") REFERENCES "SampledQuantityObservationRecord" (id)
);
CREATE INDEX "ix_SampledQuantityObservationRecord_screen_text_capture_references_screen_text_capture_references" ON "SampledQuantityObservationRecord_screen_text_capture_references" (screen_text_capture_references);
CREATE INDEX "ix_SampledQuantityObservationRecord_screen_text_capture_references_SampledQuantityObservationRecord_id" ON "SampledQuantityObservationRecord_screen_text_capture_references" ("SampledQuantityObservationRecord_id");

CREATE TABLE "SampledQuantityObservationRecord_source_locators" (
	"SampledQuantityObservationRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SampledQuantityObservationRecord_id", source_locators),
	FOREIGN KEY("SampledQuantityObservationRecord_id") REFERENCES "SampledQuantityObservationRecord" (id)
);
CREATE INDEX "ix_SampledQuantityObservationRecord_source_locators_source_locators" ON "SampledQuantityObservationRecord_source_locators" (source_locators);
CREATE INDEX "ix_SampledQuantityObservationRecord_source_locators_SampledQuantityObservationRecord_id" ON "SampledQuantityObservationRecord_source_locators" ("SampledQuantityObservationRecord_id");

CREATE TABLE "DeviceStateIntervalRecord_source_locators" (
	"DeviceStateIntervalRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("DeviceStateIntervalRecord_id", source_locators),
	FOREIGN KEY("DeviceStateIntervalRecord_id") REFERENCES "DeviceStateIntervalRecord" (id)
);
CREATE INDEX "ix_DeviceStateIntervalRecord_source_locators_source_locators" ON "DeviceStateIntervalRecord_source_locators" (source_locators);
CREATE INDEX "ix_DeviceStateIntervalRecord_source_locators_DeviceStateIntervalRecord_id" ON "DeviceStateIntervalRecord_source_locators" ("DeviceStateIntervalRecord_id");

CREATE TABLE "RingerStateIntervalRecord_source_locators" (
	"RingerStateIntervalRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("RingerStateIntervalRecord_id", source_locators),
	FOREIGN KEY("RingerStateIntervalRecord_id") REFERENCES "RingerStateIntervalRecord" (id)
);
CREATE INDEX "ix_RingerStateIntervalRecord_source_locators_source_locators" ON "RingerStateIntervalRecord_source_locators" (source_locators);
CREATE INDEX "ix_RingerStateIntervalRecord_source_locators_RingerStateIntervalRecord_id" ON "RingerStateIntervalRecord_source_locators" ("RingerStateIntervalRecord_id");

CREATE TABLE "QueryDefinition_query_dependencies" (
	"QueryDefinition_query_id" TEXT,
	query_dependencies_query_id TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", query_dependencies_query_id),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id),
	FOREIGN KEY(query_dependencies_query_id) REFERENCES "QueryDefinition" (query_id)
);
CREATE INDEX "ix_QueryDefinition_query_dependencies_query_dependencies_query_id" ON "QueryDefinition_query_dependencies" (query_dependencies_query_id);
CREATE INDEX "ix_QueryDefinition_query_dependencies_QueryDefinition_query_id" ON "QueryDefinition_query_dependencies" ("QueryDefinition_query_id");

CREATE TABLE "QueryDefinition_query_outputs" (
	"QueryDefinition_query_id" TEXT,
	query_outputs TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", query_outputs),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id)
);
CREATE INDEX "ix_QueryDefinition_query_outputs_query_outputs" ON "QueryDefinition_query_outputs" (query_outputs);
CREATE INDEX "ix_QueryDefinition_query_outputs_QueryDefinition_query_id" ON "QueryDefinition_query_outputs" ("QueryDefinition_query_id");

CREATE TABLE "QueryDefinition_query_request_fields" (
	"QueryDefinition_query_id" TEXT,
	query_request_fields TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", query_request_fields),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id)
);
CREATE INDEX "ix_QueryDefinition_query_request_fields_query_request_fields" ON "QueryDefinition_query_request_fields" (query_request_fields);
CREATE INDEX "ix_QueryDefinition_query_request_fields_QueryDefinition_query_id" ON "QueryDefinition_query_request_fields" ("QueryDefinition_query_id");

CREATE TABLE "StudyMethodProfile_method_setting_ids" (
	"StudyMethodProfile_method_profile_id" TEXT,
	method_setting_ids TEXT,
	PRIMARY KEY ("StudyMethodProfile_method_profile_id", method_setting_ids),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_StudyMethodProfile_method_setting_ids_method_setting_ids" ON "StudyMethodProfile_method_setting_ids" (method_setting_ids);
CREATE INDEX "ix_StudyMethodProfile_method_setting_ids_StudyMethodProfile_method_profile_id" ON "StudyMethodProfile_method_setting_ids" ("StudyMethodProfile_method_profile_id");

CREATE TABLE "StudyMethodProfile_source_locators" (
	"StudyMethodProfile_method_profile_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("StudyMethodProfile_method_profile_id", source_locators),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_StudyMethodProfile_source_locators_source_locators" ON "StudyMethodProfile_source_locators" (source_locators);
CREATE INDEX "ix_StudyMethodProfile_source_locators_StudyMethodProfile_method_profile_id" ON "StudyMethodProfile_source_locators" ("StudyMethodProfile_method_profile_id");

CREATE TABLE "MethodConfigurationGroup_method_configuration_axis" (
	"MethodConfigurationGroup_method_configuration_group_id" TEXT,
	method_configuration_axis TEXT,
	PRIMARY KEY ("MethodConfigurationGroup_method_configuration_group_id", method_configuration_axis),
	FOREIGN KEY("MethodConfigurationGroup_method_configuration_group_id") REFERENCES "MethodConfigurationGroup" (method_configuration_group_id)
);
CREATE INDEX "ix_MethodConfigurationGroup_method_configuration_axis_method_configuration_axis" ON "MethodConfigurationGroup_method_configuration_axis" (method_configuration_axis);
CREATE INDEX "ix_MethodConfigurationGroup_method_configuration_axis_MethodConfigurationGroup_method_configuration_group_id" ON "MethodConfigurationGroup_method_configuration_axis" ("MethodConfigurationGroup_method_configuration_group_id");

CREATE TABLE "MethodConfigurationGroup_documentary_method_setting_ids" (
	"MethodConfigurationGroup_method_configuration_group_id" TEXT,
	documentary_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationGroup_method_configuration_group_id", documentary_method_setting_ids),
	FOREIGN KEY("MethodConfigurationGroup_method_configuration_group_id") REFERENCES "MethodConfigurationGroup" (method_configuration_group_id)
);
CREATE INDEX "ix_MethodConfigurationGroup_documentary_method_setting_ids_documentary_method_setting_ids" ON "MethodConfigurationGroup_documentary_method_setting_ids" (documentary_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationGroup_documentary_method_setting_ids_MethodConfigurationGroup_method_configuration_group_id" ON "MethodConfigurationGroup_documentary_method_setting_ids" ("MethodConfigurationGroup_method_configuration_group_id");

CREATE TABLE "MethodConfigurationGroup_unresolved_method_setting_ids" (
	"MethodConfigurationGroup_method_configuration_group_id" TEXT,
	unresolved_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationGroup_method_configuration_group_id", unresolved_method_setting_ids),
	FOREIGN KEY("MethodConfigurationGroup_method_configuration_group_id") REFERENCES "MethodConfigurationGroup" (method_configuration_group_id)
);
CREATE INDEX "ix_MethodConfigurationGroup_unresolved_method_setting_ids_unresolved_method_setting_ids" ON "MethodConfigurationGroup_unresolved_method_setting_ids" (unresolved_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationGroup_unresolved_method_setting_ids_MethodConfigurationGroup_method_configuration_group_id" ON "MethodConfigurationGroup_unresolved_method_setting_ids" ("MethodConfigurationGroup_method_configuration_group_id");

CREATE TABLE "MethodConfigurationGroup_source_locators" (
	"MethodConfigurationGroup_method_configuration_group_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("MethodConfigurationGroup_method_configuration_group_id", source_locators),
	FOREIGN KEY("MethodConfigurationGroup_method_configuration_group_id") REFERENCES "MethodConfigurationGroup" (method_configuration_group_id)
);
CREATE INDEX "ix_MethodConfigurationGroup_source_locators_source_locators" ON "MethodConfigurationGroup_source_locators" (source_locators);
CREATE INDEX "ix_MethodConfigurationGroup_source_locators_MethodConfigurationGroup_method_configuration_group_id" ON "MethodConfigurationGroup_source_locators" ("MethodConfigurationGroup_method_configuration_group_id");

CREATE TABLE "MethodConfigurationCombination_selected_method_configuration_level_ids" (
	"MethodConfigurationCombination_method_configuration_combination_id" TEXT,
	selected_method_configuration_level_ids TEXT NOT NULL,
	PRIMARY KEY ("MethodConfigurationCombination_method_configuration_combination_id", selected_method_configuration_level_ids),
	FOREIGN KEY("MethodConfigurationCombination_method_configuration_combination_id") REFERENCES "MethodConfigurationCombination" (method_configuration_combination_id)
);
CREATE INDEX "ix_MethodConfigurationCombination_selected_method_configuration_level_ids_selected_method_configuration_level_ids" ON "MethodConfigurationCombination_selected_method_configuration_level_ids" (selected_method_configuration_level_ids);
CREATE INDEX "ix_MethodConfigurationCombination_selected_method_configuration_level_ids_MethodConfigurationCombination_method_configuration_combination_id" ON "MethodConfigurationCombination_selected_method_configuration_level_ids" ("MethodConfigurationCombination_method_configuration_combination_id");

CREATE TABLE "MethodConfigurationCombination_included_method_setting_ids" (
	"MethodConfigurationCombination_method_configuration_combination_id" TEXT,
	included_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationCombination_method_configuration_combination_id", included_method_setting_ids),
	FOREIGN KEY("MethodConfigurationCombination_method_configuration_combination_id") REFERENCES "MethodConfigurationCombination" (method_configuration_combination_id)
);
CREATE INDEX "ix_MethodConfigurationCombination_included_method_setting_ids_included_method_setting_ids" ON "MethodConfigurationCombination_included_method_setting_ids" (included_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationCombination_included_method_setting_ids_MethodConfigurationCombination_method_configuration_combination_id" ON "MethodConfigurationCombination_included_method_setting_ids" ("MethodConfigurationCombination_method_configuration_combination_id");

CREATE TABLE "MethodConfigurationCombination_source_locators" (
	"MethodConfigurationCombination_method_configuration_combination_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("MethodConfigurationCombination_method_configuration_combination_id", source_locators),
	FOREIGN KEY("MethodConfigurationCombination_method_configuration_combination_id") REFERENCES "MethodConfigurationCombination" (method_configuration_combination_id)
);
CREATE INDEX "ix_MethodConfigurationCombination_source_locators_source_locators" ON "MethodConfigurationCombination_source_locators" (source_locators);
CREATE INDEX "ix_MethodConfigurationCombination_source_locators_MethodConfigurationCombination_method_configuration_combination_id" ON "MethodConfigurationCombination_source_locators" ("MethodConfigurationCombination_method_configuration_combination_id");

CREATE TABLE "DeviceSessionLabelRecord" (
	id INTEGER NOT NULL,
	label_record_id TEXT NOT NULL,
	label_setting_reference TEXT NOT NULL,
	observed_property TEXT NOT NULL,
	label_value_json TEXT,
	"DeviceUseSessionRecord_id" INTEGER,
	"AppInterruptionSessionRecord_id" INTEGER,
	"SessionInterruptionRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("DeviceUseSessionRecord_id") REFERENCES "DeviceUseSessionRecord" (id),
	FOREIGN KEY("AppInterruptionSessionRecord_id") REFERENCES "AppInterruptionSessionRecord" (id),
	FOREIGN KEY("SessionInterruptionRecord_id") REFERENCES "SessionInterruptionRecord" (id)
);
CREATE INDEX "ix_DeviceSessionLabelRecord_id" ON "DeviceSessionLabelRecord" (id);

CREATE TABLE "SampledQuantityRecord" (
	id INTEGER NOT NULL,
	observed_property TEXT NOT NULL,
	evidence_value_json TEXT,
	evidence_unit TEXT,
	quantity_qualifier TEXT,
	"TaskObservationWindowRecord_id" INTEGER,
	"SampledQuantityObservationRecord_id" INTEGER,
	"SampledEntityMemberRecord_id" INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY("TaskObservationWindowRecord_id") REFERENCES "TaskObservationWindowRecord" (id),
	FOREIGN KEY("SampledQuantityObservationRecord_id") REFERENCES "SampledQuantityObservationRecord" (id),
	FOREIGN KEY("SampledEntityMemberRecord_id") REFERENCES "SampledEntityMemberRecord" (id)
);
CREATE INDEX "ix_SampledQuantityRecord_id" ON "SampledQuantityRecord" (id);

CREATE TABLE "MethodSettingAssertion" (
	method_setting_id TEXT NOT NULL,
	source_extraction_id TEXT NOT NULL,
	rubric_component_id TEXT,
	method_setting_role VARCHAR(19) NOT NULL,
	method_target_layer VARCHAR(29),
	method_parameter_key TEXT,
	method_value_kind VARCHAR(18) NOT NULL,
	method_value_json TEXT,
	method_unit TEXT,
	method_comparator TEXT,
	method_boundary_convention TEXT,
	method_applicability_status VARCHAR(14) NOT NULL,
	method_disclosure_status VARCHAR(16) NOT NULL,
	chronicle_output_kind TEXT,
	chronicle_output_column TEXT,
	source_output_position INTEGER,
	method_implementation_status VARCHAR(22) NOT NULL,
	method_execution_route VARCHAR(25),
	method_execution_destination_id TEXT,
	method_execution_parameter_path TEXT,
	method_execution_blocker_code TEXT,
	executor_id TEXT,
	source_work_id TEXT NOT NULL,
	source_evidence_work_id TEXT,
	source_component_id TEXT,
	source_observed_setting TEXT,
	source_value_json TEXT,
	source_coverage_status TEXT,
	source_clause_label TEXT,
	source_clause_text TEXT,
	source_clause_path TEXT,
	source_clause_start INTEGER,
	source_clause_end INTEGER,
	source_value_sha256 TEXT,
	method_variant_group_id TEXT,
	method_variant_relation TEXT,
	method_variant_branch_id TEXT,
	method_variant_branch_label TEXT,
	method_configuration_json TEXT,
	structured_protocol_candidate_json TEXT,
	evidence_layer TEXT,
	ontology_mapping_note TEXT,
	gap_assessment TEXT,
	integration_source TEXT,
	adjudication_confidence FLOAT,
	adjudication_rationale TEXT,
	conformance_fixture_id TEXT,
	conformance_result_digest TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	"AcquisitionProtocol_acquisition_protocol_id" TEXT,
	"SessionConstructionPolicy_session_construction_policy_id" TEXT,
	"DiaryProtocol_diary_protocol_id" TEXT,
	PRIMARY KEY (method_setting_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id),
	FOREIGN KEY("AcquisitionProtocol_acquisition_protocol_id") REFERENCES "AcquisitionProtocol" (acquisition_protocol_id),
	FOREIGN KEY("SessionConstructionPolicy_session_construction_policy_id") REFERENCES "SessionConstructionPolicy" (session_construction_policy_id),
	FOREIGN KEY("DiaryProtocol_diary_protocol_id") REFERENCES "DiaryProtocol" (diary_protocol_id)
);
CREATE INDEX "ix_MethodSettingAssertion_method_setting_id" ON "MethodSettingAssertion" (method_setting_id);

CREATE TABLE "DiaryItem" (
	diary_item_id TEXT NOT NULL,
	diary_item_name TEXT,
	diary_prompt TEXT,
	diary_response_kind VARCHAR(18) NOT NULL,
	method_unit TEXT,
	diary_required BOOLEAN,
	diary_repeatable BOOLEAN,
	diary_anchor_event TEXT,
	"DiaryProtocol_diary_protocol_id" TEXT,
	PRIMARY KEY (diary_item_id),
	FOREIGN KEY("DiaryProtocol_diary_protocol_id") REFERENCES "DiaryProtocol" (diary_protocol_id)
);
CREATE INDEX "ix_DiaryItem_diary_item_id" ON "DiaryItem" (diary_item_id);

CREATE TABLE "DiaryScheduleRule" (
	diary_schedule_rule_id TEXT NOT NULL,
	diary_trigger_kind VARCHAR(21) NOT NULL,
	requested_cadence TEXT,
	diary_window_start TEXT,
	diary_window_end TEXT,
	diary_max_prompts_per_day INTEGER,
	diary_randomization_policy TEXT,
	diary_response_timezone TEXT,
	"DiaryProtocol_diary_protocol_id" TEXT,
	PRIMARY KEY (diary_schedule_rule_id),
	FOREIGN KEY("DiaryProtocol_diary_protocol_id") REFERENCES "DiaryProtocol" (diary_protocol_id)
);
CREATE INDEX "ix_DiaryScheduleRule_diary_schedule_rule_id" ON "DiaryScheduleRule" (diary_schedule_rule_id);

CREATE TABLE "InteractionRedactionRecord_selected_element_ids" (
	"InteractionRedactionRecord_id" INTEGER,
	selected_element_ids TEXT NOT NULL,
	PRIMARY KEY ("InteractionRedactionRecord_id", selected_element_ids),
	FOREIGN KEY("InteractionRedactionRecord_id") REFERENCES "InteractionRedactionRecord" (id)
);
CREATE INDEX "ix_InteractionRedactionRecord_selected_element_ids_selected_element_ids" ON "InteractionRedactionRecord_selected_element_ids" (selected_element_ids);
CREATE INDEX "ix_InteractionRedactionRecord_selected_element_ids_InteractionRedactionRecord_id" ON "InteractionRedactionRecord_selected_element_ids" ("InteractionRedactionRecord_id");

CREATE TABLE "InteractionRedactionRecord_source_locators" (
	"InteractionRedactionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("InteractionRedactionRecord_id", source_locators),
	FOREIGN KEY("InteractionRedactionRecord_id") REFERENCES "InteractionRedactionRecord" (id)
);
CREATE INDEX "ix_InteractionRedactionRecord_source_locators_source_locators" ON "InteractionRedactionRecord_source_locators" (source_locators);
CREATE INDEX "ix_InteractionRedactionRecord_source_locators_InteractionRedactionRecord_id" ON "InteractionRedactionRecord_source_locators" ("InteractionRedactionRecord_id");

CREATE TABLE "DeviceSessionQuestionnaireResponseRecord_support_task_action_references" (
	"DeviceSessionQuestionnaireResponseRecord_id" INTEGER,
	support_task_action_references TEXT,
	PRIMARY KEY ("DeviceSessionQuestionnaireResponseRecord_id", support_task_action_references),
	FOREIGN KEY("DeviceSessionQuestionnaireResponseRecord_id") REFERENCES "DeviceSessionQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_DeviceSessionQuestionnaireResponseRecord_support_task_action_references_DeviceSessionQuestionnaireResponseRecord_id" ON "DeviceSessionQuestionnaireResponseRecord_support_task_action_references" ("DeviceSessionQuestionnaireResponseRecord_id");
CREATE INDEX "ix_DeviceSessionQuestionnaireResponseRecord_support_task_action_references_support_task_action_references" ON "DeviceSessionQuestionnaireResponseRecord_support_task_action_references" (support_task_action_references);

CREATE TABLE "DeviceSessionQuestionnaireResponseRecord_source_locators" (
	"DeviceSessionQuestionnaireResponseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("DeviceSessionQuestionnaireResponseRecord_id", source_locators),
	FOREIGN KEY("DeviceSessionQuestionnaireResponseRecord_id") REFERENCES "DeviceSessionQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_DeviceSessionQuestionnaireResponseRecord_source_locators_source_locators" ON "DeviceSessionQuestionnaireResponseRecord_source_locators" (source_locators);
CREATE INDEX "ix_DeviceSessionQuestionnaireResponseRecord_source_locators_DeviceSessionQuestionnaireResponseRecord_id" ON "DeviceSessionQuestionnaireResponseRecord_source_locators" ("DeviceSessionQuestionnaireResponseRecord_id");

CREATE TABLE "SessionQuantityRecord_support_task_action_references" (
	"SessionQuantityRecord_id" INTEGER,
	support_task_action_references TEXT,
	PRIMARY KEY ("SessionQuantityRecord_id", support_task_action_references),
	FOREIGN KEY("SessionQuantityRecord_id") REFERENCES "SessionQuantityRecord" (id)
);
CREATE INDEX "ix_SessionQuantityRecord_support_task_action_references_support_task_action_references" ON "SessionQuantityRecord_support_task_action_references" (support_task_action_references);
CREATE INDEX "ix_SessionQuantityRecord_support_task_action_references_SessionQuantityRecord_id" ON "SessionQuantityRecord_support_task_action_references" ("SessionQuantityRecord_id");

CREATE TABLE "SessionQuantityRecord_questionnaire_response_references" (
	"SessionQuantityRecord_id" INTEGER,
	questionnaire_response_references TEXT,
	PRIMARY KEY ("SessionQuantityRecord_id", questionnaire_response_references),
	FOREIGN KEY("SessionQuantityRecord_id") REFERENCES "SessionQuantityRecord" (id)
);
CREATE INDEX "ix_SessionQuantityRecord_questionnaire_response_references_questionnaire_response_references" ON "SessionQuantityRecord_questionnaire_response_references" (questionnaire_response_references);
CREATE INDEX "ix_SessionQuantityRecord_questionnaire_response_references_SessionQuantityRecord_id" ON "SessionQuantityRecord_questionnaire_response_references" ("SessionQuantityRecord_id");

CREATE TABLE "SessionQuantityRecord_source_locators" (
	"SessionQuantityRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SessionQuantityRecord_id", source_locators),
	FOREIGN KEY("SessionQuantityRecord_id") REFERENCES "SessionQuantityRecord" (id)
);
CREATE INDEX "ix_SessionQuantityRecord_source_locators_source_locators" ON "SessionQuantityRecord_source_locators" (source_locators);
CREATE INDEX "ix_SessionQuantityRecord_source_locators_SessionQuantityRecord_id" ON "SessionQuantityRecord_source_locators" ("SessionQuantityRecord_id");

CREATE TABLE "SessionScreenshotRecord_source_locators" (
	"SessionScreenshotRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SessionScreenshotRecord_id", source_locators),
	FOREIGN KEY("SessionScreenshotRecord_id") REFERENCES "SessionScreenshotRecord" (id)
);
CREATE INDEX "ix_SessionScreenshotRecord_source_locators_source_locators" ON "SessionScreenshotRecord_source_locators" (source_locators);
CREATE INDEX "ix_SessionScreenshotRecord_source_locators_SessionScreenshotRecord_id" ON "SessionScreenshotRecord_source_locators" ("SessionScreenshotRecord_id");

CREATE TABLE "ScreenshotRangeAnnotationRecord_support_screenshot_references" (
	"ScreenshotRangeAnnotationRecord_id" INTEGER,
	support_screenshot_references TEXT,
	PRIMARY KEY ("ScreenshotRangeAnnotationRecord_id", support_screenshot_references),
	FOREIGN KEY("ScreenshotRangeAnnotationRecord_id") REFERENCES "ScreenshotRangeAnnotationRecord" (id)
);
CREATE INDEX "ix_ScreenshotRangeAnnotationRecord_support_screenshot_references_ScreenshotRangeAnnotationRecord_id" ON "ScreenshotRangeAnnotationRecord_support_screenshot_references" ("ScreenshotRangeAnnotationRecord_id");
CREATE INDEX "ix_ScreenshotRangeAnnotationRecord_support_screenshot_references_support_screenshot_references" ON "ScreenshotRangeAnnotationRecord_support_screenshot_references" (support_screenshot_references);

CREATE TABLE "ScreenshotRangeAnnotationRecord_source_locators" (
	"ScreenshotRangeAnnotationRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("ScreenshotRangeAnnotationRecord_id", source_locators),
	FOREIGN KEY("ScreenshotRangeAnnotationRecord_id") REFERENCES "ScreenshotRangeAnnotationRecord" (id)
);
CREATE INDEX "ix_ScreenshotRangeAnnotationRecord_source_locators_ScreenshotRangeAnnotationRecord_id" ON "ScreenshotRangeAnnotationRecord_source_locators" ("ScreenshotRangeAnnotationRecord_id");
CREATE INDEX "ix_ScreenshotRangeAnnotationRecord_source_locators_source_locators" ON "ScreenshotRangeAnnotationRecord_source_locators" (source_locators);

CREATE TABLE "AppSessionQuestionnaireResponseRecord_support_task_action_references" (
	"AppSessionQuestionnaireResponseRecord_id" INTEGER,
	support_task_action_references TEXT,
	PRIMARY KEY ("AppSessionQuestionnaireResponseRecord_id", support_task_action_references),
	FOREIGN KEY("AppSessionQuestionnaireResponseRecord_id") REFERENCES "AppSessionQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_AppSessionQuestionnaireResponseRecord_support_task_action_references_support_task_action_references" ON "AppSessionQuestionnaireResponseRecord_support_task_action_references" (support_task_action_references);
CREATE INDEX "ix_AppSessionQuestionnaireResponseRecord_support_task_action_references_AppSessionQuestionnaireResponseRecord_id" ON "AppSessionQuestionnaireResponseRecord_support_task_action_references" ("AppSessionQuestionnaireResponseRecord_id");

CREATE TABLE "AppSessionQuestionnaireResponseRecord_source_locators" (
	"AppSessionQuestionnaireResponseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("AppSessionQuestionnaireResponseRecord_id", source_locators),
	FOREIGN KEY("AppSessionQuestionnaireResponseRecord_id") REFERENCES "AppSessionQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_AppSessionQuestionnaireResponseRecord_source_locators_source_locators" ON "AppSessionQuestionnaireResponseRecord_source_locators" (source_locators);
CREATE INDEX "ix_AppSessionQuestionnaireResponseRecord_source_locators_AppSessionQuestionnaireResponseRecord_id" ON "AppSessionQuestionnaireResponseRecord_source_locators" ("AppSessionQuestionnaireResponseRecord_id");

CREATE TABLE "SessionInterruptionRecord_notification_history_references" (
	"SessionInterruptionRecord_id" INTEGER,
	notification_history_references TEXT,
	PRIMARY KEY ("SessionInterruptionRecord_id", notification_history_references),
	FOREIGN KEY("SessionInterruptionRecord_id") REFERENCES "SessionInterruptionRecord" (id)
);
CREATE INDEX "ix_SessionInterruptionRecord_notification_history_references_notification_history_references" ON "SessionInterruptionRecord_notification_history_references" (notification_history_references);
CREATE INDEX "ix_SessionInterruptionRecord_notification_history_references_SessionInterruptionRecord_id" ON "SessionInterruptionRecord_notification_history_references" ("SessionInterruptionRecord_id");

CREATE TABLE "SessionInterruptionRecord_visited_app_labels" (
	"SessionInterruptionRecord_id" INTEGER,
	visited_app_labels TEXT,
	PRIMARY KEY ("SessionInterruptionRecord_id", visited_app_labels),
	FOREIGN KEY("SessionInterruptionRecord_id") REFERENCES "SessionInterruptionRecord" (id)
);
CREATE INDEX "ix_SessionInterruptionRecord_visited_app_labels_visited_app_labels" ON "SessionInterruptionRecord_visited_app_labels" (visited_app_labels);
CREATE INDEX "ix_SessionInterruptionRecord_visited_app_labels_SessionInterruptionRecord_id" ON "SessionInterruptionRecord_visited_app_labels" ("SessionInterruptionRecord_id");

CREATE TABLE "SessionInterruptionRecord_source_locators" (
	"SessionInterruptionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SessionInterruptionRecord_id", source_locators),
	FOREIGN KEY("SessionInterruptionRecord_id") REFERENCES "SessionInterruptionRecord" (id)
);
CREATE INDEX "ix_SessionInterruptionRecord_source_locators_source_locators" ON "SessionInterruptionRecord_source_locators" (source_locators);
CREATE INDEX "ix_SessionInterruptionRecord_source_locators_SessionInterruptionRecord_id" ON "SessionInterruptionRecord_source_locators" ("SessionInterruptionRecord_id");

CREATE TABLE "TaskActionRecord_assigned_role_labels" (
	"TaskActionRecord_id" INTEGER,
	assigned_role_labels TEXT,
	PRIMARY KEY ("TaskActionRecord_id", assigned_role_labels),
	FOREIGN KEY("TaskActionRecord_id") REFERENCES "TaskActionRecord" (id)
);
CREATE INDEX "ix_TaskActionRecord_assigned_role_labels_assigned_role_labels" ON "TaskActionRecord_assigned_role_labels" (assigned_role_labels);
CREATE INDEX "ix_TaskActionRecord_assigned_role_labels_TaskActionRecord_id" ON "TaskActionRecord_assigned_role_labels" ("TaskActionRecord_id");

CREATE TABLE "TaskActionRecord_source_locators" (
	"TaskActionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TaskActionRecord_id", source_locators),
	FOREIGN KEY("TaskActionRecord_id") REFERENCES "TaskActionRecord" (id)
);
CREATE INDEX "ix_TaskActionRecord_source_locators_source_locators" ON "TaskActionRecord_source_locators" (source_locators);
CREATE INDEX "ix_TaskActionRecord_source_locators_TaskActionRecord_id" ON "TaskActionRecord_source_locators" ("TaskActionRecord_id");

CREATE TABLE "TaskCriterionAssessmentRecord_support_task_action_references" (
	"TaskCriterionAssessmentRecord_id" INTEGER,
	support_task_action_references TEXT,
	PRIMARY KEY ("TaskCriterionAssessmentRecord_id", support_task_action_references),
	FOREIGN KEY("TaskCriterionAssessmentRecord_id") REFERENCES "TaskCriterionAssessmentRecord" (id)
);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_support_task_action_references_support_task_action_references" ON "TaskCriterionAssessmentRecord_support_task_action_references" (support_task_action_references);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_support_task_action_references_TaskCriterionAssessmentRecord_id" ON "TaskCriterionAssessmentRecord_support_task_action_references" ("TaskCriterionAssessmentRecord_id");

CREATE TABLE "TaskCriterionAssessmentRecord_support_criterion_assessment_references" (
	"TaskCriterionAssessmentRecord_id" INTEGER,
	support_criterion_assessment_references TEXT,
	PRIMARY KEY ("TaskCriterionAssessmentRecord_id", support_criterion_assessment_references),
	FOREIGN KEY("TaskCriterionAssessmentRecord_id") REFERENCES "TaskCriterionAssessmentRecord" (id)
);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_support_criterion_assessment_references_support_criterion_assessment_references" ON "TaskCriterionAssessmentRecord_support_criterion_assessment_references" (support_criterion_assessment_references);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_support_criterion_assessment_references_TaskCriterionAssessmentRecord_id" ON "TaskCriterionAssessmentRecord_support_criterion_assessment_references" ("TaskCriterionAssessmentRecord_id");

CREATE TABLE "TaskCriterionAssessmentRecord_source_locators" (
	"TaskCriterionAssessmentRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TaskCriterionAssessmentRecord_id", source_locators),
	FOREIGN KEY("TaskCriterionAssessmentRecord_id") REFERENCES "TaskCriterionAssessmentRecord" (id)
);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_source_locators_source_locators" ON "TaskCriterionAssessmentRecord_source_locators" (source_locators);
CREATE INDEX "ix_TaskCriterionAssessmentRecord_source_locators_TaskCriterionAssessmentRecord_id" ON "TaskCriterionAssessmentRecord_source_locators" ("TaskCriterionAssessmentRecord_id");

CREATE TABLE "TaskQuestionnaireResponseRecord_support_task_action_references" (
	"TaskQuestionnaireResponseRecord_id" INTEGER,
	support_task_action_references TEXT,
	PRIMARY KEY ("TaskQuestionnaireResponseRecord_id", support_task_action_references),
	FOREIGN KEY("TaskQuestionnaireResponseRecord_id") REFERENCES "TaskQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_TaskQuestionnaireResponseRecord_support_task_action_references_support_task_action_references" ON "TaskQuestionnaireResponseRecord_support_task_action_references" (support_task_action_references);
CREATE INDEX "ix_TaskQuestionnaireResponseRecord_support_task_action_references_TaskQuestionnaireResponseRecord_id" ON "TaskQuestionnaireResponseRecord_support_task_action_references" ("TaskQuestionnaireResponseRecord_id");

CREATE TABLE "TaskQuestionnaireResponseRecord_source_locators" (
	"TaskQuestionnaireResponseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TaskQuestionnaireResponseRecord_id", source_locators),
	FOREIGN KEY("TaskQuestionnaireResponseRecord_id") REFERENCES "TaskQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_TaskQuestionnaireResponseRecord_source_locators_source_locators" ON "TaskQuestionnaireResponseRecord_source_locators" (source_locators);
CREATE INDEX "ix_TaskQuestionnaireResponseRecord_source_locators_TaskQuestionnaireResponseRecord_id" ON "TaskQuestionnaireResponseRecord_source_locators" ("TaskQuestionnaireResponseRecord_id");

CREATE TABLE "TaskObservationWindowRecord_window_setting_references" (
	"TaskObservationWindowRecord_id" INTEGER,
	window_setting_references TEXT NOT NULL,
	PRIMARY KEY ("TaskObservationWindowRecord_id", window_setting_references),
	FOREIGN KEY("TaskObservationWindowRecord_id") REFERENCES "TaskObservationWindowRecord" (id)
);
CREATE INDEX "ix_TaskObservationWindowRecord_window_setting_references_window_setting_references" ON "TaskObservationWindowRecord_window_setting_references" (window_setting_references);
CREATE INDEX "ix_TaskObservationWindowRecord_window_setting_references_TaskObservationWindowRecord_id" ON "TaskObservationWindowRecord_window_setting_references" ("TaskObservationWindowRecord_id");

CREATE TABLE "TaskObservationWindowRecord_questionnaire_response_references" (
	"TaskObservationWindowRecord_id" INTEGER,
	questionnaire_response_references TEXT,
	PRIMARY KEY ("TaskObservationWindowRecord_id", questionnaire_response_references),
	FOREIGN KEY("TaskObservationWindowRecord_id") REFERENCES "TaskObservationWindowRecord" (id)
);
CREATE INDEX "ix_TaskObservationWindowRecord_questionnaire_response_references_questionnaire_response_references" ON "TaskObservationWindowRecord_questionnaire_response_references" (questionnaire_response_references);
CREATE INDEX "ix_TaskObservationWindowRecord_questionnaire_response_references_TaskObservationWindowRecord_id" ON "TaskObservationWindowRecord_questionnaire_response_references" ("TaskObservationWindowRecord_id");

CREATE TABLE "TaskObservationWindowRecord_screen_text_capture_references" (
	"TaskObservationWindowRecord_id" INTEGER,
	screen_text_capture_references TEXT,
	PRIMARY KEY ("TaskObservationWindowRecord_id", screen_text_capture_references),
	FOREIGN KEY("TaskObservationWindowRecord_id") REFERENCES "TaskObservationWindowRecord" (id)
);
CREATE INDEX "ix_TaskObservationWindowRecord_screen_text_capture_references_screen_text_capture_references" ON "TaskObservationWindowRecord_screen_text_capture_references" (screen_text_capture_references);
CREATE INDEX "ix_TaskObservationWindowRecord_screen_text_capture_references_TaskObservationWindowRecord_id" ON "TaskObservationWindowRecord_screen_text_capture_references" ("TaskObservationWindowRecord_id");

CREATE TABLE "TaskObservationWindowRecord_source_locators" (
	"TaskObservationWindowRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TaskObservationWindowRecord_id", source_locators),
	FOREIGN KEY("TaskObservationWindowRecord_id") REFERENCES "TaskObservationWindowRecord" (id)
);
CREATE INDEX "ix_TaskObservationWindowRecord_source_locators_source_locators" ON "TaskObservationWindowRecord_source_locators" (source_locators);
CREATE INDEX "ix_TaskObservationWindowRecord_source_locators_TaskObservationWindowRecord_id" ON "TaskObservationWindowRecord_source_locators" ("TaskObservationWindowRecord_id");

CREATE TABLE "AppFeatureOccurrenceRecord_source_locators" (
	"AppFeatureOccurrenceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("AppFeatureOccurrenceRecord_id", source_locators),
	FOREIGN KEY("AppFeatureOccurrenceRecord_id") REFERENCES "AppFeatureOccurrenceRecord" (id)
);
CREATE INDEX "ix_AppFeatureOccurrenceRecord_source_locators_source_locators" ON "AppFeatureOccurrenceRecord_source_locators" (source_locators);
CREATE INDEX "ix_AppFeatureOccurrenceRecord_source_locators_AppFeatureOccurrenceRecord_id" ON "AppFeatureOccurrenceRecord_source_locators" ("AppFeatureOccurrenceRecord_id");

CREATE TABLE "SessionFeatureSelectionRecord_selected_feature_occurrence_references" (
	"SessionFeatureSelectionRecord_id" INTEGER,
	selected_feature_occurrence_references TEXT,
	PRIMARY KEY ("SessionFeatureSelectionRecord_id", selected_feature_occurrence_references),
	FOREIGN KEY("SessionFeatureSelectionRecord_id") REFERENCES "SessionFeatureSelectionRecord" (id)
);
CREATE INDEX "ix_SessionFeatureSelectionRecord_selected_feature_occurrence_references_selected_feature_occurrence_references" ON "SessionFeatureSelectionRecord_selected_feature_occurrence_references" (selected_feature_occurrence_references);
CREATE INDEX "ix_SessionFeatureSelectionRecord_selected_feature_occurrence_references_SessionFeatureSelectionRecord_id" ON "SessionFeatureSelectionRecord_selected_feature_occurrence_references" ("SessionFeatureSelectionRecord_id");

CREATE TABLE "SessionFeatureSelectionRecord_source_locators" (
	"SessionFeatureSelectionRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SessionFeatureSelectionRecord_id", source_locators),
	FOREIGN KEY("SessionFeatureSelectionRecord_id") REFERENCES "SessionFeatureSelectionRecord" (id)
);
CREATE INDEX "ix_SessionFeatureSelectionRecord_source_locators_source_locators" ON "SessionFeatureSelectionRecord_source_locators" (source_locators);
CREATE INDEX "ix_SessionFeatureSelectionRecord_source_locators_SessionFeatureSelectionRecord_id" ON "SessionFeatureSelectionRecord_source_locators" ("SessionFeatureSelectionRecord_id");

CREATE TABLE "TokenEvaluationVerdictRecord_questionnaire_response_references" (
	"TokenEvaluationVerdictRecord_id" INTEGER,
	questionnaire_response_references TEXT,
	PRIMARY KEY ("TokenEvaluationVerdictRecord_id", questionnaire_response_references),
	FOREIGN KEY("TokenEvaluationVerdictRecord_id") REFERENCES "TokenEvaluationVerdictRecord" (id)
);
CREATE INDEX "ix_TokenEvaluationVerdictRecord_questionnaire_response_references_questionnaire_response_references" ON "TokenEvaluationVerdictRecord_questionnaire_response_references" (questionnaire_response_references);
CREATE INDEX "ix_TokenEvaluationVerdictRecord_questionnaire_response_references_TokenEvaluationVerdictRecord_id" ON "TokenEvaluationVerdictRecord_questionnaire_response_references" ("TokenEvaluationVerdictRecord_id");

CREATE TABLE "TokenEvaluationVerdictRecord_source_locators" (
	"TokenEvaluationVerdictRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TokenEvaluationVerdictRecord_id", source_locators),
	FOREIGN KEY("TokenEvaluationVerdictRecord_id") REFERENCES "TokenEvaluationVerdictRecord" (id)
);
CREATE INDEX "ix_TokenEvaluationVerdictRecord_source_locators_source_locators" ON "TokenEvaluationVerdictRecord_source_locators" (source_locators);
CREATE INDEX "ix_TokenEvaluationVerdictRecord_source_locators_TokenEvaluationVerdictRecord_id" ON "TokenEvaluationVerdictRecord_source_locators" ("TokenEvaluationVerdictRecord_id");

CREATE TABLE "TextChangeVerdictRecord_questionnaire_response_references" (
	"TextChangeVerdictRecord_id" INTEGER,
	questionnaire_response_references TEXT,
	PRIMARY KEY ("TextChangeVerdictRecord_id", questionnaire_response_references),
	FOREIGN KEY("TextChangeVerdictRecord_id") REFERENCES "TextChangeVerdictRecord" (id)
);
CREATE INDEX "ix_TextChangeVerdictRecord_questionnaire_response_references_questionnaire_response_references" ON "TextChangeVerdictRecord_questionnaire_response_references" (questionnaire_response_references);
CREATE INDEX "ix_TextChangeVerdictRecord_questionnaire_response_references_TextChangeVerdictRecord_id" ON "TextChangeVerdictRecord_questionnaire_response_references" ("TextChangeVerdictRecord_id");

CREATE TABLE "TextChangeVerdictRecord_source_locators" (
	"TextChangeVerdictRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TextChangeVerdictRecord_id", source_locators),
	FOREIGN KEY("TextChangeVerdictRecord_id") REFERENCES "TextChangeVerdictRecord" (id)
);
CREATE INDEX "ix_TextChangeVerdictRecord_source_locators_source_locators" ON "TextChangeVerdictRecord_source_locators" (source_locators);
CREATE INDEX "ix_TextChangeVerdictRecord_source_locators_TextChangeVerdictRecord_id" ON "TextChangeVerdictRecord_source_locators" ("TextChangeVerdictRecord_id");

CREATE TABLE "TypingQuestionnaireResponseRecord_source_locators" (
	"TypingQuestionnaireResponseRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("TypingQuestionnaireResponseRecord_id", source_locators),
	FOREIGN KEY("TypingQuestionnaireResponseRecord_id") REFERENCES "TypingQuestionnaireResponseRecord" (id)
);
CREATE INDEX "ix_TypingQuestionnaireResponseRecord_source_locators_source_locators" ON "TypingQuestionnaireResponseRecord_source_locators" (source_locators);
CREATE INDEX "ix_TypingQuestionnaireResponseRecord_source_locators_TypingQuestionnaireResponseRecord_id" ON "TypingQuestionnaireResponseRecord_source_locators" ("TypingQuestionnaireResponseRecord_id");

CREATE TABLE "SampledObservationReferenceRecord_source_locators" (
	"SampledObservationReferenceRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SampledObservationReferenceRecord_id", source_locators),
	FOREIGN KEY("SampledObservationReferenceRecord_id") REFERENCES "SampledObservationReferenceRecord" (id)
);
CREATE INDEX "ix_SampledObservationReferenceRecord_source_locators_source_locators" ON "SampledObservationReferenceRecord_source_locators" (source_locators);
CREATE INDEX "ix_SampledObservationReferenceRecord_source_locators_SampledObservationReferenceRecord_id" ON "SampledObservationReferenceRecord_source_locators" ("SampledObservationReferenceRecord_id");

CREATE TABLE "SampledEntityMemberRecord_source_locators" (
	"SampledEntityMemberRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("SampledEntityMemberRecord_id", source_locators),
	FOREIGN KEY("SampledEntityMemberRecord_id") REFERENCES "SampledEntityMemberRecord" (id)
);
CREATE INDEX "ix_SampledEntityMemberRecord_source_locators_source_locators" ON "SampledEntityMemberRecord_source_locators" (source_locators);
CREATE INDEX "ix_SampledEntityMemberRecord_source_locators_SampledEntityMemberRecord_id" ON "SampledEntityMemberRecord_source_locators" ("SampledEntityMemberRecord_id");

CREATE TABLE "ProtocolMaterializationBlocker_blocked_method_setting_ids" (
	"ProtocolMaterializationBlocker_protocol_materialization_blocker_id" TEXT,
	blocked_method_setting_ids TEXT NOT NULL,
	PRIMARY KEY ("ProtocolMaterializationBlocker_protocol_materialization_blocker_id", blocked_method_setting_ids),
	FOREIGN KEY("ProtocolMaterializationBlocker_protocol_materialization_blocker_id") REFERENCES "ProtocolMaterializationBlocker" (protocol_materialization_blocker_id)
);
CREATE INDEX "ix_ProtocolMaterializationBlocker_blocked_method_setting_ids_blocked_method_setting_ids" ON "ProtocolMaterializationBlocker_blocked_method_setting_ids" (blocked_method_setting_ids);
CREATE INDEX "ix_ProtocolMaterializationBlocker_blocked_method_setting_ids_ProtocolMaterializationBlocker_protocol_materialization_blocker_id" ON "ProtocolMaterializationBlocker_blocked_method_setting_ids" ("ProtocolMaterializationBlocker_protocol_materialization_blocker_id");

CREATE TABLE "ProtocolMaterializationBlocker_source_locators" (
	"ProtocolMaterializationBlocker_protocol_materialization_blocker_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("ProtocolMaterializationBlocker_protocol_materialization_blocker_id", source_locators),
	FOREIGN KEY("ProtocolMaterializationBlocker_protocol_materialization_blocker_id") REFERENCES "ProtocolMaterializationBlocker" (protocol_materialization_blocker_id)
);
CREATE INDEX "ix_ProtocolMaterializationBlocker_source_locators_ProtocolMaterializationBlocker_protocol_materialization_blocker_id" ON "ProtocolMaterializationBlocker_source_locators" ("ProtocolMaterializationBlocker_protocol_materialization_blocker_id");
CREATE INDEX "ix_ProtocolMaterializationBlocker_source_locators_source_locators" ON "ProtocolMaterializationBlocker_source_locators" (source_locators);

CREATE TABLE "MethodConfigurationLevel_included_method_setting_ids" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	included_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", included_method_setting_ids),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_included_method_setting_ids_included_method_setting_ids" ON "MethodConfigurationLevel_included_method_setting_ids" (included_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationLevel_included_method_setting_ids_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_included_method_setting_ids" ("MethodConfigurationLevel_method_configuration_level_id");

CREATE TABLE "MethodConfigurationLevel_excluded_method_setting_ids" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	excluded_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", excluded_method_setting_ids),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_excluded_method_setting_ids_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_excluded_method_setting_ids" ("MethodConfigurationLevel_method_configuration_level_id");
CREATE INDEX "ix_MethodConfigurationLevel_excluded_method_setting_ids_excluded_method_setting_ids" ON "MethodConfigurationLevel_excluded_method_setting_ids" (excluded_method_setting_ids);

CREATE TABLE "MethodConfigurationLevel_common_method_setting_ids" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	common_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", common_method_setting_ids),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_common_method_setting_ids_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_common_method_setting_ids" ("MethodConfigurationLevel_method_configuration_level_id");
CREATE INDEX "ix_MethodConfigurationLevel_common_method_setting_ids_common_method_setting_ids" ON "MethodConfigurationLevel_common_method_setting_ids" (common_method_setting_ids);

CREATE TABLE "MethodConfigurationLevel_branch_method_setting_ids" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	branch_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", branch_method_setting_ids),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_branch_method_setting_ids_branch_method_setting_ids" ON "MethodConfigurationLevel_branch_method_setting_ids" (branch_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationLevel_branch_method_setting_ids_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_branch_method_setting_ids" ("MethodConfigurationLevel_method_configuration_level_id");

CREATE TABLE "MethodConfigurationLevel_documentary_method_setting_ids" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	documentary_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", documentary_method_setting_ids),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_documentary_method_setting_ids_documentary_method_setting_ids" ON "MethodConfigurationLevel_documentary_method_setting_ids" (documentary_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationLevel_documentary_method_setting_ids_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_documentary_method_setting_ids" ("MethodConfigurationLevel_method_configuration_level_id");

CREATE TABLE "MethodConfigurationLevel_unresolved_method_setting_ids" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	unresolved_method_setting_ids TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", unresolved_method_setting_ids),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_unresolved_method_setting_ids_unresolved_method_setting_ids" ON "MethodConfigurationLevel_unresolved_method_setting_ids" (unresolved_method_setting_ids);
CREATE INDEX "ix_MethodConfigurationLevel_unresolved_method_setting_ids_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_unresolved_method_setting_ids" ("MethodConfigurationLevel_method_configuration_level_id");

CREATE TABLE "MethodConfigurationLevel_source_locators" (
	"MethodConfigurationLevel_method_configuration_level_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("MethodConfigurationLevel_method_configuration_level_id", source_locators),
	FOREIGN KEY("MethodConfigurationLevel_method_configuration_level_id") REFERENCES "MethodConfigurationLevel" (method_configuration_level_id)
);
CREATE INDEX "ix_MethodConfigurationLevel_source_locators_source_locators" ON "MethodConfigurationLevel_source_locators" (source_locators);
CREATE INDEX "ix_MethodConfigurationLevel_source_locators_MethodConfigurationLevel_method_configuration_level_id" ON "MethodConfigurationLevel_source_locators" ("MethodConfigurationLevel_method_configuration_level_id");

CREATE TABLE "AcquisitionProtocol_source_locators" (
	"AcquisitionProtocol_acquisition_protocol_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("AcquisitionProtocol_acquisition_protocol_id", source_locators),
	FOREIGN KEY("AcquisitionProtocol_acquisition_protocol_id") REFERENCES "AcquisitionProtocol" (acquisition_protocol_id)
);
CREATE INDEX "ix_AcquisitionProtocol_source_locators_source_locators" ON "AcquisitionProtocol_source_locators" (source_locators);
CREATE INDEX "ix_AcquisitionProtocol_source_locators_AcquisitionProtocol_acquisition_protocol_id" ON "AcquisitionProtocol_source_locators" ("AcquisitionProtocol_acquisition_protocol_id");

CREATE TABLE "SessionConstructionPolicy_source_locators" (
	"SessionConstructionPolicy_session_construction_policy_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("SessionConstructionPolicy_session_construction_policy_id", source_locators),
	FOREIGN KEY("SessionConstructionPolicy_session_construction_policy_id") REFERENCES "SessionConstructionPolicy" (session_construction_policy_id)
);
CREATE INDEX "ix_SessionConstructionPolicy_source_locators_source_locators" ON "SessionConstructionPolicy_source_locators" (source_locators);
CREATE INDEX "ix_SessionConstructionPolicy_source_locators_SessionConstructionPolicy_session_construction_policy_id" ON "SessionConstructionPolicy_source_locators" ("SessionConstructionPolicy_session_construction_policy_id");

CREATE TABLE "NotificationAttributionPolicy_source_locators" (
	"NotificationAttributionPolicy_notification_attribution_policy_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("NotificationAttributionPolicy_notification_attribution_policy_id", source_locators),
	FOREIGN KEY("NotificationAttributionPolicy_notification_attribution_policy_id") REFERENCES "NotificationAttributionPolicy" (notification_attribution_policy_id)
);
CREATE INDEX "ix_NotificationAttributionPolicy_source_locators_NotificationAttributionPolicy_notification_attribution_policy_id" ON "NotificationAttributionPolicy_source_locators" ("NotificationAttributionPolicy_notification_attribution_policy_id");
CREATE INDEX "ix_NotificationAttributionPolicy_source_locators_source_locators" ON "NotificationAttributionPolicy_source_locators" (source_locators);

CREATE TABLE "DurationPolicy_source_locators" (
	"DurationPolicy_duration_policy_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("DurationPolicy_duration_policy_id", source_locators),
	FOREIGN KEY("DurationPolicy_duration_policy_id") REFERENCES "DurationPolicy" (duration_policy_id)
);
CREATE INDEX "ix_DurationPolicy_source_locators_DurationPolicy_duration_policy_id" ON "DurationPolicy_source_locators" ("DurationPolicy_duration_policy_id");
CREATE INDEX "ix_DurationPolicy_source_locators_source_locators" ON "DurationPolicy_source_locators" (source_locators);

CREATE TABLE "TimestampPolicy_source_locators" (
	"TimestampPolicy_timestamp_policy_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("TimestampPolicy_timestamp_policy_id", source_locators),
	FOREIGN KEY("TimestampPolicy_timestamp_policy_id") REFERENCES "TimestampPolicy" (timestamp_policy_id)
);
CREATE INDEX "ix_TimestampPolicy_source_locators_TimestampPolicy_timestamp_policy_id" ON "TimestampPolicy_source_locators" ("TimestampPolicy_timestamp_policy_id");
CREATE INDEX "ix_TimestampPolicy_source_locators_source_locators" ON "TimestampPolicy_source_locators" (source_locators);

CREATE TABLE "ParameterProvenanceAssertion_source_locators" (
	"ParameterProvenanceAssertion_parameter_provenance_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("ParameterProvenanceAssertion_parameter_provenance_id", source_locators),
	FOREIGN KEY("ParameterProvenanceAssertion_parameter_provenance_id") REFERENCES "ParameterProvenanceAssertion" (parameter_provenance_id)
);
CREATE INDEX "ix_ParameterProvenanceAssertion_source_locators_ParameterProvenanceAssertion_parameter_provenance_id" ON "ParameterProvenanceAssertion_source_locators" ("ParameterProvenanceAssertion_parameter_provenance_id");
CREATE INDEX "ix_ParameterProvenanceAssertion_source_locators_source_locators" ON "ParameterProvenanceAssertion_source_locators" (source_locators);

CREATE TABLE "SourceArtifactProvenanceAssertion_provenance_keys" (
	"SourceArtifactProvenanceAssertion_method_setting_id" TEXT,
	provenance_keys TEXT NOT NULL,
	PRIMARY KEY ("SourceArtifactProvenanceAssertion_method_setting_id", provenance_keys),
	FOREIGN KEY("SourceArtifactProvenanceAssertion_method_setting_id") REFERENCES "SourceArtifactProvenanceAssertion" (method_setting_id)
);
CREATE INDEX "ix_SourceArtifactProvenanceAssertion_provenance_keys_provenance_keys" ON "SourceArtifactProvenanceAssertion_provenance_keys" (provenance_keys);
CREATE INDEX "ix_SourceArtifactProvenanceAssertion_provenance_keys_SourceArtifactProvenanceAssertion_method_setting_id" ON "SourceArtifactProvenanceAssertion_provenance_keys" ("SourceArtifactProvenanceAssertion_method_setting_id");

CREATE TABLE "MeasurementReleaseProfile_collector_to_release_transformations" (
	"MeasurementReleaseProfile_release_profile_id" TEXT,
	collector_to_release_transformations TEXT,
	PRIMARY KEY ("MeasurementReleaseProfile_release_profile_id", collector_to_release_transformations),
	FOREIGN KEY("MeasurementReleaseProfile_release_profile_id") REFERENCES "MeasurementReleaseProfile" (release_profile_id)
);
CREATE INDEX "ix_MeasurementReleaseProfile_collector_to_release_transformations_collector_to_release_transformations" ON "MeasurementReleaseProfile_collector_to_release_transformations" (collector_to_release_transformations);
CREATE INDEX "ix_MeasurementReleaseProfile_collector_to_release_transformations_MeasurementReleaseProfile_release_profile_id" ON "MeasurementReleaseProfile_collector_to_release_transformations" ("MeasurementReleaseProfile_release_profile_id");

CREATE TABLE "MeasurementReleaseProfile_source_locators" (
	"MeasurementReleaseProfile_release_profile_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("MeasurementReleaseProfile_release_profile_id", source_locators),
	FOREIGN KEY("MeasurementReleaseProfile_release_profile_id") REFERENCES "MeasurementReleaseProfile" (release_profile_id)
);
CREATE INDEX "ix_MeasurementReleaseProfile_source_locators_source_locators" ON "MeasurementReleaseProfile_source_locators" (source_locators);
CREATE INDEX "ix_MeasurementReleaseProfile_source_locators_MeasurementReleaseProfile_release_profile_id" ON "MeasurementReleaseProfile_source_locators" ("MeasurementReleaseProfile_release_profile_id");

CREATE TABLE "DiaryProtocol_source_locators" (
	"DiaryProtocol_diary_protocol_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("DiaryProtocol_diary_protocol_id", source_locators),
	FOREIGN KEY("DiaryProtocol_diary_protocol_id") REFERENCES "DiaryProtocol" (diary_protocol_id)
);
CREATE INDEX "ix_DiaryProtocol_source_locators_DiaryProtocol_diary_protocol_id" ON "DiaryProtocol_source_locators" ("DiaryProtocol_diary_protocol_id");
CREATE INDEX "ix_DiaryProtocol_source_locators_source_locators" ON "DiaryProtocol_source_locators" (source_locators);

CREATE TABLE "DiaryReplicationBinding_blocker_codes" (
	"DiaryReplicationBinding_method_setting_id" TEXT,
	blocker_codes TEXT NOT NULL,
	PRIMARY KEY ("DiaryReplicationBinding_method_setting_id", blocker_codes),
	FOREIGN KEY("DiaryReplicationBinding_method_setting_id") REFERENCES "DiaryReplicationBinding" (method_setting_id)
);
CREATE INDEX "ix_DiaryReplicationBinding_blocker_codes_DiaryReplicationBinding_method_setting_id" ON "DiaryReplicationBinding_blocker_codes" ("DiaryReplicationBinding_method_setting_id");
CREATE INDEX "ix_DiaryReplicationBinding_blocker_codes_blocker_codes" ON "DiaryReplicationBinding_blocker_codes" (blocker_codes);

CREATE TABLE "OperationDefinition" (
	operation_id TEXT NOT NULL,
	verb TEXT,
	engine TEXT,
	operation_role TEXT,
	epistemic_role TEXT,
	is_fatal BOOLEAN,
	part_of_operation TEXT,
	grouping_basis VARCHAR(25),
	selection_rule VARCHAR(37),
	event_payload_association VARCHAR(38),
	missing_gesture_marks_incomplete BOOLEAN,
	gesture_presence_implies_correctness BOOLEAN,
	sequence_encoding_rule VARCHAR(37),
	sequence_first_symbol_setting_id TEXT,
	sequence_repeat_symbol_setting_id TEXT,
	"WorkflowPlan_plan_id" TEXT,
	"StudyMethodProfile_method_profile_id" TEXT,
	PRIMARY KEY (operation_id),
	FOREIGN KEY(part_of_operation) REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(sequence_first_symbol_setting_id) REFERENCES "MethodSettingAssertion" (method_setting_id),
	FOREIGN KEY(sequence_repeat_symbol_setting_id) REFERENCES "MethodSettingAssertion" (method_setting_id),
	FOREIGN KEY("WorkflowPlan_plan_id") REFERENCES "WorkflowPlan" (plan_id),
	FOREIGN KEY("StudyMethodProfile_method_profile_id") REFERENCES "StudyMethodProfile" (method_profile_id)
);
CREATE INDEX "ix_OperationDefinition_operation_id" ON "OperationDefinition" (operation_id);

CREATE TABLE "MethodContractBinding" (
	id INTEGER NOT NULL,
	contract_slot TEXT NOT NULL,
	contract_value_json TEXT NOT NULL,
	"MethodSettingAssertion_method_setting_id" TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY("MethodSettingAssertion_method_setting_id") REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_MethodContractBinding_id" ON "MethodContractBinding" (id);

CREATE TABLE "DeviceSessionLabelRecord_support_task_action_references" (
	"DeviceSessionLabelRecord_id" INTEGER,
	support_task_action_references TEXT,
	PRIMARY KEY ("DeviceSessionLabelRecord_id", support_task_action_references),
	FOREIGN KEY("DeviceSessionLabelRecord_id") REFERENCES "DeviceSessionLabelRecord" (id)
);
CREATE INDEX "ix_DeviceSessionLabelRecord_support_task_action_references_support_task_action_references" ON "DeviceSessionLabelRecord_support_task_action_references" (support_task_action_references);
CREATE INDEX "ix_DeviceSessionLabelRecord_support_task_action_references_DeviceSessionLabelRecord_id" ON "DeviceSessionLabelRecord_support_task_action_references" ("DeviceSessionLabelRecord_id");

CREATE TABLE "DeviceSessionLabelRecord_questionnaire_response_references" (
	"DeviceSessionLabelRecord_id" INTEGER,
	questionnaire_response_references TEXT,
	PRIMARY KEY ("DeviceSessionLabelRecord_id", questionnaire_response_references),
	FOREIGN KEY("DeviceSessionLabelRecord_id") REFERENCES "DeviceSessionLabelRecord" (id)
);
CREATE INDEX "ix_DeviceSessionLabelRecord_questionnaire_response_references_questionnaire_response_references" ON "DeviceSessionLabelRecord_questionnaire_response_references" (questionnaire_response_references);
CREATE INDEX "ix_DeviceSessionLabelRecord_questionnaire_response_references_DeviceSessionLabelRecord_id" ON "DeviceSessionLabelRecord_questionnaire_response_references" ("DeviceSessionLabelRecord_id");

CREATE TABLE "DeviceSessionLabelRecord_source_locators" (
	"DeviceSessionLabelRecord_id" INTEGER,
	source_locators TEXT NOT NULL,
	PRIMARY KEY ("DeviceSessionLabelRecord_id", source_locators),
	FOREIGN KEY("DeviceSessionLabelRecord_id") REFERENCES "DeviceSessionLabelRecord" (id)
);
CREATE INDEX "ix_DeviceSessionLabelRecord_source_locators_source_locators" ON "DeviceSessionLabelRecord_source_locators" (source_locators);
CREATE INDEX "ix_DeviceSessionLabelRecord_source_locators_DeviceSessionLabelRecord_id" ON "DeviceSessionLabelRecord_source_locators" ("DeviceSessionLabelRecord_id");

CREATE TABLE "MethodSettingAssertion_mapped_ontology_term" (
	"MethodSettingAssertion_method_setting_id" TEXT,
	mapped_ontology_term TEXT,
	PRIMARY KEY ("MethodSettingAssertion_method_setting_id", mapped_ontology_term),
	FOREIGN KEY("MethodSettingAssertion_method_setting_id") REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_MethodSettingAssertion_mapped_ontology_term_MethodSettingAssertion_method_setting_id" ON "MethodSettingAssertion_mapped_ontology_term" ("MethodSettingAssertion_method_setting_id");
CREATE INDEX "ix_MethodSettingAssertion_mapped_ontology_term_mapped_ontology_term" ON "MethodSettingAssertion_mapped_ontology_term" (mapped_ontology_term);

CREATE TABLE "MethodSettingAssertion_mapped_contract_slot" (
	"MethodSettingAssertion_method_setting_id" TEXT,
	mapped_contract_slot TEXT,
	PRIMARY KEY ("MethodSettingAssertion_method_setting_id", mapped_contract_slot),
	FOREIGN KEY("MethodSettingAssertion_method_setting_id") REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_MethodSettingAssertion_mapped_contract_slot_mapped_contract_slot" ON "MethodSettingAssertion_mapped_contract_slot" (mapped_contract_slot);
CREATE INDEX "ix_MethodSettingAssertion_mapped_contract_slot_MethodSettingAssertion_method_setting_id" ON "MethodSettingAssertion_mapped_contract_slot" ("MethodSettingAssertion_method_setting_id");

CREATE TABLE "MethodSettingAssertion_required_inputs" (
	"MethodSettingAssertion_method_setting_id" TEXT,
	required_inputs TEXT,
	PRIMARY KEY ("MethodSettingAssertion_method_setting_id", required_inputs),
	FOREIGN KEY("MethodSettingAssertion_method_setting_id") REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_MethodSettingAssertion_required_inputs_required_inputs" ON "MethodSettingAssertion_required_inputs" (required_inputs);
CREATE INDEX "ix_MethodSettingAssertion_required_inputs_MethodSettingAssertion_method_setting_id" ON "MethodSettingAssertion_required_inputs" ("MethodSettingAssertion_method_setting_id");

CREATE TABLE "MethodSettingAssertion_source_clause_ids" (
	"MethodSettingAssertion_method_setting_id" TEXT,
	source_clause_ids TEXT,
	PRIMARY KEY ("MethodSettingAssertion_method_setting_id", source_clause_ids),
	FOREIGN KEY("MethodSettingAssertion_method_setting_id") REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_MethodSettingAssertion_source_clause_ids_MethodSettingAssertion_method_setting_id" ON "MethodSettingAssertion_source_clause_ids" ("MethodSettingAssertion_method_setting_id");
CREATE INDEX "ix_MethodSettingAssertion_source_clause_ids_source_clause_ids" ON "MethodSettingAssertion_source_clause_ids" (source_clause_ids);

CREATE TABLE "MethodSettingAssertion_source_locators" (
	"MethodSettingAssertion_method_setting_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("MethodSettingAssertion_method_setting_id", source_locators),
	FOREIGN KEY("MethodSettingAssertion_method_setting_id") REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_MethodSettingAssertion_source_locators_MethodSettingAssertion_method_setting_id" ON "MethodSettingAssertion_source_locators" ("MethodSettingAssertion_method_setting_id");
CREATE INDEX "ix_MethodSettingAssertion_source_locators_source_locators" ON "MethodSettingAssertion_source_locators" (source_locators);

CREATE TABLE "DiaryItem_diary_allowed_values" (
	"DiaryItem_diary_item_id" TEXT,
	diary_allowed_values TEXT,
	PRIMARY KEY ("DiaryItem_diary_item_id", diary_allowed_values),
	FOREIGN KEY("DiaryItem_diary_item_id") REFERENCES "DiaryItem" (diary_item_id)
);
CREATE INDEX "ix_DiaryItem_diary_allowed_values_DiaryItem_diary_item_id" ON "DiaryItem_diary_allowed_values" ("DiaryItem_diary_item_id");
CREATE INDEX "ix_DiaryItem_diary_allowed_values_diary_allowed_values" ON "DiaryItem_diary_allowed_values" (diary_allowed_values);

CREATE TABLE "DiaryItem_source_locators" (
	"DiaryItem_diary_item_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("DiaryItem_diary_item_id", source_locators),
	FOREIGN KEY("DiaryItem_diary_item_id") REFERENCES "DiaryItem" (diary_item_id)
);
CREATE INDEX "ix_DiaryItem_source_locators_DiaryItem_diary_item_id" ON "DiaryItem_source_locators" ("DiaryItem_diary_item_id");
CREATE INDEX "ix_DiaryItem_source_locators_source_locators" ON "DiaryItem_source_locators" (source_locators);

CREATE TABLE "DiaryScheduleRule_source_locators" (
	"DiaryScheduleRule_diary_schedule_rule_id" TEXT,
	source_locators TEXT,
	PRIMARY KEY ("DiaryScheduleRule_diary_schedule_rule_id", source_locators),
	FOREIGN KEY("DiaryScheduleRule_diary_schedule_rule_id") REFERENCES "DiaryScheduleRule" (diary_schedule_rule_id)
);
CREATE INDEX "ix_DiaryScheduleRule_source_locators_DiaryScheduleRule_diary_schedule_rule_id" ON "DiaryScheduleRule_source_locators" ("DiaryScheduleRule_diary_schedule_rule_id");
CREATE INDEX "ix_DiaryScheduleRule_source_locators_source_locators" ON "DiaryScheduleRule_source_locators" (source_locators);

CREATE TABLE "OperationExecution" (
	execution_id TEXT NOT NULL,
	executes_operation TEXT,
	started_at TEXT,
	ended_at TEXT,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (execution_id),
	FOREIGN KEY(executes_operation) REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_OperationExecution_execution_id" ON "OperationExecution" (execution_id);

CREATE TABLE "OperationDefinition_consumes" (
	"OperationDefinition_operation_id" TEXT,
	consumes TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", consumes),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_consumes_consumes" ON "OperationDefinition_consumes" (consumes);
CREATE INDEX "ix_OperationDefinition_consumes_OperationDefinition_operation_id" ON "OperationDefinition_consumes" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_produces" (
	"OperationDefinition_operation_id" TEXT,
	produces TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", produces),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_produces_produces" ON "OperationDefinition_produces" (produces);
CREATE INDEX "ix_OperationDefinition_produces_OperationDefinition_operation_id" ON "OperationDefinition_produces" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_depends_on" (
	"OperationDefinition_operation_id" TEXT,
	depends_on TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", depends_on),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_depends_on_depends_on" ON "OperationDefinition_depends_on" (depends_on);
CREATE INDEX "ix_OperationDefinition_depends_on_OperationDefinition_operation_id" ON "OperationDefinition_depends_on" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_configuration_dependencies" (
	"OperationDefinition_operation_id" TEXT,
	configuration_dependencies TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", configuration_dependencies),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_configuration_dependencies_configuration_dependencies" ON "OperationDefinition_configuration_dependencies" (configuration_dependencies);
CREATE INDEX "ix_OperationDefinition_configuration_dependencies_OperationDefinition_operation_id" ON "OperationDefinition_configuration_dependencies" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_data_effects" (
	"OperationDefinition_operation_id" TEXT,
	data_effects TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", data_effects),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_data_effects_data_effects" ON "OperationDefinition_data_effects" (data_effects);
CREATE INDEX "ix_OperationDefinition_data_effects_OperationDefinition_operation_id" ON "OperationDefinition_data_effects" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_group_scope_operation_ids" (
	"OperationDefinition_operation_id" TEXT,
	group_scope_operation_ids_operation_id TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", group_scope_operation_ids_operation_id),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(group_scope_operation_ids_operation_id) REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_group_scope_operation_ids_OperationDefinition_operation_id" ON "OperationDefinition_group_scope_operation_ids" ("OperationDefinition_operation_id");
CREATE INDEX "ix_OperationDefinition_group_scope_operation_ids_group_scope_operation_ids_operation_id" ON "OperationDefinition_group_scope_operation_ids" (group_scope_operation_ids_operation_id);

CREATE TABLE "OperationDefinition_equality_key_setting_ids" (
	"OperationDefinition_operation_id" TEXT,
	equality_key_setting_ids_method_setting_id TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", equality_key_setting_ids_method_setting_id),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(equality_key_setting_ids_method_setting_id) REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_OperationDefinition_equality_key_setting_ids_equality_key_setting_ids_method_setting_id" ON "OperationDefinition_equality_key_setting_ids" (equality_key_setting_ids_method_setting_id);
CREATE INDEX "ix_OperationDefinition_equality_key_setting_ids_OperationDefinition_operation_id" ON "OperationDefinition_equality_key_setting_ids" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_concatenated_key_setting_ids" (
	"OperationDefinition_operation_id" TEXT,
	concatenated_key_setting_ids_method_setting_id TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", concatenated_key_setting_ids_method_setting_id),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(concatenated_key_setting_ids_method_setting_id) REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_OperationDefinition_concatenated_key_setting_ids_concatenated_key_setting_ids_method_setting_id" ON "OperationDefinition_concatenated_key_setting_ids" (concatenated_key_setting_ids_method_setting_id);
CREATE INDEX "ix_OperationDefinition_concatenated_key_setting_ids_OperationDefinition_operation_id" ON "OperationDefinition_concatenated_key_setting_ids" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_empty_if_absent_key_setting_ids" (
	"OperationDefinition_operation_id" TEXT,
	empty_if_absent_key_setting_ids_method_setting_id TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", empty_if_absent_key_setting_ids_method_setting_id),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(empty_if_absent_key_setting_ids_method_setting_id) REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_OperationDefinition_empty_if_absent_key_setting_ids_empty_if_absent_key_setting_ids_method_setting_id" ON "OperationDefinition_empty_if_absent_key_setting_ids" (empty_if_absent_key_setting_ids_method_setting_id);
CREATE INDEX "ix_OperationDefinition_empty_if_absent_key_setting_ids_OperationDefinition_operation_id" ON "OperationDefinition_empty_if_absent_key_setting_ids" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_required_event_payload_roles" (
	"OperationDefinition_operation_id" TEXT,
	required_event_payload_roles VARCHAR(14),
	PRIMARY KEY ("OperationDefinition_operation_id", required_event_payload_roles),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_required_event_payload_roles_required_event_payload_roles" ON "OperationDefinition_required_event_payload_roles" (required_event_payload_roles);
CREATE INDEX "ix_OperationDefinition_required_event_payload_roles_OperationDefinition_operation_id" ON "OperationDefinition_required_event_payload_roles" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_optional_event_payload_roles" (
	"OperationDefinition_operation_id" TEXT,
	optional_event_payload_roles VARCHAR(14),
	PRIMARY KEY ("OperationDefinition_operation_id", optional_event_payload_roles),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_optional_event_payload_roles_optional_event_payload_roles" ON "OperationDefinition_optional_event_payload_roles" (optional_event_payload_roles);
CREATE INDEX "ix_OperationDefinition_optional_event_payload_roles_OperationDefinition_operation_id" ON "OperationDefinition_optional_event_payload_roles" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_sequence_scope_operation_ids" (
	"OperationDefinition_operation_id" TEXT,
	sequence_scope_operation_ids_operation_id TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", sequence_scope_operation_ids_operation_id),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(sequence_scope_operation_ids_operation_id) REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_OperationDefinition_sequence_scope_operation_ids_sequence_scope_operation_ids_operation_id" ON "OperationDefinition_sequence_scope_operation_ids" (sequence_scope_operation_ids_operation_id);
CREATE INDEX "ix_OperationDefinition_sequence_scope_operation_ids_OperationDefinition_operation_id" ON "OperationDefinition_sequence_scope_operation_ids" ("OperationDefinition_operation_id");

CREATE TABLE "OperationDefinition_sequence_identity_setting_ids" (
	"OperationDefinition_operation_id" TEXT,
	sequence_identity_setting_ids_method_setting_id TEXT,
	PRIMARY KEY ("OperationDefinition_operation_id", sequence_identity_setting_ids_method_setting_id),
	FOREIGN KEY("OperationDefinition_operation_id") REFERENCES "OperationDefinition" (operation_id),
	FOREIGN KEY(sequence_identity_setting_ids_method_setting_id) REFERENCES "MethodSettingAssertion" (method_setting_id)
);
CREATE INDEX "ix_OperationDefinition_sequence_identity_setting_ids_sequence_identity_setting_ids_method_setting_id" ON "OperationDefinition_sequence_identity_setting_ids" (sequence_identity_setting_ids_method_setting_id);
CREATE INDEX "ix_OperationDefinition_sequence_identity_setting_ids_OperationDefinition_operation_id" ON "OperationDefinition_sequence_identity_setting_ids" ("OperationDefinition_operation_id");

CREATE TABLE "QueryDefinition_realizes_operations" (
	"QueryDefinition_query_id" TEXT,
	realizes_operations_operation_id TEXT,
	PRIMARY KEY ("QueryDefinition_query_id", realizes_operations_operation_id),
	FOREIGN KEY("QueryDefinition_query_id") REFERENCES "QueryDefinition" (query_id),
	FOREIGN KEY(realizes_operations_operation_id) REFERENCES "OperationDefinition" (operation_id)
);
CREATE INDEX "ix_QueryDefinition_realizes_operations_realizes_operations_operation_id" ON "QueryDefinition_realizes_operations" (realizes_operations_operation_id);
CREATE INDEX "ix_QueryDefinition_realizes_operations_QueryDefinition_query_id" ON "QueryDefinition_realizes_operations" ("QueryDefinition_query_id");

CREATE TABLE "EffectiveUsageMeasure" (
	id INTEGER NOT NULL,
	participant_id TEXT NOT NULL,
	date DATE,
	app_package_name TEXT,
	produced_by TEXT,
	screen_gating_rule VARCHAR(22),
	denotes_interval_id INTEGER,
	cites_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(produced_by) REFERENCES "OperationExecution" (execution_id),
	FOREIGN KEY(denotes_interval_id) REFERENCES "UsageInterval" (id),
	FOREIGN KEY(cites_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_EffectiveUsageMeasure_id" ON "EffectiveUsageMeasure" (id);

CREATE TABLE "QueryExecution" (
	id INTEGER NOT NULL,
	executes_query TEXT NOT NULL,
	query_execution_status VARCHAR(10) NOT NULL,
	query_input_key TEXT NOT NULL,
	query_output_digest TEXT NOT NULL,
	query_reason_id TEXT NOT NULL,
	part_of_execution TEXT NOT NULL,
	execution_started_at DATETIME NOT NULL,
	execution_ended_at DATETIME NOT NULL,
	used_parameter_set_id INTEGER,
	PRIMARY KEY (id),
	FOREIGN KEY(executes_query) REFERENCES "QueryDefinition" (query_id),
	FOREIGN KEY(part_of_execution) REFERENCES "OperationExecution" (execution_id),
	FOREIGN KEY(used_parameter_set_id) REFERENCES "ParameterSet" (id)
);
CREATE INDEX "ix_QueryExecution_id" ON "QueryExecution" (id);

