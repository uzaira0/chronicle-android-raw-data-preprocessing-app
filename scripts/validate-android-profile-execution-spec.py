#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import os
import stat
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

SCHEMA = "chronicle-android-profile-execution-spec/v1"
BLOCK_CODES = {"compiler", "missing_fixture", "missing_support", "missing_oracle"}
RUNTIME_OPTION_DEFAULTS = {
    "application_label_exclusions": [],
    "aggregate_top_apps_limit": 0,
    "filter_match_field": "app_package_name",
}
REPO = Path(__file__).resolve().parent.parent
PRIVATE_ROOT = REPO / ".tmp-literature-review-private"
DEFAULT_LIBRARY = PRIVATE_ROOT / "ontology-sublation-20260831/adjudicated-method-profile-library.json"
DEFAULT_MATRIX = PRIVATE_ROOT / "profile-runs/matrix-after-t27-20260901.json"
DEFAULT_MANIFEST = PRIVATE_ROOT / "profile-runs/android-profile-execution-spec.json"
REVIEW_CROSSWALK = PRIVATE_ROOT / "corrective-final-reconciliation-20260831/retained-profile-crosswalk.jsonl"
REVIEW_QUEUE = PRIVATE_ROOT / "corrective-final-reconciliation-20260831/corrected-queue-state.jsonl"
EXTERNAL_EXECUTOR_REGISTRY = REPO / "web/src/generated/literature-external-executor-registry.json"
SOURCE_ARTIFACT_REGISTRY = REPO / "web/src/generated/source-artifact-provenance-registry.json"
LITERATURE_INPUT_ADAPTER_CONTRACT = REPO / "web/schema/literature-input-adapter-contract.json"
DIFFERENTIAL_REQUEST_SCHEMA = "chronicle-android-released-code-differential-request/v1"
DIFFERENTIAL_RECEIPT_SCHEMA = "chronicle-android-released-code-differential-receipt/v1"
EXECUTABLE_SOURCE_ROLES = {
    "analysis_script",
    "analysis_script_collection",
    "feature_extraction_script",
    "feature_extraction_script_collection",
    "preprocessing_script",
    "r_project_bundle",
    "r_syntax_collection",
    "source_code_repository_snapshot",
}


class ValidationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"cannot read JSON {path}: {error}") from None


@lru_cache
def reviewed_crosswalk():
    private_mode(REVIEW_CROSSWALK, 0o600)
    rows = [json.loads(line) for line in REVIEW_CROSSWALK.read_text(encoding="utf-8").splitlines() if line]
    ids = [row["canonical_work_id"] for row in rows]
    require(len(ids) == len(set(ids)), "reviewed crosswalk has duplicate source-work IDs")
    require(all(row["decision"].startswith("RETAIN") for row in rows),
            "retained crosswalk contains a non-retained decision")
    return rows


@lru_cache
def retained_work_ids():
    frozen = {row["canonical_work_id"] for row in reviewed_crosswalk()}
    # Reuse the Node corpus gate; do not create a second admission policy in Python.
    result = subprocess.run([
        "node", "--input-type=module", "-e",
        'import {readFileSync} from "node:fs"; '
        'import {loadPostFreezeAdmissions} from "./web/scripts/literature_post_freeze_admissions.mjs"; '
        'const library=JSON.parse(readFileSync(".tmp-literature-review-private/ontology-sublation-20260831/method-profile-library.json","utf8")); '
        'console.log(JSON.stringify(loadPostFreezeAdmissions(process.cwd(),new Set(library.profiles.map(p=>p.source_work_id))).map(e=>e.canonical_work_id)));',
    ], cwd=REPO, capture_output=True, text=True)
    require(result.returncode == 0, "post-freeze admission validation failed")
    admitted = json.loads(result.stdout)
    require(isinstance(admitted, list) and len(admitted) == len(set(admitted))
            and not frozen.intersection(admitted), "post-freeze retained identities collide")
    return frozen | set(admitted)


def nonretained_work_ids():
    private_mode(REVIEW_QUEUE, 0o600)
    rows = [json.loads(line) for line in REVIEW_QUEUE.read_text(encoding="utf-8").splitlines() if line]
    ids = [row["canonical_work_id"] for row in rows]
    require(len(ids) == len(set(ids)), "review queue has duplicate source-work IDs")
    return {row["canonical_work_id"] for row in rows
            if row["decision"] in {"EXCLUDE", "ACQUISITION_PENDING"}}


def digest(path):
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def object_digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def is_digest(value):
    return (
        isinstance(value, str)
        and len(value) == 71
        and value.startswith("sha256:")
        and all(character in "0123456789abcdef" for character in value[7:])
    )


def private_mode(path, expected):
    require(stat.S_IMODE(path.stat().st_mode) == expected, f"{path} must be {expected:04o}")


def relative_path(value, label):
    require(isinstance(value, str) and value, f"{label}.path must be a non-empty string")
    relative = Path(value)
    require(not relative.is_absolute(), f"{label}.path must be repository-relative")
    require(relative.as_posix() == value, f"{label}.path must be normalized POSIX syntax")
    require(relative.parts and all(part not in ("", ".", "..") for part in relative.parts), f"unsafe path for {label}")
    require(relative.parts[0] == PRIVATE_ROOT.name, f"{label}.path must stay in {PRIVATE_ROOT.name}")
    current = REPO
    for part in relative.parts:
        current = current / part
        require(current.exists(), f"missing {label}: {current}")
        require(not current.is_symlink(), f"symlink is not allowed for {label}: {current}")
    return current


def pinned_file(record, label):
    require(isinstance(record, dict) and set(record) == {"path", "sha256"}, f"{label} must contain path and sha256")
    path = relative_path(record["path"], label)
    require(path.is_file(), f"{label} is not a regular file: {path}")
    private_mode(path, 0o600)
    require(is_digest(record["sha256"]), f"invalid digest for {label}")
    require(digest(path) == record["sha256"], f"digest changed for {label}: {path}")
    return path


def repository_pinned_file(record, label):
    require(isinstance(record, dict) and set(record) == {"path", "sha256"}, f"{label} must contain path and sha256")
    value = record["path"]
    require(isinstance(value, str) and value, f"{label}.path must be a non-empty string")
    relative = Path(value)
    require(not relative.is_absolute(), f"{label}.path must be repository-relative")
    require(relative.as_posix() == value, f"{label}.path must be normalized POSIX syntax")
    require(relative.parts and all(part not in ("", ".", "..") for part in relative.parts), f"unsafe path for {label}")
    current = REPO
    for part in relative.parts:
        current = current / part
        require(current.exists(), f"missing {label}: {current}")
        require(not current.is_symlink(), f"symlink is not allowed for {label}: {current}")
    require(current.is_file(), f"{label} is not a regular file: {current}")
    if relative.parts[0] == PRIVATE_ROOT.name:
        private_mode(current, 0o600)
    require(is_digest(record["sha256"]), f"invalid digest for {label}")
    require(digest(current) == record["sha256"], f"digest changed for {label}: {current}")
    return current


def private_directory(value, label):
    path = relative_path(value, label)
    require(path.is_dir(), f"{label} is not a directory: {path}")
    private_mode(path, 0o700)
    return path


def selection_from_id(selection_id):
    require(isinstance(selection_id, str) and "::" in selection_id, f"invalid selectionId: {selection_id!r}")
    tail = selection_id.split("::", 1)[1]
    result = {}
    if not tail:
        return result
    for assignment in tail.split("|"):
        require(assignment.count("=") == 1, f"invalid selection assignment: {assignment}")
        group_id, level_id = assignment.split("=", 1)
        require(group_id and level_id and group_id not in result, f"invalid selection assignment: {assignment}")
        result[group_id] = level_id
    return result


def selection_key(selection):
    require(isinstance(selection, dict), "selection must be an object")
    require(all(isinstance(key, str) and key for key in selection), "selection group IDs must be strings")
    require(all(isinstance(value, str) and value for value in selection.values()), "selection level IDs must be strings")
    return tuple(sorted(selection.items()))


def authority_record(path):
    return {"path": path.relative_to(REPO).as_posix(), "sha256": digest(path)}


def preprocessing_ready(variant):
    readiness = variant.get("readiness", {})
    return (
        bool(variant.get("executableSettingIds"))
        and readiness.get("configuration", {}).get("status") == "ready"
        and readiness.get("input", {}).get("status") in {"ready", "not_required"}
        and readiness.get("preprocessing", {}).get("status") in {"ready", "not_required"}
    )


def documentary_ready(variant):
    return (
        not variant.get("blockers")
        and variant.get("readiness", {}).get("disposition") == "fully_reproduced"
    )


