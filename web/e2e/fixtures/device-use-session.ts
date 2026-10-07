import type { StudyMethodProfile, DeviceSessionLabelRecord, DeviceUseSessionRecord, SessionQuantityRecord, TaskActionRecord, SampledQuantityObservationRecord, TaskOccurrenceRecord } from "../../src/lib/methodProfiles";

export function apnomsDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => profile.method_settings.find(s => s.method_parameter_key === key)!;
  const source = (key: string) => [...setting(key).source_locators as string[], "Constructed independent supplied interval; no recovered raw boundaries, clock, state allocation, charge/change equivalence or snapshot join"];
  const keys = ["reconstruction.network_session_scope", "reconstruction.network_session_scope", "reconstruction.network_session_scope", "reconstruction.battery_interval_definition", "reconstruction.battery_interval_definition", "reconstruction.battery_change_interval"];
  const device_use_sessions: DeviceUseSessionRecord[] = keys.map((key, index) => ({
    device_use_session_id: `constructed:apnoms-interval-${index}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:apnoms-participant", device_id: "example:apnoms-phone", record_origin: "analyst_constructed_example",
    method_setting_reference: setting(key).method_setting_id, source_locators: source(key),
    denotes_interval: index === 5 ? { start_instant: null, end_instant: null, duration_seconds: 90000 } : { duration_seconds: [12.5, 0, 8, 3600, 7200][index]! },
    ...(index === 0 ? { start_condition: null, end_condition: null } : {}),
    session_labels: index === 5 ? null : [{ label_record_id: "supplied-kind", label_setting_reference: setting(index < 3 ? key : "schema.battery_plugged_vocabulary").method_setting_id,
      observed_property: index < 3 ? "network modality" : "charging power source", label_value_json: JSON.stringify(["voice call", "3G", "Wi-Fi", "AC", "USB"][index]), source_locators: source(key) }],
    ...(index < 3 ? {} : { session_quantities: ["start", "end"].map((endpoint, i) => ({
      quantity_record_id: `supplied-${endpoint}`, quantity_setting_reference: setting(`reconstruction.${endpoint}_battery_level`).method_setting_id,
      quantity_scope: "session", observed_property: `${endpoint} battery level`, evidence_unit: "percent",
      ...(index === 5 ? i === 0 ? { evidence_value_json: null } : {} : { evidence_value_json: ["60.00", "40.00"][i] }),
      source_locators: source(`reconstruction.${endpoint}_battery_level`),
    })) }),
  }));
  // Decreasing supplied levels deliberately do not turn import into charging arithmetic.
  return { profiles: [profile], device_use_sessions };
}

export function mommDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error(`Missing MOMM definition: ${key}`);
    return found;
  };
  const source = (key: string) => [...setting(key).source_locators as string[], "Constructed normalized record; not a recovered participant/device ID, event reconstruction, context matching or duration calculation"];
  const label = (key: string, observed_property: string, value: string): DeviceSessionLabelRecord => ({
    label_record_id: key, label_setting_reference: setting(key).method_setting_id,
    observed_property, label_value_json: JSON.stringify(value), source_locators: source(key),
  });
  const device_use_sessions: DeviceUseSessionRecord[] = ([
    ["locked", "home", 90.5], ["unlocked", "office", 17.5], ["locked", "other meaningful", 0], ["unlocked", "elsewhere", 22.4],
  ] as const).map(([kind, context, duration], index) => ({
    device_use_session_id: `constructed:momm-session-${index}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: index < 2 ? "constructed:phone-participant" : "constructed:tablet-participant", device_id: index < 2 ? "constructed:phone" : "constructed:tablet",
    record_origin: "analyst_constructed_example", method_setting_reference: setting("session.call_aware_constructor").method_setting_id,
    denotes_interval: { duration_seconds: duration }, ...(index === 0 ? { start_condition: null, end_condition: null } : {}),
    source_locators: source("session.call_aware_constructor"),
    session_labels: [label("session.locked_unlocked_meaning", "session kind", kind), label("context.session_assignment", "session context", context)],
    ...(index === 0 ? { session_questionnaire_responses: null } : index === 1 ? { session_questionnaire_responses: [] } : {}),
  }));
  for (const index of [0, 1]) device_use_sessions[index]!.session_actions = ["screen|power (off)", "screen|power (on)", "screen|power (off)", "screen|power (on)"].map((action_label, i) => ({
    task_action_id: `supplied-call-event-${i}`, action_label, assigned_role_labels: [index === 0 ? "locked, active call" : "unlocked, call"],
    source_locators: [...source("session.call_aware_constructor"), "Supplied active-call members stay in this session; not inferred event pairing or transition execution"],
  }));
  device_use_sessions[0]!.session_actions!.push({ task_action_id: "supplied-authentication-interval", action_label: "authentication timer",
    assigned_role_labels: ["authentication interval"], denotes_interval: { duration_seconds: 2.5 },
    source_locators: [...source("analysis.unlock_measure"), "Supplied authentication interval, not pure credential input or assumed screen-on origin"] });
  device_use_sessions[2]!.session_actions = []; device_use_sessions[3]!.session_actions = null;
  return { profiles: [profile], device_use_sessions };
}

export function vanBerkelDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => {
    const result = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!result) throw new Error(`Missing Van Berkel definition: ${key}`);
    return result;
  };
  const constructor = setting("session.base_T0"), question = setting("diary.item_and_options"), encoding = setting("diary.session_outcome_encoding");
  const locator = "Van Berkel CHI2016 pp4-5 Analysis and pp9-10 Discussion/Limitations; primary SHA256:dc96c062227304428722832c0423f4207d501185777083fca612193e7d6e2982; constructed normalized records, not recovered data, reconstructed boundaries, label scoring or classifier output; Day/Hour encoding and app-category identities are analyst-supplied";
  const rows: DeviceUseSessionRecord[] = [1, 0, 0, 1].map((label, index) => ({
    device_use_session_id: `constructed:T0-${index}`, method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id, participant_id: "constructed:van-participant", device_id: "constructed:van-device",
    record_origin: "analyst_constructed_example", method_setting_reference: constructor.method_setting_id,
    denotes_interval: { duration_seconds: [17.5, 4, 8, 0][index]!, ...(index === 0 ? { start_instant: null, end_instant: null } : {}) },
    following_device_use_session_reference: index < 3 ? `constructed:T0-${index + 1}` : null,
    source_locators: [locator],
    session_actions: ["app-A", "app-B", "app-A"].map((app, ordinal) => ({
      task_action_id: `app-member-${ordinal}`, app_identifier: app, source_locators: [locator],
    })),
    session_questionnaire_responses: [{ questionnaire_response_id: `onset-answer-${index}`,
      questionnaire_setting_reference: question.method_setting_id, observed_property: "present onset objective",
      questionnaire_item_label: "Why did you start using your phone?",
      response_value_json: JSON.stringify(label ? "Start on a new objective" : "Continue previous objective"), source_locators: [locator] }],
    session_labels: [{ label_record_id: "supplied-onset-label", label_setting_reference: encoding.method_setting_id,
      observed_property: "participant-supplied continuation/new label", label_value_json: JSON.stringify(label),
      questionnaire_response_references: [`onset-answer-${index}`], source_locators: [locator] }],
    session_quantities: [
      ["feature.application_set", "Application pattern", '["app-A","app-B"]'],
      ["feature.category_set", "Categories pattern", '["constructed:category-A","constructed:category-B"]'],
      ["feature.weekday", "Day", '"Monday"'], ["feature.hour", "Hour", '"14"'],
      ["feature.intersession_gap", "Gap", JSON.stringify([null, 45000, 0, 15000][index])],
    ].map(([key, property, value]) => ({ quantity_record_id: key!, quantity_setting_reference: setting(key!).method_setting_id,
      quantity_scope: "session", observed_property: property!, evidence_value_json: value!,
      ...(key === "feature.intersession_gap" ? { evidence_unit: "milliseconds" } : {}), source_locators: [locator] })),
  }));
  for (const row of rows) row.session_actions!.push({ task_action_id: "esm-status-reply", action_label: "reply", assigned_role_labels: ["ESM status"], source_locators: setting("diary.statuses").source_locators as string[] });
  rows[3]!.following_device_use_session_reference = "constructed:T0-4";
  for (const [index, status] of ["ignore", "dismiss"].entries()) {
    const row: DeviceUseSessionRecord = {
      ...rows[0]!, device_use_session_id: `constructed:T0-${index + 4}`,
      following_device_use_session_reference: index === 0 ? "constructed:T0-5" : null,
      denotes_interval: null, session_questionnaire_responses: null, session_labels: null, session_quantities: null,
      session_actions: [{ task_action_id: `esm-status-${status}`, action_label: status, assigned_role_labels: ["ESM status"],
        source_locators: [...setting("diary.statuses").source_locators as string[], "Constructed supplied status membership, not a recovered status code, session join or continuation label"] }],
    };
    if (index === 1) {
      delete row.denotes_interval; delete row.session_questionnaire_responses; delete row.session_labels; delete row.session_quantities;
    }
    rows.push(row);
  }
  return { profiles: [profile], device_use_sessions: rows };
}

