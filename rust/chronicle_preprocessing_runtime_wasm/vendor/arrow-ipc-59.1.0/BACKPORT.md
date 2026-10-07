# Arrow IPC 59.1.0 WASM compressed-length backport

This directory retains the published Apache Arrow `arrow-ipc` 59.1.0 package.
The original crates.io archive SHA-256 is
`29dac499fcbc6ba74ee0324057821d381929a48526a3966bd9dffb44aa06d98c`.
Upstream `LICENSE.txt` and `NOTICE.txt` are retained unchanged.

The sole upstream source modification is the one-line fix from
[apache/arrow-rs#10989](https://github.com/apache/arrow-rs/pull/10989):
`compression.rs` writes the compressed buffer's uncompressed-length prefix as
an eight-byte signed little-endian integer, rather than target-width `usize`.
The original four-byte WASM32 prefix produced invalid IPC files. This fix is
also included in upstream Arrow 60.0.0; the backport avoids a major API migration.

Dependency versions, features, compression, dictionary handling, writer and
reader behavior otherwise remain unchanged. Chronicle's existing production
source-digest and build-watch owners explicitly include this package's manifest
and sources, so a path override cannot evade implementation/evidence freshness.

Runtime resolution stays at 59.1.0. The semantic-index root's runtime test
dependency previously resolved IPC 59.2.0; it now uses this same patched 59.1.0
owner and drops its unused `lz4_flex` 0.14.0 resolution, retaining the existing
0.13.1 resolution. No other locked package changes and no policy exceptions
are introduced. Normal supply-chain checks still apply; this note does not
claim a fresh advisory scan or author-runtime equivalence.
