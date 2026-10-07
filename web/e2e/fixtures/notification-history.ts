// Source-derived, analyst-constructed histories, not recovered participant rows,
// raw serialization, a classifier run or a reproduction of the reported results.
import type { NotificationEvidenceRecord, NotificationHistoryRecord, NotificationOpeningOccurrenceRecord, ParticipantDayObservationRecord, StudyMethodProfile } from "../../src/lib/methodProfiles";
// Borapp2 pilot item histories preserve supplied actions and labels independently.
// Three normalized examples are not a denominator census or classifier run.
export function boredomPilotHistoryExample(profile: StudyMethodProfile): NotificationHistoryRecord[] {
  if (profile.source_work_id !== "doi:10.1145/2750858.2804252") throw new Error("Wrong Boredom pilot profile");
  const keys = ["borapp2.validation.repeated_measures_design", "borapp2.outcome.click_ratio", "borapp2.outcome.engagement_ratio", "borapp2.intervention.ignored_expiration"];
  const locators = keys.flatMap(key => profile.method_settings.find(s => s.method_parameter_key === key)!.source_locators as string[]);
  const supplied = [...locators, "Constructed pilot item identity/actions/independent labels; no exact clocks, bar-click callback, original acceptance code, classifier state or presentation/click/foreground join recovered"];
  return ["inferred bored", "inferred normal", "inferred bored"].map((condition, index) => {
    const evidence = (id: string, kind: NotificationEvidenceRecord["evidence_kind"], role: NotificationEvidenceRecord["evidence_role"],
      fields: Partial<NotificationEvidenceRecord>): NotificationEvidenceRecord => ({
      evidence_record_id: id, evidence_kind: kind, evidence_role: role, source_locators: supplied, ...fields,
    });
    return {
      notification_history_id: `example:borapp2:${index}`, notification_item_id: `example:borapp2-item:${index}`,
      method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "example:pilot-not-a-source-participant",
      history_record_origin: "analyst_constructed_example" as const, source_locators: supplied,
      notification_evidence: [
        evidence("supplied-condition", "response_objective_label", "inferred", { observed_property: "inferred condition", evidence_value_json: JSON.stringify(condition) }),
        evidence("presented", "action_occurrence", "recorded", { action_kind: "notification presented" }),
        ...(index < 2 ? [
          evidence("clicked", "action_occurrence", "recorded", { action_kind: "notification clicked", evidence_references: ["presented"] }),
          evidence("opened", "action_occurrence", "recorded", { action_kind: "Buzzfeed opened", evidence_references: ["clicked"] }),
          evidence("duration", "quantity", "inferred", { observed_property: "Buzzfeed open duration", evidence_value_json: index ? "29.99" : "30.00", evidence_unit: "seconds", evidence_references: ["opened"] }),
          evidence("engagement", "response_objective_label", "inferred", { observed_property: "engagement numerator membership (supplied normalized Boolean)",
            evidence_value_json: index ? "false" : "true", evidence_references: ["opened", "duration"], evidence_basis: "independent supplied membership, not computed from opening/duration" }),
        ] : [
          evidence("expired", "action_occurrence", "recorded", { action_kind: "ignored notification expiration", evidence_references: ["presented"] }),
          evidence("engagement", "response_objective_label", "inferred", { observed_property: "engagement numerator membership (supplied normalized Boolean)",
            evidence_value_json: null, evidence_basis: "unknown membership; absence of click is not converted to false" }),
        ]),
      ],
    };
  });
}

const work = "doi:10.1145/2858036.2858566";
const pin = "accepted manuscript SHA256 afb1aee398084cf9af4f2ca5898e8e1eea40243f37ef52c21a3fce7e72dec4e7";
const timing = `My Phone and Me PDF p.3 Figure2/Reasoning; p.4 Table1/Data Collection; ${pin}`;
const questionnaire = `My Phone and Me PDF p.4 Table2/Data Collection; ${pin}`;
const acceptance = `My Phone and Me PDF p.8 acceptance procedure, txt524-531; ${pin}`;

