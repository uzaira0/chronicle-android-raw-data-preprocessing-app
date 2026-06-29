#!/usr/bin/env python3
"""Run deterministic desktop-vs-browser parity across multiple fixture sizes."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PARITY_SCRIPT = REPO_ROOT / "scripts" / "run_deterministic_web_parity.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", nargs="+", type=int, default=[2, 6])
    parser.add_argument("--datetime", default="2026-04-24 00:32:53")
    parser.add_argument("--report-json", type=Path)
    parser.add_argument(
        "--python",
        default="./.tmp_benchmarks/venv313/bin/python",
        help="Path to Python interpreter to use for each parity sub-run.",
    )
    return parser.parse_args()


def _run_parity(
    python: str,
    weeks: int,
    datetime_override: str,
    *,
    model_concurrent_usage: bool = False,
) -> dict:
    cmd = [
        python,
        str(PARITY_SCRIPT),
        "--weeks",
        str(weeks),
        "--datetime",
        datetime_override,
    ]
    if model_concurrent_usage:
        cmd.append("--model-concurrent-usage")
    completed = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError:
        parsed = {"parse_error": completed.stdout[:500], "stderr": completed.stderr[:500]}
    return {"returncode": completed.returncode, "report": parsed}


def main() -> int:
    args = parse_args()
    report: dict[str, dict] = {}
    failed = False

    for weeks in args.weeks:
        key = str(weeks)
        result = _run_parity(args.python, weeks, args.datetime)
        if result["returncode"] != 0:
            failed = True
        report[key] = result

    # Flag-on entry: concurrent (PiP) usage model, using the pathological fixture.
    # The matrix's job is desktop-vs-browser parity, not oracle comparison.
    for weeks in args.weeks:
        key = f"{weeks}_pip"
        result = _run_parity(args.python, weeks, args.datetime, model_concurrent_usage=True)
        if result["returncode"] != 0:
            failed = True
        report[key] = result

    if args.report_json:
        args.report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
