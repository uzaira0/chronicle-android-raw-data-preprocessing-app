#!/usr/bin/env python3
"""Compile and prove one canonical Android method-profile configuration.

The driver deliberately uses Chronicle's normal native workspace executor.  Its
only exceptional authority is the explicit conformance-attempt admission used
before a configuration has been promoted into the completed-proof registry.
The existing execution-spec validator remains the authority that compares the
two persisted artifact trees and executes the independent semantic oracle.
"""

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PRIVATE_ROOT = REPO / ".tmp-literature-review-private"
RUNTIME_MANIFEST = REPO / "rust/chronicle_preprocessing_runtime_wasm/Cargo.toml"
RUNTIME_EXAMPLE = "profile_execute_workspace_native"
COMPILER = REPO / "web/scripts/compile_android_method_profile.mts"
VITE_NODE = REPO / "web/node_modules/.bin/vite-node"
VALIDATOR = REPO / "scripts/validate-android-profile-execution-spec.py"
LITERATURE_INPUT_ADAPTER_CONTRACT = REPO / "web/schema/literature-input-adapter-contract.json"


class ConformanceError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ConformanceError(message)


def read_json(path: Path, label: str) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ConformanceError(f"cannot read {label} JSON {path}: {error}") from None


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def repository_relative(path: Path, label: str, *, private: bool = True) -> str:
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(REPO)
    except ValueError:
        raise ConformanceError(f"{label} must stay inside the repository") from None
    require(path.exists() and not path.is_symlink(), f"missing or symlinked {label}: {path}")
    if private:
        try:
            relative.relative_to(PRIVATE_ROOT.relative_to(REPO))
        except ValueError:
            raise ConformanceError(f"{label} must stay inside {PRIVATE_ROOT.name}") from None
    return relative.as_posix()


def private_file(path: Path, label: str) -> str:
    relative = repository_relative(path, label)
    require(path.is_file(), f"{label} is not a regular file: {path}")
    require(stat.S_IMODE(path.stat().st_mode) == 0o600, f"{label} must be 0600: {path}")
    return relative


def pin(path: Path, label: str) -> dict[str, str]:
    return {"path": private_file(path, label), "sha256": sha256(path)}


def selection(values: list[str]) -> dict[str, str]:
    selected: dict[str, str] = {}
    for value in values:
        group, separator, level = value.partition("=")
        require(separator == "=" and group and level, f"invalid --select value: {value}")
        require(group not in selected, f"duplicate --select group: {group}")
        selected[group] = level
    return dict(sorted(selected.items()))