// Constructed normalized records; no original OS keys, exact sensor clocks,
// matching, classification, IDL calculation or snooze scheduling is asserted.
export function notificationBoundaryExample(profile: StudyMethodProfile) {
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const definition = (key: string, role: string, target: string, expected: string | Record<string, unknown>) => {
    const settings = profile.method_settings.filter(s => s.method_parameter_key === key);
    const setting = settings[0];
    if (settings.length !== 1 || !setting || setting.source_work_id !== profile.source_work_id
      || setting.method_setting_role !== role || setting.method_target_layer !== target) throw new Error(`Missing source-bound fixture definition: ${key}`);
    const content: unknown = JSON.parse(String(setting.method_value_json));
    const wrapped = object(content) && Object.hasOwn(content, "definition");
    const body = wrapped ? content.definition : content;
    if (object(content) && (((wrapped || Object.hasOwn(content, "source_facing_role")) && content.source_facing_role !== role)
      || ((wrapped || Object.hasOwn(content, "source_facing_target")) && content.source_facing_target !== target))) throw new Error(`Wrong source tuple: ${key}`);
    const matches = typeof expected === "string" ? body === expected
      : object(body) && Object.entries(expected).every(([k, v]) => JSON.stringify(body[k]) === JSON.stringify(v));
    if (!matches) throw new Error(`Wrong source body: ${key}`);
    return setting.source_locators as string[];
  };
  const histories: NotificationHistoryRecord[] = [];
  const history = (id: string, locators: string[]) => {
    const row: NotificationHistoryRecord = {
      notification_history_id: id, notification_item_id: `${id}:item`,
      method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "example:notification-participant", device_id: "example:phone",
      history_record_origin: "analyst_constructed_example", notification_evidence: [], source_locators: locators,
    };
    histories.push(row);
    return row;
  };
  const evidence = (id: string, kind: NotificationEvidenceRecord["evidence_kind"], role: NotificationEvidenceRecord["evidence_role"],
    locators: string[], fields: Partial<NotificationEvidenceRecord> = {}): NotificationEvidenceRecord => ({
    evidence_record_id: id, evidence_kind: kind, evidence_role: role, source_locators: locators, ...fields,
  });
  switch (profile.source_work_id) {
    case "doi:10.1145/3130956": {
      const posting = definition("feature.notification_post_anchor", "feature_engineering", "derived_feature",
        "Compute context from phone-use data available before each study notification was posted; output one feature/label row per posted notification with user ID.");
      const inventory = definition("feature.base_group_inventory", "feature_engineering", "derived_feature", { total_features: 197 });
      const outcome = definition("outcome.content_engagement_label", "feature_engineering", "outcome", {
        positive: "opened questionnaire and clicked one of two suggested content buttons",
        negative: "did not open questionnaire, or opened it but ignored suggested content",
        source_numeric_labels: { positive: 1, negative: 0 }, sustained_content_consumption_observed: false,
      });
      const mood = definition("instrument.mood_questionnaire", "diary_schema", "diary_item", { mood_item_count: 4 });
      const check = definition("quality.questionnaire_random_response_check", "quality_control", "diary_response",
        { illustrated_instruction: "Select the button on the left", offered_positions: 3, validity_rule: null });
      for (const positive of [true, false]) {
        const row = history(`example:beyond:${positive ? "content-click" : "opened-only"}`, [...posting, ...inventory, ...outcome, ...mood, ...check]);
        row.notification_evidence = [
          evidence("posted", "action_occurrence", "recorded", posting, { action_kind: "post_study_notification" }),
          ...[
            ["unlocks", "last 5 minutes", "2"],
            ["screen-on fraction", "last hour", "0.25"],
            ["screen-on fraction", "since 5 am today", "0.50"],
          ].map(([observed_property, lookback, value], index) => evidence(`context-${index}`, "context", "inferred", [...posting, ...inventory], {
            observed_property: observed_property!, context_sampling_boundary: "posting", lookback: lookback!,
            evidence_value_json: value!, evidence_references: ["posted"],
          })),
          evidence("opened", "action_occurrence", "recorded", outcome, { action_kind: "questionnaire_open", evidence_references: ["posted"] }),
          ...(positive ? [evidence("content-click", "action_occurrence", "recorded", outcome, { action_kind: "content_button_click", evidence_references: ["opened"] })] : []),
          evidence("supplied-engagement", "response_objective_label", "inferred", outcome, {
            observed_property: "content engagement", evidence_value_json: positive ? "1" : "0",
            evidence_references: positive ? ["opened", "content-click"] : ["opened"],
            evidence_basis: "independently supplied label; opening alone is not positive",
          }),
        ];
        row.questionnaire_responses = positive ? [
          ...[["Bad–Good", "Good"], ["Tense–Calm", "Calm"], ["Tired–Awake", "Awake"], ["I feel bored", "No"]].map(([label, answer], index) => ({
            questionnaire_response_id: `mood-${index}`, questionnaire_item_label: label!, response_value_json: JSON.stringify(answer), source_locators: mood,
          })),
          { questionnaire_response_id: "random-response-check", questionnaire_item_label: "Select the button on the left",
            response_value_json: JSON.stringify("left"), source_locators: check },
        ] : null;
      }
      break;
    }
    case "doi:10.3390/s24082612": {
      const endpoints = definition("derive.idl_endpoints", "feature_engineering", "derived_feature", {
        quantity: "Interaction Delay (IDL)", start: "notification displayed/appearance", end: "notification-bar removal/disappearance",
        removal_reason: null, proxy_not_observed_click_dismissal_or_attention: true,
      });
      const precision = definition("derive.idl_precision", "feature_engineering", "derived_feature", { unit: "seconds", output: "integer", rounding_or_truncation: null });
      for (const [index, value] of ["13", "0"].entries()) {
        const row = history(`example:idl:${index}`, [...endpoints, ...precision]);
        row.notification_evidence = [
          evidence("appearance", "arrival", "recorded", endpoints, { evidence_instant: null }),
          evidence("disappearance", "removal", "recorded", endpoints),
          evidence("supplied-idl", "quantity", "inferred", [...endpoints, ...precision], {
            observed_property: "Interaction Delay (IDL)", evidence_value_json: value, evidence_unit: "seconds",
            evidence_references: ["appearance", "disappearance"],
            evidence_basis: "supplied independently; zero is a pre-filter candidate, unknown clocks and removal cause",
          }),
        ];
      }
      break;
    }
    case "doi:10.1145/3229434.3229436": {
      const locators = definition("intervention.drawer_entry", "intervention", "notification_delivery", {
        statement: "After a drawer dismissal, NHistory creates a temporary snooze-action notification; tapping it opens the snooze options for the dismissed item.",
        qualification: "Separate source path; exact notification-key matching is undisclosed.",
      });
      const repeated = definition("analysis.notification_vs_snooze_identity", "reconstruction", "notification_item",
        { relation: "one logical notification item may have one initial and multiple repeat snooze events", identity_key: null });
      const lifetime = definition("intervention.drawer_prompt_lifetime", "intervention", "notification_delivery", { duration: 5, unit: "second", not_session_gap: true });
      const retrigger = definition("operation.retrigger", "intervention", "notification_delivery",
        { statement: "NHistory reissues the dismissed notification after the selected duration or at the selected point in time." });
      const prompt = history("example:snooze:temporary-prompt", [...locators, ...lifetime]);
      prompt.original_notification_history_reference = "example:snooze:original";
      prompt.notification_evidence = [
        evidence("prompt-post", "arrival", "recorded", locators),
        evidence("open-options", "action_occurrence", "recorded", locators, { action_kind: "open_snooze_options", evidence_references: ["prompt-post"] }),
      ];
      const copy = history("example:snooze:retriggered-copy", [...repeated, ...retrigger]);
      copy.original_notification_history_reference = "example:snooze:original";
      copy.notification_evidence = [evidence("retriggered-post", "arrival", "recorded", retrigger,
        { evidence_instant: null, evidence_basis: "supplied re-triggered copy; original raw keys undisclosed" })];
      const original = history("example:snooze:original", [...locators, ...repeated]);
      original.notification_evidence = [
        evidence("posted", "arrival", "recorded", repeated),
        evidence("dismissed", "dismissed", "recorded", locators, { evidence_value_json: "true" }),
        evidence("snooze-1", "action_occurrence", "recorded", repeated, { action_kind: "snooze", occurrence_ordinal: 0, evidence_references: ["dismissed"] }),
        evidence("snooze-2", "action_occurrence", "recorded", repeated, { action_kind: "snooze", occurrence_ordinal: 1, evidence_references: ["snooze-1"] }),
      ];
      break;
    }
    default: throw new Error(`Unsupported notification fixture source: ${profile.source_work_id}`);
  }
  return { profiles: [profile], notification_histories: histories };
}

