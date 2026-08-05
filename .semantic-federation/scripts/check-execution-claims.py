#!/usr/bin/env python3
"""Keep generated execution claims equal to the active Rust query registry."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path


FEDERATION_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = FEDERATION_ROOT.parent
PLAN_PATH = FEDERATION_ROOT / "semantic/resources/chronicle.plan.json"
INVENTORY_PATH = REPOSITORY_ROOT / "docs/semantic-federation/behavior-inventory.json"
IMPLEMENTATION_PLAN_PATH = (
    REPOSITORY_ROOT / "docs/semantic-federation/incremental-runtime-plan.md"
)

# Changed-cell totals are the one class of published figure with no producer in
# the prose: a campaign reruns, the checked ledger moves, and the four documents
# that quote its total keep the old number indefinitely. That is exactly what
# happened — the sidecars held 202,124 and 651,823 while the documents published
# 204,370, 660,187, and a sum of 864,557. Derive all three from the checked
# evidence and let no document publish a fourth value.
GOLDEN_EVIDENCE_ROOT = (
    REPOSITORY_ROOT / "web/src/lib/pipelineGraph/golden/family-expected"
)
CELL_EVIDENCE_CAMPAIGNS = (
    ("artifact-influence-ledger.json", "artifact-output-cell-correspondence.json.gz"),
    (
        "raw-boundary-influence-ledger.json",
        "raw-boundary-output-cell-correspondence.json.gz",
    ),
)
# Every published spelling of the total, so a document cannot escape the gate by
# rewording. The text is whitespace-normalized first because these sentences
# wrap mid-phrase.
CHANGED_CELL_CLAIM = re.compile(
    r"([\d][\d,]*)\s+(?:exact\s+)?(?:"
    r"canonical CSV/JSON cell addresses"
    r"|changed[- ]cell addresses"
    r"|changed canonical output-cell addresses"
    r")"
)
# Documents that quote the combined total of both campaigns.
CELL_EVIDENCE_TOTAL_DOCUMENTS = (
    REPOSITORY_ROOT / "README.md",
    REPOSITORY_ROOT / "web/combinatorial/README.md",
    REPOSITORY_ROOT / "docs/semantic-federation/production-proof.md",
    REPOSITORY_ROOT / "docs/semantic-federation/final-review-matrix.md",
)
# The document that quotes each campaign separately.
CELL_EVIDENCE_PER_CAMPAIGN_DOCUMENT = (
    REPOSITORY_ROOT / "docs/semantic-federation/artifact-dependency-tomography.md"
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
        "count-neutral workflow contract",
        "registered queries match the complete Rust oracle",
        "Persisted Salsa snapshots were removed",
    ],
    REPOSITORY_ROOT / ".semantic-federation/PROJECT_DECISIONS.md": [
        "Salsa `0.28.1`",
        "callable Rust queries",
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/production-proof.md": [
        "registered Salsa-tracked Rust product computations",
        "actual executed-query IDs",
    ],
    REPOSITORY_ROOT / "docs/semantic-federation/final-review-matrix.md": [
        "Physical query-registry executor",
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
        "The runtime's query status labels are created after the fused result exists"
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


def check_machine_state() -> tuple[int, int, set[str]]:
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    workflow_queries = plan["queries"]
    groups = plan["query_groups"]
    if plan["implementation_state"]["physical_execution"] != "salsa-tracked-rust-pipeline-v2":
        fail("executable plan does not select the registered-query Salsa executor")
    if not groups or not workflow_queries:
        fail("the plan must contain non-empty query-group and query registries")
    if len({query["query_id"] for query in workflow_queries}) != len(workflow_queries):
        fail("declared query IDs are not unique")

    physical = inventory["coverage"]["physical_execution"]
    query_count = len(workflow_queries)
    expected_physical = {
        "tracked_executor_count": 1,
        "fused_cold_oracle_count": 1,
        "independently_callable_queries": query_count,
        "independently_cached_queries": query_count,
        "production_authoritative_incremental_queries": query_count,
        "actual_query_execution_event_ids": query_count,
    }
    if physical != expected_physical:
        fail(f"behavior inventory physical state drift: {physical!r}")
    if inventory["physical_incremental_execution_status"] != "runtime-cutover-release-verified":
        fail("behavior inventory no longer reports the release-verified runtime cutover truthfully")
    if inventory["rust_actual_query_event_projection"] != {
        "covers": "rust_declared_query_ids",
        "count": query_count,
    }:
        fail("behavior inventory does not cover all actual query event IDs")
    if inventory["rust_independently_callable_query_ids"] != [
        query["query_id"] for query in workflow_queries
    ]:
        fail("behavior inventory callable queries do not exactly match the plan")
    if inventory["rust_independently_cached_query_ids"] != [
        query["query_id"] for query in workflow_queries
    ]:
        fail("behavior inventory cached queries do not exactly match the plan")
    for query in workflow_queries:
        source = query.get("rust_executable_source", {})
        if source.get("entrypoint") != query["query_id"] or source.get("tracking") != "salsa-query":
            fail(f"plan lacks an exact Salsa query source for {query['query_id']}")

    implementation_plan = IMPLEMENTATION_PLAN_PATH.read_text(encoding="utf-8")
    for phrase in (
        "The registry size is deliberately not part of this contract.",
        "CI proves set equality between the Rust workflow contract",
    ):
        if not contains_phrase(implementation_plan, phrase):
            fail(f"implementation plan lost its count-neutral registry policy: {phrase}")
    return (
        len(groups),
        len(workflow_queries),
        {query["query_id"] for query in workflow_queries},
    )


def check_source_shape(declared_queries: set[str]) -> None:
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
        "fn build_runtime_query_executions(",
        "fn project_query_groups(",
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
    projected_status = execute_body.index("build_runtime_query_executions(")
    group_projection = execute_body.index("project_query_groups(")
    if not (
        cache_decision
        < tracked_execution
        < review_execution
        < full_execution
        < projected_status
        < group_projection
    ):
        fail("cache validation, tracked execution, exact query reporting, and query-group projection are out of order")

    incremental_path = (
        REPOSITORY_ROOT
        / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2_incremental.rs"
    )
    incremental = incremental_path.read_text(encoding="utf-8")
    import re

    # Salsa accepts both `#[salsa::tracked]` and `#[salsa::tracked(...)]`. Every
    # function in the kernel happens to use the parenthesized form today, so a
    # pattern that required the parentheses matched all 79 and looked correct —
    # but a new query written in the bare canonical form would be invisible here,
    # and fixed product/internal counts below would keep passing
    # while the real split had moved. Accept both spellings.
    tracked_functions = re.findall(
        r"#\[salsa::tracked(?:\([^\]]*\))?\]\s*fn\s+([a-z0-9_]+)\s*\(",
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
    if product_queries != declared_queries:
        fail(
            "Salsa product-query registry mismatch: "
            f"missing={sorted(declared_queries - product_queries)}, "
            f"extra={sorted(product_queries - declared_queries)}"
        )
    if not derived_queries:
        fail("the runtime must declare its internal cache queries explicitly")

    oracle = (
        REPOSITORY_ROOT / "rust/chronicle_chrono_kernel_wasm/src/pipeline_v2.rs"
    ).read_text(encoding="utf-8")
    if "pub fn run_pipeline_v2_with_supports(" not in oracle:
        fail("independent fused cold-test oracle is missing")

    capabilities = (
        REPOSITORY_ROOT
        / "rust/chronicle_preprocessing_semantic_adapter/src/capabilities.rs"
    ).read_text(encoding="utf-8")
    query_binding = capabilities[
        capabilities.index("pub struct QueryBinding") : capabilities.index(
            "include!(", capabilities.index("pub struct QueryBinding")
        )
    ]
    for field in ("entrypoint: &'static str", "tracking: &'static str"):
        if field not in query_binding:
            fail(f"exact query binding lost field: {field}")
    if "stage: PhysicalQueryGroup" in query_binding:
        fail("exact query bindings must not collapse into query-group projections")


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


def changed_cell_claims(text: str) -> list[int]:
    """Every changed-cell count a document publishes, in document order."""
    normalized = re.sub(r"\s+", " ", text)
    return [
        int(match.group(1).replace(",", ""))
        for match in CHANGED_CELL_CLAIM.finditer(normalized)
    ]


def check_published_cell_evidence_counts() -> tuple[int, int, int]:
    """Bind every published changed-cell figure to the checked sidecars.

    The ledger's own recorded count is not trusted: it is recomputed from the
    compressed sidecar, and the sidecar is checked against the digest the ledger
    committed to. A campaign rerun therefore moves the documents or fails here.
    """
    totals: list[int] = []
    for ledger_name, sidecar_name in CELL_EVIDENCE_CAMPAIGNS:
        ledger = json.loads(
            (GOLDEN_EVIDENCE_ROOT / ledger_name).read_text(encoding="utf-8")
        )
        evidence = ledger["cellEvidence"]
        # The campaign hashes the serialized JSON it compressed, not the gzip
        # container, so the receipt survives a re-compression at a different
        # level. Decompress first or every comparison here is a false failure.
        serialized = gzip.decompress(
            (GOLDEN_EVIDENCE_ROOT / sidecar_name).read_bytes()
        )
        digest = "sha256:" + hashlib.sha256(serialized).hexdigest()
        if evidence["contentDigest"] != digest:
            fail(
                f"{ledger_name} commits to {evidence['contentDigest']} but "
                f"{sidecar_name} content hashes to {digest}"
            )
        cases = json.loads(serialized)["cases"]
        observed = sum(len(case["changedOutputCellAddresses"]) for case in cases)
        if len(cases) != evidence["cases"]:
            fail(
                f"{ledger_name} records {evidence['cases']} cases but "
                f"{sidecar_name} holds {len(cases)}"
            )
        if observed != evidence["changedCellAddresses"]:
            fail(
                f"{ledger_name} records {evidence['changedCellAddresses']} changed "
                f"cells but {sidecar_name} holds {observed}"
            )
        totals.append(observed)

    combined = sum(totals)
    permitted = set(totals) | {combined}

    per_campaign = CELL_EVIDENCE_PER_CAMPAIGN_DOCUMENT.read_text(encoding="utf-8")
    published = changed_cell_claims(per_campaign)
    for expected in totals:
        if expected not in published:
            fail(
                f"{CELL_EVIDENCE_PER_CAMPAIGN_DOCUMENT.name} does not publish the "
                f"campaign's {expected} changed-cell addresses"
            )
    for document in CELL_EVIDENCE_TOTAL_DOCUMENTS:
        if combined not in changed_cell_claims(document.read_text(encoding="utf-8")):
            fail(
                f"{document.name} does not publish the combined "
                f"{combined} changed-cell addresses"
            )

    for document in documentation_files() + [REPOSITORY_ROOT / "web/combinatorial/README.md"]:
        for claimed in changed_cell_claims(document.read_text(encoding="utf-8")):
            if claimed not in permitted:
                fail(
                    f"{document.relative_to(REPOSITORY_ROOT)} publishes "
                    f"{claimed} changed-cell addresses, which no checked sidecar "
                    f"produces (evidence holds {sorted(permitted)})"
                )
    return totals[0], totals[1], combined


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
    # The drift this check exists for: a document keeps a superseded total.
    # Parsing must see the number through every published spelling, including
    # the ones that wrap across lines.
    for wording, expected in (
        ("sidecars retain 864,557 exact changed-cell\naddresses", 864557),
        ("864,557 exact canonical CSV/JSON cell addresses changed by", 864557),
        ("It contains 202,124 changed-cell addresses across", 202124),
        ("and 651,823 changed canonical output-cell addresses in", 651823),
        ("; 853,947 changed-cell addresses;", 853947),
    ):
        if changed_cell_claims(wording) != [expected]:
            fail(
                "changed-cell claim parser self-test missed a published spelling: "
                f"{wording!r} parsed as {changed_cell_claims(wording)}"
            )
    if changed_cell_claims("the campaign cases and registered queries carry no cell claim"):
        fail("changed-cell claim parser self-test matched an unrelated number")

    print("execution_claims_self_test=passed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    check_document_text()
    groups, query_count, declared_queries = check_machine_state()
    check_source_shape(declared_queries)
    protocol = check_published_protocol_version()
    artifact_cells, boundary_cells, combined_cells = check_published_cell_evidence_counts()
    print(
        "execution_claims=valid "
        f"query_groups={groups} declared_queries={query_count} tracked_executors=1 "
        f"independently_callable_queries={query_count} independently_cached_queries={query_count} "
        f"influence_protocol={protocol} "
        f"changed_cells_artifact={artifact_cells} "
        f"changed_cells_boundary={boundary_cells} "
        f"changed_cells_total={combined_cells} "
        "physical_incrementality=runtime-cutover-release-verified"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
