#!/usr/bin/env python3
"""Benchmark Polars-py vs PyO3 chrono kernels on the Python side.

Mirrors the methodology of the WASM bench at web/.tmp/profile/kernels_full.json:
warm up once on a representative fixture, then time the same operations
across the same five large fixtures used by the WASM bench.

Three operations are compared:

1. format_timestamps
   - Polars-py:  df.with_columns(pl.col('ts').dt.convert_time_zone(tz).dt.strftime(fmt))
   - PyO3:       _rust_chrono_kernel.format_timestamps(ts_ns_list, tz)
   Inputs are pre-parsed nanosecond timestamps so we are timing format only.

2. sort_by_timestamp_stable
   - Polars-py:  df.sort(by='ts')         (stable, multi-threaded)
   - PyO3:       _rust_chrono_kernel.sort_by_timestamp_stable(ts_ns_list)

3. process_pipeline_e2e
   - Polars-py:  parse CSV with pl.read_csv -> sort -> dedup -> format
                 (our shape of "the equivalent of what PyO3 e2e does")
   - PyO3:       _rust_chrono_kernel.process_pipeline_e2e(csv_bytes, tz)
   The PyO3 e2e produces 6-column simplified CSV; we build the same shape
   in Polars and compare timestamps for parity.

Outputs:
  web/.tmp/profile/python_bench.log
  web/.tmp/profile/python_bench.json
"""

from __future__ import annotations

import io
import json
import os
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import polars as pl

import _rust_chrono_kernel as kernel  # type: ignore[import-not-found]

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "web" / ".tmp" / "test-csvs"
OUT_DIR = REPO_ROOT / "web" / ".tmp" / "profile"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Same five fixtures used by the WASM bench.
FIXTURES = [
    "chronicle_raw_035_dangling.csv",
    "chronicle_raw_074_duplicates.csv",
    "chronicle_raw_054_kitchen-sink.csv",
    "chronicle_raw_028_single.csv",
    "chronicle_raw_024_shutdown.csv",
]

TIMEZONE = "America/Chicago"
FORMAT_STR = "%Y-%m-%d %H:%M:%S%:z"  # Rust chrono shape; Polars uses %z (no colon).
ITERATIONS = 5  # per (fixture, operation, implementation)


def _bytes_to_int_list(b) -> list[int]:
    """PyO3 returns Vec<u8> as Python `bytes`; convert to int list."""
    if isinstance(b, bytes):
        return list(b)
    return list(b)


def fmt_ms(seconds: float) -> str:
    return f"{seconds * 1000:7.2f} ms"


def time_call(fn, *args, **kwargs) -> tuple[float, object]:
    t0 = time.perf_counter()
    out = fn(*args, **kwargs)
    return time.perf_counter() - t0, out


@dataclass
class FixtureBench:
    fixture: str
    n_rows: int
    fmt_polars: list[float]
    fmt_pyo3: list[float]
    sort_polars: list[float]
    sort_pyo3: list[float]
    e2e_polars: list[float]
    e2e_pyo3: list[float]
    parity_fmt_match: bool
    parity_sort_match: bool
    parity_e2e_match: bool


def parse_with_kernel(csv_bytes: bytes) -> dict:
    """Use the Rust parse_raw_csv to produce columns deterministically."""
    cols = kernel.parse_raw_csv(csv_bytes)
    return cols


def polars_format(ts_ns: list[int], tz: str) -> list[str]:
    """The shape of formatting work the Python pipeline currently does."""
    df = pl.DataFrame({"ts": pl.Series("ts", ts_ns, dtype=pl.Int64)})
    df = df.with_columns(pl.col("ts").cast(pl.Datetime("ns", time_zone="UTC")))
    df = df.with_columns(
        pl.col("ts")
        .dt.convert_time_zone(tz)
        .dt.strftime("%Y-%m-%d %H:%M:%S%z")
        .alias("ts_str")
    )
    return df.get_column("ts_str").to_list()


def normalize_offset(s: str) -> str:
    """Polars writes -0600; chrono writes -06:00. Compare under either shape."""
    if len(s) >= 5 and (s[-5] in {"+", "-"}) and s[-3] != ":":
        return s[:-2] + ":" + s[-2:]
    return s


