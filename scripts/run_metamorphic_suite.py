#!/usr/bin/env python3
"""Metamorphic-DIFFERENTIAL suite over the pathological fixture.

Byte-parity proves the two engines AGREE; it never proves either is correct.
Each metamorphic relation (MR) here transforms the raw input and asserts a
known input/output relation on BOTH engines independently, then re-asserts
cross-engine parity on the transformed input:

  * engines diverge on a transformed input  -> at least one engine is wrong;
  * engines agree but the relation fails    -> a SHARED bug — the class
    byte-parity alone can never catch.

Battery v1 (numbering follows docs/dag-validate-ontologize-productize-
research.md §S2; relations chosen to be THEOREMS of the intended semantics,
not aspirations):

  MR-1   shuffle-unique      permuting rows with UNIQUE timestamps is
                             output-invariant (the engines sort internally;
                             ties are excluded because tie-break is defined
                             by input order).
  MR-2   tie-permute         reordering rows WITHIN tied-timestamp groups has
                             no invariance claim (tie-break = input order) —
                             but the engines must still agree with each other.
  MR-17  duplicate-row       an exact consecutive duplicate row is collapsed
                             by dedup → output-invariant.
  MR-19  crlf                CRLF line endings are semantics-preserving →
                             output-invariant.
  MR-20  pid-bijection       renaming the participant (file name + ID
                             columns) yields the identical output modulo the
                             same renaming (byte-equal after back-rename).
  MR-8   day-shift (+7d)     shifting every event by exactly 7×24h preserves
                             usage CONTENT: per-type row counts and the
                             multiset of durations are invariant (calendar
                             columns legitimately move; DST edges may move a
                             midnight-adjacent event's local day, so day
                             bucketing is NOT asserted).

Run:  PYTHONPATH=src .venv/bin/python scripts/run_metamorphic_suite.py
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import tempfile
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import polars as pl

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from run_deterministic_web_parity import (  # noqa: E402
    FIXED_DATETIME,
    RAW_FILE_NAME,
    _build_options,
    _compare_csvs,
    _run_browser_processing,
    _run_desktop,
    _write_browser_spec,
)
from chronicle_preprocessing_app.config.constants import UsageSessionMode  # noqa: E402
from chronicle_preprocessing_app.utils.pathological_fixture_builder import (  # noqa: E402
    FixtureBuildConfig,
    build_pathological_raw_dataframe,
)

REPO_ROOT = SCRIPTS_DIR.parent
TS_COLUMN = "event_timestamp"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weeks", type=int, default=2)
    parser.add_argument("--datetime", default=FIXED_DATETIME)
    parser.add_argument("--report-json", type=Path)
    return parser.parse_args()


# ── Input transforms (polars df → polars df, or text-level) ─────────────────


def transform_shuffle_unique(df: pl.DataFrame) -> pl.DataFrame:
    """Permute rows whose timestamp is UNIQUE among the singleton positions;
    tied-timestamp rows keep their exact positions and relative order."""
    timestamps = df[TS_COLUMN].to_list()
    counts = Counter(timestamps)
    singleton_positions = [i for i, ts in enumerate(timestamps) if counts[ts] == 1]
    permuted = singleton_positions[:]
    random.Random(42).shuffle(permuted)
    new_order = list(range(df.height))
    for position, source in zip(singleton_positions, permuted):
        new_order[position] = source
    return df[new_order]


def transform_tie_permute(df: pl.DataFrame) -> pl.DataFrame:
    """Reverse the relative order WITHIN each tied-timestamp group."""
    timestamps = df[TS_COLUMN].to_list()
    groups: dict[str, list[int]] = {}
    for index, ts in enumerate(timestamps):
        groups.setdefault(ts, []).append(index)
    new_order = list(range(df.height))
    for indices in groups.values():
        if len(indices) > 1:
            for position, source in zip(indices, reversed(indices)):
                new_order[position] = source
    return df[new_order]


def transform_duplicate_row(df: pl.DataFrame) -> pl.DataFrame:
    """Insert an exact copy of a middle row immediately after itself."""
    middle = df.height // 2
    return pl.concat([df[: middle + 1], df[middle : middle + 1], df[middle + 1 :]])


def transform_day_shift(df: pl.DataFrame, days: int = 7) -> pl.DataFrame:
    """Add exactly days×24h by rewriting the leading YYYY-MM-DD of each
    timestamp (format-preserving; the time-of-day text is untouched)."""

    def shift(ts: str) -> str:
        day_part = date.fromisoformat(ts[:10]) + timedelta(days=days)
        return f"{day_part.isoformat()}{ts[10:]}"

    return df.with_columns(
        pl.col(TS_COLUMN).map_elements(shift, return_dtype=pl.String).alias(TS_COLUMN)
    )


# ── Engine runners ───────────────────────────────────────────────────────────


def run_both_engines(
    scenario: str,
    raw_df: pl.DataFrame,
    temp_root: Path,
    datetime_override: str,
    *,
    raw_file_name: str = RAW_FILE_NAME,
    crlf: bool = False,
) -> dict[str, Path]:
    """Run desktop + browser on one raw frame; return output CSV paths."""
    scenario_root = temp_root / scenario
    desktop_raw_dir = scenario_root / "raw"
    desktop_raw_dir.mkdir(parents=True)
    desktop_raw_path = desktop_raw_dir / raw_file_name
    raw_df.write_csv(desktop_raw_path)
    if crlf:
        text = desktop_raw_path.read_text(encoding="utf-8")
        desktop_raw_path.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))

    options = _build_options(
        raw_data_folder=desktop_raw_dir,
        use_app_codebook=True,
        use_filter_file=True,
        use_apps_forcing_screen_open_file=True,
        usage_session_mode=UsageSessionMode.APP_AND_SCREEN_USAGE,
        datetime_override=datetime_override,
    )
    # _run_desktop returns P01-named paths; derive this scenario's participant
    # names from the shared output folder so pid-bijection scenarios resolve.
    participant = raw_file_name.replace("Raw ", "").replace(".csv", "")
    desktop_app_p01, _ = _run_desktop(desktop_raw_path, options, scenario_root)
    desktop_folder = desktop_app_p01.parent
    desktop_app = desktop_folder / f"{participant} Automatically Preprocessed.csv"
    desktop_screen = desktop_folder / f"{participant} Screen Usage Automatically Preprocessed.csv"
    if not desktop_app.exists():
        raise RuntimeError(f"desktop app output missing for {scenario}: {desktop_app}")

    browser_output_dir = scenario_root / "browser"
    browser_output_dir.mkdir()
    spec_path = scenario_root / "spec.json"
    _write_browser_spec(
        spec_path,
        raw_csv_path=desktop_raw_path,
        output_dir=browser_output_dir,
        options={
            "studyName": "Deterministic Parity",
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
        datetime_override=datetime_override,
        support_file_paths={
            "filterFile": str(
                REPO_ROOT
                / "web/src/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv"
            ),
            "appsForcingScreenOpenFile": str(
                REPO_ROOT
                / "apps_forcing_screen_open_files/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv"
            ),
            "appCodebookFile": str(
                REPO_ROOT / "src/chronicle_preprocessing_app/data/unified_app_codebook.csv"
            ),
        },
    )
    # The browser runner derives output names from the spec's inputFileName;
    # pin it to this scenario's file name so pid-bijection renames flow through.
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["inputFileName"] = raw_file_name
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    _run_browser_processing(spec_path)

    stem = raw_file_name[: -len(".csv")]
    outputs = {
        "desktop_app": desktop_app,
        "browser_app": browser_output_dir / f"{stem} Automatically Preprocessed.csv",
    }
    if desktop_screen.exists():
        outputs["desktop_screen"] = desktop_screen
        outputs["browser_screen"] = (
            browser_output_dir / f"{stem} Screen Usage Automatically Preprocessed.csv"
        )
    return outputs


# ── Relations ────────────────────────────────────────────────────────────────


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def relation_byte_equal(base: Path, transformed: Path) -> dict:
    equal = read_text(base) == read_text(transformed)
    return {"holds": equal, "detail": None if equal else "outputs differ"}


def relation_byte_equal_after_rename(base: Path, transformed: Path, old: str, new: str) -> dict:
    equal = read_text(base) == read_text(transformed).replace(new, old)
    return {"holds": equal, "detail": None if equal else f"outputs differ modulo {new}->{old}"}


def usage_signature(path: Path) -> Counter:
    """Multiset of (interaction_type, duration_seconds) — the shift-invariant
    usage CONTENT of an output."""
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return Counter(
        (row.get("interaction_type", ""), row.get("duration_seconds", "")) for row in rows
    )


def relation_usage_signature_equal(base: Path, transformed: Path) -> dict:
    base_sig = usage_signature(base)
    new_sig = usage_signature(transformed)
    if base_sig == new_sig:
        return {"holds": True, "detail": None}
    missing = base_sig - new_sig
    extra = new_sig - base_sig
    return {
        "holds": False,
        "detail": {
            "missing": list(missing.items())[:5],
            "extra": list(extra.items())[:5],
        },
    }


def parity(outputs: dict[str, Path]) -> dict:
    report = {"app": _compare_csvs(outputs["desktop_app"], outputs["browser_app"])}
    if "desktop_screen" in outputs:
        report["screen"] = _compare_csvs(outputs["desktop_screen"], outputs["browser_screen"])
    return report


def parity_clean(report: dict) -> bool:
    return all(not surface["mismatches"] for surface in report.values())


# ── Main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    args = parse_args()
    report: dict[str, dict] = {}
    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="chronicle-metamorphic-") as temp_dir:
        temp_root = Path(temp_dir)
        base_df = build_pathological_raw_dataframe(config=FixtureBuildConfig(weeks=args.weeks))

        base = run_both_engines("base", base_df, temp_root, args.datetime)
        base_parity = parity(base)
        report["base"] = {"parity": base_parity}
        if not parity_clean(base_parity):
            failures.append("base parity")

        def check(name: str, outputs: dict[str, Path], relations: dict[str, dict]) -> None:
            mr_parity = parity(outputs)
            entry: dict = {"parity_clean": parity_clean(mr_parity), "relations": relations}
            if not entry["parity_clean"]:
                entry["parity"] = mr_parity
                failures.append(f"{name}: cross-engine parity")
            for relation_name, result in relations.items():
                if not result["holds"]:
                    failures.append(f"{name}: {relation_name}")
            report[name] = entry

        # MR-1 shuffle-unique → invariant on both engines.
        outputs = run_both_engines(
            "mr1_shuffle_unique", transform_shuffle_unique(base_df), temp_root, args.datetime
        )
        check(
            "mr1_shuffle_unique",
            outputs,
            {
                "desktop_app_invariant": relation_byte_equal(base["desktop_app"], outputs["desktop_app"]),
                "browser_app_invariant": relation_byte_equal(base["browser_app"], outputs["browser_app"]),
                "desktop_screen_invariant": relation_byte_equal(base["desktop_screen"], outputs["desktop_screen"]),
            },
        )

        # MR-2 tie-permute → differential only (tie-break is input order by spec).
        outputs = run_both_engines(
            "mr2_tie_permute", transform_tie_permute(base_df), temp_root, args.datetime
        )
        check("mr2_tie_permute", outputs, {})

        # MR-17 consecutive duplicate row → collapsed by dedup, invariant.
        outputs = run_both_engines(
            "mr17_duplicate_row", transform_duplicate_row(base_df), temp_root, args.datetime
        )
        check(
            "mr17_duplicate_row",
            outputs,
            {
                "desktop_app_invariant": relation_byte_equal(base["desktop_app"], outputs["desktop_app"]),
                "browser_app_invariant": relation_byte_equal(base["browser_app"], outputs["browser_app"]),
            },
        )

        # MR-19 CRLF input → invariant.
        outputs = run_both_engines("mr19_crlf", base_df, temp_root, args.datetime, crlf=True)
        check(
            "mr19_crlf",
            outputs,
            {
                "desktop_app_invariant": relation_byte_equal(base["desktop_app"], outputs["desktop_app"]),
                "browser_app_invariant": relation_byte_equal(base["browser_app"], outputs["browser_app"]),
            },
        )

        # MR-20 participant bijection P01→P99 → identical modulo rename.
        renamed_df = base_df.with_columns(
            [
                pl.col(column).str.replace_all("P01", "P99").alias(column)
                for column, dtype in zip(base_df.columns, base_df.dtypes)
                if dtype == pl.String
            ]
        )
        outputs = run_both_engines(
            "mr20_pid_bijection",
            renamed_df,
            temp_root,
            args.datetime,
            raw_file_name="Raw P99.csv",
        )
        check(
            "mr20_pid_bijection",
            outputs,
            {
                "desktop_app_equal_mod_rename": relation_byte_equal_after_rename(
                    base["desktop_app"], outputs["desktop_app"], "P01", "P99"
                ),
                "browser_app_equal_mod_rename": relation_byte_equal_after_rename(
                    base["browser_app"], outputs["browser_app"], "P01", "P99"
                ),
            },
        )

        # MR-8 +7×24h shift → usage content invariant (calendar columns move).
        outputs = run_both_engines(
            "mr8_day_shift", transform_day_shift(base_df), temp_root, args.datetime
        )
        check(
            "mr8_day_shift",
            outputs,
            {
                "desktop_usage_signature": relation_usage_signature_equal(
                    base["desktop_app"], outputs["desktop_app"]
                ),
                "browser_usage_signature": relation_usage_signature_equal(
                    base["browser_app"], outputs["browser_app"]
                ),
            },
        )

    print(json.dumps(report, indent=2, default=str))
    if args.report_json:
        args.report_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    if failures:
        print(f"METAMORPHIC FAILURES ({len(failures)}):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("All metamorphic relations hold; cross-engine parity clean on every transform.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
