import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParticipantDayObservationRecord, StudyMethodProfile, TaskOccurrenceRecord } from "../../src/lib/methodProfiles";
import { odimInteractionTraceExample } from "./odim-interaction-trace";

export function taskReferenceExample(profile: StudyMethodProfile) {
  const setting = (key: string): string => {
    const value = profile.method_settings.find(s => s.method_parameter_key === key);
    if (!value) throw new Error(`Missing source definition: ${key}`);
    return value.method_setting_id;
  };
  const task = (id: string, participant: string, label: string, locator: string): TaskOccurrenceRecord => ({
    task_occurrence_id: id, method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id,
    participant_id: participant, record_origin: "analyst_constructed_example", task_label: label, source_locators: [locator],
  });
  if (profile.source_work_id === "doi:10.1145/3743726") {
    const input = odimInteractionTraceExample(profile);
    input.interaction_traces[0]!.method_profile_id = profile.method_profile_id;
    input.interaction_traces[0]!.source_work_id = profile.source_work_id;
    const locator = "ODIM author PDF sha256:dcf3c9cdf7d6fe9fb916774ee0cedfcae11ccdc2fe2c93cb922815faafd7e920; pp12–13 §§5.2–5.3; constructed ratings, not source responses";
    input.interaction_traces[0]!.participant_id = "example:P1";
    const otherTrace = structuredClone(input.interaction_traces[0]!);
    otherTrace.interaction_trace_id = "example:second-trace";
    otherTrace.participant_id = "example:P2";
    input.interaction_traces.push(otherTrace);
    const tasks = input.interaction_traces.flatMap((trace, i) => {
      const usability = task(`example:usability-${i}`, `example:P${i + 1}`, "post-trace usability questionnaire", locator);
      usability.interaction_trace_reference = trace.interaction_trace_id;
      usability.task_questionnaire_responses = ["selected NASA-TLX cognitive-load response; exact item unknown", "privacy concerns about public upload", "trace representativeness"].map((property, j) => ({
        questionnaire_response_id: `answer:${j}`, questionnaire_setting_reference: setting("evaluation.post_trace_questionnaire"),
        observed_property: property, response_value_json: j === 2 ? "5.00" : "1.00", source_locators: [locator],
      }));
      const quality = task(`example:LLM-quality-${i}`, `example:P${i + 1}`, "separate evaluated LLM-description rating", locator);
      quality.interaction_trace_reference = trace.interaction_trace_id;
      quality.task_actions = [{ task_action_id: "example:review-description", action_label: "review supplied baseline description",
        action_content_json: JSON.stringify({ supplied_description: "Hypothetical baseline-generated task description; no model was run by this fixture" }), source_locators: [locator] }];
      quality.task_questionnaire_responses = [{ questionnaire_response_id: "answer:quality",
        questionnaire_setting_reference: setting("evaluation.llm_description_quality_rating"), observed_property: "quality of LLM-generated task description",
        response_value_json: "5.00", source_locators: [locator] }];
      return [usability, quality];
    });
    return { ...input, profiles: [profile], task_occurrences: tasks, participant_day_observations: [] as ParticipantDayObservationRecord[] };
  }
  if (profile.source_work_id === "doi:10.1145/2371574.2371617") {
    const locator = "Back to the App PDF sha256:1e6266084397d91b9401781431b279d6ae969012d858a90f3c84a6d1ba737c01; physical p2/printed292 Figs1–2; constructed supplied comparison, not recovered pairing, timestamps or a cognitive-task claim";
    const episode = task("example:internal-app-comparison", "example:P1", "supplied interrupted-versus-normal app comparison", locator);
    episode.task_actions = [
      ["before", "T_b", "example:app-A", 3], ["intervening", "T_i", "example:app-B", 4],
      ["after", "T_a", "example:app-A", 5], ["normal", "T_n", "example:app-A", 10],
    ].map(([id, role, app, seconds]) => ({ task_action_id: String(id), action_label: String(role), assigned_role_labels: [String(role)],
      app_identifier: String(app), denotes_interval: { duration_seconds: Number(seconds) }, source_locators: [locator] }));
    const criterion = (id: string, key: string, value: string) => ({ criterion_assessment_id: id,
      criterion_setting_reference: setting(key), criterion_label: id, assessment_value_json: value, source_locators: [locator] });
    episode.criterion_assessments = [
      { ...criterion("T_b", "measure.interrupted_runtime_components", "3.00"), support_task_action_references: ["before"] },
      { ...criterion("T_i", "measure.interrupted_runtime_components", "4.00"), support_task_action_references: ["intervening"] },
      { ...criterion("T_a", "measure.interrupted_runtime_components", "5.00"), support_task_action_references: ["after"] },
      { ...criterion("T_r", "measure.interrupted_runtime_components", "8.00"), support_task_action_references: ["before", "after"], support_criterion_assessment_references: ["T_b", "T_a"] },
      { ...criterion("T_n", "measure.normal_runtime_reference", "10.00"), support_task_action_references: ["normal"] },
      { ...criterion("T_o", "measure.signed_overhead", "-2.00"), support_criterion_assessment_references: ["T_r", "T_n"] },
    ];
    const external = structuredClone(episode);
    external.task_occurrence_id = "example:external-call-comparison";
    external.task_actions![1]!.app_identifier = "example:phone-app-C";
    external.task_actions![1]!.assigned_role_labels = ["T_i", "C"];
    const unpaired = structuredClone(episode);
    unpaired.task_occurrence_id = "example:unpaired-interruption";
    unpaired.task_label = "supplied unpaired interruption; no normal-use comparison or overhead";
    unpaired.task_actions = unpaired.task_actions!.filter(action => action.task_action_id !== "normal");
    unpaired.criterion_assessments = unpaired.criterion_assessments!.filter(assessment => !["T_n", "T_o"].includes(assessment.criterion_assessment_id));
    return { profiles: [profile], task_occurrences: [episode, external, unpaired], interaction_traces: [], referenced_artifacts: [], participant_day_observations: [] as ParticipantDayObservationRecord[] };
  }
  if (!["source-ref:e2014b2268ac2833bb8e", "doi:10.1145/3422821"].includes(profile.source_work_id)) throw new Error("Unsupported task-reference example");
  const bdi = profile.source_work_id === "doi:10.1145/3422821";
  const locator = bdi ? "doi:10.1145/3422821; publisher PDF sha256:f22f33f5bf8cf4491ec19c47d1b94bb2b592c8d6383958f19d75ab9701872aa3; pp6–7 §3.2 text315–342; constructed BDI-II values, not original participant rows"
    : "Brain Disorders medRxiv 6Oct2020 PDF sha256:0a6efad6a7640caa29ab2d65470e5369f2ad400877a854aa68535f954137f87f; extracted text524–541,652–667; constructed values, unknown subtraction orientation";
  const criterion = (id: string, key: string, label: string, value: string) => ({
    criterion_assessment_id: id, criterion_setting_reference: setting(key), criterion_label: label,
    assessment_value_json: value, source_locators: [locator],
  });
  if (bdi) {
    const episode = task("example:paired-BDI-episode", "example:P1", "week1/week16 BDI-II assessment episode", locator);
    episode.task_actions = [1, 16].map(week => ({ task_action_id: `example:week${week}`, action_label: `week${week} assessment occasion`, source_locators: [locator] }));
    episode.criterion_assessments = [
      { ...criterion("score:beginning", "ground_truth.bdi_ii", "supplied week1 total", "18.00"), support_task_action_references: ["example:week1"] },
      { ...criterion("score:end", "ground_truth.bdi_ii", "supplied week16 total", "14.00"), support_task_action_references: ["example:week16"] },
      { ...criterion("change", "outcome.change_binary", "supplied severity-level change, not score subtraction", '"did not worsen"'), support_criterion_assessment_references: ["score:beginning", "score:end"] },
      { ...criterion("severity:beginning", "ground_truth.bdi_ii", "supplied week1 severity", '"mild"'), support_criterion_assessment_references: ["score:beginning"] },
      { ...criterion("severity:end", "ground_truth.bdi_ii", "supplied week16 severity", '"mild"'), support_criterion_assessment_references: ["score:end"] },
      { ...criterion("post", "outcome.post_semester_binary", "supplied post-semester outcome", '"having depression"'), support_criterion_assessment_references: ["score:end"] },
    ];
    episode.task_questionnaire_responses = [{ questionnaire_response_id: "example:individual-item", questionnaire_setting_reference: setting("ground_truth.bdi_ii"),
      observed_property: "hypothetical individual BDI-II item answer; exact wording and item identity unknown", response_value_json: "1.00", source_locators: [locator] }];
    const other = structuredClone(episode);
    other.task_occurrence_id = "example:other-BDI-episode";
    other.criterion_assessments!.push(criterion("sibling-only", "ground_truth.bdi_ii", "separate episode score", "0.00"));
    return { profiles: [profile], task_occurrences: [episode, other], interaction_traces: [], referenced_artifacts: [], participant_day_observations: [] as ParticipantDayObservationRecord[] };
  }
  const episode = task("example:paired-PHQ-episode", "example:P1", "StudentLife beginning/end ten-week PHQ-9 assessment episode", locator);
  episode.task_actions = ["beginning", "end"].map(part => ({ task_action_id: `example:${part}`, action_label: `${part} assessment occasion`, source_locators: [locator] }));
  episode.criterion_assessments = [
    { ...criterion("score:beginning", "studentlife.outcome.phq9_schedule", "supplied beginning PHQ-9 score", "9.00"), support_task_action_references: ["example:beginning"] },
    { ...criterion("score:end", "studentlife.outcome.phq9_schedule", "supplied end PHQ-9 score", "9.00"), support_task_action_references: ["example:end"] },
    { ...criterion("change", "studentlife.monitoring.horizon", "supplied ten-week PHQ-9 change; direction unknown", "0.00"), support_criterion_assessment_references: ["score:beginning", "score:end"] },
    { ...criterion("state:beginning", "outcome.depression.phq9_threshold", "supplied beginning classification", '"not_depressed"'), support_criterion_assessment_references: ["score:beginning"] },
    { ...criterion("state:end", "outcome.depression.phq9_threshold", "supplied end classification", '"not_depressed"'), support_criterion_assessment_references: ["score:end"] },
    { ...criterion("trend:improving", "outcome.trend.improving", "supplied improving predicate", "false"), support_criterion_assessment_references: ["change"] },
    { ...criterion("trend:worsening", "outcome.trend.worsening", "supplied worsening predicate including zero", "true"), support_criterion_assessment_references: ["change"] },
  ];
  const other = structuredClone(episode);
  other.task_occurrence_id = "example:other-assessment-episode";
  other.criterion_assessments!.push(criterion("sibling-only", "studentlife.outcome.phq9_schedule", "separate episode score", "8.00"));
  const day = { method_profile_id: profile.method_profile_id, source_work_id: profile.source_work_id, participant_id: "example:P2",
    referenced_day_token: "example:supplied-day-not-a-calendar-date", day_record_origin: "analyst_constructed_example" as const, source_locators: [locator] };
  const participant_day_observations: ParticipantDayObservationRecord[] = [
    { ...day, day_observation_id: "acceleration", day_observation_kind: "objective_aggregate",
      observed_property: "supplied daily accelerometer aggregate; exact statistic and unit unrecovered", day_observation_value_json: "0.00" },
    ...["positive", "negative"].map(affect => ({ ...day, day_observation_id: `PANAS:${affect}`, day_observation_kind: "subjective_response" as const,
      observed_property: `supplied daily PANAS ${affect} affect`, day_observation_value_json: affect === "positive" ? "null" : "2.00",
      aggregate_observation_references: ["acceleration"] })),
  ];
  return { profiles: [profile], task_occurrences: [episode, other], interaction_traces: [], referenced_artifacts: [], participant_day_observations };
}

if (process.argv.includes("--emit-fixture-json")) {
  const { profiles } = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../.tmp-literature-review-private/ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: StudyMethodProfile[] };
  console.log(JSON.stringify(profiles.filter(p => ["doi:10.1145/3743726", "source-ref:e2014b2268ac2833bb8e", "doi:10.1145/3422821", "doi:10.1145/2371574.2371617"].includes(p.source_work_id)).map(taskReferenceExample)));
}
