# Semantic federation branch authority

- Chronicle feature behavior: `origin/codebook-refresh-and-bcm-rename@b857be0382777892d4fa8c8a3a48934b07e6ad0c`.
- Rust/WASM implementation base: `origin/desktop-removal@5f8e64527edd33f90901cd553602063daadf0014`.
- Isolated implementation branch: `codex/semantic-federation-rust-wasm`.
- Canonical checkout: deliberately untouched because an external local consumer
  currently imports its Python engine.

The isolated branch is stacked on desktop-removal. Feature behavior is a shadow
comparison oracle, not a merge target and not a declaration that generated YAML
contains executable bodies.

Production Pages, `main`, research-pipeline, GitOps, homelab provisioning, and
runner infrastructure are outside this branch's authority.
