"""Execution lineage + PROV-O provenance sidecar for the desktop engine.

This is the desktop mirror of the web engine's runtime lineage surfaces
(``web/src/lib/pipelineGraph/executionRecords.ts`` +
``web/src/lib/processingReport.ts``): a per-stage execution ledger and a
``chronicle-provenance.jsonld`` sidecar of ``chron:NodeExecution`` activities
that conforms to the SAME research-ontology shapes graph
(``web/schema/generated/shacl/merged.shacl.ttl``) the web sidecar is validated
against.

Design rules (kept identical to the web design on purpose):

  - The deterministic core of a stage record (id, status, row counts) is kept
    SEPARATE from its wall-clock timing (nested under ``timing``), so
    determinism-minded consumers can exclude timing by key.
  - The sidecar is DESCRIPTIVE ONLY. Building it reads frame heights and file
    bytes and writes one extra JSON file next to the CSV outputs — it never
    mutates a frame, changes a row, or alters the CSV outputs. The parameter
    set is a content address (sha256 of the canonicalized options), minted as a
    ``chron:ParameterSet`` node in the same document, in the same
    content-addressed spirit as the web ``buildParameterSetRecord``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, fields
from datetime import UTC, datetime, timedelta
from enum import Enum
from pathlib import Path
from time import perf_counter
from typing import Any
from urllib.parse import quote

from chronicle_preprocessing_app.core.config import PreprocessingOptions

# File name of the emitted sidecar (bundled next to the CSV outputs).
PROVENANCE_SIDECAR_FILENAME = "chronicle-provenance.jsonld"

# Status strings for a stage record (mirrors the web StepExecutionCore.status).
STATUS_RAN = "ran"
STATUS_BYPASSED = "bypassed"

# Option fields excluded from the content-addressed parameter set: runtime
# injections that carry no reproducibility meaning and are not JSON-serializable
# (an injected survey DataFrame, an orchestrator-provided sharing map).
_EXCLUDED_OPTION_FIELDS: frozenset[str] = frozenset({"survey_data_df", "device_sharing_status_map"})

# @context prefixes — byte-identical to the web sidecar's @context so the two
# surfaces' documents share one vocabulary (web/src/lib/processingReport.ts).
_JSONLD_CONTEXT: dict[str, str] = {
    "prov": "http://www.w3.org/ns/prov#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "dcterms": "http://purl.org/dc/terms/",
    "chron": "https://w3id.org/chronicle-usage-ontology/core/",
    "chronicle": "https://chronicle.local/schemas/",
}


@dataclass
class StageTiming:
    """Wall-clock timing for one stage — kept separate from the deterministic core."""

    started_at: str
    ended_at: str
    duration_ms: float


@dataclass
class StageExecutionRecord:
    """One desktop pipeline stage's execution record.

    The desktop analogue of the web ``StepExecutionRecord``: a deterministic
    core (``stage_id``, ``status``, ``rows_in``, ``rows_out``) plus a nested
    wall-clock ``timing`` object determinism assertions can exclude.
    """

    stage_id: str
    status: str
    rows_in: int | None
    rows_out: int | None
    timing: StageTiming


@dataclass
class OutputArtifact:
    """A CSV output the run produced (descriptive provenance only)."""

    name: str
    row_count: int | None
    kind: str


class _StageHandle:
    """Mutable handle yielded by :meth:`LineageCollector.stage`.

    The caller fills ``rows_out`` (and may override ``rows_in`` / ``status``)
    inside the ``with`` body; the collector reads it back when the body exits.
    """

    def __init__(self, stage_id: str, rows_in: int | None, status: str) -> None:
        self.stage_id = stage_id
        self.rows_in = rows_in
        self.rows_out: int | None = None
        self.status = status


class LineageCollector:
    """Append-only per-run ledger of :class:`StageExecutionRecord`.

    One collector is created per processed file. Each stage is timed by the
    :meth:`stage` context manager, which appends a record when the body exits
    (even if the body raised — the partial record is still recorded, then the
    exception propagates).
    """

    def __init__(self, unit_id: str) -> None:
        self.unit_id = unit_id
        self.records: list[StageExecutionRecord] = []

    @contextmanager
    def stage(
        self,
        stage_id: str,
        *,
        rows_in: int | None = None,
        status: str = STATUS_RAN,
    ) -> Iterator[_StageHandle]:
        handle = _StageHandle(stage_id, rows_in, status)
        started = datetime.now(UTC)
        start_perf = perf_counter()
        try:
            yield handle
        finally:
            elapsed_seconds = max(0.0, perf_counter() - start_perf)
            # ended is derived from started + measured elapsed, so
            # started_at <= ended_at holds unconditionally (no dependence on a
            # second wall-clock read that a clock adjustment could move back).
            ended = started + timedelta(seconds=elapsed_seconds)
            self.records.append(
                StageExecutionRecord(
                    stage_id=handle.stage_id,
                    status=handle.status,
                    rows_in=handle.rows_in,
                    rows_out=handle.rows_out,
                    timing=StageTiming(
                        started_at=_format_instant(started),
                        ended_at=_format_instant(ended),
                        duration_ms=round(elapsed_seconds * 1000.0, 3),
                    ),
                )
            )


def _format_instant(value: datetime) -> str:
    """ISO-8601 UTC instant with millisecond precision and a trailing ``Z``.

    Matches the web sidecar's ``xsd:dateTime`` literals (e.g.
    ``2026-01-01T00:00:00.000Z``).
    """
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def utc_now_instant() -> str:
    """Current instant formatted as an ISO-8601 UTC ``xsd:dateTime`` literal."""
    return _format_instant(datetime.now(UTC))


def sha256_file(path: Path | str) -> str | None:
    """SHA-256 hex digest of a file's bytes, or ``None`` if it cannot be read."""
    try:
        digest = hashlib.sha256()
        with Path(path).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _canonicalize(value: Any) -> Any:
    """Recursively convert an option value into a JSON-safe, deterministic form.

    Sets are sorted (order-independent), enums collapse to their value, Paths to
    strings — so two option objects that differ only in insertion/iteration
    order canonicalize identically (a true content address).
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Enum):
        return _canonicalize(value.value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _canonicalize(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        return sorted(
            (_canonicalize(item) for item in value),
            key=lambda item: json.dumps(item, sort_keys=True, default=str),
        )
    if isinstance(value, (list, tuple)):
        return [_canonicalize(item) for item in value]
    return str(value)


def parameter_set_sha256(options: PreprocessingOptions) -> str:
    """Content-addressed SHA-256 of the full processing options.

    Canonical JSON (recursively sorted keys, sets sorted, no whitespace) of every
    option field except the runtime-only injections in
    :data:`_EXCLUDED_OPTION_FIELDS`.
    """
    payload = {
        field.name: _canonicalize(getattr(options, field.name))
        for field in fields(options)
        if field.name not in _EXCLUDED_OPTION_FIELDS
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _instant_literal(value: str) -> dict[str, str]:
    return {"@value": value, "@type": "xsd:dateTime"}


def _row_counts(rows_in: int | None, rows_out: int | None) -> dict[str, int]:
    counts: dict[str, int] = {}
    if rows_in is not None:
        counts["chronicle:rowsIn"] = rows_in
    if rows_out is not None:
        counts["chronicle:rowsOut"] = rows_out
    return counts


def _node_execution(
    *,
    iri: str,
    step_iri: str,
    timing: StageTiming,
    parameter_set_iri: str,
    run_iri: str,
    label: str,
    status: str,
    rows_in: int | None,
    rows_out: int | None,
    part_of_iri: str | None = None,
) -> dict[str, Any]:
    """One ``chron:NodeExecution`` activity node (unit- or stage-scale)."""
    node: dict[str, Any] = {
        "@id": iri,
        "@type": ["prov:Activity", "chron:NodeExecution"],
        "chron:executes_step": {"@id": step_iri},
        "chron:used_parameter_set": {"@id": parameter_set_iri},
        "prov:startedAtTime": _instant_literal(timing.started_at),
        "prov:endedAtTime": _instant_literal(timing.ended_at),
        "prov:wasInformedBy": {"@id": run_iri},
        "rdfs:label": label,
        "chronicle:status": status,
        **_row_counts(rows_in, rows_out),
    }
    if part_of_iri is not None:
        node["dcterms:isPartOf"] = {"@id": part_of_iri}
    return node


def build_provenance_jsonld(
    *,
    run_id: str,
    generated_at: str,
    preprocessor_version: str,
    parameter_set_sha256: str,
    input_file_name: str,
    input_sha256: str | None,
    outputs: list[OutputArtifact],
    records: list[StageExecutionRecord],
    unit_id: str,
) -> str:
    """Build the ``chronicle-provenance.jsonld`` document (pretty-printed JSON).

    Mirrors ``buildProvenanceJsonLd`` in ``web/src/lib/processingReport.ts``:
    the run is a ``prov:Activity`` that used each raw input and the ParameterSet
    entity, associated with the preprocessor SoftwareAgent, generating each
    output entity — plus a unit-scale ``chron:NodeExecution`` for the whole file
    processing and one stage-scale ``chron:NodeExecution`` per pipeline stage
    (``dcterms:isPartOf`` the unit), each executing a minted
    ``chron:StepDefinition`` and citing the ParameterSet.
    """
    run_iri = f"urn:uuid:{run_id}"
    agent_iri = f"urn:chronicle:agent:preprocessor:{preprocessor_version}"
    parameter_set_iri = f"urn:chronicle:parameterset:sha256:{parameter_set_sha256}"
    scope = f"{run_id}:{quote(input_file_name, safe='')}"
    unit_exec_iri = f"urn:chronicle:nodeexec:{scope}:{unit_id}"
    unit_step_iri = f"urn:chronicle:step:{unit_id}"

    # StepDefinition plan nodes (deduped): the unit, and one per stage that is a
    # dcterms:isPartOf the unit (recursive composition — the ontology's
    # part_of_step slot declares slot_uri dcterms:isPartOf).
    step_definitions: list[dict[str, Any]] = [
        {
            "@id": unit_step_iri,
            "@type": "chron:StepDefinition",
            "chron:step_id": unit_id,
            "rdfs:label": unit_id,
        }
    ]
    seen_step_ids = {unit_id}
    for record in records:
        if record.stage_id in seen_step_ids:
            continue
        seen_step_ids.add(record.stage_id)
        step_definitions.append(
            {
                "@id": f"urn:chronicle:step:{record.stage_id}",
                "@type": "chron:StepDefinition",
                "chron:step_id": record.stage_id,
                "rdfs:label": record.stage_id,
                "dcterms:isPartOf": {"@id": unit_step_iri},
            }
        )

    # NodeExecution activities: a unit-scale execution spanning the run, then one
    # stage-scale execution per record nested under it.
    unit_timing = _unit_timing(records)
    unit_rows_in = records[0].rows_in if records else None
    unit_rows_out = records[-1].rows_out if records else None
    node_executions: list[dict[str, Any]] = [
        _node_execution(
            iri=unit_exec_iri,
            step_iri=unit_step_iri,
            timing=unit_timing,
            parameter_set_iri=parameter_set_iri,
            run_iri=run_iri,
            label=f"{unit_id} ({STATUS_RAN})",
            status=STATUS_RAN,
            rows_in=unit_rows_in,
            rows_out=unit_rows_out,
        )
    ]
    for record in records:
        node_executions.append(
            _node_execution(
                iri=f"{unit_exec_iri}:{record.stage_id}",
                step_iri=f"urn:chronicle:step:{record.stage_id}",
                timing=record.timing,
                parameter_set_iri=parameter_set_iri,
                run_iri=run_iri,
                label=f"{unit_id}/{record.stage_id} ({record.status})",
                status=record.status,
                rows_in=record.rows_in,
                rows_out=record.rows_out,
                part_of_iri=unit_exec_iri,
            )
        )

    input_iri = (
        f"urn:chronicle:input:sha256:{input_sha256}"
        if input_sha256
        else f"urn:chronicle:input:name:{quote(input_file_name, safe='')}"
    )
    input_entity: dict[str, Any] = {
        "@id": input_iri,
        "@type": "prov:Entity",
        "rdfs:label": input_file_name,
    }
    if input_sha256:
        input_entity["chronicle:sha256"] = input_sha256

    output_entities: list[dict[str, Any]] = []
    for output in outputs:
        entity: dict[str, Any] = {
            "@id": f"urn:chronicle:output:{run_id}:{quote(output.name, safe='')}",
            "@type": "prov:Entity",
            "rdfs:label": output.name,
            "chronicle:outputKind": output.kind,
            "prov:wasGeneratedBy": {"@id": run_iri},
            "prov:wasDerivedFrom": {"@id": input_iri},
        }
        if output.row_count is not None:
            entity["chronicle:rowCount"] = output.row_count
        output_entities.append(entity)

    graph: list[dict[str, Any]] = [
        {
            "@id": run_iri,
            "@type": "prov:Activity",
            "rdfs:label": "Chronicle Android raw data preprocessing run",
            "prov:endedAtTime": _instant_literal(generated_at),
            "prov:wasAssociatedWith": {"@id": agent_iri},
            "prov:used": [
                {"@id": input_iri},
                {"@id": parameter_set_iri},
            ],
        },
        {
            "@id": agent_iri,
            "@type": ["prov:Agent", "prov:SoftwareAgent"],
            "rdfs:label": f"Chronicle Android raw data preprocessor {preprocessor_version}",
            "chronicle:version": preprocessor_version,
        },
        {
            "@id": parameter_set_iri,
            "@type": ["prov:Entity", "chron:ParameterSet"],
            "rdfs:label": "ParameterSet (full processing options, canonical JSON)",
            "chronicle:sha256": parameter_set_sha256,
            "chron:parameter_set_sha256": parameter_set_sha256,
        },
        input_entity,
        *output_entities,
        *step_definitions,
        *node_executions,
    ]

    return json.dumps({"@context": _JSONLD_CONTEXT, "@graph": graph}, indent=2)


def _unit_timing(records: list[StageExecutionRecord]) -> StageTiming:
    """Span timing for the unit execution: earliest start, latest end.

    Duration is the summed stage wall-clock (the stages run sequentially), which
    stays well-defined even when a stage's rounded start/end coincide.
    """
    if not records:
        instant = utc_now_instant()
        return StageTiming(started_at=instant, ended_at=instant, duration_ms=0.0)
    started_at = min(record.timing.started_at for record in records)
    ended_at = max(record.timing.ended_at for record in records)
    duration_ms = round(sum(record.timing.duration_ms for record in records), 3)
    return StageTiming(started_at=started_at, ended_at=ended_at, duration_ms=duration_ms)
