#!/usr/bin/env python3
"""Generated shape proof; owner-local references are the importer's responsibility."""
from copy import deepcopy
from pathlib import Path
import sys

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "generated" / "pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    ScreenshotSessionRecord, UsageSessionAssertion, InteractionEventRecord,
)

# PULSE printed202 §2.2 / printed203 Figure1b/c. Constructed identities,
# NOT recovered participant rows or deployed serialization.
VALID = {
    "screenshot_session_id": "example-session", "method_profile_id": "example-profile",
    "source_work_id": "doi:10.1145/3714394.3754395", "participant_id": "example-participant",
    "session_record_origin": "analyst_constructed_example",
    "screenshots": [
        {"screenshot_record_id": identity, "screenshot_sequence_position": position,
         "screenshot_instant": "equal-time-token", "source_locators": ["PULSE §2.2"]}
        for identity, position in [("first", 10), ("later", 20)]
    ],
    "screenshot_range_annotations": [
        {"range_annotation_id": "range", "first_screenshot_reference": "first",
         "last_screenshot_reference": "later", "range_label_values_json": ' {"usage_intent":"Information"} ',
         "source_locators": ["PULSE §2.2 / Figure1b/c"]},
        {"range_annotation_id": "unknown", "first_screenshot_reference": None,
         "range_label_values_json": None, "source_locators": ["PULSE §2.2"]},
    ],
    "source_locators": ["PULSE §2.2 / Figure1b/c"],
}


def rejected(cls, value):
    try:
        cls(**value)
    except ValidationError:
        return True
    return False


assert ScreenshotSessionRecord(**VALID).model_dump(exclude_unset=True) == VALID
assert rejected(UsageSessionAssertion, VALID), "unlock-to-lock assertion is not a screenshot-range session"
assert rejected(InteractionEventRecord, VALID), "paired hierarchy event is not a screenshot-range session"
mutants = []
for field in ("screenshot_session_id", "participant_id", "screenshots"):
    row = deepcopy(VALID)
    row.pop(field)
    mutants.append(row)
row = deepcopy(VALID)
row["screenshots"][0].pop("screenshot_record_id")
mutants.append(row)
row = deepcopy(VALID)
row["screenshot_range_annotations"][0].pop("range_annotation_id")
mutants.append(row)
row = deepcopy(VALID)
row["screenshot_range_annotations"][0]["whole_session_intent"] = "Information"
mutants.append(row)
assert all(rejected(ScreenshotSessionRecord, row) for row in mutants)
print("generated screenshot-range shape: exact positive, 2 carrier rejections, 6 structural mutants passed")
