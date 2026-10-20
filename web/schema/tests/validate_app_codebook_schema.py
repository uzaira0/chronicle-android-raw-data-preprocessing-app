"""Validate the bundled app-codebook schema against its authored LinkML shape.

``AppCodebookSchema`` and ``AppCodebookColumn`` are extracted from the local
contract into a minimal validation schema (the contract's browser-option
annotations are not LinkML metamodel keys), and the real ``linkml-validate``
CLI runs over both shipped copies of the schema JSON. The copies must also be
byte-identical.

A corrupted copy (one column without its ``source_column``) must be rejected,
so this is an instance-validation gate and not a parse or command smoke check.
The kernel's own parser adds the cross-field rules LinkML cannot state.
"""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml

SCHEMA_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SCHEMA_DIR.parent.parent
CONTRACT = SCHEMA_DIR / "chronicle-local-contract.linkml.yaml"
INSTANCES = (
    REPO_ROOT / "web" / "src" / "assets" / "defaults" / "unified_app_codebook.schema.json",
    REPO_ROOT / "app_codebook_files" / "unified_app_codebook.schema.json",
)
ARTIFACT_DIR = Path(__file__).resolve().parent / ".artifacts"
CLASSES = ("AppCodebookSchema", "AppCodebookColumn")


def build_validation_schema(contract: dict[str, Any]) -> dict[str, Any]:
    classes = contract.get("classes", {})
    slots = contract.get("slots", {})
    selected: dict[str, Any] = {}
    slot_names: set[str] = set()
    for name in CLASSES:
        definition = classes.get(name)
        if not isinstance(definition, dict):
            raise ValueError(f"authored class {name} is missing")
        selected[name] = copy.deepcopy(definition)
        slot_names.update(definition.get("slots", []))
    missing = sorted(slot_names - slots.keys())
    if missing:
        raise ValueError(f"authored slots are missing: {', '.join(missing)}")
    return {
        "id": "https://chronicle.local/schemas/chronicle-app-codebook-schema-validation",
        "name": "chronicle_app_codebook_schema_validation",
        "prefixes": copy.deepcopy(contract.get("prefixes", {})),
        "default_prefix": contract.get("default_prefix", "chronicle"),
        "default_range": contract.get("default_range", "string"),
        "imports": copy.deepcopy(contract.get("imports", ["linkml:types"])),
        "classes": selected,
        "slots": {name: copy.deepcopy(slots[name]) for name in sorted(slot_names)},
    }


def validate(executable: str, schema: Path, instance: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [executable, "--schema", str(schema), "--target-class", "AppCodebookSchema", str(instance)],
        cwd=SCHEMA_DIR,
        check=False,
        capture_output=True,
        text=True,
    )


def main() -> int:
    executable = shutil.which("linkml-validate")
    if executable is None:
        print("FAIL: linkml-validate is unavailable in the validation environment", file=sys.stderr)
        return 2
    first, second = (path.read_bytes() for path in INSTANCES)
    if first != second:
        print(f"FAIL: {INSTANCES[0]} and {INSTANCES[1]} differ", file=sys.stderr)
        return 1
    contract = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    corrupted = json.loads(first)
    corrupted["codebook_columns"][0].pop("source_column")

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="app-codebook-schema-", dir=ARTIFACT_DIR) as temp_name:
        temp_dir = Path(temp_name)
        schema_path = temp_dir / "app-codebook-schema.linkml.yaml"
        schema_path.write_text(yaml.safe_dump(build_validation_schema(contract), sort_keys=False), encoding="utf-8")
        corrupted_path = temp_dir / "corrupted.schema.json"
        corrupted_path.write_text(json.dumps(corrupted), encoding="utf-8")

        positive = validate(executable, schema_path, INSTANCES[0])
        if positive.returncode != 0:
            print("FAIL: the bundled app-codebook schema does not conform to LinkML", file=sys.stderr)
            print(positive.stdout, file=sys.stderr)
            print(positive.stderr, file=sys.stderr)
            return 1
        negative = validate(executable, schema_path, corrupted_path)
        if negative.returncode == 0:
            print("FAIL: LinkML accepted a codebook column with no source_column", file=sys.stderr)
            return 1

    print("validate_app_codebook_schema OK: the bundled schema conforms and the corrupted copy is rejected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
