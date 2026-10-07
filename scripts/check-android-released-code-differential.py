#!/usr/bin/env python3
"""Focused local check for the released-code differential gate and manifest hook."""

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
PRIVATE_ROOT = REPO / ".tmp-literature-review-private"
SOURCE_WORK_ID = "doi:10.1016/j.chb.2023.107977"
PROFILE_ID = f"method-profile:{SOURCE_WORK_ID}"
PROVENANCE_ID = "source-artifact-provenance:method-setting-b8725165fc97aa16c5370d0c"
SOURCE_DIGEST = "sha256:ca5d3052b4a30e9a62ae046e57c890196fff1f84157b02ea324b4b0ae1c2b797"


def digest(path):
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def record(path):
    return {"path": path.relative_to(REPO).as_posix(), "sha256": digest(path)}


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        if isinstance(value, str):
            handle.write(value)
        else:
            json.dump(value, handle, indent=2)
            handle.write("\n")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def produce(fixture, options, output, mismatch=False):
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = {
        "fixtureSha256": digest(fixture),
        "options": json.loads(options.read_text(encoding="utf-8")),
        "mismatch": mismatch,
    }
    write_private(output / "result.json", payload)


def main():
    if len(sys.argv) >= 5 and sys.argv[1] == "--produce":
        produce(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[-1] == "mismatch")
        return

    os.umask(0o077)
    source = next((
        path for path in PRIVATE_ROOT.rglob("Screen_preprocessing.R")
        if path.is_file() and digest(path) == SOURCE_DIGEST
    ), None)
    if source is None:
        raise SystemExit("focused check requires the registered private Screen_preprocessing.R artifact")
    root = Path(tempfile.mkdtemp(prefix="differential-gate-check-", dir=PRIVATE_ROOT))
    root.chmod(0o700)
    try:
        fixture = root / "fixture.csv"
        options = root / "options.json"
        request = root / "request.json"
        output = root / "output"
        write_private(fixture, "event,value\nopen,5\n")
        write_private(options, {"thresholdSeconds": 5, "comparator": "strict_lt"})
        entrypoint = Path(__file__).resolve()
        gate = REPO / "scripts/run-android-released-code-differential.py"
        runtime = REPO / "scripts/validate-android-profile-execution-spec.py"
        chronicle_execution = {
            "command": [sys.executable, "{entrypoint}", "--produce", "{fixture}", "{options}", "{output}"],
            "entrypoint": record(entrypoint),
            "implementation": [record(entrypoint)],
            "runtime": [record(runtime)],
        }
        source_execution = {
            **chronicle_execution,
            "command": chronicle_execution["command"] + ["--source-artifact", f"{{sourceArtifact:{PROVENANCE_ID}}}"],
            "implementation": [record(entrypoint), record(source)],
        }
        request_value = {
            "schemaVersion": "chronicle-android-released-code-differential-request/v1",
            "methodProfileId": PROFILE_ID,
            "sourceWorkId": SOURCE_WORK_ID,
            "selection": {},
            "sourceArtifacts": [{"sourceArtifactProvenanceId": PROVENANCE_ID, **record(source)}],
            "fixture": record(fixture),
            "support": [],
            "options": record(options),
            "source": source_execution,
            "chronicle": chronicle_execution,
            "outputs": ["result.json"],
            "comparison": {"mode": "exact_bytes"},
            "timeoutSeconds": 30,
        }
        write_private(request, request_value)
        completed = subprocess.run(
            [sys.executable, str(gate), str(request), str(output)],
            cwd=REPO,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise SystemExit(f"gate check failed with status {completed.returncode}: {completed.stderr.strip()}")
        receipt_path = output / "differential-receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        assert receipt["passed"] is True
        assert receipt["comparison"]["mode"] == "exact_bytes"
        validator = load("android_execution_validator", runtime)
        validator.validate_differential_receipt(
            record(receipt_path),
            {"method_profile_id": PROFILE_ID, "source_work_id": SOURCE_WORK_ID},
            {},
        )
        unbound_request = root / "unbound-source-request.json"
        unbound_output = root / "unbound-source-output"
        unbound_value = json.loads(json.dumps(request_value))
        unbound_value["source"]["command"] = chronicle_execution["command"]
        write_private(unbound_request, unbound_value)
        unbound = subprocess.run(
            [sys.executable, str(gate), str(unbound_request), str(unbound_output)],
            cwd=REPO,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        assert unbound.returncode != 0
        assert not (unbound_output / "differential-receipt.json").exists()
        failing_request = root / "failing-request.json"
        failing_output = root / "failing-output"
        failing_value = json.loads(json.dumps(request_value))
        failing_value["chronicle"]["command"].append("mismatch")
        write_private(failing_request, failing_value)
        failed = subprocess.run(
            [sys.executable, str(gate), str(failing_request), str(failing_output)],
            cwd=REPO,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        assert failed.returncode != 0
        assert not (failing_output / "differential-receipt.json").exists()
        print("PASS: exact parity is accepted; unused released code and output drift fail closed")
    finally:
        shutil.rmtree(root)


if __name__ == "__main__":
    main()