// Constructed responses on the fifth, ESM-only collector. Rated device type is
// part of each question identity/label, never the collector's device_id.
export function multiDeviceQuestionnaireExample(profile: StudyMethodProfile) {
  const instrument = profile.method_settings.find(s => s.method_parameter_key === "protocol.esm_q3_q4_device_ratings")!;
  const collector = profile.method_settings.find(s => s.method_parameter_key === "collector.esm_fifth_device")!;
  const location = profile.method_settings.find(s => s.method_parameter_key === "protocol.esm_q1_location")!;
  const people = profile.method_settings.find(s => s.method_parameter_key === "protocol.esm_q2_people")!;
  const notification_histories: NotificationHistoryRecord[] = [{
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example-participant", device_id: "example:ESM-collector-phone",
    notification_history_id: "example:ESM-prompt", notification_item_id: "example:ESM-notification",
    history_record_origin: "analyst_constructed_example", source_locators: collector.source_locators as string[],
    notification_evidence: [{ evidence_record_id: "arrival", evidence_kind: "arrival", evidence_role: "recorded",
      evidence_instant: null, source_locators: collector.source_locators as string[] },
    { evidence_record_id: "survey-open", evidence_kind: "action_occurrence", evidence_role: "recorded",
      action_kind: "survey_open", evidence_references: ["arrival"], source_locators: collector.source_locators as string[] }],
    questionnaire_responses: [
      { questionnaire_response_id: "Q1", questionnaire_item_label: "Where are you?",
        response_value_json: JSON.stringify(["In transit", "Work/uni"]), source_locators: location.source_locators as string[] },
      { questionnaire_response_id: "Q2", questionnaire_item_label: "How many people are in your surroundings?",
        response_value_json: JSON.stringify("1-3"), source_locators: people.source_locators as string[] },
      ...["smartphone", "tablet", "PC", "smartwatch"].flatMap((device, index) => [
      { questionnaire_response_id: `Q3:${device}`,
        questionnaire_item_label: `The mentioned device is in my proximity. [rated device: ${device}]`,
        response_value_json: JSON.stringify(["Strongly Agree", "Disagree", "Agree", "Strongly Disagree"][index]),
        source_locators: instrument.source_locators as string[] },
      { questionnaire_response_id: `Q4:${device}`,
        questionnaire_item_label: `I want to receive a notification on the mentioned device. [rated device: ${device}]`,
        response_value_json: JSON.stringify([1, 4, 2, 5][index]), source_locators: instrument.source_locators as string[] },
    ])],
  }];
  const partial = structuredClone(notification_histories[0]!);
  partial.notification_history_id = "example:partial-ESM-prompt";
  partial.notification_item_id = "example:partial-ESM-notification";
  partial.questionnaire_responses = partial.questionnaire_responses!.slice(2, 4);
  partial.questionnaire_responses[1]!.response_value_json = "null";
  notification_histories.push(partial);
  return { profiles: [profile], notification_histories };
}

