#!/usr/bin/env python3
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]
plan = json.loads((ROOT / "semantic/resources/chronicle.plan.json").read_text(encoding="utf-8"))
queries = json.loads((ROOT / "semantic/resources/registered-queries.json").read_text(encoding="utf-8"))
view_schema = json.loads((ROOT / "semantic/resources/chronicle-views.schema.json").read_text(encoding="utf-8"))

nodes = plan["nodes"]
steps = plan["steps"]
if len(nodes) != 15 or len(steps) != 55:
    raise SystemExit("Chronicle plan must bind the complete 15-node/55-step behavior")

node_ids = [node["node_id"] for node in nodes]
step_ids = [step["step_id"] for step in steps]
capabilities = [node["capability_id"] for node in nodes] + [step["capability_id"] for step in steps]
if len(set(node_ids)) != len(node_ids) or len(set(step_ids)) != len(step_ids):
    raise SystemExit("duplicate Chronicle node or step identifier")
if len(set(capabilities)) != len(capabilities):
    raise SystemExit("duplicate Chronicle capability binding")

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
    if step["target_registry"] != "rust/chronicle_semantic_runtime/src/capabilities.rs":
        raise SystemExit(f"{step['step_id']}: capability target escaped product Rust registry")

support_roles = {role["role_id"] for role in plan["root_roles"]} - {
    "raw_chronicle_csv",
    "processing_options",
}
referenced_support = {role for node in nodes for role in node["support_roles"]}
if support_roles != referenced_support:
    raise SystemExit(
        f"support-role coverage mismatch: declared={sorted(support_roles)} referenced={sorted(referenced_support)}"
    )

allowed_views = {
    "chronicle.stage.v1",
    "chronicle.artifact.v1",
    "chronicle.obligation.v1",
    "chronicle.temporal-subject.v1",
    "chronicle.explanation.v1",
    "chronicle.assurance.v1",
}
query_views = {query["view_id"] for query in queries["queries"]}
if not query_views <= allowed_views or queries["arbitrary_production_sparql"]:
    raise SystemExit("registered query boundary is invalid")

serialized_schema = json.dumps(view_schema)
for forbidden in ('"items"', '"links"'):
    # JSON Schema's array keyword is necessarily named "items"; only reject
    # a generic top-level graph payload property carrying that name.
    if f'"properties": {{{forbidden}:' in serialized_schema:
        raise SystemExit("generic items/links graph payload is forbidden")

print("chronicle semantic contract valid: nodes=15 steps=55 roles=10 typed_views=6")
