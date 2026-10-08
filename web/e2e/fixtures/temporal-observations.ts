export function wearableMoodObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
} {
  const setting = (key: string) => {
    const result = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!result) throw new Error("Missing Wearable Mood source definition: " + key);
    return result;
  };
  const limits = "Constructed supplied identities and values, not original participant rows/serializer. One-Hz phone samples, about-12-Hz watch HR and up-to-1024-Hz ECG HR remain separate; no callback clock, timestamp join/tolerance, HRV window/unit, quality filter, item scoring, trigger cooldown execution, calendar-count window, model execution or published result-cell transcription. Empty locked foreground is not missing. Full activity/light codes, the 13-feature composition, SUS item wording/scoring and source-version software are unreported.";
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string) => ({ observed_property,
    ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }) });
  const base = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:wearable-person", record_origin: "analyst_constructed_example" as const };
  const phone = "constructed:wearable-phone", watch = "constructed:wearable-watch", ecg = "constructed:wearable-ECG";
  const row = (key: string, id: string, quantities: ReturnType<typeof q>[] | null, device = phone, entity: SampledQuantityObservationRecord["observed_entity_kind"] = "device"): SampledQuantityObservationRecord => ({
    ...base, device_id: device, method_setting_reference: setting(key).method_setting_id,
    sampled_observation_id: "constructed:wearable-" + id, observed_entity_kind: entity, quantities,
    observation_instant: "supplied-observation-token:" + id, source_locators: [...setting(key).source_locators as string[], limits],
  });
  const link = (relationship_label: string, id: string) => ({ relationship_label,
    sampled_observation_reference: "constructed:wearable-" + id,
    source_locators: ["357.txt:156–180; explicitly supplied support, no inferred timing, membership or calculation"] });
  const items = [
    ["very tired", "very awake"], ["very content", "very discontent"], ["very agitated", "very calm"],
    ["very full of energy", "very without energy"], ["very unwell", "very well"], ["very relaxed", "very tense"],
  ];
  const triggers = [
    ["prompt.time", "full hour"], ["prompt.calendar", "calendar entry end"], ["prompt.connectivity", "connectivity lost"],
    ["prompt.message", "message sent"], ["prompt.call", "outgoing call ended"], ["prompt.voluntary", "voluntary report"],
  ];
  const task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = triggers.map(([, trigger], index) => {
    const id = "constructed:wearable-MDMQ-" + index;
    return { ...base, device_id: index === 1 ? watch : phone, task_occurrence_id: id,
      task_label: "Constructed independent MDMQ completion; " + (index === 1 ? "three-screen watch layout" : "single-frame phone layout"),
      task_actions: [{ task_action_id: id + ":answer", action_label: "supplied MDMQ completion", source_locators: ["357.txt:87–114; Figs 1–2; action has no inferred prompt/open/answer timestamps"] }],
      task_questionnaire_responses: items.slice(0, index < 2 ? 6 : 1).map(([left, right], i) => ({
        questionnaire_response_id: id + ":item-" + i, questionnaire_setting_reference: setting(index === 1 ? "mdmq.instrument" : "mdmq.items").method_setting_id,
        observed_property: "At this moment I feel:", questionnaire_item_label: left + " / " + right,
        response_value_json: index === 1 ? "null" : JSON.stringify(left),
        source_locators: ["357.txt:87–100; Figs 1–2; supplied endpoint response/unknown, no invented slider code or reverse scoring"] })),
      criterion_assessments: ["valence", "calmness", "energetic arousal"].map((dimension, i) => ({
        criterion_assessment_id: id + ":" + dimension, criterion_setting_reference: setting("mdmq.dimensions").method_setting_id,
        criterion_label: dimension, assessment_value_json: index === 1 ? "null" : ["2.50", "4.25", "1.75"][i],
        source_locators: ["357.txt:156–170; supplied dimension on reported 0–6 range, not computed from item responses"] })).concat([{
          criterion_assessment_id: id + ":class", criterion_setting_reference: setting("valence.classes").method_setting_id,
          criterion_label: "independently supplied valence class", assessment_value_json: index === 1 ? "null" : '"neutral"',
          source_locators: ["357.txt:167–170; supplied classification; no rounding or assignment of gaps between printed ranges"],
        }]), source_locators: ["357.txt:87–114; constructed " + trigger + " occasion; no original occurrence identity or timing recovered", limits] };
  });
  const finalId = "constructed:wearable-final";
  task_occurrences.push({ ...base, device_id: phone, task_occurrence_id: finalId, task_label: "Constructed final-meeting feedback",
    task_questionnaire_responses: ["demographic data", "experience using the app", "quantitative and qualitative comfort feedback"].map((topic, i) => ({
      questionnaire_response_id: finalId + ":" + i, questionnaire_setting_reference: setting("procedure.final_feedback").method_setting_id,
      observed_property: topic, response_value_json: i === 1 ? '"supplied open feedback"' : "null", source_locators: ["357.txt:125–155; reported topic only, no invented full questions or coding"] })),
    criterion_assessments: [{ criterion_assessment_id: finalId + ":SUS", criterion_setting_reference: setting("procedure.final_feedback").method_setting_id,
      criterion_label: "System Usability Scale independently supplied result", assessment_value_json: "75.00", source_locators: ["357.txt:125–155; no recovered SUS items or scoring operation; this is not the published median"] }], source_locators: [limits] });
  const raw = [
    row("location.schema", "location", [q("cell ID", '"supplied-CID"'), q("location area code", '"supplied-LAC"')]),
    row("foreground.schema", "app", [q("foreground application", '"supplied foreground name"'), q("screen locked", "false")]),
    row("foreground.schema", "locked", [q("foreground application", '""'), q("screen locked", "true")]),
    row("microphone.schema", "microphone", [q("maximum absolute amplitude", "0.00")]),
    row("message.schema", "message", [q("hashed unique caller ID", '"supplied-hash-A"'), q("folder", '"inbox"'), q("message length", "12")]),
    row("call.schema", "call", [q("hashed unique caller ID", '"supplied-hash-A"'), q("call type", '"missed"'), q("call duration", "null")]),
    row("light.schema", "light", [q("ambient light", "12.50", "lux")]),
    row("connectivity.schema", "connection", [q("connectivity", '"none"')]),
    row("calendar.schema", "calendar", [q("current entry ID", '"supplied-entry"'), q("calendar name", '"supplied-calendar"')]),
    row("activity.schema", "activity", [q("recognized activity", '"opaque supplied API activity"')]),
    row("watch.cadence", "watch-HR", [q("heart rate", "64.00", "bpm")], watch),
    row("ekg.cadence", "ECG-HR", [q("heart rate", "61.00", "bpm")], ecg),
  ];
  const features = [
    row("time.features", "time-features", [q("day of week", '"supplied weekday"'), q("type of day", '"weekday"'), q("daytime", '"unreported partition token"')]),
    { ...row("light.factorization", "light-category", [q("ambient-light category", '"pitch black"')]), sampled_observation_references: [link("light reading", "light")] },
    { ...row("activity.factorization", "activity-category", [q("activity category", '"stillness"')]), sampled_observation_references: [link("activity reading", "activity")] },
    { ...row("hr.factorization", "HR-block", [q("heart-rate block", "60", "bpm")], watch), sampled_observation_references: [link("heart-rate reading", "watch-HR")] },
    row("feature_ranking.method", "calendar-count", [q("number of calendar entries", "3", "entries")], phone, "participant"),
  ];
  const hrvNames = ["HrvHf", "HrvLf", "HrvLfHf", "HrvPnn50", "HrvRmssd", "HrvSd1", "HrvSd2", "HrvSd2Sd1", "HrvSdnn", "HrvSdsd"];
  const hrv = { ...row("hrv.features", "HRV", hrvNames.map((name, i) => q(name, i === 0 ? "0.00" : i === 1 ? null : String(i + 0.25))), ecg),
    sampled_observation_references: [link("ECG reading", "ECG-HR")] };
  const association = { ...row("hrv.alignment", "association", null, phone, "participant"), task_occurrence_reference: task_occurrences[0]!.task_occurrence_id,
    sampled_observation_references: [link("associated HRV", "HRV")] };
  const secondAssociation = { ...row("hrv.alignment", "association-watch", [], watch, "participant"), task_occurrence_reference: task_occurrences[1]!.task_occurrence_id,
    sampled_observation_references: [link("associated HRV", "HRV")] };
  return { task_occurrences, sampled_quantity_observations: [...raw, ...features, hrv, association, secondAssociation,
    ...triggers.map(([key, trigger], index) => ({ ...row(key!, "trigger-" + index, [q("trigger", JSON.stringify(trigger))], task_occurrences[index]!.device_id!),
      task_occurrence_reference: task_occurrences[index]!.task_occurrence_id }))] };
}

export function nextAppObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const setting = (key: string) => {
    const result = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!result) throw new Error("Missing Next App source definition: " + key);
    return result;
  };
  const limits = "Constructed normalized ownership, supplied values and references; no original row IDs, collector build/API/serializer, clock conversion, latest-action selection, Gaussian endpoints, vector training, aggregation, inventory matching, class threshold, prediction or surrogate-history alignment recovered. Six last-family supports are not last six events; collection time is not source event time. Table2 memberships do not imply co-installation or participant identity.";
  const q = (observed_property: string, evidence_value_json?: string | null) => ({ observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }) });
  const owner = (key: string, id: string, entity: SampledQuantityObservationRecord["observed_entity_kind"] = "device"): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:next-user", device_id: "constructed:next-phone", record_origin: "analyst_constructed_example",
    method_setting_reference: setting(key).method_setting_id, sampled_observation_id: id, observed_entity_kind: entity,
    source_locators: [...setting(key).source_locators as string[], limits],
  });
  const link = (relationship_label: string, sampled_observation_reference?: string | null) => ({ relationship_label,
    ...(sampled_observation_reference === undefined ? {} : { sampled_observation_reference }),
    source_locators: ["Primary pp4–7 §§4.3–5.2; supplied normalized relationship, not an inferred temporal or identity join"] });
  const families = ["Phone Locked", "App Open", "Wifi Connection", "Location Update", "Charge Cable", "Audio Cable", "Context Trigger", "App Installed", "Context Pulled", "Others"];
  const raw = families.map((family, i) => ({ ...owner("source.action_family_inventory", "constructed:next-raw-" + i),
    quantities: [q("action family", JSON.stringify(family))] }));
  raw[1]!.quantities.push(q("app identifier", '"com.android.dialer"'), q("rendered event token", '"App_Opened"'));
  raw[3]!.quantities.push(q("latitude", '"37.393093"'), q("longitude", '"-122.079788"'), q("payload position 3", '"20.000000"'), q("payload position 4", '"0.000000"'), q("rendered event token", '"Location_Update"'));
  raw[6]!.quantities.push(q("Aviate context", '"Work"'), q("rendered event token", '"Context_Triggered"'));
  raw[4]!.quantities.push(q("cable plugged", null)); raw[5]!.quantities.push(q("cable plugged"));
  const prior = { ...owner("source.action_family_inventory", "constructed:next-prior-app"), source_event_time_token: "2014-01-10 12:27:39",
    quantities: [q("action family", '"App Open"'), q("app identifier", '"com.skype.raider"')] };
  const priorRepeat = { ...prior, sampled_observation_id: "constructed:next-prior-repeat" };
  const locationPrior = { ...raw[3]!, sampled_observation_id: "constructed:next-prior-location", source_event_time_token: "supplied-location-time-unordered" };
  const openB = { ...raw[1]!, sampled_observation_id: "constructed:next-open-B" };
  raw[1]!.source_event_time_token = "2014-01-10 12:36:09"; raw[1]!.observation_instant = "independent-supplied-collection-time";
  raw[3]!.source_event_time_token = "2014-01-10 12:47:41";
  const last = ["App Open", "Location Update", "Charge Cable", "Audio Cable", "Context Trigger", "Context Pulled"];
  const supportIds = [prior.sampled_observation_id, locationPrior.sampled_observation_id, raw[4]!.sampled_observation_id, raw[5]!.sampled_observation_id, raw[6]!.sampled_observation_id, raw[8]!.sampled_observation_id];
  const basic = ["Time", "Latitude", "Longitude", "Speed", "GPS Accuracy", "Context Trigger", "Context Pulled", "Charge Cable", "Audio Cable"];
  const feature = { ...owner("features.event_training_rows", "constructed:next-features-A"),
    sampled_observation_references: [link("AppOpen anchor", raw[1]!.sampled_observation_id), ...last.map((family, i) => link("Last " + family, supportIds[i]))],
    quantities: [q("opened app", '"com.android.dialer"'), ...basic.map((name, i) => q(name, ['"12:36:09"', '"37.393093"', '"-122.079788"', "0.00", null, '"Work"', "null", undefined, '"unreported code"'][i])),
      ...last.map((name, i) => q("Last " + name, JSON.stringify([i + 0.25, null, -0.5])))],
  };
  const inventory = (id: string, participant: string, apps: string[]) => ({ ...owner("cold_user.pseudo_inventory", id, "participant"), participant_id: participant,
    device_id: "constructed:phone-" + participant, entity_members: apps.map((app, i) => ({ entity_member_id: "member-" + i,
      member_entity_kind: "application" as const, observed_entity_token: app, source_locators: ["Primary p7 §5.2; constructed static installed membership, not a running or opened claim"] })) });
  const inventories = [
    inventory("constructed:next-inventory-new", "constructed:next-user", ["com.android.dialer", "com.skype.raider"]),
    inventory("constructed:next-inventory-A", "constructed:known-A", ["com.skype.raider"]),
    inventory("constructed:next-inventory-B", "constructed:known-B", ["com.android.dialer"]),
  ];
  // The new user's inventory and observations use one supplied known device.
  inventories[0]!.device_id = "constructed:next-phone";
  const historyA = { ...prior, sampled_observation_id: "constructed:next-history-A", participant_id: "constructed:known-A", device_id: inventories[1]!.device_id };
  const historyB = { ...raw[3]!, sampled_observation_id: "constructed:next-history-B", participant_id: "constructed:known-B", device_id: inventories[2]!.device_id };
  const selected = [link("new user inventory", inventories[0]!.sampled_observation_id), link("selected user inventory", inventories[1]!.sampled_observation_id), link("selected user inventory", inventories[2]!.sampled_observation_id)];
  const app = (key: string, id: string, quantities: ReturnType<typeof q>[]) => ({ ...owner(key, id, "application"), observed_entity_token: "com.android.dialer", quantities });
  const classes = {
    "short-term": ["jp.gree.jackpot", "com.rockstargames.gtasa", "com.sq.dragonsworld", "com.cocoapps.elbomberman", "com.zhan_dui.animetaste", "com.sweettracker.smartparcel", "com.mobie.catholiclife", "com.partyplay.xxl", "com.king.candycrushsaga", "com.battlelancer.seriesguide"],
    "long-term": ["com.quixey.android", "com.google.android.talk", "com.whatsapp", "mobi.mgeek.TunnyBrowser", "com.fitbit.FitbitMobile", "com.spotify.mobile.android.ui", "com.google.android.apps.authenticator2", "com.facebook.katana", "com.myfitnesspal.android", "com.google.android.gm"],
  };
  const publishedClasses = Object.entries(classes).flatMap(([label, apps]) => apps.map((name, i) => {
    const row = { ...app("cold_app.longevity_classifier", "constructed:next-Table2-" + label + i, [q("longevity class", JSON.stringify(label))]),
      observed_entity_kind: "application" as const, observed_entity_token: name };
    Reflect.deleteProperty(row, "participant_id"); delete row.device_id;
    return row;
  }));
  return [...raw, prior, priorRepeat, locationPrior, openB, historyA, historyB, feature,
    { ...feature, sampled_observation_id: "constructed:next-features-B", sampled_observation_references: [link("AppOpen anchor", openB.sampled_observation_id), ...last.map((family, i) => link("Last " + family, i === 0 ? priorRepeat.sampled_observation_id : supportIds[i]))] },
    { ...owner("features.event_training_rows", "constructed:next-features-unknown"), quantities: null, sampled_observation_references: null },
    { ...owner("features.action_context_sampling", "constructed:next-context"), quantities: [q("g1", null), q("g2")],
      sampled_observation_references: [link("context anchor", raw[1]!.sampled_observation_id), link("context member", prior.sampled_observation_id), link("context member", raw[3]!.sampled_observation_id)] },
    { ...owner("features.embedding_mapreduce", "constructed:next-vector"), quantities: [q("distributed action vector", "[ 0.125, null, -0.25 ]")], sampled_observation_references: [link("represented action", prior.sampled_observation_id)] },
    app("popularity.global_frequency", "constructed:next-global", [q("app openings", "7")]),
    ...["1d", "1h", "30m", "15m", "10m", "5m", "1m", "0.5m", "1s"].map((width, i) => app("popularity.timeslot_frequency", "constructed:next-slot-" + i, [q("app openings", "0"), q("timeslot width", JSON.stringify(width)), q("timeslot identity", JSON.stringify("supplied-bin-" + i))])),
    app("popularity.weekly_cycle", "constructed:next-weekday", [q("app openings", "2"), q("day within week", '"supplied-weekday-token"')]),
    app("popularity.activeness", "constructed:next-activeness", [q("app activeness", "0.50"), q("F_ai", "1"), q("F_i", "3"), q("S", "9"), q("activeness rank", "4")]),
    ...inventories, { ...inventory("constructed:next-inventory-empty", "constructed:known-empty", []), entity_members: [] },
    { ...inventory("constructed:next-inventory-unknown", "constructed:known-unknown", []), entity_members: null },
    { ...owner("cold_user.most_similar", "constructed:next-similar", "participant"), quantities: [q("inventory similarity", "0.25")],
      sampled_observation_references: [link("new user inventory", inventories[0]!.sampled_observation_id), link("most similar user inventory", inventories[1]!.sampled_observation_id)] },
    { ...owner("cold_user.pseudo_inventory", "constructed:next-cover", "participant"), quantities: [q("inventory similarity", "0.25"), q("inverse-Jaccard cost", "7.00")], sampled_observation_references: selected },
    { ...owner("cold_user.pseudo_history", "constructed:next-surrogate", "participant"),
      sampled_observation_references: [...selected, link("surrogate history member", historyA.sampled_observation_id), link("surrogate history member", historyB.sampled_observation_id)] },
    { ...owner("cold_app.installation_partition", "constructed:next-install-partition", "participant"), quantities: [q("target app", '"com.android.dialer"')],
      sampled_observation_references: [link("installation anchor", raw[7]!.sampled_observation_id), link("training member", prior.sampled_observation_id), link("prediction member", raw[1]!.sampled_observation_id)] },
    app("cold_app.short_term_prior", "constructed:next-short-prior", [q("app opening prior", "0.20"), q("prior phase", '"initial other-user prior"')]),
    app("cold_app.long_term_prior", "constructed:next-long-prior", [q("app opening prior", "0.75"), q("O_aui", "1"), q("O_u", "7"), q("Omega_ai", "0.20"), q("C")]),
    { ...app("model.prediction_rule", "constructed:next-prediction", [q("probability score", "0.80")]), sampled_observation_references: [link("new user inventory", inventories[0]!.sampled_observation_id)] },
    ...publishedClasses,
  ];
}
// Constructed normalized records, not participant data or recovered serialization.
export function apnomsSummaryExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const five = ["waiting", "voice call", "Wi-Fi", "3G", "other"], three = ["voice call", "Wi-Fi", "3G"];
  return [
    ["reconstruction.time_spent_by_state", "time spent", five], ["reconstruction.battery_spent_by_state", "battery spent", five],
    ["analysis.individual_five_state_time", "time share", five], ["analysis.individual_five_state_battery", "battery-consumption share", five],
    ["analysis.communication_three_state_time", "time share", three], ["analysis.communication_three_state_battery", "battery-consumption share", three],
    ["analysis.power_source_time_share", "power-source time share", ["battery", "USB", "AC"]],
  ].map(([key, property, qualifiers]) => {
    const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
    return { sampled_observation_id: `constructed:apnoms-summary-${key as string}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "example:apnoms-participant", device_id: "example:apnoms-phone", record_origin: "analyst_constructed_example", observed_entity_kind: "participant",
      method_setting_reference: setting.method_setting_id,
      source_locators: [...setting.source_locators as string[], "Constructed independent per-user summaries; five-state and communication-only denominators stay distinct; no snapshot/session join, normalization, summation or original serialization inferred"],
      quantities: (qualifiers as string[]).map((quantity_qualifier, index) => ({ observed_property: property as string, quantity_qualifier,
        ...(String(key).startsWith("analysis.") ? { evidence_unit: "percent" } : {}),
        ...(index === 4 ? {} : { evidence_value_json: ["12.50", "0", "null", null][index] }),
      })),
    };
  });
}

export function apnomsSnapshotExample(): SampledQuantityObservationRecord[] {
  const owner = {
    method_profile_id: "method-profile:doi:10.1109/apnoms.2011.6077030", source_work_id: "doi:10.1109/apnoms.2011.6077030",
    participant_id: "example:apnoms-participant", device_id: "example:apnoms-phone", record_origin: "analyst_constructed_example" as const,
    method_setting_reference: "method-setting-87da78443b1e253a58d67526", observed_entity_kind: "device" as const,
    source_locators: ["rank323-primary.txt:58–89; text SHA256:df1727a02983f86d1d604e0116bb7c0f3c47f2b2c999387b9a812366efcfa9fc; constructed joint readings and opaque sample identities; normalized property labels, not recovered raw fields/codes; Charing retains printed spelling; no cadence, state precedence, sample-to-interval or battery attribution inferred"],
  };
  const properties = ["voice call status", "screen status", "3G data communication status", "active network", "WiFi status", "battery level", "battery status", "battery plugged status"];
  const values: Array<Array<string | null | undefined>> = [
    ['"Ringing"', '"On"', '"InOut"', '"WiFi"', '"On"', "75.00", '"Charing"', '"USB"'],
    ['"Waiting"', '"Off"', '"Out"', '"3G"', '"Off"', "0", '"Discharging"', '"Battery"'],
    ['"Calling"', "null", null, undefined, '"On"', "100.00", '"Full"', '"AC"'],
  ];
  return values.map((row, index) => ({ ...owner, sampled_observation_id: `example:apnoms-sample-${index}`,
    ...(index < 2 ? { observation_instant: "example:opaque-supplied-token" } : {}),
    quantities: properties.map((observed_property, column) => ({ observed_property,
      ...(observed_property === "battery level" ? { evidence_unit: "percent" } : {}),
      ...(row[column] === undefined ? {} : { evidence_value_json: row[column] }),
    })),
  }));
}

export function mommSuppliedObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile) {
  const source = (key: string) => {
    const setting = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!setting) throw new Error(`Missing MOMM definition: ${key}`);
    return setting;
  };
  const limits = "Constructed supplied values and opaque identities; not original records. No hash/serializer/cadence/unit recovery, geographic lookup, clustering/visit/context execution, session join, raw-day membership or aggregation. AP/cell member order is retained, not a source ranking. Configuration booleans normalize supplied truth, not original encoding. Original-dataset configuration/authentication owners are not assumed to be in the filtered usage-session cohort.";
  const owner = (key: string, id: string, originalDataset = false): SampledQuantityObservationRecord & { participant_id: string; observed_entity_kind: "device" } => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: originalDataset ? "constructed:configuration-participant" : "constructed:phone-participant",
    device_id: originalDataset ? "constructed:configuration-device" : "constructed:phone",
    record_origin: "analyst_constructed_example", method_setting_reference: source(key).method_setting_id,
    sampled_observation_id: id, observed_entity_kind: "device", source_locators: [...source(key).source_locators as string[], limits],
  });
  const q = (observed_property: string, value?: string | null, evidence_unit?: string, quantity_qualifier?: string) => ({
    observed_property, ...(value === undefined ? {} : { evidence_value_json: value }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const member = (id: string, kind: "access_point" | "cell", token: string, quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[]) => ({
    entity_member_id: id, member_entity_kind: kind, observed_entity_token: token, quantities,
    source_locators: [kind === "cell" ? "author.txt:219–250; constructed anonymized CID/LAC member, no geographic lookup" : "author.txt:198–250; constructed anonymized AP identity and supplied appearance/member, no inferred signal units"],
  });
  const ap = (id: string, token: string, rssi: string) => member(id, "access_point", token,
    [q("MAC address", JSON.stringify(token)), q("SSID", '"constructed:hashed-ssid"'), q("RSSI", rssi), q("frequency", '"constructed:frequency-token"')]);
  const cell = (id: string, lac: string) => member(id, "cell", `constructed:${id}`,
    [q("CID", '"constructed:hashed-cid"'), q("LAC", JSON.stringify(lac))]);
  const rows: SampledQuantityObservationRecord[] = [
    ...["constructed:lac-a", "constructed:lac-b"].map((lac, i) => ({ ...owner("schema.location_inputs", `constructed:gsm-${i}`),
      observation_instant: "constructed:same-opaque-time", quantities: [q("CID", '"constructed:hashed-cid"'), q("LAC", JSON.stringify(lac))] })),
    { ...owner("schema.location_inputs", "constructed:gsm-partial"), quantities: [q("CID", null), q("LAC")] },
    { ...owner("schema.wifi_scan", "constructed:scan-a"), observation_instant: "constructed:same-opaque-time",
      entity_members: [ap("appearance-a", "constructed:ap-a", "-41.00"), ap("appearance-b", "constructed:ap-b", "-61.00")] },
    { ...owner("schema.wifi_scan", "constructed:scan-b"), observation_instant: "constructed:same-opaque-time",
      entity_members: [ap("appearance-a", "constructed:ap-a", "-42.00")] },
    { ...owner("schema.wifi_scan", "constructed:scan-empty"), entity_members: [] },
    { ...owner("schema.wifi_scan", "constructed:scan-null"), entity_members: null },
    owner("schema.wifi_scan", "constructed:scan-unknown"),
    { ...owner("context.wifi_places", "constructed:wifi-place-a"), observed_entity_kind: "place", observed_entity_token: "constructed:place-a",
      entity_members: [member("wifi-a", "access_point", "constructed:ap-a", [q("MAC address", '"constructed:ap-a"'), q("SSID", "null")]),
        member("wifi-b", "access_point", "constructed:ap-b", [q("MAC address", '"constructed:ap-b"'), q("SSID", null)])],
      root_entity_member_reference: "wifi-b", quantities: [q("place context", '"home"'), q("number of visits to derived place", "8"), q("visits during weekends", "2"), q("total visits", "8"), q("visits during weekday working hours", "1"), q("visits during weekdays", "6"), q("visits on weekday night hours", "3"), q("visits on weekdays during non-working hours", "5")] },
    { ...owner("context.wifi_places", "constructed:wifi-place-b"), observed_entity_kind: "place", observed_entity_token: "constructed:place-b",
      entity_members: [member("wifi-a", "access_point", "constructed:ap-a", [q("MAC address", '"constructed:ap-a"'), q("SSID")])],
      root_entity_member_reference: null, quantities: [q("place context", '"office"')] },
    { ...owner("context.gsm_places", "constructed:gsm-place"), observed_entity_kind: "place", observed_entity_token: "constructed:cell-place",
      entity_members: [cell("cell-a", "constructed:lac-a"), cell("cell-b", "constructed:lac-b")], quantities: [q("place context", '"other meaningful"')] },
    { ...owner("context.gsm_places", "constructed:gsm-place-elsewhere"), observed_entity_kind: "place", entity_members: null, quantities: [q("place context", '"elsewhere"')] },
    { ...owner("aggregation.daily_features", "constructed:daily-summary"), quantities: [
      q("mean daily interaction count", "7.50", undefined, "locked; home; smartphone; all observed days"),
      q("median daily interaction count", "6.00", undefined, "locked; home; smartphone; all observed days"),
      q("mean daily usage time", "4.25", "minutes", "unlocked; office; smartphone; all observed days"),
      q("median daily usage time", "3.00", "minutes", "overall; all contexts; smartphone; all observed days"),
    ] },
    { ...owner("aggregation.session_features", "constructed:session-summary"), quantities: [
      q("mean session duration", "18.50", "seconds", "locked; other meaningful; smartphone; entire observation period"),
      q("median session duration", "12.00", "seconds", "unlocked; elsewhere; smartphone; entire observation period"),
    ] },
    { ...owner("analysis.scan_yield", "constructed:scan-yield"), quantities: ["Wi-Fi scans", "Bluetooth scans"].flatMap((stream, i) => [
      q("scans/day", i ? "0.00" : "11.25", undefined, stream),
      q("visible surrounding AP/device count per scan", i ? "null" : "2.50", undefined, stream),
      q("probability of at least one visible AP/device", i ? null : "0.75", undefined, stream),
    ]) },
    { ...owner("analysis.security_configuration", "constructed:security", true), quantities: [q("device rooted", "true"), q("third-party APK installation allowed", "false")] },
    { ...owner("analysis.locking_population", "constructed:locking", true), quantities: [q("pattern enabled", "true"), q("pattern visual feedback", "false"), q("no locking", "null")] },
    ...["9.99", "10.00", "10.01"].map((duration, i) => ({ ...owner("analysis.unlock_measure", `constructed:authentication-${i}`, true),
      quantities: [q("unlocking-session duration", duration, "seconds", i === 1 ? "Other" : "Pattern")] })),
  ];
  return { profiles: [profile], sampled_quantity_observations: rows };
}

export function mommFormFactorObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile) {
  const setting = profile.method_settings.find(s => s.method_parameter_key === "feature.form_factor");
  if (!setting) throw new Error("Missing MOMM form-factor definition");
  const sampled_quantity_observations: SampledQuantityObservationRecord[] = ["smartphone", "tablet"].map((value, index) => ({
    sampled_observation_id: `constructed:momm-form-factor-${index}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: index === 0 ? "constructed:phone-participant" : "constructed:tablet-participant", device_id: index === 0 ? "constructed:phone" : "constructed:tablet",
    record_origin: "analyst_constructed_example", method_setting_reference: setting.method_setting_id, observed_entity_kind: "device",
    source_locators: [...setting.source_locators as string[], "Constructed independently supplied device classification, not inferred screen geometry, raw identifier equality or a phone-call capability test"],
    quantities: [{ observed_property: "device form factor", evidence_value_json: JSON.stringify(value) }],
  }));
  return { profiles: [profile], sampled_quantity_observations };
}

export function directScreenTimeObservationExample(): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  participant_day_observations: ParticipantDayObservationRecord[];
} {
  const owner = {
    method_profile_id: "method-profile:doi:10.1371/journal.pone.0165331", source_work_id: "doi:10.1371/journal.pone.0165331",
    participant_id: "example:direct-screen-participant",
    source_locators: ["rank132.txt:132–149,188–195,212–214,397–403; PDF SHA256:aaddd48cf10eddf9a081f0834e94e9272e43a518dab9dff38c178ca9ff9202c1; constructed independent hourly readings and one grouped selected-30-day result; 00–23 are normalized recurring clock-hour labels, not original serialization or particular-hour IDs; no calendar bounds, raw-hour membership, denominator, eligibility, clock conversion or aggregation inferred"],
  };
  const values = ["0.00", "12.50", "null", null, undefined, '"3.50"', "1.00", "2.00", "3.00", "4.00", "5.00", "6.00",
    "7.00", "8.00", "9.00", "10.00", "11.00", "12.00", "13.00", "14.00", "15.00", "16.00", "17.00", "18.00"];
  const sleep = ["hour before reported bedtime", "reported bedtime hour", "hour after reported bedtime", "all hours from reported bedtime to reported wake-up time"];
  return {
    participant_day_observations: ["0.00", "12.50", "null", null, undefined].map((value, index) => ({
      ...owner, day_record_origin: "analyst_constructed_example", day_observation_kind: "objective_aggregate",
      day_observation_id: "example:screen-on-minutes", referenced_hour_token: `example:particular-hour-${index}`,
      observed_property: "screen-on minutes within hour", evidence_unit: "minutes",
      ...(value === undefined ? {} : { day_observation_value_json: value }),
    })),
    sampled_quantity_observations: [{
      ...owner, record_origin: "analyst_constructed_example", observed_entity_kind: "participant",
      sampled_observation_id: "example:selected-window-results", method_setting_reference: "method-setting-e446fda52d96418bff224c5f",
      quantities: [
        { observed_property: "total screen-time", evidence_value_json: "15.00", evidence_unit: "hours" },
        { observed_property: "overall average screen-time", evidence_value_json: "3.50", evidence_unit: "minutes/hour" },
        ...values.map((value, index) => ({
          observed_property: "hour-of-day average screen-time", quantity_qualifier: String(index).padStart(2, "0"), evidence_unit: "minutes/hour",
          ...(value === undefined ? {} : { evidence_value_json: value }),
        })),
        ...sleep.map((quantity_qualifier, index) => ({
          observed_property: "sleep-relative average screen-time", quantity_qualifier, evidence_unit: "minutes/hour",
          evidence_value_json: ["0.00", "2.75", null, "null"][index]!,
        })),
      ],
    }],
  };
}

export function screenomicsHourObservationExample(): ParticipantDayObservationRecord[] {
  const owner = {
    method_profile_id: "method-profile:doi:10.1007/s41347-024-00443-5",
    source_work_id: "doi:10.1007/s41347-024-00443-5", participant_id: "example-user",
    day_record_origin: "analyst_constructed_example" as const, day_observation_kind: "objective_aggregate" as const,
    source_locators: ["Screenomics primary236–257,443–490/Table3; PDF SHA256:6a0aabc0166dd810e42201638d25b30d520fad214eefb8eea08e2de01892c712; constructed supplied hour/app records, no NA/zero rule or aggregation executed"],
  };
  return [
    ...["0.00", '"NA"', "null", null, undefined].map((value, i) => ({
      ...owner, day_observation_id: `instagram-duration-${i}`, referenced_hour_token: `example:hour-${i}`,
      app_package_name: "com.instagram.android", observed_property: "sumduration", evidence_unit: "minutes",
      ...(value === undefined ? {} : { day_observation_value_json: value }),
    })),
    { ...owner, day_observation_id: "youtube-duration", referenced_hour_token: "example:hour-0", app_package_name: "com.google.android.youtube", observed_property: "sumduration", day_observation_value_json: "0.00", evidence_unit: "minutes" },
    { ...owner, day_observation_id: "instagram-count", referenced_hour_token: "example:hour-0", app_package_name: "com.instagram.android", observed_property: "countevent", day_observation_value_json: "0" },
    ...["SNS", "Broad", "Google Play", "Popular SM"].map(observation_category => ({
      ...owner, day_observation_id: `category-${observation_category}`, referenced_hour_token: "example:hour-0", observation_category,
      observed_property: "sumduration", day_observation_value_json: "0.00", evidence_unit: "minutes",
    })),
  ];
}

export function typingMotionExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
  sampled_quantity_observations: SampledQuantityObservationRecord[];
} {
  const work = profile.source_work_id;
  const family = work === "doi:10.1007/978-3-319-23222-5_4" ? "touchstroke" : work === "doi:10.1007/s10916-020-1530-z" ? "keyboard-stress" : "hmog";
  if (!["doi:10.1007/978-3-319-23222-5_4", "doi:10.1007/s10916-020-1530-z", "doi:10.1109/tifs.2015.2506542"].includes(work)) throw new Error("Unsupported typing/motion example source");
  const prefix = "constructed:" + family + "-", person = prefix + "person-A", device = prefix + "phone-A";
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing typing/motion definition: " + key);
    return found;
  };
  const limits = family === "touchstroke"
    ? "rank299-primary.txt:71–79,153–162,218–249,268–300; constructed independent authentication attempts, supplied xyz readings/features and memberships. No original Sensor.TYPE codes, raw units, filter coefficients, Android callback timestamps, realized cadence, feature arithmetic, item-action assignment, model fitting or scientific results reconstructed."
    : family === "keyboard-stress"
      ? "110.txt:145–164,173–192,230–273,285–328; constructed supplied task controls, mood answers and pooled windows. Dataset pooled across participants before nominal DS-A/B/C windows; no source order, task-boundary reset, timestamps, participant timeline, label arbitration, arithmetic scoring or feature/model execution inferred. The complete top-k grid is unreported; the constructed subset is not claimed as a tested study setting. Released extra sensor columns are not promoted to the six analyzed axes."
      : "112.txt:160–244,266–355,577–580,667–677,690–929; constructed supplied typing/tap/key/motion regions, selected vectors, user templates, scores, biometric-key outcomes and controlled-device energy values. No original timing alignment, feature/filter/model/cryptographic computation, random key recovery, threshold/EER assignment or published result cells. Mechanism 91-ms blocks remain distinct from whole between-tap gaps; every-sixth downsampling is not an exact16-Hz recovered clock.";
  const base = { method_profile_id: profile.method_profile_id, source_work_id: work, record_origin: "analyst_constructed_example" as const };
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string) => ({ observed_property,
    ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }) });
  const vector = (length: number) => JSON.stringify(Array.from({ length }, (_, i) => i === 1 ? null : (i + 1) / 100));
  const link = (relationship_label: string, id: string | null) => ({ relationship_label, sampled_observation_reference: id === null ? null : prefix + id, source_locators: [limits] });
  type Options = { task?: string; person?: string | null; device?: string | null; kind?: SampledQuantityObservationRecord["observed_entity_kind"]; token?: string; refs?: ReturnType<typeof link>[] };
  const sample = (key: string, id: string, quantities: ReturnType<typeof q>[], options: Options = {}): SampledQuantityObservationRecord => ({
    ...base, participant_id: options.person === undefined ? person : options.person, device_id: options.device === undefined ? device : options.device,
    sampled_observation_id: prefix + id, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind: options.kind ?? "participant", quantities,
    ...(options.task === undefined ? {} : { task_occurrence_reference: prefix + options.task }),
    ...(options.token === undefined ? {} : { observed_entity_token: options.token }),
    ...(options.refs === undefined ? {} : { sampled_observation_references: options.refs }), source_locators: [...setting(key).source_locators as string[], limits, "Feature/statistic identities are explicitly supplied beside values; their constructed order is not a recovered serializer. Omitted/null identities remain unidentified, not a fully named vector."],
  } as SampledQuantityObservationRecord);
  const task = (id: string, task_label: string, owner = person): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({
    ...base, participant_id: owner, device_id: device, task_occurrence_id: prefix + id, task_label, source_locators: [limits],
  });
  const task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = [];
  const rows: SampledQuantityObservationRecord[] = [];
  if (family === "touchstroke") {
    for (const id of ["attempt-A", "attempt-B", "attempt-other"]) {
      const record = task(id, "Supplied four-touch authentication attempt; sensor readings belong to this attempt, not one action", id === "attempt-other" ? prefix + "person-B" : person);
      record.task_actions = Array.from({ length: 4 }, (_, i) => ({ task_action_id: prefix + id + ":touch-" + (i + 1), action_label: "Supplied touch position " + (i + 1), source_locators: ["rank299-primary.txt:71–79,218–228; four arbitrary alphanumeric touches; no original key identity or event serializer recovered"] }));
      task_occurrences.push(record);
    }
    const streams = ["raw_accelerometer", "low_pass_accelerometer", "high_pass_accelerometer", "gravity", "gyroscope", "magnetometer", "orientation"];
    streams.forEach((name, i) => rows.push({ ...sample("sensor.stream." + name, "raw-" + name, [q("x", "0.00"), q("y", i === 0 ? null : "-1.250"), q("z", i === 1 ? undefined : "null")], { task: "attempt-A" }), source_event_time_token: "supplied-event-token:" + name }));
    rows.push(sample("sensor.stream.raw_accelerometer", "second-attempt", [q("x", "19.00")], { task: "attempt-B" }));
    rows.push(sample("sensor.magnitude_formula", "magnitude", [q("sensor", '"sensor.stream.raw_accelerometer"'), q("magnitude", "12.75")], { task: "attempt-A", refs: [link("sensor reading", "raw-raw_accelerometer")] }));
    const touchStatistics = ["skewness", "kurtosis", "mean", "standard deviation"];
    const touchTimings = ["D1", "D2", "D3", "D4", "F1Type1", "F2Type1", "F3Type1", "F1Type2", "F2Type2", "F3Type2", "F1Type3", "F2Type3", "F3Type3", "FType4"];
    rows.push(sample("feature.sensor.matrix_shape", "sensor-vector", [q("sensor", '"sensor.stream.raw_accelerometer"'), ...["x", "y", "z", "magnitude"].map(axis => q(axis + " statistics", "[-0.50,2.75,1.250,0.20]")), q("statistic identities", JSON.stringify(touchStatistics))], { task: "attempt-A", refs: [link("sensor reading", "raw-raw_accelerometer"), link("magnitude reading", "magnitude")] }));
    rows.push(sample("feature.touch.count", "touch-vector", ["D1", "D2", "D3", "D4", "F1Type1", "F2Type1", "F3Type1", "F1Type2", "F2Type2", "F3Type2", "F1Type3", "F2Type3", "F3Type3", "FType4"].map((name, i) => q(name, i === 4 ? "-2.50" : i === 3 ? "null" : String(i + 1))), { task: "attempt-A" }));
    rows.push(sample("fusion.input_pair", "fused", [q("sensor", '"sensor.stream.raw_accelerometer"'), q("fused values", vector(30)), q("feature identities", JSON.stringify([...touchTimings, ...["x", "y", "z", "magnitude"].flatMap(axis => touchStatistics.map(name => axis + ":" + name))]))], { task: "attempt-A", refs: [link("sensor vector", "sensor-vector"), link("touch vector", "touch-vector")] }));
    rows.push(sample("fusion.input_pair", "other-vector", [q("sensor", '"sensor.stream.raw_accelerometer"'), q("fused values", "null")], { task: "attempt-other", person: prefix + "person-B" }));
    rows.push(sample("study.authentication_task", "decision", [q("supplied authentication decision", '"supplied decision; original outcome coding unreported"')], { task: "attempt-A", refs: [link("query vector", "fused"), link("other-user template vector", "other-vector")] }));
  } else if (family === "keyboard-stress") {
    for (const id of ["before", "after"]) {
      const record = task(id, "Independent six-item " + id + " mood questionnaire");
      record.task_questionnaire_responses = ["tired", "happy", "stress", "energy", "angry", "interested"].map((name, i) => ({
        questionnaire_response_id: prefix + id + ":" + name, questionnaire_setting_reference: setting(i === 0 ? "survey.items" : "survey.scale").method_setting_id,
        observed_property: name, response_value_json: id === "after" ? "null" : String(i % 5 + 1), source_locators: ["110.txt:248–273; supplied ordinal item answers, not computed CALM/STRESS labels"] }));
      task_occurrences.push(record);
    }
    for (const [id, condition] of [["calm-typing", "CALM"], ["stress-typing", "STRESS"]]) {
      const record = task(id!, "One representative supplied " + condition + " typing trial from the disclosed five prompts; no invented prompt text or deadline");
      record.criterion_assessments = [{ criterion_assessment_id: prefix + id + ":condition", criterion_setting_reference: setting("label.class").method_setting_id,
        criterion_label: "supplied experimental typing condition", assessment_value_json: JSON.stringify(condition), source_locators: [limits] }];
      task_occurrences.push(record);
      rows.push(sample("sensor.accelerometer", id + "-accel", [q("x", "0.00", "G"), q("y", "-0.5", "G"), q("z", "null", "G")], { task: id }));
      rows.push(sample("sensor.gyroscope", id + "-gyro", [q("x", "0.25", "radians_per_second"), q("y", null, "radians_per_second"), q("z", undefined, "radians_per_second")], { task: id }));
      rows.push(sample("feature.control_fields", id + "-controls", [q("touch_count", id === "calm-typing" ? "9" : "17"), q("backspace_count", "0"), q("age", "24"), q("gender", '"supplied unencoded gender value"')], { task: id }));
    }
    const arithmetic = task("arithmetic", "Subtraction stressor: correct +1, incorrect -1, reach 7 points within 60 seconds; no score execution");
    arithmetic.criterion_assessments = [{ criterion_assessment_id: prefix + "arithmetic:net", criterion_setting_reference: setting("stressor.arithmetic").method_setting_id,
      criterion_label: "independently supplied net-point score", assessment_value_json: "-1", source_locators: ["110.txt:173–192; independent supplied net score, not a count of correct responses or typing input"] }];
    task_occurrences.push(arithmetic, { ...task("stroop", "Supplied two-stage Stroop stressor, not a typing trial"), task_actions: ["identify font color", "identify written color"].map((label, i) => ({task_action_id: prefix + "stroop:" + i, action_label: label, source_locators: ["110.txt:187–227; no original stimulus list/timestamp/response code inferred"]})) });
    const pool: Options = { kind: "participant_group", person: null, device: null, token: "all participants" };
    task_occurrences.push(task("other-typing", "Separate participant's supplied typing trial", prefix + "person-B"));
    rows.push(sample("sensor.accelerometer", "other-accel", [q("x", "0.75", "G")], { task: "other-typing", person: prefix + "person-B" }));
    rows.push(sample("preprocess.concatenate", "pool", [q("population scope", '"all participants"')], { ...pool, refs: [link("accelerometer reading", "calm-typing-accel"), link("gyroscope reading", "stress-typing-gyro"), link("accelerometer reading", "other-accel")] }));
    for (const [name, seconds, count] of [["DS-A", 5, 100], ["DS-B", 10, 200], ["DS-C", 15, 300]] as const) rows.push(sample("preprocess.windows", name, [q("dataset", JSON.stringify(name)), q("window duration", String(seconds), "seconds"), q("nominal row count", String(count), "rows"), q("supplied class", name === "DS-B" ? "null" : '"CALM"')], { ...pool, refs: [link("pooled input", "pool")] }));
    const statisticIdentities = ["minimum","maximum","standard_deviation","arithmetic_mean","absolute_mean","geometric_mean","harmonic_mean","sum","first_quartile","median","third_quartile","variance","skewness","kurtosis","zero_crossings","mean_energy","mean_curve_length","mean_Teager_energy"].reverse();
    const statisticAxes = ["accelerometer_x","accelerometer_y","accelerometer_z","gyroscope_x","gyroscope_y","gyroscope_z"];
    rows.push(sample("feature.statistics", "statistics", [q("statistic identities", JSON.stringify(statisticIdentities)), ...statisticAxes.map(axis => q(axis, JSON.stringify(statisticIdentities.map((name, i) => name === "skewness" ? -0.5 : name === "zero_crossings" ? 2 : i === 1 ? null : (i + 1) / 100))))], { ...pool, refs: [link("source window", "DS-A")] }));
    rows.push(sample("feature.control_fields", "window-controls", [q("touch_count", "11"), q("backspace_count", "2"), q("age", "null"), q("gender", "null")], { ...pool, refs: [link("source window", "DS-A")] }));
    rows.push(sample("feature.total", "vector", [q("feature values", JSON.stringify([null, 24, 2, 11, ...statisticAxes.flatMap(() => statisticIdentities.map((name, i) => name === "zero_crossings" ? 2 : (i + 1) / 100))])), q("feature identities", JSON.stringify(["gender", "age", "backspace_count", "touch_count", ...statisticAxes.flatMap(axis => statisticIdentities.map(name => axis + ":" + name))])), q("supplied class", '"CALM"')], { ...pool, refs: [link("axis statistics", "statistics"), link("window controls", "window-controls")] }));
    rows.push(sample("feature.rank", "rank", [q("feature identity", '"accelerometer_x:skewness"'), q("Gain Ratio", "0.125"), q("rank", "1")], { ...pool, refs: [link("dataset feature vector", "vector")] }));
    rows.push(sample("feature.subsets", "selected", [q("feature identities", '["accelerometer_x:skewness","gyroscope_z:mean_energy"]'), q("feature values", "[1.25,null]"), q("subset size", "2")], { ...pool, refs: [link("dataset feature vector", "vector"), link("ranked feature", "rank")] }));
    rows.push(sample("label.class", "prediction", [q("supplied class", '"STRESS"'), q("classifier", '"C4.5"')], { ...pool, refs: [link("classified vector", "selected")] }));
  } else {
    task_occurrences.push(task("typing-A", "Supplied typing session; tap/key/motion membership is explicit, not inferred from clocks"), task("typing-other", "Separate supplied other-user typing session", prefix + "person-B"));
    const owned: Options = { task: "typing-A" };
    for (const sensor of ["accelerometer", "gyroscope", "magnetometer"]) rows.push({ ...sample("schema.motion_sensors", sensor, [q("sensor", JSON.stringify(sensor)), q("x", "0.00"), q("y", "-1.25"), q("z", "null")], owned), source_event_time_token: "opaque-motion-time:" + sensor });
    for (const id of ["touch-A", "touch-B"]) rows.push(sample("schema.raw_touch", id, [q("contact size", id === "touch-A" ? "1.25" : "0.75")], owned));
    for (const id of ["tap-A", "tap-B", "scroll"]) rows.push(sample("schema.gesture_types", id, [q("gesture", id === "scroll" ? '"scroll"' : '"tap"'), q("start time token", '"opaque-start-' + id + '"'), q("end time token", "null")], { ...owned, refs: id === "tap-A" ? [link("raw touch member", "touch-A"), link("raw touch member", "touch-B")] : [] }));
    for (const [id, phase, key] of [["press-A", "key press", "A"], ["release-A", "key release", "A"], ["press-B", "key press", "B"]]) rows.push(sample("schema.keyboard_latencies", id!, [q("key phase", JSON.stringify(phase)), q("key", JSON.stringify(key)), q("latency", "null")], owned));
    // Keep the exact retained feature-key inventory, not an invented flattened vector order.
    const actualFeatureKeys = profile.method_settings.filter(s => /^feature\.(resistance|stability)\./.test(String(s.method_parameter_key)) && s.method_parameter_key !== "feature.stability.tmin_search").map(s => String(s.method_parameter_key));
    actualFeatureKeys.forEach((key, i) => rows.push(sample(key, "feature-" + i, [q("sensor axis", '"accelerometer:x"'), q("supplied feature", i === 0 ? "2.7500" : "null")], { ...owned, refs: [link("tap", "tap-A"), link("motion member", "accelerometer")] })));
    rows.push(sample("feature.tap_duration", "tap-duration", [q("tap duration", "125.00")], { ...owned, refs: [link("tap", "tap-A")] }));
    rows.push(sample("feature.tap_contact_size", "contact-stats", ["mean", "median", "standard deviation", "first quartile", "second quartile", "third quartile", "first contact size", "minimum", "maximum"].map((name, i) => q(name, String(i / 10))), { ...owned, refs: [link("tap", "tap-A"), link("raw touch member", "touch-A")] }));
    rows.push(sample("feature.tap_velocity", "velocity", [q("velocity", "2.25", "pixels per second")], { ...owned, refs: [link("previous tap", "tap-A"), link("next tap", "tap-B")] }));
    rows.push(sample("feature.key_hold", "key-hold", [q("key", '"A"'), q("key-hold latency", "55.00", "milliseconds")], { ...owned, refs: [link("key press", "press-A"), link("key release", "release-A")] }));
    rows.push(sample("feature.digraph", "digraph", [q("first key", '"A"'), q("second key", '"B"'), q("digraph latency", "71.25", "milliseconds")], { ...owned, refs: [link("first key press", "press-A"), link("second key press", "press-B")] }));
    const featureValues = [q("feature identities", '["supplied selected feature 1","supplied selected feature 2"]'), q("feature values", "[1.250,null]")];
    rows.push(sample("authentication.vector_unit.touch", "tap-vector", [...structuredClone(featureValues), q("feature family", '"HMOG"')], { ...owned, refs: [link("tap", "tap-A"), link("feature", "feature-0")] }));
    rows.push(sample("authentication.vector_unit.keystroke", "key-vector", [...structuredClone(featureValues), q("feature family", '"key hold"')], { ...owned, refs: [link("key press", "press-A"), link("feature", "key-hold")] }));
    const mechanismIdentities = ["gyroscope", "accelerometer"].flatMap(sensor => ["magnitude", "z", "y", "x"].flatMap(axis => actualFeatureKeys.map(key => sensor + ":" + axis + ":" + key)));
    rows.push(sample("mechanism.region.during", "during", [q("HMOG feature values", vector(64)), q("feature identities", JSON.stringify(mechanismIdentities))], { ...owned, refs: [link("tap", "tap-A"), link("motion member", "accelerometer"), link("motion member", "gyroscope")] }));
    rows.push(sample("mechanism.region.between", "between", [q("HMOG feature values", vector(64)), q("feature identities", JSON.stringify([...mechanismIdentities].reverse())),  q("block duration", "91", "milliseconds")], { ...owned, refs: [link("previous tap", "tap-A"), link("next tap", "tap-B"), link("motion member", "gyroscope")] }));
    rows.push(sample("authentication.vector_unit.touch", "other-training", [...structuredClone(featureValues), q("feature family", '"HMOG"')], { task: "typing-other", person: prefix + "person-B" }));
    rows.push(sample("authentication.sm_se_template", "template", structuredClone(featureValues), { device: null, refs: [link("training vector", "tap-vector")] }));
    rows.push(sample("authentication.svm_template", "other-template", structuredClone(featureValues), { person: prefix + "person-B", device: null, refs: [link("training vector", "other-training")] }));
    rows.push(sample("authentication.scan_vector", "scan", [q("scan duration", "60", "seconds"), ...structuredClone(featureValues)], { device: null, refs: [link("test vector", "tap-vector"), link("test vector", "key-vector")] }));
    for (const name of ["HMOG", "tap", "key hold", "digraph"]) rows.push(sample("authentication.score_types", "score-" + name, [q("score type", '"genuine"'), q("score", "0.125"), q("feature family", JSON.stringify(name))], { device: null, refs: [link("query scan", "scan"), link("same-user template", "template")] }));
    rows.push(sample("authentication.score_types", "impostor-score", [q("score type", '"impostor"'), q("score", "0.875"), q("feature family", '"HMOG"')], { device: null, refs: [link("query scan", "scan"), link("other-user template", "other-template")] }));
    rows.push(sample("authentication.score_fusion", "fusion", [q("fused score", "0.625"), ...["HMOG", "tap", "key hold", "digraph"].map(name => q(name + " weight", "0.25"))], { device: null, refs: ["HMOG", "tap", "key hold", "digraph"].map(name => link(name + " score", "score-" + name)) }));
    rows.push(sample("bkg.discretization", "discretized", [q("discretized feature values", "[0,2,null,4]")], { device: null, refs: [link("biometric scan", "scan")] }));
    rows.push(sample("bkg.discretization", "other-discretized", [q("discretized feature values", "[1,0,null,3]")], { person: prefix + "person-B", device: null }));
    rows.push(sample("bkg.commitment", "commitment", [q("commitment tag", '"supplied opaque tag"'), q("masked feature values", "[-2,1,null,0]")], { device: null, refs: [link("discretized biometric", "discretized")] }));
    rows.push(sample("bkg.opening", "opening", [q("opened", "false")], { device: null, refs: [link("commitment", "commitment"), link("opening biometric", "discretized")] }));
    rows.push(sample("bkg.guessing_protocol", "guessing", [q("guessing distance", "3.25"), q("non-guessed", "null")], { device: null, refs: [link("commitment", "commitment"), link("other-user biometric", "other-discretized")] }));
    const hardware: Options = { kind: "device", person: null, device: prefix + "controlled-Galaxy-S4" };
    rows.push(sample("energy.baseline", "baseline", [q("scan duration", "60", "seconds"), q("energy", "2.7500", "joules")], hardware));
    [5, 16, 50, 100].forEach((rate, i) => rows.push(sample("energy.modules", "energy-" + rate, [q("module", i % 2 ? '"HMOG feature computation"' : '"accelerometer and gyroscope collection"'), q("sampling rate", String(rate), "Hz"), q("scan duration", i % 2 ? "120" : "60", "seconds"), q("energy", "3.1250", "joules")], hardware)));
    rows.push(sample("energy.summary_statistics", "energy-summary", [q("mean energy", "3.50", "joules"), q("standard deviation energy", "0.125", "joules"), q("overhead to baseline", "4.75", "percent")], { ...hardware, refs: [link("baseline", "baseline"), link("measurement", "energy-5")] }));
  }
  return { task_occurrences, sampled_quantity_observations: rows };
}

export function assessmentTrioExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
  sampled_quantity_observations: SampledQuantityObservationRecord[];
} {
  const work = profile.source_work_id;
  const family = work === "doi:10.1177/2050157921993896" ? "caught" : work === "doi:10.2196/26540" ? "phq8-markers" : "clinical-episodes";
  if (!["doi:10.1177/2050157921993896", "doi:10.2196/26540", "doi:10.1109/mprv.2015.54"].includes(work)) throw new Error("Unsupported assessment-trio source");
  const prefix = "constructed:" + family + "-";
  const base = { method_profile_id: profile.method_profile_id, source_work_id: work, participant_id: prefix + "person", device_id: prefix + "phone", record_origin: "analyst_constructed_example" as const };
  const limits = family === "caught"
    ? "231.txt:291–368; official qvj8g itemSelection_preprocessing.R:6–39. Constructed supplied completion identities, raw occurrences, interval members, independent features/outcomes and pilot column examples. Consecutive completed responses may cross days and bridge missed prompts. No completion discovery, night correction, interval arithmetic, per-hour normalization, pilot recoding, DSEM grid/collision execution, scoring, model fitting or original serializer/timeline recovery. Pilot column labels are not invented item wording."
    : family === "phq8-markers"
      ? "100.txt:136–230,235–268. Constructed joint battery-change snapshots, independent PHQ-8 completions and selected preceding-14-day features. Acquisition locked/unlocked is not inferred equivalent to analysis on/off. Local-time conversion, day retention, valid-day counts, entropy, day-pair regularity, pooled SD, means and models are not executed. Three printed PHQ examples/endpoints only; other item wording/middle labels, administration details and original 2018 serializer remain unknown. Later released framework fields are not asserted as deployed records."
      : "119-android-cohort-source.txt:132–245,257–360,410–448; 119.txt:80–124. Constructed clinical visits/phone assessment, separate end-of-day self-ratings/consent, supplied modified label windows, motion/GPS summaries, patient models and outcomes. Clinical role and opaque assessor identity are distinct. Window changes follow self-rating consistency, not agreement with the clinical score; exact modification/exclusion/overlap rules are unknown. AND/OR use decisions; weighted fusion uses normalized distances and separately supplied combined threshold. No resampling, timestamps, coordinate transform, feature/state scoring, fusion, threshold optimization, model fitting or result-cell reconstruction. Raw axes/units, self-rating scale, activity-score formula and clock boundaries remain unreported.";
  const setting = (key: string) => {
    const found = profile.method_settings.find(setting => setting.method_parameter_key === key);
    if (!found) throw new Error("Missing assessment-trio source definition: " + key);
    return found;
  };
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string) => ({ observed_property,
    ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }) });
  const text = (property: string, value: string) => q(property, JSON.stringify(value));
  const link = (relationship_label: string, id: string | null) => ({ relationship_label, sampled_observation_reference: id === null ? null : prefix + id, source_locators: [limits] });
  const sample = (key: string, id: string, quantities: ReturnType<typeof q>[], refs?: ReturnType<typeof link>[], task?: string): SampledQuantityObservationRecord => ({
    ...base, sampled_observation_id: prefix + id, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind: "participant", quantities, source_locators: [...setting(key).source_locators as string[], limits],
    ...(refs === undefined ? {} : { sampled_observation_references: refs }), ...(task === undefined ? {} : { task_occurrence_reference: prefix + task }),
  });
  const task = (id: string, task_label: string): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({ ...base,
    task_occurrence_id: prefix + id, task_label, source_locators: [limits] });
  const response = (id: string, key: string, observed_property: string, value?: string | null) => ({ questionnaire_response_id: prefix + id,
    questionnaire_setting_reference: setting(key).method_setting_id, observed_property,
    ...(value === undefined ? {} : { response_value_json: value }), source_locators: [...setting(key).source_locators as string[], limits] });
  const criterion = (id: string, key: string, criterion_label: string, value?: string | null) => ({ criterion_assessment_id: prefix + id,
    criterion_setting_reference: setting(key).method_setting_id, criterion_label,
    ...(value === undefined ? {} : { assessment_value_json: value }), source_locators: [...setting(key).source_locators as string[], limits] });
  const task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = [];
  const rows: SampledQuantityObservationRecord[] = [];
  if (family === "caught") {
    const questions = ["I delayed before starting on work I have to do", "I wasted time by doing other things than what I had intended to do", "I thought: I'll do it later"];
    for (const [index, name] of ["A", "B", "C"].entries()) {
      const id = "completion-" + name, mean = ["4.25", "2.75", "5.25"][index]!;
      task_occurrences.push({ ...task(id, "Actual supplied GPS-ESM completion, since the last survey"), referenced_day_token: "supplied-day-" + name,
        denotes_interval: { end_instant: "supplied-completion-time-" + name },
        task_questionnaire_responses: questions.map((question, i) => response(id + ":item-" + i, i ? "main.outcome.items_fixed_order" : "main.outcome.scale", question, ["1", "4", "7"][i])),
        criterion_assessments: [criterion(id + ":mean", "main.outcome.aggregate", "independently supplied three-item GPS-ESM mean", mean)] });
      rows.push({ ...sample("main.outcome.aggregate", "outcome-" + name, [q("GPS-ESM mean", mean)], undefined, id), source_event_time_token: "supplied-completion-time-" + name });
    }
    for (const [key, id] of [["main.collection.app_open_timestamp", "open"], ["main.collection.app_close_timestamp", "close"], ["main.collection.notification_timestamp", "notification"]])
      rows.push({ ...sample(key!, id!, [text("app identity", "supplied app A")]), source_event_time_token: "supplied-occurrence-time:" + id });
    rows.push(sample("main.preprocess.interval_between_completed_surveys", "interval-AB", [q("elapsed hours", "27.50", "hours")], [link("previous completed survey", "outcome-A"), link("next completed survey", "outcome-B"), link("app-open member", "open"), link("app-close member", "close"), link("notification member", "notification")]));
    rows.push(sample("main.preprocess.interval_between_completed_surveys", "interval-BC", [q("elapsed hours", "4.00", "hours")], [link("previous completed survey", "outcome-B"), link("next completed survey", "outcome-C")]));
    const keys = ["total_duration", "social_media_duration", "messenger_duration", "video_streaming_duration", "browser_duration", "game_duration", "fragmentation_final_operator", "notifications_count"];
    keys.forEach((key, i) => rows.push(sample("main.preprocess." + key, "feature-" + i, [q("supplied feature", i === 6 ? "0.125" : i === 7 ? "3" : "2.7500")], [link("between-completion interval", "interval-AB")])));
    rows.push(sample("main.preprocess.normalize_per_hour", "per-hour", [text("predictor family", "total"), q("supplied per-hour feature", "0.40")], [link("unscaled feature", "feature-0")]));
    rows.push(sample("main.preprocess.analysis_csv_schema", "analysis", [text("predictor family", "total"), q("s", "0.40"), q("p", "2.75"), q("time", "12345.00")], [link("interval feature", "per-hour"), link("completed outcome", "outcome-B")]));
    rows.push(sample("main.dsem.tinterval_assignment", "grid", [text("model grid slot token", "supplied-model-slot")], [link("analysis observation", "analysis")]));
    rows.push(sample("main.dsem.within_random_predictor_slope", "beta", [text("predictor family", "total"), q("supplied beta", "-0.125")], [link("model input", "grid")]));
    task_occurrences.push({ ...task("pilot", "Independent item-selection pilot completion; ordinal source columns, no invented item wording"),
      task_questionnaire_responses: [response("pilot:ordinary", "pilot.preprocess.item_columns", "pilot column 8", '"supplied original label"'), response("pilot:special", "pilot.preprocess.item_columns", "pilot column 32", "null")] });
    rows.push(sample("pilot.preprocess.label_recode", "pilot-recode", [q("column number", "32"), q("supplied recoded answer", "0")], undefined, "pilot"));
    rows.push(sample("pilot.preprocess.add_date", "pilot-date", [text("supplied response-time token", "supplied-pilot-time"), text("supplied derived value", "supplied-pilot-date")], undefined, "pilot"));
    rows.push(sample("pilot.preprocess.add_unix_time", "pilot-unix", [text("supplied response-time token", "supplied-pilot-time"), q("supplied derived value", "12345")], undefined, "pilot"));
    rows.push(sample("pilot.preprocess.per_person_means", "pilot-mean", [q("column number", "32"), q("supplied summary", "2.75")], [link("supplied recoded answer", "pilot-recode")]));
    rows.push(sample("pilot.preprocess.per_person_sd", "pilot-SD", [q("column number", "32"), q("supplied summary", "0.25")], [link("supplied recoded answer", "pilot-recode")]));
  } else if (family === "phq8-markers") {
    task_occurrences.push({ ...task("intake", "Supplied demographic intake"), task_questionnaire_responses: ["age", "gender", "education", "occupation"].map((name, i) => response("intake:" + name, "schema.demographics", name, i ? "null" : "25")) });
    for (const [index, id] of ["PHQ-A", "PHQ-B"].entries()) task_occurrences.push({ ...task(id, "Independent actual PHQ-8 completion; preceding two weeks"),
      task_questionnaire_responses: Array.from({ length: 8 }, (_, i) => ({ ...response(id + ":item-" + i, "phq8.item_scale", "PHQ-8 item " + (i + 1), i === 7 ? null : String(i % 4)),
        ...(i < 3 ? { questionnaire_item_label: ["Little interest or pleasure in doing things", "Feeling down, depressed, or hopeless", "Trouble falling or staying asleep, or sleeping too much"][i] } : {}) })),
      criterion_assessments: [criterion(id + ":total", "phq8.total_range", "independently supplied PHQ-8 total", index ? "9" : "10"), criterion(id + ":binary", "phq8.binary_threshold", "independently supplied binary label, not calculated from total", index ? "0" : "1")] });
    for (const [i, id] of ["snapshot-A", "snapshot-B"].entries()) rows.push({ ...sample("collector.battery_delta_trigger", id, [text("screen sample", i ? "unlocked" : "locked"), text("internet sample", i ? "connected" : "disconnected"), q("foreground app", i ? '"supplied app"' : "null"), text("timezone", "supplied-timezone-token")]), observation_instant: "supplied-joint-snapshot-time:" + id });
    for (const name of ["A", "B"]) rows.push(sample("preprocess.hourly_daily_resolution", "hour-" + name, [text("day token", "supplied-day-" + name), text("particular hour token", "supplied-hour-" + name), q("hour of day", "7"), text("screen modal state", "on"), text("internet modal state", "connected"), q("distinct app count", "2")], [link("acquired snapshot", "snapshot-" + name)]));
    for (const [i, epoch] of ["night", "morning", "afternoon", "evening"].entries()) rows.push(sample("feature.epoch_counts", "epoch-" + epoch, [text("day token", "supplied-day-A"), text("epoch", epoch), ...["screen on count", "screen off count", "connected count", "disconnected count", "app count"].map(name => q(name, String(i)))], [link("acquired snapshot", "snapshot-A")]));
    rows.push(sample("feature.regularity_pair", "day-pair", [text("first day token", "supplied-day-A"), text("second day token", "supplied-day-B"), q("screen regularity", "-0.25"), q("internet regularity", "0.50"), q("app regularity", "null")], [link("first-day hour", "hour-A"), link("second-day hour", "hour-B")]));
    const features = profile.method_settings.filter(setting => String(setting.method_parameter_key).startsWith("output.")).map(setting => String(setting.method_parameter_key).slice(7));
    const featureValues = () => features.map((name, i) => q(name, /regularity/.test(name) ? "-0.25" : (/entropy|Entropy/.test(name) || name.endsWith("_sd")) ? "0.25" : /Count|count/.test(name) ? "3" : String(i + 0.25)));
    for (const name of ["A", "B"]) rows.push(sample("preprocess.participant_day_merge", "day-" + name, [text("day token", "supplied-day-" + name), ...featureValues()], [link("hourly member", "hour-" + name), ...(name === "A" ? [link("epoch member", "epoch-morning")] : []), link("day-pair regularity", "day-pair")]));
    rows.push(sample("qc.day_exclusion_rule", "quality-A", [text("day token", "supplied-day-A"), q("missing log intervals", "9"), q("supplied retained-day decision", "true")], [link("supplied day features", "day-A")]));
    rows.push(sample("qc.day_exclusion_rule", "quality-B", [text("day token", "supplied-day-B"), q("missing log intervals", "10"), q("supplied retained-day decision", "false")], [link("supplied day features", "day-B")]));
    rows.push(sample("analysis.pooling_window", "window-A", [q("window days", "14", "days"), q("valid-day count", "8"), q("supplied retained-response decision", "true")], [link("daily feature member", "day-A"), link("day-quality assessment", "quality-A")], "PHQ-A"));
    rows.push(sample("analysis.pooling_window", "window-B", [q("window days", "14", "days"), q("valid-day count", "null"), q("supplied retained-response decision")], [], "PHQ-B"));
    rows.push(sample("analysis.pool_entropy_regularity", "mean", [text("feature identity", "screen_status_entropy"), q("pooled mean", "0.75")], [link("PHQ8 assessment window", "window-A")]));
    rows.push(sample("analysis.pool_sd", "SD", [text("feature identity", "screen_offCount_sd"), q("pooled SD", "2.50")], [link("PHQ8 assessment window", "window-A")]));
    rows.push(sample("analysis.ml.one_hot_demographics", "encoded", [text("age group", "supplied group"), text("gender", "supplied category"), q("supplied encoded identities", '["supplied age category","supplied gender category"]'), q("supplied encoded values", "[1,0]")]));
    rows.push(sample("analysis.ml.predictor_set_features", "features-only", featureValues(), [link("PHQ8 assessment window", "window-A"), link("pooled mean", "mean"), link("pooled SD", "SD")]));
    rows.push(sample("analysis.ml.predictor_set_demographics", "features-demographics", featureValues(), [link("PHQ8 assessment window", "window-A"), link("pooled mean", "mean"), link("pooled SD", "SD"), link("encoded demographics", "encoded")]));
    rows.push(sample("analysis.lmm_standardization", "standardized", [text("feature identity", "screen_offCount_sd"), q("supplied standardized value", "-0.75")], [link("pooled feature", "SD")]));
  } else {
    const clinicalInstruments = ["Hamilton Depression Scale (HAMD)", "Common Depression Scale (ADS)", "Young Mania Rating Scale (YRMS)", "Mania Self-Rating Scale (MSS)"];
    for (const [i, name] of ["A", "B"].entries()) {
      const id = "clinical-" + name;
      task_occurrences.push({ ...task(id, i ? "Actual interim clinical phone assessment" : "Actual clinical visit"), assessor_id: "supplied-clinician-A",
        task_actions: [{ task_action_id: prefix + id + ":context", action_label: i ? "phone assessment" : "clinical visit", source_locators: [limits] }],
        criterion_assessments: [criterion(id + ":role", "ground_truth.examiner", "supplied assessor role", '"specifically trained clinical psychologist"'),
          ...clinicalInstruments.map(name => criterion(id + ":" + name, "ground_truth.clinical_instruments", name, "null")),
          { ...criterion(id + ":state", "ground_truth.state_scale", "independently supplied clinical state", i ? "1.0" : "-1.5"), support_criterion_assessment_references: [prefix + id + ":role", ...clinicalInstruments.map(name => prefix + id + ":" + name)], support_task_action_references: [prefix + id + ":context"] }] });
      task_occurrences.push({ ...task("diary-" + name, "Separate end-of-day self-assessment and retrospective consent"), referenced_day_token: "supplied-day-" + name,
        task_questionnaire_responses: [response("diary-" + name + ":rating", "collector.components", "supplied end-of-day self-assessment rating", i ? "null" : "2.25"), response("diary-" + name + ":consent", "collector.daily_retrospective_consent", "supplied retrospective day-logging consent", i ? "false" : "true")] });
      rows.push(sample("ground_truth.default_alignment_window_days", "default-" + name, [q("days before assessment", "7", "days"), q("days after assessment", "2", "days")], undefined, id));
      rows.push(sample("collector.components", "self-rating-" + name, [text("day token", "supplied-day-" + name), q("supplied self-assessment rating", i ? "null" : "2.25")], undefined, "diary-" + name));
    }
    rows.push(sample("ground_truth.self_assessment_window_modification", "modified", [q("days before assessment", "5", "days"), q("days after assessment", "3", "days")], [link("default clinical window", "default-A"), link("self-rating evidence", "self-rating-A"), link("self-rating evidence", "self-rating-B")], "clinical-A"));
    for (const [i, name] of ["A", "B"].entries()) rows.push(sample("ground_truth.unstable_self_assessment_exclusion", "assigned-" + name, [text("day token", "supplied-day-" + name), q("supplied assigned clinical state", i ? "1.0" : "-1.5"), q("supplied included-day decision", "true")], [link("clinical assignment window", i ? "default-B" : "modified")]));
    rows.push(sample("acceleration.resample_hz", "raw", [text("stage", "raw signal"), q("supplied acceleration reading", "-0.125"), text("channel token", "supplied-channel")]));
    rows.push(sample("acceleration.resample_hz", "resampled", [text("stage", "resampled signal"), q("supplied acceleration reading", "-0.25"), text("channel token", "supplied-channel")], [link("raw reading", "raw")]));
    rows.push(sample("acceleration.orientation_invariant_magnitude", "magnitude", [q("magnitude", "0.75")], [link("resampled reading", "resampled")]));
    const windowNames = ["root mean square", "frequency centroid", "frequency fluctuation"], dailyNames = windowNames.flatMap(name => ["mean", "variance"].map(statistic => name + ":" + statistic));
    rows.push(sample("acceleration.window_features", "motion-window", windowNames.map((name, i) => q(name, String(i + 0.25))), [link("magnitude member", "magnitude")]));
    for (const name of ["A", "B"]) rows.push(sample("acceleration.daily_aggregation", "accel-" + name, [text("day token", "supplied-day-" + name), ...dailyNames.map((name, i) => q(name, String(i + 0.125)))], [link("window member", "motion-window"), link("clinical day assignment", "assigned-" + name)]));
    rows.push(sample("activity.score_definition", "activity", [text("day token", "supplied-day-A"), text("daypart", "morning"), q("activity score", "2.75")], [link("clinical day comparison", "assigned-A")]));
    const coordinates = [q("coordinate identities", '["supplied coordinate 1","supplied coordinate 2"]'), q("coordinate values", "[1.25,-0.75]")];
    rows.push({ ...sample("gps.source", "GPS-original", structuredClone(coordinates)), source_event_time_token: "supplied-GPS-event" });
    rows.push({ ...sample("gps.privacy_transform", "GPS-anonymous", [q("coordinate identities", '["supplied anonymous coordinate 1","supplied anonymous coordinate 2"]'), q("coordinate values", "[0.25,-0.50]")], [link("original point", "GPS-original")]), source_event_time_token: "supplied-GPS-event" });
    rows.push(sample("gps.feature.outdoor_stays", "stay", [text("day token", "supplied-day-A"), q("stay duration", "2.25")], [link("anonymized point", "GPS-anonymous")]));
    const gpsNames = profile.method_settings.filter(setting => String(setting.method_parameter_key).startsWith("gps.feature.")).map(setting => String(setting.method_parameter_key));
    for (const name of ["A", "B"]) rows.push(sample("gps.daily_feature_count", "GPS-" + name, [text("day token", "supplied-day-" + name), ...gpsNames.map((name, i) => q(name, /distinct_locations|hours_outdoors|outdoor_stays/.test(name) ? "2" : String(i + 0.25)))], [link("anonymized point", "GPS-anonymous"), ...(name === "A" ? [link("outdoor stay", "stay")] : []), link("clinical day assignment", "assigned-" + name)]));
    for (const [label, modality] of [["accel", "accelerometer"], ["GPS", "GPS"]]) {
      rows.push(sample("state_recognition.scope", "model-" + label, [text("model tag", "supplied-patient-model-" + label), text("modality", modality!)], [link("training day", label + "-A")]));
      rows.push(sample("state_recognition.primary_classifier", "prediction-" + label, [text("day token", "supplied-day-B"), text("modality", modality!), q("class identities", "[-1.5,1.0]"), q("class probabilities", "[0.25,0.75]"), q("supplied predicted state", "1.0")], [link("patient model", "model-" + label), link("feature day", label + "-B")]));
      rows.push(sample("change_detection.density", "default-model-" + label, [text("model tag", "supplied-default-model-" + label), q("default state", "-1.5"), text("modality", modality!)], [link("training day", label + "-A")]));
      rows.push(sample("change_detection.distance", "distance-" + label, [text("day token", "supplied-day-B"), q("Mahalanobis distance", "1.25")], [link("default-state model", "default-model-" + label), link("test day", label + "-B")]));
      rows.push(sample("change_detection.normalization", "normalized-" + label, [q("normalized distance", "-0.25"), q("training distance mean", "2.25"), q("training distance SD", "0.50")], [link("distance", "distance-" + label)]));
      rows.push(sample("change_detection.decision", "decision-" + label, [text("day token", "supplied-day-B"), text("modality", modality!), q("supplied threshold", "1.25"), q("supplied change decision", label === "GPS" ? "false" : "true")], [link("normalized distance", "normalized-" + label)]));
    }
    rows.push(sample("state_recognition.fusion.combine", "fusion", [text("day token", "supplied-day-B"), q("class identities", "[-1.5,1.0]"), q("class scores", "[0.4,0.6]"), q("supplied fused state", "1.0")], [link("accelerometer prediction", "prediction-accel"), link("GPS prediction", "prediction-GPS")]));
    for (const variant of ["and", "or"]) rows.push(sample("change_detection.variant." + variant, variant, [text("day token", "supplied-day-B"), q("supplied change decision", variant === "and" ? "false" : "true")], [link("accelerometer decision", "decision-accel"), link("GPS decision", "decision-GPS")]));
    rows.push(sample("change_detection.variant.weighted", "weighted", [text("day token", "supplied-day-B"), q("supplied weighted distance", "-0.125"), q("supplied combined threshold", "0.75"), q("accelerometer weight", "0.25"), q("GPS weight", "0.75"), q("supplied change decision", "null")], [link("accelerometer normalized distance", "normalized-accel"), link("GPS normalized distance", "normalized-GPS")]));
  }
  return { task_occurrences, sampled_quantity_observations: rows };
}

export function participantHourObservationExample() {
  const owner = {
    method_profile_id: "method-profile:doi:10.1145/3313831.3376163",
    source_work_id: "doi:10.1145/3313831.3376163", participant_id: "example-user",
    day_record_origin: "analyst_constructed_example" as const,
    day_observation_kind: "objective_aggregate" as const,
    source_locators: ["CHI2020 Paper36 pp4–5 validity filter/CCM, text345–390; method-setting-2534ea74ac47f3277d2de39d and method-setting-673c09b12602d29c7b83ff60; all values and specific-hour identities constructed"],
  };
  // These identify two particular hours, not recurring hour-of-day buckets.
  return ["example:hour-A-not-a-clock", "example:hour-B-not-a-clock"].flatMap((referenced_hour_token, i) => [
    ...["contempt", "disgust", "joy", "sadness", "surprise"].map((emotion) => ({
      ...owner, referenced_hour_token, day_observation_id: `mean-${emotion}`,
      observed_property: `mean ${emotion}`, day_observation_value_json: String(60 + i),
    })),
    { ...owner, referenced_hour_token, day_observation_id: "app-launches",
      observed_property: "application launch count", day_observation_value_json: i ? "3" : "0" },
    { ...owner, referenced_hour_token, day_observation_id: "app-duration",
      observed_property: "total application use duration", day_observation_value_json: i ? "12.50" : "0.00" },
  ]);
}

// Traffic: DOI10.1145/1879141.1879176, Section2 Dataset2 (process samples),
// distinct from Section4's later per-application two-minute interval analysis.
// Monthly cells: DOI10.1038/s41598-021-82294-1, Figure1 and Methods, pp2/7.
export function temporalObservationExample(
  processProfile = "method-profile:doi:10.1145/1879141.1879176",
  monthProfile = "method-profile:doi:10.1038/s41598-021-82294-1",
) {
  const processOwner = {
    method_profile_id: processProfile, source_work_id: "doi:10.1145/1879141.1879176",
    participant_id: "example-user", device_id: "example-device",
    record_origin: "analyst_constructed_example",
    method_setting_reference: "method-setting-e7753ad2ab13b64b37980b5c",
    source_locators: ["Traffic primary Section2 Dataset2, p2; values and process/time tokens constructed"],
  };
  const monthOwner = {
    method_profile_id: monthProfile, source_work_id: "doi:10.1038/s41598-021-82294-1",
    participant_id: "example-user", record_origin: "analyst_constructed_example",
    method_setting_reference: "method-setting-5cafe8cd8aa6976f15f0ce71",
    source_locators: ["Monthly app-fingerprints Figure1/Methods, pp2/7; partial constructed cells"],
  };
  return {
    sampled_quantity_observations: [
      { ...processOwner, sampled_observation_id: "process-sample-P", observed_entity_kind: "process", observed_entity_token: "process-P", observation_instant: "collection-token-C", quantities: [
        { observed_property: "bytes sent", evidence_value_json: "0", evidence_unit: "bytes" },
        { observed_property: "bytes received", evidence_value_json: '"5"', evidence_unit: "bytes" },
      ] },
      { ...processOwner, sampled_observation_id: "process-sample-Q", observed_entity_kind: "process", observed_entity_token: "process-Q", observation_instant: "collection-token-C", quantities: [
        { observed_property: "bytes sent", evidence_value_json: " 7 ", evidence_unit: "bytes" },
        { observed_property: "bytes received", evidence_value_json: "0", evidence_unit: "bytes" },
      ] },
    ],
    monthly_app_use_cells: [
      { ...monthOwner, cell_id: "month-cell-1", month_label: "February 2016", app_identifier: "opaque-app-A", used_in_month: 1 },
      { ...monthOwner, cell_id: "month-cell-2", month_label: "February 2016", app_identifier: "opaque-app-B", used_in_month: 0 },
      { ...monthOwner, cell_id: "month-cell-3", month_label: "March 2016", app_identifier: "opaque-app-A", used_in_month: null },
      { ...monthOwner, cell_id: "month-cell-4", month_label: "March 2016", app_identifier: "opaque-app-B" },
    ],
  };
}

// Hush §3.1 and Sarsenbayeva CHI2020 p3: supplied normalized examples,
// not recovered source rows. No PID/UID-to-app or frame/session join is asserted.
export function scalarObservationExample(): SampledQuantityObservationRecord[] {
  const hush = {
    method_profile_id: "method-profile:doi:10.1145/2789168.2790107",
    source_work_id: "doi:10.1145/2789168.2790107", participant_id: "example-user", device_id: "example-device",
    record_origin: "analyst_constructed_example" as const,
    source_locators: ["Hush §3.1, rank169:109–123; constructed values and entity/time tokens"],
  };
  return [
    { ...hush, sampled_observation_id: "process-cpu", method_setting_reference: "method-setting-dcb2303d8feefccc21a6f0cd",
      observed_entity_kind: "process", observed_entity_token: "supplied-pid", observation_instant: "coarse-C",
      quantities: [{ observed_property: "CPU usage", evidence_value_json: "0" }] },
    { ...hush, sampled_observation_id: "core-cpu", method_setting_reference: "method-setting-b86467be6e0647b1e9a29ef6",
      observed_entity_kind: "cpu_core", observed_entity_token: "supplied-core", observation_instant: "coarse-C",
      quantities: [{ observed_property: "CPU usage", evidence_value_json: '"5"', evidence_unit: null }] },
    { ...hush, sampled_observation_id: "core-residency", method_setting_reference: "method-setting-5a3755b1d8dc571ccc474e90",
      observed_entity_kind: "cpu_core", observed_entity_token: "supplied-core", observation_instant: "coarse-C",
      quantities: [
        { observed_property: "frequency residency duration", quantity_qualifier: "supplied-frequency-A", evidence_value_json: " 7 " },
        { observed_property: "frequency residency duration", quantity_qualifier: "supplied-frequency-B", evidence_value_json: "0", evidence_unit: null },
        { observed_property: "frequency residency duration", quantity_qualifier: null, evidence_value_json: null },
        { observed_property: "frequency residency duration" },
      ] },
    { ...hush, sampled_observation_id: "uid-on", method_setting_reference: "method-setting-16784c1b8e05b7d624a0efcc",
      observed_entity_kind: "android_uid", observed_entity_token: "supplied-uid", observation_instant: "fine-on-C",
      quantities: [{ observed_property: "network usage", evidence_value_json: "900719925474099312345", evidence_unit: "bytes" }] },
    { ...hush, sampled_observation_id: "uid-off", method_setting_reference: "method-setting-aff794f705ff6a07ba130fc5",
      observed_entity_kind: "android_uid", observed_entity_token: "supplied-uid", observation_instant: "fine-off-C",
      quantities: [{ observed_property: "network usage", evidence_value_json: "0", evidence_unit: "bytes" }] },
    { ...hush, sampled_observation_id: "battery", method_setting_reference: "method-setting-b4cf50a32a7e11a271c77f39",
      observed_entity_kind: "device", observed_entity_token: "example-device", observation_instant: "battery-change-C",
      quantities: [{ observed_property: "battery level", evidence_value_json: "77", evidence_unit: "percent" }] },
    { ...hush, sampled_observation_id: "wifi", method_setting_reference: "method-setting-6f5b5111f7cf4ba0431cce80",
      observed_entity_kind: "device", observed_entity_token: "example-device", observation_instant: "signal-change-C",
      quantities: [{ observed_property: "WiFi signal strength", evidence_value_json: '"null"' }] },
    { ...hush, sampled_observation_id: "cellular", method_setting_reference: "method-setting-44d0b695c00c612e73e72f89",
      observed_entity_kind: "device", observed_entity_token: "example-device", observation_instant: "signal-change-C",
      quantities: [{ observed_property: "cellular signal strength", evidence_value_json: "null" }] },
    { method_profile_id: "method-profile:doi:10.1145/3313831.3376163", source_work_id: "doi:10.1145/3313831.3376163",
      participant_id: "example-user", record_origin: "analyst_constructed_example",
      sampled_observation_id: "emotion-confidence", method_setting_reference: "method-setting-feb3188e492fc052213224d7",
      observed_entity_kind: "participant", observation_instant: "supplied-emotion-time",
      quantities: ["anger", "contempt", "disgust", "fear", "joy", "sadness", "surprise"].map((observed_property, index) => ({
        observed_property, evidence_value_json: index === 0 ? "0" : index === 1 ? "100" : " 25.0 ",
      })),
      source_locators: ["Sarsenbayeva CHI2020 p3, text189–199; constructed independent confidence values, not a sum-to-100 vector"],
    },
  ];
}
export function lonelinessStepObservationExample(): SampledQuantityObservationRecord[] {
  const owner = {
    method_profile_id: "method-profile:doi:10.2196/13209", source_work_id: "doi:10.2196/13209",
    participant_id: "example:loneliness-participant", device_id: "example:fitbit-flex-2",
    record_origin: "analyst_constructed_example" as const, observed_entity_kind: "participant" as const,
    source_locators: ["59-loneliness.txt:270–274,327–353,368–377;59-loneliness-supplement-app1.txt:124–175,255–276,357–364,405–433; independent supplied Fitbit counts and scope summaries; no classification, clocks or aggregation inferred"],
  };
  const summaries = [
    ["total steps", "1000.00", "steps"], ["maximum steps in any five-minute period", "50.00", "steps"],
    ["active bout count", "2", "bouts"], ["sedentary bout count", "3", "bouts"],
    ["minimum active bout length", "5.00", "minutes"], ["maximum active bout length", "15.00", "minutes"],
    ["mean active bout length", "7.50", "minutes"], ["minimum sedentary bout length", "10.00", "minutes"],
    ["maximum sedentary bout length", "30.00", "minutes"], ["mean sedentary bout length", "20.00", "minutes"],
    ["minimum steps over active bouts", "11.00", "steps"], ["maximum steps over active bouts", "77.00", "steps"],
    ["mean steps over active bouts", "30.25", "steps"],
  ] as const;
  return [
    ...["9", "10", "11"].map((evidence_value_json, i) => ({
      ...owner, sampled_observation_id: `example:fitbit-five-minute-${i}`,
      method_setting_reference: "method-setting-c49b1d701d919b7eb7bcefbc", observation_instant: `example:independent-fitbit-sample-${i}`,
      quantities: [{ observed_property: "step count", evidence_value_json, evidence_unit: "steps" }],
    })),
    ...["semester; all day; all days", "weeks 1–6; morning; weekdays", "week 7; evening; weekends"].map((quantity_qualifier, i) => ({
      ...owner, sampled_observation_id: `example:fitbit-summary-${i}`, method_setting_reference: "method-setting-369dafce2182b6c82c9e47e7",
      quantities: summaries.map(([observed_property, evidence_value_json, evidence_unit]) => ({ observed_property, evidence_value_json, evidence_unit, quantity_qualifier })),
    })),
    ...['"asleep"', '"awake"', '"restless"', '"unknown"', undefined, null, "null"].map((evidence_value_json, i) => ({
      ...owner, sampled_observation_id: `example:fitbit-sleep-${i}`, method_setting_reference: "method-setting-10c72eeb4f304472e8920580",
      observation_instant: `example:independent-fitbit-sleep-sample-${i}`,
      source_locators: ["59-loneliness.txt:272–274,365; Fitbit one-minute sleep-state samples; supplied opaque instant, not recovered cadence clock; named unknown is distinct from absent/null data"],
      quantities: [{ observed_property: "sleep state", ...(evidence_value_json === undefined ? {} : { evidence_value_json }) }],
    })),
  ];
}

export function moodableAvailabilityExample(): ParticipantDayObservationRecord[] {
  const owner = {
    method_profile_id: "method-profile:doi:10.1016/j.smhl.2020.100118", source_work_id: "doi:10.1016/j.smhl.2020.100118",
    participant_id: "example:moodable-participant", day_record_origin: "analyst_constructed_example" as const,
    day_observation_kind: "modality_availability" as const, method_setting_reference: "method-setting-fd247f1e496508a700555090",
    source_locators: ["rank292-primary.txt:508–517,603–611,685–689; constructed normalized provided/unavailable states and independent run identities, not source serialization or evidence of repeated participation; unavailable means no supplied modality, not refusal, denied permission, empty log, zero count or model eligibility"],
  };
  return ["example:run-A-not-a-clock", "example:run-B-not-a-clock"].flatMap((referenced_run_token, i) => [
    { ...owner, referenced_run_token, day_observation_id: "example:modality-text", observed_property: "text messages", day_observation_value_json: i ? '"unavailable"' : '"provided"' },
    { ...owner, referenced_run_token, day_observation_id: "example:modality-calls", observed_property: "call logs", day_observation_value_json: i ? '"provided"' : '"unavailable"' },
  ]);
}

export function energyDrainRawObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  if (profile.source_work_id !== "doi:10.1145/2745844.2745875") throw new Error("Energy raw observations require their actual frozen source profile");
  const expectedIds: Record<string, string> = {"collector.dynamic_events":"method-setting-4ea98e6e82da4fbf9d70c3f3","network_reconstruction.input":"method-setting-9742e2cd3e78ef50b4b831df","cpu_model":"method-setting-d44e641d57278d1377b480f6","screen_model":"method-setting-e3b692e617bee2deb414043c"};
  const setting = (key: string) => {
    const actual = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!actual || actual.method_setting_id !== expectedIds[key]) throw new Error("Missing exact Energy raw definition: " + key);
    return actual;
  };
  const owner = (key: string, id: string) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, sampled_observation_id: id,
    participant_id: "constructed:energy-raw-context", device_id: "constructed:energy-raw-device", record_origin: "analyst_constructed_example" as const,
    method_setting_reference: setting(key).method_setting_id,
    source_locators: [...setting(key).source_locators as string[],
      "Primary PDF SHA256:37ec0a2b5b48fd6c5871f12d47015b6a4472437b03249a7a2458863f1d844a14; text SHA256:53a2aa8f2f37aa2dad128835ff2e272344bded1ef3b3adbd19fb9f5961621ea9; rank355:249–262,287–293,1158–1167",
      "Constructed supplied observations, not participant rows or original serializer. Event time and collection time are independent opaque tokens. No event-to-state conversion, artificial task/session group, UID/PID/core/app join, cadence, clock, counter subtraction/reset, call reconstruction, energy estimate or brightness-unit conversion inferred"],
  });
  const q = (observed_property: string, evidence_value_json: string | null, evidence_unit?: string) => ({
    observed_property, evidence_value_json, ...(evidence_unit === undefined ? {} : { evidence_unit }),
  });
  const events = ["WiFi on","WiFi off","mobile data on","mobile data off","screen on","screen off","WiFi association","WiFi scan","WiFi signal change","cellular signal change","battery 1% change","app start","app stop"];
  const occurrences: SampledQuantityObservationRecord[] = events.map((event, index) => ({
    ...owner("collector.dynamic_events", "constructed:energy-event-" + index),
    observed_entity_kind: index < 11 ? "device" : "application",
    observed_entity_token: index < 11 ? "constructed:energy-raw-device" : "supplied-app-token-without-UID-mapping",
    source_event_time_token: "supplied-event-token-E", observation_instant: "independent-collection-token-C",
    quantities: [q("dynamic event", JSON.stringify(event))],
  }));
  return [...occurrences,
    { ...owner("cpu_model", "constructed:energy-core-frequency-A"), observed_entity_kind: "cpu_core", observed_entity_token: "supplied-core-alpha",
      observation_instant: "supplied-frequency-collection-C", quantities: [q("CPU frequency", "384", "MHz")] },
    { ...owner("cpu_model", "constructed:energy-core-frequency-B"), observed_entity_kind: "cpu_core", observed_entity_token: "supplied-core-beta",
      observation_instant: "supplied-frequency-collection-C", quantities: [q("CPU frequency", ' "594.000" ', "MHz")] },
    { ...owner("screen_model", "constructed:energy-raw-brightness"), observed_entity_kind: "device",
      quantities: [q("screen brightness", "51.000")] },
    { ...owner("network_reconstruction.input", "constructed:energy-uid-input-A"), observed_entity_kind: "android_uid", observed_entity_token: "supplied-uid-alpha",
      observation_instant: "supplied-counter-collection-C", quantities: [q("Nsnd", "0", "bytes"), q("Nrcv", "5", "bytes"), q("T", "1", "seconds")] },
    { ...owner("network_reconstruction.input", "constructed:energy-uid-input-B"), observed_entity_kind: "android_uid", observed_entity_token: "supplied-uid-beta",
      observation_instant: "supplied-counter-collection-C", quantities: [q("Nsnd", "7", "bytes"), q("Nrcv", "0", "bytes"), q("T", ' "5.00" ', "seconds")] },
  ];
}

export function energyDrainObservationExample(): SampledQuantityObservationRecord[] {
  const owner = {
    method_profile_id: "method-profile:doi:10.1145/2745844.2745875", source_work_id: "doi:10.1145/2745844.2745875",
    participant_id: "example:energy-participant", device_id: "example:energy-device", record_origin: "analyst_constructed_example" as const,
    source_locators: ["rank355:173–177,239–262,1158–1177; primary PDF SHA256:37ec0a2b5b48fd6c5871f12d47015b6a4472437b03249a7a2458863f1d844a14; constructed scalar observations, independent opaque identities and collection tokens; no source rows, PID/UID/package join, counter subtraction, interval construction or energy prediction"],
  };
  return [
    { ...owner, sampled_observation_id: "example:uid-A", method_setting_reference: "method-setting-c1cd7e231d503b04d7ce7ae3",
      observed_entity_kind: "android_uid", observed_entity_token: "supplied-uid-A", observation_instant: "supplied-collection-C",
      quantities: [{ observed_property: "bytes sent", evidence_value_json: "0", evidence_unit: "bytes" },
        { observed_property: "bytes received", evidence_value_json: '"5"', evidence_unit: "bytes" }] },
    { ...owner, sampled_observation_id: "example:uid-B", method_setting_reference: "method-setting-c1cd7e231d503b04d7ce7ae3",
      observed_entity_kind: "android_uid", observed_entity_token: "supplied-uid-B", observation_instant: "supplied-collection-C",
      quantities: [{ observed_property: "bytes sent", evidence_value_json: " 7 ", evidence_unit: "bytes" },
        { observed_property: "bytes received", evidence_value_json: "0", evidence_unit: "bytes" }] },
    { ...owner, sampled_observation_id: "example:process-usage", method_setting_reference: "method-setting-4761932ccc1e8537b158ae1e",
      observed_entity_kind: "process", observed_entity_token: "supplied-pid", observation_instant: "supplied-coarse-C",
      quantities: [{ observed_property: "CPU usage", evidence_value_json: '"12.50"' }] },
    { ...owner, sampled_observation_id: "example:core-usage-and-residency", method_setting_reference: "method-setting-4761932ccc1e8537b158ae1e",
      observed_entity_kind: "cpu_core", observed_entity_token: "supplied-core", observation_instant: "supplied-coarse-C",
      quantities: [{ observed_property: "CPU usage", evidence_value_json: "0", evidence_unit: null },
        { observed_property: "frequency residency duration", quantity_qualifier: "supplied-frequency-A", evidence_value_json: '"7.00"' },
        { observed_property: "frequency residency duration", quantity_qualifier: "supplied-frequency-B", evidence_value_json: "0" }] },
    { ...owner, sampled_observation_id: "example:gpu-frequency-state-duration", method_setting_reference: "method-setting-8367c67fbbccaeda5a339f13",
      observed_entity_kind: "device", observed_entity_token: "example:energy-device", observation_instant: "supplied-GPU-C",
      quantities: [{ observed_property: "GPU state", evidence_value_json: '"Active"' },
        { observed_property: "GPU frequency", evidence_value_json: "128", evidence_unit: "MHz" },
        { observed_property: "time in state", evidence_value_json: '"7.00"', evidence_unit: null }] },
  ];
}

// Two independently supplied predictor rows per printed feature. This catalog is
// Tables3/4 (36 names), not the prose claim of 35 or the separate cleaning policies.
export function boredomObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile,
  taskIds = ["example:boredom-esm-A", "example:boredom-esm-B"]): SampledQuantityObservationRecord[] {
  const specs: Array<[string, string]> = [
  [
    "borapp.feature.time_last_notif_access",
    "method-setting-06a89c05dbaab6c3d5c4452b"
  ],
  [
    "borapp.feature.battery_level",
    "method-setting-08037a8d170b98415f6cf3f0"
  ],
  [
    "borapp.feature.time_last_outgoing_call",
    "method-setting-08e90fc16419b0c9ab090936"
  ],
  [
    "borapp.feature.age",
    "method-setting-0a13579a3f1d9a188decfde9"
  ],
  [
    "borapp.feature.bytes_received",
    "method-setting-0a24028f1bec23afe1201212"
  ],
  [
    "borapp.feature.time_last_SMS_received",
    "method-setting-1d87202679402a3bdfd5a3fc"
  ],
  [
    "borapp.feature.screen_orient_changes",
    "method-setting-21ec30d86302c37e9fbb9756"
  ],
  [
    "borapp.feature.light",
    "method-setting-2cfb91ed8f7facc65f006908"
  ],
  [
    "borapp.feature.time_last_SMS_read",
    "method-setting-2e245d7d18df702204ad7d67"
  ],
  [
    "borapp.feature.hour_of_day",
    "method-setting-34f601bf40debe65e5861c15"
  ],
  [
    "borapp.feature.num_apps",
    "method-setting-36b2a32024f36b55de7d8a84"
  ],
  [
    "borapp.feature.semantic_location",
    "method-setting-3f060639a0126ae946f91e05"
  ],
  [
    "borapp.feature.time_last_unlock",
    "method-setting-4727080cf3f765c40ba2cb73"
  ],
  [
    "borapp.feature.time_last_notif",
    "method-setting-52e136f07e64bd491d4ee9e5"
  ],
  [
    "borapp.feature.most_used_app_category",
    "method-setting-5692ffc5bd4ac90ba94ff61d"
  ],
  [
    "borapp.feature.comm_notifs_in_tw",
    "method-setting-5ce0551429b1630bb476bad0"
  ],
  [
    "borapp.feature.ringer_mode",
    "method-setting-69595eb1d3a986b79cdfea04"
  ],
  [
    "borapp.feature.day_of_week",
    "method-setting-6c904e9f68be3f55abf8c651"
  ],
  [
    "borapp.feature.proximity",
    "method-setting-7a8c18f3296446e40c4bf461"
  ],
  [
    "borapp.feature.prev_app_in_focus",
    "method-setting-7c8c94275d1570fea277b8f5"
  ],
  [
    "borapp.feature.most_used_app",
    "method-setting-84bdc1a5cabe7e805e4eefee"
  ],
  [
    "borapp.feature.last_notif",
    "method-setting-884c09c10336ec861a1991ef"
  ],
  [
    "borapp.feature.bytes_transmitted",
    "method-setting-911691042d1ff66eec4f8ba0"
  ],
  [
    "borapp.feature.num_unlock",
    "method-setting-91c816a8346dee02e5fd16ed"
  ],
  [
    "borapp.feature.app_category_in_focus",
    "method-setting-92767cd32b228576505c2304"
  ],
  [
    "borapp.feature.time_in_comm_apps",
    "method-setting-9b31b19bceb1c013a61f6c4a"
  ],
  [
    "borapp.feature.apps_per_min",
    "method-setting-a919dfdb135e2590cd6ea65b"
  ],
  [
    "borapp.feature.time_last_SMS_sent",
    "method-setting-b28da509babfd528aef86412"
  ],
  [
    "borapp.feature.audio",
    "method-setting-b53f4c3f7507cbd0f9540ea3"
  ],
  [
    "borapp.feature.charging",
    "method-setting-df5f86935514db29f04d69a4"
  ],
  [
    "borapp.feature.gender",
    "method-setting-e267e0c4115ae73f087a1b70"
  ],
  [
    "borapp.feature.num_notifs",
    "method-setting-e3fc2d4f25b19e9556c3ac6d"
  ],
  [
    "borapp.feature.battery_drain",
    "method-setting-e9197a10ac0bfd8019c2c933"
  ],
  [
    "borapp.feature.time_last_incoming_call",
    "method-setting-f0737838a5f9a897d2e7606a"
  ],
  [
    "borapp.feature.app_in_focus",
    "method-setting-f5966bd450ed74fb43764bed"
  ],
  [
    "borapp.feature.last_notif_category",
    "method-setting-fcda7c9d64e3be9855a58c21"
  ]
];
  const texts: Record<string, string[]> = {
    semantic_location: ["Home", "unknown"], ringer_mode: ["silent", "normal"], time_in_comm_apps: ["none", "micro session"],
    app_in_focus: ["example supplied app", "example supplied app"], prev_app_in_focus: ["other", "other"], most_used_app: ["other", "other"],
    last_notif: ["other", "other"], app_category_in_focus: ["Communication", "Communication"],
    most_used_app_category: ["Productivity", "Productivity"], last_notif_category: ["Society", "Society"],
  };
  return taskIds.flatMap((task_occurrence_reference, index) => specs.map(([key, id]) => {
    const actual = profile.method_settings.find(s => s.method_parameter_key === key);
    if (actual?.method_setting_id !== id) throw new Error(`Missing exact printed Boredom feature ${key}`);
    const property = key.slice("borapp.feature.".length);
    const evidence_value_json = texts[property] ? JSON.stringify(texts[property][index % 2])
      : ["charging", "audio", "proximity", "screen_orient_changes"].includes(property) ? (index ? "false" : "true")
      : property === "hour_of_day" ? "13" : property === "day_of_week" ? "2" : property === "gender" ? String(index % 2)
      : property === "age" ? "29.00" : property === "battery_level" ? " -2.00 " : "1.0000";
    const unit = property === "age" ? "years" : property === "light" ? "lux"
      : ["bytes_received", "bytes_transmitted"].includes(property) ? "bytes" : undefined;
    return {
      sampled_observation_id: `example:boredom-feature:${index}:${property}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "example:not-a-source-participant", record_origin: "analyst_constructed_example" as const,
      method_setting_reference: id, observed_entity_kind: "participant" as const, task_occurrence_reference,
      quantities: [{ observed_property: property, evidence_value_json, ...(unit ? { evidence_unit: unit } : {}) }],
      source_locators: [...actual.source_locators as string[], "Constructed supplied predictor with explicit same-owner ESM identity; no clocks, probe/submission anchor, raw serializer, window membership, percentile cap, app lookup, category computation or value calculation recovered"],
    };
  }));
}

export function boredomRatioExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  return ["borapp2.outcome.click_ratio", "borapp2.outcome.engagement_ratio"].flatMap((key, ratio) => {
    const setting = profile.method_settings.find(s => s.method_parameter_key === key)!;
    return ["inferred bored", "inferred normal"].map((quantity_qualifier, condition) => ({
      sampled_observation_id: `example:boredom-ratio:${ratio}:${condition}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "example:pilot-not-a-source-participant", record_origin: "analyst_constructed_example" as const,
      method_setting_reference: setting.method_setting_id, observed_entity_kind: "participant" as const,
      quantities: [{ observed_property: key.slice("borapp2.outcome.".length), quantity_qualifier, evidence_unit: "percent",
        evidence_value_json: ratio ? condition ? "null" : "10.00" : condition ? "0.00" : "20.00" }],
      source_locators: [...setting.source_locators as string[], "Constructed independent participant/condition percentage; no history census, ratio computation, denominator, random assignment, main-study or pilot-row join"],
    }));
  });
}

export function energyDrainSummaryExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  participant_day_observations: ParticipantDayObservationRecord[];
} {
  if (profile.source_work_id !== "doi:10.1145/2745844.2745875") throw new Error("Energy summary requires its actual frozen source profile");
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing Energy summary definition: " + key);
    return found;
  };
  const source = [
    "rank355:366–397,454–680,735–883,915–1059; primary SHA256:37ec0a2b5b48fd6c5871f12d47015b6a4472437b03249a7a2458863f1d844a14; text SHA256:53a2aa8f2f37aa2dad128835ff2e272344bded1ef3b3adbd19fb9f5961621ea9",
    "Constructed independent supplied quantities, opaque subjects/days/versions and partial unknowns; not source rows or serializer. No participant=device equality, PID/UID/package join, selected-window bounds, foreground/background inference, energy/time division, weighted mean, quintile boundary or reported-result reproduction.",
  ];
  const q = (observed_property: string, value?: string | null, evidence_unit?: string, quantity_qualifier?: string): import("../../src/lib/methodProfiles").SampledQuantityRecord => ({
    observed_property, ...(value === undefined ? {} : { evidence_value_json: value }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const sample = (key: string, id: string, kind: "device" | "cpu_core" | "application" | "application_category", token: string, quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[]): SampledQuantityObservationRecord => {
    const def = setting(key);
    const base = { sampled_observation_id: id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      method_setting_reference: def.method_setting_id, record_origin: "analyst_constructed_example" as const,
      observed_entity_token: token, quantities, source_locators: [...def.source_locators as string[], ...source] };
    // App/version averages are across devices (§5.4), not an invented participant.
    if (kind === "application" || kind === "application_category") return { ...base, observed_entity_kind: kind };
    return { ...base, observed_entity_kind: kind, participant_id: "constructed:energy-context", device_id: kind === "device" ? token : "constructed:energy-device-A" };
  };
  const cpu = ["background services during screen-off", "background apps during screen-off", "background services during screen-on",
    "background apps during screen-on", "foreground apps during screen-on", "idle during screen-on", "idle during screen-off"];
  const activities = ["SOC, WiFi beacons, WiFi scanning and cellular paging during screen-off", "background services during screen-off",
    "background apps during screen-off", "background services during screen-on", "background apps during screen-on",
    "foreground CPU, GPU and network during screen-on", "idle CPU during screen-on", "idle CPU during screen-off", "screen during screen-on"];
  const components = ["SOC", "cellular paging", "WiFi beacon", "WiFi scan", "screen", "cellular network", "WiFi network", "GPU", "CPU idle", "CPU busy during screen-off", "CPU busy during screen-on"];
  const appComponents = ["foreground CPU", "foreground GPU", "foreground network", "foreground screen", "background CPU", "background network"];
  const appQuantities = (offset: number) => appComponents.map((component, i) =>
    q("average daily " + component + " energy", ["0", "1.25", "null", null, undefined, String(7 + offset)][i], "mAh"));
  const sampled_quantity_observations = [
    sample("analysis.screen_intervals", "constructed:device-screen-summaries", "device", "constructed:energy-device-A", [
      q("average daily screen-on time", "12.50", "minutes"), q("average daily screen-off time", "0.00", "minutes"),
      q("screen-on interval duration", "0", "minutes"), q("screen-off interval duration", "null", "minutes")]),
    sample("analysis.cpu_classes", "constructed:device-cpu-summaries", "device", "constructed:energy-device-A", [
      ...cpu.map((variant, i) => q("CPU time", String(i), "hours", variant)),
      ...cpu.map((variant, i) => q("share of total daily CPU time", String(10 + i), "percent", variant))]),
    sample("analysis.energy_components", "constructed:device-energy-summaries", "device", "constructed:energy-device-A", [
      ...activities.map((variant, i) => q("activity energy", String(i), "mAh", variant)),
      ...components.map((variant, i) => q("component energy", String(i + 3), "mAh", variant)),
      q("duration-weighted screen brightness", "59.00", "percent")]),
    ...["constructed:core-0", "constructed:core-1"].map((token, i) =>
      sample("analysis.energy_components", "constructed:core-frequency-share-" + i, "cpu_core", token, [
        q("frequency time share during screen-on, normalized to core-0 on-time", "0", "percent", "supplied-frequency-A"),
        q("frequency time share during screen-off, normalized to core-0 on-time", '"7.00"', "percent", "supplied-frequency-B")])),
    sample("analysis.network_connectivity", "constructed:device-connectivity-summaries", "device", "constructed:energy-device-A", [
      ...["WiFi connected", "WiFi disconnected and mobile data connected", "both disconnected", "WiFi scanning while WiFi connected",
        "WiFi scanning while mobile data connected", "WiFi scanning while both disconnected"].map((variant, i) => q("connectivity time share", String(i), "percent", variant)),
      q("traffic volume", "0", "bytes", "WiFi"), q("traffic volume", '"5"', "bytes", "cellular"),
      ...["WiFi active", "WiFi tail", "WiFi scan", "WiFi beacon", "cellular active", "cellular tail", "cellular paging"].map((variant, i) => q("wireless energy", String(i), "mAh", variant))]),
    ...["constructed:app-alpha", "constructed:app-beta"].map((token, i) => sample("analysis.per_app", "constructed:app-energy-" + i, "application", token, [
      ...appQuantities(i), q("total average daily app energy", String(30 + i), "mAh"), q("background energy share", "12.50", "percent"),
      q("total foreground energy", "20.00", "mAh"), q("total foreground time", '"2.75"'),
      q("foreground energy drain rate", i ? "0" : "333.30", "mA")])),
    sample("analysis.app_categories", "constructed:app-category", "application_category", "constructed:category-Game", [
      q("Google Play category", '"Game"'), ...appQuantities(0),
      q("total average daily app energy within category", "29.75", "mAh"), q("average background energy share", "32.50", "percent"),
      q("screen energy share", "0", "percent"), q("GPU energy share", '"12.90"', "percent"),
      q("CPU energy share", "28.60", "percent"), q("network energy share", "null", "percent")]),
    ...["supplied-version-A", "supplied-version-B"].map((version, i) => sample("analysis.named_app_versions", "constructed:app-version-" + i, "application", "constructed:named-app", [
      q("app name", '"Facebook"'), q("app version", JSON.stringify(version)), q("foreground energy drain rate", i ? '"0.00"' : "123.50", "mA")])),
    ...["least active", "less active", "medium active", "more active", "most active"].map((label, i) =>
      sample("analysis.user_quintiles", "constructed:quintile-" + i, "device", "constructed:independent-device-" + i, [q("screen-time quintile", JSON.stringify(label))])),
    ...["S3/Jelly Bean", "S4/Jelly Bean", "S3/KitKat", "S4/KitKat"].map((label, i) =>
      sample("analysis.device_os_strata", "constructed:device-os-" + i, "device", "constructed:independent-device-" + i, [q("device/OS stratum", JSON.stringify(label))])),
    sample("analysis.cellular_strata", "constructed:radio-summaries", "device", "constructed:energy-device-A", [
      ...["3G", "LTE"].flatMap(variant => [q("cellular connectivity time share", "0", "percent", variant), q("cellular traffic share", '"7.00"', "percent", variant),
        q("cellular energy share excluding paging", "null", "percent", variant)]),
      ...["3G good", "3G medium", "3G poor", "LTE good", "LTE medium", "LTE poor"].map((variant, i) =>
        q("energy normalized by traffic volume", String(i), "mAh/MB", variant))]),
  ];
  const dayOwner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:energy-context", day_record_origin: "analyst_constructed_example" as const,
    day_observation_kind: "objective_aggregate" as const, source_locators: source };
  const day = (device_id: string, referenced_day_token: string, day_observation_id: string, observed_property: string,
    value: string | null | undefined, evidence_unit: string, observation_category?: string, app_package_name?: string): ParticipantDayObservationRecord => ({
    ...dayOwner, device_id, referenced_day_token, day_observation_id, observed_property, evidence_unit,
    ...(value === undefined ? {} : { day_observation_value_json: value }),
    ...(observation_category === undefined ? {} : { observation_category }), ...(app_package_name === undefined ? {} : { app_package_name }),
  });
  const participant_day_observations = ["constructed:energy-device-A", "constructed:energy-device-B"].flatMap((device, i) =>
    ["supplied-day-A", "supplied-day-B"].flatMap((token, j) => [
      day(device, token, "constructed:screen-on", "screen-on time", i ? "0.00" : '"12.50"', "minutes"),
      day(device, token, "constructed:screen-off", "screen-off time", j ? "null" : "0", "minutes"),
      ...cpu.map((variant, n) => day(device, token, "constructed:cpu-" + n, "CPU time", String(n), "hours", variant)),
      ...activities.map((variant, n) => day(device, token, "constructed:activity-energy-" + n, "activity energy", String(n), "mAh", variant)),
      ...components.map((variant, n) => day(device, token, "constructed:component-energy-" + n, "component energy", String(n), "mAh", variant)),
      ...["com.example.energy.alpha", "com.example.energy.beta"].flatMap((app, a) =>
        appComponents.map((component, n) => day(device, token, "constructed:app-" + a + "-component-" + n,
          component + " energy", [undefined, null, "null", "0", '"1.25"', "7.00"][n], "mAh", component.startsWith("foreground") ? "foreground" : "background", app))),
    ]));
  return { sampled_quantity_observations, participant_day_observations };
}



/** Boredom p3 Tables1/2: independently supplied raw observations, not derived predictors or a deployed collector. */
export function boredomRawObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  notification_histories: import("../../src/lib/methodProfiles").NotificationHistoryRecord[];
} {
  if (profile.source_work_id !== "doi:10.1145/2750858.2804252") throw new Error("Boredom raw observations require their actual frozen source");
  const setting = (key: string) => {
    const locals = profile.method_settings.filter(s => s.method_parameter_key === key);
    if (locals.length !== 1) throw new Error("Missing/ambiguous Boredom raw definition: " + key);
    return locals[0]!;
  };
  const pin = "Primary p3 Tables1/2 and acquisition paragraph; PDF SHA256:742c12c64195e69d26669765db5a91f16a63a24fef84babb9c3bcfadc559e493; text SHA256:573c960515520042ebaa5c74454e01fc58b2b400b0a48149110250626ffd8b18";
  const limits = "Constructed independent normalized readings/occurrences, not original source rows/serializer or deployed collection. Table1 always-active and Table2 screen-on-and-unlocked remain definition-owned acquisition scopes, not inferred realized state. No shared cadence, cumulative/delta/reset, event constants, call/SMS IDs or bounds, notification deduplication, point-time conversion, raw-to-predictor, task/session grouping or ESM join.";
  const locators = (key: string) => [...setting(key).source_locators as string[], pin, limits];
  const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:raw-not-a-source-participant", device_id: "example:raw-not-a-source-device" };
  const quantity = (observed_property: string, evidence_value_json: string | null, evidence_unit?: string): import("../../src/lib/methodProfiles").SampledQuantityRecord => ({
    observed_property, evidence_value_json, ...(evidence_unit === undefined ? {} : { evidence_unit }),
  });
  const specs: Array<[string, import("../../src/lib/methodProfiles").SampledQuantityRecord[]]> = [
    ["battery_status", [quantity("battery level", "0.00", "percent")]],
    ["proximity", [quantity("proximity state", '"screen covered"')]],
    ["ringer_mode", [quantity("ringer mode", '"Vibration"')]],
    ["airplane_mode", [quantity("whether phone in airplane mode", "false")]],
    ["ambient_noise", [quantity("ambient noise", "17.50", "dB")]],
    ["audio_jack", [quantity("phone connected to headphones or speakers", "true")]],
    ["cell_tower", [quantity("connected cell tower", '"supplied-cell-A"')]],
    ["data_activity", [quantity("bytes uploaded", "0", "bytes"), quantity("bytes downloaded", "5", "bytes")]],
    ["foreground_package", [quantity("foreground package name", '"example.foreground.package"')]],
    ["light", [quantity("ambient light level", "0", "lux")]],
    ["screen_orientation", [quantity("screen orientation", '"Portrait"')]],
    ["wifi_info", [quantity("connected Wi-Fi network", '"supplied-network-A"')]],
  ];
  const observation = (short: string, id: string, quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[]): SampledQuantityObservationRecord => {
    const key = "borapp.schema." + short;
    return { ...owner, sampled_observation_id: "example:boredom-raw:" + id, record_origin: "analyst_constructed_example",
      method_setting_reference: setting(key).method_setting_id, observed_entity_kind: "device",
      observed_entity_token: owner.device_id, quantities, source_locators: locators(key) };
  };
  const sampled_quantity_observations = specs.map(([short, quantities]) => observation(short, short, quantities));
  const events: Array<[string, string, string, string | null | undefined]> = [
    ["screen_events", "screen event", "screen turned on", undefined], ["screen_events", "screen event", "screen turned off", null],
    ["screen_events", "screen event", "screen unlocked", undefined], ["phone_events", "phone event", "incoming call", "supplied-call-time-A"],
    ["phone_events", "phone event", "outgoing call", "supplied-call-time-B"], ["sms", "SMS event", "receiving SMS", "supplied-SMS-time-A"],
    ["sms", "SMS event", "reading SMS", "supplied-SMS-time-B"], ["sms", "SMS event", "sending SMS", "supplied-SMS-time-C"],
  ];
  events.forEach(([short, property, event, token], index) => {
    const row = observation(short, "event:" + index, [quantity(property, JSON.stringify(event))]);
    if (token !== undefined) row.source_event_time_token = token;
    // A separately supplied collection token is not a conversion or equality claim.
    if (index === 3) row.observation_instant = "independently-supplied-collection-token";
    sampled_quantity_observations.push(row);
  });
  const notification_histories: import("../../src/lib/methodProfiles").NotificationHistoryRecord[] = [0, 1].map(index => ({
    ...owner, notification_history_id: "example:boredom-raw-notification:" + index,
    notification_item_id: "example:independently-supplied-notification:" + index,
    history_record_origin: "analyst_constructed_example", app_package_name: "example.notification.package",
    notification_evidence: [{ evidence_record_id: "example:raw-post:" + index, evidence_kind: "arrival", evidence_role: "recorded",
      evidence_instant: "same-supplied-notification-time", source_locators: locators("borapp.schema.notifications") }],
    source_locators: [...locators("borapp.schema.notifications"),
      "Two supplied identities with equal time/app do not recover source item keys, update/dismissal joins or NLS callback payloads."],
  }));
  return { sampled_quantity_observations, notification_histories };
}

import type { ParticipantDayObservationRecord, SampledQuantityObservationRecord } from "../../src/lib/methodProfiles";

// Source-shaped normalized examples, not the papers' unavailable raw rows.
export function appMembershipObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  profiles: import("../../src/lib/methodProfiles").StudyMethodProfile[];
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  participant_day_observations: ParticipantDayObservationRecord[];
  app_feature_sessions: import("../../src/lib/methodProfiles").AppFeatureSessionRecord[];
} {
  if (profile.source_work_id === "doi:10.1145/2638728.2641700") return { profiles: [profile], sampled_quantity_observations: rankedRecentTaskObservationExample(profile), participant_day_observations: [], app_feature_sessions: [] };
  const installed = profile.source_work_id === "doi:10.4000/questionsdecommunication.9851";
  if (!installed && profile.source_work_id !== "doi:10.1007/s42486-020-00045-z") throw new Error("No source-shaped app-membership example for this profile");
  const source = (key: string) => {
    const setting = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!setting) throw new Error(`Missing application-membership definition: ${key}`);
    return setting;
  };
  const limits = installed
    ? "Ouakrat260.txt:243–250,616–652; primary PDF SHA256:e48ddf456c3f49f9602514188af53b380315aafa49a9e903bd1141b8ba12ebf7; constructed static installed memberships; no timestamp/cadence/day/usage/launch, package-name lookup, installation action or original serializer inferred. Native/operator/manufacturer/Android and user-installed are supplied categories, not inferred from app names. Cohort mean84 and five-case native54% remain separate definitions, not values of these inventories."
    : "NextApps101.txt:130–193,386–409; primary PDF SHA256:9a5e106c89081874b2cc5e727ed66048d221164c0858cb3c18a42ef24ff45bec; constructed simultaneous running-app snapshots and independent per-user binary feature rows; five-minute interval is specification, not a generated clock. No foreground/launch/session identity, GPS discretization, raw-to-feature join, duplicate-removal, complete per-user vocabulary or model execution inferred.";
  const key = installed ? "probe.static_device" : "dataset.fields";
  const owner = (reference: string, id: string): SampledQuantityObservationRecord => ({
    sampled_observation_id: id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:app-membership-participant", device_id: "constructed:app-membership-device",
    record_origin: "analyst_constructed_example", method_setting_reference: source(reference).method_setting_id,
    observed_entity_kind: "device", source_locators: [...source(reference).source_locators as string[], limits],
  });
  const member = (id: string, token?: string | null): import("../../src/lib/methodProfiles").SampledEntityMemberRecord => ({
    entity_member_id: id, member_entity_kind: "application", ...(token === undefined ? {} : { observed_entity_token: token }), source_locators: [limits],
  });
  const a = member("app-a", installed ? "constructed:native-application" : "example.running.a");
  const b = member("app-b", installed ? "constructed:user-installed-application" : "example.running.b");
  if (installed) {
    a.quantities = [{ observed_property: "installation origin", evidence_value_json: '"native/operator/manufacturer/Android"' }];
    b.quantities = [{ observed_property: "installation origin", evidence_value_json: '"user-installed"' }];
  }
  const full = { ...owner(key, installed ? "constructed:installed-inventory-a" : "constructed:running-snapshot-a"),
    ...(!installed ? { observation_instant: "constructed:same-supplied-time" } : {}),
    entity_members: [a, b],
    quantities: installed ? [{ observed_property: "device type", evidence_value_json: '"constructed:phone-type"' },
      { observed_property: "operator", evidence_value_json: "null" }, { observed_property: "Android version" }]
      : [{ observed_property: "smartphone location", evidence_value_json: '"constructed:supplied-location-token"' }],
  };
  const repeated = structuredClone(full);
  repeated.sampled_observation_id = installed ? "constructed:installed-inventory-b" : "constructed:running-snapshot-b";
  const rows: SampledQuantityObservationRecord[] = [full, repeated,
    { ...owner(key, "constructed:membership-empty"), entity_members: [] },
    { ...owner(key, "constructed:membership-null"), entity_members: null },
    owner(key, "constructed:membership-omitted"),
  ];
  const partial = member("unknown-app", null);
  if (installed) partial.quantities = [{ observed_property: "installation origin", evidence_value_json: "null" }];
  rows.push({ ...owner(key, "constructed:membership-partial"), entity_members: [partial, member("unreported-app")] });
  if (!installed) rows.push({
    ...owner("preprocess.app_vector", "constructed:independent-app-vector"), observation_instant: "constructed:independent-feature-time",
    quantities: [{ observed_property: "time-bin vector", evidence_value_json: " [1.00,0,0,0] " },
      { observed_property: "location vector", evidence_value_json: "[0,1,0]" }],
    entity_members: [
      { ...member("app-a", "example.running.a"), quantities: [{ observed_property: "app used", evidence_value_json: "1.00" }] },
      { ...member("app-b", "example.running.b"), quantities: [{ observed_property: "app used", evidence_value_json: "0.00" }] },
      { ...member("app-c", "example.running.c"), quantities: [{ observed_property: "app used", evidence_value_json: "null" }] },
    ],
  });
  if (!installed) return { profiles: [profile], sampled_quantity_observations: rows, participant_day_observations: [], app_feature_sessions: [] };
  const rawLimits = "Ouakrat260.txt:243–250; constructed independent acquired occurrences/measurements. Source event-time tokens are not collection-time instants or wall-clock datetimes; battery/network timestamp status and original units are unreported. No screen/foreground interval or task/session grouping inferred; SMS directions are normalized concepts, not recovered event codes; no call events are disclosed.";
  for (const [rawKey, id, values] of [
    ["probe.battery", "constructed:battery", [{ observed_property: "battery level", evidence_value_json: "50.00" }]],
    ["probe.network", "constructed:network", [{ observed_property: "network detection", evidence_value_json: "true" }, { observed_property: "network performance", evidence_value_json: null }]],
  ] as const) rows.push({ ...owner(rawKey, id), quantities: [...values], source_locators: [...source(rawKey).source_locators as string[], rawLimits] });
  rows.push(
    { ...owner("probe.screen_activation", "constructed:screen-activation"), source_event_time_token: "constructed:screen-event-time", source_locators: [...source("probe.screen_activation").source_locators as string[], rawLimits] },
    { ...owner("probe.foreground_app", "constructed:foreground-app"), observed_entity_kind: "application", observed_entity_token: "Facebook",
      source_event_time_token: "constructed:foreground-event-time", source_locators: [...source("probe.foreground_app").source_locators as string[], rawLimits] },
    ...["received", "sent"].map(direction => ({ ...owner("probe.sms", `constructed:sms-${direction}`), source_event_time_token: `constructed:sms-${direction}-time`,
      quantities: [{ observed_property: "SMS direction", evidence_value_json: JSON.stringify(direction) }], source_locators: [...source("probe.sms").source_locators as string[], rawLimits] })),
  );
  const daySource = source("aggregation.temporal_rhythms");
  const dayOwner = {
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "constructed:app-membership-participant",
    referenced_day_token: "constructed:supplied-day", day_record_origin: "analyst_constructed_example" as const, day_observation_kind: "objective_aggregate" as const,
    source_locators: [...daySource.source_locators as string[], "Constructed independent daily values; day token is opaque, not an instant; no inventory/event membership, aggregation or denominator inferred"],
  };
  const participant_day_observations: ParticipantDayObservationRecord[] = [
    { ...dayOwner, day_observation_id: "constructed:daily-screen-count", observed_property: "screen activations per day", day_observation_value_json: "12.00" },
    { ...dayOwner, day_observation_id: "constructed:daily-phone-duration", observed_property: "smartphone duration per day", day_observation_value_json: "15.50", evidence_unit: "minutes" },
    { ...dayOwner, day_observation_id: "constructed:daily-app-frequency", observed_property: "application frequency per day", observation_category: "Facebook", day_observation_value_json: "2.00" },
    { ...dayOwner, day_observation_id: "constructed:daily-app-duration", observed_property: "application duration per day", observation_category: "Facebook", day_observation_value_json: "0.00", evidence_unit: "minutes" },
  ];
  const duration = source("reconstruction.use_duration");
  const app_feature_sessions: import("../../src/lib/methodProfiles").AppFeatureSessionRecord[] = [
    { feature_session_id: "constructed:foreground-application-interval", method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "constructed:app-membership-participant", device_id: full.device_id, session_record_origin: "analyst_constructed_example",
      app_name: "Facebook", app_package_name: null, denotes_interval: { duration_seconds: 17.50 }, feature_occurrences: [],
      source_locators: [...duration.source_locators as string[], "Constructed independent supplied app duration; exact constructor/start/stop/gap and package are unknown. Empty feature membership does not assert an absence of app use, and there is no inventory/day/session join."] },
    { feature_session_id: "constructed:partial-foreground-interval", method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
      participant_id: "constructed:app-membership-participant", device_id: full.device_id, session_record_origin: "analyst_constructed_example",
      app_name: "Facebook", denotes_interval: { start_instant: null, end_instant: null }, feature_occurrences: [],
      source_locators: [...duration.source_locators as string[], "Independent partial normalized interval; omitted duration and null endpoints remain unknown, not zero or constructed boundary"] },
  ];
  return { profiles: [profile], sampled_quantity_observations: rows, participant_day_observations, app_feature_sessions };
}

export function rankedRecentTaskObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  if (profile.source_work_id !== "doi:10.1145/2638728.2641700") throw new Error("No ranked recent-task source example for this profile");
  const setting = profile.method_settings.find(s => s.method_parameter_key === "collector.key_family");
  if (!setting) throw new Error("Missing collector.key_family definition");
  const locator = "Gouin-Vallerand2014 primary p3 Sample1/DataModel:100–128,139–149; PDF SHA256:5e53ab306fee55138b62ac9432e894b9b712963f6a6bc6f855c21990d90aa7f1; constructed normalized ranked list using the printed rank5/6 cell values, not recovered poll identity or original serialization. Source first-column tokens remain uninterpreted. Boot-elapsed logging times are member-local lexical tokens with no disclosed unit or wall-clock join. Same package/different activities remain distinct; no launch, cadence, filtering, reversal, Markov matrix or source-version dictionary join is inferred.";
  const owner = (id: string): SampledQuantityObservationRecord => ({
    sampled_observation_id: id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:recent-task-participant", device_id: "constructed:recent-task-device",
    record_origin: "analyst_constructed_example", method_setting_reference: setting.method_setting_id,
    observed_entity_kind: "device", source_locators: [...setting.source_locators as string[], locator],
  });
  const member = (id: string, rank: number, row: string, boot: string, activity: string): import("../../src/lib/methodProfiles").SampledEntityMemberRecord => ({
    entity_member_id: id, member_entity_kind: "application", observed_entity_token: "com.android.contacts",
    quantities: [
      { observed_property: "source row token", evidence_value_json: JSON.stringify(row) },
      { observed_property: "boot-elapsed logging time", evidence_value_json: JSON.stringify(boot) },
      { observed_property: "source key", evidence_value_json: JSON.stringify("app|recent|" + rank) },
      { observed_property: "source rank", evidence_value_json: String(rank) },
      { observed_property: "component string", evidence_value_json: JSON.stringify("com.android.contacts/" + activity) },
      { observed_property: "source value", evidence_value_json: '"1"' },
    ], source_locators: [locator],
  });
  const first = { ...owner("constructed:recent-snapshot-a"), entity_members: [
    member("constructed:recent-member-5", 5, "317", "89393313", ".activities.PeopleActivity"),
    member("constructed:recent-member-6", 6, "318", "89393314", ".activities.DialtactsActivity"),
  ] };
  const repeated = structuredClone(first); repeated.sampled_observation_id = "constructed:recent-snapshot-b";
  const partial: import("../../src/lib/methodProfiles").SampledEntityMemberRecord = {
    entity_member_id: "constructed:partial-recent-member", member_entity_kind: "application", observed_entity_token: null,
    quantities: [{ observed_property: "source rank", evidence_value_json: "null" },
      { observed_property: "boot-elapsed logging time", evidence_value_json: null },
      { observed_property: "component string" }, { observed_property: "source value", evidence_value_json: '""' }],
    source_locators: [locator],
  };
  return [first, repeated, { ...owner("constructed:recent-members-empty"), entity_members: [] },
    { ...owner("constructed:recent-members-null"), entity_members: null }, owner("constructed:recent-members-omitted"),
    { ...owner("constructed:recent-members-partial"), entity_members: [partial] }];
}

export function falakiObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  participant_day_observations: ParticipantDayObservationRecord[];
} {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing Falaki definition: " + key);
    return found;
  };
  const limits = "Falaki2010 PDF SHA256:8aa91f677842f1931db3f7602d8f74c4ebf817194b716ce1c5ebdc0ce5462021; text SHA256:de7670a73f9e271cfb133e44266ceee6c9ef3e7b4223940279ce2b27c234085c. Constructed normalized readings/summaries, not source rows. Executable identities are not inferred packages/PIDs/UIDs. No cadence/reset/delta, clock conversion, raw-to-session/app/category join, denominator/CI/weighting, quantization or estimator runs. Raw timer/traffic units and trend-table coordinate/statistic units are unreported. Named coordinates retain supplied order, not invented time bounds; 1h and 2h tables stay separate.";
  const q = (observed_property: string, value?: string | null, evidence_unit?: string, quantity_qualifier?: string) => ({
    observed_property, ...(value === undefined ? {} : { evidence_value_json: value }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const sample = (key: string, id: string, kind: SampledQuantityObservationRecord["observed_entity_kind"], quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[], token?: string): SampledQuantityObservationRecord => ({
    sampled_observation_id: "constructed:falaki-" + id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:falaki-participant", device_id: "constructed:falaki-phone",
    record_origin: "analyst_constructed_example", method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind: kind, ...(token === undefined ? {} : { observed_entity_token: token }), quantities,
    source_locators: [...setting(key).source_locators as string[], limits],
  });
  const sampled_quantity_observations: SampledQuantityObservationRecord[] = [
    ...["A", "B"].map((id, i) => ({ ...sample("acquisition.android_counter_snapshot", "timer-" + id, "application",
      [q("cumulative application usage timer", i ? '"7.000"' : "0")], "constructed:executable-A"), observation_instant: "constructed:same-collection-token" })),
    sample("acquisition.android_screen_state", "screen-on", "device", [q("screen state", '"screen on"')]),
    sample("acquisition.android_screen_state", "screen-off", "device", [q("screen state", '"screen off"')]),
    ...["start of incoming voice call", "end of incoming voice call", "start of outgoing voice call", "end of outgoing voice call"].map((label, i) => ({
      ...sample("acquisition.android_voice_call_bounds", "call-" + i, "device", [q("voice call boundary", JSON.stringify(label))]),
      source_event_time_token: "constructed:call-event-token", observation_instant: "constructed:independent-collection-token",
    })),
    sample("acquisition.android_traffic_channel", "traffic-A", "application", [q("traffic sent", "0"), q("traffic received", '"5.000"')], "constructed:executable-A"),
    sample("acquisition.android_traffic_channel", "traffic-B", "application", [q("traffic sent", "7"), q("traffic received", "0")], "constructed:executable-B"),
    sample("feature.battery_indicator_drain", "battery", "device", [q("remaining battery indicator", "50.00", "percent"),
      q("battery capacity", "1200", "mAh"), q("estimated charge drain", "12.00", "mAh"), q("estimated energy drain", "48.00", "mWh")]),
    sample("aggregation.daily_interaction_statistics", "daily-statistics", "participant", [
      q("mean daily interaction time", "20.50", "minutes"), q("standard deviation of daily interaction time", "3.25", "minutes"),
      q("mean daily session count", "12.50", "sessions"), q("standard deviation of daily session count", "2.25", "sessions"),
      q("mean session length", "17.50", "seconds"), q("standard deviation of session length", "4.25", "seconds")]),
    sample("aggregation.hourly_interaction_metrics", "hour-of-day-statistics", "participant", [
      ...["hourly interaction time", "hourly session count", "session length"].flatMap((property, i) =>
        ["mean ", "95% CI lower ", "95% CI upper "].map((statistic, j) => q(statistic + property, ["7.50", "5.00", "10.00"][j],
          ["minutes", "sessions", "seconds"][i], "07")))]),
    sample("feature.voice_usage_ratio", "voice-ratio", "participant", [q("voice usage ratio", "0.25")]),
    sample("feature.diurnal_ratio", "interaction-diurnal-ratio", "participant", [q("diurnal ratio", "2.50", undefined, "interaction time")]),
    sample("validation.first_second_half_usage", "trace-halves", "participant", [q("average daily interaction time", "20.50", "minutes", "first half of trace"),
      q("average daily interaction time", "22.50", "minutes", "second half of trace")]),
    sample("feature.trace_application_count", "trace-app-count", "participant", [q("applications used over full trace", "12", "applications")]),
    sample("feature.relative_application_popularity", "app-popularity", "application", [q("relative application popularity", "0.25")], "constructed:executable-A"),
    sample("feature.application_category_vocabulary", "app-category", "application", [q("application category", '"communication"')], "constructed:executable-A"),
    sample("feature.hourly_application_popularity", "windows-hourly-app-popularity", "application", [q("relative application popularity by hour", "0.20", undefined, "07")], "tmail.exe"),
    sample("aggregation.application_category_popularity", "pooled-category", "application_category", [q("mean relative category popularity", "25.00", "percent", "Dataset1 Android; high traffic"),
      q("95% CI lower relative category popularity", "20.00", "percent", "Dataset1 Android; high traffic"),
      q("95% CI upper relative category popularity", "30.00", "percent", "Dataset1 Android; high traffic")], "communication"),
    sample("aggregation.traffic_statistics", "traffic-statistics", "participant", [
      q("mean daily traffic sent", "3.25", "MB"), q("standard deviation of daily traffic sent", "1.25", "MB"),
      q("mean daily traffic received", "10.25", "MB"), q("standard deviation of daily traffic received", "2.25", "MB"),
      ...["sent", "received"].flatMap(direction => ["mean ", "95% CI lower ", "95% CI upper "].map((statistic, i) =>
        q(statistic + "hourly traffic " + direction, ["2.50", "1.00", "4.00"][i], "MB", "07"))),
      q("sent traffic diurnal ratio", "2.50"), q("received traffic diurnal ratio", "3.50")]),
    sample("feature.traffic_interactive_screen_rule", "screen-on-traffic", "participant", [q("traffic while screen on", '"5.000"')]),
    sample("feature.received_traffic_prescreen_window", "prescreen-traffic", "participant", [q("received traffic within one minute before screen on", "7")]),
    sample("feature.interactive_traffic_fraction", "interactive-fraction", "participant", [q("interactive traffic fraction", "0.75")]),
    sample("aggregation.energy_drain_statistics", "energy-statistics", "participant", [
      q("mean one-hour charge drain", "20.00", "mAh", "Figure24 noncharging periods"),
      q("standard deviation of one-hour charge drain", "5.00", "mAh", "Figure24 noncharging periods"),
      ...["mean ", "95% CI lower ", "95% CI upper "].map((s, i) => q(s + "hourly charge drain", ["20.00", "15.00", "25.00"][i], "mAh", "07")),
      q("energy drain diurnal ratio", "3.50")]),
    sample("feature.energy_drain_variability_by_window", "variability", "participant", ["10-minute windows", "60-minute windows", "120-minute windows"]
      .map((scope, i) => q("standard deviation divided by mean energy drain", ["3.50", "1.50", "1.00"][i], undefined, scope))),
    sample("feature.inferred_screen_timeout", "timeout", "participant", [q("approximate screen timeout", "60.00", "seconds")]),
    sample("feature.trend_table_chunk_width", "chunks", "participant", ["x1", "x2", "x3"].map((coordinate, i) =>
      q("chunk energy usage reading", ["1.00", "2.00", "3.00"][i], undefined, coordinate))),
    ...["1-hour horizon", "2-hour horizon"].map((horizon, i) => sample("feature.trend_table_quantization_and_statistics", "trend-table-" + i, "participant", [
      q("preceding quantized x1", "1"), q("preceding quantized x2", "2"), q("preceding quantized x3", "3"),
      q("following-window mean", i ? "20.00" : "10.00", undefined, horizon),
      q("following-window standard deviation", i ? "4.00" : "2.00", undefined, horizon)])),
    sample("reporting.fitted_parameter_distributions", "model-parameters", "participant", ["session-mixture r", "session-mixture lambda", "session-mixture xm",
      "session-mixture alpha", "Weibull scale", "Weibull shape", "application-popularity exponential rate"].map((property, i) => q(property, ["0.40", "0.50", "60.00", "1.50", "6.00", "0.50", "0.20"][i]))),
    ...["analysis.trend_neighbor_weighted_prediction", "analysis.generic_prediction_comparator", "analysis.short_term_prediction_comparator", "analysis.time_of_day_prediction_comparator"]
      .map((key, i) => sample(key, "prediction-" + i, "participant", [q("predicted energy drain", String(i + 1) + ".00", undefined, "1-hour horizon")])),
  ];
  // A pooled category is not a fake participant/device; the Windows illustration is not an Android app interval.
  const category = sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:falaki-pooled-category")!;
  if (category.observed_entity_kind !== "application_category") throw new Error("Expected supplied pooled category");
  delete category.participant_id; delete category.device_id;
  const windows = sampled_quantity_observations.find(row => row.sampled_observation_id === "constructed:falaki-windows-hourly-app-popularity")!;
  windows.participant_id = "constructed:windows-comparator-participant"; windows.device_id = "constructed:windows-comparator-phone";
  windows.source_locators.push("PDFp7 Figure12 explicitly illustrates Dataset2 Windows; no application-session bounds transferred to Android");
  const participant_day_observations: ParticipantDayObservationRecord[] = [
    ["day", "daily interaction time", "20.50", "minutes", "aggregation.daily_interaction_statistics"],
    ["day", "daily session count", "12", "sessions", "aggregation.daily_interaction_statistics"],
    ["hour", "interaction time", "3.50", "minutes", "aggregation.hourly_interaction_metrics"],
    ["day", "traffic sent", "3.50", "MB", "aggregation.traffic_statistics"],
    ["day", "traffic received", "5.50", "MB", "aggregation.traffic_statistics"],
    ["hour", "charge drain", "20.00", "mAh", "aggregation.energy_drain_statistics"],
  ].map(([period, observed_property, value, evidence_unit, key], i) => ({
    day_observation_id: "constructed:falaki-period-" + i, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:falaki-participant", device_id: "constructed:falaki-phone", day_record_origin: "analyst_constructed_example",
    ...(period === "day" ? { referenced_day_token: "constructed:day" } : { referenced_hour_token: "constructed:particular-hour" }),
    day_observation_kind: "objective_aggregate", observed_property: observed_property!, day_observation_value_json: value, evidence_unit,
    source_locators: [...setting(key!).source_locators as string[], limits],
  }));
  return { sampled_quantity_observations, participant_day_observations };
}

export function hammerObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile) {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error(`Missing Hammer definition: ${key}`);
    return found;
  };
  const limits = "352-primary.pdf pp35–42; SHA256:c3c79245765b9288e48b95eeb089abae7fb6d00868b5c1a4a746b61b189f6e84; constructed normalized records, not participant data or recovered fields/binary codes. Figure7 isStressed versus prose isStressful is not silently normalized. Frame width comes solely from its exact local30s definition; no screen/task anchor, endpoints, stride, raw-to-frame join, CCDF, confidence decay, label selection, classifier, location heuristic, histogram measure, top-k selection, clock conversion or cohort result is computed.";
  const source = (key: string) => [...setting(key).source_locators as string[], limits];
  const owner = (key: string, id: string, kind: import("../../src/lib/methodProfiles").SampledQuantityObservationRecord["observed_entity_kind"]): import("../../src/lib/methodProfiles").SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:hammer-participant", device_id: "constructed:hammer-device",
    record_origin: "analyst_constructed_example", method_setting_reference: setting(key).method_setting_id,
    sampled_observation_id: id, observed_entity_kind: kind, source_locators: source(key),
  });
  const q = (observed_property: string, evidence_value_json?: string | null, quantity_qualifier?: string) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const sampled_quantity_observations = [
    ...["constructed:app-A", "constructed:app-B"].map((app, i) => ({ ...owner("collector.foreground_app", `constructed:hammer-poll-${i}`, "application"),
      observed_entity_token: app, observation_instant: "constructed:opaque-collection-time", quantities: [] })),
    ...["screen ON", "screen OFF"].map((event, i) => ({ ...owner("collector.screen_state_events", `constructed:hammer-screen-${i}`, "device"),
      source_event_time_token: `constructed:screen-event-${i}`, quantities: [q("screen event", JSON.stringify(event))] })),
    { ...owner("collector.network_events", "constructed:hammer-network", "device"), quantities: [
      q("BSSID", '"constructed:connected-bssid"'), q("cellular tower ID", '"constructed:cell-token"'), q("network-status change", "null"),
    ] },
    ...[true, false].map((value, i) => ({ ...owner("collector.labels", `constructed:hammer-entered-label-${i}`, "participant"),
      source_event_time_token: `constructed:user-entry-${i}`, quantities: [q("isBusy", JSON.stringify(value)), q("isAlone", null), q("isHappy"), q("isStressful", "null")] })),
  ] as import("../../src/lib/methodProfiles").SampledQuantityObservationRecord[];
  const frame = owner("segmentation.frame_width", "constructed:hammer-frame-a", "participant");
  frame.quantities = ["isBusy", "isAlone", "isHappy", "isStressful"].flatMap((status, i) => [
    q("forward-filled human label", JSON.stringify(i % 2 === 0), status), q("human confidence", " 0.9000 ", status),
    q("secondary classifier label", JSON.stringify(i > 0), status), q("secondary classifier confidence", "0.800", status), q("predicted logical status", JSON.stringify(i % 2 === 1), status),
  ]);
  frame.quantities.push(q("unique application count", "2"), q("categorical mode", '"home"', "logical location"),
    q("minimum", "1.00", "constructed:numeric feature"), q("maximum", "3.00", "constructed:numeric feature"), q("average", "2.00", "constructed:numeric feature"),
    q("top-k dominant app categories", '["constructed:category-A","constructed:category-B"]'), q("time of day", '"constructed:time-of-day"'),
    q("day of week", '"constructed:weekday"'), q("logical location", '"null"'));
  frame.entity_members = ["constructed:app-A", "constructed:app-B"].map((token, i) => ({
    entity_member_id: `constructed:histogram-bin-${i}`, member_entity_kind: "application", observed_entity_token: token,
    quantities: [q("histogram bin value", i ? "0.00" : "2.50"), q("application category", '"constructed:category-A"')],
    source_locators: source("feature.app_category"),
  }));
  sampled_quantity_observations.push(frame, { ...structuredClone(frame), sampled_observation_id: "constructed:hammer-frame-b" });
  const partial = owner("segmentation.frame_width", "constructed:hammer-frame-partial", "participant");
  partial.quantities = [q("forward-filled human label", null, "isBusy"), q("human confidence", "null", "isBusy"),
    q("secondary classifier label", undefined, "isBusy"), q("secondary classifier confidence", '"0.80"', "isBusy"),
    q("logical location", "null")];
  partial.entity_members = null;
  sampled_quantity_observations.push(partial);
  const notification_histories: import("../../src/lib/methodProfiles").NotificationHistoryRecord[] = ["clicked", "dismissed"].map((kind, i) => ({
    notification_history_id: `constructed:hammer-notification-${i}`, notification_item_id: `constructed:hammer-item-${i}`,
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "constructed:hammer-participant", device_id: "constructed:hammer-device",
    history_record_origin: "analyst_constructed_example", source_locators: [...source("collector.notification_events"), "352.txt:146–175; supplied item identity/supports, not inferred matching, swipe action, positive attention or a posted callback"],
    notification_evidence: [
      { evidence_record_id: "arrival", evidence_kind: "arrival", evidence_role: "recorded", evidence_instant: null, source_locators: source("collector.notification_events") },
      { evidence_record_id: "departure", evidence_kind: "removal", evidence_role: "recorded", source_locators: source("collector.notification_events") },
      { evidence_record_id: "owner", evidence_kind: "quantity", evidence_role: "inferred", observed_property: "owner application", evidence_value_json: '"constructed:owner-app"', source_locators: source("feature.notification_owner") },
      ...[["response time", "feature.notification_response_time"], ["inter-arrival time", "feature.notification_interarrival"], ["inter-departure time", "feature.notification_interdeparture"]].map(([property, key]) => ({
        evidence_record_id: property!, evidence_kind: "quantity" as const, evidence_role: "inferred" as const, observed_property: property!,
        evidence_value_json: i ? "0.00" : "2.500", source_locators: [...source(key!), "Independently supplied quantity; original time unit and pairing remain undisclosed"],
      })),
      { evidence_record_id: "response", evidence_kind: kind as "clicked" | "dismissed", evidence_role: "inferred", evidence_references: ["departure", "owner"], source_locators: source("feature.notification_response") },
    ],
  }));
  return { profiles: [profile], sampled_quantity_observations, notification_histories };
}

export function predictorObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const definition = (key: string) => {
    const matches = profile.method_settings.filter(s => s.method_parameter_key === key);
    if (matches.length !== 1) throw new Error("Missing or ambiguous Predictor definition: " + key);
    return matches[0]!;
  };
  const limits = "Constructed supplied records, not original Predictor/MDC/Wandoujia rows. Grounded in retained primary-review manifest, not a fresh reading of currently unavailable primary PDF bytes. No original serializer, sensor axes/units, event tie rule, latest/nearest selection, window alignment, fitted embeddings/clusters, threshold, ranking, DBSCAN/Apriori, weighting, fusion or calculation is recovered.";
  const q = (observed_property: string, evidence_value_json?: string | null) => ({ observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }) });
  const row = (key: string, id: string, entity: SampledQuantityObservationRecord["observed_entity_kind"], quantities: ReturnType<typeof q>[] = []): SampledQuantityObservationRecord => ({
    sampled_observation_id: "constructed:predictor-" + id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:predictor-user", device_id: "constructed:predictor-phone", record_origin: "analyst_constructed_example",
    method_setting_reference: definition(key).method_setting_id, observed_entity_kind: entity, quantities,
    source_locators: [...definition(key).source_locators as string[], limits],
  });
  const link = (relationship_label: string, id?: string | null) => ({ relationship_label,
    ...(id === undefined ? {} : { sampled_observation_reference: id === null ? null : "constructed:predictor-" + id }),
    source_locators: ["Retained author-rendering locator manifest sections session-features, incremental-model, cev, cold-user-similarity, cold-app-periodicity or cold-fusion; explicit constructed relationship only"] });
  const member = (id: string, app: string, quantities: ReturnType<typeof q>[] = []) => ({
    entity_member_id: id, member_entity_kind: "application" as const, observed_entity_token: app, quantities,
    source_locators: ["Constructed ordered application member, not an original installation/launch/rank identifier"],
  });
  const families = ["opened app", "audio cable", "location", "charge cable", "Wi-Fi", "mobile data", "Bluetooth", "light"];
  const raw = [
    { ...row("event.type.AppOpenEvent", "open-A", "device", [q("app identifier", '"com.android.dialer"')]), source_event_time_token: "supplied-open-time-A", observation_instant: "independent-collection-time" },
    { ...row("event.type.AppOpenEvent", "open-B", "device", [q("app identifier", '"android.mms"')]), source_event_time_token: "supplied-open-time-B" },
    { ...row("event.type.AppOpenEvent", "prior-app", "device", [q("app identifier", '"com.android.alarmclock"')]), source_event_time_token: "same-opaque-time" },
    { ...row("event.type.AppOpenEvent", "prior-repeat", "device", [q("app identifier", '"com.android.alarmclock"')]), source_event_time_token: "same-opaque-time" },
    row("event.type.ChargeCableEvent", "charge", "device", [q("charge state", '"supplied unreported code"')]),
    row("event.type.DataConnectedEvent", "data", "device", [q("data state", "false")]),
    row("event.type.LocationChangedEvent", "location", "device", [q("latitude", '"37.25"'), q("longitude", '"-122.50"')]),
    ...["audio cable", "Wi-Fi", "Bluetooth", "light"].map((family, i) => row("session.session_feature_definition", "context-" + i, "device",
      [q("context family", JSON.stringify(family)), q("context value", [undefined, null, "null", "0.00"][i])])),
  ];
  const supports = ["prior-app", "context-0", "location", "charge", "context-1", "data", "context-2", "context-3"];
  const features = ["A", "B"].map((name, i) => ({
    ...row("session.target_event", "features-" + name, "device", [q("opened app", JSON.stringify(i ? "android.mms" : "com.android.dialer")),
      ...families.map((family, j) => ({ ...q("Latest prior " + family, ['"com.android.alarmclock"', null, '"supplied coordinate observation"', undefined, "null", "0", '"unreported state"', "0.00"][j]),
        quantity_qualifier: "four-hour sliding window; alignment and boundary inclusion unreported" }))]),
    sampled_observation_references: [link("AppOpen anchor", "open-" + name), ...families.map((family, j) => link("Latest prior " + family, i && j === 0 ? "prior-repeat" : supports[j]))],
  }));
  const inventory = { ...row("collector.installed_app_list", "inventory-new", "participant"), entity_members: [
    member("app-A", "com.android.dialer"), member("app-B", "android.mms"),
  ] };
  const cloud = { ...inventory, sampled_observation_id: "constructed:predictor-inventory-cloud",
    participant_id: "constructed:cloud-user", device_id: "constructed:cloud-phone",
    entity_members: [member("cloud-app", "com.android.dialer")] };
  const consumption = { ...row("collector.app_power_consumption", "consumption", "application", [q("power consumption", "3.50")]),
    observed_entity_token: "com.android.dialer", observation_instant: "supplied-power-reading-time" };
  const network = { ...row("collector.app_network_consumption", "network", "application", [q("network consumption", '"250.00"')]),
    observation_instant: "independent-network-reading-time",
    observed_entity_token: "com.android.dialer" };
  const weight = { ...row("cold.app_weight", "weight", "application", [q("app use count", "7"), q("maximum app use count", "20"),
    q("market download count", "1000"), q("maximum market download count", "50000"), q("normalized use popularity", "0.25"),
    q("inverse market popularity", "1.50"), q("app weight", "0.80")]), observed_entity_token: "com.android.dialer" };
  const clusters = ["warm.basic_cluster_state", "warm.incremental_cluster_state", "cev.icknn_cluster_state"].map((key, i) => ({
    ...row(key, "cluster-" + i, "participant", [
      q("cluster name", JSON.stringify("supplied-cluster-" + i)), q("cluster radius", "0.75"), q("instance count", "12"),
      ...(i > 0 ? [q("hierarchy layer", String(i))] : []),
      ...(i === 1 ? [q("ECI weight", "0.40"), q("split statistic", "0.30")] : []),
      ...(i === 2 ? [q("cluster credibility", "0.90"), q("ECI", "1"), q("CEV", "0"),
        ...families.flatMap(f => [q(f + " frequency", "0.20"), q(f + " stability", "0.40")])] : []),
    ]), sampled_observation_references: [link("central representative", "features-A"), link("covered instance", "features-A"), link("covered instance", "features-B")],
  }));
  const context = row("collector.periodicity_trigger", "launch-context", "device", [q("time", '"supplied launch clock"'), q("location", '"supplied location node"'),
    q("accelerometer", "0.25"), q("compass", null), q("gyroscope"), q("ambient light", "0")]);
  context.source_event_time_token = "independent-Predictor-launch-time";
  const periodicity = { ...row("cold.apriori", "periodicity", "device", [q("day type", '"holiday"'), q("hour/time interval", '"supplied-hour-interval"'),
    q("location node", '"supplied-place-node"'), q("movement-status node", '"unreported movement code"'), q("behavior/app pattern", '"supplied-pattern-A"'),
    q("maximum periodicity probability", "0.65")]), entity_members: [member("sequence-1", "com.android.dialer"), member("sequence-2", "android.mms"), member("sequence-3", "com.android.dialer")],
    sampled_observation_references: [link("Predictor-launch context", "launch-context")] };
  const ranked = (key: string, id: string, probability: string) => ({ ...row(key, id, "participant"), entity_members: [
    member(id + "-1", "com.android.dialer", [q("rank", "1"), q("app probability", probability)]),
    member(id + "-2", "android.mms", [q("rank", "2"), q("app probability", null)]),
  ] });
  const components = ["fusion.user_set", "fusion.item_set", "fusion.intersection_set"].map((key, i) => ({
    ...row(key, ["US", "IS", "UIS"][i]!, "application", [q("app probability", ["0.80", "0.65", "0.55"][i]),
      ...(i === 2 ? [q("depends on US", "1"), q("depends on IS", "1")] : [])]), observed_entity_token: "com.android.dialer",
    ...(i === 2 ? { sampled_observation_references: [link("US component", "US"), link("IS component", "IS")] } : {}),
  }));
  return [...raw, ...features, inventory, cloud,
    { ...inventory, sampled_observation_id: "constructed:predictor-inventory-empty", entity_members: [] },
    { ...inventory, sampled_observation_id: "constructed:predictor-inventory-unknown", entity_members: null },
    consumption, network, weight, context,
    { ...context, sampled_observation_id: "constructed:predictor-launch-context-2", quantities: null, source_event_time_token: null },
    { ...row("cold.weighted_user_similarity", "comparison", "participant", [q("cosine similarity", "0.30"), q("weighted user similarity", "0.90")]),
      sampled_observation_references: [link("new user inventory", "inventory-new"), link("cloud user inventory", "inventory-cloud"), link("app weight", "weight")] },
    { ...row("similarity.training_instances", "distance", "participant", [
      ...families.flatMap(f => [q(f + " similarity", "0.25"), q(f + " distance", "0.50")]), q("Euclidean distance", "1.25")]),
      sampled_observation_references: [link("first AppOpen feature", "features-A"), link("second AppOpen feature", "features-B")] },
    ...clusters,
    { ...row("warm.covered_set", "covered", "participant"), sampled_observation_references: [link("instance", "features-A")] },
    { ...row("warm.uncovered_set", "uncovered", "participant"), sampled_observation_references: [link("instance", "features-B")] },
    ...["one covering cluster", "multiple covering clusters", "no covering cluster"].map((label, i) => ({
      ...row("cev.predict_single_cover", "warm-prediction-" + i, "device", [q("coverage case", JSON.stringify(label)), q("predicted app", '"com.android.dialer"')]),
      sampled_observation_references: [link("classified AppOpen feature", "features-A"), link("selected cluster", i === 1 ? "cluster-2" : "cluster-0"),
        ...(i === 0 ? [link("covering cluster", "cluster-0")] : i === 1 ? [link("covering cluster", "cluster-0"), link("covering cluster", "cluster-2")] : [])],
    })),
    periodicity,
    { ...ranked("cold.user_top_k", "rank-user", "0.80"), sampled_observation_references: [link("user-similarity result", "comparison")] },
    { ...ranked("cold.periodicity_output.probability", "rank-period", "0.65"), sampled_observation_references: [link("periodicity condition", "periodicity")] },
    ...components,
    { ...ranked("fusion.ranked_output", "rank-fused", "0.70"), sampled_observation_references: [link("US component", "US"), link("IS component", "IS"), link("UIS component", "UIS")] },
  ];
}

export function trafficObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  participant_day_observations: ParticipantDayObservationRecord[];
} {
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing Traffic source definition: " + key);
    return found;
  };
  const limits = "Traffic IMC2010 primary SHA256:46ed9e4eadf3bb3a27d09e0bd940c7c8a4f36d63aca91f502b8c4fd097a9ade4; constructed normalized identities/values/relationships, not original rows or serializer fields. No packet parsing, IP/port matching, idle splitting, cumulative-counter subtraction/reset, process/UID-to-app join, threshold selection, metric calculation or radio replay. Event and collection time tokens are independently supplied. Power calibration is HTC Touch Windows Mobile6.1; pooled replay is not an Android-specific result.";
  const source = (key: string) => [...setting(key).source_locators as string[], limits];
  const owner = (key: string, id: string, kind: SampledQuantityObservationRecord["observed_entity_kind"] = "device"): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: key.startsWith("d2_transfer.") || ["composition.wifi_ratio", "composition.category_ontology"].includes(key) ? "constructed:traffic-D2-user" : "constructed:traffic-D1-user",
    device_id: key.startsWith("d2_transfer.") || ["composition.wifi_ratio", "composition.category_ontology"].includes(key) ? "constructed:traffic-D2-phone" : "constructed:traffic-D1-phone", record_origin: "analyst_constructed_example",
    method_setting_reference: setting(key).method_setting_id, sampled_observation_id: "constructed:traffic-" + id,
    observed_entity_kind: kind, source_locators: source(key),
  });
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string, quantity_qualifier?: string) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const link = (relationship_label: string, id?: string | null) => ({
    relationship_label, ...(id === undefined ? {} : { sampled_observation_reference: id === null ? null : "constructed:traffic-" + id }),
    source_locators: [limits, "Primary §§4–6; explicit supplied membership or measurement support, not inferred timing/IP/app equality"],
  });
  const flow = (id: string, destination: string): SampledQuantityObservationRecord => ({
    ...owner("d1_transfer.key", id), quantities: [
      q("IP source address", '"constructed:source-ip"'), q("IP destination address", '"constructed:destination-ip"'),
      q("source port", '"constructed:source-port"'), q("destination port", JSON.stringify(destination)),
    ],
  });
  const flowA = flow("flow-A", "constructed:port-A"), flowB = flow("flow-B", "constructed:port-B");
  flowA.sampled_observation_references = ["packet-1", "packet-2", "packet-3"].map(id => link("packet member", id));
  const packets: SampledQuantityObservationRecord[] = ["sent", "received", "sent"].map((direction, i) => ({
    ...owner("d1.raw_schema", "packet-" + (i + 1)), source_event_time_token: "supplied:packet-time-" + (i + 1),
    observation_instant: "supplied:independent-capture-token",
    quantities: [q("capture platform", '"Android"'), q("capture collector", '"tcpdump"'), q("packet direction", JSON.stringify(direction)),
      q("packet byte count", i ? "0" : " 64 ", "bytes"), q("link-layer headers", '"supplied:opaque-link-header"'),
      q("IP/TCP headers", '"supplied:opaque-IP-TCP-header"'), q("IP source address", '"constructed:source-ip"'),
      q("IP destination address", '"constructed:destination-ip"'), q("source port", '"constructed:source-port"'),
      q("destination port", '"constructed:port-A"'), q("TCP sequence number", JSON.stringify("supplied:sequence-" + i)),
      q("TCP flags", JSON.stringify(i === 0 ? "SYN" : i === 1 ? "SYN-ACK" : "supplied:flags"))],
    sampled_observation_references: [link("TCP flow", "flow-A")],
  }));
  const windows = { ...owner("d1.raw_schema", "windows-packet"), device_id: "constructed:windows-phone",
    quantities: [q("capture platform", '"Windows Mobile"'), q("capture collector", '"Netlog"'), q("packet direction", '"received"'), q("packet byte count", null, "bytes")] };
  const transfer = (id: string, members: string[], sent: string, received: string): SampledQuantityObservationRecord => ({
    ...owner("d1_transfer.idle_split", id), quantities: [q("transfer bytes sent", sent, "bytes"), q("transfer bytes received", received, "bytes"),
      q("transfer packets sent", "2", "packets"), q("transfer packets received", "1", "packets")],
    sampled_observation_references: [link("TCP flow", "flow-A"), ...members.map(id => link("packet member", id))],
  });
  const transferA = transfer("transfer-A", ["packet-1", "packet-2"], "999", "0");
  const transferB = transfer("transfer-B", ["packet-3"], "0", "5");
  // These memberships and totals are supplied independently; even disagreement
  // with packet counts/bytes does not authorize reconstructing the source run.
  const measured = (key: string, id: string, quantities: ReturnType<typeof q>[], links = [link("measured packet transfer", "transfer-A")]): SampledQuantityObservationRecord => ({
    ...owner(key, id), quantities, sampled_observation_references: links,
  });
  const app = (key: string, id: string, token: string, quantities: ReturnType<typeof q>[]): SampledQuantityObservationRecord => ({
    ...owner(key, id, "application"), observed_entity_token: token, quantities,
  });
  const intervalA = app("d2_transfer.inputs", "interval-A", "constructed:app-A", [q("bytes sent", "0", "bytes"), q("bytes received", "5", "bytes")]);
  intervalA.observation_instant = "supplied:interval-A"; intervalA.sampled_observation_references = [link("application transfer", "app-transfer-A")];
  const intervalB = app("d2_transfer.inputs", "interval-B", "constructed:app-A", [q("bytes sent", "7", "bytes"), q("bytes received", "0", "bytes")]);
  intervalB.observation_instant = "supplied:interval-B";
  const otherApp = app("d2_transfer.inputs", "interval-other-app", "constructed:app-B", [q("bytes sent", "1", "bytes"), q("bytes received", "0", "bytes")]);
  const appTransfer = app("d2_transfer.contiguous", "app-transfer-A", "constructed:app-A", [q("transfer bytes sent", "99", "bytes"), q("transfer bytes received", "0", "bytes")]);
  appTransfer.sampled_observation_references = [link("application interval member", "interval-A"), link("application interval member", "interval-B")];
  const appSize = app("d2_transfer.across_connections", "app-size", "constructed:app-A", [q("transfer size", "0.00", "KB", "uplink")]);
  appSize.sampled_observation_references = [link("measured application transfer", "app-transfer-A")];
  const sampled_quantity_observations: SampledQuantityObservationRecord[] = [
    ...packets, windows, flowA, flowB, transferA, transferB, intervalA, intervalB, otherApp, appTransfer, appSize,
    measured("d1_transfer.byte_scope", "size", [q("transfer size", "0.00", "KB", "uplink"), q("transfer packet count", "2", "packets", "downlink")]),
    measured("d1_transfer.overhead_scope", "byte-overhead", [q("TCP+ byte overhead", "17.500", "percent"), q("SSL+ byte overhead", "0", "percent")]),
    measured("d1_transfer.overhead_time", "time-overhead", [q("TCP+ time overhead", "0.00", "percent"), q("SSL+ time overhead", null, "percent")],
      [link("measured packet transfer", "transfer-A"), link("first SYN", "packet-1"), link("first non-TCP payload", "packet-3"), link("first non-TCP/non-SSL payload")]),
    measured("performance.rtt", "rtt", [q("transfer RTT", " 25.5000 ", "ms", "Trailing")],
      [link("measured packet transfer", "transfer-A"), link("last SYN", "packet-1"), link("SYN-ACK", "packet-2"), link("previous send/receive", "packet-3")]),
    measured("performance.retransmission", "retransmission", [q("retransmission rate", "0", "percent", "uplink"), q("data packet count", "11", "packets", "uplink")],
      [link("measured packet transfer", "transfer-A"), link("retransmitted packet", "packet-3")]),
    measured("performance.throughput", "throughput", [q("transfer throughput", "5.00", "kbps", "downlink"), q("data packet count", "10", "packets", "downlink")]),
    measured("performance.limit_method", "limit", [q("throughput limit", '"Unknown"', undefined, "uplink"), q("data packet count", "101", "packets", "uplink")]),
    { ...owner("composition.wifi_ratio", "wifi", "participant"), quantities: [q("WiFi byte share", "0.00")] },
    { ...owner("composition.direction_ratio", "direction-ratio", "participant"), quantities: [q("downlink/uplink byte ratio", '"0.0000"')] },
    app("composition.category_ontology", "category", "constructed:app-A", [q("application category", '"Browsing"')]),
    { ...owner("power.interpacket", "delay"), quantities: [q("inter-packet delay", "17.500", "seconds")],
      sampled_observation_references: [link("previous packet", "packet-1"), link("following packet", "packet-2")] },
    ...["current 17-second tail", "fixed 4.5-second tail", "perfect-future oracle sleep decision"].map((branch, i) => ({
      ...owner("power.replay", "replay-" + i), quantities: [q("radio energy", i ? "0.00" : '"supplied:unknown-unit-energy"', undefined, branch),
        q("energy savings", "0", "percent", branch), q("radio wakeups", "0", undefined, branch), q("packets triggering radio wakeup", "0.00", "percent", branch)],
      sampled_observation_references: ["packet-1", "packet-2", "packet-3"].map(id => link("replayed packet", id)),
    })),
    { ...owner("d1_transfer.idle_split", "partial-transfer"), quantities: null, sampled_observation_references: null },
    { ...owner("d2_transfer.contiguous", "empty-transfer", "application"), observed_entity_token: null, quantities: [], sampled_observation_references: [] },
  ];
  const participant_day_observations: ParticipantDayObservationRecord[] = ["D1", "D2"].map((dataset, i) => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "constructed:traffic-" + dataset + "-user",
    device_id: "constructed:traffic-" + dataset + "-phone", day_observation_id: "constructed:traffic-day-" + dataset,
    referenced_day_token: "supplied:" + dataset + "-day", day_record_origin: "analyst_constructed_example",
    day_observation_kind: "objective_aggregate", observed_property: dataset + " daily network bytes", day_observation_value_json: i ? "0.00" : '"5.000"',
    evidence_unit: "MB",
    source_locators: [...source("composition.daily_volume"), "Dataset-specific supplied day identity; no timezone, calendar boundary or cross-dataset participant join recovered"],
  }));
  return { sampled_quantity_observations, participant_day_observations };
}

export function s3ObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const setting = (key: string) => {
    const local = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!local) throw new Error("Missing S3 source definition: " + key);
    return local;
  };
  const limits = "Constructed normalized S3 vectors/metadata/protocols/scores and explicitly supplied links, not recovered original rows or computed authentication. Vector observation_instant denotes supplied generation/sample time, NOT framework receipt time; no <60-second eligibility, timestamp alignment, stride, interval, concatenation, latest selection, encoding, scaling, model training or score calculation inferred. No coordinate dictionary/order/units, source app-ID mapping or classifier oracle recovered. README appended day/hour is distinct from experiment weekday/seconds-in-day. Data files are inactivity-delimited groups, NOT screen/unlock sessions; st does not force both sensor and statistics membership.";
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string | null) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }),
  });
  const owner = (key: string, suffix: string, entity: "device" | "participant" = "device"): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:s3-user-A", device_id: "constructed:s3-phone-A", record_origin: "analyst_constructed_example",
    sampled_observation_id: "constructed:s3-" + suffix, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind: entity, source_locators: [...setting(key).source_locators as string[], limits],
  });
  const link = (relationship_label: string, suffix?: string | null) => ({
    relationship_label, ...(suffix === undefined ? {} : { sampled_observation_reference: suffix === null ? null : "constructed:s3-" + suffix }),
    source_locators: ["S3 primary §§3.2.3–4.3.1 and released README §§Data/Info/Protocols Files; independently supplied normalized membership, not an inferred join"],
  });
  const coordinates = (length: number) => JSON.stringify(Array.from({ length }, (_, i) => i % 3 === 0 ? "1.0000" : i % 3 === 1 ? null : -0.25));
  const sensor: SampledQuantityObservationRecord = { ...owner("sensor.feature_count", "sensor-A"),
    observation_instant: "supplied-generation-token-A", quantities: [q("sensor vector", coordinates(40)), q("released day", '"unreported source day code"'), q("released hour", null)] };
  const statisticsProperties = ["number of different foreground applications in last minute","total foreground application count in last minute","number of different foreground applications in last day","total foreground application count in last day","most common application ID in last minute","usage count for most common application in last minute","most common application ID in last day","usage count for most common application in last day","ID of currently active application","ID of last active application before current application","ID of application most frequently used immediately before current application","bytes transmitted through network interfaces","bytes received through network interfaces"];
  const statisticsValues = ["2.00", "5.00", "7.00", "11.00", '"constructed:app-A"', "3.00", '"constructed:app-B"', "9.00", '"constructed:app-A"', '"constructed:app-C"', '"constructed:app-B"', "1024.00", "0.00"];
  const statistics: SampledQuantityObservationRecord = { ...owner("statistics.feature_count", "statistics-A"),
    observation_instant: "supplied-generation-token-B", quantities: [
      q("statistics vector", coordinates(13)),
      ...statisticsProperties.map((property, i) => q(property, statisticsValues[i], property.startsWith("bytes ") ? "bytes" : undefined)),
      q("released day", '"unreported source day code"'), q("released hour", "null"),
    ] };
  const speaker: SampledQuantityObservationRecord = { ...owner("speaker.embedding_size", "speaker-A"),
    observation_instant: "supplied-generation-token-C", quantities: [q("speaker embedding", coordinates(512)), q("recording type", '"vn"'), q("microphone activation context", '"voice note"')] };
  const call: SampledQuantityObservationRecord = { ...speaker, sampled_observation_id: "constructed:s3-speaker-call",
    quantities: [q("speaker embedding", coordinates(512)), q("recording type", '"cr"'), q("microphone activation context", '"phone call"')] };
  const command: SampledQuantityObservationRecord = { ...owner("speaker.embedding_size", "speaker-command"), observation_instant: "supplied-command-generation-token",
    quantities: [q("speaker embedding", coordinates(512)), q("microphone activation context", '"voice command"')] };
  const other = { ...statistics, sampled_observation_id: "constructed:s3-statistics-B", participant_id: "constructed:s3-user-B", device_id: "constructed:s3-phone-B" };
  const missingSensor = { ...statistics, sampled_observation_id: "constructed:s3-statistics-C", participant_id: "constructed:s3-user-C", device_id: "constructed:s3-phone-C" };
  const statsKeys = ["statistics.distinct_apps_minute","statistics.total_apps_minute","statistics.distinct_apps_day","statistics.total_apps_day","statistics.common_app_minute","statistics.common_app_minute_count","statistics.common_app_day","statistics.common_app_day_count","statistics.current_app","statistics.last_app","statistics.preceding_app","statistics.network_bytes_transmitted","statistics.network_bytes_received"];
  const individualStatistics = statsKeys.map((key, i) => ({ ...owner(key, "statistic-" + i),
    quantities: [q(statisticsProperties[i]!, statisticsValues[i], key.includes("network_bytes") ? "bytes" : undefined)] }));
  const file = (suffix: string, user: string, phone: string, type: string, members: string[]): SampledQuantityObservationRecord => ({
    ...owner("dataset.info_schema", suffix, "participant"), participant_id: user, device_id: phone,
    quantities: [q("file", JSON.stringify(suffix + ".csv")), q("user", JSON.stringify(user)), q("tmsIni", '"supplied-first-generation-token"', "milliseconds"),
      q("tmsEnd", null, "milliseconds"), q("duration", "17.50", "seconds"), q("type", JSON.stringify(type))],
    sampled_observation_references: members.map(id => link("file vector", id)),
  });
  const fileA = file("file-A", sensor.participant_id!, sensor.device_id!, "st", ["statistics-A"]);
  const fileAll = file("file-all", sensor.participant_id!, sensor.device_id!, "st_vn_cr", ["sensor-A", "statistics-A", "speaker-A", "speaker-call"]);
  const fileB = file("file-B", other.participant_id, other.device_id, "st", ["statistics-B"]);
  const fileC = file("file-C", missingSensor.participant_id, missingSensor.device_id, "st", ["statistics-C"]);
  const train: SampledQuantityObservationRecord = { ...owner("dataset.train_protocol_schema", "training-A", "participant"), quantities: [
    q("nameModel", '"constructed:model-A"'), q("secondsTrain", "1209600.00", "seconds"), q("tmsIni", '"supplied-model-start-token"'), q("tmsEnd"),
    q("st_vn{x}_cr{y}", '"supplied modality-count token; serializer not decoded"'), q("files", '["file-A.csv","file-all.csv"]'),
  ], sampled_observation_references: [link("training file", "file-A"), link("training file", "file-all")] };
  const trial = (suffix: string, data: typeof fileA, fileName: string, label: string): SampledQuantityObservationRecord => ({
    ...owner("dataset.test_protocol_schema", suffix, "participant"), participant_id: data.participant_id!, device_id: data.device_id,
    quantities: [q("nameModel", '"constructed:model-A"'), q("file", JSON.stringify(fileName)), q("label", JSON.stringify(label))],
    sampled_observation_references: [link("test file", data.sampled_observation_id.replace("constructed:s3-", "")), link("model protocol", "training-A")],
  });
  const vectorLinks = [link("sensor vector", "sensor-A"), link("statistics vector", "statistics-A")];
  const aggregate = (key: string, suffix: string, property: string, length: number, links = vectorLinks): SampledQuantityObservationRecord => ({
    ...owner(key, suffix), quantities: [q(property, coordinates(length))], sampled_observation_references: structuredClone(links),
  });
  const scores = ["sensor", "statistics", "speaker"].map((modality, i) => ({
    ...owner("experiment.score_direction", "score-" + modality),
    quantities: [q("modality", JSON.stringify(modality)), q("authentication score", ["30.000", "80.00", "60.000"][i])],
    sampled_observation_references: [link("scored vector", modality + "-A")],
  }));
  const scoreLinks = scores.map((_, i) => link(["sensor score", "statistics score", "speaker score"][i]!, "score-" + ["sensor", "statistics", "speaker"][i]));
  const scoreState: SampledQuantityObservationRecord = { ...owner("score_combination.state", "score-state"), quantities: [
    q("scoresen", "30.000"), q("scoresta", "80.00"), q("scorespe", "60.000"),
    q("timesen", '"supplied-state-time-token-1"'), q("timesta", null), q("timespe"),
  ], sampled_observation_references: scoreLinks };
  const levels = ["score_combination.three", "score_combination.two", "score_combination.one"].map((key, i) => ({
    ...owner(key, "level-" + i), quantities: [q("authentication level", ["5.00", "0.00", "30.000"][i])],
    sampled_observation_references: i === 0 ? scoreLinks : i === 1 ? scoreLinks.slice(0, 2) : scoreLinks.slice(0, 1),
  }));
  return [
    sensor, { ...sensor, sampled_observation_id: "constructed:s3-sensor-equal-content" }, statistics, speaker, call, command, other, missingSensor, ...individualStatistics,
    { ...owner("exp1.sensor_feature_count", "experimental-sensor"), quantities: [q("experimental sensor vector", coordinates(42))] },
    { ...owner("exp1.statistics_feature_count", "experimental-statistics"), quantities: [q("experimental statistics vector", coordinates(15))] },
    { ...owner("exp1.speaker_features", "experimental-speaker"), quantities: [q("experimental speaker vector", coordinates(512))] },
    { ...owner("exp1.ss.calendar_weekday", "weekday"), quantities: [q("weekday", "1")] },
    { ...owner("exp1.ss.seconds_in_day", "seconds-in-day"), quantities: [q("seconds in day", "123.00", "seconds")] },
    fileA, fileAll, fileB, fileC, train, trial("target", fileA, "file-A.csv", "target"), trial("nontarget", fileB, "file-B.csv", "nontarget"),
    { ...owner("dataset.absent_sensor_users", "missing-sensor", "participant"), participant_id: missingSensor.participant_id, device_id: missingSensor.device_id,
      quantities: [q("sensor availability", '"absent"'), q("retained", "true")] },
    aggregate("vector_aggregation.same_window", "generic-aggregate", "aggregated vector", 53),
    { ...owner("vector_aggregation.fallback", "fallback-C"), participant_id: missingSensor.participant_id, device_id: missingSensor.device_id,
      quantities: [q("fallback vector", coordinates(13))], sampled_observation_references: [link("recent vector", "statistics-C")] },
    aggregate("exp2.join_window", "experiment-aggregate", "aggregated vector", 55),
    aggregate("exp2.sensta.schema", "SenSta", "SenSta vector", 55),
    aggregate("exp2.all.schema", "SenStaSpe", "SenStaSpe vector", 557, [...vectorLinks, link("speaker vector", "speaker-A")]),
    ...scores, scoreState, ...levels,
    { ...owner("final.calibration_points", "calibration"), quantities: [q("empirical FPR", "10", "percent"), q("supplied threshold", "9.7500"), q("calibrated score", "90.00")] },
  ];
}

export function moodscopeObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const setting = (key: string) => {
    const local = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!local) throw new Error("Missing MoodScope source definition: " + key);
    return local;
  };
  const limits = "Constructed supplied MoodScope API records, not original serializer rows or computed mood. Android Galaxy S2/4.0.1 prototype is distinct from iPhone empirical evaluation; the 13-page author manuscript is not proved equivalent to the publisher version. MoodState has two floats with no disclosed API range or five-level journal constraint. Past query time is an opaque supplied API argument, NOT collection time or a day label. SetMood declares current-state/cloud-model update; no return status, model artifact, update schedule, prior Get, raw/model join, interpolation, training or inference is constructed.";
  const q = (observed_property: string, evidence_value_json?: string | null) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
  });
  const owner = (key: string, suffix: string): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:moodscope-user-A", device_id: "constructed:moodscope-phone-A",
    record_origin: "analyst_constructed_example", sampled_observation_id: "constructed:moodscope-" + suffix,
    method_setting_reference: setting(key).method_setting_id, observed_entity_kind: "participant",
    source_locators: [...setting(key).source_locators as string[], limits],
  });
  const state: SampledQuantityObservationRecord = { ...owner("api.mood_state_schema", "argument-A"),
    quantities: [q("pleasure", "3.1250"), q("activeness", "-0.7500")] };
  const current: SampledQuantityObservationRecord = { ...owner("api.current_and_past", "current-A"),
    observation_instant: "independently-supplied-collection-token-A",
    quantities: [q("API operation", '"GetCurrentMood()"'), q("pleasure", "2.5000"), q("activeness", "6.1250")] };
  const past: SampledQuantityObservationRecord = { ...owner("api.current_and_past", "past-A"),
    quantities: [q("API operation", '"GetPastMood(time)"'), q("past query time", '"opaque-supplied-past-timestamp-A"'),
      q("pleasure", "2.5000"), q("activeness", "6.1250")] };
  const equalCurrent: SampledQuantityObservationRecord = { ...current, sampled_observation_id: "constructed:moodscope-current-equal",
    quantities: structuredClone(current.quantities), source_locators: [...current.source_locators] };
  const feedback: SampledQuantityObservationRecord = { ...owner("api.mood_correction", "feedback-A"),
    quantities: [q("API operation", '"SetMood(mood)"')],
    sampled_observation_references: [{ relationship_label: "MoodState argument", sampled_observation_reference: state.sampled_observation_id,
      source_locators: ["MoodScope author primary physical pp11–12 §6.3/Table4: independently supplied SetMood(mood) argument; current-state/cloud-model effect is a source definition, not a claim that an update was executed"] }] };
  return [feedback, current, past, equalCurrent, state]; // Forward argument reference; no implied temporal order.
}

export function autosenObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const setting = (key: string) => {
    const matches = profile.method_settings.filter(s => s.method_parameter_key === key);
    if (matches.length !== 1) throw new Error("Missing or ambiguous AUToSen definition: " + key);
    return matches[0]!;
  };
  const limits = "Constructed supplied AUToSen records, not original 84-user data or executed preprocessing/model output. Touch is frequency within t, NOT coordinates or a fabricated per-second count. Magnetometer component ordinals preserve a supplied three-vector without claiming source axis names/order. Source 64 Hz acquisition, 0.5/1-second sequence periods and five-second normalization are separate; printed five/ten normalization readings remains an unresolved source discrepancy. No clock encoding/alignment, nearest selection, imputation, normalization, sequence boundaries/stride, activity filtering, training or scoring is performed. Partial supplied references are not complete original memberships.";
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string | null) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }),
  });
  const row = (key: string, suffix: string, user = "A", entity: "device" | "participant" = "device"): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:autosen-user-" + user, device_id: "constructed:autosen-phone-" + user,
    record_origin: "analyst_constructed_example", sampled_observation_id: "constructed:autosen-" + suffix,
    method_setting_reference: setting(key).method_setting_id, observed_entity_kind: entity,
    source_locators: [...setting(key).source_locators as string[], limits],
  });
  const link = (relationship_label: string, suffix?: string | null) => ({
    relationship_label, ...(suffix === undefined ? {} : { sampled_observation_reference: suffix === null ? null : "constructed:autosen-" + suffix }),
    source_locators: ["AUToSen primary pp.5012–5014, lines251–315,330–452; independently supplied normalized membership, not inferred matching"],
  });
  const raw: SampledQuantityObservationRecord[] = [
    { ...row("schema.touch_semantics", "touch-action"), source_event_time_token: "opaque-touch-event", quantities: [q("touch action", '"tap"')] },
    { ...row("schema.touch_dimension", "touch-missing"), source_event_time_token: "opaque-touch-step", quantities: [q("touch frequency", null)] },
    { ...row("schema.touch_dimension", "touch-zero"), source_event_time_token: "opaque-touch-step", quantities: [q("touch frequency", "0.00")] },
    ...Array.from({ length: 5 }, (_, i) => ({ ...row("schema.accelerometer", "ac-" + i),
      source_event_time_token: i < 2 ? "same-opaque-source-time" : "opaque-ac-" + i,
      ...(i === 0 ? { observation_instant: "independent-collection-time" } : {}),
      quantities: ["x", "y", "z"].map((axis, j) => q("accelerometer " + axis, j === 1 ? null : JSON.stringify(i + j + 0.25), "m/s^2")),
    })),
    { ...row("schema.gyroscope", "gr"), quantities: ["x", "y", "z"].map((axis, i) => q("gyroscope " + axis, ["0.1250", "null", undefined][i], "radians/second")) },
    { ...row("schema.magnetometer", "ma"), quantities: [1, 2, 3].map((i) => q("magnetometer component " + i, i === 2 ? '"1.000"' : "0.00", "microtesla")) },
    { ...row("schema.elevation", "el"), quantities: [q("elevation", "7.2500")] },
  ];
  const imputed: SampledQuantityObservationRecord[] = [
    { ...row("missing.touch.zero", "touch-imputed"), quantities: [q("imputed touch frequency", "0.00")], sampled_observation_references: [link("missing touch reading", "touch-missing")] },
    { ...row("missing.elevation.locf", "el-imputed"), quantities: [q("imputed elevation", "7.2500")], sampled_observation_references: [link("previous observed elevation", "el")] },
    { ...row("missing.other.previous_five_mean", "motion-imputed"), quantities: ["x", "y", "z"].map((axis, i) => q("imputed accelerometer " + axis, ["2.2500", null, "4.2500"][i], "m/s^2")),
      sampled_observation_references: Array.from({ length: 5 }, (_, i) => link("previous observed accelerometer", "ac-" + i)) },
  ];
  const properties: Record<string, string[]> = {
    ToAcGrMaEl: ["touch frequency", "accelerometer x", "accelerometer y", "accelerometer z", "gyroscope x", "gyroscope y", "gyroscope z", "magnetometer component 1", "magnetometer component 2", "magnetometer component 3", "elevation"],
    AcGrMaEl: ["accelerometer x", "accelerometer y", "accelerometer z", "gyroscope x", "gyroscope y", "gyroscope z", "magnetometer component 1", "magnetometer component 2", "magnetometer component 3", "elevation"],
    AcGrMa: ["accelerometer x", "accelerometer y", "accelerometer z", "gyroscope x", "gyroscope y", "gyroscope z", "magnetometer component 1", "magnetometer component 2", "magnetometer component 3"],
    AcGr: ["accelerometer x", "accelerometer y", "accelerometer z", "gyroscope x", "gyroscope y", "gyroscope z"],
  };
  const unit = (property: string) => property.startsWith("accelerometer ") ? "m/s^2" : property.startsWith("gyroscope ") ? "radians/second" : property.startsWith("magnetometer ") ? "microtesla" : undefined;
  const alignedValues = ["0.00", "0.25", null, "2.25", "0.1250", "null", undefined, "0.00", '"1.000"', "0.00", "7.2500"];
  const aligned: SampledQuantityObservationRecord = { ...row("preprocessing.temporal_alignment", "aligned"), observation_instant: "supplied-aligned-step-not-reconstructed",
    quantities: [q("sensor set", '"ToAcGrMaEl"'), ...properties.ToAcGrMaEl!.map((property, i) => q(property, alignedValues[i], unit(property)))],
    sampled_observation_references: [link("touch reading", "touch-imputed"), link("accelerometer reading", "ac-0"), link("gyroscope reading", "gr"), link("magnetometer reading", "ma"), link("elevation reading", "el-imputed")],
  };
  const normalized: SampledQuantityObservationRecord[] = [];
  const sequences: SampledQuantityObservationRecord[] = [];
  for (const [index, sensorSet] of Object.keys(properties).entries()) {
    const user = index === 3 ? "B" : "A", length = index % 2 === 0 ? 32 : 64;
    const members = Array.from({ length }, (_, i) => {
      const id = "normalized-" + sensorSet + "-" + i;
      normalized.push({ ...row("normalization.formula", id, user),
        observation_instant: i < 2 ? "equal-opaque-normalized-step" : null,
        quantities: [q("sensor set", JSON.stringify(sensorSet)), ...properties[sensorSet]!.map((property, j) => q("normalized " + property, j === 1 ? null : "0.2500"))],
        ...(index === 0 && i === 0 ? { sampled_observation_references: [link("source reading", "aligned")] } : {}),
      });
      return link("sequence member", id);
    });
    sequences.push({ ...row(length === 32 ? "sequence.period_half_second" : "sequence.period_one_second", "sequence-" + sensorSet, user),
      quantities: [q("sensor set", JSON.stringify(sensorSet))], sampled_observation_references: members });
  }
  // A separate one-second AcGrMa sequence witnesses the temporal illustration's exact subset.
  const temporalSequence: SampledQuantityObservationRecord = { ...row("sequence.period_one_second", "temporal-sequence"),
    quantities: [q("sensor set", '"AcGrMa"')], sampled_observation_references: [link("sequence member", "normalized-AcGrMa-0"), link("sequence member", "normalized-AcGrMa-1")] };
  const impostorReading: SampledQuantityObservationRecord = { ...row("normalization.formula", "normalized-impostor", "B"),
    quantities: [q("sensor set", '"ToAcGrMaEl"'), ...properties.ToAcGrMaEl!.map(property => q("normalized " + property, "0.1250"))] };
  const impostorSequence: SampledQuantityObservationRecord = { ...row("sequence.period_half_second", "impostor-sequence", "B"),
    quantities: [q("sensor set", '"ToAcGrMaEl"')], sampled_observation_references: [link("sequence member", "normalized-impostor")] };
  const model: SampledQuantityObservationRecord = { ...row("model.per_user_binary", "model-A", "A", "participant"),
    sampled_observation_references: [link("legitimate sequence", "sequence-ToAcGrMaEl"), link("impostor sequence", "impostor-sequence")] };
  return [...raw, ...imputed, aligned, ...normalized, ...sequences, temporalSequence, impostorReading, impostorSequence, model,
    { ...row("model.per_user_binary", "model-temporal", "A", "participant"), sampled_observation_references: [link("legitimate sequence", "temporal-sequence")] },
    { ...row("model.per_user_binary", "model-B", "B", "participant"), sampled_observation_references: [link("legitimate sequence", "sequence-AcGr")] },
    { ...row("model.output", "output-A", "A", "participant"), quantities: [q("authentication probability", "0.8300"), q("authentication decision", "1")],
      sampled_observation_references: [link("input sequence", "sequence-ToAcGrMaEl"), link("authentication model", "model-A")] },
    { ...row("model.output", "output-B", "B", "participant"), quantities: [q("authentication probability", "0.1250"), q("authentication decision", "0")],
      sampled_observation_references: [link("input sequence", "impostor-sequence"), link("authentication model", "model-A")] },
    ...["A", "B", "C"].map((day, i) => ({ ...row("temporal.window", "confidence-" + day, "A", "participant"),
      source_event_time_token: "supplied-confidence-occurrence-" + day,
      quantities: [q("confidence score", ["0.10", "0.20", "0.30"][i]), q("authentication decision", i === 1 ? null : String(i === 0 ? 0 : 1)),
        q("selected day token", JSON.stringify("supplied selected day " + day)), q("selected minute token", '"supplied selected minute alpha"')],
      sampled_observation_references: [link("scored sequence", "temporal-sequence"), link("authentication model", "model-temporal")] })),
    { ...row("sequence.period_half_second", "sequence-partial"), quantities: null, sampled_observation_references: null },
    { ...row("sequence.period_one_second", "sequence-empty"), quantities: [], sampled_observation_references: [] },
  ];
}

export function depressionTrafficObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
} {
  const setting = (key: string) => {
    const result = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!result) throw new Error("Missing depression-traffic source definition: " + key);
    return result;
  };
  const limits = "Automatic depression prediction / Smart Health18(2020)100137 primary PDF SHA256:27bd026e4b57921ca4347406e0069543dff95103ffda3ebc86e31135cecb5a29; text SHA256:bcc6bc66fc17cd1d8c105b005d13147734d3506c4a9a95276e202858199a8c7c. Constructed normalized identities, scalar values, designations and memberships, not recovered rows, packet parsing, participant-IP matching, screen pairing/clock conversion, keep-alive detection, bin origin/end inclusion, grouping, DBIP query/matching, calendar endpoints, PHQ scoring or model execution. Within-IP printed occupied-index difference<=1 conflicts with Fig2's3/4/6->one session; across-IP end/start<1 is distinct. Supplied gaps/memberships are not certified literal-rule execution. Raw packet time is server capture time, not an Android callback time. iOS has no supplied screen association. Table2 printed shop is normalized here to the prose shopping; duplicate youtube is retained and Table1 Facebook narrative does not add a Table2 keyword. Named PHQ-9 item wording/response codes/anchors are not recovered.";
  const source = (key: string) => [...setting(key).source_locators as string[], limits];
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }),
  });
  const row = (key: string, id: string, quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[] = []): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "constructed:depression-traffic-user",
    device_id: "constructed:depression-traffic-phone", record_origin: "analyst_constructed_example", method_setting_reference: setting(key).method_setting_id,
    sampled_observation_id: "constructed:depression-traffic-" + id, observed_entity_kind: key.startsWith("features.") || key === "aggregation.phq9_feature_window"
      || key.startsWith("analysis.") ? "participant" : "device", quantities, source_locators: source(key),
  });
  const link = (relationship_label: string, id?: string | null) => ({
    relationship_label, ...(id === undefined ? {} : { sampled_observation_reference: id === null ? null : "constructed:depression-traffic-" + id }),
    source_locators: [limits, "Primary102.txt:319–405,478–526; explicit independently supplied support, not inferred timestamp/IP/category equality"],
  });
  const instrument = "diary.phq9_instrument";
  const assessment = (id: string, key: string, criterion_label: string, assessment_value_json: string) => ({
    criterion_assessment_id: id, criterion_setting_reference: setting(key).method_setting_id, criterion_label, assessment_value_json,
    source_locators: source(key),
  });
  const task = (id: string, initial: boolean): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({
    task_occurrence_id: "constructed:depression-traffic-PHQ-" + id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:depression-traffic-user", device_id: "constructed:depression-traffic-phone", record_origin: "analyst_constructed_example",
    task_label: initial ? "Independent initial PHQ-9 and clinician screening" : "Independent later PHQ-9 completion; no calendar date inferred",
    task_actions: [{ task_action_id: "constructed:PHQ-" + id + "-answer", action_label: "Supplied questionnaire answering",
      source_locators: source("diary.phq9_cadence") }],
    task_questionnaire_responses: Array.from({ length: 9 }, (_, i) => ({
      questionnaire_response_id: "constructed:PHQ-" + id + "-item-" + (i + 1), questionnaire_setting_reference: setting(instrument).method_setting_id,
      observed_property: "PHQ-9 supplied item " + (i + 1) + "; exact wording/code undisclosed",
      ...(i === 7 ? {} : { response_value_json: i === 8 ? null : i === 6 ? "null" : '"supplied answer; original code unspecified"' }),
      source_locators: source(instrument),
    })),
    criterion_assessments: [
      assessment("constructed:PHQ-" + id + "-total", instrument, "Independent supplied PHQ-9 total; no item scoring", initial ? "12" : "3"),
      assessment("constructed:PHQ-" + id + "-clinical", initial ? "outcome.clinician_assessment" : "validation.classification_ground_truth",
        "Independent study-clinician depressed/non-depressed status; not inferred from PHQ total", initial ? '"depressed"' : '"non-depressed"'),
      ...(!initial ? [assessment("constructed:PHQ-" + id + "-followup", "outcome.depressed_followup", "Independent supplied clinician followup assessment", '"supplied clinician assessment"')] : []),
    ], source_locators: source(instrument),
  });
  const tasks = [task("A", true), task("B", false)];
  const rows: SampledQuantityObservationRecord[] = [
    ...["screen-on", "screen-off"].map((event, i) => ({ ...row("collector.android_screen_events", "screen-" + i, [q("screen event", JSON.stringify(event))]),
      source_event_time_token: "supplied:screen-event-" + i, observation_instant: "independent:screen-collection-" + i })),
    { ...row("reconstruction.screen_interval_definition", "screen-original", [q("start token", '"supplied:screen-start"'), q("end token", '"supplied:screen-end"'), q("screen-on duration", "90", "minutes")]),
      sampled_observation_references: [link("screen-on event", "screen-0"), link("screen-off event", "screen-1")] },
    { ...row("reconstruction.screen_interval_cap", "screen-effective", [q("retained screen-on duration", "60", "minutes"), q("remaining screen-off duration", "30", "minutes")]),
      sampled_observation_references: [link("original screen interval", "screen-original")] },
    ...[7, 3, 1].map((payload, i) => ({ ...row("schema.packet_tuple", "packet-" + i, [
      q("source IP address", i === 1 ? '"198.51.100.1"' : '"192.0.2.1"'), q("destination IP address", i === 1 ? '"192.0.2.1"' : '"198.51.100.1"'),
      q("payload size bytes", String(payload), "bytes"), q("platform", '"Android"') ]), observation_instant: "supplied:server-capture-" + i })),
    ...[0, 1, 2].map(i => ({ ...row("quality.android_screen_traffic_gate", "gate-" + i),
      sampled_observation_references: [link("raw packet", "packet-" + i), link("screen-on interval", "screen-effective")] })),
    ...[0, 1, 2].map(i => ({ ...row("quality.keepalive_predicate", "designation-" + i, [q("identified keep-alive", String(i === 2))]),
      sampled_observation_references: [link("classified packet", "gate-" + i)] })),
    ...[0, 1, 2].map(i => ({ ...row("quality.keepalive_removal", "decision-" + i, [q("disposition", i === 2 ? '"removed"' : '"retained"')]),
      sampled_observation_references: [link("screen-gated packet", "gate-" + i), link("keep-alive designation", "designation-" + i)] })),
    { ...row("schema.aggregated_application_session", "bin-A", [q("start time t", '"supplied:bin-start-A"'), q("external IP address a", '"198.51.100.1"'), q("sum of payload sizes s", "10", "bytes")]),
      sampled_observation_references: [link("retained packet member", "decision-0"), link("retained packet member", "decision-1")] },
    { ...row("schema.aggregated_application_session", "bin-B", [q("start time t", '"supplied:bin-start-B"'), q("external IP address a", '"198.51.100.1"'), q("sum of payload sizes s", "0", "bytes")]),
      sampled_observation_references: [] },
    { ...row("schema.aggregated_application_session", "bin-C", [q("start time t", '"supplied:bin-start-C"'), q("external IP address a", '"203.0.113.5"'), q("sum of payload sizes s", null, "bytes")]),
      sampled_observation_references: null },
    { ...row("reconstruction.usage_session_gap_rules", "within-A", [q("aggregation stage", '"within external IP"'), q("external IP address a", '"198.51.100.1"'),
      q("start token", '"supplied:within-start-A"'), q("end token", '"supplied:within-end-A"'), q("duration", "2", "minutes"), q("successive occupied-minute-index gap", "1", "minutes")]),
      sampled_observation_references: [link("minute-bin member", "bin-A"), link("minute-bin member", "bin-B")] },
    { ...row("reconstruction.usage_session_gap_rules", "within-C", [q("aggregation stage", '"within external IP"'), q("external IP address a", '"203.0.113.5"'), q("duration", "1", "minutes")]),
      sampled_observation_references: [link("minute-bin member", "bin-C")] },
    { ...row("reconstruction.usage_session_gap_rules", "across-A", [q("aggregation stage", '"across external IPs"'), q("duration", "4.50", "minutes"), q("ending-to-beginning gap", "0.50", "minutes")]),
      sampled_observation_references: [link("within-IP member", "within-A"), link("within-IP member", "within-C")] },
    { ...row("reconstruction.usage_session_gap_rules", "across-B", [q("aggregation stage", '"across external IPs"'), q("duration", null, "minutes")]),
      sampled_observation_references: null },
    { ...row("reconstruction.on_off_definition", "on-A", [q("period type", '"on-period"'), q("duration", "4.50", "minutes")]),
      sampled_observation_references: [link("merged usage session", "across-A")] },
    { ...row("reconstruction.on_off_definition", "on-B", [q("period type", '"on-period"'), q("duration", "null", "minutes")]),
      sampled_observation_references: [link("merged usage session", "across-B")] },
    { ...row("reconstruction.on_off_definition", "off", [q("period type", '"off-period"'), q("duration", "17", "minutes")]),
      sampled_observation_references: [link("preceding on-period", "on-A"), link("following on-period", "on-B")] },
    ...[["A", "198.51.100.1"], ["C", "203.0.113.5"]].map(([id, ip]) => ({ ...row("category.dbip_lookup", "lookup-" + id, [
      q("external IP address a", JSON.stringify(ip)), q("hostname", '"supplied hostname"'), q("ASN", '"supplied ASN"'), q("ISP", null), q("organization"), q("description", "null")]) })),
    ...[["A", "198.51.100.1"], ["C", "203.0.113.5"]].map(([id, ip]) => ({ ...row("category.first_match_policy", "category-" + id,
      [q("external IP address a", JSON.stringify(ip)), q("category", '"social"')]), sampled_observation_references: [link("external-IP usage session", "within-" + id), link("DBIP response", "lookup-" + id)] })),
    { ...row("reconstruction.category_overlap_merge", "category-merged", [q("category", '"social"'), q("duration", "3.25", "minutes")]),
      sampled_observation_references: [link("categorized session member", "category-A"), link("categorized session member", "category-C")] },
    { ...row("schema.packet_tuple", "iOS-independent", [q("platform", '"iOS"'), q("payload size bytes", "0", "bytes")]),
      device_id: null, observation_instant: null },
  ];
  for (const [i, t] of tasks.entries()) {
    const id = i === 0 ? "A" : "B", task_occurrence_reference = t.task_occurrence_id;
    rows.push({ ...row("aggregation.phq9_feature_window", "window-" + id, [q("days with data", i === 0 ? "8" : "1", "days"), q("history length days", i === 0 ? "14" : "1", "days")]),
      task_occurrence_reference, sampled_observation_references: [link("on-period member", "on-A"), link("off-period member", "off"),
        link("categorized session member", "category-merged"), link("minute-bin member", "bin-A")] });
    for (const [key, quantities] of [
      ["features.aggregate_usage", [q("total session duration divided by days with data", "10"), q("total session count divided by days with data", "3"), q("total off-duration divided by days with data", "25"),
        ...["morning", "afternoon", "night", "midnight"].flatMap(daypart => [q("duration share (" + daypart + ")", "0.25"), q("session-count share (" + daypart + ")", "0.25")])]],
      ["features.category_usage", ["mail", "social", "video", "audio", "game", "shopping", "study"].flatMap(category =>
        [q("duration share (" + category + ")", "0.10"), q("session-count share (" + category + ")", "0.20")])],
      ["features.volume", [q("total payload bytes divided by days with data", "0"), ...["morning", "afternoon", "night", "midnight"].map(daypart => q("payload-volume share (" + daypart + ")", "0.25"))]],
    ] as const) rows.push({ ...row(key, key + "-" + id, [...quantities]), task_occurrence_reference,
      sampled_observation_references: [link("PHQ feature window", "window-" + id)] });
    rows.push({ ...row("analysis.regression_models", "predicted-PHQ-" + id, [
      q("model", JSON.stringify(i === 0 ? "L2-regularized epsilon-SV linear multivariate regression" : "RBF epsilon-SV regression")),
      q("feature combination", '"aggregate+category"'), q("predicted PHQ-9 score", i === 0 ? '"9.00"' : "3.50")]), task_occurrence_reference,
      sampled_observation_references: [link("aggregate feature input", "features.aggregate_usage-" + id), link("category feature input", "features.category_usage-" + id)] });
    rows.push({ ...row("analysis.classification_model", "predicted-class-" + id, [q("feature combination", '"volume"'),
      q("predicted clinical status", i === 0 ? '"depressed"' : '"non-depressed"')]), task_occurrence_reference,
      sampled_observation_references: [link("volume feature input", "features.volume-" + id)] });
  }
  return { sampled_quantity_observations: rows, task_occurrences: tasks };
}

export function mercatiGovernorObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const setting = (key: string) => {
    const local = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!local) throw new Error("Missing Mercati source definition: " + key);
    return local;
  };
  const limits = "Constructed normalized independent per-core observations, not digitized plots, exported PID rows, source serial identifiers or an executed governor. The hardware experiment has no invented human participant. Allocation H/L is not a PID, H-list history, foreground app, interaction/session, or idle frequency state. Experimental seconds, virtual reliability years, scheduler10ms, temperature1s and 500-jiffy/30-virtual-day definitions remain separate; no clock conversion or cadence/row join inferred. H does not impose maximum frequency: the core4 budget-exhaustion qualification is retained in the referenced governor definition. Raw plot constructor, monitor schema, source build and DOI alias remain unproved.";
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string | null) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }),
  });
  const owner = (key: string, suffix: string, core: string): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    device_id: "constructed:mercati-tablet", record_origin: "analyst_constructed_example",
    sampled_observation_id: "constructed:mercati-" + suffix, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind: "cpu_core", observed_entity_token: core,
    source_locators: [...setting(key).source_locators as string[], limits],
  });
  const allocations: SampledQuantityObservationRecord[] = ["H", "L", "H", "L"].map((state, i) => ({
    ...owner("reported.allocation_trace", "allocation-" + (i + 1), String(i + 1)),
    quantities: [q("allocated task criticality", JSON.stringify(state)), q("experimental time", "10.0000", "seconds")],
  }));
  allocations.push({ ...owner("reported.allocation_trace", "allocation-next", "1"),
    quantities: [q("allocated task criticality", '"L"'), q("experimental time", "10.2500", "seconds")] },
    { ...structuredClone(allocations[0]!), sampled_observation_id: "constructed:mercati-allocation-equal" },
    { ...owner("reported.allocation_trace", "allocation-unknown", "2"),
      quantities: [q("allocated task criticality", null), q("experimental time", "null", "seconds")] });
  const traces: SampledQuantityObservationRecord[] = [
    { ...owner("reported.experiment_branches", "trace-1", "1"), quantities: [
      q("frequency", "1670.000", "MHz"), q("reliability", "0.9500"),
      q("experimental time", "10.0000", "seconds"), q("virtual time", "0.1500", "years"), q("frequency context", '"H"'),
    ] },
    { ...owner("reported.experiment_branches", "trace-4", "4"), quantities: [
      q("frequency", "380.000", "MHz"), q("reliability", "0.8000"),
      q("experimental time", "200.0000", "seconds"), q("virtual time", "3.3000", "years"), q("frequency context"),
    ] },
    { ...owner("reported.experiment_branches", "trace-idle", "3"), quantities: [
      q("frequency", "0.0000", "MHz"), q("frequency context", '"Idle"'), q("reliability", "null"),
    ] },
  ];
  return [...allocations, ...traces]; // No inferred raw/allocation/frequency/model relation.
}

export function signalPowerObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const setting = (key: string) => {
    const result = profile.method_settings.find(local => local.method_parameter_key === key);
    if (!result) throw new Error("Missing wireless-signal source definition: " + key);
    return result;
  };
  const limits = "Constructed independently supplied identities, memberships and values, not original rows or a recovered serializer. Android volunteer signal-change readings and five-minute network polls are separate; None/GPRS/EDGE/LTE remain observed technologies although the analysis focuses UMTS/HSPA/Wi-Fi. Raw battery units/counter reset/location encoding, clocks, RSSI bin endpoints/rounding/frequency denominator and the -80dBm equality distinction remain unknown. Controlled external-laptop frames, phone TCPDump packets, Monsoon current, replayed states, fitted powers, modeled windows and validation readings remain distinct. No frame-time conversion, counter allocation, integration, AIMD, state replay, interpolation, model fitting, overlap arithmetic, random draw or future-signal prediction executes. What-if flows and scheduling are hypothetical selected-user inputs, not recovered trace flows.";
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string | null) => ({ observed_property,
    ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }) });
  const lab = new Set(["experiment.powermeter","wifi.link_capture","wifi.synchronization","wifi.frame_classification","wifi.frame_duration","wifi.frame_interval","wifi.energy_categories","wifi.scan_behavior","wifi.power_fit","g3.packet_capture","g3.synchronization","g3.state_replay","g3.energy_categories","g3.power_fit","systemcall.required_logs","systemcall.window_estimation","systemcall.window_duration","systemcall.window_power","systemcall.idle_tail","systemcall.concurrent.final_tail","systemcall.concurrent.windows","validation.workload_capture","validation.reference","wifi.rssi_logging","g3.rssi_logging"]);
  const values: Record<string, Array<[string, string, string?]>> = {
    "trace.collector": [["network technology","\"LTE\""]],
    "trace.cellular_rssi": [["cellular RSSI","-91.7","dBm"]],
    "trace.wifi_rssi": [["Wi-Fi RSSI","-80","dBm"]],
    "trace.operator": [["operator name","\"supplied operator\""]],
    "trace.bytes": [["bytes transferred","1000","bytes"]],
    "trace.location": [["coarse network-based location","\"opaque location A\""]],
    "trace.screen_state": [["screen state","\"on\""]],
    "trace.battery_level": [["battery level","\"source indicator, units unknown\""]],
    "trace.network_poll": [["network usage","1000","bytes"]],
    "trace.active_use": [["active device usage","true"]],
    "trace.traffic_class_proxy": [["traffic class","\"primarily foreground\""]],
    "trace.within_bin_allocation": [["allocated bytes","250","bytes"],["signal strength","-91.7","dBm"],["technology","\"3G\""]],
    "trace.location_cycle": [["hour of day","0"],["location designation","\"1\""],["RSSI bin","\"-95 to -86 dBm\""],["frequency","0.5000"]],
    "experiment.powermeter": [["reported current","75.00","mA"]],
    "wifi.link_capture": [["frame type","\"ACK\""],["frame size","64","bytes"],["radiotap rate","6.0","Mbps"],["monitor placement","\"next to phone\""]],
    "wifi.synchronization": [],
    "wifi.frame_classification": [["frame class","\"ReTx ACK\""]],
    "wifi.frame_duration": [["frame duration","0.08533","milliseconds"]],
    "wifi.frame_interval": [["start token","\"supplied derived frame-start\""],["finish token","\"supplied captured frame-finish\""],["Tx/Rx energy","0.1000","µAh"],["between-frame idle energy","0.0100","µAh"]],
    "wifi.energy_categories": [["Unique Tx ACK","0.11","µAh"],["Unique Rx DATA","0.12","µAh"],["ReTx ACK","0.13","µAh"],["ReRx DATA","0.14","µAh"],["Idle","0.15","µAh"],["PSM Tail","0.16","µAh"]],
    "wifi.scan_behavior": [["scan duration","1000.5","milliseconds"],["scan type","\"active Probe Request/Response scanning\""]],
    "wifi.power_fit": [["RSSI","-85","dBm"],["direction","\"Rx\""],["reported current","200.00","mA"]],
    "g3.packet_capture": [["packet designation","\"captured TCP packet; link retransmissions unobserved\""],["packet size","100","bytes"]],
    "g3.synchronization": [["controlled power event","\"supplied synchronization spike\""]],
    "g3.state_replay": [["state or transition","\"DCH\""]],
    "g3.energy_categories": [["Promotion1","1.1","µAh"],["Promotion2","1.2","µAh"],["Data transmission","1.3","µAh"],["Tail1","1.4","µAh"],["Tail2","1.5","µAh"],["Idle","1.6","µAh"]],
    "g3.power_fit": [["RSSI","-100","dBm"],["power state or parameter","\"DCH Rx\""],["reported current","300.00","mA"]],
    "systemcall.required_logs": [["system call","\"send\""],["transfer size","20000","bytes"],["RSSI","-85","dBm"],["end-to-end RTT","30.0","milliseconds"]],
    "systemcall.window_estimation": [["TCP-window count","1"],["TCP-window size","20000","bytes"]],
    "systemcall.window_duration": [["window duration","25.00","milliseconds"],["effective rate","6.40","Mbps"]],
    "systemcall.window_power": [["RSSI","-85","dBm"],["reported current","210.00","mA"],["technology","\"Wi-Fi\""]],
    "systemcall.idle_tail": [["period kind","\"final tail\""],["tail duration","210.00","milliseconds"]],
    "systemcall.concurrent.final_tail": [["overlap current","75.00","mA"]],
    "systemcall.concurrent.windows": [["supplied offset","5.50","milliseconds"]],
    "validation.workload_capture": [["flow size","\"supplied flow-size token, original unit unreported\""],["server RTT","30.0","milliseconds"],["site","\"constructed local replay site\""]],
    "validation.reference": [["predicted energy","12.500","µAh"],["measured energy","12.700","µAh"],["model designation","\"new model\""]],
    "whatif.flow_size": [["synthetic flow size","4344.50","bytes"]],
    "whatif.flow_start": [["supplied original flow start","\"opaque original start A\""]],
    "whatif.rtt.wifi": [["synthetic RTT","5.00","milliseconds"]],
    "whatif.rtt.3g": [["synthetic RTT","700.00","milliseconds"]],
    "whatif.background_assignment": [["background flow","true"]],
    "whatif.delay_rule": [["technology","\"Wi-Fi\""],["supplied original flow start","\"opaque original start A\""],["supplied scheduled flow start","\"opaque scheduled start A\""],["maximum delay hours","2","hours"],["supplied delay","1.25","hours"]],
    "whatif.energy_comparison": [["without scheduling energy","3.40","µAh"],["with scheduling energy","2.70","µAh"]],
    "wifi.rssi_logging": [["Wi-Fi RSSI","-85","dBm"]],
    "g3.rssi_logging": [["cellular RSSI","-100","dBm"]],
  };
  const links: Record<string, Array<[string, string]>> = {
    "trace.network_poll": [["polled byte observation","trace.bytes"]],
    "trace.active_use": [["screen state","trace.screen_state"]],
    "trace.traffic_class_proxy": [["screen state","trace.screen_state"]],
    "trace.within_bin_allocation": [["five-minute poll","trace.network_poll"],["signal reading","trace.cellular_rssi"],["traffic-class designation","trace.traffic_class_proxy"]],
    "trace.location_cycle": [["location observation","trace.location"],["signal reading","trace.cellular_rssi"]],
    "wifi.synchronization": [["first frame","wifi.link_capture"],["first power spike","experiment.powermeter"]],
    "wifi.frame_classification": [["observed frame","wifi.link_capture"]],
    "wifi.frame_duration": [["observed frame","wifi.link_capture"]],
    "wifi.frame_interval": [["observed frame","wifi.link_capture"],["frame duration","wifi.frame_duration"],["frame class","wifi.frame_classification"],["power reading","experiment.powermeter"],["synchronization","wifi.synchronization"]],
    "wifi.energy_categories": [["frame-energy member","wifi.frame_interval"]],
    "wifi.power_fit": [["power reading","experiment.powermeter"],["signal reading","wifi.rssi_logging"]],
    "wifi.scan_behavior": [["observed frame","wifi.link_capture"]],
    "g3.synchronization": [["power event reading","experiment.powermeter"],["packet trace member","g3.packet_capture"]],
    "g3.state_replay": [["packet member","g3.packet_capture"],["synchronization","g3.synchronization"]],
    "g3.energy_categories": [["state member","g3.state_replay"],["power reading","experiment.powermeter"]],
    "g3.power_fit": [["state member","g3.state_replay"],["power reading","experiment.powermeter"],["signal reading","g3.rssi_logging"]],
    "systemcall.window_estimation": [["transfer call","systemcall.required_logs"]],
    "systemcall.window_duration": [["estimated window","systemcall.window_estimation"]],
    "systemcall.window_power": [["window duration","systemcall.window_duration"],["signal reading","wifi.rssi_logging"]],
    "systemcall.idle_tail": [["window member","systemcall.window_duration"],["transfer call","systemcall.required_logs"]],
    "systemcall.concurrent.final_tail": [["member tail","systemcall.idle_tail"]],
    "systemcall.concurrent.windows": [["window member","systemcall.window_duration"]],
    "validation.reference": [["power reading","experiment.powermeter"],["modelled window","systemcall.window_power"],["captured workload flow","validation.workload_capture"]],
    "validation.workload_capture": [["transfer call","systemcall.required_logs"]],
    "whatif.flow_size": [["source five-minute poll","trace.network_poll"]],
    "whatif.flow_start": [["synthetic flow","whatif.flow_size"]],
    "whatif.rtt.wifi": [["synthetic flow","whatif.flow_size"]],
    "whatif.rtt.3g": [["synthetic flow","flow-B"]],
    "whatif.background_assignment": [["synthetic flow","whatif.flow_size"]],
    "whatif.delay_rule": [["synthetic flow","whatif.flow_size"],["original start","whatif.flow_start"],["RTT assignment","whatif.rtt.wifi"],["background designation","whatif.background_assignment"],["signal at original start","trace.wifi_rssi"],["threshold-crossing signal","trace.wifi_rssi"]],
    "whatif.energy_comparison": [["original flow member","whatif.flow_size"],["scheduled flow member","whatif.delay_rule"]],
  };
  const id = (key: string) => "constructed:signal-power-" + key;
  const reference = (relationship_label: string, key: string) => ({ relationship_label, sampled_observation_reference: id(key),
    source_locators: ["114-raw.txt §§3,5–7; supplied relationship only; no temporal join or constructor execution"] });
  const rows: SampledQuantityObservationRecord[] = Object.entries(values).map(([key, quantities], index) => ({
    sampled_observation_id: id(key), method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    ...(lab.has(key) ? index % 2 ? { participant_id: null } : {} : { participant_id: "constructed:signal-volunteer-A" }),
    device_id: lab.has(key) ? "constructed:signal-lab-handset" : "constructed:signal-volunteer-phone-A",
    observed_entity_kind: key === "systemcall.required_logs" ? "process" : "device",
    observed_entity_token: key === "systemcall.required_logs" ? "constructed:logged-process" : lab.has(key) ? "constructed:signal-lab-handset" : "constructed:signal-volunteer-phone-A",
    record_origin: "analyst_constructed_example",
    method_setting_reference: setting(key).method_setting_id, source_locators: [...setting(key).source_locators as string[], limits],
    observation_instant: "supplied collection token:" + key,
    ...(key === "wifi.link_capture" || key === "g3.packet_capture" || key === "systemcall.required_logs" ? { source_event_time_token: "supplied event token:" + key } : {}),
    quantities: quantities.map(([property, value, unit]) => q(property, value, unit)),
    ...(links[key] ? { sampled_observation_references: links[key].map(([role, target]) => reference(role, target)) } : {}),
  }));
  const clone = (key: string, suffix: string) => {
    const row = structuredClone(rows.find(value => value.sampled_observation_id === id(key))!);
    row.sampled_observation_id = id(suffix);
    return row;
  };
  // Explicit start/crossing readings, not a signal predictor or a threshold-derived join.
  for (const [source, suffix, property, value] of [
    ["trace.wifi_rssi", "WiFi-at-start", "Wi-Fi RSSI", "-81"],
    ["trace.wifi_rssi", "WiFi-crossing", "Wi-Fi RSSI", "-79"],
    ["trace.cellular_rssi", "3G-at-start", "cellular RSSI", "-101"],
    ["trace.cellular_rssi", "3G-crossing", "cellular RSSI", "-99"],
  ]) {
    const reading = clone(source!, suffix!); reading.quantities = [q(property!, value, "dBm")]; rows.push(reading);
  }
  const originalDelay = rows.find(row => row.sampled_observation_id === id("whatif.delay_rule"))!;
  originalDelay.sampled_observation_references!.find(link => link.relationship_label === "signal at original start")!.sampled_observation_reference = id("WiFi-at-start");
  originalDelay.sampled_observation_references!.find(link => link.relationship_label === "threshold-crossing signal")!.sampled_observation_reference = id("WiFi-crossing");
  const interwindow = clone("systemcall.idle_tail", "inter-window-idle");
  interwindow.quantities = [q("period kind", '"between-window tail"'), q("tail duration", "5.00", "milliseconds")];
  rows.push(interwindow);
  // Seven observed technologies are not narrowed to the focus-network policy.
  for (const technology of ["None", "GPRS", "EDGE", "UMTS", "HSPA", "WiFi"]) {
    const row = clone("trace.collector", "technology-" + technology);
    row.quantities = [q("network technology", JSON.stringify(technology))]; rows.push(row);
  }
  const off = clone("trace.screen_state", "screen-off"); off.quantities = [q("screen state", '"off"')]; rows.push(off);
  const inactive = clone("trace.active_use", "inactive"); inactive.quantities = [q("active device usage", "false")];
  inactive.sampled_observation_references = [reference("screen state", "screen-off")]; rows.push(inactive);
  const background = clone("trace.traffic_class_proxy", "screen-off-proxy");
  background.quantities = [q("traffic class", '"solely non-interactive background"')];
  background.sampled_observation_references = [reference("screen state", "screen-off")]; rows.push(background);
  // A second independent synthetic flow supplies 3G RTT, foreground designation and zero delay.
  const flow = clone("whatif.flow_size", "flow-B"); flow.quantities = [q("synthetic flow size", "0.00", "bytes")]; rows.push(flow);
  const start = clone("whatif.flow_start", "start-B"); start.quantities = [q("supplied original flow start", '"opaque original start B"')];
  start.sampled_observation_references = [reference("synthetic flow", "flow-B")]; rows.push(start);
  const foreground = clone("whatif.background_assignment", "foreground-B"); foreground.quantities = [q("background flow", "false")];
  foreground.sampled_observation_references = [reference("synthetic flow", "flow-B")]; rows.push(foreground);
  const delay = clone("whatif.delay_rule", "delay-B");
  delay.quantities = [q("technology", '"3G"'), q("supplied original flow start", '"opaque original start B"'),
    q("supplied scheduled flow start", '"opaque scheduled start B"'), q("maximum delay hours", "12", "hours"), q("supplied delay", "0.00", "hours")];
  delay.sampled_observation_references = [reference("synthetic flow", "flow-B"), reference("original start", "start-B"),
    reference("RTT assignment", "whatif.rtt.3g"), reference("background designation", "foreground-B"),
    reference("signal at original start", "3G-at-start"), reference("threshold-crossing signal", "3G-crossing")];
  rows.push(delay);
  rows.find(row => row.sampled_observation_id === id("whatif.energy_comparison"))!.sampled_observation_references!.push(
    reference("original flow member", "flow-B"), reference("scheduled flow member", "delay-B"));
  return rows;
}

export function classroomContextExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  participant_day_observations: import("../../src/lib/methodProfiles").ParticipantDayObservationRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
  device_use_sessions: import("../../src/lib/methodProfiles").DeviceUseSessionRecord[];
} {
  const kim = profile.source_work_id === "doi:10.1016/j.compedu.2019.103611";
  if (!kim && profile.source_work_id !== "doi:10.1177/0956797620956613") throw new Error("Not a reviewed classroom-context source");
  const setting = (key: string) => {
    const result = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!result) throw new Error("Missing classroom-context source definition: " + key);
    return result;
  };
  const limits = kim
    ? "Constructed supplied student/course/class identities, values and supports; primary288 pp4–11. No original serializer, clocks, course roster, AP match thresholds, building radii, attendance/activity classifier, class joins, bin clipping, normalization, questionnaire scoring or source analysis executed. GPS building presence is not classroom arrival; no on/off-task inference from app identity."
    : "Constructed supplied student/course/class identities, values and supports; author-preprint365 pp6–8 and retained publisher SOM locator receipt pp1–2, not journal/SOM PDF bytes. No original screen/location/schedule rows, restricted analysis.csv, collector policy, class joins, quarter-hour clipping, denominator calculation, >=35-second classification, grades, models or bootstrap executed. App identity/activity is unobserved.";
  const common = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:classroom-student", device_id: "constructed:classroom-phone", record_origin: "analyst_constructed_example" as const };
  const locators = (key: string) => [...setting(key).source_locators as string[], limits];
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string, quantity_qualifier?: string) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const row = (key: string, id: string, quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[] | null = [],
    observed_entity_kind: SampledQuantityObservationRecord["observed_entity_kind"] = "course",
    observed_entity_token = observed_entity_kind === "course" ? "constructed:course-A" : "constructed:classroom-phone"): SampledQuantityObservationRecord => ({
    ...common, sampled_observation_id: "constructed:classroom-" + id, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind, observed_entity_token, quantities, source_locators: locators(key),
  });
  const link = (relationship_label: string, id?: string | null) => ({ relationship_label,
    ...(id === undefined ? {} : { sampled_observation_reference: id === null ? null : "constructed:classroom-" + id }),
    source_locators: [limits, "Supplied normalized support only; no inferred temporal, enrollment or raw-event join"] });
  const task = (id: string, key: string, properties: string[]): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({
    method_profile_id: common.method_profile_id, source_work_id: common.source_work_id, participant_id: common.participant_id, device_id: common.device_id,
    task_occurrence_id: "constructed:classroom-" + id, record_origin: common.record_origin,
    task_label: id, source_locators: locators(key),
    task_questionnaire_responses: properties.map((observed_property, i) => ({
      questionnaire_response_id: id + "-answer-" + i, questionnaire_setting_reference: setting(key).method_setting_id,
      observed_property, ...(i === 0 ? { response_value_json: "null" } : i === 1 ? { response_value_json: null } : {}),
      source_locators: locators(key),
    })),
  });
  const task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = [];
  const samples: SampledQuantityObservationRecord[] = [];
  if (kim) {
    task_occurrences.push(task("weekly-A", "diary.weekly_class_report", ["difficulty", "interest", "workload", "quiz_exam"]),
      task("weekly-B", "diary.weekly_class_report", ["difficulty", "interest", "workload", "quiz_exam"]),
      task("monthly-A", "diary.monthly_course_report", ["organization", "delivery effectiveness", "helpfulness for learning"]),
      task("post-use", "diary.post_study_self_report", ["on-task frequency per 90-minute class", "on-task duration/use", "on-task app names/reasons", "off-task frequency", "off-task duration/use", "off-task purpose"]),
      task("unanalysed-intake", "diary.unanalyzed_psychological_battery", ["personality", "stress", "self-esteem"]));
    task_occurrences[0]!.task_questionnaire_responses![3]!.response_value_json = "true";
    task_occurrences[1]!.task_questionnaire_responses![3]!.response_value_json = "false";
    task_occurrences[3]!.task_questionnaire_responses![0]!.response_value_json = "2.00";
    task_occurrences[3]!.task_questionnaire_responses![1]!.response_value_json = "30.00";
    task_occurrences[3]!.task_questionnaire_responses![2]!.response_value_json = '["supplied on-task app/reason"]';
    const post = task("post-SAS-GPA", "diary.post_study_sas_grades", ["Smartphone Addiction Scale"]);
    post.criterion_assessments = ["Smartphone Addiction Scale", "overall semester GPA"].map((criterion_label, i) => ({
      criterion_assessment_id: "post-participant-" + i, criterion_setting_reference: setting("diary.post_study_sas_grades").method_setting_id,
      criterion_label, assessment_value_json: i === 0 ? "null" : "3.00", source_locators: locators("diary.post_study_sas_grades"),
    }));
    const grade = task("post-course-grade", "diary.post_study_sas_grades", []);
    grade.criterion_assessments = [{ criterion_assessment_id: "post-course-grade", criterion_setting_reference: setting("diary.post_study_sas_grades").method_setting_id,
      criterion_label: "course letter grade", assessment_value_json: '"A"', source_locators: locators("diary.post_study_sas_grades") }];
    task_occurrences.push(post, grade);
    const course = row("schema.course_information", "course-A", [q("time", '"supplied schedule, clock unreported"'), q("location", '"supplied classroom"'), q("enrolled students", '["supplied roster token"]'), q("credits", "3")]);
    course.task_occurrence_reference = task_occurrences[0]!.task_occurrence_id;
    const courseB = { ...structuredClone(course), sampled_observation_id: "constructed:classroom-course-B", observed_entity_token: "constructed:course-B",
      task_occurrence_reference: task_occurrences[1]!.task_occurrence_id };
    const monthly = { ...structuredClone(course), sampled_observation_id: "constructed:classroom-monthly-context", task_occurrence_reference: task_occurrences[2]!.task_occurrence_id };
    const gradeContext = { ...structuredClone(course), sampled_observation_id: "constructed:classroom-grade-context", task_occurrence_reference: grade.task_occurrence_id };
    samples.push(course, courseB, monthly, gradeContext);
    const wifi = row("schema.table1", "wifi", [q("current AP", '"supplied AP-one"')], "device");
    wifi.entity_members = [{ entity_member_id: "AP-one", member_entity_kind: "access_point", observed_entity_token: "supplied AP-one",
      quantities: [q("RSSI", "-54.00")], source_locators: locators("schema.table1") },
      { entity_member_id: "AP-two", member_entity_kind: "access_point", observed_entity_token: "supplied AP-two",
        quantities: [q("RSSI", null)], source_locators: locators("schema.table1") }];
    const fingerprint = row("attendance.wifi_primary", "fingerprint", []);
    fingerprint.device_id = null;
    fingerprint.entity_members = structuredClone(wifi.entity_members);
    fingerprint.source_locators.push("Primary288:305–318; independently supplied author-built classroom reference input in this student-course context, not a student-phone scan or matched attendance result; collector device unknown");
    const gps = row("schema.table1", "gps", [q("latitude", "37.50"), q("longitude", "127.00")], "device");
    const traffic = row("schema.table1", "traffic", [q("bytes sent", "0", "bytes"), q("bytes received", "18.000", "bytes")], "device");
    const ringer = row("schema.table1", "ringer", [q("ringer mode", '"Silence"')], "device");
    const applications = row("schema.application_fields", "applications", [], "device");
    applications.entity_members = ["installed", "running"].map((role, i) => ({ entity_member_id: "app-" + i, member_entity_kind: "application",
      observed_entity_token: "supplied app-A", quantities: [q("application role", JSON.stringify(role))], source_locators: locators("schema.application_fields") }));
    const notification = row("schema.notification_fields", "notification", [q("source", '"supplied app-A"'), q("title", '"supplied title"'),
      q("alarm type", '"Vibration"'), q("notification setting", '{"supplied setting":null}')], "device");
    const events = ["screen on", "screen off", "short touch", "long touch", "scroll", "key press"].map((event, i) => ({
      ...row("schema.interaction_events", "event-" + i, [q("interaction event", JSON.stringify(event))], "device"),
      source_event_time_token: "supplied event token, clock unreported",
    }));
    const activities = ["Still", "Walk", "Run", "Bike", "Vehicle"].map((activity, i) => row("acquisition.activity_classes", "activity-" + i, [q("activity class", JSON.stringify(activity))], "device"));
    samples.push(wifi, fingerprint, gps, traffic, ringer, applications, notification, ...events, ...activities);
    samples.push({ ...row("attendance.wifi_primary", "attendance-A", [q("class attendance", "true"), q("fingerprint comparison", '"supplied match, threshold unknown"')]),
      sampled_observation_references: [link("scheduled class", "course-A"), link("Wi-Fi observation", "wifi"), link("classroom fingerprint", "fingerprint")] },
      { ...row("attendance.gps_fallback", "building-A", [q("building presence", "true"), q("Wi-Fi fingerprints missing", "true")]),
        sampled_observation_references: [link("scheduled class", "course-A"), link("GPS observation", "gps")] },
      { ...row("attendance.exclude_without_wifi_or_gps", "unavailable-A", [q("Wi-Fi available", "false"), q("GPS available", "false"), q("excluded from attendance analysis", "true")]),
        sampled_observation_references: [link("scheduled class", "course-A")] },
      { ...row("arrival.activity_transition", "arrival-A", [q("classroom arrival", '"supplied arrival token"'), q("classroom departure", null)]),
        sampled_observation_references: [link("scheduled class", "course-A"), link("attendance evidence", "attendance-A"), link("activity observation", "activity-1"), link("activity observation", "activity-0")] },
      { ...row("arrival.effective_class_duration", "class-A", [q("scheduled class time", "90", "minutes"), q("effective class time", "75", "minutes")]),
        sampled_observation_references: [link("scheduled class", "course-A"), link("arrival/departure evidence", "arrival-A")] },
      { ...row("session.levels", "use-A", [q("session duration", "35.00", "seconds"), q("inter-session interval", "9.50", "seconds"),
        q("session frequency", "2", "sessions"), q("use duration", "3.00", "minutes")]),
        sampled_observation_references: [link("class context", "class-A"), link("attendance evidence", "attendance-A")] },
      { ...row("rhythm.per_student_vectors", "rhythm-A", [q("duration vector", JSON.stringify([1,0,null,2,0,0,0,0,0,0,0,0,0,0,0]), "minutes"),
        q("frequency vector", JSON.stringify([1,0,0,1,0,0,0,0,0,0,0,0,0,0,0]), "sessions")]),
        sampled_observation_references: [link("class context", "class-A")] },
      { ...row("apps.ringer_modes", "ringer-A", [q("silent fraction", "0.50"), q("vibration fraction", "0.25"), q("sound fraction", "0.25")], "participant", "constructed:classroom-student"),
        sampled_observation_references: [link("class context", "class-A"), link("ringer observation", "ringer")] },
      row("apps.within_user_normalization", "app-normalized", [q("normalized app frequency", "0.20", undefined, "class-A"),
        q("normalized app duration", "0.30", undefined, "class-A")], "application", "supplied app-A"));
    samples.push({ ...structuredClone(samples.find(r => r.sampled_observation_id === "constructed:classroom-class-A")!),
      sampled_observation_id: "constructed:classroom-class-A-second" }); // Equal values/course do not merge independent class occurrences.
  } else {
    samples.push(row("acquisition.scheduled_class_administration", "scheduled-A", [q("scheduled class location", '"supplied scheduled location"'), q("scheduled class time", '"supplied schedule token"')]),
      row("acquisition.scheduled_class_administration", "scheduled-B", [q("scheduled class location", '"supplied other location"')], "course", "constructed:course-B"),
      row("event_schema.geolocation", "location-A", [q("device geolocation", '{"supplied latitude":"55.00","supplied longitude":"12.00"}')], "device"),
      row("event_schema.screen_on_state", "screen-A", [q("screen on", "true")], "device"),
      row("event_schema.screen_on_state", "screen-off-A", [q("screen on", "false")], "device"));
    samples.push({ ...row("reconstruction.attendance_inference", "attendance-A", [q("class attendance", "true"), q("attended class time", "1200.00", "seconds")]),
      sampled_observation_references: [link("scheduled class", "scheduled-A"), link("device geolocation", "location-A")] },
      { ...row("aggregation.in_class_screen_percent", "use-A", [q("screen-on class time", "60.00", "seconds"), q("attended class time", "1200.00", "seconds"),
        q("in-class screen percent", "5.00", "percent"), q("long-session screen-on class time", "35.00", "seconds"), q("long-session in-class percent", "2.90", "percent")]),
        sampled_observation_references: [link("attendance evidence", "attendance-A"), link("screen observation", "screen-A"), link("long-session measure", "long-A")] },
      { ...row("feature.long_screen_session_ge_35s", "long-A", [q("supplied screen-session duration", "35.00", "seconds"), q("long-session membership", "true")]),
        sampled_observation_references: [link("attendance evidence", "attendance-A")] },
      { ...row("aggregation.average_long_session_in_class_percent", "average-A", [q("average long-session in-class percent", "2.90", "percent")], "participant", "constructed:classroom-student"),
        sampled_observation_references: [link("per-course measure", "use-A")] },
      row("aggregation.screen_time_bin_width", "bin-A", [q("screen-on time", "60.00", "seconds", "supplied quarter-hour bin token")], "participant"),
      { ...row("aggregation.out_of_class_window", "out-of-class-A", [q("out-of-class screen percent", "0.00", "percent"),
        q("screen-on out-of-class time", "0.00", "seconds"), q("eligible out-of-class time", "2400.00", "seconds")], "participant"),
        sampled_observation_references: [link("attended class to exclude", "attendance-A")] },
      { ...row("validation.scheduled_class_break_quarter_hour_trim", "sensitivity-A", [q("sensitivity in-class screen percent", "4.00", "percent"), q("sensitivity class time", "900.00", "seconds")]),
        sampled_observation_references: [link("source class measure", "use-A")] });
    samples.push({ ...structuredClone(samples.find(r => r.sampled_observation_id === "constructed:classroom-attendance-A")!), sampled_observation_id: "constructed:classroom-attendance-A-second" });
  }
  const dayProperties = kim ? [["daily use duration", "hours", "1.50"], ["daily session frequency", "sessions", "12"],
    ["daily mean session duration", "seconds", "45.00"], ["daily mean inter-session interval", "seconds", "90.00"]]
    : [["out-of-class screen percent", "percent", "0.00"]];
  const participant_day_observations = dayProperties.map(([observed_property, evidence_unit, day_observation_value_json], i) => ({
    method_profile_id: common.method_profile_id, source_work_id: common.source_work_id, participant_id: common.participant_id, device_id: common.device_id,
    day_observation_id: "constructed:classroom-day-" + i, referenced_day_token: "supplied opaque day, timezone unreported",
    day_record_origin: common.record_origin, day_observation_kind: "objective_aggregate" as const,
    observed_property: observed_property!, evidence_unit: evidence_unit!, day_observation_value_json: day_observation_value_json!, source_locators: [limits],
  }));
  const constructor = kim ? "session.screen_on_start" : "reconstruction.screen_on_to_off_session";
  const device_use_sessions: import("../../src/lib/methodProfiles").DeviceUseSessionRecord[] = ["35.00", "0.00"].map((duration_seconds, i) => ({
    ...common, device_use_session_id: "constructed:classroom-screen-session-" + i, method_setting_reference: setting(constructor).method_setting_id,
    start_condition: kim ? "Screen On" : "screen on", end_condition: kim ? "Screen Off" : "subsequent screen off",
    denotes_interval: { duration_seconds: Number(duration_seconds) }, source_locators: locators(constructor),
  }));
  if (kim) device_use_sessions[0]!.session_actions = ["supplied app-A","supplied app-B","supplied app-A"].map((app_identifier,i) => ({
    task_action_id: "constructed:classroom-foreground-period-" + i, app_identifier, action_label: "independently supplied running-app occurrence",
    source_locators: ["Primary288:357–364; one screen session can contain a series of running apps; no recovered original clocks, packages, periods or source session joins"],
  }));
  return { sampled_quantity_observations: samples, participant_day_observations, task_occurrences, device_use_sessions };
}

/** Constructed supplied aggregate outputs; published result cells are not digitized or recomputed. */
export function cohortAppSummaryExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): SampledQuantityObservationRecord[] {
  const angry = profile.source_work_id === "doi:10.1145/2037373.2037383";
  if (!angry && profile.source_work_id !== "doi:10.1016/j.compedu.2019.103611") throw new Error("Not a reviewed cohort/app summary source");
  const limits = angry
    ? "Constructed independently supplied aggregate values and group/app/category scopes; primary article.txt:187–209,350–387,440–561,623–641. No published result cells digitized, original rows, population census, launch/session/chain reconstruction, category assignment, raw membership joins, clocks/timezone, hourly denominator, color normalization, airport footprint, speed eligibility or location lookup recovered/executed."
    : "Constructed independently supplied cohort/app outputs; rank288-primary.txt:366–459,461–514. No published result cells digitized, original participant/app census, class joins, per-user normalization, rank/support/selection computation, LMS classifier, multitasking/notification causation, questionnaire scoring or inferential tests executed. Existing per-student class/course ownership remains separate.";
  const setting = (key: string) => {
    const s = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!s) throw new Error("Missing cohort/app source definition: " + key);
    return s;
  };
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string, quantity_qualifier?: string) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const row = (key: string, id: string, observed_entity_kind: "participant_group" | "application" | "application_category",
    observed_entity_token: string, quantities: import("../../src/lib/methodProfiles").SampledQuantityRecord[]): SampledQuantityObservationRecord => ({
    method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, record_origin: "analyst_constructed_example",
    sampled_observation_id: "constructed:cohort-app-" + id, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind, observed_entity_token,
    quantities: [q("population scope", '"all participants"'), ...quantities], source_locators: [...setting(key).source_locators as string[], limits],
  });
  const group = "constructed:supplied-analysis-cohort";
  if (angry) return [
    row("analysis.daily_device_use_mean", "daily", "participant_group", group, [q("mean daily device use", "42.00", "minutes")]),
    row("analysis.application_session_mean", "app-session", "participant_group", group, [q("mean application-session duration", "63.50", "seconds")]),
    row("analysis.category_session_duration", "category", "application_category", "Communication", [q("mean application-session duration", "35.25", "seconds")]),
    row("analysis.hourly_launch_counts", "hour-launch", "participant_group", group, [q("hour of day", "18"), q("application launch count", "7", "launches")]),
    row("analysis.hourly_session_duration", "hour-duration", "participant_group", group, [q("hour of day", "18"), q("mean application-session duration", "1.50", "minutes")]),
    row("analysis.hourly_category_launch_share", "hour-category", "application_category", "Communication", [q("hour of day", "18"), q("within-hour category launch percent", "25.00", "percent"), q("row-normalized heatmap value", null)]),
    row("analysis.selected_app_hourly_usage", "hour-app", "application", "Angry Birds", [q("hour of day", "18"), q("within-app daily usage percent", "12.50", "percent")]),
    row("analysis.chain_occurrence_distribution", "chain-occurrences", "participant_group", group, [q("app occurrences per chain", "3", "app occurrences"), q("chain count", "5", "chains"), q("chain percent", "20.00", "percent")]),
    row("analysis.chain_unique_app_distribution", "chain-distinct", "participant_group", group, [q("distinct apps per chain", "2", "apps"), q("chain count", "4", "chains"), q("chain percent", "15.00", "percent")]),
    row("analysis.application_chain_duration_metric", "chain-duration", "participant_group", group, [q("application-chain duration", "4.00", "seconds", "supplied summary bin; endpoint policy unreported"), q("chain percent", "30.00", "percent", "supplied summary bin; endpoint policy unreported")]),
    row("analysis.chain_first_category", "first-category", "application_category", "Communication", [q("chain-start percent", "30.00", "percent")]),
    row("analysis.chain_first_category", "first-app", "application", "Handcent SMS", [q("chain-start percent", "4.50", "percent")]),
    row("analysis.chain_transition_probabilities", "transition", "application_category", "Communication", [q("destination category", '"Communication"'), q("next-app transition percent", "45.00", "percent")]),
    row("analysis.location_airport_comparison", "airport", "application_category", "Browsers", [q("comparison scope", '"US airports"'), q("reference scope", '"all US"'), q("relative usage-time likelihood", "1.50")]),
    row("analysis.location_motion_comparison", "motion", "application_category", "Multimedia", [q("comparison scope", '"travel speed >25 kph"'), q("reference scope", '"reference population (unreported)"'), q("relative usage-time likelihood", "1.25")]),
    row("analysis.location_region_comparison", "region", "application_category", "Browsers", [q("comparison scope", '"Europe"'), q("reference scope", '"US"'), q("relative usage-time likelihood", "0.75")]),
    row("analysis.hourly_category_launch_share", "hour-category-equal", "application_category", "Communication", [q("hour of day", "18"), q("within-hour category launch percent", "25.00", "percent"), q("row-normalized heatmap value", null)]),
  ];
  const selected = JSON.parse(String(setting("apps.top_five").method_value_json)) as unknown;
  const names = typeof selected === "object" && selected !== null && "definition" in selected
    ? (selected as { definition: string[] }).definition : selected as string[];
  return [
    row("apps.within_user_normalization", "rank", "application", "KakaoTalk", [q("summed normalized app frequency", "3.50"), q("summed normalized app duration", "2.75")]),
    row("apps.initial_support", "support", "application", "KakaoTalk", [q("top-ten participant support", "25.00", "percent"), q("supporting participants", "20", "participants"), q("candidate membership", "true")]),
    ...names.map((name,i) => row("apps.top_five", "selected-" + i, "application", name, [q("selected top-five membership", "true")])),
    row("apps.lms_comparator", "LMS", "application", "university LMS", [q("comparison-app membership", "true"), q("selected top-five membership", "false")]),
    row("apps.top_five_share", "subset", "participant_group", group, [q("selected-app use duration", "14.00"), q("overall use duration", "20.00"), q("selected-app duration fraction", "0.65")]),
    row("apps.main_results", "app-mean", "application", "KakaoTalk", [q("mean app-use duration per class", "2.50", "minutes"), q("mean app-use frequency per class", "4.25", "times")]),
    row("apps.notifications", "notification-mean", "application", "KakaoTalk", [q("mean notifications per class", "8.50", "notifications"), q("SD notifications per class", "1.25", "notifications")]),
    row("apps.multitasking", "multitasking", "participant_group", group, [q("mean apps per session", "2.50", "apps"), q("mean apps per class", "12.50", "apps"), q("SD apps per session", "0.50", "apps"), q("SD apps per class", "2.25", "apps")]),
    row("apps.multitasking", "pair", "participant_group", group, [q("pair first app", '"KakaoTalk"'), q("pair second app", '"Facebook"')]),
    row("rq1.class_prevalence", "prevalence", "participant_group", group, [q("mean class-use fraction", "0.75"), q("SD class-use fraction", "0.10"), q("participants below class-use fraction 0.80", "4", "participants")]),
    row("rq1.class_session_results", "class-summary", "participant_group", group, [q("mean session duration", "100.00", "seconds"), q("SD session duration", "20.00", "seconds"),
      q("mean inter-session interval", "180.00", "seconds"), q("SD inter-session interval", "30.00", "seconds"), q("mean uses per class", "10.25", "times"), q("SD uses per class", "2.25", "times"),
      q("mean use duration per class", "15.00", "minutes"), q("SD use duration per class", "5.00", "minutes"), q("effective-class use percent", "19.00", "percent")]),
    ...["weeks 3-7","weeks 9-15"].map((half,i) => row("rq1.semester_halves", "half-"+i, "participant_group", group,
      [q("mean use duration per class", i ? "16.00" : "14.00", "minutes", half), q("SD use duration per class", "4.00", "minutes", half),
        q("mean uses per class", "11.25", "times", half), q("SD uses per class", "2.00", "times", half)])),
    ...["all days","weekdays","weekends"].map((dayType,i) => row("rq1.weekday_weekend", "day-type-"+i, "participant_group", group,
      [q("mean daily use duration", "4.00", "hours", dayType), q("SD daily use duration", "1.00", "hours", dayType),
        q("mean daily use frequency", "120.00", "times", dayType), q("SD daily use frequency", "25.00", "times", dayType)])),
    row("rq1.class_vs_overall_tests", "class-overall", "participant_group", group, [q("comparison basis", '"in-class shorter than overall; subtraction convention unspecified"'),
      q("reported session-duration difference", "-2.00", "seconds"), q("reported inter-session-interval difference", "3.00", "seconds")]),
    ...["self-reported on-task","self-reported off-task","self-reported overall","logged"].map((basis,i) => row("validation.logged_vs_self_report", "measurement-basis-"+i, "participant_group", group,
      [q("mean use frequency per class", "8.25", "times", basis), q("SD use frequency per class", "2.50", "times", basis),
        ...(basis === "self-reported on-task" || basis === "self-reported off-task" ? [q("mean session duration", "120.00", "seconds", basis), q("SD session duration", "25.00", "seconds", basis)] : [])])),

  ];
}

export function backDeviceAuthenticationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
} {
  const setting = (key: string) => {
    const value = profile.method_settings.find(local => local.method_parameter_key === key);
    if (!value) throw new Error("Missing Back-of-device source definition: " + key);
    return value;
  };
  const sourceLocators = (key: string): string[] => {
    const locators = setting(key).source_locators;
    if (!Array.isArray(locators) || !locators.every((locator: unknown): locator is string => typeof locator === "string")) throw new Error("Invalid Back-of-device source locators: " + key);
    return locators;
  };
  const text = ".tmp-literature-review-private/corrective-packet-09-ranks330-381-20260831/text/349.txt";
  const limits = "Constructed supplied identities and values, not original touch/password/questionnaire/video rows. Anonymous point positions/coordinates have no recovered column dictionary, clock, units or transform. No Wi-Fi Direct transfer, ShortStraw, duplicate collapse, direction-character translation, password comparison, retry counting, duration arithmetic or attack execution. Rear/front devices are distinct supplied owners; repeated local IDs belong to separate participants. Protocol/randomization/outlier/statistical definitions remain source-referenced, not executed.";
  const q = (observed_property: string, evidence_value_json?: string | null) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
  });
  const link = (relationship_label: string, sampled_observation_reference?: string | null) => ({
    relationship_label, ...(sampled_observation_reference === undefined ? {} : { sampled_observation_reference }),
    source_locators: [text + ":160-172,235-273; " + limits],
  });
  const observations: SampledQuantityObservationRecord[] = [];
  const tasks: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = [];
  for (const suffix of ["A", "B"]) {
    const participant = "constructed:back-person-" + suffix, rear = "constructed:back-rear-" + suffix, front = "constructed:back-front-" + suffix;
    const base = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: participant,
      record_origin: "analyst_constructed_example" as const };
    const row = (key: string, id: string, device: string, quantities: ReturnType<typeof q>[], refs?: ReturnType<typeof link>[]): SampledQuantityObservationRecord => ({
      ...base, device_id: device, observed_entity_kind: "device", observed_entity_token: device,
      method_setting_reference: setting(key).method_setting_id, sampled_observation_id: id, quantities,
      ...(refs === undefined ? {} : { sampled_observation_references: refs }), source_locators: [...sourceLocators(key), limits],
    });
    // Identical local IDs across two people are intentional, not globally unique source keys.
    observations.push(
      row("prototype.touch_forwarding", "constructed:back-rear-points", rear,
        [q("device role", '"rear"'), q("coordinate point series", "[[0.00,1.00],[1.50,null],[2.00,3.00]]")]),
      row("prototype.touch_forwarding", "constructed:back-front-points", front,
        [q("device role", '"front"'), q("coordinate point series", "[[7.00,4.00],[null,4.50],[8.00,5.00]]")],
        [link("rear point series", "constructed:back-rear-points")]),
      { ...row("shapes.finger_lift_segmentation", "constructed:back-lift", front, [q("event", '"finger lift"')],
        [link("point series", "constructed:back-front-points")]), source_event_time_token: "supplied opaque finger-lift event time; clock unreported" },
      row("shapes.shortstraw", "constructed:back-raw-strokes", front, [q("stroke labels", '["Up","Down","Down","Left"]')],
        [link("lift-completed series", "constructed:back-lift")]),
      row("shapes.consecutive_duplicate_rule", "constructed:back-filtered-strokes", front, [q("stroke labels", '["Up","Down","Left"]')],
        [link("ShortStraw output", "constructed:back-raw-strokes")]),
      ...[1, 2, 3].map(ordinal => row("shapes.shape_storage", "constructed:back-shape-" + ordinal, front,
        [q("stroke labels", '["Up","Down","Left"]'), q("stored direction characters", '"UDL"')],
        ordinal === 1 ? [link("filtered strokes", "constructed:back-filtered-strokes")] : undefined)),
      { ...row("shapes.password_shape_count", "constructed:back-password", front, [q("shape count", "3")],
        [link("shape 1", "constructed:back-shape-1"), link("shape 2", "constructed:back-shape-2"), link("shape 3", "constructed:back-shape-3")]),
        task_occurrence_reference: "constructed:back-authentication" },
      { ...row("main.input_logging", "constructed:back-input", front,
        [q("system", '"BoD Shapes"'), q("stroke input", '["Up","Down","Left"]'), q("digit input", null)],
        [link("entered password", "constructed:back-password")]), task_occurrence_reference: "constructed:back-authentication" },
    );
    const action = (id: string, label: string, roles?: string[], content?: unknown) => ({
      task_action_id: id, action_label: label, ...(roles === undefined ? {} : { assigned_role_labels: roles }),
      ...(content === undefined ? {} : { action_content_json: JSON.stringify(content) }), source_locators: [text + ":318-382,471-521; " + limits],
    });
    const criterion = (id: string, key: string, label: string, value?: string | null, actions?: string[]) => ({
      criterion_assessment_id: id, criterion_setting_reference: setting(key).method_setting_id, criterion_label: label,
      ...(value === undefined ? {} : { assessment_value_json: value }),
      ...(actions === undefined ? {} : { support_task_action_references: actions }), source_locators: [...sourceLocators(key), limits],
    });
    const task = (id: string, label: string): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({
      ...base, device_id: front, task_occurrence_id: id, task_label: label, source_locators: [text + ":170-237,318-382,471-560; " + limits],
    });
    const pilot = task("constructed:back-pilot", "Supplied pilot attempt; target pair/hand condition independently labelled");
    pilot.task_actions = [
      action("pilot-point", "point at target 1", ["pilot target acquisition"], { supplied_target_token: "target-A", hand_condition: "forced one-handed" }),
      action("pilot-drag", "drag to target 2", ["pilot drag"], { supplied_target_token: "target-B" }),
      action("pilot-lift", "lift finger", ["pilot completion"]),
    ];
    pilot.criterion_assessments = [criterion("pilot-error", "pilot.error_definition", "independently supplied pilot error", "false", ["pilot-point", "pilot-drag"])];
    const auth = task("constructed:back-authentication", "Supplied main-study authentication session");
    auth.task_actions = [
      action("main-condition", "main-study condition", ["System", "Password", "Difficulty"], { System: "BoD Shapes", Password: "given", Difficulty: suffix === "A" ? "easy" : "hard" }),
      action("main-input-1", "independently supplied password input", ["authentication input"]),
      action("main-input-2", suffix === "A" ? "independently supplied retry input" : "independently supplied authentication input", ["authentication input"]),
      { ...action("successful-input-time", "successful-input timing", ["first touch to third-shape lift-off"]),
        denotes_interval: { duration_seconds: suffix === "A" ? 1.25 : 0 } },
    ];
    auth.criterion_assessments = [
      criterion("authentication-outcome", "shapes.authentication_decision", "independently supplied authentication outcome", '"success"', ["main-input-2"]),
      criterion("termination", "main.session_termination", "independently supplied termination condition", '"correct password"'),
      criterion("basic-error", "error.basic_definition", "basic error for this session", suffix === "A" ? "true" : "false"),
      criterion("critical-error", "error.critical_definition", "critical error for this session", "false"),
      criterion("error-category", "error.categories", "independently supplied input error category", suffix === "A" ? '"unintentional_strokes"' : "null", ["main-input-1"]),
      criterion("authentication-time", "speed.boundaries", "independently supplied authentication speed in milliseconds", suffix === "A" ? "1250.00" : "0.00", ["successful-input-time"]),
    ];
    const attack = task("constructed:back-attack", "Supplied shoulder-surfing/video-review attempt");
    attack.assessor_id = "constructed:back-expert";
    attack.task_actions = [
      action("one-off-attack", "one-off shoulder-surf attack", ["video views", "guess limit"], { video_views: 1, guesses: 3 }),
      action("review-attack", "video-review attack after failed one-off", ["conditional additional attempt"], { playback_controls: ["play", "pause", "rewind"], additional_guesses: 3 }),
    ];
    attack.criterion_assessments = [criterion("attack-outcome", "security.outcome_categories", "independently supplied attack outcome",
      suffix === "A" ? '"successful video-review attack"' : '"no success"', ["one-off-attack", "review-attack"])];
    const exit = task("constructed:back-exit", "Supplied study exit questionnaire; no recovered complete wording/coding");
    exit.task_questionnaire_responses = (["demographics", "problems", "preferences", "security/usability thoughts"] as const).map((topic, i) => ({
      questionnaire_response_id: "exit-topic-" + i, questionnaire_setting_reference: setting("main.questionnaire").method_setting_id,
      observed_property: topic, ...(i === 0 ? {} : { response_value_json: i === 1 ? null : i === 2
        ? JSON.stringify({ ranked_systems: ["PIN", "grid unlock", "Front Shapes", "BoD Shapes"], adoption_answer: "yes under the condition that" }) : "null" }),
      source_locators: [...sourceLocators("main.questionnaire"), text + ":539-560; " + limits],
    }));
    tasks.push(pilot, auth, attack, exit);
    // The other disclosed main-study systems share input logging, not the BoD
    // rear transform or a fabricated grid/PIN touch serializer.
    for (const [system, digit, stroke] of [
      ["PIN", "0", null], ["grid unlock", undefined, '"opaque supplied grid-input encoding"'],
      ["Front Shapes", undefined, '["Up","Down","Left"]'],
    ] as const) {
      const systemTask = task("constructed:back-system-" + system, "Supplied " + system + " authentication session");
      systemTask.task_actions = [action("system-input", "independently supplied authentication input", ["System", "Password", "Difficulty"],
        { System: system, Password: "self-selected", Difficulty: "easy" })];
      systemTask.criterion_assessments = [criterion("system-outcome", "shapes.authentication_decision", "independently supplied comparison-system authentication outcome", '"success"', ["system-input"])];
      // The three-shape decision applies only to Shapes; PIN/grid outcomes use
      // their explicit task/action context and termination definition instead.
      if (system !== "Front Shapes") systemTask.criterion_assessments = [criterion("system-termination", "main.session_termination", "independently supplied termination condition", '"correct password"', ["system-input"])];
      tasks.push(systemTask);
      observations.push({ ...row("main.input_logging", "constructed:back-system-input-" + system, front,
        [q("system", JSON.stringify(system)), q("digit input", digit), q("stroke input", stroke)]), task_occurrence_reference: systemTask.task_occurrence_id });
    }
  }
  return { sampled_quantity_observations: observations, task_occurrences: tasks };
}

export function tailFourExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
  sampled_quantity_observations: SampledQuantityObservationRecord[];
} {
  const families = ["daily-validity", "corona", "places", "sleep-prediction"];
  const works = ["doi:10.1016/j.chb.2024.108281", "doi:10.1038/s41597-026-07015-7", "doi:10.1145/3131901", "doi:10.5555/2442691.2442720"];
  const index = works.indexOf(profile.source_work_id), family = families[index];
  if (!family) throw new Error("Unsupported tail-four source");
  const prefix = "constructed:" + family + "-";
  const base = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: prefix + "person-A", device_id: prefix + "phone-A", record_origin: "analyst_constructed_example" as const };
  const limits = [
    "rank161.txt:206–270; supplement-mmc1.txt:17–76. Constructed supplied seconds, ordered preprocessing stages, independent daily/typical answers, trace summaries and discrepancies. No 1Hz acquisition, missing-second repair, unknown/off corroboration, short-off bridge, session construction, weighted mean, winsorization, log transform or subtraction is executed. Odd split, unbounded missingness, battery cutoff and notification-lightup attribution remain unknown. Daily 4am-to-response and available full-day burst means are distinct definitions; no timestamp alignment is inferred.",
    "252.txt:431–491,597–621,864–946; released APP_Baseline.csv physical row8 begin1594911276/end1595516076. Constructed independent baseline/EMA submissions, ordered app blocks, separate active/inactive intervals, device metadata and optional coarse GPS. The release can span seven days; no daily-window or begin/collection/end/GPS clock equality is inferred. Per-app first/last are article-declared outputs, not asserted as released fields. App/dailyValues serialization and app-duration units remain unresolved; missing GPS does not mean absent app usage or denied permission. No collection, rounding, app selection or aggregation is executed.",
    "rank149.txt:231–252,284–345,348–391,829–942. Constructed actual activity diary, supplied physical place/coder identities, four independent coder assessments, author merge, ratings/means/rescale/categories, and individual-context/pooled summaries. No place visit, clustering, Google lookup, majority vote, rating calculation, normalization, notification matching or statistical analysis is executed. Original coding handbook and exact ±0.5 category allocation remain unknown. Supplied context tokens and selected membership do not recover original joins or calendar boundaries.",
    "274.txt:120–146,183–250,328–336; linked collector text10_4108_icst_bodynets_2012_250091-eudl.txt:350–455,465–500. Constructed 16-item PSQI-based diary (own total0–18), independent components/total, separate daytime SleepMiner and night Sleep-as-Android observations, raw summaries, directed i→j day edges, own previous-day quality and supplied graph/prediction. Past-week item wording and printed Yes0/No1 trouble encoding remain unreconciled. No score, sound formula, GPS/activity extraction, previous-day arithmetic, quality complement, graph construction or prediction is executed. Raw serializer/axes/units, night/day cutoffs and original joins remain unknown.",
  ][index]!;
  const setting = (key: string) => {
    const found = profile.method_settings.find(setting => setting.method_parameter_key === key);
    if (!found) throw new Error("Missing tail-four source definition: " + key);
    return found;
  };
  const source = (key: string) => [...setting(key).source_locators as string[], limits];
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string) => ({ observed_property,
    ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }) });
  const text = (name: string, value: string) => q(name, JSON.stringify(value));
  const link = (relationship_label: string, id: string | null) => ({ relationship_label,
    sampled_observation_reference: id === null ? null : prefix + id, source_locators: [limits] });
  const sample = (key: string, id: string, quantities: ReturnType<typeof q>[], refs?: ReturnType<typeof link>[], task?: string): SampledQuantityObservationRecord => ({
    ...base, sampled_observation_id: prefix + id, method_setting_reference: setting(key).method_setting_id,
    observed_entity_kind: "participant", quantities, source_locators: source(key),
    ...(refs === undefined ? {} : { sampled_observation_references: refs }), ...(task === undefined ? {} : { task_occurrence_reference: prefix + task }),
  });
  const task = (id: string, task_label: string): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({ ...base,
    task_occurrence_id: prefix + id, task_label, source_locators: [limits] });
  const response = (id: string, key: string, observed_property: string, value?: string | null) => ({
    questionnaire_response_id: prefix + id, questionnaire_setting_reference: setting(key).method_setting_id, observed_property,
    ...(value === undefined ? {} : { response_value_json: value }), source_locators: source(key) });
  const criterion = (id: string, key: string, criterion_label: string, value?: string | null) => ({
    criterion_assessment_id: prefix + id, criterion_setting_reference: setting(key).method_setting_id, criterion_label,
    ...(value === undefined ? {} : { assessment_value_json: value }), source_locators: source(key) });
  const pooled = (row: SampledQuantityObservationRecord): SampledQuantityObservationRecord => {
    const rest = { ...row };
    delete rest.participant_id;
    delete rest.device_id;
    return { ...rest, observed_entity_kind: "participant_group", observed_entity_token: prefix + "supplied-group" };
  };
  const questionnaireItemLabel = (key: string): string => {
    const content: unknown = JSON.parse(String(setting(key).method_value_json));
    const body = content !== null && typeof content === "object" && Object.hasOwn(content, "definition") ? (content as { definition: unknown }).definition : content;
    if (typeof body !== "string") throw new Error("Missing lexical SleepMiner item definition: " + key);
    return body;
  };
  const tasks: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = [], rows: SampledQuantityObservationRecord[] = [];
  if (index === 0) {
    for (const [i, name] of ["A", "B"].entries()) tasks.push({ ...task("daily-" + name, "Actual end-of-day report until questionnaire, not a constructed analysis task"),
      referenced_day_token: "supplied-day-" + name, task_questionnaire_responses: [
        response("daily-" + name + ":hours", "diary.daily_screen_time_item", "screen time hours", String(i + 1)),
        response("daily-" + name + ":minutes", "diary.daily_screen_time_item", "screen time minutes", i ? "null" : "30"),
        response("daily-" + name + ":checks", "diary.daily_phone_check_item", "phone checks", i ? null : "12"),
      ] });
    tasks.push({ ...task("typical", "Actual post-burst report for preceding14-day typical school/non-school days"), task_questionnaire_responses:
      ["school day", "non-school day"].flatMap((day, i) => [response(day + ":hours", "diary.typical_screen_time_item", day + " screen time hours", String(i + 2)),
        response(day + ":minutes", "diary.typical_screen_time_item", day + " screen time minutes", i ? "15" : "0"),
        response(day + ":checks", "diary.typical_phone_check_item", day + " phone checks", String(i + 10))]) });
    tasks.push({ ...task("night", "Actual night-phone-profile answer used only as supplied corroboration"), task_questionnaire_responses:
      [response("night:profile", "diary.night_phone_profile_item", "night phone profile", '"turned off"')] });
    rows.push({ ...sample("event_schema.screen_second_unit", "on-before", [text("screen status", "screen-on")]), observation_instant: "supplied-second-before" });
    rows.push({ ...sample("event_schema.screen_second_unit", "on-after", [q("screen status", "null")]), observation_instant: "supplied-second-after" });
    rows.push(sample("event_schema.no_record_state", "missing", [text("supplied second token", "supplied-missing-second")]));
    rows.push(sample("event_schema.battery_status", "battery", [text("battery status", "supplied low-battery token; cutoff unreported")]));
    rows.push(sample("event_schema.repaired_screen_states", "repaired", [text("screen status", "screen-unknown"), text("repair case", "more than 60 seconds")], [link("missing second", "missing"), link("preceding bound", "on-before"), link("following bound", "on-after")]));
    rows.push(sample("quality.unknown_to_off_policy", "off", [text("screen status", "screen-off"), text("corroboration basis", "night shutdown")], [link("repaired unknown state", "repaired"), link("battery corroboration", "battery")], "night"));
    rows.push(sample("reconstruction.short_off_bridge", "bridge", [text("screen status", "screen-on"), q("supplied off-run duration", "3.00", "seconds")], [link("off member", "off"), link("preceding on bound", "on-before"), link("following on bound", "on-after")]));
    rows.push({ ...sample("event_schema.notification_presence", "notification", [text("database storage time", "supplied-storage-token"), text("generating app identifier", "supplied.app"), q("display time", null), text("text", ""), q("title")]), observation_instant: "supplied-presence-sample-token" });
    for (const [i, name] of ["A", "B"].entries()) rows.push(sample("aggregation.daily_trace_window", "trace-" + name, [text("day token", "supplied-day-" + name), q("screen time", i ? "2700.25" : "3600.50", "seconds"), q("phone checks", String(i + 5))], undefined, "daily-" + name));
    rows.push(sample("aggregation.typical_waking_day_missingness", "missingness", [text("day token", "supplied-day-A"), q("missing-data ratio", "0.10")]));
    for (const threshold of [40, 10, 5]) rows.push(sample("quality.missing_threshold_" + threshold, "retained-" + threshold, [text("day token", "supplied-day-A"), q("supplied admissible-day decision", threshold === 10 ? "null" : threshold === 40 ? "true" : "false")], [link("day missingness", "missingness")]));
    rows.push(sample("aggregation.single_time_trace_window", "burst", [text("burst token", "supplied-burst"), q("available day count", "2"), q("mean screen time", "3000.75", "seconds"), q("mean phone checks", "7.25")], [link("available day", "trace-A"), link("available day", "trace-B")]));
    rows.push(sample("feature.typical_day_weighted_mean", "weighted", [text("measure", "screen time"), q("supplied weighted estimate", "2.25")], undefined, "typical"));
    rows.push(sample("aggregation.person_mean_daily", "person-mean", [text("measure", "trace phone checks"), q("supplied person mean", "7.75")], [link("daily observation", "trace-A"), link("daily observation", "trace-B")]));
    rows.push(sample("feature.discrepancy_index", "discrepancy", [text("measure", "screen time"), q("supplied discrepancy", "-0.25")], [link("typical trace", "burst"), link("weighted typical estimate", "weighted")]));
    rows.push(sample("feature.overestimation_index", "over", [text("measure", "screen time"), q("supplied discrepancy", "0.00")], [link("discrepancy input", "discrepancy")]));
    rows.push(sample("feature.underestimation_index", "under", [text("measure", "screen time"), q("supplied discrepancy", "0.75")], [link("discrepancy input", "discrepancy")]));
  } else if (index === 1) {
    for (const id of ["baseline", "EMA-A", "EMA-B"]) tasks.push({ ...task(id, "Actual supplied " + id + " questionnaire completion; version-specific response encoding"), task_questionnaire_responses:
      ["SingleChoice", "MultipleChoice", "Scale", "Knob", "text input"].map((form, i) => response(id + ":" + form, "diary.question_types", form, [ '"supplied option"', '["supplied option"]', "null", null, '"supplied text"'][i])) });
    for (const [i, id] of ["baseline", "EMA-A", "EMA-B"].entries()) rows.push({ ...sample(i ? "acquisition.ema_submission_unit" : "acquisition.baseline_submission_unit", id,
      [text("appdata_beginTime", i ? "supplied-begin:" + id : "1594911276"), text("appdata_collected_at", "supplied-collection:" + id), text("appdata_endTime", i ? "supplied-end:" + id : "1595516076"), text("appdata_apps", "supplied unresolved serialized apps"), q("total screen-on time", i ? "0.00" : "52.25")],
      i === 1 ? [link("active-use interval", "active"), link("inferred inactive interval", "inactive"), link("per-app first/last usage", "app-first-last"), link("submission device metadata", "device"), link("submission GPS", "GPS")] : undefined, id),
      ...(i === 0 ? { entity_members: Array.from({ length: 5 }, (_, j) => ({ entity_member_id: prefix + "app-" + j, member_entity_kind: "application" as const,
        observed_entity_token: "supplied.app." + j, quantities: [q("block number", String(j + 1)), text("packageName", "supplied.app." + j), q("completeFGServiceUseTime", j ? "0.00" : "2.25"), q("completeUseTime", j ? null : "8.50"), q("dailyValues", j ? '""' : '"unresolved source string"')], source_locators: [limits] })) } : i === 1 ? { entity_members: [] } : { entity_members: null }),
    });
    rows.push({ ...sample("schema.active_use_interval_release", "active", [], undefined, "EMA-A"), denotes_interval: { start_instant: "supplied-active-start", end_instant: null, duration_seconds: 17.25, end_status: null } });
    rows.push({ ...sample("schema.inferred_inactivity_interval_release", "inactive", [], undefined, "EMA-A"), denotes_interval: null });
    rows.push(sample("schema.active_use_interval_release", "active-unknown", [], undefined, "EMA-B"));
    rows.push(sample("aggregation.per_app_first_last_usage", "app-first-last", [text("app package", "supplied.app.0"), text("first usage time", "independent-first-token"), text("last usage time", "independent-last-token")], undefined, "EMA-A"));
    rows.push(sample("acquisition.device_metadata", "device", [text("operating-system version", "supplied Android version"), text("device type", "supplied phone model")], undefined, "EMA-A"));
    rows.push(sample("schema.submission_location", "GPS", [text("sensordata_collected_at", "independent-GPS-token-not-submission-clock"), q("sensordata_latitude", "42.1", "degrees"), q("sensordata_longitude", "-71.2", "degrees"), q("sensordata_altitude", undefined, "meters")], undefined, "EMA-A"));
  } else if (index === 2) {
    tasks.push({ ...task("diary", "Actual supplied other-activity diary completion"), task_questionnaire_responses: [response("diary:other", "diary.other_free_text_allowed", "other activity text", '"washing dishes"')] });
    tasks.push({ ...task("diary-work", "Separate actual supplied offered-activity diary completion"), task_questionnaire_responses: [response("diary-work:activity", "diary.activity_options", "activity type", '"work"')] });
    rows.push({ ...sample("schema.daily_activity", "activity", [text("activity type", "other"), text("other activity text", "washing dishes")], undefined, "diary"), denotes_interval: { start_instant: "supplied-activity-start", end_instant: "supplied-activity-end", duration_seconds: 900.25 } });
    rows.push(sample("schema.daily_activity", "activity-work", [text("activity type", "work")], undefined, "diary-work"));
    rows.push(sample("diary.routine_other_to_chores", "chores", [text("activity category", "chores")], [link("original activity", "activity")]));
    rows.push(sample("schema.location", "GPS", [q("longitude", "-71.200"), q("latitude", "42.100"), q("accuracy", "12.5", "meters")]));
    const place = (row: SampledQuantityObservationRecord): SampledQuantityObservationRecord => ({ ...row, observed_entity_kind: "place", observed_entity_token: prefix + "place-A" });
    rows.push(place(sample("location.significant_place_output", "place", [q("longitude", "-71.210"), q("latitude", "42.110"), q("time at place", "125.25")], [link("location member", "GPS")])));
    rows.push(place(sample("location.top_places_for_coding", "top-place", [q("supplied place rank", "1")], [link("significant place", "place")])));
    for (let i = 0; i < 4; i++) {
      const id = "coder-" + i;
      tasks.push({ ...task(id, "Independent undergraduate nonparticipant place coding"), assessor_id: prefix + id,
        criterion_assessments: [criterion(id + ":type", "place_type.vocabulary", "supplied place type", i ? '"university"' : '"unclear"'), criterion(id + ":rating", "place_characteristic.rating_scale", "inactive-busy", String(i + 2))] });
      rows.push(place(sample("place_type.vocabulary", id + "-type", [text("supplied place type", i ? "university" : "unclear")], [link("coded place", "top-place")], id)));
      rows.push(place(sample("place_characteristic.rating_scale", id + "-rating", [text("dimension", "inactive-busy"), q("supplied coder rating", String(i + 2))], [link("coded place", "top-place")], id)));
    }
    tasks.push({ ...task("author", "Author place-type merge, not majority-vote execution"), assessor_id: prefix + "author", criterion_assessments: [criterion("author:type", "place_type.four_coder_merge", "supplied author-merged place type", '"university"')] });
    rows.push(place(sample("place_type.four_coder_merge", "merged", [text("supplied author-merged place type", "university")], Array.from({ length: 4 }, (_, i) => link("independent coder type", "coder-" + i + "-type")), "author")));
    rows.push(place(sample("place_characteristic.coder_aggregation", "mean", [text("dimension", "inactive-busy"), q("supplied mean rating", "4.50")], Array.from({ length: 4 }, (_, i) => link("independent coder rating", "coder-" + i + "-rating")))));
    rows.push(place(sample("place_characteristic.center_rescale", "centered", [text("dimension", "inactive-busy"), q("supplied centered rating", "0.50")], [link("coder mean", "mean")])));
    rows.push(place(sample("place_characteristic.trichotomization", "category", [text("dimension", "inactive-busy"), q("supplied characteristic category", "null")], [link("centered rating", "centered")])));
    rows.push({ ...sample("app_category.initial_categories", "app-category", [text("app identity", "supplied.app"), text("app category", "communication")]), observed_entity_kind: "application", observed_entity_token: "supplied.app" });
    for (const [kind, id, role] of [["activity", "activity", "activity context"], ["place", "place", "place context"], ["place characteristic", "category", "place characteristic context"]]) {
      const context = [text("context kind", kind!), text("context token", "supplied-context:" + kind), text("measure", "notification seen time"), ...(kind === "place characteristic" ? [text("dimension", "inactive-busy"), q("supplied characteristic category", "null")] : [])];
      rows.push(sample("aggregation.per_user_context_average", "context-" + id, [...context, q("supplied per-user context mean", "2.75")], [link(role!, id!)]));
      rows.push(pooled(sample("reporting.point_and_bar_summary", "pooled-" + id, [...structuredClone(context), q("mean", "3.50"), q("standard deviation", "0.75")], [link("per-user context mean", "context-" + id)])));
    }
    for (const [kind, id] of [["activity", "activity"], ["place", "place"]]) rows.push(sample("normalization.app_usage_by_" + kind + "_time", "normalized-" + kind,
      [text("context token", "supplied-context:" + kind), text("app category", "communication"), q("app usage", "12.25"), q("context time", "24.75"), q("supplied normalized app usage", "0.40")], [link(kind + " context", id!)]));
  } else {
    const itemKeys = profile.method_settings.map(setting => String(setting.method_parameter_key)).filter(key => key.startsWith("diary.item."));
    const scoreKeys = profile.method_settings.map(setting => String(setting.method_parameter_key)).filter(key => key.startsWith("diary.score."));
    for (const [i, person] of ["A", "B"].entries()) {
      const own = { participant_id: prefix + "person-" + person, device_id: prefix + "phone-" + person };
      tasks.push({ ...task("diary-" + person, "Actual PSQI-based16-item sleep diary; past-week wording retained where printed"), ...own,
        ...(i ? {} : { task_questionnaire_responses: itemKeys.map((key, j) => ({ ...response("diary-A:" + key, key, key,
          j < 2 ? '"supplied original answer"' : j === 2 ? null : "null"), questionnaire_item_label: questionnaireItemLabel(key) })) }),
        criterion_assessments: [...(i ? [] : scoreKeys.map(key => criterion("diary-A:" + key, key, "independently supplied " + key,
          key === "diary.score.trouble_item_encoding" ? "0" : key === "diary.score.sleep_medicine" || key === "diary.score.sleep_latency_bins" ? "1" : key === "diary.score.sleep_efficiency_bins" || key === "diary.score.overall_quality" ? "3" : "2"))),
          criterion("diary-" + person + ":total", "outcome.questionnaire_score_range", "independently supplied own-instrument total, not recomputed", i ? "4" : "17"),
          criterion("diary-" + person + ":validated", "quality.questionnaire_conflict_validation", "independently supplied questionnaire validation", i ? "null" : "true")] });
      const ownSample = (row: SampledQuantityObservationRecord) => ({ ...row, ...own });
      rows.push(ownSample(sample("sleep_app.measurement", "night-" + person, [text("night token", "supplied-night-" + person), q("supplied objective sleep-quality value", "0.75")])));
      rows.push(ownSample(sample("sleep_app.use", "quality-" + person, [text("night token", "supplied-night-" + person), q("supplied complemented sleep-quality value", i ? "4.25" : "3.75")], [link("independent sleep-app measure", "night-" + person)], "diary-" + person)));
      rows.push(ownSample(sample("feature.attribute_vector_scope", "attributes-" + person, [text("day token", "supplied-day-t"), q("feature identities", '["daily average sound","daily average light"]'), q("feature values", "[2.25,4.75]")], i ? undefined : [link("trajectory feature", "trajectory"), link("sound feature", "sound-mean"), link("light feature", "light-mean"), link("activity feature", "activity")])));
      rows.push(ownSample(sample("feature.previous_day_sleep_quality", "previous-" + person, [text("day token", "supplied-day-t"), text("previous day token", "supplied-day-t-minus-one"), q("supplied previous sleep-quality value", i ? "2.25" : "5.25")], [link("same-subject previous quality", "quality-" + person)])));
      rows.push(ownSample(sample("feature.social_edge.dimensions", "edge-" + person, [text("day token", "supplied-day-t"), q("calling", i ? "0.00" : "2.25"), q("messaging", i ? "3.75" : "null")], [link("source subject day", "attributes-" + person), link("destination subject day", "attributes-" + (i ? "A" : "B")), ...(i ? [] : [link("calling record", "call"), link("messaging record", "SMS")])])));
      rows.push(ownSample(sample("outcome.prediction_target", "prediction-" + person, [text("day token", "supplied-day-t"), q("supplied predicted sleep-quality value", i ? "3.25" : "4.75")], [link("daily graph", "graph"), link("own subject attributes", "attributes-" + person), link("own previous quality", "previous-" + person)])));
    }
    rows.push(sample("schema.sound.raw_summaries", "microphone", [q("s1", "-2.25"), q("s2", "8.75"), q("n", "4")]));
    rows.push(sample("feature.sound_db_formula", "sound", [q("sound intensity", "-0.25", "dB")], [link("microphone summaries", "microphone")]));
    rows.push(sample("acquisition.location_gps", "GPS", [q("longitude", "-71.200"), q("latitude", "42.100")]));
    rows.push(sample("acquisition.location_wifi_assist", "Wi-Fi", [text("nearest Wi-Fi device token", "supplied-nearest-Wi-Fi")]));
    rows.push(sample("acquisition.light_strength", "light", [q("light strength", "8.25")]));
    rows.push(sample("acquisition.accelerometer", "accelerometer", [q("channel identities", '["supplied channel B","supplied channel A"]'), q("channel readings", "[-0.25,1.50]")]));
    rows.push(sample("acquisition.call_log", "call", []), sample("acquisition.sms_log", "SMS", []));
    rows.push(sample("feature.daily_trajectory.definition", "trajectory", [text("day token", "supplied-day-t")], [link("trajectory location member", "GPS")]));
    rows.push(sample("feature.sound.daily_aggregation", "sound-mean", [text("day token", "supplied-day-t"), q("daily average sound", "2.75")], [link("sound member", "sound")]));
    rows.push(sample("feature.light.daily_aggregation", "light-mean", [text("day token", "supplied-day-t"), q("daily average light", "3.75")], [link("light member", "light")]));
    rows.push(sample("feature.activity.classes", "activity", [text("day token", "supplied-day-t"), text("activity class", "walking")], [link("accelerometer member", "accelerometer")]));
    rows.push(pooled(sample("feature.daily_graph", "graph", [text("day token", "supplied-day-t")], ["A", "B"].flatMap(person => [link("subject attribute member", "attributes-" + person), link("directed social edge member", "edge-" + person), link("previous quality member", "previous-" + person)]))));
    rows.push(sample("quality.daily_report", "report", [text("day token", "supplied-day-t"), q("data size", "4.25")]));
  }
  return { task_occurrences: tasks, sampled_quantity_observations: rows };
}

export function dynamicSecurityExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
  sampled_quantity_observations: import("../../src/lib/methodProfiles").SampledQuantityObservationRecord[];
} {
  const setting=(key:string)=>{
    const result=profile.method_settings.find(s=>s.method_parameter_key===key);
    if (!result) throw new Error("Missing DynamicSecurity source definition: "+key);
    return result;
  };
  const limits="Constructed normalized identities/independent supplied values, not original participant rows, serializer, clocks or recovered joins. Answering participant is distinct from history subject. Shared case identity is supplied across roles; wording may change. No ranker, location clustering, score, confidence, threshold, Bayes classifier, question scheduling or study-result calculation runs. Missing history subject remains unknown. Exact APK/source, raw rows, option order/correctness, deployed clustering settings, event/elapsed-time clocks and full administered exit instrument are unavailable.";
  const loc=(key:string)=>[...(setting(key).source_locators as string[]),limits];
  const owner={method_profile_id:profile.method_profile_id,source_work_id:profile.source_work_id,
    record_origin:"analyst_constructed_example" as const};
  const history="constructed:security-history-person";
  const roles=[["legitimate",history],["strong adversary","constructed:security-paired-answerer"],
    ["naive adversary","constructed:security-stranger-answerer"]] as const;
  const cases=[
    {id:"call-in",property:"incoming call person",format:"communication.response",score:"communication.score_threshold",type:"Call",prompt:"Who called you on <time> ?",answer:JSON.stringify("constructed contact"),accuracy:"1.00"},
    {id:"call-out",property:"outgoing call person",format:"communication.response",score:"communication.score_threshold",type:"Call",prompt:"Who did you call on <time> ?",answer:JSON.stringify("constructed contact"),accuracy:"0.00"},
    {id:"sms-in",property:"received SMS person",format:"communication.response",score:"communication.score_threshold",type:"SMS",prompt:"Who SMS messaged you on <time> ?",answer:JSON.stringify("constructed contact"),accuracy:"1.00"},
    {id:"sms-out",property:"sent SMS person",format:"communication.response",score:"communication.score_threshold",type:"SMS",prompt:"Who did you SMS message on <time> ?",answer:"null",accuracy:null},
    {id:"location",property:"visited location",format:"location.map",score:"location.score",type:"Location",prompt:"Where were you on <time> ?",answer:JSON.stringify({latitude:"constructed latitude token",longitude:null}),accuracy:"0.00"},
    {id:"app",property:"applications used",format:"app.answer_format",score:"app.score_formula",type:"App",prompt:"What are the applications you used in the last 24 h?",answer:JSON.stringify(["constructed option-1",null]),accuracy:"-0.500"},
    {id:"music",property:"music listened to",format:"music.answer_format",score:"music.score",type:"Music",prompt:"What are the music you listened to in the last 24 h?",answer:JSON.stringify(["constructed option-2"]),accuracy:"-1.250"},
    {id:"activity",property:"activities and times",format:"activity.answer_format",score:"activity.score_formula",type:"Activity",prompt:"What activities did you perform in the last 24 h and when?",answer:JSON.stringify([{activity:"walking",selected_time:"supplied opaque selection token"}]),accuracy:"0.50"},
    {id:"battery",property:"charging time and mode",format:"battery.answer_format",score:"battery.score_formula",type:"Battery",prompt:"When did you charge your phone in the last 24 h and how was it charged?",answer:JSON.stringify({mode:"USB",selected_time:null}),accuracy:"-0.125"},
  ];
  const task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[]=cases.flatMap((c,caseIndex)=>roles.map(([role,participant],roleIndex)=>{
    const id="constructed:security-"+c.id+"-"+roleIndex, answerId=id+":answer";
    return {...owner,participant_id:participant,device_id:"constructed:security-answer-device-"+roleIndex,
      history_subject_participant_id:history,task_occurrence_id:id,task_label:role,
      task_actions:[
        {task_action_id:id+":question",action_label:"supplied challenge presentation",assigned_role_labels:["question presentation"],
          action_content_json:JSON.stringify({printed_template:c.prompt,display_wording_role:role,question_type:c.type,
            ...(c.type==="App" || c.type==="Music" ? {supplied_option_tokens:Array.from({length:15},(_,i)=>"constructed option-"+(i+1))} : {})}),
          source_locators:["s13673-fulltext-layout.txt:268–420,874–896; Table2 template, not exact administered wording/order; options independently supplied"]},
        {task_action_id:answerId,action_label:"supplied answer",assigned_role_labels:["answer",role],
          source_locators:loc(c.format)},
      ],
      task_questionnaire_responses:[
        {questionnaire_response_id:id+":response",questionnaire_setting_reference:setting(c.format).method_setting_id,
          assessment_case_token:"constructed:security-shared-question-"+c.id,observed_property:c.property,
          response_value_json:c.answer,support_task_action_references:[answerId],source_locators:loc(c.format)},
        {questionnaire_response_id:id+":confidence",questionnaire_setting_reference:setting("confidence.measure").method_setting_id,
          assessment_case_token:"constructed:security-shared-question-"+c.id,observed_property:"answer confidence",
          response_value_json:JSON.stringify((caseIndex+roleIndex)%5+1),support_task_action_references:[answerId],
          source_locators:["s13673-fulltext-layout.txt:1068–1075; separately supplied confidence AFTER this answer, not calculated from accuracy",limits]},
      ],
      criterion_assessments:[
        {criterion_assessment_id:id+":accuracy",criterion_setting_reference:setting(c.score).method_setting_id,
          criterion_label:"independently supplied "+c.type+" question accuracy",assessment_value_json:c.accuracy,
          support_task_action_references:[answerId],source_locators:loc(c.score)},
        {criterion_assessment_id:id+":elapsed",criterion_setting_reference:setting("confidence.answer_time").method_setting_id,
          criterion_label:"elapsed answer time in seconds; source clock/start-stop unknown",assessment_value_json:roleIndex===0?"17.50":"0.00",
          support_task_action_references:[answerId],source_locators:["s13673-fulltext-layout.txt:1145–1159,1303–1315; independent supplied seconds, no timestamp subtraction",limits]},
      ],source_locators:["s13673-fulltext-layout.txt:268–420,874–896,1068–1075",limits]};
  }));
  const sessionId="constructed:security-independent-session";
  task_occurrences.push({...owner,participant_id:history,history_subject_participant_id:history,
    task_occurrence_id:sessionId,task_label:"legitimate",
    criterion_assessments:[
      ...[["communication.score_threshold","1.00"],["app.score_formula","-0.500"],["battery.score_formula","0.25"]].map(([key,value],i)=>({
        criterion_assessment_id:sessionId+":supplied-question-"+i,criterion_setting_reference:setting(key!).method_setting_id,
        criterion_label:"independent supplied question score copied into this supplied session, not joined from another task",
        assessment_value_json:value!,source_locators:loc(key!)})),
      {criterion_assessment_id:sessionId+":average",criterion_setting_reference:setting("threshold.session_score").method_setting_id,
        criterion_label:"independent supplied three-question session average",assessment_value_json:"0.1250",
        support_criterion_assessment_references:[0,1,2].map(i=>sessionId+":supplied-question-"+i),source_locators:loc("threshold.session_score")},
      {criterion_assessment_id:sessionId+":threshold-decision",criterion_setting_reference:setting("threshold.decision").method_setting_id,
        criterion_label:"independently supplied threshold decision; no delta chosen or comparison executed",assessment_value_json:"null",
        support_criterion_assessment_references:[sessionId+":average"],source_locators:loc("threshold.decision")},
      {criterion_assessment_id:sessionId+":bayes",criterion_setting_reference:setting("bayes.family").method_setting_id,
        criterion_label:"independently supplied Naive Bayes legitimate posterior; question type App; no model training/output computation",
        assessment_value_json:"0.7500",source_locators:loc("bayes.family")},
    ],source_locators:loc("threshold.session_score")});
  const surveyStatements=["It was easy for me to recall","It was easy for my close friends to guess","It was easy for me to guess my close friends’ questions","It was easy for a stranger to guess","It was easy for me to guess stranger’s questions"];
  task_occurrences.push({...owner,participant_id:history,task_occurrence_id:"constructed:security-exit",task_label:"end-of-study exit completion",
    task_questionnaire_responses:surveyStatements.flatMap((statement,s)=>["Call","SMS","Location","App","Music","Battery","Activity"].map((type,t)=>({
      questionnaire_response_id:"constructed:security-exit-"+s+"-"+t,questionnaire_setting_reference:setting("survey.protocol").method_setting_id,
      observed_property:statement,questionnaire_item_label:type,response_value_json:s===0&&t===0?null:JSON.stringify((s+t)%5+1),
      source_locators:["s13673-fulltext-layout.txt:1338–1347,1430–1444; printed five statement labels × seven result-table columns ONLY; full administered wording/order unavailable",limits]}))),
    source_locators:loc("survey.protocol")});
  task_occurrences.push({...owner,participant_id:history,task_occurrence_id:"constructed:security-qualitative",task_label:"independent selected free-text exit response",
    task_questionnaire_responses:[{questionnaire_response_id:"constructed:security-replacement",questionnaire_setting_reference:setting("survey.qualitative").method_setting_id,
      observed_property:"replacement preference",response_value_json:null,source_locators:loc("survey.qualitative")},
      {questionnaire_response_id:"constructed:security-usability",questionnaire_setting_reference:setting("survey.qualitative").method_setting_id,
        observed_property:"usability concerns",source_locators:loc("survey.qualitative")}],source_locators:loc("survey.qualitative")});
  const q=(observed_property:string,evidence_value_json?:string|null,evidence_unit?:string,quantity_qualifier?:string)=>({
    observed_property,...(evidence_value_json===undefined?{}:{evidence_value_json}),...(evidence_unit===undefined?{}:{evidence_unit}),
    ...(quantity_qualifier===undefined?{}:{quantity_qualifier})});
  const raw=(key:string,id:string,quantities:ReturnType<typeof q>[]): import("../../src/lib/methodProfiles").SampledQuantityObservationRecord=>({
    ...owner,participant_id:history,device_id:"constructed:security-history-phone",method_setting_reference:setting(key).method_setting_id,
    sampled_observation_id:"constructed:security-"+id,observed_entity_kind:"device",quantities,
    source_event_time_token:"supplied raw event time:"+id,source_locators:[...loc(key),"Table1 event time is not renamed a collection instant; duration units/serializer remain unreported"]});
  const sampled_quantity_observations: import("../../src/lib/methodProfiles").SampledQuantityObservationRecord[]=[
    raw("collection.call_schema","raw-call",[q("direction",JSON.stringify("incoming")),q("person name",JSON.stringify("constructed contact")),q("duration","0.00")]),
    raw("collection.sms_schema","raw-sms",[q("direction",JSON.stringify("sent")),q("receiver or sender name",null),q("message length","0")]),
    raw("collection.app_schema","raw-app",[q("app name",JSON.stringify("constructed app")),q("package name",JSON.stringify("constructed.app")),q("duration","12.5000")]),
    raw("collection.music_schema","raw-music",[q("track name",JSON.stringify("constructed track")),q("artist",null),q("album","null"),q("duration","12.5000")]),
    raw("collection.activity_schema","raw-activity",[q("activity type",JSON.stringify("no_movement")),q("confidence level"),q("duration",null)]),
    raw("collection.battery_schema","raw-battery",[q("power connection type",JSON.stringify("USB")),q("duration","0")]),
    raw("collection.location_schema","raw-location",[q("latitude","0.000"),q("longitude","0.000"),q("accuracy expected error bound",null),q("duration")]),
  ];
  for(const [key,id,quantities] of [
    ["ranker.history_tuple","history-tuple",[q("activity",JSON.stringify("constructed independent event")),q("duration","0.00")]],
    ["ranker.weight_formula","event-weight",[q("event probability","0.25"),q("time-window event probability","0.50"),
      q("weekday-window event probability","0.125"),q("total event duration","20.00"),q("current event duration","2.00"),q("event weight","0.0001")]],
  ] as const)sampled_quantity_observations.push({...owner,participant_id:history,method_setting_reference:setting(key).method_setting_id,
    sampled_observation_id:"constructed:security-"+id,observed_entity_kind:"participant",observed_entity_token:"constructed independent event identity",
    source_event_time_token:id==="history-tuple"?"supplied history timestamp":null,quantities:[...quantities],source_locators:loc(key)});
  const pooled=(key:string,id:string,quantities:ReturnType<typeof q>[])=>sampled_quantity_observations.push({
    ...owner,method_setting_reference:setting(key).method_setting_id,sampled_observation_id:"constructed:security-"+id,
    observed_entity_kind:"participant_group",observed_entity_token:key==="survey.result_matrix" ? "supplied group: exit respondents"
      : ["bayes.result_matrix","threshold.metrics"].includes(key) ? "supplied evaluation population: legitimate and strong-adversary responses"
      : "supplied group: strong adversaries",quantities,source_locators:[...loc(key),
      "Constructed supplied aggregate by explicit question/user type; no fictitious participant/day and no published numeric result-cell transcription"]});
  pooled("descriptive.accuracy_matrix","group-accuracy",[q("mean question accuracy","-0.2500",undefined,"question type: Music; user type: strong adversary")]);
  pooled("confidence.time_matrix","group-time",[q("mean answer time","12.50","seconds","question type: Call; user type: strong adversary"),
    q("median answer time","10.00","seconds","question type: Call; user type: strong adversary"),q("answer-time SD","1.2500","seconds","question type: Call; user type: strong adversary")]);
  pooled("confidence.rank_matrix","group-rank",[q("mean rank","12.00",undefined,"question type: Battery; user type: strong adversary"),q("order","2",undefined,"question type: Battery; user type: strong adversary")]);
  pooled("survey.result_matrix","group-exit",[q("mode","2",undefined,"statement: It was easy for me to recall; question type: Call"),
    q("median","3.50",undefined,"statement: It was easy for me to recall; question type: Call")]);
  pooled("bayes.result_matrix","group-bayes",[q("TPR","87.0","percent","question type: App; n: 3; attack regime: strong"),
    q("FPR","25.00","percent","question type: App; n: 3; attack regime: strong"),q("F1","50.00","percent","question type: App; n: 3; attack regime: strong"),
    q("accuracy","50.00","percent","question type: App; n: 3; attack regime: strong")]);
  pooled("threshold.metrics","group-roc",[q("TPR","0.7500",undefined,"question type: Music; n: 3; attack regime: strong"),
    q("FPR","0.2500",undefined,"question type: Music; n: 3; attack regime: strong"),q("AUC","0.50",undefined,"question type: Music; n: 3; attack regime: strong")]);
  return {task_occurrences,sampled_quantity_observations};
}

export function timeKillingObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  screenshot_sessions: import("../../src/lib/methodProfiles").ScreenshotSessionRecord[];
  device_use_sessions: import("../../src/lib/methodProfiles").DeviceUseSessionRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
  notification_histories: import("../../src/lib/methodProfiles").NotificationHistoryRecord[];
} {
  if (profile.source_work_id !== "doi:10.1145/3544548.3580689") throw new Error("Wrong TimeKilling profile");
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error("Missing actual TimeKilling definition: " + key);
    return found;
  };
  const limits = "Constructed supplied identities/values, not original participant rows or released serialization. Phone-use parents (45-second screen-off retention) are distinct from 30-second nonoverlapping seven-pair prediction sequences. Capture/generation time, collector time, raw event time and clock encodings are not equated. Explicit zero-padding is not a missing member or an actual captured black image. No 183-column dictionary, complete membership, tensor construction, timestamp join, interpolation, cluster fit, score/label calculation, notification schedule, questionnaire coding or original-data/model execution is recovered. U00 released code/sample is not the original 36-participant IRB corpus; primary/release model and processing differences remain documentary.";
  const locators = (key: string) => [...setting(key).source_locators as string[], limits];
  const base = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "constructed:time-killing-person", device_id: "constructed:time-killing-phone",
    record_origin: "analyst_constructed_example" as const };
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string | null, quantity_qualifier?: string | null) => ({
    observed_property, ...(evidence_value_json === undefined ? {} : { evidence_value_json }),
    ...(evidence_unit === undefined ? {} : { evidence_unit }), ...(quantity_qualifier === undefined ? {} : { quantity_qualifier }),
  });
  const row = (key: string, id: string, quantities: ReturnType<typeof q>[] | null,
    entity: SampledQuantityObservationRecord["observed_entity_kind"] = "device"): SampledQuantityObservationRecord => ({
      ...base, method_setting_reference: setting(key).method_setting_id,
      sampled_observation_id: "constructed:time-killing-" + id, observed_entity_kind: entity,
      observed_entity_token: entity === "participant" ? base.participant_id : base.device_id, quantities, source_locators: locators(key),
    });
  const link = (relationship_label: string, id?: string | null) => ({
    relationship_label, ...(id === undefined ? {} : { sampled_observation_reference: id === null ? null : "constructed:time-killing-" + id }),
    source_locators: ["223-1-ac549455d86f.txt:390–405,439–455; supplied support only, no pairing/order/timing selection"],
  });
  const current = "current characteristics at screenshot capture", session = "current phone-use-session characteristics accumulated through the screenshot";
  const sampled_quantity_observations: SampledQuantityObservationRecord[] = [
    row("collector.sensor_streams", "raw-streams", ["Android accessibility events", "screen status", "network connections", "phone volume", "application usage", "transportation type"].map((p,index) =>
      q(p, index === 0 ? '{"supplied event":"click"}' : index === 1 ? '"screen on"' : null))),
    row("sequence.timestamp_pairing", "pair-A", [q("phone-sensor feature vector", JSON.stringify(Array.from({length:183},(_,i)=>i===1 ? null : 0)))]),
    row("sequence.timestamp_pairing", "pair-B", [q("phone-sensor feature vector", '"opaque supplied coordinate encoding"')]),
    row("sequence.timestamp_pairing", "pair-C", [q("phone-sensor feature vector", null)]),
    ...Array.from({length:4},(_,index)=>row("sequence.padding","pad-" + index, [q("padding kind", '"zero pad"'),q("screenshot representation", '"whole black image"'),q("phone-sensor feature vector", null)])),
    row("sequence.lookback", "sequence-A", [q("predicted pair position","7")]),
    row("sequence.lookback", "sequence-B", [q("predicted pair position","7")]),
    row("feature.transportation", "transportation", [q("physical activity",'"on foot"',undefined,current),q("was moving","true",undefined,current),
      ...["not moving","on foot","in vehicle","on bicycle"].map(activity=>q("cumulative time per activity","0.00","seconds",session+"; activity: "+activity)),
      q("majority activity",'"not moving"',undefined,session)]),
    row("feature.day_and_time", "day-time", [q("day of week","0",undefined,current),q("was weekend","false",undefined,current),
      q("hour of day","23",undefined,current),q("was meal time","true",undefined,current)]),
    row("feature.battery", "battery", [q("phone battery level","17.50",undefined,current),q("charging status","false",undefined,current),q("charging source",null,undefined,current),
      ...["average","standard deviation","minimum","maximum","median"].map(stat=>q(stat+" phone-battery level","0.00",undefined,session)),
      q("charging count","0",undefined,session),q("cumulative charging time","0.00","seconds",session)]),
    row("feature.screen_and_orientation", "screen", [q("screen orientation",'"portrait"',undefined,current),
      ...["average","standard deviation","minimum","maximum","median","sum"].map(stat=>q(stat+" screen time","0.00","seconds",session))]),
    row("feature.foreground_app", "apps", [q("foreground app name",'"supplied app"',undefined,current),q("foreground app package",null,undefined,current),
      q("foreground app category",null,undefined,current),q("app-switch count","2",undefined,session),q("app-switch frequency","0.25",undefined,session),
      q("used-app count","2",undefined,session),q("cumulative app-category usage time","0.00","seconds",session+"; app-category basis: all-other group"),
      q("cumulative app-category usage time","12.50","seconds",session+"; app-category basis: top-15 category; category: supplied-category")]),
    row("feature.network", "network", [q("WiFi available","true",undefined,current),q("mobile available","false",undefined,current),
      q("network type",null,undefined,current),q("network operator",null,undefined,current),q("was connected","true",undefined,current),
      ...["WiFi connected time","mobile connected time","not-connected time"].map(p=>q(p,"0.00","seconds",session))]),
    row("feature.audio_ringer_volume_call", "audio", [q("ringer mode",'"normal"',undefined,current),q("audio mode",'"normal"',undefined,current),
      q("call state",'"idle"',undefined,current),q("ringer mode adjusted","false",undefined,session),q("call count","0",undefined,session),
      ...["silent","vibrate","normal"].map(mode=>q("ringer-mode cumulative time","0.00","seconds",session+"; ringer mode: "+mode)),
      ...["ringing","in call","in communication","normal"].map(mode=>q("audio-mode cumulative time","0.00","seconds",session+"; audio mode: "+mode)),
      ...["music","notification","phone calls","ring","system sounds"].flatMap(stream=>[
        q("stream volume","0.00",undefined,current+"; stream: "+stream),
        ...["average","standard deviation","minimum","maximum","median"].map(stat=>q(stat+" stream volume","0.00",undefined,session+"; stream: "+stream)),
        q("volume adjusted","false",undefined,session+"; stream: "+stream),
      ])]),
    row("feature.interaction_events", "interaction", [
      ...[180,300,600,900,1800,3600].map(seconds=>q("screen-on past-window count","0",undefined,current+"; window seconds: "+seconds)),
      ...["click","long click","scroll","hover enter/exit","input focus","text change","selection"].flatMap(event=>[
        ...[30,60,180,300,600,900,1800,3600].map(seconds=>q("accessibility past-window count","0",undefined,current+"; event: "+event+"; window seconds: "+seconds)),
        q("accessibility session count","0",undefined,session+"; event: "+event),q("accessibility session frequency","0.00",undefined,session+"; event: "+event),
      ]),q("screen-on session count","0",undefined,session),q("screen-on session frequency","0.00",undefined,session),
    ]),
    row("model.target", "prediction", [q("time-killing prediction",'"time-killing"'),q("model variant",'"Fusion (Sensor+Screenshot)"'),q("user group","1")]),
    row("clustering.user_features", "cluster-proportions", ["A","B","C","D","E"].map(c=>q("session cluster proportion","0.20",undefined,c)),"participant"),
    row("clustering.user_kmeans", "user-group", [q("user group","1")],"participant"),
  ];
  const find = (id: string) => sampled_quantity_observations.find(r=>r.sampled_observation_id === "constructed:time-killing-" + id)!;
  find("raw-streams").source_event_time_token = "supplied:raw-event-time";
  for (const [id, parent, image] of [["pair-A","phone-use-A","image-A"],["pair-B","phone-use-A","image-B"],["pair-C","phone-use-B","image-C"]]) {
    find(id!).screenshot_session_reference = "constructed:time-killing-" + parent;
    find(id!).screenshot_record_reference = image;
    find(id!).observation_instant = "supplied:collector-time:" + id;
    find(id!).source_locators.push("223-1-ac549455d86f.txt:439–455; supplied capture pairing may use another time encoding, not string equality");
  }
  find("sequence-A").sampled_observation_references = ["pad-0","pad-1","pad-2","pad-3","pair-A","pair-B"].map((id,i)=>link("pair position " + (i+1),id));
  // Position 6 is explicitly unknown, not filled with an image or inferred zero.
  find("sequence-A").sampled_observation_references!.splice(5,0,link("pair position 6",null));
  find("sequence-A").sampled_observation_references![6]!.relationship_label = "pair position 7";
  find("sequence-B").sampled_observation_references = [link("pair position 1"),link("pair position 7","pair-C")];
  for (const r of sampled_quantity_observations.filter(r=>String(profile.method_settings.find(s=>s.method_setting_id === r.method_setting_reference)?.method_parameter_key).startsWith("feature."))) {
    r.screenshot_session_reference = "constructed:time-killing-phone-use-A"; r.screenshot_record_reference = "image-B";
    r.sampled_observation_references = [link("paired capture","pair-B")];
  }
  find("prediction").sampled_observation_references = [link("input sequence","sequence-A")];
  find("user-group").sampled_observation_references = [link("session-cluster proportions","cluster-proportions")];
  for (const [key,id,entity,quantities] of [
    ["correlation.method","correlation","participant_group",[q("population scope",'"Group 1"'),q("sensor feature",'"cumulative charging time"'),q("correlation","-0.25")]],
    ["app_distribution.method","category-share","application_category",[q("population scope",'"Group 1"'),q("time-killing status",'"non-time-killing"'),q("app-category percentage","12.50","percent")]],
    ["evaluation.metrics","evaluation","participant_group",[q("population scope",'"general model population"'),q("model variant",'"SensorOnly"'),...["accuracy","precision","recall","AUROC","specificity"].map(p=>q(p,"0.00")),q("ROC curve","[[0,0],null,[1,1]]"),q("precision-recall curve",null)]],
  ] as const) {
    const supplied = row(key,id,[...quantities],entity);
    delete supplied.participant_id; delete supplied.device_id;
    supplied.observed_entity_token = "constructed:time-killing-" + id + "-subject";
    sampled_quantity_observations.push(supplied);
  }
  const screenshot_sessions: import("../../src/lib/methodProfiles").ScreenshotSessionRecord[] = ["A","B"].map((id,index)=>({
    screenshot_session_id:"constructed:time-killing-phone-use-" + id,method_profile_id:base.method_profile_id,source_work_id:base.source_work_id,
    participant_id:base.participant_id,device_id:base.device_id,session_record_origin:"analyst_constructed_example",
    method_setting_reference:setting("reconstruction.phone_session_gap_retention").method_setting_id,
    screenshots:(index===0 ? ["image-A","image-B"] : ["image-C"]).map((image,i)=>({screenshot_record_id:image,screenshot_sequence_position:i+10,
      screenshot_instant:"supplied:capture-time:"+image,source_locators:[...locators("sequence.timestamp_pairing"),image==="image-A" ? "Constructed captured black-image identity; it remains an actual capture, not padding." : "Supplied captured image, pixels not recovered."]})),
    screenshot_range_annotations:index===0 ? [
      {range_annotation_id:"constructed:selected-range",method_setting_reference:setting("annotation.label_options").method_setting_id,
        first_screenshot_reference:"image-A",last_screenshot_reference:"image-B",
        range_label_values_json:JSON.stringify({"time-killing and notification availability":"killing time and available","actual activity":"supplied participant activity"}),
        source_locators:locators("annotation.label_options")},
      {range_annotation_id:"constructed:partial-annotation",method_setting_reference:setting("annotation.label_options").method_setting_id,
        first_screenshot_reference:null,range_label_values_json:'{"time-killing and notification availability":null,"actual activity":null}',source_locators:locators("annotation.actual_activity_item")},
    ] : null,
    source_locators:locators("reconstruction.phone_session_gap_retention"),
  }));
  const durationNames = new Set(["session duration","maximum scroll-event gap","minimum scroll-event gap","maximum text-change-event gap","minimum text-change-event gap"]);
  const features = ["session duration","screen-switch frequency","app-switch frequency","scroll-event frequency","text-change-event frequency",
    "maximum scroll-event gap","minimum scroll-event gap","maximum text-change-event gap","minimum text-change-event gap"];
  const device_use_sessions: import("../../src/lib/methodProfiles").DeviceUseSessionRecord[] = ["A","B"].map((id,index)=>({
    ...base,device_use_session_id:"constructed:time-killing-device-use-"+id,method_setting_reference:setting("reconstruction.phone_session_gap_retention").method_setting_id,
    ...(index===0 ? {start_condition:null,end_condition:null} : {}),
    session_quantities:features.map(p=>({quantity_record_id:p,quantity_setting_reference:setting("clustering.session_features").method_setting_id,
      quantity_scope:"session",observed_property:p,evidence_value_json:index===0 ? "0.00" : "12.50",
      ...(durationNames.has(p) ? {evidence_unit:"seconds"} : {}),source_locators:locators("clustering.session_features")})),
    session_labels:[{label_record_id:"supplied-cluster",label_setting_reference:setting("clustering.session_kmeans").method_setting_id,
      observed_property:"session behavioral cluster",label_value_json:index===0 ? '"A"' : '"E"',source_locators:locators("clustering.session_kmeans")}],
    source_locators:[...locators("reconstruction.phone_session_gap_retention"),"No link to screenshot parent is inferred merely because constructed letters match."],
  }));
  const task = (id:string,key:string,topics:string[]): import("../../src/lib/methodProfiles").TaskOccurrenceRecord => ({
    ...base,task_occurrence_id:"constructed:time-killing-"+id,task_label:"Supplied "+id+" completion",
    task_questionnaire_responses:topics.map((topic,i)=>({questionnaire_response_id:"topic-"+i,questionnaire_setting_reference:setting(key).method_setting_id,
      observed_property:topic,...(i===0 ? {} : {questionnaire_item_label:null}),response_value_json:i===0 ? '"supplied unknown coding"' : null,source_locators:locators(key)})),
    source_locators:locators(key),
  });
  const task_occurrences = [
    task("final-questionnaires","study.final_questionnaires",["boredom proneness","smartphone addiction","inattention","acceptability of deployed time-killing detection"]),
    task("interview-seven-days","study.optional_interviews",["labeling processes","time-killing behaviors and preferences","how participants killed time, both typically and during the study"]),
    task("interview-complete","study.optional_interviews",["labeling processes","time-killing behaviors and preferences","how participants killed time, both typically and during the study"]),
    task("activity-report","annotation.actual_activity_item",["actual activity"]),
    task("notification-esm","notification.esm_items",["awareness of notification","receptivity to notification","context at notification arrival"]),
  ];
  const notification_histories: import("../../src/lib/methodProfiles").NotificationHistoryRecord[] = ["crowdsourcing tasks","non-ESM questionnaires","advertisements","news items"].map((content,index)=>({
    notification_history_id:"constructed:time-killing-notification-"+index,notification_item_id:"constructed:time-killing-item-"+index,
    method_profile_id:base.method_profile_id,source_work_id:base.source_work_id,participant_id:base.participant_id,device_id:base.device_id,
    history_record_origin:"analyst_constructed_example",
    notification_evidence:[{evidence_record_id:"receipt",evidence_kind:"arrival",evidence_role:"recorded",
      evidence_value_json:JSON.stringify(content),source_locators:[...locators("notification.content_types"),...locators("collector.notification_stream")]}],
    questionnaire_responses:["awareness of notification","receptivity to notification","context at notification arrival"].map((topic,i)=>({
      questionnaire_response_id:"esm-topic-"+i,questionnaire_item_label:topic,response_value_json:"null",source_locators:locators("notification.esm_items")})),
    source_locators:[...locators("notification.content_types"),...locators("notification.esm_delay_minutes"),"Independent supplied ESM ownership, no fabricated five-minute clocks or join to standalone task completions."],
  }));
  return {sampled_quantity_observations,screenshot_sessions,device_use_sessions,task_occurrences,notification_histories};
}

export function prefminerObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
} {
  const setting = (key: string) => {
    const found = profile.method_settings.find(setting => setting.method_parameter_key === key);
    if (!found) throw new Error("Missing PrefMiner source definition: " + key);
    return found.method_setting_id;
  };
  const limits = "Constructed independently supplied observations, identities and relationships, not original participant rows, callback keys, mined classes or executed decisions. Same rule references are explicitly supplied; no retraining identity, keyword/blacklist matching, title/context join, calendar convention, event-clock equality, TF/support/metric arithmetic or rule activation/filtering is recovered. The later linked Java build is not the deployed study. Clicked/dismissed/other-device responses, Accept/Dismiss predictions, consent, state and subjective exit answers remain separate.";
  const primary = "Retained author text 10.1145_2971648.2971747.txt";
  const q = (observed_property: string, evidence_value_json?: string | null, evidence_unit?: string) => ({ observed_property,
    ...(evidence_value_json === undefined ? {} : { evidence_value_json }), ...(evidence_unit === undefined ? {} : { evidence_unit }) });
  const link = (relationship_label: string, id?: string | null) => ({ relationship_label,
    ...(id === undefined ? {} : { sampled_observation_reference: id === null ? null : "constructed:prefminer-" + id }), source_locators: [primary + ":257–289,384–405,512–568,703–728; supplied relation only"] });
  const records: SampledQuantityObservationRecord[] = [];
  const add = (key: string, id: string, quantities: ReturnType<typeof q>[], links?: ReturnType<typeof link>[], kind: SampledQuantityObservationRecord["observed_entity_kind"] = "application", app = "constructed:app-A") => {
    const row = { sampled_observation_id: "constructed:prefminer-" + id, method_profile_id: profile.method_profile_id,
      source_work_id: profile.source_work_id, record_origin: "analyst_constructed_example", method_setting_reference: setting(key),
      ...(kind === "participant_group" ? {} : { device_id: "constructed:prefminer-phone" }),
      ...(["participant_group","device"].includes(kind) ? {} : { participant_id: "constructed:prefminer-person" }),
      observed_entity_kind: kind, ...(kind === "application" ? {observed_entity_token:app} : {}), quantities,
      ...(links === undefined ? {} : { sampled_observation_references: links }),
      source_locators: [primary + ":170–330,373–410,512–568,612–648,686–760; " + key, limits] } as SampledQuantityObservationRecord;
    records.push(row); return row;
  };
  const rawA = add("notification.title_input_and_privacy_boundary","notification-A",[q("notification title",'"Alice"')]);
  rawA.source_event_time_token = "supplied-arrival-token"; rawA.observation_instant = "independent-supplied-collection-token";
  const rawB = add("notification.title_input_and_privacy_boundary","notification-B",[q("notification title",'"Alice"')],undefined,"application","constructed:app-B");
  rawB.source_event_time_token = "supplied-arrival-token";
  add("notification.title_input_and_privacy_boundary","notification-new",[q("notification title",'"Alice says hello"')]);
  add("notification.response_state_boundary","response-A",[q("source response",'"clicked"')],[link("notification","notification-A")]);
  add("notification.response_state_boundary","response-new",[q("source response",'"dismissed"')],[link("notification","notification-new")]);
  add("notification.response_state_boundary","response-other-device",[q("source response",'"handled on another device"')],[link("notification","notification-B")],"application","constructed:app-B");
  const cleaning = ["text.clean_lowercase","text.clean_remove_punctuation_numbers","text.clean_stopwords","text.clean_sender_and_app_names","text.clean_stemming"];
  for (const app of ["A","B"]) {
    cleaning.forEach((key,index) => add(key,"clean-" + app + "-" + index,[q("supplied cleaned title",'"alice"')],
      [link("input title",index === 0 ? "notification-" + app : "clean-" + app + "-" + (index-1))],"application","constructed:app-" + app));
    add("text.document_term_matrix","dtm-" + app,[q("terms",'["alice"]'),q("term frequencies","[1.00]")],
      [link("title row","clean-" + app + "-4")],"application","constructed:app-" + app);
    add("text.per_application_cluster_partition","classifier-" + app,[q("minimum points","2.50"),q("epsilon","1.00")],
      [link("training document-term row","dtm-" + app)],"application","constructed:app-" + app);
    add("notification.type_identity","type-" + app,[q("cluster identifier",'"N1"')],
      [link("classifier","classifier-" + app),link("classified notification","notification-" + app)],"application","constructed:app-" + app);
  }
  add("text.term_frequency_filter","term-filter",[q("term",'"alice"'),q("term frequency","0.25"),q("threshold","0.25"),q("retained","true")],
    [link("document-term row","dtm-A"),link("document-term row","dtm-B")],"participant");
  add("analysis.activity_and_location_features","arrival-context",[q("activity",'"still"'),q("location",'"work"')],[link("notification","notification-A")]);
  add("analysis.arrival_time_categories","arrival-bin",[q("arrival time category",'"morning"')],[link("notification","notification-A")]);
  add("deployment.AR4_daily_charging_gate","mining-pass",[q("charging","true"),q("phone in use","false"),q("mining performed","true"),q("iteration token",'"supplied-pass-A"')],
    [link("training notification","notification-A")],"participant");
  add("association.rule_mining_algorithm","rule-A",[q("consequent response",'"Dismiss"'),q("location",'"work"'),q("feature arm",'"AR4"'),q("support","0.75"),q("confidence","0.85")],
    [link("antecedent notification type","type-A"),link("mining iteration","mining-pass")]);
  add("association.rule_mining_algorithm","rule-B",[q("consequent response",'"Dismiss"'),q("feature arm",'"AR1"'),q("support",null),q("confidence","null")],
    [link("antecedent notification type","type-B")],"application","constructed:app-B");
  add("association.rule_mining_algorithm","rule-accept",[q("consequent response",'"Accept"'),q("feature arm",'"AR5"'),q("activity",'"walking"'),q("arrival time category",'"evening"'),q("location",'"home"')],
    [link("antecedent notification type","type-A")]);
  add("library.rule_keyword_representation","presentation-A",[q("keywords",'["alice"]'),q("presented rule text",'"Stop app-A notifications containing alice at work"'),q("location",'"work"')],
    [link("represented rule","rule-A")]);
  add("analysis.five_feature_combinations","prediction",[q("predicted response",'"Dismiss"'),q("feature arm",'"AR4"')],
    [link("notification","notification-new"),link("rule","rule-A"),link("actual response","response-new")]);
  const taskOwner = {method_profile_id:profile.method_profile_id,source_work_id:profile.source_work_id,participant_id:"constructed:prefminer-person",device_id:"constructed:prefminer-phone",record_origin:"analyst_constructed_example" as const};
  const task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[] = [];
  for (const [id,value,rule,app] of [
    ["proposal-first",'"Not Now"',"rule-A","A"], ["proposal-again",'"Yes"',"rule-A","A"],
    ["proposal-never",'"Never"',"rule-B","B"], ["proposal-unknown","null",undefined,"A"],
  ] as const) {
    const taskId = "constructed:prefminer-consent-" + id;
    task_occurrences.push({...taskOwner,task_occurrence_id:taskId,task_label:"Constructed individual rule-consent completion",task_actions:[],
      task_questionnaire_responses:[{questionnaire_response_id:"decision",questionnaire_setting_reference:setting("deployment.user_acceptance_rule_lifecycle"),
        observed_property:"rule proposal decision",response_value_json:value,source_locators:[primary + ":703–728; distinct supplied consent, not notification acceptance",limits]}],
      source_locators:[primary + ":703–728",limits]});
    const supports = rule === undefined ? undefined : [link("rule",rule),...(id === "proposal-again" ? [link("prior proposal","proposal-first"),link("rule presentation","presentation-A")] : [])];
    const proposal = add("deployment.user_acceptance_rule_lifecycle",id,[q("lifecycle stage",'"proposal"')],supports,"application","constructed:app-"+app);
    proposal.task_occurrence_reference = taskId;
  }
  add("deployment.user_acceptance_rule_lifecycle","state-active",[q("lifecycle stage",'"rule state"'),q("active","true"),q("blacklisted","false"),q("re-proposed","null")],
    [link("rule","rule-A"),link("consent proposal","proposal-again")]);
  add("deployment.user_acceptance_rule_lifecycle","state-blacklisted",[q("lifecycle stage",'"rule state"'),q("active","false"),q("blacklisted","true")],
    [link("rule","rule-B"),link("consent proposal","proposal-never")],"application","constructed:app-B");
  add("deployment.user_acceptance_rule_lifecycle","manual-availability",[q("lifecycle stage",'"manual-rule availability"'),q("within first 15 study days","true"),q("manual rule creation allowed","false")]);
  add("deployment.notification_filter_output","filter",[q("filtered","true")],[link("notification","notification-new"),link("rule","rule-A"),link("supplied active state","state-active")]);
  add("analysis.online_daily_update","online",[q("training day tokens",'["supplied-training-day-A",null]'),q("test day token",'"supplied-test-day-B"'),q("minimum support","0.125")],
    [link("training notification","notification-A"),link("test notification","notification-new")],"participant");
  add("analysis.cross_validation","fold",[q("fold token",'"supplied-fold"'),q("feature arm",'"AR4"'),q("precision mean","82.50","percent"),q("precision standard error","1.25","percent"),
    q("precision 95-percent lower confidence limit","80.00","percent"),q("precision 95-percent upper confidence limit","85.00","percent"),q("recall mean","40.25","percent"),
    q("recall standard error","0.50","percent"),q("recall 95-percent lower confidence limit",null,"percent"),q("recall 95-percent upper confidence limit",undefined,"percent")],
    [link("training notification","notification-A"),link("test notification","notification-new"),link("prediction member","prediction")],"participant");
  add("notification.reminder_zero_click_rate","click-rate",[q("accepted notification count","1","notifications"),q("all notification count","3","notifications"),q("click rate","60.00","percent"),q("reminder classification","false")],
    [link("response member","response-A")]);
  add("analysis.notification_metric_definitions","metric",[q("metric",'"field recall"'),q("numerator","3","notifications"),q("denominator","10","notifications"),q("ratio","0.90")],
    [link("filter member","filter"),link("response member","response-new")],"participant");
  add("analysis.cohort_and_complete_context_filter","retrospective-inclusion",[q("participation days","14","days"),q("included in retrospective analysis","true")],undefined,"participant");
  add("deployment.evaluation_cohort","field-inclusion",[q("evaluation inclusion","true"),q("exclusion reason","null"),q("notification permission granted","true"),q("consent recorded","true")],undefined,"participant");
  add("report.field_filter_results","pooled-field",[q("population scope",'"supplied evaluated group, original membership unavailable"'),q("suggestion count","4","suggestions"),q("accepted rule count","1","rules"),q("acceptance percentage","67.50","percent"),
    q("daily notification mean","20.25","notifications per day"),q("daily notification SD","3.50","notifications per day"),q("daily filtered mean","2.25","notifications per day"),q("daily filtered SD","1.50","notifications per day"),
    q("daily reminder mean","4.75","notifications per day"),q("daily reminder SD","2.00","notifications per day")],undefined,"participant_group");
  add("report.field_filter_results","person-field",[q("suggestion count","3","suggestions"),q("accepted rule count","1","rules"),q("acceptance percentage","50.00","percent")],undefined,"participant");
  const items = ["I found the app useful for learning my preferences to filter notifications.","The app filtered most of the notifications that I didn’t want to receive.","The app incorrectly filtered notifications that I wanted to receive."];
  task_occurrences.push({...taskOwner,task_occurrence_id:"constructed:prefminer-exit",task_label:"Constructed end-of-study exit completion",task_actions:[],
    task_questionnaire_responses:items.map((text,index)=>({questionnaire_response_id:"exit-Q"+(index+1),questionnaire_setting_reference:setting("diary.exit_questionnaire"),
      observed_property:"Q"+(index+1),questionnaire_item_label:text,response_value_json:["5","3","1"][index]!,source_locators:[primary+":686–696,749–757",limits]})),source_locators:[primary+":686–696,749–757",limits]});
  add("report.exit_questionnaire_results","pooled-exit",[q("population scope",'"supplied exit respondents, original membership unavailable"'),q("item",'"Q2"'),q("mean response","3.50")],undefined,"participant_group");
  add("report.library_resource_campaign","resource",[q("feature arm",'"AR2"'),q("input notification count","100","notifications"),q("memory footprint","2.25","MB"),q("mining time","4.75","seconds"),q("battery charge consumed","0.50","mAH")],undefined,"device");
  return {sampled_quantity_observations:records,task_occurrences};
}


export function atteliaObservationExample(profile: import("../../src/lib/methodProfiles").StudyMethodProfile): {
  sampled_quantity_observations: SampledQuantityObservationRecord[];
  task_occurrences: import("../../src/lib/methodProfiles").TaskOccurrenceRecord[];
} {
  const setting=(key:string)=>{
    const result=profile.method_settings.find(s=>s.method_parameter_key===key);
    if(!result)throw new Error("Missing Attelia II source definition: "+key);
    return result;
  };
  const limits="Constructed normalized supplied identities/values, not original study rows, serializer or clock. Detector event timestamp is not Bluetooth receipt/decision time. Screen-derived DEVICE IN USE is only the disclosed proxy, not observed attention/manipulation. No synchronization, 10-second equality/currentness calculation, 2.5-second framing, 3-second stride, 50-Hz acquisition, AND/OR classification, random schedule/quota/deferral, daily assignment, NASA-TLX scoring, gain selection or device-operation grouping executes. Unanswered prompt fate, Attelia I UI-vector formulas and original NASA-TLX form/version remain unreported.";
  const base={method_profile_id:profile.method_profile_id,source_work_id:profile.source_work_id,
    participant_id:"constructed:attelia-user",record_origin:"analyst_constructed_example" as const};
  const phone="constructed:attelia-phone",watch="constructed:attelia-watch";
  const q=(observed_property:string,evidence_value_json?:string|null)=>({observed_property,
    ...(evidence_value_json===undefined?{}:{evidence_value_json})});
  const row=(key:string,id:string,quantities:ReturnType<typeof q>[]|null,device?:string):SampledQuantityObservationRecord=>({
    ...base,...(device===undefined?{}:{device_id:device}),method_setting_reference:setting(key).method_setting_id,
    sampled_observation_id:"constructed:attelia-"+id,observed_entity_kind:device===undefined?"participant":"device",
    quantities,source_locators:[...setting(key).source_locators as string[],limits],
  });
  const link=(relationship_label:string,id:string)=>({relationship_label,
    sampled_observation_reference:"constructed:attelia-"+id,source_locators:["Attelia II author PDF pp6–9; explicitly supplied relationship, not a timestamp or membership inference"]});
  const detectors=["watch_ui","watch_activity","phone_ui","phone_activity"];
  const shared=detectors.map((type,i)=>({...row("acquisition.interdevice_breakpoint_sharing","shared-"+type,
    [q("detector type",JSON.stringify(type)),q("breakpoint","true")],i<2?watch:phone),
    source_event_time_token:"supplied-detector-timestamp:"+type}));
  const current=detectors.map((type,i)=>({...row("feature.combination_freshness","current-"+type,
    [q("detector type",JSON.stringify(type)),q("current breakpoint",i===0?"false":"true")],phone),
    sampled_observation_references:[link("shared breakpoint","shared-"+type)]}));
  const phoneOn=row("feature.device_use_screen_proxy","phone-on",[q("device type",'"phone"'),q("usage status",'"DEVICE IN USE"')],phone);
  const phoneOff=row("feature.device_use_screen_proxy","phone-off",[q("device type",'"phone"'),q("usage status",'"DEVICE NOT USED"')],phone);
  const watchOff=row("feature.device_use_screen_proxy","watch-off",[q("device type",'"watch"'),q("usage status",'"DEVICE NOT USED"')],watch);
  const observed=detectors.map(type=>link("observed detector state","current-"+type));
  const included=(types:string[])=>types.map(type=>link("included detector state","current-"+type));
  const assignment=row("validation.phase2_daily_assignment","assignment",
    [q("assignment day token",'"supplied-opaque-day-A"'),q("model",'"Combo(x)"')]);
  const trigger={...row("feature.combination_trigger","trigger",[q("model",'"Combo(x)"'),q("final breakpoint","true")],phone),
    sampled_observation_references:[...observed,link("daily model assignment","assignment")]};
  const comboG={...row("model.combo_conjunction","combo-g",[q("model",'"Combo(g)"'),q("final breakpoint","true")],phone),
    sampled_observation_references:included(["watch_activity","phone_ui","phone_activity"])};
  const comboH={...row("model.combo_conjunction","combo-h",[q("model",'"Combo(h)"'),q("final breakpoint","false")],watch),
    sampled_observation_references:included(["watch_ui","phone_ui","phone_activity"])};
  const comboX={...row("model.combo_x_disjunction","combo-x",[q("model",'"Combo(x)"'),q("final breakpoint","true")],phone),
    sampled_observation_references:[link("included combination outcome","combo-g"),link("included combination outcome","combo-h"),link("daily model assignment","assignment")]};
  const basePolicy={...row("model.base_state_conditional_delivery","base-policy",[q("model",'"Phone UI Act"'),q("final breakpoint","true")],phone),
    sampled_observation_references:[link("phone usage state","phone-on"),...observed]};
  const task=(id:string,device:string,value:string):import("../../src/lib/methodProfiles").TaskOccurrenceRecord=>({
    ...base,device_id:device,task_occurrence_id:"constructed:attelia-"+id,task_label:"Supplied artificial full-screen ESM occasion",
    task_actions:[{task_action_id:"constructed:attelia-"+id+":prompt",action_label:"full-screen ESM displayed",assigned_role_labels:["ESM prompt"],
      source_locators:["Author PDF p8 Interruptive Notifications; no official Android notification callback, scheduling execution or supplied completion clock"]}],
    task_questionnaire_responses:[{questionnaire_response_id:"constructed:attelia-"+id+":answer",
      questionnaire_setting_reference:setting("diary.esm_interruptibility_response").method_setting_id,
      observed_property:"whether current moment was a good time to be interrupted",response_value_json:value,
      source_locators:[...setting("diary.esm_interruptibility_response").source_locators as string[],limits]}],
    source_locators:[limits],
  });
  const esmPhone=task("esm-phone",phone,"4"),esmWatch=task("esm-watch",watch,"2"),esmComparison=task("esm-phase1",phone,"3");
  const deliveredPhone={...row("intervention.delivery_device","delivery-phone",[q("destination",'"phone"'),q("model",'"Combo(x)"')],phone),
    task_occurrence_reference:esmPhone.task_occurrence_id,
    sampled_observation_references:[link("phone usage state","phone-on"),link("watch usage state","watch-off"),link("selected breakpoint","combo-x"),link("daily model assignment","assignment")]};
  const deliveredWatch={...row("intervention.delivery_device","delivery-watch",[q("destination",'"watch"'),q("model",'"Combo(x)"')],watch),
    task_occurrence_reference:esmWatch.task_occurrence_id,
    sampled_observation_references:[link("phone usage state","phone-off"),link("watch usage state","watch-off"),link("selected breakpoint","combo-x"),link("daily model assignment","assignment")]};
  const comparisonModels=["Combo(c)","Combo(d)","Combo(e)","Combo(f)","Combo(g)","Combo(h)","Combo(i)","Combo(j)","Combo(k)"];
  const phase1Shared=shared.map(r=>({...r,sampled_observation_id:r.sampled_observation_id+":phase1",source_event_time_token:r.source_event_time_token+":phase1"}));
  const phase1Current=current.map(r=>({...r,sampled_observation_id:r.sampled_observation_id+":phase1",sampled_observation_references:r.sampled_observation_references.map(s=>({...s,sampled_observation_reference:s.sampled_observation_reference+":phase1"}))}));
  const comparisons=comparisonModels.map((model,i)=>({...row("validation.phase1_joint_comparison","phase1-"+i,
    [q("evaluated model",JSON.stringify(model)),q("model breakpoint",[2,3,4].includes(i)?"true":"false")],phone),
    task_occurrence_reference:esmComparison.task_occurrence_id,sampled_observation_references:observed.map(s=>({...s,sampled_observation_reference:s.sampled_observation_reference+":phase1",source_locators:[...s.source_locators]}))}));
  const gains=[row("analysis.phase1_gain_selection","gain-g",
    [q("model",'"Combo(g)"'),q("mean ESM score","3.50"),q("Random mean ESM score","3.00"),q("gain","0.50"),q("highest gain model","true")]),
    row("analysis.phase1_gain_selection","gain-c",[q("model",'"Combo(c)"'),q("mean ESM score","2.50"),q("Random mean ESM score","3.00"),q("gain","-0.50"),q("highest gain model","false")])];
  const nightly:import("../../src/lib/methodProfiles").TaskOccurrenceRecord={...base,task_occurrence_id:"constructed:attelia-nightly",task_label:"Supplied nightly web NASA-TLX occasion",
    referenced_day_token:"supplied-opaque-day-A",task_questionnaire_responses:[{questionnaire_response_id:"constructed:attelia-nightly:response",
      questionnaire_setting_reference:setting("diary.nightly_nasa_tlx").method_setting_id,observed_property:"daily notification experience workload",
      response_value_json:null,source_locators:[...setting("diary.nightly_nasa_tlx").source_locators as string[],"Full administered item wording/version/export unknown; no invented subscales"]}],
    criterion_assessments:[{criterion_assessment_id:"constructed:attelia-nightly:WWL",criterion_setting_reference:setting("diary.nightly_nasa_tlx").method_setting_id,
      criterion_label:"NASA-TLX WWL",assessment_value_json:"40.00",source_locators:["Author PDF pp8–10; independently supplied WWL, not calculated from items or a published mean"]}],source_locators:[limits]};
  return {task_occurrences:[esmPhone,esmWatch,esmComparison,nightly],
    sampled_quantity_observations:[...shared,...current,phoneOn,phoneOff,watchOff,assignment,trigger,comboG,comboH,comboX,basePolicy,deliveredPhone,deliveredWatch,...phase1Shared,...phase1Current,...comparisons,...gains]};
}
