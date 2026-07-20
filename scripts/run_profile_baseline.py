#!/usr/bin/env python3
"""Regenerate docs/perf/BASELINE.md — the tracked performance baseline.

One command (`make profile`) produces every number an optimization claim can
be diffed against:

  1. hyperfine A/B of the two engine CLIs on the same pathological fixture
     (browser: vite-node run_browser_processing.mts · desktop: python
     run_desktop_processing.py), identical knob values (the parity pins).
  2. cProfile cumulative-time dump of the desktop hot path.
  3. The web engine's per-unit/per-step ExecutionLedger table
     (scripts/profile_steps.mts — the Phase-1 ledger IS the profiler).

Usage:
    PYTHONPATH=src python scripts/run_profile_baseline.py \
        [--weeks 4] [--repetitions 16] [--runs 5] [--out docs/perf/BASELINE.md]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import pstats
import shlex
import subprocess
import sys
import tempfile
from io import StringIO
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = REPO_ROOT / "web"
FIXED_DATETIME = "2026-04-24 00:32:53"
RAW_NAME = "Raw_pathological_1.csv"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}", file=sys.stderr)
    return subprocess.run(cmd, check=True, **kwargs)


def cpu_model() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "unknown"


def write_browser_spec(spec_path: Path, raw_csv: Path, output_dir: Path) -> None:
    spec = {
        "inputFileName": raw_csv.name,
        "rawCsvPath": str(raw_csv),
        "outputDir": str(output_dir),
        "options": {
            "studyName": "Profile Baseline",
            "minimumUsageDuration": 0,
            "proximityIntervalSeconds": 0,
            "processAppUsage": True,
            "processScreenUsage": True,
            "enablePlotting": False,
            "parallelProcessing": False,
            "selectedTimezone": "America/Chicago",
            "timezoneHandling": "selected-filter",
            "useFilterFile": True,
            "useAppsForcingScreenOpenFile": True,
            "useAppCodebook": True,
        },
        "runtime": {"datetimeOfPreprocessing": FIXED_DATETIME},
        "supportFilePaths": {
            "filterFile": str(
                WEB_DIR / "src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"
            ),
            "appsForcingScreenOpenFile": str(
                REPO_ROOT
                / "apps_forcing_screen_open_files/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"
            ),
            "appCodebookFile": str(
                REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv"
            ),
        },
    }
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")


def fmt_ms(ms: float) -> str:
    return f"{ms / 1000:.2f}s" if ms >= 1000 else f"{ms:.1f}ms"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", type=int, default=4)
    parser.add_argument("--repetitions", type=int, default=16)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "docs/perf/BASELINE.md")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="chronicle-profile-") as temp_dir:
        temp = Path(temp_dir)
        fixture_dir = temp / "fixture"
        fixture_dir.mkdir()

        run(
            [
                sys.executable,
                "scripts/build_pathological_raw_fixture.py",
                "--output-folder", str(fixture_dir),
                "--files", "1",
                "--repetitions", str(args.repetitions),
                "--weeks", str(args.weeks),
            ],
            cwd=REPO_ROOT,
        )
        raw_csv = fixture_dir / RAW_NAME
        row_count = sum(1 for _ in raw_csv.open()) - 1

        spec_path = temp / "browser_spec.json"
        browser_out = temp / "browser_out"
        browser_out.mkdir()
        write_browser_spec(spec_path, raw_csv, browser_out)

        # Every interpolated path is shell-quoted — hyperfine hands these
        # strings to a shell, and unquoted paths break on spaces.
        browser_cmd = (
            f"cd {shlex.quote(str(WEB_DIR))} && "
            f"npm exec vite-node -- scripts/run_browser_processing.mts {shlex.quote(str(spec_path))}"
        )
        desktop_workdir = temp / "desktop_work"
        desktop_cmd = (
            f"cd {shlex.quote(str(REPO_ROOT))} && "
            f"PYTHONPATH=src {shlex.quote(sys.executable)} scripts/run_desktop_processing.py"
            f" --raw {shlex.quote(str(raw_csv))} --workdir {shlex.quote(str(desktop_workdir))}"
        )

        hyperfine_json = temp / "hyperfine.json"
        run(
            [
                "hyperfine",
                "--warmup", "1",
                "--runs", str(args.runs),
                "--export-json", str(hyperfine_json),
                "--command-name", "browser (vite-node, WASM matcher)",
                "--command-name", "desktop (python + rust matcher)",
                browser_cmd,
                desktop_cmd,
            ],
        )
        hyperfine = json.loads(hyperfine_json.read_text())

        # cProfile the desktop hot path (one run).
        pstats_path = temp / "desktop.pstats"
        run(
            [
                sys.executable,
                "-m", "cProfile",
                "-o", str(pstats_path),
                "scripts/run_desktop_processing.py",
                "--raw", str(raw_csv),
                "--workdir", str(temp / "desktop_prof"),
            ],
            cwd=REPO_ROOT,
            env={**os.environ, "PYTHONPATH": "src"},
        )
        stats_buffer = StringIO()
        stats = pstats.Stats(str(pstats_path), stream=stats_buffer)
        stats.sort_stats(pstats.SortKey.CUMULATIVE)
        stats_buffer.write("Top 25 by cumulative time (all frames):\n")
        stats.print_stats(25)
        stats_buffer.write("\nTop 25 by cumulative time (chronicle_preprocessing_app frames):\n")
        stats.print_stats("chronicle_preprocessing_app", 25)
        cprofile_text = "\n".join(
            line.rstrip() for line in stats_buffer.getvalue().splitlines() if line.strip()
        )

        # Web per-step ledger profile on the same fixture.
        ledger_run = run(
            ["npm", "exec", "vite-node", "--", "scripts/profile_steps.mts", str(raw_csv)],
            cwd=WEB_DIR,
            capture_output=True,
            text=True,
        )
        try:
            ledger = json.loads(ledger_run.stdout)
        except json.JSONDecodeError:
            # Surface the profiler's own diagnostics instead of a bare decode error.
            print("profile_steps.mts produced non-JSON stdout:", file=sys.stderr)
            print(ledger_run.stdout[:2000], file=sys.stderr)
            print("--- stderr ---", file=sys.stderr)
            print(ledger_run.stderr[:4000], file=sys.stderr)
            raise

    generated = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = []
    lines.append("# Performance baseline")
    lines.append("")
    lines.append(
        "Regenerated by `make profile` (scripts/run_profile_baseline.py) — do not hand-edit. "
        "Every optimization claim diffs against this file."
    )
    lines.append("")
    lines.append(f"- Generated: {generated}")
    lines.append(f"- Machine: {platform.platform()} · {cpu_model()}")
    lines.append(f"- Python: {platform.python_version()} · fixture: {row_count:,} rows "
                 f"(weeks={args.weeks}, repetitions={args.repetitions})")
    lines.append("")
    lines.append("## Engine A/B (hyperfine, same fixture, parity-pinned knobs)")
    lines.append("")
    lines.append("| command | mean | stddev | min | max | runs |")
    lines.append("|---|---|---|---|---|---|")
    for result in hyperfine["results"]:
        lines.append(
            f"| {result['command']} | {result['mean']:.2f}s | {result['stddev']:.2f}s "
            f"| {result['min']:.2f}s | {result['max']:.2f}s | {len(result['times'])} |"
        )
    lines.append("")
    lines.append(
        "Note: browser numbers include vite-node startup/transform (~seconds); the ledger "
        "table below is the in-pipeline time and is the number step optimizations move."
    )
    lines.append("")
    lines.append("## Web engine — per-unit ledger time (ExecutionLedger)")
    lines.append("")
    lines.append(f"Pipeline wall total: {fmt_ms(ledger['grandTotalMs'])}")
    lines.append("")
    lines.append("| unit | total | share | rows in→out |")
    lines.append("|---|---|---|---|")
    for unit in ledger["units"]:
        share = unit["totalMs"] / ledger["grandTotalMs"] * 100
        lines.append(
            f"| {unit['unit']} | {fmt_ms(unit['totalMs'])} | {share:.1f}% "
            f"| {unit['rowsIn']:,}→{unit['rowsOut']:,} |"
        )
    lines.append("")
    lines.append("## Web engine — top 15 steps by ledger time")
    lines.append("")
    lines.append("| step | total | share | rows in→out | dropped |")
    lines.append("|---|---|---|---|---|")
    for step in ledger["steps"][:15]:
        share = step["totalMs"] / ledger["grandTotalMs"] * 100
        lines.append(
            f"| {step['key']} | {fmt_ms(step['totalMs'])} | {share:.1f}% "
            f"| {step['rowsIn']:,}→{step['rowsOut']:,} | {step['droppedRows']:,} |"
        )
    lines.append("")
    lines.append("## Desktop engine — cProfile (cumulative)")
    lines.append("")
    lines.append("```")
    lines.append(cprofile_text)
    lines.append("```")
    lines.append("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