// Analyst-constructed normalized records, not recovered rows, a session
// constructor, ESM scheduling, label scoring or scientific reproduction.
export function deviceUseSessionExample(profile: StudyMethodProfile) {
  const definition = (key: string) => {
    const setting = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!setting) throw new Error(`Missing Rabbit source definition: ${key}`);
    return setting;
  };
  const constructor = definition("session.constructor");
  const instrument = definition("diary.lock_short_instrument");
  const original = definition("labels.original");
  const revised = definition("labels.revised_definition");
  const source = (setting: typeof constructor) => setting.source_locators as string[];
  const session = {
    device_use_session_id: "constructed-session", method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id, participant_id: "constructed-participant",
    record_origin: "analyst_constructed_example" as const, method_setting_reference: constructor.method_setting_id,
    start_condition: "ON_USERPRESENT", end_condition: "OFF_LOCKED",
    denotes_interval: { start_instant: "supplied-start-token", end_instant: null },
    source_locators: source(constructor),
    session_questionnaire_responses: [
      { questionnaire_response_id: "answer-one", questionnaire_setting_reference: instrument.method_setting_id,
        observed_property: "intention deviation", response_value_json: ' "No" ', source_locators: source(instrument) },
      { questionnaire_response_id: "answer-two", questionnaire_setting_reference: instrument.method_setting_id,
        observed_property: "intention deviation", response_value_json: ' "No" ', source_locators: source(instrument) },
    ],
    session_labels: [
      { label_record_id: "original", label_setting_reference: original.method_setting_id,
        observed_property: "original intention-deviation classification", label_value_json: '"non-rabbit hole"',
        questionnaire_response_references: ["answer-two"], source_locators: source(original) },
      { label_record_id: "revised", label_setting_reference: revised.method_setting_id,
        observed_property: "revised rabbit-hole classification", label_value_json: null,
        questionnaire_response_references: null, source_locators: source(revised) },
    ] as DeviceSessionLabelRecord[],
  };
  return { profiles: [profile], device_use_sessions: [session] };
}
// Supplied normalized interval, not a recovered session or sampled-boundary inference.
export function separateDeviceSessionExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile) {
  const session = {
    device_use_session_id: "constructed-g1-session", method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id, participant_id: "constructed-participant",
    record_origin: "analyst_constructed_example" as const,
    method_setting_reference: "method-setting-4a5e3b950aabbf64714b7a36",
    start_condition: "user activates device from idle or screensaver mode",
    end_condition: "next time the phone is idle or locked again",
    denotes_interval: { start_instant: "opaque-start", end_instant: null },
    source_locators: ["Oulasvirta printed p106; primary SHA256:d44507841f0068c6a0d7c50a1d3a1129d56438cb54344c8b981236ead0424917; constructed interval, not original source row"],
    session_actions: [
      ...["app-k", "app-j", "app-k"].map((app_identifier, index) => ({ task_action_id: `launch-${index}`, app_identifier,
        action_label: "application launched", denotes_interval: { start_instant: "equal-opaque-time" },
        source_locators: ["Oulasvirta printed pp106–107; supplied order, constructed app labels and times"] })),
      { task_action_id: "non-app-action", action_label: "supplied user action", app_identifier: null,
        source_locators: ["Oulasvirta printed p106: all recorded user actions; constructed example"] },
    ] as TaskActionRecord[],
  };
  const second = { ...structuredClone(session), device_use_session_id: "constructed-g1-second", session_actions: [structuredClone(session.session_actions[0]!)] };
  return { profiles: [profile], device_use_sessions: [session, second] };
}

export function hushDeviceSessionExample(profile: StudyMethodProfile) {
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed-participant", device_id: "constructed-device", record_origin: "analyst_constructed_example" as const,
    method_setting_reference: "method-setting-8b7f49496a9d3fb73255f31f",
    source_locators: ["Hush §3.2/§6.1 rank169:198–230,463–470; constructed membership and immediate successor, not timestamp-inferred"] };
  const device_use_sessions: DeviceUseSessionRecord[] = [
    { ...owner, device_use_session_id: "off-b1", start_condition: "screen-off", end_condition: "screen-on",
      denotes_interval: { start_instant: "opaque-A", end_instant: "opaque-B" }, following_device_use_session_reference: "on-s1",
      session_actions: [{ task_action_id: "app-k-member", app_identifier: "app-k", assigned_role_labels: ["active during screen-off"], source_locators: ["Hush rank169:463–466"] }] },
    { ...owner, device_use_session_id: "on-s1", start_condition: "screen-on", end_condition: "screen-off",
      denotes_interval: { start_instant: "opaque-B", end_instant: "opaque-C" },
      session_actions: [{ task_action_id: "app-k-member", app_identifier: "app-k", assigned_role_labels: ["foreground during screen-on"], source_locators: ["Hush rank169:466–470"] }] },
    { ...owner, device_use_session_id: "on-s2", start_condition: "screen-on", end_condition: "screen-off", session_actions: [] },
  ];
  return { profiles: [profile], device_use_sessions };
}

// Supplied app membership after the paper's within-session repetition collapse;
// no raw-event pairing, app matching, event attribution or day assignment is run.
export function shinDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "session.opener")!;
  const source = ["Shin2013 primary p338–339, lines295–320; analyst-constructed normalized membership"];
  const device_use_sessions: DeviceUseSessionRecord[] = [["app-A", "app-B"], ["app-A"], []].map((apps, index) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed-participant", device_use_session_id: `constructed-shin-${index}`,
    record_origin: "analyst_constructed_example", method_setting_reference: constructor.method_setting_id,
    start_condition: "screen turns on", end_condition: "screen turns off",
    source_locators: constructor.source_locators as string[],
    session_actions: apps.map((app_identifier, i) => ({ task_action_id: `app-${i}`, app_identifier,
      assigned_role_labels: ["app use within session"], source_locators: source })),
  }));
  device_use_sessions[0]!.session_actions!.push({ task_action_id: "event-member", app_identifier: null,
    action_label: "supplied event usage", assigned_role_labels: ["event usage within session"], source_locators: source });
  return { profiles: [profile], device_use_sessions };
}

// Printed first sequence; constructed second session demonstrates the disclosed
// reset scope. IDs/membership are supplied, not reconstructed from raw logs.
export function jonesDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "session.unlock_lock")!;
  const encoding = profile.method_settings.find(s => s.method_parameter_key === "derive.FB_encoding")!;
  const device_use_sessions: DeviceUseSessionRecord[] = [
    [["Email", "F"], ["Chrome", "F"], ["Facebook", "F"], ["Chrome", "B"], ["Facebook", "B"]],
    [["Email", "F"]],
  ].map((sequence, session) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed-participant", device_id: "constructed-device",
    record_origin: "analyst_constructed_example", device_use_session_id: `constructed-jones-${session}`,
    method_setting_reference: constructor.method_setting_id, start_condition: "unlock", end_condition: "lock",
    source_locators: constructor.source_locators as string[],
    session_actions: sequence.map(([app, label], index) => ({
      task_action_id: `launch-${index}`, app_identifier: app!, action_label: "application launch",
      assigned_role_labels: [label!], source_locators: encoding.source_locators as string[],
    })),
  }));
  return { profiles: [profile], device_use_sessions };
}

