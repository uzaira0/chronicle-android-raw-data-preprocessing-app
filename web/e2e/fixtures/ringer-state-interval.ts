import type { StudyMethodProfile, TaskOccurrenceRecord } from "../../src/lib/methodProfiles";

// Analyst-normalized examples, not Chang's unreleased logs or constructor output.
export function ringerStateIntervalExample(profile: StudyMethodProfile) {
  const policy = (profile.session_construction_policies as Array<Record<string, unknown>>)
    .find((row) => row.session_output_layer === "device_setting_state_interval")!;
  const common = {
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example-participant", interval_record_origin: "analyst_constructed_example",
    session_construction_policy_reference: policy.session_construction_policy_id as string,
    source_locators: policy.source_locators as string[],
  };
  return { profiles: [profile], ringer_state_intervals: [
    { ...common, ringer_state_interval_id: "example-silent", ringer_mode: "Silent",
      denotes_interval: { start_instant: "2026-01-01T12:00:00Z", end_instant: "2026-01-01T12:10:00Z" } },
    { ...common, ringer_state_interval_id: "example-normal", ringer_mode: "Normal",
      denotes_interval: { start_instant: "2026-01-01T12:10:00Z", end_instant: "2026-01-01T12:20:00Z", duration_seconds: null } },
    { ...common, ringer_state_interval_id: "example-vibrate", ringer_mode: "Vibrate",
      denotes_interval: { start_instant: "2026-01-01T12:20:00Z", end_instant: null } },
  ] };
}

// Constructed normalized CSV. Physical data row 2 is deliberately all-empty.
// Source-row references belong to this exact artifact; opaque/contradictory
// clocks below are never used to infer lastness, latency or grouping.
export const suppliedCommunicationCsv = [
  "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone,communication_modality,communication_direction,communication_peer_id,sms_response_to_source_row,communication_conversation_id,sms_response_latency_seconds,communication_state",
  "Communication proof,example-participant,Example,Messages,Activity Resumed,example.messages,2026-01-01 12:00:01,UTC,sms,received,peer-one,,conversation-one,,new",
  ",,,,,,,,,,,,,,",
  "Communication proof,example-participant,Example,Messages,Activity Paused,example.messages,2026-01-01 12:00:00,UTC,sms,sent,peer-one,1,conversation-one,17.500,chat",
  "Communication proof,example-participant,Example,Messages,Activity Resumed,example.messages,2026-01-01 12:00:02,UTC,sms,received,peer-two,,conversation-two,,new",
  "Communication proof,example-participant,Example,Messages,Activity Paused,example.messages,2026-01-01 12:00:03,UTC,sms,sent,,4,conversation-two,0,chat",
].join("\n") + "\n";

