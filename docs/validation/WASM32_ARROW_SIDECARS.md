# wasm32 Arrow sidecars: 4-byte compressed-length prefix (issue #8)

Status: **open upstream defect, workaround pinned here.** Tracked as preview
issue #8; root cause is in upstream `arrow-rs` (`arrow-ipc`), still present as
of 59.2.0.

## Symptom

Three of the four Arrow sidecars the browser runtime exports —
`source-coordinate-index-arrow`, `result-cell-correspondence-arrow`, and
`source-result-influence-arrow` — cannot be opened by any standard Arrow
reader when produced by the WASM (32-bit) build:

- pyarrow 25.0.1 `ipc.open_file(...).read_all()` →
  `ArrowMemoryError: malloc of size 1751093230692206223 failed`
- arrow-rs 59.1.0 / 59.2.0 `FileReader::try_new` →
  `memory allocation of 1751093230692206223 bytes failed` in
  `CompressionCodec::decompress_to_buffer` (dictionary batch)

`row-lineage-arrow` opens fine — none of its buffers compress smaller than
the input, so every buffer takes the uncompressed marker path.

Reproduced 2026-08-17 on the 600-event fixture from
`rustPipelineRuntimeContract.test.ts` ("bounds the exact source-coordinate
sidecar"); the exported bytes' SHA-256 matched the manifest digest, so this is
the writer's framing, not corruption in transport.

## Root cause

`arrow-ipc/src/compression.rs::compress_to_vec` writes the
uncompressed-length prefix as `uncompressed_data_len.to_le_bytes()` where
`uncompressed_data_len: usize`. The IPC format requires an 8-byte
little-endian `i64`. On `wasm32` `usize` is 4 bytes, so every **compressed**
buffer gets a 4-byte prefix, while the `-1` "not compressed" marker (an `i64`
constant) keeps its 8 bytes. A reader then interprets
`[len:u32][LZ4 magic 04 22 4D 18]` as one `i64` —
`0x184d2204_0000068f` is exactly the number in the malloc failure. Native
(64-bit) output of the same writer round-trips in pyarrow and arrow-rs.

The Rust unit tests read the writer's output on the native target, so nothing
in the gate exercises the wasm32 encoding.

## Workaround: patched reader

A vendored `arrow-ipc` 59.1.0 with a 4-byte-aware read path decodes all three
files completely (1,128 witness rows on the reproduction fixture,
dictionaries intact) — the data is sound, only the framing is wrong. Local
copies live at `/home/opt/chronicle_campaign_backup/arrow-ipc-32` (the
patched crate) and `/home/opt/chronicle_campaign_backup/witness_dump` (a
reader binary using it via `[patch.crates-io]`).

The complete patch, reproducible from a clean `arrow-ipc` 59.1.0 checkout of
`src/compression.rs`:

1. `const LENGTH_OF_PREFIX_DATA: i64 = 8;` → `4`.
2. `read_uncompressed_size` reads the first **4** bytes as a `u32`;
   `u32::MAX` maps to `LENGTH_NO_COMPRESSED_DATA` (the writer's 8-byte `-1`
   marker begins `FF FF FF FF`, so the first half identifies it), any other
   value is the uncompressed length.
3. In `decompress_to_buffer`, the not-compressed arm still slices at **8**
   (the `-1` marker keeps its full-width prefix even on wasm32); the
   compressed arm slices at `LENGTH_OF_PREFIX_DATA` (= 4).

```toml
[dependencies]
arrow-ipc = { version = "=59.1.0", features = ["lz4"] }

[patch.crates-io]
arrow-ipc = { path = "../arrow-ipc-32" }
```

This reader accepts wasm32-produced files only; do not point it at
well-formed (native) files — a genuine 8-byte prefix would be misread.

## Fix options (recorded from the issue; not yet landed)

1. **Root cause:** `[patch.crates-io]` on the *writer* with the one-line fix
   `(uncompressed_data_len as i64).to_le_bytes()` — bytes then identical
   across native and wasm32; upstream PR to apache/arrow-rs.
2. Disable IPC compression under `cfg(target_pointer_width = "32")` — always
   readable, but sidecar sizes and digests then differ between native and
   wasm32 and every pinned sidecar figure moves.
3. Add a wasm32 decode check (Arrow JS or a small IPC-frame validator) to the
   web suite so this class of drift is gated.

Option 1 + 3 is the intended fix. It changes pinned artifact figures and
needs its own evidence run, so it ships as its own change, not as a rider.

Until then, the "browser-WASM transported, and researcher-exportable" claim
in `docs/semantic-federation/production-proof.md` carries this caveat for the
three affected sidecars: export works, but reading them requires the patched
reader above.