// Supplied multi-app groups, not lock/unlock sessions or reconstructed durations.
export function academicDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error(`Missing academic session definition: ${key}`);
    return found;
  };
  const constructor = setting("sessions.gap");
  const device_use_sessions: DeviceUseSessionRecord[] = [["app-A", "app-B", "app-A"], ["app-B"]].map((apps, index) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed-participant", device_use_session_id: `constructed-academic-${index}`,
    record_origin: "analyst_constructed_example", method_setting_reference: constructor.method_setting_id,
    source_locators: constructor.source_locators as string[],
    session_actions: apps.map((app_identifier, action) => ({ task_action_id: `use-${action}`, app_identifier,
      action_label: "supplied app use", source_locators: constructor.source_locators as string[] })),
    session_labels: ["micro", "review", "engage"].map(band => ({
      label_record_id: band, label_setting_reference: setting(`sessions.${band}`).method_setting_id,
      observed_property: `${band} session membership`, label_value_json: index === 0 ? JSON.stringify(band === "micro") : "null",
      source_locators: setting(`sessions.${band}`).source_locators as string[],
    })),
  }));
  return { profiles: [profile], device_use_sessions };
}

export function recordedBehaviorDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "reconstruction.session_definition");
  if (!constructor) throw new Error("Missing Recorded Behavior reconstruction.session_definition");
  const device_use_sessions: DeviceUseSessionRecord[] = [45.5, 0].map((duration_seconds, index) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:recorded-behavior-participant", record_origin: "analyst_constructed_example",
    device_use_session_id: `example:active-visual-session-${index}`, method_setting_reference: constructor.method_setting_id,
    denotes_interval: { duration_seconds, ...(index === 0 ? { start_instant: "example:supplied-visual-start", end_instant: "example:supplied-visual-stop" } : { start_instant: null, end_instant: null }) },
    source_locators: ["Recorded Behavior primary134:155–167; constructed supplied active-visual session, not a recovered raw record; start/stop and duration are independent supplied fields; no exact unlock/lock boundary, app membership or weekly denominator inferred"],
  }));
  return { profiles: [profile], device_use_sessions };
}

export function appMeasuresDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "reconstruction.epoch_boundary");
  if (!constructor) throw new Error("Missing App Measures reconstruction.epoch_boundary");
  const device_use_sessions: DeviceUseSessionRecord[] = [1087, 0].map((duration_seconds, index) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:app-measures-participant", record_origin: "analyst_constructed_example",
    device_use_session_id: `example:screen-epoch-${index}`, method_setting_reference: constructor.method_setting_id,
    start_condition: "screen-on", end_condition: "screen-off",
    denotes_interval: { duration_seconds, ...(index === 0 ? { start_instant: "13:35:27", end_instant: "13:53:34" } : {}) },
    source_locators: ["App Measures lin-2017-app-measures.txt:143–174; constructed supplied whole-device epochs; first clock-only tuple reproduces Figure 1 without a date/timezone or recovered participant; independent duration, no app identity, unlock, matching or daily allocation inferred"],
  }));
  return { profiles: [profile], device_use_sessions };
}

export function cognitiveDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "session.unlock_marked_device_use");
  if (!constructor) throw new Error("Missing Cognitive Rhythms unlock marker");
  const device_use_sessions: DeviceUseSessionRecord[] = [29, 30].map((duration_seconds, index) => ({
    device_use_session_id: `example:cr-phone-${index}`, method_profile_id: profile.method_profile_id,
    source_work_id: profile.source_work_id, participant_id: "example:cr-participant", record_origin: "analyst_constructed_example",
    method_setting_reference: constructor.method_setting_id, start_condition: "unlocking the phone", denotes_interval: { duration_seconds },
    source_locators: ["Cognitive Rhythms author PDF SHA256 d843f55d340665f9fb79532e99572677595f3a26386dbc45527bdb2d3aafb329 p7; constructed supplied durations and session IDs, no closer, raw state code or short-session classification inferred"],
  }));
  device_use_sessions[0]!.end_condition = null;
  device_use_sessions[0]!.denotes_interval!.end_instant = null;
  return { profiles: [profile], device_use_sessions };
}

export function whatsappDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "session.phone_definition");
  if (!constructor) throw new Error("Missing WhatsApp session.phone_definition");
  const device_use_sessions: DeviceUseSessionRecord[] = [17.5, 0].map((duration_seconds, index) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:whatsapp-participant", record_origin: "analyst_constructed_example",
    device_use_session_id: `example:visual-phone-session-${index}`, method_setting_reference: constructor.method_setting_id,
    denotes_interval: { duration_seconds, ...(index === 0 ? { start_instant: null, end_instant: null } : {}) },
    source_locators: ["WhatsApp rank172.txt:140–165; constructed supplied uninterrupted visual-phone sessions and independent durations, not original rows; raw boundary codes/clocks, app-session membership and day assignment are not recovered"],
  }));
  return { profiles: [profile], device_use_sessions };
}

export function lonelinessDeviceSessionExample(profile: StudyMethodProfile) {
  const constructor = profile.method_settings.find(s => s.method_parameter_key === "phone.interaction_interval");
  if (!constructor) throw new Error("Missing loneliness phone.interaction_interval");
  const device_use_sessions: DeviceUseSessionRecord[] = ["off", "lock"].map((end_condition, index) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:loneliness-participant", device_id: "example:android-device",
    record_origin: "analyst_constructed_example", device_use_session_id: `example:loneliness-interaction-${index}`,
    method_setting_reference: constructor.method_setting_id, start_condition: "unlock", end_condition,
    denotes_interval: { duration_seconds: index === 0 ? 17.5 : 0 },
    source_locators: ["59-loneliness.txt:354–365; constructed supplied unlock-to-off/lock intervals and independent durations; no AWARE code-to-deployment equivalence or boundary reconstruction"],
  }));
  return { profiles: [profile], device_use_sessions };
}

export function sessionQuantityExample(profile: StudyMethodProfile) {
  const jones = profile.source_work_id === "doi:10.1145/2750858.2807542";
  const input = jones ? jonesDeviceSessionExample(profile) : deviceUseSessionExample(profile);
  const rows: DeviceUseSessionRecord[] = input.device_use_sessions;
  if (!jones) rows.push({ ...structuredClone(rows[0]!), device_use_session_id: "constructed-second-session" });
  const setting = (key: string) => profile.method_settings.find(s => s.method_parameter_key === key)!;
  const quantity = (id: string, key: string, property: string, value: string, extra: Partial<SessionQuantityRecord> = {}): SessionQuantityRecord => ({
    quantity_record_id: id, quantity_setting_reference: setting(key).method_setting_id,
    quantity_scope: "session", observed_property: property, evidence_value_json: value,
    source_locators: setting(key).source_locators as string[], ...extra,
  });
  for (const [index, row] of rows.entries()) {
    row.session_quantities = jones ? [
      quantity("length", "derive.sequence_length", "length of F/B string", index ? "1" : "5", { evidence_unit: "application launches" }),
      quantity("ratio", "derive.backtracking_ratio", "backtracking ratio", index ? "0" : "0.4"),
    ] : [
      ...["number of times used in session", "time spent", "click count", "scroll count"].map((property, i) =>
        quantity("app-" + i, "features.apps_and_categories", property, index ? "0" : "2", { quantity_scope: "app", app_identifier: "constructed-app-A" })),
      quantity("other-app", "features.apps_and_categories", "click count", "2", { quantity_scope: "app", app_identifier: "constructed-app-B" }),
      quantity("category-time", "features.apps_and_categories", "time spent", "30", { quantity_scope: "app_category", observation_category: "Social Media", evidence_unit: "seconds" }),
      quantity("normalized-category", "features.normalization", "time spent in app category", "2.00", { quantity_scope: "app_category", observation_category: "Social Media", quantity_qualifier: "normalized by session length" }),
      quantity("clicks", "features.interactions", "clicks", "2", { quantity_qualifier: "absolute counts" }),
      quantity("click-frequency", "features.interactions", "clicks", "0.5", { quantity_qualifier: "time-relative frequencies", evidence_unit: "per minute" }),
      quantity("session-length", "features.time", "session length", "30", { evidence_unit: "seconds" }),
      quantity("ringer", "features.settings", "ringer mode", '"silent"'),
    ];
    if (jones) row.session_labels = [{
      label_record_id: "supplied-strategy", label_setting_reference: setting("analysis.regex_classes").method_setting_id,
      observed_property: "session strategy", label_value_json: JSON.stringify(index ? "Initiate" : "Initiate-Revisit"),
      source_locators: setting("analysis.regex_classes").source_locators as string[],
    }];
  }
  return { profiles: [profile], device_use_sessions: rows };
}

