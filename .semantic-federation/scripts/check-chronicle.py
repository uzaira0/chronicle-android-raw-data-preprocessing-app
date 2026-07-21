#!/usr/bin/env python3
"""Fail-closed checks for the preprocessing app's selected Rust authority."""

from pathlib import Path
import hashlib
import json


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ROOT.parent
plan = json.loads((ROOT / "semantic/resources/chronicle.plan.json").read_text())
queries = json.loads((ROOT / "semantic/resources/registered-queries.json").read_text())
view_schema = json.loads((ROOT / "semantic/resources/chronicle-views.schema.json").read_text())
bindings = json.loads((ROOT / "semantic/capability-bindings.json").read_text())
runtime_authority = json.loads(
    (ROOT / "semantic/resources/runtime-authority.json").read_text()
)


def rendered_digest(value: dict) -> str:
    rendered = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    return "sha256:" + hashlib.sha256(rendered).hexdigest()


expected_contract_digest = rendered_digest(
    {"plan": plan, "runtime_authority": runtime_authority}
)
if bindings["product_contract_digest"] != expected_contract_digest:
    raise SystemExit("binding set does not bind the plan and runtime-authority contract")

nodes = plan["nodes"]
steps = plan["steps"]
if len(nodes) != 15 or len(steps) != 55:
    raise SystemExit("preprocessing plan must bind the complete 15-node/55-step behavior")
if plan["implementation_state"]["active_logical_authority"] != "rust-composed-runtime":
    raise SystemExit("plan does not select the composed Rust runtime")
if plan["implementation_state"]["generated_yaml_is_executable_authority"]:
    raise SystemExit("structural YAML cannot be executable authority")
if any(node["implementation_status"] != "rust-wasm-active-logical-authority" for node in nodes):
    raise SystemExit("a logical node is not bound to active Rust/WASM authority")

node_ids = [node["node_id"] for node in nodes]
step_ids = [step["step_id"] for step in steps]
if len(set(node_ids)) != len(node_ids) or len(set(step_ids)) != len(step_ids):
    raise SystemExit("duplicate node or step identifier")
known_nodes = set(node_ids)
known_steps = set(step_ids)
for node in nodes:
    unknown = set(node["input_nodes"]) - known_nodes
    if unknown:
        raise SystemExit(f"{node['node_id']}: unknown input nodes {sorted(unknown)}")
for step in steps:
    unknown = set(step["input_steps"]) - known_steps
    if unknown:
        raise SystemExit(f"{step['step_id']}: unknown input steps {sorted(unknown)}")
    if step["binding_set_id"] != bindings["binding_set_id"]:
        raise SystemExit(f"{step['step_id']}: capability binding-set drift")

logical_capabilities = [node["capability_id"] for node in nodes] + [
    step["capability_id"] for step in steps
]
runtime_capabilities = [
    surface["capability_id"] for surface in runtime_authority["surfaces"]
]
capabilities = logical_capabilities + runtime_capabilities
if len(set(capabilities)) != len(capabilities):
    raise SystemExit("duplicate logical or runtime capability")

active_authorities: dict[str, list[dict]] = {capability: [] for capability in capabilities}
for binding in bindings["bindings"]:
    for capability in binding["capability_ids"]:
        if capability not in active_authorities:
            raise SystemExit(f"binding references unknown capability: {capability}")
        if binding["status"] == "active" and binding["authority"]:
            active_authorities[capability].append(binding)

required = set(logical_capabilities) | {
    surface["capability_id"]
    for surface in runtime_authority["surfaces"]
    if surface["requires_active_authority"]
}
invalid = {
    capability: [binding["binding_id"] for binding in authorities]
    for capability, authorities in active_authorities.items()
    if capability in required and len(authorities) != 1
}
if invalid:
    raise SystemExit(f"each required capability needs one active authority: {invalid}")
if any(
    binding["implementation"]["language"] != "rust"
    for capability in required
    for binding in active_authorities[capability]
):
    raise SystemExit("non-Rust production authority remains after cutover")