export function notificationHistoryExample() {
  const profileId = `example:notification-history:${work}`;
  const owner = { method_profile_id: profileId, source_work_id: work, participant_id: "example-participant",
    history_record_origin: "analyst_constructed_example" as const, source_locators: [timing, questionnaire, acceptance] };
  const profiles = [{
    method_profile_id: profileId, source_work_id: work,
    source_method_variant_id: "source-derived-notification-history-example",
    method_configuration_structure: "fixed", method_profile_version: "normalized-example-v1",
    profile_implementation_status: "blocked", source_locators: owner.source_locators,
    method_settings: [{
      method_setting_id: "example:acceptance-recode", source_extraction_id: "example:p8:acceptance",
      source_work_id: work, method_parameter_key: "acceptance.esm_recode",
      method_setting_role: "feature_engineering", method_target_layer: "outcome",
      method_value_json: JSON.stringify({ clicked_code: 1, dismissed_but_no_further_action_code: 1,
        dismissed_code: 0, import_computes_recode: false }), method_value_kind: "object",
      method_applicability_status: "applicable", method_disclosure_status: "declared",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [acceptance],
    }],
  }];
  const notification_histories: NotificationHistoryRecord[] = [{
    ...owner, notification_history_id: "example-history-1", notification_item_id: "example-item-1",
    app_package_name: "example.notification.app", notification_title: "",
    notification_evidence: [
      { evidence_record_id: "arrival", evidence_kind: "arrival", evidence_role: "recorded",
        evidence_instant: "2026-01-01T09:00:00Z", source_locators: [timing] },
      { evidence_record_id: "removal", evidence_kind: "removal", evidence_role: "recorded",
        evidence_instant: "2026-01-01T09:02:00Z", source_locators: [timing] },
      { evidence_record_id: "unlock", evidence_kind: "phone_unlock", evidence_role: "recorded",
        evidence_instant: "2026-01-01T09:01:00Z", source_locators: [timing] },
      { evidence_record_id: "assumed-seen", evidence_kind: "assumed_seen", evidence_role: "inferred",
        evidence_instant: "2026-01-01T09:01:00Z", evidence_basis: "unlock_proxy_not_observed_attention",
        evidence_references: ["unlock"], source_locators: [timing] },
      { evidence_record_id: "dismissal-status", evidence_kind: "dismissed", evidence_role: "recorded",
        evidence_value_json: "true", source_locators: [timing] },
    ],
    questionnaire_responses: [{ questionnaire_response_id: "initial-handling",
      questionnaire_item_label: "How did you handle the notification when you first saw it?",
      response_value_json: JSON.stringify("I decided to dismiss it because it didn't require any further action"),
      source_locators: [questionnaire] }],
    acceptance_records: [{ acceptance_record_id: "supplied-accepted", acceptance_code: 1,
      evidence_references: ["dismissal-status"], questionnaire_response_references: ["initial-handling"],
      source_locators: [acceptance] }],
  }, {
    ...owner, notification_history_id: "example-history-2", notification_item_id: "example-item-2",
    app_package_name: "example.notification.app", notification_title: null,
    notification_evidence: [
      { evidence_record_id: "arrival", evidence_kind: "arrival", evidence_role: "recorded",
        evidence_instant: "2026-01-01T09:00:00Z", source_locators: [timing] },
      { evidence_record_id: "zero-seen-latency", evidence_kind: "seen_latency", evidence_role: "inferred",
        evidence_value_json: "0", evidence_unit: "seconds", evidence_basis: "already_unlocked_arrival_convention",
        evidence_references: [], source_locators: [timing] },
    ],
  }];
  return { profiles, notification_histories };
}

