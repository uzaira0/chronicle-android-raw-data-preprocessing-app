# Chronicle Salsa 0.28.1 patch

This directory contains the unmodified Salsa 0.28.1 crate source from
crates.io, except for one persistence compatibility fix in
`src/function.rs`.

Salsa 0.28.1 deserializes a serialized memo key into `&str`. That requires a
deserializer backed by one contiguous borrowed byte buffer, so it fails for a
streaming MessagePack reader. Chronicle restores a large, LZ4-compressed Salsa
database directly from the decompression stream to avoid holding a second
uncompressed copy in memory. The local patch deserializes that temporary key
into an owned `String` instead. The parsed key is used only during the current
loop iteration, so this does not change Salsa's stored state or query behavior.

Upstream source at the time the patch was recorded:

- crate: `salsa 0.28.1`
- repository: <https://github.com/salsa-rs/salsa>
- upstream `master`: `dcbcc7082c3b90cd5ec30a200337ab9ab05eedfa`
- inspected: 2026-07-23

Both upstream licenses are retained verbatim. Remove this vendor copy once an
exact released Salsa version contains the owned-key fix and passes Chronicle's
native/WASM persistence tests.