primary = next(
    (
        binding
        for binding in bindings["bindings"]
        if binding["implementation"]["entrypoint"] == "execute_workspace"
    ),
    None,
)
if not primary or primary["status"] != "active" or not primary["authority"]:
    raise SystemExit("Rust/WASM execute_workspace is not the selected production authority")
if set(primary["capability_ids"]) != required:
    raise SystemExit("Rust/WASM production binding does not cover the exact required closure")
if primary["evidence_projection"]["loss"] != "lossless":
    raise SystemExit("selected logical execution/evidence projection is not lossless")

native = next(
    binding
    for binding in bindings["bindings"]
    if binding["implementation"]["entrypoint"] == "execute_workspace_native"
)
if native["status"] != "active" or native["authority"]:
    raise SystemExit("native parity runtime must be active but non-authoritative")
legacy = next(
    binding
    for binding in bindings["bindings"]
    if binding["implementation"]["entrypoint"] == "processRawCsvContent"
)
if legacy["status"] != "retired" or legacy["authority"]:
    raise SystemExit("TypeScript reference pipeline must remain retired/test-only")

if not runtime_authority["cutover_gate"]["enforced"]:
    raise SystemExit("Rust cutover architecture gate is not enforced")
for surface in runtime_authority["surfaces"]:
    if not surface["requires_active_authority"]:
        raise SystemExit(f"runtime surface unexpectedly optional: {surface['surface_id']}")
    if surface["current"]["language"] != "rust":
        raise SystemExit(f"runtime surface is not Rust-owned: {surface['surface_id']}")
    path = REPOSITORY_ROOT / surface["current"]["path"]
    if not path.exists():
        raise SystemExit(f"missing runtime authority source: {surface['surface_id']}")
    if surface["current"]["entrypoint"] not in path.read_text():
        raise SystemExit(
            f"missing runtime entrypoint {surface['current']['entrypoint']}: {surface['surface_id']}"
        )

worker = (REPOSITORY_ROOT / "web/src/workers/chronicle-worker.ts").read_text()
authority_adapter = (REPOSITORY_ROOT / "web/src/lib/rustPipelineAuthority.ts").read_text()
runtime = (REPOSITORY_ROOT / "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs").read_text()
for source, required_symbol in (
    (worker, "processRawCsvWithRustAuthority"),
    (authority_adapter, "executeRustRuntime"),
    (runtime, "Scheduler::new"),
    (runtime, "run_pipeline_v2_with_supports"),
):
    if required_symbol not in source:
        raise SystemExit(f"selected production path omits {required_symbol}")
if "processRawCsvContent" in worker:
    raise SystemExit("production worker still selects TypeScript computation")

support_roles = {role["role_id"] for role in plan["root_roles"]} - {
    "raw_chronicle_csv",
    "processing_options",
}
referenced_support = {role for node in nodes for role in node["support_roles"]}
if support_roles != referenced_support:
    raise SystemExit("support-role declaration and use differ")

allowed_views = {
    "chronicle.stage.v1",
    "chronicle.artifact.v1",
    "chronicle.obligation.v1",
    "chronicle.temporal-subject.v1",
    "chronicle.explanation.v1",
    "chronicle.assurance.v1",
}
if {query["view_id"] for query in queries["queries"]} - allowed_views:
    raise SystemExit("registered query references an unknown typed view")
if queries["arbitrary_production_sparql"]:
    raise SystemExit("arbitrary production SPARQL is forbidden")
serialized_schema = json.dumps(view_schema)
if '"properties": {"items":' in serialized_schema or '"properties": {"links":' in serialized_schema:
    raise SystemExit("generic items/links graph payload is forbidden")

print(
    "preprocessing semantic contract valid: "
    f"nodes=15 steps=55 rust_authorities={len(required)} "
    f"runtime_surfaces={len(runtime_capabilities)} typed_views=6"
)