// Böhmer pp.3,7–8 discloses repeated postpones and widget moves, not these raw
// keys, times, ordinals or participant rows. Import preserves supplied values.
export function boehmerCallActionExample() {
  const work = "doi:10.1145/2556288.2557066";
  const locator = "Interrupted by a Phone Call PDF p.3 Figure2; p.7 Table1/Cases; p.8 Usage of Postpone/Timing of Call Handling; SHA256 7b66db164a6c0a232e67d59813277c65c8be78776a6199196aacde2c90663627";
  const base = notificationHistoryExample().profiles[0]!;
  const profile = { ...base, method_profile_id: "example:boehmer-call-actions", source_work_id: work,
    source_method_variant_id: "analyst-normalized-call-action-example", source_locators: [locator],
    method_settings: [{ ...base.method_settings[0]!, source_work_id: work,
      method_setting_id: "example:boehmer-call-actions", source_extraction_id: "example:p8:postpone",
      method_parameter_key: "field.postpone_action_event", method_setting_role: "event_schema", method_target_layer: "raw_record",
      method_disclosure_status: "declared_partial", method_value_json: JSON.stringify({ repeated_actions_on_one_call: true,
        raw_key: null, grouping: null, import_computes_call_endings: false }), source_locators: [locator] }] };
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: work, participant_id: "example-participant",
    history_record_origin: "analyst_constructed_example" as const, source_locators: [locator] };
  const action = { evidence_kind: "action_occurrence" as const, evidence_role: "recorded" as const, source_locators: [locator] };
  const notification_histories: NotificationHistoryRecord[] = [{
    ...owner, notification_history_id: "example:one-call", notification_item_id: "example:call-alert",
    notification_evidence: [
      { ...action, evidence_record_id: "p2", action_kind: "postpone", occurrence_ordinal: 8, evidence_instant: "equal-supplied-time", evidence_references: ["p1"] },
      { ...action, evidence_record_id: "m1", action_kind: "widget_move", occurrence_ordinal: 3, evidence_instant: "equal-supplied-time" },
      { ...action, evidence_record_id: "p1", action_kind: "postpone", occurrence_ordinal: 0, evidence_instant: "equal-supplied-time" },
      { ...action, evidence_record_id: "unknown-order", action_kind: "example:other supplied action", occurrence_ordinal: null, evidence_instant: null },
      { ...action, evidence_record_id: "omitted-order", action_kind: "postpone" },
    ],
  }, {
    ...owner, notification_history_id: "example:second-call", notification_item_id: "example:second-call-alert",
    notification_evidence: [{ ...action, evidence_record_id: "p1", action_kind: "postpone", occurrence_ordinal: 0 }],
  }];
  return { profiles: [profile], notification_histories };
}

