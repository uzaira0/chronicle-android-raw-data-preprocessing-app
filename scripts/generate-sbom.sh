#!/usr/bin/env bash
# CycloneDX SBOM of the deployed web app (launch audit 2026-10-03, analysis S9).
#
#   scripts/generate-sbom.sh [output-dir]      (default: web/dist)
#
# Writes <output-dir>/sbom.cdx.json, served at <site>/sbom.cdx.json next to
# THIRD-PARTY-NOTICES.txt. Run after the Vite build: `make deploy-artifact`,
# `make pin-figures`, `make check` and the Pages deploy workflow all do, and
# web/scripts/check_deploy_artifact.mts fails when the file is missing or wrong.
#
# syft catalogs the lockfiles the shipped code is built from:
#   web/package-lock.json                       npm, production entries only
#   rust/chronicle_preprocessing_runtime_wasm/Cargo.lock and
#   rust/chronicle_semantic_index_wasm/Cargo.lock    the two WASM packages
# A Cargo.lock also lists dev-, build- and host-only crates, so the Rust
# components are then narrowed to web/third-party/rust-wasm-crates.txt — the
# committed normal-dependency closure for wasm32 that THIRD-PARTY-NOTICES.txt
# is built from (web/scripts/rust_wasm_notices.mjs). A crate in that list that
# syft did not report fails the script. The application's own packages
# (chronicle_*, the web package) are the SBOM's subject, not its components.
#
# The output is reproducible: the timestamp is the HEAD commit time and the
# serial number is derived from the component list.
set -euo pipefail
cd "$(dirname "$0")/.."

# SYFT overrides the binary (the deploy workflow passes the path that
# anchore/sbom-action/download-syft reports).
syft=${SYFT:-syft}
if ! command -v "$syft" >/dev/null 2>&1; then
  echo "syft not found — install with: brew install syft (CI: anchore/sbom-action/download-syft)" >&2
  exit 1
fi

out_dir=${1:-web/dist}
[[ -d "$out_dir" ]] || { echo "output directory $out_dir does not exist (build the app first)" >&2; exit 1; }

# Stage only the lockfiles, so nothing else in the tree is cataloged.
stage=target/sbom-input
rm -rf "$stage"
mkdir -p "$stage/web" "$stage/runtime" "$stage/semantic-index"
cp web/package-lock.json "$stage/web/"
cp rust/chronicle_preprocessing_runtime_wasm/Cargo.lock "$stage/runtime/"
cp rust/chronicle_semantic_index_wasm/Cargo.lock "$stage/semantic-index/"

SYFT_CHECK_FOR_APP_UPDATE=false SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES=false \
  "$syft" scan "dir:$stage" --quiet \
  --override-default-catalogers javascript-lock-cataloger,rust-cargo-lock-cataloger \
  -o "cyclonedx-json=$stage/syft.cdx.json"

python3 - "$stage/syft.cdx.json" "$out_dir/sbom.cdx.json" <<'PY'
import json, re, subprocess, sys, uuid
from datetime import datetime, timezone

raw_path, out_path = sys.argv[1:]
bom = json.load(open(raw_path))

linked = set()
for line in open("web/third-party/rust-wasm-crates.txt", encoding="utf-8"):
    match = re.match(r"^  (\S+) (\S+)  \[", line)
    if match:
        linked.add(match.groups())
if not linked:
    sys.exit("no crates parsed from web/third-party/rust-wasm-crates.txt")

def own(component):
    return component["name"].startswith("chronicle_") or component["name"] == "chronicle-preprocessing-web"

kept, seen = [], set()
for component in bom.get("components", []):
    purl = component.get("purl", "")
    if not purl.startswith(("pkg:npm/", "pkg:cargo/")) or own(component):
        continue
    if purl.startswith("pkg:cargo/") and (component["name"], component.get("version")) not in linked:
        continue  # dev-, build- or host-only crate: not in the WASM
    if purl in seen:
        continue  # the same crate in both WASM lockfiles
    seen.add(purl)
    # syft's own properties carry staging paths; purl, cpe and licenses stay.
    component = {key: value for key, value in component.items() if key != "properties"}
    component["bom-ref"] = purl
    kept.append(component)

found = {(c["name"], c["version"]) for c in kept if c["purl"].startswith("pkg:cargo/")}
missing = sorted(linked - found)
if missing:
    sys.exit("crates linked into the WASM but absent from the syft SBOM: "
             + ", ".join(f"{name} {version}" for name, version in missing))
kept.sort(key=lambda c: c["purl"])
if not any(c["purl"].startswith("pkg:npm/") for c in kept):
    sys.exit("syft reported no production npm packages from web/package-lock.json")

package = json.load(open("web/package.json"))
commit_time = subprocess.run(["git", "log", "-1", "--format=%cI"], capture_output=True,
                             text=True, check=True).stdout.strip()
timestamp = datetime.fromisoformat(commit_time).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
serial = uuid.uuid5(uuid.NAMESPACE_URL, "chronicle-sbom:" + "\n".join(c["purl"] for c in kept))
syft_tool = (bom.get("metadata", {}).get("tools", {}).get("components") or [])
sbom = {
    # The components are syft's, so the document keeps syft's spec version.
    "$schema": f"http://cyclonedx.org/schema/bom-{bom['specVersion']}.schema.json",
    "bomFormat": "CycloneDX",
    "specVersion": bom["specVersion"],
    "serialNumber": f"urn:uuid:{serial}",
    "version": 1,
    "metadata": {
        "timestamp": timestamp,
        "tools": {"components": syft_tool},
        "component": {
            "bom-ref": "chronicle-android-raw-data-preprocessing-app",
            "type": "application",
            "name": "chronicle-android-raw-data-preprocessing-app",
            "version": package["version"],
            "licenses": [{"license": {"id": "GPL-3.0-only"}}],
            "externalReferences": [{
                "type": "vcs",
                "url": "https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app",
            }],
        },
    },
    "components": kept,
    "dependencies": [{
        "ref": "chronicle-android-raw-data-preprocessing-app",
        "dependsOn": [c["bom-ref"] for c in kept],
    }],
}
with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(sbom, handle, indent=1, sort_keys=True)
    handle.write("\n")
npm = sum(c["purl"].startswith("pkg:npm/") for c in kept)
print(f"sbom: {out_path}: {npm} npm packages, {len(kept) - npm} Rust crates")
PY
