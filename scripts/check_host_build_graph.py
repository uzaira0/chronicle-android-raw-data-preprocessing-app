#!/usr/bin/env python3
"""Fail if a WASM crate's build-time dependency graph differs between Linux and macOS.

Build scripts and proc-macros are compiled for the build machine, and Cargo folds
their dependency graph into the metadata of every crate that depends on them.
A host-only platform dependency (sha2 -> cpufeatures -> libc on Apple silicon)
therefore made the same sources build different WASM bytes on a Mac and on Linux.
"""
import json
import subprocess
import sys
from pathlib import Path

CRATES = [
    "rust/chronicle_preprocessing_runtime_wasm",
    "rust/chronicle_preprocessing_semantic_adapter",
    "rust/chronicle_semantic_index_wasm",
]
PLATFORMS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin", "x86_64-apple-darwin"]


def host_edges(crate: Path, platform: str) -> set[str]:
    meta = json.loads(subprocess.run(
        ["cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", platform],
        cwd=crate, check=True, capture_output=True, text=True).stdout)
    packages = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    roots = {d["pkg"] for n in nodes.values() for d in n["deps"]
             if any(k["kind"] == "build" for k in d["dep_kinds"])}
    roots |= {i for i in nodes if any("proc-macro" in t["kind"] for t in packages[i]["targets"])}
    seen, stack, edges = set(), list(roots), set()
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        for dep in nodes[node]["deps"]:
            if all(k["kind"] == "dev" for k in dep["dep_kinds"]):
                continue
            edges.add(f'{packages[node]["name"]} {packages[node]["version"]} -> '
                      f'{packages[dep["pkg"]]["name"]} {packages[dep["pkg"]]["version"]}')
            stack.append(dep["pkg"])
    return edges


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    failed = False
    for crate in CRATES:
        graphs = {p: host_edges(root / crate, p) for p in PLATFORMS}
        reference = graphs[PLATFORMS[0]]
        for platform, edges in graphs.items():
            if edges != reference:
                failed = True
                print(f"{crate}: build-time graph on {platform} differs from {PLATFORMS[0]}:")
                for line in sorted(edges ^ reference):
                    print(f"  {'+' if line in edges else '-'} {line}")
    if not failed:
        print(f"build-time dependency graphs match on {', '.join(PLATFORMS)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
