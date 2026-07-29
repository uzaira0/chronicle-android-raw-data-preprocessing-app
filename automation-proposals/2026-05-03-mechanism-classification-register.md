# Proposal: Automation Mechanism Classification Register

Policy basis: `/Users/u/AGENTS.md` Priority 0 preserves dirty work and forbids destructive cleanup; Priority 2 requires current file evidence over memory; Priority 4 sends deterministic recurring work to scripts, hooks, launchd, cron, CI, or manual commands instead of Codex automations; Priority 5 keeps edits narrow; Priority 7 requires explicit verification and failure reporting.

This register classifies the existing automation candidates for this repo. It is
not an activation request. It also does not authorize creating GitHub Actions
workflows for local test/check automation; local checks should remain local
scripts, hooks, schedules, or manual commands unless a separate user request
asks for hosted CI. Deterministic rows must not be promoted into Codex
automations unless a later proposal adds a concrete judgment step that cannot be
scripted.

| Candidate | Classification | Required mechanism and stop condition |
| --- | --- | --- |
| `2026-04-28-live-pwa-offline-privacy-canary.md` | Deterministic non-LLM schedule/manual command | Use a local or scheduled PWA canary script that records offline/privacy checks and stops after producing a pass/fail artifact. |
| `2026-04-28-rust-wasm-fast-path-promotion-gate.md` | Deterministic manual command or hook | Run the Rust/WASM build, benchmark, and promotion gate from a script; stop at threshold pass/fail plus artifact paths. |
| `2026-04-28-semantic-decision-coverage-and-fixture-planner.md` | Deterministic script with manual review | Generate coverage/fixture gaps mechanically; stop with a review packet instead of opening an LLM automation. |
| `2026-04-28-support-file-lineage-and-default-bundle-sync.md` | Deterministic script or hook | Validate lineage, bundle sync, hashes, and duplicates; stop on first invariant failure with exact file references. |

Failure reporting: every deterministic mechanism should emit a compact artifact with command, inputs, changed paths, and exact failing invariant. Codex may be used only as a separate follow-up to interpret a failing packet and choose a repair.
