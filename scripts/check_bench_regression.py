#!/usr/bin/env python3
"""Benchmark regression gate for the Chronicle app-usage matcher.

Parses plain criterion output (``cargo bench``): every
``<criterion-dir>/<group>/<param>/new/`` directory carries ``benchmark.json``
(the benchmark's ``full_id``) and ``estimates.json`` (mean in nanoseconds).
cargo-criterion's ``--message-format=json`` stream is NOT required — this
repository runs the stock criterion harness via
``CRITERION_HOME=benchmarks/criterion cargo bench`` (see ``make
bench-regression``).

Compares against the committed baseline (default ``benchmarks/baseline.json``)
and fails with exit code 1 if any benchmark's mean regressed by more than 25%.
Writes the current run to ``benchmarks/current.json`` (gitignored).

Usage:
  cargo bench first (via make bench-regression), then:
    scripts/check_bench_regression.py                 # gate vs committed baseline
    scripts/check_bench_regression.py --baseline P    # gate vs an alternate baseline
    scripts/check_bench_regression.py --write-baseline  # (re)capture the baseline
  BENCH_BASELINE env var also overrides the baseline path.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from datetime import date
from pathlib import Path

REGRESSION_THRESHOLD = 0.25  # 25% slower than baseline triggers failure

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_BASELINE_PATH = REPO_ROOT / "benchmarks" / "baseline.json"
DEFAULT_CRITERION_DIR = REPO_ROOT / "benchmarks" / "criterion"
CURRENT_PATH = REPO_ROOT / "benchmarks" / "current.json"


def collect_criterion_estimates(criterion_dir: Path) -> dict[str, float]:
    """Return {full_benchmark_id: mean_ns} from plain criterion's data dir."""
    results: dict[str, float] = {}
    for benchmark_json in sorted(criterion_dir.glob("*/*/new/benchmark.json")):
        estimates_json = benchmark_json.with_name("estimates.json")
        if not estimates_json.exists():
            continue
        try:
            bench_meta = json.loads(benchmark_json.read_text())
            estimates = json.loads(estimates_json.read_text())
        except json.JSONDecodeError as err:
            print(f"WARNING: unparseable criterion JSON under {benchmark_json.parent}: {err}", file=sys.stderr)
            continue
        bench_id = bench_meta.get("full_id", "")
        mean_val = (estimates.get("mean") or {}).get("point_estimate")
        if bench_id and mean_val is not None:
            # criterion estimates are always in nanoseconds
            results[bench_id] = float(mean_val)
    return results


def normalise(key: str) -> str:
    """Match baseline keys regardless of '/' vs '_' separators."""
    return key.replace("/", "_")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path(os.environ.get("BENCH_BASELINE", DEFAULT_BASELINE_PATH)),
        help="baseline JSON to compare against (env: BENCH_BASELINE; default benchmarks/baseline.json)",
    )
    parser.add_argument(
        "--criterion-dir",
        type=Path,
        default=DEFAULT_CRITERION_DIR,
        help="criterion data dir written by CRITERION_HOME=... cargo bench (default benchmarks/criterion)",
    )
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="write the current run's means to the baseline path instead of gating",
    )
    args = parser.parse_args()

    if not args.criterion_dir.is_dir():
        print(
            f"ERROR: criterion data dir not found at {args.criterion_dir}.\n"
            "Run the benches first: make bench-regression (or CRITERION_HOME=benchmarks/criterion "
            "cargo bench --manifest-path rust/chronicle_app_usage_matcher/Cargo.toml --no-default-features).",
            file=sys.stderr,
        )
        return 1

    current = collect_criterion_estimates(args.criterion_dir)
    if not current:
        print(f"ERROR: no */new/estimates.json results found under {args.criterion_dir}.", file=sys.stderr)
        return 1

    current_normalised = {normalise(k): v for k, v in current.items()}

    CURRENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CURRENT_PATH.write_text(
        json.dumps({k: {"mean_ns": v} for k, v in sorted(current_normalised.items())}, indent=2) + "\n"
    )

    if args.write_baseline:
        payload: dict[str, object] = {
            "_meta": {
                "captured": date.today().isoformat(),
                "machine": f"{platform.machine()} {platform.system()} {platform.release()}",
                "source": "CRITERION_HOME=benchmarks/criterion cargo bench --no-default-features --bench matcher_bench",
                "threshold": f"mean regression > {REGRESSION_THRESHOLD:.0%} fails scripts/check_bench_regression.py",
            }
        }
        payload.update({k: {"mean_ns": v} for k, v in sorted(current_normalised.items())})
        args.baseline.parent.mkdir(parents=True, exist_ok=True)
        args.baseline.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"Baseline written to {args.baseline} ({len(current_normalised)} benchmarks).")
        return 0

    if not args.baseline.exists():
        print("Benchmark results (mean ns):")
        for bench_id, mean_ns in sorted(current_normalised.items()):
            print(f"  {bench_id}: {mean_ns:,.1f} ns")
        print(
            f"\nNo baseline found at {args.baseline}. Results written to {CURRENT_PATH}. "
            "Exiting 0 (first run); capture one with --write-baseline."
        )
        return 0

    baseline_raw = json.loads(args.baseline.read_text())
    baseline = {normalise(k): v for k, v in baseline_raw.items() if not k.startswith("_")}

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
        for failure in failures:
            print(f"  {failure}")
        return 1

    print(f"\nAll benchmarks within {REGRESSION_THRESHOLD:.0%} regression threshold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
