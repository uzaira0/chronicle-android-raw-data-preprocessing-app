#!/usr/bin/env python3
"""Generated-shape proof, not raw-row recovery or runtime reconstruction."""
import sys
from copy import deepcopy
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "generated" / "pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    AppInterruptionSessionRecord,
    AppFeatureSessionRecord,
    UsageSessionAssertion,
    UsageEpisodeAssertion,
)

# WhyStop author copy p4 Figure1, SHA2561d6962ef...a277e22. Local IDs and
# ownership are analyst-constructed; literal clock/list subset, not whole timeline.
VALID = {
    "app_interruption_session_id": "illustration-session",
    "method_profile_id": "example-profile",
    "source_work_id": "doi:10.1145/3473856.3473881",
    "participant_id": "illustration-owner-not-study-participant",
    "session_record_origin": "analyst_constructed_example",
    "denotes_interval": {"start_instant": "05:48:56", "end_instant": "05:50:43"},
    "interruptions": [{
        "interruption_record_id": "illustration-interruption",
        "denotes_interval": {"start_instant": "05:49:03", "end_instant": "05:50:43"},
        "interruption_type": "APP_SWITCH",
        "visited_app_labels": ["Google", "Google Play Store", "Google", "Activity Recognition"],
        "source_locators": ["WhyStop p4 Figure1"],
    }],
    "source_locators": ["WhyStop p4 Figure1; p3 Section3.2; p7 Section4.4.2"],
}


def rejected(cls, value):
    try:
        cls(**value)
    except ValidationError:
        return True
    return False


assert AppInterruptionSessionRecord(**VALID).model_dump(exclude_unset=True) == VALID
ordinary = {"participant_id": VALID["participant_id"], "denotes_interval": VALID["denotes_interval"]}
for cls in [UsageSessionAssertion, UsageEpisodeAssertion]:
    cls(**ordinary)
    assert rejected(cls, {**ordinary, "interruptions": VALID["interruptions"]})
feature = {
    "feature_session_id": "example-feature-session", "method_profile_id": "example-profile",
    "source_work_id": VALID["source_work_id"], "participant_id": VALID["participant_id"],
    "session_record_origin": "analyst_constructed_example", "app_name": "supplied app label",
    "denotes_interval": VALID["denotes_interval"], "feature_occurrences": [], "source_locators": VALID["source_locators"],
}
AppFeatureSessionRecord(**feature)
assert rejected(AppFeatureSessionRecord, {**feature, "interruptions": VALID["interruptions"]})
for membership in [None, []]:
    variant = deepcopy(VALID)
    variant["interruptions"] = membership
    assert AppInterruptionSessionRecord(**variant).model_dump(exclude_unset=True) == variant
for path, value in [
    (["app_interruption_session_id"], None), (["method_profile_id"], None),
    (["session_record_origin"], "raw_row"), (["denotes_interval"], None),
    (["interruptions", 0, "interruption_record_id"], None),
    (["interruptions", 0, "denotes_interval"], None),
    (["interruptions", 0, "parent_session_reference"], "foreign"),
]:
    mutant = deepcopy(VALID)
    target = mutant
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    assert rejected(AppInterruptionSessionRecord, mutant), path
print("PASS interruption-session shape: exact example/unknown/empty, 3 existing-owner rejections, 7 structural mutants; membership/owner rules tested at importer")

# Additional source-shaped members; local ownership/definition guards execute
# only in the actual importer, not in generated Pydantic or SHACL rules.
with_answers = deepcopy(VALID)
with_answers["app_package_name"] = None
with_answers["session_questionnaire_responses"] = [{
    "questionnaire_response_id": "example:importance-answer",
    "questionnaire_setting_reference": "method-setting-dfbc989c650e3f0e6400c40d",
    "observed_property": "interruption importance",
    "response_value_json": '"Not important - I could have ignored it and continued learning"',
    "response_role_label": "supplied interruption follow-up",
    "interruption_record_reference": "illustration-interruption",
    "source_locators": ["WhyStop ESQ importance item; supplied local link, no last-selection inference"],
}]
with_answers["session_quantities"] = [{
    "quantity_record_id": "example:net-duration",
    "quantity_setting_reference": "method-setting-8212b7717f3d8401939701eb",
    "quantity_scope": "session",
    "observed_property": "learning session net length",
    "evidence_value_json": "17.500",
    "evidence_unit": "seconds",
    "source_locators": ["WhyStop net length definition; supplied seconds, no subtraction"],
}]
assert AppInterruptionSessionRecord(**with_answers).model_dump(exclude_unset=True) == with_answers
for field in ["session_questionnaire_responses", "session_quantities"]:
    for membership in [None, []]:
        variant = deepcopy(with_answers)
        variant[field] = membership
        assert AppInterruptionSessionRecord(**variant).model_dump(exclude_unset=True) == variant
    variant = deepcopy(with_answers)
    variant.pop(field)
    assert AppInterruptionSessionRecord(**variant).model_dump(exclude_unset=True) == variant
for field in ["response_value_json", "response_role_label", "interruption_record_reference"]:
    for omitted in [False, True]:
        variant = deepcopy(with_answers)
        if omitted:
            variant["session_questionnaire_responses"][0].pop(field)
        else:
            variant["session_questionnaire_responses"][0][field] = None
        assert AppInterruptionSessionRecord(**variant).model_dump(exclude_unset=True) == variant
for path, value in [
    (["session_questionnaire_responses", 0, "questionnaire_setting_reference"], None),
    (["session_questionnaire_responses", 0, "invented_join"], "foreign"),
    (["session_quantities", 0, "quantity_setting_reference"], None),
]:
    variant = deepcopy(with_answers)
    target = variant
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    assert rejected(AppInterruptionSessionRecord, variant), path
print("PASS tracked-app supplied answer/quantity shape; local links and source semantics checked at ingress")