@lru_cache
def registered_components():
    contract = read_json(LITERATURE_INPUT_ADAPTER_CONTRACT)
    require(
        contract.get("schemaVersion") == "chronicle-literature-input-adapter-contract/v1",
        "wrong literature input-adapter contract schema",
    )
    if any(isinstance(group, dict) and isinstance(group.get("componentExecution"), dict)
           and group["componentExecution"].get("canonicalRegistrationStatus") == "outside_frozen143_extension"
           for group in contract.get("groups", [])):
        # Reuse the closed Node ownership gate; extensions are not frozen lanes.
        checked = subprocess.run([
            "node", "--input-type=module", "-e",
            'import {readFileSync} from "node:fs"; '
            'import {projectRegisteredComponents} from "./web/scripts/android_method_profile_component_projection.mjs"; '
            'const p=JSON.parse(readFileSync(0,"utf8")); '
            'projectRegisteredComponents(p.profiles,p.contract,new Set(p.nonretained)); console.log("ok");',
        ], cwd=REPO, input=json.dumps({"profiles": read_json(DEFAULT_LIBRARY)["profiles"],
            "contract": contract, "nonretained": sorted(nonretained_work_ids())}),
            capture_output=True, text=True)
        require(checked.returncode == 0 and checked.stdout.strip() == "ok",
                "literature component projection or closed-extension ownership validation failed")
    result = {}
    setting_owners = {}
    for index, group in enumerate(contract.get("groups", [])):
        require(isinstance(group, dict), f"literature adapter group {index} must be an object")
        component = group.get("componentExecution")
        if component is None:
            continue
        require(isinstance(component, dict), f"literature adapter component {index} must be an object")
        if component.get("canonicalRegistrationStatus") == "outside_frozen143_extension":
            continue
        if component.get("sourceWorkId") not in retained_work_ids():
            require(component.get("sourceWorkId") in nonretained_work_ids(),
                    f"literature adapter component {index} has an unknown source work")
            continue
        if component.get("canonicalRegistrationStatus") == "linked_artifact_only":
            require(component.get("limitations") and group.get("methodSettingIds"),
                    f"literature adapter component {index} has no linked-artifact boundary")
            continue
        component_id = component.get("componentId")
        profile_id = component.get("parentMethodProfileId")
        setting_ids = group.get("methodSettingIds")
        require(isinstance(component_id, str) and component_id, "literature component ID must be non-empty")
        require(isinstance(profile_id, str) and profile_id, f"{component_id} parent profile must be non-empty")
        require(
            isinstance(setting_ids, list)
            and setting_ids
            and all(isinstance(setting_id, str) and setting_id for setting_id in setting_ids)
            and len(setting_ids) == len(set(setting_ids)),
            f"{component_id} setting IDs must be non-empty and unique",
        )
        identity = (profile_id, component_id)
        require(identity not in result, f"duplicate literature component: {component_id}")
        for setting_id in setting_ids:
            owner = setting_owners.setdefault((profile_id, setting_id), component_id)
            require(owner == component_id, f"{profile_id} setting has multiple component owners: {setting_id}")
        result[identity] = {
            "componentId": component_id,
            "profileId": profile_id,
            "sourceWorkId": component.get("sourceWorkId"),
            "sourceMethodVariantId": component.get("sourceMethodVariantId"),
            "methodProfileVersion": component.get("methodProfileVersion"),
            "sourceOracleId": component.get("sourceOracleId"),
            "derivedResultKind": component.get("derivedResultKind"),
            "requiredSupportRoles": component.get("requiredSupportRoles", []),
            "settingIds": setting_ids,
        }
    return result


def compound_lane_expectation(receipt, profile):
    """Partition one compiled receipt into the executors that actually own it."""
    receipt = normalized_receipt(receipt)
    ordered_setting_ids = receipt.get("settingIds")
    require(
        isinstance(ordered_setting_ids, list)
        and ordered_setting_ids
        and all(isinstance(setting_id, str) and setting_id for setting_id in ordered_setting_ids)
        and len(ordered_setting_ids) == len(set(ordered_setting_ids)),
        "compound compiled setting IDs must be non-empty and unique",
    )
    expected = set(ordered_setting_ids)
    input_bindings = receipt["inputBindings"]
    require(isinstance(input_bindings, list), "compound input bindings must be an array")
    input_ids_by_adapter = {}
    for binding in input_bindings:
        require(isinstance(binding, dict), "compound input bindings must be objects")
        adapter_id = binding.get("adapterId")
        adapter_version = binding.get("adapterVersion")
        setting_id = binding.get("settingId")
        require(
            isinstance(adapter_id, str)
            and isinstance(adapter_version, str)
            and isinstance(setting_id, str),
            "compound input binding identity is invalid",
        )
        input_ids_by_adapter.setdefault(f"{adapter_id}/{adapter_version}", []).append(setting_id)

    components = []
    owned = set()
    for (profile_id, component_id), component in registered_components().items():
        if profile_id != profile["method_profile_id"]:
            continue
        component_ids = component["settingIds"]
        selected = expected.intersection(component_ids)
        if not selected:
            continue
        require(
            selected == set(component_ids),
            f"{component_id} is only partially selected; a component execution cannot prove a subset",
        )
        require(
            set(input_ids_by_adapter.get(component_id, [])) == set(component_ids),
            f"{component_id} compiled input bindings do not equal its registered settings",
        )
        require(not owned.intersection(component_ids), f"{component_id} overlaps another compound lane")
        owned.update(component_ids)
        components.append(component)

    external = []
    for index, binding in enumerate(receipt["externalBindings"]):
        require(isinstance(binding, dict), f"compound external binding {index} must be an object")
        setting_ids = binding.get("settingIds")
        require(
            isinstance(setting_ids, list)
            and setting_ids
            and all(isinstance(setting_id, str) and setting_id in expected for setting_id in setting_ids)
            and len(setting_ids) == len(set(setting_ids)),
            f"compound external binding {index} has invalid setting IDs",
        )
        require(not owned.intersection(setting_ids), f"compound external binding {index} overlaps another lane")
        owned.update(setting_ids)
        external.append(binding)

    documentary_ids = []
    for index, binding in enumerate(receipt["documentaryBindings"]):
        require(isinstance(binding, dict), f"compound documentary binding {index} must be an object")
        setting_id = binding.get("settingId")
        require(isinstance(setting_id, str) and setting_id in expected, "compound documentary setting is invalid")
        require(setting_id not in owned, f"compound documentary setting overlaps another lane: {setting_id}")
        owned.add(setting_id)
        documentary_ids.append(setting_id)
    require(len(documentary_ids) == len(set(documentary_ids)), "duplicate compound documentary setting")

    core_ids = [setting_id for setting_id in ordered_setting_ids if setting_id not in owned]
    return {
        "core": core_ids,
        "components": components,
        "external": external,
        "documentary": documentary_ids,
    }


def validate_compound_lane_coverage(lanes, expectation):
    """Require an exact disjoint union before a compound run may count as complete."""
    require(
        isinstance(lanes, dict) and set(lanes) == {"core", "components", "external", "documentary"},
        "compound lanes must contain core, components, external, and documentary",
    )
    expected_core = expectation["core"]
    core = lanes["core"]
    if expected_core:
        require(isinstance(core, dict), "compound core lane is required")
        require(core.get("settingIds") == expected_core, "compound core setting coverage is not exact")
    else:
        require(core is None, "compound core lane must be null when no core settings are selected")

    observed_components = lanes["components"]
    require(isinstance(observed_components, list), "compound components must be an array")
    expected_components = {component["componentId"]: component for component in expectation["components"]}
    require(
        len(observed_components) == len(expected_components)
        and all(isinstance(component, dict) for component in observed_components),
        "compound component count is not exact",
    )
    observed_component_ids = [component.get("componentId") for component in observed_components]
    require(len(observed_component_ids) == len(set(observed_component_ids)), "duplicate compound component lane")
    require(set(observed_component_ids) == set(expected_components), "compound component identities are not exact")
    for component in observed_components:
        expected_component = expected_components[component["componentId"]]
        require(
            component.get("settingIds") == expected_component["settingIds"],
            f"{component['componentId']} setting coverage is not exact",
        )

    observed_external = lanes["external"]
    require(isinstance(observed_external, list), "compound external lanes must be an array")
    external_key = lambda binding: (binding.get("executorId"), binding.get("sourceConfigurationId"))
    expected_external = {external_key(binding): binding for binding in expectation["external"]}
    require(len(expected_external) == len(expectation["external"]), "duplicate compiled external binding")
    require(
        len(observed_external) == len(expected_external)
        and all(isinstance(binding, dict) for binding in observed_external),
        "compound external lane count is not exact",
    )
    observed_external_keys = [external_key(binding) for binding in observed_external]
    require(len(observed_external_keys) == len(set(observed_external_keys)), "duplicate compound external lane")
    require(set(observed_external_keys) == set(expected_external), "compound external identities are not exact")
    for binding in observed_external:
        expected_binding = expected_external[external_key(binding)]
        require(binding.get("settingIds") == expected_binding.get("settingIds"), "compound external setting coverage is not exact")

    documentary = lanes["documentary"]
    require(
        isinstance(documentary, dict) and set(documentary) == {"settingIds"},
        "compound documentary lane is invalid",
    )
    require(documentary["settingIds"] == expectation["documentary"], "compound documentary coverage is not exact")

    observed_sets = []
    if core is not None:
        observed_sets.append(set(core["settingIds"]))
    observed_sets.extend(set(component["settingIds"]) for component in observed_components)
    observed_sets.extend(set(binding["settingIds"]) for binding in observed_external)
    observed_sets.append(set(documentary["settingIds"]))
    combined = set()
    for setting_ids in observed_sets:
        require(not combined.intersection(setting_ids), "compound setting is claimed by multiple lanes")
        combined.update(setting_ids)
    expected_union = set(expectation["core"]) | set(expectation["documentary"])
    expected_union.update(setting_id for component in expectation["components"] for setting_id in component["settingIds"])
    expected_union.update(setting_id for binding in expectation["external"] for setting_id in binding["settingIds"])
    require(combined == expected_union, "compound lanes do not cover the exact compiled setting set")


@lru_cache
def external_receipt_path(expected):
    require(is_digest(expected), "external configuration receipt digest is invalid")
    matches = [
        path for path in (PRIVATE_ROOT / "profile-runs").rglob("external-execution.json")
        if path.is_file() and not path.is_symlink() and digest(path) == expected
    ]
    require(len(matches) == 1, "external configuration must resolve to exactly one private execution receipt")
    private_mode(matches[0], 0o600)
    return matches[0]


