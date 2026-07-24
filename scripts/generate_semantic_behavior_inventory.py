#!/usr/bin/env python3
"""Freeze the preprocessing app's current Rust/WASM authority and product plan.

The generated YAML remains a structural source projection, never an executable
body. This generator verifies every reporting group and declared step, records
the 55-query Salsa implementation as the production computation authority,
and records the fused implementation only as an independent cold-test oracle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
GRAPH_YAML = ROOT / "web/schema/chronicle-pipeline-graph.yaml"
LOCAL_CONTRACT = ROOT / "web/schema/chronicle-local-contract.linkml.yaml"
GRAPH_DEF = ROOT / "web/src/lib/pipelineGraph/graphDef.ts"
PIPELINE_V2 = ROOT / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs"
PIPELINE_INCREMENTAL = (
    ROOT / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs"
)
STEP_CONTRACT = ROOT / "rust/chronicle_chrono_kernel_wasm/src/step_contract.rs"
KERNEL_MANIFEST = ROOT / "rust/chronicle_chrono_kernel_wasm/Cargo.toml"
MATCHER_WASM = ROOT / "rust/chronicle_app_usage_wasm"
TYPESCRIPT_PIPELINE = ROOT / "web/src/lib/browserPipeline.ts"
TYPESCRIPT_GRAPH = ROOT / "web/src/lib/pipelineGraph"
FEDERATION = ROOT / ".semantic-federation"
RESOURCE_ROOT = FEDERATION / "semantic/resources"
PLAN_OUTPUT = RESOURCE_ROOT / "chronicle.plan.json"
RUNTIME_AUTHORITY_OUTPUT = RESOURCE_ROOT / "runtime-authority.json"
BINDINGS_OUTPUT = FEDERATION / "semantic/capability-bindings.json"
INVENTORY_OUTPUT = ROOT / "docs/semantic-federation/behavior-inventory.json"
DEPENDENCY_CERTIFICATE_OUTPUT = (
    FEDERATION / "proofs/dependency-certificate.json"
)
PROOF_LEDGER_ROOT = (
    ROOT / "web/src/lib/pipelineGraph/golden/family-expected"
)
DEPENDENCY_PROOF_LEDGERS = [
    "configuration-influence-ledger.json",
    "artifact-influence-ledger.json",
    "raw-boundary-influence-ledger.json",
    "interaction-influence-ledger.json",
    "mixed-artifact-configuration-ledger.json",
    "semantic-model-mutation-ledger.json",
]

BASE_REF = "5f8e64527edd33f90901cd553602063daadf0014"
FEATURE_REF = "b857be0382777892d4fa8c8a3a48934b07e6ad0c"

UNIT_MODULES = {
    "parse_events": "parseEvents.ts",
    "normalize_timezones": "normalizeTimezones.ts",
    "dedup_and_order": "dedupAndOrder.ts",
    "app_policy": "appPolicy.ts",
    "device_state_timeline": "deviceStateTimeline.ts",
    "reconstruct_episodes": "reconstructEpisodes.ts",
    "categorize_apps": "categorizeApps.ts",
    "episode_annotations": "episodeAnnotations.ts",
    "interval_cleaning": "intervalCleaning.ts",
    "effective_usage": "effectiveUsage.ts",
    "observation_window": "observationWindow.ts",
    "attribute_person": "attributePerson.ts",
    "day_coverage": "dayCoverage.ts",
    "score_compliance": "scoreCompliance.ts",
    "outputs": "outputs.ts",
}

RUNTIME_CAPABILITY_PREFIX = (
    "urn:uzaira0:semantic-federation:chronicle-preprocessing:capability/runtime"
)


def runtime_capability(identifier: str) -> str:
    return f"{RUNTIME_CAPABILITY_PREFIX}/{identifier}/v1"


def rust_surface(surface_id: str, category: str, path: str, entrypoint: str) -> dict:
    return {
        "surface_id": surface_id,
        "capability_id": runtime_capability(surface_id.replace("_", "-")),
        "category": category,
        "current": {
            "language": "rust",
            "path": path,
            "entrypoint": entrypoint,
            "status": "active-production-authority",
        },
        "target": {
            "language": "rust",
            "path": path,
            "entrypoint": entrypoint,
            "status": "active",
        },
        "requires_active_authority": True,
    }


RUNTIME_SURFACES = [
    rust_surface(
        "tracked_physical_pipeline",
        "product-computation",
        "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs",
        "IncrementalPipelineV2Engine",
    ),
    {
        **rust_surface(
            "product_stage_projection",
            "semantic-projection",
            "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
            "project_product_stages",
        ),
        "does_not_schedule_physical_queries": True,
    },
    rust_surface(
        "dependency_certificate",
        "semantic-validation",
        "rust/chronicle_preprocessing_semantic_adapter/src/dependency_cache.rs",
        "evaluate_dependency_cache_decision",
    ),
    rust_surface(
        "role_materialization",
        "semantic-computation",
        "rust/chronicle_preprocessing_semantic_adapter/src/materialize.rs",
        "evaluate_materialization",
    ),
    rust_surface(
        "deterministic_role_qualification",
        "semantic-validation",
        "rust/chronicle_preprocessing_semantic_adapter/src/qualify.rs",
        "qualify_candidates",
    ),
    rust_surface(
        "typed_logical_checkpoints",
        "evidence-authority",
        "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs",
        "logical_stage_checkpoint",
    ),
    rust_surface(
        "execution_evidence",
        "evidence-authority",
        "rust/chronicle_preprocessing_semantic_adapter/src/journal.rs",
        "pub fn append",
    ),
    rust_surface(
        "request_validation",
        "semantic-validation",
        "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
        "fn validate",
    ),
    rust_surface(
        "requirements_evaluation",
        "semantic-validation",
        "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
        "evaluate_workspace_requirements_native",
    ),
    rust_surface(
        "support_file_parsing",
        "semantic-validation",
        "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
        "fn resolve",
    ),
    rust_surface(
        "proximity_matcher_branch",
        "product-computation",
        "rust/chronicle_app_usage_matcher/src/lib.rs",
        "match_app_usage_update_indices_with_proximity_core",
    ),
    rust_surface(
        "aggregate_exports",
        "artifact-computation",
        "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_aggregates.rs",
        "build_aggregate_outputs",
    ),
    rust_surface(
        "parquet_encoding",
        "artifact-computation",
        "rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs",
        "parquet_from_csv",
    ),
    rust_surface(
        "spss_encoding",
        "artifact-computation",
        "rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs",
        "sav_from_csv",
    ),
    rust_surface(
        "review_metrics",
        "semantic-computation",
        "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs",
        "build_review_summary",
    ),
    rust_surface(
        "row_lineage",
        "evidence-authority",
        "rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs",
        "row_lineage_arrow",
    ),
    rust_surface(
        "source_coordinate_index",
        "evidence-authority",
        "rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs",
        "source_coordinate_index_arrow",
    ),
    rust_surface(
        "result_cell_correspondence",
        "evidence-authority",
        "rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs",
        "result_cell_correspondence_arrow",
    ),
    rust_surface(
        "bidirectional_correspondence",
        "evidence-authority",
        "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
        "build_correspondence_index",
    ),
    rust_surface(
        "typed_views",
        "semantic-projection",
        "rust/chronicle_preprocessing_semantic_adapter/src/views.rs",
        "stage_view",
    ),
    rust_surface(
        "artifact_closure",
        "storage-authority",
        "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
        "build_artifact_closure",
    ),
    rust_surface(
        "configuration_family",
        "semantic-computation",
        "rust/chronicle_preprocessing_runtime_wasm/src/configuration_family.rs",
        "compile_configuration_family",
    ),
    rust_surface(
        "semantic_index",
        "semantic-projection",
        "rust/chronicle_semantic_index_wasm/src/lib.rs",
        "rebuild_semantic_index",
    ),
    rust_surface(
        "registered_query",
        "semantic-projection",
        "rust/chronicle_semantic_index_wasm/src/lib.rs",
        "query_registered",
    ),
]

def digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def closure_digest(paths: list[Path]) -> str:
    # Implementation identity covers repository build inputs, never local tool
    # output or proof fixtures. In particular cargo-mutants writes mutable
    # reports beside each crate, while the TypeScript reference tree stores
    # goldens and tests beside production modules. Including either makes a
    # test/evidence update change the claimed executable build even though no
    # production input changed.
    transient_parts = {
        ".git",
        "__snapshots__",
        "__pycache__",
        "benches",
        "examples",
        "family-expected",
        "golden",
        "mutants.out",
        "mutants.out.old",
        "target",
        "test-results",
        "tests",
    }
    non_build_names = {"validationHarness.ts"}
    non_build_markers = (".spec.", ".test.")

    def is_build_input(root: Path, item: Path) -> bool:
        relative = item.relative_to(root)
        return (
            not transient_parts.intersection(relative.parts)
            and item.name != ".DS_Store"
            and item.name not in non_build_names
            and not any(marker in item.name for marker in non_build_markers)
        )

    payload = hashlib.sha256()
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            for current, directories, names in os.walk(path):
                directories[:] = sorted(
                    name
                    for name in directories
                    if name not in transient_parts and name != ".DS_Store"
                )
                for name in sorted(names):
                    item = Path(current) / name
                    if is_build_input(path, item):
                        files.append(item)
        else:
            files.append(path)
    for path in sorted({item for item in files if item.is_file()}):
        payload.update(str(path.relative_to(ROOT)).encode("utf-8"))
        payload.update(b"\0")
        payload.update(hashlib.sha256(path.read_bytes()).digest())
    return "sha256:" + payload.hexdigest()


def rust_runtime_implementation_digest() -> str:
    """Read the production-source digest from the runtime's sole authority.

    The runtime build script parses Rust with ``syn`` and removes ``cfg(test)``
    items before hashing. Calling its tiny example keeps profile bindings and
    the compiled runtime on the same algorithm instead of reimplementing Rust
    parsing in this Python generator.
    """
    result = subprocess.run(
        [
            "cargo",
            "run",
            "--quiet",
            "--manifest-path",
            str(ROOT / "rust/chronicle_preprocessing_runtime_wasm/Cargo.toml"),
            "--example",
            "implementation_digest",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "CHRONICLE_REPOSITORY_ROOT": str(ROOT),
            "CHRONICLE_SEMANTIC_ROOT": str(FEDERATION / "semantic"),
        },
    )
    value = result.stdout.strip()
    if not value.startswith("sha256:") or len(value) != 71:
        raise RuntimeError(f"runtime returned an invalid implementation digest: {value!r}")
    return value


def rendered_digest(value: dict) -> str:
    rendered = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return "sha256:" + hashlib.sha256(rendered).hexdigest()


def canonical_digest(value: object) -> str:
    rendered = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(rendered).hexdigest()


def configuration_axes() -> dict[str, list[str]]:
    contract = yaml.safe_load(LOCAL_CONTRACT.read_text(encoding="utf-8"))
    option_slots = (
        contract["classes"]["BrowserProcessingOptions"]["slots"]
        + contract["classes"]["BrowserProcessingRuntime"]["slots"]
    )
    axes = {"computational": [], "annotation": [], "view": [], "execution": []}
    for option_key in option_slots:
        slot = contract["slots"][option_key]
        axis = slot.get("annotations", {}).get("configuration_axis", "computational")
        if axis not in axes:
            raise RuntimeError(
                f"invalid configuration axis {axis!r} for {option_key}"
            )
        axes[axis].append(option_key)
    return {axis: sorted(keys) for axis, keys in axes.items()}


def dependency_binding_surface(plan: dict) -> dict:
    option_bindings: dict[str, list[dict]] = {}
    role_bindings: dict[str, list[dict]] = {
        "raw_chronicle_csv": [{"kind": "raw-input", "node_id": "parse_events"}],
        "processing_options": [
            {"kind": "configuration-source", "node_id": "*"}
        ],
    }
    for node in plan["nodes"]:
        for knob in node["knobs"]:
            option_bindings.setdefault(knob["option_key"], []).append(
                {"edge": knob["edge"], "node_id": node["node_id"]}
            )
        for role_id in node["support_roles"]:
            role_bindings.setdefault(role_id, []).append(
                {"kind": "support-input", "node_id": node["node_id"]}
            )
    for bindings in option_bindings.values():
        bindings.sort(key=lambda binding: (binding["node_id"], binding["edge"]))
    for bindings in role_bindings.values():
        bindings.sort(key=lambda binding: (binding["node_id"], binding["kind"]))
    return {
        "option_bindings": dict(sorted(option_bindings.items())),
        "role_bindings": dict(sorted(role_bindings.items())),
    }


def build_dependency_certificate(plan: dict) -> dict:
    axes = configuration_axes()
    cache_relevant = sorted(axes["computational"] + axes["annotation"])
    excluded = sorted(axes["view"] + axes["execution"])
    plan_options = sorted(
        {
            knob["option_key"]
            for node in plan["nodes"]
            for knob in node["knobs"]
        }
    )
    if cache_relevant != plan_options:
        raise RuntimeError(
            "cache-relevant LinkML options do not exactly match plan knob bindings: "
            f"missing={sorted(set(cache_relevant) - set(plan_options))} "
            f"unexpected={sorted(set(plan_options) - set(cache_relevant))}"
        )

    role_ids = sorted(role["role_id"] for role in plan["root_roles"])
    surface = dependency_binding_surface(plan)
    unbound_roles = sorted(set(role_ids) - set(surface["role_bindings"]))
    if unbound_roles:
        raise RuntimeError(f"unbound dependency roles: {unbound_roles}")

    ledgers = []
    receipts = []
    for name in DEPENDENCY_PROOF_LEDGERS:
        path = PROOF_LEDGER_ROOT / name
        ledger = json.loads(path.read_text(encoding="utf-8"))
        receipt = ledger.get("implementationReceipt")
        if not isinstance(receipt, dict):
            raise RuntimeError(f"proof ledger lacks implementation receipt: {path}")
        receipts.append(receipt)
        ledgers.append(
            {
                "path": str(path.relative_to(ROOT)),
                "digest": digest(path),
                "protocol_version": ledger.get("protocolVersion"),
                "claim_boundary": ledger.get("claimBoundary"),
            }
        )
    receipt_strings = {
        json.dumps(receipt, sort_keys=True, separators=(",", ":"))
        for receipt in receipts
    }
    if len(receipt_strings) != 1:
        raise RuntimeError("dependency proof ledgers do not share one authority receipt")

    return {
        "protocol_version": "chronicle-dependency-certificate/v1",
        "certificate_id": (
            "urn:uzaira0:semantic-federation:chronicle-preprocessing:"
            "dependency-certificate/v1"
        ),
        "structural_contract": {
            "plan_digest": rendered_digest(plan),
            "configuration_axes": axes,
            "cache_relevant_option_keys": cache_relevant,
            "excluded_option_keys": excluded,
            "role_ids": role_ids,
            "binding_surface": surface,
            "binding_surface_digest": canonical_digest(surface),
            "unclassified_option_keys": [],
            "unbound_role_ids": [],
        },
        "evidence": {
            "implementation_receipt": receipts[0],
            "proof_ledgers": ledgers,
        },
        "narrowing_policy": {
            "certified_surface": "classified-product-input-surface-plus-exact-query-reads",
            "unknown_option": "discard-query-state-and-run-all-55-queries-cold",
            "missing_option": "discard-query-state-and-run-all-55-queries-cold",
            "unknown_role": "fail-closed",
            "certificate_mismatch": "discard-query-state-and-run-all-55-queries-cold",
            "stale_empirical_evidence": "release-blocking",
            "code_or_contract_change": "discard-query-state-and-run-all-55-queries-cold",
        },
        "claim_boundary": (
            "The certificate proves complete classification and binding of the current "
            "product option/role surface and binds the named empirical ledgers. Salsa's "
            "actual query reads decide physical reuse; the 15 product stages are derived "
            "views and do not schedule work. Empirical absence-of-effect claims remain "
            "bounded by each ledger's claim boundary. Unknown or mismatched state discards "
            "incremental query state and runs all 55 Rust queries cold."
        ),
    }


def source_path_for_unit(unit_id: str) -> Path:
    return ROOT / "web/src/lib/pipelineGraph/steps" / UNIT_MODULES[unit_id]


def independently_callable_rust_steps(step_ids: list[str]) -> list[str]:
    source = PIPELINE_INCREMENTAL.read_text(encoding="utf-8")
    tracked_functions = set(
        re.findall(
            r"#\[salsa::tracked\([^\]]*\)\]\s*fn\s+([a-z0-9_]+)\s*\(",
            source,
        )
    )
    unknown = sorted(tracked_functions - set(step_ids))
    if unknown:
        raise RuntimeError(f"tracked Rust queries are absent from the 55-step contract: {unknown}")
    return [step_id for step_id in step_ids if step_id in tracked_functions]


def rust_step_contract() -> dict:
    result = subprocess.run(
        [
            "cargo",
            "run",
            "--quiet",
            "--manifest-path",
            str(KERNEL_MANIFEST),
            "--features",
            "incremental-v2",
            "--bin",
            "export_pipeline_step_contract",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    contract = json.loads(result.stdout)
    if contract.get("protocolVersion") != "chronicle-preprocessing-step-contract/v3":
        raise RuntimeError("unsupported Rust step contract protocol")
    return contract


def capability(kind: str, identifier: str) -> str:
    return f"urn:uzaira0:semantic-federation:chronicle-preprocessing:capability/{kind}/{identifier}/v1"


def load_and_verify() -> dict:
    projection = yaml.safe_load(GRAPH_YAML.read_text(encoding="utf-8"))
    nodes = projection["graph_nodes"]
    steps = projection["graph_steps"]
    if len(nodes) != 15 or len(steps) != 55:
        raise RuntimeError(f"expected 15 nodes/55 steps, found {len(nodes)}/{len(steps)}")

    rust_source = PIPELINE_V2.read_text(encoding="utf-8")
    for function in (
        "parse_raw_rows",
        "dedupe_exact_rows",
        "mark_data_time_gaps",
        "derive_screen_usage_sessions_full",
        "run_app_usage_algorithm",
        "join_codebook",
        "run_pipeline_v2",
    ):
        if f"fn {function}" not in rust_source and f"pub fn {function}" not in rust_source:
            raise RuntimeError(f"missing expected Rust migration base: {function}")
    return projection


def build_plan(projection: dict) -> dict:
    rust_contract = rust_step_contract()
    rust_groups = {group["id"]: group for group in rust_contract["groups"]}
    rust_steps = {step["id"]: step for step in rust_contract["steps"]}
    nodes = []
    for node in projection["graph_nodes"]:
        node_id = node["node_id"]
        rust_group = rust_groups[node_id]
        nodes.append(
            {
                "node_id": node_id,
                "label": node["node_label"],
                "section": node["section"],
                "capability_id": capability("node", node_id),
                "input_nodes": node.get("node_inputs", []),
                "output_role": f"urn:uzaira0:semantic-federation:chronicle-preprocessing:role/node-output/{node_id}",
                "knobs": [
                    {"option_key": knob["optionKey"], "edge": knob["edge"]}
                    for knob in rust_group["knobs"]
                ],
                "support_roles": rust_group["supportRoles"],
                "applicability": rust_group["applicability"],
                "can_bypass": rust_group["canBypass"],
                "early_cutoff": rust_group["earlyCutoff"],
                "determinism": "semantic",
                "implementation_status": "rust-wasm-product-stage-projection",
                "physical_execution_authority": False,
            }
        )

    steps = []
    for step in projection["graph_steps"]:
        step_id = step["step_id"]
        rust_step = rust_steps[step_id]
        steps.append(
            {
                "step_id": step_id,
                "unit_id": step["unit_id"],
                "label": step["step_label"],
                "description": step["step_description"],
                "capability_id": capability("step", step_id),
                "input_steps": step.get("step_inputs", []),
                "request_fields": rust_step["requestFields"],
                "source_role_bindings": [
                    {
                        "role": binding["role"],
                        "when_all": binding["whenAll"],
                    }
                    for binding in rust_step["sourceRoleBindings"]
                ],
                "applicability": rust_step["applicability"],
                "can_bypass": rust_step["canBypass"],
                "rust_executable_source": {
                    "path": str(PIPELINE_INCREMENTAL.relative_to(ROOT)),
                    "entrypoint": step_id,
                    "tracking": "salsa-query",
                },
                "binding_set_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:binding-set/v1",
            }
        )

    return {
        "protocol_version": "0.1",
        "plan_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:plan/raw-data/v1",
        "revision": "0.1.0",
        "family": "incremental-dataflow",
        "implementation_state": {
            "browser_selector": "typescript-worker-calls-rust-execute-workspace",
            "active_logical_authority": "rust-composed-runtime",
            "physical_execution": "salsa-tracked-rust-pipeline-v2",
            "logical_execution_evidence": "salsa-actual-step-events-grouped-into-15-product-views",
            "workspace_authority": "rust-root-and-closure-contract-with-opfs-browser-io-adapter",
            "semantic_index": "derived-rust-oxigraph-registered-queries-only",
            "typescript_boundary": "interaction-visualization-and-browser-io-only",
            "generated_yaml_is_executable_authority": False,
        },
        "relations": ["feeds", "gates", "tunes"],
        "materialization_states": [
            "open",
            "ready",
            "satisfied",
            "blocked",
            "invalid",
            "not_applicable",
        ],
        "execution_states": ["cached", "recomputed", "error", "skipped", "bypassed"],
        "root_roles": [
            {
                "role_id": role["roleId"],
                "cardinality": {
                    "minimum": role["minimum"],
                    "maximum": role["maximum"],
                },
                "media_types": role["mediaTypes"],
                "required": role["required"],
                **(
                    {"required_when": role["requiredWhen"]}
                    if "requiredWhen" in role
                    else {}
                ),
                **(
                    {"qualification": role["qualification"]}
                    if "qualification" in role
                    else {}
                ),
            }
            for role in rust_contract["rootRoles"]
        ],
        "nodes": nodes,
        "steps": steps,
        "reason_contract": {
            "every_state_change_has_reason": True,
            "reasons_reference_artifact_or_constraint": True,
            "open_roles_materialize_as_obligations": True,
        },
    }


def build_runtime_authority(plan: dict) -> dict:
    logical_capabilities = [node["capability_id"] for node in plan["nodes"]] + [
        step["capability_id"] for step in plan["steps"]
    ]
    return {
        "protocol_version": "0.1",
        "contract_id": (
            "urn:uzaira0:semantic-federation:chronicle-preprocessing:runtime-authority/v1"
        ),
        "revision": "0.1.0",
        "target_state": {
            "semantic_computation": "rust-wasm",
            "evidence_and_storage": "rust-wasm",
            "typescript": "interaction-visualization-and-thin-browser-host-adapters-only",
        },
        "logical_plan_capability_ids": logical_capabilities,
        "surfaces": RUNTIME_SURFACES,
        "typescript_host_allowances": [
            {
                "path": "web/src/lib/chronicleMatcher.ts",
                "purpose": "Web Worker lifecycle, request correlation, transferables, and pool fault handling",
                "may_define_product_semantics": False,
            },
            {
                "path": "web/src/workers/chronicle-worker.ts",
                "purpose": "Thin Comlink and browser-API adapter for the active Rust runtime",
                "may_define_product_semantics": False,
            },
            {
                "path": "web/src/lib/opfsArtifactStore.ts",
                "purpose": "OPFS byte I/O, alternating root slots, and browser capability probing around Rust-defined digests and roots",
                "may_define_product_semantics": False,
            },
            {
                "path": "web/src/lib/fileInspection.ts",
                "purpose": "Non-authoritative upload readiness preview; execution re-parses and validates in Rust",
                "may_define_product_semantics": False,
            },
            {
                "path": "web/src/lib/processingReport.ts",
                "purpose": "Download-facing projection of Rust-owned execution evidence and browser environment metadata",
                "may_define_product_semantics": False,
            },
            {
                "path": "web/src/lib/zip.ts",
                "purpose": "Browser download container formatting only",
                "may_define_product_semantics": False,
            },
        ],
        "typescript_visualization_allowances": [
            "web/src/lib/plotGenerator.ts",
            "web/src/lib/plotScene.ts",
            "web/src/lib/timelineViewer.ts",
            "web/src/lib/reviewCompareScene.ts",
            "web/src/components",
            "web/src/App.tsx",
        ],
        "cutover_gate": {
            "enforced": True,
            "rule": (
                "Every required runtime surface and every logical plan capability has exactly "
                "one active Rust authority; TypeScript retains no semantic, transformation, "
                "scheduler, evidence, cache-key, or storage authority."
            ),
        },
    }


def build_bindings(plan: dict, runtime_authority: dict) -> dict:
    node_capabilities = [node["capability_id"] for node in plan["nodes"]]
    step_capabilities = [step["capability_id"] for step in plan["steps"]]
    logical_capabilities = node_capabilities + step_capabilities
    runtime_capabilities = [
        surface["capability_id"] for surface in runtime_authority["surfaces"]
    ]
    complete_authority = logical_capabilities + runtime_capabilities
    product_runtime_capabilities = node_capabilities + runtime_capabilities
    runtime_implementation_digest = rust_runtime_implementation_digest()
    tracked_step_bindings = [
        {
            "binding_id": f"urn:uzaira0:semantic-federation:chronicle-preprocessing:binding/rust-wasm-step/{step['step_id']}",
            "capability_ids": [step["capability_id"]],
            "implementation": {
                "implementation_id": f"urn:uzaira0:semantic-federation:chronicle-preprocessing:implementation/rust-wasm-step/{step['step_id']}",
                "language": "rust",
                "target": "wasm32-unknown-unknown",
                "source": "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs",
                "entrypoint": step["step_id"],
                "build_digest": runtime_implementation_digest,
            },
            "relationship": "one-to-one",
            "status": "active",
            "authority": True,
            "evidence_projection": {
                "schema_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:evidence/salsa-step/v1",
                "loss": "lossless",
                "notes": "Salsa reports whether this exact Rust query body executed or its typed result was reused.",
            },
            "notes": "Production computation authority for one exact Chronicle preprocessing step.",
        }
        for step in plan["steps"]
    ]
    return {
        "protocol_version": "0.1",
        "binding_set_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:binding-set/v1",
        "product_profile_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing",
        "product_contract_digest": rendered_digest(
            {"plan": plan, "runtime_authority": runtime_authority}
        ),
        "bindings": [
            {
                "binding_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:binding/rust-wasm-product-runtime",
                "capability_ids": product_runtime_capabilities,
                "implementation": {
                    "implementation_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:implementation/rust-wasm-product-runtime",
                    "language": "rust",
                    "target": "wasm32-unknown-unknown",
                    "source": "rust/chronicle_preprocessing_runtime_wasm",
                    "entrypoint": "execute_workspace",
                    "build_digest": runtime_implementation_digest,
                },
                "relationship": "projection",
                "status": "active",
                "authority": True,
                "evidence_projection": {
                    "schema_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:evidence/rust-runtime/v1",
                    "loss": "lossless",
                    "notes": "The runtime projects actual Salsa step-execution events into the 15 product reporting groups, evidence, obligations, and artifact records.",
                },
                "notes": "Production worker authority for parsing, validation, computation, scheduling, evidence, artifact encoding, typed views, and semantic indexing.",
            },
            *tracked_step_bindings,
            {
                "binding_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:binding/rust-native-parity-runtime",
                "capability_ids": complete_authority,
                "implementation": {
                    "implementation_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:implementation/rust-native-parity-runtime",
                    "language": "rust",
                    "target": "native-test",
                    "source": "rust/chronicle_preprocessing_runtime_wasm",
                    "entrypoint": "execute_workspace_native",
                    "build_digest": runtime_implementation_digest,
                },
                "relationship": "one-to-one",
                "status": "active",
                "authority": False,
                "evidence_projection": {
                    "schema_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:evidence/native-wasm-parity/v1",
                    "loss": "lossless",
                    "notes": "Non-authoritative native target executes the same Rust runtime for deterministic parity and fault tests.",
                },
            },
            {
                "binding_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:binding/typescript-reference-harness",
                "capability_ids": logical_capabilities,
                "implementation": {
                    "implementation_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:implementation/typescript-reference-harness",
                    "language": "typescript",
                    "target": "test-only",
                    "source": "web/src/lib/browserPipeline.ts",
                    "entrypoint": "processRawCsvContent",
                    "build_digest": closure_digest([TYPESCRIPT_PIPELINE, TYPESCRIPT_GRAPH]),
                },
                "relationship": "one-to-one",
                "status": "retired",
                "authority": False,
                "evidence_projection": {
                    "schema_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:evidence/migration-reference/v1",
                    "loss": "lossless",
                    "notes": "Retained only for regression and migration-history tests; excluded from production imports and bundles.",
                },
            },
        ],
    }


def build_inventory(projection: dict, plan: dict, dependency_certificate: dict) -> dict:
    node_ids = [node["node_id"] for node in projection["graph_nodes"]]
    step_ids = [step["step_id"] for step in projection["graph_steps"]]
    callable_step_ids = independently_callable_rust_steps(step_ids)
    return {
        "inventory_version": "0.1.0",
        "branch_authority": {
            "feature_behavior": FEATURE_REF,
            "implementation_base": BASE_REF,
            "isolated_worktree_branch": "codex/chronicle-55-step-authority",
        },
        "sources": {
            "unit_graph": {
                "path": str(GRAPH_DEF.relative_to(ROOT)),
                "digest": digest(GRAPH_DEF),
                "executable": True,
                "production_authority": False,
                "purpose": "test-only-migration-reference",
            },
            "step_wirings": {
                "directory": "web/src/lib/pipelineGraph/steps",
                "executable": True,
                "production_authority": False,
                "purpose": "test-only-migration-reference",
            },
            "structural_projection": {
                "path": str(GRAPH_YAML.relative_to(ROOT)),
                "digest": digest(GRAPH_YAML),
                "executable": False,
            },
            "rust_migration_base": {
                "path": str(PIPELINE_V2.relative_to(ROOT)),
                "included_paths": [
                    str(path.relative_to(ROOT))
                    for path in [PIPELINE_V2, PIPELINE_INCREMENTAL, STEP_CONTRACT]
                ],
                "digest": closure_digest(
                    [PIPELINE_V2, PIPELINE_INCREMENTAL, STEP_CONTRACT]
                ),
                "coverage": "active-55-query-salsa-kernel-plus-fused-cold-test-oracle",
            },
            "rust_product_runtime": {
                "path": "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs",
                "digest": digest(ROOT / "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs"),
                "coverage": "production-worker-authority",
            },
            "configuration_family_compiler": {
                "path": "rust/chronicle_preprocessing_runtime_wasm/src/configuration_family.rs",
                "digest": digest(
                    ROOT
                    / "rust/chronicle_preprocessing_runtime_wasm/src/configuration_family.rs"
                ),
                "coverage": "product-local-variability-authority",
            },
        },
        "coverage": {
            "nodes": {"expected": 15, "recorded": len(node_ids), "percent": 100},
            "steps": {"expected": 55, "recorded": len(step_ids), "percent": 100},
            "declared_capability_identity_coverage": {
                "expected": 70,
                "recorded": 70,
                "percent": 100,
                "claim": "identity-and-exact-rust-query-entrypoint-coverage",
            },
            "physical_execution": {
                "tracked_executor_count": 1,
                "fused_cold_oracle_count": 1,
                "independently_callable_steps": len(callable_step_ids),
                "independently_cached_steps": len(callable_step_ids),
                "production_authoritative_incremental_steps": len(callable_step_ids),
                "actual_step_execution_event_ids": len(callable_step_ids),
                "target_steps": 55,
            },
            "dependency_surface": {
                "cache_relevant_options": len(
                    dependency_certificate["structural_contract"][
                        "cache_relevant_option_keys"
                    ]
                ),
                "excluded_options": len(
                    dependency_certificate["structural_contract"][
                        "excluded_option_keys"
                    ]
                ),
                "root_roles": len(
                    dependency_certificate["structural_contract"]["role_ids"]
                ),
                "unclassified_options": 0,
                "unbound_roles": 0,
            },
        },
        "node_ids": node_ids,
        "step_ids": step_ids,
        "rust_actual_event_projection_groups": node_ids,
        "rust_declared_step_ids": step_ids,
        "rust_independently_callable_step_ids": callable_step_ids,
        "rust_independently_cached_step_ids": callable_step_ids,
        "rust_actual_step_event_projection": {
            "covers": "rust_declared_step_ids",
            "count": len(step_ids),
        },
        "physical_incremental_execution_status": "runtime-cutover-active-release-blocked",
        "typescript_production_authority_capabilities": [],
        "runtime_authority_surface_count": len(RUNTIME_SURFACES),
        "dependency_certificate": {
            "path": str(DEPENDENCY_CERTIFICATE_OUTPUT.relative_to(ROOT)),
            "digest": rendered_digest(dependency_certificate),
            "fallback": "full-logical-recompute",
        },
        "resolved_baseline_findings": [
            {
                "gate": "trivy-bun-lock",
                "finding": "brace-expansion 5.0.6 / CVE-2026-13149",
                "resolution": "bun.lock and package-lock.json now resolve affected branches to 5.0.7 or 1.1.16",
            }
        ],
    }


def write_or_check(path: Path, value: dict, check: bool) -> None:
    rendered = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    if check:
        if not path.exists() or path.read_text(encoding="utf-8") != rendered:
            raise RuntimeError(f"generated artifact drift: {path.relative_to(ROOT)}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered, encoding="utf-8")


def sync_existing_ontology_resources(check: bool) -> None:
    sources = {
        ROOT / "web/schema/chronicle-research-ontology.linkml.yaml": RESOURCE_ROOT
        / "chronicle-research-ontology.linkml.yaml",
        ROOT / "web/schema/generated/shacl/merged.shacl.ttl": RESOURCE_ROOT
        / "chronicle-research-ontology.merged.shacl.ttl",
    }
    for source, target in sources.items():
        content = source.read_bytes()
        if source.suffix == ".ttl":
            content = (
                "\n".join(
                    line.rstrip()
                    for line in source.read_text(encoding="utf-8").splitlines()
                )
                + "\n"
            ).encode("utf-8")
        if check:
            if not target.exists() or target.read_bytes() != content:
                raise RuntimeError(f"vendored ontology resource drift: {target.relative_to(ROOT)}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--contracts-only",
        action="store_true",
        help=(
            "update/check the product plan, runtime authority, and capability "
            "bindings without reading empirical ledgers; use before rebuilding "
            "WASM and regenerating evidence after a contract change"
        ),
    )
    args = parser.parse_args()
    projection = load_and_verify()
    plan = build_plan(projection)
    runtime_authority = build_runtime_authority(plan)
    bindings = build_bindings(plan, runtime_authority)
    if args.contracts_only:
        write_or_check(PLAN_OUTPUT, plan, args.check)
        write_or_check(RUNTIME_AUTHORITY_OUTPUT, runtime_authority, args.check)
        write_or_check(BINDINGS_OUTPUT, bindings, args.check)
        sync_existing_ontology_resources(args.check)
        mode = "checked" if args.check else "generated"
        print(
            f"semantic_behavior_contracts={mode} groups=15 declared_steps=55 "
            "tracked_executors=1"
        )
        return 0
    dependency_certificate = build_dependency_certificate(plan)
    inventory = build_inventory(projection, plan, dependency_certificate)
    write_or_check(PLAN_OUTPUT, plan, args.check)
    write_or_check(RUNTIME_AUTHORITY_OUTPUT, runtime_authority, args.check)
    write_or_check(BINDINGS_OUTPUT, bindings, args.check)
    write_or_check(
        DEPENDENCY_CERTIFICATE_OUTPUT, dependency_certificate, args.check
    )
    write_or_check(INVENTORY_OUTPUT, inventory, args.check)
    sync_existing_ontology_resources(args.check)
    mode = "checked" if args.check else "generated"
    print(
        f"semantic_behavior_inventory={mode} groups=15 declared_steps=55 "
        f"tracked_executors=1 independently_cached_steps={len(inventory['rust_independently_cached_step_ids'])} "
        f"production_authoritative_incremental_steps={len(inventory['rust_independently_cached_step_ids'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
