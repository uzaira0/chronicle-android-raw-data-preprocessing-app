#!/usr/bin/env python3
"""Fail when the generated semantic artifacts are wrong or uncommitted.

`make check` runs `semprof closure`, which *writes* semantic/artifact-closure.json
rather than verifying it. Nothing compared the tracked file to reality, so a
closure whose recorded digests matched nothing on disk sat in the repository and
every gate stayed green: the target simply overwrote it on each run and left the
working tree quietly dirty.

Two independent checks, because they catch different failures:

1. Digest correctness - every artifacts[].digest must equal the sha256 of the
   file it names. Catches a closure that is internally wrong, and needs no git.
2. Drift - the regenerated artifacts must match what is committed. Catches the
   case above, where the file on disk is correct only because this run just
   rewrote it, while the committed copy is stale.

Same contract as `generate_semantic_behavior_inventory.py --check`: regenerate,
then commit the result.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

SEMANTIC_DIR = Path(__file__).resolve().parent.parent / "semantic"
CLOSURE = SEMANTIC_DIR / "artifact-closure.json"


def check_digests() -> list[str]:
    if not CLOSURE.exists():
        return [f"{CLOSURE.name} does not exist; run `make closure`"]
    closure = json.loads(CLOSURE.read_text(encoding="utf-8"))
    problems: list[str] = []
    for entry in closure.get("artifacts", []):
        artifact_id = entry["artifact_id"]
        target = SEMANTIC_DIR / artifact_id
        if not target.exists():
            problems.append(f"{artifact_id}: recorded in the closure but missing on disk")
            continue
        actual = "sha256:" + hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != entry["digest"]:
            problems.append(
                f"{artifact_id}: closure records {entry['digest']} but the file hashes to {actual}"
            )
    return problems


def check_drift() -> list[str]:
    """Report tracked semantic artifacts that regeneration changed."""
    result = subprocess.run(
        ["git", "status", "--porcelain", "--", str(SEMANTIC_DIR)],
        capture_output=True,
        text=True,
        cwd=SEMANTIC_DIR.parent.parent,
    )
    if result.returncode != 0:
        # Not a git checkout (tarball, vendored copy). Digest correctness above
        # still ran, so this is a skipped check rather than a pass.
        print("check-artifacts-in-sync: not a git checkout, skipping the drift check")
        return []
    changed = [
        line[3:] for line in result.stdout.splitlines() if line and not line.startswith("??")
    ]
    if not changed:
        return []
    return [
        "regenerating changed tracked artifacts, so the committed copies are stale: "
        + ", ".join(sorted(changed))
    ]


def main() -> int:
    problems = check_digests() + check_drift()
    if problems:
        print("semantic artifacts are out of sync:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\nRun `make -C .semantic-federation closure` and commit the result.",
            file=sys.stderr,
        )
        return 1
    print("check-artifacts-in-sync: closure digests correct and no drift")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