// The values below are constructed normalized examples, not recovered sensor
// types/codes or participant observations. In particular no GPS join is inferred.
export function notificationContextExample() {
  const input = notificationHistoryExample();
  const first = input.notification_histories[0]!;
  const context = `My Phone and Me PDF p.4 Table1/Data Collection; ${pin}`;
  first.notification_evidence.push(...["arrival", "removal"].flatMap((boundary) =>
    ["Physical activity", "Location", "Presence of surrounding sound", "WiFi connectivity",
      "Proximity to the phone", "Surrounding light intensity"].map((label, index) => ({
      evidence_record_id: `${boundary}-context-${index}`, evidence_kind: "context" as const,
      evidence_role: "recorded" as const, observed_property: label,
      context_sampling_boundary: boundary as "arrival" | "removal",
      evidence_value_json: [JSON.stringify("example-activity"), JSON.stringify("example-location"),
        "false", "true", "false", boundary === "arrival" ? "0" : "10"][index]!,
      evidence_references: [boundary], source_locators: [context],
    }))));
  const contentWork = "doi:10.1145/2750858.2807544";
  const contentPin = "primary PDF SHA256 a2f6364d8e10e4f4925dd30eb9060b74c25b733bf5424a4d66a7ccad2f96f548";
  const contentLocator = `Content-driven notifications PDF p.3 Table1/NotifyMe; ${contentPin}`;
  const contentProfile = { ...structuredClone(input.profiles[0]!),
    method_profile_id: "example:content-notification-context", source_work_id: contentWork,
    source_method_variant_id: "source-derived-content-context-example", source_locators: [contentLocator],
    method_settings: [{ ...structuredClone(input.profiles[0]!.method_settings[0]!),
      method_setting_id: "example:content-context-schema", source_extraction_id: "example:content:p3:Table1",
      source_work_id: contentWork, method_parameter_key: "notification.context_schema",
      method_setting_role: "event_schema", method_target_layer: "raw_record",
      method_value_json: JSON.stringify({ sampling_boundary: "source_unreported",
        preceding_minute_features: ["Proximity", "Phone's status"] }), source_locators: [contentLocator] }] };
  input.profiles.push(contentProfile);
  const contentHistory: NotificationHistoryRecord = {
    notification_history_id: "example-content-history", notification_item_id: "example-content-item",
    method_profile_id: contentProfile.method_profile_id, source_work_id: contentWork,
    participant_id: "example-participant", history_record_origin: "analyst_constructed_example",
    app_package_name: "example.notification.app", notification_title: "example-title",
    notification_evidence: [{ evidence_record_id: "inferred-clicked", evidence_kind: "clicked",
      evidence_role: "inferred", evidence_value_json: "false", source_locators: [contentLocator] }],
    source_locators: [contentLocator],
  };
  contentHistory.notification_evidence.push(...["Proximity", "Phone's status", "Surrounding sound", "WiFi connectivity", "Alert type", "Ringer mode"].map((label, index) => ({
    evidence_record_id: `content-context-${index}`, evidence_kind: "context" as const,
    evidence_role: "recorded" as const, observed_property: label,
    context_sampling_boundary: "source_unreported" as const,
    evidence_value_json: index === 3 ? "null" : index === 4 ? '["LED"]' : index === 5 ? '"LED"' : "false",
    ...(index < 2 ? { lookback: "last one minute" } : {}), source_locators: [contentLocator],
  })));
  input.notification_histories.push(contentHistory, {
    ...structuredClone(contentHistory), notification_history_id: "example-content-no-context",
    notification_item_id: "example-content-no-context-item", app_package_name: null,
    notification_title: null, notification_evidence: [],
  });
  return input;
}