export function falakiDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = profile.method_settings.find(s => s.method_parameter_key === "reconstruction.android_interaction_predicate");
  if (!setting) throw new Error("Missing Falaki OR-active definition");
  const source = [...setting.source_locators as string[], "PDF SHA256:8aa91f677842f1931db3f7602d8f74c4ebf817194b716ce1c5ebdc0ce5462021 p3§3:165–172. Constructed supplied OR-active intervals, not raw reconstruction. A supplied voice-call activity can span screen-off without ending this device interaction. No raw screen/call join, precise app interval, callback, clock, initial/tie state or boundary code is recovered."];
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:falaki-participant", device_id: "constructed:falaki-phone", record_origin: "analyst_constructed_example" as const,
    method_setting_reference: setting.method_setting_id, source_locators: source };
  const device_use_sessions: DeviceUseSessionRecord[] = [
    { ...owner, device_use_session_id: "constructed:falaki-or-active", start_condition: null, end_condition: null,
      denotes_interval: { start_instant: null, end_instant: null, duration_seconds: 40 },
      session_actions: [{ task_action_id: "constructed:supplied-active-call", action_label: "voice call",
        assigned_role_labels: ["voice call active"], denotes_interval: { duration_seconds: 40 }, source_locators: source }] },
    { ...owner, device_use_session_id: "constructed:falaki-zero-interval", denotes_interval: { duration_seconds: 0 }, session_actions: [] },
    { ...owner, device_use_session_id: "constructed:falaki-unknown-interval", denotes_interval: null, session_actions: null },
    { ...owner, device_use_session_id: "constructed:falaki-omitted-interval" },
  ];
  return { profiles: [profile], device_use_sessions };
}