export function communicationQuestionnaireExample(profile: StudyMethodProfile): { profiles: StudyMethodProfile[]; task_occurrences: TaskOccurrenceRecord[] } {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing admitted communication setting " + key);
    return found;
  };
  const locator = profile.source_work_id === "doi:10.1007/978-3-642-37210-0_6"
    ? "de-montjoye-2013-author.pdf SHA256:239a23caebc02f3d81d16442c5dbb28984a1594a99bce820028f7038481ff8d2; text220–226,243–266; constructed supplied BFI occasions, not original item wording, response codes, scoring, cutpoints or message selection"
    : "chang-tang-ringer-2015.pdf SHA256:260111cdcce42dac583e9edc6f78507ea3ceb92776559c1f2447588a3c62b9cd; printedpp8–12/PDFpp3–7; retrospective event context only, not immediate ESM or a selected original event";
  const common = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example-participant", record_origin: "analyst_constructed_example" as const, source_locators: [locator] };
  const answer = (id: string, key: string, label: string, value?: string | null) => ({
    questionnaire_response_id: id, questionnaire_setting_reference: setting(key).method_setting_id,
    observed_property: label, ...(value !== undefined ? { response_value_json: value } : {}), source_locators: [locator],
  });
  if (profile.source_work_id === "doi:10.1007/978-3-642-37210-0_6") {
    return { profiles: [profile], task_occurrences: ["A", "B"].map((occasion, index) => ({
      ...common, task_occurrence_id: "BFI-" + occasion, task_label: "Independent BFI completion " + occasion,
      task_questionnaire_responses: Array.from({ length: 44 }, (_, i) => answer(occasion + "-item-" + (i + 1), "outcome.bfi44_instrument", "ordinal item " + (i + 1), String((i + index) % 5 + 1))),
      criterion_assessments: [
        ...["neuroticism", "extraversion", "openness", "conscientiousness", "agreeableness"].map((trait, i) => ({
          criterion_assessment_id: occasion + "-" + trait, criterion_setting_reference: setting("outcome.five_traits").method_setting_id,
          criterion_label: trait, assessment_value_json: String(i + 0.25 + index), source_locators: [locator],
        })),
        { criterion_assessment_id: occasion + "-class", criterion_setting_reference: setting("outcome.three_class_labels").method_setting_id,
          criterion_label: "neuroticism class", assessment_value_json: JSON.stringify(index ? "high" : "low"), source_locators: [locator] },
      ],
    })) };
  }
  const diary = {
    ...common, task_occurrence_id: "retrospective-diary", task_label: "End-of-day retrospective email diary",
    task_actions: ["ringer change", "missed call", "unread-notification interval over one hour"].map((label, i) => ({
      task_action_id: "diary-event-" + i, action_label: label, source_locators: [locator],
    })),
    task_questionnaire_responses: [
      { ...answer("ringer-reason", "diary.retrospective_event_index", "reason for ringer change", JSON.stringify("supplied reason")), support_task_action_references: ["diary-event-0"] },
      { ...answer("missed-reason", "diary.retrospective_event_index", "reason for missed call", null), support_task_action_references: ["diary-event-1"] },
      { ...answer("unread-reason", "diary.retrospective_event_index", "reason for unread notification"), support_task_action_references: ["diary-event-2"] }, // omitted, not a negative
    ],

  };
  const feedback = { ...common, task_occurrence_id: "poststudy-feedback", task_label: "Separate post-study survey/interview feedback",
    task_questionnaire_responses: [answer("feedback", "analysis.qualitative_coding", "experience with ringer-mode use", JSON.stringify("supplied open-ended feedback"))] };
  return { profiles: [profile], task_occurrences: [diary, feedback] };
}

