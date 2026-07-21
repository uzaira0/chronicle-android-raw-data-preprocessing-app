# Production browser performance baseline

This is the active Rust/WASM browser baseline. The former TypeScript/Python
comparison described retired engines and is intentionally no longer used as a
production gate.

- Captured: 2026-07-21
- Machine: Apple M3 Ultra, 512 GiB RAM, arm64 macOS 26.2
- Browser: Playwright Chromium, headless, service-worker controlled
- Fixture: deterministic generated Chronicle raw CSV, 600 events, 75,173 bytes
- Command: `make profile CSV=/tmp/chronicle-production-readiness.csv`

## End-to-end result

| Measurement | Result | Enforced budget |
|---|---:|---:|
| Processing wall time | 374.5 ms | 10,000 ms |
| Input files completed | 1/1 | all files |
| App output rows | 4,197 | non-empty |
| Screen output rows | 3,845 | non-empty when enabled |
| External requests | 0 | 0 |
| Service-worker controlled | yes | required |
| Reported JS heap delta | 0 bytes | 256 MiB |

Chromium exposes `performance.memory` only as an approximate browser metric;
the heap delta budget is a regression tripwire, not proof of peak total WASM
memory. Large-fixture browser memory profiling remains a release obligation.

## Deploy artifact

The exact build measured above occupied 8,791,595 bytes (approximately 8.38
MiB) on disk. Largest
payloads were:

| Asset | Bytes |
|---|---:|
| preprocessing runtime WASM | 3,584,583 |
| semantic index WASM | 2,307,886 |
| bundled app codebook | 2,029,388 |
| main JavaScript | 423,250 |
| graph JavaScript | 233,869 |

The repository deploy-artifact and bundle-budget checks remain authoritative;
these figures are evidence for this machine and commit, not portable promises.

## Known profiling gaps

- Peak WASM and total browser-process memory on genuinely large input files.
- Cross-browser OPFS and performance measurements outside Chromium.
- Cold-versus-warm semantic-index query profiling after adding an index cache.
- Export/import streaming memory for large workspace closures.
- Separate cost attribution for CSV-to-Parquet/SPSS generation.
