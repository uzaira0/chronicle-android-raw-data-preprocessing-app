#!/usr/bin/env python3
"""Normalized shape proof only; relational ownership is enforced at importer."""
import sys
import json
from copy import deepcopy
from pathlib import Path
from pydantic import ValidationError
from jsonschema import Draft202012Validator
from linkml.generators.jsonschemagen import JsonSchemaGenerator

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "generated" / "pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    DeviceStateObservationRecord, DeviceStateIntervalRecord,
    UsageEventRecord, UsageSessionAssertion, GlanceAssertion, RingerStateIntervalRecord,
)

SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
def json_validator(cls):
    return Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": SCHEMA["$defs"]})

def preserved(cls, value):
    json_validator(cls).validate(value)
    assert cls(**value).model_dump(exclude_unset=True) == value

OWNER = dict(method_profile_id="example-profile", source_work_id="usenix:soups2014:harbach-hard-lock-life",
             participant_id="example-participant", device_id="example-device",
             record_origin="analyst_constructed_example", source_locators=["printed p218 Figure1; p220 Section4.2.1"])
OBS = dict(**OWNER, method_setting_reference="example-local-schema", state_observation_id="off-unlocked",
           observation_instant="t1", screen_state="OFF", keyguard_state="UNLOCKED")
INTERVAL = dict(**OWNER, method_setting_reference="example-local-bout", state_interval_id="screen-bout",
                interval_kind="screen_bout", denotes_interval=dict(start_instant="t0", end_instant="t1"),
                start_observation_ref="on-locked", end_observation_ref="off-unlocked")

def rejected(cls, value):
    try:
        cls(**value)
    except ValidationError:
        return True
    return False

preserved(DeviceStateObservationRecord, OBS)
preserved(DeviceStateIntervalRecord, INTERVAL)
cost = {**INTERVAL, "state_interval_id": "unlock-cost", "interval_kind": "unlock_cost_upper_bound", "end_observation_ref": "on-unlocked"}
preserved(DeviceStateIntervalRecord, cost)
assert INTERVAL["denotes_interval"] == cost["denotes_interval"]
assert INTERVAL["end_observation_ref"] != cost["end_observation_ref"]
for cls in [UsageEventRecord, UsageSessionAssertion, GlanceAssertion, RingerStateIntervalRecord]:
    assert rejected(cls, OBS)
    assert rejected(cls, INTERVAL)
for cls, valid, fields in [(DeviceStateObservationRecord, OBS, ["observation_instant", "screen_state", "keyguard_state", "device_id"]),
                          (DeviceStateIntervalRecord, INTERVAL, ["start_observation_ref", "end_observation_ref", "device_id"])]:
    for field in fields:
        for supplied in [False, True]:
            partial = deepcopy(valid)
            if supplied:
                partial[field] = None
            else:
                del partial[field]
            preserved(cls, partial)
partial = {**OBS, "observation_instant": "", "screen_state": None}
del partial["keyguard_state"]
preserved(DeviceStateObservationRecord, partial)
for bounds in [{}, {"start_instant": "", "end_instant": None}, {"start_instant": None},
               {"start_status": None, "end_status": None}]:
    preserved(DeviceStateIntervalRecord, {**INTERVAL, "denotes_interval": bounds})
for cls, valid, field, bad in [
    (DeviceStateObservationRecord, OBS, "screen_state", "LOCKED"),
    (DeviceStateObservationRecord, OBS, "keyguard_state", "OFF"),
    (DeviceStateObservationRecord, OBS, "state_observation_id", None),
    (DeviceStateIntervalRecord, INTERVAL, "interval_kind", "authentication_duration"),
    (DeviceStateIntervalRecord, INTERVAL, "denotes_interval", None),
    (DeviceStateIntervalRecord, INTERVAL, "invented_constructor", True),
]:
    assert rejected(cls, {**valid, field: bad})
    assert not json_validator(cls).is_valid({**valid, field: bad})
assert not json_validator(DeviceStateIntervalRecord).is_valid({**INTERVAL, "interval_kind": None})
assert not json_validator(DeviceStateObservationRecord).is_valid({**OBS, "record_origin": None})
# Independently apply the declared repairs to the unmodified upstream generator.
native = JsonSchemaGenerator(str(Path(__file__).resolve().parents[1] / "chronicle-research-ontology.linkml.yaml"))
vanilla = json.loads(native.serialize())
changed = 0
for name, definition in vanilla["$defs"].items():
    for field, prop in definition.get("properties", {}).items():
        if "$ref" in prop and field not in definition.get("required", []) \
                and "enum" in vanilla["$defs"][prop["$ref"].split("/")[-1]]:
            definition["properties"][field] = {"anyOf": [prop, {"type": "null"}]}
            changed += 1
def repair_presence_ranges(shape, expression):
    presence_ranges = absent_groups = 0
    for name, condition in expression.slot_conditions.items():
        if condition.required or str(condition.value_presence) == "PRESENT":
            original = shape["properties"][name]
            declared = native.get_subschema_for_slot(native.schemaview.get_slot(name), include_null=False)
            shape["properties"][name] = {"allOf": [declared, original]}
            presence_ranges += 1
    absent = [name for name, condition in expression.slot_conditions.items() if str(condition.value_presence) == "ABSENT"]
    if absent:
        assert shape["not"] == {"required": absent}
        shape["not"] = {"anyOf": [{"required": [name]} for name in absent]}
        absent_groups += 1
    for branch, child in zip(shape.get("oneOf", []), expression.exactly_one_of):
        present, missing = repair_presence_ranges(branch, child)
        presence_ranges += present
        absent_groups += missing
    return presence_ranges, absent_groups

for class_name, expected in [("TypingTrialRecord", (9, 2)), ("ParticipantDayObservationRecord", (6, 4)), ("CrossPeriodAggregateReference", (4, 3))]:
    shape = vanilla["$defs"][class_name]
    rules = native.schemaview.get_class(class_name).rules
    assert len(rules) == 1
    rule = rules[0]
    presence_ranges = absent_groups = 0
    for branch, expression in [("if", rule.preconditions), ("then", rule.postconditions), ("else", rule.elseconditions)]:
        if expression is None:
            assert branch not in shape
            continue
        present, missing = repair_presence_ranges(shape[branch], expression)
        presence_ranges += present
        absent_groups += missing
    assert (presence_ranges, absent_groups) == expected, class_name
assert changed > 0 and vanilla == SCHEMA
print(f"PASS JSON Schema generator parity: {changed} optional enum nulls; exact typing and day/hour/night/run conditional ranges/absence; no other changes")
print("PASS device-state shapes: joint state, distinct kind/endpoints, optional/nulls, 4 existing-owner rejections, 6 structural mutants")