def initialize(manifest_path, library_path, matrix_path):
    require(not manifest_path.exists(), f"refusing to replace existing manifest: {manifest_path}")
    library = read_json(library_path)
    matrix = read_json(matrix_path)
    profiles = library.get("profiles")
    variants = matrix.get("variantDetails")
    require(isinstance(profiles, list) and {profile["source_work_id"] for profile in profiles} == retained_work_ids(),
            "library must contain exactly the retained source-work IDs")
    require(isinstance(variants, list) and variants, "matrix must enumerate at least one configuration")
    method_id_by_source = {profile["source_work_id"]: profile["method_profile_id"] for profile in profiles}
    require(len(method_id_by_source) == len(profiles), "library source-work IDs must be unique")
    by_profile = {method_id: [] for method_id in method_id_by_source.values()}
    for variant in variants:
        method_id = method_id_by_source.get(variant.get("sourceWorkId"))
        require(method_id is not None, f"matrix contains an unknown source work: {variant.get('sourceWorkId')}")
        compiled = preprocessing_ready(variant)
        by_profile[method_id].append({
            "selection": selection_from_id(variant.get("selectionId")),
            "code": "missing_fixture" if compiled else "compiler",
            "detail": (
                "preprocessing-ready selection has no registered execution fixture"
                if compiled
                else "selection is not preprocessing-ready in the pinned compiler matrix"
            ),
        })
    document = {
        "schemaVersion": SCHEMA,
        "authority": {
            "profileLibrary": authority_record(library_path),
            "executionMatrix": authority_record(matrix_path),
        },
        "profiles": [
            {
                "methodProfileId": profile["method_profile_id"],
                "runs": [],
                "documentary": [],
                "blocked": by_profile[profile["method_profile_id"]],
            }
            for profile in profiles
        ],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def one_artifact(directory, kind):
    matches = sorted(path for path in directory.iterdir() if path.is_file() and path.name.endswith(f"-{kind}"))
    require(len(matches) == 1, f"expected one {kind} artifact in {directory}, got {len(matches)}")
    return matches[0]


def one_method_profile_receipt_artifact(directory):
    matches = sorted(
        path for path in directory.iterdir()
        if path.is_file() and (
            path.name.endswith("-method-profile-receipt-json")
            or path.name == "diagnostic-method-profile-preprocessing-receipt-json"
        )
    )
    require(len(matches) == 1, f"expected one method-profile receipt artifact in {directory}, got {len(matches)}")
    return matches[0]


def private_tree(directory):
    result = {}
    for path in sorted(directory.rglob("*")):
        require(not path.is_symlink(), f"execution tree contains a symlink: {path}")
        if path.is_dir():
            private_mode(path, 0o700)
            continue
        require(path.is_file(), f"unsupported execution entry: {path}")
        private_mode(path, 0o600)
        result[path.relative_to(directory).as_posix()] = digest(path)
    require(result, f"empty execution directory: {directory}")
    return result


def normalized_receipt(receipt):
    require(isinstance(receipt, dict), "method-profile receipt must be an object")
    result = dict(receipt)
    for key in ("inputBindings", "documentaryBindings", "outputBindings", "externalBindings"):
        result.setdefault(key, [])
    return result


def normalized_runtime_options(value):
    require(isinstance(value, dict), "runtime options must be an object")
    result = dict(value)
    for key, default in RUNTIME_OPTION_DEFAULTS.items():
        result.setdefault(key, default)
    return result


def validate_compiled_receipt(receipt, profile, variant):
    require(isinstance(receipt, dict), "compiled receipt must be an object")
    require(receipt.get("methodProfileId") == profile["method_profile_id"], "compiled receipt has the wrong method profile")
    require(receipt.get("sourceWorkId") == profile["source_work_id"], "compiled receipt has the wrong source work")
    require(receipt.get("sourceMethodVariantId") == profile["source_method_variant_id"], "compiled receipt has the wrong source variant")
    require(receipt.get("sourceMethodVariantIds") == variant["selectedLevelIds"], "compiled receipt has the wrong selected levels")
    expected_ids = set(variant["executableSettingIds"]) | set(variant.get("evidenceSettingIds", []))
    expected_order = [
        setting["method_setting_id"]
        for setting in profile["method_settings"]
        if setting["method_setting_id"] in expected_ids
    ]
    require(receipt.get("settingIds") == expected_order, "compiled receipt disagrees with compiler-owned settings")
    return normalized_receipt(receipt)


def execute_oracle(path, expected):
    require(path.suffix == ".py", f"semantic oracle must be a Python script: {path}")
    try:
        completed = subprocess.run(
            [sys.executable, str(path)],
            cwd=REPO,
            shell=False,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValidationError(f"semantic oracle did not complete: {type(error).__name__}") from None
    require(completed.returncode == 0, f"semantic oracle exited with status {completed.returncode}")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError:
        raise ValidationError("semantic oracle stdout is not JSON") from None
    require(result == expected, "semantic oracle result is not bound to this profile selection and evidence")


@lru_cache
def source_artifact_registry():
    registry = read_json(SOURCE_ARTIFACT_REGISTRY)
    require(
        registry.get("schema_version") == "chronicle-source-artifact-provenance-closed-registry/v2",
        "wrong source-artifact provenance registry schema",
    )
    payload = {key: value for key, value in registry.items() if key != "content_digest"}
    require(object_digest(payload) == registry.get("content_digest"), "source-artifact provenance registry content drift")
    identities = registry.get("profile_identities")
    require(isinstance(identities, list), "source-artifact registry profile identities must be an array")
    return registry


def differential_required(profile):
    registry = source_artifact_registry()
    identified = any(
        identity.get("method_profile_id") == profile["method_profile_id"]
        and identity.get("source_work_id") == profile["source_work_id"]
        for identity in registry["profile_identities"]
    )
    return identified and any(
        row.get("source_work_id") == profile["source_work_id"]
        and row.get("candidate_status") == "ready_for_typed_registry"
        and row.get("source_artifact_provenance", {}).get("artifact_role") in EXECUTABLE_SOURCE_ROLES
        and is_digest(row.get("source_artifact_provenance", {}).get("locally_validated_artifact_digest"))
        for row in registry["rows"]
    )


def strict_json(path, label):
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        raise ValidationError(f"{label} is not strict JSON") from None


def json_within_tolerance(left, right, tolerance, location="$"):
    number = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool)
    if number(left) and number(right):
        require(math.isfinite(left) and math.isfinite(right), f"differential output is non-finite at {location}")
        require(abs(left - right) <= tolerance, f"differential output exceeds tolerance at {location}")
        return
    require(type(left) is type(right), f"differential output type differs at {location}")
    if isinstance(left, dict):
        require(set(left) == set(right), f"differential output keys differ at {location}")
        for key in sorted(left):
            json_within_tolerance(left[key], right[key], tolerance, f"{location}.{key}")
    elif isinstance(left, list):
        require(len(left) == len(right), f"differential output length differs at {location}")
        for index, (left_item, right_item) in enumerate(zip(left, right)):
            json_within_tolerance(left_item, right_item, tolerance, f"{location}[{index}]")
    else:
        require(left == right, f"differential output differs at {location}")


def validate_differential_execution(record, request, lane, shared_input_digest, output_names, receipt_root):
    expected_keys = {"commandTemplateDigest", "entrypoint", "implementation", "runtime", "sharedInputDigest", "outputs"}
    require(isinstance(record, dict) and set(record) == expected_keys, f"differential {lane} execution is invalid")
    request_lane = request["source" if lane == "source" else "chronicle"]
    require(record["commandTemplateDigest"] == object_digest(request_lane["command"]), f"differential {lane} command drift")
    require(record["entrypoint"] == request_lane["entrypoint"], f"differential {lane} entrypoint drift")
    require(record["implementation"] == request_lane["implementation"], f"differential {lane} implementation drift")
    require(record["runtime"] == request_lane["runtime"], f"differential {lane} runtime drift")
    repository_pinned_file(record["entrypoint"], f"differential.{lane}.entrypoint")
    require(isinstance(record["implementation"], list) and record["implementation"], f"differential {lane} implementation must not be empty")
    require(isinstance(record["runtime"], list) and record["runtime"], f"differential {lane} runtime must not be empty")
    for index, value in enumerate(record["implementation"]):
        repository_pinned_file(value, f"differential.{lane}.implementation[{index}]")
    for index, value in enumerate(record["runtime"]):
        repository_pinned_file(value, f"differential.{lane}.runtime[{index}]")
    require(record["sharedInputDigest"] == shared_input_digest, f"differential {lane} did not use the exact shared inputs")
    outputs = record["outputs"]
    require(isinstance(outputs, list) and len(outputs) == len(output_names), f"differential {lane} output count drift")
    output_paths = []
    for index, (output, name) in enumerate(zip(outputs, output_names)):
        path = pinned_file(output, f"differential.{lane}.outputs[{index}]")
        expected = receipt_root / lane / name
        require(path == expected, f"differential {lane} output path drift")
        output_paths.append(path)
    return output_paths


def validate_differential_receipt(record, profile, selection):
    receipt_path = pinned_file(record, "run.differentialReceipt")
    receipt = read_json(receipt_path)
    expected_keys = {
        "schemaVersion", "passed", "methodProfileId", "sourceWorkId", "selection", "request",
        "sourceArtifactRegistry", "sourceArtifacts", "sharedInputs", "sourceExecution",
        "chronicleExecutions", "comparison", "contentDigest",
    }
    require(isinstance(receipt, dict) and set(receipt) == expected_keys, "differential receipt has missing or unknown fields")
    payload = {key: value for key, value in receipt.items() if key != "contentDigest"}
    require(receipt["schemaVersion"] == DIFFERENTIAL_RECEIPT_SCHEMA, "wrong differential receipt schema")
    require(receipt["passed"] is True, "differential receipt did not pass")
    require(receipt["methodProfileId"] == profile["method_profile_id"], "differential receipt profile identity drift")
    require(receipt["sourceWorkId"] == profile["source_work_id"], "differential receipt source identity drift")
    require(receipt["selection"] == selection, "differential receipt selection drift")
    require(object_digest(payload) == receipt["contentDigest"], "differential receipt content drift")

    request_path = pinned_file(receipt["request"], "differential.request")
    request = read_json(request_path)
    request_keys = {
        "schemaVersion", "methodProfileId", "sourceWorkId", "selection", "sourceArtifacts",
        "fixture", "support", "options", "source", "chronicle", "outputs", "comparison", "timeoutSeconds",
    }
    require(isinstance(request, dict) and set(request) == request_keys, "differential request has missing or unknown fields")
    require(request["schemaVersion"] == DIFFERENTIAL_REQUEST_SCHEMA, "wrong differential request schema")
    require(request["methodProfileId"] == profile["method_profile_id"], "differential request profile identity drift")
    require(request["sourceWorkId"] == profile["source_work_id"], "differential request source identity drift")
    require(request["selection"] == selection, "differential request selection drift")

    registry = source_artifact_registry()
    registry_record = receipt["sourceArtifactRegistry"]
    expected_registry_record = {
        "path": SOURCE_ARTIFACT_REGISTRY.relative_to(REPO).as_posix(),
        "sha256": digest(SOURCE_ARTIFACT_REGISTRY),
        "contentDigest": registry["content_digest"],
    }
    require(registry_record == expected_registry_record, "differential receipt does not use the canonical source-artifact registry")
    registry_rows = {
        row["source_artifact_provenance"]["source_artifact_provenance_id"]: row
        for row in registry["rows"]
        if row.get("source_work_id") == profile["source_work_id"]
    }
    source_artifacts = receipt["sourceArtifacts"]
    require(isinstance(source_artifacts, list) and source_artifacts, "differential receipt must pin a released source artifact")
    require(len(source_artifacts) == len(request["sourceArtifacts"]), "differential source artifact count drift")
    source_artifact_paths = {}
    for index, (artifact, requested) in enumerate(zip(source_artifacts, request["sourceArtifacts"])):
        expected_artifact_keys = {
            "sourceArtifactProvenanceId", "methodSettingId", "sourceArtifactProvenanceObjectDigest", "path", "sha256",
        }
        require(isinstance(artifact, dict) and set(artifact) == expected_artifact_keys, f"differential sourceArtifacts[{index}] is invalid")
        require(
            {key: artifact[key] for key in ("sourceArtifactProvenanceId", "path", "sha256")} == requested,
            f"differential sourceArtifacts[{index}] disagrees with the request",
        )
        row = registry_rows.get(artifact["sourceArtifactProvenanceId"])
        require(row is not None and row.get("candidate_status") == "ready_for_typed_registry", "differential source artifact is not registry-ready")
        require(
            row.get("source_artifact_provenance", {}).get("artifact_role") in EXECUTABLE_SOURCE_ROLES,
            "differential source artifact is not executable code",
        )
        require(artifact["methodSettingId"] == row["method_setting_id"], "differential source method-setting identity drift")
        require(artifact["sourceArtifactProvenanceObjectDigest"] == row["source_artifact_provenance_object_digest"], "differential source provenance drift")
        require(artifact["sha256"] == row["source_artifact_provenance"].get("locally_validated_artifact_digest"), "differential source bytes disagree with registry")
        pinned_file({"path": artifact["path"], "sha256": artifact["sha256"]}, f"differential.sourceArtifacts[{index}]")
        source_artifact_paths[artifact["sourceArtifactProvenanceId"]] = artifact["path"]
    source_request = request["source"]
    require(isinstance(source_request, dict), "differential source request is invalid")
    source_implementation_paths = {
        record.get("path") for record in source_request.get("implementation", []) if isinstance(record, dict)
    }
    require(
        set(source_artifact_paths.values()) <= source_implementation_paths,
        "differential source implementation omits released source bytes",
    )
    source_command = source_request.get("command")
    require(
        isinstance(source_command, list) and all(isinstance(part, str) for part in source_command),
        "differential source command is invalid",
    )
    command_text = "\0".join(source_command)
    for provenance_id in source_artifact_paths:
        require(
            f"{{sourceArtifact:{provenance_id}}}" in command_text,
            f"differential source command omits released source artifact {provenance_id}",
        )

    shared = receipt["sharedInputs"]
    require(isinstance(shared, dict) and set(shared) == {"fixture", "support", "options"}, "differential shared inputs are invalid")
    require(shared["fixture"] == request["fixture"] and shared["options"] == request["options"], "differential fixture/options drift")
    require(shared["support"] == request["support"], "differential support inputs drift")
    pinned_file(shared["fixture"], "differential.fixture")
    pinned_file(shared["options"], "differential.options")
    require(isinstance(shared["support"], list), "differential support must be an array")
    support_roles = set()
    for index, support in enumerate(shared["support"]):
        require(isinstance(support, dict) and set(support) == {"role", "path", "sha256"}, f"differential support[{index}] is invalid")
        require(isinstance(support["role"], str) and support["role"] and support["role"] not in support_roles, "differential support roles are invalid")
        support_roles.add(support["role"])
        pinned_file({"path": support["path"], "sha256": support["sha256"]}, f"differential.support[{index}]")
    shared_input_digest = object_digest(shared)

    output_names = request["outputs"]
    require(isinstance(output_names, list) and output_names, "differential outputs must be a non-empty array")
    require(len(output_names) == len(set(output_names)), "differential output names must be unique")
    for name in output_names:
        relative = Path(name)
        require(isinstance(name, str) and name and not relative.is_absolute() and relative.as_posix() == name, "unsafe differential output name")
        require(relative.parts and all(part not in ("", ".", "..") for part in relative.parts), "unsafe differential output name")
    receipt_root = receipt_path.parent
    source_outputs = validate_differential_execution(
        receipt["sourceExecution"], request, "source", shared_input_digest, output_names, receipt_root,
    )
    executions = receipt["chronicleExecutions"]
    require(isinstance(executions, dict) and set(executions) == {"a", "b"}, "differential Chronicle executions must contain a and b")
    chronicle_a = validate_differential_execution(
        executions["a"], request, "chronicle-a", shared_input_digest, output_names, receipt_root,
    )
    chronicle_b = validate_differential_execution(
        executions["b"], request, "chronicle-b", shared_input_digest, output_names, receipt_root,
    )
    require([digest(path) for path in chronicle_a] == [digest(path) for path in chronicle_b], "differential Chronicle A/B outputs drift")

    comparison = receipt["comparison"]
    require(isinstance(comparison, dict) and comparison.get("passed") is True, "differential comparison did not pass")
    require(comparison.get("outputs") == output_names, "differential compared-output list drift")
    requested_comparison = request["comparison"]
    if requested_comparison == {"mode": "exact_bytes"}:
        require(
            comparison == {"mode": "exact_bytes", "absoluteTolerance": 0, "toleranceEvidence": None, "outputs": output_names, "passed": True},
            "differential exact comparison drift",
        )
        for source_output, chronicle_output in zip(source_outputs, chronicle_a):
            require(source_output.read_bytes() == chronicle_output.read_bytes(), "differential exact output mismatch")
    else:
        require(
            isinstance(requested_comparison, dict)
            and set(requested_comparison) == {"mode", "absoluteTolerance", "toleranceEvidence", "locator"}
            and requested_comparison.get("mode") == "json_numeric_absolute",
            "invalid differential tolerance request",
        )
        tolerance = requested_comparison["absoluteTolerance"]
        require(isinstance(tolerance, (int, float)) and not isinstance(tolerance, bool) and math.isfinite(tolerance) and tolerance >= 0, "invalid differential absolute tolerance")
        pinned_file(requested_comparison["toleranceEvidence"], "differential.toleranceEvidence")
        require(comparison == {**requested_comparison, "outputs": output_names, "passed": True}, "differential tolerance comparison drift")
        for index, (source_output, chronicle_output) in enumerate(zip(source_outputs, chronicle_a)):
            json_within_tolerance(
                strict_json(source_output, f"differential source output {index}"),
                strict_json(chronicle_output, f"differential Chronicle output {index}"),
                tolerance,
            )
    return shared


def validate_run(run, profile, variant):
    expected_keys = {"selection", "timezone", "raw", "support", "oracle", "compiled", "executions"}
    require(isinstance(run, dict), "run must be an object")
    require(
        set(run) in (expected_keys, expected_keys | {"differentialReceipt"}),
        "run has missing or unknown fields",
    )
    require(
        ("differentialReceipt" in run) or not differential_required(profile),
        "native run for a source-artifact-registry profile requires a released-code differential receipt",
    )
    require(isinstance(run["timezone"], str) and run["timezone"], "run timezone must be non-empty")
    raw_path = pinned_file(run["raw"], "run.raw")
    oracle_path = pinned_file(run["oracle"], "run.oracle")
    support = run["support"]
    require(isinstance(support, list), "run.support must be an array")
    support_paths = {}
    for index, record in enumerate(support):
        require(isinstance(record, dict) and set(record) == {"role", "path", "sha256"}, f"run.support[{index}] is invalid")
        role = record["role"]
        require(isinstance(role, str) and role and role != "raw_chronicle_csv", f"invalid support role: {role!r}")
        require(role not in support_paths, f"duplicate support role: {role}")
        support_paths[role] = pinned_file({"path": record["path"], "sha256": record["sha256"]}, f"run.support[{role}]")

    compiled = run["compiled"]
    require(isinstance(compiled, dict) and set(compiled) == {"receipt", "runtimeOptions"}, "run.compiled is invalid")
    receipt_path = pinned_file(compiled["receipt"], "run.compiled.receipt")
    options_path = pinned_file(compiled["runtimeOptions"], "run.compiled.runtimeOptions")
    receipt = read_json(receipt_path)
    options = read_json(options_path)
    normalized_compiled_receipt = validate_compiled_receipt(receipt, profile, variant)
    composition = compound_lane_expectation(normalized_compiled_receipt, profile)
    require(
        not composition["components"] and not composition["external"],
        "profile has registered component or external outputs and requires a compound run",
    )
    input_bindings = normalized_compiled_receipt["inputBindings"]
    require(isinstance(input_bindings, list) and all(isinstance(binding, dict) for binding in input_bindings), "compiled input bindings must be objects")
    roles = {binding.get("inputRole") for binding in input_bindings}
    expected_roles = set(support_paths) | {"raw_chronicle_csv"}
    require(None not in roles and roles <= expected_roles, "compiled receipt names an unknown input role")
    require(roles - {"raw_chronicle_csv"} == set(support_paths), "support roles disagree with the compiled receipt")

    executions = run["executions"]
    require(isinstance(executions, dict) and set(executions) == {"a", "b"}, "run.executions must contain a and b")
    trees = {}
    expected_inputs = {"raw_chronicle_csv": digest(raw_path), **{role: digest(path) for role, path in support_paths.items()}}
    for label in ("a", "b"):
        directory = private_directory(executions[label], f"run.executions.{label}")
        trees[label] = private_tree(directory)
        runtime_receipt = read_json(one_method_profile_receipt_artifact(directory))
        runtime_options = read_json(one_artifact(directory, "processing-options-json"))
        workspace = read_json(one_artifact(directory, "workspace-root-json"))
        require(normalized_receipt(runtime_receipt) == normalized_receipt(receipt), f"execution {label} receipt differs from compilation")
        require(normalized_runtime_options(runtime_options) == normalized_runtime_options(options), f"execution {label} options differ from compilation")
        assignments = workspace.get("assignmentDigests")
        require(isinstance(assignments, dict), f"execution {label} assignments must be an object")
        require(set(assignments) == set(expected_inputs) | {"processing_options"}, f"execution {label} input assignments are not exact")
        require(all(assignments[role] == value for role, value in expected_inputs.items()), f"execution {label} input assignments are not exact")
        require(is_digest(assignments["processing_options"]), f"execution {label} processing-options digest is invalid")
        require(workspace.get("optionsDigest") == assignments["processing_options"], f"execution {label} options digest is not exact")
        require(workspace.get("inputDigest") == expected_inputs["raw_chronicle_csv"], f"execution {label} raw digest is not exact")
    require(trees["a"] == trees["b"], "A/B execution trees are not byte-identical")
    execute_oracle(
        oracle_path,
        {
            "assertionsPassed": True,
            "methodProfileId": profile["method_profile_id"],
            "selection": run["selection"],
            "evidence": {
                "kind": "execution_pair",
                "executions": {"a": run["executions"]["a"], "b": run["executions"]["b"]},
            },
        },
    )
    if "differentialReceipt" in run:
        differential_inputs = validate_differential_receipt(
            run["differentialReceipt"], profile, run["selection"]
        )
        require(differential_inputs["fixture"] == run["raw"], "differential fixture differs from the profile run raw input")
        require(differential_inputs["options"] == compiled["runtimeOptions"], "differential options differ from the profile run options")
        require(
            {record["role"]: {"path": record["path"], "sha256": record["sha256"]} for record in differential_inputs["support"]}
            == {record["role"]: {"path": record["path"], "sha256": record["sha256"]} for record in support},
            "differential support differs from the profile run support",
        )


def validate_compound_inputs(record, label):
    raw_path = pinned_file(record["raw"], f"{label}.raw")
    support = record["support"]
    require(isinstance(support, list), f"{label}.support must be an array")
    support_paths = {}
    for index, item in enumerate(support):
        require(isinstance(item, dict) and set(item) == {"role", "path", "sha256"}, f"{label}.support[{index}] is invalid")
        role = item["role"]
        require(isinstance(role, str) and role and role not in support_paths and role != "raw_chronicle_csv", f"{label} support role is invalid")
        support_paths[role] = pinned_file({"path": item["path"], "sha256": item["sha256"]}, f"{label}.support[{role}]")
    return raw_path, support_paths


def compound_core_receipt(receipt, setting_ids):
    selected = set(setting_ids)
    result = {
        key: value
        for key, value in receipt.items()
        if key not in {"settingIds", "bindings", "inputBindings", "outputBindings", "documentaryBindings", "externalBindings"}
    }
    result.update({
        "settingIds": setting_ids,
        "bindings": [binding for binding in receipt.get("bindings", []) if binding.get("settingId") in selected],
        "inputBindings": [binding for binding in receipt.get("inputBindings", []) if binding.get("settingId") in selected],
        "outputBindings": [binding for binding in receipt.get("outputBindings", []) if binding.get("settingId") in selected],
        "documentaryBindings": [],
    })
    bound = {
        binding.get("settingId")
        for key in ("bindings", "inputBindings", "outputBindings")
        for binding in result[key]
    }
    require(bound == selected, "compound core receipt does not bind every core setting")
    return normalized_receipt(result)


def validate_compound_core_lane(lane, expected_setting_ids, receipt, options):
    require(
        isinstance(lane, dict)
        and set(lane) == {"settingIds", "raw", "support", "executions"},
        "compound core lane has missing or unknown fields",
    )
    raw_path, support_paths = validate_compound_inputs(lane, "compound.core")
    expected_receipt = compound_core_receipt(receipt, expected_setting_ids)
    input_roles = {binding.get("inputRole") for binding in expected_receipt["inputBindings"]}
    require(None not in input_roles, "compound core receipt has an invalid input role")
    require(
        input_roles - {"raw_chronicle_csv"} == set(support_paths),
        "compound core support roles disagree with the compiled receipt",
    )
    executions = lane["executions"]
    require(isinstance(executions, dict) and set(executions) == {"a", "b"}, "compound core executions must contain a and b")
    trees = {}
    for label in ("a", "b"):
        directory = private_directory(executions[label], f"compound.core.executions.{label}")
        trees[label] = private_tree(directory)
        observed_receipt = read_json(one_method_profile_receipt_artifact(directory))
        require(normalized_receipt(observed_receipt) == expected_receipt, f"compound core execution {label} receipt drift")
        runtime_options = read_json(one_artifact(directory, "processing-options-json"))
        require(normalized_runtime_options(runtime_options) == normalized_runtime_options(options), f"compound core execution {label} options drift")
        runtime_input_matches = sorted(path for path in directory.iterdir() if path.is_file() and path.name.endswith("-literature-runtime-input-csv"))
        expected_raw_digest = digest(raw_path)
        if expected_receipt["inputBindings"]:
            require(len(runtime_input_matches) == 1, f"compound core execution {label} lacks its adapted runtime input")
            expected_raw_digest = digest(runtime_input_matches[0])
            adaptation = read_json(one_artifact(directory, "literature-input-adaptation-receipt-json"))
            require(adaptation.get("originalInputDigest") == digest(raw_path), f"compound core execution {label} adaptation input drift")
            require(set(adaptation.get("settingIds", [])) == set(expected_setting_ids), f"compound core execution {label} adaptation settings drift")
        else:
            require(not runtime_input_matches, f"compound core execution {label} emitted an unexpected adapted runtime input")
        workspace = read_json(one_artifact(directory, "workspace-root-json"))
        assignments = workspace.get("assignmentDigests")
        expected_assignments = {"raw_chronicle_csv": expected_raw_digest, **{role: digest(path) for role, path in support_paths.items()}}
        require(isinstance(assignments, dict), f"compound core execution {label} assignments must be an object")
        require(set(assignments) == set(expected_assignments) | {"processing_options"}, f"compound core execution {label} assignments are not exact")
        require(all(assignments[key] == value for key, value in expected_assignments.items()), f"compound core execution {label} input digest drift")
        require(workspace.get("inputDigest") == expected_raw_digest, f"compound core execution {label} workspace input drift")
        require(workspace.get("optionsDigest") == assignments.get("processing_options"), f"compound core execution {label} options digest drift")
    require(trees["a"] == trees["b"], "compound core A/B execution trees are not byte-identical")


def validate_compound_component_lane(lane, expected_component, profile):
    require(
        isinstance(lane, dict)
        and set(lane) == {"componentId", "settingIds", "raw", "support", "executions"},
        "compound component lane has missing or unknown fields",
    )
    component_id = lane["componentId"]
    raw_path, support_paths = validate_compound_inputs(lane, f"compound.component[{component_id}]")
    require(set(support_paths) == set(expected_component["requiredSupportRoles"]), f"{component_id} support roles are not exact")
    executions = lane["executions"]
    require(isinstance(executions, dict) and set(executions) == {"a", "b"}, f"{component_id} executions must contain a and b")
    trees = {}
    for label in ("a", "b"):
        directory = private_directory(executions[label], f"compound.component[{component_id}].executions.{label}")
        trees[label] = private_tree(directory)
        method = read_json(one_artifact(directory, "literature-component-method-receipt-json"))
        execution = read_json(one_artifact(directory, "literature-component-execution-receipt-json"))
        require(method.get("protocolVersion") == "chronicle-literature-component-method-receipt/v1", f"{component_id} method receipt schema drift")
        require(execution.get("protocolVersion") == "chronicle-literature-component-execution-receipt/v1", f"{component_id} execution receipt schema drift")
        require(execution.get("componentExecutionStatus") == "executed", f"{component_id} did not execute")
        for observed in (method, execution):
            require(observed.get("componentId") == component_id, f"{component_id} receipt identity drift")
            require(observed.get("parentMethodProfileId") == profile["method_profile_id"], f"{component_id} parent profile drift")
            require(observed.get("sourceWorkId") == profile["source_work_id"], f"{component_id} source identity drift")
            require(observed.get("sourceMethodVariantId") == profile["source_method_variant_id"], f"{component_id} source variant drift")
            require(observed.get("methodProfileVersion") == profile["method_profile_version"], f"{component_id} profile version drift")
            require(observed.get("settingIds") == expected_component["settingIds"], f"{component_id} receipt setting coverage drift")
        require(execution.get("originalInputDigest") == digest(raw_path), f"{component_id} raw input digest drift")
        require(execution.get("supportArtifactDigests") == {role: digest(path) for role, path in support_paths.items()}, f"{component_id} support digest drift")
        require(execution.get("oracleId") == expected_component["sourceOracleId"], f"{component_id} source oracle drift")
        require(execution.get("derivedResultKind") == expected_component["derivedResultKind"], f"{component_id} output kind drift")
        derived = one_artifact(directory, expected_component["derivedResultKind"])
        require(execution.get("derivedResultDigest") == digest(derived), f"{component_id} derived result digest drift")
        require(is_digest(execution.get("componentMethodReceiptDigest")), f"{component_id} method receipt digest is invalid")
        require(digest(one_artifact(directory, "literature-component-method-receipt-json")) == execution["componentMethodReceiptDigest"], f"{component_id} method receipt digest drift")
        require(is_digest(execution.get("adaptationReceiptDigest")), f"{component_id} adaptation receipt digest is invalid")
        require(digest(one_artifact(directory, "literature-input-adaptation-receipt-json")) == execution["adaptationReceiptDigest"], f"{component_id} adaptation receipt digest drift")
        workspace = read_json(one_artifact(directory, "workspace-root-json"))
        expected_assignments = {"raw_chronicle_csv": digest(raw_path), **{role: digest(path) for role, path in support_paths.items()}}
        require(workspace.get("assignmentDigests") == expected_assignments, f"{component_id} workspace assignments drift")
    require(trees["a"] == trees["b"], f"{component_id} A/B execution trees are not byte-identical")


def validate_compound_run(run, profile, variant, library_path):
    expected_keys = {"kind", "selection", "timezone", "oracle", "compiled", "lanes"}
    require(isinstance(run, dict) and set(run) in (expected_keys, expected_keys | {"differentialReceipt"}), "compound run has missing or unknown fields")
    require(run["kind"] == "compound_profile", "compound run kind is invalid")
    require(isinstance(run["timezone"], str) and run["timezone"], "compound run timezone must be non-empty")
    oracle_path = pinned_file(run["oracle"], "compound.oracle")
    compiled = run["compiled"]
    require(isinstance(compiled, dict) and set(compiled) == {"receipt", "runtimeOptions"}, "compound compiled record is invalid")
    receipt_path = pinned_file(compiled["receipt"], "compound.compiled.receipt")
    options_path = pinned_file(compiled["runtimeOptions"], "compound.compiled.runtimeOptions")
    receipt = validate_compiled_receipt(read_json(receipt_path), profile, variant)
    options = read_json(options_path)
    expectation = compound_lane_expectation(receipt, profile)
    validate_compound_lane_coverage(run["lanes"], expectation)
    if expectation["core"]:
        validate_compound_core_lane(run["lanes"]["core"], expectation["core"], receipt, options)
    expected_components = {component["componentId"]: component for component in expectation["components"]}
    for component in run["lanes"]["components"]:
        validate_compound_component_lane(component, expected_components[component["componentId"]], profile)
    expected_external = {
        (binding["executorId"], binding["sourceConfigurationId"]): binding
        for binding in expectation["external"]
    }
    for lane in run["lanes"]["external"]:
        binding = expected_external[(lane["executorId"], lane["sourceConfigurationId"])]
        validate_compound_external_lane(lane, binding, profile, receipt, library_path)
    if "differentialReceipt" in run:
        require(expectation["core"], "compound differential receipt requires a core lane")
        differential_inputs = validate_differential_receipt(run["differentialReceipt"], profile, run["selection"])
        core = run["lanes"]["core"]
        require(differential_inputs["fixture"] == core["raw"], "compound differential fixture differs from the core raw input")
        require(differential_inputs["options"] == compiled["runtimeOptions"], "compound differential options drift")
        require(differential_inputs["support"] == core["support"], "compound differential support drift")
    else:
        require(not differential_required(profile), "compound run requires a released-code differential receipt")
    evidence = {
        "kind": "compound_profile",
        "compiledReceipt": compiled["receipt"]["path"],
        "core": None if run["lanes"]["core"] is None else {"executions": run["lanes"]["core"]["executions"]},
        "components": [
            {"componentId": component["componentId"], "executions": component["executions"]}
            for component in run["lanes"]["components"]
        ],
        "external": [
            {
                "executorId": lane["executorId"],
                "sourceConfigurationId": lane["sourceConfigurationId"],
                "executionReceipt": lane["executionReceipt"]["path"],
            }
            for lane in run["lanes"]["external"]
        ],
        "documentarySettingIds": run["lanes"]["documentary"]["settingIds"],
    }
    execute_oracle(
        oracle_path,
        {
            "assertionsPassed": True,
            "methodProfileId": profile["method_profile_id"],
            "selection": run["selection"],
            "evidence": evidence,
        },
    )


def validate_documentary(record, profile, variant):
    expected_keys = {"selection", "receipt", "oracle"}
    require(isinstance(record, dict) and set(record) == expected_keys, "documentary entry has missing or unknown fields")
    receipt_path = pinned_file(record["receipt"], "documentary.receipt")
    oracle_path = pinned_file(record["oracle"], "documentary.oracle")
    receipt = validate_compiled_receipt(read_json(receipt_path), profile, variant)
    require(receipt.get("bindings") == [], "documentary receipt must not contain executable bindings")
    require(receipt["inputBindings"] == [], "documentary receipt must not contain input bindings")
    require(receipt["outputBindings"] == [], "documentary receipt must not contain output bindings")
    bindings = receipt["documentaryBindings"]
    require(isinstance(bindings, list) and all(isinstance(binding, dict) for binding in bindings), "documentary bindings must be objects")
    require([binding.get("settingId") for binding in bindings] == receipt["settingIds"], "documentary bindings do not cover the exact settings")
    for binding in bindings:
        require(binding.get("executionEligible") is False, "documentary binding must not claim execution eligibility")
        require(isinstance(binding.get("conformanceFixtureId"), str) and binding["conformanceFixtureId"], "documentary binding is missing a conformance fixture")
        require(is_digest(binding.get("conformanceResultDigest")), "documentary binding has an invalid conformance digest")
    execute_oracle(
        oracle_path,
        {
            "assertionsPassed": True,
            "methodProfileId": profile["method_profile_id"],
            "selection": record["selection"],
            "evidence": {
                "kind": "documentary_receipt",
                "receipt": receipt_path.relative_to(REPO).as_posix(),
            },
        },
    )


def external_registry(library_path):
    registry = read_json(EXTERNAL_EXECUTOR_REGISTRY)
    require(registry.get("schema_version") == "chronicle-literature-external-executor-registry/v1", "wrong external executor registry schema")
    require(registry.get("source_library_sha256") == digest(library_path), "external executor registry is stale for the canonical library")
    require(is_digest(registry.get("execution_receipt_sha256")), "external executor registry receipt digest is invalid")
    result = {}
    for executor in registry.get("executors", []):
        require(isinstance(executor, dict), "external executor record must be an object")
        for configuration in executor.get("configurations", []):
            selection = configuration.get("selection")
            if selection is None:
                continue
            identity = (executor.get("method_profile_id"), selection_key(selection))
            require(identity not in result, "duplicate external executor profile selection")
            result[identity] = (executor, configuration)
    return result


@lru_cache
def external_configurations(library_path):
    registry = read_json(EXTERNAL_EXECUTOR_REGISTRY)
    require(registry.get("schema_version") == "chronicle-literature-external-executor-registry/v1", "wrong external executor registry schema")
    require(registry.get("source_library_sha256") == digest(library_path), "external executor registry is stale for the canonical library")
    result = {}
    for executor in registry.get("executors", []):
        require(isinstance(executor, dict), "external executor record must be an object")
        executor_id = executor.get("executor_id")
        for configuration in executor.get("configurations", []):
            require(isinstance(configuration, dict), "external configuration record must be an object")
            identity = (executor_id, configuration.get("source_configuration_id"))
            require(all(isinstance(value, str) and value for value in identity), "external configuration identity is invalid")
            require(identity not in result, "duplicate external executor configuration")
            result[identity] = (executor, configuration)
    return result


def validate_compiled_external_binding(binding, profile, receipt, library_path):
    identity = (binding.get("executorId"), binding.get("sourceConfigurationId"))
    registered = external_configurations(library_path).get(identity)
    require(registered is not None, "compiled external binding is not in the closed registry")
    executor, configuration = registered
    expected = {
        "executorId": executor.get("executor_id"),
        "destinationId": executor.get("executor_id"),
        "sourceConfigurationId": configuration.get("source_configuration_id"),
        "bindingKind": configuration.get("binding_kind"),
        "settingIds": configuration.get("external_setting_ids"),
        "receiptId": configuration.get("receipt_id"),
        "runtime": executor.get("runtime"),
        "runtimeVersion": executor.get("executor_version"),
        "containerImageDigest": executor.get("container_image_digest"),
        "conformanceFixtureId": configuration.get("conformance_fixture_id"),
        "conformanceResultDigest": configuration.get("conformance_result_digest"),
        "executionReceiptDigest": configuration.get("execution_receipt_sha256"),
    }
    if configuration.get("binding_kind") == "campaign":
        aggregate = configuration.get("aggregate_evidence")
        require(isinstance(aggregate, dict), "registered external campaign lacks aggregate evidence")
        expected["aggregateEvidence"] = {
            "methodExecutionPassed": aggregate.get("method_execution_passed"),
            "publishedNumericOraclePassed": aggregate.get("published_numeric_oracle_passed"),
            "sourceJobCount": aggregate.get("source_job_count"),
            "executedSourceJobCount": aggregate.get("executed_source_job_count"),
            "generatedResultRows": aggregate.get("generated_result_rows"),
            "publishedOracleRows": aggregate.get("published_oracle_rows"),
            "publishedOracleJobCount": aggregate.get("published_oracle_job_count"),
            "numericOracleCellsCompared": aggregate.get("numeric_oracle_cells_compared"),
            "numericOracleCellsMismatched": aggregate.get("numeric_oracle_cells_mismatched"),
            "jobsWithoutPublishedNumericOracles": aggregate.get("jobs_without_published_numeric_oracles"),
            "sourceJobsSha256": aggregate.get("source_jobs_sha256"),
            "sourceResultsSha256": aggregate.get("source_results_sha256"),
            "generatedResultManifestSha256": aggregate.get("generated_result_manifest_sha256"),
        }
    else:
        expected.update({
            "modelName": configuration.get("model_name"),
            "formula": configuration.get("formula"),
            "observations": configuration.get("observations"),
        })
    require(binding == expected, "compiled external binding differs from the closed registry")
    require(executor.get("method_profile_id") == profile["method_profile_id"], "external executor profile identity drift")
    require(executor.get("source_work_id") == profile["source_work_id"], "external executor source identity drift")
    require(executor.get("source_method_variant_id") == receipt["sourceMethodVariantId"], "external executor source variant drift")
    require(executor.get("method_profile_version") == receipt["methodProfileVersion"], "external executor profile version drift")
    return executor, configuration


def validate_compound_external_lane(lane, binding, profile, receipt, library_path):
    require(
        isinstance(lane, dict)
        and set(lane) == {"executorId", "sourceConfigurationId", "settingIds", "executionReceipt"},
        "compound external lane has missing or unknown fields",
    )
    executor, configuration = validate_compiled_external_binding(binding, profile, receipt, library_path)
    receipt_path = pinned_file(lane["executionReceipt"], "compound.external.executionReceipt")
    require(digest(receipt_path) == binding["executionReceiptDigest"], "compound external execution receipt digest drift")
    external_receipt = read_json(receipt_path)
    require(external_receipt.get("schema_version") == "chronicle-literature-external-execution-receipt/v1", "wrong external execution receipt schema")
    require(external_receipt.get("passed") is True, "compound external execution did not pass")
    require(external_receipt.get("source_work_id") == profile["source_work_id"], "compound external source identity drift")
    require(external_receipt.get("executor_id") == executor.get("executor_id"), "compound external executor identity drift")
    require(external_receipt.get("executor_version") == executor.get("executor_version"), "compound external executor version drift")
    require(external_receipt.get("runtime") == executor.get("runtime"), "compound external runtime drift")
    require(external_receipt.get("container_image_digest") == executor.get("container_image_digest"), "compound external container drift")
    require(external_receipt.get("fixture_id") == configuration.get("conformance_fixture_id"), "compound external fixture drift")
    require(external_receipt.get("semantic_digest_sha256") == configuration.get("conformance_result_digest"), "compound external semantic digest drift")
    pinned_file(external_receipt.get("audit"), "compound.external.audit")
    pinned_file(external_receipt.get("evidence"), "compound.external.evidence")
    bindings = external_receipt.get("configuration_bindings")
    require(isinstance(bindings, list) and bindings, "compound external receipt lacks configuration bindings")
    if configuration.get("binding_kind") == "model":
        matches = [record for record in bindings if isinstance(record, dict) and record.get("configuration_id") == configuration.get("source_configuration_id")]
        require(len(matches) == 1, "compound external receipt does not contain its registered model")
        model = matches[0]
        require(
            all(model.get(key) == configuration.get(key) for key in ("receipt_id", "model_name", "formula", "observations")),
            "compound external model binding drift",
        )
    else:
        aggregate = configuration.get("aggregate_evidence", {})
        configuration_ids = [record.get("configuration_id") for record in bindings if isinstance(record, dict)]
        require(
            len(configuration_ids) == len(set(configuration_ids)) == aggregate.get("source_job_count"),
            "compound external campaign job coverage drift",
        )


def validate_external_run(run, profile, variant, registry):
    expected_keys = {"kind", "selection", "executorId", "sourceConfigurationId", "executionReceipt"}
    require(isinstance(run, dict) and set(run) == expected_keys, "external run has missing or unknown fields")
    require(run["kind"] == "external_named_executor", "external run kind is invalid")
    registered = registry.get((profile["method_profile_id"], selection_key(run["selection"])))
    require(registered is not None, "external run is not registered for the exact profile selection")
    executor, configuration = registered
    receipt_path = pinned_file(run["executionReceipt"], "external.executionReceipt")
    receipt = read_json(receipt_path)
    require(run["executorId"] == executor.get("executor_id"), "external run executor identity drift")
    require(run["sourceConfigurationId"] == configuration.get("source_configuration_id"), "external source configuration identity drift")
    require(digest(receipt_path) == configuration.get("execution_receipt_sha256"), "external execution receipt digest drift")
    require(configuration.get("selected_level_ids") == variant.get("selectedLevelIds"), "external selected levels disagree with compiler")
    require(configuration.get("executable_setting_ids") == sorted(variant.get("executableSettingIds", [])), "external executable settings disagree with compiler")
    require(receipt.get("passed") is True, "external execution receipt did not pass")
    require(receipt.get("source_work_id") == profile["source_work_id"], "external receipt source identity drift")
    require(receipt.get("semantic_digest_sha256") == configuration.get("conformance_result_digest"), "external semantic digest drift")
    matches = [binding for binding in receipt.get("configuration_bindings", [])
               if binding.get("configuration_id") == run["sourceConfigurationId"]]
    require(len(matches) == 1, "external receipt does not contain exactly one configuration binding")
    binding = matches[0]
    require(all(binding.get(key) == configuration.get(key) for key in ("receipt_id", "model_name", "formula", "observations")),
            "external receipt model binding drift")


def validate(manifest_path):
    require(manifest_path.is_file() and not manifest_path.is_symlink(), f"missing manifest: {manifest_path}")
    private_mode(manifest_path, 0o600)
    document = read_json(manifest_path)
    require(document.get("schemaVersion") == SCHEMA, "wrong execution-spec schema")
    require(set(document) == {"schemaVersion", "authority", "profiles"}, "execution spec has unknown top-level fields")
    authority = document["authority"]
    require(isinstance(authority, dict) and set(authority) == {"profileLibrary", "executionMatrix"}, "execution spec authority is invalid")
    library_path = pinned_file(authority["profileLibrary"], "authority.profileLibrary")
    matrix_path = pinned_file(authority["executionMatrix"], "authority.executionMatrix")
    library = read_json(library_path)
    matrix = read_json(matrix_path)
    external_executions = external_registry(library_path)
    profiles = library.get("profiles")
    variants = matrix.get("variantDetails")
    require(isinstance(profiles, list) and {profile["source_work_id"] for profile in profiles} == retained_work_ids(),
            "canonical library must contain exactly the retained source-work IDs")
    require(isinstance(variants, list) and variants, "compiler matrix must enumerate at least one configuration")
    canonical_profiles = {profile["method_profile_id"]: profile for profile in profiles}
    source_to_profile = {profile["source_work_id"]: profile for profile in profiles}
    require(len(canonical_profiles) == len(source_to_profile) == len(profiles), "canonical profile IDs must be unique")
    canonical_variants = {method_id: {} for method_id in canonical_profiles}
    for variant in variants:
        profile = source_to_profile.get(variant.get("sourceWorkId"))
        require(profile is not None, f"matrix contains unknown source work: {variant.get('sourceWorkId')}")
        key = selection_key(selection_from_id(variant.get("selectionId")))
        require(key not in canonical_variants[profile["method_profile_id"]], "matrix contains a duplicate selection")
        require(list(selection_from_id(variant["selectionId"]).values()) == variant.get("selectedLevelIds"), "matrix selection levels are inconsistent")
        canonical_variants[profile["method_profile_id"]][key] = variant

    declared = document.get("profiles")
    require(isinstance(declared, list) and len(declared) == len(profiles), "execution spec must cover every retained profile")
    require({entry.get("methodProfileId") for entry in declared} == set(canonical_profiles), "execution-spec profile IDs are not the exact canonical set")
    run_count = 0
    documentary_count = 0
    blocked_count = 0
    profile_completions = []
    for entry in declared:
        require(isinstance(entry, dict) and set(entry) == {"methodProfileId", "runs", "documentary", "blocked"}, "profile entry is invalid")
        method_id = entry["methodProfileId"]
        require(
            isinstance(entry["runs"], list)
            and isinstance(entry["documentary"], list)
            and isinstance(entry["blocked"], list),
            f"{method_id} runs/documentary/blocked must be arrays",
        )
        seen = set()
        for run in entry["runs"]:
            key = selection_key(run.get("selection") if isinstance(run, dict) else None)
            require(key in canonical_variants[method_id], f"{method_id} run is not a canonical selection")
            require(key not in seen, f"{method_id} selection is declared twice")
            variant = canonical_variants[method_id][key]
            require(documentary_ready(variant), f"{method_id} completed run is not fully reproduced")
            if isinstance(run, dict) and run.get("kind") == "compound_profile":
                validate_compound_run(run, canonical_profiles[method_id], variant, library_path)
            elif isinstance(run, dict) and run.get("kind") == "external_named_executor":
                component_settings = {
                    setting_id
                    for (profile_id, _), component in registered_components().items()
                    if profile_id == method_id
                    for setting_id in component["settingIds"]
                }
                require(
                    not component_settings.intersection(variant.get("executableSettingIds", [])),
                    f"{method_id} has registered components and requires a compound run",
                )
                validate_external_run(run, canonical_profiles[method_id], variant, external_executions)
            else:
                validate_run(run, canonical_profiles[method_id], variant)
            seen.add(key)
            run_count += 1
        for documentary in entry["documentary"]:
            key = selection_key(documentary.get("selection") if isinstance(documentary, dict) else None)
            require(key in canonical_variants[method_id], f"{method_id} documentary entry is not a canonical selection")
            require(key not in seen, f"{method_id} selection is declared twice")
            variant = canonical_variants[method_id][key]
            require(documentary_ready(variant), f"{method_id} documentary entry is not fully reproduced")
            validate_documentary(documentary, canonical_profiles[method_id], variant)
            seen.add(key)
            documentary_count += 1
        for blocked in entry["blocked"]:
            require(isinstance(blocked, dict) and set(blocked) == {"selection", "code", "detail"}, f"{method_id} blocker is invalid")
            key = selection_key(blocked["selection"])
            require(key in canonical_variants[method_id], f"{method_id} blocker is not a canonical selection")
            require(key not in seen, f"{method_id} selection is declared twice")
            require(blocked["code"] in BLOCK_CODES, f"unknown blocker code: {blocked['code']}")
            require(isinstance(blocked["detail"], str) and blocked["detail"], "blocker detail must be non-empty")
            compiler_blocked = not preprocessing_ready(canonical_variants[method_id][key])
            require((blocked["code"] == "compiler") == compiler_blocked, f"{method_id} blocker disagrees with compiler readiness")
            seen.add(key)
            blocked_count += 1
        require(seen == set(canonical_variants[method_id]), f"{method_id} does not enumerate its exact canonical selections")
        configuration_count = len(canonical_variants[method_id])
        completed_configuration_count = len(entry["runs"])
        blocked_configuration_count = len(entry["blocked"]) + len(entry["documentary"])
        profile_completions.append({
            "methodProfileId": method_id,
            "configurationCount": configuration_count,
            "completedConfigurationCount": completed_configuration_count,
            "blockedConfigurationCount": blocked_configuration_count,
            "status": (
                "executable"
                if configuration_count > 0 and completed_configuration_count == configuration_count and blocked_configuration_count == 0
                else "blocked"
            ),
        })
    configuration_count = len(variants)
    require(run_count + documentary_count + blocked_count == configuration_count, "execution spec does not cover every canonical configuration")
    return {
        "profiles": len(profiles),
        "configurations": configuration_count,
        "runs": run_count,
        "documentary": documentary_count,
        "completedConfigurations": run_count,
        "evidenceOnlyConfigurations": documentary_count,
        "blocked": blocked_count + documentary_count,
        "executableProfiles": sum(completion["status"] == "executable" for completion in profile_completions),
        "profileCompletions": profile_completions,
    }


def refresh_matrix(manifest_path, matrix_path, demote_regressed_completions=False):
    require(manifest_path.is_file() and not manifest_path.is_symlink(), f"missing manifest: {manifest_path}")
    private_mode(manifest_path, 0o600)
    try:
        matrix_relative = matrix_path.relative_to(REPO).as_posix()
    except ValueError:
        raise ValidationError("refreshed execution matrix must stay inside the repository") from None
    relative_path(matrix_relative, "refreshed execution matrix")
    require(matrix_path.is_file() and not matrix_path.is_symlink(), f"missing refreshed matrix: {matrix_path}")
    private_mode(matrix_path, 0o600)
    document = read_json(manifest_path)
    require(document.get("schemaVersion") == SCHEMA, "wrong execution-spec schema")
    require(set(document) == {"schemaVersion", "authority", "profiles"}, "execution spec has unknown top-level fields")
    library_path = DEFAULT_LIBRARY
    require(library_path.is_file() and not library_path.is_symlink(), f"missing canonical library: {library_path}")
    private_mode(library_path, 0o600)
    library = read_json(library_path)
    matrix = read_json(matrix_path)
    registered_external = external_registry(library_path)
    profiles = library.get("profiles")
    variants = matrix.get("variantDetails")
    require(isinstance(profiles, list) and {profile["source_work_id"] for profile in profiles} == retained_work_ids(),
            "canonical library must contain exactly the retained source-work IDs")
    require(isinstance(variants, list) and variants, "refreshed matrix must enumerate at least one configuration")
    method_id_by_source = {profile["source_work_id"]: profile["method_profile_id"] for profile in profiles}
    refreshed = {method_id: {} for method_id in method_id_by_source.values()}
    for variant in variants:
        method_id = method_id_by_source.get(variant.get("sourceWorkId"))
        require(method_id is not None, f"refreshed matrix contains an unknown source work: {variant.get('sourceWorkId')}")
        key = selection_key(selection_from_id(variant.get("selectionId")))
        require(key not in refreshed[method_id], "refreshed matrix contains a duplicate selection")
        refreshed[method_id][key] = variant
    previous_profiles = {entry["methodProfileId"]: entry for entry in document["profiles"]}
    document["profiles"] = [previous_profiles.get(profile["method_profile_id"], {
        "methodProfileId": profile["method_profile_id"], "runs": [], "documentary": [], "blocked": [],
    }) for profile in profiles]
    for entry in document["profiles"]:
        method_id = entry["methodProfileId"]
        for lane in ("runs", "documentary"):
            retained = []
            for record in entry[lane]:
                key = selection_key(record["selection"])
                variant = refreshed[method_id].get(key)
                if variant is None:
                    require(demote_regressed_completions, f"{method_id} completed selection disappeared from the refreshed matrix")
                    continue
                regressed = not documentary_ready(variant)
                if regressed:
                    require(demote_regressed_completions, f"{method_id} completed selection regressed in the refreshed matrix")
                    entry["blocked"].append({
                        "selection": record["selection"],
                        "code": "compiler",
                        "detail": "selection is not fully reproducible in the pinned compiler matrix",
                    })
                else:
                    if lane == "runs" and record.get("kind") == "external_named_executor":
                        registered = registered_external.get((method_id, key))
                        require(registered is not None, f"{method_id} external run is no longer registered")
                        executor, configuration = registered
                        record = {
                            "kind": "external_named_executor",
                            "selection": record["selection"],
                            "executorId": executor["executor_id"],
                            "sourceConfigurationId": configuration["source_configuration_id"],
                            "executionReceipt": authority_record(
                                external_receipt_path(configuration.get("execution_receipt_sha256"))
                            ),
                        }
                    retained.append(record)
            entry[lane] = retained
        completed_keys = {
            selection_key(record["selection"])
            for lane in ("runs", "documentary")
            for record in entry[lane]
        }
        for key, variant in refreshed[method_id].items():
            registered = registered_external.get((method_id, key))
            component_settings = {
                setting_id
                for (profile_id, _), component in registered_components().items()
                if profile_id == method_id
                for setting_id in component["settingIds"]
            }
            if (
                key in completed_keys
                or registered is None
                or not documentary_ready(variant)
                or component_settings.intersection(variant.get("executableSettingIds", []))
            ):
                continue
            executor, configuration = registered
            entry["runs"].append({
                "kind": "external_named_executor",
                "selection": dict(key),
                "executorId": executor["executor_id"],
                "sourceConfigurationId": configuration["source_configuration_id"],
                "executionReceipt": authority_record(external_receipt_path(configuration.get("execution_receipt_sha256"))),
            })
            completed_keys.add(key)
        old_blockers = {selection_key(record["selection"]): record for record in entry["blocked"]}
        entry["blocked"] = []
        for key, variant in refreshed[method_id].items():
            if key in completed_keys:
                continue
            compiler_blocked = not preprocessing_ready(variant)
            previous = old_blockers.get(key)
            entry["blocked"].append({
                "selection": dict(key),
                "code": "compiler" if compiler_blocked else "missing_fixture",
                "detail": (
                    previous["detail"]
                    if previous and previous["code"] == ("compiler" if compiler_blocked else "missing_fixture")
                    else "selection is not fully reproducible in the pinned compiler matrix"
                    if compiler_blocked
                    else "preprocessing-ready selection has no registered compound execution fixture"
                ),
            })
    document["authority"]["profileLibrary"] = authority_record(library_path)
    document["authority"]["executionMatrix"] = authority_record(matrix_path)
    temporary = manifest_path.with_suffix(f"{manifest_path.suffix}.tmp")
    require(not temporary.exists(), f"refusing to replace existing temporary manifest: {temporary}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    try:
        validate(temporary)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    os.replace(temporary, manifest_path)
    return validate(manifest_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--refresh-matrix", type=Path)
    parser.add_argument("--demote-regressed-completions", action="store_true")
    args = parser.parse_args()
    manifest_path = args.manifest if args.manifest.is_absolute() else (REPO / args.manifest)
    require(not (args.initialize and args.refresh_matrix), "--initialize and --refresh-matrix are mutually exclusive")
    require(not args.demote_regressed_completions or args.refresh_matrix, "--demote-regressed-completions requires --refresh-matrix")
    if args.initialize:
        initialize(manifest_path, DEFAULT_LIBRARY, DEFAULT_MATRIX)
    if args.refresh_matrix:
        matrix_path = args.refresh_matrix if args.refresh_matrix.is_absolute() else (REPO / args.refresh_matrix)
        result = refresh_matrix(manifest_path, matrix_path, args.demote_regressed_completions)
    else:
        result = validate(manifest_path)
    print(json.dumps({"schemaVersion": SCHEMA, "assertionsPassed": True, **result}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except ValidationError as error:
        raise SystemExit(f"Android profile execution-spec validation failed: {error}") from None
