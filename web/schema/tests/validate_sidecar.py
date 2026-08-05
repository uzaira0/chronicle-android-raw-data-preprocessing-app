"""Validate the Rust-owned runtime workflow/provenance JSON-LD sidecar.

``make validate-sidecar`` invokes the thin Rust
``export_workflow_provenance`` binary. That binary calls the same production
builder used by each runtime execution, so this test validates runtime-owned
bytes rather than a TypeScript reconstruction.

Generated LinkML shapes are closed, while the PROV projection intentionally
adds annotation and composition properties. This validator therefore removes
only ``sh:closed`` and ``sh:ignoredProperties`` from a copy of the shapes graph;
class, datatype, and cardinality constraints remain active. Positive structural
checks cover the full lineage graph, and negative mutations must be rejected by
both authored contract axioms and generated LinkML class constraints. The test
also enforces the interpretation boundary: semantic operations are prospective
definitions, while observed physical states are QueryExecutions.
"""

from __future__ import annotations

import sys
from pathlib import Path

from pyshacl import validate
from rdflib import RDF, Graph, Namespace, URIRef

HERE = Path(__file__).resolve().parent
MERGED = HERE.parent / "generated" / "shacl" / "merged.shacl.ttl"
DEFAULT_SIDECAR = HERE / ".artifacts" / "chronicle-provenance.jsonld"

SH = Namespace("http://www.w3.org/ns/shacl#")
CHRON = Namespace("https://w3id.org/chronicle-usage-ontology/core/")
PROV = Namespace("http://www.w3.org/ns/prov#")
DCTERMS = Namespace("http://purl.org/dc/terms/")


def clone_graph(source: Graph) -> Graph:
    clone = Graph()
    for prefix, namespace in source.namespaces():
        clone.bind(prefix, namespace)
    for triple in source:
        clone.add(triple)
    return clone


def assert_rejected(
    label: str,
    data: Graph,
    shapes: Graph,
    expected_message: str,
    failures: list[str],
) -> None:
    conforms, _report_graph, report = validate(
        data,
        shacl_graph=shapes,
        inference="none",
        advanced=True,
    )
    report_text = str(report)
    if conforms:
        failures.append(f"negative case {label!r} unexpectedly conformed")
    elif expected_message not in report_text:
        failures.append(
            f"negative case {label!r} failed without expected evidence "
            f"{expected_message!r}:\n{report_text}"
        )


