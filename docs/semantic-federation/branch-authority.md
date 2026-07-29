# Semantic federation branch authority

- Raw-data preprocessing feature behavior: `origin/codebook-refresh-and-bcm-rename@b857be0382777892d4fa8c8a3a48934b07e6ad0c`.
- Rust/WASM implementation base: `origin/desktop-removal@5f8e64527edd33f90901cd553602063daadf0014`.
- Current isolated implementation branch: `codex/chronicle-55-step-authority`.
- Baseline inspected before the 55-query correction plan:
  `d7271fdd18ddac898af44e9ee36168c4d2a5ab9b`.
- Canonical checkout: deliberately untouched because an external local consumer
  currently imports its Python engine.

The isolated branch is stacked on desktop-removal. The generated YAML is a
structural projection, not an executable body. The production browser worker
selects the composed Rust/WASM runtime. The branch now contains 55 real
Salsa-tracked Rust computations and a stateful engine with complete four-mode
parity against the fused Rust oracle. The production runtime consumes actual
Salsa execution events and derives the existing 15-group display state from
them. The profiled Salsa snapshot path was slower than cold recalculation and
has been deleted along with its browser cache pointers, serializer, patched
Salsa fork, and trial crate. OPFS retains verified inputs and complete result
history; a replacement worker recalculates from those inputs. The exact live
status and acceptance checks are in
`55-step-incremental-rust-plan.md`; no other document is an independent plan.

Production Pages, `main`, research-pipeline, GitOps, homelab provisioning, and
runner infrastructure are outside this branch's authority.
