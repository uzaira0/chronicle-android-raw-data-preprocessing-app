"""The desktop engine emits a valid PROV-O execution-lineage sidecar.

Runs the real preprocessing engine on the pathological fixture (weeks=1) and
asserts the emitted ``chronicle-provenance.jsonld`` carries per-stage
``chron:NodeExecution`` activities that each cite a ParameterSet and record a
start no later than their end — then SHACL-validates the whole document against
the SAME merged shapes graph the web sidecar is validated against
(``web/schema/generated/shacl/merged.shacl.ttl``), skipping cleanly if pyshacl
is not installed.

This is the desktop mirror of ``web/schema/tests/validate_sidecar.py``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from chronicle_preprocessing_app.config.constants import (
    TimezoneHandlingOption,
    UsageSessionMode,
)
from chronicle_preprocessing_app.core.config import PreprocessingOptions
from chronicle_preprocessing_app.core.lineage import PROVENANCE_SIDECAR_FILENAME
from chronicle_preprocessing_app.core.preprocessing.main_preprocessor import (
    ChronicleAndroidRawDataPreprocessor,
)
from chronicle_preprocessing_app.utils.pathological_fixture_builder import (
    FixtureBuildConfig,
    build_pathological_raw_dataframe,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
MERGED_SHAPES = REPO_ROOT / "web" / "schema" / "generated" / "shacl" / "merged.shacl.ttl"

CHRON = "https://w3id.org/chronicle-usage-ontology/core/"


def _run_engine(tmp_path: Path) -> Path:
    """Run the engine on the weeks=1 fixture; return the emitted sidecar path."""
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=1))
    raw_path = raw_dir / "Raw P01.csv"
    raw_df.write_csv(raw_path)

    options = PreprocessingOptions(
        study_name="Lineage Fixture",
        raw_data_folder=raw_dir,
        use_app_codebook=False,
        use_filter_file=False,
        use_apps_forcing_screen_open_file=False,
        # APP_AND_SCREEN routes through the legacy stage-by-stage loop, so the
        # ledger carries the full timestamp/timezone/screen-usage/app-usage/write
        # stage set the instrumentation targets.
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
        selected_timezone="America/Chicago",
        timezone_handling_option=TimezoneHandlingOption.CONVERT_ALL_DATA_TO_SELECTED_TIMEZONE,
        enable_plotting=False,
        parallel_processing=False,
        datetime_of_preprocessing_override="2026-04-24 00:32:53",
    )
    preprocessor = ChronicleAndroidRawDataPreprocessor(options)
    output_folder, success, _ = preprocessor.preprocess_Chronicle_Android_raw_data_file(raw_path)
    assert success, "engine reported no output for the fixture"
    return Path(output_folder) / PROVENANCE_SIDECAR_FILENAME


def _node_types(node: dict[str, Any]) -> set[str]:
    node_type = node.get("@type", [])
    return set(node_type if isinstance(node_type, list) else [node_type])


def test_sidecar_has_valid_node_executions(tmp_path: Path) -> None:
    sidecar = _run_engine(tmp_path)
    assert sidecar.exists(), f"sidecar not emitted at {sidecar}"

    document = json.loads(sidecar.read_text(encoding="utf-8"))
    graph = document["@graph"]

    # The sidecar is compact JSON-LD: @type carries prefixed CURIEs verbatim.
    parameter_sets = [node for node in graph if "chron:ParameterSet" in _node_types(node)]
    assert parameter_sets, "no chron:ParameterSet node minted in the sidecar"

    executions = [node for node in graph if "chron:NodeExecution" in _node_types(node)]
    # A unit-scale execution plus one per stage (read/timestamp/timezone/
    # screen_usage/app_usage/write).
    assert len(executions) >= 6, f"expected per-stage NodeExecutions, found {len(executions)}"

    stage_executions = [node for node in executions if "dcterms:isPartOf" in node]
    stage_statuses = {node["chronicle:status"] for node in stage_executions}
    assert stage_executions, "no stage-scale NodeExecutions (dcterms:isPartOf a unit) found"
    assert stage_statuses <= {"ran", "bypassed"}, f"unexpected stage statuses: {stage_statuses}"

    for execution in executions:
        assert "chron:executes_step" in execution, f"{execution['@id']} has no executes_step"
        assert "chron:used_parameter_set" in execution, (
            f"{execution['@id']} does not cite a ParameterSet"
        )
        started = execution["prov:startedAtTime"]["@value"]
        ended = execution["prov:endedAtTime"]["@value"]
        # Fixed-format ISO-8601 UTC literals sort chronologically as strings.
        assert started <= ended, f"{execution['@id']} started after it ended"


def test_sidecar_conforms_to_merged_shapes(tmp_path: Path) -> None:
    pyshacl = pytest.importorskip("pyshacl")
    from rdflib import RDF, Graph, Namespace

    assert MERGED_SHAPES.exists(), f"merged shapes graph missing at {MERGED_SHAPES}"
    sidecar = _run_engine(tmp_path)
    assert sidecar.exists()

    sh = Namespace("http://www.w3.org/ns/shacl#")
    chron = Namespace(CHRON)
    prov = Namespace("http://www.w3.org/ns/prov#")
    dcterms = Namespace("http://purl.org/dc/terms/")

    data = Graph()
    data.parse(sidecar, format="json-ld")
    shapes = Graph()
    shapes.parse(MERGED_SHAPES, format="turtle")

    # Relax ONLY closed-world enforcement — the sidecar is a PROV-idiomatic
    # projection carrying annotation properties beyond the LinkML core (rdfs:label,
    # prov:*, dcterms:isPartOf, chronicle:* counters). Mirrors
    # web/schema/tests/validate_sidecar.py. pyshacl rejects sh:ignoredProperties
    # without sh:closed, so both go together.
    for triple in list(shapes.triples((None, sh.closed, None))):
        shapes.remove(triple)
    for triple in list(shapes.triples((None, sh.ignoredProperties, None))):
        shapes.remove(triple)

    conforms, _graph, report = pyshacl.validate(
        data, shacl_graph=shapes, inference="none", advanced=True
    )
    assert conforms, f"sidecar does not conform to merged shapes:\n{report}"

    executions = set(data.subjects(RDF.type, chron.NodeExecution))
    step_execs = {e for e in executions if (e, dcterms.isPartOf, None) in data}
    unit_execs = executions - step_execs
    assert unit_execs, "no unit-scale NodeExecutions"
    assert step_execs, "no step-scale NodeExecutions"
    for execution in executions:
        step = data.value(execution, chron.executes_step)
        assert step is not None
        assert (step, RDF.type, chron.StepDefinition) in data
        assert data.value(execution, chron.used_parameter_set) is not None
        assert data.value(execution, prov.startedAtTime) is not None
        assert data.value(execution, prov.endedAtTime) is not None
