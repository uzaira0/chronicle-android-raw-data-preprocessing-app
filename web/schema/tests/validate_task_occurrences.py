#!/usr/bin/env python3
"""Same constructed example as real ingress/GUI; no source-row or scoring claim."""
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator
from pydantic import ValidationError

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "generated/pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    TaskOccurrenceRecord, TaskActionRecord, TaskCriterionAssessmentRecord,
    TaskQuestionnaireResponseRecord, TaskObservationWindowRecord, SampledQuantityRecord, NotificationQuestionnaireResponseRecord,
    InteractionTraceRecord, AppFeatureSessionRecord, ParticipantDayObservationRecord, SampledQuantityObservationRecord, ScreenTextCaptureRecord,
)

schema = json.loads((root / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
records = json.loads((root.parent / "e2e/fixtures/s-adl-task-example.json.fixture").read_text())["task_occurrences"]

def validator(cls):
    return Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": schema["$defs"]})

def preserved(cls, row):
    validator(cls).validate(row)
    assert cls(**row).model_dump(exclude_unset=True) == row

for row in records:
    preserved(TaskOccurrenceRecord, row)
    for member in row.get("task_actions") or []:
        preserved(TaskActionRecord, member)
    for assessment in row.get("criterion_assessments") or []:
        preserved(TaskCriterionAssessmentRecord, assessment)

task = records[0]
for assessor in [None, "example:independent-clinician"]:
    assessed = {**task, "assessor_id": assessor}
    preserved(TaskOccurrenceRecord, assessed)
    assert assessed["participant_id"] == task["participant_id"]
for assessor in ["", " ", 0, False, {}, []]:
    invalid = {**task, "assessor_id": assessor}
    assert not validator(TaskOccurrenceRecord).is_valid(invalid)
    try:
        TaskOccurrenceRecord(**invalid)
    except ValidationError:
        pass
    else:
        raise AssertionError("Malformed assessor identity must not be coerced")
for old in [InteractionTraceRecord, AppFeatureSessionRecord, ParticipantDayObservationRecord]:
    assert not validator(old).is_valid(task), f"{old.__name__} is not the populated task relation"
swapped = deepcopy(task)
swapped["criterion_assessments"][0]["support_task_action_references"] = ["example:call"]
swapped["criterion_assessments"][1]["support_task_action_references"] = ["example:registration"]
preserved(TaskOccurrenceRecord, swapped)
assert swapped != task
assert swapped["task_actions"] == task["task_actions"]
for cls, row, fields in [
    (TaskOccurrenceRecord, task, ["task_actions", "criterion_assessments", "denotes_interval", "expected_script_setting_reference"]),
    (TaskActionRecord, task["task_actions"][0], ["denotes_interval", "assigned_role_labels", "action_content_json"]),
    (TaskCriterionAssessmentRecord, task["criterion_assessments"][0], ["assessment_value_json", "assessment_content_json", "support_task_action_references"]),
]:
    for field in fields:
        for value in [None, "omitted"]:
            variant = deepcopy(row)
            if value is None:
                variant[field] = None
            else:
                variant.pop(field, None)
            preserved(cls, variant)
for cls, row, field in [
    (TaskOccurrenceRecord, task, "task_occurrence_id"),
    (TaskOccurrenceRecord, task, "task_label"),
    (TaskActionRecord, task["task_actions"][0], "task_action_id"),
    (TaskCriterionAssessmentRecord, task["criterion_assessments"][0], "criterion_label"),
    (TaskCriterionAssessmentRecord, task["criterion_assessments"][0], "criterion_setting_reference"),
]:
    invalid = deepcopy(row)
    invalid.pop(field)
    assert not validator(cls).is_valid(invalid)
invalid = deepcopy(task)
invalid["computed_score"] = 1
assert not validator(TaskOccurrenceRecord).is_valid(invalid)
oh_tasks = json.loads((root.parent / "e2e/fixtures/oh-app-task-example.json.fixture").read_text())["task_occurrences"]
for row in oh_tasks:
    preserved(TaskOccurrenceRecord, row)
    for response in row.get("task_questionnaire_responses") or []:
        preserved(TaskQuestionnaireResponseRecord, response)
answer = oh_tasks[2]["task_questionnaire_responses"][0]
assert not validator(NotificationQuestionnaireResponseRecord).is_valid(answer)
assert not validator(TaskCriterionAssessmentRecord).is_valid(answer)
for field in ["questionnaire_item_label", "response_value_json"]:
    for omitted in [False, True]:
        variant = deepcopy(answer)
        if omitted:
            variant.pop(field, None)
        else:
            variant[field] = None
        preserved(TaskQuestionnaireResponseRecord, variant)
for state in [None, []]:
    variant = deepcopy(oh_tasks[2])
    variant["task_questionnaire_responses"] = state
    preserved(TaskOccurrenceRecord, variant)
for field in ["questionnaire_response_id", "questionnaire_setting_reference", "observed_property", "source_locators"]:
    invalid = deepcopy(answer)
    invalid.pop(field)
    assert not validator(TaskQuestionnaireResponseRecord).is_valid(invalid)
invalid = deepcopy(answer)
invalid["navigation_trial_reference"] = "example:dock-navigation"
assert not validator(TaskQuestionnaireResponseRecord).is_valid(invalid)
questionnaire_tasks = json.loads((root.parent / "e2e/fixtures/task-questionnaire-examples.json.fixture").read_text())["task_occurrences"]
for row in questionnaire_tasks:
    preserved(TaskOccurrenceRecord, row)
    for response in row.get("task_questionnaire_responses") or []:
        preserved(TaskQuestionnaireResponseRecord, response)
habitual_tasks = json.loads((root.parent / "e2e/fixtures/habitual-association-example.json.fixture").read_text())["task_occurrences"]
for row in habitual_tasks:
    preserved(TaskOccurrenceRecord, row)
    for action in row.get("task_actions") or []:
        preserved(TaskActionRecord, action)
    for response in row.get("task_questionnaire_responses") or []:
        preserved(TaskQuestionnaireResponseRecord, response)
assert len(habitual_tasks) == 8
print("Habitual generated shapes: distinct habit workflows/actions, historical per-habit ratings/debrief and final participant feedback preserved")
print("task generated shapes: S-ADL, Oh, categorical session and condition-instrument answers preserve references and null/omission; incompatible carriers and required/unknown-field negatives reject; semantic/local links checked by real ingress")
window_tasks = [row for name in ["response-window-examples", "pvt-window-example", "assessment-window-examples"]
                for row in json.loads((root.parent / f"e2e/fixtures/{name}.json.fixture").read_text())["task_occurrences"]]
for row in window_tasks:
    preserved(TaskOccurrenceRecord, row)
    for assessment in row.get("criterion_assessments") or []:
        preserved(TaskCriterionAssessmentRecord, assessment)
    for response in row.get("task_questionnaire_responses") or []:
        preserved(TaskQuestionnaireResponseRecord, response)
    for window in row.get("task_observation_windows") or []:
        preserved(TaskObservationWindowRecord, window)
        for quantity in window.get("quantities") or []:
            preserved(SampledQuantityRecord, quantity)
        for field in ["questionnaire_response_references", "screen_text_capture_references", "anchor_task_action_reference", "denotes_interval", "quantities"]:
            for omitted in [False, True]:
                variant = deepcopy(window)
                if omitted:
                    variant.pop(field, None)
                else:
                    variant[field] = None
                preserved(TaskObservationWindowRecord, variant)
        # Source-qualified anchor requirements are enforced by the real importer;
        # the generated structure preserves STDD unknown/null anchors.
        for field in ["observation_window_id", "window_setting_references", "source_locators"]:
            invalid = deepcopy(window)
            invalid.pop(field)
            assert not validator(TaskObservationWindowRecord).is_valid(invalid)
        invalid = deepcopy(window)
        invalid["inferred_anchor_timestamp"] = "invented"
        assert not validator(TaskObservationWindowRecord).is_valid(invalid)
window_family = json.loads((root.parent / "e2e/fixtures/assessment-window-examples.json.fixture").read_text())
for row in window_family["sampled_quantity_observations"]:
    preserved(SampledQuantityObservationRecord, row)
for row in window_family["screen_text_captures"]:
    preserved(ScreenTextCaptureRecord, row)
metric = next(row for row in window_family["sampled_quantity_observations"] if row.get("screen_text_capture_references"))
for refs in [None, [], "omitted"]:
    variant = deepcopy(metric)
    if refs == "omitted":
        variant.pop("screen_text_capture_references")
    else:
        variant["screen_text_capture_references"] = refs
    preserved(SampledQuantityObservationRecord, variant)
for refs in [0, False, {}, [None], [0]]:
    invalid = deepcopy(metric)
    invalid["screen_text_capture_references"] = refs
    assert not validator(SampledQuantityObservationRecord).is_valid(invalid)
group = next(row for row in window_family["sampled_quantity_observations"] if row["observed_entity_kind"] == "participant_group")
preserved(SampledQuantityObservationRecord, group)
invalid = {**group, "observed_entity_kind": "fabricated participant"}
assert not validator(SampledQuantityObservationRecord).is_valid(invalid)
for value in [0, False, {}, [None], [0]]:
    invalid = deepcopy(window_tasks[0]["task_observation_windows"][0])
    invalid["screen_text_capture_references"] = value
    assert not validator(TaskObservationWindowRecord).is_valid(invalid)
nightlife = next(row for row in window_tasks if row["source_work_id"] == "doi:10.1177/00936502241276793")
for omitted in [False, True]:
    variant = deepcopy(nightlife)
    if omitted:
        variant.pop("referenced_day_token")
    else:
        variant["referenced_day_token"] = None
    preserved(TaskOccurrenceRecord, variant)
for wrong in [0, False, [], {}]:
    invalid = deepcopy(nightlife)
    invalid["referenced_day_token"] = wrong
    assert not validator(TaskOccurrenceRecord).is_valid(invalid)
    try:
        TaskOccurrenceRecord(**invalid)
    except ValidationError:
        pass
    else:
        raise AssertionError(f"task day token accepted {wrong!r}")
for row in json.loads((root.parent / "e2e/fixtures/assessment-window-examples.json.fixture").read_text())["participant_day_observations"]:
    preserved(ParticipantDayObservationRecord, row)
print("task observation-window shapes: PAM/Emotion, PVT, PHQ, tutorial and Digital Nightlife fixtures preserve answers/assessments, local references, quantities, response day and unknown endpoints; calendar-completed output remains distinct; real ingress checks source compatibility and local membership")

examples = json.loads(subprocess.check_output([
    "node", "scripts/run-clean-env.mjs", "./node_modules/.bin/vite-node",
    "e2e/fixtures/task-reference-examples.ts", "--emit-fixture-json",
], cwd=root.parent, text=True))
assert len(examples) == 4
odim = next(e for e in examples if e["profiles"][0]["source_work_id"] == "doi:10.1145/3743726")
brain = next(e for e in examples if e["profiles"][0]["source_work_id"] == "source-ref:e2014b2268ac2833bb8e")
for example in examples:
    for key, cls in [("task_occurrences", TaskOccurrenceRecord), ("interaction_traces", InteractionTraceRecord),
                     ("participant_day_observations", ParticipantDayObservationRecord)]:
        for row in example[key]:
            preserved(cls, row)
for cls, row, field, wrong_types in [
    (TaskOccurrenceRecord, odim["task_occurrences"][0], "interaction_trace_reference", [0, False, [], {}]),
    (InteractionTraceRecord, odim["interaction_traces"][0], "participant_id", [0, False, [], {}]),
    (TaskCriterionAssessmentRecord, brain["task_occurrences"][0]["criterion_assessments"][2],
     "support_criterion_assessment_references", [0, False, "score:end", [None]]),
]:
    for omitted in [False, True]:
        variant = deepcopy(row)
        if omitted:
            variant.pop(field, None)
        else:
            variant[field] = None
        preserved(cls, variant)
    for value in wrong_types:
        invalid = deepcopy(row)
        invalid[field] = value
        assert not validator(cls).is_valid(invalid)
        try:
            cls(**invalid)
        except ValidationError:
            pass
        else:
            raise AssertionError(f"{cls.__name__}.{field} accepted {value!r}")
print("ODIM/BrainDisorders/BDI/Back-to-App shared fixtures preserve trace links, paired assessments, signed app comparisons and daily PANAS; generated type negatives reject, local semantics checked by ingress")

communication = json.loads(subprocess.check_output([
    "node", "scripts/run-clean-env.mjs", "./node_modules/.bin/vite-node",
    "e2e/fixtures/ringer-state-interval.ts", "--emit-fixture-json",
], cwd=root.parent, text=True))
from chronicle_research_ontology import RingerStateIntervalRecord, SessionQuantityRecord, SampledQuantityObservationRecord  # noqa: E402
for example in communication:
    for key, cls in [("ringer_state_intervals", RingerStateIntervalRecord),
                     ("sampled_quantity_observations", SampledQuantityObservationRecord),
                     ("task_occurrences", TaskOccurrenceRecord)]:
        for row in example.get(key, []):
            preserved(cls, row)
ringer = communication[0]["ringer_state_intervals"][0]
for quantity in ringer["session_quantities"]:
    preserved(SessionQuantityRecord, quantity)
gap = ringer["session_quantities"][0]
for field in ["start_action_reference", "end_action_reference"]:
    for missing in [False, True]:
        variant = deepcopy(gap)
        if missing:
            variant.pop(field)
        else:
            variant[field] = None
        preserved(SessionQuantityRecord, variant)
    for wrong in [0, False, [], {}]:
        invalid = deepcopy(gap)
        invalid[field] = wrong
        assert not validator(SessionQuantityRecord).is_valid(invalid)
        try:
            SessionQuantityRecord(**invalid)
        except ValidationError:
            pass
        else:
            raise AssertionError(f"SessionQuantityRecord.{field} accepted {wrong!r}")
print("Communication generated shapes preserve Chang occupancy actions/ordered gap endpoints/independent means, proxy links and retrospective diary contexts plus BFI44 occasions; source/ownership semantics checked by ingress")