def main() -> int:
    sidecar = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SIDECAR
    if not sidecar.exists():
        print(
            f"FAIL: sidecar not found at {sidecar} — make validate-sidecar emits it in Rust first.",
            file=sys.stderr,
        )
        return 2
    if not MERGED.exists():
        print(
            f"FAIL: merged shapes graph not found at {MERGED} (run `make all`).",
            file=sys.stderr,
        )
        return 2

    data = Graph()
    data.parse(sidecar, format="json-ld")
    shapes = Graph()
    shapes.parse(MERGED, format="turtle")

    # Relax only closed-world enforcement. pyshacl rejects ignoredProperties
    # without sh:closed, so both declarations are removed together.
    closed = list(shapes.triples((None, SH.closed, None)))
    for triple in closed:
        shapes.remove(triple)
    for triple in list(shapes.triples((None, SH.ignoredProperties, None))):
        shapes.remove(triple)
    print(
        f"validate_sidecar: {len(data)} data triples, sh:closed relaxed on {len(closed)} shapes"
    )

    failures: list[str] = []
    conforms, _report_graph, report = validate(
        data,
        shacl_graph=shapes,
        inference="none",
        advanced=True,
    )
    if not conforms:
        failures.append(f"SHACL non-conformance:\n{report}")

    plans = set(data.subjects(RDF.type, CHRON.WorkflowPlan))
    operation_definitions = set(data.subjects(RDF.type, CHRON.OperationDefinition))
    query_definitions = set(data.subjects(RDF.type, CHRON.QueryDefinition))
    parameter_sets = set(data.subjects(RDF.type, CHRON.ParameterSet))
    operation_executions = set(data.subjects(RDF.type, CHRON.OperationExecution))
    query_executions = set(data.subjects(RDF.type, CHRON.QueryExecution))

    if len(plans) != 1:
        failures.append(f"expected exactly one WorkflowPlan, found {len(plans)}")
    if not parameter_sets:
        failures.append("no typed ParameterSet found")
    if len(operation_executions) != 1:
        failures.append(
            "expected exactly one root OperationExecution and no inferred semantic "
            f"OperationExecutions, found {len(operation_executions)}"
        )
    if not query_definitions:
        failures.append("no physical QueryDefinitions found")
    if not query_executions:
        failures.append("no physical QueryExecutions found")

    for plan in plans:
        planned_operations = set(data.objects(plan, CHRON.operations))
        missing_operations = operation_definitions - planned_operations
        if missing_operations:
            failures.append(
                "WorkflowPlan omits typed OperationDefinitions: "
                + ", ".join(sorted(map(str, missing_operations)))
            )
        planned_queries = set(data.objects(plan, CHRON.queries))
        missing_queries = query_definitions - planned_queries
        if missing_queries:
            failures.append(
                "WorkflowPlan omits typed QueryDefinitions: "
                + ", ".join(sorted(map(str, missing_queries)))
            )

    for execution in operation_executions:
        operation = data.value(execution, CHRON.executes_operation)
        if operation is None:
            failures.append(f"{execution} has no chron:executes_operation")
        elif operation not in operation_definitions:
            failures.append(
                f"{execution} executes_operation {operation} which is not a typed OperationDefinition"
            )
        parameter_set = data.value(execution, CHRON.used_parameter_set)
        if parameter_set is None:
            failures.append(f"{execution} does not cite a ParameterSet")
        elif parameter_set not in parameter_sets:
            failures.append(
                f"{execution} cites {parameter_set}, which is not a typed ParameterSet"
            )
        if (
            data.value(execution, PROV.startedAtTime) is None
            or data.value(execution, PROV.endedAtTime) is None
        ):
            failures.append(f"{execution} is missing a prov timestamp")

    for execution in query_executions:
        query = data.value(execution, CHRON.executes_query)
        if query is None:
            failures.append(f"{execution} has no chron:executes_query")
        elif query not in query_definitions:
            failures.append(
                f"{execution} executes_query {query} which is not a typed QueryDefinition"
            )
        parameter_set = data.value(execution, CHRON.used_parameter_set)
        if parameter_set is None:
            failures.append(f"{execution} does not cite a ParameterSet")
        elif parameter_set not in parameter_sets:
            failures.append(
                f"{execution} cites {parameter_set}, which is not a typed ParameterSet"
            )
        parent = data.value(execution, DCTERMS.isPartOf)
        if parent not in operation_executions:
            failures.append(
                f"{execution} isPartOf {parent}, which is not a root OperationExecution"
            )
        if data.value(execution, CHRON.query_execution_status) is None:
            failures.append(f"{execution} has no physical execution status")
        if (
            data.value(execution, PROV.startedAtTime) is None
            or data.value(execution, PROV.endedAtTime) is None
        ):
            failures.append(f"{execution} is missing a prov timestamp")

    # Composition uses the slot's canonical predicate. Emitting the local
    # chron:part_of_operation name would hide every edge from ontology clients.
    if any(True for _ in data.subject_objects(CHRON.part_of_operation)):
        failures.append(
            "found chron:part_of_operation triples — composition must use dcterms:isPartOf"
        )
    nested_definitions = {
        operation
        for operation in operation_definitions
        if data.value(operation, DCTERMS.isPartOf) is not None
    }
    for definition in nested_definitions:
        parent = data.value(definition, DCTERMS.isPartOf)
        if parent not in operation_definitions:
            failures.append(
                f"{definition} isPartOf {parent}, which is not an OperationDefinition"
            )
    if not nested_definitions:
        failures.append("no nested OperationDefinitions found")

    # The negative cases exercise authored A7/A8 invariants and generated
    # sh:class constraints at both interpretation layers. Running them here
    # makes a weakened or disconnected shapes graph fail even when the positive
    # fixture happens to conform.
    if operation_executions:
        target = sorted(operation_executions, key=str)[0]

        missing_operation = clone_graph(data)
        missing_operation.remove((target, CHRON.executes_operation, None))
        assert_rejected(
            "missing executes_operation",
            missing_operation,
            shapes,
            "An operation execution must name the OperationDefinition it realizes.",
            failures,
        )

        missing_parameters = clone_graph(data)
        missing_parameters.remove((target, CHRON.used_parameter_set, None))
        assert_rejected(
            "missing used_parameter_set",
            missing_parameters,
            shapes,
            "An operation execution must cite the ParameterSet it ran under.",
            failures,
        )

        missing_end = clone_graph(data)
        missing_end.remove((target, PROV.endedAtTime, None))
        assert_rejected(
            "start without end",
            missing_end,
            shapes,
            "A node execution that records a start must record its end.",
            failures,
        )

        wrong_operation_class = clone_graph(data)
        wrong_operation_class.remove((target, CHRON.executes_operation, None))
        wrong_operation_class.add(
            (
                target,
                CHRON.executes_operation,
                URIRef("urn:chronicle:operation:untyped-negative-fixture"),
            )
        )
        assert_rejected(
            "executes_operation target has no OperationDefinition type",
            wrong_operation_class,
            shapes,
            "OperationDefinition",
            failures,
        )

    if query_executions:
        target = sorted(query_executions, key=str)[0]

        missing_query_parameters = clone_graph(data)
        missing_query_parameters.remove((target, CHRON.used_parameter_set, None))
        assert_rejected(
            "query execution missing used_parameter_set",
            missing_query_parameters,
            shapes,
            "A query execution must cite the ParameterSet it ran under.",
            failures,
        )

        wrong_query_class = clone_graph(data)
        wrong_query_class.remove((target, CHRON.executes_query, None))
        wrong_query_class.add(
            (
                target,
                CHRON.executes_query,
                URIRef("urn:chronicle:query:untyped-negative-fixture"),
            )
        )
        assert_rejected(
            "executes_query target has no QueryDefinition type",
            wrong_query_class,
            shapes,
            "QueryDefinition",
            failures,
        )

    print(
        f"validate_sidecar: {len(operation_executions)} root operation execution, "
        f"{len(query_executions)} physical query executions, "
        f"{len(operation_definitions)} operation definitions "
        f"({len(nested_definitions)} nested), {len(query_definitions)} query definitions"
    )
    if failures:
        print(f"validate_sidecar: {len(failures)} failure(s):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(
        "validate_sidecar OK: Rust runtime JSON-LD conforms and all negative cases are rejected."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
