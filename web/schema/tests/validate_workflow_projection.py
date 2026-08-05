"""Validate the generated workflow projection against its authored LinkML shape.

The local application contract contains browser-option ``default`` annotations
that are consumed by Chronicle's generators but are not LinkML metamodel keys.
To keep those annotations intact, this gate extracts the five authored workflow
classes and their slots into a minimal validation schema, then runs the real
``linkml-validate`` CLI over ``chronicle-workflow.yaml``.

The negative fixture removes an identifier from a nested operation. Requiring
that fixture to fail proves this is an instance-validation gate rather than a
YAML parse or command-smoke check.
"""

from __future__ import annotations

import copy
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml

SCHEMA_DIR = Path(__file__).resolve().parent.parent
CONTRACT = SCHEMA_DIR / "chronicle-local-contract.linkml.yaml"
PROJECTION = SCHEMA_DIR / "chronicle-workflow.yaml"
ARTIFACT_DIR = Path(__file__).resolve().parent / ".artifacts"

WORKFLOW_CLASSES = (
    "WorkflowPhase",
    "WorkflowOperation",
    "WorkflowArtifact",
    "WorkflowQuery",
    "WorkflowContractProjection",
)


def load_yaml(path: Path) -> dict[str, Any]:
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return document


def build_validation_schema(contract: dict[str, Any]) -> dict[str, Any]:
    classes = contract.get("classes", {})
    slots = contract.get("slots", {})
    selected_classes: dict[str, Any] = {}
    selected_slot_names: set[str] = set()
    for class_name in WORKFLOW_CLASSES:
        class_definition = classes.get(class_name)
        if not isinstance(class_definition, dict):
            raise ValueError(f"authored workflow class {class_name} is missing")
        selected_classes[class_name] = copy.deepcopy(class_definition)
        selected_slot_names.update(class_definition.get("slots", []))

    missing_slots = sorted(selected_slot_names - slots.keys())
    if missing_slots:
        raise ValueError(
            f"authored workflow slots are missing: {', '.join(missing_slots)}"
        )

    return {
        "id": "https://chronicle.local/schemas/chronicle-workflow-validation",
        "name": "chronicle_workflow_validation",
        "title": "Chronicle Workflow Projection Validation",
        "prefixes": copy.deepcopy(contract.get("prefixes", {})),
        "default_prefix": contract.get("default_prefix", "chronicle"),
        "default_range": contract.get("default_range", "string"),
        "imports": copy.deepcopy(contract.get("imports", ["linkml:types"])),
        "classes": selected_classes,
        "slots": {
            name: copy.deepcopy(slots[name]) for name in sorted(selected_slot_names)
        },
    }


def run_validator(
    executable: str, schema: Path, instance: Path
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            executable,
            "--schema",
            str(schema),
            "--target-class",
            "WorkflowContractProjection",
            str(instance),
        ],
        cwd=SCHEMA_DIR,
        check=False,
        capture_output=True,
        text=True,
    )


def main() -> int:
    executable = shutil.which("linkml-validate")
    if executable is None:
        print(
            "FAIL: linkml-validate is unavailable in the validation environment",
            file=sys.stderr,
        )
        return 2
    if not PROJECTION.exists():
        print(f"FAIL: generated projection not found at {PROJECTION}", file=sys.stderr)
        return 2

    contract = load_yaml(CONTRACT)
    projection = load_yaml(PROJECTION)
    operations = projection.get("workflow_operations")
    if not isinstance(operations, list) or not operations:
        print("FAIL: workflow projection has no operations", file=sys.stderr)
        return 1

    validation_schema = build_validation_schema(contract)
    invalid_projection = copy.deepcopy(projection)
    invalid_projection["workflow_operations"][0].pop("workflow_id", None)

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="workflow-linkml-", dir=ARTIFACT_DIR
    ) as temp_name:
        temp_dir = Path(temp_name)
        schema_path = temp_dir / "workflow-validation.linkml.yaml"
        invalid_path = temp_dir / "invalid-workflow.yaml"
        schema_path.write_text(
            yaml.safe_dump(validation_schema, sort_keys=False),
            encoding="utf-8",
        )
        invalid_path.write_text(
            yaml.safe_dump(invalid_projection, sort_keys=False),
            encoding="utf-8",
        )

        positive = run_validator(executable, schema_path, PROJECTION)
        if positive.returncode != 0:
            print(
                "FAIL: generated workflow projection does not conform to LinkML",
                file=sys.stderr,
            )
            print(positive.stdout, file=sys.stderr)
            print(positive.stderr, file=sys.stderr)
            return 1

        negative = run_validator(executable, schema_path, invalid_path)
        if negative.returncode == 0:
            print(
                "FAIL: LinkML accepted an operation with no required workflow_id",
                file=sys.stderr,
            )
            return 1

    print(
        "validate_workflow_projection OK: generated YAML conforms and the nested negative case is rejected."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
