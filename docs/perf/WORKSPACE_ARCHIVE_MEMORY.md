# Workspace archive export/import peak memory

Evidence for closing the recorded debt item "Workspace archive export/import
still materializes the full closure in memory. Large-workspace streaming
remains a release-scale memory obligation."

- Captured: 2026-08-01
- Machine: arm64 macOS 26.2, 32 logical cores
- Browser: Playwright Chromium, headless, service-worker controlled, launched
  with `--enable-precise-memory-info --js-flags=--expose-gc`
- Harness: `web/scripts/measure_workspace_archive_memory.mjs`
- Raw JSON: `docs/perf/results/workspace-archive-memory-*.json`

## What was materialized before

Export (`exportRuntimeClosure`) read every object into a `payloads` array, then
allocated one contiguous `Uint8Array` the size of the whole archive and copied
each payload into it — the closure existed twice in the worker heap at once.
That buffer was then transferred to the main thread, where the UI copied it a
third time into a `Blob`. Import was the mirror image: the picked `File` was read
whole with `arrayBuffer()`, transferred whole into the worker, parsed with
`subarray` views that pinned the entire archive, and every object was retained in
a `PersistedRuntimeArtifact[]` until the commit finished.

## What it does now

The archive format is unchanged. `chronicle-runtime-closure/v1` already places
the magic, a little-endian `u32` manifest length, and the manifest ahead of the
payload, and the manifest already declares each object's exact offset and size —
so the container was always incrementally consumable and needed no version bump.

- **Export** walks the object table twice: once over filesystem metadata
  (`storedObjectByteLength`) so the manifest can be written before any payload
  byte, then once to read, digest-verify, and append one object at a time into an
  incrementally built `Blob` (`ClosureArchiveBuilder`, 4 MiB staging budget).
- **Export/import transport** is the `Blob` itself. A structured-cloned `Blob`
  crosses the worker boundary as a handle to browser-held, disk-backed storage,
  so neither side materializes the closure to hand it over. On import the picked
  `File` is passed straight through and read one declared range at a time.
- **Placement** goes through artifact sources that produce bytes on demand, and
  `putObject` releases the source before reading the stored copy back, so the
  largest artifact is never resident twice.

Fail-closed order is byte-for-byte the same as before: framing and object table,
then every object rehashed against its declared digest, then the caller's
semantic closure verification, then workspace identity and history checks, then
object placement, and only then the alternating root slot.

## Format compatibility

The pre-change browser build and the streaming build produce **identical bytes**
for the same workspace, at both measured sizes:

| Workspace | Archive bytes | SHA-256 (both writers) |
|---|---:|---|
| 60,624 rows | 80,422,659 | `136865eabf17a3e36509584862331fd16652744346d248ba336147b18c6dcd34` |
| 242,386 rows | 307,461,120 | `8b4da100a87b5d9c2ea9700bb53cfe7d3444919c23e5792dcf101c1cb782abc9` |

Existing backups are therefore not merely still readable — they are the same
artifact this code writes. `opfsArtifactStore.test.ts` pins this in the unit
suite by keeping the removed whole-buffer writer as
`legacyExportRuntimeClosure` and asserting both that the streamed bytes equal
its output and that its output still imports.

## Measurements

Two probes per phase. `pageHeap` is `performance.memory.usedJSHeapSize` on the
main thread, precise because of `--enable-precise-memory-info`. `rendererRss` is
the resident set of the Chromium renderer processes from CDP
`SystemInfo.getProcessInfo` plus `ps`; it is the only probe that can see the Rust
runtime worker, whose isolate does not expose `performance.memory`. Both are
peaks (max over samples) measured against a baseline taken after a forced GC, and
the export context is closed before the import phase so exactly one renderer is
alive while import is sampled.

### 242,386-row workspace — 307,461,120-byte archive (293 MiB)

| Phase | Probe | Before | After | Change |
|---|---|---:|---:|---|
| Export | main-thread heap peak delta | 245,650,479 B | 403,026 B | **609× lower** |
| Export | renderer RSS peak delta | 595,574,784 B | 236,814,336 B | **2.5× lower** |
| Import | main-thread heap peak delta | 246,100 B | 487,458 B | both negligible |
| Import | renderer RSS peak delta | 540,573,696 B | 295,895,040 B | **1.83× lower** |

Before, export peak RSS was 1.94× the archive and import peak RSS was 1.76× it —
the signature of holding the closure whole, more than once. After, the main
thread never sees the archive at all (0.4 MB for a 293 MiB backup), and renderer
RSS drops below the archive size.

### 60,624-row workspace — 80,422,659-byte archive (76.7 MiB)

| Phase | Probe | Before | After |
|---|---|---:|---:|
| Export | main-thread heap peak delta | 67,658,323 B | 297,843 B |
| Export | renderer RSS peak delta | 89,882,624 B | 89,653,248 B |
| Import | main-thread heap peak delta | 206,772 B | 365,818 B |
| Import | renderer RSS peak delta | 156,172,288 B | 126,500,864 B |

At this size the renderer already carried ~500 MB of slack from processing, so
freed pages were reused and RSS understated the before case; the main-thread heap
delta (227× lower) is the clean signal. The larger fixture above is where the
renderer number separates.

### Why renderer RSS does not fall to "one object"

Retention is now one object at a time, but *peak RSS* is not, because each
object's `Blob.slice().arrayBuffer()` allocation becomes garbage that V8 has not
necessarily collected before the next one is read. The archive's 44 objects at
the 76.7 MiB size are heavily skewed — largest 18,613,651 B, median 8,164 B — so
transient buffers can accumulate toward the payload total between collections.
The difference that matters is that those bytes are now *collectable*: nothing
holds a reference to them, so the browser can reclaim under pressure. Before,
the whole-archive buffer and the payload array were live and could not be.

## Reproducing

```bash
cd web
npm run generate:benchmark-fixture -- --sessions 80000 --seed 909 \
  --output ../.tmp/huge-workspace.csv
npm run build:app
node scripts/measure_workspace_archive_memory.mjs \
  --raw ../.tmp/huge-workspace.csv --port 4291 --label current \
  --out ../.tmp/memory.json
```

The harness fails loudly when a probe is unavailable rather than reporting nulls
that would read as "no growth".
