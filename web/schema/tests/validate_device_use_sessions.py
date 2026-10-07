#!/usr/bin/env python3
"""Validate the shared normalized example supplied on stdin, not raw source rows."""
import json
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "generated/pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    DeviceUseSessionRecord, DeviceSessionQuestionnaireResponseRecord,
    DeviceSessionLabelRecord, UsageSessionAssertion, AppInterruptionSessionRecord,
    DeviceStateIntervalRecord, DiaryItem, TaskQuestionnaireResponseRecord,
)

schema = json.loads((ROOT / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
records = json.load(sys.stdin)["device_use_sessions"]
assert records, "No shared example supplied"

def validator(cls):
    return Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": schema["$defs"]})

def preserved(cls, row):
    validator(cls).validate(row)
    assert cls(**row).model_dump(exclude_unset=True) == row

for record in records:
    preserved(DeviceUseSessionRecord, record)
    for response in record.get("session_questionnaire_responses") or []:
        preserved(DeviceSessionQuestionnaireResponseRecord, response)
        # Reused answer slots are structurally compatible; task ingress has a
        # different instrument constraint, exercised by the real importer tests.
        preserved(TaskQuestionnaireResponseRecord, response)
    for label in record.get("session_labels") or []:
        preserved(DeviceSessionLabelRecord, label)

first = records[0]
for old in [UsageSessionAssertion, AppInterruptionSessionRecord, DeviceStateIntervalRecord, DiaryItem]:
    assert not validator(old).is_valid(first)
for key in ["denotes_interval", "start_condition", "end_condition", "session_questionnaire_responses", "session_labels"]:
    for supplied in [False, True]:
        row = deepcopy(first)
        if supplied:
            row[key] = None
        else:
            row.pop(key, None)
        preserved(DeviceUseSessionRecord, row)
for cls, row, key, value in [
    (DeviceUseSessionRecord, first, "device_use_session_id", None),
    (DeviceUseSessionRecord, first, "session_labels", [None]),
    (DeviceUseSessionRecord, first, "invented_raw_join", True),
    (DeviceSessionQuestionnaireResponseRecord, first["session_questionnaire_responses"][0], "questionnaire_setting_reference", None),
    (DeviceSessionLabelRecord, first["session_labels"][0], "label_setting_reference", None),
]:
    assert not validator(cls).is_valid({**row, key: value})
print("PASS shared device-session/answer/label JSON Schema and Pydantic equality, nullable fields, old-owner contrasts and structural mutants; membership belongs to real ingress")
