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

## Large Rust/WASM runtime baseline

The 600-row browser check above is retained as a fast end-to-end gate. A
second, artifact-heavy baseline now measures the production Rust/WASM entry
point at realistic scale, including every enabled correspondence export.

- Captured: 2026-07-23
- Runtime: Node 22.23.1 loading the production browser WASM on arm64 macOS
- Fixture: 60,624 data rows, 11,525,930 bytes,
  `sha256:8bf14d199724ad7df3cb8822241b4d6355d20977e0c7eb0e92799f06dd2b8e60`
- Options: concurrent-usage modeling, screen-gated crediting, and aggregate
  exports enabled
- Command: `npx vite-node scripts/benchmark_runtime_wasm.mts --raw <fixture>
  --full-options`

| Measurement | Final result |
|---|---:|
| Hyperfine process median (5 runs) | 8.817 s |
| Hyperfine process range | 8.794–8.823 s |
| Rust/WASM `execute_workspace` | 8,372 ms |
| Artifact extraction | 12.7 ms |
| SHA-256 verification of all artifacts | 51.5 ms |
| Measured total inside benchmark | 8,445 ms |
| Maximum resident set size (`/usr/bin/time -l`) | 945,635,328 bytes |
| Produced artifacts | 43 / 143,005,771 bytes |
| Runtime WASM | 4,762,609 bytes |
| Published-output digest | `sha256:c34427afd08fe31acdfa4a7509d6d87ce739b5171fed4c05e84a5e037ab54258` |

The matching pre-optimization fixture measured 10,956.8 ms inside
`execute_workspace` and 1,421,639,680 bytes maximum RSS. The current code is
about 24% faster on that direct execution measurement and uses about 33%
less peak process memory. The output digest is unchanged.

All five Hyperfine measurements landed within 29 milliseconds. The median is
the tracked comparison value. This is a machine-specific regression baseline,
not a portable latency promise.

The production hot path was also captured with symbol-preserving WASM/V8 CPU
profiles and a native Samply flamegraph. The final named WASM profile attributes
23.3% of samples to BLAKE3 SIMD compression and 14.3% to SHA-256 compression;
those hashes protect checkpoint and artifact identity and remain intact.
`cProfile` confirms the Python metadata generator is not on the product path
(616,557 calls in 0.221 seconds, with YAML parsing dominant).

## Deploy artifact

The exact final deploy build occupied 9,758,545 bytes (approximately 9.31
MiB) on disk. Largest
payloads were:

| Asset | Bytes |
|---|---:|
| preprocessing runtime WASM | 4,762,609 |
| semantic index WASM | 2,099,237 |
| bundled app codebook | 2,029,388 |
| main JavaScript | 420,820 |
| graph JavaScript | 233,870 |

The repository deploy-artifact and bundle-budget checks remain authoritative;
these figures are evidence for this machine and commit, not portable promises.

## Known profiling gaps

- Repeated large-fixture peak RSS in Chromium rather than the Node WASM host.
- Cross-browser OPFS and performance measurements outside Chromium.
- Cold-versus-warm semantic-index query profiling after adding an index cache.
- Export/import streaming memory for large workspace closures.
- Separate cost attribution for CSV-to-Parquet/SPSS generation.
