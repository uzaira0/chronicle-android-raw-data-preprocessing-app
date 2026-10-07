import type { AppInterruptionSessionRecord, AppSessionQuestionnaireResponseRecord, SessionQuantityRecord, StudyMethodProfile, SampledQuantityObservationRecord, NotificationHistoryRecord, ParticipantDayObservationRecord } from "../../src/lib/methodProfiles";

// Published illustration plus analyst-normalized ownership, NOT participant rows,
// recovered serialization, a return classification or a session constructor.
export function appInterruptionSessionExample() {
  const work = "doi:10.1145/3473856.3473881";
  const locator = "Why Did you Stop author copy physical p4 Figure1; p3 Section3.2; p7 Section4.4.2/Table1; SHA256:1d6962efd1eddeddeeb7c1dc12799dc642ef5e921f42bff8e165eababa277e22";
  const profileId = "example:app-session-interruptions";
  const profiles = [{
    method_profile_id: profileId, source_work_id: work,
    source_method_variant_id: "example:normalized-interruption-membership-not-deployed-build",
    method_profile_version: "normalized-example-v1", method_configuration_structure: "fixed",
    profile_implementation_status: "specification_only", source_locators: [locator],
    method_settings: [{
      method_setting_id: "example:session-interruption-membership", source_extraction_id: "example:why-stop:section3.2",
      source_work_id: work, method_parameter_key: "session.interruption_membership",
      method_setting_role: "event_schema", method_target_layer: "raw_record", method_value_kind: "object",
      method_value_json: JSON.stringify({ recorded_unit: "containing learning session and individually recorded interruptions", raw_serialization: null }),
      method_applicability_status: "applicable", method_disclosure_status: "declared_partial",
      method_implementation_status: "specification_only", contract_bindings: [], source_locators: [locator],
    }],
  }];
  const app_interruption_sessions = [{
    app_interruption_session_id: "illustration-session", method_profile_id: profileId, source_work_id: work,
    participant_id: "illustration-owner-not-study-participant",
    session_record_origin: "analyst_constructed_example", source_locators: [locator],
    denotes_interval: { start_instant: "05:48:56", end_instant: "05:50:43" },
    // The illustrated app name, device, date, timezone and outcome are not supplied.
    interruptions: [{
      interruption_record_id: "illustration-interruption", interruption_type: "APP_SWITCH",
      denotes_interval: { start_instant: "05:49:03", end_instant: "05:50:43" },
      visited_app_labels: ["Google", "Google Play Store", "Google", "Activity Recognition"],
      source_locators: [locator],
    }],
  }];
  return { profiles, app_interruption_sessions };
}

