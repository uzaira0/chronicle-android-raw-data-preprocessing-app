#!/usr/bin/env python3
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ROOT.parent
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

# The browser production boundary may render and interact with Rust-projected
# views, but it must not import the archived TypeScript computation or its
# executable graph definition. Test and migration-evidence modules remain in
# the repository deliberately and are checked by parity tests, not bundled.
production_sources = [
    REPOSITORY_ROOT / "web/src/App.tsx",
    REPOSITORY_ROOT / "web/src/workers",
    REPOSITORY_ROOT / "web/src/components",
    REPOSITORY_ROOT / "web/src/lib/rustPipelineAuthority.ts",
    REPOSITORY_ROOT / "web/src/lib/rustPipelineRuntime.ts",
]
for source in production_sources:
    paths = [source] if source.is_file() else list(source.rglob("*.ts")) + list(source.rglob("*.tsx"))
    for path in paths:
        if ".test." in path.name:
            continue
        text = path.read_text(encoding="utf-8")
        for forbidden in (
            'from "@/lib/browserPipeline"',
            "from '@/lib/browserPipeline'",
            "processRawCsvContent",
            "pipelineGraph/graphDef",
            "pipelineGraph/stepGraph",
            "pipelineGraph/steps/",
            "rustPipelineShadow",
            'executionAuthority: "typescript"',
        ):
            if forbidden in text:
                raise SystemExit(
                    f"TypeScript computation leaked into production boundary: {path}: {forbidden}"
                )

view_registry = json.loads((ROOT / "views/view-registry.json").read_text(encoding="utf-8"))
if not view_registry["envelope"].get("payload_is_family_specific"):
    raise SystemExit("view registry collapsed family-specific payloads")
if not view_registry["envelope"].get("generic_items_links_forbidden"):
    raise SystemExit("generic graph view IR is not forbidden")

print("architecture boundaries valid")
