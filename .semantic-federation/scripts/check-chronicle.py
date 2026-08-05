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
dependency_certificate = json.loads(
    (ROOT / "proofs/dependency-certificate.json").read_text()
)


def rendered_digest(value: dict) -> str:
    rendered = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    return "sha256:" + hashlib.sha256(rendered).hexdigest()


def file_digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


implementation_receipt = dependency_certificate["evidence"]["implementation_receipt"]
for proof in dependency_certificate["evidence"]["proof_ledgers"]:
    proof_path = (REPOSITORY_ROOT / proof["path"]).resolve()
    try:
        proof_path.relative_to(REPOSITORY_ROOT.resolve())
    except ValueError as error:
        raise SystemExit(f"dependency proof escapes repository: {proof['path']}") from error
    if not proof_path.is_file():
        raise SystemExit(f"dependency proof is missing: {proof['path']}")
    if file_digest(proof_path) != proof["digest"]:
        raise SystemExit(f"dependency proof digest is stale: {proof['path']}")
    ledger = json.loads(proof_path.read_text())
    if ledger.get("protocolVersion") != proof["protocol_version"]:
        raise SystemExit(f"dependency proof protocol drift: {proof['path']}")
    if ledger.get("implementationReceipt") != implementation_receipt:
        raise SystemExit(f"dependency proof implementation drift: {proof['path']}")


expected_contract_digest = rendered_digest(
    {"plan": plan, "runtime_authority": runtime_authority}
)
if bindings["product_contract_digest"] != expected_contract_digest:
    raise SystemExit("binding set does not bind the plan and runtime-authority contract")

query_groups = plan["query_groups"]
workflow_queries = plan["queries"]
if not query_groups or not workflow_queries:
    raise SystemExit("preprocessing plan must declare non-empty query groups and queries")
if plan["implementation_state"]["active_logical_authority"] != "rust-composed-runtime":
    raise SystemExit("plan does not select the composed Rust runtime")
if plan["implementation_state"]["physical_execution"] != "salsa-tracked-rust-pipeline-v2":
    raise SystemExit("current plan must select the registered-query Salsa executor")
if plan["implementation_state"]["generated_yaml_is_executable_authority"]:
    raise SystemExit("structural YAML cannot be executable authority")
if any(query_group["implementation_status"] != "rust-wasm-query-group-projection" for query_group in query_groups):
    raise SystemExit("a query_group is not a Rust/WASM query-group projection")
if any(query_group.get("physical_execution_authority") is not False for query_group in query_groups):
    raise SystemExit("a query-group projection incorrectly claims physical execution authority")

query_group_ids = [query_group["query_group_id"] for query_group in query_groups]
query_ids = [query["query_id"] for query in workflow_queries]
if len(set(query_group_ids)) != len(query_group_ids) or len(set(query_ids)) != len(query_ids):
    raise SystemExit("duplicate query-group or query identifier")
known_query_groups = set(query_group_ids)
known_queries = set(query_ids)
for query_group in query_groups:
    unknown = set(query_group["input_query_groups"]) - known_query_groups
    if unknown:
        raise SystemExit(f"{query_group['query_group_id']}: unknown input query_groups {sorted(unknown)}")
for query in workflow_queries:
    unknown = set(query["input_queries"]) - known_queries
    if unknown:
        raise SystemExit(f"{query['query_id']}: unknown input queries {sorted(unknown)}")
    if query["binding_set_id"] != bindings["binding_set_id"]:
        raise SystemExit(f"{query['query_id']}: capability binding-set drift")
    rust_source = query.get("rust_executable_source", {})
    if rust_source != {
        "path": "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs",
        "entrypoint": query["query_id"],
        "tracking": "salsa-query",
    }:
        raise SystemExit(f"{query['query_id']}: exact Rust query source drift")

logical_capabilities = [query_group["capability_id"] for query_group in query_groups] + [
    query["capability_id"] for query in workflow_queries
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
query_capabilities = {query["capability_id"] for query in workflow_queries}
if set(primary["capability_ids"]) != required - query_capabilities:
    raise SystemExit("Rust/WASM product-runtime binding does not cover its exact required capabilities")
if primary["evidence_projection"]["loss"] != "lossless":
    raise SystemExit("selected logical execution/evidence projection is not lossless")
for query in workflow_queries:
    authority = active_authorities[query["capability_id"]][0]
    implementation = authority["implementation"]
    if authority["relationship"] != "one-to-one":
        raise SystemExit(f"{query['query_id']}: production query binding is not one-to-one")
    if implementation["entrypoint"] != query["query_id"]:
        raise SystemExit(f"{query['query_id']}: production query entrypoint drift")
    if implementation["source"] != "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs":
        raise SystemExit(f"{query['query_id']}: production query source drift")

native = next(
    binding
    for binding in bindings["bindings"]
    if binding["implementation"]["entrypoint"] == "execute_workspace_native"
)
if native["status"] != "active" or native["authority"]:
    raise SystemExit("native parity runtime must be active but non-authoritative")
if any(
    binding["implementation"]["language"] != "rust"
    or binding["implementation"]["entrypoint"] == "processRawCsvContent"
    for binding in bindings["bindings"]
):
    raise SystemExit("a deleted TypeScript preprocessing binding has returned")

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
    (runtime, "IncrementalPipelineV2Engine"),
    (runtime, "request.command == QUERY_REVIEW_COMMAND"),
    (runtime, ".execute_review_with_bases("),
    (runtime, "review_base_bytes,"),
    (runtime, "reconstruction_base_bytes,"),
    (runtime, ".execute(csv_bytes, options, support_files)?"),
    (runtime, "project_query_groups"),
):
    if required_symbol not in source:
        raise SystemExit(f"selected production path omits {required_symbol}")
if "processRawCsvContent" in worker:
    raise SystemExit("production worker still selects TypeScript computation")

support_roles = {role["role_id"] for role in plan["root_roles"]} - {
    "raw_chronicle_csv",
    "processing_options",
}
referenced_support = {role for query_group in query_groups for role in query_group["support_roles"]}
if support_roles != referenced_support:
    raise SystemExit("support-role declaration and use differ")

allowed_views = {
    "chronicle.query-group.v1",
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
    f"groups={len(query_groups)} declared_queries={len(workflow_queries)} tracked_executors=1 "
    f"independently_cached_queries={len(workflow_queries)} rust_authorities={len(required)} "
    f"runtime_surfaces={len(runtime_capabilities)} typed_views={len(allowed_views)} "
    "physical_incrementality=runtime-cutover-active-release-blocked"
)
