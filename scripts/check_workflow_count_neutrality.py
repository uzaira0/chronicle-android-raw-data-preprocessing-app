#!/usr/bin/env python3
"""Reject fixed workflow topology branding and retired contract vocabulary."""

from __future__ import annotations

import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {
    ".git",
    ".artifacts",
    ".venv",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "target",
    "test-results",
    "mutants",
    "reports",
    "venv",
}
SOURCE_SUFFIXES = {
    ".json",
    ".md",
    ".mjs",
    ".mts",
    ".py",
    ".rs",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
RETIRED_NAMES = (
    "pipeline_step_contract",
    "step_contract",
    "chronicle-preprocessing-step-contract",
    "stage-view-json",
    "rustStageView",
    "planStageView",
    "rustStepContract",
    "PipelineStep",
    "NodeExecution",
    "step_id",
    "step_states",
    "part_of_step",
    "unit_id",
    "field-level-step-contract",
    # A query-group collection must be derived from WORKFLOW_QUERIES.  These
    # names previously denoted a second, fixed topology registry.
    "QUERY_GROUPS",
    "QUERY_GROUP_COUNT",
    "WORKFLOW_GROUPS",
    "WORKFLOW_QUERY_GROUPS",
    "WORKFLOW_QUERY_GROUP_COUNT",
    "QUERY_GROUP_REGISTRY",
    "GROUP_REGISTRY",
    "FIXED_GROUPS",
)
RETIRED_WORKFLOW_TERMINOLOGY = re.compile(
    r"(?:"
    r"logical[-_ ]?stage"
    r"|logical[-_ ]?checkpoints?"
    r"|product[-_ ]?stage"
    r"|(?:terminal|target)[-_ ]?logical[-_ ]?node"
    r")",
    re.IGNORECASE,
)
# Known legacy counts are rejected even without an adjective; any count presented
# as the production/versioned topology is rejected regardless of its value.
TOPOLOGY_BRANDING = re.compile(
    r"\b(?:"
    r"(?:14|15|55)[- ](?:"
    r"(?:logical[- ])?stage|graph[- ]node|step|query|transformation|computation|"
    r"node|group|unit|knob|option"
    r")s?"
    r"|(?:production|versioned|canonical|fixed|hardcoded)\s+\d+[- ](?:"
    r"step|query|transformation|computation|node|stage|group|unit|knob|option"
    r")s?"
    r")\b",
    re.IGNORECASE,
)
REGISTRY_BASENAME = (
    r"(?:queries|query_registry|query_groups|workflow_query_group_ids|"
    r"query_checkpoints|workflow_query_digests|workflow_query_group_digests|"
    r"workflow_query_group_checkpoints|option_keys|role_ids|tracked|projected)"
)
REGISTRY_VALUE = (
    rf"(?:WORKFLOW_QUERIES|QUERY_GROUPS|CERTIFIED_OPTION_KEYS|{REGISTRY_BASENAME}|"
    rf"[A-Za-z_][A-Za-z0-9_.]{{0,120}}{REGISTRY_BASENAME}[A-Za-z0-9_.]{{0,80}})"
)
REGISTRY_REFERENCE = rf"{REGISTRY_VALUE}(?:\(\))?"
# Empty/singleton checks can encode real behavior. Nontrivial registry cardinalities
# must instead be compared with another derived set or asserted by exact identities.
NONTRIVIAL_LITERAL_COUNT = r"(?:[2-9]|\d{2,})"
LITERAL_LENGTH_OPERATOR = re.compile(
    rf"(?:\.len\(\)\s*,\s*{NONTRIVIAL_LITERAL_COUNT}\b"
    rf"|\.length\s*[!=]==?\s*{NONTRIVIAL_LITERAL_COUNT}\b"
    rf"|\.toHaveLength\(\s*{NONTRIVIAL_LITERAL_COUNT}\s*\))",
    re.IGNORECASE,
)
PYTHON_REGISTRY_LITERAL = re.compile(
    rf"len\(\s*{REGISTRY_REFERENCE}\s*\)\s*[!=]=\s*{NONTRIVIAL_LITERAL_COUNT}\b",
    re.IGNORECASE,
)
REGISTRY_VALUE_AT_END = re.compile(rf"{REGISTRY_REFERENCE}\s*$", re.IGNORECASE)
EXPECT_REGISTRY_AT_END = re.compile(
    rf"expect\(\s*{REGISTRY_REFERENCE}\s*\)\s*$", re.IGNORECASE
)
POSITIONAL_REGISTRY = re.compile(
    rf"\b{REGISTRY_REFERENCE}\s*(?:"
    rf"\[\s*\d+|(?:\.iter\(\))?\.(?:get|nth|take|skip)\(\s*\d+"
    rf")",
    re.IGNORECASE,
)
ORDINAL_DOC_REFERENCE = re.compile(
    r"(?:docs/(?:pipeline-graph|workflow)/\d{2}[-_][A-Za-z0-9_.-]+"
    r"|\bdocs?[- ](?:0[1-9]|1[0-3])(?=\b|[/,])"
    r"|\b(?:esp\.|especially)\s+(?:0[1-9]|1[0-3])(?=\b|,))",
    re.IGNORECASE,
)
RETIRED_FEATURE_ORDINAL = re.compile(
    r"§\s*14(?=\s+(?:valid-usage|credit|layer|paradigm|view|attribution))",
    re.IGNORECASE,
)
RETIRED_WORKFLOW_FILENAME = re.compile(
    r"(?:"
    r"logical[-_]?stage"
    r"|logical[-_]?checkpoint"
    r"|product[-_]?stage"
    r"|pipeline[-_]?step"
    r"|(?:^|[-_])\d+[-_](?:step|query|node|stage|group|unit|knob|option)"
    r")",
    re.IGNORECASE,
)
ORDINAL_DOC_SCOPES = (
    Path("docs/workflow"),
    Path("docs/superpowers/plans"),
    Path("docs/superpowers/specs"),
)


def included(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if path.is_symlink():
        return False
    if path.name == "check_workflow_count_neutrality.py":
        return False
    if relative == Path("docs/workflow/contract-and-dag-migration-plan.md"):
        return False
    if any(part in SKIP_PARTS for part in relative.parts):
        return False
    if path.suffix not in SOURCE_SUFFIXES and path.name != "Makefile":
        return False
    if path.name in {"CHANGELOG.md"}:
        return False
    return True


def candidate_paths() -> list[Path]:
    paths: list[Path] = []
    for directory, child_directories, filenames in os.walk(ROOT):
        child_directories[:] = sorted(
            name for name in child_directories if name not in SKIP_PARTS
        )
        paths.extend(Path(directory, filename) for filename in sorted(filenames))
    return paths


def is_ordinal_doc_scope(relative: Path) -> bool:
    return any(relative == scope or scope in relative.parents for scope in ORDINAL_DOC_SCOPES)


def append_pattern_failures(
    failures: list[str],
    relative: Path,
    text: str,
    pattern: re.Pattern[str],
    message: str,
) -> None:
    for match in pattern.finditer(text):
        line_number = text.count("\n", 0, match.start()) + 1
        failures.append(f"{relative}:{line_number}: {message}")


def append_registry_literal_failures(
    failures: list[str], relative: Path, text: str
) -> None:
    for match in LITERAL_LENGTH_OPERATOR.finditer(text):
        prefix = text[max(0, match.start() - 240) : match.start()]
        if not (
            REGISTRY_VALUE_AT_END.search(prefix)
            or EXPECT_REGISTRY_AT_END.search(prefix)
        ):
            continue
        line_number = text.count("\n", 0, match.start()) + 1
        failures.append(f"{relative}:{line_number}: literal registry-size assertion")
    append_pattern_failures(
        failures,
        relative,
        text,
        PYTHON_REGISTRY_LITERAL,
        "literal registry-size assertion",
    )


def main() -> int:
    failures: list[str] = []
    for path in candidate_paths():
        if not included(path):
            continue
        relative = path.relative_to(ROOT)
        filename_match = RETIRED_WORKFLOW_FILENAME.search(path.name)
        if filename_match:
            failures.append(
                f"{relative}: retired workflow branding in filename "
                f"{filename_match.group(0)!r}"
            )
        try:
            text = path.read_text(encoding="utf-8")
        except (FileNotFoundError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            retired = next((name for name in RETIRED_NAMES if name in line), None)
            if retired:
                failures.append(f"{relative}:{line_number}: retired name {retired!r}")
            if TOPOLOGY_BRANDING.search(line):
                failures.append(f"{relative}:{line_number}: fixed topology branding")
            terminology_match = RETIRED_WORKFLOW_TERMINOLOGY.search(line)
            if terminology_match:
                failures.append(
                    f"{relative}:{line_number}: retired workflow/checkpoint terminology "
                    f"{terminology_match.group(0)!r}"
                )
        append_registry_literal_failures(failures, relative, text)
        append_pattern_failures(
            failures,
            relative,
            text,
            POSITIONAL_REGISTRY,
            "positional workflow-registry access",
        )
        if is_ordinal_doc_scope(relative):
            append_pattern_failures(
                failures,
                relative,
                text,
                ORDINAL_DOC_REFERENCE,
                "ordinal workflow-document reference",
            )
            append_pattern_failures(
                failures,
                relative,
                text,
                RETIRED_FEATURE_ORDINAL,
                "retired ordinal feature name",
            )
    if failures:
        raise SystemExit("workflow count-neutrality check failed:\n" + "\n".join(failures))
    print("workflow_count_neutrality=valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
