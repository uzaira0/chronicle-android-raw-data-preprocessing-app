#!/usr/bin/env python3
"""Keep generated execution claims equal to the active 55-query Rust runtime."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


FEDERATION_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = FEDERATION_ROOT.parent
PLAN_PATH = FEDERATION_ROOT / "semantic/resources/chronicle.plan.json"
INVENTORY_PATH = REPOSITORY_ROOT / "docs/semantic-federation/behavior-inventory.json"
IMPLEMENTATION_PLAN_PATH = (
    REPOSITORY_ROOT / "docs/semantic-federation/55-step-incremental-rust-plan.md"
)

REQUIRED_DOCUMENT_TEXT = {
    REPOSITORY_ROOT / "README.md": [
        "55-step incremental Rust plan",
        "all 55 preprocessing transformations now exist",
        "Persisted Salsa snapshots were removed",
    ],
    REPOSITORY_ROOT / ".semantic-federation/PROJECT_DECISIONS.md": [
        "Salsa `0.28.1`",
        "55 callable Rust queries",
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/production-proof.md": [
        "55 Salsa-tracked Rust product computations",
        "actual executed-step IDs",
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/final-review-matrix.md": [
        "Physical 55-step executor",
        "**Release blocker:**",
    ],
    REPOSITORY_ROOT / "docs/perf/BASELINE.md": [
        "Historical pre-Salsa warm-path baseline",
        "must not be used as the current runtime result",
    ],
}

FORBIDDEN_DOCUMENT_TEXT = {
    REPOSITORY_ROOT / "README.md": ["first complete consumer"],
    REPOSITORY_ROOT / "docs/semantic-federation/production-proof.md": [
        "first complete consumer"
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/final-review-matrix.md": [
        "Splitting the kernel into restartable physical stages is optional performance work"
    ],
    REPOSITORY_ROOT / ".semantic-federation/PROJECT_DECISIONS.md": [
        "The product-owned Rust scheduler is selected"
    ],
    REPOSITORY_ROOT / "docs/perf/BASELINE.md": [
        "The runtime's 55 `cached` and `recomputed` labels are created after the fused result exists"
    ],
}


def fail(message: str) -> None:
    raise SystemExit(message)


def contains_phrase(text: str, phrase: str) -> bool:
    searchable = " ".join(text.split()).casefold()
    expected = " ".join(phrase.split()).casefold()
    return expected in searchable


def check_document_text() -> None:
    for path, phrases in REQUIRED_DOCUMENT_TEXT.items():
        text = path.read_text(encoding="utf-8")
        for phrase in phrases:
            if not contains_phrase(text, phrase):
                fail(
                    f"missing execution-state disclosure in {path.relative_to(REPOSITORY_ROOT)}: {phrase}"
                )
    for path, phrases in FORBIDDEN_DOCUMENT_TEXT.items():
        text = path.read_text(encoding="utf-8")
        for phrase in phrases:
            if contains_phrase(text, phrase):
                fail(
                    f"stale physical-incrementality claim in {path.relative_to(REPOSITORY_ROOT)}: {phrase}"
                )


def check_machine_state() -> tuple[int, int]:
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    steps = plan["steps"]
    groups = plan["nodes"]
    if plan["implementation_state"]["physical_execution"] != "salsa-tracked-rust-pipeline-v2":
        fail("executable plan does not select the 55-query Salsa executor")
    if len(groups) != 15 or len(steps) != 55:
        fail(f"expected 15 groups/55 steps, found {len(groups)}/{len(steps)}")
    if len({step["step_id"] for step in steps}) != 55:
        fail("declared step IDs are not unique")

    physical = inventory["coverage"]["physical_execution"]
    expected_physical = {
        "tracked_executor_count": 1,
        "fused_cold_oracle_count": 1,
        "independently_callable_steps": 55,
        "independently_cached_steps": 55,
        "production_authoritative_incremental_steps": 55,
        "actual_step_execution_event_ids": 55,
        "target_steps": 55,
    }
    if physical != expected_physical:
        fail(f"behavior inventory physical state drift: {physical!r}")
    if inventory["physical_incremental_execution_status"] != "runtime-cutover-active-release-blocked":
        fail("behavior inventory no longer reports the active runtime cutover truthfully")
    if inventory["rust_actual_step_event_projection"] != {
        "covers": "rust_declared_step_ids",
        "count": 55,
    }:
        fail("behavior inventory does not cover all actual step event IDs")
    if inventory["rust_independently_callable_step_ids"] != [
        step["step_id"] for step in steps
    ]:
        fail("behavior inventory callable queries do not exactly match the plan")
    if inventory["rust_independently_cached_step_ids"] != [
        step["step_id"] for step in steps
    ]:
        fail("behavior inventory cached queries do not exactly match the plan")
    for step in steps:
        source = step.get("rust_executable_source", {})
        if source.get("entrypoint") != step["step_id"] or source.get("tracking") != "salsa-query":
            fail(f"plan lacks an exact Salsa query source for {step['step_id']}")

    implementation_plan = IMPLEMENTATION_PLAN_PATH.read_text(encoding="utf-8")
    missing = [
        step["step_id"]
        for step in steps
        if f"`{step['step_id']}`" not in implementation_plan
    ]
    if missing:
        fail(f"implementation plan omits declared steps: {missing}")
    return len(groups), len(steps)


def check_source_shape() -> None:
    runtime_path = (
        REPOSITORY_ROOT / "rust/chronicle_preprocessing_runtime_wasm/src/lib.rs"
    )
    runtime = runtime_path.read_text(encoding="utf-8")
    for symbol in (
        "IncrementalPipelineV2Engine",
        "evaluate_dependency_cache_decision(",
        "request.command == QUERY_REVIEW_COMMAND",
        ".execute_review_with_base(",
        "review_base_bytes,",
        ".execute(csv_bytes, options, support_files)?",
        "fn build_runtime_step_executions(",
        "fn project_product_stages(",
        "fn execute_incremental_pipeline(",
    ):
        if symbol not in runtime:
            fail(f"current execution-shape check lost source symbol: {symbol}")

    for retired in (
        "struct FusedPhysicalExecutor",
        "struct TrackedPhysicalExecutor",
        "Scheduler::new_certified(",
        "run_with_decision(&mut state.workspace",
    ):
        if retired in runtime:
            fail(f"retired second-scheduler production path remains: {retired}")
    execute_body = runtime[runtime.index("fn execute_incremental_pipeline(") :]
    cache_decision = execute_body.index("evaluate_dependency_cache_decision(")
    tracked_execution = execute_body.index(
        "let tracked_execution = if request.command == QUERY_REVIEW_COMMAND"
    )
    review_execution = execute_body.index(
        ".execute_review_with_base("
    )
    full_execution = execute_body.index(
        ".execute(csv_bytes, options, support_files)?"
    )
    projected_status = execute_body.index("build_runtime_step_executions(")
    product_projection = execute_body.index("project_product_stages(")
    if not (
        cache_decision
        < tracked_execution
        < review_execution
        < full_execution
        < projected_status
        < product_projection
    ):
        fail("cache validation, tracked execution, exact step reporting, and product-stage projection are out of order")

    incremental_path = (
        REPOSITORY_ROOT
        / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs"
    )
    incremental = incremental_path.read_text(encoding="utf-8")
    import re

    tracked_functions = re.findall(
        r"#\[salsa::tracked\([^\]]*\)\]\s*fn\s+([a-z0-9_]+)\s*\(",
        incremental,
    )
    product_queries = {
        name
        for name in tracked_functions
        if f'record_query_body("{name}")' in incremental
    }
    derived_queries = {
        name
        for name in tracked_functions
        if f'record_internal_query_body("{name}")' in incremental
    }
    unclassified = set(tracked_functions) - product_queries - derived_queries
    if unclassified:
        fail(f"unclassified Salsa queries: {sorted(unclassified)}")
    if len(product_queries) != 55:
        fail(f"expected 55 unique Salsa product queries, found {len(product_queries)}")
    if derived_queries != {
        "assemble_primary_outputs",
        "codebook_is_empty",
        "decoded_review_base",
        "matching_review_base",
        "review_annotations_fused",
        "review_reconstructed_rows",
        "review_reconstruction_fused",
    }:
        fail(f"unexpected derived Salsa cache queries: {sorted(derived_queries)}")

    oracle = (
        REPOSITORY_ROOT / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs"
    ).read_text(encoding="utf-8")
    if "pub fn run_pipeline_v2_with_supports(" not in oracle:
        fail("independent fused cold-test oracle is missing")

    capabilities = (
        REPOSITORY_ROOT
        / "rust/chronicle_preprocessing_semantic_adapter/src/capabilities.rs"
    ).read_text(encoding="utf-8")
    step_binding = capabilities[
        capabilities.index("pub struct StepBinding") : capabilities.index(
            "include!(", capabilities.index("pub struct StepBinding")
        )
    ]
    for field in ("entrypoint: &'static str", "tracking: &'static str"):
        if field not in step_binding:
            fail(f"exact step binding lost field: {field}")
    if "stage: PhysicalStage" in step_binding:
        fail("exact 55-step bindings must not collapse back to a 15-stage projection")


def self_test() -> None:
    forbidden = "This repository is the first complete consumer."
    phrase = FORBIDDEN_DOCUMENT_TEXT[REPOSITORY_ROOT / "README.md"][0]
    if not contains_phrase(forbidden, phrase):
        fail("execution-claim checker self-test did not detect its seeded false claim")
    if contains_phrase("This repository is the first full implementation target.", phrase):
        fail("execution-claim checker self-test rejected the allowed wording")
    print("execution_claims_self_test=passed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    check_document_text()
    groups, steps = check_machine_state()
    check_source_shape()
    print(
        "execution_claims=valid "
        f"groups={groups} declared_steps={steps} tracked_executors=1 "
        "independently_callable_steps=55 independently_cached_steps=55 "
        "physical_incrementality=runtime-cutover-active-release-blocked"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
