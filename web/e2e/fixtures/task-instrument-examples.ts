import type { StudyMethodProfile, StudyMethodProfileLibrary, TaskOccurrenceRecord, TaskQuestionnaireResponseRecord } from "../../src/lib/methodProfiles";
import { boredomObservationExample, boredomRatioExample, boredomRawObservationExample } from "./temporal-observations";
import { boredomPilotHistoryExample } from "./notification-history";

// Constructed supplied records, not recovered study rows, scale codes or joins.
export function taskInstrumentExamples(profile: StudyMethodProfile): { task_occurrences: TaskOccurrenceRecord[] } & Pick<StudyMethodProfileLibrary, "participant_day_observations" | "device_use_sessions" | "notification_histories" | "screen_text_captures" | "app_feature_sessions" | "sampled_quantity_observations"> {
  const meaningful = profile.source_work_id === "doi:10.1145/3191754";
  const whyStop = profile.source_work_id === "doi:10.1145/3473856.3473881";
  const password = profile.source_work_id === "doi:10.1145/2406367.2406384";
  const sleepful = profile.source_work_id === "doi:10.1145/2470654.2481345";
  const demonic = profile.source_work_id === "doi:10.1016/j.smhl.2018.07.005";
  const jmir = profile.source_work_id === "doi:10.2196/55999";
  const loneliness = profile.source_work_id === "doi:10.2196/13209";
  const moodable = profile.source_work_id === "doi:10.1016/j.smhl.2020.100118";
  const whatsapp = profile.source_work_id === "doi:10.1186/s13104-015-1280-z";
  const recordedBehavior = profile.source_work_id === "doi:10.3390/bs5040434";
  const appMeasures = profile.source_work_id === "doi:10.4088/jcp.15m10310";
  const screenTk = profile.source_work_id === "doi:10.1145/3675094.3677547";
  const directScreenTime = profile.source_work_id === "doi:10.1371/journal.pone.0165331";
  const locator = meaningful ? "Meaningful primary098.txt exit-survey frequency item/scale; independent constructed survey, no app-instance or participant-row join"
    : whyStop ? "WhyStop author PDF pp3-8 initial/final instruments; SHA256:1d6962efd1eddeddeeb7c1dc12799dc642ef5e921f42bff8e165eababa277e22; independent constructed surveys, no original codes, scoring or learning-session join"
    : password ? "PasswordEntry primary rank347:215–236,303–345,374–410; PDF SHA256 df8423b119a070976bf9c81c31a5bc881151fef017dd72c4b31537257351bbfe"
    : sleepful ? "Sleepful pinned researchgate-method-index.json:876–900,1008–1118,1579–1586; source-index-only evidence, article bytes/alignment unavailable"
    : demonic ? "DemonicSalmon 107-codebook.txt:88–195,497–508; codebook PDF SHA256 634b81469a340eb22dcb01753e548e695d18311f0f2de65def43bed9632095c8"
    : jmir ? "JMIR55999 primary e55999.txt:174–219,548–554,570–571; supplement e55999-app1.txt:3–31; constructed supplied values, not recovered screenshots or EMA rows"
    : loneliness ? "59-loneliness.txt:263–305,469–497; constructed independent UCLA occasions, supplied answers/scores/classes; no scoring or cross-occasion matching"
    : moodable ? "Moodable rank292-primary.txt:248–257,490–517,603–611,685–689; Table 4; constructed independent Study1/Study2 occurrences and supplied values, no original join, clock, scoring or threshold execution"
    : whatsapp ? "WhatsApp rank172.txt:120–128; constructed independent BFI-10/demographic completions and dimension scores; ordinal labels are not recovered item wording; original response coding, reverse items, item-to-dimension map and scoring are not inferred"
    : recordedBehavior ? "Recorded Behavior primary134:95–148,155–167,279–294; constructed baseline weekly recalls and ordinal MPPUS answers, independent later recorded means; original German wording/reverse coding, scoring, joins and weekly denominator are not recovered"
    : screenTk ? "ScreenTK screentk-author-2024.pdf physical pp2–4/printed197–199 Figures1–3 and §4.1; PDF SHA256 ac038972eed3ea18b9539a6e3faa70c84ee6818fc87330b8039649a756226377; constructed supplied observations/reference episodes, not recovered rows, epoch conversion, content-question answers or classifier outputs"
    : appMeasures ? "App Measures lin-2017-app-measures.txt:120–174,224–248,255–309,412–438; constructed participant inputs and three separate clinician assessments; IDs and judgment strings are not recovered source codes; no consensus, scoring, EMD, timing or cross-task join inferred"
    : directScreenTime ? "Direct Measurements rank132.txt:151–162,232–291,320–321,360–368,381–390; initial eVisit battery with supplied personal/medical responses and independent BMI/instrument summaries; labels are normalized concepts, not recovered question wording/codes; original height/weight units, nine-level income/education coding and survey-to-screen-window alignment remain unreported; full deployed questionnaire wording, response serialization and item-to-component scoring are not recovered; printed PSQI ranges, component-sum total and >5 threshold are retained as definitions, not executed"
    : "Real-World Winds author PDF pp4–6 §§3–4.3.3; SHA256 bbed15c7c29445e867727cf1b34436830332ee2e936fcb4379a47c84f70edeca";
  const setting = (key: string) => {
    const found = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!found) throw new Error(`Missing actual instrument ${key}`);
    return found;
  };
  const answer = (key: string, label: string, value: string | null): TaskQuestionnaireResponseRecord => ({
    questionnaire_response_id: `example:${key}:${label}`, questionnaire_setting_reference: setting(key).method_setting_id,
    observed_property: label, response_value_json: value,
    source_locators: [locator, "Hypothetical supplied response; designation is not invented question wording or recovered storage code"],
  });
  const task = (id: string, label: string, answers: TaskQuestionnaireResponseRecord[], actions: string[] = []): TaskOccurrenceRecord => ({
    task_occurrence_id: `example:${id}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: "example:not-a-source-participant", record_origin: "analyst_constructed_example", task_label: label,
    task_questionnaire_responses: answers,
    task_actions: actions.map((label, i) => ({ task_action_id: `example:${id}:action-${i}`, action_label: label,
      source_locators: [locator, "Supplied membership/order only; no timestamps, matching or generated observations"] })),
    source_locators: [locator, "Independent constructed occurrence; no original collector schema or cross-occurrence join inferred"],
  });
  if (profile.source_work_id === "doi:10.1145/2750858.2804252") {
    const primary = "Boredom author-copy PDF SHA256:742c12c64195e69d26669765db5a91f16a63a24fef84babb9c3bcfadc559e493; pp3–5 Figure1/Tables3–4/Ground Truth, pp7–8 Borapp2; no serializer, exact ESM clock, probe/submission equivalence, BPS scoring, model execution or original row join inferred";
    const response = (key: string, property: string, value: string | null): TaskQuestionnaireResponseRecord => ({
      ...answer(key, property, value), source_locators: [...setting(key).source_locators as string[], primary],
    });
    const assessment = (id: string, key: string, label: string, value: string | null, supports?: string[]) => ({
      criterion_assessment_id: id, criterion_setting_reference: setting(key).method_setting_id, criterion_label: label,
      assessment_value_json: value, ...(supports ? { support_criterion_assessment_references: supports } : {}),
      source_locators: [...setting(key).source_locators as string[], primary, "Independent supplied value/class, not calculated from answers or other assessments"],
    });
    const occurrences = ["A", "B"].map((suffix, i) => {
      const row = task(`boredom-esm-${suffix}`, "Repeated supplied boredom self-report; no timing anchor recovered", [
        response("borapp.diary.boredom_item", "state boredom", "3"),
        response("borapp.diary.additional_items_not_analyzed", "valence (wording/scale undisclosed)", null),
        response("borapp.diary.additional_items_not_analyzed", "arousal (wording/scale undisclosed)", "null"),
      ]);
      delete row.task_actions;
      row.source_locators = [primary];
      row.criterion_assessments = [
        assessment(`example:boredom-absolute-${suffix}`, "borapp.outcome.absolute_label", "Supplied absolute label", '"bored"'),
        assessment(`example:boredom-z-${suffix}`, "borapp.outcome.normalized_label", "Supplied participant-personalized z-score", i ? "0.26" : "0.25"),
        assessment(`example:boredom-normalized-${suffix}`, "borapp.outcome.normalized_label", "Supplied normalized label", i ? '"bored"' : '"baseline"', [`example:boredom-z-${suffix}`]),
        ...(i ? [] : [assessment("example:boredom-bps-predictor-A", "borapp.participant.boredom_proneness_instrument", "Optional supplied BPS predictor", "12.00")]),
      ];
      return row;
    });
    const setup = task("boredom-setup", "Optional setup demographics", [
      response("borapp.participant.optional_demographics", "age", "29"),
      response("borapp.participant.optional_demographics", "gender", null),
      response("borapp.participant.optional_demographics", "follow-up email", "null"),
    ]);
    const bps = task("boredom-posthoc-bps", "Post-hoc BPS; ordinal designations are not recovered wording or response coding",
      Array.from({ length: 28 }, (_, i) => response("borapp.participant.boredom_proneness_instrument", `BPS item ${i + 1} (wording/scale undisclosed)`, null)));
    bps.criterion_assessments = [assessment("example:boredom-bps-score", "borapp.participant.boredom_proneness_instrument", "Independent supplied BPS score", "12.00")];
    const pilot = task("boredom-pilot-post-study", "Separate pilot post-study demographics survey; questions undisclosed", [], ["post-study demographics survey completion"]);
    pilot.participant_id = "example:pilot-not-a-source-participant"; delete pilot.task_questionnaire_responses;
    for (const row of [setup, bps, pilot]) {
      row.source_locators = [primary];
      for (const action of row.task_actions ?? []) action.source_locators = [primary];
    }
    delete setup.task_actions; delete bps.task_actions;
    const raw = boredomRawObservationExample(profile);
    return { task_occurrences: [...occurrences, setup, bps, pilot],
      notification_histories: [...boredomPilotHistoryExample(profile), ...raw.notification_histories],
      sampled_quantity_observations: [...boredomObservationExample(profile), ...boredomRatioExample(profile), ...raw.sampled_quantity_observations] };
  }
  if (profile.source_work_id === "doi:10.4000/questionsdecommunication.9851") {
    const source = "Ouakrat260.txt:192–208,319–366; primary PDF SHA256:e48ddf456c3f49f9602514188af53b380315aafa49a9e903bd1141b8ba12ebf7; constructed topic-level survey responses, not recovered questions, response codes, interview records or survey-to-log joins";
    const topics = ["sociodemographics", "equipment", "media practices", "cultural practices", "study field", "gender", "age"];
    const occurrences = ["a", "b"].map((suffix, index) => {
      const responses = topics.map((topic, column) => {
        const response = answer("survey.schema", topic, column === 6 ? String(22 + index) : column === 4 ? '"constructed:study-field"' : column === 5 ? "null" : null);
        response.source_locators = [source];
        if (column === 2) delete response.response_value_json;
        return response;
      });
      const row = task(`installed-app-survey-${suffix}`, "Independent topic-level survey occurrence; no invented inventory/day/interview join", responses);
      row.source_locators = [source]; delete row.task_actions;
      return row;
    });
    const interviewDefinition = setting("qualitative.interviews");
    const elicitation = setting("qualitative.trace_elicitation");
    const interview = task("installed-app-interview", "Independent genuine selected-participant interview and trace elicitation", [
      ...["use logic", "representations", "routines", "context"].map(topic => answer("qualitative.interviews", topic, null)),
    ]);
    interview.participant_id = "constructed:independent-interview-participant";
    interview.task_actions = [{ task_action_id: "constructed:trace-elicitation-comparison",
      action_label: "Confront interview accounts with visual representations of this participant's recorded activity",
      assigned_role_labels: ["trace elicitation comparison"],
      source_locators: [...elicitation.source_locators as string[], "Supplied interview-owned comparison occurrence, not recovered visualization or trace-to-quote IDs; no physical screenshot/hierarchy artifacts or automated alignment inferred"] }];
    interview.source_locators = [...interviewDefinition.source_locators as string[], source, "Original interview guide/transcripts/codebook and trace-visualization source are unavailable. No question wording, clock, scoring or original participant join inferred."];
    interview.task_questionnaire_responses!.forEach(response => { response.source_locators = [...interviewDefinition.source_locators as string[], "Constructed unknown topic response, not an actual interview quotation"]; });
    return { task_occurrences: [...occurrences, interview] };
  }
  if (meaningful) {
    const names = ["Getting things done or self-improvement", "Getting information", "Communicating or interacting with other people",
      "Entertainment", "Browsing social media without interacting with other people"];
    const row = task("meaningful-exit-frequency", "Independent exit-survey desired-frequency answers; no app-instance join",
      names.map((name, i) => answer("exit_survey.frequency_scale", name, i === 0 ? "3" : null)));
    delete row.task_actions;
    row.task_questionnaire_responses!.push(answer("exit_survey.technical_difficulty_item", "technical difficulties using the study app; exact question and coding undisclosed", '"example: supplied technical-difficulty description"'));
    const validity = task("meaningful-validity", "Independent typology-validity completion, three supplied descriptions and classifications",
      ["A", "B", "C"].flatMap((id, i) => [
        { ...answer("validity.task", "case " + id + " description", JSON.stringify("example: supplied description " + id)), assessment_case_token: "example:validity-case-" + id },
        { ...answer("validity.task", "case " + id + " supplied typology", JSON.stringify(i === 0 ? "Not sure" : names[i]!)), assessment_case_token: "example:validity-case-" + id },
      ]));
    const reliability = ["rater-A", "rater-B", "rater-C"].map((rater, i) => {
      const rating = task("meaningful-reliability-" + rater, "Independent reliability completion; two constructed shared case labels, not the original thirty cases",
        ["A", "B"].map((id, j) => ({ ...answer("reliability.case_sample", "supplied case classification " + id, JSON.stringify(names[(i + j) % names.length]!)),
          questionnaire_item_label: "example: same display label", assessment_case_token: "example:validity-case-" + id })));
      rating.participant_id = "example:" + rater; rating.assessor_id = "example:" + rater;
      delete rating.task_actions;
      rating.source_locators.push("Meaningful primary098.txt:339–354: independent supplied raters and typed shared case identity; equal display labels do not merge cases. Original case IDs, thirty descriptions and fully crossed response matrix were not recovered");
      return rating;
    });
    const interview = task("meaningful-exit-interview", "Independent exit interview; not an app session or a reconstructed 24-hour timeline", [
      answer("interview.part_one_topics", "what learned about smartphone use", '"example: supplied reflection"'),
      answer("interview.part_one_topics", "why types were more or less meaningful", null),
      answer("interview.part_one_topics", "desired phone-use habit changes", "null"),
      answer("interview.part_two_method", "retrospective commentary while reviewing own supplied 24-hour timeline; timeline not reconstructed", '"example: supplied commentary"'),
    ]);
    delete interview.task_questionnaire_responses![1]!.response_value_json;
    delete interview.task_actions; delete validity.task_actions;
    return { task_occurrences: [row, validity, ...reliability, interview] };
  }
  if (whyStop) {
    const initial = task("why-stop-initial", "Independent initial survey; no learning-session join", [
      answer("survey.initial_instruments", "demographics", null), answer("survey.initial_instruments", "previous ML experience", null),
      answer("survey.initial_instruments", "smartphone daily usage estimate", '"31-60"'),
      answer("survey.initial_instruments", "social-media daily usage estimate", '"15-30"'),
      answer("survey.initial_instruments", "messaging daily usage estimate", '"0-15"'),
      answer("survey.initial_instruments", "daily notification estimate", "0"),
    ]);
    const final = task("why-stop-final", "Independent final survey; no ESQ/session/submission join", [
      answer("survey.final_instruments", "app enjoyment", "5"), answer("survey.final_instruments", "learning-app user experience", "null"),
      answer("survey.final_instruments", "ESQ-app user experience", null), answer("survey.final_instruments", "learning progress", null),
      answer("survey.final_instruments", "distraction by interruption cause", null), answer("survey.final_instruments", "usual discontinuation/resumption", "null"),
      answer("survey.final_instruments", "difficulty resuming", "1"), answer("survey.final_instruments", "qualitative reasons", null),
    ]);
    delete final.task_questionnaire_responses![3]!.response_value_json;
    delete initial.task_actions; delete final.task_actions;
    return { task_occurrences: [initial, final] };
  }
  if (directScreenTime) {
    const baseline: Array<[string, string | null | undefined]> = [
      ["Age (years)", "40"], ["Sex", '"Female"'],
      ["Self-reported height; original unit unspecified", "170.00"], ["Self-reported weight; original unit unspecified", "60.00"],
      ["Selected race", '"White"'], ["Ethnicity", '"Hispanic"'],
      ["Income; original nine-level coding unspecified", null], ["Education; original nine-level coding unspecified", undefined],
      ["Alcoholic drinks per week", "2.00"], ["Smoking", '"Never"'],
      ["Atrial fibrillation", "false"], ["CAD", "null"], ["CHF", null], ["Diabetes", undefined],
      ["Hyperlipidemia", "true"], ["HTN", "false"], ["Obstructive sleep apnea", "false"],
    ];
    const responses = baseline.map(([label, value]) => {
      const response = answer("survey.baseline", label, value ?? null);
      if (value === undefined) delete response.response_value_json;
      return response;
    });
    responses.push(
      answer("covariate.derived_and_instrument", "PSQI reported sleep duration; original unit unspecified", "7.00"),
      answer("covariate.derived_and_instrument", "PSQI reported sleep quality; original response coding unspecified", "null"),
      answer("covariate.derived_and_instrument", "PSQI reported bedtime", '"example:reported-bedtime-token"'),
      answer("covariate.derived_and_instrument", "PSQI reported wake-up time", '"example:reported-wakeup-token"'),
    );
    const row = task("direct-screen-initial-evisit", "Initial online eVisit questionnaire battery; not a screen-time analysis window", responses);
    row.participant_id = "example:direct-screen-participant";
    delete row.task_actions;
    row.criterion_assessments = [
      ["bmi", "BMI (kg/m2); independently supplied, not computed from height/weight", "22.25"],
      ["phq9", "PHQ-9 depression score; independently supplied, no item scoring", "4.00"],
      ["ipaq", "IPAQ activity level; independently supplied Table1 label", '"Medium"'],
      ["psqi-total", "PSQI total; independently supplied, no component scoring", "5.00"],
      ["psqi-quality", "PSQI sleep-quality component sub-score; independently supplied", "1.00"],
      ["psqi-duration", "PSQI sleep-duration component sub-score; independently supplied", "0.00"],
      ["psqi-efficiency", "PSQI sleep-efficiency component sub-score; independently supplied", "1.00"],
      ["psqi-latency", "PSQI sleep-onset-latency component sub-score; independently supplied", "2.00"],
      ["poor-sleep", "Poor sleep, source PSQI total >5; supplied classification, not computed", "false"],
    ].map(([id, criterion_label, assessment_value_json]) => ({
      criterion_assessment_id: `example:direct-screen:${id}`, criterion_setting_reference: setting("covariate.derived_and_instrument").method_setting_id,
      criterion_label: criterion_label!, assessment_value_json,
      ...(id === "poor-sleep" ? { support_criterion_assessment_references: ["example:direct-screen:psqi-total"] } : {}), source_locators: [locator],
    }));
    row.criterion_assessments.push({ criterion_assessment_id: "example:direct-screen:race-ethnicity", criterion_setting_reference: setting("covariate.race_ethnicity").method_setting_id,
      criterion_label: "Combined race/ethnicity; independently supplied, no Hispanic-precedence calculation", assessment_value_json: '"Hispanic"', source_locators: [locator] });
    const other = structuredClone(row);
    other.task_occurrence_id = "example:direct-screen-initial-evisit-b";
    other.participant_id = "example:direct-screen-participant-b";
    other.task_questionnaire_responses![0]!.response_value_json = "41";
    other.criterion_assessments!.find(a => a.criterion_assessment_id === "example:direct-screen:phq9")!.assessment_value_json = "6.00";
    return { task_occurrences: [row, other] };
  }
  if (screenTk) {
    const tasks = (["explicit", "implicit"] as const).map(context => {
      const id = `screentk:${context}:reference`;
      const row = task(id, `First-author manual ${context} URL-click-to-reading-return reference`, [], ["Participant clicked URL in story/article", "Participant returned to original reading"]);
      row.participant_id = `example:screentk:${context}:participant`;
      row.assessor_id = "example:first-author-reviewer";
      delete row.task_questionnaire_responses;
      row.denotes_interval = { start_instant: `example:${context}:click-token`, end_instant: `example:${context}:return-token` };
      row.task_actions!.forEach((action, i) => {
        action.assigned_role_labels = [i === 0 ? "URL_CLICK" : "READING_RETURN"];
        action.denotes_interval = { start_instant: i === 0 ? row.denotes_interval!.start_instant : row.denotes_interval!.end_instant };
        action.source_locators = [locator, "Constructed supplied endpoint and role; not recovered Android event codes or inferred timestamps"];
      });
      row.criterion_assessments = [{ criterion_assessment_id: `example:${id}:manual-reference`, criterion_setting_reference: setting("ground_truth.url_click_to_reading_return_interval").method_setting_id,
        criterion_label: `Supplied manual-reference ${context} episode, not LLM classification`, support_task_action_references: row.task_actions!.map(action => action.task_action_id), source_locators: [locator] }];
      return row;
    });
    const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: tasks[0]!.participant_id,
      record_origin: "analyst_constructed_example" as const, method_setting_reference: setting("input.screen_text_observation_time_and_content").method_setting_id,
      source_locators: [locator, "Constructed identities/time ownership; no recovered CSV rows or capture-to-reference matching"] };
    return { task_occurrences: tasks, screen_text_captures: [
      { ...owner, text_capture_id: "example:screentk:capture-only", capture_instant: "13:47:16.454", screen_text: "Click here.||" },
      { ...owner, text_capture_id: "example:screentk:event-only-a", source_event_time_token: "example:unix-event-token", screen_text: "same supplied text" },
      { ...owner, text_capture_id: "example:screentk:event-only-b", source_event_time_token: "example:unix-event-token", screen_text: "same supplied text" },
      { ...owner, text_capture_id: "example:screentk:two-times", capture_instant: "example:capture-token", source_event_time_token: "example:event-token" },
      { ...owner, text_capture_id: "example:screentk:unknown-times", capture_instant: null, source_event_time_token: null, screen_text: "" },
    ] };
  }
  if (appMeasures) {
    const candidateIds = [...Array.from({ length: 12 }, (_, i) => `A${i + 1}`), "B1", "B2"];
    const clinicians = ["Live diagnostic interview", "Video review of the diagnostic interview", "Video review of the diagnostic interview"].map((action, index) => {
      const row = task(`app-measures-assessment-${index}`, "Independent clinician standard and app-incorporated assessments", [], [action]);
      row.participant_id = "example:app-measures-participant";
      row.assessor_id = `example:clinician-${index}`;
      delete row.task_questionnaire_responses;
      row.task_actions![0]!.assigned_role_labels = [index === 0 ? "live interviewer" : "video reviewer"];
      const candidates = ["standard", "app-incorporated"].flatMap(mode => candidateIds.map((id, item) => ({
        criterion_assessment_id: `example:clinician-${index}:${mode}:${id}`,
        criterion_setting_reference: setting("protocol.diagnostic_candidate_structure").method_setting_id,
        criterion_label: `${mode} ${id}; independently supplied criterion judgment`,
        assessment_value_json: JSON.stringify(mode === "app-incorporated" && id === "A3" ? "absent"
          : mode === "app-incorporated" && id === "A7" ? "present" : (item + index) % 3 === 0 ? "present" : "absent"),
        ...(mode === "app-incorporated" && (id === "A3" || id === "A7")
          ? { support_criterion_assessment_references: [`example:clinician-${index}:app-context:${id === "A3" ? "M-trend" : "frequency"}`] }
          : { support_task_action_references: [row.task_actions![0]!.task_action_id] }), source_locators: [locator],
      })));
      row.criterion_assessments = [
        ...candidates,
        { criterion_assessment_id: `example:clinician-${index}:app-context:M-trend`, criterion_setting_reference: setting("analysis.emd_trend_outputs").method_setting_id,
          criterion_label: "Independently supplied M-trend context for this assessor's app-A3; not a new measurement", assessment_value_json: "0.00", source_locators: [locator] },
        { criterion_assessment_id: `example:clinician-${index}:app-context:frequency`, criterion_setting_reference: setting("aggregation.monthly_mean_features").method_setting_id,
          criterion_label: "Independently supplied mean daily epoch count context for app-A7, prose/Table3 branch; Table1 F-trend conflict retained in definition", assessment_value_json: "69.00", source_locators: [locator] },
        ...(["standard", "app-incorporated"] as const).map((mode, modeIndex) => ({
          criterion_assessment_id: `example:clinician-${index}:${mode}:diagnosis`,
          criterion_setting_reference: setting(mode === "standard" ? "outcome.standard_diagnosis" : "outcome.app_incorporated_diagnosis").method_setting_id,
          criterion_label: `${mode} diagnosis; independent supplied judgment, not computed from criteria`,
          assessment_value_json: JSON.stringify((index + modeIndex) % 2 === 0 ? "positive" : "negative"),
          support_criterion_assessment_references: candidates.filter(candidate => candidate.criterion_assessment_id.startsWith(`example:clinician-${index}:${mode}:`)).map(candidate => candidate.criterion_assessment_id),
          support_task_action_references: [row.task_actions![0]!.task_action_id], source_locators: [locator],
        })),
      ];
      return row;
    });
    const inputs = task("app-measures-participant-inputs", "Independently supplied participant estimate and app parameters; no original clinician-record join recovered", [
      answer("protocol.app_information_for_interview", "Participant Dself: recalled daily smartphone use duration in the same supplied duration unit", "1.00"),
    ]);
    inputs.participant_id = "example:app-measures-participant";
    inputs.criterion_assessments = [
      ["protocol.app_information_for_interview", "Dapp: independent app-recorded daily use duration in the same supplied duration unit; not mean epoch length", "3.00"],
      ["protocol.app_information_for_interview", "ΔD: independently supplied difference between Dself and Dapp; direction and sign interpretation unreported", "-2.00"],
      ["aggregation.monthly_mean_features", "frequency: independent mean daily epoch count; monthly window", "69.00"],
      ["aggregation.monthly_mean_features", "duration: independent mean daily epoch length in supplied seconds; not daily total", "12.50"],
      ["aggregation.monthly_mean_features", "median: independent mean daily median epoch duration in supplied seconds", "10.00"],
      ["analysis.emd_trend_outputs", "F-trend: independent directional rate of daily epoch-count change", "0.10"],
      ["analysis.emd_trend_outputs", "D-trend: independent directional rate of daily mean-epoch-length change", "-0.25"],
      ["analysis.emd_trend_outputs", "M-trend: independent directional rate of daily median-epoch-length change in supplied seconds/day", "0.00"],
    ].map(([key, label, value], index) => ({
      criterion_assessment_id: `example:app-input-${index}`, criterion_setting_reference: setting(key!).method_setting_id,
      criterion_label: label!, assessment_value_json: value!, source_locators: [locator],
    }));
    return { task_occurrences: [...clinicians, inputs] };
  }
  if (recordedBehavior) {
    const variables = [
      ["phone_use", "weekly phone use in hours"], ["incoming_calls", "incoming calls each week"],
      ["outgoing_calls", "outgoing calls each week"], ["incoming_sms", "incoming SMS each week"],
      ["outgoing_sms", "outgoing SMS each week"],
    ] as const;
    return { task_occurrences: [0, 1].map(index => {
      const recalled = index ? ["6.00", "1.00", "0.00", "5.00", "null"] : ["3.25", "2.50", "0.00", "7.00", null];
      const recorded = index ? ["5.50", "1.25", "2.25", "4.00", "3.50"] : ["2.00", "4.25", "8.50", "11.50", "0.00"];
      const row = task(`recorded-behavior-${index}`, "Constructed baseline self-report and MPPUS with independent later recorded weekly means; original record join not recovered", [
        ...variables.map(([, label], i) => answer("collection.self_report_prompt_scope", `Before-install recalled average ${label}`, recalled[i]!)),
        ...Array.from({ length: 27 }, (_, i) => ({
          ...answer(i === 12 ? "mppus.example_item" : "mppus.instrument",
            i === 12 ? "Printed English example: I find it difficult to switch off my mobile phone; not recovered German wording" : `MPPUS ordinal item ${i + 1}; original German wording unavailable`,
            String(index ? 5 - i % 5 : 1 + i % 5)),
          questionnaire_item_label: `MPPUS item ${i + 1}`,
        })),
      ]);
      row.participant_id = `example:recorded-behavior-participant-${index}`;
      row.criterion_assessments = [
        { criterion_assessment_id: "example:mppus-total", criterion_setting_reference: setting("mppus.score_range").method_setting_id,
          criterion_label: "Independent supplied MPPUS total; no item scoring executed", assessment_value_json: index ? "70.00" : "50.00", source_locators: [locator] },
        ...variables.map(([key, label], i) => ({
          criterion_assessment_id: `example:recorded-${key}`, criterion_setting_reference: setting(`weekly.variable.${key}`).method_setting_id,
          criterion_label: `Independent later recorded mean: ${label}; retained-week denominator unknown`, assessment_value_json: recorded[i]!, source_locators: [locator],
        })),
      ];
      return row;
    }) };
  }
  if (whatsapp) {
    const dimensions = ["Extraversion", "Neuroticism", "Openness", "Agreeableness", "Conscientiousness"];
    const owner = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "example:not-a-source-participant" };
    return { task_occurrences: ["input.personality_instrument", "input.personality_items"].map((key, index) => {
      const row = task(`whatsapp-bfi-${index}`, "Independent supplied BFI-10 and demographics completion; no source questionnaire/session join recovered", [
        ...Array.from({ length: 10 }, (_, i) => ({
          ...answer(key, `BFI-10 item ${i + 1}`, String(index ? 5 - i % 5 : 1 + i % 5)),
          questionnaire_item_label: `BFI-10 item ${i + 1}`,
        })),
        answer("input.demographics", "age", index ? "30" : "29"),
        answer("input.demographics", "gender", null),
        answer("input.demographics", "education", "null"),
      ]);
      row.criterion_assessments = dimensions.map((dimension, i) => ({
        criterion_assessment_id: `example:bfi-${dimension}`, criterion_setting_reference: setting("input.personality_dimensions").method_setting_id,
        criterion_label: dimension, assessment_value_json: String(index ? 10 - 2 * i : 2 + 2 * i),
        source_locators: [locator, "Independently supplied named dimension score; no undocumented two-item assignment, reverse coding or summation"],
      }));
      return row;
    }), app_feature_sessions: [{
      ...owner, feature_session_id: "example:whatsapp-app-tuple", session_record_origin: "analyst_constructed_example", app_name: "WhatsApp",
      denotes_interval: { start_instant: "example:supplied-app-start", end_instant: "example:supplied-app-end" }, feature_occurrences: [],
      source_locators: ["rank172.txt:140–151; constructed printed app-name tuple, no package identity or inferred feature-use/phone membership"],
    }], participant_day_observations: [
      ["phone", "visual phone-session minutes", "15.00"], ["whatsapp", "WhatsApp visual-session minutes", "5.00"], ["facebook", "Facebook visual-session minutes", "0.00"],
    ].map(([id, observed_property, day_observation_value_json]) => ({
      ...owner, day_observation_id: `example:daily-${id}`, referenced_day_token: "example:supplied-retained-day",
      day_record_origin: "analyst_constructed_example", day_observation_kind: "objective_aggregate", observed_property: observed_property!,
      day_observation_value_json, evidence_unit: "minutes",
      source_locators: ["rank172.txt:140–165,170–190,276–281; constructed independent totals, no day-to-session join, expected calendar, denominator or calculation"],
    })) };
  }
  if (moodable) {
    const completions = ["a", "b"].map((occasion, index) => {
      const row = task(`moodable-phq-${occasion}`, "Independent supplied Study 2 PHQ-9 completion; prior two weeks; no original run join recovered",
        Array.from({ length: 9 }, (_, i) => ({
          ...answer("ground_truth.PHQ9", `PHQ-9 item ${i + 1}${i === 8 ? "; suicidal thoughts" : ""}`, i === 8 ? (index ? "3.00" : "2.00") : String(i % 4)),
          questionnaire_item_label: `PHQ-9 item ${i + 1}`,
        })));
      row.criterion_assessments = [
        { criterion_assessment_id: "example:moodable-phq-total", criterion_setting_reference: setting("ground_truth.PHQ9").method_setting_id,
          criterion_label: "Independently supplied PHQ-9 total", assessment_value_json: index ? "20.00" : "10.00", source_locators: [locator] },
        { criterion_assessment_id: "example:moodable-q9-score", criterion_setting_reference: setting("ground_truth.Q9").method_setting_id,
          criterion_label: "Independently supplied PHQ-9 item 9 suicidal-thoughts score", assessment_value_json: index ? "3.00" : "2.00", source_locators: [locator] },
        { criterion_assessment_id: "example:moodable-total-class", criterion_setting_reference: setting("ground_truth.total_cutoff").method_setting_id,
          criterion_label: "Independently supplied depression class at supplied cutoff 10; equality unreported", assessment_value_json: index ? '"depressed"' : "null",
          support_criterion_assessment_references: ["example:moodable-phq-total"], source_locators: [locator] },
        { criterion_assessment_id: "example:moodable-q9-class", criterion_setting_reference: setting("ground_truth.Q9").method_setting_id,
          criterion_label: "Independently supplied Q9 classification at supplied cutoff 2; no equality rule inferred", assessment_value_json: index ? '"above supplied cutoff"' : "null",
          support_criterion_assessment_references: ["example:moodable-q9-score"], source_locators: [locator] },
        { criterion_assessment_id: "example:moodable-table4-severity", criterion_setting_reference: setting("ground_truth.severity").method_setting_id,
          criterion_label: "Independently supplied Table 4 severity; not the conflicting prose grouping", assessment_value_json: index ? '"severe"' : '"moderate"',
          support_criterion_assessment_references: ["example:moodable-phq-total"], source_locators: [locator] },
        { criterion_assessment_id: "example:moodable-prose-grouping", criterion_setting_reference: setting("ground_truth.severity").method_setting_id,
          criterion_label: "Independently supplied prose grouping; not Table 4 severity", assessment_value_json: index ? '"severely depressed"' : '"mild depression"',
          support_criterion_assessment_references: ["example:moodable-phq-total"], source_locators: [locator] },
      ];
      return row;
    });
    const willingness = task("moodable-study1-willingness", "Separate Study 1 willingness response; not Study 2 contribution, availability or refusal", [
      answer("study1.response_scale", "willingness to disclose call logs", '"Somewhat Unwilling"'),
    ]);
    willingness.participant_id = "example:separate-study1-participant";
    return { task_occurrences: [...completions, willingness] };
  }
  if (loneliness) {
    const questions = [
      "How often do you feel that you are in tune with the people around you?",
      "How often do you feel that you lack companionship?",
      "How often do you feel that there is no one you can turn to?",
      "How often do you feel alone?",
      "How often do you feel part of a group of friends?",
      "How often do you feel that you have a lot in common with the people around you?",
      "How often do you feel that you are no longer close to anyone?",
      "How often do you feel that your interests and ideas are not shared by those around you?",
      "How often do you feel outgoing and friendly?",
      "How often do you feel close to people?",
      "How often do you feel left out?",
      "How often do you feel that your relationships with others are not meaningful?",
      "How often do you feel that no one really knows you well?",
      "How often do you feel isolated from others?",
      "How often do you feel you can find companionship when you want it?",
      "How often do you feel that there are people who really understand you?",
      "How often do you feel shy?",
      "How often do you feel that people are around you but not with you?",
      "How often do you feel that there are people you can talk to?",
      "How often do you feel that there are people you can turn to?",
    ];
    const completions = ["presemester", "postsemester"].map((occasion, index) => {
      const row = task(`loneliness-${occasion}`, `Independent ${occasion} UCLA completion`, questions.map((question, i) => {
        const response: TaskQuestionnaireResponseRecord = {
          ...answer("survey.instrument", question, i === 17 ? null : i === 19 ? "null" : index ? "3.00" : "2.00"),
          questionnaire_item_label: question,
        };
        if (i === 18) delete response.response_value_json;
        return response;
      }));
      row.criterion_assessments = [
        { criterion_assessment_id: "example:loneliness-total", criterion_setting_reference: setting("survey.total_score").method_setting_id,
          criterion_label: "Independently supplied UCLA total", assessment_value_json: index ? "41.00" : "40.00", source_locators: [locator] },
        { criterion_assessment_id: "example:loneliness-class", criterion_setting_reference: setting("outcome.binary_loneliness").method_setting_id,
          criterion_label: "Independently supplied loneliness class", assessment_value_json: index ? '"high"' : '"low"', source_locators: [locator] },
      ];
      return row;
    });
    const comparison = task("loneliness-comparison", "Independent supplied pre/post loneliness-class comparison", []);
    comparison.criterion_assessments = [
      { criterion_assessment_id: "example:loneliness-class-presemester", criterion_setting_reference: setting("outcome.binary_loneliness").method_setting_id,
        criterion_label: "Supplied presemester class copy; no cross-task match", assessment_value_json: '"low"', source_locators: [locator] },
      { criterion_assessment_id: "example:loneliness-class-postsemester", criterion_setting_reference: setting("outcome.binary_loneliness").method_setting_id,
        criterion_label: "Supplied postsemester class copy; no cross-task match", assessment_value_json: '"high"', source_locators: [locator] },
      { criterion_assessment_id: "example:loneliness-change", criterion_setting_reference: setting("outcome.level_change").method_setting_id,
        criterion_label: "Supplied class change, not score difference", assessment_value_json: '"increased"',
        support_criterion_assessment_references: ["example:loneliness-class-presemester", "example:loneliness-class-postsemester"], source_locators: [locator] },
    ];
    return { task_occurrences: [...completions, comparison] };
  }
  if (jmir) {
    const questions = [
      "Life is not worth living for me", "There are more reasons to die than to live", "I want to die", "I think about taking my life",
      "Considered a specific suicide method", "Identified how to acquire your suicide method", "Made other preparations for your death",
      "How strong is your urge to make a suicide attempt?", "How intense is your desire to kill yourself?",
    ];
    const completions = ["a", "b"].map(id => {
      const row = task(`jmir-${id}`, "Independent EMA completion; momentary and since-last-prompt groups retain distinct source contexts",
        [
          ...questions.map(question => ({ ...answer("ema.suicide", question, ' "supplied response; source numeric coding undisclosed" '), questionnaire_item_label: question })),
          ...["positive", "negative"].flatMap(group => Array.from({ length: 10 }, (_, i) => answer("ema.affect", `PANAS ${group} item ${i + 1}; wording not supplied in appendix`, "null"))),
          ...["useless", "like a burden for others", "like I do not belong", "lonely"].map(label => answer("ema.theoretical", `momentary: ${label}`, '"supplied 5-point response; code unknown"')),
          answer("ema.theoretical", "interpersonal conflict or interpersonally stressful situation since the last prompt", '"present"'),
          ...["drink alcohol", "use drugs", "harm oneself or self-injury without the intent to die"].map(label => answer("ema.empirical", `current urge to ${label}`, '"supplied 5-point response; code unknown"')),
        ]);
      row.criterion_assessments = ["suicidal ideation", "suicidal planning", "suicidal desire"].map((label, index) => ({
        criterion_assessment_id: `example:sum-${index}`, criterion_setting_reference: setting("ema.suicide").method_setting_id,
        criterion_label: `${label} sum`, assessment_value_json: id === "a" ? "4.00" : "null",
        source_locators: [locator, "Independently supplied hypothetical group sum; no response-code decoding or sum calculation at import"],
      }));
      row.criterion_assessments.push({
        criterion_assessment_id: "example:ideation-percentile", criterion_setting_reference: setting("ema.percentile").method_setting_id,
        criterion_label: "Supplied ideation at-or-above person-specific empirical 90th percentile indicator", assessment_value_json: "true",
        support_criterion_assessment_references: ["example:sum-0"],
        source_locators: [locator, "Independent supplied flag; no percentile estimator, sample membership or threshold calculation inferred"],
      });
      return row;
    });
    const daily = [
      task("jmir-first-prompt", "First EMA prompt of the day; supplied sleep responses", [
        answer("ema.daily", "sleep time", '"opaque supplied sleep-time token"'),
        answer("ema.daily", "wake time", '"opaque supplied wake-time token"'),
        answer("ema.daily", "presence of nightmares", '"absent"'),
        answer("ema.daily", "subjective quality of sleep", '"supplied 5-point response; code unknown"'),
      ], ["First EMA prompt of supplied day"]),
      task("jmir-last-prompt", "Last EMA prompt of the day; supplied behaviour and pain responses", [
        answer("ema.daily", "presence of alcohol use", '"present"'),
        answer("ema.daily", "presence of self-injury", '"absent"'),
        answer("ema.daily", "physical pain across the day", "26.80"),
      ], ["Last EMA prompt of supplied day"]),
    ];
    daily.forEach(row => { row.referenced_day_token = "example:supplied-day"; });
    return { task_occurrences: [...completions, ...daily],
      screen_text_captures: ["a", "b"].map(id => ({
        text_capture_id: `example:ocr-${id}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
        participant_id: completions[0]!.participant_id, record_origin: "analyst_constructed_example",
        method_setting_reference: setting("text.ocr").method_setting_id,
        screen_text: " equal supplied text token\n", source_locators: [locator, "No original image ID, capture clock, text-node rectangles or contributor join disclosed"],
      })),
      participant_day_observations: [
        ["component", "LIWC component score", "LIWC: affect", "4.00", "text.daily_scores", "day"],
        ["ratio", "LIWC daily component display ratio", "LIWC: affect", "0.25", "text.daily_scores", "day"],
        ["count", "custom dictionary word count", "custom substances dictionary", "2", "text.daily_scores", "day"],
        ["social", "daily aggregate predicted social-use probability", "ResNet18, not app identity or binary classification", "0.65", "social.application", "day"],
        ["screenshots", "screenshot count", "phone use", "720", "comparison.phone_use", "day"],
        ["intervals", "five-second screenshot interval count", "phone use", "360", "comparison.hour_reference", "hour"],
        ["percentage", "percentage of hour used", "phone use", "50.00", "comparison.hour_reference", "hour"],
      ].map(([id, property, category, value, key, period]) => ({
        day_observation_id: `example:${id}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
        participant_id: completions[0]!.participant_id,
        ...(period === "hour" ? { referenced_hour_token: "example:supplied-hour" } : { referenced_day_token: "example:supplied-day" }),
        day_record_origin: "analyst_constructed_example", day_observation_kind: "objective_aggregate", observed_property: property!,
        observation_category: category, day_observation_value_json: value,
        source_locators: [locator, `${setting(key!).method_setting_id}; independent supplied day/hour quantity, no image/text contributor set or timing inferred`],
      })),
    };
  }
  if (password) {
    const pssuq = task("pssuq", "Desktop PSSUQ after the five-password task; no per-password questionnaire join inferred", [
      answer("usability.pssuq", "PSSUQ item 1 rating", "6"),
      answer("usability.pssuq", "PSSUQ item 2 explicit no-answer option", '"no answer"'),
      answer("usability.pssuq", "PSSUQ item 2 comment", ' "example supplied comment" '),
    ]);
    pssuq.device_id = "example:desktop-questionnaire-computer";
    pssuq.task_questionnaire_responses![0]!.questionnaire_item_label = "PSSUQ item 1";
    pssuq.task_questionnaire_responses![1]!.questionnaire_item_label = "PSSUQ item 2";
    pssuq.task_questionnaire_responses![2]!.questionnaire_item_label = "PSSUQ item 2";
    const entry = task("entry-questionnaire", "Separate desktop entry questionnaire", [
      answer("study.entry_questionnaire", "multitouch experience", "3"),
      answer("study.entry_questionnaire", "primary phone brand/model", "null"),
    ]);
    entry.device_id = pssuq.device_id;
    const attempt = task("password-attempt", "Separate Android-Vanilla password-entry attempt; partial supplied action membership", [], [
      "Target presentation", "First character entered", "Mistyped character entered", "Correction", "Last character entered", "Send",
    ]);
    attempt.device_id = "example:assigned-android-phone";
    attempt.task_actions![0]!.assigned_role_labels = ["supplied target", "printed password pattern"];
    attempt.task_actions![0]!.action_content_json = ' {"pattern":"z00Z2z3","target":"a12B@c€"} ';
    attempt.task_actions![1]!.assigned_role_labels = ["first character", "entry-time start"];
    attempt.task_actions![1]!.action_content_json = '{"character":"a","timestamp":"opaque-first-key-token"}';
    attempt.task_actions![2]!.action_content_json = '{"character":"X","timestamp":"opaque-mistyped-key-token"}';
    attempt.task_actions![3]!.action_content_json = '{"timestamp":"opaque-correction-token"}';
    attempt.task_actions![4]!.assigned_role_labels = ["last character", "entry-time end"];
    attempt.task_actions![4]!.action_content_json = '{"character":"€","timestamp":"opaque-last-key-token"}';
    attempt.task_actions![5]!.assigned_role_labels = ["submit", "not entry-time end"];
    attempt.task_actions![5]!.action_content_json = '{"timestamp":"opaque-send-token"}';
    attempt.criterion_assessments = [{
      criterion_assessment_id: "example:entry-time", criterion_setting_reference: setting("usability.entry_time").method_setting_id,
      criterion_label: "Supplied first-to-last-character entry time (milliseconds)", assessment_value_json: "1200.00",
      support_task_action_references: [attempt.task_actions![1]!.task_action_id, attempt.task_actions![4]!.task_action_id],
      source_locators: [locator, "Constructed supplied duration, not computed from unknown original timestamps; Send is not the endpoint"],
    }];
    const shoulder = task("shoulder-attempt", "Observer's password-reproduction attempts for supplied target sunshine", [], [
      "Experimenter-as-victim types the supplied target", "Observer finishes notes", "Observer guess 1", "Observer guess 2",
    ]);
    shoulder.task_actions![0]!.assigned_role_labels = ["experimenter-as-victim", "target presentation"];
    shoulder.task_actions![0]!.action_content_json = '"sunshine"';
    shoulder.task_actions![2]!.assigned_role_labels = ["participant-as-observer", "guess 1"];
    shoulder.task_actions![2]!.action_content_json = '"sunshins"';
    shoulder.task_actions![3]!.assigned_role_labels = ["participant-as-observer", "guess 2"];
    shoulder.task_actions![3]!.action_content_json = '"sunshine"';
    shoulder.criterion_assessments = [
      { criterion_assessment_id: "example:guess-distance", criterion_setting_reference: setting("shoulder.success_metric").method_setting_id,
        criterion_label: "Supplied Levenshtein distance for guess 1", assessment_value_json: "1",
        support_task_action_references: [shoulder.task_actions![0]!.task_action_id, shoulder.task_actions![2]!.task_action_id], source_locators: [locator] },
      { criterion_assessment_id: "example:selected-distance", criterion_setting_reference: setting("shoulder.best_attempt").method_setting_id,
        criterion_label: "Supplied best-attempt distance; independently identified selected guess", assessment_value_json: "0",
        support_task_action_references: [shoulder.task_actions![3]!.task_action_id], source_locators: [locator, "PasswordEntry primary rank347:506–517; at most three attempts; no missing third guess manufactured or selection run at import"] },
    ];
    return { task_occurrences: [pssuq, entry, attempt,
      task("shoulder-before", "Observer perception before shoulder surfing", [answer("shoulder.perception", "before: item 1", "5")]),
      shoulder,
      task("shoulder-after", "Observer post-experiment perception and strategy", [
        answer("shoulder.perception", "after: item 1", "4"),
        answer("shoulder.strategy_questionnaire", "focus on virtual keyboard", "null"),
        answer("shoulder.strategy_questionnaire", "comment", '"example strategy comment"'),
      ]),
    ] };
  }
  if (sleepful) {
    const night = task("night-recording", "Supplied night activity; partial observations do not classify sleep or missed responses", [], [
      "Start Recording Sleep button", "In bed", "App-emitted tone", "Touch screen", "App-emitted tone", "Out of bed",
    ]);
    const actionKeys = ["collector.manual_recording_start", "schema.bed_status_toggle", "collector.tone_duration", "schema.tone_response", "collector.tone_duration", "schema.bed_status_toggle"];
    night.task_actions!.forEach((action, i) => {
      const definition = setting(actionKeys[i]!);
      action.source_locators.push(`${definition.method_setting_id} ${String(definition.method_parameter_key)}; pinned index:853–891`);
    });
    return { task_occurrences: [
    task("initial-battery", "Initial eight-task familiarization battery followed by TLX", [
      answer("study1.nasa_tlx", "TLX supplied response with undisclosed item/scale", '"example supplied TLX response"'),
    ], ["Familiarization task 1", "Familiarization task 2", "Familiarization task 3", "Familiarization task 4", "Familiarization task 5", "Familiarization task 6", "Familiarization task 7", "Familiarization task 8"]),
    task("post-week", "Separate post-week CSUQ debrief", [
      answer("study1.csuq", "CSUQ supplied response with undisclosed item/scale", '"example supplied CSUQ response"'),
    ]),
    task("personal-details", "Separate Study 1 personal details", [answer("study1.personal_details", "bed-partner status", "null")]),
    task("daily-diary", "Independently supplied Study 1 daily diary completion", [
      answer("study1.daily_sleep_diary", "sleep onset latency", '"example supplied value; unit unspecified"'),
      answer("study1.daily_sleep_diary", "comments", '"example diary comment"'),
    ]),
    task("study2-psqi", "Separate Study 2 PSQI completion", [answer("study2.psqi", "supplied PSQI response, not the cohort range", "null")]),
    task("study2-diary", "Separate Study 2 standard sleep diary; exact fields undisclosed", [answer("study2.sleep_diary", "supplied diary response; field unspecified", "null")]),
    night,
  ], participant_day_observations: [
    ["sleepful-se", "objective_aggregate", "sleep efficiency", "Sleepful", "80.00", "feature.sleepful_sleep_efficiency"],
    ["actiwatch-se", "objective_aggregate", "sleep efficiency", "Actiwatch", "85", "feature.actiwatch_sleep_efficiency"],
    ["diary-quality", "subjective_response", "subjective sleep quality", "diary", '"example supplied diary value"', "study1.daily_sleep_diary"],
    ["diary-comments", "subjective_response", "comments", "diary", "null", "study1.daily_sleep_diary"],
  ].map(([id, kind, property, category, value, key]) => ({
    day_observation_id: `example:${id}`, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: night.participant_id, referenced_day_token: "example:supplied-day-not-derived-from-night",
    day_record_origin: "analyst_constructed_example", day_observation_kind: kind as "objective_aggregate" | "subjective_response",
    observed_property: property!, observation_category: category, day_observation_value_json: value,
    ...(kind === "objective_aggregate" ? { evidence_unit: "percent" } : {}),
    source_locators: [locator, `${setting(key!).method_setting_id} ${key}; pinned index:1023–1048,1122–1131`, "Hypothetical participant value, not a cohort mean; no inferred cross-record joins"],
  })) };
  }
  if (demonic) {
    const choices: Record<string, string> = {
      RT4: '["changing your perspective on something","trying to distract yourself from thoughts/feelings"]',
      RT6: '["positive things about myself"]', RT9: '"2-4"',
      RT10: '{"choices":["other"],"optional_input":"example supplied description"}',
      AC1: '"close friend"', AC6: '["to seek social support","to get a different perspective on something"]',
    };
    const completions = ([ ["ema.rt_schema", "RT", 12], ["ema.eod_schema", "EOD", 16], ["ema.after_call_schema", "AC", 10] ] as const).map(([key, prefix, count]) => {
      const row = task(`demonic-${prefix}-a`, `${prefix} questionnaire completion; answers retain the printed retrospective/current/forecast referents`,
        Array.from({ length: count }, (_, i) => ({ ...answer(key, `${prefix}${i + 1}`, choices[`${prefix}${i + 1}`] ?? "50.25"), questionnaire_item_label: `${prefix}${i + 1}` })),
        prefix === "AC" ? ["Supplied call context; not a reconstructed disconnect", "Initial prompt", "Later answering"] : ["Initial prompt", "Later answering"]);
      row.task_actions!.forEach((action, i) => {
        action.action_content_json = JSON.stringify({ supplied_time_token: `opaque-${prefix}-a-${i}` });
        action.source_locators = [locator, "Constructed opaque time tokens; no clock, elapsed duration, call-trigger lifecycle or raw-log join inferred"];
      });
      if (prefix === "EOD") row.referenced_day_token = "example:EOD-referenced-day";
      return row;
    });
    const secondCall = structuredClone(completions[2]!);
    secondCall.task_occurrence_id = "example:demonic-AC-b";
    secondCall.task_label = "Independent AC completion and call context; partial supplied answers";
    secondCall.task_actions!.forEach((action, i) => {
      action.task_action_id = `example:demonic-AC-b:action-${i}`;
      action.action_content_json = JSON.stringify({ supplied_time_token: `opaque-AC-b-${i}` });
    });
    secondCall.task_questionnaire_responses = secondCall.task_questionnaire_responses!.slice(0, 5);
    secondCall.task_questionnaire_responses[1]!.response_value_json = "0.00";
    secondCall.task_questionnaire_responses[2]!.response_value_json = null;
    delete secondCall.task_questionnaire_responses[3]!.response_value_json;
    return { task_occurrences: [...completions, secondCall] };
  }
  if (profile.source_work_id !== "doi:10.1145/3613904.3642583") throw new Error("No source-shaped instrument example for this profile");
  const rowAnswers = (key: string) => {
    const value = JSON.parse(String(setting(key).method_value_json)) as { definition: { rows: string[][] } };
    return value.definition.rows.map(row => answer(key, `${row[0]} ${row[1]}`, "3"));
  };
  const snooze = task("global-snooze", "User-activated global snooze, independent of any challenge", [], ["Activate snooze via main-screen floating button"]);
  snooze.denotes_interval = { duration_seconds: 600 };
  snooze.source_locators.push(`${setting("snooze.user_activation").method_setting_id}; ${setting("snooze.user_duration").method_setting_id}; ${setting("snooze.suppression_effect").method_setting_id}; ${setting("log.snooze_timer").method_setting_id}`, "Constructed supplied duration, not a disclosed default, option or maximum; PDFp5 §3");
  return { task_occurrences: [
    task("manual-challenge-a", "Manually requested challenge A, completion questionnaire", [
      ...rowAnswers("survey.Complete_ES_items"), answer("study.self_report_location", "self-reported location after completion", '"at home"'),
    ], ["Request via A1", "Opened", "Completed"]),
    task("manual-challenge-b", "Independent manually requested challenge B", [
      answer("survey.Complete_ES_items", "Q32 Balance", "2"), answer("study.self_report_location", "self-reported location after completion", '"outside"'),
    ], ["Request via A1", "Opened", "Completed"]),
    task("four-point-balance", "Separate four-point balance disclosure; relationship to five-point Q32 unknown", [
      answer("survey.balance_four_point_statement", "life-technology balance", '"very balanced"'),
    ]),
    task("pre-study", "Pre-deployment life-smartphone balance questionnaire", rowAnswers("survey.pre_post_LSB_items")),
    task("post-study", "Separate post-week questionnaire", [
      ...rowAnswers("survey.pre_post_LSB_items"), ...rowAnswers("survey.post_effectiveness_items"), ...rowAnswers("survey.post_enjoyment_items"),
      answer("survey.post_category_rank_protocol", "effectiveness in establishing balance: supplied first place", '"example supplied category"'),
      answer("survey.post_category_rank_protocol", "first-place justification", '"example supplied justification"'),
      answer("study.sus_and_timing", "SUS supplied item response; item count and codes unknown", "null"),
      answer("study.sus_and_timing", "Q29 appropriateness of notification timing", "3"),
      answer("survey.post_open_feedback", "further comments and findings about study", '"example supplied feedback"'),
    ]),
    task("cancel", "Separate cancelled challenge", [answer("study.cancel_exchange_reasons", "Cancel offered reason", '"Other"')], ["Cancel"]),
    task("exchange", "Separate exchanged challenge", [answer("study.cancel_exchange_reasons", "Exchange offered reason", '"Other"')], ["Exchange"]),
    snooze,
  ], device_use_sessions: [{
    device_use_session_id: "example:phone-session", method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: snooze.participant_id, record_origin: "analyst_constructed_example",
    method_setting_reference: setting("session.lock_unlock_duration").method_setting_id, denotes_interval: { duration_seconds: 125 },
    session_actions: ["example.app.a", "example.app.b"].map((app, i) => ({
      task_action_id: `example:membership-${i}`, app_identifier: app, action_label: "Supplied app used within session",
      source_locators: [locator, `${setting("collector.within_session_apps").method_setting_id}; PDFp5 §3 Additional Functionality`, "Supplied membership only, not recovered UsageStats callbacks or a complete ordered launch stream"],
    })),
    source_locators: [locator, "Hypothetical supplied duration; no endpoint vocabulary, pairing or clock inferred"],
  }], notification_histories: [{
    notification_history_id: "example:automatic-challenge", method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: snooze.participant_id, history_record_origin: "analyst_constructed_example", notification_item_id: "example:notification-item",
    notification_evidence: [
      { evidence_record_id: "example:arrival", evidence_kind: "arrival", evidence_role: "recorded", source_locators: [locator, "PDFp4 §3 automatic overload-challenge notification"] },
      ...["Added", "Opened", "Reply/complete"].map((action, i) => ({
        evidence_record_id: `example:automatic-action-${i}`, evidence_kind: "action_occurrence" as const, evidence_role: "recorded" as const,
        action_kind: action, evidence_instant: `opaque-supplied-challenge-time-${i}`, evidence_references: ["example:arrival"],
        ...(i === 2 ? { evidence_value_json: '"example participant reply"', evidence_basis: "Participant reply/self-reported completion, not verified physical execution" } : {}),
        source_locators: [locator, "PDFp6 §4.3.1 logged challenge actions; constructed supplied membership"],
      })),
      { evidence_record_id: "example:category", evidence_kind: "category", evidence_role: "recorded", evidence_value_json: '"relaxation"', source_locators: [locator, `${setting("log.challenge_category").method_setting_id}`] },
    ],
    source_locators: [locator, "Constructed supplied automatic-notification item, distinct from manual requests and global snooze; no trigger execution or original identifier inferred"],
  }] };
}
