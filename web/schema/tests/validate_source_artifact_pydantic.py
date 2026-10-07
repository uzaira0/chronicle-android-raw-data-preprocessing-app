#!/usr/bin/env python3
"""Prove the generated source-artifact assertion is closed and documentary-only."""

import sys
from pathlib import Path

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "generated" / "pydantic"))

from chronicle_research_ontology import SourceArtifactProvenanceAssertion  # noqa: E402


VALID = {
    "source_artifact_provenance_id": "source-artifact-provenance:setting",
    "method_setting_id": "setting",
    "source_work_id": "doi:example",
    "source_extraction_id": "extraction",
    "source_value_sha256": "0" * 64,
    "source_artifact_provenance_object_json": "{}",
    "source_artifact_provenance_object_digest": "sha256:" + "0" * 64,
    "provenance_keys": ["source_artifact_provenance_id"],
    "candidate_status": "ready_for_typed_registry",
    "conformance_fixture_id": "fixture",
    "conformance_result_digest": "sha256:" + "1" * 64,
    "execution_eligibility": "documentary_only",
}


def rejected(candidate: dict) -> bool:
    try:
        SourceArtifactProvenanceAssertion(**candidate)
    except ValidationError:
        return True
    return False


SourceArtifactProvenanceAssertion(**VALID)
for required in ("source_value_sha256", "conformance_fixture_id", "conformance_result_digest"):
    candidate = dict(VALID)
    candidate.pop(required)
    assert rejected(candidate), f"generated Pydantic accepted missing {required}"
assert rejected({**VALID, "execution_eligibility": True})
assert rejected({**VALID, "execution_eligibility": "executable"})
print("source-artifact generated Pydantic positive/negative proof passed")
