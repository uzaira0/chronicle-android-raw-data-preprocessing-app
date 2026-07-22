# Production browser performance baseline

This is the active Rust/WASM browser baseline. The former TypeScript/Python
comparison described retired engines and is intentionally no longer used as a
production gate.

- Captured: 2026-07-22
- Machine: Apple M3 Ultra, 512 GiB RAM, arm64 macOS 26.2
- Browser: Playwright Chromium, headless, service-worker controlled
- Fixture: deterministic generated Chronicle raw CSV, 601 lines (600 data
  rows), 111,924 bytes,
  `sha256:bedb857c9eb97b0e80692312d5a99875588d7bd3feb623bc1f07082cd83936b1`
- Commands: `npm run generate:benchmark-fixture -- --output <fixture>` then
  `npm run benchmark:browser -- --raw <fixture> --output-json`

## End-to-end result

| Measurement | Result | Enforced budget |
|---|---:|---:|
| Processing wall time | 549.1 ms | 10,000 ms |
| Input files completed | 1/1 | all files |
| App output rows | 4,272 | non-empty |
| Screen output rows | 3,892 | non-empty when enabled |
| External requests | 0 | 0 |
| Service-worker controlled | yes | required |
| Reported JS heap delta | 0 bytes | 256 MiB |

Chromium exposes `performance.memory` only as an approximate browser metric;
the heap delta budget is a regression tripwire, not proof of peak total WASM
memory. Large-fixture browser memory profiling remains a release obligation.

## Deploy artifact

The exact build measured above occupied 9,124,456 bytes (approximately 8.70
MiB) on disk. Largest
payloads were:

| Asset | Bytes |
|---|---:|
| preprocessing runtime WASM | 3,884,503 |
| semantic index WASM | 2,338,336 |
| bundled app codebook | 2,029,388 |
| main JavaScript | 423,304 |
| graph JavaScript | 233,869 |

The repository deploy-artifact and bundle-budget checks remain authoritative;
these figures are evidence for this machine and commit, not portable promises.

## Known profiling gaps

- Peak WASM and total browser-process memory on genuinely large input files.
- Cross-browser OPFS and performance measurements outside Chromium.
- Cold-versus-warm semantic-index query profiling after adding an index cache.
- Export/import streaming memory for large workspace closures.
- Separate cost attribution for CSV-to-Parquet/SPSS generation.
