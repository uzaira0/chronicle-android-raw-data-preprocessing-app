# Semantic federation branch authority

**Every branch named below has been deleted.** `git ls-remote --heads origin`
returns `main` plus two open Dependabot branches; the SHAs remain reachable
locally by hash and are kept here as provenance, not as checkout targets.

- Current authority: `main@3c598ee1d223dbb18b8e9b59008b2c251846e105`. Everything
  in this directory describes that commit.
- Raw-data preprocessing feature behavior (merged, branch deleted):
  `codebook-refresh-and-bcm-rename@b857be0382777892d4fa8c8a3a48934b07e6ad0c`.
- Rust/WASM implementation base (merged, branch deleted):
  `desktop-removal@5f8e64527edd33f90901cd553602063daadf0014`.
- Implementation branch (squash-merged as `121e7b5` in PR #81, then deleted):
  `codex/chronicle-55-step-authority`.
- Baseline inspected before the 55-query correction plan:
  `d7271fdd18ddac898af44e9ee36168c4d2a5ab9b`.
- Canonical checkout on the production machine: deliberately left on the
  `last-python-engine` tag because the `research-pipeline` consumer still
  imports the removed Python engine. Do not pull current `main` there.

The generated YAML is a structural projection, not an executable body. The
production browser worker selects the composed Rust/WASM runtime. `main`
contains 55 real Salsa-tracked Rust computations and a stateful engine with
complete four-mode parity against the fused Rust oracle. The production runtime
consumes actual Salsa execution events and derives the existing 15-group
display state from them. The profiled Salsa snapshot path was slower than cold
recalculation and has been deleted along with its browser cache pointers,
serializer, patched Salsa fork, and trial crate. OPFS retains verified inputs
and complete result history; a replacement worker resumes from a verified
step-16 or step-28 value when one validates and otherwise recalculates from
those inputs. The exact live status and acceptance checks are in
`55-step-incremental-rust-plan.md`; no other document is an independent plan.

`main` is no longer outside this work's authority — PR #81 (`121e7b5`) and
PR #88 (`3c598ee`) landed there. Production Pages, research-pipeline, GitOps,
homelab provisioning, and runner infrastructure remain outside it. Landing on
`main` does not deploy: `web-pwa-deploy.yml` has been `workflow_dispatch` only
since PR #85 (`b315858`).
