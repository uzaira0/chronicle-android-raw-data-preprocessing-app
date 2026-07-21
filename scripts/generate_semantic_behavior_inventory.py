#!/usr/bin/env python3
"""Freeze Chronicle's executable graph and compile its product-owned plan.

The generated YAML remains a structural input only. This generator also
verifies that every projected node/step has an executable TypeScript source
site and records a Rust capability destination for every branch.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
GRAPH_YAML = ROOT / "web/schema/chronicle-pipeline-graph.yaml"
GRAPH_DEF = ROOT / "web/src/lib/pipelineGraph/graphDef.ts"
PIPELINE_V2 = ROOT / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs"
FEDERATION = ROOT / ".semantic-federation"
RESOURCE_ROOT = FEDERATION / "semantic/resources"
PLAN_OUTPUT = RESOURCE_ROOT / "chronicle.plan.json"
INVENTORY_OUTPUT = ROOT / "docs/semantic-federation/behavior-inventory.json"

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

PARTIAL_RUST_NODES = {
    "parse_events",
    "normalize_timezones",
    "dedup_and_order",
    "app_policy",
    "device_state_timeline",
    "reconstruct_episodes",
    "categorize_apps",
    "episode_annotations",
    "interval_cleaning",
    "outputs",
}

SUPPORT_ROLES = {
    "filter_file": {"required_when": {"option_true": "use_filter_file"}},
    "apps_forcing_screen_open_file": {
        "required_when": {"option_true": "use_apps_forcing_screen_open_file"}
    },
    "background_apps_file": {
        "required_when": {"option_true": "use_background_apps_file"}
    },
    "app_codebook_file": {"required_when": {"option_true": "use_app_codebook"}},
    "study_dates_file": {
        "required_when_any": [
            {"option_true": "enable_study_window_filter"},
            {"option_true": "add_no_activity_placeholder_days"},
            {"option_true": "enable_day_coverage"},
        ]
    },
    "device_sharing_file": {
        "required_when_any": [
            {"option_true": "enable_person_attribution"},
            {"option_true": "enable_compliance_scoring"},
        ]
    },
    "survey_attribution_file": {"required": False, "qualification": "optional-evidence"},
    "enrolled_devices_file": {"required": False, "qualification": "reserved-support"},
}


def digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def source_path_for_unit(unit_id: str) -> Path:
    return ROOT / "web/src/lib/pipelineGraph/steps" / UNIT_MODULES[unit_id]


def capability(kind: str, identifier: str) -> str:
    return f"urn:uzaira0:semantic-federation:chronicle-preprocessing:capability/{kind}/{identifier}/v1"


def load_and_verify() -> dict:
    projection = yaml.safe_load(GRAPH_YAML.read_text(encoding="utf-8"))
    nodes = projection["graph_nodes"]
    steps = projection["graph_steps"]
    if len(nodes) != 15 or len(steps) != 55:
        raise RuntimeError(f"expected 15 nodes/55 steps, found {len(nodes)}/{len(steps)}")

    graph_source = GRAPH_DEF.read_text(encoding="utf-8")
    for node in nodes:
        marker = f'id: "{node["node_id"]}"'
        if marker not in graph_source:
            raise RuntimeError(f"node has no executable graphDef source site: {node['node_id']}")

    for step in steps:
        source = source_path_for_unit(step["unit_id"])
        marker = f'id: "{step["step_id"]}"'
        if marker not in source.read_text(encoding="utf-8"):
            raise RuntimeError(f"step has no executable source site: {step['step_id']} in {source}")

    rust_source = PIPELINE_V2.read_text(encoding="utf-8")
    for function in (
        "parse_raw_rows",
        "dedupe_exact_rows",
        "mark_data_time_gaps",
        "derive_screen_usage_sessions_full",
        "run_app_usage_algorithm",
        "enrich_codebook",
        "run_pipeline_v2",
    ):
        if f"fn {function}" not in rust_source and f"pub fn {function}" not in rust_source:
            raise RuntimeError(f"missing expected Rust migration base: {function}")
    return projection


def build_plan(projection: dict) -> dict:
    nodes = []
    for node in projection["graph_nodes"]:
        node_id = node["node_id"]
        nodes.append(
            {
                "node_id": node_id,
                "label": node["node_label"],
                "section": node["section"],
                "capability_id": capability("node", node_id),
                "input_nodes": node.get("node_inputs", []),
                "output_role": f"urn:uzaira0:semantic-federation:chronicle-preprocessing:role/node-output/{node_id}",
                "knobs": node.get("node_knobs", []),
                "support_roles": node.get("node_support_files", []),
                "can_bypass": node["has_bypass"],
                "early_cutoff": node["has_early_cutoff"],
                "determinism": "semantic",
                "migration_status": (
                    "partial-rust-shadow" if node_id in PARTIAL_RUST_NODES else "typescript-only"
                ),
            }
        )

    steps = []
    for step in projection["graph_steps"]:
        step_id = step["step_id"]
        source = source_path_for_unit(step["unit_id"])
        steps.append(
            {
                "step_id": step_id,
                "unit_id": step["unit_id"],
                "label": step["step_label"],
                "description": step["step_description"],
                "capability_id": capability("step", step_id),
                "input_steps": step.get("step_inputs", []),
                "can_bypass": step["has_bypass"],
                "legacy_executable_source": str(source.relative_to(ROOT)),
                "target_registry": "rust/chronicle_semantic_runtime/src/capabilities.rs",
            }
        )

    return {
        "protocol_version": "0.1",
        "plan_id": "urn:uzaira0:semantic-federation:chronicle-preprocessing:plan/raw-data/v1",
        "revision": "0.1.0",
        "family": "incremental-dataflow",
        "authority": {
            "current_shadow": "typescript-executable-wiring",
            "target": "compiled-rust-capability-registry",
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
                "role_id": "raw_chronicle_csv",
                "cardinality": {"minimum": 1, "maximum": 1},
                "media_types": ["text/csv"],
                "required": True,
            },
            {
                "role_id": "processing_options",
                "cardinality": {"minimum": 1, "maximum": 1},
                "media_types": ["application/json"],
                "required": True,
            },
            *[
                {
                    "role_id": role_id,
                    "cardinality": {"minimum": 0, "maximum": 1},
                    "media_types": ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
                    **policy,
                }
                for role_id, policy in SUPPORT_ROLES.items()
            ],
        ],
        "nodes": nodes,
        "steps": steps,
        "reason_contract": {
            "every_state_change_has_reason": True,
            "reasons_reference_artifact_or_constraint": True,
            "open_roles_materialize_as_obligations": True,
        },
    }


def build_inventory(projection: dict, plan: dict) -> dict:
    node_ids = [node["node_id"] for node in projection["graph_nodes"]]
    step_ids = [step["step_id"] for step in projection["graph_steps"]]
    return {
        "inventory_version": "0.1.0",
        "branch_authority": {
            "feature_behavior": FEATURE_REF,
            "implementation_base": BASE_REF,
            "isolated_worktree_branch": "codex/semantic-federation-rust-wasm",
        },
        "sources": {
            "unit_graph": {
                "path": str(GRAPH_DEF.relative_to(ROOT)),
                "digest": digest(GRAPH_DEF),
                "executable": True,
            },
            "step_wirings": {
                "directory": "web/src/lib/pipelineGraph/steps",
                "executable": True,
            },
            "structural_projection": {
                "path": str(GRAPH_YAML.relative_to(ROOT)),
                "digest": digest(GRAPH_YAML),
                "executable": False,
            },
            "rust_migration_base": {
                "path": str(PIPELINE_V2.relative_to(ROOT)),
                "digest": digest(PIPELINE_V2),
                "coverage": "partial-preprocessing-shadow",
            },
        },
        "coverage": {
            "nodes": {"expected": 15, "recorded": len(node_ids), "percent": 100},
            "steps": {"expected": 55, "recorded": len(step_ids), "percent": 100},
            "migration_destinations": {
                "expected": 55,
                "recorded": len(plan["steps"]),
                "percent": 100,
            },
        },
        "node_ids": node_ids,
        "step_ids": step_ids,
        "rust_gap_nodes": [node for node in node_ids if node not in PARTIAL_RUST_NODES],
        "known_baseline_blockers": [
            {
                "gate": "trivy-bun-lock",
                "finding": "brace-expansion 5.0.6 / CVE-2026-13149",
                "fixed_version": "5.0.7",
                "classification": "pre-existing dependency lock vulnerability",
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
    args = parser.parse_args()
    projection = load_and_verify()
    plan = build_plan(projection)
    inventory = build_inventory(projection, plan)
    write_or_check(PLAN_OUTPUT, plan, args.check)
    write_or_check(INVENTORY_OUTPUT, inventory, args.check)
    sync_existing_ontology_resources(args.check)
    mode = "checked" if args.check else "generated"
    print(f"semantic_behavior_inventory={mode} nodes=15 steps=55 destinations=55")
    return 0


if __name__ == "__main__":
    sys.exit(main())