export function hammerDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error(`Missing Hammer definition: ${key}`);
    return found;
  };
  const limits = "Hammer2014 pp36–38,352.txt:72–143,181–265; constructed independent supplied values. Screen ON→OFF is not unlock→lock. No constructor, app membership, duration sum, intersession subtraction, null/app classifier, trigger inference, category mapping, histogram measure, top-k selection or original serializer is executed; no-app duration<=15s remains unclassified.";
  const source = (key: string) => [...setting(key).source_locators as string[], limits];
  const q = (key: string, observed_property: string, evidence_value_json: string | null, app_identifier?: string, quantity_qualifier?: string): SessionQuantityRecord => ({
    quantity_record_id: `constructed:${key}:${observed_property}`, quantity_setting_reference: setting(key).method_setting_id,
    quantity_scope: app_identifier === undefined ? "session" : "app", observed_property, evidence_value_json,
    ...(app_identifier === undefined ? {} : { app_identifier }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }), source_locators: source(key),
  });
  const device_use_sessions: DeviceUseSessionRecord[] = [20, 17.5, 15, 0].map((duration, i) => ({
    device_use_session_id: `constructed:hammer-session-${i}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:hammer-participant", device_id: "constructed:hammer-device", record_origin: "analyst_constructed_example",
    method_setting_reference: setting("session.boundary").method_setting_id, denotes_interval: { duration_seconds: duration },
    ...(i === 0 ? { start_condition: "screen ON", end_condition: "screen OFF" } : i === 1 ? { start_condition: null, end_condition: null } : {}),
    source_locators: source("session.boundary"), session_labels: i < 2 ? [{
      label_record_id: "supplied-session-type", label_setting_reference: setting(i ? "session.app" : "session.null").method_setting_id,
      observed_property: "session type", label_value_json: JSON.stringify(i ? "app session" : "null session"),
      source_locators: source(i ? "session.app" : "session.null"),
    }] : i === 2 ? null : [],
    session_quantities: [q("session.unique_app_count", "unique application count", i === 1 ? "2" : "0"),
      q("session.inter_session_time", "time between consecutive sessions", i === 0 ? "null" : "60.00")],
    session_actions: i === 1 ? ["constructed:app-A", "constructed:app-B", "constructed:app-A"].map((app_identifier, j) => ({
      task_action_id: `constructed:app-member-${j}`, app_identifier, source_locators: source("collector.foreground_app"),
    })) : i === 0 ? [] : null,
  }));
  device_use_sessions[1]!.session_quantities!.push(
    q("session.duration", "elapsed session time", "17.500"), q("feature.trigger_app", "trigger app", '"constructed:app-A"'),
    q("feature.trigger_type", "trigger type", '"passive notification-or-call attraction"'),
    q("feature.app_category", "application category", '"constructed:category-A"', "constructed:app-A"),
    q("feature.app_category", "app histogram bin", "2.50", "constructed:app-A"),
    q("feature.app_category", "top-k dominant app categories", '["constructed:category-A"]'),
    q("feature.time_of_day", "time of day", '"constructed:time-of-day"'), q("feature.day_of_week", "day of week", '"constructed:weekday"'),
    q("feature.logical_location", "logical location", '"home"'), q("aggregation.unique_count", "unique application count", "2"),
    q("aggregation.categorical_mode", "categorical mode", '"home"', undefined, "logical location"),
    ...["minimum", "maximum", "average"].map((property, i) => q("aggregation.numeric", property, ["1.00", "3.00", "2.00"][i]!, undefined, "constructed:numeric feature")),
  );
  device_use_sessions[1]!.session_quantities!.push(q("label.forward_fill", "forward-filled human label", "true", undefined, "isBusy"),
    q("label.human_confidence", "human confidence", "0.9000", undefined, "isBusy"), q("label.secondary_source", "secondary classifier label", "false", undefined, "isBusy"),
    q("label.secondary_source", "secondary classifier confidence", "0.800", undefined, "isBusy"), q("outcomes", "predicted logical status", "true", undefined, "isBusy"));
  return { profiles: [profile], device_use_sessions };
}

// Constructed normalized period identities; no raw-state join, EEG alignment,
// session construction, survey anchor selection, feature calculation or classifier runs.
export function appPeriodDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing retained app-period definition: " + key);
    return found;
  };
  const source = (key: string) => [...setting(key).source_locators as string[], "Constructed independently supplied records; no original serializer, episode pairing, clock, clipping, join, label calculation or model execution recovered"];
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:app-period-participant", device_id: "example:app-period-phone", record_origin: "analyst_constructed_example" as const };
  const periods = (prefix: string): TaskActionRecord[] => ["app-A", "app-B", "app-A"].map((app, i) => ({
    task_action_id: prefix + ":period-" + i, app_identifier: app, action_label: "Supplied foreground app period",
    assigned_role_labels: [i === 2 ? "later repeated visit" : "earlier visit"],
    denotes_interval: i === 1 ? null : { start_instant: null, end_instant: null, duration_seconds: i ? 8 : 17.5 },
    source_locators: [...source(profile.source_work_id === "doi:10.1145/2971648.2971760" ? prefix === "quantapp" ? "quantapp.reuse_seven_app_features" : "sessionlogger.app_usage_period_unit"
      : profile.source_work_id === "doi:10.1145/2971648.2971762" ? "window.session_sequence" : "episode.application_session_definition"),
      "Supplied period membership/order and independent normalized duration, not raw sample/event timing or a complete original stream"],
  }));
  const quantity = (id: string, key: string, scope: "session" | "app" | "app_category", property: string, value: string | null,
    extra: Partial<SessionQuantityRecord> = {}): SessionQuantityRecord => ({
      quantity_record_id: id, quantity_setting_reference: setting(key).method_setting_id, quantity_scope: scope,
      observed_property: property, evidence_value_json: value, source_locators: source(key), ...extra,
    });
  const sampled_quantity_observations: SampledQuantityObservationRecord[] = [];
  const raw = (key: string, properties: Record<string, string | null>, id = key, event = false) => {
    const eeg = key.endsWith(".eeg_cadence");
    sampled_quantity_observations.push({ ...owner, sampled_observation_id: "example:raw:" + id,
      method_setting_reference: setting(key).method_setting_id, observed_entity_kind: eeg ? "participant" : "device",
      observed_entity_token: eeg ? owner.participant_id : owner.device_id, source_locators: source(key),
      ...(event ? { source_event_time_token: null } : { observation_instant: null }),
      quantities: Object.entries(properties).map(([observed_property, evidence_value_json]) => ({ observed_property, evidence_value_json })),
    });
  };
  const device_use_sessions: DeviceUseSessionRecord[] = [];
  const task_occurrences: TaskOccurrenceRecord[] = [];
  if (profile.source_work_id === "doi:10.1145/2971648.2971760") {
    const fields: Array<[string, string, string[]]> = [
      ["app_feature.bucket_id", "BucketID", ['"opaque supplied five-minute bin"', '"other supplied bin"', '"opaque supplied five-minute bin"']],
      ["app_feature.duration", "Duration", ["40.00", "15.00", "20.00"]],
      ["app_feature.apps_in_session", "AppsInSession", ["2", "2", "2"]],
      ["app_feature.app_order", "AppOrder", ["1", "2", "3"]],
      ["app_feature.revisitation_count", "RevisitationCount", ["0", "0", "1"]],
      ["app_feature.last_app_duration", "LastAppDuration", ["null", "40.00", "15.00"]],
      ["app_feature.time_since_last_app", "TimeSinceLastApp", ["null", "0.00", "null"]],
    ];
    for (const stage of ["sessionlogger", "quantapp"] as const) {
      const key = stage === "sessionlogger" ? "sessionlogger.screen_session_bounds" : "quantapp.context_feature_anchor";
      const actions = periods(stage);
      const row: DeviceUseSessionRecord = { ...owner, device_use_session_id: "example:" + stage + "-session",
        method_setting_reference: setting(key).method_setting_id, start_condition: "screen-on",
        ...(stage === "sessionlogger" ? { end_condition: "screen-off" } : { end_condition: null }),
        denotes_interval: null, session_actions: actions, source_locators: source(key),
        session_quantities: actions.flatMap((action, ordinal) => fields.map(([definition, property, values]) =>
          quantity(stage + ":" + definition + ":" + ordinal, definition, "app", property, values[ordinal]!, {
            app_identifier: action.app_identifier, support_task_action_references: [action.task_action_id],
          }))), session_labels: [],
      };
      if (stage === "sessionlogger") {
        row.session_quantities!.push(...actions.map((action, i) => quantity("BES:" + i, "proxy.app_bes_target", "app", "BES", i === 1 ? "0.20" : "0.50", {
          app_identifier: action.app_identifier, support_task_action_references: [action.task_action_id],
        })));
        row.session_labels = actions.map((action, i) => ({ label_record_id: "EEG-class:" + i,
          label_setting_reference: setting("proxy.per_user_median_label").method_setting_id,
          observed_property: "EEG-derived app-period engagement class", label_value_json: JSON.stringify(i === 1 ? "Low Engagement" : "High Engagement"),
          support_task_action_references: [action.task_action_id], source_locators: source("proxy.per_user_median_label") }));
      } else {
        const context: Array<[string, string, string?]> = [
          ["ConnectionType", '"Wi-Fi"'], ["BatteryLevel", "70.00"], ["RingerMode", '"normal"'],
          ["DayOfWeek", "2"], ["HourOfDay", "10"], ["isWeekend", "false"], ["isCharging", "true"], ["Proximity", "false"],
          ["TimeSinceLastSession", "0.00"], ["TimeSinceLastCall", "null"], ["TimeSinceLastNotification", "null"], ["Initiator", '"notification"'],
          ["LastHourAppCount", "3"], ["LastHourSessionCount", "2"], ["LastHourActiveTime", "120.00"], ["LastHourNotificationReceived", "0"],
          ["LastHourNotificationAttended", "0"], ["LastHourAppsPerMin", "0.75"], ["LastHourBatteryDrain", "0.00"],
          ["Location", '"home"'], ["AmbientNoise", "30.00", "dB"], ["AmbientLight", "50.00", "lux"], ["PhysicalActivity", '"stationary"'],
          ["Age", "29", "years"], ["Gender", "null"], ["Occupation", '"employed"'],
        ];
        row.session_quantities!.push(...context.map(([property, value, unit]) => quantity("context:" + property, "quantapp.context_feature_inventory", "session", property, value,
          unit ? { evidence_unit: unit } : {})));
        row.session_labels = actions.map((action, i) => ({ label_record_id: "RF-class:" + i,
          label_setting_reference: setting("quantapp.proxy_app_labels").method_setting_id, observed_property: "RF-proxy app-period engagement class",
          label_value_json: JSON.stringify(i === 1 ? "Low Engagement" : "High Engagement"), support_task_action_references: [action.task_action_id],
          source_locators: source("quantapp.proxy_app_labels") }));
        row.session_labels.push({ label_record_id: "weighted-session-class", label_setting_reference: setting("quantapp.duration_weighted_session_label").method_setting_id,
          observed_property: "duration-weighted session engagement class", label_value_json: '"High Engagement"',
          support_task_action_references: actions.map(action => action.task_action_id), source_locators: source("quantapp.duration_weighted_session_label") });
      }
      device_use_sessions.push(row);
    }
    const instrument = setting("benchmark.ues_measure");
    const content = JSON.parse(String(instrument.method_value_json)) as { printed_items: Record<string, string[]> };
    task_occurrences.push({ ...owner, task_occurrence_id: "example:mathur-benchmark", task_label: "Independent researcher-selected benchmark task",
      task_actions: [{ task_action_id: "example:benchmark-task-action", app_identifier: "YouTube", action_label: "Supplied researcher-selected video task",
        source_locators: source("benchmark.task_inventory") }],
      task_questionnaire_responses: Object.entries(content.printed_items).flatMap(([subscale, items]) => items.map((item, i) => ({
        questionnaire_response_id: subscale + ":" + i, questionnaire_setting_reference: instrument.method_setting_id,
        observed_property: subscale, questionnaire_item_label: item, response_value_json: i ? null : '"Strongly Agree"', source_locators: source("benchmark.ues_measure"),
      }))),
      criterion_assessments: [{ criterion_assessment_id: "example:benchmark-BES", criterion_setting_reference: setting("benchmark.bes_selection").method_setting_id,
        criterion_label: "Independent supplied maximum EEG engagement score/BES", assessment_value_json: "0.50",
        support_task_action_references: ["example:benchmark-task-action"], source_locators: source("benchmark.bes_selection") }], source_locators: source("benchmark.ues_measure"),
    });
    raw("sessionlogger.session_timestamp_schema", { "session-start timestamp": '"supplied start token"', "session-end timestamp": '"supplied end token"' });
    raw("sessionlogger.application_observations", { "application name": '"app-A"', "application transition": '"foreground"' }, "sessionlogger-open", true);
    raw("sessionlogger.application_observations", { "application name": '"app-A"', "application transition": '"background"' }, "sessionlogger-close", true);
    raw("sessionlogger.launcher_time", { "home/launcher time": "0.00" });
    raw("sessionlogger.eeg_cadence", { "EEG engagement score": "0.50" });
    raw("benchmark.eeg_cadence", { "EEG engagement score": "0.50" });
    raw("quantapp.screen_schema", { "screen event": '"screen unlocked"' }, "quantapp-screen", true);
    raw("quantapp.app_schema", { "app name": '"app-A"', "application transition": '"foreground"' }, "quantapp-app", true);
    raw("quantapp.notification_schema", { "notification event": '"access"', "sender app name": '"app-A"' }, "quantapp-notification", true);
    raw("quantapp.call_schema", { "call type": '"missed"' }, "quantapp-call", true);
    raw("quantapp.sensor_inventory", { "battery level": "70.00", "cell tower ID": '"supplied Cell-ID"', "Wi-Fi connected state": "true",
      "BSSID": '"supplied BSSID"', "headphone connected state": "false", "ringer mode": '"normal"', "proximity": "false",
      "ambient light intensity": "50.00", "ambient sound level": "30.00", "physical activity": '"stationary"' });
  } else if (profile.source_work_id === "doi:10.1145/2971648.2971762") {
    const options = ["To achieve a specific goal", "To browse, explore, or pass the time", "I was not using my phone", "I don't know why I was using my phone"];
    const question = "Which of the following best describes the way you are currently using your phone?";
    const categories = (JSON.parse(String(setting("app.category_vocabulary").method_value_json)) as { definition: string[] }).definition;
    for (const [i, option] of options.entries()) {
      const actions = periods("hiniker:" + i), responseId = "example:hiniker-response-" + i;
      actions[0]!.assigned_role_labels = ["recent window when survey displayed", "before sample (supplied)"];
      actions[2]!.assigned_role_labels = ["next window after submission (supplied)"];
      const row: DeviceUseSessionRecord = { ...owner, device_use_session_id: "example:hiniker-session-" + i,
        method_setting_reference: setting("session.partition").method_setting_id, denotes_interval: null,
        ...(i === 0 ? { start_condition: null, end_condition: "system_or_launcher_idle_gte_30_seconds" } : {}),
        session_actions: i < 2 ? actions : i === 2 ? null : [],
        session_questionnaire_responses: [{ questionnaire_response_id: responseId, questionnaire_setting_reference: setting("diary.prompt_text").method_setting_id,
          observed_property: "present phone-use self-report", questionnaire_item_label: question, response_value_json: JSON.stringify(option), source_locators: source("diary.prompt_text") }],
        ...(i < 2 ? { session_labels: [{ label_record_id: "usage-class", label_setting_reference: setting("diary.binary_label").method_setting_id,
          observed_property: "instrumental/ritualistic phone-use class", label_value_json: JSON.stringify(i ? "ritualistic" : "instrumental"),
          questionnaire_response_references: [responseId], source_locators: source("diary.binary_label") }] } : i === 2 ? {} : { session_labels: null }),
        source_locators: source("session.partition"),
      };
      if (i < 2) {
        row.session_quantities = profile.method_settings.filter(s => String(s.method_parameter_key).startsWith("feature.") && s.method_parameter_key !== "feature.inventory_40").flatMap(s => {
          const key = String(s.method_parameter_key), body = (JSON.parse(String(s.method_value_json)) as { definition: { quantity: string; unit?: string } }).definition;
          const window = /(longest|recent|next)_window/.test(key), action = key.includes("next_window") ? actions[2]! : actions[0]!;
          const values: Record<string, string> = { "feature.participant_id": JSON.stringify(owner.participant_id), "feature.minute_of_day": "899",
            "feature.longest_window_app": '"app-A"', "feature.recent_window_app": '"app-A"', "feature.next_window_app": '"app-A"',
            "feature.longest_window_category": '"Browsing"', "feature.recent_window_category": '"Browsing"', "feature.next_window_category": '"Browsing"',
            "feature.dominant_category": '"Communication"', "feature.dominant_category_share": "60.00" };
          const extra = { questionnaire_response_references: [responseId], ...(body.unit ? { evidence_unit: body.unit } : {}) };
          if (key === "feature.category_duration_20") return categories.map(category =>
            quantity("category:" + category, key, "app_category", body.quantity, category === "Communication" ? "100.00" : null, { ...extra, observation_category: category }));
          return [quantity(key, key, window ? "app" : "session", body.quantity, values[key] ?? (key.includes("count") || key.includes("sessions") || key.includes("windows") ? "2" : "0.00"),
            { ...extra, ...(window ? { app_identifier: "app-A", support_task_action_references: [action.task_action_id] } : {}) })];
        });
      }
      device_use_sessions.push(row);
    }
    raw("schema.app_identity", { "package name": '"example.app.a"', "app name": '"app-A"' });
    raw("schema.local_time", { "local time of day": '"supplied local-time token"' });
    raw("schema.active_duration", { "active duration": "17.50" });
  } else if (profile.source_work_id === "doi:10.1145/2037373.2037383") {
    const actions = periods("angry-birds");
    device_use_sessions.push({ ...owner, device_use_session_id: "example:application-chain", method_setting_reference: setting("session.application_chain_constructor").method_setting_id,
      denotes_interval: null, start_condition: null, end_condition: null, session_actions: actions, source_locators: source("session.application_chain_constructor"),
      session_quantities: [
        quantity("chain-occurrences", "analysis.chain_occurrence_distribution", "session", "application occurrences", "3", { evidence_unit: "count", support_task_action_references: actions.map(action => action.task_action_id) }),
        quantity("chain-unique", "analysis.chain_unique_app_distribution", "session", "unique applications", "2", { evidence_unit: "count", support_task_action_references: actions.map(action => action.task_action_id) }),
        quantity("chain-duration", "analysis.application_chain_duration_metric", "session", "chain usage duration", "25.50"),
        quantity("first-category", "analysis.chain_first_category", "session", "first app category", '"Communication"', { support_task_action_references: [actions[0]!.task_action_id] }),
      ] });
    device_use_sessions.push({ ...owner, device_use_session_id: "example:unknown-application-chain", method_setting_reference: setting("session.application_chain_constructor").method_setting_id,
      session_actions: null, session_quantities: [], source_locators: source("session.application_chain_constructor") });
    for (const [i, value] of ['"epsilon"', '"app-A"', '"app-A"', "null"].entries()) raw("schema.appsensor_state_domain", { "foreground app identity": value }, "app-state-" + i);
    raw("collector.deployment_and_context", { "location": '"supplied location token"', "local time": '"supplied local-time token"', "previous app interaction": '"app-B"' });
    raw("collector.screen_standby_boundary", { "screen event": '"screen off"' }, "standby-off", true);
    raw("collector.screen_standby_boundary", { "screen event": '"screen on"' }, "standby-on", true);
  } else throw new Error("No retained app-period family example for this source");
  return { profiles: [profile], device_use_sessions, sampled_quantity_observations, task_occurrences };
}


// Three distinct normalized hierarchies. Tokens and values are constructed, not
// recovered study rows, wall-clock values, joins, classifiers or session execution.
export function nestedSessionFamilyExample(profile: StudyMethodProfile): import("../../src/lib/methodProfiles").StudyMethodProfileLibrary {
  const input: import("../../src/lib/methodProfiles").StudyMethodProfileLibrary = {
    schema_version: "chronicle-method-profile-library-v1", profiles: [profile],
    device_use_sessions: [], sampled_quantity_observations: [], task_occurrences: [], screenshot_sessions: [], participant_day_observations: [],
  };
  const setting = (key: string) => {
    const rows = profile.method_settings.filter(s => s.method_parameter_key === key);
    if (rows.length !== 1) throw new Error("Frozen nested-session definition absent/ambiguous: " + key);
    return rows[0]!;
  };
  const source = (key: string) => [...setting(key).source_locators as string[],
    "Constructed supplied identities/values; no original serialization, completeness, clocks or algorithm execution claimed"];
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:not-a-source-participant", device_id: "example:supplied-device",
    record_origin: "analyst_constructed_example" as const };
  const period = (prefix: string, app: string, i: number): TaskActionRecord => ({
    task_action_id: prefix + "-period-" + i, app_identifier: app, assigned_role_labels: ["foreground app period"],
    denotes_interval: { start_instant: "opaque:app-start-" + i, end_instant: i === 1 ? null : "opaque:app-end-" + i,
      duration_seconds: profile.source_work_id === "doi:10.1145/3706598.3713724" ? 31.5 : i === 1 ? 0 : 17.5 }, source_locators: source("app_session." + (profile.source_work_id === "doi:10.2139/ssrn.4768783" ? "boundary" : "definition")),
  });
  const quantity = (id: string, key: string, scope: "session" | "app", property: string, value: string | null,
    supports: string[] | null = null, app?: string, unit?: string): SessionQuantityRecord => ({
    quantity_record_id: id, quantity_setting_reference: setting(key).method_setting_id, quantity_scope: scope,
    observed_property: property, evidence_value_json: value, support_task_action_references: supports,
    ...(app ? { app_identifier: app } : {}), ...(unit ? { evidence_unit: unit } : {}), source_locators: source(key),
  });
  if (profile.source_work_id === "doi:10.2139/ssrn.4768783") {
    const actions = ["app-A", "app-B", "app-A"].map((app, i) => period("tap", app, i));
    const sleepReset: TaskActionRecord = { task_action_id: "example:tap-screen-sleep-reset", action_label: "screen sleep",
      assigned_role_labels: ["session ID generation"], source_locators: source("phone_session.screen_sleep_termination") };
    const session: DeviceUseSessionRecord = { ...owner, device_use_session_id: "example:tap-phone",
      method_setting_reference: setting("phone_session.boundary").method_setting_id,
      start_condition: "participant unlocks screen", end_condition: "screen locked again",
      denotes_interval: { start_instant: "opaque:phone-start", end_instant: null, duration_seconds: 40 },
      session_actions: [...actions, sleepReset], session_quantities: [
        quantity("phone-taps", "schema.phone_session_fields", "session", "total tap count", "4", actions.map(a => a.task_action_id), undefined, "taps"),
        quantity("phone-apps", "schema.phone_session_fields", "session", "apps used", '["app-A","app-B","app-A"]'),
        quantity("sleep-generated-ID", "phone_session.screen_sleep_termination", "session", "generated session ID",
          '"opaque:generated-at-screen-sleep"', [sleepReset.task_action_id]),
        ...actions.flatMap((a, i) => [
          quantity("rate-" + i, "analysis.taps_per_second", "app", "taps per second", "0.50", [a.task_action_id], a.app_identifier!, "taps/second"),
          quantity("counts-" + i, "clustering.input_sequence", "app", "one-second tap counts", " [0, 1, null, 2] ", [a.task_action_id], a.app_identifier!),
          quantity("time-" + i, "clustering.timestamp_normalization", "app", "normalized timestamps", "[0,0.50,1]", [a.task_action_id], a.app_identifier!),
          quantity("length-" + i, "clustering.length_normalization", "app", "length-normalized tap counts", "[0,0.75,2]", [a.task_action_id], a.app_identifier!),
        ]),
      ], session_labels: actions.map((a, i) => ({ label_record_id: "cluster-" + i,
        label_setting_reference: setting("clustering.semantic_labels").method_setting_id, observed_property: "app-session cluster label",
        label_value_json: JSON.stringify(i === 1 ? "passive" : "active"), support_task_action_references: [a.task_action_id],
        source_locators: source("clustering.semantic_labels") })), source_locators: source("phone_session.boundary") };
    input.device_use_sessions!.push(session);
    // Two equal-time/equal-content taps still have different identities, including
    // a later visit to the same app. These are event time, not collection time.
    [actions[0]!, actions[0]!, actions[2]!].forEach((a, i) => input.sampled_quantity_observations!.push({
      ...owner, sampled_observation_id: "example:tap-" + i, method_setting_reference: setting("schema.tap_event").method_setting_id,
      observed_entity_kind: "application", observed_entity_token: a.app_identifier!, source_event_time_token: "opaque:millisecond-tap-token",
      device_use_session_reference: session.device_use_session_id, session_action_reference: a.task_action_id,
      quantities: [{ observed_property: "tap event", evidence_value_json: '"tap"' }], source_locators: source("schema.tap_event"),
    }));
    input.sampled_quantity_observations!.push({ ...owner, sampled_observation_id: "example:category-minus-one",
      method_setting_reference: setting("schema.app_category").method_setting_id, observed_entity_kind: "application", observed_entity_token: "app-B",
      quantities: [{ observed_property: "Google Play category", evidence_value_json: "-1" }], source_locators: source("schema.app_category") });
    return input;
  }
  if (profile.source_work_id === "doi:10.1145/3706598.3713724") {
    const actions = ["Instagram", "Reddit", "Instagram"].map((app, i) => period("regret", app, i));
    const session: DeviceUseSessionRecord = { ...owner, device_use_session_id: "example:regret-screen",
      method_setting_reference: setting("screen_session.definition").method_setting_id,
      start_condition: "SCREEN ON", end_condition: "SCREEN OFF", session_actions: actions,
      session_questionnaire_responses: actions.flatMap((a, i) => [
        { questionnaire_response_id: "intention-" + i, questionnaire_setting_reference: setting("intention.categories").method_setting_id,
          observed_property: "intended use", questionnaire_item_label: "Why are you here?",
          response_value_json: JSON.stringify(["Communication", "I am not sure", "No Specific Goal"][i]),
          support_task_action_references: [a.task_action_id], source_locators: source("intention.categories") },
        { questionnaire_response_id: "regret-" + i, questionnaire_setting_reference: setting("daily.regret_scale").method_setting_id,
          observed_property: "end-of-day regret concerning supplied app period",
          response_value_json: i === 0 ? "2" : i === 1 ? "null" : null,
          support_task_action_references: [a.task_action_id], source_locators: source("daily.regret_scale") },
      ]), session_quantities: actions.map((a, i) => quantity("ratio-" + i, "predictor.fixed_effects", "app", "ratio of Communication",
        i === 1 ? null : "0.50", [a.task_action_id], a.app_identifier!)),
      session_labels: actions.map((a, i) => ({ label_record_id: "prevalent-" + i,
        label_setting_reference: setting("rq2.session_activity").method_setting_id, observed_property: "most prevalent app-session activity",
        label_value_json: JSON.stringify(i === 0 ? "Communication" : "Other"), support_task_action_references: [a.task_action_id],
        questionnaire_response_references: ["intention-" + i], source_locators: source("rq2.session_activity") })),
      source_locators: source("screen_session.definition") };
    input.device_use_sessions!.push(session);
    actions.forEach((a, i) => {
      const images = Array.from({length: 6}, (_, j) => ({ screenshot_record_id: "example:app-" + i + "-image-" + j,
        screenshot_sequence_position: j, screenshot_instant: "opaque:equal-capture-token", source_locators: source("gpt.step1_input") }));
      const current = images[4]!.screenshot_record_id;
      input.screenshot_sessions!.push({ method_profile_id: owner.method_profile_id, source_work_id: owner.source_work_id,
        participant_id: owner.participant_id, device_id: owner.device_id, session_record_origin: "analyst_constructed_example",
        screenshot_session_id: "example:app-captures-" + i, method_setting_reference: setting("app_session.definition").method_setting_id,
        app_identifier: a.app_identifier!, device_use_session_reference: session.device_use_session_id, session_action_reference: a.task_action_id,
        screenshots: images, screenshot_range_annotations: [
          { range_annotation_id: "description-first", method_setting_reference: setting("gpt.step1_output").method_setting_id,
            first_screenshot_reference: images[0]!.screenshot_record_id, last_screenshot_reference: images[0]!.screenshot_record_id,
            support_screenshot_references: [], range_label_values_json: '{"description":null}', source_locators: source("gpt.step1_output") },
          { range_annotation_id: "description-current", method_setting_reference: setting("gpt.step1_output").method_setting_id,
            first_screenshot_reference: current, last_screenshot_reference: current,
            support_screenshot_references: [images[3]!.screenshot_record_id],
            range_label_values_json: '{"description":"Constructed visual description, not a model execution."}', source_locators: source("gpt.step1_output") },
          { range_annotation_id: "model-category", method_setting_reference: setting("gpt.output").method_setting_id,
            first_screenshot_reference: current, last_screenshot_reference: current, assessor_id: "example:model-token",
            support_screenshot_references: images.slice(0,4).map(image => image.screenshot_record_id),
            range_label_values_json: '{"activity category":"Other","justification":"Independent supplied rationale."}', source_locators: source("gpt.output") },
          ...["A","B"].map((rater, j) => ({ range_annotation_id: "human-" + rater, method_setting_reference: setting("activity.categories").method_setting_id,
            first_screenshot_reference: current, last_screenshot_reference: current, assessor_id: "example:human-" + rater,
            support_screenshot_references: images.slice(0,4).map(image => image.screenshot_record_id),
            range_label_values_json: JSON.stringify({"activity category": j ? "Other" : "View_Shared"}), source_locators: source("validation.sample") })),
          { range_annotation_id: "human-consensus", method_setting_reference: setting("validation.consensus").method_setting_id,
            first_screenshot_reference: current, last_screenshot_reference: current, assessor_id: "example:consensus-owner",
            support_screenshot_references: null, range_label_values_json: '{"activity category":"View_Shared"}', source_locators: source("validation.consensus") },
        ], source_locators: source("app_session.definition"),
      });
    });
    input.task_occurrences!.push({ ...owner, task_occurrence_id: "example:regret-follow-up-interview",
      task_label: "supplied follow-up interview", task_questionnaire_responses: [
        { questionnaire_response_id: "interview-motivation", questionnaire_setting_reference: setting("interview.prompts").method_setting_id,
          observed_property: "motivation for app use", response_value_json: null, source_locators: source("interview.prompts") },
      ], source_locators: source("interview.prompts") });
    return input;
  }
  if (profile.source_work_id !== "doi:10.1145/2858036.2858267") throw new Error("Unsupported frozen nested-session source");
  const attempts: TaskActionRecord[] = [0,1,2,3].map(i => ({ task_action_id: "example:unlock-attempt-" + i,
    assigned_role_labels: ["unlock attempt"], denotes_interval: { start_instant: "opaque:attempt-start-" + i, end_instant: null },
    source_locators: source("fsm.key_entry_begin") }));
  input.device_use_sessions!.push({ ...owner, device_use_session_id: "example:unlock-screen",
    method_setting_reference: setting("fsm.session_boundary").method_setting_id, start_condition: "SCREEN ON", end_condition: "SCREEN OFF",
    session_actions: attempts, denotes_interval: { duration_seconds: 20, start_instant: null, end_instant: null }, source_locators: source("fsm.session_boundary") });
  ["incorrect","too short","correct"].forEach((value, i) => {
    const begin = "example:key-begin-" + i, outcome = "example:key-outcome-" + i;
    input.task_occurrences!.push({ ...owner, task_occurrence_id: "example:auth-" + i, task_label: "supplied unlock attempt",
      device_use_session_reference: "example:unlock-screen", session_action_reference: attempts[i]!.task_action_id,
      task_actions: [
        { task_action_id: begin, action_label: "KeyEntryBegin", source_locators: source("fsm.key_entry_begin") },
        { task_action_id: outcome, action_label: "code " + value, source_locators: source("fsm.code_outcomes") },
        ...(i === 2 ? [{ task_action_id: "example:dismissed", action_label: "Keyguard dismissed", source_locators: source("fsm.dismissal_outcomes") }] : []),
      ], criterion_assessments: [
        { criterion_assessment_id: "outcome", criterion_setting_reference: setting("fsm.code_outcomes").method_setting_id,
          criterion_label: "code outcome", assessment_value_json: JSON.stringify(value), support_task_action_references: [begin,outcome],
          source_locators: source("fsm.code_outcomes") },
        { criterion_assessment_id: "preparation", criterion_setting_reference: setting("fsm.preparation_interval").method_setting_id,
          criterion_label: "supplied preparation duration in seconds", assessment_value_json: i ? null : "3.00",
          support_task_action_references: [begin], source_locators: source("fsm.preparation_interval") },
        ...(i === 2 ? [{ criterion_assessment_id: "dismissal", criterion_setting_reference: setting("fsm.dismissal_outcomes").method_setting_id,
          criterion_label: "keyguard dismissal outcome", assessment_value_json: '"dismissal after correct code"',
          support_task_action_references: ["example:dismissed"], source_locators: source("fsm.dismissal_outcomes") }] : []),
      ], source_locators: source("fsm.key_entry_begin") });
  });
  const instrument = JSON.parse(String(setting("survey.instrument").method_value_json)) as { definition?: unknown;
    code_based_printed_statement_labels?: string[]; no_code_printed_statement_labels?: string[] };
  const figure = (instrument.definition ?? instrument) as { code_based_printed_statement_labels: string[]; no_code_printed_statement_labels: string[] };
  if (!Array.isArray(figure.code_based_printed_statement_labels) || !Array.isArray(figure.no_code_printed_statement_labels)) throw new Error("Canonical Figure6 correction has not been normally merged");
  [figure.code_based_printed_statement_labels, figure.no_code_printed_statement_labels].forEach((labels, group) => {
    input.task_occurrences!.push({ ...owner, participant_id: group ? "example:separate-no-code-respondent" : owner.participant_id,
      task_occurrence_id: "example:unlock-exit-survey-" + group, task_label: group ? "supplied no-code-lock exit survey" : "supplied code-lock exit survey",
      task_questionnaire_responses: labels.map((label, i) => ({
        questionnaire_response_id: "figure6-" + i, questionnaire_setting_reference: setting("survey.instrument").method_setting_id,
        observed_property: label, response_value_json: i === 0 ? "7" : i === 1 ? "1" : i === 2 ? "null" : null,
        source_locators: source("survey.instrument"),
      })), source_locators: source("survey.instrument") });
  });

  input.task_occurrences!.push({ ...owner, task_occurrence_id: "example:auth-aborted",
    task_label: "supplied attempt aborted on screen off", device_use_session_reference: "example:unlock-screen",
    session_action_reference: attempts[3]!.task_action_id,
    task_actions: [{ task_action_id: "example:abort-screen-off", action_label: "SCREEN OFF", source_locators: source("fsm.abort_retry") }],
    criterion_assessments: [{ criterion_assessment_id: "abort", criterion_setting_reference: setting("fsm.abort_retry").method_setting_id,
      criterion_label: "supplied abort outcome", assessment_value_json: '"attempt aborted on SCREEN OFF"',
      support_task_action_references: ["example:abort-screen-off"], source_locators: source("fsm.abort_retry") }],
    source_locators: source("fsm.abort_retry") });
  // Independently supplied raw occurrences/configuration, not inferred supports
  // for attempts. Logged event time is not an accurate phenomenon-time promise.
  ["SCREEN ON", "SCREEN OFF"].forEach((value, i) => input.sampled_quantity_observations!.push({
    ...owner, sampled_observation_id: "example:unlock-screen-event-" + i,
    method_setting_reference: setting("event_schema.screen_broadcasts").method_setting_id, observed_entity_kind: "device",
    observed_entity_token: owner.device_id, source_event_time_token: "opaque:logged-event-token",
    quantities: [{ observed_property: "screen event", evidence_value_json: JSON.stringify(value) }], source_locators: source("event_schema.screen_broadcasts"),
  }));
  ["KeyEntryBegin", "code correct", "code incorrect", "code too short", "Keyguard dismissed"].forEach((value, i) => input.sampled_quantity_observations!.push({
    ...owner, sampled_observation_id: "example:keyguard-event-" + i,
    method_setting_reference: setting("event_schema.keyguard_events").method_setting_id, observed_entity_kind: "device",
    observed_entity_token: owner.device_id, source_event_time_token: "opaque:logged-event-token",
    quantities: [{ observed_property: "keyguard event", evidence_value_json: JSON.stringify(value) }], source_locators: source("event_schema.keyguard_events"),
  }));
  input.sampled_quantity_observations!.push({ ...owner, sampled_observation_id: "example:unlock-additional-fields",
    method_setting_reference: setting("event_schema.additional_fields").method_setting_id, observed_entity_kind: "device",
    observed_entity_token: owner.device_id, quantities: [
      { observed_property: "lock-screen type", evidence_value_json: '"pattern"' },
      { observed_property: "entered-code length", evidence_value_json: "3" },
      { observed_property: "pattern stealth mode", evidence_value_json: "false" },
      { observed_property: "screen-off reason", evidence_value_json: '"user"' },
      { observed_property: "number of prior attempts", evidence_value_json: "0" },
    ], source_locators: source("event_schema.additional_fields") });
  input.participant_day_observations!.push(...[
    ["sessions per day","4","count"],["unlocks per day","2","count"],["time spent unlocking per day","3.00","seconds"],
    ["locked/non-unlock session length","7.50","seconds"],["unlocked session length","12.00","seconds"],["manual screen-off proportion","0.50",undefined],
  ].map(([observed_property, day_observation_value_json, evidence_unit], i) => ({
    method_profile_id: owner.method_profile_id, source_work_id: owner.source_work_id, participant_id: owner.participant_id,
    day_record_origin: "analyst_constructed_example" as const, day_observation_kind: "objective_aggregate" as const,
    day_observation_id: "example:unlock-day-" + i, referenced_day_token: "example:day-not-a-clock",
    observed_property: observed_property!, day_observation_value_json: day_observation_value_json!,
    ...(evidence_unit ? {evidence_unit} : {}), source_locators: source("rq1.daily_session_metrics"),
  })));
  return input;
}

export function dailyValidityDeviceSessionExample(profile: StudyMethodProfile) {
  const setting = (key: string) => profile.method_settings.find(setting => setting.method_parameter_key === key)!;
  const constructor = setting("reconstruction.screen_on_session"), check = setting("feature.phone_check_definition");
  const limits = "rank161.txt:206–215; supplement-mmc1.txt:17–76. Constructed supplied post-processing screen-on→subsequent-screen-off sessions and independent phone-check labels. Source operation order is missing-second repair, corroborated unknown→off, short-off bridge, then session construction. These records do not execute those stages or invent an instance-level join to sampled state records. Opaque endpoints/duration remain independent; <=15seconds is the disclosed phone-check distinction.";
  const device_use_sessions: DeviceUseSessionRecord[] = [15, 15.25, undefined].map((duration, i) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:daily-validity-person-A", device_id: "constructed:daily-validity-phone-A",
    device_use_session_id: "constructed:daily-validity-session-" + i, record_origin: "analyst_constructed_example",
    method_setting_reference: constructor.method_setting_id, source_locators: [...constructor.source_locators as string[], limits],
    denotes_interval: duration === undefined ? { start_instant: null, end_instant: null, duration_seconds: null } : { duration_seconds: duration },
    ...(i === 2 ? { start_condition: null, end_condition: null } : { start_condition: "screen-on", end_condition: "screen-off" }),
    session_labels: [{ label_record_id: "supplied-phone-check", label_setting_reference: check.method_setting_id,
      observed_property: "phone check", label_value_json: i === 2 ? "null" : i ? "false" : "true", source_locators: [...check.source_locators as string[], limits] }],
  }));
  return { profiles: [profile], device_use_sessions };
}