// Constructed supplied records; no recovered rows, timestamps, duration calculation or last-interruption join.
export function appInterruptionQuestionnaireExample(profile: StudyMethodProfile): { profiles: StudyMethodProfile[]; app_interruption_sessions: AppInterruptionSessionRecord[]; sampled_quantity_observations?: SampledQuantityObservationRecord[]; notification_histories?: NotificationHistoryRecord[]; participant_day_observations?: ParticipantDayObservationRecord[] } {
  const meaningful = profile.source_work_id === "doi:10.1145/3191754";
  if (!meaningful && profile.source_work_id !== "doi:10.1145/3473856.3473881") throw new Error("Unexpected interruption-questionnaire source");
  const locator = meaningful
    ? "Meaningful primary098.txt:279-284; released Event.java:91-117, Sample.java:527-554, DetectAppsService.java:509-519; supplied values/one timing per distinct app instance, not executed code"
    : "WhyStop author PDF pp3-8; Figure1/Table1; SHA256:1d6962efd1eddeddeeb7c1dc12799dc642ef5e921f42bff8e165eababa277e22; independent supplied ESQ/net seconds, not a last-interruption query";
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error(`Missing actual interruption definition ${key}`);
    return found;
  };
  const response = (key: string, observed_property: string, value: string | null | undefined, role?: string, ref?: string): AppSessionQuestionnaireResponseRecord => ({
    questionnaire_response_id: `example:response:${observed_property}`, questionnaire_setting_reference: setting(key).method_setting_id,
    observed_property, ...(value === undefined ? {} : { response_value_json: value }),
    ...(role === undefined ? {} : { response_role_label: role }), ...(ref === undefined ? {} : { interruption_record_reference: ref }),
    source_locators: [...setting(key).source_locators as string[], locator],
  });
  const quantity = (key: string, observed_property: string, evidence_value_json: string): SessionQuantityRecord => ({
    quantity_record_id: `example:quantity:${observed_property}`, quantity_setting_reference: setting(key).method_setting_id,
    quantity_scope: "session", observed_property, evidence_value_json,
    evidence_unit: meaningful ? "milliseconds" : "seconds", source_locators: [...setting(key).source_locators as string[], locator],
  });
  const session = (id: string): AppInterruptionSessionRecord => ({
    app_interruption_session_id: `example:${id}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:not-a-source-participant", session_record_origin: "analyst_constructed_example", denotes_interval: {}, source_locators: [locator],
  });
  if (meaningful) {
    const timing = ["before", "during", "after"] as const;
    const durationValues = [['"NA"', "5000", "17000", "17000"], ["30000", "4000", '"NA"', "30000"], ["17000", "5000", '"NA"', "17000"]];
    const app_interruption_sessions = timing.map((role, index) => {
      const row = session(`meaningful-${role}-instance`);
      row.app_package_name = "org.example.constructed.app"; // Not a study package or inferred app name.
      row.app_name = null;
      row.source_locators.push(...setting("event.timing_field").source_locators as string[], ...setting("sampling.one_timing_per_app_instance").source_locators as string[]);
      row.session_questionnaire_responses = [
        response("instrument.affect_valence_scale", "valence", "4", role),
        response("instrument.affect_arousal_scale", "arousal", "5", role),
        response("event.response_fields", "affect_text", '"example: earlier supplied affect text"', role),
        response("instrument.motivation_prompt_options", "ugPurpose", role === "during" ? '"NO_RESPONSE"' : '"To achieve a specific goal"', role),
        response(role === "during" ? "event.response_fields" : "instrument.use_type_options", "purpose", role === "during" ? '"NA"' : '"Entertainment"', role),
        response(role === "after" ? "instrument.meaningfulness_scale" : "event.response_fields", "meaningfulness", role === "after" ? "5" : '"NA"', role),
        response("event.response_fields", "meaningfulness_text", role === "after" ? '"example: supplied meaningfulness text"' : '"NA"', role),
      ];
      row.session_quantities = ["duration_before", "sample_duration", "duration_after", "duration_total"]
        .map((field, i) => quantity("event.duration_fields", field, durationValues[index]![i]!));
      if (role === "after") row.session_questionnaire_responses.find(r => r.observed_property === "ugPurpose")!.response_value_json = '"To browse, explore, or pass the time"';
      row.session_labels = [{
        label_record_id: "example:motivation-class", label_setting_reference: setting("instrument.motivation_analysis_labels").method_setting_id,
        observed_property: "motivation analysis class", label_value_json: role === "during" ? null : JSON.stringify(role === "after" ? "habitual" : "instrumental"),
        questionnaire_response_references: [row.session_questionnaire_responses.find(r => r.observed_property === "ugPurpose")!.questionnaire_response_id],
        source_locators: [...setting("instrument.motivation_analysis_labels").source_locators as string[], "Independent supplied analysis label and local answer support, not calculated"],
      }, {
        label_record_id: "example:time-bin", label_setting_reference: setting("lme.time_bins").method_setting_id,
        observed_property: "time of day", label_value_json: JSON.stringify(["morning", "afternoon", "night"][index]),
        source_locators: [...setting("lme.time_bins").source_locators as string[], "Supplied source bin; absent clock/timezone is not reconstructed"],
      }];
      return row;
    });
    const tableRows: Array<[string, string[], string, string]> = [["Chrome", ["9", "50", "10", "20", "11"], "50", "701"], ["Gmail", ["12", "39", "31", "10", "8"], "39", "459"]];
    const shareProperties = ["productivity share", "information share", "communication share", "entertainment share", "social-media share"];
    const sampled_quantity_observations: SampledQuantityObservationRecord[] = tableRows.map(([app, shares, largest, count], i) => ({
      sampled_observation_id: "example:printed-app-shares-" + i, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      record_origin: "analyst_constructed_example", method_setting_reference: setting("aggregation.statistic").method_setting_id,
      observed_entity_kind: "application", observed_entity_token: app,
      quantities: [...shares.map((value, j) => ({ observed_property: shareProperties[j]!, evidence_value_json: value, evidence_unit: "percent" })),
        { observed_property: "largest share", evidence_value_json: largest, evidence_unit: "percent" }, { observed_property: "sample count", evidence_value_json: count, evidence_unit: "count" }],
      source_locators: [...setting("aggregation.statistic").source_locators as string[], ...setting("aggregation.top_five_app_table").source_locators as string[],
        "Meaningful primary098.txt:466–496 Table4: two literal published app-level rows in a constructed carrier; no participant/day/package owner, aggregation execution, fabricated cohort participant or original sample join"],
    }));
    return { profiles: [profile], app_interruption_sessions, sampled_quantity_observations };
  }
  const first = session("why-stop-partial-A");
  first.app_package_name = null;
  first.interruptions = ["example:interruption-A", "example:interruption-B"].map(id => ({
    interruption_record_id: id, interruption_type: "APP_SWITCH", denotes_interval: {},
    visited_app_labels: ["example: other app", "example: other app"], source_locators: [locator],
  }));
  first.session_questionnaire_responses = [
    response("esm.location_item", "location", '"Home"'), response("esm.company_item", "company", '"Alone"'),
    response("esm.movement_confirmation_item", "movement confirmation; allowed response codes undisclosed", undefined),
    response("esm.notification_distraction_gate", "notification distraction", '"Yes"'),
    response("esm.end_reason_item", "offered subjective end reason", '"Device Internal"'),
    response("esm.importance_followup", "interruption importance", '"Not important - I could have ignored it and continued learning"', undefined, "example:interruption-A"),
  ];
  first.session_quantities = [quantity("analysis.net_duration", "learning session net length", "17.500")];
  const second = session("why-stop-partial-B");
  second.interruptions = null;
  second.session_questionnaire_responses = [response("esm.location_item", "location", null), response("esm.company_item", "company", undefined),
    response("esm.end_reason_item", "offered subjective end reason", '"Intentional"')];
  second.session_quantities = [quantity("analysis.net_duration", "learning session net length", "0.00")];
  first.device_id = second.device_id = "example:why-stop-device";
  first.session_quantities.push(quantity("collector.recorded_identifiers", "learning session length", "90.00"),
    { ...quantity("analysis.GAMLSS_targets", "suspending interruption count", "2"), evidence_unit: "count" },
    quantity("analysis.GAMLSS_targets", "total suspending interruption duration", "12.00"));
  second.session_quantities.push(quantity("collector.recorded_identifiers", "learning session length", "0.00"),
    { ...quantity("analysis.GAMLSS_targets", "suspending interruption count", "0"), evidence_unit: "count" },
    quantity("analysis.GAMLSS_targets", "total suspending interruption duration", "0.00"));
  first.session_actions = ["android.intent.action.PHONE_STATE with RINGING", "android.provider.Telephony.SMS_RECEIVED"].map((action_label, i) => ({
    task_action_id: "example:communication-event-" + i, action_label,
    source_locators: [...setting("communication.collector").source_locators as string[], "Independent supplied communication occurrence; no caller/content, clock, inferred switch or cause"],
  }));
  first.session_labels = [{
    label_record_id: "example:time-bin", label_setting_reference: setting("analysis.time_of_day_bins").method_setting_id,
    observed_property: "time of day", label_value_json: '"morning"', source_locators: [...setting("analysis.time_of_day_bins").source_locators as string[], "Supplied reporting bin, not calculated from absent clock/timezone"],
  }];
  const classification = (key: string, value: string) => ({
    label_record_id: "example:automatic:" + key, label_setting_reference: setting(key).method_setting_id,
    observed_property: "automatic interruption class", label_value_json: JSON.stringify(value),
    source_locators: [...setting(key).source_locators as string[], "Constructed normalized automatic label, independent of APP_SWITCH and the supplied ESQ response; not a classifier execution"],
  });
  first.interruptions[0]!.interruption_classifications = [
    classification("app_switch.internal_label", "internal"),
    classification("termination.classification_flow", "internal"),
    { ...classification("termination.classification_flow", "EXTERNAL"), label_record_id: "example:final-esq-class",
      observed_property: "ESQ-confirmed termination class", source_locators: [...setting("termination.classification_flow").source_locators as string[],
        "Independent supplied final classification; neither automatic class nor ESQ answer is recoded or reconciled; incomplete branch precedence remains unknown"] },
  ];
  first.interruptions[1]!.interruption_classifications = [classification("app_switch.device_label", "device-internal")];
  first.interruptions.push({
    interruption_record_id: "example:screen-lock", interruption_type: "SCREEN_LOCK", denotes_interval: {},
    interruption_classifications: [classification("screen_lock.observation_and_ambiguity", "ambiguous")], source_locators: [locator],
  });
  first.interruptions[2]!.denotes_interval.duration_seconds = 7.25;
  first.interruptions[1]!.denotes_interval.duration_seconds = 4.75;
  first.interruptions.forEach((item, i) => item.interruption_classifications!.push({
    ...classification("interruptions.suspending_vs_terminating", i === 0 ? "terminating" : "suspending"), observed_property: "interruption outcome",
  }));
  first.session_questionnaire_responses.find(response => response.observed_property === "offered subjective end reason")!.interruption_record_reference = "example:interruption-A";
  const notification = setting("notification.collector");
  const notification_histories: NotificationHistoryRecord[] = [{
    notification_history_id: "example:why-stop-notification", notification_item_id: "example:why-stop-item",
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: first.participant_id,
    device_id: first.device_id, history_record_origin: "analyst_constructed_example", app_package_name: null,
    notification_evidence: [
      { evidence_record_id: "example:arrival", evidence_kind: "arrival", evidence_role: "recorded", evidence_instant: null, source_locators: notification.source_locators as string[] },
      ...[["app name", '"example: supplied app label"'], ["priority", "null"], ["sound occurred", "true"], ["vibration occurred", "false"]].map(([observed_property, evidence_value_json], i) => ({
        evidence_record_id: "example:metadata-" + i, evidence_kind: "quantity" as const, evidence_role: "recorded" as const,
        observed_property: observed_property!, evidence_value_json: evidence_value_json!, source_locators: notification.source_locators as string[],
      })),
    ],
    source_locators: [...notification.source_locators as string[], "Constructed item identity and metadata only; original Android ID/key, app-label-to-package mapping, content and caller identity are unreported"],
  }];
  first.interruptions[1]!.notification_history_references = [notification_histories[0]!.notification_history_id];
  const participant_day_observations: ParticipantDayObservationRecord[] = [
    [first.participant_id, "example:first-learning-day", "2"], [first.participant_id, "example:later-learning-day", "0"],
    ["example:independent-learning-participant", "example:first-learning-day", "1"],
  ].map(([participant_id, day, count], i) => ({
    day_observation_id: "example:why-stop-day-" + i, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: participant_id!, referenced_day_token: day!, day_record_origin: "analyst_constructed_example", day_observation_kind: "objective_aggregate",
    observed_property: "learning session count", day_observation_value_json: count!, evidence_unit: "count",
    source_locators: [...setting("analysis.first_learning_session_day_zero").source_locators as string[], "Supplied participant-day result; first-learning-day token denotes participant-specific Day0, not installation or a reconstructed calendar; no session-to-day join inferred"],
  }));
  const movement = setting("movement.source_and_filter");
  const sampled_quantity_observations: SampledQuantityObservationRecord[] = ["STILL", "WALKING", "UNKNOWN"].map((state, i) => ({
    sampled_observation_id: "example:why-stop-movement-" + i, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: first.participant_id, device_id: first.device_id, record_origin: "analyst_constructed_example",
    method_setting_reference: movement.method_setting_id, observed_entity_kind: "device",
    app_interruption_session_reference: i < 2 ? first.app_interruption_session_id : second.app_interruption_session_id,
    observation_instant: i === 2 ? null : "example:opaque-movement-instant",
    quantities: [{ observed_property: "movement type", evidence_value_json: JSON.stringify(state) },
      { observed_property: "movement confidence", evidence_value_json: i === 0 ? "95.00" : i === 1 ? "90" : null, evidence_unit: "percent" }],
    source_locators: [...movement.source_locators as string[], "WhyStop primary p3 §3.2/p7 §4.4.1: independent supplied passive readings, not confirmation answers; equal opaque times preserve two observations; no clock, state interval, threshold filtering or latest-state join"],
  }));
  sampled_quantity_observations.push(...["android.intent.action.PHONE_STATE with RINGING", "android.provider.Telephony.SMS_RECEIVED"].map((event, i): SampledQuantityObservationRecord => ({
    sampled_observation_id: "example:why-stop-raw-communication-" + i, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: first.participant_id, device_id: first.device_id, record_origin: "analyst_constructed_example",
    method_setting_reference: setting("communication.collector").method_setting_id, observed_entity_kind: "device",
    ...(i === 0 ? { app_interruption_session_reference: first.app_interruption_session_id } : {}),
    source_event_time_token: i === 0 ? "example:unconverted-phone-event-time" : null,
    quantities: [{ observed_property: "communication event", evidence_value_json: JSON.stringify(event) }],
    source_locators: [...setting("communication.collector").source_locators as string[], "WhyStop p3 §3.2: supplied raw communication occurrences; opaque source time retained, not an interval bound. Session membership is separately supplied or absent; action occurrences are independent supplied memberships, not matched to these raw rows"],
  })));
  return { profiles: [profile], app_interruption_sessions: [first, second], sampled_quantity_observations, notification_histories, participant_day_observations };
}