def run(command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            shell=False,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ConformanceError(f"command did not complete: {command[0]}: {type(error).__name__}") from None
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "no diagnostic output"
        raise ConformanceError(f"command failed ({completed.returncode}): {command[0]}: {detail}")
    return completed


def write_private_json(path: Path, value: object, *, exclusive: bool = False) -> None:
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def compile_profile(
    profile_id: str,
    selected: dict[str, str],
    library_path: Path,
    timezone: str,
    output: Path,
) -> tuple[Path, Path]:
    selection_path = output / "selection.json"
    write_private_json(selection_path, selected, exclusive=True)
    command = [
        str(VITE_NODE),
        str(COMPILER),
        "--library",
        str(library_path),
        "--profile-id",
        profile_id,
        "--selection",
        str(selection_path),
        "--timezone",
        timezone,
        "--output",
        str(output / "compiled"),
    ]
    run(command, cwd=REPO / "web")
    receipt = output / "compiled/method-profile-receipt.json"
    options = output / "compiled/runtime-options.json"
    require(
        receipt.is_file(),
        "compiler did not produce a complete method-profile receipt; conformance refuses supported-plan diagnostics",
    )
    require(options.is_file(), "compiler did not produce runtime options")
    private_file(receipt, "compiled receipt")
    private_file(options, "compiled runtime options")
    compiled_receipt = read_json(receipt, "compiled receipt")
    require(isinstance(compiled_receipt, dict), "compiled receipt must be an object")
    require(compiled_receipt.get("methodProfileId") == profile_id, "compiler returned the wrong profile")
    return receipt, options


def compound_expectation(receipt: dict[str, object], profile_id: str) -> dict[str, object]:
    setting_ids = receipt.get("settingIds")
    require(
        isinstance(setting_ids, list)
        and setting_ids
        and all(isinstance(setting_id, str) and setting_id for setting_id in setting_ids)
        and len(setting_ids) == len(set(setting_ids)),
        "compiled setting IDs must be non-empty and unique",
    )
    expected = set(setting_ids)
    contract = read_json(LITERATURE_INPUT_ADAPTER_CONTRACT, "literature input-adapter contract")
    require(isinstance(contract, dict) and contract.get("schemaVersion") == "chronicle-literature-input-adapter-contract/v1", "wrong literature input-adapter contract schema")
    input_bindings = receipt.get("inputBindings", [])
    require(isinstance(input_bindings, list), "compiled input bindings must be an array")
    input_ids_by_adapter: dict[str, list[str]] = {}
    for binding in input_bindings:
        require(isinstance(binding, dict), "compiled input bindings must be objects")
        identity = f"{binding.get('adapterId')}/{binding.get('adapterVersion')}"
        setting_id = binding.get("settingId")
        require(isinstance(setting_id, str), "compiled input binding setting ID is invalid")
        input_ids_by_adapter.setdefault(identity, []).append(setting_id)

    components: list[dict[str, object]] = []
    owned: set[str] = set()
    groups = contract.get("groups")
    require(isinstance(groups, list), "literature input-adapter groups must be an array")
    for group in groups:
        require(isinstance(group, dict), "literature input-adapter groups must be objects")
        component = group.get("componentExecution")
        if not isinstance(component, dict) or component.get("parentMethodProfileId") != profile_id:
            continue
        component_id = component.get("componentId")
        component_ids = group.get("methodSettingIds")
        require(isinstance(component_id, str) and component_id, "registered component ID is invalid")
        require(isinstance(component_ids, list) and component_ids and all(isinstance(value, str) for value in component_ids), f"{component_id} registered settings are invalid")
        selected = expected.intersection(component_ids)
        if not selected:
            continue
        require(selected == set(component_ids), f"{component_id} is only partially selected")
        require(set(input_ids_by_adapter.get(component_id, [])) == set(component_ids), f"{component_id} compiled bindings disagree with its registration")
        require(not owned.intersection(component_ids), f"{component_id} overlaps another compound lane")
        owned.update(component_ids)
        components.append({
            "componentId": component_id,
            "settingIds": component_ids,
            "requiredSupportRoles": component.get("requiredSupportRoles", []),
        })

    external = receipt.get("externalBindings", [])
    require(isinstance(external, list), "compiled external bindings must be an array")
    for binding in external:
        require(isinstance(binding, dict), "compiled external bindings must be objects")
        external_ids = binding.get("settingIds")
        require(isinstance(external_ids, list) and external_ids and all(isinstance(value, str) and value in expected for value in external_ids), "compiled external setting IDs are invalid")
        require(not owned.intersection(external_ids), "compiled external binding overlaps another lane")
        owned.update(external_ids)

    documentary_bindings = receipt.get("documentaryBindings", [])
    require(isinstance(documentary_bindings, list), "compiled documentary bindings must be an array")
    documentary: list[str] = []
    for binding in documentary_bindings:
        require(isinstance(binding, dict), "compiled documentary bindings must be objects")
        setting_id = binding.get("settingId")
        require(isinstance(setting_id, str) and setting_id in expected, "compiled documentary setting ID is invalid")
        require(setting_id not in owned, f"documentary setting overlaps another lane: {setting_id}")
        owned.add(setting_id)
        documentary.append(setting_id)
    return {
        "core": [setting_id for setting_id in setting_ids if setting_id not in owned],
        "components": components,
        "external": external,
        "documentary": documentary,
    }


def core_receipt(receipt: dict[str, object], setting_ids: list[str]) -> dict[str, object]:
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
    require(bound == selected, "core lane does not bind every claimed setting")
    return result


def external_receipt(binding: dict[str, object]) -> Path:
    expected = binding.get("executionReceiptDigest")
    require(isinstance(expected, str) and expected.startswith("sha256:"), "external binding execution digest is invalid")
    matches = [
        path
        for path in (PRIVATE_ROOT / "profile-runs").rglob("external-execution.json")
        if path.is_file() and not path.is_symlink() and sha256(path) == expected
    ]
    require(len(matches) == 1, "external binding must resolve to exactly one private execution receipt")
    private_file(matches[0], "external execution receipt")
    return matches[0]


def execute_once(
    raw: Path,
    receipt: Path,
    options: Path,
    support: list[tuple[str, Path]],
    output: Path,
) -> None:
    output.mkdir(mode=0o700)
    command = [
        "cargo",
        "run",
        "--quiet",
        "--manifest-path",
        str(RUNTIME_MANIFEST),
        "--example",
        RUNTIME_EXAMPLE,
        "--",
        "--raw",
        str(raw),
        "--options",
        str(options),
        "--receipt",
        str(receipt),
        "--conformance-attempt",
        "--export-artifacts-dir",
        str(output),
    ]
    for role, path in support:
        command.extend(("--support", f"{role}={path}"))
    run(command, cwd=REPO)
    require(any(output.iterdir()), f"runtime produced no persisted artifacts: {output}")


def execute_core_once(
    raw: Path,
    receipt: Path,
    options: Path,
    support: list[tuple[str, Path]],
    output: Path,
) -> None:
    output.mkdir(mode=0o700)
    command = [
        "cargo",
        "run",
        "--quiet",
        "--manifest-path",
        str(RUNTIME_MANIFEST),
        "--example",
        RUNTIME_EXAMPLE,
        "--",
        "--raw",
        str(raw),
        "--options",
        str(options),
        "--diagnostic-receipt",
        str(receipt),
        "--export-artifacts-dir",
        str(output),
    ]
    for role, path in support:
        command.extend(("--support", f"{role}={path}"))
    run(command, cwd=REPO)
    require(any(output.iterdir()), f"core runtime produced no persisted artifacts: {output}")


def execute_component_once(
    component_id: str,
    raw: Path,
    options: Path,
    support: list[tuple[str, Path]],
    output: Path,
) -> None:
    output.mkdir(mode=0o700)
    command = [
        "cargo",
        "run",
        "--quiet",
        "--manifest-path",
        str(RUNTIME_MANIFEST),
        "--example",
        RUNTIME_EXAMPLE,
        "--",
        "--raw",
        str(raw),
        "--options",
        str(options),
        "--component",
        component_id,
        "--export-artifacts-dir",
        str(output),
    ]
    for role, path in support:
        command.extend(("--support", f"{role}={path}"))
    run(command, cwd=REPO)
    require(any(output.iterdir()), f"component runtime produced no persisted artifacts: {output}")


def replace_blocker_with_run(
    manifest: dict[str, object],
    profile_id: str,
    selected: dict[str, str],
    run_record: dict[str, object],
) -> None:
    profiles = manifest.get("profiles")
    require(isinstance(profiles, list), "execution-spec profiles must be an array")
    matches = [entry for entry in profiles if isinstance(entry, dict) and entry.get("methodProfileId") == profile_id]
    require(len(matches) == 1, f"execution spec must contain exactly one profile: {profile_id}")
    entry = matches[0]
    for lane in ("runs", "documentary", "blocked"):
        require(isinstance(entry.get(lane), list), f"execution-spec {lane} must be an array")
    require(
        not any(isinstance(record, dict) and record.get("selection") == selected for record in entry["runs"]),
        "selection already has a completed run",
    )
    require(
        not any(isinstance(record, dict) and record.get("selection") == selected for record in entry["documentary"]),
        "selection is registered as documentary-only",
    )
    blockers = [
        record
        for record in entry["blocked"]
        if isinstance(record, dict) and record.get("selection") == selected
    ]
    require(len(blockers) == 1, "selection must replace exactly one existing execution-spec blocker")
    entry["blocked"] = [record for record in entry["blocked"] if record is not blockers[0]]
    entry["runs"].append(run_record)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--select", action="append", default=[], metavar="GROUP=LEVEL")
    parser.add_argument("--support", action="append", default=[], metavar="ROLE=PATH")
    parser.add_argument("--component", action="append", default=[], metavar="COMPONENT_ID=RAW_PATH")
    parser.add_argument(
        "--component-support",
        action="append",
        default=[],
        metavar="COMPONENT_ID:ROLE=PATH",
    )
    parser.add_argument("--differential-receipt", type=Path)
    parser.add_argument("--timezone", default="UTC")
    args = parser.parse_args()

    os.umask(0o077)
    manifest_path = args.manifest if args.manifest.is_absolute() else REPO / args.manifest
    raw_path = args.raw if args.raw.is_absolute() else REPO / args.raw
    oracle_path = args.oracle if args.oracle.is_absolute() else REPO / args.oracle
    output = args.output if args.output.is_absolute() else REPO / args.output
    differential = args.differential_receipt
    if differential is not None and not differential.is_absolute():
        differential = REPO / differential

    private_file(manifest_path, "execution-spec manifest")
    manifest_digest = sha256(manifest_path)
    raw_record = pin(raw_path, "raw source-faithful fixture")
    oracle_record = pin(oracle_path, "independent semantic oracle")
    require(oracle_path.suffix == ".py", "independent semantic oracle must be a Python script")
    require(args.profile_id.strip() == args.profile_id and args.profile_id, "--profile-id must be non-empty")
    require(args.timezone.strip() == args.timezone and args.timezone, "--timezone must be non-empty")

    selected = selection(args.select)
    support: list[tuple[str, Path]] = []
    support_records: list[dict[str, object]] = []
    seen_roles: set[str] = set()
    for item in args.support:
        role, separator, value = item.partition("=")
        require(separator == "=" and role and value, f"invalid --support value: {item}")
        require(role not in seen_roles and role != "raw_chronicle_csv", f"duplicate or reserved support role: {role}")
        seen_roles.add(role)
        path = Path(value)
        if not path.is_absolute():
            path = REPO / path
        record = pin(path, f"support fixture {role}")
        support.append((role, path))
        support_records.append({"role": role, **record})

    component_raw: dict[str, Path] = {}
    component_raw_records: dict[str, dict[str, str]] = {}
    for item in args.component:
        component_id, separator, value = item.partition("=")
        require(separator == "=" and component_id and value, f"invalid --component value: {item}")
        require(component_id not in component_raw, f"duplicate --component ID: {component_id}")
        path = Path(value)
        if not path.is_absolute():
            path = REPO / path
        component_raw[component_id] = path
        component_raw_records[component_id] = pin(path, f"component raw fixture {component_id}")
    component_support: dict[str, list[tuple[str, Path]]] = {}
    component_support_records: dict[str, list[dict[str, object]]] = {}
    component_support_roles: set[tuple[str, str]] = set()
    for item in args.component_support:
        owner_role, separator, value = item.partition("=")
        component_id, role_separator, role = owner_role.rpartition(":")
        require(separator == "=" and role_separator == ":" and component_id and role and value, f"invalid --component-support value: {item}")
        identity = (component_id, role)
        require(identity not in component_support_roles and role != "raw_chronicle_csv", f"duplicate or reserved component support role: {owner_role}")
        component_support_roles.add(identity)
        path = Path(value)
        if not path.is_absolute():
            path = REPO / path
        record = pin(path, f"component support fixture {component_id}:{role}")
        component_support.setdefault(component_id, []).append((role, path))
        component_support_records.setdefault(component_id, []).append({"role": role, **record})

    require(not output.exists(), f"refusing to replace conformance output: {output}")
    output_relative = Path(repository_relative(output.parent, "conformance output parent")) / output.name
    output.mkdir(mode=0o700)

    document = read_json(manifest_path, "execution-spec manifest")
    require(isinstance(document, dict), "execution-spec manifest must be an object")
    authority = document.get("authority")
    require(isinstance(authority, dict), "execution-spec authority must be an object")
    library_record = authority.get("profileLibrary")
    require(
        isinstance(library_record, dict) and set(library_record) == {"path", "sha256"},
        "execution-spec profileLibrary authority is invalid",
    )
    library_path = REPO / str(library_record["path"])
    private_file(library_path, "canonical profile library")
    require(sha256(library_path) == library_record["sha256"], "canonical profile library digest changed")

    receipt, options = compile_profile(
        args.profile_id,
        selected,
        library_path,
        args.timezone,
        output,
    )
    compiled_receipt = read_json(receipt, "compiled receipt")
    require(isinstance(compiled_receipt, dict), "compiled receipt must be an object")
    expectation = compound_expectation(compiled_receipt, args.profile_id)
    is_compound = bool(expectation["components"] or expectation["external"])
    executions = output / "executions"
    executions.mkdir(mode=0o700)
    compiled_record = {
        "receipt": pin(receipt, "compiled receipt"),
        "runtimeOptions": pin(options, "compiled runtime options"),
    }
    if is_compound:
        expected_components = {
            component["componentId"]: component
            for component in expectation["components"]
        }
        require(set(component_raw) == set(expected_components), "--component fixtures must equal the registered selected components")
        require(set(component_support) <= set(expected_components), "--component-support names an unselected component")
        component_lanes = []
        component_root = executions / "components"
        component_root.mkdir(mode=0o700)
        for index, component in enumerate(expectation["components"], start=1):
            component_id = component["componentId"]
            component_roles = component_support.get(component_id, [])
            require(
                {role for role, _ in component_roles} == set(component["requiredSupportRoles"]),
                f"{component_id} component support roles must equal its registration",
            )
            directory = component_root / f"{index:03d}"
            directory.mkdir(mode=0o700)
            execute_component_once(component_id, component_raw[component_id], options, component_roles, directory / "a")
            execute_component_once(component_id, component_raw[component_id], options, component_roles, directory / "b")
            relative = output_relative / f"executions/components/{index:03d}"
            component_lanes.append({
                "componentId": component_id,
                "settingIds": component["settingIds"],
                "raw": component_raw_records[component_id],
                "support": component_support_records.get(component_id, []),
                "executions": {
                    "a": (relative / "a").as_posix(),
                    "b": (relative / "b").as_posix(),
                },
            })

        core_lane = None
        if expectation["core"]:
            core_method_receipt = output / "compiled/core-method-profile-receipt.json"
            write_private_json(core_method_receipt, core_receipt(compiled_receipt, expectation["core"]), exclusive=True)
            core_root = executions / "core"
            core_root.mkdir(mode=0o700)
            execute_core_once(raw_path, core_method_receipt, options, support, core_root / "a")
            execute_core_once(raw_path, core_method_receipt, options, support, core_root / "b")
            core_lane = {
                "settingIds": expectation["core"],
                "raw": raw_record,
                "support": support_records,
                "executions": {
                    "a": (output_relative / "executions/core/a").as_posix(),
                    "b": (output_relative / "executions/core/b").as_posix(),
                },
            }
        else:
            require(not support, "--support is unavailable when the compound profile has no core lane")

        external_lanes = []
        for binding in expectation["external"]:
            external_lanes.append({
                "executorId": binding["executorId"],
                "sourceConfigurationId": binding["sourceConfigurationId"],
                "settingIds": binding["settingIds"],
                "executionReceipt": pin(external_receipt(binding), "external execution receipt"),
            })
        run_record = {
            "kind": "compound_profile",
            "selection": selected,
            "timezone": args.timezone,
            "oracle": oracle_record,
            "compiled": compiled_record,
            "lanes": {
                "core": core_lane,
                "components": component_lanes,
                "external": external_lanes,
                "documentary": {"settingIds": expectation["documentary"]},
            },
        }
    else:
        require(not component_raw and not component_support, "--component inputs are only valid for a compound profile")
        execute_once(raw_path, receipt, options, support, executions / "a")
        execute_once(raw_path, receipt, options, support, executions / "b")
        run_record = {
            "selection": selected,
            "timezone": args.timezone,
            "raw": raw_record,
            "support": support_records,
            "oracle": oracle_record,
            "compiled": compiled_record,
            "executions": {
                "a": (output_relative / "executions/a").as_posix(),
                "b": (output_relative / "executions/b").as_posix(),
            },
        }
    if differential is not None:
        run_record["differentialReceipt"] = pin(differential, "released-code differential receipt")
    replace_blocker_with_run(document, args.profile_id, selected, run_record)

    temporary = manifest_path.with_suffix(f"{manifest_path.suffix}.conformance.tmp")
    require(not temporary.exists(), f"refusing to replace temporary execution spec: {temporary}")
    write_private_json(temporary, document, exclusive=True)
    try:
        validated = run(
            [sys.executable, str(VALIDATOR), "--manifest", str(temporary)],
            cwd=REPO,
        )
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    if sha256(manifest_path) != manifest_digest:
        temporary.unlink(missing_ok=True)
        raise ConformanceError("execution-spec manifest changed during conformance; refusing to overwrite it")
    os.replace(temporary, manifest_path)
    print(validated.stdout.strip())


if __name__ == "__main__":
    try:
        main()
    except ConformanceError as error:
        raise SystemExit(f"Android method-profile conformance failed: {error}") from None
