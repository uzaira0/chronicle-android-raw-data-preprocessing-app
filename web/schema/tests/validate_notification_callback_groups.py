#!/usr/bin/env python3
"""Generated-shape checks on the same constructed callback fixture as real ingress."""
import json
import sys
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "generated/pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    NotificationCallbackGroupRecord, NotificationEvidenceRecord,
    NotificationHistoryRecord, NotificationDrawerSnapshotRecord, UsageEventRecord,
)

schema = json.loads((root / "generated/json-schema/chronicle-research-ontology.schema.json").read_text())
records = json.loads((root.parent / "e2e/fixtures/notification-callback-example.json.fixture").read_text())["notification_callback_groups"]

def validator(cls):
    return Draft202012Validator({"$ref": f"#/$defs/{cls.__name__}", "$defs": schema["$defs"]})

def preserved(cls, row):
    validator(cls).validate(row)
    assert cls(**row).model_dump(exclude_unset=True) == row

for row in records:
    preserved(NotificationCallbackGroupRecord, row)
    for member in row["notification_evidence"]:
        preserved(NotificationEvidenceRecord, member)
group = records[0]
for cls in [NotificationHistoryRecord, NotificationDrawerSnapshotRecord, UsageEventRecord]:
    assert not validator(cls).is_valid(group), f"{cls.__name__} changes callback-group ownership/meaning"
variant = deepcopy(group)
variant["analytic_alert_proxy_reference"] = "callback-a"
preserved(NotificationCallbackGroupRecord, variant)
assert variant != group and variant["notification_evidence"] == group["notification_evidence"]
for cls, row, fields in [
    (NotificationCallbackGroupRecord, group, ["analytic_alert_proxy_reference", "device_id"]),
    (NotificationEvidenceRecord, group["notification_evidence"][0], ["evidence_instant", "evidence_value_json", "evidence_unit", "evidence_basis", "evidence_references"]),
]:
    for field in fields:
        for omitted in [False, True]:
            variant = deepcopy(row)
            if omitted:
                variant.pop(field, None)
            else:
                variant[field] = None
            preserved(cls, variant)
for field in ["callback_group_id", "method_profile_id", "source_work_id", "participant_id", "history_record_origin", "notification_evidence", "source_locators"]:
    invalid = deepcopy(group)
    invalid.pop(field)
    assert not validator(NotificationCallbackGroupRecord).is_valid(invalid)
invalid = deepcopy(group)
invalid["observed_perception"] = True
assert not validator(NotificationCallbackGroupRecord).is_valid(invalid)
print("callback generated shapes: shared constructed group/members and lexical/null/omitted values preserved; incompatible owners/required/unknown-field negatives reject; semantic kinds and local references checked by real ingress")