export function ringerCommunicationExample(profile: StudyMethodProfile) {
  const input = ringerStateIntervalExample(profile);
  const setting = (key: string) => profile.method_settings.find(s => s.method_parameter_key === key)!;
  const locators = ["Chang and Tang printedpp9,12/PDFpp4,7; constructed supplied occupancy actions/gaps/means, not reconstructed records, complete action coverage, SMS reading or arithmetic"];
  const actions = (prefix: string) => [
    { task_action_id: prefix + "-wake", action_label: "waking/unlocking phone", source_locators: locators },
    { task_action_id: prefix + "-select", action_label: "pulling down notification bar or selecting notifications", source_locators: locators },
    { task_action_id: prefix + "-compose", action_label: "composing outgoing messages in the same communication app that generated the notification", app_identifier: "example.messages", source_locators: locators },
  ];
  const quantity = (id: string, key: string, property: string, value?: string | null) => ({
    quantity_record_id: id, quantity_setting_reference: setting(key).method_setting_id, quantity_scope: "session" as const,
    observed_property: property, ...(value !== undefined ? { evidence_value_json: value } : {}), source_locators: locators,
  });
  const intervals = input.ringer_state_intervals.map((interval, i) => ({
    ...interval,
    ...(i === 0 ? {
      session_actions: actions("silent"),
      session_quantities: [
        { ...quantity("zero-gap", "feature.general_attentiveness_gap", "attending-action interval", "0"), evidence_unit: "minutes", start_action_reference: "silent-wake", end_action_reference: "silent-select" },
        { ...quantity("second-gap", "feature.general_attentiveness_gap", "attending-action interval", "17.500"), evidence_unit: "minutes", start_action_reference: "silent-select", end_action_reference: "silent-compose" },
        { ...quantity("supplied-mean", "feature.within_ringer_interval_attendance", "mean attending-action interval", "6.250"), evidence_unit: "minutes" },
        { ...quantity("ordinal-code", "feature.attendance_bins", "attendance code", "3"), start_action_reference: "silent-wake", end_action_reference: "silent-select" },
      ],
    } : i === 1 ? { session_actions: actions("normal"), session_quantities: [
      { ...quantity("unknown-gap", "feature.general_attentiveness_gap", "attending-action interval", null), start_action_reference: null },
      quantity("unknown-mean", "feature.within_ringer_interval_attendance", "mean attending-action interval"),
    ] } : { session_actions: [], session_quantities: [] }),
  }));
  const sampledCommon = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "example-participant",
    record_origin: "analyst_constructed_example" as const, observed_entity_kind: "device" as const, device_id: "constructed-device", source_locators: locators };
  const observed = (id: string, key: string, quantities: Array<{ observed_property: string; evidence_value_json?: string | null; evidence_unit?: string | null }>, refs?: Array<{ relationship_label: string; sampled_observation_reference?: string | null; source_locators: string[] }>) => ({
    ...sampledCommon, sampled_observation_id: id, method_setting_reference: setting(key).method_setting_id,
    observation_instant: "opaque collection " + id, source_event_time_token: "opaque event " + id, quantities,
    ...(refs !== undefined ? { sampled_observation_references: refs } : {}),
  });
  const q = (property: string, value: unknown) => ({ observed_property: property, evidence_value_json: JSON.stringify(value) });
  const link = (role: string, target: string) => ({ relationship_label: role, sampled_observation_reference: target, source_locators: locators });
  const incoming = observed("incoming", "collector.communication_and_ringer_events", [q("event", "incoming SMS"), q("contact", "peer-one"), q("communication app", "example.messages")]);
  const outgoing = observed("outgoing", "collector.communication_and_ringer_events", [q("event", "outgoing SMS"), q("contact", "peer-one")]);
  const ui = observed("ui", "collector.accessibility_action_stream", [q("action", "typing"), q("communication app", "example.messages")]);
  const attending = observed("attending", "feature.attending_action_set", [q("attending action", "composing outgoing messages in the same communication app that generated the notification"), q("communication app", "example.messages")], [link("observed action", "ui")]);
  const snapshot = observed("snapshot", "acquisition.target_event_snapshot", [
    q("location", "opaque supplied GPS context"), q("Google activity recognition", "on foot"), q("sensors", "opaque sensor context"),
    q("network", "opaque network context"), q("calendar", null), q("ringer mode", "Silent"), q("screen on/off", "screen on"),
    q("currently running application", "example.messages"),
  ], [link("target event", "incoming")]);
  const proxy = observed("proxy", "feature.sms_notification_first_action", [{ ...q("SMS-specific attending interval", 17.5), evidence_unit: "minutes" }],
    [link("incoming SMS notification", "incoming"), link("first later attending action", "attending")]);
  const response = observed("response", "outcome.same_contact_sms_response", [q("responded", true)], [link("incoming SMS", "incoming"), link("outgoing SMS", "outgoing")]);
  const locale = observed("locale", "preparation.participant_locale_annotation", [q("semantic locale", "Home")], [link("location snapshot", "snapshot")]);
  return { profiles: [profile], ringer_state_intervals: intervals, sampled_quantity_observations: [incoming, outgoing, ui, attending, snapshot, proxy, response, locale],
    task_occurrences: communicationQuestionnaireExample(profile).task_occurrences };
}