def polars_sort(ts_ns: list[int]) -> list[int]:
    df = pl.DataFrame({"ts": pl.Series("ts", ts_ns, dtype=pl.Int64), "i": pl.arange(0, len(ts_ns), eager=True).cast(pl.UInt32)})
    return df.sort("ts").get_column("i").to_list()


def polars_e2e(csv_bytes: bytes, tz: str) -> bytes:
    """Polars-py end-to-end equivalent of process_pipeline_e2e."""
    # 1. parse
    df = pl.read_csv(io.BytesIO(csv_bytes), infer_schema_length=0)
    # 2. ensure required cols, parse ts -> Datetime[ns, UTC] like the real pipeline
    timestamp_text = pl.col("event_timestamp").cast(pl.Utf8)
    parsed = pl.coalesce(
        [
            timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                format="%Y-%m-%dT%H:%M:%S%#z", time_zone="UTC", strict=False
            ),
            timestamp_text.str.replace(r"Z$", "+00:00").str.to_datetime(
                format="%Y-%m-%d %H:%M:%S%#z", time_zone="UTC", strict=False
            ),
            timestamp_text.str.to_datetime(
                format="%Y-%m-%d %H:%M:%S", time_zone="UTC", strict=False
            ),
            timestamp_text.str.to_datetime(
                format="%Y-%m-%dT%H:%M:%S", time_zone="UTC", strict=False
            ),
        ]
    )
    df = df.with_columns(parsed.alias("event_timestamp"))
    df = df.filter(pl.col("event_timestamp").is_not_null())
    # 3. stable sort by timestamp
    df = df.sort("event_timestamp")
    # 4. dedup on (ts, interaction, package)
    df = df.unique(
        subset=["event_timestamp", "interaction_type", "app_package_name"],
        keep="first",
        maintain_order=True,
    )
    # 5. format + project to the 6-col simplified output
    local = pl.col("event_timestamp").dt.convert_time_zone(tz)
    df = df.with_columns(
        local.dt.strftime("%Y-%m-%d %H:%M:%S%z").alias("event_timestamp_str"),
        local.dt.strftime("%Y-%m-%d").alias("date"),
        local.dt.hour().cast(pl.UInt8).alias("hour"),
        # Chronicle 1=Sun..7=Sat. Polars weekday: 1=Mon..7=Sun.
        ((local.dt.weekday() % 7) + 1).cast(pl.UInt8).alias("day"),
    )
    df = df.select(
        pl.col("event_timestamp_str").alias("event_timestamp"),
        "app_package_name",
        "interaction_type",
        "date",
        "hour",
        "day",
    )
    buf = io.BytesIO()
    df.write_csv(buf)
    return buf.getvalue()


def normalize_csv_for_parity(b: bytes) -> list[tuple[str, str, str, str, str, str]]:
    """Read a 6-col CSV and return rows with normalized offsets for compare."""
    df = pl.read_csv(io.BytesIO(b), infer_schema_length=0)
    cols = ["event_timestamp", "app_package_name", "interaction_type", "date", "hour", "day"]
    if any(c not in df.columns for c in cols):
        return []
    df = df.select(cols)
    out: list[tuple[str, str, str, str, str, str]] = []
    for row in df.iter_rows():
        ts = normalize_offset(str(row[0]))
        out.append((ts, str(row[1]), str(row[2]), str(row[3]), str(row[4]), str(row[5])))
    return out


