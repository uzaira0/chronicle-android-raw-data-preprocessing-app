#!/usr/bin/env python3
"""Keep generated execution claims equal to the active 55-query Rust runtime."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


FEDERATION_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = FEDERATION_ROOT.parent
PLAN_PATH = FEDERATION_ROOT / "semantic/resources/chronicle.plan.json"
INVENTORY_PATH = REPOSITORY_ROOT / "docs/semantic-federation/behavior-inventory.json"
IMPLEMENTATION_PLAN_PATH = (
    REPOSITORY_ROOT / "docs/semantic-federation/55-step-incremental-rust-plan.md"
)

# The published influence-witness protocol. The Rust constant is the only
# source; the documents below quote it and must never name a superseded one.
INFLUENCE_PROTOCOL_SOURCE = (
    REPOSITORY_ROOT / "rust/chronicle_preprocessing_runtime_wasm/src/binary_exports.rs"
)
INFLUENCE_PROTOCOL_PATTERN = re.compile(
    r'const SOURCE_RESULT_INFLUENCE_PROTOCOL: &str = "([^"]+)";'
)
# The witness publishes its own precision vocabulary. A class the runtime emits
# but no document explains is an unexplained label in a researcher's export.
INFLUENCE_PRECISION_CLASSES = re.compile(
    r'"precisionClasses"\.into\(\),\s*"([^"]+)"\.into\(\),'
)
# These two must each name the current protocol. Requiring only that *some*
# document does lets one free-ride on the other: rewrite one to say "its
# protocol is now `v2`" and the bare version carries no slug to match, while
# the sibling's correct slug satisfies the check.
INFLUENCE_PROTOCOL_PUBLISHERS = (
    REPOSITORY_ROOT / "docs/semantic-federation/production-proof.md",
    REPOSITORY_ROOT / "docs/semantic-federation/final-review-matrix.md",
)


def documentation_files() -> list[Path]:
    """Every prose document that could publish the protocol or its vocabulary.

    Deliberately a search, not an allowlist. A third document that starts
    naming the protocol -- the natural thing to do in a document about this
    artifact -- would be unguarded under an allowlist and would silently
    outlive the constant at the next version bump.
    """
    found = sorted((REPOSITORY_ROOT / "docs").rglob("*.md"))
    for extra in ("README.md", ".semantic-federation/PROJECT_DECISIONS.md"):
        path = REPOSITORY_ROOT / extra
        if path.is_file():
            found.append(path)
    return found

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
        ".execute_review_with_bases(",
        "review_base_bytes,",
        "reconstruction_base_bytes,",
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
    review_execution = execute_body.index(".execute_review_with_bases(")
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
        "background_apps",
        "blind_lineage_suffix_digests",
        "codebook_is_empty",
        "collect_early_assembly",
        "decoded_reconstruction_base",
        "decoded_review_base",
        "matching_reconstruction_base",
        "matching_review_base",
        "parsed_apps_forcing_screen_open",
        "parsed_codebook",
        "parsed_device_sharing",
        "parsed_enrolled_devices",
        "parsed_filter_rules",
        "parsed_study_windows",
        "parsed_survey_attribution",
        "review_applied_rows",
        "review_usage_rows_before_floor",
        "review_static_annotations",
        "review_annotations_fused",
        "review_reconstructed_rows",
        "review_reconstruction_fused",
        "review_reconstruction_output",
        "screen_base_input_key",
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


def protocol_mention_pattern(current: str) -> re.Pattern[str]:
    """Match any version of the protocol family `current` belongs to.

    Derived from the constant rather than written out here. A hardcoded family
    name is the same defect this whole check exists to close: rename the
    protocol in Rust and a literal spelled in this file goes on matching a name
    nothing emits, so every document keeps passing while publishing the old one.
    """
    family, _, _ = current.rpartition("/")
    if not family:
        fail(
            f"influence protocol {current!r} has no family/version shape, so the "
            "document check cannot tell a superseded version from a current one"
        )
    return re.compile(rf"{re.escape(family)}/v\d+")


def precision_class_definition(name: str) -> re.Pattern[str]:
    """The published shape of a precision-class definition.

    A bare substring search is not enough. `unresolved` occurs in
    `final-review-matrix.md` in "rejects unresolved conditional support roles",
    which has nothing to do with the vocabulary -- so a substring check stays
    green with every real definition deleted. This requires the bullet the
    documents actually use: the class as a backticked token, optionally sharing
    the bullet with a sibling class, followed by an em-dash definition.
    """
    token = rf"`{re.escape(name)}`"
    return re.compile(
        rf"^\s*[-*]\s+(?:`[^`]+`\s*/\s*)*{token}\s*(?:/\s*`[^`]+`\s*)*—",
        re.MULTILINE,
    )


def protocol_version_failures(current: str, documents: dict[Path, str]) -> list[str]:
    """Every fully-qualified protocol slug in the docs must name `current`.

    History stays writable: a bare version word such as "v1" carries no slug and
    is not matched, so a sentence describing how the protocol has moved is fine.
    What this refuses is a document publishing a superseded protocol as if it
    were the one the runtime emits, which is how `/v2` outlived the constant.
    """
    mention = protocol_mention_pattern(current)
    failures = []
    for path, text in documents.items():
        for number, line in enumerate(text.splitlines(), 1):
            for named in mention.findall(line):
                if named != current:
                    failures.append(
                        f"{path.relative_to(REPOSITORY_ROOT)}:{number} publishes "
                        f"protocol {named}, but the runtime emits {current}. "
                        "Update the document, or write the history with a bare "
                        "version word instead of the full protocol name."
                    )
    return failures


def check_published_protocol_version() -> str:
    source = INFLUENCE_PROTOCOL_SOURCE.read_text(encoding="utf-8")
    match = INFLUENCE_PROTOCOL_PATTERN.search(source)
    if match is None:
        fail(
            "influence-witness protocol constant is unreadable in "
            f"{INFLUENCE_PROTOCOL_SOURCE.relative_to(REPOSITORY_ROOT)}; the "
            "document check below derives from it and would silently pass"
        )
    current = match.group(1)
    documents = {
        path: path.read_text(encoding="utf-8") for path in documentation_files()
    }
    for message in protocol_version_failures(current, documents):
        fail(message)
    for path in INFLUENCE_PROTOCOL_PUBLISHERS:
        if current not in documents.get(path, ""):
            fail(
                f"{path.relative_to(REPOSITORY_ROOT)} does not publish the "
                f"current influence protocol {current}; the document describes "
                "the witness, so a reader takes its version as the live one"
            )

    classes = INFLUENCE_PRECISION_CLASSES.search(source)
    if classes is None:
        fail(
            "influence-witness precisionClasses metadata is unreadable in "
            f"{INFLUENCE_PROTOCOL_SOURCE.relative_to(REPOSITORY_ROOT)}"
        )
    emitted = [name.strip() for name in classes.group(1).split(",") if name.strip()]
    for name in emitted:
        definition = precision_class_definition(name)
        if not any(definition.search(text) for text in documents.values()):
            fail(
                f"influence witness emits precision class {name!r} that no "
                "document defines; a researcher reading the export would find "
                "a label with no published meaning. Define it as a bullet: "
                f"- `{name}` — what the class claims."
            )
    return current


def self_test() -> None:
    seeded = REPOSITORY_ROOT / "doc.md"
    stale = {seeded: "Its protocol is now `chronicle-source-result-influence/v2`."}
    if not protocol_version_failures("chronicle-source-result-influence/v3", stale):
        fail("protocol checker self-test did not detect its seeded stale version")
    history = {seeded: "The version moved from v1 to v2 rather than forking."}
    if protocol_version_failures("chronicle-source-result-influence/v3", history):
        fail("protocol checker self-test rejected a legitimate history sentence")
    renamed = {seeded: "Its protocol is now `chronicle-cell-influence/v1`."}
    if not protocol_version_failures("chronicle-cell-influence/v2", renamed):
        fail(
            "protocol checker self-test did not follow a renamed protocol family; "
            "the family must be derived from the constant, not spelled here"
        )

    # The exact coincidence that made the substring form of this check useless:
    # `unresolved` appears in final-review-matrix.md in "rejects unresolved
    # conditional support roles", so the class could lose its definition with
    # the gate green.
    mention = "Rust rejects unresolved conditional support roles at ExecuteWorkspace."
    if precision_class_definition("unresolved").search(mention):
        fail("precision-class checker self-test accepted a passing mention as a definition")
    for defined in (
        "- `exact-field` — one supplied raw cell determines one output cell.",
        "- `declared-transitive` / `unresolved` — role or selector scope.",
    ):
        for name in ("exact-field", "declared-transitive", "unresolved"):
            if name not in defined:
                continue
            if not precision_class_definition(name).search(defined):
                fail(
                    "precision-class checker self-test rejected the published "
                    f"definition shape for {name!r}"
                )

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
    protocol = check_published_protocol_version()
    print(
        "execution_claims=valid "
        f"groups={groups} declared_steps={steps} tracked_executors=1 "
        "independently_callable_steps=55 independently_cached_steps=55 "
        f"influence_protocol={protocol} "
        "physical_incrementality=runtime-cutover-active-release-blocked"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
