#!/usr/bin/env python3
"""Generated-shape necessity/representability, not importer membership validation."""
import sys
from copy import deepcopy
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "generated" / "pydantic"))
from chronicle_research_ontology import (  # noqa: E402
    AppFeatureSessionRecord,
    DiaryItem,
    UsageEpisodeAssertion,
)

# Constructed normalized witness from Finesse p8 Section3.3 / Figure1 p3,
# PDF SHA256 a176dc1cb83b1a31b57bbbd0663207a6152ca9f33a0fa578e00b9fba5337bc8a.
# IDs and opaque timing are examples, not source participant records.
VALID = {
    "feature_session_id": "example-session",
    "method_profile_id": "example-profile",
    "source_work_id": "doi:10.1145/3479600",
    "participant_id": "example-participant",
    "session_record_origin": "analyst_constructed_example",
    "app_name": "Instagram",
    "denotes_interval": {"start_instant": "opaque-start", "duration_seconds": 120.0},
    "feature_occurrences": [
        {"feature_occurrence_id": identity, "feature_name": "SEARCH",
         "denotes_interval": {"start_instant": start, "end_instant": end},
         "source_locators": ["Finesse p8 Section3.3"]}
        for identity, start, end in [
            ("first", "opaque-start-1", "opaque-end-1"),
            ("later", "opaque-start-2", "opaque-end-2"),
        ]
    ],
    "session_feature_selections": [
        {"questionnaire_response_id": "selected-later", "selection_response_status": "submitted",
         "selected_feature_occurrence_references": ["later"], "source_locators": ["Finesse p8 Section3.3"]},
        {"questionnaire_response_id": "submitted-empty", "selection_response_status": "submitted",
         "selected_feature_occurrence_references": [], "source_locators": ["Finesse p8 Section3.3"]},
        {"questionnaire_response_id": "expired", "selection_response_status": "expired",
         "source_locators": ["Finesse p8 Section3.3"]},
        {"questionnaire_response_id": "unknown-membership", "selection_response_status": "supplied-unreported",
         "selected_feature_occurrence_references": None, "source_locators": ["Finesse p8 Section3.3"]},
    ],
    "source_locators": ["Finesse p8 Section3.3 / Figure1 p3"],
}


def rejected(cls, value):
    try:
        cls(**value)
    except ValidationError:
        return True
    return False


assert AppFeatureSessionRecord(**VALID).model_dump(exclude_unset=True) == VALID
episode = {"participant_id": VALID["participant_id"], "denotes_interval": VALID["denotes_interval"]}
UsageEpisodeAssertion(**episode)
assert rejected(UsageEpisodeAssertion, {**episode, "feature_occurrences": VALID["feature_occurrences"]}), "app-level episode loses occurrence semantics"
instrument = {"diary_item_id": "example-instrument", "diary_response_kind": "object"}
DiaryItem(**instrument)
assert rejected(DiaryItem, {**instrument, "session_feature_selections": VALID["session_feature_selections"]}), "instrument definition is not a populated session response"

mutants = []
for field in ("feature_session_id", "app_name", "feature_occurrences"):
    invalid = deepcopy(VALID)
    invalid.pop(field)
    mutants.append(invalid)
invalid = deepcopy(VALID)
invalid["feature_occurrences"][0].pop("feature_occurrence_id")
mutants.append(invalid)
invalid = deepcopy(VALID)
invalid["session_feature_selections"][0].pop("selection_response_status")
mutants.append(invalid)
invalid = deepcopy(VALID)
invalid["feature_occurrences"][0]["invented_raw_key"] = "not-disclosed"
mutants.append(invalid)
assert all(rejected(AppFeatureSessionRecord, value) for value in mutants)
print("generated feature-session shape: exact positive, 2 existing-carrier rejections, 6 structural mutants passed")
