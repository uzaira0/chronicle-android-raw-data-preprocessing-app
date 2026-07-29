# Chronicle Raw Data Preprocessing

Generated from `semantic-federation-scaffold`.

Selected computational families: `incremental_dataflow`.
Selected runtime targets: `rust_native, rust_wasm`.
Selected storage policies: `opfs_cas, append_only_journal, arrow_sidecars`.

The files in `semantic/families/` are product-owned contracts. The vendored
registry contains only the shared release protocol and standards catalog.

```sh
make semantic SEM_PROF_BIN=/path/to/semprof
make check SEM_PROF_BIN=/path/to/semprof
```
