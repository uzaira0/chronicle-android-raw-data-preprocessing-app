#!/usr/bin/env python3
"""Run a pinned released implementation and Chronicle on the same explicit inputs."""

import argparse
import hashlib
import json
import math
import os
import stat
import subprocess
from pathlib import Path


REQUEST_SCHEMA = "chronicle-android-released-code-differential-request/v1"
RECEIPT_SCHEMA = "chronicle-android-released-code-differential-receipt/v1"
REPO = Path(__file__).resolve().parent.parent
PRIVATE_ROOT = REPO / ".tmp-literature-review-private"
SOURCE_REGISTRY = REPO / "web/src/generated/source-artifact-provenance-registry.json"
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


class GateError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def sha256_bytes(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def sha256_file(path):
    return sha256_bytes(path.read_bytes())


def object_digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return sha256_bytes(encoded)


def is_digest(value):
    return (
        isinstance(value, str)
        and len(value) == 71
        and value.startswith("sha256:")
        and all(character in "0123456789abcdef" for character in value[7:])
    )


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise GateError(f"cannot read strict JSON {path}: {type(error).__name__}") from None


def normalized_repo_path(value, label, *, private=False):
    require(isinstance(value, str) and value, f"{label}.path must be a non-empty string")
    relative = Path(value)
    require(not relative.is_absolute(), f"{label}.path must be repository-relative")
    require(relative.as_posix() == value, f"{label}.path must use normalized POSIX syntax")
    require(relative.parts and all(part not in ("", ".", "..") for part in relative.parts), f"unsafe {label}.path")
    if private:
        require(relative.parts[0] == PRIVATE_ROOT.name, f"{label}.path must stay in {PRIVATE_ROOT.name}")
    current = REPO
    for part in relative.parts:
        current = current / part
        require(current.exists(), f"missing {label}: {current}")
        require(not current.is_symlink(), f"symlink is not allowed for {label}: {current}")
    return current


def pinned_file(record, label, *, private=False):
    require(isinstance(record, dict) and set(record) == {"path", "sha256"}, f"{label} must contain path and sha256")
    path = normalized_repo_path(record["path"], label, private=private)
    require(path.is_file(), f"{label} is not a regular file")
    if private:
        require(stat.S_IMODE(path.stat().st_mode) == 0o600, f"{label} must be mode 0600")
    require(is_digest(record["sha256"]), f"{label}.sha256 is invalid")
    require(sha256_file(path) == record["sha256"], f"{label} digest changed")
    return path


def authority_record(path):
    return {"path": path.relative_to(REPO).as_posix(), "sha256": sha256_file(path)}


def records(records_value, label, *, private=False, nonempty=True):
    require(isinstance(records_value, list), f"{label} must be an array")
    require(not nonempty or records_value, f"{label} must not be empty")
    result = []
    seen = set()
    for index, record in enumerate(records_value):
        path = pinned_file(record, f"{label}[{index}]", private=private)
        require(path not in seen, f"{label} contains a duplicate path")
        seen.add(path)
        result.append(path)
    return result


def source_registry_rows(source_work_id):
    registry = read_json(SOURCE_REGISTRY)
    require(registry.get("schema_version") == "chronicle-source-artifact-provenance-closed-registry/v2", "wrong source-artifact registry schema")
    payload = {key: value for key, value in registry.items() if key != "content_digest"}
    require(object_digest(payload) == registry.get("content_digest"), "source-artifact registry content digest changed")
    identities = [row for row in registry.get("profile_identities", []) if row.get("source_work_id") == source_work_id]
    require(len(identities) == 1, "source work is not identified exactly once by the source-artifact registry")
    return registry, {
        row["source_artifact_provenance"]["source_artifact_provenance_id"]: row
        for row in registry.get("rows", [])
        if row.get("source_work_id") == source_work_id
    }


def validate_source_artifacts(value, source_work_id):
    require(isinstance(value, list) and value, "sourceArtifacts must be a non-empty array")
    registry, rows = source_registry_rows(source_work_id)
    resolved = []
    seen = set()
    for index, record in enumerate(value):
        expected = {"sourceArtifactProvenanceId", "path", "sha256"}
        require(isinstance(record, dict) and set(record) == expected, f"sourceArtifacts[{index}] is invalid")
        provenance_id = record["sourceArtifactProvenanceId"]
        require(provenance_id not in seen, "duplicate source artifact provenance ID")
        seen.add(provenance_id)
        row = rows.get(provenance_id)
        require(row is not None, f"unregistered source artifact: {provenance_id}")
        require(row.get("candidate_status") == "ready_for_typed_registry", f"source artifact is not receipt-ready: {provenance_id}")
        provenance = row["source_artifact_provenance"]
        require(
            provenance.get("artifact_role") in EXECUTABLE_SOURCE_ROLES,
            f"source artifact is not executable code: {provenance_id}",
        )
        registered_digest = provenance.get("locally_validated_artifact_digest")
        require(registered_digest is not None, f"source artifact has no registered local content digest: {provenance_id}")
        path = pinned_file({"path": record["path"], "sha256": record["sha256"]}, f"sourceArtifacts[{index}]", private=True)
        require(record["sha256"] == registered_digest, f"source artifact bytes disagree with the registry: {provenance_id}")
        resolved.append((record, row, path))
    return registry, resolved


def safe_output_name(value):
    require(isinstance(value, str) and value, "output names must be non-empty strings")
    path = Path(value)
    require(not path.is_absolute() and path.as_posix() == value, f"unsafe output name: {value!r}")
    require(path.parts and all(part not in ("", ".", "..") for part in path.parts), f"unsafe output name: {value!r}")
    return path


def command_placeholders(command, support_roles, source_artifacts):
    joined = "\0".join(command)
    required = {"{entrypoint}", "{fixture}", "{options}", "{output}"}
    required.update(f"{{support:{role}}}" for role in support_roles)
    required.update(f"{{sourceArtifact:{provenance_id}}}" for provenance_id in source_artifacts)
    missing = sorted(placeholder for placeholder in required if placeholder not in joined)
    require(not missing, f"command omits required identical-input placeholders: {missing}")


def execution_request(value, label, support_roles, source_artifacts=None):
    require(isinstance(value, dict) and set(value) == {"command", "entrypoint", "implementation", "runtime"}, f"{label} is invalid")
    entrypoint = pinned_file(value["entrypoint"], f"{label}.entrypoint")
    implementation = records(value["implementation"], f"{label}.implementation")
    require(entrypoint in implementation, f"{label}.entrypoint must be included in {label}.implementation")
    source_artifacts = source_artifacts or {}
    require(
        set(source_artifacts.values()) <= set(implementation),
        f"{label}.implementation must include every released source artifact",
    )
    runtime = records(value["runtime"], f"{label}.runtime")
    command = value["command"]
    require(isinstance(command, list) and command and all(isinstance(part, str) and part for part in command), f"{label}.command must be a non-empty argv array")
    command_placeholders(command, support_roles, source_artifacts)
    return {"entrypoint": entrypoint, "implementation": implementation, "runtime": runtime, "command": command}


def expanded_command(template, execution, fixture, options, support, output, source_artifacts=None):
    replacements = {
        "{entrypoint}": str(execution["entrypoint"]),
        "{fixture}": str(fixture),
        "{options}": str(options),
        "{output}": str(output),
        **{f"{{support:{role}}}": str(path) for role, path in support.items()},
        **{
            f"{{sourceArtifact:{provenance_id}}}": str(path)
            for provenance_id, path in (source_artifacts or {}).items()
        },
    }
    return [replace_all(part, replacements) for part in template]


def replace_all(value, replacements):
    result = value
    for needle, replacement in replacements.items():
        result = result.replace(needle, replacement)
    require("{" not in result and "}" not in result, f"unknown command placeholder in {value!r}")
    return result


def run_command(argv, timeout_seconds):
    environment = os.environ.copy()
    environment.update({"TZ": "UTC", "LC_ALL": "C", "LANG": "C", "PYTHONHASHSEED": "0"})
    try:
        completed = subprocess.run(
            argv,
            cwd=REPO,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
            shell=False,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError(f"execution did not complete: {type(error).__name__}") from None
    require(completed.returncode == 0, f"execution exited with status {completed.returncode}")


def output_records(directory, output_names):
    expected = {safe_output_name(value) for value in output_names}
    actual = set()
    for path in directory.rglob("*"):
        require(not path.is_symlink(), f"execution output contains a symlink: {path}")
        if path.is_dir():
            require(stat.S_IMODE(path.stat().st_mode) == 0o700, f"execution output directory must be mode 0700: {path}")
            continue
        require(path.is_file(), f"unsupported execution output: {path}")
        require(stat.S_IMODE(path.stat().st_mode) == 0o600, f"execution output must be mode 0600: {path}")
        actual.add(path.relative_to(directory))
    require(actual == expected, f"execution output set differs from declared outputs: expected {sorted(map(str, expected))}, got {sorted(map(str, actual))}")
    return [authority_record(directory / path) for path in sorted(expected)]


def json_equal(left, right, tolerance, location="$."):
    number = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool)
    if number(left) and number(right):
        require(math.isfinite(left) and math.isfinite(right), f"non-finite numeric output at {location}")
        require(abs(left - right) <= tolerance, f"numeric output differs beyond tolerance at {location}")
        return
    require(type(left) is type(right), f"output type differs at {location}")
    if isinstance(left, dict):
        require(set(left) == set(right), f"output keys differ at {location}")
        for key in sorted(left):
            json_equal(left[key], right[key], tolerance, f"{location}{key}.")
    elif isinstance(left, list):
        require(len(left) == len(right), f"output length differs at {location}")
        for index, (left_item, right_item) in enumerate(zip(left, right)):
            json_equal(left_item, right_item, tolerance, f"{location}[{index}]")
    else:
        require(left == right, f"output differs at {location}")


def compare_outputs(source_dir, chronicle_dir, output_names, comparison):
    mode = comparison.get("mode") if isinstance(comparison, dict) else None
    if mode == "exact_bytes":
        require(set(comparison) == {"mode"}, "exact comparison has unknown fields")
        for name in output_names:
            require((source_dir / name).read_bytes() == (chronicle_dir / name).read_bytes(), f"output bytes differ: {name}")
        return {"mode": mode, "absoluteTolerance": 0, "toleranceEvidence": None}
    require(mode == "json_numeric_absolute", f"unsupported comparison mode: {mode!r}")
    require(set(comparison) == {"mode", "absoluteTolerance", "toleranceEvidence", "locator"}, "tolerant comparison has missing or unknown fields")
    tolerance = comparison["absoluteTolerance"]
    require(isinstance(tolerance, (int, float)) and not isinstance(tolerance, bool) and math.isfinite(tolerance) and tolerance >= 0, "absoluteTolerance must be a finite non-negative number")
    evidence = pinned_file(comparison["toleranceEvidence"], "comparison.toleranceEvidence", private=True)
    require(isinstance(comparison["locator"], str) and comparison["locator"], "tolerant comparison requires an evidence locator")
    for name in output_names:
        json_equal(read_json(source_dir / name), read_json(chronicle_dir / name), tolerance)
    return {
        "mode": mode,
        "absoluteTolerance": tolerance,
        "toleranceEvidence": authority_record(evidence),
        "locator": comparison["locator"],
    }


def run_gate(request_path, output_dir):
    require(request_path.is_file() and not request_path.is_symlink(), "request must be a regular non-symlink file")
    require(request_path.is_relative_to(PRIVATE_ROOT), f"request must stay in {PRIVATE_ROOT.name}")
    require(stat.S_IMODE(request_path.stat().st_mode) == 0o600, "request must be mode 0600")
    require(not output_dir.exists(), f"refusing to replace existing output directory: {output_dir}")
    require(output_dir.is_relative_to(PRIVATE_ROOT), f"output directory must stay in {PRIVATE_ROOT.name}")
    request = read_json(request_path)
    expected_keys = {
        "schemaVersion", "methodProfileId", "sourceWorkId", "selection", "sourceArtifacts",
        "fixture", "support", "options", "source", "chronicle", "outputs", "comparison", "timeoutSeconds",
    }
    require(isinstance(request, dict) and set(request) == expected_keys, "request has missing or unknown fields")
    require(request["schemaVersion"] == REQUEST_SCHEMA, "wrong differential request schema")
    require(request["methodProfileId"] == f"method-profile:{request['sourceWorkId']}", "method/source work identity mismatch")
    require(isinstance(request["selection"], dict), "selection must be an object")
    require(all(isinstance(key, str) and key and isinstance(value, str) and value for key, value in request["selection"].items()), "selection must contain non-empty string IDs")
    timeout_seconds = request["timeoutSeconds"]
    require(isinstance(timeout_seconds, int) and not isinstance(timeout_seconds, bool) and 0 < timeout_seconds <= 3600, "timeoutSeconds must be an integer from 1 to 3600")

    registry, source_artifacts = validate_source_artifacts(request["sourceArtifacts"], request["sourceWorkId"])
    fixture = pinned_file(request["fixture"], "fixture", private=True)
    options = pinned_file(request["options"], "options", private=True)
    support_value = request["support"]
    require(isinstance(support_value, list), "support must be an array")
    support = {}
    for index, record in enumerate(support_value):
        require(isinstance(record, dict) and set(record) == {"role", "path", "sha256"}, f"support[{index}] is invalid")
        role = record["role"]
        require(isinstance(role, str) and role and role not in support, f"invalid or duplicate support role: {role!r}")
        support[role] = pinned_file({"path": record["path"], "sha256": record["sha256"]}, f"support[{role}]", private=True)
    source_artifact_paths = {
        record["sourceArtifactProvenanceId"]: path for record, _row, path in source_artifacts
    }
    source = execution_request(
        request["source"], "source", support, source_artifacts=source_artifact_paths
    )
    chronicle = execution_request(request["chronicle"], "chronicle", support)
    outputs = request["outputs"]
    require(isinstance(outputs, list) and outputs, "outputs must be a non-empty array")
    require(len(set(outputs)) == len(outputs), "outputs must be unique")
    for name in outputs:
        safe_output_name(name)

    output_dir.mkdir(mode=0o700, parents=True)
    source_dir = output_dir / "source"
    chronicle_a_dir = output_dir / "chronicle-a"
    chronicle_b_dir = output_dir / "chronicle-b"
    for directory in (source_dir, chronicle_a_dir, chronicle_b_dir):
        directory.mkdir(mode=0o700)

    run_command(
        expanded_command(
            source["command"], source, fixture, options, support, source_dir,
            source_artifacts=source_artifact_paths,
        ),
        timeout_seconds,
    )
    run_command(expanded_command(chronicle["command"], chronicle, fixture, options, support, chronicle_a_dir), timeout_seconds)
    run_command(expanded_command(chronicle["command"], chronicle, fixture, options, support, chronicle_b_dir), timeout_seconds)
    source_outputs = output_records(source_dir, outputs)
    chronicle_a_outputs = output_records(chronicle_a_dir, outputs)
    chronicle_b_outputs = output_records(chronicle_b_dir, outputs)
    require(
        [record["sha256"] for record in chronicle_a_outputs]
        == [record["sha256"] for record in chronicle_b_outputs],
        "Chronicle A/B outputs are not byte-identical",
    )
    comparison = compare_outputs(source_dir, chronicle_a_dir, outputs, request["comparison"])

    shared_inputs = {
        "fixture": authority_record(fixture),
        "support": [{"role": role, **authority_record(path)} for role, path in sorted(support.items())],
        "options": authority_record(options),
    }
    execution_receipt = lambda execution, output_records_value: {
        "commandTemplateDigest": object_digest(execution["command"]),
        "entrypoint": authority_record(execution["entrypoint"]),
        "implementation": [authority_record(path) for path in execution["implementation"]],
        "runtime": [authority_record(path) for path in execution["runtime"]],
        "sharedInputDigest": object_digest(shared_inputs),
        "outputs": output_records_value,
    }
    payload = {
        "schemaVersion": RECEIPT_SCHEMA,
        "passed": True,
        "methodProfileId": request["methodProfileId"],
        "sourceWorkId": request["sourceWorkId"],
        "selection": request["selection"],
        "request": authority_record(request_path),
        "sourceArtifactRegistry": {
            **authority_record(SOURCE_REGISTRY),
            "contentDigest": registry["content_digest"],
        },
        "sourceArtifacts": [
            {
                "sourceArtifactProvenanceId": record["sourceArtifactProvenanceId"],
                "methodSettingId": row["method_setting_id"],
                "sourceArtifactProvenanceObjectDigest": row["source_artifact_provenance_object_digest"],
                **authority_record(path),
            }
            for record, row, path in source_artifacts
        ],
        "sharedInputs": shared_inputs,
        "sourceExecution": execution_receipt(source, source_outputs),
        "chronicleExecutions": {
            "a": execution_receipt(chronicle, chronicle_a_outputs),
            "b": execution_receipt(chronicle, chronicle_b_outputs),
        },
        "comparison": {**comparison, "outputs": outputs, "passed": True},
    }
    receipt = {**payload, "contentDigest": object_digest(payload)}
    receipt_path = output_dir / "differential-receipt.json"
    descriptor = os.open(receipt_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(receipt, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    return receipt_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    request = args.request if args.request.is_absolute() else REPO / args.request
    output = args.output_dir if args.output_dir.is_absolute() else REPO / args.output_dir
    print(run_gate(request.resolve(), output.resolve()).relative_to(REPO).as_posix())


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except GateError as error:
        raise SystemExit(f"Android released-code differential gate failed: {error}") from None
