#!/usr/bin/env python3
"""Fail closed when a number published in a document disagrees with its producer.

A figure printed in a Markdown document is a CLAIM. If nothing regenerates it,
it is unverified, and published figures in this repository have been observed
to be stale *on the day they were written* (see the entries below). This check
closes that hole: every registered figure names the artifact that produces it,
the artifact is read (or regenerated) at check time, and any disagreement is a
non-zero exit.

Registering a figure is mandatory for any number that is copied out of a
generated artifact into prose. The locator is a regex over the document rather
than a line number, so ordinary editing does not silently detach the check from
the sentence it guards; a locator that matches zero or several lines is itself
a failure.

Usage:
    scripts/check_published_figures.py            # check every figure, exit 1 on drift
    scripts/check_published_figures.py --list     # show the registry
    scripts/check_published_figures.py --json     # machine-readable report
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LEDGER_ROOT = ROOT / "web/src/lib/pipelineGraph/golden/family-expected"
SEMANTIC_MUTATION_LEDGER = LEDGER_ROOT / "semantic-model-mutation-ledger.json"
NATIVE_PROFILE_SUMMARY = (
    ROOT / "docs/perf/results/chronicle-incremental-runtime-native-summary.json"
)
RUNTIME_WASM = (
    ROOT
    / "web/src/wasm/chronicle_preprocessing_runtime_wasm/pkg"
    / "chronicle_preprocessing_runtime_wasm_bg.wasm"
)
SEMANTIC_INDEX_WASM = (
    ROOT
    / "web/src/wasm/chronicle_semantic_index_wasm/pkg"
    / "chronicle_semantic_index_wasm_bg.wasm"
)
APP_CODEBOOK = ROOT / "web/src/assets/defaults/unified_app_codebook.csv"
RUNTIME_CONTRACT_TEST = ROOT / "web/src/lib/rustPipelineRuntimeContract.test.ts"
DIST = ROOT / "web/dist"

# A figure's producer is either a committed artifact, readable in any checkout,
# or the deploy build, which only exists after `npm run build`. `make web` runs
# the committed group; `make deploy-artifact` runs the deploy group *after* the
# build. Mixing them would force every `make web` to either build the app or
# skip a figure, and a skip is how a stale number survives.
GROUP_COMMITTED = "committed"
GROUP_DEPLOY = "deploy"


# ---------- producers ----------------------------------------------------
#
# A producer returns the CURRENT value of a figure as a string, or raises
# ProducerError when the producing artifact cannot be read. A missing producer
# artifact is a failure, never a skip: "the file was not there" is exactly how
# a stale figure survives.


class ProducerError(RuntimeError):
    pass


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise ProducerError(f"producing artifact missing: {path.relative_to(ROOT)}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:  # pragma: no cover - corrupt artifact
        raise ProducerError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}")


def semantic_mutants_killed() -> str:
    counts = _load_json(SEMANTIC_MUTATION_LEDGER).get("counts")
    if not isinstance(counts, dict):
        raise ProducerError("semantic-model-mutation-ledger.json has no counts object")
    for key in ("total", "killed"):
        if key not in counts:
            raise ProducerError(f"semantic mutation ledger counts lacks '{key}'")
    return f"{counts['killed']}/{counts['total']}"


def semantic_mutants_survived() -> str:
    counts = _load_json(SEMANTIC_MUTATION_LEDGER).get("counts", {})
    if "survived" not in counts:
        raise ProducerError("semantic mutation ledger counts lacks 'survived'")
    return str(counts["survived"])


def runtime_wasm_bytes() -> str:
    if not RUNTIME_WASM.exists():
        raise ProducerError(
            f"producing artifact missing: {RUNTIME_WASM.relative_to(ROOT)} "
            "(run `cd web && npm run build:wasm`)"
        )
    return f"{RUNTIME_WASM.stat().st_size:,}"


def _stat_bytes(path: Path, cure: str = "") -> str:
    if not path.exists():
        suffix = f" ({cure})" if cure else ""
        raise ProducerError(
            f"producing artifact missing: {path.relative_to(ROOT)}{suffix}"
        )
    return f"{path.stat().st_size:,}"


def semantic_index_wasm_bytes() -> str:
    return _stat_bytes(SEMANTIC_INDEX_WASM, "run `cd web && npm run build:wasm`")


def app_codebook_bytes() -> str:
    return _stat_bytes(APP_CODEBOOK)


def runtime_contract_budget(constant: str) -> str:
    """Read one exact artifact budget pinned against the compiled runtime.

    The Vitest fixture independently executes the committed WASM and checks
    these constants against emitted artifact metadata. Binding prose to the
    constants keeps the inexpensive documentation gate deterministic while
    the runtime test remains the producer-of-truth check.
    """
    if not RUNTIME_CONTRACT_TEST.exists():
        raise ProducerError(
            f"producing test missing: {RUNTIME_CONTRACT_TEST.relative_to(ROOT)}"
        )
    source = RUNTIME_CONTRACT_TEST.read_text(encoding="utf-8")
    matches = re.findall(
        rf"^const {re.escape(constant)} = ([\d_]+);$", source, flags=re.MULTILINE
    )
    if len(matches) != 1:
        raise ProducerError(
            f"expected exactly one {constant} constant in "
            f"{RUNTIME_CONTRACT_TEST.relative_to(ROOT)}, found {len(matches)}"
        )
    return f"{int(matches[0].replace('_', '')):,}"


def _dist_asset(pattern: str) -> Path:
    """Resolve one content-hashed deploy asset.

    Vite renames every asset with a content hash, so the deploy figures cannot
    name a fixed file. Zero or several matches is a failure, not a guess: the
    published byte count would otherwise silently describe whichever build
    output happened to sort first.
    """
    if not DIST.exists():
        raise ProducerError(
            "deploy build missing: web/dist (run `cd web && npm run build`)"
        )
    matches = sorted((DIST / "assets").glob(pattern))
    if len(matches) != 1:
        raise ProducerError(
            f"expected exactly one web/dist/assets/{pattern}, found {len(matches)}"
        )
    return matches[0]


def dist_main_js_bytes() -> str:
    return _stat_bytes(_dist_asset("index-*.js"))


def dist_graph_js_bytes() -> str:
    return _stat_bytes(_dist_asset("GraphPanel-*.js"))


def dist_runtime_wasm_bytes() -> str:
    return _stat_bytes(_dist_asset("chronicle_preprocessing_runtime_wasm_bg-*.wasm"))


def dist_total_bytes() -> str:
    if not DIST.exists():
        raise ProducerError(
            "deploy build missing: web/dist (run `cd web && npm run build`)"
        )
    total = sum(path.stat().st_size for path in DIST.rglob("*") if path.is_file())
    return f"{total:,}"


def native_profile(*keys: str, decimals: int | None = None) -> str:
    """A value from the summary `make profile-current` writes from its own
    JSON-lines records; milliseconds are published to one decimal."""
    value = _load_json(NATIVE_PROFILE_SUMMARY)
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            raise ProducerError(
                f"native profile summary lacks {'.'.join(keys)}"
            )
        value = value[key]
    if not isinstance(value, (int, float)):
        raise ProducerError(f"native profile summary {'.'.join(keys)} is not a number")
    return f"{value:,.{decimals}f}" if decimals is not None else f"{value:,}"


def runtime_wasm_sha256() -> str:
    if not RUNTIME_WASM.exists():
        raise ProducerError(
            f"producing artifact missing: {RUNTIME_WASM.relative_to(ROOT)}"
        )
    return hashlib.sha256(RUNTIME_WASM.read_bytes()).hexdigest()


# ---------- registry -----------------------------------------------------


class Figure:
    """One published number, bound to the artifact that produces it."""

    def __init__(
        self,
        *,
        figure_id: str,
        document: str,
        locator: str,
        extract: str,
        producer: Callable[[], str],
        produced_by: str,
        group: str = GROUP_COMMITTED,
        note: str = "",
    ) -> None:
        self.figure_id = figure_id
        self.document = document
        self.locator = re.compile(locator)
        self.extract = re.compile(extract)
        self.producer = producer
        self.produced_by = produced_by
        self.group = group
        self.note = note


def normalize(value: str) -> str:
    """Compare figures by value, not by thousands separators or case."""
    return value.strip().replace(",", "").replace("_", "").lower()


REGISTRY: list[Figure] = [
    # Published as "116/116" in the commit that first introduced the string,
    # while the named producer already read 347/347 at that same commit. The
    # ledger total tracks the declared graph (edges, option bindings, role
    # bindings), so it moves with every pipeline/contract change.
    Figure(
        figure_id="semantic-mutants-killed",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"semantic mutants killed",
        extract=r"(\d+/\d+)\s+semantic mutants killed",
        producer=semantic_mutants_killed,
        produced_by=(
            "web/src/lib/pipelineGraph/golden/family-expected/"
            "semantic-model-mutation-ledger.json -> counts.killed/counts.total"
        ),
    ),
    # Current deploy prose separates decoded package bytes from the shipped
    # lossless transport. Neither guard rewrites the historical timing capture.
    Figure(
        figure_id="runtime-wasm-bytes-baseline",
        document="docs/perf/BASELINE.md",
        locator=r"^\| decoded preprocessing runtime WASM \| [\d,]+ \|$",
        extract=r"\| decoded preprocessing runtime WASM \| ([\d,]+) \|",
        producer=runtime_wasm_bytes,
        produced_by=(
            "stat of web/src/wasm/chronicle_preprocessing_runtime_wasm/pkg/"
            "chronicle_preprocessing_runtime_wasm_bg.wasm (force-tracked output "
            "of `npm run build:wasm`, the exact file benchmark_runtime_wasm.mts reads)"
        ),
    ),
    Figure(
        figure_id="runtime-wasm-bytes-deploy-artifact",
        document="docs/perf/BASELINE.md",
        locator=r"^\| preprocessing runtime WASM \| [\d,]+ \|$",
        extract=r"\| preprocessing runtime WASM \| ([\d,]+) \|",
        producer=dist_runtime_wasm_bytes,
        produced_by=(
            "stat of the unique web/dist/assets/"
            "chronicle_preprocessing_runtime_wasm_bg-*.wasm shipped transport"
        ),
        group=GROUP_DEPLOY,
    ),
    Figure(
        figure_id="semantic-index-wasm-bytes-deploy-artifact",
        document="docs/perf/BASELINE.md",
        locator=r"^\| semantic index WASM \| [\d,]+ \|$",
        extract=r"\| semantic index WASM \| ([\d,]+) \|",
        producer=semantic_index_wasm_bytes,
        produced_by=(
            "stat of web/src/wasm/chronicle_semantic_index_wasm/pkg/"
            "chronicle_semantic_index_wasm_bg.wasm"
        ),
    ),
    Figure(
        figure_id="app-codebook-bytes-deploy-artifact",
        document="docs/perf/BASELINE.md",
        locator=r"^\| bundled app codebook \| [\d,]+ \|$",
        extract=r"\| bundled app codebook \| ([\d,]+) \|",
        producer=app_codebook_bytes,
        produced_by="stat of web/src/assets/defaults/unified_app_codebook.csv",
    ),
    # These figures are emitted by the compiled runtime on the deterministic
    # 600-event fixture and pinned exactly by rustPipelineRuntimeContract.test.ts.
    # The documentation gate reads those pinned values; the Vitest boundary
    # test separately proves that the values still match the WASM artifacts.
    Figure(
        figure_id="source-coordinate-index-rows",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"^\| Per-result backward correspondence \|",
        extract=r"source index: ([\d,]+) coordinates",
        producer=lambda: runtime_contract_budget("EXPECTED_SOURCE_COORDINATE_ROWS"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_SOURCE_COORDINATE_ROWS (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="source-coordinate-index-bytes",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"^\| Per-result backward correspondence \|",
        extract=r"source index: [\d,]+ coordinates, ([\d,]+) bytes",
        producer=lambda: runtime_contract_budget("EXPECTED_SOURCE_COORDINATE_BYTES"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_SOURCE_COORDINATE_BYTES (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="result-cell-index-rows",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"^\| Per-result backward correspondence \|",
        extract=r"result-cell index: ([\d,]+) cells",
        producer=lambda: runtime_contract_budget("EXPECTED_RESULT_CELL_ROWS"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_RESULT_CELL_ROWS (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="result-cell-index-bytes",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"^\| Per-result backward correspondence \|",
        extract=r"result-cell index: [\d,]+ cells, ([\d,]+) bytes",
        producer=lambda: runtime_contract_budget("EXPECTED_RESULT_CELL_BYTES"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_RESULT_CELL_BYTES (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="source-result-influence-rows",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"^\| Per-result backward correspondence \|",
        extract=r"influence witness: ([\d,]+) rows",
        producer=lambda: runtime_contract_budget("EXPECTED_INFLUENCE_WITNESS_ROWS"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_INFLUENCE_WITNESS_ROWS (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="source-result-influence-bytes",
        document="docs/semantic-federation/final-review-matrix.md",
        locator=r"^\| Per-result backward correspondence \|",
        extract=r"influence witness: [\d,]+ rows, ([\d,]+) bytes",
        producer=lambda: runtime_contract_budget("EXPECTED_INFLUENCE_WITNESS_BYTES"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_INFLUENCE_WITNESS_BYTES (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="production-proof-source-coordinate-rows",
        document="docs/semantic-federation/production-proof.md",
        locator=r"source index contains [\d,]+ coordinates",
        extract=r"contains ([\d,]+) coordinates",
        producer=lambda: runtime_contract_budget("EXPECTED_SOURCE_COORDINATE_ROWS"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_SOURCE_COORDINATE_ROWS (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="production-proof-source-coordinate-bytes",
        document="docs/semantic-federation/production-proof.md",
        locator=r"^in [\d,]+ bytes, against a [\d,]+-byte raw CSV fixture",
        extract=r"in ([\d,]+) bytes",
        producer=lambda: runtime_contract_budget("EXPECTED_SOURCE_COORDINATE_BYTES"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_SOURCE_COORDINATE_BYTES (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="production-proof-result-cell-rows",
        document="docs/semantic-federation/production-proof.md",
        locator=r"representative fixture it contains [\d,]+ cells",
        extract=r"contains ([\d,]+) cells",
        producer=lambda: runtime_contract_budget("EXPECTED_RESULT_CELL_ROWS"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_RESULT_CELL_ROWS (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="production-proof-result-cell-bytes",
        document="docs/semantic-federation/production-proof.md",
        locator=r"representative fixture it contains [\d,]+ cells",
        extract=r"cells in ([\d,]+) bytes",
        producer=lambda: runtime_contract_budget("EXPECTED_RESULT_CELL_BYTES"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_RESULT_CELL_BYTES (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="production-proof-influence-rows",
        document="docs/semantic-federation/production-proof.md",
        locator=r"^Its protocol is now .* and it contains [\d,]+$",
        extract=r"contains ([\d,]+)$",
        producer=lambda: runtime_contract_budget("EXPECTED_INFLUENCE_WITNESS_ROWS"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_INFLUENCE_WITNESS_ROWS (compiled-WASM fixture assertion)"
        ),
    ),
    Figure(
        figure_id="production-proof-influence-bytes",
        document="docs/semantic-federation/production-proof.md",
        locator=r"^normalized witness rows in [\d,]+ bytes",
        extract=r"in ([\d,]+) bytes",
        producer=lambda: runtime_contract_budget("EXPECTED_INFLUENCE_WITNESS_BYTES"),
        produced_by=(
            "web/src/lib/rustPipelineRuntimeContract.test.ts -> "
            "EXPECTED_INFLUENCE_WITNESS_BYTES (compiled-WASM fixture assertion)"
        ),
    ),
    # The native profile figures are copied out of the summary that
    # scripts/profile_current_performance.sh (make profile-current) pools from
    # its committed JSON-lines records. Each locator pins the labelled sentence
    # (IN-PROCESS / PROCESS WALL / PROCESS PEAK RSS) the number belongs to.
    Figure(
        figure_id="native-cold-first-iteration-median",
        document="docs/perf/BASELINE.md",
        locator=r"^IN-PROCESS, pooled over the five seeds: first iterations median [\d,.]+ ms",
        extract=r"first iterations median ([\d,.]+) ms",
        producer=lambda: native_profile(
            "in_process_cold", "first_iteration_per_process", "median_ms", decimals=1
        ),
        produced_by=(
            "docs/perf/results/chronicle-incremental-runtime-native-summary.json -> "
            "in_process_cold.first_iteration_per_process.median_ms (IN-PROCESS)"
        ),
    ),
    Figure(
        figure_id="native-cold-process-wall-median",
        document="docs/perf/BASELINE.md",
        locator=r"^PROCESS WALL, seed 1, Hyperfine .* runs: median [\d,.]+ ms",
        extract=r"runs: median ([\d,.]+) ms",
        producer=lambda: native_profile("process_wall_cold", "median_ms", decimals=1),
        produced_by=(
            "docs/perf/results/chronicle-incremental-runtime-native-summary.json -> "
            "process_wall_cold.median_ms (Hyperfine, PROCESS WALL)"
        ),
    ),
    Figure(
        figure_id="native-cold-whole-process-peak-rss",
        document="docs/perf/BASELINE.md",
        locator=r"^PROCESS PEAK RSS [\d,]+ B maximum resident set size",
        extract=r"^PROCESS PEAK RSS ([\d,]+) B maximum",
        producer=lambda: native_profile(
            "process_peak_resident_bytes", "whole_process_usr_bin_time"
        ),
        produced_by=(
            "docs/perf/results/chronicle-incremental-runtime-native-summary.json -> "
            "process_peak_resident_bytes.whole_process_usr_bin_time (/usr/bin/time -l)"
        ),
    ),
    Figure(
        figure_id="native-cold-in-process-high-water",
        document="docs/perf/BASELINE.md",
        locator=r"^PROCESS PEAK RSS read by the example in that same run: [\d,]+ B right after",
        extract=r"same run: ([\d,]+) B right after",
        producer=lambda: native_profile(
            "process_peak_resident_bytes",
            "same_run_in_process_high_water_after_cold_execute",
        ),
        produced_by=(
            "docs/perf/results/chronicle-incremental-runtime-native-summary.json -> "
            "process_peak_resident_bytes.same_run_in_process_high_water_after_cold_execute"
        ),
    ),
    Figure(
        figure_id="native-cold-in-process-high-water-before-execute",
        document="docs/perf/BASELINE.md",
        locator=r"^PROCESS PEAK RSS read by the example in that same run: .*\([\d,]+ B after building the fixture\)",
        extract=r"\(([\d,]+) B after building the fixture\)",
        producer=lambda: native_profile(
            "process_peak_resident_bytes",
            "same_run_in_process_high_water_before_first_execute",
        ),
        produced_by=(
            "docs/perf/results/chronicle-incremental-runtime-native-summary.json -> "
            "process_peak_resident_bytes.same_run_in_process_high_water_before_first_execute"
        ),
    ),
    # The three figures below describe the Vite output, which does not exist
    # until `npm run build`. They were the rest of the same stale table: the
    # five listed assets summed to more than the stated whole-build total,
    # which is impossible, and is what exposed the drift.
    Figure(
        figure_id="deploy-build-total-bytes",
        document="docs/perf/BASELINE.md",
        locator=r"^The deploy build occupies [\d,]+ bytes",
        extract=r"occupies ([\d,]+) bytes",
        producer=dist_total_bytes,
        produced_by="recursive byte sum of web/dist (output of `npm run build` + scripts/generate-sbom.sh)",
        group=GROUP_DEPLOY,
    ),
    Figure(
        figure_id="deploy-main-js-bytes",
        document="docs/perf/BASELINE.md",
        locator=r"^\| main JavaScript \| [\d,]+ \|$",
        extract=r"\| main JavaScript \| ([\d,]+) \|",
        producer=dist_main_js_bytes,
        produced_by="stat of web/dist/assets/index-*.js",
        group=GROUP_DEPLOY,
    ),
    Figure(
        figure_id="deploy-graph-js-bytes",
        document="docs/perf/BASELINE.md",
        locator=r"^\| graph JavaScript \| [\d,]+ \|$",
        extract=r"\| graph JavaScript \| ([\d,]+) \|",
        producer=dist_graph_js_bytes,
        produced_by="stat of web/dist/assets/GraphPanel-*.js",
        group=GROUP_DEPLOY,
    ),
]


# ---------- checking -----------------------------------------------------


class FigureResult:
    def __init__(
        self,
        figure: Figure,
        status: str,
        line: int | None,
        published: str | None,
        actual: str | None,
        detail: str = "",
    ) -> None:
        self.figure = figure
        self.status = status  # ok | drift | unlocatable | producer-error
        self.line = line
        self.published = published
        self.actual = actual
        self.detail = detail

    def as_dict(self) -> dict:
        return {
            "figure_id": self.figure.figure_id,
            "document": self.figure.document,
            "line": self.line,
            "status": self.status,
            "published": self.published,
            "actual": self.actual,
            "produced_by": self.figure.produced_by,
            "detail": self.detail,
        }


def check_figure(figure: Figure) -> list[FigureResult]:
    path = ROOT / figure.document
    if not path.exists():
        return [
            FigureResult(
                figure,
                "unlocatable",
                None,
                None,
                None,
                f"document missing: {figure.document}",
            )
        ]

    lines = path.read_text().split("\n")
    hits = [(i + 1, line) for i, line in enumerate(lines) if figure.locator.search(line)]
    if not hits:
        return [
            FigureResult(
                figure,
                "unlocatable",
                None,
                None,
                None,
                "locator matched no line — the guarded sentence was renamed or "
                "deleted; update the registry entry rather than dropping it",
            )
        ]

    try:
        actual = figure.producer()
    except ProducerError as exc:
        return [FigureResult(figure, "producer-error", hits[0][0], None, None, str(exc))]

    results: list[FigureResult] = []
    for line_no, line in hits:
        match = figure.extract.search(line)
        if match is None:
            results.append(
                FigureResult(
                    figure,
                    "unlocatable",
                    line_no,
                    None,
                    actual,
                    "extract pattern did not match the located line",
                )
            )
            continue
        published = match.group(1)
        status = "ok" if normalize(published) == normalize(actual) else "drift"
        results.append(FigureResult(figure, status, line_no, published, actual))
    return results


def fix_drift(result: FigureResult) -> FigureResult:
    """Rewrite the drifted value on its located line; the producer stays the authority."""
    path = ROOT / result.figure.document
    lines = path.read_text().split("\n")
    line = lines[result.line - 1]
    match = result.figure.extract.search(line)
    lines[result.line - 1] = line[: match.start(1)] + result.actual + line[match.end(1) :]
    path.write_text("\n".join(lines))
    print(f"fixed   {result.figure.document}:{result.line}  {result.published} -> {result.actual}")
    return FigureResult(result.figure, "ok", result.line, result.actual, result.actual)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list", action="store_true", help="print the registry and exit 0"
    )
    parser.add_argument("--json", action="store_true", help="emit a JSON report")
    parser.add_argument(
        "--fix",
        action="store_true",
        help="rewrite each drifted figure in its document to the producer's value",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="FIGURE_ID",
        help="check only the named figure (repeatable)",
    )
    parser.add_argument(
        "--group",
        choices=[GROUP_COMMITTED, GROUP_DEPLOY, "all"],
        default=GROUP_COMMITTED,
        help=(
            "which producers to read: 'committed' (default, artifacts present in "
            "any checkout), 'deploy' (requires web/dist from `npm run build`), "
            "or 'all'"
        ),
    )
    args = parser.parse_args()

    # An explicit --only names figures directly and overrides the group filter.
    # Intersecting the two would let `--only <a deploy figure>` select nothing
    # and report "0/0 agree", which is the silent skip this script exists to
    # prevent.
    if args.only:
        wanted = set(args.only)
        unknown = wanted - {f.figure_id for f in REGISTRY}
        if unknown:
            print(f"unknown figure id(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        figures = [f for f in REGISTRY if f.figure_id in wanted]
    elif args.group == "all":
        figures = REGISTRY
    else:
        figures = [f for f in REGISTRY if f.group == args.group]

    if args.list:
        for figure in figures:
            print(f"{figure.figure_id}\n  document:    {figure.document}")
            print(f"  produced_by: {figure.produced_by}")
        return 0

    results: list[FigureResult] = []
    for figure in figures:
        results.extend(check_figure(figure))

    if args.fix:
        results = [fix_drift(r) if r.status == "drift" else r for r in results]

    if args.json:
        print(json.dumps([r.as_dict() for r in results], indent=2))
    else:
        for result in results:
            location = f"{result.figure.document}:{result.line or '?'}"
            if result.status == "ok":
                print(f"ok      {location}  {result.figure.figure_id} = {result.actual}")
            elif result.status == "drift":
                print(
                    f"DRIFT   {location}  {result.figure.figure_id}\n"
                    f"        published: {result.published}\n"
                    f"        actual:    {result.actual}\n"
                    f"        producer:  {result.figure.produced_by}"
                )
            else:
                print(
                    f"BROKEN  {location}  {result.figure.figure_id}\n"
                    f"        {result.detail}"
                )

    failures = [r for r in results if r.status != "ok"]
    checked = len(results)
    if failures:
        print(
            f"\npublished figures: {checked - len(failures)}/{checked} agree with "
            f"their producers; {len(failures)} failed.\n"
            "A number in a document is a claim. Re-read the producing artifact "
            "and correct the document, or correct the registry entry.",
            file=sys.stderr,
        )
        return 1

    print(f"\npublished figures: {checked}/{checked} agree with their producers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
