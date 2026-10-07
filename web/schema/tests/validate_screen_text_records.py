#!/usr/bin/env python3
"""Generated-shape preservation; profile ownership is checked by real ingress."""
import json
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator

SCHEMA_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCHEMA_ROOT / "generated/pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    ScreenTextCaptureRecord, ScreenTextPhraseRecord, SensorControlOccurrenceRecord,
    UsageEventRecord, InteractionEventRecord, DeviceStateObservationRecord,
    NotificationEvidenceRecord, ParticipantDayObservationRecord,
)

schema = json.loads((SCHEMA_ROOT / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
records = json.loads((SCHEMA_ROOT.parent / "e2e/fixtures/screen-text-example.json.fixture").read_text())
def validator(cls):
    return Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": schema["$defs"]})
def preserved(cls, value):
    validator(cls).validate(value)
    assert cls(**value).model_dump(exclude_unset=True) == value

for row in records["screen_text_captures"]:
    preserved(ScreenTextCaptureRecord, row)
    for phrase in row.get("screen_phrases") or []:
        preserved(ScreenTextPhraseRecord, phrase)
for row in records["sensor_control_occurrences"]:
    preserved(SensorControlOccurrenceRecord, row)
    for field in ["device_id", "occurrence_instant"]:
        for supplied in [False, True]:
            value = deepcopy(row)
            if supplied:
                value[field] = None
            else:
                value.pop(field, None)
            preserved(SensorControlOccurrenceRecord, value)

capture = records["screen_text_captures"][0]
for token in [None, "", "opaque source event token"]:
    preserved(ScreenTextCaptureRecord, {**capture, "source_event_time_token": token})
for token in [0, False, {}, []]:
    invalid = {**capture, "source_event_time_token": token}
    assert not validator(ScreenTextCaptureRecord).is_valid(invalid)
    try:
        ScreenTextCaptureRecord(**invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("source-event token must retain string/null type")
phrase = capture["screen_phrases"][0]
control = records["sensor_control_occurrences"][0]
for old in [UsageEventRecord, InteractionEventRecord, DeviceStateObservationRecord,
            NotificationEvidenceRecord, ParticipantDayObservationRecord]:
    assert not validator(old).is_valid(capture)
    assert not validator(old).is_valid(phrase)
    assert not validator(old).is_valid(control)
# These distinctions cannot be retained after their typed components are erased.
other_phrase = capture["screen_phrases"][1]
assert phrase["phrase_text"] == other_phrase["phrase_text"]
assert phrase["phrase_id"] != other_phrase["phrase_id"]
assert phrase["phrase_left_px"] != other_phrase["phrase_left_px"]
for cls, row, field, bad in [
    (ScreenTextPhraseRecord, phrase, "phrase_id", None),
    (ScreenTextPhraseRecord, phrase, "phrase_left_px", "0"),
    (ScreenTextPhraseRecord, phrase, "visible", True),
    (ScreenTextCaptureRecord, capture, "screen_phrases", [None]),
    (ScreenTextCaptureRecord, capture, "record_origin", None),
    (SensorControlOccurrenceRecord, control, "sensor_control_action", "ON"),
    (SensorControlOccurrenceRecord, control, "sensor_control_action", None),
    (SensorControlOccurrenceRecord, control, "sensor_control_action", ["enable"]),
]:
    assert not validator(cls).is_valid({**row, field: bad})
print("PASS text-capture/phrase/control JSON Schema and Pydantic round-trip; old-owner contrasts and 8 structural mutants")