// Participant/title annotations are shared references, not notification-item
// deduplication or permanent categories. Supplied arrival locations/categories
// below are constructed witnesses; no GPS join or classifier runs on import.
export function notificationTitleAnnotationExample() {
  const source = notificationContextExample();
  const profile = structuredClone(source.profiles[1]!);
  profile.method_profile_id = "example:notification-title-annotation";
  profile.source_method_variant_id = "source-derived-title-annotation-example";
  const locator = "Content-driven notifications PDF p.4 Dataset/right column/footnote2 and p.5 location paragraph; primary PDF SHA256 a2f6364d8e10e4f4925dd30eb9060b74c25b733bf5424a4d66a7ccad2f96f548";
  profile.source_locators = [locator];
  profile.method_settings[0] = { ...profile.method_settings[0]!, method_setting_id: "example:participant-title-label-resolution",
    source_extraction_id: "example:content:p4:title-label-resolution", method_parameter_key: "notification.title_label_resolution",
    method_setting_role: "feature_engineering", method_target_layer: "derived_feature",
    method_value_json: JSON.stringify({ participant_scoped_title_labels: true, title_list_deduplicated_not_items: true,
      workplace: ["work", "social", "family"], home: ["social", "family", "work"], other: ["family", "social", "work"],
      title_matching: null, arrival_location_join: null, unranked_other_policy: null }), source_locators: [locator] };
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example-participant", source_locators: [locator] };
  const notification_title_annotations = [
    { ...owner, title_annotation_id: "example-shared-title", annotation_record_origin: "analyst_constructed_example",
      notification_title: "example-sender", sender_relationship_labels: ["work", "social"] },
    { ...owner, participant_id: "another-participant", title_annotation_id: "example-shared-title",
      annotation_record_origin: "analyst_constructed_example", notification_title: "example-sender", sender_relationship_labels: ["family"] },
    { ...owner, title_annotation_id: "example-unranked-label", annotation_record_origin: "analyst_constructed_example",
      notification_title: null, sender_relationship_labels: ["work", "other"] },
  ];
  const notification_histories = [
    ["workplace", "work", owner.participant_id, "example-shared-title"],
    ["home", "social", owner.participant_id, "example-shared-title"],
    ["home", "family", "another-participant", "example-shared-title"],
    [null, null, owner.participant_id, "example-unranked-label"],
  ].map(([place, category, participant, annotation], index) => ({
    ...owner, participant_id: participant!, notification_history_id: `example-title-history-${index}`,
    notification_item_id: `example-title-item-${index}`, history_record_origin: "analyst_constructed_example",
    notification_title: index === 3 ? null : "example-sender", title_annotation_reference: annotation!,
    notification_evidence: [
      { evidence_record_id: "arrival-location", evidence_kind: "context", evidence_role: "inferred",
        observed_property: "arrival location class", context_sampling_boundary: "source_unreported",
        evidence_value_json: JSON.stringify(place), evidence_basis: "supplied arrival class; questionnaire-time GPS join unreported", source_locators: [locator] },
      { evidence_record_id: "selected-category", evidence_kind: "category", evidence_role: "inferred",
        evidence_value_json: JSON.stringify(category), evidence_references: ["arrival-location"],
        evidence_basis: "supplied item category linked to owning title annotation; import does not resolve labels", source_locators: [locator] },
    ],
  }));
  return { profiles: [profile], notification_title_annotations, notification_histories };
}

// Analyst-normalized relationships, not the paper's raw keys, pending matcher
// or participant rows. Opening is not process launch or proof of reading.
export function notificationOpeningExample() {
  const source = notificationHistoryExample();
  const profile = source.profiles[0]!;
  const work = "doi:10.1145/2628363.2628364";
  const locator = "In-Situ notifications PDF p.4 Notification Viewed; primary PDF SHA256 587e51fcb0394da2cb7133e08c65dbef82bf1f9f43807c9072c30a0580e1d721";
  profile.method_profile_id = "example:shared-notification-opening";
  profile.source_work_id = work;
  profile.source_method_variant_id = "source-derived-shared-opening-example";
  profile.source_locators = [locator];
  profile.method_settings[0] = { ...profile.method_settings[0]!, source_work_id: work,
    method_setting_id: "example:opening-bulk-view", source_extraction_id: "example:in-situ:p4:bulk-view",
    method_parameter_key: "notification.opening_bulk_view", method_target_layer: "notification_attendance",
    method_value_json: JSON.stringify({ app_opening: "pending notifications associated with app",
      drawer_opening: "pending notifications shown in drawer", raw_item_key: null, pending_matcher: null,
      import_computes_views: false }), source_locators: [locator] };
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: work,
    participant_id: "example-participant", device_id: "example-device", source_locators: [locator] };
  const notification_histories: NotificationHistoryRecord[] = [1, 2, 3].map((n) => ({
    ...owner, notification_history_id: `example-history-${n}`, notification_item_id: `example-item-${n}`,
    history_record_origin: "analyst_constructed_example", app_package_name: n === 3 ? "example.other.app" : "example.notification.app",
    notification_evidence: [{ evidence_record_id: "supplied-view", evidence_kind: "assumed_seen", evidence_role: "inferred",
      evidence_instant: "supplied-view-time", evidence_basis: "supplied opening proxy; not observed reading",
      opening_occurrence_reference: n === 3 ? "drawer-opening" : "app-opening-1", source_locators: [locator] }],
  }));
  notification_histories[0]!.notification_evidence.push({
    evidence_record_id: "second-supplied-view", evidence_kind: "seen_latency", evidence_role: "inferred",
    evidence_value_json: "0.00", evidence_unit: null, opening_occurrence_reference: "app-opening-2", source_locators: [locator],
  });
  const occurrence = { ...owner, opening_record_origin: "analyst_constructed_example" as const,
    occurrence_instant: "equal-supplied-opening-time", opening_kind: "app_opening" as const, app_package_name: "example.notification.app" };
  const notification_opening_occurrences: NotificationOpeningOccurrenceRecord[] = [
    { ...occurrence, opening_occurrence_id: "app-opening-1", pending_history_references: ["example-history-2", "example-history-1"] },
    { ...occurrence, opening_occurrence_id: "app-opening-2", pending_history_references: ["example-history-1"] },
    { ...owner, opening_record_origin: "analyst_constructed_example", opening_occurrence_id: "drawer-opening",
      opening_kind: "drawer_opening", pending_history_references: ["example-history-1", "example-history-3"] },
    { ...occurrence, opening_occurrence_id: "empty-membership", pending_history_references: [] },
    { ...owner, device_id: null, opening_record_origin: "analyst_constructed_example", opening_occurrence_id: "unknown-membership",
      opening_kind: "app_opening", occurrence_instant: null, app_package_name: null, pending_history_references: null },
    { ...owner, opening_record_origin: "analyst_constructed_example", opening_occurrence_id: "omitted-membership", opening_kind: "drawer_opening" },
  ];
  return { profiles: [profile], notification_histories, notification_opening_occurrences };
}

