# Semantic Decision Coverage And Fixture Planner

Date: 2026-04-28

## Summary

Automate a coverage map between documented preprocessing semantics and tests or
pathological fixture cases, then generate a review packet for uncovered rules.

## Repo evidence

The repo has an explicit semantic contract in
`docs/app-usage-semantic-decisions.md`. Some decisions are covered directly in
`tests/test_app_usage_semantic_decisions.py`, and broader pathologies are
covered by `tests/test_pathological_fixture_builder.py` plus
`scripts/run_deterministic_web_parity.py`.

This is already a strong foundation, but the mapping is implicit. A new bullet
can be added to the decision doc without an obvious machine-readable reminder
that it needs either a focused unit test, a pathological fixture clause, or an
explicit "documented but not directly testable" waiver.

## Classification

Deterministic static-analysis script / manual audit command. This is not a
Codex automation.

This classification follows `/Users/u/AGENTS.md` Priority 4 because parsing a
decision document, matching stable IDs, and reporting missing coverage are
repeatable checks. Priority 7 requires the report to state exactly what was
verified and what remains unmapped.

## Proposed mechanism

Add a small semantic coverage planner script and a documented manual command.
The same command may be used from a pre-push hook when semantic docs or
preprocessing code changes. Do not create a Codex automation or a GitHub
Actions workflow for this local test/check surface.

The planner:

1. Parses `docs/app-usage-semantic-decisions.md` into stable decision IDs.
2. Looks for matching test markers or comments in Python, TypeScript, and parity
   fixtures, for example `semantic: same-app-stop`.
3. Reports decisions with no test/fixture link.
4. Suggests the best fixture target: focused Python unit test, pathological raw
   fixture, browser/desktop parity matrix cell, or web E2E.
5. Emits a Markdown report artifact and exits nonzero only when a changed
   decision lacks a mapping.

## Trigger

- Manual command during semantic-doc or preprocessing changes.
- Optional pre-push hook when changed files include semantic docs,
  preprocessing algorithms, timestamp handling, screen usage, browser pipeline
  logic, or parity scripts.
- Optional local monthly launchd/cron report to expose stale waivers.

## Inputs

- `docs/app-usage-semantic-decisions.md`.
- Existing tests, parity fixtures, and stable marker comments.
- Optional waiver list for documented behavior that is intentionally not tested
  directly.

## Outputs

- Decision-to-test/fixture coverage map.
- Unmapped decision list.
- Suggested deterministic target category for each gap.
- Local Markdown report artifact.

## Stop condition

Stop once every stable semantic decision has a test, fixture, parity-matrix
cell, E2E reference, or explicit waiver.

## Failure reporting

Print unmapped decision IDs, the expected marker shape, and the report path.
Escalate to Codex only when a human-level judgment is needed to design a new
test or decide whether a waiver is defensible.

## Why LLM judgment is not required

The mapping check can be expressed as document parsing plus marker lookup.
`/Users/u/AGENTS.md` Priority 4 puts that in deterministic scripts/hooks. LLM
judgment is useful only for creating or reviewing missing coverage after the
script has produced evidence.

## Why it helps

This project keeps legacy-compatible behavior intentionally, including deferred
quirks in `docs/deferred-semantic-quirks.md`. A decision-to-test map makes it
clear which behavior is protected by executable coverage and which behavior is
only documented.

## Duplicate-risk review

This is not another parity runner. It does not replace
`scripts/run_deterministic_web_parity.py` or `scripts/run_web_parity_matrix.py`;
it plans and audits semantic coverage so parity and unit tests stay aligned
with the written behavior contract.

## External references reviewed

- The Turing Way CI chapter emphasizes early detection when important behavior
  changes: https://book.the-turing-way.org/reproducible-research/ci/
- Continuous analysis literature frames automated reruns as a way to improve
  reproducibility of computational analyses: https://pmc.ncbi.nlm.nih.gov/articles/PMC6103790/