/** Supplied normalized GPS, place, per-user features and contact annotations; never recovered study rows. */
export function communicationFeatureExample(profile: StudyMethodProfile): {
  profiles: StudyMethodProfile[]; sampled_quantity_observations: import("../../src/lib/methodProfiles").SampledQuantityObservationRecord[];
  participant_day_observations: import("../../src/lib/methodProfiles").ParticipantDayObservationRecord[];
  task_occurrences: TaskOccurrenceRecord[];
} {
  const sms = profile.source_work_id === "doi:10.1007/978-3-642-37210-0_6";
  if (!sms && profile.source_work_id !== "doi:10.1145/2785830.2785852") throw new Error("Not a reviewed communication source");
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing communication feature definition: " + key);
    return found;
  };
  const source = sms
    ? "de-montjoye-2013-author.pdf SHA256:239a23caebc02f3d81d16442c5dbb28984a1594a99bce820028f7038481ff8d2; text207–236/Table1 physicalp6"
    : "chang-tang-ringer-2015.pdf SHA256:260111cdcce42dac583e9edc6f78507ea3ceb92776559c1f2447588a3c62b9cd; printedp7/PDFp2, printedpp9,12";
  const limits = "Constructed supplied ownership and values, not original source rows/serializer, inferred contact/GPS joins, ordering, lastness, latency, coordinate conversion, 50m grouping, 15min dwell, daily endpoints, entropy/AR fitting or BFI scoring. The explicit SMS latency bound is <=1h; matching eligibility at exactly1h, raw clocks and ties are not reconstructed. Methods phi18 is distinct from its absence in Table1. Contact closeness is not asked.";
  const common = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:communication-person", device_id: "constructed:communication-phone", record_origin: "analyst_constructed_example" as const };
  const q = (observed_property: string, value?: string | null) => ({ observed_property, ...(value === undefined ? {} : { evidence_value_json: value }) });
  const row = (key: string, id: string, observed_entity_kind: "place" | "participant" | "device", quantities: ReturnType<typeof q>[]): import("../../src/lib/methodProfiles").SampledQuantityObservationRecord => ({
    ...common, sampled_observation_id: id, method_setting_reference: setting(key).method_setting_id, observed_entity_kind,
    observed_entity_token: id + ":subject", quantities, source_locators: [...setting(key).source_locators as string[], source, limits],
  });
  if (!sms) {
    const event = row("collector.communication_and_ringer_events", "constructed:contact-event", "device", [q("event", '"incoming SMS"'), q("contact", '"supplied-contact-hash"')]);
    const annotation = row("preparation.contact_anonymization", "constructed:contact-annotation", "device", [
      q("recorded contact", '"supplied-contact-hash"'), q("hashed contact label", '"supplied-label-hash"'),
      q("hashed phone number", null), q("relationship label", '"friend"'),
    ]);
    annotation.sampled_observation_references = [{ relationship_label: "recorded contact event",
      sampled_observation_reference: event.sampled_observation_id, source_locators: [source, "Explicit supplied annotation→recorded event support; no hash recovery or matching algorithm"] }];
    return { profiles: [profile], sampled_quantity_observations: [event, annotation], participant_day_observations: [], task_occurrences: [] };
  }
  const a = row("schema.gps_points", "constructed:GPS-A", "place", [q("latitude", "10.125"), q("longitude", null)]);
  a.source_event_time_token = "opaque-source-GPS-time-A"; a.observation_instant = "opaque-collection-A";
  const b = row("schema.gps_points", "constructed:GPS-B", "place", [q("latitude", '"unconverted-source-token"'), q("longitude")]);
  const center = row("feature.place_center", "constructed:place-center", "place", [q("latitude", "0.00"), q("longitude", "null")]);
  center.sampled_observation_references = [a, b].map(point => ({ relationship_label: "contributing GPS point",
    sampled_observation_reference: point.sampled_observation_id, source_locators: [source, "Supplied point membership only; no grouping, proximity, dwell or averaging executed"] }));
  const metrics = profile.method_settings.filter(s => String(s.method_parameter_key).startsWith("feature.metric.")).map((s, i) => {
    const value: unknown = JSON.parse(String(s.method_value_json));
    const body = typeof value === "object" && value !== null && "definition" in value ? (value as { definition: { label: string } }).definition : value as { label: string };
    return row(String(s.method_parameter_key), "constructed:metric-" + i, "participant", [q(body.label, i === 0 ? "0.00" : i === 1 ? null : i === 2 ? undefined : String(i))]);
  });
  const ar = row("feature.ar_disclosed_coefficients", "constructed:AR-coefficients", "participant",
    ["phi1", "phi4", "phi8", "phi12", "phi18", "phi24"].map((coefficient, i) => q(coefficient, i === 4 ? "-0.25" : "0.00")));
  const participant_day_observations: import("../../src/lib/methodProfiles").ParticipantDayObservationRecord[] = ["radius of the smallest circle containing all places visited", "sum of distances between consecutive places"].map((observed_property, i) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: common.participant_id, device_id: common.device_id,
    day_observation_id: "constructed:spatial-day-" + i, referenced_day_token: "opaque-supplied-day", day_record_origin: "analyst_constructed_example",
    day_observation_kind: "objective_aggregate", observed_property, day_observation_value_json: i ? "0.00" : null, source_locators: [source, limits],
  }));
  return { profiles: [profile], sampled_quantity_observations: [a, b, center, ...metrics, ar], participant_day_observations,
    task_occurrences: communicationQuestionnaireExample(profile).task_occurrences };
}

if (process.argv.includes("--emit-fixture-json")) {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { parseStudyMethodProfileLibrary } = await import("../../src/lib/methodProfiles");
  const canonical = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../.tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: unknown[] };
  const profiles = parseStudyMethodProfileLibrary(canonical).profiles;
  console.log(JSON.stringify([
    ringerCommunicationExample(profiles.find(p => p.source_work_id === "doi:10.1145/2785830.2785852")!),
    communicationQuestionnaireExample(profiles.find(p => p.source_work_id === "doi:10.1007/978-3-642-37210-0_6")!),
  ]));
}
