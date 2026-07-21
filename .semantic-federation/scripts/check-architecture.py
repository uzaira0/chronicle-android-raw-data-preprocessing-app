#!/usr/bin/env python3
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
federation = json.loads((ROOT / "federation.json").read_text(encoding="utf-8"))
families = set(federation["computational_families"])
actual = {
    path.name
    for path in (ROOT / "semantic/families").iterdir()
    if path.is_dir()
}
expected = {family.replace("_", "-") for family in families}
if actual != expected:
    raise SystemExit(f"family artifact closure mismatch: expected={sorted(expected)} actual={sorted(actual)}")

for path in (ROOT / "semantic").rglob("*"):
    if path.suffix in {".rs", ".ts", ".tsx", ".py", ".kt", ".wasm"}:
        raise SystemExit(f"executable code leaked into semantic profile resources: {path}")

view_registry = json.loads((ROOT / "views/view-registry.json").read_text(encoding="utf-8"))
if not view_registry["envelope"].get("payload_is_family_specific"):
    raise SystemExit("view registry collapsed family-specific payloads")
if not view_registry["envelope"].get("generic_items_links_forbidden"):
    raise SystemExit("generic graph view IR is not forbidden")

print("architecture boundaries valid")
