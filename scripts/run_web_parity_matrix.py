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
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report: dict[str, dict] = {}
    failed = False

    for weeks in args.weeks:
        completed = subprocess.run(
            [
                "./.tmp_benchmarks/venv313/bin/python",
                str(PARITY_SCRIPT),
                "--weeks",
                str(weeks),
                "--datetime",
                args.datetime,
            ],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            failed = True
        report[str(weeks)] = {
            "returncode": completed.returncode,
            "report": json.loads(completed.stdout),
        }

    if args.report_json:
        args.report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
