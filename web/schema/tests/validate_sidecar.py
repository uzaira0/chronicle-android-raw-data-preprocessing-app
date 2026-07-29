"""SHACL + structural validation of the REAL runtime provenance sidecar.

`scripts/emit_golden_sidecar.mts` runs a golden scenario through the actual
pipeline and writes the `chronicle-provenance.jsonld` a user's download ZIP
would contain. This test closes the loop the research ontology exists for:
the runtime lineage ledger (chron:NodeExecution activities + minted
chron:StepDefinition plan nodes) must conform to the SAME merged shapes
graph that guards canonical LinkML instances.

Closed-world note: the generated LinkML shapes are `sh:closed true`. The
sidecar is a PROV-idiomatic projection — it deliberately carries annotation
properties beyond the LinkML core (rdfs:label, prov:startedAtTime/endedAtTime,
prov:wasInformedBy, dcterms:isPartOf, chronicle:* row counters) — so this
validator strips ONLY the `sh:closed` triples before validating. Everything
else (datatypes, sh:class targets, cardinalities, and the hand-authored A1–A7
contract axioms, including NodeExecutionContractShape) keeps its teeth.
`validate_axioms.py` continues to enforce closedness on canonical instances.

Structural assertions (rdflib, beyond SHACL):
  - the graph contains NodeExecutions at BOTH scales (unit + step);
  - every NodeExecution names an executes_step target that is a typed
    chron:StepDefinition in the same graph, cites the ParameterSet, and
    carries both prov timestamps;
  - every step-scale execution is dcterms:isPartOf a unit-scale execution;
  - every step-scale StepDefinition is dcterms:isPartOf a unit StepDefinition
    (the `part_of_step` slot's declared slot_uri IS dcterms:isPartOf, so the
    sidecar must use the canonical predicate).

Run with `make validate-sidecar` (part of `make check`).
"""

from __future__ import annotations

import sys
from pathlib import Path

from pyshacl import validate
from rdflib import RDF, Graph, Namespace

HERE = Path(__file__).resolve().parent
MERGED = HERE.parent / "generated" / "shacl" / "merged.shacl.ttl"
DEFAULT_SIDECAR = HERE / ".artifacts" / "chronicle-provenance.jsonld"

SH = Namespace("http://www.w3.org/ns/shacl#")
CHRON = Namespace("https://w3id.org/chronicle-usage-ontology/core/")
PROV = Namespace("http://www.w3.org/ns/prov#")
DCTERMS = Namespace("http://purl.org/dc/terms/")


def main() -> int:
    sidecar = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SIDECAR
    if not sidecar.exists():
        print(
            f"FAIL: sidecar not found at {sidecar} — run the emit step first "
            "(make validate-sidecar drives both).",
            file=sys.stderr,
        )
        return 2
    if not MERGED.exists():
        print(f"FAIL: merged shapes graph not found at {MERGED} (run `make all`).", file=sys.stderr)
        return 2

    data = Graph()
    data.parse(sidecar, format="json-ld")
    shapes = Graph()
    shapes.parse(MERGED, format="turtle")

    # Relax ONLY closed-world enforcement (see module docstring). pyshacl
    # rejects sh:ignoredProperties without sh:closed, so both go together.
    closed = list(shapes.triples((None, SH.closed, None)))
    for triple in closed:
        shapes.remove(triple)
    for triple in list(shapes.triples((None, SH.ignoredProperties, None))):
        shapes.remove(triple)
    print(f"validate_sidecar: {len(data)} data triples, sh:closed relaxed on {len(closed)} shapes")

    failures: list[str] = []

    conforms, _graph, report = validate(data, shacl_graph=shapes, inference="none", advanced=True)
    if not conforms:
        failures.append(f"SHACL non-conformance:\n{report}")

    executions = set(data.subjects(RDF.type, CHRON.NodeExecution))
    step_execs = {e for e in executions if (e, DCTERMS.isPartOf, None) in data}
    unit_execs = executions - step_execs
    if not unit_execs:
        failures.append("no unit-scale NodeExecutions found")
    if not step_execs:
        failures.append("no step-scale NodeExecutions found")

    for execution in executions:
        step = data.value(execution, CHRON.executes_step)
        if step is None:
            failures.append(f"{execution} has no chron:executes_step")
        elif (step, RDF.type, CHRON.StepDefinition) not in data:
            failures.append(f"{execution} executes_step {step} which is not a typed StepDefinition")
        if data.value(execution, CHRON.used_parameter_set) is None:
            failures.append(f"{execution} does not cite a ParameterSet")
        if data.value(execution, PROV.startedAtTime) is None or data.value(execution, PROV.endedAtTime) is None:
            failures.append(f"{execution} is missing a prov timestamp")

    for execution in step_execs:
        parent = data.value(execution, DCTERMS.isPartOf)
        if parent not in unit_execs:
            failures.append(f"{execution} isPartOf {parent}, which is not a unit-scale NodeExecution")

    # Composition uses the slot's canonical predicate (part_of_step has
    # slot_uri dcterms:isPartOf). A sidecar emitting chron:part_of_step would
    # hide every composition edge from ontology-driven consumers.
    step_defs = set(data.subjects(RDF.type, CHRON.StepDefinition))
    if any(True for _ in data.subject_objects(CHRON.part_of_step)):
        failures.append(
            "found chron:part_of_step triples — composition must use the slot_uri dcterms:isPartOf"
        )
    nested = {s for s in step_defs if data.value(s, DCTERMS.isPartOf) is not None}
    for definition in nested:
        parent = data.value(definition, DCTERMS.isPartOf)
        if parent not in step_defs:
            failures.append(f"{definition} isPartOf {parent}, which is not a StepDefinition")
    if not nested:
        failures.append("no step-scale StepDefinitions (isPartOf recursion) found")

    print(
        f"validate_sidecar: {len(unit_execs)} unit executions, {len(step_execs)} step executions, "
        f"{len(step_defs)} step definitions ({len(nested)} nested)"
    )
    if failures:
        print(f"validate_sidecar: {len(failures)} failure(s):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("validate_sidecar OK: the real runtime sidecar conforms to the merged shapes graph.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
