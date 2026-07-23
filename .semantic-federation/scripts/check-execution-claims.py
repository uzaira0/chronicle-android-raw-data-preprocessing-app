#!/usr/bin/env python3
"""Keep current fused execution distinct from the planned 55-query runtime."""

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
        "not yet independently callable and cached",
    ],
    REPOSITORY_ROOT / ".semantic-federation/PROJECT_DECISIONS.md": [
        "existing custom 15-node fingerprint scheduler is provisional",
        "Salsa product trial",
        "55 callable Rust queries",
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/production-proof.md": [
        "55 real cached Rust computations",
        "post-run logical evidence",
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/final-review-matrix.md": [
        "Physical 55-step executor",
        "**Release blocker:**",
    ],
    REPOSITORY_ROOT / "docs/perf/BASELINE.md": [
        "Current warm-execution limitation",
        "still performs the full physical computation",
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
    if plan["implementation_state"]["physical_execution"] != "fused-rust-pipeline-v2":
        fail("executable plan no longer discloses its fused physical executor")
    if len(groups) != 15 or len(steps) != 55:
        fail(f"expected 15 groups/55 steps, found {len(groups)}/{len(steps)}")
    if len({step["step_id"] for step in steps}) != 55:
        fail("declared step IDs are not unique")

    physical = inventory["coverage"]["physical_execution"]
    expected_physical = {
        "fused_executor_count": 1,
        "independently_callable_steps": 0,
        "independently_cached_steps": 0,
        "actual_step_execution_events": 0,
        "target_steps": 55,
    }
    if physical != expected_physical:
        fail(f"behavior inventory physical state drift: {physical!r}")
    if inventory["physical_incremental_execution_status"] != "release-blocked":
        fail("behavior inventory no longer marks physical incrementality as blocked")
    if inventory["rust_post_run_status_projection"] != {
        "covers": "rust_declared_step_ids",
        "count": 55,
    }:
        fail("behavior inventory does not disclose all post-run status step IDs")
    if inventory["rust_independently_callable_step_ids"]:
        fail("behavior inventory claims callable step queries before implementation")
    if inventory["rust_independently_cached_step_ids"]:
        fail("behavior inventory claims cached step queries before implementation")

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
        "struct FusedPhysicalExecutor",
        "fn ensure_result",
        "run_pipeline_v2_with_supports(",
        "fn build_runtime_step_executions(",
        "fn execute_incremental_pipeline(",
    ):
        if symbol not in runtime:
            fail(f"current execution-shape check lost source symbol: {symbol}")

    execute_body = runtime[runtime.index("fn execute_incremental_pipeline(") :]
    fused_result = execute_body.index(".result\n")
    projected_status = execute_body.index("build_runtime_step_executions(")
    if projected_status <= fused_result:
        fail("step statuses are no longer visibly constructed after the fused result")

    capabilities = (
        REPOSITORY_ROOT
        / "rust/chronicle_preprocessing_semantic_adapter/src/capabilities.rs"
    ).read_text(encoding="utf-8")
    step_binding = capabilities[
        capabilities.index("pub struct StepBinding") : capabilities.index(
            "include!(", capabilities.index("pub struct StepBinding")
        )
    ]
    if "stage: PhysicalStage" not in step_binding:
        fail("current step binding no longer discloses its 15-stage projection")
    if "fn(" in step_binding or "query" in step_binding.lower():
        fail("callable query binding appeared; update current/target status and tests")


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
        f"groups={groups} declared_steps={steps} fused_executors=1 "
        "independently_callable_steps=0 independently_cached_steps=0 "
        "physical_incrementality=release-blocked"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
