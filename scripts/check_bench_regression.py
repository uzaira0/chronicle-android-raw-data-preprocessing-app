#!/usr/bin/env python3
"""Benchmark regression gate for the Chronicle app-usage matcher.

Reads cargo-criterion JSON lines from stdin (--message-format=json).
Compares against benchmarks/baseline.json if it exists.
Fails with exit code 1 if any benchmark has regressed by more than 25%.
Writes the current run results to benchmarks/current.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REGRESSION_THRESHOLD = 0.25  # 25% slower than baseline triggers failure

REPO_ROOT = Path(__file__).parent.parent
BASELINE_PATH = REPO_ROOT / "benchmarks" / "baseline.json"
CURRENT_PATH = REPO_ROOT / "benchmarks" / "current.json"

CURRENT_PATH.parent.mkdir(parents=True, exist_ok=True)


def parse_criterion_json(lines: list[str]) -> dict[str, float]:
    """Return {benchmark_id: mean_ns} from cargo-criterion JSON lines."""
    results: dict[str, float] = {}
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if obj.get("reason") != "benchmark-complete":
            continue
        bench_id: str = obj.get("id", "")
        mean_block = obj.get("mean") or {}
        mean_val = mean_block.get("estimate")
        unit = mean_block.get("unit", "ns")
        if bench_id and mean_val is not None:
            # cargo-criterion always reports ns; guard just in case
            if unit != "ns":
                print(
                    f"WARNING: unexpected unit '{unit}' for {bench_id!r}; skipping",
                    file=sys.stderr,
                )
                continue
            results[bench_id] = float(mean_val)
    return results


def main() -> int:
    stdin_lines = sys.stdin.read().splitlines()
    current = parse_criterion_json(stdin_lines)

    if not current:
        print("ERROR: no benchmark-complete records found in stdin.", file=sys.stderr)
        return 1

    # Normalise key format: replace '/' with '_' for the baseline JSON keys
    # so both formats work (baseline may use either separator).
    def normalise(k: str) -> str:
        return k.replace("/", "_")

    current_normalised = {normalise(k): v for k, v in current.items()}

    # Write current results
    CURRENT_PATH.write_text(
        json.dumps(
            {k: {"mean_ns": v} for k, v in current_normalised.items()},
            indent=2,
        )
        + "\n"
    )

    if not BASELINE_PATH.exists():
        print("Benchmark results (mean ns):")
        for bench_id, mean_ns in sorted(current_normalised.items()):
            print(f"  {bench_id}: {mean_ns:,.1f} ns")
        print(
            f"\nNo baseline found at {BASELINE_PATH}. Results written to benchmarks/current.json. Exiting 0 (first run)."
        )
        return 0

    baseline_raw = json.loads(BASELINE_PATH.read_text())
    # Normalise baseline keys too
    baseline = {normalise(k): v for k, v in baseline_raw.items()}

    print("Benchmark results (mean ns):")
    failures: list[str] = []
    for bench_id, baseline_entry in sorted(baseline.items()):
        baseline_ns: float = (
            baseline_entry["mean_ns"] if isinstance(baseline_entry, dict) else float(baseline_entry)
        )
        if bench_id not in current_normalised:
            print(f"WARNING: baseline key {bench_id!r} not found in current run.")
            continue
        current_ns = current_normalised[bench_id]
        ratio = (current_ns - baseline_ns) / baseline_ns
        status = ""
        if ratio > REGRESSION_THRESHOLD:
            status = f"  *** REGRESSION: {ratio:+.1%} vs baseline {baseline_ns:,.1f} ns ***"
            failures.append(
                f"{bench_id}: {current_ns:,.1f} ns vs baseline {baseline_ns:,.1f} ns ({ratio:+.1%})"
            )
        elif ratio < -0.05:
            status = f"  (improvement: {ratio:+.1%} vs baseline {baseline_ns:,.1f} ns)"
        else:
            status = f"  (within threshold: {ratio:+.1%} vs baseline {baseline_ns:,.1f} ns)"
        print(f"  {bench_id}: {current_ns:,.1f} ns{status}")

    if failures:
        print(
            f"\nFAILED: {len(failures)} benchmark(s) regressed by more than {REGRESSION_THRESHOLD:.0%}:"
        )
        for f in failures:
            print(f"  {f}")
        return 1

    print(f"\nAll benchmarks within {REGRESSION_THRESHOLD:.0%} regression threshold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
