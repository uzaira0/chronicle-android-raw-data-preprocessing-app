"""Automated contract test for the hand-authored SHACL axioms.

The `axioms/*.shacl.ttl` invariants only earn their place if they actually FIRE
on the instances LinkML canonically produces. This test proves that end to end:

  1. build a canonical instance graph for each case via `linkml-convert` (the
     same serializer any consumer would use — enum slots become string literals,
     classes are typed by their minted `chron:` IRI),
  2. validate it against the merged shapes graph with pyshacl,
  3. assert the outcome: a "bad" instance must be non-conformant AND surface its
     axiom's message; a "good" instance must conform.

This is the regression guard behind the README's claim that "all 5 contract
axioms are pyshacl-verified to fire" (A2–A6; A1 cardinality is delegated to the
generated shape). Each case's `needles` lists EVERY message that must appear, so
a shape carrying two invariants (e.g. EffectiveUsageProvenanceShape:
cites_parameter_set AND produced_by) is guarded on both.

Cases C4–C6 additionally prove the identifier-bearing classes (PipelinePlan /
StepDefinition / ReconstructionStrategy, keyed by plan_id / step_id / strategy_id)
serialize and conform: a bare local id cannot be minted into an IRI and fails
linkml-convert; the CURIE identifier convention (`chron:...`) is what these cases
exercise, so a regression back to un-serializable identifiers is caught here.
Run it with `make validate`.

Exit code is non-zero if any case does not match its expectation.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from pyshacl import validate
from rdflib import Graph

HERE = Path(__file__).resolve().parent
SCHEMA = HERE.parent / "chronicle-research-ontology.linkml.yaml"
MERGED = HERE.parent / "generated" / "shacl" / "merged.shacl.ttl"

# (name, class, instance YAML, expect_conforms, message substrings ALL required when non-conformant)
CASES: list[tuple[str, str, str, bool, tuple[str, ...]]] = [
    (
        "A2 unresolved attribution naming a person is forbidden",
        "AttributionAssertion",
        'attribution_status: unresolved\nattributed_person: "Jane Doe"\non_shared_device: false\n',
        False,
        ("must not name an attributed_person",),
    ),
    (
        "A2 unresolved attribution with no person conforms",
        "AttributionAssertion",
        "attribution_status: unresolved\non_shared_device: false\n",
        True,
        (),
    ),
    (
        "A3 an 'observed' endpoint without its instant is forbidden",
        "UsageInterval",
        "start_status: observed\nend_status: observed\nduration_seconds: 5.0\n",
        False,
        ("must carry its instant",),
    ),
    (
        "A4 a no-data assessment without an expectation is forbidden",
        "CoverageAssessment",
        'participant_id: "P1"\nactually_available: false\n',
        False,
        ("requires expected_available",),
    ),
    (
        "A5 an episode assertion without reconstructed_by is forbidden",
        "UsageEpisodeAssertion",
        'app_package_name: "com.example"\nparticipant_id: "P1"\n',
        False,
        ("reconstructed_by an execution",),
    ),
    (
        "A6 an effective-usage measure without provenance is forbidden",
        "EffectiveUsageMeasure",
        'participant_id: "P1"\ndate: "2026-03-05"\neffective_minutes: 42.0\n',
        False,
        ("cite the ParameterSet", "name the node execution that produced it"),
    ),
    (
        "C3 a valid ParameterSet conforms (no spurious participant_id violation)",
        "ParameterSet",
        'parameter_set_sha256: "abc123"\n',
        True,
        (),
    ),
    # C4–C6: the identifier-bearing classes (plan_id / step_id / strategy_id) must
    # serialize to RDF and conform. A bare local id (`plan_id: p1`) cannot be minted
    # into an IRI without a base URI and fails linkml-convert with "Unknown CURIE
    # prefix: @base"; the canonical fix is a CURIE identifier value (`chron:...`), the
    # same convention the sibling research-standards ontology uses. These cases guard
    # that every class — not just the blank-node ones — round-trips cleanly.
    (
        "C4 a PipelinePlan (identifier class) converts + conforms",
        "PipelinePlan",
        'plan_id: "chron:plan-1"\nsteps:\n  - step_id: "chron:step-a"\n    verb: "download"\n',
        True,
        (),
    ),
    (
        "C5 a StepDefinition (identifier class) converts + conforms",
        "StepDefinition",
        'step_id: "chron:step-a"\nverb: "download"\n',
        True,
        (),
    ),
    (
        "C6 a ReconstructionStrategy (identifier class) converts + conforms",
        "ReconstructionStrategy",
        'strategy_id: "chron:strat-1"\nstrategy_version: "1.0"\n',
        True,
        (),
    ),
]


def instance_graph(cls: str, yaml_text: str) -> Graph:
    """Serialize an instance to canonical RDF exactly as a consumer would."""
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as handle:
        handle.write(yaml_text)
        yaml_path = handle.name
    try:
        result = subprocess.run(
            ["linkml-convert", "-s", str(SCHEMA), "-t", "ttl", "-C", cls, yaml_path],
            capture_output=True,
            text=True,
            check=True,
        )
    finally:
        os.unlink(yaml_path)
    graph = Graph()
    graph.parse(data=result.stdout, format="turtle")
    return graph


def main() -> int:
    if not MERGED.exists():
        print(f"FAIL: merged shapes graph not found at {MERGED} (run `make all` first).", file=sys.stderr)
        return 2
    shapes = Graph()
    shapes.parse(MERGED, format="turtle")

    failures: list[str] = []
    for name, cls, yaml_text, expect_conforms, needles in CASES:
        data = instance_graph(cls, yaml_text)
        conforms, _results_graph, report = validate(
            data, shacl_graph=shapes, inference="none", advanced=True
        )
        ok = conforms == expect_conforms
        # Every listed message must appear — guards each invariant of a
        # multi-invariant shape (e.g. cites_parameter_set AND produced_by).
        if not conforms and any(n not in report for n in needles):
            ok = False
        status = "ok  " if ok else "FAIL"
        print(f"[{status}] {name} (conforms={conforms}, expected={expect_conforms})")
        if not ok:
            failures.append(name)

    print()
    if failures:
        print(f"validate: {len(failures)} axiom case(s) did not match expectation:", file=sys.stderr)
        for name in failures:
            print(f"  - {name}", file=sys.stderr)
        return 1
    print(f"validate OK: all {len(CASES)} contract-axiom cases behave as specified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
