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
selects the composed Rust/WASM runtime, but the current physical executor is
still one fused pipeline. Its 15 grouped checkpoints and 55 step statuses are
logical evidence calculated around or after that full run, not 55 independently
cached Rust computations. The active migration and acceptance checks are in
`55-step-incremental-rust-plan.md`.

Production Pages, `main`, research-pipeline, GitOps, homelab provisioning, and
runner infrastructure are outside this branch's authority.