// Explicitly supplied prior-day identity, not inferred from the next-morning
// diary request or a submission timestamp. Values/keys are analyst examples.
export function notificationParticipantDayExample() {
  const profile = notificationOpeningExample().profiles[0]!;
  const locator = "In-Situ notifications PDF pp.3-4 Procedure/Diary and p.6 Qualitative Results from Diary; primary PDF SHA256 587e51fcb0394da2cb7133e08c65dbef82bf1f9f43807c9072c30a0580e1d721";
  profile.method_profile_id = "example:notification-participant-day";
  profile.source_method_variant_id = "source-derived-participant-day-example";
  profile.source_locators = [locator];
  profile.method_settings[0] = { ...profile.method_settings[0]!,
    method_setting_id: "example:objective-subjective-day-join", source_extraction_id: "example:in-situ:p6:day-join",
    method_parameter_key: "diary.objective_subjective_day_join", method_setting_role: "analysis", method_target_layer: "participant_day",
    method_value_json: JSON.stringify({ objective_and_subjective_same_referenced_day: true,
      original_day_key: null, cutoff_timezone: null, import_computes_join_or_correlation: false }), source_locators: [locator] };
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example-participant", referenced_day_token: "example:prior-day-1-not-a-date",
    day_record_origin: "analyst_constructed_example" as const, source_locators: [locator] };
  const participant_day_observations: ParticipantDayObservationRecord[] = [
    { ...owner, day_observation_id: "daily-email-count", day_observation_kind: "objective_aggregate",
      observed_property: "daily email notification count", observation_category: "Email", day_observation_value_json: "0", evidence_unit: "notifications" },
    { ...owner, day_observation_id: "daily-messenger-count", day_observation_kind: "objective_aggregate",
      observed_property: "daily messenger notification count", observation_category: "Messengers", day_observation_value_json: "0.00", evidence_unit: null },
    { ...owner, day_observation_id: "reported-stress", day_observation_kind: "subjective_response",
      observed_property: "reported stress", day_observation_value_json: '"example stress answer; wording unrecovered"',
      aggregate_observation_references: ["daily-messenger-count", "daily-email-count"] },
    { ...owner, day_observation_id: "relative-email-volume", day_observation_kind: "subjective_response",
      observed_property: "perceived volume relative to usual", observation_category: "Email", day_observation_value_json: '"don\'t know"',
      aggregate_observation_references: ["daily-email-count"] },
    { ...owner, referenced_day_token: "example:prior-day-2-not-a-date", day_observation_id: "daily-email-count",
      day_observation_kind: "objective_aggregate", observed_property: "daily email notification count", day_observation_value_json: "null" },
    { ...owner, referenced_day_token: "example:prior-day-2-not-a-date", day_observation_id: "reported-stress",
      day_observation_kind: "subjective_response", observed_property: "reported stress", day_observation_value_json: null,
      aggregate_observation_references: null },
    { ...owner, participant_id: "another-participant", day_observation_id: "daily-email-count",
      day_observation_kind: "objective_aggregate", observed_property: "daily email notification count", observation_category: null },
    { ...owner, referenced_day_token: "example:prior-day-2-not-a-date", day_observation_id: "unlinked-answer",
      day_observation_kind: "subjective_response", observed_property: "example subjective property", day_observation_value_json: "false",
      questionnaire_item_label: null },
    { ...owner, day_observation_id: "explicit-empty-supports", day_observation_kind: "subjective_response",
      observed_property: "example subjective property", day_observation_value_json: "0", aggregate_observation_references: [] },
  ];
  return { profiles: [profile], participant_day_observations };
}