def bench_fixture(path: Path) -> FixtureBench:
    csv_bytes = path.read_bytes()
    cols = parse_with_kernel(csv_bytes)
    ts_ns = list(cols["event_timestamp_ns"])
    n = len(ts_ns)

    # ---- format_timestamps ---------------------------------------------
    fmt_polars_times: list[float] = []
    fmt_pyo3_times: list[float] = []
    polars_strs: list[str] = []
    pyo3_strs: list[str] = []
    for i in range(ITERATIONS):
        t, polars_strs_i = time_call(polars_format, ts_ns, TIMEZONE)
        fmt_polars_times.append(t)
        if i == 0:
            polars_strs = polars_strs_i
    for i in range(ITERATIONS):
        t, out = time_call(kernel.format_timestamps, ts_ns, TIMEZONE)
        fmt_pyo3_times.append(t)
        if i == 0:
            pyo3_strs = list(out["event_timestamp_strings"])

    parity_fmt = (
        len(polars_strs) == len(pyo3_strs)
        and all(
            normalize_offset(a) == normalize_offset(b)
            for a, b in zip(polars_strs, pyo3_strs)
        )
    )

    # ---- sort_by_timestamp_stable --------------------------------------
    sort_polars_times: list[float] = []
    sort_pyo3_times: list[float] = []
    polars_perm: list[int] = []
    pyo3_perm: list[int] = []
    for i in range(ITERATIONS):
        t, perm_i = time_call(polars_sort, ts_ns)
        sort_polars_times.append(t)
        if i == 0:
            polars_perm = perm_i
    for i in range(ITERATIONS):
        t, perm_i = time_call(kernel.sort_by_timestamp_stable, ts_ns)
        sort_pyo3_times.append(t)
        if i == 0:
            pyo3_perm = list(perm_i)

    # Stable sort -> permutations should produce identical sorted ts sequences.
    polars_sorted = [ts_ns[i] for i in polars_perm]
    pyo3_sorted = [ts_ns[i] for i in pyo3_perm]
    parity_sort = polars_sorted == pyo3_sorted

    # ---- process_pipeline_e2e ------------------------------------------
    e2e_polars_times: list[float] = []
    e2e_pyo3_times: list[float] = []
    polars_csv = b""
    pyo3_csv = b""
    for i in range(ITERATIONS):
        t, b = time_call(polars_e2e, csv_bytes, TIMEZONE)
        e2e_polars_times.append(t)
        if i == 0:
            polars_csv = b
    for i in range(ITERATIONS):
        t, b = time_call(kernel.process_pipeline_e2e, csv_bytes, TIMEZONE)
        e2e_pyo3_times.append(t)
        if i == 0:
            pyo3_csv = bytes(b)

    polars_rows = normalize_csv_for_parity(polars_csv)
    pyo3_rows = normalize_csv_for_parity(pyo3_csv)
    parity_e2e = polars_rows == pyo3_rows

    return FixtureBench(
        fixture=path.name,
        n_rows=n,
        fmt_polars=fmt_polars_times,
        fmt_pyo3=fmt_pyo3_times,
        sort_polars=sort_polars_times,
        sort_pyo3=sort_pyo3_times,
        e2e_polars=e2e_polars_times,
        e2e_pyo3=e2e_pyo3_times,
        parity_fmt_match=parity_fmt,
        parity_sort_match=parity_sort,
        parity_e2e_match=parity_e2e,
    )


def fmt_summary_line(label: str, polars_t: list[float], pyo3_t: list[float], parity: bool) -> str:
    p_med = statistics.median(polars_t)
    r_med = statistics.median(pyo3_t)
    speedup = p_med / r_med if r_med > 0 else float("inf")
    parity_str = "OK" if parity else "MISMATCH"
    return (
        f"  {label:<28} polars={fmt_ms(p_med)}  pyo3={fmt_ms(r_med)}  "
        f"speedup={speedup:5.2f}x  parity={parity_str}"
    )


