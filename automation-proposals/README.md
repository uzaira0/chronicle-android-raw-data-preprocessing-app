# Automation Proposals

This folder tracks proposed automations for the Chronicle Android raw data
preprocessing codebase. Proposals focus on recurring checks or repeatable
workflows that reduce manual verification across the Python desktop pipeline,
Rust/WASM kernels, and local-first web/PWA surface.

Per `/Users/u/AGENTS.md` Priority 4, proposals in this repo must classify the
candidate as deterministic script/hook/manual command/non-LLM schedule versus
agentic Codex automation. Deterministic watches, test runners, command
summaries, and routine script execution should not become Codex automations.
For local test/check surfaces, do not add GitHub Actions CI workflows; prefer
repo scripts, pre-push/pre-commit hooks, launchd/cron, or manual commands.
Priority 0 and Priority 5 still apply: preserve user work, avoid destructive
operations, and keep edits scoped.

## Current proposals

- 2026-04-28: Support file lineage and default bundle sync
  (deterministic local script / hook candidate)
- 2026-04-28: Semantic decision coverage and fixture planner
  (deterministic static-analysis script / manual audit command)
- 2026-04-28: Rust/WASM fast-path promotion gate
  (deterministic local script / manual promotion command)
- 2026-04-28: Live PWA offline and privacy canary
  (deterministic local check / non-LLM schedule)
