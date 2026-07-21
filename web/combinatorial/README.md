# Combinatorial coverage of the processing-option contract

Implements §S3 of `docs/dag-validate-ontologize-productize-research.md`: measure
how much of the option space the executed test suite actually reaches (NIST CCM),
then close the gap with generated covering arrays (Microsoft PICT).

Everything here derives from the LinkML contract via
`web/scripts/generate_combinatorial_model.mts`, which maps each of the 54
contract keys to named equivalence classes (booleans → true/false, enums → each
value, numbers → default + boundary, arrays → default + empty/alternate) and
fails loudly when the contract grows a key it does not know.

Regenerate + remeasure with `make combinatorial` (repo root). The command has a
portable, exact valid-tuple coverage verifier and uses the checked-in arrays
when PICT is unavailable. If `pict` is on `PATH` (or `PICT_BIN` is set), it also
regenerates them. NIST CCM is an optional independent differential measurement,
not a workstation-specific prerequisite. Tool build instructions are in
`scripts/run_combinatorial_coverage.sh`.

## Files

| file | role |
|------|------|
| `model.pict` | Microsoft PICT model (equivalence classes + illegal-combo constraints) |
| `model.acts.txt` | Same model in NIST ACTS format, consumed by CCM |
| `existing_tests.csv` | The 150 EXECUTED test configs (6 parity scenarios + 128 exec-gate sweep + 16 analyze-gate sweep), projected onto the classes |
| `covering_t2.tsv` / `covering_t3.tsv` | PICT covering arrays (all pairs / all triples) |
| `covering_array_t2.json` / `covering_array_t3.json` | Decoded full option objects, executed by `web/src/lib/pipelineGraph/coveringArrayValidation.test.ts` |

Constraints model the two illegal/inert regions: `selected-*` timezone handling
requires a selected timezone; `primary-*` ignores it (pinned to `none` so inert
variation stays out of the coverage denominator).

## Measured coverage (CCM, 2026-07-17)

| test set | rows | total 2-way | fully-covered pairs | total 3-way |
|----------|------|-------------|---------------------|-------------|
| executed suite (before) | 150 | **43.5%** | 92/1431 (6.4%) | **26.4%** |
| + PICT t=2 (18 rows) + t=3 (62 rows) | 230 | **100%** | 1431/1431 | **100%** |

The hand-written sweeps varied only the 11 gate booleans around two base
points (ALL_ON and the parity defaults) — every pair involving a non-gate knob
(thresholds, timeouts, enum values, array shapes) was untested until the
covering arrays. The 80 generated configs now execute in the unit suite with
engine-level invariants (statuses match the closed-form bypass spec; only the
documented fail-loud wipe error is tolerated).

Notes:
- CCM's stock `ccmcl.jar` cannot run headless (Swing `JFrame` in a static
  initializer). The repository therefore does not require a private patched
  build: its exact verifier is the gate, while a `ccm` on `PATH` or `CCM_CMD`
  enables a differential measurement.
- CCM at t=4 with constraints is slow (choco solver per combination); measure
  t≤3 routinely, t=4 only when needed (`TWAY=2,3,4`).