def main() -> int:
    log_path = OUT_DIR / "python_bench.log"
    json_path = OUT_DIR / "python_bench.json"

    log_lines: list[str] = []

    def emit(s: str) -> None:
        print(s)
        log_lines.append(s)

    emit("Chronicle Python kernels bench: Polars-py vs PyO3 chrono kernel")
    emit(f"  fixtures dir : {FIXTURE_DIR}")
    emit(f"  iterations   : {ITERATIONS}")
    emit(f"  timezone     : {TIMEZONE}")
    emit(f"  polars       : {pl.__version__}")
    emit(f"  python       : {sys.version.split()[0]}")
    emit("")

    # Warm up once on a representative fixture (the duplicates one is dense).
    warmup_path = FIXTURE_DIR / "chronicle_raw_074_duplicates.csv"
    if warmup_path.exists():
        emit(f"Warming up on {warmup_path.name}...")
        bench_fixture(warmup_path)
        emit("Warmup done.\n")

    results: list[FixtureBench] = []
    for name in FIXTURES:
        path = FIXTURE_DIR / name
        if not path.exists():
            emit(f"SKIP {name} (not found)")
            continue
        emit(f"Benching {name} ({os.path.getsize(path) / (1024*1024):.1f} MB)...")
        r = bench_fixture(path)
        results.append(r)
        emit(f"  rows: {r.n_rows}")
        emit(fmt_summary_line("format_timestamps", r.fmt_polars, r.fmt_pyo3, r.parity_fmt_match))
        emit(fmt_summary_line("sort_by_timestamp_stable", r.sort_polars, r.sort_pyo3, r.parity_sort_match))
        emit(fmt_summary_line("process_pipeline_e2e", r.e2e_polars, r.e2e_pyo3, r.parity_e2e_match))
        emit("")

    # Aggregate medians-of-medians for the headline.
    if results:
        emit("Aggregate (median across fixtures of per-fixture median):")
        for op_name, polars_attr, pyo3_attr, parity_attr in [
            ("format_timestamps", "fmt_polars", "fmt_pyo3", "parity_fmt_match"),
            ("sort_by_timestamp_stable", "sort_polars", "sort_pyo3", "parity_sort_match"),
            ("process_pipeline_e2e", "e2e_polars", "e2e_pyo3", "parity_e2e_match"),
        ]:
            polars_meds = [statistics.median(getattr(r, polars_attr)) for r in results]
            pyo3_meds = [statistics.median(getattr(r, pyo3_attr)) for r in results]
            p_med = statistics.median(polars_meds)
            r_med = statistics.median(pyo3_meds)
            speedup = p_med / r_med if r_med > 0 else float("inf")
            parity_all = all(getattr(r, parity_attr) for r in results)
            parity_str = "OK" if parity_all else "MISMATCH"
            emit(
                f"  {op_name:<28} polars={fmt_ms(p_med)}  pyo3={fmt_ms(r_med)}  "
                f"speedup={speedup:5.2f}x  parity={parity_str}"
            )

    # Write outputs.
    log_path.write_text("\n".join(log_lines) + "\n")
    json_payload = {
        "iterations": ITERATIONS,
        "timezone": TIMEZONE,
        "polars_version": pl.__version__,
        "python_version": sys.version.split()[0],
        "fixtures": [
            {
                "fixture": r.fixture,
                "n_rows": r.n_rows,
                "format_timestamps": {
                    "polars_seconds": r.fmt_polars,
                    "pyo3_seconds": r.fmt_pyo3,
                    "polars_median_ms": statistics.median(r.fmt_polars) * 1000,
                    "pyo3_median_ms": statistics.median(r.fmt_pyo3) * 1000,
                    "speedup": (statistics.median(r.fmt_polars) / statistics.median(r.fmt_pyo3))
                    if statistics.median(r.fmt_pyo3) > 0
                    else None,
                    "parity": r.parity_fmt_match,
                },
                "sort_by_timestamp_stable": {
                    "polars_seconds": r.sort_polars,
                    "pyo3_seconds": r.sort_pyo3,
                    "polars_median_ms": statistics.median(r.sort_polars) * 1000,
                    "pyo3_median_ms": statistics.median(r.sort_pyo3) * 1000,
                    "speedup": (statistics.median(r.sort_polars) / statistics.median(r.sort_pyo3))
                    if statistics.median(r.sort_pyo3) > 0
                    else None,
                    "parity": r.parity_sort_match,
                },
                "process_pipeline_e2e": {
                    "polars_seconds": r.e2e_polars,
                    "pyo3_seconds": r.e2e_pyo3,
                    "polars_median_ms": statistics.median(r.e2e_polars) * 1000,
                    "pyo3_median_ms": statistics.median(r.e2e_pyo3) * 1000,
                    "speedup": (statistics.median(r.e2e_polars) / statistics.median(r.e2e_pyo3))
                    if statistics.median(r.e2e_pyo3) > 0
                    else None,
                    "parity": r.parity_e2e_match,
                },
            }
            for r in results
        ],
    }
    json_path.write_text(json.dumps(json_payload, indent=2) + "\n")
    emit("")
    emit(f"Wrote {log_path}")
    emit(f"Wrote {json_path}")
    log_path.write_text("\n".join(log_lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
