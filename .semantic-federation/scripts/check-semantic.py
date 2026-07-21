#!/usr/bin/env python3
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / "semantic/profile-source.json").read_text(encoding="utf-8"))
manifest = json.loads((ROOT / "semantic/semantic-profile.json").read_text(encoding="utf-8"))
lock = json.loads((ROOT / "semantic/semantic-profile.lock").read_text(encoding="utf-8"))
report = json.loads((ROOT / "semantic/conformance-report.json").read_text(encoding="utf-8"))
toolchain_lock = json.loads((ROOT / "toolchain.lock.json").read_text(encoding="utf-8"))
vendor_source = json.loads(
    (ROOT / "vendor/semantic-profile-registry/SOURCE.json").read_text(encoding="utf-8")
)

if source["profile_id"] != manifest["profile_id"] or manifest["profile_id"] != lock["root_profile"]:
    raise SystemExit("profile identity drift")
if not report.get("conforms"):
    raise SystemExit("semantic conformance report rejected the generated profile")
if report.get("profile_lock_digest") != lock.get("closure_digest"):
    raise SystemExit("conformance report does not bind the active profile lock")

for resource in manifest["resources"]:
    path = ROOT / "semantic" / resource["path"]
    actual = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != resource["digest"]:
        raise SystemExit(f"resource digest drift: {resource['path']}")

if any("latest" in json.dumps(value).lower() for value in (source, manifest, lock)):
    raise SystemExit("mutable latest alias is forbidden")
if len(toolchain_lock.get("commit", "")) != 40 or len(vendor_source.get("commit", "")) != 40:
    raise SystemExit("registry and toolchain dependencies must pin full commit SHAs")

print(f"semantic profile valid: {manifest['profile_id']}@{manifest['version']} resources={len(manifest['resources'])}")
